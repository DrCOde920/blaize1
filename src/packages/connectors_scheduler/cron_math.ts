/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure 5-Field Cron Expression Parser & IANA Timezone / DST Next-Run Calculator.
 * Zero dependency on runtime or workspace packages to prevent circular imports.
 */

export interface ParsedCronExpression {
  raw: string;
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  dayOfMonthWildcard: boolean;
  dayOfWeekWildcard: boolean;
  hourWildcardOrStep: boolean;
}

const DOW_NAME_MAP: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const MONTH_NAME_MAP: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

function replaceNamedTokens(
  token: string,
  nameMap?: Record<string, number>
): string {
  if (!nameMap) return token;
  let upper = token.toUpperCase();
  for (const [name, num] of Object.entries(nameMap)) {
    upper = upper.replace(new RegExp(`\\b${name}\\b`, 'g'), String(num));
  }
  return upper;
}

function parseCronField(
  fieldStr: string,
  min: number,
  max: number,
  fieldName: string,
  nameMap?: Record<string, number>,
  normalizeSevenToZero: boolean = false
): { values: Set<number>; isWildcard: boolean; hasStepOrWildcard: boolean } {
  const cleaned = replaceNamedTokens(fieldStr.trim(), nameMap);
  if (!cleaned) {
    throw new Error(`Invalid cron ${fieldName} field: empty`);
  }

  const values = new Set<number>();
  const isWildcard = cleaned === '*';
  const hasStepOrWildcard = cleaned.includes('*') || cleaned.includes('/');

  const parts = cleaned.split(',');
  for (const part of parts) {
    const [rangePart, stepPart] = part.split('/');
    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid step '${stepPart}' in cron ${fieldName} field '${fieldStr}'`);
      }
    }

    let start = min;
    let end = max;

    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [sStr, eStr] = rangePart.split('-');
      start = Number(sStr);
      end = Number(eStr);
      if (normalizeSevenToZero && end === 7 && start <= 6) {
        for (let v = start; v <= 6; v += step) {
          values.add(v);
        }
        if ((7 - start) % step === 0) {
          values.add(0);
        }
        continue;
      }
    } else {
      const single = Number(rangePart);
      if (!Number.isInteger(single)) {
        throw new Error(`Invalid number '${rangePart}' in cron ${fieldName} field '${fieldStr}'`);
      }
      const normalized = normalizeSevenToZero && single === 7 ? 0 : single;
      if (normalized < min || normalized > max) {
        throw new Error(
          `Value ${single} out of bounds [${min}-${max}] in cron ${fieldName} field '${fieldStr}'`
        );
      }
      if (stepPart !== undefined) {
        start = normalized;
        end = max;
      } else {
        values.add(normalized);
        continue;
      }
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      throw new Error(
        `Invalid range '${rangePart}' in cron ${fieldName} field '${fieldStr}' (bounds ${min}-${max})`
      );
    }

    for (let v = start; v <= end; v += step) {
      values.add(normalizeSevenToZero && v === 7 ? 0 : v);
    }
  }

  if (values.size === 0) {
    throw new Error(`Cron ${fieldName} field '${fieldStr}' produced no valid values.`);
  }

  return { values, isWildcard, hasStepOrWildcard };
}

export function parseCronExpression(expression: string): ParsedCronExpression {
  if (!expression || typeof expression !== 'string') {
    throw new Error('Cron expression must be a non-empty string.');
  }
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week). Got ${fields.length}: '${expression}'`
    );
  }

  const minParsed = parseCronField(fields[0], 0, 59, 'minute');
  const hourParsed = parseCronField(fields[1], 0, 23, 'hour');
  const domParsed = parseCronField(fields[2], 1, 31, 'dayOfMonth');
  const monthParsed = parseCronField(fields[3], 1, 12, 'month', MONTH_NAME_MAP);
  const dowParsed = parseCronField(fields[4], 0, 6, 'dayOfWeek', DOW_NAME_MAP, true);

  return {
    raw: expression.trim(),
    minutes: minParsed.values,
    hours: hourParsed.values,
    daysOfMonth: domParsed.values,
    months: monthParsed.values,
    daysOfWeek: dowParsed.values,
    dayOfMonthWildcard: domParsed.isWildcard,
    dayOfWeekWildcard: dowParsed.isWildcard,
    hourWildcardOrStep: hourParsed.hasStepOrWildcard,
  };
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getFormatterForTimeZone(timeZone: string): Intl.DateTimeFormat {
  let fmt = dtfCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    dtfCache.set(timeZone, fmt);
  }
  return fmt;
}

export interface ZonedWallClockParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  dayOfWeek: number; // 0-6 (Sun-Sat)
  localDateKey: string; // YYYY-MM-DD
  localWallClockIso: string; // YYYY-MM-DDTHH:MM:00
}

const WEEKDAY_SHORT_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedWallClockParts(
  epochMs: number,
  timeZone: string
): ZonedWallClockParts {
  const fmt = getFormatterForTimeZone(timeZone);
  const parts = fmt.formatToParts(new Date(epochMs));
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let dayOfWeek = 0;

  for (const p of parts) {
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
    else if (p.type === 'hour') {
      hour = Number(p.value);
      if (hour === 24) hour = 0;
    } else if (p.type === 'minute') minute = Number(p.value);
    else if (p.type === 'second') second = Number(p.value);
    else if (p.type === 'weekday') dayOfWeek = WEEKDAY_SHORT_MAP[p.value] ?? 0;
  }

  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');
  const hStr = String(hour).padStart(2, '0');
  const minStr = String(minute).padStart(2, '0');
  const localDateKey = `${year}-${mStr}-${dStr}`;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfWeek,
    localDateKey,
    localWallClockIso: `${localDateKey}T${hStr}:${minStr}:00`,
  };
}

function matchesCronDay(
  parsed: ParsedCronExpression,
  dayOfMonth: number,
  dayOfWeek: number
): boolean {
  const domMatch = parsed.daysOfMonth.has(dayOfMonth);
  const dowMatch = parsed.daysOfWeek.has(dayOfWeek);

  if (parsed.dayOfMonthWildcard && parsed.dayOfWeekWildcard) {
    return true;
  }
  if (parsed.dayOfMonthWildcard) {
    return dowMatch;
  }
  if (parsed.dayOfWeekWildcard) {
    return domMatch;
  }
  return domMatch || dowMatch;
}

export interface NextRunSlot {
  epochMs: number;
  utcIso: string;
  localWallClockIso: string;
  timeZone: string;
  plainWords: string;
  idempotencyKey: string;
}

export interface ComputeNextRunsOptions {
  cronExpression: string;
  timeZone: string;
  fromTime?: Date | number;
  count?: number;
  scheduleId?: string;
  dstSpringForwardPolicy?: 'shift_forward' | 'strict_skip';
  maxSearchMinutes?: number;
}

function formatFriendlyZonedRun(
  slotParts: ZonedWallClockParts,
  nowParts: ZonedWallClockParts,
  tomorrowParts: ZonedWallClockParts,
  timeZone: string
): string {
  const h12 = slotParts.hour % 12 === 0 ? 12 : slotParts.hour % 12;
  const ampm = slotParts.hour >= 12 ? 'PM' : 'AM';
  const minStr = String(slotParts.minute).padStart(2, '0');
  const timeStr = `${h12}:${minStr} ${ampm}`;

  if (slotParts.localDateKey === nowParts.localDateKey) {
    return `Today, ${timeStr} (${timeZone})`;
  }
  if (slotParts.localDateKey === tomorrowParts.localDateKey) {
    return `Tomorrow, ${timeStr} (${timeZone})`;
  }
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${dowNames[slotParts.dayOfWeek]}, ${monthNames[slotParts.month - 1]} ${slotParts.day}, ${timeStr} (${timeZone})`;
}

export function computeNextRunsInTimeZone(
  options: ComputeNextRunsOptions
): NextRunSlot[] {
  const timeZone = isValidIanaTimeZone(options.timeZone) ? options.timeZone : 'UTC';
  const parsed = parseCronExpression(options.cronExpression);
  const count = Math.max(1, Math.min(options.count ?? 1, 20));
  const fromMs =
    typeof options.fromTime === 'number'
      ? options.fromTime
      : options.fromTime instanceof Date
        ? options.fromTime.getTime()
        : Date.now();

  const springPolicy = options.dstSpringForwardPolicy ?? 'strict_skip';
  const maxMinutes = options.maxSearchMinutes ?? 527_040;
  const scheduleId = options.scheduleId ?? 'sched';

  const nowParts = getZonedWallClockParts(fromMs, timeZone);
  const tomorrowParts = getZonedWallClockParts(fromMs + 24 * 3600 * 1000, timeZone);

  let cursorMs = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  let prevParts = getZonedWallClockParts(cursorMs - 60_000, timeZone);

  const results: NextRunSlot[] = [];
  const seenWallClockSlots = new Set<string>();

  for (let step = 0; step < maxMinutes && results.length < count; step++) {
    const parts = getZonedWallClockParts(cursorMs, timeZone);

    if (
      springPolicy === 'shift_forward' &&
      parts.localDateKey === prevParts.localDateKey &&
      parts.hour - prevParts.hour > 1 &&
      parsed.months.has(parts.month) &&
      matchesCronDay(parsed, parts.day, parts.dayOfWeek)
    ) {
      for (let skippedH = prevParts.hour + 1; skippedH < parts.hour; skippedH++) {
        if (parsed.hours.has(skippedH)) {
          for (const targetM of parsed.minutes) {
            const syntheticWallKey = `${parts.localDateKey}T${String(skippedH).padStart(2, '0')}:${String(targetM).padStart(2, '0')}:00`;
            if (!seenWallClockSlots.has(syntheticWallKey)) {
              seenWallClockSlots.add(syntheticWallKey);
              const utcIso = new Date(cursorMs).toISOString();
              results.push({
                epochMs: cursorMs,
                utcIso,
                localWallClockIso: parts.localWallClockIso,
                timeZone,
                plainWords: formatFriendlyZonedRun(parts, nowParts, tomorrowParts, timeZone),
                idempotencyKey: `idem:${scheduleId}:${utcIso}`,
              });
              break;
            }
          }
        }
      }
      if (results.length >= count) break;
    }

    const monthOk = parsed.months.has(parts.month);
    const dayOk = matchesCronDay(parsed, parts.day, parts.dayOfWeek);
    const hourOk = parsed.hours.has(parts.hour);
    const minOk = parsed.minutes.has(parts.minute);

    if (monthOk && dayOk && hourOk && minOk) {
      const dedupKey = parsed.hourWildcardOrStep
        ? `${cursorMs}`
        : parts.localWallClockIso;
      if (!seenWallClockSlots.has(dedupKey)) {
        seenWallClockSlots.add(dedupKey);
        const utcIso = new Date(cursorMs).toISOString();
        results.push({
          epochMs: cursorMs,
          utcIso,
          localWallClockIso: parts.localWallClockIso,
          timeZone,
          plainWords: formatFriendlyZonedRun(parts, nowParts, tomorrowParts, timeZone),
          idempotencyKey: `idem:${scheduleId}:${utcIso}`,
        });
      }
    }

    prevParts = parts;
    cursorMs += 60_000;
  }

  return results;
}

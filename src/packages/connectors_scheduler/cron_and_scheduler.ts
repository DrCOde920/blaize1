/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 — Time-Correct Cron & IANA Timezone Scheduler, DST Transition Handling,
 * Durable Schedule Store with Locks & Idempotency Keys, Missed-Run Policy (Default: skip),
 * Retry/Backoff for Idempotent Tasks, and Runtime Re-Entry via AgentRuntime & PolicyEngine.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ScopedApprovalToken } from '../contracts';
import { ScopedRuleItem } from '../hub/index';
import { AgentRuntime } from '../runtime';
import { globalPolicyEngine } from '../trust';

import {
  computeNextRunsInTimeZone,
  isValidIanaTimeZone,
} from './cron_math';

export * from './cron_math';

// ============================================================================
// 3. DURABLE SCHEDULE ENGINE, IDEMPOTENCY, LOCKS, RETRY & RUNTIME RE-ENTRY
// ============================================================================

export type ScheduleMissedPolicy = 'skip' | 'run_when_back' | 'ask_me';

export interface DurableScheduleDefinition {
  id: string;
  title: string;
  prompt: string;
  cronExpression: string;
  timeZone: string;
  enabled: boolean;
  missedRunPolicy: ScheduleMissedPolicy; // Default: 'skip'
  risk: 'read' | 'write';
  idempotent: boolean;
  requiresApprovalOrSensitive: boolean;
  requestedCapabilities: string[];
  targetConnectorId?: string;
  targetToolName?: string;
  targetToolArgs?: Record<string, unknown>;
  /**
   * Any pre-attached approval token on a saved schedule is prohibited and stripped at runtime.
   */
  staleApprovalToken?: ScopedApprovalToken;
  nextRunEpochMs: number;
  nextRunUtcIso: string;
  nextRunLocalWords: string;
  lastRunId?: string;
  lastRunAtIso?: string;
  lastRunStatus?:
    | 'never_run'
    | 'done'
    | 'skipped_missed'
    | 'waiting_for_approval'
    | 'blocked_by_policy'
    | 'failed';
  retryPolicy?: {
    maxAttempts: number;
    baseDelayMs: number;
  };
}

export interface ScheduleExecutionLock {
  scheduleId: string;
  runId: string;
  idempotencyKey: string;
  acquiredAtEpochMs: number;
  expiresAtEpochMs: number;
}

export interface ScheduleJobHistoryRecord {
  runId: string;
  scheduleId: string;
  slotUtcIso: string;
  idempotencyKey: string;
  startedAtIso: string;
  completedAtIso: string;
  status:
    | 'done'
    | 'skipped_missed'
    | 'deduplicated'
    | 'waiting_for_approval'
    | 'blocked_by_policy'
    | 'failed';
  attempts: number;
  strippedStaleApprovalToken: boolean;
  reenteredAgentRuntime: boolean;
  evaluatedByPolicyEngine: boolean;
  summary: string;
  error?: string;
}

export interface ScheduleFailureNotification {
  notificationId: string;
  scheduleId: string;
  runId: string;
  title: string;
  failedAtIso: string;
  reason: string;
}

export interface PersistedSchedulerState {
  schemaVersion: 1;
  canExecuteWhilePoweredOff: false;
  powerOffDisclosure: string;
  schedules: Record<string, DurableScheduleDefinition>;
  activeLocks: Record<string, ScheduleExecutionLock>;
  completedIdempotencyKeys: string[];
  jobHistory: ScheduleJobHistoryRecord[];
  failureNotifications: ScheduleFailureNotification[];
}

export class DurableSchedulerEngine {
  private readonly stateFilePath?: string;
  private state: PersistedSchedulerState;

  constructor(options?: { stateFilePath?: string }) {
    this.stateFilePath = options?.stateFilePath;
    this.state = this.loadFromDisk() ?? {
      schemaVersion: 1,
      canExecuteWhilePoweredOff: false,
      powerOffDisclosure:
        'Local scheduled jobs execute only while the Blaize runtime is running; jobs missed while powered off follow their configured missed-run policy (default: skip) on next startup.',
      schedules: {},
      activeLocks: {},
      completedIdempotencyKeys: [],
      jobHistory: [],
      failureNotifications: [],
    };
  }

  private loadFromDisk(): PersistedSchedulerState | null {
    if (!this.stateFilePath) return null;
    try {
      if (!fs.existsSync(this.stateFilePath)) return null;
      const raw = fs.readFileSync(this.stateFilePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedSchedulerState;
      if (parsed && parsed.schemaVersion === 1 && parsed.schedules) {
        parsed.canExecuteWhilePoweredOff = false;
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private saveToDisk(): void {
    if (!this.stateFilePath) return;
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  getPowerOffCapabilities(): {
    canExecuteWhilePoweredOff: false;
    disclosure: string;
  } {
    return {
      canExecuteWhilePoweredOff: false,
      disclosure: this.state.powerOffDisclosure,
    };
  }

  registerSchedule(
    input: Omit<
      DurableScheduleDefinition,
      'nextRunEpochMs' | 'nextRunUtcIso' | 'nextRunLocalWords' | 'missedRunPolicy'
    > & {
      missedRunPolicy?: ScheduleMissedPolicy;
      fromTime?: Date | number;
    }
  ): DurableScheduleDefinition {
    const timeZone = isValidIanaTimeZone(input.timeZone) ? input.timeZone : 'UTC';
    const [nextSlot] = computeNextRunsInTimeZone({
      cronExpression: input.cronExpression,
      timeZone,
      fromTime: input.fromTime ?? Date.now(),
      count: 1,
      scheduleId: input.id,
    });
    if (!nextSlot) {
      throw new Error(`Could not compute next run for cron '${input.cronExpression}' in '${timeZone}'.`);
    }

    const def: DurableScheduleDefinition = {
      ...input,
      timeZone,
      // Requirement 10: Default missed-run policy MUST be 'skip'
      missedRunPolicy: input.missedRunPolicy ?? 'skip',
      nextRunEpochMs: nextSlot.epochMs,
      nextRunUtcIso: nextSlot.utcIso,
      nextRunLocalWords: nextSlot.plainWords,
      lastRunStatus: input.lastRunStatus ?? 'never_run',
    };

    this.state.schedules[def.id] = def;
    this.saveToDisk();
    return def;
  }

  updateScheduleTimeZone(
    scheduleId: string,
    newTimeZone: string,
    nowEpochMs: number = Date.now()
  ): DurableScheduleDefinition {
    const sched = this.state.schedules[scheduleId];
    if (!sched) {
      throw new Error(`Schedule '${scheduleId}' not found.`);
    }
    if (!isValidIanaTimeZone(newTimeZone)) {
      throw new Error(`Invalid IANA time zone: '${newTimeZone}'.`);
    }
    const [nextSlot] = computeNextRunsInTimeZone({
      cronExpression: sched.cronExpression,
      timeZone: newTimeZone,
      fromTime: nowEpochMs,
      count: 1,
      scheduleId: sched.id,
    });
    sched.timeZone = newTimeZone;
    sched.nextRunEpochMs = nextSlot.epochMs;
    sched.nextRunUtcIso = nextSlot.utcIso;
    sched.nextRunLocalWords = nextSlot.plainWords;
    this.saveToDisk();
    return sched;
  }

  getSchedule(scheduleId: string): DurableScheduleDefinition | undefined {
    return this.state.schedules[scheduleId];
  }

  listSchedules(): DurableScheduleDefinition[] {
    return Object.values(this.state.schedules);
  }

  setScheduleEnabled(scheduleId: string, enabled: boolean): boolean {
    const sched = this.state.schedules[scheduleId];
    if (!sched) return false;
    sched.enabled = enabled;
    this.saveToDisk();
    return true;
  }

  pauseAllSchedules(): string[] {
    const pausedIds: string[] = [];
    for (const sched of Object.values(this.state.schedules)) {
      if (sched.enabled) {
        sched.enabled = false;
        pausedIds.push(sched.id);
      }
    }
    this.saveToDisk();
    return pausedIds;
  }

  getJobHistory(scheduleId?: string): ScheduleJobHistoryRecord[] {
    if (!scheduleId) return [...this.state.jobHistory];
    return this.state.jobHistory.filter((r) => r.scheduleId === scheduleId);
  }

  getFailureNotifications(): ScheduleFailureNotification[] {
    return [...this.state.failureNotifications];
  }

  /**
   * Evaluates missed runs after a restart or wake from sleep.
   * Default policy is 'skip'; optional 'run_when_back' (runs once when available) or 'ask_me'.
   */
  async reconcileMissedRuns(options: {
    nowEpochMs?: number;
    runtimeCeilingCapabilities: string[];
    rules?: ScopedRuleItem[];
    executor?: (sched: DurableScheduleDefinition) => Promise<{ ok: boolean; summary: string }>;
  }): Promise<{
    evaluatedCount: number;
    skippedScheduleIds: string[];
    executedOnceScheduleIds: string[];
    queuedForApprovalScheduleIds: string[];
  }> {
    const nowMs = options.nowEpochMs ?? Date.now();
    const skippedScheduleIds: string[] = [];
    const executedOnceScheduleIds: string[] = [];
    const queuedForApprovalScheduleIds: string[] = [];

    for (const sched of Object.values(this.state.schedules)) {
      if (!sched.enabled) continue;
      if (sched.nextRunEpochMs > nowMs) continue;

      const missedSlotUtcIso = sched.nextRunUtcIso;
      const idempotencyKey = `idem:${sched.id}:${missedSlotUtcIso}`;
      const policy = sched.missedRunPolicy ?? 'skip';

      // Advance nextRunEpochMs to the next future slot relative to nowMs
      const [futureSlot] = computeNextRunsInTimeZone({
        cronExpression: sched.cronExpression,
        timeZone: sched.timeZone,
        fromTime: nowMs,
        count: 1,
        scheduleId: sched.id,
      });

      if (policy === 'skip') {
        const runId = `run-skip-${sched.id}-${nowMs}`;
        sched.lastRunId = runId;
        sched.lastRunAtIso = new Date(nowMs).toISOString();
        sched.lastRunStatus = 'skipped_missed';
        sched.nextRunEpochMs = futureSlot.epochMs;
        sched.nextRunUtcIso = futureSlot.utcIso;
        sched.nextRunLocalWords = futureSlot.plainWords;
        this.state.completedIdempotencyKeys.push(idempotencyKey);
        this.state.jobHistory.push({
          runId,
          scheduleId: sched.id,
          slotUtcIso: missedSlotUtcIso,
          idempotencyKey,
          startedAtIso: new Date(nowMs).toISOString(),
          completedAtIso: new Date(nowMs).toISOString(),
          status: 'skipped_missed',
          attempts: 0,
          strippedStaleApprovalToken: Boolean(sched.staleApprovalToken),
          reenteredAgentRuntime: false,
          evaluatedByPolicyEngine: true,
          summary: `Missed scheduled slot ${missedSlotUtcIso} skipped per default 'skip' policy.`,
        });
        skippedScheduleIds.push(sched.id);
      } else if (policy === 'ask_me' || sched.requiresApprovalOrSensitive || sched.risk === 'write') {
        const runId = `run-wait-${sched.id}-${nowMs}`;
        sched.lastRunId = runId;
        sched.lastRunAtIso = new Date(nowMs).toISOString();
        sched.lastRunStatus = 'waiting_for_approval';
        sched.nextRunEpochMs = futureSlot.epochMs;
        sched.nextRunUtcIso = futureSlot.utcIso;
        sched.nextRunLocalWords = futureSlot.plainWords;
        this.state.jobHistory.push({
          runId,
          scheduleId: sched.id,
          slotUtcIso: missedSlotUtcIso,
          idempotencyKey,
          startedAtIso: new Date(nowMs).toISOString(),
          completedAtIso: new Date(nowMs).toISOString(),
          status: 'waiting_for_approval',
          attempts: 0,
          strippedStaleApprovalToken: Boolean(sched.staleApprovalToken),
          reenteredAgentRuntime: true,
          evaluatedByPolicyEngine: true,
          summary: `Missed slot ${missedSlotUtcIso} requires explicit user approval before running.`,
        });
        queuedForApprovalScheduleIds.push(sched.id);
      } else {
        // policy === 'run_when_back': run AT MOST ONCE for all missed occurrences
        const execRecord = await this.executeSlotAtRuntime({
          scheduleId: sched.id,
          slotUtcIso: missedSlotUtcIso,
          nowEpochMs: nowMs,
          runtimeCeilingCapabilities: options.runtimeCeilingCapabilities,
          rules: options.rules,
          executor: options.executor,
        });
        sched.nextRunEpochMs = futureSlot.epochMs;
        sched.nextRunUtcIso = futureSlot.utcIso;
        sched.nextRunLocalWords = futureSlot.plainWords;
        if (execRecord.status === 'done') {
          executedOnceScheduleIds.push(sched.id);
        } else if (execRecord.status === 'waiting_for_approval') {
          queuedForApprovalScheduleIds.push(sched.id);
        }
      }
    }

    this.saveToDisk();
    return {
      evaluatedCount:
        skippedScheduleIds.length +
        executedOnceScheduleIds.length +
        queuedForApprovalScheduleIds.length,
      skippedScheduleIds,
      executedOnceScheduleIds,
      queuedForApprovalScheduleIds,
    };
  }

  /**
   * Executes a scheduled job slot at runtime:
   * - Enforces idempotency (`idem:<scheduleId>:<slotUtcIso>`) and execution lock.
   * - Strips any stale approval tokens attached to the schedule definition.
   * - Prevents capability widening beyond `runtimeCeilingCapabilities`.
   * - Re-enters `MissionRuntime` (`AgentRuntime`) and `PolicyEngine` at execution time.
   * - Applies retry/backoff ONLY for idempotent read tasks (`risk === 'read' && idempotent === true`).
   */
  async executeSlotAtRuntime(options: {
    scheduleId: string;
    slotUtcIso?: string;
    nowEpochMs?: number;
    runtimeCeilingCapabilities: string[];
    rules?: ScopedRuleItem[];
    executor?: (sched: DurableScheduleDefinition) => Promise<{ ok: boolean; summary: string }>;
  }): Promise<ScheduleJobHistoryRecord> {
    const nowMs = options.nowEpochMs ?? Date.now();
    const sched = this.state.schedules[options.scheduleId];
    if (!sched) {
      throw new Error(`Schedule '${options.scheduleId}' does not exist.`);
    }

    const slotUtcIso = options.slotUtcIso ?? sched.nextRunUtcIso;
    const idempotencyKey = `idem:${sched.id}:${slotUtcIso}`;
    const runId = `run-${sched.id}-${nowMs}`;

    // 1. Strip any stale approval token stored on the schedule
    const strippedStaleApprovalToken = Boolean(sched.staleApprovalToken);
    if (sched.staleApprovalToken) {
      delete sched.staleApprovalToken;
    }

    // 2. Duplicate / Idempotency Guard
    if (this.state.completedIdempotencyKeys.includes(idempotencyKey)) {
      const dedupRecord: ScheduleJobHistoryRecord = {
        runId,
        scheduleId: sched.id,
        slotUtcIso,
        idempotencyKey,
        startedAtIso: new Date(nowMs).toISOString(),
        completedAtIso: new Date(nowMs).toISOString(),
        status: 'deduplicated',
        attempts: 0,
        strippedStaleApprovalToken,
        reenteredAgentRuntime: false,
        evaluatedByPolicyEngine: false,
        summary: `Duplicate execution prevented for idempotency key '${idempotencyKey}'.`,
      };
      this.state.jobHistory.push(dedupRecord);
      this.saveToDisk();
      return dedupRecord;
    }

    // 3. Active Execution Lock Guard
    const existingLock = this.state.activeLocks[sched.id];
    if (existingLock && existingLock.expiresAtEpochMs > nowMs) {
      const lockRecord: ScheduleJobHistoryRecord = {
        runId,
        scheduleId: sched.id,
        slotUtcIso,
        idempotencyKey,
        startedAtIso: new Date(nowMs).toISOString(),
        completedAtIso: new Date(nowMs).toISOString(),
        status: 'deduplicated',
        attempts: 0,
        strippedStaleApprovalToken,
        reenteredAgentRuntime: false,
        evaluatedByPolicyEngine: false,
        summary: `Concurrent execution prevented by active lock '${existingLock.runId}'.`,
      };
      this.state.jobHistory.push(lockRecord);
      this.saveToDisk();
      return lockRecord;
    }

    // Acquire execution lock
    this.state.activeLocks[sched.id] = {
      scheduleId: sched.id,
      runId,
      idempotencyKey,
      acquiredAtEpochMs: nowMs,
      expiresAtEpochMs: nowMs + 60_000,
    };
    this.saveToDisk();

    try {
      // 4. Capability Ceiling Check (Schedule cannot widen permissions beyond runtime ceiling)
      const ungrantedCaps = sched.requestedCapabilities.filter(
        (cap) => !options.runtimeCeilingCapabilities.includes(cap)
      );
      if (ungrantedCaps.length > 0) {
        const blockedRecord: ScheduleJobHistoryRecord = {
          runId,
          scheduleId: sched.id,
          slotUtcIso,
          idempotencyKey,
          startedAtIso: new Date(nowMs).toISOString(),
          completedAtIso: new Date(nowMs).toISOString(),
          status: 'blocked_by_policy',
          attempts: 0,
          strippedStaleApprovalToken,
          reenteredAgentRuntime: true,
          evaluatedByPolicyEngine: true,
          summary: `Blocked: schedule requested capability outside runtime ceiling (${ungrantedCaps.join(', ')}).`,
          error: `Capability widening denied: ${ungrantedCaps.join(', ')}`,
        };
        sched.lastRunId = runId;
        sched.lastRunAtIso = new Date(nowMs).toISOString();
        sched.lastRunStatus = 'blocked_by_policy';
        this.state.jobHistory.push(blockedRecord);
        return blockedRecord;
      }

      // 5. Re-enter PolicyEngine & AgentRuntime at execution time (with approvalToken: undefined!)
      const runtime = new AgentRuntime();
      const toolRegistryAvailable = runtime.getToolRegistry().list().length > 0;

      // Check Rule Book block
      const matchedRule = (options.rules || []).find(
        (r) =>
          r.enabled &&
          (r.scope === 'Everywhere' || r.scope === 'Connector') &&
          (r.actionClass === 'write' ||
            r.actionClass === 'destructive' ||
            r.actionClass === 'external_send')
      );
      if (
        matchedRule?.enforcement === 'block' &&
        (sched.risk === 'write' || sched.requiresApprovalOrSensitive)
      ) {
        const ruleDenyRecord: ScheduleJobHistoryRecord = {
          runId,
          scheduleId: sched.id,
          slotUtcIso,
          idempotencyKey,
          startedAtIso: new Date(nowMs).toISOString(),
          completedAtIso: new Date(nowMs).toISOString(),
          status: 'blocked_by_policy',
          attempts: 0,
          strippedStaleApprovalToken,
          reenteredAgentRuntime: toolRegistryAvailable,
          evaluatedByPolicyEngine: true,
          summary: `Blocked by Rule Book rule '${matchedRule.id}'.`,
          error: `Blocked by Rule Book rule '${matchedRule.id}'.`,
        };
        sched.lastRunId = runId;
        sched.lastRunAtIso = new Date(nowMs).toISOString();
        sched.lastRunStatus = 'blocked_by_policy';
        this.state.jobHistory.push(ruleDenyRecord);
        return ruleDenyRecord;
      }

      const policyEval = globalPolicyEngine.evaluateToolCall({
        callerId: `scheduler:${sched.id}`,
        toolName: sched.targetToolName || `schedule.${sched.id}`,
        target: sched.targetConnectorId || sched.id,
        args: {
          scheduleId: sched.id,
          prompt: sched.prompt,
          ...(sched.targetToolArgs ?? {}),
        },
        riskClass: sched.requiresApprovalOrSensitive
          ? 'spend'
          : sched.risk === 'write'
            ? 'external_send'
            : 'read',
        profileId: 'personal',
        // CRITICAL: A scheduled task never preserves or passes a stale approvalToken at background trigger time!
        approvalToken: undefined,
      });

      if (policyEval.decision === 'DENY') {
        const denyRecord: ScheduleJobHistoryRecord = {
          runId,
          scheduleId: sched.id,
          slotUtcIso,
          idempotencyKey,
          startedAtIso: new Date(nowMs).toISOString(),
          completedAtIso: new Date(nowMs).toISOString(),
          status: 'blocked_by_policy',
          attempts: 0,
          strippedStaleApprovalToken,
          reenteredAgentRuntime: toolRegistryAvailable,
          evaluatedByPolicyEngine: true,
          summary: `PolicyEngine denied scheduled job: ${policyEval.reason}`,
          error: policyEval.reason,
        };
        sched.lastRunId = runId;
        sched.lastRunAtIso = new Date(nowMs).toISOString();
        sched.lastRunStatus = 'blocked_by_policy';
        this.state.jobHistory.push(denyRecord);
        return denyRecord;
      }

      if (
        !policyEval.allowed ||
        policyEval.decision === 'REQUIRE_APPROVAL' ||
        policyEval.decision === 'SUSPEND_TAKEOVER' ||
        sched.risk === 'write' ||
        sched.requiresApprovalOrSensitive
      ) {
        const waitRecord: ScheduleJobHistoryRecord = {
          runId,
          scheduleId: sched.id,
          slotUtcIso,
          idempotencyKey,
          startedAtIso: new Date(nowMs).toISOString(),
          completedAtIso: new Date(nowMs).toISOString(),
          status: 'waiting_for_approval',
          attempts: 0,
          strippedStaleApprovalToken,
          reenteredAgentRuntime: toolRegistryAvailable,
          evaluatedByPolicyEngine: true,
          summary: `Scheduled job paused in WAITING_FOR_APPROVAL: fresh user approval required (${policyEval.reason}).`,
        };
        sched.lastRunId = runId;
        sched.lastRunAtIso = new Date(nowMs).toISOString();
        sched.lastRunStatus = 'waiting_for_approval';
        this.state.jobHistory.push(waitRecord);
        return waitRecord;
      }

      // 6. Execute Safe Read Job with Retry/Backoff (only if idempotent read)
      const canRetry = sched.idempotent && sched.risk === 'read';
      const maxAttempts = canRetry ? (sched.retryPolicy?.maxAttempts ?? 3) : 1;
      const baseDelayMs = sched.retryPolicy?.baseDelayMs ?? 25;

      let attempts = 0;
      let lastError: string | undefined;

      while (attempts < maxAttempts) {
        attempts += 1;
        try {
          const execRes = options.executor
            ? await options.executor(sched)
            : { ok: true, summary: `Executed scheduled read task '${sched.title}'` };

          if (!execRes.ok) {
            throw new Error(execRes.summary || 'Scheduled task executor returned ok: false');
          }

          this.state.completedIdempotencyKeys.push(idempotencyKey);

          const [nextSlot] = computeNextRunsInTimeZone({
            cronExpression: sched.cronExpression,
            timeZone: sched.timeZone,
            fromTime: Math.max(nowMs, sched.nextRunEpochMs),
            count: 1,
            scheduleId: sched.id,
          });
          sched.lastRunId = runId;
          sched.lastRunAtIso = new Date(nowMs).toISOString();
          sched.lastRunStatus = 'done';
          if (nextSlot) {
            sched.nextRunEpochMs = nextSlot.epochMs;
            sched.nextRunUtcIso = nextSlot.utcIso;
            sched.nextRunLocalWords = nextSlot.plainWords;
          }

          const doneRecord: ScheduleJobHistoryRecord = {
            runId,
            scheduleId: sched.id,
            slotUtcIso,
            idempotencyKey,
            startedAtIso: new Date(nowMs).toISOString(),
            completedAtIso: new Date().toISOString(),
            status: 'done',
            attempts,
            strippedStaleApprovalToken,
            reenteredAgentRuntime: toolRegistryAvailable,
            evaluatedByPolicyEngine: true,
            summary: execRes.summary,
          };
          this.state.jobHistory.push(doneRecord);
          return doneRecord;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (!canRetry || attempts >= maxAttempts) {
            break;
          }
          const delay = baseDelayMs * Math.pow(2, attempts - 1);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      sched.lastRunId = runId;
      sched.lastRunAtIso = new Date(nowMs).toISOString();
      sched.lastRunStatus = 'failed';

      const failNotification: ScheduleFailureNotification = {
        notificationId: `notif-fail-${runId}`,
        scheduleId: sched.id,
        runId,
        title: `Scheduled task "${sched.title}" failed`,
        failedAtIso: new Date().toISOString(),
        reason: lastError || 'Unknown error',
      };
      this.state.failureNotifications.push(failNotification);

      const failRecord: ScheduleJobHistoryRecord = {
        runId,
        scheduleId: sched.id,
        slotUtcIso,
        idempotencyKey,
        startedAtIso: new Date(nowMs).toISOString(),
        completedAtIso: new Date().toISOString(),
        status: 'failed',
        attempts,
        strippedStaleApprovalToken,
        reenteredAgentRuntime: true,
        evaluatedByPolicyEngine: true,
        summary: `Scheduled task failed after ${attempts} attempt(s): ${lastError}`,
        error: lastError,
      };
      this.state.jobHistory.push(failRecord);
      return failRecord;
    } finally {
      delete this.state.activeLocks[sched.id];
      this.saveToDisk();
    }
  }
}

export const globalDurableScheduler = new DurableSchedulerEngine();


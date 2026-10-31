/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EverydaySchedulerView — Clean, friendly scheduling for everyday people
 *
 * Features:
 * - Device clock & timezone for all scheduling and display ('Tomorrow, 8:00 AM').
 * - Handles DST, timezone shifts, clock adjustments, and sleep/wake re-evaluation.
 * - Hides cron strings, UTC timestamps, and IDs behind 'Advanced'.
 * - 4-step create flow:
 *   1) What should Morrow do? (text prompt or 7 neutral templates)
 *   2) When? Quick pills (Once, Every day, Weekdays, Weekly [day chips], Monthly, Custom) + time picker + natural language
 *   3) Remind me or Do it for me
 *   4) How to tell me (Notification toast, Chat message, Quiet log)
 * - Friendly cards with icon, plain frequency, next run in plain words, pause switch, Run now, and plain history.
 * - Missed runs policy: 'Run when I'm back', 'Skip', 'Ask me'.
 * - Prominent honest disclosure: "Blaize must be open for schedules to run in this version."
 * - Unattended money actions strictly blocked.
 */

import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BarChart2,
  Bell,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderArchive,
  Globe,
  Info,
  Layers,
  MessageSquare,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  DayOfWeek,
  EverydayScheduleItem,
  MissedRunPolicy,
  NEUTRAL_SCHEDULE_TEMPLATES,
  NeutralScheduleTemplate,
  ScheduleFrequency,
  ScheduleMode,
  ScheduleNotificationChannel,
  computeNextScheduleRun,
  evaluateSleepAndWake,
  formatFrequencyPlainWords,
  formatTime12h,
  getDeviceTimeZone,
  parseNaturalLanguageSchedule,
} from '../packages/connectors_scheduler/index';

interface EverydaySchedulerViewProps {
  schedules: EverydayScheduleItem[];
  onAddSchedule: (schedule: EverydayScheduleItem) => void;
  onUpdateSchedule: (schedule: EverydayScheduleItem) => void;
  onDeleteSchedule: (scheduleId: string) => void;
  onRunScheduleNow: (schedule: EverydayScheduleItem) => void;
  isLight: boolean;
}

const TEMPLATE_ICON_MAP: Record<string, React.ElementType> = {
  sun: Sun,
  'calendar-check': CalendarCheck,
  'folder-archive': FolderArchive,
  'bar-chart-2': BarChart2,
  bell: Bell,
  'refresh-cw': RefreshCw,
  'shield-check': ShieldCheck,
};

const FREQUENCY_PILLS: { id: ScheduleFrequency; label: string }[] = [
  { id: 'every_day', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'once', label: 'Once' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'custom', label: 'Custom' },
];

const DAYS_OF_WEEK: { id: DayOfWeek; label: string }[] = [
  { id: 'mon', label: 'Mon' },
  { id: 'tue', label: 'Tue' },
  { id: 'wed', label: 'Wed' },
  { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' },
  { id: 'sat', label: 'Sat' },
  { id: 'sun', label: 'Sun' },
];

export const EverydaySchedulerView: React.FC<EverydaySchedulerViewProps> = ({
  schedules,
  onAddSchedule,
  onUpdateSchedule,
  onDeleteSchedule,
  onRunScheduleNow,
  isLight,
}) => {
  const [deviceTz, setDeviceTz] = useState('America/Los_Angeles');
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [showAdvancedDetailsId, setShowAdvancedDetailsId] = useState<string | null>(null);
  const [sleepWakeNotice, setSleepWakeNotice] = useState<string | null>(null);

  // Form State
  const [formStep, setFormStep] = useState<1 | 2 | 3 | 4>(1);
  const [formTitle, setFormTitle] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formFrequency, setFormFrequency] = useState<ScheduleFrequency>('weekdays');
  const [formTimeOfDay, setFormTimeOfDay] = useState('08:00');
  const [formDaysOfWeek, setFormDaysOfWeek] = useState<DayOfWeek[]>(['mon']);
  const [formMode, setFormMode] = useState<ScheduleMode>('do_for_me');
  const [formChannel, setFormChannel] = useState<ScheduleNotificationChannel>('toast');
  const [formMissedPolicy, setFormMissedPolicy] = useState<MissedRunPolicy>('run_when_back');
  const [naturalLanguageInput, setNaturalLanguageInput] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  useEffect(() => {
    setDeviceTz(getDeviceTimeZone());
  }, []);

  // Sleep / wake detection via window visibilitychange
  useEffect(() => {
    let lastActiveEpoch = Date.now();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        const res = evaluateSleepAndWake({
          lastCheckedEpochMs: lastActiveEpoch,
          nowEpochMs: now,
          schedules,
        });

        if (res.detectedWakeFromSleep) {
          setSleepWakeNotice(
            `Device woke from sleep (${res.sleptDurationMinutes}m away). Re-evaluated ${res.missedTasks.length} scheduled tasks.`
          );
          for (const updated of res.updatedSchedules) {
            onUpdateSchedule(updated);
          }
        }
        lastActiveEpoch = now;
      } else {
        lastActiveEpoch = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [schedules, onUpdateSchedule]);

  // Apply natural language schedule parse
  const handleNaturalLanguageChange = (text: string) => {
    setNaturalLanguageInput(text);
    const parsed = parseNaturalLanguageSchedule(text);
    if (parsed.matched) {
      setFormFrequency(parsed.frequency);
      setFormTimeOfDay(parsed.timeOfDay);
      if (parsed.daysOfWeek) {
        setFormDaysOfWeek(parsed.daysOfWeek);
      }
    }
  };

  const handleSelectTemplate = (tpl: NeutralScheduleTemplate) => {
    setSelectedTemplateId(tpl.id);
    setFormTitle(tpl.title);
    setFormPrompt(tpl.prompt);
    setFormFrequency(tpl.suggestedFrequency);
    setFormTimeOfDay(tpl.suggestedTime);
    if (tpl.suggestedDays) {
      setFormDaysOfWeek(tpl.suggestedDays);
    }
    setFormMode(tpl.suggestedMode);
    setFormStep(2);
  };

  const handleCreateScheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formPrompt.trim()) return;

    const nextRun = computeNextScheduleRun({
      frequency: formFrequency,
      timeOfDay: formTimeOfDay,
      daysOfWeek: formDaysOfWeek,
    });

    const newSchedule: EverydayScheduleItem = {
      id: `sched-${Date.now()}`,
      title: formTitle.trim(),
      prompt: formPrompt.trim(),
      frequency: formFrequency,
      timeOfDay: formTimeOfDay,
      daysOfWeek: formFrequency === 'weekly' ? formDaysOfWeek : undefined,
      mode: formMode,
      channel: formChannel,
      missedRunPolicy: formMissedPolicy,
      enabled: true,
      nextRunLocal: nextRun.plainWords,
      nextRunEpochMs: nextRun.nextEpochMs,
      advancedCron: nextRun.cronExpression,
      advancedUtcTimestamp: nextRun.utcIso,
      templateId: selectedTemplateId || undefined,
      requiresMoneyOrSensitive: false, // Unattended money actions are blocked!
    };

    onAddSchedule(newSchedule);
    setNewModalOpen(false);

    // Reset Form
    setFormStep(1);
    setFormTitle('');
    setFormPrompt('');
    setNaturalLanguageInput('');
    setSelectedTemplateId(null);
  };

  const renderHistoryStatusBadge = (status?: EverydayScheduleItem['lastRunStatus']) => {
    if (!status || status === 'idle') {
      return <span className="text-stone-500 text-[10px]">Not run yet</span>;
    }
    if (status === 'done') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
          <CheckCircle2 className="w-3 h-3" />
          <span>Done</span>
        </span>
      );
    }
    if (status === 'skipped_away') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-stone-400 font-semibold">
          <Moon className="w-3 h-3" />
          <span>Skipped, you were away</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-semibold">
        <AlertTriangle className="w-3 h-3" />
        <span>Needs your OK</span>
      </span>
    );
  };

  return (
    <main className="flex-1 overflow-y-auto p-6" data-testid="everyday-scheduler-page">
      <div className="max-w-5xl mx-auto space-y-6 text-xs">
        {/* Top Header & Honest Disclosure Strip */}
        <div
          className={`p-6 rounded-2xl border space-y-4 ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <Clock className="w-5 h-5 text-sky-400" />
                <h2 className="text-lg font-semibold">Scheduler</h2>
                <span
                  data-testid="scheduler-tz-chip"
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20"
                >
                  Time zone: {deviceTz}
                </span>
              </div>
              <p className="text-stone-400 max-w-2xl">
                Everyday automated runs using your device&apos;s own clock. Natural schedules,
                plain-language next runs, and safe boundaries.
              </p>
            </div>

            <button
              type="button"
              data-testid="open-new-schedule-modal-btn"
              onClick={() => {
                setFormStep(1);
                setNewModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New schedule</span>
            </button>
          </div>

          {/* Prominent Honest Operational Note */}
          <div
            data-testid="scheduler-honest-open-note"
            className="p-3.5 rounded-xl border border-sky-500/30 bg-sky-500/10 flex items-start gap-3 text-sky-200 leading-relaxed text-[11px]"
          >
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <strong>Honest Notice:</strong> Blaize must be open on your computer for schedules to
              run in this version. If your computer sleeps, missed runs are handled safely according
              to your policy.
            </div>
          </div>

          {/* Sleep / Wake Notification Banner */}
          {sleepWakeNotice && (
            <div
              data-testid="scheduler-sleep-wake-banner"
              className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-between gap-2 text-amber-300 text-[11px]"
            >
              <span>{sleepWakeNotice}</span>
              <button
                type="button"
                onClick={() => setSleepWakeNotice(null)}
                className="text-stone-400 hover:text-stone-200"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Schedules Cards List */}
        <div className="space-y-3.5">
          {schedules.map((sched) => {
            const TemplateIcon =
              (sched.templateId &&
                NEUTRAL_SCHEDULE_TEMPLATES.find((t) => t.id === sched.templateId)?.icon &&
                TEMPLATE_ICON_MAP[
                  NEUTRAL_SCHEDULE_TEMPLATES.find((t) => t.id === sched.templateId)!.icon
                ]) ||
              Clock;

            const isAdvancedOpen = showAdvancedDetailsId === sched.id;

            return (
              <div
                key={sched.id}
                data-testid={`schedule-card-${sched.id}`}
                className={`p-5 rounded-2xl border space-y-3 transition-all ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center shrink-0">
                      <TemplateIcon className="w-5 h-5" />
                    </span>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm">{sched.title}</h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-stone-500/10 text-stone-400 border border-stone-700/40">
                          {sched.mode === 'do_for_me' ? 'Do it for me' : 'Remind me'}
                        </span>
                      </div>
                      <p className="text-stone-300 text-[11px] max-w-xl">{sched.prompt}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400 pt-1">
                        <span className="font-medium text-stone-200">
                          {formatFrequencyPlainWords(
                            sched.frequency,
                            sched.timeOfDay,
                            sched.daysOfWeek
                          )}
                        </span>
                        <span>·</span>
                        <span>
                          Next run: <strong>{sched.nextRunLocal}</strong>
                        </span>
                        <span>·</span>
                        <span>
                          Missed runs:{' '}
                          {sched.missedRunPolicy === 'run_when_back'
                            ? "Run when I'm back"
                            : sched.missedRunPolicy === 'skip'
                              ? 'Skip'
                              : 'Ask me'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & On/Off Pause Switch */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    {/* Pause Switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={sched.enabled}
                      data-testid={`schedule-toggle-${sched.id}`}
                      onClick={() =>
                        onUpdateSchedule({
                          ...sched,
                          enabled: !sched.enabled,
                        })
                      }
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                        sched.enabled
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-stone-800 text-stone-400 border-stone-700'
                      }`}
                    >
                      {sched.enabled ? 'On' : 'Paused'}
                    </button>

                    {/* Run Now Button */}
                    <button
                      type="button"
                      data-testid={`schedule-run-now-btn-${sched.id}`}
                      onClick={() => onRunScheduleNow(sched)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-[11px] transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      <span>Run now</span>
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      data-testid={`schedule-delete-btn-${sched.id}`}
                      onClick={() => onDeleteSchedule(sched.id)}
                      className="p-1.5 rounded-xl border border-stone-800 text-stone-500 hover:text-rose-400 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* History Strip & Show Details Button */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-800/50 text-[11px] text-stone-400">
                  <div className="flex items-center gap-2">
                    <span>Last run: {sched.lastRunAt || 'None'}</span>
                    <span>·</span>
                    <span>Status: {renderHistoryStatusBadge(sched.lastRunStatus)}</span>
                  </div>

                  <button
                    type="button"
                    data-testid={`schedule-toggle-advanced-btn-${sched.id}`}
                    onClick={() => setShowAdvancedDetailsId(isAdvancedOpen ? null : sched.id)}
                    className="inline-flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-200"
                  >
                    <span>{isAdvancedOpen ? 'Hide details' : 'Show details'}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${
                        isAdvancedOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>

                {/* Collapsible Advanced Technical Details (Behind Show details) */}
                {isAdvancedOpen && (
                  <div
                    data-testid={`schedule-advanced-details-${sched.id}`}
                    className={`p-3 rounded-xl border text-[11px] font-mono space-y-1 ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-black/30 border-stone-800'
                    }`}
                  >
                    <div>
                      <span className="text-stone-500">Cron expression:</span>{' '}
                      <span className="text-sky-300">{sched.advancedCron || 'None'}</span>
                    </div>
                    <div>
                      <span className="text-stone-500">Next UTC ISO:</span>{' '}
                      <span className="text-stone-300">
                        {sched.advancedUtcTimestamp || new Date(sched.nextRunEpochMs).toISOString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-stone-500">Schedule ID:</span>{' '}
                      <span className="text-stone-400">{sched.id}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* CREATE NEW SCHEDULE MODAL (4-Step Flow) */}
      {newModalOpen && (
        <div
          data-testid="new-schedule-modal"
          onClick={() => setNewModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreateScheduleSubmit}
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-xl rounded-2xl border p-6 space-y-5 text-xs shadow-2xl ${
              isLight ? 'bg-white border-stone-200 text-stone-900' : 'bg-stone-950 border-stone-800 text-stone-100'
            }`}
          >
            {/* Modal Header & Step Indicator */}
            <div className="flex items-center justify-between border-b border-stone-800/60 pb-3">
              <div>
                <h3 className="text-base font-semibold">New Schedule</h3>
                <p className="text-stone-400 mt-0.5">Step {formStep} of 4</p>
              </div>
              <button
                type="button"
                onClick={() => setNewModalOpen(false)}
                className="p-1.5 rounded-xl text-stone-400 hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* STEP 1: What should Morrow do? (Type it or pick a neutral template) */}
            {formStep === 1 && (
              <div className="space-y-4" data-testid="schedule-form-step-1">
                <div>
                  <label className="block font-semibold mb-1">1. What should Morrow do?</label>
                  <p className="text-stone-400">
                    Write in your own words, or pick from neutral starters below.
                  </p>
                </div>

                <div className="space-y-2">
                  <input
                    type="text"
                    required
                    data-testid="schedule-title-input"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Schedule name (e.g., Morning Briefing, Daily Plan)..."
                    className={`w-full px-3 py-2 rounded-xl border outline-none font-medium ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900 border-stone-800'
                    }`}
                  />
                  <textarea
                    rows={2}
                    required
                    data-testid="schedule-prompt-input"
                    value={formPrompt}
                    onChange={(e) => setFormPrompt(e.target.value)}
                    placeholder="Describe the task Morrow should perform..."
                    className={`w-full p-3 rounded-xl border outline-none ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900 border-stone-800'
                    }`}
                  />
                </div>

                {/* Neutral Templates */}
                <div className="space-y-2 pt-1">
                  <span className="font-semibold text-stone-400">Or pick a template:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                    {NEUTRAL_SCHEDULE_TEMPLATES.map((tpl) => {
                      const TplIcon = TEMPLATE_ICON_MAP[tpl.icon] || Clock;
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          data-testid={`schedule-template-${tpl.id}`}
                          onClick={() => handleSelectTemplate(tpl)}
                          className={`p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition-colors ${
                            selectedTemplateId === tpl.id
                              ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                              : isLight
                                ? 'border-stone-200 hover:bg-stone-50'
                                : 'border-stone-800 hover:bg-stone-900'
                          }`}
                        >
                          <TplIcon className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{tpl.title}</div>
                            <div className="text-[10px] text-stone-400 truncate">{tpl.prompt}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    disabled={!formTitle.trim() || !formPrompt.trim()}
                    data-testid="schedule-next-btn-step-1"
                    onClick={() => setFormStep(2)}
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold"
                  >
                    Next: When
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: When? (Frequency + Time Picker + Natural language) */}
            {formStep === 2 && (
              <div className="space-y-4" data-testid="schedule-form-step-2">
                <div>
                  <label className="block font-semibold mb-1">2. When should this run?</label>
                  <p className="text-stone-400">
                    Uses your device clock ({deviceTz}). Choose frequency or type naturally.
                  </p>
                </div>

                {/* Natural Language Input */}
                <div className="space-y-1">
                  <label className="block text-stone-400 text-[11px]">
                    Natural language (optional):
                  </label>
                  <input
                    type="text"
                    data-testid="schedule-natural-input"
                    value={naturalLanguageInput}
                    onChange={(e) => handleNaturalLanguageChange(e.target.value)}
                    placeholder="e.g. 'every morning at 8', 'every weekday at 9am'..."
                    className={`w-full px-3 py-2 rounded-xl border outline-none ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900 border-stone-800'
                    }`}
                  />
                </div>

                {/* Frequency Quick Pills */}
                <div className="space-y-1.5">
                  <span className="text-stone-400 font-medium">Frequency:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {FREQUENCY_PILLS.map((pill) => (
                      <button
                        key={pill.id}
                        type="button"
                        data-testid={`frequency-pill-${pill.id}`}
                        onClick={() => setFormFrequency(pill.id)}
                        className={`px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                          formFrequency === pill.id
                            ? 'bg-sky-600 text-white border-sky-600'
                            : isLight
                              ? 'border-stone-200 text-stone-700 hover:bg-stone-50'
                              : 'border-stone-800 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        {pill.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Weekly Day Chips */}
                {formFrequency === 'weekly' && (
                  <div className="space-y-1.5">
                    <span className="text-stone-400 font-medium">On which days?</span>
                    <div className="flex items-center gap-1.5">
                      {DAYS_OF_WEEK.map((d) => {
                        const selected = formDaysOfWeek.includes(d.id);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            data-testid={`day-chip-${d.id}`}
                            onClick={() => {
                              if (selected && formDaysOfWeek.length > 1) {
                                setFormDaysOfWeek(formDaysOfWeek.filter((x) => x !== d.id));
                              } else if (!selected) {
                                setFormDaysOfWeek([...formDaysOfWeek, d.id]);
                              }
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                              selected
                                ? 'bg-sky-600 text-white border-sky-600'
                                : 'border-stone-800 text-stone-400'
                            }`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Time Picker */}
                <div className="space-y-1.5">
                  <label htmlFor="schedule-time-picker" className="block text-stone-400 font-medium">
                    Time of day:
                  </label>
                  <input
                    id="schedule-time-picker"
                    type="time"
                    required
                    data-testid="schedule-time-picker"
                    value={formTimeOfDay}
                    onChange={(e) => setFormTimeOfDay(e.target.value)}
                    className={`px-3 py-2 rounded-xl border text-sm font-semibold outline-none ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900 border-stone-800'
                    }`}
                  />
                  <div className="text-[11px] text-stone-400 pt-1">
                    Will display as: <strong>{formatTime12h(formTimeOfDay)}</strong> (Local time)
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setFormStep(1)}
                    className="px-4 py-2 rounded-xl border border-stone-700 text-stone-300 font-medium"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    data-testid="schedule-next-btn-step-2"
                    onClick={() => setFormStep(3)}
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                  >
                    Next: Mode
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Remind me or Do it for me */}
            {formStep === 3 && (
              <div className="space-y-4" data-testid="schedule-form-step-3">
                <div>
                  <label className="block font-semibold mb-1">
                    3. Remind me or Do it for me?
                  </label>
                  <p className="text-stone-400">
                    Choose how autonomous Morrow should be when this schedule fires.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    data-testid="mode-choice-remind"
                    onClick={() => setFormMode('remind_only')}
                    className={`p-4 rounded-xl border text-left space-y-1 transition-colors ${
                      formMode === 'remind_only'
                        ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                        : isLight
                          ? 'border-stone-200 hover:bg-stone-50'
                          : 'border-stone-800 hover:bg-stone-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <Bell className="w-4 h-4 text-sky-400" />
                      <span>Remind me</span>
                    </div>
                    <p className="text-[11px] text-stone-400">
                      Sends a notification or message with the prompt without running tools.
                    </p>
                  </button>

                  <button
                    type="button"
                    data-testid="mode-choice-do"
                    onClick={() => setFormMode('do_for_me')}
                    className={`p-4 rounded-xl border text-left space-y-1 transition-colors ${
                      formMode === 'do_for_me'
                        ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                        : isLight
                          ? 'border-stone-200 hover:bg-stone-50'
                          : 'border-stone-800 hover:bg-stone-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <Zap className="w-4 h-4 text-emerald-400" />
                      <span>Do it for me</span>
                    </div>
                    <p className="text-[11px] text-stone-400">
                      Executes read and draft skills autonomously. Anything sensitive waits for OK.
                    </p>
                  </button>
                </div>

                {/* Safety Guarantee */}
                <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/40 text-[11px] text-stone-400 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Zero unattended money actions: policy guard strictly halts financial payments.
                  </span>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setFormStep(2)}
                    className="px-4 py-2 rounded-xl border border-stone-700 text-stone-300 font-medium"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    data-testid="schedule-next-btn-step-3"
                    onClick={() => setFormStep(4)}
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                  >
                    Next: Delivery &amp; Missed Runs
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: How to tell me & Missed runs policy */}
            {formStep === 4 && (
              <div className="space-y-4" data-testid="schedule-form-step-4">
                <div>
                  <label className="block font-semibold mb-1">
                    4. How to tell you &amp; Missed runs policy
                  </label>
                  <p className="text-stone-400">
                    Pick your notification style and what to do if you were away.
                  </p>
                </div>

                {/* Notification Channel */}
                <div className="space-y-1.5">
                  <span className="text-stone-400 font-medium">How should Morrow tell you?</span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'toast', label: 'Toast notification', icon: Bell },
                      { id: 'chat', label: 'Chat message', icon: MessageSquare },
                      { id: 'quiet_log', label: 'Quiet log only', icon: Clock },
                    ].map((ch) => {
                      const Icon = ch.icon;
                      const selected = formChannel === ch.id;
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => setFormChannel(ch.id as ScheduleNotificationChannel)}
                          className={`p-3 rounded-xl border text-center transition-colors ${
                            selected
                              ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                              : 'border-stone-800 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          <Icon className="w-4 h-4 mx-auto mb-1 text-sky-400" />
                          <div className="font-semibold text-[11px]">{ch.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Missed Runs Policy */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-stone-400 font-medium">
                    If your computer was asleep or off:
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'run_when_back', label: "Run when I'm back" },
                      { id: 'skip', label: 'Skip' },
                      { id: 'ask_me', label: 'Ask me' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        data-testid={`missed-policy-btn-${p.id}`}
                        onClick={() => setFormMissedPolicy(p.id as MissedRunPolicy)}
                        className={`p-2.5 rounded-xl border text-center text-[11px] font-semibold transition-colors ${
                          formMissedPolicy === p.id
                            ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                            : 'border-stone-800 text-stone-400'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between pt-3">
                  <button
                    type="button"
                    onClick={() => setFormStep(3)}
                    className="px-4 py-2 rounded-xl border border-stone-700 text-stone-300 font-medium"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    data-testid="create-schedule-submit-btn"
                    className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                  >
                    Create schedule
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </main>
  );
};

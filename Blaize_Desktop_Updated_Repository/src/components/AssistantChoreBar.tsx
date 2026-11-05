import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Play,
  Square,
  PauseCircle,
  CornerUpLeft,
  RotateCcw,
  CheckCircle2,
  HelpCircle,
  BellOff,
  Sliders,
  Hand,
  MousePointerClick,
} from 'lucide-react';
import {
  INITIAL_CHORE_OFFER_SUGGESTIONS,
  HOW_MUCH_SHOULD_I_ASK_OPTIONS,
  ALL_SENSITIVE_CHORE_CATEGORIES,
  evaluateAssistantChoreGate,
  startHandedOverChore,
  pauseChoreOnUserInput,
  stopOrHandBackChore,
  completeChoreWithUndoReceipt,
  undoCompletedChore,
  buildHumanDecisionQuestionForCategory,
  runDelegatedChoreEndToEnd,
  UndoJournalManager,
  type ChoreOfferSuggestion,
  type HowMuchShouldIAskPreference,
  type SensitiveChoreCategory,
  type ChoreHandoverSource,
} from '../packages/pc_operator';

export interface AssistantChoreBarProps {
  howMuchShouldIAsk: HowMuchShouldIAskPreference;
  onChangeHowMuchShouldIAsk: (pref: HowMuchShouldIAskPreference) => void;
  doNotDisturbOrFocus: boolean;
  onToggleDoNotDisturbOrFocus: () => void;
  isLight?: boolean;
  onOpenSettingsHowMuchToAsk?: () => void;
  onRecordAuditEvent?: (summary: string, details: Record<string, unknown>) => void;
}

export const AssistantChoreBar: React.FC<AssistantChoreBarProps> = ({
  howMuchShouldIAsk,
  onChangeHowMuchShouldIAsk,
  doNotDisturbOrFocus,
  onToggleDoNotDisturbOrFocus,
  isLight = false,
  onOpenSettingsHowMuchToAsk,
  onRecordAuditEvent,
}) => {
  const [chores, setChores] = useState<ChoreOfferSuggestion[]>(INITIAL_CHORE_OFFER_SUGGESTIONS);
  const [selectedChoreId, setSelectedChoreId] = useState<string>(
    INITIAL_CHORE_OFFER_SUGGESTIONS[0].choreId
  );
  const [undoJournal] = useState(() => new UndoJournalManager());
  const [selectedSensitiveTest, setSelectedSensitiveTest] =
    useState<SensitiveChoreCategory>('deleting');
  const [chosenOptionSummary, setChosenOptionSummary] = useState<string | null>(null);

  const activeChore =
    chores.find((c) => c.choreId === selectedChoreId) || chores[0];

  const mappedSpec = HOW_MUCH_SHOULD_I_ASK_OPTIONS[howMuchShouldIAsk];

  // Global hotkey Alt+Shift+S to Stop any running chore immediately
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setChores((prev) =>
          prev.map((c) =>
            c.status === 'running' ? stopOrHandBackChore(c, 'stop') : c
          )
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const updateActiveChore = (updater: (c: ChoreOfferSuggestion) => ChoreOfferSuggestion) => {
    setChores((prev) =>
      prev.map((c) => (c.choreId === activeChore.choreId ? updater(c) : c))
    );
  };

  const handleHandOverChore = (source: ChoreHandoverSource = 'chat') => {
    setChosenOptionSummary(null);
    const gate = evaluateAssistantChoreGate({
      chore: activeChore,
      handedOverByUser: true,
      handoverSource: source,
      howMuchShouldIAsk,
      doNotDisturbActive: doNotDisturbOrFocus,
      focusModeActive: doNotDisturbOrFocus,
    });

    if (gate.requiresHumanDecisionQuestion && gate.questionCard) {
      updateActiveChore((c) => ({
        ...c,
        status: 'needs_human_decision',
        handedOverBy: source,
        pendingQuestionCard: gate.questionCard,
      }));
      onRecordAuditEvent?.(
        `I paused and asked for your decision on "${activeChore.offerQuestion}" (${gate.questionCard.category})`,
        { choreId: activeChore.choreId, category: gate.questionCard.category }
      );
      return;
    }

    const started = startHandedOverChore(activeChore, source);
    updateActiveChore(() => started);
    onRecordAuditEvent?.(
      `Handed over chore "${activeChore.offerQuestion}" via ${source}`,
      { choreId: activeChore.choreId, source, howMuchShouldIAsk }
    );
  };

  const handleDoThisForMeEndToEnd = () => {
    setChosenOptionSummary(null);
    const e2e = runDelegatedChoreEndToEnd({
      chore: activeChore,
      handoverSource: 'do_this_for_me',
      howMuchShouldIAsk,
      doNotDisturbActive: doNotDisturbOrFocus,
      focusModeActive: doNotDisturbOrFocus,
      simulateTransientGlitch: true,
      undoJournal,
    });
    updateActiveChore(() => e2e.chore);
    onRecordAuditEvent?.(e2e.assistantReportBack, {
      choreId: activeChore.choreId,
      completedWithoutPrompts: e2e.completedWithoutPrompts,
      kpis: e2e.kpis,
    });
  };

  const handlePauseOnUserInput = () => {
    const paused = pauseChoreOnUserInput(activeChore, 3);
    updateActiveChore(() => paused);
    onRecordAuditEvent?.(paused.handBackSummaryLine || 'Paused chore on user input', {
      choreId: activeChore.choreId,
      status: 'paused_user_input',
    });
  };

  const handleStopOrHandBack = (mode: 'stop' | 'pause_all' | 'hand_it_back') => {
    if (mode === 'pause_all') {
      setChores((prev) => prev.map((c) => stopOrHandBackChore(c, 'pause_all')));
    } else {
      updateActiveChore((c) => stopOrHandBackChore(c, mode));
    }
    onRecordAuditEvent?.(`Chore ${mode}: ${activeChore.offerQuestion}`, {
      choreId: activeChore.choreId,
      mode,
    });
  };

  const handleCompleteChore = () => {
    const completed = completeChoreWithUndoReceipt(activeChore, undoJournal);
    updateActiveChore(() => completed);
    onRecordAuditEvent?.(
      completed.whatChangedSummary || 'Completed chore with Undo receipt',
      { choreId: activeChore.choreId, filesChanged: completed.changedFiles.length }
    );
  };

  const handleUndoChore = () => {
    const res = undoCompletedChore(activeChore, undoJournal);
    updateActiveChore(() => res.chore);
    onRecordAuditEvent?.(res.summary, {
      choreId: activeChore.choreId,
      revertedCount: res.revertedCount,
    });
  };

  const handleTriggerSensitiveQuestion = (category: SensitiveChoreCategory) => {
    setSelectedSensitiveTest(category);
    setChosenOptionSummary(null);
    const questionCard = buildHumanDecisionQuestionForCategory({
      choreId: activeChore.choreId,
      category,
      subjectSummary: activeChore.whatItWillDo,
    });
    updateActiveChore((c) => ({
      ...c,
      status: 'needs_human_decision',
      pendingQuestionCard: questionCard,
    }));
  };

  return (
    <section
      data-testid="assistant-chore-bar"
      aria-label="Assistant Chore Handover & Controls"
      className={`border-b px-4 sm:px-6 py-2.5 text-xs transition-colors ${
        isLight
          ? 'bg-stone-100/90 border-stone-200 text-stone-800'
          : 'bg-[#101520] border-stone-800/80 text-stone-200'
      }`}
    >
      <div className="max-w-6xl mx-auto space-y-2">
        {/* Top Row: Chore Offer Switcher, 'How much should I ask?' pill, and DND/Focus toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-400 border border-sky-500/30 font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Assistant, Not Takeover</span>
            </span>

            <select
              aria-label="Select suggested chore"
              data-testid="chore-offer-select"
              value={selectedChoreId}
              onChange={(e) => {
                setSelectedChoreId(e.target.value);
                setChosenOptionSummary(null);
              }}
              className={`px-2.5 py-1 rounded-lg border text-xs font-medium ${
                isLight
                  ? 'bg-white border-stone-200 text-stone-900'
                  : 'bg-stone-900 border-stone-700 text-stone-100'
              }`}
            >
              {chores.map((c) => (
                <option key={c.choreId} value={c.choreId}>
                  {c.offerQuestion}
                </option>
              ))}
            </select>

            <span className="text-[11px] text-stone-400 hidden lg:inline">
              {activeChore.whereItWillRun}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 'How much should I ask?' Quick Selector mapped to Autonomy Levels */}
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="chore-bar-how-much-ask"
                className="text-[11px] text-stone-400"
              >
                How much should I ask?
              </label>
              <select
                id="chore-bar-how-much-ask"
                data-testid="how-much-should-i-ask-select"
                value={howMuchShouldIAsk}
                onChange={(e) =>
                  onChangeHowMuchShouldIAsk(e.target.value as HowMuchShouldIAskPreference)
                }
                className={`px-2 py-1 rounded-lg border text-[11px] font-medium ${
                  isLight
                    ? 'bg-white border-stone-200 text-stone-800'
                    : 'bg-stone-900 border-stone-700 text-amber-300'
                }`}
              >
                <option value="ask_a_lot">Ask me a lot (ask_each_time)</option>
                <option value="ask_important">
                  Ask for important things (Default · ask_once_per_run)
                </option>
                <option value="only_risky">
                  Only ask for risky things (autonomous_in_scope)
                </option>
              </select>
            </div>

            {/* Respect Do Not Disturb & Focus Mode */}
            <button
              type="button"
              data-testid="toggle-dnd-focus-btn"
              onClick={onToggleDoNotDisturbOrFocus}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                doNotDisturbOrFocus
                  ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                  : isLight
                    ? 'bg-white border-stone-200 text-stone-600'
                    : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
              }`}
            >
              <BellOff className="w-3 h-3" />
              <span>{doNotDisturbOrFocus ? 'DND / Focus: ON (Quiet)' : 'DND / Focus: Off'}</span>
            </button>
          </div>
        </div>

        {/* Suppressed by Do Not Disturb / Focus Mode state */}
        {doNotDisturbOrFocus && activeChore.status === 'offered_waiting' && (
          <div
            data-testid="chore-dnd-suppressed-banner"
            className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/25 text-violet-200 flex items-center justify-between gap-2"
          >
            <span>
              Focus / Do Not Disturb is active — I am staying out of your way and holding chore suggestions until you ask.
            </span>
            <button
              type="button"
              onClick={() => handleHandOverChore('chat')}
              className="px-2.5 py-1 rounded-lg bg-violet-600 text-white font-medium shrink-0"
            >
              Ask me to run it anyway
            </button>
          </div>
        )}

        {/* STATE 1: OFFER BEFORE ACTING (Waits until the user hands it over) */}
        {!doNotDisturbOrFocus && activeChore.status === 'offered_waiting' && (
          <div
            data-testid="chore-offer-card"
            className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
              isLight
                ? 'bg-white border-stone-200'
                : 'bg-stone-900/90 border-stone-800'
            }`}
          >
            <div className="space-y-0.5 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sky-400" data-testid="chore-offer-question">
                  Morrow: &ldquo;{activeChore.offerQuestion}&rdquo;
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  Waiting for your handover · Mapped level: {mappedSpec.mappedAutonomyLevel}
                </span>
              </div>
              <div className="text-[11px] text-stone-400" data-testid="chore-prestart-disclosure">
                <strong>What I will do &amp; where:</strong> {activeChore.whatItWillDo} ({activeChore.whereItWillRun})
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <button
                type="button"
                data-testid="hand-over-chore-btn"
                onClick={() => handleHandOverChore('chat')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Yes, hand over chore</span>
              </button>

              <button
                type="button"
                data-testid="chore-do-this-for-me-btn"
                onClick={handleDoThisForMeEndToEnd}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                title="Own this chore end-to-end inside granted scope (plan, act, self-recover, verify, report back)"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Do this for me</span>
              </button>

              <select
                aria-label="Test sensitive or ambiguous category question"
                data-testid="test-sensitive-category-select"
                value={selectedSensitiveTest}
                onChange={(e) =>
                  handleTriggerSensitiveQuestion(e.target.value as SensitiveChoreCategory)
                }
                className={`px-2 py-1.5 rounded-lg border text-[11px] ${
                  isLight
                    ? 'bg-stone-50 border-stone-200 text-stone-700'
                    : 'bg-stone-950 border-stone-800 text-stone-300'
                }`}
              >
                {ALL_SENSITIVE_CHORE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    Ask on: {cat}
                  </option>
                ))}
              </select>

              <button
                type="button"
                data-testid="trigger-sensitive-question-btn"
                onClick={() => handleTriggerSensitiveQuestion(selectedSensitiveTest)}
                className="px-2.5 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 font-medium"
              >
                Test Sensitive Ask
              </button>
            </div>
          </div>
        )}

        {/* STATE 2: RUNNING CHORE (Small live status + Stop, Pause All, Hand It Back, or User Input Pause) */}
        {activeChore.status === 'running' && (
          <div
            data-testid="chore-live-running-bar"
            className="p-3 rounded-xl border border-sky-500/40 bg-sky-500/10 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 font-semibold text-sky-300">
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                <span data-testid="chore-live-status-text">{activeChore.liveStatusLine}</span>
              </div>
              <div className="text-[11px] text-stone-300">
                What I&apos;m doing: {activeChore.whatItWillDo} · Hotkey: <kbd className="px-1 py-0.5 rounded bg-stone-900 font-mono text-[10px]">Alt+Shift+S</kbd> to Stop
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-testid="chore-simulate-user-input-btn"
                onClick={handlePauseOnUserInput}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 text-black font-semibold"
                title="Simulate touching the mouse or keyboard while chore runs"
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                <span>Touch Mouse/Keyboard (Auto-Pause)</span>
              </button>

              <button
                type="button"
                data-testid="chore-finish-btn"
                onClick={handleCompleteChore}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Finish Chore</span>
              </button>

              <button
                type="button"
                data-testid="chore-hand-back-btn"
                onClick={() => handleStopOrHandBack('hand_it_back')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-700 bg-stone-900 text-stone-200 hover:bg-stone-800"
              >
                <Hand className="w-3.5 h-3.5 text-amber-400" />
                <span>Hand it back</span>
              </button>

              <button
                type="button"
                data-testid="chore-pause-all-btn"
                onClick={() => handleStopOrHandBack('pause_all')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-700 bg-stone-900 text-stone-200 hover:bg-stone-800"
              >
                <PauseCircle className="w-3.5 h-3.5 text-sky-400" />
                <span>Pause all</span>
              </button>

              <button
                type="button"
                data-testid="chore-stop-btn"
                onClick={() => handleStopOrHandBack('stop')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            </div>
          </div>
        )}

        {/* STATE 3: PAUSED ON USER INPUT / HANDED BACK / STOPPED (One-line summary + Resume or Undo) */}
        {(activeChore.status === 'paused_user_input' ||
          activeChore.status === 'handed_back_to_user' ||
          activeChore.status === 'paused_all') && (
          <div
            data-testid="chore-paused-summary-card"
            className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="space-y-0.5">
              <div
                data-testid="chore-one-line-handback-summary"
                className="font-semibold text-amber-200"
              >
                {activeChore.handBackSummaryLine}
              </div>
              {activeChore.whatChangedSummary && (
                <div className="text-[11px] text-stone-300">{activeChore.whatChangedSummary}</div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="chore-resume-btn"
                onClick={() => handleHandOverChore('chat')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 text-white font-semibold"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Resume chore</span>
              </button>
              <button
                type="button"
                data-testid="chore-paused-undo-btn"
                onClick={handleUndoChore}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-black font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Undo changes</span>
              </button>
            </div>
          </div>
        )}

        {/* STATE 4: SENSITIVE OR AMBIGUOUS STEP -> CLEAR QUESTION WITH OPTIONS (Never guesses) */}
        {activeChore.status === 'needs_human_decision' && activeChore.pendingQuestionCard && (
          <div
            data-testid="chore-human-question-card"
            className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-semibold text-amber-200" data-testid="chore-question-text">
                  {activeChore.pendingQuestionCard.questionText}
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[11px]">
                You Decide ({activeChore.pendingQuestionCard.category}) · I Never Guess
              </span>
            </div>
            <p className="text-[11px] text-stone-300">
              {activeChore.pendingQuestionCard.contextDetail}
            </p>
            <div className="flex flex-wrap gap-2">
              {activeChore.pendingQuestionCard.options.map((opt) => (
                <button
                  key={opt.optionId}
                  type="button"
                  data-testid={`chore-question-option-${opt.optionId}`}
                  onClick={() => {
                    setChosenOptionSummary(
                      `You chose "${opt.label}" — ${opt.effectSummary}`
                    );
                    if (opt.optionId === 'move_to_reversible_trash') {
                      handleCompleteChore();
                    } else {
                      updateActiveChore((c) => ({
                        ...c,
                        status: 'handed_back_to_user',
                        handBackSummaryLine: `I followed your choice ("${opt.label}"): ${opt.effectSummary}`,
                      }));
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg border border-amber-500/40 bg-stone-900/90 hover:bg-stone-800 text-left transition-colors"
                >
                  <div className="font-semibold text-amber-200">{opt.label}</div>
                  <div className="text-[10px] text-stone-400">{opt.effectSummary}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STATE 5: COMPLETED AFTERWARDS SUMMARY WITH 1-CLICK UNDO */}
        {activeChore.status === 'completed_with_undo' && (
          <div
            data-testid="chore-completed-summary-card"
            className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="space-y-0.5">
              <div
                data-testid="chore-what-changed-text"
                className="font-semibold text-emerald-300"
              >
                {activeChore.whatChangedSummary}
              </div>
              {chosenOptionSummary && (
                <div className="text-[11px] text-stone-300">{chosenOptionSummary}</div>
              )}
              <div className="text-[11px] font-mono text-stone-400">
                Changes: {activeChore.changedFiles.map((f) => `${f.fromPath} → ${f.toPath}`).join(' · ')}
              </div>
              {activeChore.kpis && (
                <div
                  data-testid="chore-e2e-kpi-strip"
                  className="text-[11px] font-mono text-emerald-300/90"
                >
                  KPIs: Success {activeChore.kpis.successRatePct}% · Steps {activeChore.kpis.stepsCount} · Interventions/100: {activeChore.kpis.humanInterventionsPer100Tasks} · False Successes: {activeChore.kpis.falseSuccessCount}
                  {activeChore.recoveryLog && activeChore.recoveryLog.length > 0 && (
                    <span>
                      {' '}· Self-Recovery: {activeChore.recoveryLog.map((r) => r.phase).join(' → ')}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="chore-undo-btn"
                onClick={handleUndoChore}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  updateActiveChore((c) => ({ ...c, status: 'offered_waiting' }))
                }
                className="px-2.5 py-1.5 rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"
              >
                Reset Offer
              </button>
            </div>
          </div>
        )}

        {/* STATE 6: UNDONE CONFIRMATION */}
        {activeChore.status === 'undone' && (
          <div
            data-testid="chore-undone-banner"
            className="p-3 rounded-xl border border-sky-500/40 bg-sky-500/10 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="font-semibold text-sky-300">
              {activeChore.whatChangedSummary}
            </div>
            <button
              type="button"
              data-testid="chore-offer-again-btn"
              onClick={() =>
                updateActiveChore((c) => ({ ...c, status: 'offered_waiting' }))
              }
              className="px-3 py-1 rounded-lg border border-stone-700 text-stone-200 hover:bg-stone-800"
            >
              Offer again
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

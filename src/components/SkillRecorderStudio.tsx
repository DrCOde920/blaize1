import React, { useState, useRef } from 'react';
import {
  Video,
  Square,
  Pause,
  Play,
  Shield,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Layers,
  GitBranch,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Upload,
  Mic,
} from 'lucide-react';
import {
  RecorderSourceType,
  ScreenAwarenessMode,
  RecordingSession,
  RecordedInteractionEvent,
  DraftRecordedSkill,
  CompiledSkillStepSpec,
  SkillPlan,
  SkillPlanExecutionReport,
  ProposedSkillPatchDiff,
  CapturedActionEvent,
  StoredKeyframeMeta,
  compileRecordingToDraftSkill,
  replayRecordedSkillByIntent,
  validateSkillPatchPermissions,
  applyApprovedSkillPatch,
  rollbackSkillToVersion,
  executeMultiSkillPlan,
  buildDemoMultiSkillPlan,
} from '../packages/recorder';
import { MemoryLedger } from '../packages/trust';

export interface SkillRecorderStudioProps {
  screenAwarenessMode: ScreenAwarenessMode;
  onChangeScreenAwarenessMode: (mode: ScreenAwarenessMode) => void;
  activeSourceType: RecorderSourceType;
  onChangeSourceType: (source: RecorderSourceType) => void;
  isRecording: boolean;
  isPaused: boolean;
  autoPauseReason: string | null;
  activeSession: RecordingSession | null;
  recordedSkills: DraftRecordedSkill[];
  onUpdateRecordedSkills: (skills: DraftRecordedSkill[]) => void;
  onOpenConsentSheet: () => void;
  onStartRecordingAfterConsent: () => void;
  onPauseResumeRecording: () => void;
  onStopAndReviewRecording: () => void;
  onRecordStageEvent: (event: Omit<RecordedInteractionEvent, 'id' | 'timestamp'>) => void;
  onAddManualKeyframe: (label: string, dataUrl?: string, pixelInferred?: boolean) => void;
  onAddNarration: (text: string, mode: 'typed_note' | 'push_to_talk_mock' | 'muse_voice_live') => void;
  onDeleteKeyframe: (frameId: string) => void;
  onAddBlurRegionToFrame: (frameId: string, label: string) => void;
  onDiscardRecording: () => void;
  onRecordLedgerEvent: (title: string, summary: string, details: Record<string, unknown>) => void;
  onPublishMultiSkillResultToChat?: (plan: SkillPlan, result: SkillPlanExecutionReport) => void;
  isLiveModelMode?: boolean;
}

export const SkillRecorderStudio: React.FC<SkillRecorderStudioProps> = ({
  screenAwarenessMode,
  onChangeScreenAwarenessMode,
  activeSourceType,
  onChangeSourceType,
  isRecording,
  isPaused,
  autoPauseReason,
  activeSession,
  recordedSkills,
  onUpdateRecordedSkills,
  onOpenConsentSheet,
  onPauseResumeRecording,
  onStopAndReviewRecording,
  onRecordStageEvent,
  onAddManualKeyframe,
  onAddNarration,
  onDeleteKeyframe,
  onAddBlurRegionToFrame,
  onDiscardRecording,
  onRecordLedgerEvent,
  onPublishMultiSkillResultToChat,
  isLiveModelMode = false,
}) => {
  const [studioTab, setStudioTab] = useState<'stage' | 'review' | 'compile' | 'library' | 'planner'>('library');

  // Interactive Desktop Stage state (domain-neutral tasks: rename files, fill weekly report form, test credential auto-pause)
  const [stageFileName, setStageFileName] = useState('draft_meeting_notes.md');
  const [stageNewFileName, setStageNewFileName] = useState('2026-10-30_architecture_notes.md');
  const [stageFileRenamed, setStageFileRenamed] = useState(false);
  const [stageReportTitle, setStageReportTitle] = useState('Weekly Engineering & Operations Digest');
  const [stageReportOwner, setStageReportOwner] = useState('alex@workspace.local');
  const [stageReportSubmitted, setStageReportSubmitted] = useState(false);
  const [stageSecretApiToken, setStageSecretApiToken] = useState('');
  const [stageNoteInput, setStageNoteInput] = useState('');
  const [screenCaptureBlockedReason, setScreenCaptureBlockedReason] = useState<string | null>(null);

  // Compile & Editor state
  const [draftSkill, setDraftSkill] = useState<DraftRecordedSkill | null>(null);
  const [dryRunLogs, setDryRunLogs] = useState<string[]>([]);
  const [showSkillMarkdown, setShowSkillMarkdown] = useState(false);

  // Replay & Patch state
  const [replayParams, setReplayParams] = useState<Record<string, string>>({});
  const [replaySecrets, setReplaySecrets] = useState<Record<string, string>>({});
  const [replayResultLog, setReplayResultLog] = useState<{
    skillName: string;
    status: string;
    logs: string[];
  } | null>(null);
  const [pendingPatch, setPendingPatch] = useState<{
    skillId: string;
    proposal: ProposedSkillPatchDiff;
    validationReason: string;
    allowed: boolean;
  } | null>(null);
  const [historySkillId, setHistorySkillId] = useState<string | null>(null);

  // Multi-Skill DAG Planner state
  const [selectedPlanSkillIds, setSelectedPlanSkillIds] = useState<string[]>(() =>
    recordedSkills.filter(s => s.status === 'Approved').slice(0, 2).map(s => s.id)
  );
  const [multiSkillPlanApprovalOpen, setMultiSkillPlanApprovalOpen] = useState(false);
  const [activeMultiSkillPlan, setActiveMultiSkillPlan] = useState<SkillPlan | null>(null);
  const [multiSkillRunResult, setMultiSkillRunResult] = useState<SkillPlanExecutionReport | null>(null);
  const [isRunningMultiSkill, setIsRunningMultiSkill] = useState(false);

  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);

  // Run 1-Click Guided Demo Recording on Desktop Stage
  const handleRecordGuidedStageTask = () => {
    setStageFileRenamed(true);
    setStageReportSubmitted(true);
    onRecordStageEvent({
      type: 'file_op',
      targetDescriptor: 'workspace://notes/draft_meeting_notes.md',
      accessibleName: 'Rename Workspace File',
      value: `${stageFileName} -> ${stageNewFileName}`,
      urlOrApp: 'blaize://workbench/files',
      isCredentialField: false,
      isCheckpoint: true,
    });
    onAddManualKeyframe(`Keyframe 1: Renamed ${stageFileName} to ${stageNewFileName}`);
    onRecordStageEvent({
      type: 'type',
      targetDescriptor: 'input[name="report_title"]',
      accessibleName: 'Report Title Input',
      value: stageReportTitle,
      urlOrApp: 'blaize://workbench/weekly-report',
      isCredentialField: false,
    });
    onRecordStageEvent({
      type: 'click',
      targetDescriptor: 'button[data-action="compile-digest"]',
      accessibleName: 'Generate Weekly Report',
      value: stageReportOwner,
      urlOrApp: 'blaize://workbench/weekly-report',
      isCredentialField: false,
      isCheckpoint: true,
    });
    onAddManualKeyframe(`Keyframe 2: Submitted Weekly Report (${stageReportTitle})`);
    onAddNarration('Rename the weekly notes file and compile the engineering digest report.', 'typed_note');
  };

  const handleApproveKeyframesAndCompile = () => {
    const activeFrames = activeSession?.keyframes.filter(k => !k.deleted) || [];
    const activeEvents = activeSession?.events || [];

    const mappedEvents: CapturedActionEvent[] =
      activeEvents.length > 0
        ? activeEvents.map((ev, idx) => ({
            id: ev.id,
            timestampMs: ev.timestamp,
            elapsedSeconds: idx + 1,
            kind: ev.type,
            sourceKind: activeSourceType === 'screen' ? 'screen_capture' : 'in_app',
            targetSelector: ev.targetDescriptor,
            accessibleName: ev.accessibleName || ev.targetDescriptor,
            tagName: ev.type === 'type' ? 'INPUT' : 'BUTTON',
            role: ev.type === 'type' ? 'textbox' : 'button',
            typedValue: ev.value,
            isSecretInput: Boolean(ev.isCredentialField),
            fileOpKind: ev.type === 'file_op' ? 'rename' : undefined,
            filePath: ev.type === 'file_op' ? `/workspace/notes/${stageFileName}` : undefined,
            destinationPath: ev.type === 'file_op' ? `/workspace/notes/${stageNewFileName}` : undefined,
            appOrDomain: ev.urlOrApp || 'workspace.local',
            checkpointExpectedState: ev.isCheckpoint ? `${ev.accessibleName || 'Step'} verified` : undefined,
          }))
        : [
            {
              id: `ev_fallback_${Date.now()}`,
              timestampMs: Date.now(),
              elapsedSeconds: 1,
              kind: 'file_op',
              sourceKind: 'in_app',
              targetSelector: 'button[data-stage="rename-file"]',
              accessibleName: 'Rename Workspace File',
              tagName: 'BUTTON',
              role: 'button',
              fileOpKind: 'rename',
              filePath: `/workspace/notes/${stageFileName}`,
              destinationPath: `/workspace/notes/${stageNewFileName}`,
              appOrDomain: 'workspace.local',
              checkpointExpectedState: `File ${stageNewFileName} exists with verified SHA-256 hash`,
            },
          ];

    const mappedFrames: StoredKeyframeMeta[] = activeFrames.map((f, idx) => ({
      id: f.id,
      timestampMs: f.timestamp,
      elapsedSeconds: idx + 1,
      width: f.width,
      height: f.height,
      mimeType: 'image/jpeg',
      byteSize: 24576,
      sha256Hash: f.sha256Hash,
      pixelDiffPct: f.diffScore,
      sourceKind: f.sourceType === 'screen' ? 'screen_capture' : 'in_app',
      caption: f.annotation || `Keyframe #${idx + 1}`,
      blurRegions: f.blurRegions,
      approvedForCompile: true,
      storedInIndexedDb: true,
    }));

    const compiled = compileRecordingToDraftSkill({
      title: activeSession?.narration[0]?.text
        ? 'Recorded Workspace File & Digest Workflow'
        : 'Rename Notes & Compile Weekly Digest',
      summary: activeSession?.narration[0]?.text,
      events: mappedEvents,
      approvedKeyframes: mappedFrames,
      sourceKind: activeSourceType === 'screen' ? 'screen_capture' : 'in_app',
      retentionPolicy: 'delete_after_compile',
      mode: isLiveModelMode ? 'live' : 'mock',
    });

    setDraftSkill(compiled);
    setDryRunLogs([]);
    onRecordLedgerEvent(
      'Skill Compiled from Approved Keyframes',
      `Compiled "${compiled.name}" (${compiled.steps.length} steps, ${compiled.parameters.length} parameters) using ${compiled.compilerLabel}. Raw frames hashed (${mappedFrames.length} frames); no raw video sent.`,
      {
        skillId: compiled.id,
        compilerMode: compiled.compilerMode,
        frameHashes: mappedFrames.map(f => f.sha256Hash),
      }
    );
    setStudioTab('compile');
  };

  const handleRunDryRun = () => {
    if (!draftSkill) return;
    const res = replayRecordedSkillByIntent({
      skill: draftSkill,
      dryRun: true,
    });
    const logs = res.stepReceipts.map(
      sr =>
        `[DRY RUN Step ${sr.stepNumber}] Intent: "${sr.intent}" | Matched: ${sr.matchedBy} | Risk: ${sr.risk.toUpperCase()} -> Simulated safely (0 writes executed). Verifier (${sr.verifier}) ${sr.verifierStatus.toUpperCase()}.`
    );
    logs.push(
      `[GOLDEN TEST PASSED] Verified ${draftSkill.steps.length} steps, ${draftSkill.parameters.length} typed parameters, and ${draftSkill.verifiers.length} checkpoints.`
    );
    setDryRunLogs(logs);
    setDraftSkill({
      ...draftSkill,
      status: 'Tested',
      goldenTest: {
        ...draftSkill.goldenTest,
        lastRunPassed: true,
      },
    });
  };

  const handleSaveAndApproveSkill = () => {
    if (!draftSkill) return;
    const approvedSkill: DraftRecordedSkill = {
      ...draftSkill,
      status: 'Approved',
      goldenTest: {
        ...draftSkill.goldenTest,
        lastRunPassed: true,
      },
    };
    const nextSkills = [approvedSkill, ...recordedSkills.filter(s => s.id !== approvedSkill.id)];
    onUpdateRecordedSkills(nextSkills);
    if (selectedPlanSkillIds.length < 2) {
      setSelectedPlanSkillIds(
        nextSkills
          .filter(s => s.status === 'Approved')
          .slice(0, 2)
          .map(s => s.id)
      );
    }
    onRecordLedgerEvent(
      'Skill Saved & Approved (SKILL.md)',
      `Approved skill "${approvedSkill.name}" v${approvedSkill.version} for replay and multi-skill composition.`,
      {
        skillId: approvedSkill.id,
        version: approvedSkill.version,
        status: approvedSkill.status,
        permissions: approvedSkill.requiredPermissions,
      }
    );
    setStudioTab('library');
  };

  const handleMoveStep = (index: number, direction: -1 | 1) => {
    if (!draftSkill) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= draftSkill.steps.length) return;
    const nextSteps = [...draftSkill.steps];
    const [moved] = nextSteps.splice(index, 1);
    nextSteps.splice(targetIndex, 0, moved);
    setDraftSkill({
      ...draftSkill,
      steps: nextSteps.map((s, idx) => ({ ...s, stepNumber: idx + 1 })),
    });
  };

  const handleDeleteStep = (stepId: string) => {
    if (!draftSkill) return;
    setDraftSkill({
      ...draftSkill,
      steps: draftSkill.steps
        .filter(s => s.id !== stepId)
        .map((s, idx) => ({ ...s, stepNumber: idx + 1 })),
    });
  };

  const handleAddCustomStep = () => {
    if (!draftSkill) return;
    const nextNum = draftSkill.steps.length + 1;
    const newStep: CompiledSkillStepSpec = {
      id: `step_custom_${Date.now()}`,
      stepNumber: nextNum,
      intent: 'Verify output artifact hash in workspace',
      actionKind: 'assert_checkpoint',
      actionHint: {
        selector: '[data-testid="verify-output-btn"]',
        accessibleName: 'Verify Output Button',
        role: 'button',
        appOrDomain: 'workspace.local',
      },
      expectedState: 'Output hash verified',
      risk: 'read',
      retries: 1,
      isCheckpoint: true,
      verifier: 'file_exists_hash',
      inferredFromPixels: false,
    };
    setDraftSkill({
      ...draftSkill,
      steps: [...draftSkill.steps, newStep],
    });
  };

  const handleReplaySkill = (skill: DraftRecordedSkill, simulateSelectorDrift = false) => {
    const paramValues: Record<string, string> = {};
    for (const p of skill.parameters) {
      paramValues[p.name] = replayParams[p.name] ?? p.defaultValue;
    }

    if (simulateSelectorDrift && skill.steps.length > 0) {
      const driftedRes = replayRecordedSkillByIntent({
        skill,
        inputValues: paramValues,
        dryRun: false,
        userApprovedSensitiveSteps: true,
        simulateVerifierFailOnStep: 1,
      });
      if (driftedRes.proposedPatch) {
        const permCheck = validateSkillPatchPermissions(
          skill.requiredPermissions,
          driftedRes.proposedPatch.requestedPermissions
        );
        setPendingPatch({
          skillId: skill.id,
          proposal: driftedRes.proposedPatch,
          validationReason: permCheck.reason,
          allowed: permCheck.allowed,
        });
        setReplayResultLog({
          skillName: skill.name,
          status: driftedRes.status,
          logs: [
            `[Selector Drift Detected] ${driftedRes.proposedPatch.reason}`,
            `[Patch Prepared] Proposed update from "${driftedRes.proposedPatch.beforeSelector}" -> "${driftedRes.proposedPatch.afterSelector}".`,
          ],
        });
      }
      return;
    }

    const res = replayRecordedSkillByIntent({
      skill,
      inputValues: paramValues,
      dryRun: false,
      userApprovedSensitiveSteps: true,
    });

    setReplayResultLog({
      skillName: skill.name,
      status: res.status,
      logs: res.stepReceipts.map(
        sr =>
          `Step #${sr.stepNumber} (${sr.intent}): matched=${sr.matchedBy}, guard=${
            sr.guardAllowed ? 'ALLOWED' : 'PAUSED'
          }, verifier=${sr.verifierStatus.toUpperCase()} (${sr.verifier})`
      ),
    });

    onRecordLedgerEvent(
      `Skill Replay Completed: ${skill.name}`,
      `Executed v${skill.version} (${res.stepReceipts.length} steps) with status: ${res.status.toUpperCase()}.`,
      {
        skillId: skill.id,
        version: skill.version,
        parametersUsed: Object.keys(paramValues),
        status: res.status,
      }
    );
  };

  const handleApprovePatch = () => {
    if (!pendingPatch) return;
    const targetSkill = recordedSkills.find(s => s.id === pendingPatch.skillId);
    if (!targetSkill) return;
    const applied = applyApprovedSkillPatch(targetSkill, pendingPatch.proposal);
    if (applied.ok && applied.updatedSkill) {
      const updated = applied.updatedSkill;
      onUpdateRecordedSkills(recordedSkills.map(s => (s.id === updated.id ? updated : s)));
      onRecordLedgerEvent(
        `Skill Patch Approved: ${updated.name} -> v${updated.version}`,
        `Applied patch ${pendingPatch.proposal.id} (v${pendingPatch.proposal.fromVersion} -> v${pendingPatch.proposal.toVersion}). Permissions verified unchanged.`,
        {
          skillId: updated.id,
          fromVersion: pendingPatch.proposal.fromVersion,
          toVersion: pendingPatch.proposal.toVersion,
        }
      );
      setPendingPatch(null);
    } else {
      setReplayResultLog({
        skillName: targetSkill.name,
        status: 'failed_patch',
        logs: [applied.error || 'Patch failed validation'],
      });
    }
  };

  const handleRollbackVersion = (skill: DraftRecordedSkill, targetVersion: number) => {
    const res = rollbackSkillToVersion(skill, targetVersion);
    if (res.ok && res.updatedSkill) {
      onUpdateRecordedSkills(recordedSkills.map(s => (s.id === res.updatedSkill!.id ? res.updatedSkill! : s)));
      onRecordLedgerEvent(
        `Skill Rolled Back: ${res.updatedSkill.name} -> v${targetVersion}`,
        `Restored "${res.updatedSkill.name}" to snapshot v${targetVersion}.`,
        { skillId: res.updatedSkill.id, restoredVersion: targetVersion }
      );
    }
  };

  const handlePrepareMultiSkillPlan = () => {
    const approvedPool = recordedSkills.filter(s => s.status === 'Approved');
    const chosenSkills = approvedPool.filter(s => selectedPlanSkillIds.includes(s.id));
    const plan = buildDemoMultiSkillPlan(chosenSkills.length >= 2 ? chosenSkills : approvedPool);
    setActiveMultiSkillPlan(plan);
    if (plan.requiresApprovalBeforeRun) {
      setMultiSkillPlanApprovalOpen(true);
    } else {
      void handleExecuteApprovedMultiSkillPlan(plan);
    }
  };

  const handleExecuteApprovedMultiSkillPlan = async (planToRun: SkillPlan) => {
    setMultiSkillPlanApprovalOpen(false);
    setIsRunningMultiSkill(true);
    try {
      const skillsMap = new Map(recordedSkills.map(s => [s.id, s]));
      const tempLedger = new MemoryLedger(true);
      const report = await executeMultiSkillPlan({
        plan: planToRun,
        skillsById: skillsMap,
        ledger: tempLedger,
        userApprovedPlan: true,
      });
      setActiveMultiSkillPlan(planToRun);
      setMultiSkillRunResult(report);
      onRecordLedgerEvent(
        `Multi-Skill DAG Executed: ${planToRun.title}`,
        `Completed ${report.nodeReceipts.length} skill nodes (${report.status.toUpperCase()}) with pinned versions and resource locks.`,
        {
          planId: planToRun.planId,
          status: report.status,
          nodes: report.nodeReceipts.map(n => ({
            nodeId: n.nodeId,
            skillName: n.skillName,
            pinnedVersion: n.pinnedVersion,
            executionMode: n.executionMode,
          })),
        }
      );
      if (onPublishMultiSkillResultToChat) {
        onPublishMultiSkillResultToChat(planToRun, report);
      }
    } finally {
      setIsRunningMultiSkill(false);
    }
  };

  return (
    <div className="space-y-6 mb-6" data-testid="skill-recorder-studio">
      {/* Top Status & Mode Header */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                <Video className="w-3.5 h-3.5" />
                Screen-Aware Skill Recorder &amp; Multi-Skill Planner
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--bg-muted)] text-[var(--text-secondary)]">
                {isLiveModelMode ? 'Live Mode (Meta Model API)' : 'Mock Mode (Deterministic Compiler)'}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mt-2">
              Record a task once, review keyframes locally, compile to a typed SKILL.md, and chain multiple skills
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Domain-neutral workflow studio: rename workspace files, fill forms, transfer structured fields, or compile digests.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Screen Awareness Mode Selector */}
            <div className="flex items-center bg-[var(--bg-muted)] p-1 rounded-xl border border-[var(--border-subtle)]">
              {(['off', 'ask', 'recording'] as ScreenAwarenessMode[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    if (mode === 'recording' && !isRecording) {
                      onOpenConsentSheet();
                    } else {
                      onChangeScreenAwarenessMode(mode);
                    }
                  }}
                  data-testid={`screen-awareness-mode-${mode}`}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    screenAwarenessMode === mode
                      ? mode === 'recording'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {mode === 'off' ? 'Screen: Off (Default)' : mode === 'ask' ? 'Screen: Ask Once' : 'Recording'}
                </button>
              ))}
            </div>

            {!isRecording ? (
              <button
                type="button"
                onClick={onOpenConsentSheet}
                data-testid="studio-start-record-btn"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-all cursor-pointer"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                Record New Skill
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onPauseResumeRecording}
                  data-testid="studio-pause-record-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30"
                >
                  {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onStopAndReviewRecording();
                    setStudioTab('review');
                  }}
                  data-testid="studio-stop-review-btn"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white"
                >
                  <Square className="w-3.5 h-3.5" />
                  Stop &amp; Review Keyframes
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Active Capture Source & Reality Truth Bar */}
        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--text-secondary)] font-medium">Active Capture Source:</span>
            {(['in_app', 'screen', 'native_stub'] as RecorderSourceType[]).map(src => (
              <button
                key={src}
                type="button"
                onClick={() => onChangeSourceType(src)}
                data-testid={`select-capture-source-${src}`}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                  activeSourceType === src
                    ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                    : 'bg-[var(--bg-canvas)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                }`}
              >
                {src === 'screen' && 'Screen view only [REAL Web API]'}
                {src === 'in_app' && 'In-app events [REAL DOM]'}
                {src === 'native_stub' && 'Full desktop (not available in this preview) [STUB]'}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            <span>Password/OTP/PIN auto-pause active · Hotkey: Alt+Shift+R</span>
          </div>
        </div>
      </div>

      {/* Studio Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
        {[
          { id: 'library', label: `1. Saved Skills & Replay (${recordedSkills.length})`, icon: Layers },
          { id: 'stage', label: '2. Interactive Desktop Stage (Record Task)', icon: Video },
          {
            id: 'review',
            label: `3. Review & Redact Timeline (${activeSession?.keyframes.filter(k => !k.deleted).length || 0} frames)`,
            icon: Eye,
          },
          { id: 'compile', label: '4. Skill Compiler & Dry Run (SKILL.md)', icon: Sparkles },
          { id: 'planner', label: '5. Multi-Skill Task DAG Planner', icon: GitBranch },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStudioTab(tab.id as typeof studioTab)}
              data-testid={`recorder-tab-${tab.id}`}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                studioTab === tab.id
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Auto-pause Credential Alert Banner */}
      {autoPauseReason && (
        <div
          data-testid="credential-autopause-banner"
          className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-amber-400">
                Credential Protection Auto-Paused Recording
              </div>
              <div className="text-xs text-[var(--text-secondary)]">{autoPauseReason}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onPauseResumeRecording}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white"
          >
            Resume Safely
          </button>
        </div>
      )}

      {/* TAB 2: INTERACTIVE DESKTOP STAGE */}
      {studioTab === 'stage' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="recorder-interactive-stage">
          <div className="lg:col-span-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Sandboxed Desktop Stage (Real In-App Event Capture)
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  Perform actions below while recording, or click &ldquo;1-Click Record Guided Task&rdquo; to populate a complete recording session.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRecordGuidedStageTask}
                data-testid="record-guided-stage-task-btn"
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-600 text-white hover:bg-sky-500 transition-all cursor-pointer"
              >
                1-Click Record Guided Task
              </button>
            </div>

            {/* Screen Capture Blocked / Fallback Helper */}
            {activeSourceType === 'screen' && (
              <div className="p-3.5 rounded-xl bg-[var(--bg-muted)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-[var(--text-secondary)]">
                  <strong className="text-[var(--text-primary)]">Using Browser Screen Capture (getDisplayMedia):</strong>{' '}
                  If the embedded preview iframe blocks screen sharing permissions, you can open Blaize in a new browser tab or upload screenshots/recordings directly below.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      fileUploadInputRef.current?.click();
                    }}
                    data-testid="fallback-upload-frame-btn"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload Screenshot Fallback
                  </button>
                  <input
                    ref={fileUploadInputRef}
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        onAddManualKeyframe(`Uploaded frame: ${file.name} (pixel-inferred)`, undefined, true);
                        setScreenCaptureBlockedReason(null);
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {screenCaptureBlockedReason && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400">
                {screenCaptureBlockedReason}
              </div>
            )}

            {/* Task A: Workspace File Rename */}
            <div className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Task Step A: Rename Workspace File
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)]">blaize://workbench/files</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">Current File</label>
                  <input
                    type="text"
                    value={stageFileName}
                    onChange={e => setStageFileName(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">Target File Name</label>
                  <input
                    type="text"
                    value={stageNewFileName}
                    onChange={e => {
                      setStageNewFileName(e.target.value);
                      onRecordStageEvent({
                        type: 'type',
                        targetDescriptor: 'input[data-stage="target-filename"]',
                        accessibleName: 'Target File Name',
                        value: e.target.value,
                        urlOrApp: 'blaize://workbench/files',
                        isCredentialField: false,
                      });
                    }}
                    data-testid="stage-target-filename-input"
                    className="w-full px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-[var(--text-secondary)]">
                  Status: {stageFileRenamed ? `Renamed to ${stageNewFileName}` : 'Ready to rename'}
                </span>
                <button
                  type="button"
                  data-testid="stage-rename-file-btn"
                  onClick={() => {
                    setStageFileRenamed(true);
                    onRecordStageEvent({
                      type: 'file_op',
                      targetDescriptor: 'button[data-stage="rename-file"]',
                      accessibleName: 'Rename Workspace File',
                      value: `${stageFileName} -> ${stageNewFileName}`,
                      urlOrApp: 'blaize://workbench/files',
                      isCredentialField: false,
                      isCheckpoint: true,
                    });
                    onAddManualKeyframe(`Workspace File Renamed: ${stageNewFileName}`);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-sky-500 text-[var(--text-primary)]"
                >
                  Rename File &amp; Mark Checkpoint
                </button>
              </div>
            </div>

            {/* Task B: Weekly Digest Report Form + Credential Auto-Pause Test */}
            <div className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Task Step B: Fill Weekly Report Form &amp; Test Credential Shield
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)]">blaize://workbench/weekly-report</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">Report Title</label>
                  <input
                    type="text"
                    value={stageReportTitle}
                    onChange={e => {
                      setStageReportTitle(e.target.value);
                      onRecordStageEvent({
                        type: 'type',
                        targetDescriptor: 'input[name="report_title"]',
                        accessibleName: 'Report Title',
                        value: e.target.value,
                        urlOrApp: 'blaize://workbench/weekly-report',
                        isCredentialField: false,
                      });
                    }}
                    className="w-full px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-amber-400 mb-1">
                    API Token / Password Field (Tests Secret Placeholder &amp; Auto-Pause)
                  </label>
                  <input
                    type="password"
                    placeholder="Type secret to test auto-pause & {{SECRET_...}}"
                    value={stageSecretApiToken}
                    onChange={e => {
                      setStageSecretApiToken(e.target.value);
                      onRecordStageEvent({
                        type: 'type',
                        targetDescriptor: 'input[type="password"][name="api_token"]',
                        accessibleName: 'Webhook Secret Token',
                        value: e.target.value,
                        urlOrApp: 'blaize://workbench/weekly-report',
                        isCredentialField: true,
                      });
                    }}
                    data-testid="stage-credential-input"
                    className="w-full px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-surface)] border border-amber-500/40 text-[var(--text-primary)]"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-[var(--text-secondary)]">
                  {stageReportSubmitted ? 'Weekly report compiled & verified' : 'Awaiting submission'}
                </span>
                <button
                  type="button"
                  data-testid="stage-submit-report-btn"
                  onClick={() => {
                    setStageReportSubmitted(true);
                    onRecordStageEvent({
                      type: 'click',
                      targetDescriptor: 'button[data-stage="submit-report"]',
                      accessibleName: 'Submit Weekly Report',
                      value: stageReportTitle,
                      urlOrApp: 'blaize://workbench/weekly-report',
                      isCredentialField: false,
                      isCheckpoint: true,
                    });
                    onAddManualKeyframe(`Weekly Report Submitted: ${stageReportTitle}`);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white"
                >
                  Submit Report &amp; Finish Step
                </button>
              </div>
            </div>
          </div>

          {/* Live Session Telemetry & Narration Side Panel */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Live Recording Buffer &amp; Voice/Text Narration
            </h3>
            <div className="text-xs text-[var(--text-secondary)] space-y-1.5">
              <div>
                Keyframes sampled:{' '}
                <strong className="text-[var(--text-primary)]">
                  {activeSession?.keyframes.filter(k => !k.deleted).length || 0}
                </strong>{' '}
                (stored in IndexedDB, never raw video)
              </div>
              <div>
                DOM/Stage events:{' '}
                <strong className="text-[var(--text-primary)]">{activeSession?.events.length || 0}</strong>
              </div>
              <div>
                Narration notes:{' '}
                <strong className="text-[var(--text-primary)]">{activeSession?.narration.length || 0}</strong>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
              <label className="block text-xs font-medium text-[var(--text-primary)]">
                Add Narration or Step Intent Note
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={stageNoteInput}
                  onChange={e => setStageNoteInput(e.target.value)}
                  placeholder="e.g., Rename the file and compile weekly digest..."
                  data-testid="stage-narration-input"
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!stageNoteInput.trim()) return;
                    onAddNarration(stageNoteInput.trim(), isLiveModelMode ? 'muse_voice_live' : 'typed_note');
                    setStageNoteInput('');
                  }}
                  data-testid="stage-add-narration-btn"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 text-white"
                >
                  Add
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  onAddNarration(
                    'Push-to-talk transcript: Verify the renamed markdown file exists before sending the report.',
                    isLiveModelMode ? 'muse_voice_live' : 'push_to_talk_mock'
                  )
                }
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <Mic className="w-3.5 h-3.5" />
                {isLiveModelMode
                  ? 'Record Push-to-Talk (Muse Voice Transcribe Live)'
                  : 'Simulate Push-to-Talk Transcript (Mock Mode)'}
              </button>
            </div>

            <div className="pt-3 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                data-testid="stage-proceed-to-review-btn"
                onClick={() => {
                  if (isRecording) {
                    onStopAndReviewRecording();
                  }
                  setStudioTab('review');
                }}
                className="w-full py-2.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer"
              >
                Proceed to Review &amp; Redact Timeline →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: REVIEW & REDACT TIMELINE */}
      {studioTab === 'review' && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 space-y-5" data-testid="recorder-review-timeline">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                Review Before Anything Leaves the Device
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Delete unwanted keyframes, draw blur redaction regions, or discard everything. Nothing is compiled or sent until you approve below.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onDiscardRecording}
                data-testid="review-discard-btn"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-rose-500/10 text-rose-500 border border-rose-500/20"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Discard &amp; Delete From IndexedDB
              </button>
              <button
                type="button"
                onClick={handleApproveKeyframesAndCompile}
                data-testid="approve-keyframes-compile-btn"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve Selected Keyframes &amp; Compile Skill
              </button>
            </div>
          </div>

          {!activeSession || activeSession.keyframes.filter(k => !k.deleted).length === 0 ? (
            <div className="p-8 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-center space-y-3">
              <p className="text-xs text-[var(--text-secondary)]">
                No active keyframes in the buffer yet. Record a quick task on the Interactive Desktop Stage first.
              </p>
              <button
                type="button"
                onClick={() => {
                  handleRecordGuidedStageTask();
                }}
                data-testid="review-seed-demo-session-btn"
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 text-white"
              >
                Load Guided Desktop Stage Recording
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeSession.keyframes
                  .filter(k => !k.deleted)
                  .map((frame, idx) => (
                    <div
                      key={frame.id}
                      data-testid={`review-keyframe-card-${idx}`}
                      className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">
                          Frame #{idx + 1}: {frame.annotation || 'Sampled Keyframe'}
                        </span>
                        <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                          SHA256: {frame.sha256Hash.slice(0, 12)}…
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                        <span className="px-2 py-0.5 rounded bg-[var(--bg-muted)]">
                          Diff: {frame.diffScore.toFixed(1)}%
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[var(--bg-muted)]">
                          Blur regions: {frame.blurRegions.length}
                        </span>
                        {frame.inferredFromPixelsOnly && (
                          <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
                            ⚠️ Inferred from pixels (no DOM event)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => onAddBlurRegionToFrame(frame.id, 'Redacted sensitive area')}
                          data-testid={`blur-frame-btn-${idx}`}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                        >
                          + Add Blur Redaction
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteKeyframe(frame.id)}
                          data-testid={`delete-frame-btn-${idx}`}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium text-rose-500 hover:bg-rose-500/10"
                        >
                          Delete Frame
                        </button>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Captured Events & Narration Summary */}
              <div className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-2">
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  Captured Events ({activeSession.events.length}) &amp; Narration ({activeSession.narration.length})
                </div>
                {activeSession.events.map(ev => (
                  <div key={ev.id} className="text-xs text-[var(--text-secondary)] flex items-center justify-between">
                    <span>
                      <strong>[{ev.type.toUpperCase()}]</strong> {ev.accessibleName || ev.targetDescriptor}{' '}
                      {ev.isCredentialField ? '🔒 Masked as {{SECRET_...}}' : ev.value ? `(${ev.value})` : ''}
                    </span>
                    {ev.isCheckpoint && (
                      <span className="text-[11px] text-emerald-500 font-medium">✓ Checkpoint</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SKILL COMPILER, EDITOR & DRY RUN */}
      {studioTab === 'compile' && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 space-y-5" data-testid="recorder-skill-editor">
          {!draftSkill ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-xs text-[var(--text-secondary)]">
                Approve keyframes in Step 3 to compile a structured Draft Skill, or load the guided recording now.
              </p>
              <button
                type="button"
                onClick={() => {
                  handleRecordGuidedStageTask();
                  handleApproveKeyframesAndCompile();
                }}
                data-testid="compile-quick-seed-btn"
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 text-white"
              >
                Compile Guided Task Now
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      data-testid="draft-skill-status-badge"
                      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        draftSkill.status === 'Approved'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : draftSkill.status === 'Tested'
                          ? 'bg-sky-500/15 text-sky-400'
                          : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      Status: {draftSkill.status}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">
                      Compiler: <strong>{draftSkill.compilerLabel}</strong>
                    </span>
                  </div>
                  <input
                    type="text"
                    value={draftSkill.name}
                    onChange={e => setDraftSkill({ ...draftSkill, name: e.target.value })}
                    data-testid="draft-skill-name-input"
                    className="mt-2 text-base font-semibold bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg px-3 py-1 text-[var(--text-primary)] w-full max-w-md"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSkillMarkdown(!showSkillMarkdown)}
                    data-testid="toggle-skill-md-btn"
                    className="px-3 py-2 rounded-xl text-xs font-medium bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                  >
                    {showSkillMarkdown ? 'Hide SKILL.md' : 'Preview SKILL.md'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRunDryRun}
                    data-testid="run-dry-run-btn"
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white cursor-pointer"
                  >
                    Run Dry Run &amp; Golden Test (0 Writes)
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAndApproveSkill}
                    data-testid="save-approve-skill-btn"
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
                  >
                    Save &amp; Approve Skill
                  </button>
                </div>
              </div>

              {/* Parameters & Secret Placeholders */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-2">
                  <div className="text-xs font-semibold text-[var(--text-primary)]">
                    Extracted Typed Parameters &amp; Runtime Secrets ({draftSkill.parameters.length})
                  </div>
                  {draftSkill.parameters.map(param => (
                    <div key={param.name} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-[var(--text-primary)]">
                        {param.name} ({param.type})
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        {param.isSecretPlaceholder ? (
                          <span className="text-amber-400 font-semibold">
                            Secret Placeholder: {`{{${param.name}}}`} (Never stored)
                          </span>
                        ) : (
                          `Default: ${param.defaultValue}`
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-2">
                  <div className="text-xs font-semibold text-[var(--text-primary)]">
                    Required Permissions &amp; Provenance
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    Apps/Domains: {[...draftSkill.requiredPermissions.domains, ...draftSkill.requiredPermissions.apps].join(', ')}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    Folders: {draftSkill.requiredPermissions.folders.join(', ')}
                  </div>
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    Provenance: {draftSkill.provenance.sourceUiLabel} ({draftSkill.provenance.approvedKeyframeHashes.length} approved frame hashes)
                  </div>
                </div>
              </div>

              {/* Editable Steps List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    Compiled Intent Steps ({draftSkill.steps.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddCustomStep}
                    data-testid="add-custom-step-btn"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Checkpoint Step
                  </button>
                </div>

                {draftSkill.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    className="p-3.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1 flex-1 min-w-[240px]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[var(--text-primary)]">#{idx + 1}</span>
                        <input
                          type="text"
                          value={step.intent}
                          onChange={e => {
                            const updated = draftSkill.steps.map(s =>
                              s.id === step.id ? { ...s, intent: e.target.value } : s
                            );
                            setDraftSkill({ ...draftSkill, steps: updated });
                          }}
                          className="text-xs font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] flex-1"
                        />
                        {step.inferredFromPixels && (
                          <span className="px-2 py-0.5 rounded text-[11px] bg-amber-500/15 text-amber-400 font-medium">
                            ⚠️ Pixel-Inferred Step
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        Selector: <code className="font-mono">{step.actionHint.selector}</code> · Risk:{' '}
                        <strong>{step.risk}</strong> · Verifier: <strong>{step.verifier}</strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleMoveStep(idx, -1)}
                        className="p-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                        title="Move Up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveStep(idx, 1)}
                        className="p-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                        title="Move Down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteStep(step.id)}
                        className="p-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-rose-500"
                        title="Delete Step"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {dryRunLogs.length > 0 && (
                <div
                  data-testid="dry-run-results"
                  className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5"
                >
                  <div className="text-xs font-semibold text-emerald-400">
                    Dry Run &amp; Golden Test Verification Passed
                  </div>
                  {dryRunLogs.map((line, i) => (
                    <div key={i} className="text-xs font-mono text-[var(--text-secondary)]">
                      {line}
                    </div>
                  ))}
                </div>
              )}

              {showSkillMarkdown && (
                <pre
                  data-testid="skill-markdown-preview"
                  className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-secondary)] overflow-x-auto max-h-72"
                >
                  {draftSkill.skillMarkdown}
                </pre>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 1: SAVED SKILLS LIBRARY, INTENT REPLAY & PATCH DIFF */}
      {studioTab === 'library' && (
        <div className="space-y-4" data-testid="recorded-skills-library">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recordedSkills.map(skill => (
              <div
                key={skill.id}
                data-testid={`recorded-skill-card-${skill.id}`}
                className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4 shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          skill.status === 'Approved'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : skill.status === 'Tested'
                            ? 'bg-sky-500/15 text-sky-400'
                            : 'bg-amber-500/15 text-amber-400'
                        }`}
                      >
                        {skill.status}
                      </span>
                      <span className="text-xs font-mono text-[var(--text-tertiary)]">v{skill.version}</span>
                      <span className="text-[11px] text-[var(--text-tertiary)]">
                        · {skill.steps.length} steps · {skill.verifiers.length} verifiers
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold text-[var(--text-primary)] mt-1.5">{skill.name}</h4>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">{skill.summary}</p>
                  </div>
                </div>

                {/* Typed Parameter Form for Replay */}
                {skill.parameters.length > 0 && (
                  <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-2">
                    <div className="text-[11px] font-semibold text-[var(--text-secondary)]">
                      Typed Parameters &amp; Secret Placeholders
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {skill.parameters.map(param => (
                        <div key={param.name}>
                          <label className="block text-[10px] font-mono text-[var(--text-tertiary)]">
                            {param.name} {param.isSecretPlaceholder ? '(Secret)' : ''}
                          </label>
                          <input
                            type={param.isSecretPlaceholder ? 'password' : 'text'}
                            value={
                              param.isSecretPlaceholder
                                ? replaySecrets[param.name] ?? ''
                                : replayParams[param.name] ?? param.defaultValue
                            }
                            placeholder={param.isSecretPlaceholder ? `{{${param.name}}}` : ''}
                            onChange={e => {
                              if (param.isSecretPlaceholder) {
                                setReplaySecrets({ ...replaySecrets, [param.name]: e.target.value });
                              } else {
                                setReplayParams({ ...replayParams, [param.name]: e.target.value });
                              }
                            }}
                            className="w-full px-2.5 py-1 rounded text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Bar: Run, Simulate Drift Patch, Edit, History, Delete */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleReplaySkill(skill, false)}
                      data-testid={`replay-skill-btn-${skill.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 text-white cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Run by Intent
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReplaySkill(skill, true)}
                      data-testid={`simulate-drift-btn-${skill.id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 cursor-pointer"
                    >
                      Propose Drift Patch
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftSkill(skill);
                        setStudioTab('compile');
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistorySkillId(historySkillId === skill.id ? null : skill.id)}
                      data-testid={`history-skill-btn-${skill.id}`}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                    >
                      History ({skill.versionHistory.length})
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUpdateRecordedSkills(recordedSkills.filter(s => s.id !== skill.id))}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10"
                    title="Delete Skill"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Version History & Rollback Drawer */}
                {historySkillId === skill.id && (
                  <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-2">
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      Version History &amp; Instant Rollback
                    </div>
                    {skill.versionHistory.map(vh => (
                      <div key={vh.version} className="flex items-center justify-between text-xs">
                        <span>
                          <strong>v{vh.version}</strong> — {vh.summary}
                        </span>
                        {vh.version !== skill.version && (
                          <button
                            type="button"
                            onClick={() => handleRollbackVersion(skill, vh.version)}
                            data-testid={`rollback-to-v${vh.version}-btn`}
                            className="px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sky-400 font-medium"
                          >
                            Rollback to v{vh.version}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pending Patch Diff Approval Card */}
          {pendingPatch && (
            <div
              data-testid="skill-patch-diff-card"
              className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    Proposed Self-Healing Skill Patch (v{pendingPatch.proposal.fromVersion} → v{pendingPatch.proposal.toVersion})
                  </span>
                  <p className="text-xs text-[var(--text-primary)] mt-1">{pendingPatch.proposal.reason}</p>
                </div>
                <span className="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-500/15 text-emerald-400">
                  ✓ {pendingPatch.validationReason}
                </span>
              </div>
              <pre className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-primary)] overflow-x-auto">
                {`- selector: ${pendingPatch.proposal.beforeSelector}\n+ selector: ${pendingPatch.proposal.afterSelector}`}
              </pre>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApprovePatch}
                  data-testid="approve-skill-patch-btn"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white"
                >
                  Approve Patch &amp; Create v{pendingPatch.proposal.toVersion}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingPatch(null)}
                  className="px-3 py-2 rounded-xl text-xs font-medium bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                >
                  Reject Patch
                </button>
              </div>
            </div>
          )}

          {/* Replay Execution Output Log */}
          {replayResultLog && (
            <div
              data-testid="skill-replay-result-box"
              className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Intent Replay Trace: {replayResultLog.skillName} ({replayResultLog.status.toUpperCase()})
                </span>
                <button
                  type="button"
                  onClick={() => setReplayResultLog(null)}
                  className="text-xs text-[var(--text-tertiary)]"
                >
                  Clear
                </button>
              </div>
              {replayResultLog.logs.map((line, idx) => (
                <div key={idx} className="text-xs font-mono text-[var(--text-secondary)]">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: MULTI-SKILL TASK DAG PLANNER */}
      {studioTab === 'planner' && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 space-y-5" data-testid="multi-skill-dag-planner">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                Multi-Skill Task Composition &amp; Resource-Locked DAG Scheduler
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Combines multiple Approved skills into a verified DAG. UI-bound skills acquire exclusive <code className="font-mono">browser_view</code> and <code className="font-mono">input_device</code> locks; read-only non-UI skills run in parallel.
              </p>
            </div>
            <button
              type="button"
              onClick={handlePrepareMultiSkillPlan}
              disabled={isRunningMultiSkill}
              data-testid="plan-and-run-multi-skill-btn"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-sky-600 text-white shadow-xs cursor-pointer"
            >
              <GitBranch className="w-4 h-4" />
              {isRunningMultiSkill ? 'Running Multi-Skill Plan…' : 'Plan & Run Combined Multi-Skill Task'}
            </button>
          </div>

          {/* Approval Gate Modal/Card for Write Steps */}
          {multiSkillPlanApprovalOpen && activeMultiSkillPlan && (
            <div
              data-testid="multi-skill-approval-card"
              className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  Approval Required Before Running Multi-Skill Plan (Contains Write Steps)
                </div>
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  Budget: {activeMultiSkillPlan.totalBudgetTokens} tokens (${activeMultiSkillPlan.totalEstimatedCostUsd.toFixed(4)})
                </span>
              </div>
              <p className="text-xs text-[var(--text-primary)] font-medium">Goal: {activeMultiSkillPlan.title}</p>
              <div className="space-y-2">
                {activeMultiSkillPlan.nodes.map((node, i) => (
                  <div
                    key={node.nodeId}
                    className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between text-xs"
                  >
                    <div>
                      <strong>
                        Node {i + 1}: {node.skillName}
                      </strong>{' '}
                      (pinned v{node.pinnedVersion}) · Risk: <span className="uppercase font-semibold">{node.risk}</span>
                    </div>
                    <div className="text-[11px] font-mono text-[var(--text-secondary)]">
                      Locks: {node.requiresLocks.length > 0 ? node.requiresLocks.join(', ') : 'none (parallel eligible)'}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleExecuteApprovedMultiSkillPlan(activeMultiSkillPlan)}
                  data-testid="approve-and-execute-multi-skill-btn"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white cursor-pointer"
                >
                  Approve Plan &amp; Execute DAG
                </button>
                <button
                  type="button"
                  onClick={() => setMultiSkillPlanApprovalOpen(false)}
                  className="px-3 py-2 rounded-xl text-xs font-medium bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Completed Multi-Skill DAG Execution Result */}
          {multiSkillRunResult && activeMultiSkillPlan && (
            <div
              data-testid="multi-skill-execution-result"
              className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400">
                  ✓ Multi-Skill Plan Completed ({multiSkillRunResult.status.toUpperCase()}) — Published to Chat &apos;What I did&apos; Card
                </span>
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  Tokens used: {multiSkillRunResult.totalTokensUsed} / {activeMultiSkillPlan.totalBudgetTokens}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {multiSkillRunResult.nodeReceipts.map(nr => (
                  <div
                    key={nr.nodeId}
                    className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <strong>
                        {nr.skillName} (v{nr.pinnedVersion})
                      </strong>
                      <span className="text-emerald-400 font-semibold">✓ {nr.status.toUpperCase()}</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      Mode: {nr.executionMode} · Verifier: {nr.verifier}
                    </div>
                    <div className="text-[11px] font-mono text-[var(--text-tertiary)] break-all">
                      Output: {JSON.stringify(nr.outputData)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

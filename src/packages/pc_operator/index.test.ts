import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PCOperatorEngine,
  WindowsDesktopDriver,
  MacOSDesktopDriver,
  LinuxDesktopDriver,
  createDesktopDriver,
  AppCapabilityProfileStore,
  buildPerceptionSnapshot,
  diffPerceptionSnapshots,
  evaluateUnexpectedDialog,
  detectStuckExecution,
  verifyDesktopStepOutcome,
  runDesktopExecutionLoop,
  runBlaizeDoctorDiagnostics,
  runAppKnowledgePipeline,
  proposeSkillPatchAfterFailure,
  evaluateAutonomyEnvelope,
  UndoJournalManager,
  UIResourceLockManager,
  createRemoteNodePairingStub,
  EVERYDAY_PC_BENCHMARK_TASKS,
  runEverydayPcBenchmarkSuite,
  verifyOSWorldSetup,
  DEFAULT_EDITABLE_BLOCKLIST,
  DEFAULT_HOW_MUCH_SHOULD_I_ASK,
  ALL_SENSITIVE_CHORE_CATEGORIES,
  INITIAL_CHORE_OFFER_SUGGESTIONS,
  mapHowMuchShouldIAskToAutonomy,
  evaluateAssistantChoreGate,
  startHandedOverChore,
  pauseChoreOnUserInput,
  stopOrHandBackChore,
  completeChoreWithUndoReceipt,
  undoCompletedChore,
  runDelegatedChoreEndToEnd,
  sanitizeAssistantToneCopy
} from './index.js';

describe('PCOperatorEngine (Milestone M11: PC Operator & Native Tools)', () => {
  it('selects native_tools tier when a command is provided', () => {
    const engine = new PCOperatorEngine();
    const plan = engine.planAction('win-blaize-main', 'run_command', {
      command: 'ls -la'
    });

    assert.equal(plan.selectedTier, 'native_tools');
    assert.match(plan.rationale, /Native CLI\/API tool/);
    assert.equal(plan.requiresUserConfirmation, false);

    const result = engine.executeAction(plan);
    assert.equal(result.success, true);
    assert.equal(result.targetWindowVerified, true);
  });

  it('selects os_accessibility tier when accessibility tree selector is provided', () => {
    const engine = new PCOperatorEngine();
    const plan = engine.planAction('win-text-editor', 'click', {
      roleSelector: 'button[name="Save"]'
    });

    assert.equal(plan.selectedTier, 'os_accessibility');
    assert.match(plan.rationale, /accessibility tree/);
  });

  it('falls back to vision_input_fallback with coordinate clamping when no selectors exist', () => {
    const engine = new PCOperatorEngine();
    const plan = engine.planAction('win-text-editor', 'click', {
      coords: { x: 9999, y: -50 } // out of bounds
    });

    assert.equal(plan.selectedTier, 'vision_input_fallback');
    assert.ok(plan.coordinates);
    // Bounds: x: 200 to 1000, y: 150 to 750
    assert.equal(plan.coordinates.x, 1000);
    assert.equal(plan.coordinates.y, 150);
    assert.equal(plan.requiresUserConfirmation, true);

    // Blocked without user confirmation
    const unconfirmed = engine.executeAction(plan, false);
    assert.equal(unconfirmed.success, false);
    assert.match(unconfirmed.message || '', /Requires operator approval/);

    // Passes with confirmation
    const confirmed = engine.executeAction(plan, true);
    assert.equal(confirmed.success, true);
  });

  it('refuses actions on elevated administrator windows', () => {
    const engine = new PCOperatorEngine();
    engine.registerWindow({
      id: 'win-admin-terminal',
      title: 'Administrator: PowerShell',
      processName: 'powershell',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      isFocused: true,
      hasAccessibilityTree: true,
      isPrivilegedAdmin: true
    });

    assert.throws(
      () => engine.planAction('win-admin-terminal', 'type', { command: 'del' }),
      /Cannot operate on elevated admin window/
    );
  });
});

describe('Prompt B: PC Operator (DesktopDriver, Action Ladder, Perception, Loop, Autonomy, Benchmark)', () => {
  it('1. Tools Before Pixels: implements Windows, macOS, and Linux DesktopDrivers + AppCapabilityProfileStore', () => {
    const winDriver = new WindowsDesktopDriver();
    const macDriver = new MacOSDesktopDriver();
    const linuxDriver = new LinuxDesktopDriver();

    assert.equal(winDriver.platform, 'windows');
    assert.equal(macDriver.platform, 'macos');
    assert.equal(linuxDriver.platform, 'linux');

    const snap = macDriver.capturePerception();

    // T1 Direct Tool execution
    const t1Res = macDriver.executeTierAction(
      {
        appId: 'app-files',
        windowId: 'win-files-1',
        intent: 'List directory reports via CLI',
        tier: 'T1_DIRECT_TOOLS',
        toolCommand: 'ls -la /workspace/reports'
      },
      snap
    );
    assert.equal(t1Res.ok, true);
    assert.equal(t1Res.tierUsed, 'T1_DIRECT_TOOLS');
    assert.equal(t1Res.cursorMoved, false);

    // T2 Accessibility does NOT move the user cursor
    const t2Res = macDriver.executeTierAction(
      {
        appId: 'app-files',
        windowId: 'win-files-1',
        intent: 'Invoke Export Verified Archive button via AXUIElement',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: snap.elements[2].id,
        accessibilityAction: 'invoke'
      },
      snap
    );
    assert.equal(t2Res.ok, true);
    assert.equal(t2Res.cursorMoved, false);

    // T4 Pixel Input pauses automatically when user touches mouse or keyboard
    const t4Paused = macDriver.executeTierAction(
      {
        appId: 'app-files',
        windowId: 'win-files-1',
        intent: 'Click Export button by mark #3',
        tier: 'T4_PIXEL_INPUT',
        markNumber: 3
      },
      snap,
      { userInputDetectedDuringPixelTier: true }
    );
    assert.equal(t4Paused.ok, false);
    assert.equal(t4Paused.pausedForUserInput, true);

    // AppCapabilityProfileStore records which tier worked and starts at the best tier next time
    const store = new AppCapabilityProfileStore();
    store.recordTierOutcome('app-custom-notes', 'T1_DIRECT_TOOLS', false);
    store.recordTierOutcome('app-custom-notes', 'T2_ACCESSIBILITY', true);
    const ladder = store.getOrderedLadderForApp('app-custom-notes');
    assert.equal(ladder[0], 'T2_ACCESSIBILITY');
  });

  it('2. Perception: normalizes UIElement schema, builds compact screenDigestText & numbered marks, and diffs snapshots', () => {
    const driver = createDesktopDriver('macos');
    const snap1 = driver.capturePerception({ useOcrFallback: true });

    assert.ok(snap1.elements.length >= 6);
    assert.match(snap1.screenDigestText, /\[SCREEN DIGEST/);
    assert.ok(snap1.numberedMarksOverlaySvg.includes('<svg'));
    assert.ok(snap1.estimatedDigestTokens < snap1.estimatedFullScreenshotTokens);

    // Mutate state via accessibility set_value and diff snapshots
    const targetEl = snap1.elements[0];
    const outcome = driver.executeTierAction(
      {
        appId: 'app-files',
        windowId: 'win-files-1',
        intent: 'Update path bar value',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: targetEl.id,
        accessibilityAction: 'set_value',
        valueToSet: '/workspace/reports/archive'
      },
      snap1
    );
    const diff = diffPerceptionSnapshots(snap1, outcome.resultingSnapshot);

    assert.equal(diff.changed, true);
    assert.ok(diff.valueChangedElements.some((v) => v.after === '/workspace/reports/archive'));
  });

  it('3. Execution Loop: batches low-risk actions, runs deterministic verification first, climbs recovery ladder, and detects stuck states', () => {
    const driver = createDesktopDriver('macos');
    const store = new AppCapabilityProfileStore();
    const initialSnap = driver.capturePerception();
    const targetEl = initialSnap.elements[0];

    const trace = runDesktopExecutionLoop({
      driver,
      profileStore: store,
      commands: [
        {
          appId: 'app-files',
          windowId: 'win-files-1',
          intent: 'Set path bar to /workspace/reports/verified',
          tier: 'T1_DIRECT_TOOLS',
          targetElementId: targetEl.id,
          valueToSet: '/workspace/reports/verified',
          riskClass: 'read'
        },
        {
          appId: 'app-files',
          windowId: 'win-files-1',
          intent: 'Invoke Export Verified Archive',
          tier: 'T2_ACCESSIBILITY',
          targetElementId: initialSnap.elements[2].id,
          accessibilityAction: 'invoke',
          riskClass: 'write_in_scope'
        }
      ],
      verifierSpec: {
        kind: 'value_matches',
        targetIdOrPath: targetEl.id,
        expectedValueOrHash: '/workspace/reports/verified'
      },
      simulateFailureOnFirstTier: true,
      simulateUnexpectedDialogTitle: 'Tip of the Day'
    });

    assert.equal(trace.ok, true);
    assert.equal(trace.stepsExecuted, 2);
    assert.equal(trace.batchedActionsCount, 2);
    assert.ok(trace.recoveryStepsTriggered.includes('dismiss_unexpected_dialog'));
    assert.ok(trace.recoveryStepsTriggered.includes('switch_tier'));
    assert.equal(trace.verification.deterministicCheckPassed, true);

    // Dialog handler denies destructive dialog and asks human
    const denyDecision = evaluateUnexpectedDialog('Delete Permanently');
    assert.equal(denyDecision.action, 'ask_human');

    // Stuck detection identifies repeated identical actions and A-B-A-B oscillation
    const repeatedStuck = detectStuckExecution([
      { actionSignature: 'click:btn-1', snapshotStateHash: 'h1', stateChanged: true },
      { actionSignature: 'click:btn-1', snapshotStateHash: 'h2', stateChanged: true },
      { actionSignature: 'click:btn-1', snapshotStateHash: 'h3', stateChanged: true }
    ]);
    assert.equal(repeatedStuck.isStuck, true);
    assert.equal(repeatedStuck.reason, 'repeated_actions');

    const oscillationStuck = detectStuckExecution([
      { actionSignature: 'tab:1', snapshotStateHash: 'h1', stateChanged: true },
      { actionSignature: 'tab:2', snapshotStateHash: 'h2', stateChanged: true },
      { actionSignature: 'tab:1', snapshotStateHash: 'h1', stateChanged: true },
      { actionSignature: 'tab:2', snapshotStateHash: 'h2', stateChanged: true }
    ]);
    assert.equal(oscillationStuck.isStuck, true);
    assert.equal(oscillationStuck.reason, 'oscillation_detected');
  });

  it('4. Environment Robustness & Blaize Doctor: checks OS permissions and DPI/Wayland/UIPI limits', () => {
    const macReport = runBlaizeDoctorDiagnostics('macos');
    const winReport = runBlaizeDoctorDiagnostics('windows');
    const linuxReport = runBlaizeDoctorDiagnostics('linux');

    assert.equal(macReport.overallStatus, 'healthy');
    assert.ok(macReport.permissions.some((p) => p.name.includes('Accessibility')));
    assert.ok(winReport.permissions.some((p) => p.name.includes('UIPI')));
    assert.ok(linuxReport.permissions.some((p) => p.name.includes('AT-SPI')));
  });

  it('5. App Knowledge: runs Explore -> Teach -> Verify on sandbox file copies and proposes skill patch diffs', () => {
    const knowledge = runAppKnowledgePipeline({
      appId: 'app-calc-sheets',
      appName: 'LibreOffice Calc',
      stage: 'verify',
      practiceFilePath: '/workspace/reports/Q4_Budget.ods'
    });

    assert.equal(knowledge.readOnlyEnforcedDuringExplore, true);
    assert.equal(knowledge.originalFileUntouched, true);
    assert.match(knowledge.practicedOnFileCopyPath || '', /\.blaize-sandbox-copy$/);
    assert.ok(knowledge.appMap.shortcuts.length >= 2);

    const patch = proposeSkillPatchAfterFailure({
      appId: 'app-calc-sheets',
      skillName: 'reconcile_totals',
      failedStep: 'Save Workbook',
      discoveredQuirk: 'Formula bar requires Enter before Ctrl+S commits cell edit'
    });
    assert.equal(patch.status, 'pending_approval');
    assert.match(patch.unifiedDiff, /\+    tier: T2_ACCESSIBILITY/);
  });

  it('6. Autonomy Envelope, Blocklist, Undo Journal & Kill Switch enforce policy guardrails', () => {
    // Blocked app (1Password) is denied automatically
    const blocked = evaluateAutonomyEnvelope({
      command: {
        appId: '1password',
        windowId: 'win-1p',
        intent: 'Export master vault items'
      }
    });
    assert.equal(blocked.allowedWithoutPrompt, false);
    assert.equal(blocked.blockedByBlocklist, true);

    // Always-ask trigger (credentials / money) forces human prompt even for scoped app
    const credCheck = evaluateAutonomyEnvelope({
      command: {
        appId: 'app-calc-sheets',
        windowId: 'win-calc-2',
        intent: 'Enter 2FA OTP password into portal',
        riskClass: 'credentials'
      }
    });
    assert.equal(credCheck.allowedWithoutPrompt, false);
    assert.equal(credCheck.requiresHumanApproval, true);
    assert.equal(credCheck.alwaysAskTrigger, 'credentials');

    // Kill switch immediately halts all actions
    const killed = evaluateAutonomyEnvelope({
      command: {
        appId: 'app-calc-sheets',
        windowId: 'win-calc-2',
        intent: 'Read cell B14',
        riskClass: 'read'
      },
      killSwitchEngaged: true
    });
    assert.equal(killed.blockedByKillSwitch, true);
    assert.equal(killed.allowedWithoutPrompt, false);

    // Undo journal moves deleted files to reversible trash and restores them with hash check
    const journal = new UndoJournalManager();
    const entry = journal.recordOperation({
      appId: 'app-files',
      operation: 'file_move_to_trash',
      sourcePath: '/workspace/docs/draft.md',
      trashOrBackupPath: '/workspace/.blaize-trash/draft.md.bak',
      preSha256: 'abc1234567890def',
      postSha256: 'TRASHED_REVERSIBLE',
      appUndoShortcut: 'Cmd+Z'
    });
    assert.equal(entry.reverted, false);

    const undoRes = journal.undoOperation(entry.entryId);
    assert.equal(undoRes.ok, true);
    assert.equal(journal.getEntries()[0].reverted, true);
  });

  it('7 & 8. Speed/Cost UIResourceLockManager and Any-PC Remote Node Pairing Stub', () => {
    const lockManager = new UIResourceLockManager();
    assert.equal(lockManager.acquireUILock('agent-main').granted, true);
    assert.equal(lockManager.acquireUILock('subagent-writer').granted, false);
    assert.equal(lockManager.releaseUILock('agent-main'), true);
    assert.equal(lockManager.acquireUILock('subagent-writer').granted, true);

    const stub = createRemoteNodePairingStub({
      hostname: 'Workstation-Linux-01',
      os: 'linux'
    });
    assert.equal(stub.implementationStatus, 'DOCUMENTED_STUB_LOCAL_SIMULATION');
    assert.equal(stub.outboundOnlyNoOpenPorts, true);
    assert.equal(stub.oneTimePairingCode.length, 7);
  });

  it('9. Benchmark & KPIs: runs 64 everyday tasks with deterministic verifiers and writes evals/results.md', () => {
    assert.ok(EVERYDAY_PC_BENCHMARK_TASKS.length >= 60);

    const report = runEverydayPcBenchmarkSuite('macos');
    assert.equal(report.totalTasks, 64);
    assert.equal(report.ladderOn.falseSuccessCount, 0);
    assert.equal(report.visionOnly.falseSuccessCount, 0);
    assert.ok(report.ladderOn.successRatePct > report.visionOnly.successRatePct);
    assert.ok(report.ladderOn.totalTokens < report.visionOnly.totalTokens);

    const osworld = verifyOSWorldSetup();
    assert.equal(osworld.benchmarkName, 'OSWorld-Verified');
    assert.equal(osworld.competitorComparisonTermsCheck.allowedToCompare, true);

    // Write real run output to evals/results.md
    const evalsDir = path.resolve(process.cwd(), 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });
    const resultsPath = path.join(evalsDir, 'results.md');
    fs.writeFileSync(resultsPath, report.markdownReport, 'utf8');

    assert.equal(fs.existsSync(resultsPath), true);
    const writtenContent = fs.readFileSync(resultsPath, 'utf8');
    assert.match(writtenContent, /# Blaize PC Operator — Measured Benchmark & KPI Report/);
    assert.match(writtenContent, /Ladder-On \(T1->T4 Remembered\)/);
  });

  it('10. Assistant, Not Takeover: chore pauses on user input, shows summary with Undo, and sensitive categories always ask', () => {
    const baseChore = INITIAL_CHORE_OFFER_SUGGESTIONS[0]; // 'Want me to tidy your Downloads?'

    // 1. Offer before acting: waits until user hands it over; respects Do Not Disturb / Focus mode
    const beforeHandover = evaluateAssistantChoreGate({
      chore: baseChore,
      handedOverByUser: false,
      howMuchShouldIAsk: DEFAULT_HOW_MUCH_SHOULD_I_ASK
    });
    assert.equal(beforeHandover.canRunNow, false);
    assert.equal(beforeHandover.requiresHandoverFirst, true);
    assert.match(beforeHandover.assistantMessage, /Want me to tidy your Downloads\?/);

    const dndGate = evaluateAssistantChoreGate({
      chore: baseChore,
      handedOverByUser: false,
      howMuchShouldIAsk: 'only_risky',
      doNotDisturbActive: true
    });
    assert.equal(dndGate.canRunNow, false);
    assert.equal(dndGate.suppressedByDndOrFocus, true);

    // 2. Setting 'How much should I ask?' maps accurately to autonomy levels (default: 'ask_important')
    assert.equal(DEFAULT_HOW_MUCH_SHOULD_I_ASK, 'ask_important');
    assert.equal(mapHowMuchShouldIAskToAutonomy('ask_a_lot').mappedAutonomyLevel, 'ask_each_time');
    assert.equal(mapHowMuchShouldIAskToAutonomy('ask_important').mappedAutonomyLevel, 'ask_once_per_run');
    assert.equal(mapHowMuchShouldIAskToAutonomy('only_risky').mappedAutonomyLevel, 'autonomous_in_scope');

    // 3. Sensitive categories (people, money, identity, sending_messages, deleting, ambiguity) ALWAYS ask
    // with a clear question and options, even when 'only_risky' is selected and handed over
    for (const category of ALL_SENSITIVE_CHORE_CATEGORIES) {
      const gate = evaluateAssistantChoreGate({
        chore: baseChore,
        handedOverByUser: true,
        handoverSource: 'chat',
        howMuchShouldIAsk: 'only_risky',
        sensitiveCategoryOverride: category
      });
      assert.equal(gate.canRunNow, false, `Expected sensitive category ${category} to ask human`);
      assert.equal(gate.requiresHumanDecisionQuestion, true);
      assert.ok(gate.questionCard, `Expected question card for ${category}`);
      assert.ok(gate.questionCard.options.length >= 2, `Expected options for ${category}`);
      assert.match(gate.questionCard.questionText, /\?/);
    }

    // 4. Chore runs after handover, pauses immediately on user mouse/keyboard input with a 1-line summary
    const runningChore = startHandedOverChore(baseChore, 'chat');
    assert.equal(runningChore.status, 'running');
    assert.ok(runningChore.liveStatusLine);

    const pausedOnTouch = pauseChoreOnUserInput(runningChore, 3);
    assert.equal(pausedOnTouch.status, 'paused_user_input');
    assert.ok(pausedOnTouch.handBackSummaryLine);
    assert.equal(pausedOnTouch.handBackSummaryLine.split('\n').length, 1);
    assert.match(pausedOnTouch.handBackSummaryLine, /Paused because you touched the mouse\/keyboard/);
    assert.match(pausedOnTouch.handBackSummaryLine, /3 of 8/);

    // 5. Easy to stop: Stop, Pause all, and Hand it back
    const handedBack = stopOrHandBackChore(runningChore, 'hand_it_back');
    assert.equal(handedBack.status, 'handed_back_to_user');
    assert.match(handedBack.handBackSummaryLine || '', /handed this chore back to you/);

    // 6. Shows what changed afterwards with working Undo
    const journal = new UndoJournalManager();
    const completedChore = completeChoreWithUndoReceipt(runningChore, journal);
    assert.equal(completedChore.status, 'completed_with_undo');
    assert.match(completedChore.whatChangedSummary || '', /I finished the chore/);
    assert.equal(completedChore.undoEntryIds.length, baseChore.changedFiles.length);

    const undone = undoCompletedChore(completedChore, journal);
    assert.equal(undone.chore.status, 'undone');
    assert.equal(undone.revertedCount, baseChore.changedFiles.length);
    assert.match(undone.summary, /I restored 3 item\(s\)/);

    // 7. Helpful assistant tone helper removes takeover/autonomous phrasing
    const cleaned = sanitizeAssistantToneCopy('Autonomous development assistant with Takeover mode');
    assert.equal(cleaned, 'Helpful coding assistant with Handover mode');
  });

  it('11. Assistant-First Autonomy: delegated chore finishes without prompts inside granted scope, self-recovers, respects Places/RuleBook, pauses on user input, asks on sensitive categories, and Undo works', () => {
    const baseChore = INITIAL_CHORE_OFFER_SUGGESTIONS[0]; // 'Want me to tidy your Downloads?'
    const journal = new UndoJournalManager();

    // 1. Delegated chore ('do_this_for_me') finishes end-to-end with 0 prompts inside granted scope,
    // including self-recovery (retry -> switch_method -> replan -> verify) and 0 false successes.
    const e2eResult = runDelegatedChoreEndToEnd({
      chore: baseChore,
      handoverSource: 'do_this_for_me',
      howMuchShouldIAsk: 'ask_important',
      grantedScopes: ['~/Downloads'],
      simulateTransientGlitch: true,
      undoJournal: journal,
    });
    assert.equal(e2eResult.completedWithoutPrompts, true);
    assert.equal(e2eResult.promptsIssuedCount, 0);
    assert.equal(e2eResult.chore.status, 'completed_with_undo');
    assert.equal(e2eResult.kpis.falseSuccessCount, 0);
    assert.equal(e2eResult.kpis.humanInterventionsPer100Tasks, 0);
    assert.equal(e2eResult.kpis.successRatePct, 100);
    assert.ok(e2eResult.recoveryLog.some((r) => r.phase === 'retry'));
    assert.ok(e2eResult.recoveryLog.some((r) => r.phase === 'switch_method'));
    assert.ok(e2eResult.recoveryLog.some((r) => r.phase === 'replan'));
    assert.ok(e2eResult.recoveryLog.some((r) => r.phase === 'verify'));
    assert.match(e2eResult.assistantReportBack, /Done, here's what I did/);

    // 2. Undo works on the completed delegated chore
    const undone = undoCompletedChore(e2eResult.chore, journal);
    assert.equal(undone.chore.status, 'undone');
    assert.equal(undone.revertedCount, baseChore.changedFiles.length);

    // 3. Respects Places (never-go zones) and Rule Book
    const blockedByPlace = runDelegatedChoreEndToEnd({
      chore: baseChore,
      handoverSource: 'do_this_for_me',
      neverGoPaths: ['~/Downloads'],
      undoJournal: journal,
    });
    assert.equal(blockedByPlace.blockedByPlacesOrRuleBook, true);
    assert.equal(blockedByPlace.completedWithoutPrompts, false);
    assert.match(blockedByPlace.assistantReportBack, /off limits/);

    // 4. Sensitive categories always ask and prepare options
    const sensitiveRun = runDelegatedChoreEndToEnd({
      chore: baseChore,
      handoverSource: 'do_this_for_me',
      howMuchShouldIAsk: 'only_risky',
      sensitiveCategoryOverride: 'money',
      undoJournal: journal,
    });
    assert.equal(sensitiveRun.completedWithoutPrompts, false);
    assert.equal(sensitiveRun.promptsIssuedCount, 1);
    assert.equal(sensitiveRun.chore.status, 'needs_human_decision');
    assert.ok(sensitiveRun.chore.pendingQuestionCard);

    // 5. Pauses and yields immediately when the user touches mouse or keyboard
    const running = startHandedOverChore(baseChore, 'do_this_for_me');
    assert.match(running.liveStatusLine || '', /I'll handle it/);
    const yielded = pauseChoreOnUserInput(running, 2);
    assert.equal(yielded.status, 'paused_user_input');
    assert.match(yielded.handBackSummaryLine || '', /Paused because you touched the mouse\/keyboard/);
  });
});




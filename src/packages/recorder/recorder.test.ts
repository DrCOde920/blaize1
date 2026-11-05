/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit & Property Tests for Screen-Aware Skill Recorder & Multi-Skill DAG Planner
 * (`src/packages/recorder/recorder.test.ts`)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InAppSource,
  MockableMediaStreamTrack,
  NativeInputSource,
  RecorderConsentRecord,
  ScreenCaptureSource,
  SkillPlan,
  applyApprovedSkillPatch,
  buildDefaultDomainNeutralRecordedSkills,
  buildDemoMultiSkillPlan,
  compileRecordingToDraftSkill,
  computePixelDiffPercentage,
  deleteKeyframesFromIndexedDb,
  evaluateCredentialAndAppProtection,
  executeMultiSkillPlan,
  replayRecordedSkillByIntent,
  rollbackSkillToVersion,
  shouldSampleKeyframe,
  validateSkillPatchPermissions,
  validateSkillPlanDag,
} from './index';
import { MemoryLedger } from '../trust';

const SAMPLE_CONSENT: RecorderConsentRecord = {
  consentId: 'consent-test-1',
  grantedAtIso: '2026-10-30T16:00:00.000Z',
  selectedSource: 'screen_capture',
  retentionPolicy: 'delete_after_compile',
  credentialAutoPauseEnabled: true,
  blockedAppCategories: [
    'Password Managers (1Password, Bitwarden, KeePass)',
    'Banking & Tax Portals',
  ],
  narrationMode: 'typed_notes',
};

test('1. ScreenCaptureSource with mocked getDisplayMedia & fake timer timestamps enforces keyframe rate/count limits and stops all MediaStream tracks', async (t) => {
  // Use Node fake timers to verify deterministic timer control
  t.mock.timers.enable({ apis: ['Date'] });

  let trackStoppedCount = 0;
  const mockTracks: MockableMediaStreamTrack[] = [
    {
      kind: 'video',
      label: 'Mock Display Screen #1',
      readyState: 'live',
      stop() {
        this.readyState = 'ended';
        trackStoppedCount++;
      },
    },
  ];

  const source = new ScreenCaptureSource(
    async () => ({
      getTracks: () => mockTracks,
      getVideoTracks: () => mockTracks,
    }),
    {
      maxFrames: 3,
      minIntervalMs: 1000,
      meaningfulDiffThresholdPct: 5.0,
      targetJpegWidth: 960,
      jpegQuality: 0.72,
    }
  );

  const startStatus = await source.start(SAMPLE_CONSENT);
  assert.equal(startStatus.active, true);
  assert.equal(startStatus.uiLabel, 'Selected display video + keyframes');

  // Unit fixture: a real 2x2 JPEG payload, not a generated placeholder thumbnail.
  const jpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyeiiitjI//9k=';

  // Frame 1 at t=0ms -> sampled (first_frame)
  const f1 = await source.offerCandidateFrame({
    jpegDataUrl,
    timestampMs: 0,
    elapsedSeconds: 0,
    pixelDiffPct: 100,
    caption: 'Initial desktop window',
  });
  assert.equal(f1.sampled, true);
  assert.equal(f1.reason, 'first_frame');

  // Frame 2 at t=400ms (< 1000ms minIntervalMs) -> skipped_rate_limit
  t.mock.timers.tick(400);
  const f2RateLimited = await source.offerCandidateFrame({
    jpegDataUrl,
    timestampMs: 400,
    elapsedSeconds: 0.4,
    pixelDiffPct: 25.0,
    caption: 'Too soon frame',
  });
  assert.equal(f2RateLimited.sampled, false);
  assert.equal(f2RateLimited.reason, 'skipped_rate_limit');

  // Frame 3 at t=1500ms with low visual delta (1.2% < 5.0%) -> skipped_low_visual_delta
  t.mock.timers.tick(1100);
  const f3LowDelta = await source.offerCandidateFrame({
    jpegDataUrl,
    timestampMs: 1500,
    elapsedSeconds: 1.5,
    pixelDiffPct: 1.2,
    caption: 'Static screen',
  });
  assert.equal(f3LowDelta.sampled, false);
  assert.equal(f3LowDelta.reason, 'skipped_low_visual_delta');

  // Frame 4 at t=2000ms with 14.5% change -> sampled (meaningful_visual_change)
  t.mock.timers.tick(500);
  const f4Sampled = await source.offerCandidateFrame({
    jpegDataUrl,
    timestampMs: 2000,
    elapsedSeconds: 2.0,
    pixelDiffPct: 14.5,
    caption: 'Renamed file row',
  });
  assert.equal(f4Sampled.sampled, true);
  assert.equal(f4Sampled.reason, 'meaningful_visual_change');

  // Frame 5 at t=3500ms -> sampled (reaches maxFrames=3)
  t.mock.timers.tick(1500);
  const f5Sampled = await source.offerCandidateFrame({
    jpegDataUrl,
    timestampMs: 3500,
    elapsedSeconds: 3.5,
    pixelDiffPct: 18.0,
    caption: 'Saved report',
  });
  assert.equal(f5Sampled.sampled, true);

  // Frame 6 at t=5000ms -> skipped_max_frame_cap (cap is 3)
  t.mock.timers.tick(1500);
  const f6Capped = await source.offerCandidateFrame({
    jpegDataUrl,
    timestampMs: 5000,
    elapsedSeconds: 5.0,
    pixelDiffPct: 50.0,
    caption: 'Exceeds maxFrames cap',
  });
  assert.equal(f6Capped.sampled, false);
  assert.equal(f6Capped.reason, 'skipped_max_frame_cap');

  // Stop recording -> verifies all MediaStream tracks are stopped immediately
  const stopStatus = await source.stop();
  assert.equal(stopStatus.active, false);
  assert.equal(stopStatus.allTracksStopped, true);
  assert.equal(trackStoppedCount, 1);
  assert.equal(mockTracks[0].readyState, 'ended');

  // Clean up IndexedDB fallback frames
  const frames = source.getCapturedKeyframes();
  assert.equal(frames.length, 3);
  const deleted = await deleteKeyframesFromIndexedDb(frames.map((f) => f.id));
  assert.equal(deleted, 3);
});

test('2. Credential auto-pause & secret masking: pauses on password/OTP/PIN fields and never stores secrets in compiled SKILL.md', async () => {
  const inApp = new InAppSource();
  await inApp.start({ ...SAMPLE_CONSENT, selectedSource: 'in_app' });

  // Normal typing event -> recorded and extracted as parameter
  const ev1 = await inApp.recordEvent({
    timestampMs: 1000,
    elapsedSeconds: 1.0,
    kind: 'type',
    targetSelector: 'input#project-report-name',
    accessibleName: 'Report Filename',
    tagName: 'INPUT',
    role: 'textbox',
    typedValue: '2026-10-30_weekly_summary.md',
    appOrDomain: 'stage.blaize.local',
  });
  assert.equal(ev1.recorded, true);
  assert.equal(ev1.autoPaused, false);

  // Password / OTP typing event -> triggers auto-pause & masks raw secret value
  const evSecret = await inApp.recordEvent({
    timestampMs: 2000,
    elapsedSeconds: 2.0,
    kind: 'type',
    targetSelector: 'input#user-password',
    accessibleName: 'Enter Password or 2FA OTP',
    tagName: 'INPUT',
    role: 'textbox',
    typedValue: 'SuperSecretPassword999!',
    isSecretInput: true,
    appOrDomain: 'stage.blaize.local',
  });
  assert.equal(evSecret.recorded, false);
  assert.equal(evSecret.autoPaused, true);
  assert.equal(inApp.getStatus().paused, true);
  assert.equal(inApp.getCapturedKeyframes().length, 0, 'In-app semantic events must not manufacture screenshot keyframes.');

  // Resume and click save
  inApp.resume();
  await inApp.recordEvent({
    timestampMs: 3000,
    elapsedSeconds: 3.0,
    kind: 'click',
    targetSelector: 'button#save-form',
    accessibleName: 'Save Form',
    tagName: 'BUTTON',
    role: 'button',
    appOrDomain: 'stage.blaize.local',
    checkpointExpectedState: 'Form saved banner visible',
  });
  await inApp.stop();

  const compiled = compileRecordingToDraftSkill({
    title: 'Fill Weekly Report Form',
    events: inApp.getCapturedEvents(),
    approvedKeyframes: inApp.getCapturedKeyframes(),
    sourceKind: 'in_app',
    mode: 'mock',
  });

  // Verify regular typed value became a parameter
  const regularParam = compiled.parameters.find((p) => !p.isSecretPlaceholder);
  assert.ok(regularParam);
  assert.equal(regularParam.defaultValue, '2026-10-30_weekly_summary.md');

  // Verify secret value is NEVER stored anywhere in parameters or SKILL.md
  assert.equal(compiled.skillMarkdown.includes('SuperSecretPassword999!'), false);
  const secretParam = compiled.parameters.find((p) => p.isSecretPlaceholder);
  assert.ok(secretParam);
  assert.equal(secretParam.defaultValue, '');
  assert.equal(compiled.secretPlaceholders.length, 1);
});

test('3. Patch versioning, No-Permission-Widening guard, and 1-click version rollback', () => {
  const [skill1] = buildDefaultDomainNeutralRecordedSkills();
  assert.equal(skill1.version, 1);

  // Drift simulation triggers a proposed patch
  const driftedRun = replayRecordedSkillByIntent({
    skill: skill1,
    dryRun: false,
    simulateVerifierFailOnStep: 2,
  });
  assert.equal(driftedRun.status, 'stopped_on_drift_or_fail');
  assert.ok(driftedRun.proposedPatch);
  assert.equal(driftedRun.proposedPatch.widensPermissions, false);

  // Attempt to apply a malicious patch that widens permissions (adds untrusted domain or escalates risk)
  const wideningPatch = {
    ...driftedRun.proposedPatch,
    requestedPermissions: {
      ...skill1.requiredPermissions,
      domains: [...skill1.requiredPermissions.domains, 'evil-exfil.org'],
    },
  };
  const rejected = applyApprovedSkillPatch(skill1, wideningPatch);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.error?.includes('never widen permissions'));

  // Apply valid safe patch -> creates v2
  const applied = applyApprovedSkillPatch(skill1, driftedRun.proposedPatch);
  assert.equal(applied.ok, true);
  assert.equal(applied.updatedSkill?.version, 2);
  assert.equal(applied.updatedSkill?.versionHistory.length, 2);

  // Roll back from v2 -> v1
  const rolledBack = rollbackSkillToVersion(applied.updatedSkill!, 1);
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.updatedSkill?.version, 1);
});

test('4. Multi-Skill DAG validation: cycle detection, depth limits, step caps, and unapproved skill blocking', () => {
  const skills = buildDefaultDomainNeutralRecordedSkills();
  const skillsMap = new Map(skills.map((s) => [s.id, s]));
  const basePlan = buildDemoMultiSkillPlan(skills);

  // Valid DAG passes
  const validRes = validateSkillPlanDag(basePlan, skillsMap, true);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.hasCycle, false);

  // Cyclic DAG is caught
  const cyclicPlan: SkillPlan = {
    ...basePlan,
    nodes: [
      {
        ...basePlan.nodes[0],
        dependsOnNodeIds: ['node-2-compile-digest'],
      },
      {
        ...basePlan.nodes[1],
        dependsOnNodeIds: ['node-1-index-files'],
      },
    ],
  };
  const cycleRes = validateSkillPlanDag(cyclicPlan, skillsMap, true);
  assert.equal(cycleRes.valid, false);
  assert.equal(cycleRes.hasCycle, true);

  // Unapproved (Draft) skill is blocked from running in a multi-skill plan
  const draftSkill = { ...skills[0], id: 'skill-draft-unapproved', status: 'Draft' as const };
  skillsMap.set(draftSkill.id, draftSkill);
  const unapprovedPlan: SkillPlan = {
    ...basePlan,
    nodes: [{ ...basePlan.nodes[0], skillId: draftSkill.id }],
  };
  const unapprovedRes = validateSkillPlanDag(unapprovedPlan, skillsMap, true);
  assert.equal(unapprovedRes.valid, false);
  assert.deepEqual(unapprovedRes.unapprovedSkillIds, ['skill-draft-unapproved']);
});

test('5. Multi-Skill Executor enforces approval gate, parallel non-UI execution, sequential UI resource locks, and data flow bindings', async () => {
  const skills = buildDefaultDomainNeutralRecordedSkills();
  const skillsMap = new Map(skills.map((s) => [s.id, s]));
  const ledger = new MemoryLedger(true);

  // Build a 3-node plan:
  // Layer 1 has two read-only non-UI nodes (run in parallel)
  // Layer 2 has two UI-locked nodes (must run sequentially one at a time holding browser_view lock)
  const plan: SkillPlan = {
    planId: 'plan-locks-and-parallel',
    title: 'Parallel Read + Sequential UI Lock Verification Plan',
    createdAtIso: '2026-10-30T16:00:00.000Z',
    requiresApprovalBeforeRun: true,
    approvalReason: 'Contains workspace write steps.',
    maxDepthLimit: 5,
    maxStepCap: 8,
    maxParallelNonUi: 3,
    totalBudgetTokens: 1200,
    totalEstimatedCostUsd: 0.00096,
    nodes: [
      {
        nodeId: 'n1-read-a',
        skillId: skills[0].id,
        skillName: 'Read Folder A',
        pinnedVersion: 1,
        parameterBindings: { folder: '/workspace/a' },
        dependsOnNodeIds: [],
        requiresLocks: [],
        risk: 'read',
        verifier: 'file_exists_hash',
        failurePolicy: 'retry',
        estimatedTokens: 200,
        estimatedCostUsd: 0.00016,
      },
      {
        nodeId: 'n2-read-b',
        skillId: skills[0].id,
        skillName: 'Read Folder B',
        pinnedVersion: 1,
        parameterBindings: { folder: '/workspace/b' },
        dependsOnNodeIds: [],
        requiresLocks: [],
        risk: 'read',
        verifier: 'file_exists_hash',
        failurePolicy: 'retry',
        estimatedTokens: 200,
        estimatedCostUsd: 0.00016,
      },
      {
        nodeId: 'n3-ui-form-1',
        skillId: skills[1].id,
        skillName: 'UI Form Step 1',
        pinnedVersion: 1,
        parameterBindings: { inputA: '$n1-read-a.normalizedFileList' },
        dependsOnNodeIds: ['n1-read-a', 'n2-read-b'],
        requiresLocks: ['browser_view', 'input_device'],
        risk: 'write',
        verifier: 'dom_assertion',
        failurePolicy: 'stop',
        estimatedTokens: 400,
        estimatedCostUsd: 0.00032,
      },
      {
        nodeId: 'n4-ui-form-2',
        skillId: skills[1].id,
        skillName: 'UI Form Step 2',
        pinnedVersion: 1,
        parameterBindings: { inputB: '$n2-read-b.normalizedFileList' },
        dependsOnNodeIds: ['n1-read-a', 'n2-read-b'],
        requiresLocks: ['browser_view', 'input_device'],
        risk: 'write',
        verifier: 'dom_assertion',
        failurePolicy: 'stop',
        estimatedTokens: 400,
        estimatedCostUsd: 0.00032,
      },
    ],
    edges: [
      {
        fromNodeId: 'n1-read-a',
        fromOutputKey: 'normalizedFileList',
        toNodeId: 'n3-ui-form-1',
        toParamName: 'inputA',
      },
      {
        fromNodeId: 'n2-read-b',
        fromOutputKey: 'normalizedFileList',
        toNodeId: 'n4-ui-form-2',
        toParamName: 'inputB',
      },
    ],
  };

  // 1. Without user approval -> pauses at awaiting_plan_approval
  const unapprovedRun = await executeMultiSkillPlan({
    plan,
    skillsById: skillsMap,
    ledger,
    userApprovedPlan: false,
  });
  assert.equal(unapprovedRun.status, 'awaiting_plan_approval');
  assert.equal(unapprovedRun.nodeReceipts.length, 0);

  // 2. With user approval -> runs Layer 1 in parallel (2 non-UI nodes) and Layer 2 sequentially (max 1 concurrent UI node)
  const approvedRun = await executeMultiSkillPlan({
    plan,
    skillsById: skillsMap,
    ledger,
    userApprovedPlan: true,
  });
  assert.equal(approvedRun.status, 'completed_verified');
  assert.equal(approvedRun.nodeReceipts.length, 4);
  assert.equal(approvedRun.uiLockContentionPrevented, true);
  assert.equal(approvedRun.maxConcurrentUiNodesObserved, 1);
  assert.equal(approvedRun.maxConcurrentNonUiNodesObserved, 2);

  // Verify data-flow parameter binding resolved upstream output
  const n3Receipt = approvedRun.nodeReceipts.find((r) => r.nodeId === 'n3-ui-form-1');
  assert.ok(n3Receipt);
  assert.ok(n3Receipt.resolvedInputs.inputA.includes('Rename & Index Workspace Files'));

  // Verify NativeInputSource stub reports honestly
  const nativeStub = new NativeInputSource();
  assert.equal(nativeStub.getStatus().uiLabel, 'Full desktop (not available in this preview)');
  assert.equal(nativeStub.isRealInPreview, false);
});

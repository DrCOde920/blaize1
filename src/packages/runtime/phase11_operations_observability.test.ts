/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 11 Tests — Operational Defaults, Mission Management & Observability
 * (`src/packages/runtime/phase11_operations_observability.test.ts`)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildDefaultRuntimePolicy,
  validateRuntimePolicy,
  migrateRuntimePolicy,
  RuntimePolicyManager,
  ModelUsageBudgetController,
  DeviceConcurrencyLockManager,
  MissionQueueAndLifecycleManager,
  ResourceLimiterAndWorkerSupervisor,
  SubsystemHealthRegistry,
  LocalTelemetryCollector,
  IncidentResponseAndEmergencyStopManager,
  OperationalDashboardService,
  redactSecretsFromOperationalText,
  redactSecretsFromObject,
} from './operations_and_observability';
import { DurableSqliteDatabase } from '../storage/sqlite_db';
import { PassphraseWrapVault } from '../vault';
import { DurableSchedulerEngine } from '../connectors_scheduler/cron_and_scheduler';
import { globalApprovalTokenStore } from '../trust';
import { MemoryLedger } from '../trust';

test('Phase 11.1 & 11.2: RuntimePolicy schema validation, v1->v2 migration, operational defaults, and Morrow ceiling protection', () => {
  const defaultPolicy = buildDefaultRuntimePolicy();
  const validation = validateRuntimePolicy(defaultPolicy);
  assert.equal(validation.valid, true, `Default policy should be valid: ${validation.errors.join(', ')}`);

  // Verify all required operational defaults from Prompt 11.2
  assert.equal(defaultPolicy.protectedCeilings.maxInteractiveMissions, 1);
  assert.equal(defaultPolicy.protectedCeilings.maxBackgroundJobs, 1);
  assert.equal(defaultPolicy.preferences.cloudBackgroundReflectionEnabled, false);
  assert.equal(defaultPolicy.preferences.preferDeterministicLocalFirst, true);
  assert.equal(defaultPolicy.protectedCeilings.maxSafeIdempotentRetries, 2);
  assert.equal(defaultPolicy.protectedCeilings.allowRetriesForWriteSpendSendUncertain, false);
  assert.equal(defaultPolicy.preferences.defaultToolTimeoutMs, 15_000);
  assert.equal(defaultPolicy.protectedCeilings.checkpointBeforeWrites, true);
  assert.equal(defaultPolicy.protectedCeilings.missedScheduleRunPolicy, 'skip');
  assert.equal(defaultPolicy.preferences.notificationPolicy.quietByDefault, true);
  assert.deepEqual(defaultPolicy.preferences.notificationPolicy.allowedEvents, [
    'approval_required',
    'failure',
    'uncertainty',
    'final_verified_completion',
  ]);
  assert.equal(defaultPolicy.preferences.externalTelemetryOptIn, false);

  // Test v1 -> v2 policy migration and clamping
  const migrated = migrateRuntimePolicy({
    schemaVersion: 1,
    toolTimeoutMs: 999_999, // exceeds 120_000 ceiling
    timezone: 'Invalid/Timezone_Name',
    maxTokensPerMission: 5_000_000, // exceeds 128_000 ceiling
  });
  assert.equal(migrated.migratedFromVersion, 1);
  assert.equal(migrated.policy.schemaVersion, 2);
  assert.equal(migrated.policy.preferences.defaultToolTimeoutMs, 120_000);
  assert.equal(migrated.policy.preferences.budgets.maxTokensPerMission, 128_000);
  assert.equal(validateRuntimePolicy(migrated.policy).valid, true);

  // Test RuntimePolicyManager: user can configure non-protected preferences, Morrow is blocked from editing ceilings or safety settings
  const manager = new RuntimePolicyManager();

  const userUpdate = manager.updatePolicy({
    actor: 'user',
    preferencesPatch: {
      defaultToolTimeoutMs: 20_000,
      localTimeZone: 'America/New_York',
    },
  });
  assert.equal(userUpdate.ok, true);
  assert.equal(userUpdate.policy.preferences.defaultToolTimeoutMs, 20_000);
  assert.equal(userUpdate.policy.preferences.localTimeZone, 'America/New_York');

  // Morrow attempts to edit protected ceilings -> BLOCKED
  const morrowCeilingAttempt = manager.updatePolicy({
    actor: 'morrow',
    attemptedCeilingsPatch: {
      maxInteractiveMissions: 5,
      allowRetriesForWriteSpendSendUncertain: true,
    },
  });
  assert.equal(morrowCeilingAttempt.ok, false);
  assert.equal(morrowCeilingAttempt.errorCode, 'PROTECTED_POLICY_CEILING_IMMUTABLE');

  // Morrow attempts to raise budgets or enable external telemetry or cloud reflection -> BLOCKED
  const morrowSafetyAttempt = manager.updatePolicy({
    actor: 'morrow',
    preferencesPatch: {
      externalTelemetryOptIn: true,
      cloudBackgroundReflectionEnabled: true,
      budgets: {
        maxTokensPerMission: 100_000,
        maxCostUsdPerMission: 1.5,
        maxTokensPerDay: 900_000,
        maxCostUsdPerDay: 9.0,
      },
    },
  });
  assert.equal(morrowSafetyAttempt.ok, false);
  assert.equal(morrowSafetyAttempt.errorCode, 'AGENT_SAFETY_MUTATION_FORBIDDEN');
  assert.equal(manager.getPolicy().preferences.externalTelemetryOptIn, false);
  assert.equal(manager.getPolicy().preferences.cloudBackgroundReflectionEnabled, false);
});

test('Phase 11.2: Retry evaluation (max 2 for safe idempotent reads; 0 for writes, spends, sends, and UNCERTAIN) and quiet notifications', () => {
  const manager = new RuntimePolicyManager();

  // Safe idempotent read: retry #1 and #2 allowed, retry #3 exhausted
  const r1 = manager.evaluateRetryDecision({
    toolName: 'browser.read',
    riskClass: 'read',
    idempotent: true,
    attemptNumber: 1,
  });
  assert.equal(r1.shouldRetry, true);
  assert.equal(r1.maxAllowedRetries, 2);

  const r2 = manager.evaluateRetryDecision({
    toolName: 'browser.read',
    riskClass: 'read',
    idempotent: true,
    attemptNumber: 2,
  });
  assert.equal(r2.shouldRetry, true);

  const r3 = manager.evaluateRetryDecision({
    toolName: 'browser.read',
    riskClass: 'read',
    idempotent: true,
    attemptNumber: 3,
  });
  assert.equal(r3.shouldRetry, false);
  assert.equal(r3.reasonCode, 'MAX_RETRIES_EXHAUSTED');

  // Write, spend, external_send, and UNCERTAIN outcomes: 0 retries permitted
  for (const riskClass of ['scoped_write', 'spend', 'external_send', 'destructive'] as const) {
    const dec = manager.evaluateRetryDecision({
      toolName: `tool.${riskClass}`,
      riskClass,
      idempotent: true,
      attemptNumber: 1,
    });
    assert.equal(dec.shouldRetry, false);
    assert.equal(dec.reasonCode, 'RETRY_BLOCKED_NON_READ_OR_WRITE_SPEND_SEND');
  }

  const uncertainDec = manager.evaluateRetryDecision({
    toolName: 'connectors.read',
    riskClass: 'read',
    idempotent: true,
    verificationState: 'UNCERTAIN',
    attemptNumber: 1,
  });
  assert.equal(uncertainDec.shouldRetry, false);
  assert.equal(uncertainDec.reasonCode, 'RETRY_BLOCKED_UNCERTAIN_OUTCOME');

  // Notification policy: quiet by default except approvals, failures, uncertainty, final verified completion
  assert.equal(manager.shouldNotifyUser('routine_step_progress').emitNotification, false);
  assert.equal(manager.shouldNotifyUser('background_heartbeat').emitNotification, false);
  assert.equal(manager.shouldNotifyUser('approval_required').emitNotification, true);
  assert.equal(manager.shouldNotifyUser('failure').emitNotification, true);
  assert.equal(manager.shouldNotifyUser('uncertainty').emitNotification, true);
  assert.equal(manager.shouldNotifyUser('final_verified_completion').emitNotification, true);
});

test('Phase 11.3: Per-mission and per-day model usage budgets, reported vs estimated separation, and no zero-cost live usage', () => {
  const manager = new RuntimePolicyManager();
  manager.updatePolicy({
    actor: 'operator',
    preferencesPatch: {
      budgets: {
        maxTokensPerMission: 2_000,
        maxCostUsdPerMission: 0.05,
        maxTokensPerDay: 3_500,
        maxCostUsdPerDay: 0.10,
      },
    },
  });

  const controller = new ModelUsageBudgetController(manager);
  const dateKey = '2026-11-03';

  // 1. Record a turn with provider-reported tokens
  const turn1 = controller.recordTurnUsage({
    missionId: 'msn-budget-1',
    provider: 'Meta AI',
    model: 'gemini-2.5-flash',
    mode: 'live',
    reportedInputTokens: 600,
    reportedOutputTokens: 400,
    reportedCostUsd: 0.001,
    estimatedInputTokens: 550,
    estimatedOutputTokens: 380,
    dateKey,
  });
  assert.equal(turn1.usageSource, 'provider_reported');
  assert.equal(turn1.effectiveTokensCharged, 1000);
  assert.ok(turn1.effectiveCostUsdCharged > 0);

  // 2. Record a live turn where provider omitted token counts (must use deterministic_estimate and NEVER 0 cost)
  const turn2 = controller.recordTurnUsage({
    missionId: 'msn-budget-1',
    provider: 'Meta AI',
    model: 'gemini-2.5-flash',
    mode: 'live',
    reportedInputTokens: null,
    reportedOutputTokens: null,
    reportedCostUsd: 0, // Even if 0 passed on live call, controller charges positive deterministic cost
    estimatedInputTokens: 500,
    estimatedOutputTokens: 300,
    dateKey,
  });
  assert.equal(turn2.usageSource, 'deterministic_estimate');
  assert.equal(turn2.effectiveTokensCharged, 800);
  assert.ok(turn2.effectiveCostUsdCharged > 0, 'Live model usage must never be zero-cost');

  // Verify separate accounting in mission bucket
  const missionUsage = controller.getMissionUsage('msn-budget-1');
  assert.equal(missionUsage.reportedTotalTokens, 1000);
  assert.equal(missionUsage.estimatedTotalTokens, 800);
  assert.equal(missionUsage.combinedEffectiveTokens, 1800);

  // 3. Pre-flight check stops safely BEFORE exceeding mission limit (1800 + 400 = 2200 > 2000)
  const preFlightMissionExceed = controller.evaluatePreTurnBudget({
    missionId: 'msn-budget-1',
    model: 'gemini-2.5-flash',
    mode: 'live',
    proposedInputTokens: 250,
    proposedMaxOutputTokens: 150,
    dateKey,
  });
  assert.equal(preFlightMissionExceed.allowed, false);
  assert.equal(preFlightMissionExceed.errorCode, 'MISSION_TOKEN_BUDGET_EXCEEDED');

  // 4. Second mission on the same day hits daily token limit (1800 + 1800 = 3600 > 3500)
  controller.recordTurnUsage({
    missionId: 'msn-budget-2',
    provider: 'Meta AI',
    model: 'gemini-2.5-flash',
    mode: 'live',
    reportedInputTokens: 1000,
    reportedOutputTokens: 500,
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    dateKey,
  });
  const preFlightDailyExceed = controller.evaluatePreTurnBudget({
    missionId: 'msn-budget-2',
    model: 'gemini-2.5-flash',
    mode: 'live',
    proposedInputTokens: 200,
    proposedMaxOutputTokens: 100,
    dateKey,
  });
  assert.equal(preFlightDailyExceed.allowed, false);
  assert.equal(preFlightDailyExceed.errorCode, 'DAILY_TOKEN_BUDGET_EXCEEDED');
});

test('Phase 11.4: Mission queue (1 interactive + 1 background), device locks, cancellation tokens, pause/resume, checkpoints, and orphaned job recovery', () => {
  const db = new DurableSqliteDatabase(':memory:');
  const policyManager = new RuntimePolicyManager({ db });
  const lockManager = new DeviceConcurrencyLockManager();
  const queue = new MissionQueueAndLifecycleManager(policyManager, lockManager, db);

  // Submit 2 interactive missions and 2 background jobs
  const m1 = queue.submitMission({
    missionId: 'msn-int-1',
    title: 'Interactive Mission 1',
    priority: 'interactive',
    requiredLocks: ['browser:personal', 'input_device:desktop'],
  });
  const m2 = queue.submitMission({
    missionId: 'msn-int-2',
    title: 'Interactive Mission 2',
    priority: 'interactive',
    requiredLocks: ['browser:personal'],
  });
  const bg1 = queue.submitMission({
    missionId: 'bg-job-1',
    title: 'Background Indexer 1',
    priority: 'background',
  });
  const bg2 = queue.submitMission({
    missionId: 'bg-job-2',
    title: 'Background Indexer 2',
    priority: 'background',
  });

  assert.equal(m1.record?.state, 'running');
  assert.equal(m2.record?.state, 'queued');
  assert.equal(bg1.record?.state, 'running');
  assert.equal(bg2.record?.state, 'queued');
  assert.equal(lockManager.listActiveLocks().length, 2);

  // Create a pre-write checkpoint on m1 and verify restore
  const ckpt = queue.createPreWriteCheckpoint({
    missionId: 'msn-int-1',
    stepNumber: 3,
    toolName: 'workspace.write_file',
    workspaceStateSnapshot: { 'notes.md': '# Draft v1' },
  });
  assert.equal(ckpt.createdBeforeWrite, true);
  const restored = queue.restoreCheckpoint('msn-int-1', ckpt.checkpointId);
  assert.equal(restored.restored, true);
  assert.equal(restored.checkpoint?.workspaceStateSnapshot['notes.md'], '# Draft v1');

  // Pause m1 -> releases locks and promotes m2 to running
  const paused = queue.pauseMission('msn-int-1', 'Operator requested pause');
  assert.equal(paused.ok, true);
  assert.equal(paused.record?.state, 'paused');
  assert.equal(queue.getSnapshot().activeInteractiveMission?.missionId, 'msn-int-2');

  // Cancel m2 -> aborts signal
  let m2Aborted = false;
  m2.abortSignal?.addEventListener('abort', () => {
    m2Aborted = true;
  });
  const cancelled = queue.cancelMission('msn-int-2', 'User clicked Cancel');
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.abortedSignal, true);
  assert.equal(m2Aborted, true);

  // Resume m1 -> becomes running again
  const resumed = queue.resumeMission('msn-int-1');
  assert.equal(resumed.ok, true);
  assert.equal(resumed.record?.state, 'running');

  // Simulate process restart and orphaned job recovery on the same SQLite DB
  const restartedQueue = new MissionQueueAndLifecycleManager(
    policyManager,
    new DeviceConcurrencyLockManager(),
    db
  );
  const recovery = restartedQueue.recoverOrphanedMissionsAndJobs();
  assert.equal(recovery.blindWriteReExecutionPrevented, true);
  const recoveredIds = recovery.recoveredMissions.map((m) => m.missionId);
  assert.ok(recoveredIds.includes('msn-int-1'));
  assert.ok(recoveredIds.includes('bg-job-1'));
  const recoveredM1 = recovery.recoveredMissions.find((m) => m.missionId === 'msn-int-1')!;
  assert.equal(recoveredM1.state, 'orphaned_recovered');
  assert.match(recoveredM1.orphanRecoveryNote || '', /halted for checkpoint inspection without blind re-execution/);

  db.close();
});

test('Phase 11.6: Resource limits (file size, output size, network calls) and runaway worker termination (SIGKILL)', async () => {
  const policyManager = new RuntimePolicyManager();
  const supervisor = new ResourceLimiterAndWorkerSupervisor(policyManager);

  // 1. File size limit check (5 MB max)
  assert.equal(supervisor.checkFileSizeLimit('small.txt', 1024).allowed, true);
  const oversizeFile = supervisor.checkFileSizeLimit('huge.bin', 10 * 1024 * 1024);
  assert.equal(oversizeFile.allowed, false);
  assert.equal(oversizeFile.errorCode, 'FILE_SIZE_LIMIT_EXCEEDED');

  // 2. Tool output size limit check (256 KB max)
  const hugeOutput = 'x'.repeat(300 * 1024);
  const boundedOutput = supervisor.enforceToolOutputSizeLimit('workspace.read', hugeOutput);
  assert.equal(boundedOutput.allowed, false);
  assert.equal(boundedOutput.truncated, true);
  assert.equal(boundedOutput.errorCode, 'TOOL_OUTPUT_SIZE_EXCEEDED');
  assert.match(boundedOutput.output, /TRUNCATED_BY_RESOURCE_LIMITER/);

  // 3. Network call limit per mission (25 max)
  for (let i = 1; i <= 25; i++) {
    assert.equal(
      supervisor.recordAndCheckNetworkCall('msn-net-1', `https://example.com/${i}`).allowed,
      true
    );
  }
  const call26 = supervisor.recordAndCheckNetworkCall('msn-net-1', 'https://example.com/26');
  assert.equal(call26.allowed, false);
  assert.equal(call26.errorCode, 'NETWORK_CALL_BUDGET_EXCEEDED');

  // 4. Runaway infinite-loop worker process is killed via SIGKILL and recorded
  const runawayRes = await supervisor.runSupervisedWorkerScript({
    pluginId: 'plugin-runaway-loop',
    missionId: 'msn-worker-test',
    scriptCode: 'while (true) {}',
    timeoutMsOverride: 250,
  });
  assert.equal(runawayRes.ok, false);
  assert.equal(runawayRes.killedAsRunaway, true);
  assert.equal(runawayRes.terminationRecord?.reasonCode, 'WORKER_TIMEOUT_KILLED');
  assert.equal(runawayRes.terminationRecord?.signalUsed, 'SIGKILL');
  assert.equal(supervisor.getTerminationHistory().length, 1);
});

test('Phase 11.5, 11.7, 11.8 & 11.9: 9-subsystem health checks, Operational Dashboard, Emergency Stop, and Local Telemetry secret redaction', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-phase11-'));
  const dbPath = path.join(tmpDir, 'blaize-ops.sqlite');
  const backupPath = path.join(tmpDir, 'blaize-ops.backup.sqlite');
  const db = new DurableSqliteDatabase(dbPath);
  const vault = new PassphraseWrapVault({ durableDb: db });
  await vault.store(
    {
      keyId: 'test_openai_key',
      label: 'Test Key',
      provider: 'openai',
      plainKey: 'sk-live-secret1234567890abcdef',
    },
    'operator-passphrase-1234'
  );
  assert.equal(vault.isLocked(), false);

  const scheduler = new DurableSchedulerEngine({
    stateFilePath: path.join(tmpDir, 'schedules.json'),
  });
  scheduler.registerSchedule({
    id: 'sched-daily-digest',
    title: 'Daily Digest',
    cronExpression: '0 9 * * *',
    timeZone: 'UTC',
    enabled: true,
    prompt: 'Summarize workspace notes',
    risk: 'read',
    idempotent: true,
    requiresApprovalOrSensitive: false,
    requestedCapabilities: ['workspace:read'],
  });

  const policyManager = new RuntimePolicyManager({ db });
  const budgetController = new ModelUsageBudgetController(policyManager, db);
  const lockManager = new DeviceConcurrencyLockManager();
  const missionManager = new MissionQueueAndLifecycleManager(policyManager, lockManager, db);
  const workerSupervisor = new ResourceLimiterAndWorkerSupervisor(policyManager);
  const telemetry = new LocalTelemetryCollector(policyManager);
  const ledger = new MemoryLedger();
  const healthRegistry = new SubsystemHealthRegistry({
    db,
    vault,
    scheduler,
  });
  const emergencyStopManager = new IncidentResponseAndEmergencyStopManager({
    missionManager,
    workerSupervisor,
    scheduler,
    vault,
    telemetry,
    ledger,
  });
  const dashboardService = new OperationalDashboardService({
    policyManager,
    budgetController,
    missionManager,
    workerSupervisor,
    healthRegistry,
    emergencyStopManager,
    db,
    vault,
    scheduler,
  });

  // 1. Verify all 9 subsystems return timestamped, evidence-based health reports
  const allHealth = healthRegistry.checkAllSubsystems();
  const expectedSubsystems = [
    'server',
    'electron_shell',
    'database',
    'vault',
    'model_provider',
    'browser_profiles',
    'native_driver',
    'skills_plugins',
    'scheduler',
  ] as const;
  for (const sub of expectedSubsystems) {
    assert.ok(allHealth[sub], `Missing health report for ${sub}`);
    assert.ok(allHealth[sub].checkedAtIso.length > 10);
    assert.ok(allHealth[sub].summary.length > 5);
  }
  assert.equal(allHealth.database.status, 'healthy');
  assert.equal(allHealth.vault.status, 'healthy');
  assert.equal(allHealth.browser_profiles.status, 'healthy');
  assert.equal(allHealth.scheduler.status, 'healthy');

  // 2. Verify backup/restore & OperationalDashboardSnapshot real state
  await db.backup(backupPath);
  dashboardService.recordBackupCompleted(backupPath);
  dashboardService.recordRestoreVerified(true);
  dashboardService.recordVerificationOutcome({
    timestampIso: new Date().toISOString(),
    toolOrActionName: 'workspace.write_file',
    verificationState: 'VERIFIED',
    evidenceHash: 'abcdef0123456789',
    summary: 'Verified notes.md SHA-256 on disk',
  });

  const snap = dashboardService.getDashboardSnapshot();
  assert.equal(snap.sqliteStorage.integrityOk, true);
  assert.ok(snap.sqliteStorage.fileSizeBytes > 0);
  assert.equal(snap.jobScheduler.totalSchedules, 1);
  assert.equal(snap.jobScheduler.defaultMissedRunPolicy, 'skip');
  assert.equal(snap.backupRestoreStatus.lastRestoreVerifiedOk, true);
  assert.ok(snap.backupRestoreStatus.lastBackupSizeBytes > 0);
  assert.equal(snap.lastVerification?.verificationState, 'VERIFIED');

  // 3. Local telemetry by default & secret redaction
  const blockedUpload = telemetry.prepareExternalTelemetryPayload({
    prompt: 'My secret prompt',
    screenshotBase64: 'iVBORw0KGgoAAAANSUhEUg==',
    apiKey: 'sk-live-abcdef1234567890',
    event: 'mission_done',
  });
  assert.equal(blockedUpload.allowedToUpload, false);
  assert.equal(blockedUpload.errorCode, 'EXTERNAL_TELEMETRY_DISABLED_BY_DEFAULT');

  // Even when user explicitly opts in, prompts/screenshots/files/credentials are stripped and secrets redacted
  policyManager.updatePolicy({
    actor: 'user',
    preferencesPatch: { externalTelemetryOptIn: true },
  });
  const optInUpload = telemetry.prepareExternalTelemetryPayload({
    prompt: 'Never upload user prompt',
    screenshot: 'base64-image-bytes',
    rawFile: 'secret file contents',
    credentials: 'user:pass',
    password: 'my-password',
    note: 'Failed with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and key sk-proj-1234567890abcdef',
  });
  assert.equal(optInUpload.allowedToUpload, true);
  assert.ok(optInUpload.strippedFields.includes('prompt'));
  assert.ok(optInUpload.strippedFields.includes('screenshot'));
  assert.ok(optInUpload.strippedFields.includes('rawFile'));
  assert.ok(optInUpload.strippedFields.includes('credentials'));
  assert.ok(optInUpload.strippedFields.includes('password'));
  assert.equal(optInUpload.sanitizedPayload?.prompt, undefined);
  assert.doesNotMatch(String(optInUpload.sanitizedPayload?.note), /sk-proj-1234567890abcdef/);
  assert.match(String(optInUpload.sanitizedPayload?.note), /\[REDACTED_API_KEY\]/);

  // 4. Emergency Stop: aborts missions, pauses schedules, kills workers, revokes approval/session tokens, locks vault, blocks new work
  const activeMission = missionManager.submitMission({
    missionId: 'msn-estop-active',
    title: 'Active Mission During Incident',
    priority: 'interactive',
  });
  assert.equal(activeMission.record?.state, 'running');

  const approvalGrant = globalApprovalTokenStore.issueToken({
    toolOrActionName: 'connectors.write',
    target: 'github:repo',
    payload: { title: 'Test PR' },
    profileId: 'personal',
    issuedBy: 'user',
  });
  assert.ok(globalApprovalTokenStore.getActiveTokenCount() >= 1);
  emergencyStopManager.registerSessionToken('sess_tok_123');

  const incident = emergencyStopManager.triggerEmergencyStop({
    reason: 'Suspicious tool loop with leaked token sk-live-9876543210fedcba',
    actor: 'operator',
    forensicNotes: ['Observed unexpected outbound request with ghp_1234567890abcdefghijklmnopqrstuv'],
  });

  assert.equal(incident.engaged, true);
  assert.ok(incident.abortedMissionIds.includes('msn-estop-active'));
  assert.ok(incident.pausedScheduleIds.includes('sched-daily-digest'));
  assert.equal(scheduler.getSchedule('sched-daily-digest')?.enabled, false);
  assert.ok(incident.revokedApprovalTokensCount >= 1);
  assert.equal(globalApprovalTokenStore.getActiveTokenCount(), 0);
  assert.equal(emergencyStopManager.isSessionTokenValid('sess_tok_123'), false);
  assert.equal(vault.isLocked(), true);
  assert.equal(incident.vaultLocked, true);
  assert.ok(incident.recoveryInstructions.length >= 4);
  // Verify secrets in forensic log were redacted
  assert.doesNotMatch(incident.reason, /sk-live-9876543210fedcba/);
  assert.match(incident.reason, /\[REDACTED_API_KEY\]/);
  assert.doesNotMatch(JSON.stringify(incident.redactedForensicLog), /ghp_1234567890/);

  // New work is blocked while Emergency Stop is active
  const blockedSub = missionManager.submitMission({
    title: 'Blocked Mission',
    priority: 'interactive',
  });
  assert.equal(blockedSub.accepted, false);
  assert.equal(blockedSub.errorCode, 'EMERGENCY_STOP_ACTIVE');

  // Morrow cannot clear Emergency Stop
  const morrowClear = emergencyStopManager.clearEmergencyStop({
    confirmedByOperator: true,
    actor: 'morrow',
    resolutionNote: 'I fixed it myself',
  });
  assert.equal(morrowClear.ok, false);
  assert.equal(morrowClear.errorCode, 'AGENT_CANNOT_CLEAR_EMERGENCY_STOP');

  // Operator clears Emergency Stop with resolution note -> new missions accepted again
  const opClear = emergencyStopManager.clearEmergencyStop({
    confirmedByOperator: true,
    actor: 'operator',
    resolutionNote: 'Reviewed forensic bundle and rotated affected token.',
  });
  assert.equal(opClear.ok, true);
  assert.equal(emergencyStopManager.isEmergencyStopActive(), false);

  const postClearSub = missionManager.submitMission({
    title: 'Post-Recovery Mission',
    priority: 'interactive',
  });
  assert.equal(postClearSub.accepted, true);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

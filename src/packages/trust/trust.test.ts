/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit & Property Tests for Blaize Trust Kernel (PolicyGuard, MemoryLedger, Verifier, Model Router,
 * and <24 GB RAM Memory Governance Requirements)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY_CONFIG,
  MemoryLedger,
  evaluatePolicyGuard,
  redactSensitiveText,
  runGuardPropertyTests,
  runIndependentVerifier,
} from './index';
import {
  BoundedRingBuffer,
  captureDiskSpooledScreenshot,
  checkLocalModelHardwareGate,
  computeSingleViewBrowserTabs,
  evaluateMorrowTalkPolicy,
  evaluateSleepCycleMemoryGate,
  executeSleepCycle,
  querySqliteFts5Index,
  recordAppMetricsProfile,
  runFullEvaluationHarness,
  validateMetaModelSelection,
} from '../core';

test('PolicyGuard blocks Pay/Transfer clicks on finance domains even if model claims risk is read', () => {
  const decision = evaluatePolicyGuard({
    id: 'test-pay-block',
    kind: 'click',
    target: 'https://portal.mockbank.local/pay',
    risk: 'read', // Model lies about risk level
    source: 'model',
    missionId: 'm-1',
    profileId: 'personal',
    resolvedElement: {
      tagName: 'BUTTON',
      role: 'button',
      text: 'Pay Bill GHS 450.00',
      ariaLabel: 'Pay Bill',
      formAction: '/transfer',
      isCredentialField: false,
      selector: 'button#pay-now',
      domain: 'portal.mockbank.local',
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 'DENY');
  assert.equal(decision.matchedRule, 'READ_ONLY_FINANCE_RESOLVED_ELEMENT_GUARD');
});

test('PolicyGuard suspends screenshots and triggers user takeover on password/OTP/PIN fields', () => {
  const decision = evaluatePolicyGuard({
    id: 'test-otp-takeover',
    kind: 'type',
    target: 'input#otp-code',
    risk: 'read',
    source: 'model',
    missionId: 'm-1',
    profileId: 'personal',
    typedText: '882910',
    resolvedElement: {
      tagName: 'INPUT',
      role: 'textbox',
      text: '',
      ariaLabel: 'Enter 6-digit OTP',
      inputType: 'password',
      isCredentialField: true,
      selector: 'input#otp-code',
      domain: 'portal.mockbank.local',
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 'SUSPEND_TAKEOVER');
  assert.equal(decision.redactedText, '[REDACTED_USER_SECRET]');
});

test('PolicyGuard never auto-acknowledges pending_safety_checks', () => {
  const decision = evaluatePolicyGuard({
    id: 'test-safety-check',
    kind: 'click',
    target: 'https://portal.mockbank.local/accounts',
    risk: 'read',
    source: 'model',
    missionId: 'm-1',
    profileId: 'personal',
    pendingSafetyChecks: [
      {
        id: 'sc-1',
        code: 'CONFIRM_ACTION',
        message: 'Check required',
        acknowledgedByUser: false,
      },
    ],
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 'REQUIRE_APPROVAL');
  assert.equal(decision.matchedRule, 'API_PENDING_SAFETY_CHECK_REVIEW');
});

test('PolicyGuard property test suite passes all 125 adversarial cases across 5 invariants', () => {
  const report = runGuardPropertyTests(DEFAULT_POLICY_CONFIG);
  assert.equal(report.totalGeneratedCases, 125);
  assert.equal(report.passedCases, 125);
  assert.equal(report.failedCases, 0);
  for (const inv of report.invariants) {
    assert.equal(inv.passed, true, `Invariant ${inv.id} failed`);
  }
});

test('MemoryLedger hash chain remains 100% valid after deleting encrypted user content (right-to-delete)', () => {
  const ledger = new MemoryLedger(true);
  const appended = ledger.appendEvent({
    actor: 'user',
    type: 'user_correction',
    summary: 'User corrected vendor category to Inventory',
    payload: JSON.stringify({ vendor: 'ACCRA WHOLESALE DEPOT', category: 'Inventory & Supplies' }),
    trustLevel: 'user_stated',
    missionId: 'm-ledger-test',
  });

  const beforeCheck = ledger.verifyChain();
  assert.equal(beforeCheck.valid, true);

  // Delete payload content
  const delResult = ledger.deleteContent(appended.contentRef, 'User requested deletion');
  assert.equal(delResult.deleted, true);
  assert.equal(delResult.bytesReclaimed > 0, true);

  // Hash chain must STILL verify cleanly after content deletion!
  const afterCheck = ledger.verifyChain();
  assert.equal(afterCheck.valid, true);
  assert.equal(afterCheck.firstBrokenIndex, null);

  // Tamper simulation must immediately break chain verification at index 1
  ledger.simulateTamper(1);
  const tamperedCheck = ledger.verifyChain();
  assert.equal(tamperedCheck.valid, false);
  assert.equal(tamperedCheck.firstBrokenIndex, 1);

  ledger.restoreTamperedEvent();
  assert.equal(ledger.verifyChain().valid, true);
});

test('Meta Model Router blocks -contributor IDs, muse-wonder-full, and sam-3-1 typo', () => {
  assert.equal(validateMetaModelSelection('muse-spark-1.3').allowed, true);
  assert.equal(validateMetaModelSelection('muse-spark-1.3-contributor').allowed, false);
  assert.equal(validateMetaModelSelection('muse-wonder-full').allowed, false);
  assert.equal(validateMetaModelSelection('sam-3-1').allowed, false);
  assert.equal(validateMetaModelSelection('sam-3.1').allowed, true);
});

test('BoundedRingBuffer evicts oldest items without unbounded memory growth', () => {
  const ring = new BoundedRingBuffer<number>(4);
  for (let i = 1; i <= 10; i++) {
    ring.push(i);
  }
  assert.deepEqual(ring.toArray(), [7, 8, 9, 10]);
  assert.equal(ring.evictedCount, 6);
});

test('Morrow TalkPolicy is silent by default on routine progress and respects Focus Mode', () => {
  const routine = evaluateMorrowTalkPolicy({
    trigger: 'routine_progress',
    focusModeActive: false,
    dismissalCountForCategory: 0,
    proposedMessage: 'Step 1 running',
  });
  assert.equal(routine.decision, 'STAY_QUIET');

  const focusSuppressed = evaluateMorrowTalkPolicy({
    trigger: 'task_finished_proof',
    focusModeActive: true,
    dismissalCountForCategory: 0,
    proposedMessage: 'Done',
  });
  assert.equal(focusSuppressed.decision, 'STAY_QUIET');

  const approvalAlwaysSpeaks = evaluateMorrowTalkPolicy({
    trigger: 'approval_needed',
    focusModeActive: true,
    dismissalCountForCategory: 5,
    proposedMessage: 'Need approval',
  });
  assert.equal(approvalAlwaysSpeaks.decision, 'SPEAK');
  assert.equal(approvalAlwaysSpeaks.urgency, 'phone');
});

test('<24 GB RAM Memory Governance: blocks local models, suspends background tabs, spools JPEG to disk, gates sleep cycle', () => {
  // 1. Local model never loads on <24 GB RAM even if user tries to opt in
  const hw16 = checkLocalModelHardwareGate(16, true);
  assert.equal(hw16.localModelLoaded, false);
  assert.equal(hw16.residentMemoryMb, 0);
  assert.equal(hw16.status, 'BLOCKED_UNDER_24GB_RAM');

  // 2. Single active WebContentsView: only 1 active tab in memory, 3 discarded (0 MB)
  const tabState = computeSingleViewBrowserTabs('accounts', 'personal');
  assert.equal(tabState.activeWebContentsCount, 1);
  assert.equal(tabState.activeProfileCount, 1);
  assert.equal(tabState.discardedTabsCount, 3);
  for (const t of tabState.tabs) {
    if (t.state === 'DISCARDED_TO_URL') {
      assert.equal(t.residentMemoryMb, 0);
    }
  }

  // 3. Downscaled JPEG spooled to disk (0 bytes retained in RAM)
  const shot = captureDiskSpooledScreenshot('step-verify-balance');
  assert.equal(shot.record.viewport, '1024x640');
  assert.equal(shot.inMemoryBytes, 0);
  assert.equal(shot.record.inMemoryBufferBytes, 0);

  // 4. SQLite WAL + FTS5 only (no vector DB)
  const ledger = new MemoryLedger(true);
  const fts = querySqliteFts5Index(
    'Makola',
    ledger.getEvents().map((e) => ({ id: e.id, title: e.type, body: e.summary }))
  );
  assert.equal(fts.status.engine, 'SQLite 3 (WAL + FTS5)');
  assert.equal(fts.status.vectorDatabasePresent, false);
  assert.equal(fts.status.embeddingModelMemoryMb, 0);

  // 5. Sleep cycle defers when free memory is below threshold or app is busy
  const lowMemGate = evaluateSleepCycleMemoryGate({
    appIsIdle: true,
    freeMemoryMb: 1024,
    thresholdMb: 2048,
  });
  assert.equal(lowMemGate.permitted, false);
  const deferredSleep = executeSleepCycle(ledger, {
    appIsIdle: true,
    freeMemoryMb: 1024,
    thresholdMb: 2048,
  });
  assert.equal(deferredSleep.promotionStatus, 'DEFERRED_LOW_MEMORY_OR_BUSY');

  // 6. app.getAppMetrics() profiler records Idle, Mission, and Peak
  const perfReport = recordAppMetricsProfile(16);
  assert.equal(perfReport.under24GbPolicyActive, true);
  assert.equal(perfReport.idle.totalWorkingSetMb < 160, true);
  assert.equal(perfReport.peak.totalWorkingSetMb < 220, true);
});

test('Independent Verifier and Full Evaluation Harness pass all 10 benchmark metrics', () => {
  const ver = runIndependentVerifier({
    stepId: 's1',
    expectedState: 'Reconciled',
    actualUrl: 'https://portal.mockbank.local/accounts',
    expectedUrlSubstring: 'mockbank.local/accounts',
    domSelectorPresent: false,
    numbersReconciled: true,
    pageTextSample: 'Clean page',
    actorModel: 'muse-spark-1.3',
  });
  assert.equal(ver.status, 'fail');

  const redacted = redactSensitiveText('User password=superSecret99 and card 4111-2222-3333-4444');
  assert.equal(redacted.hadSecrets, true);
  assert.equal(redacted.redacted.includes('superSecret99'), false);

  const evalReport = runFullEvaluationHarness();
  assert.equal(evalReport.rows.length, 10);
  for (const row of evalReport.rows) {
    assert.equal(row.passed, true, `Eval metric failed: ${row.metric}`);
  }
});

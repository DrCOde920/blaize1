/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Decoupling & Modular Plugin Architecture Tests
 * Proves that Blaize Core is completely domain-neutral, runs without L3xi,
 * supports third-party plugins with custom verifiers and PolicyPacks,
 * and passes the 4 required verification scenarios.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Imports strictly from core/trust contracts — zero direct dependency on l3xi in core suite
import {
  ActionProposal,
  GenericRiskClass,
  PluginManifest,
  PolicyPack,
  VerifierExecutionContext,
  VerifierExecutionResult,
  VerifierStrategy,
} from '../contracts';
import {
  CORE_VERIFIER_STRATEGIES,
  DEFAULT_POLICY_CONFIG,
  MemoryLedger,
  VerifierRegistry,
  evaluatePolicyGuard,
  globalVerifierRegistry,
  registerVerifierStrategy,
  runVerifier,
} from './index';
import { runFullEvaluationHarness } from '../core';

// Test 1: Core is domain-neutral and runs with L3xi absent
test('Blaize Core evaluation harness and 6 core verifiers run with L3xi absent', async () => {
  // Verify all 6 core verifier strategies are registered and available
  const coreStrategyIds = [
    'dom_assertion',
    'url_check',
    'file_exists_hash',
    'test_suite_pass',
    'screenshot_check',
    'schedule_preview',
  ];

  for (const id of coreStrategyIds) {
    const strat = globalVerifierRegistry.get(id);
    assert.ok(strat, `Core verifier strategy ${id} must be registered by default`);
  }

  // Full eval harness must pass all 10 rows without relying on l3xi
  const evalReport = runFullEvaluationHarness();
  assert.equal(evalReport.rows.length, 10);
  for (const row of evalReport.rows) {
    assert.equal(row.passed, true, `Metric ${row.metric} failed`);
  }
});

// Test 2: Third-party plugin (Citation Research) registers custom verifier and PolicyPack
test('Install a second non-finance plugin with custom verifier and tightening PolicyPack', async () => {
  const customVerifier: VerifierStrategy = {
    id: 'citation_check',
    name: 'Academic Citation Verifier',
    description: 'Proves citation claims match peer-reviewed source excerpts.',
    verify: (ctx: VerifierExecutionContext): VerifierExecutionResult => {
      const payload = (ctx.outputPayload as Record<string, unknown>) || {};
      const isValid = Boolean(payload.doi && payload.claimText);
      return {
        status: isValid ? 'pass' : 'fail',
        reason: isValid
          ? 'Citation claim verified against primary paper DOI source.'
          : 'Citation claim text missing or unverified.',
        evidenceHash: `hash-citation-${payload.doi || 'unknown'}`,
        details: payload,
      };
    },
  };

  registerVerifierStrategy(customVerifier);

  const testRegistryVerifier = globalVerifierRegistry.get('citation_check');
  assert.ok(testRegistryVerifier, 'citation_check must be present in VerifierRegistry');

  // Verify successful citation proof
  const passResult = runVerifier('citation_check', {
    toolName: 'plugin.research.verify_citation',
    target: 'https://arxiv.org/abs/paxos',
    outputPayload: {
      doi: '10.1145/paxos.1998',
      claimText: 'The Part-Time Parliament: consensus reached with quorum',
      primarySourceUrl: 'https://arxiv.org/abs/paxos',
    },
  });
  assert.equal(passResult.status, 'pass');
  assert.ok(passResult.evidenceHash.includes('10.1145/paxos.1998'));

  // Tightening PolicyPack: domain allowlist and deny rule
  const academicPolicyPack: PolicyPack = {
    id: 'pack-academic-safety',
    pluginId: 'plugin-citation-research',
    name: 'Academic Safety Pack',
    version: '1.0.0',
    description: 'Enforces academic research domains and blocks untrusted blogs',
    domainAllowlist: ['arxiv.org', 'scholar.google.com'],
    extraDenyRules: [
      {
        id: 'rule-block-untrusted-blog',
        description: 'Block untrusted non-academic domains',
        reason: 'Untrusted domain not permitted during research mode',
        matches: (proposal: ActionProposal) => proposal.target.includes('untrusted-blog'),
      },
    ],
  };

  const guardedPolicyConfig = {
    ...DEFAULT_POLICY_CONFIG,
    activePolicyPacks: [academicPolicyPack],
  };

  // Navigating to allowlisted domain passes
  const allowedNav = evaluatePolicyGuard(
    {
      id: 'nav-arxiv',
      kind: 'navigate',
      target: 'https://arxiv.org/abs/2104.08821',
      risk: 'read',
      source: 'model',
      missionId: 'm-research',
      profileId: 'personal',
    },
    guardedPolicyConfig
  );
  assert.equal(allowedNav.allowed, true);

  // Navigating to non-academic domain is blocked by the tightening PolicyPack
  const blockedNav = evaluatePolicyGuard(
    {
      id: 'nav-untrusted',
      kind: 'navigate',
      target: 'https://untrusted-blog.xyz/post',
      risk: 'read',
      source: 'model',
      missionId: 'm-research',
      profileId: 'personal',
    },
    guardedPolicyConfig
  );
  assert.equal(blockedNav.allowed, false);
  assert.equal(blockedNav.status, 'DENY');
});

// Test 3: Generic Risk Classes enforce default-deny and approval requirements
test('Generic risk classes enforce default-deny, spend approvals, and destructive confirmation', () => {
  // Spend on read-only finance domain is strictly denied by policy
  const directSpendOnFinance = evaluatePolicyGuard({
    id: 'act-spend-direct',
    kind: 'spend',
    target: 'https://portal.mockbank.local/operator-billing',
    risk: 'spend',
    source: 'model',
    missionId: 'm-spend',
    profileId: 'personal',
    amount: 50,
  });
  assert.equal(directSpendOnFinance.allowed, false);
  assert.equal(directSpendOnFinance.status, 'DENY');

  // Draft spend proposal requires explicit operator approval
  const draftSpend = evaluatePolicyGuard({
    id: 'act-spend-draft',
    kind: 'draft_action',
    target: 'https://dev.meta.ai/billing/subscribe',
    risk: 'spend',
    source: 'model',
    missionId: 'm-spend',
    profileId: 'personal',
    amount: 25,
  });
  assert.equal(draftSpend.allowed, false);
  assert.equal(draftSpend.status, 'REQUIRE_APPROVAL');

  // Destructive risk class requires operator confirmation
  const destructiveDecision = evaluatePolicyGuard({
    id: 'act-delete-file',
    kind: 'file_delete',
    target: 'https://docs.blaize.local/workspace/important-data.json',
    risk: 'destructive',
    source: 'model',
    missionId: 'm-delete',
    profileId: 'personal',
  });
  assert.equal(destructiveDecision.allowed, false);
  assert.equal(destructiveDecision.status, 'REQUIRE_APPROVAL');

  // Credential risk class triggers takeover
  const credDecision = evaluatePolicyGuard({
    id: 'act-pass',
    kind: 'type',
    target: 'input#token',
    risk: 'credential',
    source: 'model',
    missionId: 'm-auth',
    profileId: 'personal',
    resolvedElement: {
      tagName: 'INPUT',
      role: 'textbox',
      text: '',
      ariaLabel: 'API Token',
      isCredentialField: true,
      selector: 'input#token',
      domain: 'portal.mockbank.local',
    },
  });
  assert.equal(credDecision.allowed, false);
  assert.equal(credDecision.status, 'SUSPEND_TAKEOVER');
});

// Test 4: 4 Scenarios (research_citations, file_organize, fix_failing_test, l3xi_reconcile)
test('Executes all 4 core and plugin verification scenarios', async () => {
  // Scenario 1: research_citations using citation_check
  const res1 = runVerifier('citation_check', {
    toolName: 'plugin.research.verify_citation',
    target: 'https://arxiv.org/abs/paxos',
    outputPayload: {
      doi: '10.1145/paxos',
      claimText: 'State machine replication',
    },
  });
  assert.equal(res1.status, 'pass');

  // Scenario 2: file_organize using file_exists_hash
  const res2 = runVerifier('file_exists_hash', {
    toolName: 'workspace.write',
    target: 'dist/bundle.js',
    outputPayload: 'console.log("verified bundle");',
  });
  assert.equal(res2.status, 'pass');
  assert.ok(res2.evidenceHash.length > 0);

  // Scenario 3: fix_failing_test using test_suite_pass
  const res3 = runVerifier('test_suite_pass', {
    toolName: 'workspace.run_tests',
    target: 'tests/run',
    outputPayload: { passed: true },
    customParams: {
      exitCode: 0,
      failedTestsCount: 0,
    },
  });
  assert.equal(res3.status, 'pass');

  // Scenario 4: l3xi_reconcile using numeric_reconciliation (from optional L3xi plugin)
  const { registerL3xiPlugin } = await import('../l3xi');
  registerL3xiPlugin();

  const res4 = runVerifier('numeric_reconciliation', {
    toolName: 'plugin.l3xi.reconcile',
    target: 'statement-october',
    outputPayload: {
      openingBalance: 120000,
      totalCredits: 35000,
      totalDebits: 20000,
      statedClosingBalance: 135000,
    },
  });
  assert.equal(res4.status, 'pass');
});

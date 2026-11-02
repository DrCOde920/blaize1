import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentRuntime,
  INITIAL_RULE_BOOK,
  ModelRouter,
  RuntimeEventBus,
  assembleTokenLeanPrompt,
  compileTeachDemonstrationToSkill,
  deriveSecretCodePBKDF2,
  migratePersistedSnapshot,
  mutateRuleBookWithGuard,
  replayCompiledSkillByIntent,
  runMeasuredEvaluationSuite,
  searchInAppHelp,
  verifyAndRestyleWithPersona,
  verifySecretCodePBKDF2,
} from './index';
import { MemoryLedger, DEFAULT_POLICY_CONFIG } from '../trust';
import {
  DEFAULT_SOUL_DOCUMENT,
  INITIAL_IDE_FILES,
  INITIAL_MEMORY_ENTRIES,
  INITIAL_REUSABLE_SKILLS,
  INITIAL_WORKSPACE_CONNECTORS,
  INITIAL_WORKSPACE_PROJECTS,
} from '../workspace';
import { validateMetaModelProxyRequest } from '../../../server';

describe('Blaize Unified AgentRuntime & Toolbelt', () => {
  it('validates Meta Model API proxy requests: allows muse-spark-1.3 & muse-wonder-1.0, blocks -contributor IDs, enforces 64KB cap', () => {
    const validLoop = validateMetaModelProxyRequest({
      model: 'muse-spark-1.3',
      messages: [{ role: 'user', content: 'Reconcile October' }],
    });
    assert.equal(validLoop.valid, true);
    assert.equal(validLoop.resolvedModel, 'muse-spark-1.3');

    const validPlan = validateMetaModelProxyRequest({
      model: 'muse-wonder-1.0',
      messages: [{ role: 'user', content: 'Plan recovery' }],
    });
    assert.equal(validPlan.valid, true);
    assert.equal(validPlan.resolvedModel, 'muse-wonder-1.0');

    const blockedContributor = validateMetaModelProxyRequest({
      model: 'muse-spark-1.3-contributor',
      messages: [{ role: 'user', content: 'Test' }],
    });
    assert.equal(blockedContributor.valid, false);
    assert.match(blockedContributor.error || '', /-contributor/i);

    const oversizedPayload = validateMetaModelProxyRequest({
      model: 'muse-spark-1.3',
      messages: [{ role: 'user', content: 'x'.repeat(70000) }],
    });
    assert.equal(oversizedPayload.valid, false);
    assert.match(oversizedPayload.error || '', /64 KB/i);
  });

  it('assembles a 4-slot token-lean prompt with stable prefix caching and fact-preservation verification', () => {
    const assembled = assembleTokenLeanPrompt({
      soul: DEFAULT_SOUL_DOCUMENT,
      memories: INITIAL_MEMORY_ENTRIES,
      project: INITIAL_WORKSPACE_PROJECTS[0],
      rules: INITIAL_RULE_BOOK,
      skills: INITIAL_REUSABLE_SKILLS,
      loadedSkillSlugs: ['citation-verifier'],
      loadedPluginIds: ['plugin-l3xi-finance'],
      userMissionPrompt: 'Reconcile October and prepare the utility draft',
    });

    assert.ok(assembled.slot1SoulReadOnly.includes('READ-ONLY TO AGENT'));
    assert.ok(assembled.slot2MemorySnippets.length > 0);
    assert.ok(assembled.slot3ProjectAndRules.includes('SAFETY_FLOOR'));
    assert.ok(assembled.slot4SkillIndex.includes('citation-verifier'));
    assert.equal(assembled.loadedSkillBodies.length, 1);
    assert.ok(assembled.stablePrefixHash.length >= 8);

    // Fact-preservation passes when numbers & status are intact
    const okCheck = verifyAndRestyleWithPersona({
      structuredFacts: {
        numbers: ['GHS 2,457.50', 'GHS 120.00'],
        statusLabel: 'Needs your approval',
        summary: 'Closing balance is GHS 2,457.50 and utility draft of GHS 120.00 is paused.',
      },
      soul: DEFAULT_SOUL_DOCUMENT,
      candidateWording:
        'Reconciled! Closing balance is GHS 2,457.50; the GHS 120.00 draft Needs your approval.',
    });
    assert.equal(okCheck.factPreservationPassed, true);

    // Fact-preservation rejects altered numbers and falls back to plain structured facts
    const tamperedCheck = verifyAndRestyleWithPersona({
      structuredFacts: {
        numbers: ['GHS 2,457.50', 'GHS 120.00'],
        statusLabel: 'Needs your approval',
        summary: 'Closing balance is GHS 2,457.50 and utility draft of GHS 120.00 is paused.',
      },
      soul: DEFAULT_SOUL_DOCUMENT,
      candidateWording: 'Closing balance is GHS 9,999.00 [Needs your approval]',
    });
    assert.equal(tamperedCheck.factPreservationPassed, false);
    assert.ok(tamperedCheck.finalReply.includes('GHS 2,457.50'));
  });

  it('enforces Rule Book safety-floor protection: blocks agent edits and requires PBKDF2 secret code for user edits', () => {
    const digest = deriveSecretCodePBKDF2('2026');
    assert.equal(verifySecretCodePBKDF2('2026', digest), true);
    assert.equal(verifySecretCodePBKDF2('9999', digest), false);

    // Agent cannot toggle a safety_floor rule
    const agentAttempt = mutateRuleBookWithGuard({
      rules: INITIAL_RULE_BOOK,
      targetRuleId: 'rule-floor-no-unattended-money',
      action: 'toggle',
      actor: 'agent',
    });
    assert.equal(agentAttempt.ok, false);
    assert.match(agentAttempt.error || '', /never change or disable safety-floor/i);

    // User without secret code cannot toggle a safety_floor rule
    const userNoCode = mutateRuleBookWithGuard({
      rules: INITIAL_RULE_BOOK,
      targetRuleId: 'rule-floor-no-unattended-money',
      action: 'toggle',
      actor: 'user',
      secretCodeProvided: 'wrong',
      secretDigest: digest,
    });
    assert.equal(userNoCode.ok, false);

    // User with valid PBKDF2 secret code can toggle a safety_floor rule
    const userWithCode = mutateRuleBookWithGuard({
      rules: INITIAL_RULE_BOOK,
      targetRuleId: 'rule-floor-no-unattended-money',
      action: 'toggle',
      actor: 'user',
      secretCodeProvided: '2026',
      secretDigest: digest,
    });
    assert.equal(userWithCode.ok, true);
  });

  it('compiles Teach & Replay browser demonstrations while stripping credential fields and verifying post-conditions', () => {
    const compiled = compileTeachDemonstrationToSkill({
      title: 'Export October Statement CSV',
      events: [
        {
          stepIndex: 1,
          kind: 'navigate',
          selectorOrUrl: 'https://portal.mockbank.local/statements/october-2026',
          intentLabel: 'Open October statement page',
          narration: 'Open the statement view',
          expectedPostCondition: 'url_contains(october-2026)',
        },
        {
          stepIndex: 2,
          kind: 'type',
          selectorOrUrl: 'input[type="password"]#pin',
          intentLabel: 'Enter PIN',
          narration: 'Never record credentials',
          isCredentialField: true,
          expectedPostCondition: 'authenticated',
        },
        {
          stepIndex: 3,
          kind: 'extract',
          selectorOrUrl: 'table#statement-ledger',
          intentLabel: 'Extract 6 ledger rows',
          narration: 'Grab all statement rows',
          expectedPostCondition: 'rows_extracted == 6',
        },
      ],
    });

    assert.equal(compiled.skippedCredentialEvents, 1);
    assert.equal(compiled.steps.length, 2);

    const replay = replayCompiledSkillByIntent({
      compiled,
      dryRun: false,
      chaosLayoutChanged: true,
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.stepsCompleted, 2);
  });

  it('runs flagship mission "Reconcile October and prepare the utility draft" end-to-end across all 7 toolbelt steps and pauses payment at PolicyGuard', async () => {
    const runtime = new AgentRuntime();
    const ledger = new MemoryLedger();
    const router = new ModelRouter('mock');
    const bus = new RuntimeEventBus();

    const result = await runtime.runMission('Reconcile October and prepare the utility draft', {
      soul: DEFAULT_SOUL_DOCUMENT,
      memories: INITIAL_MEMORY_ENTRIES,
      project: INITIAL_WORKSPACE_PROJECTS[0],
      rules: INITIAL_RULE_BOOK,
      skills: INITIAL_REUSABLE_SKILLS,
      ideFiles: INITIAL_IDE_FILES,
      connectors: INITIAL_WORKSPACE_CONNECTORS,
      policyConfig: DEFAULT_POLICY_CONFIG,
      ledger,
      modelRouter: router,
      eventBus: bus,
    });

    assert.equal(result.status, 'waiting_for_approval');
    assert.equal(result.steps.length, 7);
    assert.equal(result.steps[0].toolCall.tool, 'memory.read');
    assert.equal(result.steps[1].toolCall.tool, 'skill_view');
    assert.equal(result.steps[2].toolCall.tool, 'browser.extract');
    assert.equal(result.steps[3].toolCall.tool, 'plugin.l3xi_reconcile');
    assert.equal(result.steps[4].toolCall.tool, 'workspace.write');
    assert.equal(result.steps[5].toolCall.tool, 'schedule.create');
    assert.equal(result.steps[6].toolCall.tool, 'plugin.l3xi_prepare_draft');
    assert.equal(result.steps[6].guardDecision.status, 'Needs your approval');
    assert.ok(result.pendingApproval);
    assert.equal(result.proposedIdeDiffs.length, 1);
    assert.equal(result.proposedSchedules.length, 1);
    assert.equal(result.factPreservationPassed, true);

    const audit = ledger.verifyChain();
    assert.equal(audit.valid, true);
    assert.ok(bus.getHistory().length >= 8);
  });

  it('runs the Measured Evaluation Suite from actual local executions and migrates v1 snapshots to v2', async () => {
    const evalReport = await runMeasuredEvaluationSuite();
    assert.equal(evalReport.replaySuccessRatePct, 100);
    assert.equal(evalReport.falseSuccessCount, 0);
    assert.equal(evalReport.guardEnforcementRatePct, 100);
    assert.equal(evalReport.extractionAccuracyPct, 100);
    assert.equal(evalReport.balanceCheckDetectionPct, 100);
    assert.ok(evalReport.scenarioStepsVerified >= 2);

    const migrated = migratePersistedSnapshot({
      schemaVersion: 1,
      companionName: 'MorrowCustom',
    });
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.companionName, 'MorrowCustom');
    assert.ok(searchInAppHelp('reconcile').length >= 1);
  });
});

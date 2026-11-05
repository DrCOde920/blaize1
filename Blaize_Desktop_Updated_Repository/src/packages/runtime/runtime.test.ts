import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentRuntime,
  INITIAL_RULE_BOOK,
  ModelRouter,
  RuntimeEventBus,
  ToolRegistry,
  assembleTokenLeanPrompt,
  compileTeachDemonstrationToSkill,
  createDefaultToolRegistry,
  deriveSecretCodePBKDF2,
  executePluginToolOrFail,
  migratePersistedSnapshot,
  mutateRuleBookWithGuard,
  replayCompiledSkillByIntent,
  runMeasuredEvaluationSuite,
  searchInAppHelp,
  verifyAndRestyleWithPersona,
  verifySecretCodePBKDF2,
} from './index';
import {
  MemoryLedger,
  DEFAULT_POLICY_CONFIG,
  canPromoteRecordToReal,
  formatTruthfulUiStatusLabel,
} from '../trust';
import {
  DEFAULT_SOUL_DOCUMENT,
  INITIAL_IDE_FILES,
  INITIAL_MEMORY_ENTRIES,
  INITIAL_REUSABLE_SKILLS,
  INITIAL_WORKSPACE_CONNECTORS,
  INITIAL_WORKSPACE_PROJECTS,
  executeSkillManage,
} from '../workspace';
import { validateSkillPlanDag } from '../recorder';
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
    assert.equal(result.isSimulated, true);
    assert.equal(result.steps[0].executionState, 'SIMULATED');
    assert.equal(result.steps[0].uiStatusLabel, 'Simulated (Preview)');
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

  it('PROMPT 1 Contract (a) & (b): rejects success-without-side-effect and fake executor result when target state is unchanged', async () => {
    const registry = new ToolRegistry();
    const runtimeCtx = {
      soul: DEFAULT_SOUL_DOCUMENT,
      memories: INITIAL_MEMORY_ENTRIES,
      project: INITIAL_WORKSPACE_PROJECTS[0],
      rules: INITIAL_RULE_BOOK,
      skills: INITIAL_REUSABLE_SKILLS,
      ideFiles: INITIAL_IDE_FILES,
      connectors: INITIAL_WORKSPACE_CONNECTORS,
      policyConfig: DEFAULT_POLICY_CONFIG,
      ledger: new MemoryLedger(),
      modelRouter: new ModelRouter('mock'),
      eventBus: new RuntimeEventBus(),
    };
    const toolExecCtx = {
      runtimeContext: runtimeCtx,
      sideEffects: {
        proposedIdeDiffs: [],
        proposedSchedules: [],
        reviewQueueAdditions: [],
        setBrowserUrl: () => {},
        getBrowserUrl: () => 'https://portal.mockbank.local/dashboard',
      },
    };

    // Case A: success-without-side-effect (executor returns output without realSideEffectPerformed=true on AVAILABLE_REAL tool)
    registry.register({
      name: 'workspace.write',
      version: '1.0.0',
      subsystem: 'mission_runtime',
      inputSchema: { path: 'string:required' },
      outputSchema: { ok: 'boolean' },
      riskClass: 'write',
      requiredCapabilities: ['fs:write'],
      timeoutMs: 2000,
      retryPolicy: { maxRetries: 0, backoffMs: 0, idempotent: false },
      availabilityStatus: 'AVAILABLE_REAL',
      executor: () => ({
        ok: true,
        output: { ok: true, proposedDiffOnly: true },
        realSideEffectPerformed: false,
        isSimulated: false,
      }),
      verifier: () => ({
        independentTargetRead: true,
        criteriaMet: true,
        verificationState: 'VERIFIED',
        evidenceHash: 'sha256:test_hash_1',
        summary: 'Would pass if executor had side effect',
      }),
    });

    const noSideEffectRes = registry.execute(
      {
        id: 'c-no-side-effect',
        tool: 'workspace.write',
        args: { path: 'src/App.tsx' },
        rationale: 'Test success-without-side-effect rejection',
      },
      toolExecCtx
    );
    assert.equal(noSideEffectRes.ok, false);
    assert.equal(noSideEffectRes.executionState, 'FAILED');
    assert.equal(noSideEffectRes.verificationState, 'FAILED');
    assert.equal(noSideEffectRes.errorCode, 'EXECUTION_WITHOUT_SIDE_EFFECT');
    assert.notEqual(noSideEffectRes.uiStatusLabel, 'Verified');

    // Case B: fake executor result (executor claims realSideEffectPerformed=true, but independent verifier checks actual disk state and sees no change)
    const actualTargetDiskContent = 'original-disk-content';
    const fakeExecutorRegistry = new ToolRegistry();
    fakeExecutorRegistry.register({
      name: 'workspace.write',
      version: '1.0.0',
      subsystem: 'mission_runtime',
      inputSchema: { path: 'string:required', expectedContent: 'string:required' },
      outputSchema: { written: 'boolean' },
      riskClass: 'write',
      requiredCapabilities: ['fs:write'],
      timeoutMs: 2000,
      retryPolicy: { maxRetries: 0, backoffMs: 0, idempotent: false },
      availabilityStatus: 'AVAILABLE_REAL',
      executor: () => ({
        // Lies that it wrote to disk without mutating actualTargetDiskContent
        ok: true,
        output: { written: true },
        realSideEffectPerformed: true,
        isSimulated: false,
      }),
      verifier: (args) => {
        const matchesActualTarget = actualTargetDiskContent === String(args.expectedContent);
        return {
          independentTargetRead: true,
          criteriaMet: matchesActualTarget,
          verificationState: matchesActualTarget ? 'VERIFIED' : 'FAILED',
          evidenceHash: 'sha256:fake_exec_check',
          summary: matchesActualTarget
            ? 'Target disk content matches expected content'
            : 'Target disk content did not change after executor claimed success',
          observedState: {
            actualValueSummary: actualTargetDiskContent,
            expectedCriteria: String(args.expectedContent),
          },
        };
      },
    });

    const fakeExecRes = fakeExecutorRegistry.execute(
      {
        id: 'c-fake-exec',
        tool: 'workspace.write',
        args: { path: 'src/App.tsx', expectedContent: 'updated-disk-content' },
        rationale: 'Test fake executor result caught by independent verifier',
      },
      toolExecCtx
    );
    assert.equal(fakeExecRes.ok, false);
    assert.equal(fakeExecRes.executionState, 'EXECUTED');
    assert.equal(fakeExecRes.verificationState, 'FAILED');
    assert.equal(fakeExecRes.errorCode, 'EXECUTION_WITHOUT_SIDE_EFFECT');
    assert.equal(fakeExecRes.uiStatusLabel, 'Failed');
  });

  it('PROMPT 1 Contract (d) & (e): rejects unknown tools with UNSUPPORTED_TOOL and fails on unknown skill IDs and unknown plugin IDs without fallback-to-first', async () => {
    const registry = createDefaultToolRegistry();
    const runtime = new AgentRuntime(registry);
    const runtimeCtx = {
      soul: DEFAULT_SOUL_DOCUMENT,
      memories: INITIAL_MEMORY_ENTRIES,
      project: INITIAL_WORKSPACE_PROJECTS[0],
      rules: INITIAL_RULE_BOOK,
      skills: INITIAL_REUSABLE_SKILLS,
      ideFiles: INITIAL_IDE_FILES,
      connectors: INITIAL_WORKSPACE_CONNECTORS,
      policyConfig: DEFAULT_POLICY_CONFIG,
      ledger: new MemoryLedger(),
      modelRouter: new ModelRouter('mock'),
      eventBus: new RuntimeEventBus(),
    };
    const toolExecCtx = {
      runtimeContext: runtimeCtx,
      sideEffects: {
        proposedIdeDiffs: [],
        proposedSchedules: [],
        reviewQueueAdditions: [],
        setBrowserUrl: () => {},
        getBrowserUrl: () => 'https://portal.mockbank.local/dashboard',
      },
    };

    // 1. Unknown tool returns UNSUPPORTED / UNSUPPORTED_TOOL and never { ok: true }
    const unknownToolRes = registry.execute(
      {
        id: 'call-unknown-1',
        tool: 'nonexistent.magic_tool' as any,
        args: {},
        rationale: 'Test unknown tool rejection',
      },
      toolExecCtx
    );
    assert.equal(unknownToolRes.ok, false);
    assert.equal(unknownToolRes.executionState, 'UNSUPPORTED');
    assert.equal(unknownToolRes.verificationState, 'UNSUPPORTED');
    assert.equal(unknownToolRes.errorCode, 'UNSUPPORTED_TOOL');
    assert.equal(unknownToolRes.uiStatusLabel, 'Unsupported');

    // AgentRuntime.verifyStepOutcome also returns UNSUPPORTED_TOOL for unknown tools
    const verifyUnknown = runtime.verifyStepOutcome(
      {
        id: 'call-unknown-2',
        tool: 'nonexistent.magic_tool' as any,
        args: {},
        rationale: 'Test verifyStepOutcome on unknown tool',
      },
      {
        status: 'Simulated (Preview)',
        allowed: true,
        requiresApproval: false,
        reason: 'Allowed',
        ruleId: 'guard-pass',
      },
      unknownToolRes
    );
    assert.equal(verifyUnknown.verified, false);
    assert.equal(verifyUnknown.verificationState, 'UNSUPPORTED');
    assert.equal(verifyUnknown.errorCode, 'UNSUPPORTED_TOOL');

    // 2. Unknown skill ID in skill_view, skill_run, skill_manage, and validateSkillPlanDag fails with UNKNOWN_SKILL (no fallback to skills[0])
    const unknownSkillView = registry.execute(
      {
        id: 'call-unknown-skill-view',
        tool: 'skill_view',
        args: { slug: 'nonexistent-skill-slug-999' },
        rationale: 'Test unknown skill_view',
      },
      toolExecCtx
    );
    assert.equal(unknownSkillView.ok, false);
    assert.equal(unknownSkillView.errorCode, 'UNKNOWN_SKILL');

    const unknownSkillRun = registry.execute(
      {
        id: 'call-unknown-skill-run',
        tool: 'skill_run',
        args: { slug: 'nonexistent-skill-slug-999' },
        rationale: 'Test unknown skill_run',
      },
      toolExecCtx
    );
    assert.equal(unknownSkillRun.ok, false);
    assert.equal(unknownSkillRun.errorCode, 'UNKNOWN_SKILL');

    assert.throws(
      () =>
        executeSkillManage(INITIAL_REUSABLE_SKILLS, {
          action: 'delete',
          skillId: 'nonexistent-skill-id',
        }),
      /UNKNOWN_SKILL/
    );

    const dagValidation = validateSkillPlanDag(
      {
        planId: 'plan-unknown-skill',
        title: 'Invalid Skill Plan',
        createdAtIso: new Date().toISOString(),
        nodes: [
          {
            nodeId: 'node-1',
            skillId: 'unknown-skill-id-xyz',
            skillName: 'Unknown Skill',
            pinnedVersion: 1,
            parameterBindings: {},
            dependsOnNodeIds: [],
            requiresLocks: [],
            risk: 'read',
            verifier: 'file_exists_hash',
            failurePolicy: 'stop',
            estimatedTokens: 500,
            estimatedCostUsd: 0.001,
          },
        ],
        edges: [],
        requiresApprovalBeforeRun: false,
        approvalReason: null,
        maxDepthLimit: 5,
        maxStepCap: 8,
        maxParallelNonUi: 2,
        totalBudgetTokens: 1000,
        totalEstimatedCostUsd: 0.002,
      },
      new Map(),
      false
    );
    assert.equal(dagValidation.valid, false);
    assert.match(dagValidation.error || '', /UNKNOWN_SKILL/);

    // 3. Unknown plugin ID fails with UNKNOWN_PLUGIN
    const unknownPluginCall = executePluginToolOrFail({
      pluginId: 'plugin-nonexistent-xyz',
      toolName: 'plugin.l3xi_reconcile',
      args: { statementId: 'oct-2026-clean' },
      context: toolExecCtx,
      installedPluginIds: ['plugin-l3xi-finance'],
      registry,
    });
    assert.equal(unknownPluginCall.ok, false);
    assert.equal(unknownPluginCall.executionState, 'FAILED');
    assert.equal(unknownPluginCall.errorCode, 'UNKNOWN_PLUGIN');

    const unknownPluginViaTool = registry.execute(
      {
        id: 'call-unknown-plugin',
        tool: 'plugin.l3xi_reconcile',
        args: { pluginId: 'plugin-does-not-exist', statementId: 'oct-2026-clean' },
        rationale: 'Test unknown plugin via tool',
      },
      toolExecCtx
    );
    assert.equal(unknownPluginViaTool.ok, false);
    assert.equal(unknownPluginViaTool.errorCode, 'UNKNOWN_PLUGIN');
  });

  it('PROMPT 1 Contract (f), (g), & (h): enforces missing verifier rejection, simulator isolation, and mission cancellation', async () => {
    const registry = new ToolRegistry();
    const runtimeCtx = {
      soul: DEFAULT_SOUL_DOCUMENT,
      memories: INITIAL_MEMORY_ENTRIES,
      project: INITIAL_WORKSPACE_PROJECTS[0],
      rules: INITIAL_RULE_BOOK,
      skills: INITIAL_REUSABLE_SKILLS,
      ideFiles: INITIAL_IDE_FILES,
      connectors: INITIAL_WORKSPACE_CONNECTORS,
      policyConfig: DEFAULT_POLICY_CONFIG,
      ledger: new MemoryLedger(),
      modelRouter: new ModelRouter('mock'),
      eventBus: new RuntimeEventBus(),
    };
    const toolExecCtx = {
      runtimeContext: runtimeCtx,
      sideEffects: {
        proposedIdeDiffs: [],
        proposedSchedules: [],
        reviewQueueAdditions: [],
        setBrowserUrl: () => {},
        getBrowserUrl: () => 'https://portal.mockbank.local/dashboard',
      },
    };

    // (f) Missing verifier is rejected at registration and blocked if invoked
    assert.throws(
      () =>
        registry.register({
          name: 'browser.open',
          version: '1.0.0',
          subsystem: 'browser',
          inputSchema: {},
          outputSchema: {},
          riskClass: 'read',
          requiredCapabilities: [],
          timeoutMs: 1000,
          retryPolicy: { maxRetries: 0, backoffMs: 0, idempotent: true },
          availabilityStatus: 'AVAILABLE_SIMULATED',
          executor: () => ({
            ok: true,
            output: {},
            realSideEffectPerformed: false,
            isSimulated: true,
          }),
          verifier: undefined,
        }),
      /MISSING_VERIFIER/
    );

    // Also test a tool registered with allowMissingVerifierForTest: blocked at execution with MISSING_VERIFIER
    registry.register(
      {
        name: 'browser.read',
        version: '1.0.0',
        subsystem: 'browser',
        inputSchema: {},
        outputSchema: {},
        riskClass: 'read',
        requiredCapabilities: [],
        timeoutMs: 1000,
        retryPolicy: { maxRetries: 0, backoffMs: 0, idempotent: true },
        availabilityStatus: 'AVAILABLE_REAL',
        executor: () => ({
          ok: true,
          output: { opened: true },
          realSideEffectPerformed: true,
          isSimulated: false,
        }),
        verifier: null,
      },
      { allowMissingVerifierForTest: true }
    );

    const missingVerExec = registry.execute(
      {
        id: 'c-missing-ver',
        tool: 'browser.read',
        args: {},
        rationale: 'Test missing verifier execution block',
      },
      toolExecCtx
    );
    assert.equal(missingVerExec.ok, false);
    assert.equal(missingVerExec.executionState, 'UNSUPPORTED');
    assert.equal(missingVerExec.verificationState, 'UNSUPPORTED');
    assert.equal(missingVerExec.errorCode, 'MISSING_VERIFIER');

    // Also test a verifier that does not perform an independent target read on a real tool
    registry.register({
      name: 'browser.open',
      version: '1.0.0',
      subsystem: 'browser',
      inputSchema: {},
      outputSchema: {},
      riskClass: 'read',
      requiredCapabilities: [],
      timeoutMs: 1000,
      retryPolicy: { maxRetries: 0, backoffMs: 0, idempotent: true },
      availabilityStatus: 'AVAILABLE_REAL',
      executor: () => ({
        ok: true,
        output: { opened: true },
        realSideEffectPerformed: true,
        isSimulated: false,
      }),
      verifier: () => ({
        independentTargetRead: false, // Did not independently read target!
        criteriaMet: true,
        verificationState: 'VERIFIED',
        evidenceHash: 'sha256:unverified_rubber_stamp',
        summary: 'Unverified rubber-stamp',
      }),
    });

    const unverifiedReal = registry.execute(
      {
        id: 'c-unverified-real',
        tool: 'browser.open',
        args: { url: 'https://portal.mockbank.local' },
        rationale: 'Test verifier without independentTargetRead',
      },
      toolExecCtx
    );
    assert.equal(unverifiedReal.ok, false);
    assert.equal(unverifiedReal.verificationState, 'UNCERTAIN');
    assert.equal(unverifiedReal.errorCode, 'MISSING_EVIDENCE');

    // (g) Simulator isolation: simulated results are never labelled Verified/Executed and cannot be promoted to REAL
    const promoCheck = canPromoteRecordToReal({
      executionState: 'SIMULATED',
      verificationState: 'SIMULATED',
      isSimulated: true,
    });
    assert.equal(promoCheck.allowed, false);
    assert.equal(promoCheck.errorCode, 'SIMULATED_CANNOT_PROMOTE_TO_REAL');
    assert.equal(
      formatTruthfulUiStatusLabel({
        executionState: 'SIMULATED',
        verificationState: 'SIMULATED',
        isSimulated: true,
      }),
      'Simulated (Preview)'
    );

    // (h) Cancellation: mission stops immediately when cancelAfterStep or AbortSignal is triggered
    const defaultRuntime = new AgentRuntime();
    const cancelledMission = await defaultRuntime.runMission(
      'Reconcile October and prepare the utility draft',
      {
        ...runtimeCtx,
        cancelAfterStep: 2,
      }
    );
    assert.equal(cancelledMission.status, 'cancelled');
    assert.equal(cancelledMission.executionState, 'BLOCKED');
    assert.equal(cancelledMission.steps.length, 2);
  });
});


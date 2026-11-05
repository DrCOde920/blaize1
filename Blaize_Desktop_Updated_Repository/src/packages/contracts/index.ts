/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize Contracts Package (packages/contracts)
 * Zero-allocation, memory-effective schema validation & typed boundary contracts
 * for IPC, Actions, PolicyGuard, MemoryLedger, Skills, Plugins, and L3xi records.
 */

/**
 * Canonical Action Risk Classes (PROMPT 2)
 * Required across all executors: built-ins, PC actions, browser, filesystem, connectors,
 * scheduled jobs, recorded skills, plugins, and figure generation.
 * Any unknown risk class is denied by default.
 */
export type CanonicalActionRiskClass =
  | 'read'
  | 'scoped_write'
  | 'external_send'
  | 'destructive'
  | 'spend'
  | 'credential'
  | 'system_privilege'
  | 'software_installation';

export type GenericRiskClass =
  | 'read'
  | 'write'
  | 'scoped_write'
  | 'destructive'
  | 'external_send'
  | 'credential'
  | 'spend'
  | 'system'
  | 'system_privilege'
  | 'software_installation';

// RiskLevel aliases GenericRiskClass with backward-compatible legacy aliases ('sensitive' -> credential, 'money' -> spend)
export type RiskLevel =
  | GenericRiskClass
  | 'sensitive'
  | 'money'
  | 'scoped write'
  | 'external send'
  | 'spend/money'
  | 'system/privilege'
  | 'software installation';

export type ActionSource = 'user' | 'skill' | 'model' | 'plugin' | 'scheduler' | 'pc_operator' | 'system';
export type BrowserProfileId = 'personal' | 'work' | 'testing';

export type ComputerActionType =
  | 'click'
  | 'double_click'
  | 'drag'
  | 'keypress'
  | 'move'
  | 'scroll'
  | 'type'
  | 'screenshot'
  | 'wait'
  | 'navigate'
  | 'extract_a11y'
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'run_command'
  | 'draft_action'
  | 'draft_money'
  | 'plugin_call';

/**
 * Standard Core Verifier Strategy IDs:
 * 1. dom_assertion: verifies expected selector or accessibility text exists
 * 2. url_check: verifies browser URL or domain matches expected pattern
 * 3. file_exists_hash: verifies file existence and cryptographic content hash in workspace
 * 4. test_suite_pass: verifies test command exited 0 with all assertions passed
 * 5. screenshot_check: verifies visual capture evidence was captured and spooled
 * 6. schedule_preview: verifies next run times, timezone, and cron validity
 */
export type CoreVerifierStrategyId =
  | 'dom_assertion'
  | 'url_check'
  | 'file_exists_hash'
  | 'test_suite_pass'
  | 'screenshot_check'
  | 'schedule_preview';

export type VerifierStrategyId = CoreVerifierStrategyId | string;

export interface VerifierExecutionContext {
  toolName: string;
  target: string;
  inputPayload?: unknown;
  outputPayload?: unknown;
  expectedState?: string;
  workspaceRoot?: string;
  domSnapshot?: string;
  currentUrl?: string;
  evidenceHash?: string;
  customParams?: Record<string, unknown>;
}

export interface VerifierExecutionResult {
  status: 'pass' | 'fail' | 'uncertain';
  reason: string;
  evidenceHash: string;
  details?: Record<string, unknown>;
}

export interface VerifierStrategy {
  id: VerifierStrategyId;
  name: string;
  description: string;
  verify: (context: VerifierExecutionContext) => VerifierExecutionResult;
}

/**
 * PolicyPack:
 * A plugin may ship a PolicyPack to add extra deny/approval rules, domain allowlists,
 * and spend caps. Active only while the plugin is installed and enabled; can only tighten core rules.
 */
export interface PolicyPackRule {
  id: string;
  description: string;
  matches: (proposal: ActionProposal) => boolean;
  reason: string;
  targetRisk?: GenericRiskClass;
}

export interface PolicyPack {
  id: string;
  name: string;
  pluginId: string;
  version: string;
  description: string;
  domainAllowlist?: string[];
  readOnlyDomains?: string[];
  spendCapUsd?: number;
  blockedUiPatterns?: string[];
  extraDenyRules?: PolicyPackRule[];
  extraApprovalRules?: PolicyPackRule[];
}

export interface ResolvedElement {
  tagName: string;
  role: string;
  text: string;
  ariaLabel: string;
  href?: string;
  formAction?: string;
  inputType?: string;
  isCredentialField: boolean;
  selector: string;
  coordinates?: { x: number; y: number };
  domain: string;
}

export interface SafetyCheckItem {
  id: string;
  code: string;
  message: string;
  acknowledgedByUser: boolean;
}

export interface ScopedApprovalToken {
  tokenId: string;
  toolOrActionName: string;
  target: string;
  payloadHash: string;
  amount?: number;
  profileId: BrowserProfileId;
  issuedAt: string;
  expiresAt: string;
  issuedBy: 'operator' | 'user';
  scopeReason?: string;
  consumed?: boolean;
  consumedAt?: string;
}

export type UntrustedSourceType =
  | 'web_page'
  | 'pdf'
  | 'plugin_output'
  | 'tool_output'
  | 'imported_skill'
  | 'external_memo';

export interface UntrustedContentWrapper<T = string> {
  readonly isUntrusted: true;
  readonly source: UntrustedSourceType;
  readonly content: T;
  readonly sanitizedContent?: string;
  readonly injectionFindings?: string[];
  readonly wrappedAt: string;
}

export interface ActionProposal {
  id: string;
  kind: ComputerActionType;
  target: string;
  risk: RiskLevel;
  source: ActionSource;
  missionId: string;
  profileId: BrowserProfileId;
  coordinates?: { x: number; y: number };
  typedText?: string;
  resolvedElement?: ResolvedElement;
  pendingSafetyChecks?: SafetyCheckItem[];
  amount?: number;
  currency?: string;
  pluginId?: string;
  toolName?: string;
  untrustedContext?: string;
  callerId?: string;
  approvalToken?: ScopedApprovalToken;
  isSimulated?: boolean;
}

export type PolicyDecisionStatus =
  | 'ALLOW'
  | 'DENY'
  | 'REQUIRE_APPROVAL'
  | 'SUSPEND_TAKEOVER';

export interface PolicyDecision {
  proposalId: string;
  allowed: boolean;
  status: PolicyDecisionStatus;
  reason: string;
  matchedRule: string;
  redactedText?: string;
  flaggedInjections: string[];
  evaluatedAt: string;
  errorCode?: string;
  consumedApprovalTokenId?: string;
}

export type LedgerActor = 'user' | 'agent' | 'verifier' | 'guard' | 'sleep_cycle' | 'operator';
export type TrustLevel =
  | 'user_stated'
  | 'verified_by_evidence'
  | 'observed_untrusted'
  | 'model_inferred';

/**
 * Shared Typed Execution & Verification Truth States (PROMPT 1)
 * Used canonically across PC Operator, mission runtime, browser, skills,
 * plugins, connectors, and scheduler.
 */
export type ExecutionTruthState =
  | 'EXECUTED'
  | 'SIMULATED'
  | 'UNSUPPORTED'
  | 'FAILED'
  | 'UNCERTAIN'
  | 'BLOCKED'
  | 'WAITING_FOR_APPROVAL'
  | 'NOT_CONFIGURED';

export type VerificationTruthState =
  | 'VERIFIED'
  | 'SIMULATED'
  | 'UNSUPPORTED'
  | 'FAILED'
  | 'UNCERTAIN'
  | 'BLOCKED'
  | 'WAITING_FOR_APPROVAL'
  | 'NOT_CONFIGURED';

export type CanonicalSubsystem =
  | 'pc_operator'
  | 'mission_runtime'
  | 'browser'
  | 'skills'
  | 'plugins'
  | 'connectors'
  | 'scheduler';

export type TruthfulUiStatusLabel =
  | 'Verified'
  | 'Simulated (Preview)'
  | 'Needs your approval'
  | 'Blocked for safety'
  | 'Uncertain (Unverified)'
  | 'Unsupported'
  | 'Not configured'
  | 'Failed';

export interface CanonicalVerificationEvidence {
  verifierId: string;
  independentTargetRead: boolean;
  criteriaMet: boolean;
  evidenceHash: string;
  summary: string;
  observedState?: Record<string, unknown>;
}

export interface CanonicalExecutionResult<TOutput = Record<string, unknown>> {
  subsystem: CanonicalSubsystem;
  toolOrActionName: string;
  executionState: ExecutionTruthState;
  verificationState: VerificationTruthState;
  ok: boolean;
  isRealExecution: boolean;
  isSimulated: boolean;
  uiStatusLabel: TruthfulUiStatusLabel;
  output: TOutput;
  verificationEvidence: CanonicalVerificationEvidence;
  errorCode?:
    | 'UNSUPPORTED_TOOL'
    | 'UNKNOWN_SKILL'
    | 'UNKNOWN_PLUGIN'
    | 'MISSING_VERIFIER'
    | 'MISSING_EVIDENCE'
    | 'EXECUTION_WITHOUT_SIDE_EFFECT'
    | 'BLOCKED_BY_GUARD'
    | 'WAITING_FOR_APPROVAL'
    | 'NOT_CONFIGURED'
    | 'CANCELLED'
    | 'SIMULATED_CANNOT_PROMOTE_TO_REAL'
    | string;
  errorMessage?: string;
}

/**
 * Maps canonical execution/verification states to truthful UI labels.
 * Never returns "Done", "Executed", "Connected", or "Verified" for simulated,
 * uncertain, unsupported, unconfigured, failed, or blocked operations.
 */
export function formatTruthfulUiStatusLabel(params: {
  executionState: ExecutionTruthState;
  verificationState: VerificationTruthState;
  isSimulated?: boolean;
}): TruthfulUiStatusLabel {
  if (
    params.executionState === 'WAITING_FOR_APPROVAL' ||
    params.verificationState === 'WAITING_FOR_APPROVAL'
  ) {
    return 'Needs your approval';
  }
  if (params.executionState === 'BLOCKED' || params.verificationState === 'BLOCKED') {
    return 'Blocked for safety';
  }
  if (params.executionState === 'UNSUPPORTED' || params.verificationState === 'UNSUPPORTED') {
    return 'Unsupported';
  }
  if (
    params.executionState === 'NOT_CONFIGURED' ||
    params.verificationState === 'NOT_CONFIGURED'
  ) {
    return 'Not configured';
  }
  if (params.executionState === 'FAILED' || params.verificationState === 'FAILED') {
    return 'Failed';
  }
  if (params.executionState === 'UNCERTAIN' || params.verificationState === 'UNCERTAIN') {
    return 'Uncertain (Unverified)';
  }
  if (
    params.isSimulated ||
    params.executionState === 'SIMULATED' ||
    params.verificationState === 'SIMULATED'
  ) {
    return 'Simulated (Preview)';
  }
  if (
    params.executionState === 'EXECUTED' &&
    params.verificationState === 'VERIFIED' &&
    !params.isSimulated
  ) {
    return 'Verified';
  }
  return 'Uncertain (Unverified)';
}

/**
 * Prevents any SIMULATED or UNCERTAIN record from being promoted to REAL
 * in UI badges, ledgers, standing rules, reports, or analytics.
 */
export function canPromoteRecordToReal(params: {
  executionState?: ExecutionTruthState;
  verificationState?: VerificationTruthState;
  isSimulated?: boolean;
}): { allowed: boolean; errorCode?: 'SIMULATED_CANNOT_PROMOTE_TO_REAL'; reason: string } {
  if (
    params.isSimulated ||
    params.executionState === 'SIMULATED' ||
    params.verificationState === 'SIMULATED'
  ) {
    return {
      allowed: false,
      errorCode: 'SIMULATED_CANNOT_PROMOTE_TO_REAL',
      reason:
        'Simulated/demo records are isolated for demos and tests only and cannot be promoted to REAL in UI badges, ledgers, reports, or analytics.',
    };
  }
  if (params.executionState !== 'EXECUTED' || params.verificationState !== 'VERIFIED') {
    return {
      allowed: false,
      errorCode: 'SIMULATED_CANNOT_PROMOTE_TO_REAL',
      reason: `Cannot promote non-verified record (executionState=${params.executionState ?? 'UNKNOWN'}, verificationState=${params.verificationState ?? 'UNKNOWN'}) to REAL.`,
    };
  }
  return {
    allowed: true,
    reason: 'Record has real execution and independent verification evidence.',
  };
}

export interface LedgerEvent {
  id: string;
  index: number;
  timestamp: string;
  actor: LedgerActor;
  type:
    | 'mission_started'
    | 'action_allowed'
    | 'action_blocked'
    | 'approval_requested'
    | 'approval_granted'
    | 'approval_denied'
    | 'verification_passed'
    | 'verification_failed'
    | 'verifier_passed'
    | 'verifier_failed'
    | 'memory_proposed'
    | 'memory_promoted'
    | 'memory_created'
    | 'memory_edited'
    | 'memory_deleted'
    | 'tool_executed'
    | 'user_correction'
    | 'user_deleted'
    | 'plugin_permission_grant'
    | 'plugin_blocked'
    | 'credential_takeover'
    | 'sleep_consolidation'
    | 'vault_key_event'
    | 'first_run_briefing_approved'
    | string;
  summary: string;
  contentRef: string;
  evidenceHash: string;
  previousHash: string;
  ownHash: string;
  entryHash?: string;
  prevHash?: string;
  contentDeleted?: boolean;
  payload?: string;
  trustLevel: TrustLevel;
  executionState?: ExecutionTruthState;
  verificationState?: VerificationTruthState;
  isSimulated?: boolean;
  missionId: string;
  orgId: string;
  workspaceId: string;
  quarantined: boolean;
}

export interface EncryptedContentSlot {
  contentRef: string;
  cipherText: string;
  ivHex?: string;
  authTagHex?: string;
  ciphertextHex?: string;
  algorithm?: 'aes-256-gcm';
  byteLength: number;
  deleted: boolean;
  deletedAt?: string;
  mimeType: 'application/json' | 'text/plain' | 'image/ viewport-quantized';
}

export interface VerificationResult {
  id: string;
  stepId: string;
  status: 'pass' | 'fail' | 'uncertain';
  reason: string;
  verifierModel: string;
  effortLevel: 'low' | 'medium' | 'high';
  deterministicChecks: {
    domAssertionPassed: boolean;
    urlMatched: boolean;
    numbersReconciled: boolean;
    injectionFree: boolean;
  };
  evidenceHash: string;
  timestamp: string;
}

export type MissionState =
  | 'CREATED'
  | 'PLANNING'
  | 'RUNNING'
  | 'WAITING_FOR_USER'
  | 'WAITING_FOR_EXTERNAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface MissionStep {
  id: string;
  index: number;
  title: string;
  intent: string;
  risk: RiskLevel;
  actionType: ComputerActionType;
  target: string;
  expectedState: string;
  domSelectorCheck?: string;
  status: 'pending' | 'running' | 'verified' | 'blocked' | 'waiting_approval' | 'failed';
  retries: number;
  maxRetries: number;
  reasoningSummary: string;
  verification?: VerificationResult;
  guardDecision?: PolicyDecision;
}

export interface MissionRecord {
  id: string;
  objective: string;
  successCriteria: string[];
  state: MissionState;
  profileId: BrowserProfileId;
  personalityId: PersonalityId;
  createdAt: string;
  updatedAt: string;
  steps: MissionStep[];
  tokensUsed: {
    spark13: number;
    wonder10: number;
    voiceTranscribe: number;
    a11yTokensSaved: number;
  };
  estimatedCostUsd: number;
  checkpoints: string[];
  resultSummary?: string;
}

export type MorrowState =
  | 'resting'
  | 'waking'
  | 'attentive'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'verifying'
  | 'asking_approval'
  | 'unsure'
  | 'recovering'
  | 'speaking'
  | 'done_with_proof';

export type PersonalityId = 'morrow' | 'architect' | 'sage' | 'sentinel' | 'muse';

export interface PersonalityConfig {
  id: PersonalityId;
  name: string;
  version: string;
  tone: string;
  initiative: 'conservative' | 'balanced' | 'proactive';
  format: 'concise_proof' | 'structured_audit' | 'explanatory';
  accentColor: string;
  description: string;
}

export interface TalkDecisionLog {
  id: string;
  timestamp: string;
  trigger:
    | 'approval_needed'
    | 'check_failed'
    | 'task_finished_proof'
    | 'user_condition_fired'
    | 'routine_progress'
    | 'focus_mode_suppressed'
    | 'rate_limited';
  decision: 'SPEAK' | 'STAY_QUIET';
  urgency: 'glow' | 'chime' | 'voice' | 'phone';
  message?: string;
  reason: string;
}

export interface RecordedSkillStep {
  id: string;
  intent: string;
  risk: RiskLevel;
  actionHint: {
    type: ComputerActionType;
    role: string;
    accessibleName: string;
    selectorCandidates: string[];
    coordinates?: { x: number; y: number };
  };
  expectedState: string;
  domCheck?: string;
  variables: string[];
  retryCount: number;
}

export interface CompiledSkill {
  id: string;
  name: string;
  version: number;
  profileId: BrowserProfileId;
  createdAt: string;
  narrationTranscript: string;
  steps: RecordedSkillStep[];
  baselineSuccessRate: number;
}

export interface PluginToolSchema {
  name: string;
  description: string;
  risk: GenericRiskClass | RiskLevel;
  verifier?: VerifierStrategyId;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  loadedInContext: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  publisher: string;
  compatibility: string;
  description: string;
  category?: string;
  processIsolation: 'restricted_worker';
  capabilityToken: string;
  status: 'active' | 'disabled' | 'blocked_by_guard';
  permissions: {
    domains: string[];
    folders: string[];
    canPrepareMoneyDrafts?: boolean;
    scopes?: string[];
  };
  resourceNeeds: {
    maxMemoryMb: number;
    timeoutMs: number;
  };
  policyPack?: PolicyPack;
  verifiers?: VerifierStrategy[];
  tools: PluginToolSchema[];
}

/**
 * UniversalFinancialRecord and MoneyActionDraft (Provided by L3xi Plugin)
 */
export interface UniversalFinancialRecord {
  id: string;
  date: string; // ISO YYYY-MM-DD
  rawDate: string;
  dateAmbiguous: boolean;
  amount: number; // exact decimal
  rawAmount: string;
  currency: 'GHS' | 'USD' | 'EUR' | 'INR';
  direction: 'credit' | 'debit';
  counterparty: string;
  description: string;
  category: 'Income' | 'Housing & Bills' | 'Inventory & Supplies' | 'Transfer & Fees' | 'Software & Admin' | 'Uncategorized';
  balanceAfter?: number;
  source: string;
  confidence: number;
  isDuplicate?: boolean;
  isRecurring?: boolean;
  isFee?: boolean;
  injectedMemoAlert?: string;
}

export interface MoneyActionDraft {
  id: string;
  createdAt: string;
  amount: number;
  currency: 'GHS' | 'USD' | 'EUR' | 'INR';
  date: string;
  recurrence: 'once' | 'weekly' | 'monthly';
  destination: string;
  reference: string;
  status: 'DRAFT_ONLY' | 'APPROVED_SIMULATION_EXECUTED' | 'REJECTED';
  environmentLabel: 'SIMULATION' | 'READ_ONLY_REAL_ACCOUNT';
}

export const VALID_RISK_CLASSES: GenericRiskClass[] = [
  'read',
  'write',
  'destructive',
  'external_send',
  'credential',
  'spend',
  'system',
];

/**
 * Lightweight, zero-allocation runtime validator for ActionProposal & PluginManifest boundaries
 */
export function validateActionProposal(input: unknown): {
  success: boolean;
  data?: ActionProposal;
  error?: string;
} {
  if (!input || typeof input !== 'object') {
    return { success: false, error: 'ActionProposal must be a non-null object' };
  }
  const obj = input as Record<string, unknown>;
  const validRisks: RiskLevel[] = [
    'read',
    'write',
    'scoped_write',
    'scoped write',
    'destructive',
    'external_send',
    'external send',
    'credential',
    'spend',
    'money',
    'spend/money',
    'system',
    'system_privilege',
    'system/privilege',
    'software_installation',
    'software installation',
    'sensitive',
  ];
  const validSources: ActionSource[] = [
    'user',
    'skill',
    'model',
    'plugin',
    'scheduler',
    'pc_operator',
    'system',
  ];

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    return { success: false, error: 'Invalid or missing ActionProposal.id' };
  }
  if (typeof obj.kind !== 'string' || obj.kind.length === 0) {
    return { success: false, error: 'Invalid or missing ActionProposal.kind' };
  }
  if (typeof obj.target !== 'string' || obj.target.length === 0) {
    return { success: false, error: 'Invalid or missing ActionProposal.target' };
  }
  if (!validRisks.includes(obj.risk as RiskLevel)) {
    return { success: false, error: `Invalid ActionProposal.risk: ${String(obj.risk)}` };
  }
  if (!validSources.includes(obj.source as ActionSource)) {
    return { success: false, error: `Invalid ActionProposal.source: ${String(obj.source)}` };
  }
  if (typeof obj.missionId !== 'string' || obj.missionId.length === 0) {
    return { success: false, error: 'Invalid or missing ActionProposal.missionId' };
  }
  return { success: true, data: obj as unknown as ActionProposal };
}

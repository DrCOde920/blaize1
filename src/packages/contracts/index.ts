/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize Contracts Package (packages/contracts)
 * Zero-allocation, memory-effective schema validation & typed boundary contracts
 * for IPC, Actions, PolicyGuard, MemoryLedger, Skills, Plugins, and L3xi records.
 */

export type RiskLevel = 'read' | 'write' | 'sensitive' | 'money';
export type ActionSource = 'user' | 'skill' | 'model' | 'plugin';
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
  | 'draft_money'
  | 'plugin_call';

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
}

export type LedgerActor = 'user' | 'agent' | 'verifier' | 'guard' | 'sleep_cycle';
export type TrustLevel =
  | 'user_stated'
  | 'verified_by_evidence'
  | 'observed_untrusted'
  | 'model_inferred';

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
    | 'memory_proposed'
    | 'memory_promoted'
    | 'user_correction'
    | 'user_deleted'
    | 'plugin_permission_grant'
    | 'plugin_blocked'
    | 'credential_takeover'
    | 'sleep_consolidation';
  summary: string;
  contentRef: string;
  evidenceHash: string;
  previousHash: string;
  ownHash: string;
  trustLevel: TrustLevel;
  missionId: string;
  orgId: string;
  workspaceId: string;
  quarantined: boolean;
}

export interface EncryptedContentSlot {
  contentRef: string;
  cipherText: string;
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
  risk: RiskLevel;
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
  processIsolation: 'restricted_worker';
  capabilityToken: string;
  status: 'active' | 'disabled' | 'blocked_by_guard';
  permissions: {
    domains: string[];
    folders: string[];
    canPrepareMoneyDrafts: boolean;
  };
  resourceNeeds: {
    maxMemoryMb: number;
    timeoutMs: number;
  };
  tools: PluginToolSchema[];
}

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
  const validRisks: RiskLevel[] = ['read', 'write', 'sensitive', 'money'];
  const validSources: ActionSource[] = ['user', 'skill', 'model', 'plugin'];

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

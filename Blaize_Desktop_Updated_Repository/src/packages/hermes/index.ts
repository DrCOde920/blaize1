/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-Run Briefing, Universal App Control Ladder & Hermes Top-Agent Capabilities
 * (`src/packages/hermes/index.ts`)
 */

export type RoleTemplateId = 'home' | 'work' | 'study' | 'custom';

export interface RoleTemplateSpec {
  id: RoleTemplateId;
  label: string;
  tagline: string;
  defaultJobDescription: string;
  defaultOffLimits: string;
  suggestedPlugins: string[];
  suggestedRules: string[];
}

export const ROLE_TEMPLATES: RoleTemplateSpec[] = [
  {
    id: 'home',
    label: 'Home assistant',
    tagline: 'Organize personal files, bills, schedules, and household tasks.',
    defaultJobDescription:
      'Keep my downloads and household documents organized, summarize weekly bills, and prepare reminders on this PC.',
    defaultOffLimits:
      'Never send external payments, delete personal photos, or read password managers.',
    suggestedPlugins: ['plugin-files', 'plugin-chronos-scheduler', 'plugin-l3xi-finance'],
    suggestedRules: [
      'Always ask before deleting any file or folder.',
      'Never execute money transfers; draft only for review.',
    ],
  },
  {
    id: 'work',
    label: 'Work assistant',
    tagline: 'Prepare engineering digests, code checks, and meeting notes.',
    defaultJobDescription:
      'Summarize project repositories, run test suites before patches, and compile weekly status reports on my work laptop.',
    defaultOffLimits:
      'Never push to production branches, modify credentials, or message external clients without approval.',
    suggestedPlugins: ['plugin-code-helper', 'plugin-git-companion', 'plugin-files'],
    suggestedRules: [
      'Require test_suite_pass verification before applying code patches.',
      'Ask approval before sending external messages or emails.',
    ],
  },
  {
    id: 'study',
    label: 'Study helper',
    tagline: 'Verify citations, organize research notes, and build study guides.',
    defaultJobDescription:
      'Search allowlisted documentation, verify citations, and organize study markdown notes in my workspace.',
    defaultOffLimits:
      'Never fabricate citations or overwrite my original essay drafts without creating a backup.',
    suggestedPlugins: ['plugin-ai-browser', 'plugin-files'],
    suggestedRules: [
      'Every research summary must include verified source URLs.',
      'Keep original drafts read-only when generating study guides.',
    ],
  },
  {
    id: 'custom',
    label: 'Custom role',
    tagline: 'Tailor your own job description, devices, and boundaries.',
    defaultJobDescription:
      'Assist me with daily research, file organization, and verified workflow automation.',
    defaultOffLimits:
      'Never access credential vaults, elevated system windows, or external send channels without approval.',
    suggestedPlugins: ['plugin-files', 'plugin-ai-browser'],
    suggestedRules: ['Ask before any write, destructive, or external send action.'],
  },
];

export interface FirstRunBriefingInput {
  companionName: string;
  selectedTemplates: RoleTemplateId[];
  jobDescription: string;
  allowedDevices: string[];
  offLimits: string;
  userName?: string;
}

export interface GeneratedBriefingArtifacts {
  companionName: string;
  roleSectionMarkdown: string;
  userMarkdown: string;
  spokenSummaryCard: string;
  suggestedRules: string[];
  suggestedPlugins: string[];
}

export function generateBriefingArtifacts(
  input: FirstRunBriefingInput
): GeneratedBriefingArtifacts {
  const templates = ROLE_TEMPLATES.filter((t) => input.selectedTemplates.includes(t.id));
  const chosenTemplates = templates.length > 0 ? templates : [ROLE_TEMPLATES[1]];
  const templateNames = chosenTemplates.map((t) => t.label).join(' + ');
  const name = input.companionName.trim() || 'Morrow';
  const job =
    input.jobDescription.trim() ||
    chosenTemplates.map((t) => t.defaultJobDescription).join(' ');
  const offLimits =
    input.offLimits.trim() || chosenTemplates.map((t) => t.defaultOffLimits).join(' ');
  const devices =
    input.allowedDevices.length > 0 ? input.allowedDevices.join(', ') : 'This PC (Local)';

  const roleSectionMarkdown = [
    `## Standing Role (${templateNames})`,
    `- **Companion Name:** ${name}`,
    `- **Primary Mission:** ${job}`,
    `- **Authorized Devices:** ${devices}`,
    `- **Strictly Off Limits:** ${offLimits}`,
  ].join('\n');

  const userMarkdown = [
    `# USER.md — What ${name} Knows About You`,
    `- **Preferred Role Focus:** ${templateNames}`,
    `- **Primary Workflow Goal:** ${job}`,
    `- **Authorized Devices:** ${devices}`,
    `- **Hard Boundaries (Off Limits):** ${offLimits}`,
  ].join('\n');

  const spokenSummaryCard = `Here is what I understand my job to be: As ${name}, I will act as your ${templateNames.toLowerCase()} on ${devices}. My focus is to ${job.replace(/\.$/, '')}. I will strictly treat the following as off limits: ${offLimits.replace(/\.$/, '')}.`;

  const suggestedRules = Array.from(
    new Set([
      ...chosenTemplates.flatMap((t) => t.suggestedRules),
      `Enforce off-limits boundary: ${offLimits}`,
    ])
  );
  const suggestedPlugins = Array.from(
    new Set(chosenTemplates.flatMap((t) => t.suggestedPlugins))
  );

  return {
    companionName: name,
    roleSectionMarkdown,
    userMarkdown,
    spokenSummaryCard,
    suggestedRules,
    suggestedPlugins,
  };
}

// ============================================================================
// SECTION 5: ANY PC, ANY APP (HONEST LADDER & DEVICES)
// ============================================================================

export type ControlLadderTier =
  | 'native_tools' // 1) Plugins, MCP servers, CLI, documented APIs
  | 'os_accessibility' // 2) OS Accessibility APIs (UIA / AXUIElement / AT-SPI)
  | 'vision_input_fallback' // 3) Vision + Input (screenshots & computer tool)
  | 'blocked_unsupported'; // Blocked by elevated window, secure input, DRM, or anti-cheat

export type AppSupportStatus = 'Ready' | 'Limited' | 'Not supported';
export type AppWorkflowStage = 'explore_read_only' | 'teach' | 'app_skill';

export interface ControllableAppDescriptor {
  id: string;
  name: string;
  category: string;
  hasNativePluginOrMcp: boolean;
  hasDocumentedCliOrApi: boolean;
  supportsOsAccessibility: boolean;
  isElevatedAdminWindow?: boolean;
  isSecureInputOrKeychain?: boolean;
  hasDrmProtection?: boolean;
  hasKernelAntiCheat?: boolean;
  workflowStage: AppWorkflowStage;
}

export interface AppLadderEvaluation {
  status: AppSupportStatus;
  selectedTier: ControlLadderTier;
  tierLabel: string;
  reason: string;
  canAutomate: boolean;
}

/**
 * App control ladder, tried in strict order per app:
 * 1) native_tools (plugins, MCP servers, CLI, documented APIs)
 * 2) os_accessibility (operating system accessibility APIs)
 * 3) vision_input_fallback (screenshots and computer tool)
 * Honest blocking for elevated windows, secure input, DRM, and anti-cheat.
 */
export function selectAppControlStrategy(app: ControllableAppDescriptor): AppLadderEvaluation {
  if (app.isElevatedAdminWindow) {
    return {
      status: 'Not supported',
      selectedTier: 'blocked_unsupported',
      tierLabel: 'Blocked (Elevated Window)',
      reason: 'Elevated Administrator / UAC windows block user-space automation for OS safety.',
      canAutomate: false,
    };
  }
  if (app.isSecureInputOrKeychain) {
    return {
      status: 'Not supported',
      selectedTier: 'blocked_unsupported',
      tierLabel: 'Blocked (Secure Input)',
      reason: 'Password managers and OS Secure Input lock out screen capture and synthetic keys.',
      canAutomate: false,
    };
  }
  if (app.hasDrmProtection) {
    return {
      status: 'Not supported',
      selectedTier: 'blocked_unsupported',
      tierLabel: 'Blocked (DRM Surface)',
      reason: 'Hardware DRM video surfaces black out screen capture and block synthetic input.',
      canAutomate: false,
    };
  }
  if (app.hasKernelAntiCheat) {
    return {
      status: 'Not supported',
      selectedTier: 'blocked_unsupported',
      tierLabel: 'Blocked (Anti-Cheat)',
      reason: 'Protected game anti-cheat drivers reject synthetic input events.',
      canAutomate: false,
    };
  }

  // Ladder Step 1: Native tools (plugins, MCP servers, CLI, documented APIs)
  if (app.hasNativePluginOrMcp || app.hasDocumentedCliOrApi) {
    return {
      status: 'Ready',
      selectedTier: 'native_tools',
      tierLabel: '1. Native API / MCP / CLI',
      reason: 'Uses structured native plugin, MCP server, or CLI with deterministic verification.',
      canAutomate: true,
    };
  }

  // Ladder Step 2: OS Accessibility APIs
  if (app.supportsOsAccessibility) {
    return {
      status: 'Ready',
      selectedTier: 'os_accessibility',
      tierLabel: '2. OS Accessibility Tree',
      reason: 'Uses semantic OS accessibility tree roles and labels (simulated on Desktop Stage).',
      canAutomate: true,
    };
  }

  // Ladder Step 3: Vision + Input Universal Fallback
  return {
    status: 'Limited',
    selectedTier: 'vision_input_fallback',
    tierLabel: '3. Vision + Input Fallback',
    reason: 'No native API or accessibility tree; uses downscaled screenshots and coordinate input.',
    canAutomate: true,
  };
}

export function advanceAppProgressionStage(current: AppWorkflowStage): AppWorkflowStage {
  if (current === 'explore_read_only') return 'teach';
  if (current === 'teach') return 'app_skill';
  return 'explore_read_only';
}

export const INITIAL_CONTROLLABLE_APPS: ControllableAppDescriptor[] = [
  {
    id: 'app-vscode-workspace',
    name: 'Workspace Code & Files',
    category: 'Developer Tools',
    hasNativePluginOrMcp: true,
    hasDocumentedCliOrApi: true,
    supportsOsAccessibility: true,
    workflowStage: 'app_skill',
  },
  {
    id: 'app-spreadsheet-ledger',
    name: 'Desktop Spreadsheet & Notes',
    category: 'Productivity',
    hasNativePluginOrMcp: false,
    hasDocumentedCliOrApi: false,
    supportsOsAccessibility: true,
    workflowStage: 'teach',
  },
  {
    id: 'app-legacy-canvas-erp',
    name: 'Legacy Custom Canvas Form',
    category: 'Custom UI',
    hasNativePluginOrMcp: false,
    hasDocumentedCliOrApi: false,
    supportsOsAccessibility: false,
    workflowStage: 'explore_read_only',
  },
  {
    id: 'app-1password-keychain',
    name: 'OS Keychain & Password Vault',
    category: 'Security',
    hasNativePluginOrMcp: false,
    hasDocumentedCliOrApi: false,
    supportsOsAccessibility: false,
    isSecureInputOrKeychain: true,
    workflowStage: 'explore_read_only',
  },
  {
    id: 'app-admin-terminal',
    name: 'Elevated Root / UAC Prompt',
    category: 'System',
    hasNativePluginOrMcp: false,
    hasDocumentedCliOrApi: false,
    supportsOsAccessibility: false,
    isElevatedAdminWindow: true,
    workflowStage: 'explore_read_only',
  },
];

export interface PairedDeviceRecord {
  id: string;
  name: string;
  os: 'Windows 11' | 'macOS Sequoia' | 'Ubuntu Linux';
  isCurrentPc: boolean;
  connectionMode: 'local_host' | 'outbound_e2e_paired_stub';
  status: 'online' | 'paired_stub' | 'revoked';
  requirePerActionApproval: boolean;
  lastSeen: string;
}

export const INITIAL_PAIRED_DEVICES: PairedDeviceRecord[] = [
  {
    id: 'dev-this-pc',
    name: 'This PC (Web Preview Stage)',
    os: 'Ubuntu Linux',
    isCurrentPc: true,
    connectionMode: 'local_host',
    status: 'online',
    requirePerActionApproval: true,
    lastSeen: 'Active now',
  },
  {
    id: 'dev-workstation-mac',
    name: 'Studio MacBook Pro (M4)',
    os: 'macOS Sequoia',
    isCurrentPc: false,
    connectionMode: 'outbound_e2e_paired_stub',
    status: 'paired_stub',
    requirePerActionApproval: true,
    lastSeen: 'Stub (Native shell required)',
  },
];

// ============================================================================
// SECTION 6: HERMES-INSPIRED CAPABILITIES (HOOKS, HARD STOPS, SUBAGENTS, DOCTOR)
// ============================================================================

export type LifecycleHookPoint =
  | 'before_tool'
  | 'after_tool'
  | 'on_error'
  | 'on_approval'
  | 'on_schedule';

export type HookDecisionLevel = 'allow' | 'ask' | 'deny';

const DECISION_SEVERITY: Record<HookDecisionLevel, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

export interface LifecycleHookSpec {
  id: string;
  name: string;
  point: LifecycleHookPoint;
  sourcePluginOrRule: string;
  proposedDecision: HookDecisionLevel;
  reason: string;
  enabled: boolean;
}

export interface HookEvaluationReport {
  initialDecision: HookDecisionLevel;
  finalDecision: HookDecisionLevel;
  appliedHooks: string[];
  rejectedLooseningAttempts: string[];
}

/**
 * Evaluates lifecycle hooks (`before_tool`, `after_tool`, `on_error`, `on_approval`, `on_schedule`).
 * CRITICAL INVARIANT: Hooks may ONLY tighten policy (`allow` -> `ask` -> `deny`).
 * Any hook attempting to loosen a stricter decision (e.g. `deny` -> `allow` or `ask` -> `allow`)
 * is rejected and recorded in `rejectedLooseningAttempts`.
 */
export function evaluateLifecycleHooks(
  point: LifecycleHookPoint,
  initialDecision: HookDecisionLevel,
  hooks: LifecycleHookSpec[]
): HookEvaluationReport {
  let current: HookDecisionLevel = initialDecision;
  const appliedHooks: string[] = [];
  const rejectedLooseningAttempts: string[] = [];

  for (const hook of hooks) {
    if (!hook.enabled || hook.point !== point) continue;
    const currentRank = DECISION_SEVERITY[current];
    const proposedRank = DECISION_SEVERITY[hook.proposedDecision];

    if (proposedRank > currentRank) {
      current = hook.proposedDecision;
      appliedHooks.push(`${hook.name} tightened ${initialDecision} -> ${current} (${hook.reason})`);
    } else if (proposedRank < currentRank) {
      rejectedLooseningAttempts.push(
        `Rejected hook '${hook.name}': attempted to loosen '${current}' to '${hook.proposedDecision}'.`
      );
    } else {
      appliedHooks.push(`${hook.name} confirmed '${current}'`);
    }
  }

  return {
    initialDecision,
    finalDecision: current,
    appliedHooks,
    rejectedLooseningAttempts,
  };
}

export const INITIAL_LIFECYCLE_HOOKS: LifecycleHookSpec[] = [
  {
    id: 'hook-before-write-approval',
    name: 'Require Approval on Workspace Overwrite',
    point: 'before_tool',
    sourcePluginOrRule: 'Core PolicyGuard',
    proposedDecision: 'ask',
    reason: 'Tightens file overwrite from allow to ask.',
    enabled: true,
  },
  {
    id: 'hook-schedule-block-spend',
    name: 'Block Spend in Unattended Schedules',
    point: 'on_schedule',
    sourcePluginOrRule: 'Chronos Safety Pack',
    proposedDecision: 'deny',
    reason: 'Unattended cron runs may never execute spend actions.',
    enabled: true,
  },
];

// Hard Stops for Unattended Runs vs. Warning-Only for Interactive Runs
export interface RunBudgetConfig {
  maxSteps: number;
  maxDurationSeconds: number;
  maxCostUsd: number;
}

export interface RunTelemetrySnapshot {
  mode: 'interactive' | 'unattended';
  stepsExecuted: number;
  elapsedSeconds: number;
  costUsd: number;
}

export interface RunLimitEvaluation {
  action: 'continue' | 'warn_interactive' | 'hard_stop_unattended';
  exceededMetrics: string[];
  message: string;
}

export function evaluateRunLimits(
  snapshot: RunTelemetrySnapshot,
  budget: RunBudgetConfig
): RunLimitEvaluation {
  const exceeded: string[] = [];
  if (snapshot.stepsExecuted > budget.maxSteps) {
    exceeded.push(`steps (${snapshot.stepsExecuted}/${budget.maxSteps})`);
  }
  if (snapshot.elapsedSeconds > budget.maxDurationSeconds) {
    exceeded.push(`time (${snapshot.elapsedSeconds}s/${budget.maxDurationSeconds}s)`);
  }
  if (snapshot.costUsd > budget.maxCostUsd) {
    exceeded.push(`cost ($${snapshot.costUsd.toFixed(2)}/$${budget.maxCostUsd.toFixed(2)})`);
  }

  if (exceeded.length === 0) {
    return {
      action: 'continue',
      exceededMetrics: [],
      message: 'Within step, time, and cost budgets.',
    };
  }

  if (snapshot.mode === 'unattended') {
    return {
      action: 'hard_stop_unattended',
      exceededMetrics: exceeded,
      message: `HARD STOP (Unattended Run): Exceeded ${exceeded.join(', ')}. Execution terminated safely.`,
    };
  }

  return {
    action: 'warn_interactive',
    exceededMetrics: exceeded,
    message: `Interactive Budget Warning: Exceeded ${exceeded.join(', ')}. You can continue or stop.`,
  };
}

// Skills Hub Static Checker (Blocks unrestricted shell or unreviewed install scripts)
export interface SkillImportCheckResult {
  safeToImport: boolean;
  trustLevel: 'verified_safe' | 'needs_permission_review' | 'blocked_unsafe';
  permissionDiff: string[];
  blockedReasons: string[];
}

export function inspectSkillImportSafety(
  skillMarkdown: string,
  existingPermissions: string[] = ['read']
): SkillImportCheckResult {
  const blockedReasons: string[] = [];
  const lower = skillMarkdown.toLowerCase();

  if (/\b(curl\s+[^|]+\|\s*(sh|bash)|wget\s+[^|]+\|\s*(sh|bash)|rm\s+-rf\s+\/|sudo\s+|powershell\s+-enc)\b/i.test(skillMarkdown)) {
    blockedReasons.push(
      'Blocked: Contains unreviewed install script or unrestricted shell execution pattern.'
    );
  }

  const requestedPermissions: string[] = ['read'];
  if (lower.includes('write') || lower.includes('rename') || lower.includes('save')) {
    requestedPermissions.push('write');
  }
  if (lower.includes('delete') || lower.includes('remove')) {
    requestedPermissions.push('destructive');
  }
  if (lower.includes('send') || lower.includes('email') || lower.includes('webhook')) {
    requestedPermissions.push('external_send');
  }

  const permissionDiff = requestedPermissions.filter((p) => !existingPermissions.includes(p));

  if (blockedReasons.length > 0) {
    return {
      safeToImport: false,
      trustLevel: 'blocked_unsafe',
      permissionDiff,
      blockedReasons,
    };
  }

  return {
    safeToImport: true,
    trustLevel: permissionDiff.length > 0 ? 'needs_permission_review' : 'verified_safe',
    permissionDiff,
    blockedReasons: [],
  };
}

// Workspace Profiles (Personal, Work, Sandbox)
export type WorkspaceProfileId = 'personal' | 'work' | 'sandbox';

export interface WorkspaceProfileSpec {
  id: WorkspaceProfileId;
  name: string;
  badge: string;
  description: string;
  executionBackend: 'local_sandbox' | 'docker_container' | 'ssh_remote' | 'cloud_sandbox';
  isolatedMemoryCount: number;
  isolatedSkillCount: number;
  isolatedRuleCount: number;
}

export const WORKSPACE_PROFILES: WorkspaceProfileSpec[] = [
  {
    id: 'personal',
    name: 'Personal',
    badge: 'Default',
    description: 'Personal notes, household automation, and L3xi finance sandbox.',
    executionBackend: 'local_sandbox',
    isolatedMemoryCount: 4,
    isolatedSkillCount: 3,
    isolatedRuleCount: 3,
  },
  {
    id: 'work',
    name: 'Work',
    badge: 'Isolated',
    description: 'Engineering repositories, test suites, and weekly status reports.',
    executionBackend: 'docker_container',
    isolatedMemoryCount: 6,
    isolatedSkillCount: 5,
    isolatedRuleCount: 4,
  },
  {
    id: 'sandbox',
    name: 'Sandbox',
    badge: 'Ephemeral',
    description: 'Zero-persistence quarantine for testing imported skills and plugins.',
    executionBackend: 'local_sandbox',
    isolatedMemoryCount: 0,
    isolatedSkillCount: 1,
    isolatedRuleCount: 5,
  },
];

// Blaize Doctor Diagnostics
export interface DoctorCheckItem {
  id: string;
  title: string;
  category: 'vault' | 'permissions' | 'plugins' | 'storage' | 'context';
  status: 'healthy' | 'warning' | 'action_needed';
  summary: string;
  fixLabel?: string;
}

export const INITIAL_DOCTOR_CHECKS: DoctorCheckItem[] = [
  {
    id: 'doc-vault-backend',
    title: 'Key Vault & Passphrase Encryption',
    category: 'vault',
    status: 'healthy',
    summary: 'AES-256-GCM passphrase wrap active; zero plaintext keys in browser bundle.',
  },
  {
    id: 'doc-idle-lock',
    title: 'Automatic Vault Idle Lock',
    category: 'vault',
    status: 'warning',
    summary: 'Idle lock is set to 15 minutes; 5 minutes is recommended.',
    fixLabel: 'Tighten to 5m',
  },
  {
    id: 'doc-plugin-sandbox',
    title: 'Plugin Capability Handles',
    category: 'plugins',
    status: 'healthy',
    summary: 'All plugins use host-resolved capability handles and tightening-only policy packs.',
  },
  {
    id: 'doc-quarantine-queue',
    title: 'Imported Agent Skills Quarantine',
    category: 'permissions',
    status: 'warning',
    summary: '1 imported skill in quarantine awaiting static permission diff review.',
    fixLabel: 'Review & Resolve',
  },
  {
    id: 'doc-context-cache',
    title: 'Prompt Cache & Context Compression',
    category: 'context',
    status: 'healthy',
    summary: 'Slot #1 SOUL.md cached (94% hit rate); historical turns compressed cleanly.',
  },
];

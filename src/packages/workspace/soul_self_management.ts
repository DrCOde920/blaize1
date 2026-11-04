/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 9 — Safe Non-Sensitive Morrow Soul / Personality Self-Management API
 *
 * - Allowlisted non-sensitive presentation fields:
 *   1. tone
 *   2. concision
 *   3. humour
 *   4. voiceStyle
 *   5. animationPreference
 *   6. initiativeLevel
 *   7. notificationStyle
 * - Converts user-requested presentation edits into a versioned diff and applies
 *   automatically when the prompt clearly requested the change, preserving the
 *   prior version and one-click rollback.
 * - Never exposes or modifies: user rules (RULES), standing instructions,
 *   Trust Kernel code, security settings, identity/authentication, privacy,
 *   credentials/vault, OS permissions, domain allowlists, spend limits, or
 *   approval/audit rules.
 * - When a request mixes a normal Soul presentation edit with protected settings,
 *   applies ONLY the safe non-sensitive part and explains the protected part
 *   cannot be self-modified.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_SOUL_DOCUMENT,
  SOUL_PRESET_TEMPLATES,
  SoulDocument,
  SoulVoiceCadence,
  parseAndValidateSoulDocument,
} from './index';
import type { ToolRegistration } from '../runtime/index';

// ============================================================================
// 1. ALLOWLISTED NON-SENSITIVE PRESENTATION FIELDS & SCHEMAS
// ============================================================================

export const ALLOWLISTED_SOUL_PRESENTATION_FIELD_NAMES = [
  'tone',
  'concision',
  'humour',
  'voiceStyle',
  'animationPreference',
  'initiativeLevel',
  'notificationStyle',
] as const;

export type AllowlistedSoulPresentationField =
  (typeof ALLOWLISTED_SOUL_PRESENTATION_FIELD_NAMES)[number];

export const SOUL_TONE_VALUES = [
  'warm_accountable',
  'direct_pragmatic',
  'formal_analytical',
  'calm_supportive',
  'enthusiastic_creative',
] as const;
export type SoulToneValue = (typeof SOUL_TONE_VALUES)[number];

export const SOUL_CONCISION_VALUES = [
  'terse',
  'concise',
  'balanced',
  'detailed',
] as const;
export type SoulConcisionValue = (typeof SOUL_CONCISION_VALUES)[number];

export const SOUL_HUMOUR_VALUES = [
  'none',
  'dry_understated',
  'warm_light',
  'playful',
] as const;
export type SoulHumourValue = (typeof SOUL_HUMOUR_VALUES)[number];

export const SOUL_VOICE_STYLE_VALUES = [
  'morrow_warm_accountable',
  'hermes_direct_pragmatic',
  'strict_security_auditor',
  'socratic_architect',
] as const;
export type SoulVoiceStyleValue = (typeof SOUL_VOICE_STYLE_VALUES)[number];

export const SOUL_ANIMATION_PREFERENCE_VALUES = [
  'full_expressive',
  'calm_minimal',
  'static_focus',
  'sleep_zero_fps',
] as const;
export type SoulAnimationPreferenceValue = (typeof SOUL_ANIMATION_PREFERENCE_VALUES)[number];

export const SOUL_INITIATIVE_LEVEL_VALUES = [
  'quiet_on_demand',
  'balanced_collaborative',
  'proactive_suggestions',
] as const;
export type SoulInitiativeLevelValue = (typeof SOUL_INITIATIVE_LEVEL_VALUES)[number];

export const SOUL_NOTIFICATION_STYLE_VALUES = [
  'silent_badge_only',
  'calm_digest',
  'immediate_toast',
  'voice_and_banner',
] as const;
export type SoulNotificationStyleValue = (typeof SOUL_NOTIFICATION_STYLE_VALUES)[number];

export const SoulPresentationSettingsSchema = z
  .object({
    tone: z.enum(SOUL_TONE_VALUES),
    concision: z.enum(SOUL_CONCISION_VALUES),
    humour: z.enum(SOUL_HUMOUR_VALUES),
    voiceStyle: z.enum(SOUL_VOICE_STYLE_VALUES),
    animationPreference: z.enum(SOUL_ANIMATION_PREFERENCE_VALUES),
    initiativeLevel: z.enum(SOUL_INITIATIVE_LEVEL_VALUES),
    notificationStyle: z.enum(SOUL_NOTIFICATION_STYLE_VALUES),
  })
  .strict();

export type SoulPresentationSettings = z.infer<typeof SoulPresentationSettingsSchema>;

export const SoulPresentationPatchSchema = SoulPresentationSettingsSchema.partial();
export type SoulPresentationPatch = z.infer<typeof SoulPresentationPatchSchema>;

export const DEFAULT_SOUL_PRESENTATION_SETTINGS: SoulPresentationSettings = {
  tone: 'warm_accountable',
  concision: 'concise',
  humour: 'warm_light',
  voiceStyle: 'morrow_warm_accountable',
  animationPreference: 'full_expressive',
  initiativeLevel: 'balanced_collaborative',
  notificationStyle: 'calm_digest',
};

// ============================================================================
// 2. PROTECTED DOMAINS THAT CANNOT BE EXPOSED OR SELF-MODIFIED
// ============================================================================

export const PROTECTED_SOUL_AND_SYSTEM_DOMAINS = [
  'user_rules',
  'standing_instructions',
  'trust_kernel_code',
  'security_settings',
  'identity_authentication',
  'privacy_settings',
  'credentials_vault',
  'os_permissions',
  'domain_allowlists',
  'spend_limits',
  'approval_rules',
] as const;

export type ProtectedSoulOrSystemDomain = (typeof PROTECTED_SOUL_AND_SYSTEM_DOMAINS)[number];

export interface RejectedProtectedEditAttempt {
  domain: ProtectedSoulOrSystemDomain;
  matchedClause: string;
  reason: string;
}

const PROTECTED_DOMAIN_DETECTORS: Array<{
  domain: ProtectedSoulOrSystemDomain;
  regex: RegExp;
  reason: string;
}> = [
  {
    domain: 'user_rules',
    regex: /\b(user\s*rules?|standing\s*rules?|modify\s+rules|delete\s+rules|override\s+rules|rules\s+table)\b/i,
    reason: 'User rules (RULES) are user-owned control-plane constraints and cannot be self-modified by Morrow.',
  },
  {
    domain: 'standing_instructions',
    regex: /\b(standing\s+instructions?|stance\s*&\s*uncertainty|never\s+fabricate\s+rule)\b/i,
    reason: 'Standing instructions and safety stance boundaries cannot be modified via the presentation API.',
  },
  {
    domain: 'trust_kernel_code',
    regex: /\b(trust\s*kernel|packages\/trust|verifier\s*engine|safety[-_\s]*floor)\b/i,
    reason: 'Trust Kernel code and safety-floor configurations are immutable to agent self-management.',
  },
  {
    domain: 'security_settings',
    regex: /\b(security\s*settings?|policy\s*guard|policy\s*engine|disable\s+sandbox|bypass\s+security|ssrf\s+guard)\b/i,
    reason: 'Security settings and PolicyEngine rules are protected control-plane assets.',
  },
  {
    domain: 'identity_authentication',
    regex: /\b(identity\s*settings?|auth\s*token|authentication|oauth\s*client|session\s*secret|login\s*token)\b/i,
    reason: 'Identity and authentication configuration cannot be exposed or modified by presentation tools.',
  },
  {
    domain: 'privacy_settings',
    regex: /\b(privacy\s*settings?|disable\s+redaction|telemetry\s*export|right[-_\s]*to[-_\s]*delete)\b/i,
    reason: 'Privacy and secret-redaction settings are protected.',
  },
  {
    domain: 'credentials_vault',
    regex: /\b(vault|passphrase|model\s*api\s*key|model_api_key|api\s*keys?|secret\s*key|credentials?)\b/i,
    reason: 'Vault secrets, passphrases, and model API keys are isolated in the encrypted Vault and inaccessible here.',
  },
  {
    domain: 'os_permissions',
    regex: /\b(os\s*permissions?|permission\s*ceilings?|capability\s*ceilings?|accessibility\s*permission|screen\s*recording\s*permission|grant\s+all\s+permissions)\b/i,
    reason: 'OS permissions and host capability ceilings require explicit user OS/host grants.',
  },
  {
    domain: 'domain_allowlists',
    regex: /\b(domain\s*allowlists?|allowed\s*domains?|allowed_connector_hosts|whitelist\s+domain|allowlist\s+url)\b/i,
    reason: 'Network and connector domain allowlists are protected security settings.',
  },
  {
    domain: 'spend_limits',
    regex: /\b(spend\s*limits?|budget\s*caps?|spend\s*caps?|raise\s+limit\s+to\s*\$|daily\s*spend|auto[-_\s]*pay)\b/i,
    reason: 'Spend limits and financial caps cannot be modified by Morrow.',
  },
  {
    domain: 'approval_rules',
    regex: /\b(approval\s*rules?|auto[-_\s]*approve|skip\s+approval|disable\s+approval|audit\s*policy|disable\s+audit|disable\s+ledger)\b/i,
    reason: 'Approval rules and audit ledger policies are immutable safety-floor guarantees.',
  },
];

const PROTECTED_RAW_OBJECT_KEY_MAP: Record<string, ProtectedSoulOrSystemDomain> = {
  rules: 'user_rules',
  userRules: 'user_rules',
  standingRules: 'user_rules',
  standingInstructions: 'standing_instructions',
  trustKernel: 'trust_kernel_code',
  safetyFloor: 'trust_kernel_code',
  policyEngine: 'security_settings',
  securitySettings: 'security_settings',
  auth: 'identity_authentication',
  identity: 'identity_authentication',
  privacy: 'privacy_settings',
  vault: 'credentials_vault',
  apiKey: 'credentials_vault',
  modelKey: 'credentials_vault',
  modelApiKey: 'credentials_vault',
  credentials: 'credentials_vault',
  osPermissions: 'os_permissions',
  permissionCeiling: 'os_permissions',
  capabilityCeiling: 'os_permissions',
  domainAllowlist: 'domain_allowlists',
  allowedDomains: 'domain_allowlists',
  spendLimit: 'spend_limits',
  spendCapUsd: 'spend_limits',
  approvalRules: 'approval_rules',
  auditPolicy: 'approval_rules',
};

// ============================================================================
// 3. NATURAL-LANGUAGE & STRUCTURED SELF-EDIT EXTRACTOR
// ============================================================================

export function extractPresentationAndProtectedRequests(
  promptText: string,
  rawPatchObject?: Record<string, unknown>
): {
  safePatch: SoulPresentationPatch;
  rejectedProtectedAttempts: RejectedProtectedEditAttempt[];
  explicitlyRequestedByUser: boolean;
} {
  const cleanPrompt = (promptText || '').trim();
  const lower = cleanPrompt.toLowerCase();
  const safePatch: SoulPresentationPatch = {};
  const rejectedProtectedAttempts: RejectedProtectedEditAttempt[] = [];
  const seenDomains = new Set<ProtectedSoulOrSystemDomain>();

  // 1. Inspect rawPatchObject for allowlisted vs protected keys
  if (rawPatchObject && typeof rawPatchObject === 'object') {
    for (const [key, value] of Object.entries(rawPatchObject)) {
      if ((ALLOWLISTED_SOUL_PRESENTATION_FIELD_NAMES as readonly string[]).includes(key)) {
        const singleCheck = SoulPresentationPatchSchema.safeParse({ [key]: value });
        if (singleCheck.success) {
          Object.assign(safePatch, singleCheck.data);
        }
      } else {
        const mappedDomain = PROTECTED_RAW_OBJECT_KEY_MAP[key] || 'security_settings';
        if (!seenDomains.has(mappedDomain)) {
          seenDomains.add(mappedDomain);
          rejectedProtectedAttempts.push({
            domain: mappedDomain,
            matchedClause: `field "${key}"`,
            reason: `Field "${key}" belongs to protected domain "${mappedDomain}" and cannot be modified via the Soul presentation self-edit API.`,
          });
        }
      }
    }
  }

  // 2. Scan natural language prompt for protected domain modification attempts
  for (const detector of PROTECTED_DOMAIN_DETECTORS) {
    const match = detector.regex.exec(cleanPrompt);
    if (match && !seenDomains.has(detector.domain)) {
      seenDomains.add(detector.domain);
      rejectedProtectedAttempts.push({
        domain: detector.domain,
        matchedClause: match[0],
        reason: detector.reason,
      });
    }
  }

  // 3. Extract safe allowlisted presentation fields from natural language
  // Tone
  if (/\b(direct\s+and\s+pragmatic|direct\s+tone|pragmatic\s+tone|matter[-_\s]of[-_\s]fact)\b/.test(lower)) {
    safePatch.tone = safePatch.tone ?? 'direct_pragmatic';
  } else if (/\b(formal|analytical\s+tone|forensic\s+tone)\b/.test(lower)) {
    safePatch.tone = safePatch.tone ?? 'formal_analytical';
  } else if (/\b(calm\s+and\s+supportive|calm\s+tone|gentle\s+tone|soothing)\b/.test(lower)) {
    safePatch.tone = safePatch.tone ?? 'calm_supportive';
  } else if (/\b(enthusiastic|creative\s+tone|upbeat\s+tone)\b/.test(lower)) {
    safePatch.tone = safePatch.tone ?? 'enthusiastic_creative';
  } else if (/\b(warm\s+and\s+accountable|warm\s+tone)\b/.test(lower)) {
    safePatch.tone = safePatch.tone ?? 'warm_accountable';
  }

  // Concision
  if (/\b(terse|ultra[-_\s]*short|one[-_\s]*line|minimal\s+words)\b/.test(lower)) {
    safePatch.concision = safePatch.concision ?? 'terse';
  } else if (/\b(more\s+concise|concise|brief|short\s+answers|less\s+verbose)\b/.test(lower)) {
    safePatch.concision = safePatch.concision ?? 'concise';
  } else if (/\b(detailed|thorough|comprehensive\s+explanations|in[-_\s]*depth)\b/.test(lower)) {
    safePatch.concision = safePatch.concision ?? 'detailed';
  } else if (/\b(balanced\s+length|balanced\s+concision)\b/.test(lower)) {
    safePatch.concision = safePatch.concision ?? 'balanced';
  }

  // Humour
  if (/\b(no\s+humo?ur|zero\s+humo?ur|serious\s+only)\b/.test(lower)) {
    safePatch.humour = safePatch.humour ?? 'none';
  } else if (/\b(dry\s+humo?ur|dry\s+wit|witty|understated\s+humo?ur|slightly\s+dry)\b/.test(lower)) {
    safePatch.humour = safePatch.humour ?? 'dry_understated';
  } else if (/\b(playful\s+humo?ur|playful|lighthearted)\b/.test(lower)) {
    safePatch.humour = safePatch.humour ?? 'playful';
  } else if (/\b(warm\s+humo?ur|warm\s+light)\b/.test(lower)) {
    safePatch.humour = safePatch.humour ?? 'warm_light';
  }

  // Voice style
  if (/\b(hermes\s+voice|hermes\s+cadence|hermes_direct_pragmatic)\b/.test(lower)) {
    safePatch.voiceStyle = safePatch.voiceStyle ?? 'hermes_direct_pragmatic';
  } else if (/\b(socratic\s+architect|systems\s+architect\s+voice|socratic_architect)\b/.test(lower)) {
    safePatch.voiceStyle = safePatch.voiceStyle ?? 'socratic_architect';
  } else if (/\b(security\s+auditor\s+voice|sentinel\s+voice|strict_security_auditor)\b/.test(lower)) {
    safePatch.voiceStyle = safePatch.voiceStyle ?? 'strict_security_auditor';
  } else if (/\b(morrow\s+default\s+voice|morrow_warm_accountable)\b/.test(lower)) {
    safePatch.voiceStyle = safePatch.voiceStyle ?? 'morrow_warm_accountable';
  }

  // Animation preference
  if (/\b(calm\s+minimal\s+animation|subtle\s+animation|minimal\s+motion|calm_minimal)\b/.test(lower)) {
    safePatch.animationPreference = safePatch.animationPreference ?? 'calm_minimal';
  } else if (/\b(static\s+focus|freeze\s+animation|no\s+animation\s+while\s+coding|static_focus)\b/.test(lower)) {
    safePatch.animationPreference = safePatch.animationPreference ?? 'static_focus';
  } else if (/\b(zero\s+fps|sleep\s+animation|sleep_zero_fps)\b/.test(lower)) {
    safePatch.animationPreference = safePatch.animationPreference ?? 'sleep_zero_fps';
  } else if (/\b(full\s+expressive|expressive\s+animation|full_expressive)\b/.test(lower)) {
    safePatch.animationPreference = safePatch.animationPreference ?? 'full_expressive';
  }

  // Initiative level
  if (/\b(quiet\s+on\s+demand|only\s+when\s+asked|do\s+not\s+interrupt|quiet_on_demand)\b/.test(lower)) {
    safePatch.initiativeLevel = safePatch.initiativeLevel ?? 'quiet_on_demand';
  } else if (/\b(proactive\s+suggestions|more\s+proactive|proactive_suggestions)\b/.test(lower)) {
    safePatch.initiativeLevel = safePatch.initiativeLevel ?? 'proactive_suggestions';
  } else if (/\b(balanced\s+initiative|balanced_collaborative)\b/.test(lower)) {
    safePatch.initiativeLevel = safePatch.initiativeLevel ?? 'balanced_collaborative';
  }

  // Notification style
  if (/\b(silent\s+badge|badge\s+only|no\s+popups|silent_badge_only)\b/.test(lower)) {
    safePatch.notificationStyle = safePatch.notificationStyle ?? 'silent_badge_only';
  } else if (/\b(calm\s+digest|digest\s+notifications|calm_digest)\b/.test(lower)) {
    safePatch.notificationStyle = safePatch.notificationStyle ?? 'calm_digest';
  } else if (/\b(immediate\s+toast|toast\s+notifications|immediate_toast)\b/.test(lower)) {
    safePatch.notificationStyle = safePatch.notificationStyle ?? 'immediate_toast';
  } else if (/\b(voice\s+and\s+banner|spoken\s+notifications|voice_and_banner)\b/.test(lower)) {
    safePatch.notificationStyle = safePatch.notificationStyle ?? 'voice_and_banner';
  }

  const explicitlyRequestedByUser =
    /\b(please|make\s+your|change\s+your|set\s+your|update\s+your|switch\s+your|be\s+more|use\s+a|i\s+want\s+you\s+to\s+be|adjust\s+your)\b/i.test(
      cleanPrompt
    ) || Object.keys(safePatch).length > 0;

  return {
    safePatch,
    rejectedProtectedAttempts,
    explicitlyRequestedByUser,
  };
}

// ============================================================================
// 4. VERSIONED DIFF & SOUL DOCUMENT PRESENTATION RENDERER
// ============================================================================

export interface SoulPresentationFieldDiff {
  field: AllowlistedSoulPresentationField;
  before: string;
  after: string;
}

export interface SoulPresentationVersionSnapshot {
  version: number;
  timestampIso: string;
  requestedByPrompt: string;
  presentation: SoulPresentationSettings;
  soulDocument: SoulDocument;
  diffFromPrior: SoulPresentationFieldDiff[];
}

export interface SoulPresentationVersionedDiff {
  status:
    | 'APPLIED'
    | 'PARTIALLY_APPLIED_SAFE_ONLY'
    | 'REJECTED_PROTECTED_ONLY'
    | 'NO_CHANGES';
  autoApplied: boolean;
  fromVersion: number;
  toVersion: number;
  timestampIso: string;
  requestedByPrompt: string;
  changedFields: SoulPresentationFieldDiff[];
  beforePresentation: SoulPresentationSettings;
  afterPresentation: SoulPresentationSettings;
  updatedSoulDocument: SoulDocument;
  rejectedProtectedAttempts: RejectedProtectedEditAttempt[];
  explanation: string;
}

/**
 * Renders the updated SoulDocument preserving the immutable `# Stance & Uncertainty`
 * safety boundaries while updating `# Voice & Tone` and `# Companion Presence`
 * to reflect the allowlisted presentation settings.
 */
export function renderSoulDocumentWithPresentation(
  currentSoul: SoulDocument,
  presentation: SoulPresentationSettings,
  nextVersion: number
): SoulDocument {
  const cadence: SoulVoiceCadence = presentation.voiceStyle;
  const baseTemplate = SOUL_PRESET_TEMPLATES[cadence];

  // Always preserve the existing Stance & Uncertainty safety section verbatim
  const immutableStanceSection = currentSoul.parsedSections.stanceAndUncertainty;

  const updatedMarkdown = `# Identity & Role
${currentSoul.parsedSections.identityAndRole}

# Voice & Tone
- Tone: ${presentation.tone} · Concision: ${presentation.concision} · Humour: ${presentation.humour} · Voice Style: ${baseTemplate.badge}
- Lead with the verified answer or action outcome.

# Stance & Uncertainty
${immutableStanceSection}

# Companion Presence
- Animation Preference: ${presentation.animationPreference} · Initiative Level: ${presentation.initiativeLevel} · Notification Style: ${presentation.notificationStyle}
- Never use guilt, urgency pressure, or dark patterns.`;

  return parseAndValidateSoulDocument(updatedMarkdown, cadence, nextVersion);
}

// ============================================================================
// 5. MORROW PRESENTATION SELF-MANAGER (WITH PERSISTENCE & ONE-CLICK ROLLBACK)
// ============================================================================

export class MorrowPresentationSelfManager {
  private currentVersion: number;
  private currentPresentation: SoulPresentationSettings;
  private currentSoul: SoulDocument;
  private versionHistory: SoulPresentationVersionSnapshot[];
  private readonly storageFilePath: string | null;

  constructor(options?: {
    initialPresentation?: SoulPresentationSettings;
    initialSoul?: SoulDocument;
    storageDir?: string;
  }) {
    this.storageFilePath = options?.storageDir
      ? path.join(options.storageDir, 'soul_presentation_state.json')
      : null;

    if (this.storageFilePath && fs.existsSync(this.storageFilePath)) {
      const loaded = JSON.parse(fs.readFileSync(this.storageFilePath, 'utf8'));
      this.currentVersion = loaded.currentVersion;
      this.currentPresentation = SoulPresentationSettingsSchema.parse(loaded.currentPresentation);
      this.currentSoul = loaded.currentSoul;
      this.versionHistory = loaded.versionHistory;
    } else {
      this.currentVersion = options?.initialSoul?.version ?? 1;
      this.currentPresentation = structuredClone(
        options?.initialPresentation ?? DEFAULT_SOUL_PRESENTATION_SETTINGS
      );
      this.currentSoul = structuredClone(options?.initialSoul ?? DEFAULT_SOUL_DOCUMENT);
      this.versionHistory = [
        {
          version: this.currentVersion,
          timestampIso: new Date().toISOString(),
          requestedByPrompt: 'Initial default presentation state',
          presentation: structuredClone(this.currentPresentation),
          soulDocument: structuredClone(this.currentSoul),
          diffFromPrior: [],
        },
      ];
      this.persistToDisk();
    }
  }

  private persistToDisk(): void {
    if (!this.storageFilePath) return;
    const dir = path.dirname(this.storageFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(
      this.storageFilePath,
      JSON.stringify(
        {
          currentVersion: this.currentVersion,
          currentPresentation: this.currentPresentation,
          currentSoul: this.currentSoul,
          versionHistory: this.versionHistory,
        },
        null,
        2
      ),
      { encoding: 'utf8', mode: 0o600 }
    );
  }

  public getPresentation(): SoulPresentationSettings {
    return structuredClone(this.currentPresentation);
  }

  public getSoulDocument(): SoulDocument {
    return structuredClone(this.currentSoul);
  }

  public getVersionHistory(): SoulPresentationVersionSnapshot[] {
    return structuredClone(this.versionHistory);
  }

  /**
   * Evaluates and applies a user-requested Soul presentation edit:
   * - Extracts allowlisted presentation changes (`tone`, `concision`, `humour`, `voiceStyle`,
   *   `animationPreference`, `initiativeLevel`, `notificationStyle`).
   * - Detects any protected setting requests (`RULES`, `safety_floor`, `vault`, `model_keys`,
   *   `os_permissions`, `domain_allowlists`, `spend_limits`, `approval_rules`, etc.).
   * - If mixed, applies ONLY the safe non-sensitive presentation changes and explains
   *   why the protected settings were refused.
   * - Preserves the prior version snapshot and supports one-click rollback.
   */
  public applyUserRequestedEdit(input: {
    userPrompt: string;
    patch?: Record<string, unknown>;
    previewOnly?: boolean;
  }): SoulPresentationVersionedDiff {
    const { safePatch, rejectedProtectedAttempts, explicitlyRequestedByUser } =
      extractPresentationAndProtectedRequests(input.userPrompt, input.patch);

    const beforePresentation = structuredClone(this.currentPresentation);
    const afterPresentation: SoulPresentationSettings = {
      ...beforePresentation,
      ...safePatch,
    };

    const changedFields: SoulPresentationFieldDiff[] = [];
    for (const field of ALLOWLISTED_SOUL_PRESENTATION_FIELD_NAMES) {
      if (beforePresentation[field] !== afterPresentation[field]) {
        changedFields.push({
          field,
          before: beforePresentation[field],
          after: afterPresentation[field],
        });
      }
    }

    const nowIso = new Date().toISOString();

    // Case 1: Only protected settings were requested (zero safe presentation changes)
    if (changedFields.length === 0 && rejectedProtectedAttempts.length > 0) {
      const domainLabels = rejectedProtectedAttempts.map((r) => r.domain).join(', ');
      return {
        status: 'REJECTED_PROTECTED_ONLY',
        autoApplied: false,
        fromVersion: this.currentVersion,
        toVersion: this.currentVersion,
        timestampIso: nowIso,
        requestedByPrompt: input.userPrompt,
        changedFields: [],
        beforePresentation,
        afterPresentation: beforePresentation,
        updatedSoulDocument: structuredClone(this.currentSoul),
        rejectedProtectedAttempts,
        explanation: `Refused protected setting modification [${domainLabels}]: ${rejectedProtectedAttempts
          .map((r) => r.reason)
          .join(' ')}`,
      };
    }

    // Case 2: No changes at all
    if (changedFields.length === 0) {
      return {
        status: 'NO_CHANGES',
        autoApplied: false,
        fromVersion: this.currentVersion,
        toVersion: this.currentVersion,
        timestampIso: nowIso,
        requestedByPrompt: input.userPrompt,
        changedFields: [],
        beforePresentation,
        afterPresentation: beforePresentation,
        updatedSoulDocument: structuredClone(this.currentSoul),
        rejectedProtectedAttempts: [],
        explanation: 'No presentation changes were detected in the request.',
      };
    }

    const nextVersion = this.currentVersion + 1;
    const updatedSoul = renderSoulDocumentWithPresentation(
      this.currentSoul,
      afterPresentation,
      nextVersion
    );

    const shouldAutoApply = !input.previewOnly && explicitlyRequestedByUser;
    if (shouldAutoApply) {
      this.currentVersion = nextVersion;
      this.currentPresentation = structuredClone(afterPresentation);
      this.currentSoul = structuredClone(updatedSoul);
      this.versionHistory.push({
        version: nextVersion,
        timestampIso: nowIso,
        requestedByPrompt: input.userPrompt,
        presentation: structuredClone(afterPresentation),
        soulDocument: structuredClone(updatedSoul),
        diffFromPrior: structuredClone(changedFields),
      });
      this.persistToDisk();
    }

    const changeSummary = changedFields
      .map((c) => `${c.field}: ${c.before} -> ${c.after}`)
      .join(', ');

    if (rejectedProtectedAttempts.length > 0) {
      const domainLabels = rejectedProtectedAttempts.map((r) => r.domain).join(', ');
      return {
        status: 'PARTIALLY_APPLIED_SAFE_ONLY',
        autoApplied: shouldAutoApply,
        fromVersion: nextVersion - 1,
        toVersion: shouldAutoApply ? nextVersion : this.currentVersion,
        timestampIso: nowIso,
        requestedByPrompt: input.userPrompt,
        changedFields,
        beforePresentation,
        afterPresentation,
        updatedSoulDocument: updatedSoul,
        rejectedProtectedAttempts,
        explanation: `Applied safe non-sensitive presentation changes (${changeSummary}) as v${nextVersion}, but refused protected settings [${domainLabels}] because rules, security, vault credentials, permissions, spend limits, and approval policies cannot be self-modified.`,
      };
    }

    return {
      status: 'APPLIED',
      autoApplied: shouldAutoApply,
      fromVersion: nextVersion - 1,
      toVersion: shouldAutoApply ? nextVersion : this.currentVersion,
      timestampIso: nowIso,
      requestedByPrompt: input.userPrompt,
      changedFields,
      beforePresentation,
      afterPresentation,
      updatedSoulDocument: updatedSoul,
      rejectedProtectedAttempts: [],
      explanation: `Applied non-sensitive Soul presentation changes (${changeSummary}) as v${nextVersion}.`,
    };
  }

  /**
   * One-click rollback to the prior version (or a specific version number).
   */
  public rollback(targetVersion?: number): {
    ok: boolean;
    restoredVersion: number;
    presentation: SoulPresentationSettings;
    soulDocument: SoulDocument;
    error?: string;
  } {
    if (this.versionHistory.length < 2 && targetVersion === undefined) {
      return {
        ok: false,
        restoredVersion: this.currentVersion,
        presentation: this.getPresentation(),
        soulDocument: this.getSoulDocument(),
        error: 'No prior presentation version exists to roll back to.',
      };
    }

    const desiredVersion =
      targetVersion ?? this.versionHistory[this.versionHistory.length - 2].version;
    const snapshot = this.versionHistory.find((v) => v.version === desiredVersion);
    if (!snapshot) {
      return {
        ok: false,
        restoredVersion: this.currentVersion,
        presentation: this.getPresentation(),
        soulDocument: this.getSoulDocument(),
        error: `Presentation version v${desiredVersion} not found in history.`,
      };
    }

    this.currentVersion = snapshot.version;
    this.currentPresentation = structuredClone(snapshot.presentation);
    this.currentSoul = structuredClone(snapshot.soulDocument);
    this.persistToDisk();

    return {
      ok: true,
      restoredVersion: snapshot.version,
      presentation: this.getPresentation(),
      soulDocument: this.getSoulDocument(),
    };
  }
}

/**
 * Creates ToolRegistry definitions for Morrow's allowlisted Soul presentation self-edit API.
 */
export function createSoulPresentationToolDefinitions(
  manager: MorrowPresentationSelfManager
): ToolRegistration[] {
  return [
    {
      name: 'soul.presentation.self_edit',
      version: '1.0.0',
      subsystem: 'mission_runtime',
      inputSchema: {
        userPrompt: 'string:required',
        patch: 'object:optional',
      },
      outputSchema: {
        status: 'string',
        autoApplied: 'boolean',
        fromVersion: 'number',
        toVersion: 'number',
        changedFields: 'array',
        rejectedProtectedDomains: 'array',
        explanation: 'string',
      },
      riskClass: 'read',
      requiredCapabilities: ['soul:presentation_self_edit'],
      timeoutMs: 3000,
      retryPolicy: { maxRetries: 0, backoffMs: 0, idempotent: true },
      availabilityStatus: 'AVAILABLE_REAL',
      executor: (args: Record<string, unknown>) => {
        const res = manager.applyUserRequestedEdit({
          userPrompt: String(args.userPrompt || ''),
          patch: (args.patch as Record<string, unknown>) || undefined,
        });
        const blockedOnly = res.status === 'REJECTED_PROTECTED_ONLY';
        return {
          ok: !blockedOnly,
          output: {
            status: res.status,
            autoApplied: res.autoApplied,
            fromVersion: res.fromVersion,
            toVersion: res.toVersion,
            changedFields: res.changedFields,
            rejectedProtectedDomains: res.rejectedProtectedAttempts.map((r) => r.domain),
            explanation: res.explanation,
          },
          realSideEffectPerformed: res.autoApplied,
          isSimulated: false,
          errorCode: blockedOnly ? 'PROTECTED_DOMAIN_IMMUTABLE' : undefined,
          errorMessage: blockedOnly ? res.explanation : undefined,
        };
      },
      verifier: (_args, outcome) => {
        const currentSoul = manager.getSoulDocument();
        const criteriaMet =
          outcome.ok &&
          currentSoul.guardVerified &&
          currentSoul.version === Number(outcome.output.toVersion);
        return {
          independentTargetRead: true,
          criteriaMet,
          verificationState: criteriaMet ? 'VERIFIED' : 'FAILED',
          evidenceHash: `soul-v${currentSoul.version}`,
          summary: criteriaMet
            ? `Independently verified Soul presentation v${currentSoul.version} (guardVerified=true).`
            : `Soul presentation verification failed.`,
        };
      },
    },
  ];
}


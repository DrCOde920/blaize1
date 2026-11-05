/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProtectedSettings Registry & Protected Zone Security Gate (`src/packages/trust/protected_settings.ts`)
 *
 * Implements requirement 2 of PROMPT: SELF-AUTHORING:
 * 1. Definitive Protected Zone registry containing all sensitive control plane settings:
 *    - Rule Book and safety-floor rules
 *    - PolicyGuard and its code / PolicyEngine configuration
 *    - Places never-go zones
 *    - The secret code
 *    - Identity and biometrics
 *    - Key vault and API keys
 *    - Permission grants and autonomy level
 *    - Spend caps and budgets
 *    - Network and domain allowlists
 *    - Approval settings and token store
 *    - Ledger and audit data
 *    - Model and provider allowlists
 *    - Update and install sources
 *    - The Protected Zone registry itself
 * 2. Deterministic code enforcement (never system prompt dependent):
 *    Agent, plugin, skill, hook, personality, or injected web content callers have ZERO write access.
 * 3. Write changes happen ONLY through a UI-only channel requiring a real user gesture and re-authentication.
 * 4. Any tool call or agent mutation attempt targeting a protected item fails with a clear message.
 */

export interface ProtectedSettingDefinition {
  id: string;
  name: string;
  description: string;
  category:
    | 'safety_floor_rules'
    | 'policy_guard_code'
    | 'places_never_go_zones'
    | 'secret_code'
    | 'identity_biometrics'
    | 'key_vault_and_api_keys'
    | 'permission_grants'
    | 'spend_caps_and_budgets'
    | 'network_domain_allowlists'
    | 'approval_settings'
    | 'ledger_and_audit_data'
    | 'model_provider_allowlists'
    | 'update_install_sources'
    | 'protected_zone_registry';
  requiresUserReauth: true;
  readOnlyForAgentTools: true;
}

export const PROTECTED_SETTINGS_REGISTRY: ReadonlyMap<string, ProtectedSettingDefinition> = new Map([
  [
    'rule_book_safety_floor',
    {
      id: 'rule_book_safety_floor',
      name: 'Rule Book & Safety Floor Rules',
      description: 'Immutable safety-floor rules, spend caps, and core policy constraints.',
      category: 'safety_floor_rules',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'policy_guard_code',
    {
      id: 'policy_guard_code',
      name: 'PolicyGuard & Trust Kernel Code',
      description: 'Central PolicyEngine authorization boundary, security checks, and contracts.',
      category: 'policy_guard_code',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'places_never_go_zones',
    {
      id: 'places_never_go_zones',
      name: 'Places Never-Go Zones',
      description: 'Prohibited paths, forbidden domains, and restricted OS directories.',
      category: 'places_never_go_zones',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'vault_secret_code',
    {
      id: 'vault_secret_code',
      name: 'Secret Code',
      description: 'Master vault unlock secret code and attempt limiter parameters.',
      category: 'secret_code',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'identity_biometrics',
    {
      id: 'identity_biometrics',
      name: 'Identity & Biometrics',
      description: 'User identity records, biometric factors, and passkey credentials.',
      category: 'identity_biometrics',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'key_vault_api_keys',
    {
      id: 'key_vault_api_keys',
      name: 'Key Vault & API Credentials',
      description: 'Encrypted vault handles, OAuth tokens, and provider secret keys.',
      category: 'key_vault_and_api_keys',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'permission_grants_autonomy',
    {
      id: 'permission_grants_autonomy',
      name: 'Permission Grants & Autonomy Level',
      description: 'Capability ceilings, autonomy tier grants, and elevation policies.',
      category: 'permission_grants',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'spend_caps_budgets',
    {
      id: 'spend_caps_budgets',
      name: 'Spend Caps & Usage Budgets',
      description: 'Per-mission and daily financial spend limits and model token caps.',
      category: 'spend_caps_and_budgets',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'network_domain_allowlist',
    {
      id: 'network_domain_allowlist',
      name: 'Network & Domain Allowlists',
      description: 'Authorized outbound domains, connector endpoints, and SSRF filters.',
      category: 'network_domain_allowlists',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'approval_settings_tokens',
    {
      id: 'approval_settings_tokens',
      name: 'Approval Settings & Token Store',
      description: 'Single-use approval tokens, confirmation rules, and verification requirements.',
      category: 'approval_settings',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'ledger_audit_chain',
    {
      id: 'ledger_audit_chain',
      name: 'Ledger & Audit Data',
      description: 'Cryptographic hash-chained memory ledger and tamper-evident audit logs.',
      category: 'ledger_and_audit_data',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'model_provider_allowlist',
    {
      id: 'model_provider_allowlist',
      name: 'Model & Provider Allowlists',
      description: 'ProviderRouter allowlists, model catalog, and endpoint routing.',
      category: 'model_provider_allowlists',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'update_install_sources',
    {
      id: 'update_install_sources',
      name: 'Update & Install Sources',
      description: 'Plugin installation registries, update endpoints, and package verification keys.',
      category: 'update_install_sources',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
  [
    'protected_zone_registry',
    {
      id: 'protected_zone_registry',
      name: 'Protected Zone Registry',
      description: 'The ProtectedSettings registry itself and plane boundary rules.',
      category: 'protected_zone_registry',
      requiresUserReauth: true,
      readOnlyForAgentTools: true,
    },
  ],
]);

// Patterns that identify Protected Zone targets
const PROTECTED_TARGET_PATTERNS: readonly RegExp[] = [
  /\b(?:rule[-_]?book|safety[-_]?floor|srule|standingRules)\b/i,
  /\b(?:policyGuard|policy_engine|trust_kernel|security_checks)\b/i,
  /\b(?:places|never_go_zone|prohibited_path)\b/i,
  /\b(?:secret_code|passphrase|vault_master_key|unlock_code)\b/i,
  /\b(?:identity|biometric|passkey|user_credentials)\b/i,
  /\b(?:vault|api_key|oauth_token|secret_key)\b/i,
  /\b(?:permission|capability_ceiling|autonomy_level|grant_permission|expand_grant)\b/i,
  /\b(?:spend_cap|daily_budget|token_budget|max_spend)\b/i,
  /\b(?:network_allowlist|domain_allowlist|allowed_domains|ssrf_filter)\b/i,
  /\b(?:approval_tokens|token_store|approval_settings)\b/i,
  /\b(?:canonical_ledger|memory_ledger|audit_chain|hash_chain)\b/i,
  /\b(?:model_catalog|provider_router|allowed_meta_models)\b/i,
  /\b(?:update_source|install_source|package_registry)\b/i,
  /\b(?:protected_zone|protected_settings|protected_control_plane)\b/i,
];

export type ProtectedActorRole =
  | 'user_typed'
  | 'user_voice'
  | 'user_reauthenticated_ui'
  | 'agent'
  | 'skill'
  | 'plugin'
  | 'hook'
  | 'personality'
  | 'web_content'
  | 'tool_output'
  | 'memory';

export interface ProtectedSettingsAccessResult {
  allowed: boolean;
  settingId?: string;
  category?: string;
  actor: ProtectedActorRole;
  errorCode?: 'PROTECTED_CONTROL_PLANE_WRITE_DENIED' | 'UNAUTHENTICATED_MUTATION_BLOCKED';
  reason: string;
}

/**
 * Deterministically checks whether an access request targets a Protected Zone setting
 * and enforces the write prohibition for agent-side tools.
 */
export function evaluateProtectedSettingsAccess(params: {
  actor: ProtectedActorRole;
  operation: 'read' | 'write' | 'delete' | 'reset' | 'disable';
  targetSettingOrPath: string;
  payload?: unknown;
}): ProtectedSettingsAccessResult {
  const target = String(params.targetSettingOrPath || '').trim();
  const payloadStr = params.payload ? JSON.stringify(params.payload) : '';
  const combined = `${target} ${payloadStr}`;

  // Check if target matches any known protected setting ID or pattern
  let matchedSetting: ProtectedSettingDefinition | undefined;
  for (const setting of PROTECTED_SETTINGS_REGISTRY.values()) {
    if (setting.id === target || setting.category === target) {
      matchedSetting = setting;
      break;
    }
  }

  const matchesPattern = PROTECTED_TARGET_PATTERNS.some((pattern) => pattern.test(combined));
  const isProtectedTarget = Boolean(matchedSetting) || matchesPattern;

  if (!isProtectedTarget) {
    return {
      allowed: true,
      actor: params.actor,
      reason: `Target '${target}' is not in the Protected Zone registry. Allowed in Open Zone.`,
    };
  }

  // Read-only access is permitted for inspection except raw secret code / master key
  if (params.operation === 'read') {
    const isMasterSecretRead = /\b(?:secret_code|master_key|passphrase)\b/i.test(target);
    if (!isMasterSecretRead) {
      return {
        allowed: true,
        settingId: matchedSetting?.id || target,
        category: matchedSetting?.category || 'protected_setting',
        actor: params.actor,
        reason: `Read-only inspection of protected setting '${target}' is permitted.`,
      };
    }
  }

  // Write/mutate operations are strictly blocked for all agent-side actors (agent, skill, plugin, hook, personality, web_content)
  const isUserReauthenticatedUi = params.actor === 'user_reauthenticated_ui';

  if (!isUserReauthenticatedUi) {
    const settingName = matchedSetting?.name || target;
    return {
      allowed: false,
      settingId: matchedSetting?.id || target,
      category: matchedSetting?.category || 'protected_setting',
      actor: params.actor,
      errorCode: 'PROTECTED_CONTROL_PLANE_WRITE_DENIED',
      reason: `PROTECTED_CONTROL_PLANE_WRITE_DENIED: Actor '${params.actor}' cannot ${params.operation} protected setting '${settingName}'. Protected Zone rules and sensitive settings are unwriteable by agent tools, skills, plugins, hooks, or personalities, and require explicit user UI re-authentication.`,
    };
  }

  return {
    allowed: true,
    settingId: matchedSetting?.id || target,
    category: matchedSetting?.category || 'protected_setting',
    actor: params.actor,
    reason: `Allowed '${params.operation}' on protected setting '${matchedSetting?.name || target}' via re-authenticated user UI channel.`,
  };
}

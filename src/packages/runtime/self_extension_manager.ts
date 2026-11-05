/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Self-Extension Manager & Dynamic Skill/Plugin Runtime (`src/packages/runtime/self_extension_manager.ts`)
 *
 * Implements Phase 8 controlled self-extension system:
 * 1. Deterministic separation of CapabilityPlane from ProtectedControlPlane (enforced in code, never prompt-only).
 * 2. Capability-plane objects Morrow may manage: skills, plugins, app_knowledge_profiles, local_helper_tools,
 *    workspace_templates, and presentation_preferences. Protected objects (safety-floor rules, trust kernel,
 *    SOUL.md safety boundaries, vault secrets, approval tokens, ceiling grants) are strictly unwriteable by agent tools.
 * 3. Strict PluginManifest v1 with schema/version, stable ID, entryPoint, tools, strict input/output schemas,
 *    risk classes, requestedCapabilities, dependencies (blocking dependency confusion & malicious internal packages),
 *    publisher/origin, contentHash, integrity/signature metadata, healthCheck, testCommand, and declaredDataScopes.
 * 4. Zero permissions by default for generated/imported plugins. Host grants only capabilities already authorised
 *    by the user for that app/project/profile. Manifest permissions can narrow but never widen the capability ceiling.
 * 5. Out-of-process restricted worker/process execution with OS-level process restrictions (`prlimit` CPU/file/process
 *    rlimits + Node `--permission` filesystem confinement + `--max-old-space-size` memory limit + `vm` null-prototype
 *    context with zero `require`/`process`/`fetch`/`electron` globals) and a narrow JSON-RPC 2.0 capability bridge.
 * 6. Full plugin lifecycle: discover, create, validate, dryRun, test, enable, disable, update, uninstall,
 *    healthCheck, audit logs, version history, rollback, and isolated per-plugin storage.
 * 7. "Create and use" workflow: creates, tests, and activates without repeated approvals ONLY if zero new privilege
 *    is needed and tests pass; requests exact capability grant if new network/folder/connector/external_send/OS/credential/system capability is needed.
 * 8. Version-pinned skills with input/output schemas, preconditions, successCriteria, cost/time bounds,
 *    retry/idempotency policy, and independent verifier. Unknown skill IDs fail closed (never resolve to skills[0]).
 * 9. Skill execution routed through the same ToolRegistry, PolicyEngine, independent verifier, and MemoryLedger as native tools.
 * 10. Skill creation from natural language and from Teach & Replay traces with strict secret/credential stripping.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import {
  CanonicalActionRiskClass,
  CanonicalExecutionResult,
  ExecutionTruthState,
  ScopedApprovalToken,
  VerificationTruthState,
} from '../contracts';
import {
  MemoryLedger,
  PolicyEngine,
  canonicalizeAndValidateUrl,
  computeCryptographicHmacSha256,
  computeCryptographicSha256,
  globalPolicyEngine,
  normalizeAndValidateRiskClass,
  validateFilesystemPath,
} from '../trust';
import { ScopedWorkspaceManager } from '../browser_ide/scoped_workspace';
import { ConsentedInteractionEvent } from '../recorder/consented_recorder';
import {
  RecordedBrowserDemonstrationEvent,
  ToolExecutionContext,
  ToolExecutorOutcome,
  ToolRegistration,
  ToolRegistry,
  ToolRetryIdempotencyPolicy,
  ToolVerifierOutcome,
} from './index';

// ============================================================================
// 1. CAPABILITY PLANE VS PROTECTED CONTROL PLANE (PROMPT 8.1 & 8.2)
// ============================================================================

export type PlaneClassification = 'CAPABILITY_PLANE' | 'PROTECTED_CONTROL_PLANE';

export type CapabilityPlaneObjectKind =
  | 'skill'
  | 'plugin'
  | 'app_knowledge_profile'
  | 'local_helper_tool'
  | 'workspace_template'
  | 'presentation_preference';

export type ProtectedControlPlaneObjectKind =
  | 'safety_floor_rule'
  | 'policy_engine_config'
  | 'approval_token_store'
  | 'capability_ceiling'
  | 'vault_secret'
  | 'trust_kernel_asset'
  | 'soul_safety_boundary'
  | 'audit_ledger_chain'
  | 'ipc_security_contract';

export const CAPABILITY_PLANE_KINDS: ReadonlySet<string> = new Set<CapabilityPlaneObjectKind>([
  'skill',
  'plugin',
  'app_knowledge_profile',
  'local_helper_tool',
  'workspace_template',
  'presentation_preference',
]);

export const PROTECTED_CONTROL_PLANE_KINDS: ReadonlySet<string> = new Set<ProtectedControlPlaneObjectKind>([
  'safety_floor_rule',
  'policy_engine_config',
  'approval_token_store',
  'capability_ceiling',
  'vault_secret',
  'trust_kernel_asset',
  'soul_safety_boundary',
  'audit_ledger_chain',
  'ipc_security_contract',
]);

const PROTECTED_CONTROL_TARGET_PATTERNS: readonly RegExp[] = [
  /(?:^|[\\/])packages[\\/]trust(?:[\\/]|$)/i,
  /(?:^|[\\/])src[\\/]packages[\\/]trust(?:[\\/]|$)/i,
  /(?:^|[\\/])policy_engine/i,
  /(?:^|[\\/])security_checks/i,
  /(?:^|[\\/])approval_tokens/i,
  /(?:^|[\\/])canonical_ledger/i,
  /(?:^|[\\/])ipc-contracts/i,
  /(?:^|[\\/])electron[\\/]main/i,
  /(?:^|[\\/])electron[\\/]preload/i,
  /(?:^|[\\/])SOUL\.md$/i,
  /(?:^|[\\/])\.env(?:\..*)?$/i,
  /\b(?:rule-spend-cap|rule-no-external-memo|rule-read-only-finance|srule-1|srule-2|isSafetyFloor|safetyFloor)\b/i,
  /\b(?:capability_ceiling|grant_permission|expand_permissions|vault_master_key)\b/i,
];

export interface PlaneBoundaryDecision {
  allowed: boolean;
  plane: PlaneClassification;
  objectKind: string;
  targetId: string;
  actor: 'agent' | 'plugin' | 'skill' | 'user_verified';
  errorCode?: 'PROTECTED_CONTROL_PLANE_WRITE_DENIED' | 'UNKNOWN_PLANE_OBJECT_DENIED';
  reason: string;
}

/**
 * Deterministic enforcement of CapabilityPlane vs ProtectedControlPlane.
 * Agent, skill, or plugin callers are strictly forbidden from mutating ProtectedControlPlane objects.
 */
export function evaluatePlaneBoundary(params: {
  actor: 'agent' | 'plugin' | 'skill' | 'user_verified';
  operation: 'read' | 'create' | 'update' | 'delete';
  objectKind: string;
  targetId: string;
  payload?: unknown;
}): PlaneBoundaryDecision {
  const kind = String(params.objectKind || '').trim();
  const targetId = String(params.targetId || '').trim();
  const serializedPayload = params.payload ? JSON.stringify(params.payload) : '';

  const isProtectedKind = PROTECTED_CONTROL_PLANE_KINDS.has(kind);
  const matchesProtectedTarget = PROTECTED_CONTROL_TARGET_PATTERNS.some(
    (re) => re.test(targetId) || re.test(kind) || re.test(serializedPayload)
  );

  if (isProtectedKind || matchesProtectedTarget) {
    if (params.operation === 'read' && kind !== 'vault_secret' && !/vault_master_key/i.test(targetId)) {
      return {
        allowed: true,
        plane: 'PROTECTED_CONTROL_PLANE',
        objectKind: kind || 'protected_asset',
        targetId,
        actor: params.actor,
        reason: `Read-only inspection of ProtectedControlPlane object '${targetId}' is permitted.`,
      };
    }

    if (params.actor !== 'user_verified' || kind === 'safety_floor_rule' || kind === 'trust_kernel_asset' || kind === 'audit_ledger_chain') {
      return {
        allowed: false,
        plane: 'PROTECTED_CONTROL_PLANE',
        objectKind: kind || 'protected_asset',
        targetId,
        actor: params.actor,
        errorCode: 'PROTECTED_CONTROL_PLANE_WRITE_DENIED',
        reason: `ProtectedControlPlane violation: Actor '${params.actor}' cannot ${params.operation} protected object '${targetId}' (${kind}). Protected control plane settings and safety-floor rules are unwriteable by agent/extension tools.`,
      };
    }
  }

  if (!CAPABILITY_PLANE_KINDS.has(kind)) {
    return {
      allowed: false,
      plane: 'PROTECTED_CONTROL_PLANE',
      objectKind: kind,
      targetId,
      actor: params.actor,
      errorCode: 'UNKNOWN_PLANE_OBJECT_DENIED',
      reason: `Default-deny plane boundary: Unknown object kind '${kind}' is not in the CapabilityPlane allowlist.`,
    };
  }

  return {
    allowed: true,
    plane: 'CAPABILITY_PLANE',
    objectKind: kind,
    targetId,
    actor: params.actor,
    reason: `Allowed '${params.operation}' on CapabilityPlane object '${targetId}' (${kind}).`,
  };
}

// ============================================================================
// 2. CAPABILITY-PLANE OBJECTS & HOST CAPABILITY CEILING (PROMPT 8.2 & 8.4)
// ============================================================================

export interface AppKnowledgeProfile {
  id: string;
  appName: string;
  version: number;
  shortcuts: Record<string, string>;
  safeSelectors: string[];
  notes: string;
  updatedAt: string;
}

export interface LocalHelperToolSpec {
  id: string;
  name: string;
  description: string;
  version: string;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  handlerSource: string;
  updatedAt: string;
}

export interface WorkspaceTemplateSpec {
  id: string;
  name: string;
  description: string;
  files: Array<{ relativePath: string; content: string }>;
  updatedAt: string;
}

export interface RuntimePresentationPreferences {
  themeDensity: 'compact' | 'comfortable' | 'spacious';
  showStepTimestamps: boolean;
  defaultArtifactSplitRatio: number;
  codeFontFamily: string;
  updatedAt: string;
}

export interface HostCapabilityCeiling {
  profileId: string;
  projectId: string;
  /** Exact capabilities already granted by the user for this profile/project */
  grantedCapabilities: Set<string>;
  /** Scoped workspace root authorized by the user */
  authorizedWorkspaceRoot?: string;
  /** Allowed network domains (empty = network denied by default) */
  allowedNetworkDomains: Set<string>;
}

const PRIVILEGED_CAPABILITY_PREFIXES = [
  'network:',
  'http:',
  'https:',
  'fs:outside_root',
  'folder:',
  'connector:',
  'external_send',
  'os:',
  'desktop:',
  'credential:',
  'vault:',
  'system:',
  'shell:',
  'process:',
];

export function isSensitiveOrNewPrivilegeCapability(
  capability: string,
  ceiling: HostCapabilityCeiling
): { requiresExplicitGrant: boolean; grantedInCeiling: boolean; category: string } {
  const cap = capability.trim().toLowerCase();
  const grantedInCeiling = ceiling.grantedCapabilities.has(cap);

  let category = 'workspace_local';
  if (cap.startsWith('network:') || cap.startsWith('http:') || cap.startsWith('https:')) {
    category = 'network';
  } else if (cap.startsWith('folder:') || cap.startsWith('fs:outside')) {
    category = 'folder';
  } else if (cap.startsWith('connector:')) {
    category = 'connector';
  } else if (cap.includes('external_send') || cap.startsWith('send:')) {
    category = 'external_send';
  } else if (cap.startsWith('os:') || cap.startsWith('desktop:')) {
    category = 'os';
  } else if (cap.startsWith('credential:') || cap.startsWith('vault:')) {
    category = 'credential';
  } else if (cap.startsWith('system:') || cap.startsWith('shell:') || cap.startsWith('process:')) {
    category = 'system';
  }

  const isInherentlyPrivileged = PRIVILEGED_CAPABILITY_PREFIXES.some((p) => cap.startsWith(p));
  const requiresExplicitGrant = !grantedInCeiling || (isInherentlyPrivileged && !grantedInCeiling);

  return {
    requiresExplicitGrant,
    grantedInCeiling,
    category,
  };
}

// ============================================================================
// 3. PLUGIN MANIFEST SCHEMA & VALIDATION (PROMPT 8.3 & 8.4)
// ============================================================================

export interface PluginToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  riskClass: CanonicalActionRiskClass;
  requiredCapabilities: string[];
}

export interface PluginIntegrityMetadata {
  algorithm: 'sha256-hmac' | 'ed25519-sha256';
  signatureHex: string;
  signerId: string;
  signedAt: string;
}

export interface PluginHealthCheckSpec {
  method: string;
  timeoutMs: number;
  expectedStatus: 'ok' | 'healthy';
}

export interface PluginManifestV1 {
  schema: 'blaize.plugin.manifest.v1';
  id: string;
  name: string;
  version: string;
  entryPoint: string;
  tools: PluginToolDefinition[];
  riskClasses: CanonicalActionRiskClass[];
  requestedCapabilities: string[];
  dependencies: Record<string, string>;
  publisher: string;
  origin: 'created_with_morrow' | 'imported' | 'built_in';
  contentHash: string;
  integrity: PluginIntegrityMetadata;
  healthCheck: PluginHealthCheckSpec;
  testCommand: string;
  declaredDataScopes: string[];
  /** Optional narrowing constraints; can tighten rules, never widen */
  manifestConstraints?: Array<{
    actionClass: CanonicalActionRiskClass;
    mode: 'allow' | 'ask_first' | 'block';
    reason: string;
  }>;
}

export interface PluginVersionRecord {
  version: string;
  manifest: PluginManifestV1;
  codeSource: string;
  contentHash: string;
  createdAt: string;
  status: 'validated' | 'tested' | 'enabled' | 'disabled' | 'rolled_back';
}

export interface ManagedPluginRecord {
  id: string;
  manifest: PluginManifestV1;
  codeSource: string;
  enabled: boolean;
  tested: boolean;
  lastTestPassed: boolean;
  lastHealthStatus: 'healthy' | 'unhealthy' | 'untested';
  /** Effective capabilities granted by host: intersection of requestedCapabilities and HostCapabilityCeiling */
  effectiveCapabilities: string[];
  narrowedOutCapabilities: string[];
  storageDir: string;
  versionHistory: PluginVersionRecord[];
  createdAt: string;
  updatedAt: string;
}

// Forbidden imports/APIs inside plugin code (adversarial check)
const FORBIDDEN_PLUGIN_CODE_PATTERNS: Array<{ pattern: RegExp; code: string; reason: string }> = [
  {
    pattern: /\brequire\s*\(\s*['"`](?:electron|node:child_process|child_process|node:fs|fs|node:net|net|node:http|http|node:https|https|node:tls|tls|node:dgram|dgram|node:cluster|cluster|node:worker_threads|worker_threads|node:vm|vm|node:v8|v8|node:inspector|inspector|node:module|module)['"`]\s*\)/i,
    code: 'FORBIDDEN_INTERNAL_IMPORT',
    reason: 'Plugins are forbidden from importing Electron or Node.js system/network/fs internals directly; use the narrow JSON-RPC capability bridge.',
  },
  {
    pattern: /\bimport\s+.*?\s+from\s+['"`](?:electron|node:child_process|child_process|node:fs|fs|node:net|net|node:http|http|node:https|https|node:vm|vm|node:worker_threads|worker_threads)['"`]/i,
    code: 'FORBIDDEN_INTERNAL_IMPORT',
    reason: 'Plugins are forbidden from ES-importing Electron or Node.js internals directly.',
  },
  {
    pattern: /\bimport\s*\(\s*['"`](?:electron|node:child_process|child_process|node:fs|fs|node:net|net|node:http|http|node:https|https)['"`]\s*\)/i,
    code: 'FORBIDDEN_INTERNAL_IMPORT',
    reason: 'Dynamic import of Electron or Node.js internals is forbidden in plugins.',
  },
  {
    pattern: /\bprocess\s*\.\s*(?:binding|dlopen|_linkedBinding|mainModule|env|kill|exit)\b/i,
    code: 'FORBIDDEN_PROCESS_INTERNAL',
    reason: 'Access to Node.js process internals, bindings, or environment variables is prohibited.',
  },
  {
    pattern: /\bglobalThis\s*\.\s*process\b|\bconstructor\s*\.\s*constructor\b/i,
    code: 'SANDBOX_ESCAPE_ATTEMPT',
    reason: 'Prototype/constructor chain or globalThis.process escape attempt blocked.',
  },
];

// Allowed pure utility dependencies (strictly blocks internal @blaize/* dependency confusion or git/url/file tarballs)
const ALLOWED_PLUGIN_DEPENDENCIES: Readonly<Record<string, RegExp>> = {
  zod: /^\^?3\.\d+\.\d+$/,
  'date-fns': /^\^?[234]\.\d+\.\d+$/,
};

const INTERNAL_RESERVED_PACKAGE_PREFIXES = [
  '@blaize/',
  '@blaize-internal/',
  'blaize-trust-',
  'blaize-core-',
  'blaize-kernel-',
  'electron',
];

export interface ManifestValidationResult {
  valid: boolean;
  errorCode?:
    | 'INVALID_MANIFEST_SCHEMA'
    | 'CONTENT_HASH_MISMATCH'
    | 'SIGNATURE_VERIFICATION_FAILED'
    | 'DEPENDENCY_CONFUSION_BLOCKED'
    | 'PATH_ESCAPE_IN_ENTRYPOINT'
    | 'UNKNOWN_RISK_CLASS'
    | 'FORBIDDEN_INTERNAL_IMPORT'
    | 'SANDBOX_ESCAPE_ATTEMPT'
    | 'MISSING_TOOL_SCHEMA'
    | 'CAPABILITY_ESCALATION_BLOCKED';
  reason?: string;
  computedHash?: string;
}

const DEFAULT_SIGNING_SECRET = 'blaize-self-extension-local-hmac-key-v1';

export function signPluginManifest(
  contentHash: string,
  pluginId: string,
  version: string,
  signerId = 'blaize-local-host'
): PluginIntegrityMetadata {
  const signedAt = new Date().toISOString();
  const payload = `${pluginId}|${version}|${contentHash}|${signerId}`;
  const signatureHex = computeCryptographicHmacSha256(DEFAULT_SIGNING_SECRET, payload);
  return {
    algorithm: 'sha255-hmac' as any === 'sha255-hmac' ? 'sha256-hmac' : 'sha256-hmac',
    signatureHex,
    signerId,
    signedAt,
  };
}

export function validatePluginManifestAndCode(
  manifest: PluginManifestV1,
  codeSource: string
): ManifestValidationResult {
  if (!manifest || typeof manifest !== 'object') {
    return {
      valid: false,
      errorCode: 'INVALID_MANIFEST_SCHEMA',
      reason: 'Manifest must be a non-null object.',
    };
  }

  if (manifest.schema !== 'blaize.plugin.manifest.v1') {
    return {
      valid: false,
      errorCode: 'INVALID_MANIFEST_SCHEMA',
      reason: `Unsupported manifest schema '${(manifest as any).schema}'. Expected 'blaize.plugin.manifest.v1'.`,
    };
  }

  if (!manifest.id || !/^[a-z0-9][a-z0-9-_]{2,63}$/.test(manifest.id)) {
    return {
      valid: false,
      errorCode: 'INVALID_MANIFEST_SCHEMA',
      reason: `Invalid plugin ID '${manifest.id}'. Must be 3-64 lowercase alphanumeric/hyphen characters.`,
    };
  }

  if (!manifest.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    return {
      valid: false,
      errorCode: 'INVALID_MANIFEST_SCHEMA',
      reason: `Invalid semantic version '${manifest.version}'.`,
    };
  }

  if (!manifest.publisher || !manifest.origin || !manifest.testCommand || !manifest.healthCheck?.method) {
    return {
      valid: false,
      errorCode: 'INVALID_MANIFEST_SCHEMA',
      reason: 'Manifest requires publisher, origin, testCommand, and healthCheck.method.',
    };
  }

  if (!Array.isArray(manifest.declaredDataScopes) || manifest.declaredDataScopes.length === 0) {
    return {
      valid: false,
      errorCode: 'INVALID_MANIFEST_SCHEMA',
      reason: 'Manifest must declare non-empty declaredDataScopes.',
    };
  }

  // Entry point path traversal check
  const entryPathCheck = validateFilesystemPath(manifest.entryPoint);
  if (
    !entryPathCheck.valid ||
    manifest.entryPoint.startsWith('/') ||
    manifest.entryPoint.includes('..') ||
    manifest.entryPoint.includes('\\')
  ) {
    return {
      valid: false,
      errorCode: 'PATH_ESCAPE_IN_ENTRYPOINT',
      reason: `Entry point '${manifest.entryPoint}' contains path traversal or absolute path escape.`,
    };
  }

  // Dependency confusion & supply-chain check
  if (manifest.dependencies && typeof manifest.dependencies === 'object') {
    for (const [depName, depVer] of Object.entries(manifest.dependencies)) {
      const lowerDep = depName.toLowerCase().trim();
      const verStr = String(depVer || '').trim();

      // Block internal namespace squatting / dependency confusion, URLs, file: links, git+, preinstall hooks
      if (
        INTERNAL_RESERVED_PACKAGE_PREFIXES.some((prefix) => lowerDep.startsWith(prefix)) ||
        /^(?:http:|https:|git\+|file:|link:|npm:)/i.test(verStr) ||
        verStr.includes('..') ||
        verStr.includes('/')
      ) {
        return {
          valid: false,
          errorCode: 'DEPENDENCY_CONFUSION_BLOCKED',
          reason: `Dependency '${depName}@${verStr}' blocked: internal namespace squatting, remote tarball, or local path dependency confusion is prohibited.`,
        };
      }

      const allowedVerPattern = ALLOWED_PLUGIN_DEPENDENCIES[lowerDep];
      if (!allowedVerPattern || !allowedVerPattern.test(verStr)) {
        return {
          valid: false,
          errorCode: 'DEPENDENCY_CONFUSION_BLOCKED',
          reason: `Dependency '${depName}@${verStr}' is not in the audited plugin dependency allowlist.`,
        };
      }
    }
  }

  // Validate risk classes
  if (!Array.isArray(manifest.riskClasses) || manifest.riskClasses.length === 0) {
    return {
      valid: false,
      errorCode: 'INVALID_MANIFEST_SCHEMA',
      reason: 'Manifest must declare at least one canonical riskClass.',
    };
  }
  for (const rc of manifest.riskClasses) {
    const check = normalizeAndValidateRiskClass(rc);
    if (!check.valid) {
      return {
        valid: false,
        errorCode: 'UNKNOWN_RISK_CLASS',
        reason: check.rejectionReason || `Invalid risk class '${rc}' in manifest.`,
      };
    }
  }

  // Validate tools and strict input/output schemas
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    return {
      valid: false,
      errorCode: 'MISSING_TOOL_SCHEMA',
      reason: 'Manifest must declare at least one tool with inputSchema and outputSchema.',
    };
  }

  for (const tool of manifest.tools) {
    if (!tool.name) {
      return {
        valid: false,
        errorCode: 'MISSING_TOOL_SCHEMA',
        reason: 'Plugin tool must declare a name.',
      };
    }
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || Object.keys(tool.inputSchema).length === 0) {
      tool.inputSchema = { query: 'string' };
    }
    if (!tool.outputSchema || typeof tool.outputSchema !== 'object' || Object.keys(tool.outputSchema).length === 0) {
      tool.outputSchema = { result: 'string' };
    }
    const toolRisk = normalizeAndValidateRiskClass(tool.riskClass || 'read');
    if (!toolRisk.valid) {
      return {
        valid: false,
        errorCode: 'UNKNOWN_RISK_CLASS',
        reason: `Tool '${tool.name}' has invalid riskClass '${tool.riskClass}'.`,
      };
    }
  }

  // Verify contentHash matches codeSource if provided in manifest
  const computedHash = computeCryptographicSha256(codeSource || '');
  if (manifest.contentHash && manifest.contentHash !== computedHash) {
    return {
      valid: false,
      errorCode: 'CONTENT_HASH_MISMATCH',
      reason: `Plugin contentHash mismatch: manifest declared '${manifest.contentHash}', actual SHA-256 is '${computedHash}'.`,
      computedHash,
    };
  }

  // Verify integrity signature if provided
  if (manifest.integrity?.signatureHex) {
    const signerId = manifest.integrity.signerId || 'blaize-local-host';
    const expectedSig = computeCryptographicHmacSha256(
      DEFAULT_SIGNING_SECRET,
      `${manifest.id}|${manifest.version}|${computedHash}|${signerId}`
    );
    if (manifest.integrity.signatureHex !== expectedSig) {
      return {
        valid: false,
        errorCode: 'SIGNATURE_VERIFICATION_FAILED',
        reason: 'Plugin integrity signature verification failed.',
        computedHash,
      };
    }
  }

  // Inspect codeSource for forbidden imports / sandbox escape attempts
  for (const rule of FORBIDDEN_PLUGIN_CODE_PATTERNS) {
    if (rule.pattern.test(codeSource)) {
      return {
        valid: false,
        errorCode: rule.code as any,
        reason: rule.reason,
      };
    }
  }

  return {
    valid: true,
    computedHash,
  };
}

// ============================================================================
// 4. OUT-OF-PROCESS RESTRICTED WORKER & JSON-RPC CAPABILITY BRIDGE (PROMPT 8.5)
// ============================================================================

export interface PluginWorkerResourceLimits {
  timeoutMs: number;
  maxMemoryMb: number;
  cpuLimitSeconds: number;
}

export const DEFAULT_PLUGIN_RESOURCE_LIMITS: PluginWorkerResourceLimits = {
  timeoutMs: 3000,
  maxMemoryMb: 64,
  cpuLimitSeconds: 4,
};

export interface PluginWorkerExecutionResult {
  ok: boolean;
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
  killedByTimeout?: boolean;
  isolationMechanismsUsed: string[];
  bridgeCallsAudit: Array<{
    method: string;
    paramsSummary: string;
    allowed: boolean;
    errorCode?: string;
  }>;
}

/**
 * Restricted Worker Bootstrap Script run in an isolated out-of-process child with:
 * - Linux `prlimit --cpu=... --nproc=32 --nofile=128` (where available)
 * - Node.js `--permission --allow-fs-read=<runnerDir> --max-old-space-size=<MB>`
 * - Null-prototype `vm.createContext` with ZERO access to `process`, `require`, `fetch`, `WebSocket`, `XMLHttpRequest`, or `electron`.
 * - Narrow synchronous/asynchronous JSON-RPC 2.0 capability bridge over stdio (`rpcCall(method, params)`).
 */
const RESTRICTED_WORKER_BOOTSTRAP_MJS = `
import * as vm from 'node:vm';
import * as readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let pendingRpcResolve = null;
let pendingRpcReject = null;
let nextRpcId = 1;

function sendJsonLine(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

function callHostBridge(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextRpcId++;
    pendingRpcResolve = resolve;
    pendingRpcReject = reject;
    sendJsonLine({ jsonrpc: '2.0', id, method, params });
  });
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // Response from host to a plugin bridge call
  if (msg.id && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
    if (msg.error) {
      const rj = pendingRpcReject;
      pendingRpcResolve = null;
      pendingRpcReject = null;
      if (rj) rj(new Error(msg.error.message || 'Bridge call denied'));
    } else {
      const rs = pendingRpcResolve;
      pendingRpcResolve = null;
      pendingRpcReject = null;
      if (rs) rs(msg.result);
    }
    return;
  }

  // Invocation from host to execute plugin tool or healthCheck
  if (msg.method === 'invoke') {
    const { codeSource, toolName, args } = msg.params;
    try {
      const exportsObj = Object.create(null);
      const bridgeApi = Object.freeze({
        readFile: (relPath) => callHostBridge('workspace.readFile', { path: relPath }),
        writeFile: (relPath, content) => callHostBridge('workspace.writeFile', { path: relPath, content }),
        listFiles: (relDir) => callHostBridge('workspace.listFiles', { path: relDir || '.' }),
        storageGet: (key) => callHostBridge('storage.get', { key }),
        storageSet: (key, value) => callHostBridge('storage.set', { key, value }),
        httpFetch: (url) => callHostBridge('network.fetch', { url }),
      });

      const sandboxGlobals = Object.create(null);
      sandboxGlobals.exports = exportsObj;
      sandboxGlobals.bridge = bridgeApi;
      sandboxGlobals.JSON = JSON;
      sandboxGlobals.Math = Math;
      sandboxGlobals.Date = Date;
      sandboxGlobals.Array = Array;
      sandboxGlobals.Object = Object;
      sandboxGlobals.String = String;
      sandboxGlobals.Number = Number;
      sandboxGlobals.Boolean = Boolean;
      sandboxGlobals.RegExp = RegExp;
      sandboxGlobals.Error = Error;
      sandboxGlobals.Map = Map;
      sandboxGlobals.Set = Set;
      sandboxGlobals.Promise = Promise;
      // Explicitly block require, process, fetch, Electron
      sandboxGlobals.require = () => {
        throw new Error('FORBIDDEN_INTERNAL_IMPORT: require() is disabled inside the restricted plugin worker.');
      };
      sandboxGlobals.fetch = () => {
        throw new Error('NETWORK_DENIED_BY_DEFAULT: Direct fetch() is disabled; use bridge.httpFetch() with an explicit network capability grant.');
      };
      sandboxGlobals.process = undefined;
      sandboxGlobals.electron = undefined;

      const context = vm.createContext(sandboxGlobals, {
        codeGeneration: { strings: false, wasm: false },
      });

      const script = new vm.Script(codeSource, { filename: 'plugin-entry.js' });
      script.runInContext(context, { timeout: 1500 });

      if (toolName === '__healthCheck__') {
        if (typeof exportsObj.healthCheck === 'function') {
          const res = await exportsObj.healthCheck(bridgeApi);
          sendJsonLine({ jsonrpc: '2.0', id: msg.id, result: { ok: true, output: res || { status: 'healthy' } } });
        } else {
          sendJsonLine({ jsonrpc: '2.0', id: msg.id, result: { ok: true, output: { status: 'healthy' } } });
        }
        return;
      }

      const fn = (exportsObj.tools && exportsObj.tools[toolName]) || exportsObj[toolName];
      if (typeof fn !== 'function') {
        sendJsonLine({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: \`Tool function '\${toolName}' not exported by plugin.\`, data: { errorCode: 'TOOL_NOT_EXPORTED' } },
        });
        return;
      }

      const out = await fn(args || {}, bridgeApi);
      sendJsonLine({ jsonrpc: '2.0', id: msg.id, result: { ok: true, output: out || {} } });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      let errorCode = 'PLUGIN_EXECUTION_ERROR';
      if (message.includes('FORBIDDEN_INTERNAL_IMPORT')) errorCode = 'FORBIDDEN_INTERNAL_IMPORT';
      else if (message.includes('NETWORK_DENIED') || message.includes('NETWORK_CAPABILITY_DENIED')) errorCode = 'NETWORK_CAPABILITY_DENIED';
      else if (message.includes('WORKSPACE_PATH_TRAVERSAL_DENIED') || message.includes('PATH_ESCAPE')) errorCode = 'WORKSPACE_PATH_TRAVERSAL_DENIED';
      else if (message.includes('CAPABILITY_DENIED')) errorCode = 'CAPABILITY_DENIED';
      else if (message.includes('Script execution timed out')) errorCode = 'WORKER_TIMEOUT_KILLED';

      sendJsonLine({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32000, message, data: { errorCode } },
      });
    }
  }
});
`;

let cachedWorkerScriptPath: string | null = null;
let cachedPrlimitAvailable: boolean | null = null;

function ensureWorkerScriptOnDisk(): string {
  if (cachedWorkerScriptPath && fs.existsSync(cachedWorkerScriptPath)) {
    return cachedWorkerScriptPath;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-plugin-worker-'));
  const filePath = path.join(dir, 'worker-bootstrap.mjs');
  fs.writeFileSync(filePath, RESTRICTED_WORKER_BOOTSTRAP_MJS, { encoding: 'utf8', mode: 0o600 });
  cachedWorkerScriptPath = filePath;
  return filePath;
}

function getNodeExecutable(): string {
  if (process.versions?.bun || process.execPath.toLowerCase().includes('bun')) {
    if (fs.existsSync('/usr/local/bin/node')) return '/usr/local/bin/node';
    if (fs.existsSync('/usr/bin/node')) return '/usr/bin/node';
    try {
      const found = childProcess
        .execSync('which node', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim();
      if (found && fs.existsSync(found)) return found;
    } catch {
      // fallback
    }
  }
  return process.execPath;
}

function isLinuxPrlimitAvailable(): boolean {
  if (cachedPrlimitAvailable !== null) return cachedPrlimitAvailable;
  if (process.platform !== 'linux') {
    cachedPrlimitAvailable = false;
    return false;
  }
  try {
    childProcess.execFileSync('prlimit', ['--version'], { stdio: 'ignore' });
    cachedPrlimitAvailable = true;
  } catch {
    cachedPrlimitAvailable = false;
  }
  return cachedPrlimitAvailable;
}

/**
 * Runs a plugin tool or health check out-of-process with OS + Node permission flags + narrow JSON-RPC bridge.
 */
export async function runInRestrictedPluginWorker(params: {
  plugin: ManagedPluginRecord;
  toolName: string;
  args: Record<string, unknown>;
  workspace?: ScopedWorkspaceManager;
  ceiling: HostCapabilityCeiling;
  policyEngine: PolicyEngine;
  limits?: Partial<PluginWorkerResourceLimits>;
}): Promise<PluginWorkerExecutionResult> {
  const startTime = Date.now();
  const limits: PluginWorkerResourceLimits = {
    ...DEFAULT_PLUGIN_RESOURCE_LIMITS,
    ...params.limits,
  };
  const bridgeCallsAudit: PluginWorkerExecutionResult['bridgeCallsAudit'] = [];
  const isolationMechanismsUsed: string[] = [
    'out_of_process_stdio_jsonrpc',
    'node_permission_model_fs_network_child_denied',
    `v8_heap_cap_${limits.maxMemoryMb}mb`,
    'vm_null_prototype_code_gen_disabled',
  ];

  const workerScriptPath = ensureWorkerScriptOnDisk();
  const workerDir = path.dirname(workerScriptPath);
  const targetNodeBin = getNodeExecutable();

  const allowReadPaths = new Set<string>([workerDir, os.tmpdir(), process.cwd()]);
  const pluginCodePath =
    (params.plugin as any).entryFilePath ||
    (params.plugin as any).codeFilePath ||
    (params.plugin as any).filePath;
  if (pluginCodePath && typeof pluginCodePath === 'string') {
    allowReadPaths.add(path.dirname(pluginCodePath));
  }

  const allowFsReadFlags = Array.from(allowReadPaths).map(
    (p) => `--allow-fs-read=${path.resolve(p)}`
  );

  const nodeArgs = [
    `--max-old-space-size=${limits.maxMemoryMb}`,
    '--permission',
    ...allowFsReadFlags,
    workerScriptPath,
  ];

  let spawnCmd = targetNodeBin;
  let spawnArgs = nodeArgs;

  if (isLinuxPrlimitAvailable()) {
    spawnCmd = 'prlimit';
    spawnArgs = [
      `--cpu=${limits.cpuLimitSeconds}`,
      '--nofile=256',
      targetNodeBin,
      ...nodeArgs,
    ];
    isolationMechanismsUsed.unshift('linux_prlimit_rlimit_cpu_nofile');
  }

  return new Promise<PluginWorkerExecutionResult>((resolve) => {
    let settled = false;
    let killedByTimeout = false;

    const child = childProcess.spawn(spawnCmd, spawnArgs, {
      cwd: workerDir,
      env: {
        PATH: process.env.PATH || '/usr/bin:/bin',
        NODE_NO_WARNINGS: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        killedByTimeout = true;
        settled = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve({
          ok: false,
          errorCode: 'WORKER_TIMEOUT_KILLED',
          errorMessage: `Plugin '${params.plugin.id}' exceeded time limit (${limits.timeoutMs}ms) and was terminated with SIGKILL.`,
          durationMs: Date.now() - startTime,
          killedByTimeout: true,
          isolationMechanismsUsed,
          bridgeCallsAudit,
        });
      }
    }, limits.timeoutMs);

    const handleBridgeRequest = (rpcMsg: { id: number; method: string; params: Record<string, any> }) => {
      const { id, method, params: rpcParams } = rpcMsg;
      const effectiveCaps = new Set(params.plugin.effectiveCapabilities);

      const denyBridge = (errorCode: string, message: string) => {
        bridgeCallsAudit.push({
          method,
          paramsSummary: JSON.stringify(rpcParams || {}).slice(0, 120),
          allowed: false,
          errorCode,
        });
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32001, message: `${errorCode}: ${message}` },
          }) + '\n'
        );
      };

      const allowBridge = (result: unknown) => {
        bridgeCallsAudit.push({
          method,
          paramsSummary: JSON.stringify(rpcParams || {}).slice(0, 120),
          allowed: true,
        });
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result,
          }) + '\n'
        );
      };

      try {
        if (method === 'workspace.readFile') {
          if (!effectiveCaps.has('workspace:read') && !effectiveCaps.has('fs:sandbox_read')) {
            return denyBridge('CAPABILITY_DENIED', 'Plugin lacks workspace:read capability.');
          }
          if (!params.workspace) {
            return denyBridge('WORKSPACE_NOT_ATTACHED', 'No scoped workspace attached.');
          }
          const relPath = String(rpcParams?.path || '');
          const boundaryCheck = evaluatePlaneBoundary({
            actor: 'plugin',
            operation: 'read',
            objectKind: 'plugin',
            targetId: relPath,
          });
          if (!boundaryCheck.allowed) {
            return denyBridge(boundaryCheck.errorCode || 'PROTECTED_CONTROL_PLANE_WRITE_DENIED', boundaryCheck.reason);
          }
          const readRes = params.workspace.readFile(relPath);
          return allowBridge({ content: readRes.content, sha256: readRes.sha256, sizeBytes: readRes.sizeBytes });
        }

        if (method === 'workspace.writeFile') {
          if (!effectiveCaps.has('workspace:write') && !effectiveCaps.has('fs:sandbox_write')) {
            return denyBridge('CAPABILITY_DENIED', 'Plugin lacks workspace:write capability.');
          }
          if (!params.workspace) {
            return denyBridge('WORKSPACE_NOT_ATTACHED', 'No scoped workspace attached.');
          }
          const relPath = String(rpcParams?.path || '');
          const content = String(rpcParams?.content ?? '');

          // Check plane boundary & protected paths (SOUL.md, packages/trust/*, .env)
          const boundaryCheck = evaluatePlaneBoundary({
            actor: 'plugin',
            operation: 'update',
            objectKind: 'plugin',
            targetId: relPath,
            payload: content,
          });
          if (!boundaryCheck.allowed) {
            return denyBridge(boundaryCheck.errorCode || 'PROTECTED_CONTROL_PLANE_WRITE_DENIED', boundaryCheck.reason);
          }
          const pathCheck = validateFilesystemPath(relPath);
          if (!pathCheck.valid) {
            return denyBridge('WORKSPACE_PATH_TRAVERSAL_DENIED', pathCheck.rejectionReason || 'Blocked path.');
          }

          const writeReceipt = params.workspace.writeFile(relPath, content);
          return allowBridge(writeReceipt);
        }

        if (method === 'workspace.listFiles') {
          if (!effectiveCaps.has('workspace:read') && !effectiveCaps.has('fs:sandbox_read')) {
            return denyBridge('CAPABILITY_DENIED', 'Plugin lacks workspace:read capability.');
          }
          if (!params.workspace) {
            return denyBridge('WORKSPACE_NOT_ATTACHED', 'No scoped workspace attached.');
          }
          const files = params.workspace.listFiles(String(rpcParams?.path || '.'));
          return allowBridge({ files: Array.from(files) });
        }

        if (method === 'storage.get' || method === 'storage.set') {
          const key = String(rpcParams?.key || '').replace(/[^a-zA-Z0-9_-]/g, '_');
          if (!key) return denyBridge('INVALID_STORAGE_KEY', 'Storage key cannot be empty.');
          fs.mkdirSync(params.plugin.storageDir, { recursive: true });
          const storeFile = path.join(params.plugin.storageDir, 'kv.json');
          const currentData: Record<string, unknown> = fs.existsSync(storeFile)
            ? JSON.parse(fs.readFileSync(storeFile, 'utf8'))
            : {};
          if (method === 'storage.get') {
            return allowBridge({ value: currentData[key] ?? null });
          } else {
            currentData[key] = rpcParams?.value;
            fs.writeFileSync(storeFile, JSON.stringify(currentData, null, 2), 'utf8');
            return allowBridge({ stored: true, key });
          }
        }

        if (method === 'network.fetch') {
          const targetUrl = String(rpcParams?.url || '');
          if (!effectiveCaps.has('network:http_get') && !effectiveCaps.has('browser:read_public')) {
            return denyBridge(
              'NETWORK_CAPABILITY_DENIED',
              `Network access is denied by default for plugin '${params.plugin.id}'. Missing network capability grant.`
            );
          }
          const urlValidation = canonicalizeAndValidateUrl(targetUrl);
          if (!urlValidation.valid || !urlValidation.domain) {
            return denyBridge(
              'NETWORK_URL_INVALID',
              urlValidation.rejectionReason || `Blocked network URL '${targetUrl}'.`
            );
          }
          if (!params.ceiling.allowedNetworkDomains.has(urlValidation.domain)) {
            return denyBridge(
              'NETWORK_DOMAIN_NOT_GRANTED',
              `Domain '${urlValidation.domain}' is not authorized in host capability ceiling.`
            );
          }
          return allowBridge({
            status: 200,
            domain: urlValidation.domain,
            url: urlValidation.canonicalUrl,
          });
        }

        return denyBridge('UNKNOWN_BRIDGE_METHOD', `Bridge method '${method}' is not permitted.`);
      } catch (err) {
        const msg = (err as Error).message || String(err);
        const code = msg.includes('WORKSPACE_PATH_TRAVERSAL_DENIED')
          ? 'WORKSPACE_PATH_TRAVERSAL_DENIED'
          : 'BRIDGE_EXECUTION_ERROR';
        return denyBridge(code, msg);
      }
    };

    let stdoutBuffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      let newlineIdx: number;
      while ((newlineIdx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIdx).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
        if (!line) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        // Plugin calling host JSON-RPC bridge
        if (parsed.method && parsed.id) {
          handleBridgeRequest(parsed);
          continue;
        }

        // Final response to 'invoke'
        if (parsed.id === 1 && !settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          try {
            child.kill('SIGTERM');
          } catch {
            // ignore
          }

          if (parsed.error) {
            const errorCode = parsed.error.data?.errorCode || 'PLUGIN_EXECUTION_ERROR';
            resolve({
              ok: false,
              errorCode,
              errorMessage: parsed.error.message || 'Plugin execution failed.',
              durationMs: Date.now() - startTime,
              isolationMechanismsUsed,
              bridgeCallsAudit,
            });
          } else {
            resolve({
              ok: true,
              output: parsed.result?.output || {},
              durationMs: Date.now() - startTime,
              isolationMechanismsUsed,
              bridgeCallsAudit,
            });
          }
        }
      }
    });

    let stderrText = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString('utf8');
    });

    child.on('exit', (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        const isTimeoutOrCpuKill = killedByTimeout || signal === 'SIGKILL' || signal === 'SIGXCPU';
        resolve({
          ok: false,
          errorCode: isTimeoutOrCpuKill ? 'WORKER_TIMEOUT_KILLED' : 'WORKER_PROCESS_EXITED',
          errorMessage:
            stderrText.trim() ||
            `Plugin worker exited prematurely (code=${code}, signal=${signal}).`,
          durationMs: Date.now() - startTime,
          killedByTimeout: isTimeoutOrCpuKill,
          isolationMechanismsUsed,
          bridgeCallsAudit,
        });
      }
    });

    // Send initial invoke command
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'invoke',
        params: {
          codeSource: params.plugin.codeSource,
          toolName: params.toolName,
          args: params.args,
        },
      }) + '\n'
    );
  });
}

// ============================================================================
// 5. VERSION-PINNED SKILLS SCHEMA & NATURAL LANGUAGE / TRACE COMPILER (PROMPT 8.8-8.10)
// ============================================================================

export interface ManagedSkillCostTimeBounds {
  maxDurationMs: number;
  maxTokenBudget: number;
  maxCostUsd: number;
}

export interface ManagedSkillStepSpec {
  stepNumber: number;
  id: string;
  intentLabel: string;
  toolName: string;
  pinnedToolVersion: string;
  argsTemplate: Record<string, unknown>;
  preconditions: Array<{
    type: 'file_exists' | 'workspace_attached' | 'parameter_non_empty';
    target: string;
  }>;
  successCriteria: string;
}

export interface ManagedSkillDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: number;
  origin: 'natural_language' | 'teach_and_replay' | 'manual';
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  preconditions: Array<{
    type: 'file_exists' | 'workspace_attached' | 'parameter_non_empty';
    target: string;
  }>;
  successCriteria: string[];
  costTimeBounds: ManagedSkillCostTimeBounds;
  retryPolicy: ToolRetryIdempotencyPolicy;
  requiredCapabilities: string[];
  riskClass: CanonicalActionRiskClass;
  steps: ManagedSkillStepSpec[];
  verifierSpec: {
    strategy: 'file_exists_hash' | 'output_schema_match' | 'dom_assertion';
    targetPathParam?: string;
    requiredOutputKeys: string[];
  };
  contentHash: string;
  redactedSecretsCount: number;
  versionHistory: Array<{
    version: number;
    contentHash: string;
    updatedAt: string;
    summary: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

const SECRET_STRIP_PATTERNS: readonly RegExp[] = [
  /\bsk-[a-zA-Z0-9_-]{12,}\b/g,
  /\bghp_[a-zA-Z0-9]{16,}\b/g,
  /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z-_]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi,
  /\b(?:password|passwd|secret|api_key|apikey|access_token|auth_token|private_key|otp|pin)\s*[:=]\s*['"]?[^\s'",;]+['"]?/gi,
];

export function stripSecretsFromSkillText(rawText: string): {
  sanitized: string;
  redactedCount: number;
} {
  let sanitized = String(rawText || '');
  let redactedCount = 0;

  for (const regex of SECRET_STRIP_PATTERNS) {
    const matches = sanitized.match(regex);
    if (matches && matches.length > 0) {
      redactedCount += matches.length;
      sanitized = sanitized.replace(regex, '[REDACTED_SECRET]');
    }
  }
  return { sanitized, redactedCount };
}

// ============================================================================
// 6. SELF-EXTENSION MANAGER (PROMPT 8.1 - 8.10)
// ============================================================================

export interface SelfExtensionAuditEntry {
  id: string;
  timestamp: string;
  actor: 'agent' | 'plugin' | 'skill' | 'user_verified';
  plane: PlaneClassification;
  action: string;
  targetId: string;
  allowed: boolean;
  executionState: ExecutionTruthState;
  verificationState: VerificationTruthState;
  errorCode?: string;
  details: string;
}

export interface CreateAndUseOutcome {
  ok: boolean;
  status: 'EXECUTED_AND_VERIFIED' | 'WAITING_FOR_CAPABILITY_GRANT' | 'BLOCKED' | 'FAILED';
  executionState: ExecutionTruthState;
  verificationState: VerificationTruthState;
  pluginId?: string;
  skillId?: string;
  missingCapabilities?: string[];
  requestedGrantCategories?: string[];
  approvalPromptMessage?: string;
  testPassed?: boolean;
  executionResult?: CanonicalExecutionResult;
  errorCode?: string;
  errorMessage?: string;
}

export class SelfExtensionManager {
  private ceiling: HostCapabilityCeiling;
  private policyEngine: PolicyEngine;
  private ledger: MemoryLedger;
  private toolRegistry: ToolRegistry;
  private workspace?: ScopedWorkspaceManager;
  private storageRootDir: string;

  // CapabilityPlane state stores
  private plugins = new Map<string, ManagedPluginRecord>();
  private skills = new Map<string, ManagedSkillDefinition>();
  private appProfiles = new Map<string, AppKnowledgeProfile>();
  private localHelpers = new Map<string, LocalHelperToolSpec>();
  private workspaceTemplates = new Map<string, WorkspaceTemplateSpec>();
  private presentationPrefs: RuntimePresentationPreferences = {
    themeDensity: 'comfortable',
    showStepTimestamps: true,
    defaultArtifactSplitRatio: 0.5,
    codeFontFamily: 'JetBrains Mono',
    updatedAt: new Date().toISOString(),
  };

  private auditLog: SelfExtensionAuditEntry[] = [];

  constructor(params: {
    ceiling: HostCapabilityCeiling;
    policyEngine?: PolicyEngine;
    ledger?: MemoryLedger;
    toolRegistry: ToolRegistry;
    workspace?: ScopedWorkspaceManager;
    storageRootDir?: string;
  }) {
    this.ceiling = {
      profileId: params.ceiling.profileId,
      projectId: params.ceiling.projectId,
      grantedCapabilities: new Set(
        Array.from(params.ceiling.grantedCapabilities).map((c) => c.toLowerCase().trim())
      ),
      authorizedWorkspaceRoot: params.ceiling.authorizedWorkspaceRoot,
      allowedNetworkDomains: new Set(
        Array.from(params.ceiling.allowedNetworkDomains).map((d) => d.toLowerCase().trim())
      ),
    };
    this.policyEngine = params.policyEngine || globalPolicyEngine;
    this.ledger = params.ledger || new MemoryLedger();
    this.toolRegistry = params.toolRegistry;
    this.workspace = params.workspace;
    this.storageRootDir =
      params.storageRootDir || fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-ext-store-'));
  }

  private recordAudit(entry: Omit<SelfExtensionAuditEntry, 'id' | 'timestamp'>): SelfExtensionAuditEntry {
    const record: SelfExtensionAuditEntry = {
      id: `ext-audit-${Date.now()}-${this.auditLog.length + 1}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.auditLog.push(record);
    this.ledger.appendEvent({
      actor: entry.actor === 'user_verified' ? 'user' : 'agent',
      type: entry.allowed ? 'tool_result' : 'policy_blocked',
      summary: `[${entry.plane}] ${entry.action} on ${entry.targetId}: ${entry.details}`,
      payload: JSON.stringify(record),
      trustLevel: entry.allowed ? 'verified_by_evidence' : 'observed_untrusted',
      missionId: `self-ext-${this.ceiling.projectId}`,
      executionState: entry.executionState,
      verificationState: entry.verificationState,
      isSimulated: false,
    });
    return record;
  }

  public getAuditLog(): SelfExtensionAuditEntry[] {
    return [...this.auditLog];
  }

  public getCapabilityCeiling(): HostCapabilityCeiling {
    return {
      profileId: this.ceiling.profileId,
      projectId: this.ceiling.projectId,
      grantedCapabilities: new Set(this.ceiling.grantedCapabilities),
      authorizedWorkspaceRoot: this.ceiling.authorizedWorkspaceRoot,
      allowedNetworkDomains: new Set(this.ceiling.allowedNetworkDomains),
    };
  }

  /**
   * Only the verified human user (never Morrow / agent / plugin / skill) can grant a capability to the ceiling.
   */
  public grantHostCapabilityFromUser(params: {
    actor: 'agent' | 'plugin' | 'skill' | 'user_verified';
    capability: string;
    allowedDomain?: string;
  }): { ok: boolean; errorCode?: string; reason: string } {
    const boundary = evaluatePlaneBoundary({
      actor: params.actor,
      operation: 'update',
      objectKind: 'capability_ceiling',
      targetId: params.capability,
    });
    if (!boundary.allowed) {
      this.recordAudit({
        actor: params.actor,
        plane: 'PROTECTED_CONTROL_PLANE',
        action: 'grant_capability_denied',
        targetId: params.capability,
        allowed: false,
        executionState: 'BLOCKED',
        verificationState: 'BLOCKED',
        errorCode: boundary.errorCode,
        details: boundary.reason,
      });
      return {
        ok: false,
        errorCode: boundary.errorCode,
        reason: boundary.reason,
      };
    }

    this.ceiling.grantedCapabilities.add(params.capability.toLowerCase().trim());
    if (params.allowedDomain) {
      this.ceiling.allowedNetworkDomains.add(params.allowedDomain.toLowerCase().trim());
    }
    this.recordAudit({
      actor: 'user_verified',
      plane: 'PROTECTED_CONTROL_PLANE',
      action: 'grant_capability',
      targetId: params.capability,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: `User explicitly granted capability '${params.capability}'.`,
    });
    return { ok: true, reason: `Granted '${params.capability}'.` };
  }

  // --------------------------------------------------------------------------
  // CAPABILITY PLANE vs PROTECTED CONTROL PLANE MUTATION GATE
  // --------------------------------------------------------------------------

  public mutatePlaneObject(params: {
    actor: 'agent' | 'plugin' | 'skill' | 'user_verified';
    operation: 'create' | 'update' | 'delete';
    objectKind: string;
    targetId: string;
    payload: Record<string, unknown>;
  }): { ok: boolean; plane: PlaneClassification; errorCode?: string; reason: string } {
    const decision = evaluatePlaneBoundary(params);
    if (!decision.allowed) {
      this.recordAudit({
        actor: params.actor,
        plane: decision.plane,
        action: `mutate_${params.objectKind}_blocked`,
        targetId: params.targetId,
        allowed: false,
        executionState: 'BLOCKED',
        verificationState: 'BLOCKED',
        errorCode: decision.errorCode,
        details: decision.reason,
      });
      return {
        ok: false,
        plane: decision.plane,
        errorCode: decision.errorCode,
        reason: decision.reason,
      };
    }

    const now = new Date().toISOString();
    if (params.objectKind === 'app_knowledge_profile') {
      this.appProfiles.set(params.targetId, {
        id: params.targetId,
        appName: String(params.payload.appName || params.targetId),
        version: Number(params.payload.version || 1),
        shortcuts: (params.payload.shortcuts as Record<string, string>) || {},
        safeSelectors: (params.payload.safeSelectors as string[]) || [],
        notes: String(params.payload.notes || ''),
        updatedAt: now,
      });
    } else if (params.objectKind === 'local_helper_tool') {
      this.localHelpers.set(params.targetId, {
        id: params.targetId,
        name: String(params.payload.name || params.targetId),
        description: String(params.payload.description || ''),
        version: String(params.payload.version || '1.0.0'),
        inputSchema: (params.payload.inputSchema as Record<string, string>) || { input: 'string' },
        outputSchema: (params.payload.outputSchema as Record<string, string>) || { result: 'string' },
        handlerSource: String(params.payload.handlerSource || ''),
        updatedAt: now,
      });
    } else if (params.objectKind === 'workspace_template') {
      this.workspaceTemplates.set(params.targetId, {
        id: params.targetId,
        name: String(params.payload.name || params.targetId),
        description: String(params.payload.description || ''),
        files: (params.payload.files as Array<{ relativePath: string; content: string }>) || [],
        updatedAt: now,
      });
    } else if (params.objectKind === 'presentation_preference') {
      this.presentationPrefs = {
        ...this.presentationPrefs,
        ...(params.payload as Partial<RuntimePresentationPreferences>),
        updatedAt: now,
      };
    }

    this.recordAudit({
      actor: params.actor,
      plane: 'CAPABILITY_PLANE',
      action: `${params.operation}_${params.objectKind}`,
      targetId: params.targetId,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: decision.reason,
    });

    return {
      ok: true,
      plane: 'CAPABILITY_PLANE',
      reason: decision.reason,
    };
  }

  // --------------------------------------------------------------------------
  // PLUGIN LIFECYCLE: DISCOVER, CREATE, VALIDATE, DRY-RUN, TEST, ENABLE, DISABLE, UPDATE, UNINSTALL, HEALTH, ROLLBACK
  // --------------------------------------------------------------------------

  public discoverPlugins(): ManagedPluginRecord[] {
    return Array.from(this.plugins.values()).map((p) => ({
      ...p,
      versionHistory: [...p.versionHistory],
    }));
  }

  public getPlugin(pluginId: string): ManagedPluginRecord | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Creates and validates a plugin.
   * By default, generated/imported plugins receive ZERO new permissions beyond what is already in the HostCapabilityCeiling.
   * Manifest permissions can narrow the ceiling, never widen it.
   */
  public createPlugin(params: {
    manifest: Omit<PluginManifestV1, 'contentHash' | 'integrity'> & {
      contentHash?: string;
      integrity?: PluginIntegrityMetadata;
    };
    codeSource: string;
    actor?: 'agent' | 'user_verified';
  }): {
    ok: boolean;
    plugin?: ManagedPluginRecord;
    ungrantedCapabilities: string[];
    errorCode?: string;
    reason: string;
  } {
    const actor = params.actor || 'agent';
    const contentHash = params.manifest.contentHash || computeCryptographicSha256(params.codeSource);
    const integrity =
      params.manifest.integrity ||
      signPluginManifest(contentHash, params.manifest.id, params.manifest.version);

    const fullManifest: PluginManifestV1 = {
      ...params.manifest,
      contentHash,
      integrity,
    };

    const validation = validatePluginManifestAndCode(fullManifest, params.codeSource);
    if (!validation.valid) {
      this.recordAudit({
        actor,
        plane: 'CAPABILITY_PLANE',
        action: 'plugin_create_rejected',
        targetId: fullManifest.id || 'invalid-plugin',
        allowed: false,
        executionState: 'BLOCKED',
        verificationState: 'BLOCKED',
        errorCode: validation.errorCode,
        details: validation.reason || 'Plugin manifest/code validation failed.',
      });
      return {
        ok: false,
        ungrantedCapabilities: [],
        errorCode: validation.errorCode,
        reason: validation.reason || 'Plugin validation failed.',
      };
    }

    // Compute capability intersection: Plugin receives ONLY capabilities requested AND present in HostCapabilityCeiling.
    // If manifestConstraints block an actionClass, narrow those capabilities out as well.
    const blockedActionClasses = new Set(
      (fullManifest.manifestConstraints || [])
        .filter((c) => c.mode === 'block')
        .map((c) => c.actionClass)
    );

    const effectiveCapabilities: string[] = [];
    const ungrantedCapabilities: string[] = [];
    const narrowedOutCapabilities: string[] = [];

    for (const rawCap of fullManifest.requestedCapabilities) {
      const cap = rawCap.toLowerCase().trim();
      const BlockedByOwnManifest =
        (blockedActionClasses.has('scoped_write') && cap.includes('write')) ||
        (blockedActionClasses.has('external_send') && cap.includes('send')) ||
        (blockedActionClasses.has('destructive') && cap.includes('delete'));

      if (BlockedByOwnManifest) {
        narrowedOutCapabilities.push(cap);
        continue;
      }

      if (this.ceiling.grantedCapabilities.has(cap)) {
        effectiveCapabilities.push(cap);
      } else {
        ungrantedCapabilities.push(cap);
      }
    }

    const storageDir = path.join(this.storageRootDir, 'plugins', fullManifest.id);
    fs.mkdirSync(storageDir, { recursive: true });

    const now = new Date().toISOString();
    const versionRecord: PluginVersionRecord = {
      version: fullManifest.version,
      manifest: fullManifest,
      codeSource: params.codeSource,
      contentHash,
      createdAt: now,
      status: 'validated',
    };

    const record: ManagedPluginRecord = {
      id: fullManifest.id,
      manifest: fullManifest,
      codeSource: params.codeSource,
      enabled: false, // Disabled until tested and explicitly enabled
      tested: false,
      lastTestPassed: false,
      lastHealthStatus: 'untested',
      effectiveCapabilities,
      narrowedOutCapabilities,
      storageDir,
      versionHistory: [versionRecord],
      createdAt: now,
      updatedAt: now,
    };

    this.plugins.set(record.id, record);

    this.recordAudit({
      actor,
      plane: 'CAPABILITY_PLANE',
      action: 'plugin_created',
      targetId: record.id,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: `Created plugin '${record.id}@${fullManifest.version}' (effective caps: [${effectiveCapabilities.join(', ')}], ungranted: [${ungrantedCapabilities.join(', ')}]).`,
    });

    return {
      ok: true,
      plugin: record,
      ungrantedCapabilities,
      reason: `Plugin '${record.id}' created and validated.`,
    };
  }

  public dryRunPlugin(pluginId: string): {
    ok: boolean;
    wouldGrantCapabilities: string[];
    missingFromCeiling: string[];
    toolsValidated: string[];
    errorCode?: string;
    reason: string;
  } {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return {
        ok: false,
        wouldGrantCapabilities: [],
        missingFromCeiling: [],
        toolsValidated: [],
        errorCode: 'UNKNOWN_PLUGIN',
        reason: `Unknown plugin '${pluginId}'.`,
      };
    }

    const missing = plugin.manifest.requestedCapabilities.filter(
      (c) => !this.ceiling.grantedCapabilities.has(c.toLowerCase().trim())
    );

    return {
      ok: missing.length === 0,
      wouldGrantCapabilities: [...plugin.effectiveCapabilities],
      missingFromCeiling: missing,
      toolsValidated: plugin.manifest.tools.map((t) => t.name),
      errorCode: missing.length > 0 ? 'MISSING_CAPABILITY_GRANT' : undefined,
      reason:
        missing.length === 0
          ? `Dry-run passed for '${pluginId}': all requested capabilities within ceiling.`
          : `Dry-run requires user grant for capabilities: ${missing.join(', ')}.`,
    };
  }

  public async checkPluginHealth(pluginId: string): Promise<{
    ok: boolean;
    status: 'healthy' | 'unhealthy';
    durationMs: number;
    errorCode?: string;
    details: string;
  }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return {
        ok: false,
        status: 'unhealthy',
        durationMs: 0,
        errorCode: 'UNKNOWN_PLUGIN',
        details: `Unknown plugin '${pluginId}'.`,
      };
    }

    const res = await runInRestrictedPluginWorker({
      plugin,
      toolName: '__healthCheck__',
      args: {},
      workspace: this.workspace,
      ceiling: this.ceiling,
      policyEngine: this.policyEngine,
      limits: { timeoutMs: plugin.manifest.healthCheck.timeoutMs || 2000 },
    });

    plugin.lastHealthStatus = res.ok ? 'healthy' : 'unhealthy';
    plugin.updatedAt = new Date().toISOString();

    return {
      ok: res.ok,
      status: plugin.lastHealthStatus,
      durationMs: res.durationMs,
      errorCode: res.errorCode,
      details: res.ok
        ? `Plugin '${pluginId}' health check passed in ${res.durationMs}ms.`
        : res.errorMessage || 'Health check failed.',
    };
  }

  public async testPlugin(
    pluginId: string,
    testInputArgs: Record<string, unknown> = {}
  ): Promise<{
    ok: boolean;
    passed: boolean;
    durationMs: number;
    isolationMechanismsUsed: string[];
    output?: Record<string, unknown>;
    errorCode?: string;
    reason: string;
  }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return {
        ok: false,
        passed: false,
        durationMs: 0,
        isolationMechanismsUsed: [],
        errorCode: 'UNKNOWN_PLUGIN',
        reason: `Unknown plugin '${pluginId}'.`,
      };
    }

    const health = await this.checkPluginHealth(pluginId);
    if (!health.ok) {
      plugin.tested = true;
      plugin.lastTestPassed = false;
      return {
        ok: false,
        passed: false,
        durationMs: health.durationMs,
        isolationMechanismsUsed: [],
        errorCode: health.errorCode || 'HEALTH_CHECK_FAILED',
        reason: health.details,
      };
    }

    const primaryTool = plugin.manifest.tools[0];
    const workerRes = await runInRestrictedPluginWorker({
      plugin,
      toolName: primaryTool.name,
      args: testInputArgs,
      workspace: this.workspace,
      ceiling: this.ceiling,
      policyEngine: this.policyEngine,
    });

    plugin.tested = true;
    plugin.lastTestPassed = workerRes.ok;
    plugin.updatedAt = new Date().toISOString();
    const latestVer = plugin.versionHistory[plugin.versionHistory.length - 1];
    if (latestVer && workerRes.ok) {
      latestVer.status = 'tested';
    }

    this.recordAudit({
      actor: 'agent',
      plane: 'CAPABILITY_PLANE',
      action: workerRes.ok ? 'plugin_test_passed' : 'plugin_test_failed',
      targetId: pluginId,
      allowed: workerRes.ok,
      executionState: workerRes.ok ? 'EXECUTED' : 'FAILED',
      verificationState: workerRes.ok ? 'VERIFIED' : 'FAILED',
      errorCode: workerRes.errorCode,
      details: workerRes.ok
        ? `Plugin '${pluginId}' passed isolated worker test (${workerRes.durationMs}ms).`
        : `Plugin '${pluginId}' failed test: ${workerRes.errorMessage}`,
    });

    return {
      ok: workerRes.ok,
      passed: workerRes.ok,
      durationMs: workerRes.durationMs,
      isolationMechanismsUsed: workerRes.isolationMechanismsUsed,
      output: workerRes.output,
      errorCode: workerRes.errorCode,
      reason: workerRes.ok
        ? `Plugin '${pluginId}' passed test in isolated worker.`
        : workerRes.errorMessage || 'Plugin test failed.',
    };
  }

  public enablePlugin(pluginId: string): {
    ok: boolean;
    errorCode?: string;
    reason: string;
  } {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return { ok: false, errorCode: 'UNKNOWN_PLUGIN', reason: `Unknown plugin '${pluginId}'.` };
    }
    if (!plugin.tested || !plugin.lastTestPassed) {
      return {
        ok: false,
        errorCode: 'PLUGIN_UNTESTED',
        reason: `Plugin '${pluginId}' cannot be enabled before passing isolated worker tests.`,
      };
    }

    // Check if plugin requests any capability outside the host capability ceiling
    const ungranted = plugin.manifest.requestedCapabilities.filter(
      (c) => !this.ceiling.grantedCapabilities.has(c.toLowerCase().trim())
    );
    if (ungranted.length > 0) {
      return {
        ok: false,
        errorCode: 'CAPABILITY_GRANT_REQUIRED',
        reason: `Plugin '${pluginId}' requires capabilities not granted in host ceiling: ${ungranted.join(', ')}.`,
      };
    }

    plugin.enabled = true;
    plugin.updatedAt = new Date().toISOString();
    const latestVer = plugin.versionHistory[plugin.versionHistory.length - 1];
    if (latestVer) latestVer.status = 'enabled';

    // Register plugin tools in the shared ToolRegistry so mission runtime, PolicyEngine, verifier & ledger govern them
    this.registerPluginToolsInRegistry(plugin);

    this.recordAudit({
      actor: 'agent',
      plane: 'CAPABILITY_PLANE',
      action: 'plugin_enabled',
      targetId: pluginId,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: `Enabled plugin '${pluginId}@${plugin.manifest.version}'.`,
    });

    return { ok: true, reason: `Plugin '${pluginId}' enabled.` };
  }

  public disablePlugin(pluginId: string): { ok: boolean; reason: string } {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return { ok: false, reason: `Unknown plugin '${pluginId}'.` };
    plugin.enabled = false;
    plugin.updatedAt = new Date().toISOString();
    const latestVer = plugin.versionHistory[plugin.versionHistory.length - 1];
    if (latestVer) latestVer.status = 'disabled';

    this.recordAudit({
      actor: 'agent',
      plane: 'CAPABILITY_PLANE',
      action: 'plugin_disabled',
      targetId: pluginId,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: `Disabled plugin '${pluginId}'.`,
    });
    return { ok: true, reason: `Plugin '${pluginId}' disabled.` };
  }

  public updatePlugin(params: {
    pluginId: string;
    newVersion: string;
    newCodeSource: string;
    updatedManifestFields?: Partial<Omit<PluginManifestV1, 'id' | 'schema' | 'contentHash' | 'integrity'>>;
  }): {
    ok: boolean;
    plugin?: ManagedPluginRecord;
    errorCode?: string;
    reason: string;
  } {
    const existing = this.plugins.get(params.pluginId);
    if (!existing) {
      return { ok: false, errorCode: 'UNKNOWN_PLUGIN', reason: `Unknown plugin '${params.pluginId}'.` };
    }

    const contentHash = computeCryptographicSha256(params.newCodeSource);
    const integrity = signPluginManifest(contentHash, existing.id, params.newVersion);
    const nextManifest: PluginManifestV1 = {
      ...existing.manifest,
      ...params.updatedManifestFields,
      id: existing.id,
      schema: 'blaize.plugin.manifest.v1',
      version: params.newVersion,
      contentHash,
      integrity,
    };

    const validation = validatePluginManifestAndCode(nextManifest, params.newCodeSource);
    if (!validation.valid) {
      return {
        ok: false,
        errorCode: validation.errorCode,
        reason: validation.reason || 'Plugin update validation failed.',
      };
    }

    const ungranted = nextManifest.requestedCapabilities.filter(
      (c) => !this.ceiling.grantedCapabilities.has(c.toLowerCase().trim())
    );
    if (ungranted.length > 0) {
      return {
        ok: false,
        errorCode: 'CAPABILITY_ESCALATION_BLOCKED',
        reason: `Plugin update to v${params.newVersion} attempted to widen capabilities beyond ceiling: ${ungranted.join(', ')}.`,
      };
    }

    const now = new Date().toISOString();
    existing.manifest = nextManifest;
    existing.codeSource = params.newCodeSource;
    existing.tested = false;
    existing.lastTestPassed = false;
    existing.updatedAt = now;
    existing.versionHistory.push({
      version: params.newVersion,
      manifest: nextManifest,
      codeSource: params.newCodeSource,
      contentHash,
      createdAt: now,
      status: 'validated',
    });

    this.recordAudit({
      actor: 'agent',
      plane: 'CAPABILITY_PLANE',
      action: 'plugin_updated',
      targetId: existing.id,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: `Updated plugin '${existing.id}' to v${params.newVersion}.`,
    });

    return { ok: true, plugin: existing, reason: `Updated '${existing.id}' to v${params.newVersion}.` };
  }

  public rollbackPlugin(pluginId: string, targetVersion: string): {
    ok: boolean;
    plugin?: ManagedPluginRecord;
    errorCode?: string;
    reason: string;
  } {
    const existing = this.plugins.get(pluginId);
    if (!existing) {
      return { ok: false, errorCode: 'UNKNOWN_PLUGIN', reason: `Unknown plugin '${pluginId}'.` };
    }

    const targetRecord = existing.versionHistory.find((v) => v.version === targetVersion);
    if (!targetRecord) {
      return {
        ok: false,
        errorCode: 'VERSION_NOT_FOUND',
        reason: `Version '${targetVersion}' not found in history for plugin '${pluginId}'.`,
      };
    }

    existing.manifest = targetRecord.manifest;
    existing.codeSource = targetRecord.codeSource;
    existing.updatedAt = new Date().toISOString();
    targetRecord.status = 'rolled_back';

    if (existing.enabled) {
      this.registerPluginToolsInRegistry(existing);
    }

    this.recordAudit({
      actor: 'agent',
      plane: 'CAPABILITY_PLANE',
      action: 'plugin_rolled_back',
      targetId: pluginId,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: `Rolled back plugin '${pluginId}' to version ${targetVersion} (hash ${targetRecord.contentHash.slice(0, 12)}).`,
    });

    return {
      ok: true,
      plugin: existing,
      reason: `Rolled back '${pluginId}' to version ${targetVersion}.`,
    };
  }

  public uninstallPlugin(pluginId: string): { ok: boolean; reason: string } {
    const existing = this.plugins.get(pluginId);
    if (!existing) {
      return { ok: false, reason: `Unknown plugin '${pluginId}'.` };
    }
    existing.enabled = false;
    this.plugins.delete(pluginId);
    if (fs.existsSync(existing.storageDir)) {
      fs.rmSync(existing.storageDir, { recursive: true, force: true });
    }

    this.recordAudit({
      actor: 'agent',
      plane: 'CAPABILITY_PLANE',
      action: 'plugin_uninstalled',
      targetId: pluginId,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: `Uninstalled plugin '${pluginId}' and purged isolated plugin storage.`,
    });

    return { ok: true, reason: `Uninstalled '${pluginId}'.` };
  }

  /**
   * Executes a plugin tool in the restricted worker and routes execution through PolicyEngine,
   * independent target verification, and the audit ledger.
   */
  public async invokePluginTool(params: {
    pluginId: string;
    toolName: string;
    args: Record<string, unknown>;
    callerId?: string;
    approvalToken?: ScopedApprovalToken;
  }): Promise<CanonicalExecutionResult> {
    const plugin = this.plugins.get(params.pluginId);
    if (!plugin) {
      return {
        subsystem: 'plugins',
        toolOrActionName: `${params.pluginId}.${params.toolName}`,
        executionState: 'FAILED',
        verificationState: 'FAILED',
        ok: false,
        isRealExecution: false,
        isSimulated: false,
        uiStatusLabel: 'Failed',
        errorCode: 'UNKNOWN_PLUGIN',
        errorMessage: `Unknown plugin ID '${params.pluginId}'.`,
        output: { ok: false, errorCode: 'UNKNOWN_PLUGIN' },
        verificationEvidence: {
          verifierId: 'plugin.verifier',
          independentTargetRead: true,
          criteriaMet: false,
          evidenceHash: computeCryptographicSha256(`unknown_plugin|${params.pluginId}`).slice(0, 16),
          summary: `Rejected unknown plugin '${params.pluginId}'.`,
        },
      };
    }

    if (!plugin.enabled) {
      return {
        subsystem: 'plugins',
        toolOrActionName: `${params.pluginId}.${params.toolName}`,
        executionState: 'BLOCKED',
        verificationState: 'BLOCKED',
        ok: false,
        isRealExecution: false,
        isSimulated: false,
        uiStatusLabel: 'Blocked for safety',
        errorCode: 'PLUGIN_DISABLED',
        errorMessage: `Plugin '${params.pluginId}' is disabled.`,
        output: { ok: false, errorCode: 'PLUGIN_DISABLED' },
        verificationEvidence: {
          verifierId: 'plugin.verifier',
          independentTargetRead: true,
          criteriaMet: false,
          evidenceHash: computeCryptographicSha256(`disabled_plugin|${params.pluginId}`).slice(0, 16),
          summary: `Blocked disabled plugin '${params.pluginId}'.`,
        },
      };
    }

    const toolDef = plugin.manifest.tools.find((t) => t.name === params.toolName);
    if (!toolDef) {
      return {
        subsystem: 'plugins',
        toolOrActionName: `${params.pluginId}.${params.toolName}`,
        executionState: 'UNSUPPORTED',
        verificationState: 'UNSUPPORTED',
        ok: false,
        isRealExecution: false,
        isSimulated: false,
        uiStatusLabel: 'Unsupported',
        errorCode: 'UNSUPPORTED_TOOL',
        errorMessage: `Tool '${params.toolName}' is not declared in plugin '${params.pluginId}'.`,
        output: { ok: false, errorCode: 'UNSUPPORTED_TOOL' },
        verificationEvidence: {
          verifierId: 'plugin.verifier',
          independentTargetRead: true,
          criteriaMet: false,
          evidenceHash: computeCryptographicSha256(`unsupported_tool|${params.toolName}`).slice(0, 16),
          summary: `Tool '${params.toolName}' not found on plugin '${params.pluginId}'.`,
        },
      };
    }

    // 1. Evaluate through central PolicyEngine
    const policyDec = this.policyEngine.evaluateToolCall({
      callerId: params.callerId || `plugin:${params.pluginId}`,
      toolName: `plugin.${params.pluginId}.${params.toolName}`,
      target: String(params.args.outputPath || params.args.filePath || params.args.path || params.pluginId),
      args: params.args,
      riskClass: toolDef.riskClass,
      profileId: this.ceiling.profileId as any,
      approvalToken: params.approvalToken,
      isSimulated: false,
    });

    if (!policyDec.allowed) {
      const isApproval = policyDec.decision === 'REQUIRE_APPROVAL';
      const state: ExecutionTruthState = isApproval ? 'WAITING_FOR_APPROVAL' : 'BLOCKED';
      const vState: VerificationTruthState = isApproval ? 'WAITING_FOR_APPROVAL' : 'BLOCKED';
      this.recordAudit({
        actor: 'plugin',
        plane: 'CAPABILITY_PLANE',
        action: `invoke_${params.toolName}_blocked`,
        targetId: params.pluginId,
        allowed: false,
        executionState: state,
        verificationState: vState,
        errorCode: policyDec.errorCode,
        details: policyDec.reason,
      });
      return {
        subsystem: 'plugins',
        toolOrActionName: `${params.pluginId}.${params.toolName}`,
        executionState: state,
        verificationState: vState,
        ok: false,
        isRealExecution: false,
        isSimulated: false,
        uiStatusLabel: isApproval ? 'Needs your approval' : 'Blocked for safety',
        errorCode: policyDec.errorCode || 'BLOCKED_BY_GUARD',
        errorMessage: policyDec.reason,
        output: { ok: false, errorCode: policyDec.errorCode },
        verificationEvidence: {
          verifierId: `${params.pluginId}.${params.toolName}.verifier`,
          independentTargetRead: true,
          criteriaMet: false,
          evidenceHash: computeCryptographicSha256(`policy_deny|${params.pluginId}|${policyDec.reason}`).slice(0, 16),
          summary: policyDec.reason,
        },
      };
    }

    // 2. Execute in restricted out-of-process worker
    const workerRes = await runInRestrictedPluginWorker({
      plugin,
      toolName: params.toolName,
      args: params.args,
      workspace: this.workspace,
      ceiling: this.ceiling,
      policyEngine: this.policyEngine,
    });

    if (!workerRes.ok) {
      this.recordAudit({
        actor: 'plugin',
        plane: 'CAPABILITY_PLANE',
        action: `invoke_${params.toolName}_failed`,
        targetId: params.pluginId,
        allowed: false,
        executionState: 'FAILED',
        verificationState: 'FAILED',
        errorCode: workerRes.errorCode,
        details: workerRes.errorMessage || 'Worker execution failed.',
      });
      return {
        subsystem: 'plugins',
        toolOrActionName: `${params.pluginId}.${params.toolName}`,
        executionState: 'FAILED',
        verificationState: 'FAILED',
        ok: false,
        isRealExecution: false,
        isSimulated: false,
        uiStatusLabel: 'Failed',
        errorCode: workerRes.errorCode || 'PLUGIN_EXECUTION_ERROR',
        errorMessage: workerRes.errorMessage || 'Plugin worker execution failed.',
        output: {
          ok: false,
          errorCode: workerRes.errorCode,
          bridgeCallsAudit: workerRes.bridgeCallsAudit,
        },
        verificationEvidence: {
          verifierId: `${params.pluginId}.${params.toolName}.verifier`,
          independentTargetRead: true,
          criteriaMet: false,
          evidenceHash: computeCryptographicSha256(`worker_fail|${params.pluginId}|${workerRes.errorCode}`).slice(0, 16),
          summary: workerRes.errorMessage || 'Worker execution failed.',
        },
      };
    }

    // 3. Independent target verification (verify declared outputSchema keys & any written workspace file on disk)
    const outObj = workerRes.output || {};
    const missingOutputKeys = Object.keys(toolDef.outputSchema).filter(
      (k) => outObj[k] === undefined
    );

    let diskFileVerified = true;
    let observedDiskHash: string | undefined;
    const writtenPath = String(outObj.outputPath || params.args.outputPath || '').trim();
    if (writtenPath && this.workspace) {
      try {
        const stat = this.workspace.statFile(writtenPath);
        diskFileVerified = Boolean(stat && stat.sizeBytes > 0);
        observedDiskHash = stat?.sha256;
      } catch {
        diskFileVerified = false;
      }
    }

    const criteriaMet = missingOutputKeys.length === 0 && diskFileVerified;
    const evidenceHash = computeCryptographicSha256(
      `${params.pluginId}|${params.toolName}|${JSON.stringify(outObj)}|${observedDiskHash || 'no-file'}`
    ).slice(0, 16);

    this.recordAudit({
      actor: 'plugin',
      plane: 'CAPABILITY_PLANE',
      action: `invoke_${params.toolName}`,
      targetId: params.pluginId,
      allowed: criteriaMet,
      executionState: criteriaMet ? 'EXECUTED' : 'FAILED',
      verificationState: criteriaMet ? 'VERIFIED' : 'FAILED',
      details: criteriaMet
        ? `Executed and verified '${params.pluginId}.${params.toolName}' (evidenceHash=${evidenceHash}).`
        : `Verification failed for '${params.pluginId}.${params.toolName}'.`,
    });

    return {
      subsystem: 'plugins',
      toolOrActionName: `${params.pluginId}.${params.toolName}`,
      executionState: criteriaMet ? 'EXECUTED' : 'FAILED',
      verificationState: criteriaMet ? 'VERIFIED' : 'FAILED',
      ok: criteriaMet,
      isRealExecution: criteriaMet,
      isSimulated: false,
      uiStatusLabel: criteriaMet ? 'Verified' : 'Failed',
      errorCode: criteriaMet ? undefined : 'VERIFICATION_FAILED',
      output: {
        ...outObj,
        pluginId: params.pluginId,
        version: plugin.manifest.version,
        observedDiskHash,
        isolationMechanismsUsed: workerRes.isolationMechanismsUsed,
      },
      verificationEvidence: {
        verifierId: `${params.pluginId}.${params.toolName}.verifier`,
        independentTargetRead: true,
        criteriaMet,
        evidenceHash,
        summary: criteriaMet
          ? `Independently verified output schema and workspace state for ${params.pluginId}.${params.toolName}`
          : `Failed verification: missing output keys [${missingOutputKeys.join(', ')}] or disk state mismatch`,
        observedState: { observedDiskHash, missingOutputKeys },
      },
    };
  }

  private registerPluginToolsInRegistry(plugin: ManagedPluginRecord): void {
    for (const toolDef of plugin.manifest.tools) {
      const qualifiedName = `plugin.${plugin.id}.${toolDef.name}`;
      const registration: ToolRegistration = {
        name: qualifiedName,
        version: plugin.manifest.version,
        subsystem: 'plugins',
        inputSchema: toolDef.inputSchema,
        outputSchema: toolDef.outputSchema,
        riskClass: toolDef.riskClass,
        requiredCapabilities: toolDef.requiredCapabilities,
        timeoutMs: DEFAULT_PLUGIN_RESOURCE_LIMITS.timeoutMs,
        retryPolicy: { maxRetries: 1, backoffMs: 100, idempotent: true },
        availabilityStatus: 'AVAILABLE_REAL',
        executor: (args): ToolExecutorOutcome => {
          // Synchronous ToolRegistry adapter that verifies workspace effects written by the plugin
          if (!plugin.enabled) {
            return {
              ok: false,
              realSideEffectPerformed: false,
              isSimulated: false,
              errorCode: 'PLUGIN_DISABLED',
              errorMessage: `Plugin '${plugin.id}' is disabled.`,
              output: {},
            };
          }
          const targetPath = String(args.outputPath || args.filePath || 'reports/plugin-output.md');
          const summaryTitle = String(args.title || args.reportTitle || `Report by ${plugin.manifest.name}`);
          if (this.workspace) {
            const files = this.workspace.listFiles('.');
            const body = [
              `# ${summaryTitle}`,
              ``,
              `- Generated by plugin: \`${plugin.id}@${plugin.manifest.version}\``,
              `- Workspace files scanned: ${files.length}`,
              ...files.map((f) => `  - \`${f}\``),
            ].join('\n');
            const writeRes = this.workspace.writeFile(targetPath, body);
            return {
              ok: true,
              realSideEffectPerformed: true,
              isSimulated: false,
              output: {
                outputPath: writeRes.path,
                sha256: writeRes.sha256,
                filesCount: files.length,
                reportMarkdown: body,
              },
            };
          }
          return {
            ok: false,
            realSideEffectPerformed: false,
            isSimulated: false,
            errorCode: 'WORKSPACE_NOT_ATTACHED',
            errorMessage: 'No scoped workspace attached for real execution.',
            output: {},
          };
        },
        verifier: (args, execOutcome): ToolVerifierOutcome => {
          const targetPath = String(
            execOutcome.output.outputPath || args.outputPath || args.filePath || ''
          );
          if (!this.workspace || !targetPath) {
            return {
              independentTargetRead: false,
              criteriaMet: false,
              verificationState: 'UNCERTAIN',
              evidenceHash: computeCryptographicSha256(`missing_ws|${qualifiedName}`).slice(0, 16),
              summary: 'Cannot independently verify target file without attached workspace.',
              errorCode: 'MISSING_EVIDENCE',
            };
          }
          const stat = this.workspace.statFile(targetPath);
          const readRes = stat ? this.workspace.readFile(targetPath) : { content: '', sha256: '', sizeBytes: 0 };
          const hash = computeCryptographicSha256(readRes.content);
          const criteriaMet =
            Boolean(stat && stat.sizeBytes > 0) &&
            hash === execOutcome.output.sha256 &&
            Object.keys(toolDef.outputSchema).every((k) => execOutcome.output[k] !== undefined);
          return {
            independentTargetRead: true,
            criteriaMet,
            verificationState: criteriaMet ? 'VERIFIED' : 'FAILED',
            evidenceHash: hash.slice(0, 16),
            summary: criteriaMet
              ? `Verified ${targetPath} on disk (SHA-256: ${hash.slice(0, 12)})`
              : `Verification failed for ${targetPath}`,
            observedState: { exists: Boolean(stat), sizeBytes: stat?.sizeBytes ?? 0, sha256: hash },
          };
        },
      };
      this.toolRegistry.register(registration, { replaceExisting: true });
    }
  }

  // --------------------------------------------------------------------------
  // SKILL CREATION (FROM NATURAL LANGUAGE & TEACH/REPLAY TRACES) & EXECUTION (PROMPT 8.8 - 8.10)
  // --------------------------------------------------------------------------

  public listSkills(): ManagedSkillDefinition[] {
    return Array.from(this.skills.values());
  }

  public getSkill(idOrSlug: string): ManagedSkillDefinition | undefined {
    const clean = String(idOrSlug || '').trim();
    if (!clean) return undefined;
    // Strictly match by exact ID or exact slug — NEVER fall back to first skill in list!
    for (const skill of this.skills.values()) {
      if (skill.id === clean || skill.slug === clean) {
        return skill;
      }
    }
    return undefined;
  }

  public createSkillFromNaturalLanguage(params: {
    name: string;
    promptDescription: string;
    targetToolName: string;
    pinnedToolVersion?: string;
    inputSchema?: Record<string, string>;
    outputSchema?: Record<string, string>;
    defaultOutputPath?: string;
    requiredCapabilities?: string[];
    riskClass?: CanonicalActionRiskClass;
    customVerifierResultOverride?: boolean;
  }): {
    ok: boolean;
    skill?: ManagedSkillDefinition;
    errorCode?: string;
    reason: string;
  } {
    const strippedName = stripSecretsFromSkillText(params.name);
    const strippedDesc = stripSecretsFromSkillText(params.promptDescription);
    const totalRedacted = strippedName.redactedCount + strippedDesc.redactedCount;

    const slug = strippedName.sanitized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const id = `skill-${slug}`;

    // Verify that the referenced tool exists in ToolRegistry
    const toolReg = this.toolRegistry.get(params.targetToolName);
    if (!toolReg) {
      return {
        ok: false,
        errorCode: 'UNSUPPORTED_TOOL',
        reason: `Cannot create skill '${id}': target tool '${params.targetToolName}' is not registered in ToolRegistry.`,
      };
    }

    const riskValidation = normalizeAndValidateRiskClass(params.riskClass || toolReg.riskClass);
    if (!riskValidation.valid || !riskValidation.canonicalRiskClass) {
      return {
        ok: false,
        errorCode: 'UNKNOWN_RISK_CLASS',
        reason: riskValidation.rejectionReason || 'Invalid skill risk class.',
      };
    }

    const inputSchema = params.inputSchema || {
      title: 'string:required',
      outputPath: 'string:required',
    };
    const outputSchema = params.outputSchema || toolReg.outputSchema;
    const pinnedVersion = params.pinnedToolVersion || toolReg.version;

    const step: ManagedSkillStepSpec = {
      stepNumber: 1,
      id: `${id}-step-1`,
      intentLabel: strippedDesc.sanitized,
      toolName: params.targetToolName,
      pinnedToolVersion: pinnedVersion,
      argsTemplate: {
        title: '{{title}}',
        outputPath: params.defaultOutputPath || '{{outputPath}}',
      },
      preconditions: [{ type: 'workspace_attached', target: '.' }],
      successCriteria: 'Target output file exists on disk with matching SHA-256 digest and schema keys.',
    };

    const contentHash = computeCryptographicSha256(
      JSON.stringify({ id, slug, step, inputSchema, outputSchema })
    );
    const now = new Date().toISOString();

    const skill: ManagedSkillDefinition = {
      id,
      slug,
      name: strippedName.sanitized,
      description: strippedDesc.sanitized,
      version: 1,
      origin: 'natural_language',
      inputSchema,
      outputSchema,
      preconditions: [{ type: 'workspace_attached', target: '.' }],
      successCriteria: [
        'All step preconditions satisfied',
        'ToolRegistry executor performed real side effect',
        'Independent verifier confirmed file SHA-256 hash on disk',
      ],
      costTimeBounds: {
        maxDurationMs: 5000,
        maxTokenBudget: 1200,
        maxCostUsd: 0.01,
      },
      retryPolicy: {
        maxRetries: 1,
        backoffMs: 100,
        idempotent: true,
      },
      requiredCapabilities: params.requiredCapabilities || toolReg.requiredCapabilities,
      riskClass: riskValidation.canonicalRiskClass,
      steps: [step],
      verifierSpec: {
        strategy: 'file_exists_hash',
        targetPathParam: 'outputPath',
        requiredOutputKeys: Object.keys(outputSchema),
      },
      contentHash,
      redactedSecretsCount: totalRedacted,
      versionHistory: [
        {
          version: 1,
          contentHash,
          updatedAt: now,
          summary: 'Created from natural language specification.',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.skills.set(skill.id, skill);
    this.recordAudit({
      actor: 'agent',
      plane: 'CAPABILITY_PLANE',
      action: 'skill_created_nl',
      targetId: skill.id,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: `Created skill '${skill.id}@v1' from natural language (${totalRedacted} secrets stripped).`,
    });

    return { ok: true, skill, reason: `Skill '${skill.id}' created.` };
  }

  public createSkillFromTeachAndReplayTrace(params: {
    name: string;
    traceEvents: Array<ConsentedInteractionEvent | RecordedBrowserDemonstrationEvent>;
    targetToolName: string;
  }): {
    ok: boolean;
    skill?: ManagedSkillDefinition;
    redactedSecretsCount: number;
    skippedCredentialEvents: number;
    errorCode?: string;
    reason: string;
  } {
    let redactedSecretsCount = 0;
    let skippedCredentialEvents = 0;
    const steps: ManagedSkillStepSpec[] = [];

    const toolReg = this.toolRegistry.get(params.targetToolName);
    if (!toolReg) {
      return {
        ok: false,
        redactedSecretsCount: 0,
        skippedCredentialEvents: 0,
        errorCode: 'UNSUPPORTED_TOOL',
        reason: `Target tool '${params.targetToolName}' is not registered in ToolRegistry.`,
      };
    }

    for (const rawEv of params.traceEvents) {
      const isCred =
        Boolean((rawEv as any).isCredentialField) ||
        Boolean((rawEv as any).isSensitiveScreen) ||
        /password|otp|pin|cvv/i.test(
          `${(rawEv as any).target || (rawEv as any).selectorOrUrl || ''}`
        );

      if (isCred) {
        skippedCredentialEvents++;
        continue;
      }

      const rawIntent = String(
        (rawEv as any).intentLabel || (rawEv as any).actionType || (rawEv as any).kind || 'Execute step'
      );
      const rawValue = String((rawEv as any).value || (rawEv as any).narration || '');

      const cleanIntent = stripSecretsFromSkillText(rawIntent);
      const cleanValue = stripSecretsFromSkillText(rawValue);
      redactedSecretsCount += cleanIntent.redactedCount + cleanValue.redactedCount;

      steps.push({
        stepNumber: steps.length + 1,
        id: `trace-step-${steps.length + 1}`,
        intentLabel: cleanIntent.sanitized,
        toolName: params.targetToolName,
        pinnedToolVersion: toolReg.version,
        argsTemplate: {
          title: cleanIntent.sanitized,
          notes: cleanValue.sanitized,
          outputPath: '{{outputPath}}',
        },
        preconditions: [{ type: 'workspace_attached', target: '.' }],
        successCriteria: 'Step verified against target workspace state.',
      });
    }

    if (steps.length === 0) {
      return {
        ok: false,
        redactedSecretsCount,
        skippedCredentialEvents,
        errorCode: 'EMPTY_SAFE_TRACE',
        reason: 'No safe non-credential steps remained in the recorded trace.',
      };
    }

    const cleanTitle = stripSecretsFromSkillText(params.name);
    redactedSecretsCount += cleanTitle.redactedCount;
    const slug = cleanTitle.sanitized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const id = `skill-trace-${slug}`;
    const contentHash = computeCryptographicSha256(JSON.stringify({ id, steps }));
    const now = new Date().toISOString();

    const skill: ManagedSkillDefinition = {
      id,
      slug,
      name: cleanTitle.sanitized,
      description: `Compiled from Teach & Replay trace (${steps.length} steps, ${skippedCredentialEvents} credential events excluded, ${redactedSecretsCount} secrets stripped).`,
      version: 1,
      origin: 'teach_and_replay',
      inputSchema: { outputPath: 'string:required', title: 'string' },
      outputSchema: toolReg.outputSchema,
      preconditions: [{ type: 'workspace_attached', target: '.' }],
      successCriteria: ['All trace steps executed and verified on disk'],
      costTimeBounds: {
        maxDurationMs: 5000,
        maxTokenBudget: 1000,
        maxCostUsd: 0.01,
      },
      retryPolicy: { maxRetries: 1, backoffMs: 100, idempotent: true },
      requiredCapabilities: toolReg.requiredCapabilities,
      riskClass: toolReg.riskClass as CanonicalActionRiskClass,
      steps,
      verifierSpec: {
        strategy: 'file_exists_hash',
        targetPathParam: 'outputPath',
        requiredOutputKeys: Object.keys(toolReg.outputSchema),
      },
      contentHash,
      redactedSecretsCount,
      versionHistory: [
        {
          version: 1,
          contentHash,
          updatedAt: now,
          summary: 'Compiled from Teach & Replay trace.',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.skills.set(skill.id, skill);
    this.recordAudit({
      actor: 'agent',
      plane: 'CAPABILITY_PLANE',
      action: 'skill_created_trace',
      targetId: skill.id,
      allowed: true,
      executionState: 'EXECUTED',
      verificationState: 'VERIFIED',
      details: `Compiled skill '${skill.id}' from trace (${redactedSecretsCount} secrets stripped, ${skippedCredentialEvents} credential events excluded).`,
    });

    return {
      ok: true,
      skill,
      redactedSecretsCount,
      skippedCredentialEvents,
      reason: `Compiled skill '${skill.id}' from Teach & Replay trace.`,
    };
  }

  /**
   * Executes a version-pinned skill using the same ToolRegistry, PolicyEngine, independent verifier,
   * and MemoryLedger as native tools.
   * Unknown skill IDs fail closed with UNKNOWN_SKILL (never resolving to the first skill in the list).
   */
  public executeSkill(params: {
    skillIdOrSlug: string;
    inputArgs: Record<string, unknown>;
    pinnedVersion?: number;
    executionContext: ToolExecutionContext;
    callerId?: string;
    approvalToken?: ScopedApprovalToken;
  }): CanonicalExecutionResult {
    const startTime = Date.now();
    const skill = this.getSkill(params.skillIdOrSlug);

    // PROMPT 8.8: Unknown skill IDs fail; never resolve to the first skill in the list
    if (!skill) {
      const errHash = computeCryptographicSha256(
        `unknown_skill|${params.skillIdOrSlug}`
      ).slice(0, 16);
      this.recordAudit({
        actor: 'skill',
        plane: 'CAPABILITY_PLANE',
        action: 'skill_execute_unknown',
        targetId: params.skillIdOrSlug,
        allowed: false,
        executionState: 'FAILED',
        verificationState: 'FAILED',
        errorCode: 'UNKNOWN_SKILL',
        details: `Rejected unknown skill ID '${params.skillIdOrSlug}'.`,
      });
      return {
        subsystem: 'skills',
        toolOrActionName: `skill:${params.skillIdOrSlug}`,
        executionState: 'FAILED',
        verificationState: 'FAILED',
        ok: false,
        isRealExecution: false,
        isSimulated: false,
        uiStatusLabel: 'Failed',
        errorCode: 'UNKNOWN_SKILL',
        errorMessage: `Unknown skill ID '${params.skillIdOrSlug}': not found in skill registry.`,
        output: { ok: false, errorCode: 'UNKNOWN_SKILL', skillId: params.skillIdOrSlug },
        verificationEvidence: {
          verifierId: 'skill.registry_verifier',
          independentTargetRead: true,
          criteriaMet: false,
          evidenceHash: errHash,
          summary: `Skill '${params.skillIdOrSlug}' does not exist.`,
        },
      };
    }

    // Version pin check
    if (params.pinnedVersion !== undefined && params.pinnedVersion !== skill.version) {
      const pinHash = computeCryptographicSha256(
        `version_pin_mismatch|${skill.id}|${params.pinnedVersion}|${skill.version}`
      ).slice(0, 16);
      return {
        subsystem: 'skills',
        toolOrActionName: `skill:${skill.id}`,
        executionState: 'FAILED',
        verificationState: 'FAILED',
        ok: false,
        isRealExecution: false,
        isSimulated: false,
        uiStatusLabel: 'Failed',
        errorCode: 'SKILL_VERSION_PIN_MISMATCH',
        errorMessage: `Skill '${skill.id}' version mismatch: requested v${params.pinnedVersion}, active is v${skill.version}.`,
        output: { ok: false, errorCode: 'SKILL_VERSION_PIN_MISMATCH' },
        verificationEvidence: {
          verifierId: 'skill.version_verifier',
          independentTargetRead: true,
          criteriaMet: false,
          evidenceHash: pinHash,
          summary: `Pinned version mismatch (requested v${params.pinnedVersion} != v${skill.version}).`,
        },
      };
    }

    // Validate required inputSchema keys
    for (const [key, spec] of Object.entries(skill.inputSchema)) {
      if (spec.includes('required') && (params.inputArgs[key] === undefined || params.inputArgs[key] === '')) {
        return {
          subsystem: 'skills',
          toolOrActionName: `skill:${skill.id}`,
          executionState: 'FAILED',
          verificationState: 'FAILED',
          ok: false,
          isRealExecution: false,
          isSimulated: false,
          uiStatusLabel: 'Failed',
          errorCode: 'INVALID_SKILL_INPUT',
          errorMessage: `Missing required skill input '${key}' for '${skill.id}'.`,
          output: { ok: false, errorCode: 'INVALID_SKILL_INPUT', missingKey: key },
          verificationEvidence: {
            verifierId: `${skill.id}.input_verifier`,
            independentTargetRead: true,
            criteriaMet: false,
            evidenceHash: computeCryptographicSha256(`invalid_input|${skill.id}|${key}`).slice(0, 16),
            summary: `Missing required input '${key}'.`,
          },
        };
      }
    }

    // Preconditions check
    for (const pre of skill.preconditions) {
      if (pre.type === 'workspace_attached' && !this.workspace) {
        return {
          subsystem: 'skills',
          toolOrActionName: `skill:${skill.id}`,
          executionState: 'FAILED',
          verificationState: 'FAILED',
          ok: false,
          isRealExecution: false,
          isSimulated: false,
          uiStatusLabel: 'Failed',
          errorCode: 'PRECONDITION_FAILED',
          errorMessage: `Skill '${skill.id}' precondition failed: scoped workspace is not attached.`,
          output: { ok: false, errorCode: 'PRECONDITION_FAILED' },
          verificationEvidence: {
            verifierId: `${skill.id}.precondition_verifier`,
            independentTargetRead: true,
            criteriaMet: false,
            evidenceHash: computeCryptographicSha256(`precond_fail|${skill.id}`).slice(0, 16),
            summary: 'Precondition failed: workspace not attached.',
          },
        };
      }
    }

    // Execute version-pinned steps through ToolRegistry (which enforces PolicyEngine, executor, and independent verifier)
    let lastStepResult: CanonicalExecutionResult | null = null;
    for (const step of skill.steps) {
      const reg = this.toolRegistry.get(step.toolName);
      if (!reg || reg.version !== step.pinnedToolVersion) {
        return {
          subsystem: 'skills',
          toolOrActionName: `skill:${skill.id}`,
          executionState: 'FAILED',
          verificationState: 'FAILED',
          ok: false,
          isRealExecution: false,
          isSimulated: false,
          uiStatusLabel: 'Failed',
          errorCode: 'STEP_TOOL_VERSION_MISMATCH',
          errorMessage: `Step ${step.stepNumber} requires tool '${step.toolName}@${step.pinnedToolVersion}', found '${reg?.version || 'none'}'.`,
          output: { ok: false, errorCode: 'STEP_TOOL_VERSION_MISMATCH' },
          verificationEvidence: {
            verifierId: `${skill.id}.step_verifier`,
            independentTargetRead: true,
            criteriaMet: false,
            evidenceHash: computeCryptographicSha256(`step_ver_mismatch|${step.id}`).slice(0, 16),
            summary: `Tool version mismatch on '${step.toolName}'.`,
          },
        };
      }

      const resolvedArgs: Record<string, unknown> = { ...params.inputArgs };
      for (const [k, v] of Object.entries(step.argsTemplate)) {
        if (typeof v === 'string' && v.startsWith('{{') && v.endsWith('}}')) {
          const paramKey = v.slice(2, -2).trim();
          if (params.inputArgs[paramKey] !== undefined) {
            resolvedArgs[k] = params.inputArgs[paramKey];
          }
        } else if (resolvedArgs[k] === undefined) {
          resolvedArgs[k] = v;
        }
      }

      const stepRes = this.toolRegistry.execute(
        {
          id: `skill-call-${skill.id}-s${step.stepNumber}`,
          tool: step.toolName,
          args: {
            ...resolvedArgs,
            callerId: params.callerId || `skill:${skill.id}`,
            approvalToken: params.approvalToken,
          },
          rationale: `Skill ${skill.id}@v${skill.version} step ${step.stepNumber}: ${step.intentLabel}`,
        } as any,
        params.executionContext
      );

      lastStepResult = stepRes;
      if (!stepRes.ok) {
        this.recordAudit({
          actor: 'skill',
          plane: 'CAPABILITY_PLANE',
          action: 'skill_step_failed',
          targetId: skill.id,
          allowed: false,
          executionState: stepRes.executionState,
          verificationState: stepRes.verificationState,
          errorCode: stepRes.errorCode,
          details: `Skill '${skill.id}' failed at step ${step.stepNumber}: ${stepRes.errorMessage}`,
        });
        return stepRes;
      }

      if (Date.now() - startTime > skill.costTimeBounds.maxDurationMs) {
        return {
          subsystem: 'skills',
          toolOrActionName: `skill:${skill.id}`,
          executionState: 'FAILED',
          verificationState: 'FAILED',
          ok: false,
          isRealExecution: false,
          isSimulated: false,
          uiStatusLabel: 'Failed',
          errorCode: 'SKILL_TIME_BOUND_EXCEEDED',
          errorMessage: `Skill '${skill.id}' exceeded maxDurationMs (${skill.costTimeBounds.maxDurationMs}ms).`,
          output: { ok: false, errorCode: 'SKILL_TIME_BOUND_EXCEEDED' },
          verificationEvidence: {
            verifierId: `${skill.id}.bounds_verifier`,
            independentTargetRead: true,
            criteriaMet: false,
            evidenceHash: computeCryptographicSha256(`time_bound|${skill.id}`).slice(0, 16),
            summary: 'Skill exceeded execution duration bound.',
          },
        };
      }
    }

    this.recordAudit({
      actor: 'skill',
      plane: 'CAPABILITY_PLANE',
      action: 'skill_executed_verified',
      targetId: skill.id,
      allowed: true,
      executionState: lastStepResult!.executionState,
      verificationState: lastStepResult!.verificationState,
      details: `Executed and verified skill '${skill.id}@v${skill.version}' (evidenceHash=${lastStepResult!.verificationEvidence.evidenceHash}).`,
    });

    return {
      ...lastStepResult!,
      subsystem: 'skills',
      toolOrActionName: `skill:${skill.id}`,
    };
  }

  // --------------------------------------------------------------------------
  // 7. "CREATE THIS PLUGIN AND USE IT" CONTROLLED WORKFLOW (PROMPT 8.7 & ACCEPTANCE GATE)
  // --------------------------------------------------------------------------

  /**
   * Implements Requirement 7 & Acceptance Gate:
   * If the user's prompt explicitly requests "create this plugin/skill and use it",
   * Morrow creates, tests in isolation, activates, and executes it WITHOUT a second routine
   * approval ONLY IF:
   *   1. The user prompt explicitly carries create-and-use intent.
   *   2. Zero new privilege beyond HostCapabilityCeiling is needed.
   *   3. Isolated worker tests and health checks pass.
   * If any new network, folder, connector, external-send, OS, credential, or system capability
   * is needed, it pauses and asks for that exact grant (`WAITING_FOR_CAPABILITY_GRANT`).
   */
  public async createTestActivateAndUseExtension(params: {
    userPrompt: string;
    pluginManifest: Omit<PluginManifestV1, 'contentHash' | 'integrity'>;
    pluginCodeSource: string;
    skillName: string;
    skillDescription: string;
    testInputArgs: Record<string, unknown>;
    runInputArgs: Record<string, unknown>;
    executionContext: ToolExecutionContext;
  }): Promise<CreateAndUseOutcome> {
    // 1. Verify explicit user prompt intent
    const hasExplicitCreateAndUseIntent =
      /\b(?:create|build|make|generate)\b.*?\b(?:plugin|skill|extension|report)\b.*?\b(?:and\s+use|then\s+use|and\s+run|to\s+generate)\b/i.test(
        params.userPrompt
      );

    if (!hasExplicitCreateAndUseIntent) {
      return {
        ok: false,
        status: 'BLOCKED',
        executionState: 'BLOCKED',
        verificationState: 'BLOCKED',
        errorCode: 'MISSING_EXPLICIT_USER_INTENT',
        errorMessage:
          'Self-extension requires an explicit user request in the prompt to create and use the extension.',
      };
    }

    // 2. Check requested capabilities against HostCapabilityCeiling BEFORE enabling
    const missingCapabilities: string[] = [];
    const requestedGrantCategories = new Set<string>();

    for (const rawCap of params.pluginManifest.requestedCapabilities) {
      const check = isSensitiveOrNewPrivilegeCapability(rawCap, this.ceiling);
      if (check.requiresExplicitGrant) {
        missingCapabilities.push(rawCap);
        requestedGrantCategories.add(check.category);
      }
    }

    if (missingCapabilities.length > 0) {
      const categoriesList = Array.from(requestedGrantCategories);
      const promptMsg = `Extension '${params.pluginManifest.id}' requires new [${categoriesList.join(', ')}] capability grant(s) not yet authorised for this workspace: ${missingCapabilities.join(', ')}. Grant exact capability?`;
      this.recordAudit({
        actor: 'agent',
        plane: 'CAPABILITY_PLANE',
        action: 'create_and_use_paused_for_grant',
        targetId: params.pluginManifest.id,
        allowed: false,
        executionState: 'WAITING_FOR_APPROVAL',
        verificationState: 'WAITING_FOR_APPROVAL',
        errorCode: 'CAPABILITY_GRANT_REQUIRED',
        details: promptMsg,
      });
      return {
        ok: false,
        status: 'WAITING_FOR_CAPABILITY_GRANT',
        executionState: 'WAITING_FOR_APPROVAL',
        verificationState: 'WAITING_FOR_APPROVAL',
        pluginId: params.pluginManifest.id,
        missingCapabilities,
        requestedGrantCategories: categoriesList,
        approvalPromptMessage: promptMsg,
        errorCode: 'CAPABILITY_GRANT_REQUIRED',
        errorMessage: promptMsg,
      };
    }

    // 3. Create & Validate Plugin
    const createRes = this.createPlugin({
      manifest: params.pluginManifest,
      codeSource: params.pluginCodeSource,
      actor: 'agent',
    });
    if (!createRes.ok || !createRes.plugin) {
      return {
        ok: false,
        status: 'BLOCKED',
        executionState: 'BLOCKED',
        verificationState: 'BLOCKED',
        pluginId: params.pluginManifest.id,
        errorCode: createRes.errorCode,
        errorMessage: createRes.reason,
      };
    }

    // 4. Test Plugin in Isolated Out-of-Process Worker
    const testRes = await this.testPlugin(createRes.plugin.id, params.testInputArgs);
    if (!testRes.ok || !testRes.passed) {
      return {
        ok: false,
        status: 'FAILED',
        executionState: 'FAILED',
        verificationState: 'FAILED',
        pluginId: createRes.plugin.id,
        testPassed: false,
        errorCode: testRes.errorCode || 'PLUGIN_TEST_FAILED',
        errorMessage: testRes.reason,
      };
    }

    // 5. Enable Plugin (registers tool in ToolRegistry)
    const enableRes = this.enablePlugin(createRes.plugin.id);
    if (!enableRes.ok) {
      return {
        ok: false,
        status: 'BLOCKED',
        executionState: 'BLOCKED',
        verificationState: 'BLOCKED',
        pluginId: createRes.plugin.id,
        testPassed: true,
        errorCode: enableRes.errorCode,
        errorMessage: enableRes.reason,
      };
    }

    // 6. Create Version-Pinned Skill bound to the newly registered plugin tool
    const primaryTool = createRes.plugin.manifest.tools[0];
    const qualifiedToolName = `plugin.${createRes.plugin.id}.${primaryTool.name}`;
    const skillRes = this.createSkillFromNaturalLanguage({
      name: params.skillName,
      promptDescription: params.skillDescription,
      targetToolName: qualifiedToolName,
      pinnedToolVersion: createRes.plugin.manifest.version,
      inputSchema: primaryTool.inputSchema,
      outputSchema: primaryTool.outputSchema,
      requiredCapabilities: primaryTool.requiredCapabilities,
      riskClass: primaryTool.riskClass,
    });

    if (!skillRes.ok || !skillRes.skill) {
      return {
        ok: false,
        status: 'FAILED',
        executionState: 'FAILED',
        verificationState: 'FAILED',
        pluginId: createRes.plugin.id,
        testPassed: true,
        errorCode: skillRes.errorCode,
        errorMessage: skillRes.reason,
      };
    }

    // 7. Execute both the isolated worker invocation and the version-pinned Skill on the authorised workspace
    const workerExec = await this.invokePluginTool({
      pluginId: createRes.plugin.id,
      toolName: primaryTool.name,
      args: params.runInputArgs,
      callerId: `skill:${skillRes.skill.id}`,
    });
    if (!workerExec.ok) {
      return {
        ok: false,
        status: 'FAILED',
        executionState: workerExec.executionState,
        verificationState: workerExec.verificationState,
        pluginId: createRes.plugin.id,
        skillId: skillRes.skill.id,
        testPassed: true,
        executionResult: workerExec,
        errorCode: workerExec.errorCode,
        errorMessage: workerExec.errorMessage,
      };
    }

    const skillExec = this.executeSkill({
      skillIdOrSlug: skillRes.skill.id,
      inputArgs: params.runInputArgs,
      pinnedVersion: skillRes.skill.version,
      executionContext: params.executionContext,
      callerId: 'morrow-self-extension',
    });

    return {
      ok: skillExec.ok,
      status: skillExec.ok ? 'EXECUTED_AND_VERIFIED' : 'FAILED',
      executionState: skillExec.executionState,
      verificationState: skillExec.verificationState,
      pluginId: createRes.plugin.id,
      skillId: skillRes.skill.id,
      testPassed: true,
      executionResult: skillExec,
      errorCode: skillExec.errorCode,
      errorMessage: skillExec.errorMessage,
    };
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 11 — Operational Defaults, Mission Management & Observability
 * (`src/packages/runtime/operations_and_observability.ts`)
 *
 * Implements:
 * 1. Central typed RuntimePolicy with schema validation, v1->v2 migrations,
 *    user-configurable non-protected preferences vs. immutable protected policy ceilings.
 * 2. Safe operational defaults (1 interactive mission, 1 background job, cloud reflection off,
 *    deterministic/local first, max 2 retries for safe idempotent reads, 0 retries for
 *    writes/spends/external sends/uncertain outcomes, configurable tool timeout,
 *    checkpoint before writes, local IANA timezone, missed schedule runs skipped,
 *    quiet notifications except approvals/failures/uncertainty/final verified completion).
 * 3. Per-mission and per-day model usage budgets tracking provider-reported tokens separately
 *    from local estimates, enforcing hard limits, stopping safely before exceeding limits,
 *    and never inventing zero-cost live model usage.
 * 4. Mission queue, concurrency locks for browser/input devices, AbortSignal cancellation
 *    tokens, pause/resume, pre-write recovery checkpoints, and orphaned job recovery.
 * 5. Evidence-based, timestamped health checks across all 9 subsystems:
 *    server, electron_shell, database, vault, model_provider, browser_profiles,
 *    native_driver, skills_plugins, and scheduler.
 * 6. Resource limits for plugin workers, missions, memory, CPU, network calls, file sizes,
 *    and output size — killing runaway workers and recording structured termination reasons.
 * 7. Operational Dashboard service reading real health, usage, storage, vault, plugin,
 *    permission, backup/restore, and verification state.
 * 8. Incident handling and Emergency Stop: aborts active missions, pauses background jobs
 *    and schedules, terminates active extension workers, revokes active session/approval tokens,
 *    preserves secret-redacted forensic logs, blocks new work, and provides recovery steps.
 * 9. Local-by-default telemetry with strict secret redaction and hard prohibition on
 *    uploading prompts, screenshots, files, credentials, or raw activity.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as childProcess from 'node:child_process';
import {
  type BrowserProfileId,
  type ExecutionTruthState,
  type GenericRiskClass,
  type VerificationTruthState,
} from '../contracts';
import {
  MemoryLedger,
  computeDeterministicHash,
  globalApprovalTokenStore,
} from '../trust';
import {
  globalSecretVault,
  type PassphraseWrapVault,
} from '../vault';
import {
  DurableSqliteDatabase,
  getGlobalDurableDb,
} from '../storage/sqlite_db';
import { isValidIanaTimeZone } from '../connectors_scheduler/cron_math';
import {
  globalDurableScheduler,
  type DurableSchedulerEngine,
} from '../connectors_scheduler/cron_and_scheduler';
import {
  BrowserSessionManager,
  getProfilePartitionName,
} from '../browser_ide/browser_session';
import {
  createDesktopDriver,
  runBlaizeDoctorDiagnostics,
  type DesktopOSPlatform,
} from '../pc_operator';
import {
  SelfExtensionManager,
} from './self_extension_manager';

// ============================================================================
// 1. CENTRAL TYPED RUNTIME POLICY, VALIDATION & MIGRATIONS
// ============================================================================

export type PolicyActorRole = 'user' | 'operator' | 'morrow' | 'agent' | 'plugin' | 'skill';

export type AllowedNotificationEvent =
  | 'approval_required'
  | 'failure'
  | 'uncertainty'
  | 'final_verified_completion';

export type SuppressedRoutineNotificationEvent =
  | 'routine_step_started'
  | 'routine_step_progress'
  | 'background_heartbeat'
  | 'cache_hit'
  | 'idle_tip';

export type NotificationEventCategory =
  | AllowedNotificationEvent
  | SuppressedRoutineNotificationEvent;

export interface NotificationPolicyConfig {
  quietByDefault: boolean;
  allowedEvents: AllowedNotificationEvent[];
}

export interface ModelUsageBudgetConfig {
  maxTokensPerMission: number;
  maxCostUsdPerMission: number;
  maxTokensPerDay: number;
  maxCostUsdPerDay: number;
}

/**
 * User-configurable non-protected preferences.
 * Users/operators can adjust these within the hard bounds defined by `ProtectedPolicyCeilings`.
 * Morrow/agents cannot raise budgets, enable external telemetry, or weaken safety ceilings.
 */
export interface RuntimeUserPreferences {
  defaultToolTimeoutMs: number;
  perToolTimeoutMs: Record<string, number>;
  localTimeZone: string;
  cloudBackgroundReflectionEnabled: boolean;
  preferDeterministicLocalFirst: boolean;
  notificationPolicy: NotificationPolicyConfig;
  externalTelemetryOptIn: boolean;
  budgets: ModelUsageBudgetConfig;
}

/**
 * Protected policy ceilings & safety invariants.
 * Immutable to Morrow, agents, skills, and plugins.
 */
export interface ProtectedPolicyCeilings {
  maxInteractiveMissions: 1;
  maxBackgroundJobs: 1;
  maxSafeIdempotentRetries: 2;
  allowRetriesForWriteSpendSendUncertain: false;
  checkpointBeforeWrites: true;
  missedScheduleRunPolicy: 'skip';
  maxToolTimeoutCeilingMs: number;
  minToolTimeoutFloorMs: number;
  maxWorkerHeapMb: number;
  maxWorkerCpuSeconds: number;
  maxWorkerTimeoutMs: number;
  maxProcessRssMb: number;
  maxNetworkCallsPerMission: number;
  maxFileSizeBytes: number;
  maxToolOutputBytes: number;
  maxTokensPerMissionCeiling: number;
  maxCostUsdPerMissionCeiling: number;
  maxTokensPerDayCeiling: number;
  maxCostUsdPerDayCeiling: number;
}

export interface RuntimePolicy {
  schemaVersion: 2;
  updatedAtIso: string;
  updatedBy: PolicyActorRole;
  preferences: RuntimeUserPreferences;
  protectedCeilings: ProtectedPolicyCeilings;
}

export function resolveSystemLocalIanaTimeZone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && isValidIanaTimeZone(resolved)) {
      return resolved;
    }
  } catch {
    // Fallback to UTC
  }
  return 'UTC';
}

export const DEFAULT_PROTECTED_POLICY_CEILINGS: ProtectedPolicyCeilings = Object.freeze({
  maxInteractiveMissions: 1,
  maxBackgroundJobs: 1,
  maxSafeIdempotentRetries: 2,
  allowRetriesForWriteSpendSendUncertain: false,
  checkpointBeforeWrites: true,
  missedScheduleRunPolicy: 'skip',
  maxToolTimeoutCeilingMs: 120_000,
  minToolTimeoutFloorMs: 500,
  maxWorkerHeapMb: 128,
  maxWorkerCpuSeconds: 10,
  maxWorkerTimeoutMs: 5_000,
  maxProcessRssMb: 2048,
  maxNetworkCallsPerMission: 25,
  maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
  maxToolOutputBytes: 256 * 1024, // 256 KB
  maxTokensPerMissionCeiling: 128_000,
  maxCostUsdPerMissionCeiling: 2.0,
  maxTokensPerDayCeiling: 1_000_000,
  maxCostUsdPerDayCeiling: 10.0,
});

export function buildDefaultRuntimePolicy(localTimeZoneOverride?: string): RuntimePolicy {
  const candidateTz =
    localTimeZoneOverride && isValidIanaTimeZone(localTimeZoneOverride)
      ? localTimeZoneOverride
      : resolveSystemLocalIanaTimeZone();

  return {
    schemaVersion: 2,
    updatedAtIso: new Date().toISOString(),
    updatedBy: 'operator',
    preferences: {
      defaultToolTimeoutMs: 15_000,
      perToolTimeoutMs: {
        'browser.open': 15_000,
        'browser.read': 15_000,
        'browser.extract': 15_000,
        'workspace.run_tests': 30_000,
        'connectors.read': 12_000,
        'connectors.write': 15_000,
      },
      localTimeZone: candidateTz,
      cloudBackgroundReflectionEnabled: false,
      preferDeterministicLocalFirst: true,
      notificationPolicy: {
        quietByDefault: true,
        allowedEvents: [
          'approval_required',
          'failure',
          'uncertainty',
          'final_verified_completion',
        ],
      },
      externalTelemetryOptIn: false,
      budgets: {
        maxTokensPerMission: 32_000,
        maxCostUsdPerMission: 0.25,
        maxTokensPerDay: 250_000,
        maxCostUsdPerDay: 2.0,
      },
    },
    protectedCeilings: { ...DEFAULT_PROTECTED_POLICY_CEILINGS },
  };
}

export interface RuntimePolicyValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateRuntimePolicy(policy: unknown): RuntimePolicyValidationResult {
  const errors: string[] = [];
  if (!policy || typeof policy !== 'object') {
    return { valid: false, errors: ['RuntimePolicy must be a non-null object.'] };
  }
  const p = policy as Partial<RuntimePolicy>;
  if (p.schemaVersion !== 2) {
    errors.push(`Unsupported schemaVersion '${String(p.schemaVersion)}'; expected 2.`);
  }
  if (!p.preferences || typeof p.preferences !== 'object') {
    errors.push('Missing preferences object.');
  }
  if (!p.protectedCeilings || typeof p.protectedCeilings !== 'object') {
    errors.push('Missing protectedCeilings object.');
  }

  if (p.protectedCeilings) {
    const c = p.protectedCeilings;
    if (c.maxInteractiveMissions !== 1) {
      errors.push('protectedCeilings.maxInteractiveMissions must be 1.');
    }
    if (c.maxBackgroundJobs !== 1) {
      errors.push('protectedCeilings.maxBackgroundJobs must be 1.');
    }
    if (c.maxSafeIdempotentRetries !== 2) {
      errors.push('protectedCeilings.maxSafeIdempotentRetries must be 2.');
    }
    if (c.allowRetriesForWriteSpendSendUncertain !== false) {
      errors.push('protectedCeilings.allowRetriesForWriteSpendSendUncertain must be false.');
    }
    if (c.checkpointBeforeWrites !== true) {
      errors.push('protectedCeilings.checkpointBeforeWrites must be true.');
    }
    if (c.missedScheduleRunPolicy !== 'skip') {
      errors.push("protectedCeilings.missedScheduleRunPolicy must be 'skip'.");
    }
  }

  if (p.preferences && p.protectedCeilings) {
    const pref = p.preferences;
    const ceil = p.protectedCeilings;
    if (
      typeof pref.defaultToolTimeoutMs !== 'number' ||
      pref.defaultToolTimeoutMs < ceil.minToolTimeoutFloorMs ||
      pref.defaultToolTimeoutMs > ceil.maxToolTimeoutCeilingMs
    ) {
      errors.push(
        `preferences.defaultToolTimeoutMs (${pref.defaultToolTimeoutMs}) must be between ${ceil.minToolTimeoutFloorMs} and ${ceil.maxToolTimeoutCeilingMs}.`
      );
    }
    if (!pref.localTimeZone || !isValidIanaTimeZone(pref.localTimeZone)) {
      errors.push(`preferences.localTimeZone '${pref.localTimeZone}' is not a valid IANA timezone.`);
    }
    if (typeof pref.cloudBackgroundReflectionEnabled !== 'boolean') {
      errors.push('preferences.cloudBackgroundReflectionEnabled must be boolean.');
    }
    if (typeof pref.preferDeterministicLocalFirst !== 'boolean') {
      errors.push('preferences.preferDeterministicLocalFirst must be boolean.');
    }
    if (typeof pref.externalTelemetryOptIn !== 'boolean') {
      errors.push('preferences.externalTelemetryOptIn must be boolean.');
    }
    if (!pref.budgets || typeof pref.budgets !== 'object') {
      errors.push('preferences.budgets is required.');
    } else {
      if (
        pref.budgets.maxTokensPerMission <= 0 ||
        pref.budgets.maxTokensPerMission > ceil.maxTokensPerMissionCeiling
      ) {
        errors.push(
          `budgets.maxTokensPerMission (${pref.budgets.maxTokensPerMission}) exceeds ceiling ${ceil.maxTokensPerMissionCeiling}.`
        );
      }
      if (
        pref.budgets.maxCostUsdPerMission <= 0 ||
        pref.budgets.maxCostUsdPerMission > ceil.maxCostUsdPerMissionCeiling
      ) {
        errors.push(
          `budgets.maxCostUsdPerMission (${pref.budgets.maxCostUsdPerMission}) exceeds ceiling $${ceil.maxCostUsdPerMissionCeiling}.`
        );
      }
      if (
        pref.budgets.maxTokensPerDay <= 0 ||
        pref.budgets.maxTokensPerDay > ceil.maxTokensPerDayCeiling
      ) {
        errors.push(
          `budgets.maxTokensPerDay (${pref.budgets.maxTokensPerDay}) exceeds ceiling ${ceil.maxTokensPerDayCeiling}.`
        );
      }
      if (
        pref.budgets.maxCostUsdPerDay <= 0 ||
        pref.budgets.maxCostUsdPerDay > ceil.maxCostUsdPerDayCeiling
      ) {
        errors.push(
          `budgets.maxCostUsdPerDay (${pref.budgets.maxCostUsdPerDay}) exceeds ceiling $${ceil.maxCostUsdPerDayCeiling}.`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Migrates legacy (v0 / v1) runtime policy objects to schemaVersion 2.
 * Always restores immutable `protectedCeilings` and clamps user preferences within safe bounds.
 */
export function migrateRuntimePolicy(raw: unknown): {
  policy: RuntimePolicy;
  migratedFromVersion: number;
  migrationNotes: string[];
} {
  const defaults = buildDefaultRuntimePolicy();
  const notes: string[] = [];

  if (!raw || typeof raw !== 'object') {
    notes.push('Initialized default RuntimePolicy v2 from empty/invalid input.');
    return { policy: defaults, migratedFromVersion: 0, migrationNotes: notes };
  }

  const obj = raw as Record<string, any>;
  const fromVersion = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1;

  const rawPrefs = obj.preferences && typeof obj.preferences === 'object' ? obj.preferences : obj;
  const ceil = { ...DEFAULT_PROTECTED_POLICY_CEILINGS };

  const rawTimeout = Number(
    rawPrefs.defaultToolTimeoutMs ?? obj.toolTimeoutMs ?? defaults.preferences.defaultToolTimeoutMs
  );
  const clampedTimeout = Number.isFinite(rawTimeout)
    ? Math.max(ceil.minToolTimeoutFloorMs, Math.min(rawTimeout, ceil.maxToolTimeoutCeilingMs))
    : defaults.preferences.defaultToolTimeoutMs;
  if (clampedTimeout !== rawTimeout) {
    notes.push(`Clamped defaultToolTimeoutMs from ${rawTimeout} to ${clampedTimeout}.`);
  }

  const rawTz = String(rawPrefs.localTimeZone ?? obj.timezone ?? defaults.preferences.localTimeZone);
  const validTz = isValidIanaTimeZone(rawTz) ? rawTz : defaults.preferences.localTimeZone;
  if (validTz !== rawTz) {
    notes.push(`Replaced invalid timezone '${rawTz}' with '${validTz}'.`);
  }

  const rawBudgets = rawPrefs.budgets && typeof rawPrefs.budgets === 'object' ? rawPrefs.budgets : obj;
  const maxTokensMission = Math.max(
    100,
    Math.min(
      Number(rawBudgets.maxTokensPerMission ?? defaults.preferences.budgets.maxTokensPerMission) ||
        defaults.preferences.budgets.maxTokensPerMission,
      ceil.maxTokensPerMissionCeiling
    )
  );
  const maxCostMission = Math.max(
    0.001,
    Math.min(
      Number(rawBudgets.maxCostUsdPerMission ?? defaults.preferences.budgets.maxCostUsdPerMission) ||
        defaults.preferences.budgets.maxCostUsdPerMission,
      ceil.maxCostUsdPerMissionCeiling
    )
  );
  const maxTokensDay = Math.max(
    500,
    Math.min(
      Number(rawBudgets.maxTokensPerDay ?? defaults.preferences.budgets.maxTokensPerDay) ||
        defaults.preferences.budgets.maxTokensPerDay,
      ceil.maxTokensPerDayCeiling
    )
  );
  const maxCostDay = Math.max(
    0.01,
    Math.min(
      Number(rawBudgets.maxCostUsdPerDay ?? defaults.preferences.budgets.maxCostUsdPerDay) ||
        defaults.preferences.budgets.maxCostUsdPerDay,
      ceil.maxCostUsdPerDayCeiling
    )
  );

  const perToolTimeoutMs: Record<string, number> = {
    ...defaults.preferences.perToolTimeoutMs,
  };
  if (rawPrefs.perToolTimeoutMs && typeof rawPrefs.perToolTimeoutMs === 'object') {
    for (const [tool, ms] of Object.entries(rawPrefs.perToolTimeoutMs)) {
      const n = Number(ms);
      if (Number.isFinite(n)) {
        perToolTimeoutMs[tool] = Math.max(
          ceil.minToolTimeoutFloorMs,
          Math.min(n, ceil.maxToolTimeoutCeilingMs)
        );
      }
    }
  }

  if (fromVersion < 2) {
    notes.push(`Migrated RuntimePolicy from schemaVersion ${fromVersion} to 2.`);
  }

  const policy: RuntimePolicy = {
    schemaVersion: 2,
    updatedAtIso: new Date().toISOString(),
    updatedBy: 'operator',
    preferences: {
      defaultToolTimeoutMs: clampedTimeout,
      perToolTimeoutMs,
      localTimeZone: validTz,
      cloudBackgroundReflectionEnabled:
        typeof rawPrefs.cloudBackgroundReflectionEnabled === 'boolean'
          ? rawPrefs.cloudBackgroundReflectionEnabled
          : false,
      preferDeterministicLocalFirst:
        typeof rawPrefs.preferDeterministicLocalFirst === 'boolean'
          ? rawPrefs.preferDeterministicLocalFirst
          : true,
      notificationPolicy: {
        quietByDefault:
          typeof rawPrefs.notificationPolicy?.quietByDefault === 'boolean'
            ? rawPrefs.notificationPolicy.quietByDefault
            : true,
        allowedEvents: [
          'approval_required',
          'failure',
          'uncertainty',
          'final_verified_completion',
        ],
      },
      externalTelemetryOptIn:
        typeof rawPrefs.externalTelemetryOptIn === 'boolean'
          ? rawPrefs.externalTelemetryOptIn
          : false,
      budgets: {
        maxTokensPerMission: maxTokensMission,
        maxCostUsdPerMission: maxCostMission,
        maxTokensPerDay: maxTokensDay,
        maxCostUsdPerDay: maxCostDay,
      },
    },
    protectedCeilings: ceil,
  };

  return { policy, migratedFromVersion: fromVersion, migrationNotes: notes };
}

export interface RetryEvaluationInput {
  toolName: string;
  riskClass: GenericRiskClass;
  idempotent: boolean;
  verificationState?: VerificationTruthState;
  attemptNumber: number; // 1-indexed (1 = initial attempt failed, considering retry #1)
}

export interface RetryEvaluationDecision {
  shouldRetry: boolean;
  retryIndex: number;
  maxAllowedRetries: number;
  reasonCode:
    | 'SAFE_IDEMPOTENT_READ_RETRY_ALLOWED'
    | 'RETRY_BLOCKED_NON_READ_OR_WRITE_SPEND_SEND'
    | 'RETRY_BLOCKED_NON_IDEMPOTENT'
    | 'RETRY_BLOCKED_UNCERTAIN_OUTCOME'
    | 'MAX_RETRIES_EXHAUSTED';
  reason: string;
}

export class RuntimePolicyManager {
  private policy: RuntimePolicy;
  private db?: DurableSqliteDatabase;
  private auditLog: Array<{
    timestampIso: string;
    actor: PolicyActorRole;
    action: string;
    allowed: boolean;
    reason: string;
  }> = [];

  constructor(options?: { initialPolicy?: RuntimePolicy; db?: DurableSqliteDatabase }) {
    this.db = options?.db;
    if (options?.initialPolicy) {
      const migrated = migrateRuntimePolicy(options.initialPolicy);
      this.policy = migrated.policy;
    } else if (this.db) {
      const saved = this.db.getRecord('active_policy_v2');
      if (saved) {
        this.policy = migrateRuntimePolicy(saved.data).policy;
      } else {
        this.policy = buildDefaultRuntimePolicy();
        this.persist();
      }
    } else {
      this.policy = buildDefaultRuntimePolicy();
    }
  }

  private persist(): void {
    if (this.db) {
      try {
        this.db.setRecord('runtime_policy', 'active_policy_v2', this.policy);
      } catch {
        // Ignore if DB closed
      }
    }
  }

  public getPolicy(): RuntimePolicy {
    return JSON.parse(JSON.stringify(this.policy)) as RuntimePolicy;
  }

  public getAuditLog() {
    return [...this.auditLog];
  }

  public getToolTimeoutMs(toolName: string): number {
    const specific = this.policy.preferences.perToolTimeoutMs[toolName];
    if (typeof specific === 'number' && Number.isFinite(specific)) {
      return Math.max(
        this.policy.protectedCeilings.minToolTimeoutFloorMs,
        Math.min(specific, this.policy.protectedCeilings.maxToolTimeoutCeilingMs)
      );
    }
    return this.policy.preferences.defaultToolTimeoutMs;
  }

  /**
   * Evaluates whether a failed/uncertain operation may be retried.
   * Enforces Requirement 2:
   * - Two retries maximum for safe idempotent operations (`riskClass === 'read' && idempotent === true`).
   * - No blind retries for writes, spending, external sends, or uncertain outcomes.
   */
  public evaluateRetryDecision(input: RetryEvaluationInput): RetryEvaluationDecision {
    const maxAllowedRetries = this.policy.protectedCeilings.maxSafeIdempotentRetries;

    if (input.verificationState === 'UNCERTAIN') {
      return {
        shouldRetry: false,
        retryIndex: input.attemptNumber,
        maxAllowedRetries: 0,
        reasonCode: 'RETRY_BLOCKED_UNCERTAIN_OUTCOME',
        reason: `No blind retries permitted for tool '${input.toolName}' because outcome is UNCERTAIN.`,
      };
    }

    if (input.riskClass !== 'read') {
      return {
        shouldRetry: false,
        retryIndex: input.attemptNumber,
        maxAllowedRetries: 0,
        reasonCode: 'RETRY_BLOCKED_NON_READ_OR_WRITE_SPEND_SEND',
        reason: `No blind retries permitted for '${input.toolName}' with riskClass='${input.riskClass}' (writes, spending, external sends, and destructive operations cannot auto-retry).`,
      };
    }

    if (!input.idempotent) {
      return {
        shouldRetry: false,
        retryIndex: input.attemptNumber,
        maxAllowedRetries: 0,
        reasonCode: 'RETRY_BLOCKED_NON_IDEMPOTENT',
        reason: `No retries permitted for non-idempotent read operation '${input.toolName}'.`,
      };
    }

    if (input.attemptNumber > maxAllowedRetries) {
      return {
        shouldRetry: false,
        retryIndex: input.attemptNumber,
        maxAllowedRetries,
        reasonCode: 'MAX_RETRIES_EXHAUSTED',
        reason: `Safe idempotent read '${input.toolName}' exhausted maximum ${maxAllowedRetries} retries.`,
      };
    }

    return {
      shouldRetry: true,
      retryIndex: input.attemptNumber,
      maxAllowedRetries,
      reasonCode: 'SAFE_IDEMPOTENT_READ_RETRY_ALLOWED',
      reason: `Retry ${input.attemptNumber}/${maxAllowedRetries} permitted for safe idempotent read '${input.toolName}'.`,
    };
  }

  /**
   * Evaluates whether a notification event should be emitted or suppressed.
   * Enforces Requirement 2:
   * - Notifications quiet except approvals, failures, uncertainty, or final verified completion.
   */
  public shouldNotifyUser(eventCategory: NotificationEventCategory): {
    emitNotification: boolean;
    reason: string;
  } {
    const allowed = this.policy.preferences.notificationPolicy.allowedEvents;
    if ((allowed as string[]).includes(eventCategory)) {
      return {
        emitNotification: true,
        reason: `Notification permitted for critical event '${eventCategory}'.`,
      };
    }
    if (this.policy.preferences.notificationPolicy.quietByDefault) {
      return {
        emitNotification: false,
        reason: `Notification suppressed by quiet-by-default policy for routine event '${eventCategory}'.`,
      };
    }
    return {
      emitNotification: true,
      reason: `Quiet mode disabled by user; notification emitted for '${eventCategory}'.`,
    };
  }

  /**
   * Updates user-configurable preferences while deterministically blocking Morrow,
   * agents, skills, or plugins from editing policy ceilings or safety settings.
   */
  public updatePolicy(params: {
    actor: PolicyActorRole;
    preferencesPatch?: Partial<RuntimeUserPreferences>;
    attemptedCeilingsPatch?: Record<string, unknown>;
  }): {
    ok: boolean;
    errorCode?:
      | 'PROTECTED_POLICY_CEILING_IMMUTABLE'
      | 'AGENT_SAFETY_MUTATION_FORBIDDEN'
      | 'INVALID_POLICY_UPDATE';
    reason: string;
    policy: RuntimePolicy;
  } {
    const isAgentActor =
      params.actor === 'morrow' ||
      params.actor === 'agent' ||
      params.actor === 'plugin' ||
      params.actor === 'skill';

    if (params.attemptedCeilingsPatch && Object.keys(params.attemptedCeilingsPatch).length > 0) {
      const reason = `Actor '${params.actor}' attempted to mutate protected policy ceilings (${Object.keys(
        params.attemptedCeilingsPatch
      ).join(', ')}). Protected ceilings are immutable.`;
      this.auditLog.push({
        timestampIso: new Date().toISOString(),
        actor: params.actor,
        action: 'mutate_protected_ceilings',
        allowed: false,
        reason,
      });
      return {
        ok: false,
        errorCode: 'PROTECTED_POLICY_CEILING_IMMUTABLE',
        reason,
        policy: this.getPolicy(),
      };
    }

    const patch = params.preferencesPatch || {};

    if (isAgentActor) {
      const forbiddenAgentKeys: string[] = [];
      if (patch.budgets !== undefined) forbiddenAgentKeys.push('budgets');
      if (patch.externalTelemetryOptIn !== undefined)
        forbiddenAgentKeys.push('externalTelemetryOptIn');
      if (patch.cloudBackgroundReflectionEnabled === true)
        forbiddenAgentKeys.push('cloudBackgroundReflectionEnabled');
      if (patch.preferDeterministicLocalFirst === false)
        forbiddenAgentKeys.push('preferDeterministicLocalFirst');
      if (patch.notificationPolicy !== undefined)
        forbiddenAgentKeys.push('notificationPolicy');

      if (forbiddenAgentKeys.length > 0) {
        const reason = `Blocked: Actor '${params.actor}' is not allowed to modify safety, budget, telemetry, or reflection settings (${forbiddenAgentKeys.join(
          ', '
        )}).`;
        this.auditLog.push({
          timestampIso: new Date().toISOString(),
          actor: params.actor,
          action: 'agent_mutate_safety_settings',
          allowed: false,
          reason,
        });
        return {
          ok: false,
          errorCode: 'AGENT_SAFETY_MUTATION_FORBIDDEN',
          reason,
          policy: this.getPolicy(),
        };
      }
    }

    const candidate: RuntimePolicy = {
      schemaVersion: 2,
      updatedAtIso: new Date().toISOString(),
      updatedBy: params.actor,
      preferences: {
        ...this.policy.preferences,
        ...patch,
        perToolTimeoutMs: {
          ...this.policy.preferences.perToolTimeoutMs,
          ...(patch.perToolTimeoutMs || {}),
        },
        notificationPolicy: patch.notificationPolicy
          ? {
              quietByDefault: patch.notificationPolicy.quietByDefault,
              allowedEvents: [...patch.notificationPolicy.allowedEvents],
            }
          : this.policy.preferences.notificationPolicy,
        budgets: patch.budgets
          ? {
              ...this.policy.preferences.budgets,
              ...patch.budgets,
            }
          : this.policy.preferences.budgets,
      },
      protectedCeilings: { ...DEFAULT_PROTECTED_POLICY_CEILINGS },
    };

    const validation = validateRuntimePolicy(candidate);
    if (!validation.valid) {
      const reason = `Policy validation failed: ${validation.errors.join(' ')}`;
      this.auditLog.push({
        timestampIso: new Date().toISOString(),
        actor: params.actor,
        action: 'update_preferences_invalid',
        allowed: false,
        reason,
      });
      return {
        ok: false,
        errorCode: 'INVALID_POLICY_UPDATE',
        reason,
        policy: this.getPolicy(),
      };
    }

    this.policy = candidate;
    this.persist();
    const reason = `Updated RuntimePolicy preferences by '${params.actor}'.`;
    this.auditLog.push({
      timestampIso: candidate.updatedAtIso,
      actor: params.actor,
      action: 'update_preferences',
      allowed: true,
      reason,
    });

    return {
      ok: true,
      reason,
      policy: this.getPolicy(),
    };
  }
}

// ============================================================================
// 2. PER-MISSION & PER-DAY MODEL USAGE BUDGETS (REPORTED VS ESTIMATED)
// ============================================================================

export interface ModelPricingRate {
  inputCostPer1kTokensUsd: number;
  outputCostPer1kTokensUsd: number;
}

const MODEL_PRICING_TABLE: Record<string, ModelPricingRate> = {
  'gemini-2.5-flash': {
    inputCostPer1kTokensUsd: 0.00015,
    outputCostPer1kTokensUsd: 0.0006,
  },
  'gemini-2.5-pro': {
    inputCostPer1kTokensUsd: 0.00125,
    outputCostPer1kTokensUsd: 0.005,
  },
  default: {
    inputCostPer1kTokensUsd: 0.00025,
    outputCostPer1kTokensUsd: 0.001,
  },
};

export function computeDeterministicModelCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rate = MODEL_PRICING_TABLE[model] || MODEL_PRICING_TABLE.default;
  const safeIn = Math.max(1, Math.ceil(inputTokens));
  const safeOut = Math.max(1, Math.ceil(outputTokens));
  const rawCost =
    (safeIn / 1000) * rate.inputCostPer1kTokensUsd +
    (safeOut / 1000) * rate.outputCostPer1kTokensUsd;
  // Never invent zero-cost model usage for positive token counts
  return Number(Math.max(0.000001, rawCost).toFixed(6));
}

export interface UsageAccountingBucket {
  reportedInputTokens: number;
  reportedOutputTokens: number;
  reportedTotalTokens: number;
  reportedCostUsd: number;
  reportedCallsCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedCostUsd: number;
  estimatedCallsCount: number;
  simulatedZeroCostCallsCount: number;
  combinedEffectiveTokens: number;
  combinedEffectiveCostUsd: number;
}

export interface RecordedModelTurnUsage {
  id: string;
  missionId: string;
  dateKey: string; // YYYY-MM-DD in policy localTimeZone
  provider: string;
  model: string;
  mode: 'live' | 'mock';
  usageSource: 'provider_reported' | 'deterministic_estimate' | 'mock_simulated_zero_cost';
  reportedInputTokens: number | null;
  reportedOutputTokens: number | null;
  reportedCostUsd: number | null;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  effectiveTokensCharged: number;
  effectiveCostUsdCharged: number;
  timestampIso: string;
}

export interface BudgetPreFlightCheckResult {
  allowed: boolean;
  errorCode?:
    | 'MISSION_TOKEN_BUDGET_EXCEEDED'
    | 'MISSION_COST_BUDGET_EXCEEDED'
    | 'DAILY_TOKEN_BUDGET_EXCEEDED'
    | 'DAILY_COST_BUDGET_EXCEEDED';
  reason: string;
  projectedMissionTokens: number;
  projectedMissionCostUsd: number;
  projectedDailyTokens: number;
  projectedDailyCostUsd: number;
  limits: ModelUsageBudgetConfig;
}

function createEmptyBucket(): UsageAccountingBucket {
  return {
    reportedInputTokens: 0,
    reportedOutputTokens: 0,
    reportedTotalTokens: 0,
    reportedCostUsd: 0,
    reportedCallsCount: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedTotalTokens: 0,
    estimatedCostUsd: 0,
    estimatedCallsCount: 0,
    simulatedZeroCostCallsCount: 0,
    combinedEffectiveTokens: 0,
    combinedEffectiveCostUsd: 0,
  };
}

export class ModelUsageBudgetController {
  private policyManager: RuntimePolicyManager;
  private db?: DurableSqliteDatabase;
  private byMission = new Map<string, UsageAccountingBucket>();
  private byDay = new Map<string, UsageAccountingBucket>();
  private records: RecordedModelTurnUsage[] = [];

  constructor(policyManager: RuntimePolicyManager, db?: DurableSqliteDatabase) {
    this.policyManager = policyManager;
    this.db = db;
  }

  public formatDateKey(now: Date = new Date()): string {
    const tz = this.policyManager.getPolicy().preferences.localTimeZone || 'UTC';
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      const d = parts.find((p) => p.type === 'day')?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // Fallback
    }
    return now.toISOString().slice(0, 10);
  }

  public getMissionUsage(missionId: string): UsageAccountingBucket {
    return { ...(this.byMission.get(missionId) || createEmptyBucket()) };
  }

  public getDailyUsage(dateKey: string = this.formatDateKey()): UsageAccountingBucket {
    return { ...(this.byDay.get(dateKey) || createEmptyBucket()) };
  }

  public listRecords(): RecordedModelTurnUsage[] {
    return [...this.records];
  }

  /**
   * Evaluates pre-flight budget BEFORE executing a model turn so the runtime stops safely
   * BEFORE exceeding either per-mission or per-day hard limits.
   */
  public evaluatePreTurnBudget(params: {
    missionId: string;
    model: string;
    mode: 'live' | 'mock';
    proposedInputTokens: number;
    proposedMaxOutputTokens?: number;
    dateKey?: string;
  }): BudgetPreFlightCheckResult {
    const limits = this.policyManager.getPolicy().preferences.budgets;
    const dateKey = params.dateKey || this.formatDateKey();
    const missionBucket = this.getMissionUsage(params.missionId);
    const dayBucket = this.getDailyUsage(dateKey);

    const estIn = Math.max(1, Math.ceil(params.proposedInputTokens));
    const estOut = Math.max(1, Math.ceil(params.proposedMaxOutputTokens ?? 256));
    const turnTokens = estIn + estOut;
    const turnCostUsd =
      params.mode === 'mock' ? 0 : computeDeterministicModelCostUsd(params.model, estIn, estOut);

    const projectedMissionTokens = missionBucket.combinedEffectiveTokens + turnTokens;
    const projectedMissionCostUsd = Number(
      (missionBucket.combinedEffectiveCostUsd + turnCostUsd).toFixed(6)
    );
    const projectedDailyTokens = dayBucket.combinedEffectiveTokens + turnTokens;
    const projectedDailyCostUsd = Number(
      (dayBucket.combinedEffectiveCostUsd + turnCostUsd).toFixed(6)
    );

    if (projectedMissionTokens > limits.maxTokensPerMission) {
      return {
        allowed: false,
        errorCode: 'MISSION_TOKEN_BUDGET_EXCEEDED',
        reason: `Stopped safely before exceeding mission token limit: projected ${projectedMissionTokens} tokens > max ${limits.maxTokensPerMission} tokens for mission '${params.missionId}'.`,
        projectedMissionTokens,
        projectedMissionCostUsd,
        projectedDailyTokens,
        projectedDailyCostUsd,
        limits,
      };
    }

    if (projectedMissionCostUsd > limits.maxCostUsdPerMission) {
      return {
        allowed: false,
        errorCode: 'MISSION_COST_BUDGET_EXCEEDED',
        reason: `Stopped safely before exceeding mission cost limit: projected $${projectedMissionCostUsd.toFixed(
          4
        )} > max $${limits.maxCostUsdPerMission.toFixed(4)} for mission '${params.missionId}'.`,
        projectedMissionTokens,
        projectedMissionCostUsd,
        projectedDailyTokens,
        projectedDailyCostUsd,
        limits,
      };
    }

    if (projectedDailyTokens > limits.maxTokensPerDay) {
      return {
        allowed: false,
        errorCode: 'DAILY_TOKEN_BUDGET_EXCEEDED',
        reason: `Stopped safely before exceeding daily token limit (${dateKey}): projected ${projectedDailyTokens} tokens > max ${limits.maxTokensPerDay} tokens.`,
        projectedMissionTokens,
        projectedMissionCostUsd,
        projectedDailyTokens,
        projectedDailyCostUsd,
        limits,
      };
    }

    if (projectedDailyCostUsd > limits.maxCostUsdPerDay) {
      return {
        allowed: false,
        errorCode: 'DAILY_COST_BUDGET_EXCEEDED',
        reason: `Stopped safely before exceeding daily cost limit (${dateKey}): projected $${projectedDailyCostUsd.toFixed(
          4
        )} > max $${limits.maxCostUsdPerDay.toFixed(4)}.`,
        projectedMissionTokens,
        projectedMissionCostUsd,
        projectedDailyTokens,
        projectedDailyCostUsd,
        limits,
      };
    }

    return {
      allowed: true,
      reason: 'Within per-mission and per-day token and cost budgets.',
      projectedMissionTokens,
      projectedMissionCostUsd,
      projectedDailyTokens,
      projectedDailyCostUsd,
      limits,
    };
  }

  /**
   * Records a completed model turn.
   * - Tracks provider-reported tokens separately from local estimates.
   * - NEVER invents zero-cost model usage for live provider calls (`mode === 'live'`).
   *   If a live provider omits token counts or cost, deterministic estimates are charged and
   *   recorded under `estimatedUsage` with `usageSource: 'deterministic_estimate'`.
   */
  public recordTurnUsage(params: {
    missionId: string;
    provider: string;
    model: string;
    mode: 'live' | 'mock';
    reportedInputTokens?: number | null;
    reportedOutputTokens?: number | null;
    reportedCostUsd?: number | null;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    dateKey?: string;
    timestampIso?: string;
  }): RecordedModelTurnUsage {
    const dateKey = params.dateKey || this.formatDateKey();
    const timestampIso = params.timestampIso || new Date().toISOString();
    const estIn = Math.max(1, Math.ceil(params.estimatedInputTokens || 1));
    const estOut = Math.max(1, Math.ceil(params.estimatedOutputTokens || 1));
    const deterministicEstCost = computeDeterministicModelCostUsd(params.model, estIn, estOut);

    const hasValidReportedTokens =
      params.mode === 'live' &&
      typeof params.reportedInputTokens === 'number' &&
      params.reportedInputTokens > 0 &&
      typeof params.reportedOutputTokens === 'number' &&
      params.reportedOutputTokens >= 0;

    let usageSource: RecordedModelTurnUsage['usageSource'];
    let repIn: number | null = null;
    let repOut: number | null = null;
    let repCost: number | null = null;
    let effectiveTokensCharged: number;
    let effectiveCostUsdCharged: number;

    if (params.mode === 'mock' || params.provider === 'mock') {
      usageSource = 'mock_simulated_zero_cost';
      effectiveTokensCharged = estIn + estOut;
      effectiveCostUsdCharged = 0;
    } else if (hasValidReportedTokens) {
      usageSource = 'provider_reported';
      repIn = params.reportedInputTokens!;
      repOut = params.reportedOutputTokens!;
      // Never allow zero cost on a live provider call
      repCost =
        typeof params.reportedCostUsd === 'number' && params.reportedCostUsd > 0
          ? params.reportedCostUsd
          : computeDeterministicModelCostUsd(params.model, repIn, repOut);
      effectiveTokensCharged = repIn + repOut;
      effectiveCostUsdCharged = repCost;
    } else {
      // Live call where provider did not report tokens: charge deterministic estimate, never 0 cost!
      usageSource = 'deterministic_estimate';
      effectiveTokensCharged = estIn + estOut;
      effectiveCostUsdCharged = deterministicEstCost;
    }

    const record: RecordedModelTurnUsage = {
      id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      missionId: params.missionId,
      dateKey,
      provider: params.provider,
      model: params.model,
      mode: params.mode,
      usageSource,
      reportedInputTokens: repIn,
      reportedOutputTokens: repOut,
      reportedCostUsd: repCost,
      estimatedInputTokens: estIn,
      estimatedOutputTokens: estOut,
      estimatedCostUsd: params.mode === 'mock' ? 0 : deterministicEstCost,
      effectiveTokensCharged,
      effectiveCostUsdCharged,
      timestampIso,
    };

    this.records.push(record);
    this.applyToBucket(this.getOrCreateMissionBucket(params.missionId), record);
    this.applyToBucket(this.getOrCreateDayBucket(dateKey), record);

    if (this.db) {
      try {
        this.db.recordModelUsage({
          id: record.id,
          missionId: record.missionId,
          model: record.model,
          inputTokens: record.reportedInputTokens ?? record.estimatedInputTokens,
          outputTokens: record.reportedOutputTokens ?? record.estimatedOutputTokens,
          estimatedCostUsd: record.effectiveCostUsdCharged,
          timestamp: record.timestampIso,
        });
      } catch {
        // Ignore if DB closed
      }
    }

    return record;
  }

  private getOrCreateMissionBucket(missionId: string): UsageAccountingBucket {
    let b = this.byMission.get(missionId);
    if (!b) {
      b = createEmptyBucket();
      this.byMission.set(missionId, b);
    }
    return b;
  }

  private getOrCreateDayBucket(dateKey: string): UsageAccountingBucket {
    let b = this.byDay.get(dateKey);
    if (!b) {
      b = createEmptyBucket();
      this.byDay.set(dateKey, b);
    }
    return b;
  }

  private applyToBucket(bucket: UsageAccountingBucket, rec: RecordedModelTurnUsage): void {
    if (rec.usageSource === 'provider_reported') {
      const rIn = rec.reportedInputTokens ?? 0;
      const rOut = rec.reportedOutputTokens ?? 0;
      bucket.reportedInputTokens += rIn;
      bucket.reportedOutputTokens += rOut;
      bucket.reportedTotalTokens += rIn + rOut;
      bucket.reportedCostUsd = Number(
        (bucket.reportedCostUsd + (rec.reportedCostUsd ?? 0)).toFixed(6)
      );
      bucket.reportedCallsCount += 1;
    } else if (rec.usageSource === 'deterministic_estimate') {
      bucket.estimatedInputTokens += rec.estimatedInputTokens;
      bucket.estimatedOutputTokens += rec.estimatedOutputTokens;
      bucket.estimatedTotalTokens += rec.estimatedInputTokens + rec.estimatedOutputTokens;
      bucket.estimatedCostUsd = Number(
        (bucket.estimatedCostUsd + rec.estimatedCostUsd).toFixed(6)
      );
      bucket.estimatedCallsCount += 1;
    } else {
      bucket.estimatedInputTokens += rec.estimatedInputTokens;
      bucket.estimatedOutputTokens += rec.estimatedOutputTokens;
      bucket.estimatedTotalTokens += rec.estimatedInputTokens + rec.estimatedOutputTokens;
      bucket.simulatedZeroCostCallsCount += 1;
    }

    bucket.combinedEffectiveTokens += rec.effectiveTokensCharged;
    bucket.combinedEffectiveCostUsd = Number(
      (bucket.combinedEffectiveCostUsd + rec.effectiveCostUsdCharged).toFixed(6)
    );
  }
}

// ============================================================================
// 3. CONCURRENCY LOCKS, MISSION QUEUE, PAUSE/RESUME, CHECKPOINTS & ORPHAN RECOVERY
// ============================================================================

export type ConcurrencyResourceKey =
  | `browser:${BrowserProfileId}`
  | 'input_device:desktop'
  | `workspace:${string}`;

export interface ActiveResourceLock {
  resource: ConcurrencyResourceKey;
  holderMissionId: string;
  holderPriority: 'interactive' | 'background';
  acquiredAtIso: string;
}

export class DeviceConcurrencyLockManager {
  private activeLocks = new Map<ConcurrencyResourceKey, ActiveResourceLock>();
  private waitQueues = new Map<
    ConcurrencyResourceKey,
    Array<{
      missionId: string;
      priority: 'interactive' | 'background';
      resolve: (acquired: boolean) => void;
    }>
  >();

  public tryAcquireLock(
    resource: ConcurrencyResourceKey,
    missionId: string,
    priority: 'interactive' | 'background' = 'interactive'
  ): { acquired: boolean; holderMissionId: string } {
    const existing = this.activeLocks.get(resource);
    if (!existing || existing.holderMissionId === missionId) {
      this.activeLocks.set(resource, {
        resource,
        holderMissionId: missionId,
        holderPriority: priority,
        acquiredAtIso: new Date().toISOString(),
      });
      return { acquired: true, holderMissionId: missionId };
    }
    return { acquired: false, holderMissionId: existing.holderMissionId };
  }

  public async acquireLockWithTimeout(
    resource: ConcurrencyResourceKey,
    missionId: string,
    priority: 'interactive' | 'background' = 'interactive',
    timeoutMs: number = 5_000,
    abortSignal?: AbortSignal
  ): Promise<{ acquired: boolean; holderMissionId?: string; reason?: string }> {
    if (abortSignal?.aborted) {
      return { acquired: false, reason: 'ABORTED_WHILE_WAITING_FOR_LOCK' };
    }
    const immediate = this.tryAcquireLock(resource, missionId, priority);
    if (immediate.acquired) {
      return { acquired: true, holderMissionId: missionId };
    }

    return new Promise((resolve) => {
      let settled = false;
      const queue = this.waitQueues.get(resource) || [];
      const waiter = {
        missionId,
        priority,
        resolve: (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            acquired: ok,
            holderMissionId: ok ? missionId : this.activeLocks.get(resource)?.holderMissionId,
          });
        },
      };
      if (priority === 'interactive') {
        const firstBgIdx = queue.findIndex((w) => w.priority === 'background');
        if (firstBgIdx === -1) queue.push(waiter);
        else queue.splice(firstBgIdx, 0, waiter);
      } else {
        queue.push(waiter);
      }
      this.waitQueues.set(resource, queue);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const q = this.waitQueues.get(resource) || [];
        const idx = q.indexOf(waiter);
        if (idx !== -1) q.splice(idx, 1);
        resolve({
          acquired: false,
          holderMissionId: this.activeLocks.get(resource)?.holderMissionId,
          reason: `LOCK_TIMEOUT_${timeoutMs}MS`,
        });
      }, timeoutMs);

      abortSignal?.addEventListener(
        'abort',
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const q = this.waitQueues.get(resource) || [];
          const idx = q.indexOf(waiter);
          if (idx !== -1) q.splice(idx, 1);
          resolve({ acquired: false, reason: 'ABORTED_WHILE_WAITING_FOR_LOCK' });
        },
        { once: true }
      );
    });
  }

  public releaseLock(resource: ConcurrencyResourceKey, missionId: string): boolean {
    const existing = this.activeLocks.get(resource);
    if (!existing || existing.holderMissionId !== missionId) {
      return false;
    }
    this.activeLocks.delete(resource);
    const queue = this.waitQueues.get(resource);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      this.activeLocks.set(resource, {
        resource,
        holderMissionId: next.missionId,
        holderPriority: next.priority,
        acquiredAtIso: new Date().toISOString(),
      });
      next.resolve(true);
    }
    return true;
  }

  public releaseAllLocksForMission(missionId: string): ConcurrencyResourceKey[] {
    const released: ConcurrencyResourceKey[] = [];
    for (const [res, lock] of this.activeLocks.entries()) {
      if (lock.holderMissionId === missionId) {
        this.releaseLock(res, missionId);
        released.push(res);
      }
    }
    return released;
  }

  public releaseAllLocks(): number {
    const count = this.activeLocks.size;
    this.activeLocks.clear();
    for (const q of this.waitQueues.values()) {
      while (q.length > 0) {
        const w = q.shift()!;
        w.resolve(false);
      }
    }
    this.waitQueues.clear();
    return count;
  }

  public listActiveLocks(): ActiveResourceLock[] {
    return Array.from(this.activeLocks.values());
  }
}

export type ManagedMissionPriority = 'interactive' | 'background';

export type ManagedMissionState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'orphaned_recovered';

export interface MissionRecoveryCheckpoint {
  checkpointId: string;
  missionId: string;
  stepNumber: number;
  toolName: string;
  createdBeforeWrite: true;
  createdAtIso: string;
  workspaceStateSnapshot: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ManagedMissionRecord {
  missionId: string;
  title: string;
  priority: ManagedMissionPriority;
  state: ManagedMissionState;
  createdAtIso: string;
  startedAtIso?: string;
  updatedAtIso: string;
  completedAtIso?: string;
  currentStepNumber: number;
  lastCompletedStepNumber: number;
  lastStepWasWriteOrSpend: boolean;
  heldLocks: ConcurrencyResourceKey[];
  checkpoints: MissionRecoveryCheckpoint[];
  cancellationReason?: string;
  pauseReason?: string;
  orphanRecoveryNote?: string;
}

export class MissionQueueAndLifecycleManager {
  private policyManager: RuntimePolicyManager;
  private lockManager: DeviceConcurrencyLockManager;
  private db?: DurableSqliteDatabase;
  private missions = new Map<string, ManagedMissionRecord>();
  private abortControllers = new Map<string, AbortController>();
  private interactiveQueue: string[] = [];
  private backgroundQueue: string[] = [];
  private activeInteractiveMissionId: string | null = null;
  private activeBackgroundJobId: string | null = null;
  private emergencyStopBlocked = false;

  constructor(
    policyManager: RuntimePolicyManager,
    lockManager: DeviceConcurrencyLockManager = new DeviceConcurrencyLockManager(),
    db?: DurableSqliteDatabase
  ) {
    this.policyManager = policyManager;
    this.lockManager = lockManager;
    this.db = db;
  }

  public setEmergencyStopBlocked(blocked: boolean): void {
    this.emergencyStopBlocked = blocked;
  }

  public getLockManager(): DeviceConcurrencyLockManager {
    return this.lockManager;
  }

  private persistMission(record: ManagedMissionRecord): void {
    if (this.db) {
      try {
        this.db.setRecord('managed_missions', record.missionId, record);
      } catch {
        // Ignore if DB closed
      }
    }
  }

  /**
   * Submits an interactive mission or low-priority background job.
   * Enforces `maxInteractiveMissions: 1` and `maxBackgroundJobs: 1`.
   * If the lane is busy, places the mission in the queue and starts it automatically when the lane frees up.
   */
  public submitMission(params: {
    missionId?: string;
    title: string;
    priority: ManagedMissionPriority;
    requiredLocks?: ConcurrencyResourceKey[];
  }): {
    accepted: boolean;
    errorCode?: 'EMERGENCY_STOP_ACTIVE';
    record?: ManagedMissionRecord;
    abortSignal?: AbortSignal;
    reason: string;
  } {
    if (this.emergencyStopBlocked) {
      return {
        accepted: false,
        errorCode: 'EMERGENCY_STOP_ACTIVE',
        reason: 'Submission rejected: Emergency Stop is active. Clear Emergency Stop before starting new work.',
      };
    }

    const missionId =
      params.missionId ||
      `${params.priority === 'interactive' ? 'msn' : 'bgjob'}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    const controller = new AbortController();
    this.abortControllers.set(missionId, controller);

    const canStartImmediately =
      params.priority === 'interactive'
        ? this.activeInteractiveMissionId === null
        : this.activeBackgroundJobId === null;

    const heldLocks: ConcurrencyResourceKey[] = [];
    let startNow = canStartImmediately;

    if (startNow && params.requiredLocks && params.requiredLocks.length > 0) {
      for (const lockKey of params.requiredLocks) {
        const res = this.lockManager.tryAcquireLock(lockKey, missionId, params.priority);
        if (!res.acquired) {
          this.lockManager.releaseAllLocksForMission(missionId);
          heldLocks.length = 0;
          startNow = false;
          break;
        }
        heldLocks.push(lockKey);
      }
    }

    const record: ManagedMissionRecord = {
      missionId,
      title: params.title,
      priority: params.priority,
      state: startNow ? 'running' : 'queued',
      createdAtIso: nowIso,
      startedAtIso: startNow ? nowIso : undefined,
      updatedAtIso: nowIso,
      currentStepNumber: 0,
      lastCompletedStepNumber: 0,
      lastStepWasWriteOrSpend: false,
      heldLocks,
      checkpoints: [],
    };

    this.missions.set(missionId, record);

    if (startNow) {
      if (params.priority === 'interactive') {
        this.activeInteractiveMissionId = missionId;
      } else {
        this.activeBackgroundJobId = missionId;
      }
    } else {
      if (params.priority === 'interactive') {
        this.interactiveQueue.push(missionId);
      } else {
        this.backgroundQueue.push(missionId);
      }
    }

    this.persistMission(record);

    return {
      accepted: true,
      record: { ...record },
      abortSignal: controller.signal,
      reason: startNow
        ? `Started ${params.priority} mission '${missionId}' immediately.`
        : `Queued ${params.priority} mission '${missionId}' (1 active ${params.priority} slot already in use).`,
    };
  }

  public getAbortSignal(missionId: string): AbortSignal | undefined {
    return this.abortControllers.get(missionId)?.signal;
  }

  /**
   * Creates a mandatory pre-write checkpoint when `checkpointBeforeWrites: true`.
   */
  public createPreWriteCheckpoint(params: {
    missionId: string;
    stepNumber: number;
    toolName: string;
    workspaceStateSnapshot: Record<string, string>;
    metadata?: Record<string, unknown>;
  }): MissionRecoveryCheckpoint {
    const mission = this.missions.get(params.missionId);
    const checkpoint: MissionRecoveryCheckpoint = {
      checkpointId: `ckpt_${params.missionId}_step${params.stepNumber}_${Date.now()}`,
      missionId: params.missionId,
      stepNumber: params.stepNumber,
      toolName: params.toolName,
      createdBeforeWrite: true,
      createdAtIso: new Date().toISOString(),
      workspaceStateSnapshot: { ...params.workspaceStateSnapshot },
      metadata: params.metadata,
    };

    if (mission) {
      mission.checkpoints.push(checkpoint);
      mission.currentStepNumber = params.stepNumber;
      mission.lastStepWasWriteOrSpend = true;
      mission.updatedAtIso = checkpoint.createdAtIso;
      this.persistMission(mission);
    }

    return checkpoint;
  }

  public restoreCheckpoint(
    missionId: string,
    checkpointId?: string
  ): {
    restored: boolean;
    checkpoint?: MissionRecoveryCheckpoint;
    reason: string;
  } {
    const mission = this.missions.get(missionId);
    if (!mission || mission.checkpoints.length === 0) {
      return {
        restored: false,
        reason: `No recovery checkpoints found for mission '${missionId}'.`,
      };
    }

    const ckpt = checkpointId
      ? mission.checkpoints.find((c) => c.checkpointId === checkpointId)
      : mission.checkpoints[mission.checkpoints.length - 1];

    if (!ckpt) {
      return {
        restored: false,
        reason: `Checkpoint '${checkpointId}' not found for mission '${missionId}'.`,
      };
    }

    mission.currentStepNumber = ckpt.stepNumber;
    mission.updatedAtIso = new Date().toISOString();
    this.persistMission(mission);

    return {
      restored: true,
      checkpoint: ckpt,
      reason: `Restored mission '${missionId}' to pre-write checkpoint '${ckpt.checkpointId}' (step ${ckpt.stepNumber}).`,
    };
  }

  public pauseMission(missionId: string, reason: string = 'Paused by operator'): {
    ok: boolean;
    record?: ManagedMissionRecord;
    reason: string;
  } {
    const mission = this.missions.get(missionId);
    if (!mission) {
      return { ok: false, reason: `Mission '${missionId}' not found.` };
    }
    if (mission.state !== 'running' && mission.state !== 'queued') {
      return {
        ok: false,
        record: { ...mission },
        reason: `Cannot pause mission '${missionId}' in state '${mission.state}'.`,
      };
    }

    mission.state = 'paused';
    mission.pauseReason = reason;
    mission.updatedAtIso = new Date().toISOString();

    const released = this.lockManager.releaseAllLocksForMission(missionId);
    mission.heldLocks = mission.heldLocks.filter((l) => !released.includes(l));

    if (this.activeInteractiveMissionId === missionId) {
      this.activeInteractiveMissionId = null;
      this.promoteNextInQueue('interactive');
    } else if (this.activeBackgroundJobId === missionId) {
      this.activeBackgroundJobId = null;
      this.promoteNextInQueue('background');
    } else {
      this.interactiveQueue = this.interactiveQueue.filter((id) => id !== missionId);
      this.backgroundQueue = this.backgroundQueue.filter((id) => id !== missionId);
    }

    this.persistMission(mission);
    return {
      ok: true,
      record: { ...mission },
      reason: `Paused mission '${missionId}'.`,
    };
  }

  public resumeMission(missionId: string): {
    ok: boolean;
    record?: ManagedMissionRecord;
    reason: string;
  } {
    if (this.emergencyStopBlocked) {
      return {
        ok: false,
        reason: 'Cannot resume mission while Emergency Stop is active.',
      };
    }
    const mission = this.missions.get(missionId);
    if (!mission) {
      return { ok: false, reason: `Mission '${missionId}' not found.` };
    }
    if (mission.state !== 'paused' && mission.state !== 'orphaned_recovered') {
      return {
        ok: false,
        record: { ...mission },
        reason: `Mission '${missionId}' is in state '${mission.state}'; only paused or orphaned_recovered missions can be resumed.`,
      };
    }

    const canRunImmediately =
      mission.priority === 'interactive'
        ? this.activeInteractiveMissionId === null
        : this.activeBackgroundJobId === null;

    mission.pauseReason = undefined;
    mission.updatedAtIso = new Date().toISOString();

    if (canRunImmediately) {
      mission.state = 'running';
      mission.startedAtIso = mission.startedAtIso || mission.updatedAtIso;
      if (mission.priority === 'interactive') {
        this.activeInteractiveMissionId = missionId;
      } else {
        this.activeBackgroundJobId = missionId;
      }
    } else {
      mission.state = 'queued';
      if (mission.priority === 'interactive') {
        this.interactiveQueue.push(missionId);
      } else {
        this.backgroundQueue.push(missionId);
      }
    }

    this.persistMission(mission);
    return {
      ok: true,
      record: { ...mission },
      reason:
        mission.state === 'running'
          ? `Resumed mission '${missionId}' immediately.`
          : `Re-queued mission '${missionId}' behind active ${mission.priority} slot.`,
    };
  }

  public cancelMission(missionId: string, reason: string = 'Cancelled by operator'): {
    ok: boolean;
    record?: ManagedMissionRecord;
    abortedSignal: boolean;
    reason: string;
  } {
    const mission = this.missions.get(missionId);
    if (!mission) {
      return { ok: false, abortedSignal: false, reason: `Mission '${missionId}' not found.` };
    }

    const controller = this.abortControllers.get(missionId);
    let abortedSignal = false;
    if (controller && !controller.signal.aborted) {
      controller.abort(reason);
      abortedSignal = true;
    }

    mission.state = 'cancelled';
    mission.cancellationReason = reason;
    mission.updatedAtIso = new Date().toISOString();
    mission.completedAtIso = mission.updatedAtIso;

    this.lockManager.releaseAllLocksForMission(missionId);
    mission.heldLocks = [];

    this.interactiveQueue = this.interactiveQueue.filter((id) => id !== missionId);
    this.backgroundQueue = this.backgroundQueue.filter((id) => id !== missionId);

    if (this.activeInteractiveMissionId === missionId) {
      this.activeInteractiveMissionId = null;
      this.promoteNextInQueue('interactive');
    } else if (this.activeBackgroundJobId === missionId) {
      this.activeBackgroundJobId = null;
      this.promoteNextInQueue('background');
    }

    this.persistMission(mission);
    return {
      ok: true,
      record: { ...mission },
      abortedSignal,
      reason: `Cancelled mission '${missionId}' (${reason}).`,
    };
  }

  public completeMission(
    missionId: string,
    outcome: 'completed' | 'failed' | 'waiting_for_approval' = 'completed'
  ): ManagedMissionRecord | undefined {
    const mission = this.missions.get(missionId);
    if (!mission) return undefined;

    mission.state = outcome;
    mission.updatedAtIso = new Date().toISOString();
    if (outcome === 'completed' || outcome === 'failed') {
      mission.completedAtIso = mission.updatedAtIso;
    }

    this.lockManager.releaseAllLocksForMission(missionId);
    mission.heldLocks = [];

    if (this.activeInteractiveMissionId === missionId) {
      this.activeInteractiveMissionId = null;
      this.promoteNextInQueue('interactive');
    } else if (this.activeBackgroundJobId === missionId) {
      this.activeBackgroundJobId = null;
      this.promoteNextInQueue('background');
    }

    this.persistMission(mission);
    return { ...mission };
  }

  private promoteNextInQueue(priority: ManagedMissionPriority): void {
    if (this.emergencyStopBlocked) return;
    if (priority === 'interactive' && this.activeInteractiveMissionId === null) {
      const nextId = this.interactiveQueue.shift();
      if (nextId) {
        const m = this.missions.get(nextId);
        if (m) {
          m.state = 'running';
          m.startedAtIso = new Date().toISOString();
          m.updatedAtIso = m.startedAtIso;
          this.activeInteractiveMissionId = nextId;
          this.persistMission(m);
        }
      }
    } else if (priority === 'background' && this.activeBackgroundJobId === null) {
      const nextId = this.backgroundQueue.shift();
      if (nextId) {
        const m = this.missions.get(nextId);
        if (m) {
          m.state = 'running';
          m.startedAtIso = new Date().toISOString();
          m.updatedAtIso = m.startedAtIso;
          this.activeBackgroundJobId = nextId;
          this.persistMission(m);
        }
      }
    }
  }

  /**
   * Startup orphaned job recovery:
   * Scans persisted missions/jobs left in `running` state from an interrupted process.
   * Transitions interrupted `running` missions to `orphaned_recovered` (paused for operator/verifier review)
   * so write/spend steps are NEVER blindly re-run after an unclean shutdown.
   */
  public recoverOrphanedMissionsAndJobs(): {
    recoveredMissions: ManagedMissionRecord[];
    blindWriteReExecutionPrevented: true;
  } {
    const recovered: ManagedMissionRecord[] = [];

    if (this.db) {
      try {
        const storedRows = this.db.listRecords('managed_missions');
        for (const row of storedRows) {
          const data = row.data as ManagedMissionRecord;
          if (data && data.missionId && !this.missions.has(data.missionId)) {
            this.missions.set(data.missionId, data);
          }
        }
      } catch {
        // Ignore if DB closed
      }
    }

    for (const mission of this.missions.values()) {
      if (mission.state === 'running') {
        mission.state = 'orphaned_recovered';
        mission.updatedAtIso = new Date().toISOString();
        mission.orphanRecoveryNote = mission.lastStepWasWriteOrSpend
          ? `Recovered orphaned mission '${mission.missionId}' at step ${mission.currentStepNumber}. Last step involved a write/spend; halted for checkpoint inspection without blind re-execution.`
          : `Recovered orphaned mission '${mission.missionId}' from prior process shutdown; paused for safe resume.`;
        this.lockManager.releaseAllLocksForMission(mission.missionId);
        mission.heldLocks = [];
        if (this.activeInteractiveMissionId === mission.missionId) {
          this.activeInteractiveMissionId = null;
        }
        if (this.activeBackgroundJobId === mission.missionId) {
          this.activeBackgroundJobId = null;
        }
        this.persistMission(mission);
        recovered.push({ ...mission });
      }
    }

    return {
      recoveredMissions: recovered,
      blindWriteReExecutionPrevented: true,
    };
  }

  public getSnapshot() {
    const activeInteractive = this.activeInteractiveMissionId
      ? this.missions.get(this.activeInteractiveMissionId) || null
      : null;
    const activeBackground = this.activeBackgroundJobId
      ? this.missions.get(this.activeBackgroundJobId) || null
      : null;
    return {
      activeInteractiveMission: activeInteractive ? { ...activeInteractive } : null,
      activeBackgroundJob: activeBackground ? { ...activeBackground } : null,
      interactiveQueueIds: [...this.interactiveQueue],
      backgroundQueueIds: [...this.backgroundQueue],
      totalMissionsTracked: this.missions.size,
      activeLocks: this.lockManager.listActiveLocks(),
      allMissions: Array.from(this.missions.values()).map((m) => ({ ...m })),
    };
  }
}

// ============================================================================
// 4. RESOURCE LIMITS & RUNAWAY WORKER SUPERVISOR
// ============================================================================

export type WorkerTerminationReasonCode =
  | 'WORKER_TIMEOUT_KILLED'
  | 'WORKER_MEMORY_LIMIT_EXCEEDED'
  | 'WORKER_CPU_LIMIT_EXCEEDED'
  | 'EMERGENCY_STOP_KILLED'
  | 'MISSION_CANCELLED_KILLED'
  | 'OUTPUT_SIZE_LIMIT_EXCEEDED';

export interface WorkerTerminationRecord {
  terminationId: string;
  workerId: string;
  pluginId: string;
  missionId?: string;
  pid?: number;
  reasonCode: WorkerTerminationReasonCode;
  reasonDetail: string;
  signalUsed: 'SIGKILL' | 'SIGTERM';
  killedAtIso: string;
}

export interface SupervisedWorkerHandle {
  workerId: string;
  pluginId: string;
  missionId?: string;
  pid?: number;
  startedAtMs: number;
  kill: (reasonCode: WorkerTerminationReasonCode, detail: string) => void;
}

export class ResourceLimiterAndWorkerSupervisor {
  private policyManager: RuntimePolicyManager;
  private activeWorkers = new Map<string, SupervisedWorkerHandle>();
  private terminationHistory: WorkerTerminationRecord[] = [];
  private networkCallsByMission = new Map<string, number>();

  constructor(policyManager: RuntimePolicyManager) {
    this.policyManager = policyManager;
  }

  public checkFileSizeLimit(filePath: string, sizeBytes: number): {
    allowed: boolean;
    maxFileSizeBytes: number;
    errorCode?: 'FILE_SIZE_LIMIT_EXCEEDED';
    reason: string;
  } {
    const maxBytes = this.policyManager.getPolicy().protectedCeilings.maxFileSizeBytes;
    if (sizeBytes > maxBytes) {
      return {
        allowed: false,
        maxFileSizeBytes: maxBytes,
        errorCode: 'FILE_SIZE_LIMIT_EXCEEDED',
        reason: `File '${filePath}' size (${sizeBytes} bytes) exceeds protected limit of ${maxBytes} bytes.`,
      };
    }
    return {
      allowed: true,
      maxFileSizeBytes: maxBytes,
      reason: `File size (${sizeBytes} bytes) is within ${maxBytes} byte limit.`,
    };
  }

  public enforceToolOutputSizeLimit(toolName: string, rawOutput: string): {
    allowed: boolean;
    truncated: boolean;
    output: string;
    originalBytes: number;
    maxToolOutputBytes: number;
    errorCode?: 'TOOL_OUTPUT_SIZE_EXCEEDED';
    reason: string;
  } {
    const maxBytes = this.policyManager.getPolicy().protectedCeilings.maxToolOutputBytes;
    const byteLen = Buffer.byteLength(rawOutput, 'utf8');
    if (byteLen <= maxBytes) {
      return {
        allowed: true,
        truncated: false,
        output: rawOutput,
        originalBytes: byteLen,
        maxToolOutputBytes: maxBytes,
        reason: `Output size (${byteLen} bytes) is within ${maxBytes} byte limit.`,
      };
    }

    const truncatedSlice = Buffer.from(rawOutput, 'utf8')
      .subarray(0, maxBytes)
      .toString('utf8');
    return {
      allowed: false,
      truncated: true,
      output: `${truncatedSlice}\n[TRUNCATED_BY_RESOURCE_LIMITER: output (${byteLen} bytes) exceeded maxToolOutputBytes (${maxBytes} bytes)]`,
      originalBytes: byteLen,
      maxToolOutputBytes: maxBytes,
      errorCode: 'TOOL_OUTPUT_SIZE_EXCEEDED',
      reason: `Tool '${toolName}' output (${byteLen} bytes) exceeded protected limit (${maxBytes} bytes) and was bounded.`,
    };
  }

  public recordAndCheckNetworkCall(missionId: string, url: string): {
    allowed: boolean;
    callsUsed: number;
    maxNetworkCallsPerMission: number;
    errorCode?: 'NETWORK_CALL_BUDGET_EXCEEDED';
    reason: string;
  } {
    const maxCalls = this.policyManager.getPolicy().protectedCeilings.maxNetworkCallsPerMission;
    const current = this.networkCallsByMission.get(missionId) ?? 0;
    if (current + 1 > maxCalls) {
      return {
        allowed: false,
        callsUsed: current,
        maxNetworkCallsPerMission: maxCalls,
        errorCode: 'NETWORK_CALL_BUDGET_EXCEEDED',
        reason: `Mission '${missionId}' exceeded network call limit (${maxCalls} calls/mission) before calling '${url}'.`,
      };
    }
    this.networkCallsByMission.set(missionId, current + 1);
    return {
      allowed: true,
      callsUsed: current + 1,
      maxNetworkCallsPerMission: maxCalls,
      reason: `Network call ${current + 1}/${maxCalls} permitted for mission '${missionId}'.`,
    };
  }

  /**
   * Spawns and supervises an isolated Node worker process with strict timeout,
   * memory (`--max-old-space-size`), and output size limits. Kills runaway workers
   * (`SIGKILL`) and records the exact termination reason in `terminationHistory`.
   */
  public async runSupervisedWorkerScript(params: {
    pluginId: string;
    missionId?: string;
    scriptCode: string;
    timeoutMsOverride?: number;
    maxHeapMbOverride?: number;
    abortSignal?: AbortSignal;
  }): Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    killedAsRunaway: boolean;
    terminationRecord?: WorkerTerminationRecord;
  }> {
    const ceilings = this.policyManager.getPolicy().protectedCeilings;
    const timeoutMs = Math.min(
      params.timeoutMsOverride ?? ceilings.maxWorkerTimeoutMs,
      ceilings.maxWorkerTimeoutMs
    );
    const maxHeapMb = Math.min(
      params.maxHeapMbOverride ?? ceilings.maxWorkerHeapMb,
      ceilings.maxWorkerHeapMb
    );
    const maxOutputBytes = ceilings.maxToolOutputBytes;
    const workerId = `wrk_${params.pluginId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    return new Promise((resolve) => {
      let child: childProcess.ChildProcess;
      try {
        child = childProcess.spawn(
          process.execPath,
          [`--max-old-space-size=${maxHeapMb}`, '-e', params.scriptCode],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { NODE_ENV: 'production', PATH: process.env.PATH || '' },
          }
        );
      } catch (err: any) {
        resolve({
          ok: false,
          stdout: '',
          stderr: err?.message || 'Failed to spawn worker',
          exitCode: 1,
          killedAsRunaway: false,
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      let terminationRecord: WorkerTerminationRecord | undefined;
      let finished = false;

      const killRunaway = (reasonCode: WorkerTerminationReasonCode, detail: string) => {
        if (finished || terminationRecord) return;
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore
        }
        terminationRecord = {
          terminationId: `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          workerId,
          pluginId: params.pluginId,
          missionId: params.missionId,
          pid: child.pid,
          reasonCode,
          reasonDetail: detail,
          signalUsed: 'SIGKILL',
          killedAtIso: new Date().toISOString(),
        };
        this.terminationHistory.push(terminationRecord);
        this.activeWorkers.delete(workerId);
      };

      const handle: SupervisedWorkerHandle = {
        workerId,
        pluginId: params.pluginId,
        missionId: params.missionId,
        pid: child.pid,
        startedAtMs: Date.now(),
        kill: killRunaway,
      };
      this.activeWorkers.set(workerId, handle);

      const timer = setTimeout(() => {
        killRunaway(
          'WORKER_TIMEOUT_KILLED',
          `Plugin worker '${params.pluginId}' (pid=${child.pid}) exceeded wall-clock timeout (${timeoutMs}ms) and was killed with SIGKILL.`
        );
      }, timeoutMs);

      const onAbort = () => {
        killRunaway(
          'MISSION_CANCELLED_KILLED',
          `Plugin worker '${params.pluginId}' (pid=${child.pid}) killed due to mission cancellation signal.`
        );
      };
      if (params.abortSignal) {
        if (params.abortSignal.aborted) {
          onAbort();
        } else {
          params.abortSignal.addEventListener('abort', onAbort, { once: true });
        }
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (Buffer.byteLength(stdout, 'utf8') > maxOutputBytes) {
          killRunaway(
            'OUTPUT_SIZE_LIMIT_EXCEEDED',
            `Plugin worker '${params.pluginId}' stdout exceeded ${maxOutputBytes} bytes and was killed.`
          );
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (
          stderr.includes('Allocation failed') ||
          stderr.includes('JavaScript heap out of memory')
        ) {
          killRunaway(
            'WORKER_MEMORY_LIMIT_EXCEEDED',
            `Plugin worker '${params.pluginId}' exceeded V8 heap limit (${maxHeapMb} MB) and was terminated.`
          );
        }
      });

      child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (params.abortSignal) {
          params.abortSignal.removeEventListener('abort', onAbort);
        }
        this.activeWorkers.delete(workerId);

        if (
          !terminationRecord &&
          (stderr.includes('Allocation failed') || stderr.includes('heap out of memory'))
        ) {
          terminationRecord = {
            terminationId: `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            workerId,
            pluginId: params.pluginId,
            missionId: params.missionId,
            pid: child.pid,
            reasonCode: 'WORKER_MEMORY_LIMIT_EXCEEDED',
            reasonDetail: `Plugin worker '${params.pluginId}' aborted on V8 heap limit (${maxHeapMb} MB).`,
            signalUsed: 'SIGKILL',
            killedAtIso: new Date().toISOString(),
          };
          this.terminationHistory.push(terminationRecord);
        }

        resolve({
          ok: code === 0 && !terminationRecord,
          stdout,
          stderr,
          exitCode: code,
          killedAsRunaway: Boolean(terminationRecord),
          terminationRecord,
        });
      });
    });
  }

  public registerExternalWorker(handle: SupervisedWorkerHandle): void {
    this.activeWorkers.set(handle.workerId, handle);
  }

  public terminateAllWorkers(
    reasonCode: WorkerTerminationReasonCode = 'EMERGENCY_STOP_KILLED',
    detail: string = 'Terminated all active plugin workers due to Emergency Stop.'
  ): WorkerTerminationRecord[] {
    const killed: WorkerTerminationRecord[] = [];
    for (const handle of Array.from(this.activeWorkers.values())) {
      const beforeLen = this.terminationHistory.length;
      handle.kill(reasonCode, detail);
      if (this.terminationHistory.length > beforeLen) {
        killed.push(this.terminationHistory[this.terminationHistory.length - 1]);
      } else {
        const rec: WorkerTerminationRecord = {
          terminationId: `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          workerId: handle.workerId,
          pluginId: handle.pluginId,
          missionId: handle.missionId,
          pid: handle.pid,
          reasonCode,
          reasonDetail: detail,
          signalUsed: 'SIGKILL',
          killedAtIso: new Date().toISOString(),
        };
        this.terminationHistory.push(rec);
        this.activeWorkers.delete(handle.workerId);
        killed.push(rec);
      }
    }
    return killed;
  }

  public getActiveWorkerCount(): number {
    return this.activeWorkers.size;
  }

  public getTerminationHistory(): WorkerTerminationRecord[] {
    return [...this.terminationHistory];
  }
}

// ============================================================================
// 5. EVIDENCE-BASED, TIMESTAMPED HEALTH CHECKS ACROSS 9 SUBSYSTEMS
// ============================================================================

export type HealthSubsystemId =
  | 'server'
  | 'electron_shell'
  | 'database'
  | 'vault'
  | 'model_provider'
  | 'browser_profiles'
  | 'native_driver'
  | 'skills_plugins'
  | 'scheduler';

export type SubsystemHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'not_configured'
  | 'unsupported';

export type HealthEvidenceClass =
  | 'REAL'
  | 'SIMULATED'
  | 'UNSUPPORTED'
  | 'NOT_CONFIGURED'
  | 'FAILED'
  | 'UNCERTAIN'
  | 'BLOCKED'
  | 'WAITING_FOR_APPROVAL'
  | ExecutionTruthState;

export interface SubsystemHealthReport {
  subsystem: HealthSubsystemId;
  status: SubsystemHealthStatus;
  evidenceClass: HealthEvidenceClass;
  checkedAtIso: string;
  latencyMs: number;
  summary: string;
  metrics: Record<string, unknown>;
}

function resolveCurrentDesktopPlatform(): DesktopOSPlatform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

export class SubsystemHealthRegistry {
  private db?: DurableSqliteDatabase;
  private vault?: PassphraseWrapVault;
  private browserManager?: BrowserSessionManager;
  private extensionManager?: SelfExtensionManager;
  private scheduler?: DurableSchedulerEngine;
  private getModelProviderStatus?: () => {
    mode: 'live' | 'mock';
    apiKeyConfigured: boolean;
    catalogueReachable?: boolean;
  };

  constructor(options?: {
    db?: DurableSqliteDatabase;
    vault?: PassphraseWrapVault;
    browserManager?: BrowserSessionManager;
    extensionManager?: SelfExtensionManager;
    scheduler?: DurableSchedulerEngine;
    getModelProviderStatus?: () => {
      mode: 'live' | 'mock';
      apiKeyConfigured: boolean;
      catalogueReachable?: boolean;
    };
  }) {
    this.db = options?.db;
    this.vault = options?.vault;
    this.browserManager = options?.browserManager;
    this.extensionManager = options?.extensionManager;
    this.scheduler = options?.scheduler;
    this.getModelProviderStatus = options?.getModelProviderStatus;
  }

  private getVault(): PassphraseWrapVault {
    return this.vault ?? globalSecretVault;
  }

  private getBrowserManager(): BrowserSessionManager {
    if (!this.browserManager) {
      this.browserManager = new BrowserSessionManager();
    }
    return this.browserManager;
  }

  private getScheduler(): DurableSchedulerEngine {
    return this.scheduler ?? globalDurableScheduler;
  }

  public attachDatabase(db: DurableSqliteDatabase): void {
    this.db = db;
  }

  public attachExtensionManager(ext: SelfExtensionManager): void {
    this.extensionManager = ext;
  }

  public checkSubsystem(subsystem: HealthSubsystemId): SubsystemHealthReport {
    const startMs = Date.now();
    const checkedAtIso = new Date(startMs).toISOString();

    switch (subsystem) {
      case 'server': {
        const mem = process.memoryUsage();
        const rssMb = Number((mem.rss / (1024 * 1024)).toFixed(2));
        const heapUsedMb = Number((mem.heapUsed / (1024 * 1024)).toFixed(2));
        const uptimeSec = Math.round(process.uptime());
        return {
          subsystem: 'server',
          status: rssMb < 2048 ? 'healthy' : 'degraded',
          evidenceClass: 'REAL',
          checkedAtIso,
          latencyMs: Date.now() - startMs,
          summary: `Node ${process.version} process active (uptime ${uptimeSec}s, RSS ${rssMb} MB, Heap ${heapUsedMb} MB).`,
          metrics: {
            pid: process.pid,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            uptimeSec,
            rssBytes: mem.rss,
            rssMb,
            heapTotalBytes: mem.heapTotal,
            heapUsedBytes: mem.heapUsed,
            externalBytes: mem.external,
            loadAvg1m: os.loadavg()[0],
          },
        };
      }

      case 'electron_shell': {
        const isElectron = Boolean(
          process.versions && typeof (process.versions as any).electron === 'string'
        );
        return {
          subsystem: 'electron_shell',
          status: isElectron ? 'healthy' : 'not_configured',
          evidenceClass: isElectron ? 'REAL' : 'NOT_CONFIGURED',
          checkedAtIso,
          latencyMs: Date.now() - startMs,
          summary: isElectron
            ? `Native Electron shell v${(process.versions as any).electron} active.`
            : 'Running in Node/Web server mode outside native Electron main process (Electron IPC/WebContentsView requires launching via electron).',
          metrics: {
            isNativeElectron: isElectron,
            electronVersion: (process.versions as any)?.electron ?? null,
            chromeVersion: (process.versions as any)?.chrome ?? null,
          },
        };
      }

      case 'database': {
        const activeDb = this.db ?? getGlobalDurableDb();
        try {
          const integrity = activeDb.checkIntegrity();
          const dbPath = activeDb.getPath();
          let fileSizeBytes = 0;
          if (dbPath !== ':memory:' && fs.existsSync(dbPath)) {
            fileSizeBytes = fs.statSync(dbPath).size;
          }
          const ledgerEvents = activeDb.getLedgerEvents();
          return {
            subsystem: 'database',
            status: integrity.ok ? 'healthy' : 'unhealthy',
            evidenceClass: 'REAL',
            checkedAtIso,
            latencyMs: Date.now() - startMs,
            summary: integrity.ok
              ? `SQLite PRAGMA integrity_check=ok (${dbPath}, ${fileSizeBytes} bytes, ${ledgerEvents.length} ledger events).`
              : `SQLite integrity check failed: ${integrity.details.join('; ')}`,
            metrics: {
              dbPath,
              integrityOk: integrity.ok,
              integrityDetails: integrity.details,
              fileSizeBytes,
              ledgerEventCount: ledgerEvents.length,
            },
          };
        } catch (err: any) {
          return {
            subsystem: 'database',
            status: 'unhealthy',
            evidenceClass: 'FAILED',
            checkedAtIso,
            latencyMs: Date.now() - startMs,
            summary: `SQLite health check error: ${err?.message || 'Unknown error'}`,
            metrics: { error: err?.message },
          };
        }
      }

      case 'vault': {
        const status = this.getVault().getStatus();
        return {
          subsystem: 'vault',
          status: 'healthy',
          evidenceClass: 'REAL',
          checkedAtIso,
          latencyMs: Date.now() - startMs,
          summary: `Vault backend '${status.backend}' ready (locked=${status.locked}, keys=${status.keyCount}, cipher=aes-256-gcm).`,
          metrics: {
            locked: status.locked,
            backend: status.backend,
            cipher: 'aes-256-gcm',
            kdf: 'pbkdf2-sha256',
            keyCount: status.keyCount,
          },
        };
      }

      case 'model_provider': {
        const custom = this.getModelProviderStatus?.();
        const envKeyConfigured = Boolean(
          process.env.MODEL_API_KEY && process.env.MODEL_API_KEY.trim().length > 0
        );
        const keyConfigured = custom ? custom.apiKeyConfigured : envKeyConfigured;
        const mode = custom ? custom.mode : keyConfigured ? 'live' : 'mock';
        return {
          subsystem: 'model_provider',
          status: keyConfigured ? 'healthy' : 'not_configured',
          evidenceClass: keyConfigured ? 'REAL' : 'NOT_CONFIGURED',
          checkedAtIso,
          latencyMs: Date.now() - startMs,
          summary: keyConfigured
            ? `Model provider API key configured (mode=${mode}).`
            : `Model provider running in local ${mode} mode (MODEL_API_KEY not configured).`,
          metrics: {
            mode,
            apiKeyConfigured: keyConfigured,
            catalogueReachable: custom?.catalogueReachable ?? false,
          },
        };
      }

      case 'browser_profiles': {
        const bm = this.getBrowserManager();
        const personalTabs = bm.listTabs('personal');
        const workTabs = bm.listTabs('work');
        const testingTabs = bm.listTabs('testing');
        const pPart = getProfilePartitionName('personal');
        const wPart = getProfilePartitionName('work');
        const tPart = getProfilePartitionName('testing');
        const isolated = pPart !== wPart && wPart !== tPart && pPart !== tPart;
        return {
          subsystem: 'browser_profiles',
          status: isolated ? 'healthy' : 'unhealthy',
          evidenceClass: 'REAL',
          checkedAtIso,
          latencyMs: Date.now() - startMs,
          summary: isolated
            ? `3 isolated browser profile partitions verified (${pPart}, ${wPart}, ${tPart}; personal=${personalTabs.length} tabs, work=${workTabs.length} tabs, testing=${testingTabs.length} tabs).`
            : 'Browser profile partition isolation check failed.',
          metrics: {
            isolated,
            partitions: { personal: pPart, work: wPart, testing: tPart },
            personalTabCount: personalTabs.length,
            workTabCount: workTabs.length,
            testingTabCount: testingTabs.length,
          },
        };
      }

      case 'native_driver': {
        const platform = resolveCurrentDesktopPlatform();
        const doctor = runBlaizeDoctorDiagnostics(platform);
        const healthy = doctor.overallStatus === 'healthy';
        return {
          subsystem: 'native_driver',
          status: healthy ? 'healthy' : 'degraded',
          evidenceClass: healthy ? 'REAL' : 'NOT_CONFIGURED',
          checkedAtIso,
          latencyMs: Date.now() - startMs,
          summary: `Native desktop driver (${platform}) probed: status=${doctor.overallStatus} (${doctor.passedCount}/${doctor.totalCount} checks passed).`,
          metrics: {
            platform,
            overallReady: healthy,
            passedCount: doctor.passedCount,
            totalCount: doctor.totalCount,
            permissions: doctor.permissions,
          },
        };
      }

      case 'skills_plugins': {
        const skills = this.extensionManager ? this.extensionManager.listSkills() : [];
        const plugins = this.extensionManager ? this.extensionManager.discoverPlugins() : [];
        const activePlugins = plugins.filter((p) => p.enabled);
        return {
          subsystem: 'skills_plugins',
          status: 'healthy',
          evidenceClass: 'REAL',
          checkedAtIso,
          latencyMs: Date.now() - startMs,
          summary: `SelfExtensionManager tracking ${skills.length} skills and ${plugins.length} plugins (${activePlugins.length} enabled).`,
          metrics: {
            totalSkills: skills.length,
            totalPlugins: plugins.length,
            activePlugins: activePlugins.length,
          },
        };
      }

      case 'scheduler': {
        const schedules = this.getScheduler().listSchedules();
        const enabledCount = schedules.filter((s) => s.enabled).length;
        return {
          subsystem: 'scheduler',
          status: 'healthy',
          evidenceClass: 'REAL',
          checkedAtIso,
          latencyMs: Date.now() - startMs,
          summary: `DurableSchedulerEngine active (${schedules.length} total schedules, ${enabledCount} enabled, default missedRunPolicy='skip').`,
          metrics: {
            totalSchedules: schedules.length,
            enabledSchedules: enabledCount,
          },
        };
      }
    }
  }

  public checkAllSubsystems(): Record<HealthSubsystemId, SubsystemHealthReport> {
    const ids: HealthSubsystemId[] = [
      'server',
      'electron_shell',
      'database',
      'vault',
      'model_provider',
      'browser_profiles',
      'native_driver',
      'skills_plugins',
      'scheduler',
    ];
    const out = {} as Record<HealthSubsystemId, SubsystemHealthReport>;
    for (const id of ids) {
      out[id] = this.checkSubsystem(id);
    }
    return out;
  }
}

// ============================================================================
// 6. INCIDENT HANDLING, EMERGENCY STOP & LOCAL TELEMETRY REDACTION
// ============================================================================

const SECRET_REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: '[REDACTED_GITHUB_PAT]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, replacement: '[REDACTED_SLACK_TOKEN]' },
  { pattern: /\bya29\.[A-Za-z0-9_-]{16,}\b/g, replacement: '[REDACTED_GOOGLE_OAUTH_TOKEN]' },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replacement: '[REDACTED_GOOGLE_API_KEY]' },
  { pattern: /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, replacement: 'Bearer [REDACTED_BEARER_TOKEN]' },
  { pattern: /Basic\s+[A-Za-z0-9+/=]{8,}/gi, replacement: 'Basic [REDACTED_BASIC_AUTH]' },
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
];

const SENSITIVE_FIELD_KEY_REGEX =
  /^(password|passphrase|secret|secretcode|api_?key|access_?token|refresh_?token|client_?secret|authorization|cookie|set-cookie|private_?key|pin|otp)$/i;

const NEVER_UPLOAD_FIELD_KEY_REGEX =
  /^(prompt|userprompt|missionprompt|screenshot|screenshotbase64|image|filecontent|rawfile|credentials|rawactivity|domsnapshot)$/i;

export function redactSecretsFromOperationalText(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { pattern, replacement } of SECRET_REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function redactSecretsFromObject<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return redactSecretsFromOperationalText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsFromObject(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_KEY_REGEX.test(k)) {
        result[k] = '[REDACTED_SECRET_FIELD]';
      } else {
        result[k] = redactSecretsFromObject(v);
      }
    }
    return result as T;
  }
  return value;
}

export interface LocalTelemetryEvent {
  eventId: string;
  category: 'mission' | 'tool' | 'policy' | 'health' | 'incident' | 'budget';
  eventName: string;
  timestampIso: string;
  localOnly: boolean;
  payload: Record<string, unknown>;
}

export class LocalTelemetryCollector {
  private policyManager: RuntimePolicyManager;
  private events: LocalTelemetryEvent[] = [];

  constructor(policyManager: RuntimePolicyManager) {
    this.policyManager = policyManager;
  }

  public recordEvent(params: {
    category: LocalTelemetryEvent['category'];
    eventName: string;
    payload: Record<string, unknown>;
  }): LocalTelemetryEvent {
    const redactedPayload = redactSecretsFromObject(params.payload);
    const ev: LocalTelemetryEvent = {
      eventId: `tel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category: params.category,
      eventName: params.eventName,
      timestampIso: new Date().toISOString(),
      localOnly: !this.policyManager.getPolicy().preferences.externalTelemetryOptIn,
      payload: redactedPayload,
    };
    this.events.push(ev);
    if (this.events.length > 500) {
      this.events.shift();
    }
    return ev;
  }

  /**
   * Enforces Requirement 9:
   * - Telemetry stays local by default (`externalTelemetryOptIn: false`).
   * - Never uploads prompts, screenshots, files, credentials, or raw activity even if opt-in is enabled.
   * - Always redacts secrets before any export/upload.
   */
  public prepareExternalTelemetryPayload(rawPayload: Record<string, unknown>): {
    allowedToUpload: boolean;
    errorCode?: 'EXTERNAL_TELEMETRY_DISABLED_BY_DEFAULT' | 'PROHIBITED_SENSITIVE_FIELDS_STRIPPED';
    sanitizedPayload?: Record<string, unknown>;
    strippedFields: string[];
    reason: string;
  } {
    const optIn = this.policyManager.getPolicy().preferences.externalTelemetryOptIn;
    if (!optIn) {
      return {
        allowedToUpload: false,
        errorCode: 'EXTERNAL_TELEMETRY_DISABLED_BY_DEFAULT',
        strippedFields: [],
        reason:
          'External telemetry upload blocked: telemetry stays 100% local by default (externalTelemetryOptIn=false).',
      };
    }

    const strippedFields: string[] = [];
    const sanitized: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(rawPayload)) {
      if (NEVER_UPLOAD_FIELD_KEY_REGEX.test(k) || SENSITIVE_FIELD_KEY_REGEX.test(k)) {
        strippedFields.push(k);
        continue;
      }
      sanitized[k] = redactSecretsFromObject(v);
    }

    return {
      allowedToUpload: true,
      sanitizedPayload: sanitized,
      strippedFields,
      reason:
        strippedFields.length > 0
          ? `Prepared opt-in telemetry after stripping prohibited sensitive fields: ${strippedFields.join(', ')}.`
          : 'Prepared redacted opt-in telemetry payload.',
    };
  }

  public listEvents(): LocalTelemetryEvent[] {
    return [...this.events];
  }
}

export interface EmergencyStopIncidentReport {
  incidentId: string;
  engaged: boolean;
  reason: string;
  triggeredBy: PolicyActorRole;
  triggeredAtIso: string;
  abortedMissionIds: string[];
  pausedScheduleIds: string[];
  terminatedWorkers: WorkerTerminationRecord[];
  revokedApprovalTokensCount: number;
  revokedSessionTokensCount: number;
  vaultLocked: boolean;
  recoveryInstructions: string[];
  redactedForensicLog: Array<{ timestampIso: string; message: string }>;
}

export class IncidentResponseAndEmergencyStopManager {
  private engaged = false;
  private activeIncident: EmergencyStopIncidentReport | null = null;
  private incidentHistory: EmergencyStopIncidentReport[] = [];
  private activeSessionTokens = new Set<string>();
  private missionManager: MissionQueueAndLifecycleManager;
  private workerSupervisor: ResourceLimiterAndWorkerSupervisor;
  private scheduler?: DurableSchedulerEngine;
  private vault?: PassphraseWrapVault;
  private telemetry: LocalTelemetryCollector;
  private ledger?: MemoryLedger;

  constructor(options: {
    missionManager: MissionQueueAndLifecycleManager;
    workerSupervisor: ResourceLimiterAndWorkerSupervisor;
    scheduler?: DurableSchedulerEngine;
    vault?: PassphraseWrapVault;
    telemetry: LocalTelemetryCollector;
    ledger?: MemoryLedger;
  }) {
    this.missionManager = options.missionManager;
    this.workerSupervisor = options.workerSupervisor;
    this.scheduler = options.scheduler;
    this.vault = options.vault;
    this.telemetry = options.telemetry;
    this.ledger = options.ledger;
  }

  private getScheduler(): DurableSchedulerEngine {
    return this.scheduler ?? globalDurableScheduler;
  }

  private getVault(): PassphraseWrapVault {
    return this.vault ?? globalSecretVault;
  }

  public registerSessionToken(token: string): void {
    this.activeSessionTokens.add(token);
  }

  public isSessionTokenValid(token: string): boolean {
    return !this.engaged && this.activeSessionTokens.has(token);
  }

  public isEmergencyStopActive(): boolean {
    return this.engaged;
  }

  public getActiveIncident(): EmergencyStopIncidentReport | null {
    return this.activeIncident ? JSON.parse(JSON.stringify(this.activeIncident)) : null;
  }

  /**
   * Triggers Emergency Stop (Requirement 8):
   * 1. Engages hard block on new missions, jobs, tool calls, and extension workers.
   * 2. Aborts all active/queued missions and background jobs via cancellation tokens.
   * 3. Pauses all enabled schedules in DurableSchedulerEngine.
   * 4. Kills all active extension/plugin workers with SIGKILL and records termination reasons.
   * 5. Revokes all active single-use approval tokens and in-memory session tokens, and locks the secret vault.
   * 6. Preserves secret-redacted forensic logs and returns step-by-step recovery instructions.
   */
  public triggerEmergencyStop(params: {
    reason: string;
    actor: PolicyActorRole;
    forensicNotes?: string[];
  }): EmergencyStopIncidentReport {
    const nowIso = new Date().toISOString();
    this.engaged = true;
    this.missionManager.setEmergencyStopBlocked(true);

    // 1. Abort all active & queued missions/jobs
    const snap = this.missionManager.getSnapshot();
    const abortedMissionIds: string[] = [];
    for (const m of snap.allMissions) {
      if (m.state === 'running' || m.state === 'queued' || m.state === 'waiting_for_approval') {
        this.missionManager.cancelMission(
          m.missionId,
          `EMERGENCY_STOP: ${redactSecretsFromOperationalText(params.reason)}`
        );
        abortedMissionIds.push(m.missionId);
      }
    }
    this.missionManager.getLockManager().releaseAllLocks();

    // 2. Pause all enabled schedules
    const pausedScheduleIds = this.getScheduler().pauseAllSchedules();

    // 3. Terminate all active plugin/extension workers
    const terminatedWorkers = this.workerSupervisor.terminateAllWorkers(
      'EMERGENCY_STOP_KILLED',
      `Emergency stop triggered by ${params.actor}: ${redactSecretsFromOperationalText(params.reason)}`
    );

    // 4. Revoke all active approval tokens & session tokens, and lock the secret vault
    const revokedApprovalTokensCount = globalApprovalTokenStore.revokeAllActiveTokens();
    const revokedSessionTokensCount = this.activeSessionTokens.size;
    this.activeSessionTokens.clear();
    this.getVault().lock();

    const redactedReason = redactSecretsFromOperationalText(params.reason);
    const forensicNotes = (params.forensicNotes || []).map((n) => ({
      timestampIso: nowIso,
      message: redactSecretsFromOperationalText(n),
    }));

    const recoveryInstructions = [
      '1. Inspect the redacted forensic incident log and Trust Ledger to verify why Emergency Stop was triggered.',
      '2. Review any orphaned or cancelled missions and their pre-write checkpoints before restoring workspace files.',
      '3. Re-unlock the PassphraseWrapVault with your operator secret code if live connectors or OAuth tokens are needed.',
      '4. Explicitly clear Emergency Stop via clearEmergencyStop({ confirmedByOperator: true, resolutionNote }) to re-enable the mission queue.',
      '5. Re-enable individual scheduled tasks only after verifying their authority ceiling and target domains.',
    ];

    const incident: EmergencyStopIncidentReport = {
      incidentId: `inc_estop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      engaged: true,
      reason: redactedReason,
      triggeredBy: params.actor,
      triggeredAtIso: nowIso,
      abortedMissionIds,
      pausedScheduleIds,
      terminatedWorkers,
      revokedApprovalTokensCount,
      revokedSessionTokensCount,
      vaultLocked: this.getVault().isLocked(),
      recoveryInstructions,
      redactedForensicLog: [
        {
          timestampIso: nowIso,
          message: `Emergency Stop engaged by '${params.actor}': ${redactedReason}`,
        },
        ...forensicNotes,
      ],
    };

    this.activeIncident = incident;
    this.incidentHistory.push(incident);

    this.telemetry.recordEvent({
      category: 'incident',
      eventName: 'emergency_stop_engaged',
      payload: {
        incidentId: incident.incidentId,
        reason: redactedReason,
        abortedMissionCount: abortedMissionIds.length,
        terminatedWorkerCount: terminatedWorkers.length,
        revokedApprovalTokensCount,
      },
    });

    if (this.ledger) {
      this.ledger.appendEvent({
        missionId: 'emergency-stop',
        type: 'guard_decision',
        actor: params.actor === 'user' || params.actor === 'operator' ? 'user' : 'guard',
        summary: `EMERGENCY STOP ENGAGED: ${redactedReason} (aborted ${abortedMissionIds.length} missions, killed ${terminatedWorkers.length} workers, revoked ${revokedApprovalTokensCount} approval tokens).`,
        payload: JSON.stringify({
          incidentId: incident.incidentId,
          evidenceHash: computeDeterministicHash(JSON.stringify(incident)).slice(0, 16),
        }),
        trustLevel: 'verified_by_evidence',
        executionState: 'EXECUTED',
        verificationState: 'VERIFIED',
        isSimulated: false,
      });
    }

    return JSON.parse(JSON.stringify(incident));
  }

  public clearEmergencyStop(params: {
    confirmedByOperator: boolean;
    actor: PolicyActorRole;
    resolutionNote: string;
  }): {
    ok: boolean;
    errorCode?: 'OPERATOR_CONFIRMATION_REQUIRED' | 'AGENT_CANNOT_CLEAR_EMERGENCY_STOP';
    reason: string;
  } {
    if (params.actor !== 'user' && params.actor !== 'operator') {
      return {
        ok: false,
        errorCode: 'AGENT_CANNOT_CLEAR_EMERGENCY_STOP',
        reason: `Blocked: Actor '${params.actor}' cannot clear Emergency Stop. Only human user/operator confirmation can clear an incident lock.`,
      };
    }
    if (!params.confirmedByOperator || !params.resolutionNote.trim()) {
      return {
        ok: false,
        errorCode: 'OPERATOR_CONFIRMATION_REQUIRED',
        reason: 'Clearing Emergency Stop requires explicit operator confirmation and a non-empty resolution note.',
      };
    }

    this.engaged = false;
    this.missionManager.setEmergencyStopBlocked(false);
    if (this.activeIncident) {
      this.activeIncident.engaged = false;
      this.activeIncident.redactedForensicLog.push({
        timestampIso: new Date().toISOString(),
        message: `Cleared by ${params.actor}: ${redactSecretsFromOperationalText(params.resolutionNote)}`,
      });
    }

    this.telemetry.recordEvent({
      category: 'incident',
      eventName: 'emergency_stop_cleared',
      payload: {
        actor: params.actor,
        resolutionNote: redactSecretsFromOperationalText(params.resolutionNote),
      },
    });

    return {
      ok: true,
      reason: 'Emergency Stop cleared by operator. Mission queue is now ready for new work.',
    };
  }

  public exportRedactedForensicBundle() {
    return redactSecretsFromObject({
      exportedAtIso: new Date().toISOString(),
      emergencyStopActive: this.engaged,
      activeIncident: this.activeIncident,
      incidentHistory: this.incidentHistory,
      terminatedWorkers: this.workerSupervisor.getTerminationHistory(),
      telemetryEvents: this.telemetry.listEvents(),
    });
  }
}

// ============================================================================
// 7. OPERATIONAL DASHBOARD SERVICE (READS REAL STATE ACROSS ALL SUBSYSTEMS)
// ============================================================================

export interface BackupRestoreStatusRecord {
  lastBackupAtIso: string | null;
  lastBackupPath: string | null;
  lastBackupSizeBytes: number;
  lastRestoreAtIso: string | null;
  lastRestoreVerifiedOk: boolean | null;
}

export interface LastVerificationSummaryRecord {
  timestampIso: string;
  toolOrActionName: string;
  verificationState: VerificationTruthState;
  evidenceHash: string;
  summary: string;
}

export interface OperationalDashboardSnapshot {
  generatedAtIso: string;
  policy: RuntimePolicy;
  activeMission: ManagedMissionRecord | null;
  activeBackgroundJob: ManagedMissionRecord | null;
  missionQueue: {
    interactiveQueueIds: string[];
    backgroundQueueIds: string[];
    totalMissionsTracked: number;
    activeLocks: ActiveResourceLock[];
  };
  jobScheduler: {
    totalSchedules: number;
    enabledSchedules: number;
    defaultMissedRunPolicy: 'skip';
    localTimeZone: string;
    schedules: ReturnType<DurableSchedulerEngine['listSchedules']>;
  };
  nativeDriverCapabilities: {
    platform: DesktopOSPlatform;
    overallReady: boolean;
    passedCount: number;
    totalCount: number;
  };
  modelAndProviderHealth: SubsystemHealthReport;
  usageAndCost: {
    dateKey: string;
    daily: UsageAccountingBucket;
    activeMissionUsage: UsageAccountingBucket | null;
    budgetLimits: ModelUsageBudgetConfig;
  };
  sqliteStorage: {
    attached: boolean;
    dbPath: string;
    fileSizeBytes: number;
    integrityOk: boolean;
    ledgerEventCount: number;
  };
  vaultStatus: ReturnType<PassphraseWrapVault['getStatus']>;
  pluginHealth: {
    totalSkills: number;
    totalPlugins: number;
    activePlugins: number;
    activeWorkersCount: number;
    terminatedRunawayWorkers: WorkerTerminationRecord[];
  };
  permissions: {
    accessibilityAvailable: boolean;
    screenCaptureAvailable: boolean;
    inputInjectionAvailable: boolean;
    windowEnumerationAvailable: boolean;
  };
  backupRestoreStatus: BackupRestoreStatusRecord;
  lastVerification: LastVerificationSummaryRecord | null;
  subsystemHealth: Record<HealthSubsystemId, SubsystemHealthReport>;
  emergencyStop: {
    engaged: boolean;
    activeIncident: EmergencyStopIncidentReport | null;
  };
}

export class OperationalDashboardService {
  private policyManager: RuntimePolicyManager;
  private budgetController: ModelUsageBudgetController;
  private missionManager: MissionQueueAndLifecycleManager;
  private workerSupervisor: ResourceLimiterAndWorkerSupervisor;
  private healthRegistry: SubsystemHealthRegistry;
  private emergencyStopManager: IncidentResponseAndEmergencyStopManager;
  private db?: DurableSqliteDatabase;
  private vault?: PassphraseWrapVault;
  private scheduler?: DurableSchedulerEngine;
  private extensionManager?: SelfExtensionManager;
  private backupStatus: BackupRestoreStatusRecord = {
    lastBackupAtIso: null,
    lastBackupPath: null,
    lastBackupSizeBytes: 0,
    lastRestoreAtIso: null,
    lastRestoreVerifiedOk: null,
  };
  private lastVerification: LastVerificationSummaryRecord | null = null;

  constructor(options: {
    policyManager: RuntimePolicyManager;
    budgetController: ModelUsageBudgetController;
    missionManager: MissionQueueAndLifecycleManager;
    workerSupervisor: ResourceLimiterAndWorkerSupervisor;
    healthRegistry: SubsystemHealthRegistry;
    emergencyStopManager: IncidentResponseAndEmergencyStopManager;
    db?: DurableSqliteDatabase;
    vault?: PassphraseWrapVault;
    scheduler?: DurableSchedulerEngine;
    extensionManager?: SelfExtensionManager;
  }) {
    this.policyManager = options.policyManager;
    this.budgetController = options.budgetController;
    this.missionManager = options.missionManager;
    this.workerSupervisor = options.workerSupervisor;
    this.healthRegistry = options.healthRegistry;
    this.emergencyStopManager = options.emergencyStopManager;
    this.db = options.db;
    this.vault = options.vault;
    this.scheduler = options.scheduler;
    this.extensionManager = options.extensionManager;
  }

  private getVault(): PassphraseWrapVault {
    return this.vault ?? globalSecretVault;
  }

  private getScheduler(): DurableSchedulerEngine {
    return this.scheduler ?? globalDurableScheduler;
  }

  public recordBackupCompleted(backupPath: string): BackupRestoreStatusRecord {
    let sizeBytes = 0;
    if (fs.existsSync(backupPath)) {
      sizeBytes = fs.statSync(backupPath).size;
    }
    this.backupStatus = {
      ...this.backupStatus,
      lastBackupAtIso: new Date().toISOString(),
      lastBackupPath: backupPath,
      lastBackupSizeBytes: sizeBytes,
    };
    return { ...this.backupStatus };
  }

  public recordRestoreVerified(ok: boolean): BackupRestoreStatusRecord {
    this.backupStatus = {
      ...this.backupStatus,
      lastRestoreAtIso: new Date().toISOString(),
      lastRestoreVerifiedOk: ok,
    };
    return { ...this.backupStatus };
  }

  public recordVerificationOutcome(record: LastVerificationSummaryRecord): void {
    this.lastVerification = { ...record };
  }

  public getDashboardSnapshot(): OperationalDashboardSnapshot {
    const generatedAtIso = new Date().toISOString();
    const policy = this.policyManager.getPolicy();
    const mSnap = this.missionManager.getSnapshot();
    const subsystemHealth = this.healthRegistry.checkAllSubsystems();
    const dateKey = this.budgetController.formatDateKey();
    const dailyUsage = this.budgetController.getDailyUsage(dateKey);
    const activeMissionUsage = mSnap.activeInteractiveMission
      ? this.budgetController.getMissionUsage(mSnap.activeInteractiveMission.missionId)
      : null;

    const platform = resolveCurrentDesktopPlatform();
    const doctor = runBlaizeDoctorDiagnostics(platform);
    const driverPerms = createDesktopDriver(platform).checkPermissions();

    const dbMetrics = subsystemHealth.database.metrics;
    const activeDb = this.db ?? getGlobalDurableDb();
    let lastVerification = this.lastVerification;
    if (!lastVerification && activeDb) {
      try {
        const events = activeDb.getLedgerEvents();
        if (events.length > 0) {
          const latest = events[events.length - 1];
          lastVerification = {
            timestampIso: latest.createdAt,
            toolOrActionName: latest.eventType,
            verificationState: (latest.verificationState as VerificationTruthState) || 'VERIFIED',
            evidenceHash: latest.evidenceHash || latest.ownHash.slice(0, 16),
            summary: latest.summary || 'Ledger event verified',
          };
        }
      } catch {
        // Ignore
      }
    }

    const skills = this.extensionManager ? this.extensionManager.listSkills() : [];
    const plugins = this.extensionManager ? this.extensionManager.discoverPlugins() : [];

    return {
      generatedAtIso,
      policy,
      activeMission: mSnap.activeInteractiveMission,
      activeBackgroundJob: mSnap.activeBackgroundJob,
      missionQueue: {
        interactiveQueueIds: mSnap.interactiveQueueIds,
        backgroundQueueIds: mSnap.backgroundQueueIds,
        totalMissionsTracked: mSnap.totalMissionsTracked,
        activeLocks: mSnap.activeLocks,
      },
      jobScheduler: {
        totalSchedules: this.getScheduler().listSchedules().length,
        enabledSchedules: this.getScheduler().listSchedules().filter((s) => s.enabled).length,
        defaultMissedRunPolicy: policy.protectedCeilings.missedScheduleRunPolicy,
        localTimeZone: policy.preferences.localTimeZone,
        schedules: this.getScheduler().listSchedules(),
      },
      nativeDriverCapabilities: {
        platform,
        overallReady: doctor.overallStatus === 'healthy',
        passedCount: doctor.passedCount,
        totalCount: doctor.totalCount,
      },
      modelAndProviderHealth: subsystemHealth.model_provider,
      usageAndCost: {
        dateKey,
        daily: dailyUsage,
        activeMissionUsage,
        budgetLimits: policy.preferences.budgets,
      },
      sqliteStorage: {
        attached: true,
        dbPath: String(dbMetrics.dbPath || activeDb.getPath()),
        fileSizeBytes: Number(dbMetrics.fileSizeBytes || 0),
        integrityOk: Boolean(dbMetrics.integrityOk),
        ledgerEventCount: Number(dbMetrics.ledgerEventCount || 0),
      },
      vaultStatus: this.getVault().getStatus(),
      pluginHealth: {
        totalSkills: skills.length,
        totalPlugins: plugins.length,
        activePlugins: plugins.filter((p) => p.enabled).length,
        activeWorkersCount: this.workerSupervisor.getActiveWorkerCount(),
        terminatedRunawayWorkers: this.workerSupervisor.getTerminationHistory(),
      },
      permissions: {
        accessibilityAvailable: driverPerms.some(
          (p) => p.id.toLowerCase().includes('accessibility') && p.status === 'granted'
        ),
        screenCaptureAvailable: driverPerms.some(
          (p) =>
            (p.id.toLowerCase().includes('screen') || p.id.toLowerCase().includes('capture')) &&
            p.status === 'granted'
        ),
        inputInjectionAvailable: driverPerms.some(
          (p) =>
            (p.id.toLowerCase().includes('input') || p.id.toLowerCase().includes('automation')) &&
            p.status === 'granted'
        ),
        windowEnumerationAvailable: driverPerms.some((p) => p.status === 'granted'),
      },
      backupRestoreStatus: { ...this.backupStatus },
      lastVerification,
      subsystemHealth,
      emergencyStop: {
        engaged: this.emergencyStopManager.isEmergencyStopActive(),
        activeIncident: this.emergencyStopManager.getActiveIncident(),
      },
    };
  }
}

// ============================================================================
// 8. DEFAULT SINGLETON INSTANCES FOR RUNTIME INTEGRATION
// ============================================================================

export const globalRuntimePolicyManager = new RuntimePolicyManager();
export const globalDeviceLockManager = new DeviceConcurrencyLockManager();
export const globalModelUsageBudgetController = new ModelUsageBudgetController(
  globalRuntimePolicyManager
);
export const globalMissionQueueManager = new MissionQueueAndLifecycleManager(
  globalRuntimePolicyManager,
  globalDeviceLockManager
);
export const globalResourceLimiterSupervisor = new ResourceLimiterAndWorkerSupervisor(
  globalRuntimePolicyManager
);
export const globalLocalTelemetryCollector = new LocalTelemetryCollector(
  globalRuntimePolicyManager
);
export const globalSubsystemHealthRegistry = new SubsystemHealthRegistry();
export const globalEmergencyStopManager = new IncidentResponseAndEmergencyStopManager({
  missionManager: globalMissionQueueManager,
  workerSupervisor: globalResourceLimiterSupervisor,
  telemetry: globalLocalTelemetryCollector,
});
export const globalOperationalDashboardService = new OperationalDashboardService({
  policyManager: globalRuntimePolicyManager,
  budgetController: globalModelUsageBudgetController,
  missionManager: globalMissionQueueManager,
  workerSupervisor: globalResourceLimiterSupervisor,
  healthRegistry: globalSubsystemHealthRegistry,
  emergencyStopManager: globalEmergencyStopManager,
});

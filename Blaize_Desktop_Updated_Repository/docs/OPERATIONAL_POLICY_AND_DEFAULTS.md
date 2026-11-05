# Blaize Operational Policy, Defaults & Observability

This document describes the operational management defaults, runtime policy boundaries, budget controls, concurrency locks, subsystem health checks, resource limits, emergency stop procedures, and telemetry redaction rules enforced by `src/packages/runtime/operations_and_observability.ts`.

---

## 1. Operational Defaults (`RuntimePolicy` Schema v2)

Blaize starts with conservative, deterministic operational defaults enforced in code via `RuntimePolicyManager`:

| Operational Setting | Default Value | Purpose |
| :--- | :--- | :--- |
| **Interactive Missions** | `1` (`maxInteractiveMissions: 1`) | At most one interactive mission executes at a time; additional interactive requests enter the priority queue. |
| **Background Jobs** | `1` (`maxBackgroundJobs: 1`) | At most one low-priority background job executes concurrently. |
| **Cloud Background Reflection** | `false` (`cloudBackgroundReflectionEnabled: false`) | Background cloud reflection is disabled by default so no unprompted cloud token spend occurs. |
| **Deterministic / Local First** | `true` (`preferDeterministicLocalFirst: true`) | Local deterministic tools and verifiers run before invoking external cloud models. |
| **Safe Idempotent Read Retries** | `2` (`maxSafeIdempotentRetries: 2`) | Read-only (`riskClass === 'read'`) and idempotent (`idempotent === true`) operations may retry up to 2 times. |
| **Write / Spend / Send / Uncertain Retries** | `false` (`allowRetriesForWriteSpendSendUncertain: false`) | Zero blind retries for writes, spending, external sends, destructive actions, or `UNCERTAIN` outcomes. |
| **Default Tool Timeout** | `15,000 ms` (`defaultToolTimeoutMs: 15000`) | Configurable per-tool and default wall-clock timeout clamped within `[500 ms, 120,000 ms]`. |
| **Checkpoint Before Writes** | `true` (`checkpointBeforeWrites: true`) | A recovery checkpoint (`MissionRecoveryCheckpoint`) is persisted before any write/spend step. |
| **Local IANA Timezone** | System IANA timezone (fallback `'UTC'`) | Validated via `Intl.DateTimeFormat` so daily budgets and cron schedules align with local wall-clock time. |
| **Missed Schedule Runs** | `'skip'` (`missedScheduleRunPolicy: 'skip'`) | Missed cron slots while offline or asleep are skipped by default and never auto-fire destructive actions on wake. |
| **Notification Policy** | `quietByDefault: true` | Routine progress/heartbeats are suppressed; notifications fire only for `approval_required`, `failure`, `uncertainty`, and `final_verified_completion`. |
| **External Telemetry** | `false` (`externalTelemetryOptIn: false`) | Telemetry stays 100% local by default. |

---

## 2. User-Configurable Preferences vs. Protected Policy Ceilings

`RuntimePolicy` strictly separates **User-Configurable Preferences** (`policy.preferences`) from **Protected Policy Ceilings** (`policy.protectedCeilings`).

- **Morrow / Agent / Skill / Plugin Prohibition**: Deterministic actor checks in `RuntimePolicyManager.updatePolicy()` block `actor: 'morrow' | 'agent' | 'plugin' | 'skill'` from editing `protectedCeilings` (`PROTECTED_POLICY_CEILING_IMMUTABLE`) and from modifying budgets, telemetry opt-in, cloud background reflection, or notification policy (`AGENT_SAFETY_MUTATION_FORBIDDEN`).

| Setting Path | Plane / Classification | Editable by Human User / Operator? | Editable by Morrow / Agent / Plugin? | Hard Ceiling / Invariant |
| :--- | :--- | :--- | :--- | :--- |
| `preferences.defaultToolTimeoutMs` | User Preference | Yes (within `[500, 120000]` ms) | Yes (within `[500, 120000]` ms) | `minToolTimeoutFloorMs: 500`, `maxToolTimeoutCeilingMs: 120000` |
| `preferences.perToolTimeoutMs` | User Preference | Yes (within `[500, 120000]` ms) | Yes (within `[500, 120000]` ms) | Clamped by floor/ceiling |
| `preferences.localTimeZone` | User Preference | Yes (valid IANA timezone) | Yes (valid IANA timezone) | Must pass `isValidIanaTimeZone()` |
| `preferences.budgets.*` | Operator Safety Budget | Yes (up to ceiling) | **No** (`AGENT_SAFETY_MUTATION_FORBIDDEN`) | `128k` tokens / `$2.00` per mission; `1M` tokens / `$10.00` per day |
| `preferences.cloudBackgroundReflectionEnabled` | Operator Cost Control | Yes | **No** (cannot enable) | Default `false` |
| `preferences.externalTelemetryOptIn` | Operator Privacy Control | Yes | **No** (`AGENT_SAFETY_MUTATION_FORBIDDEN`) | Default `false`; never uploads prompts/screenshots/files/credentials |
| `preferences.notificationPolicy` | Operator Notification Filter | Yes | **No** (`AGENT_SAFETY_MUTATION_FORBIDDEN`) | Default `quietByDefault: true` |
| `protectedCeilings.maxInteractiveMissions` | Protected Ceiling | **No** (Immutable `1`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Always `1` |
| `protectedCeilings.maxBackgroundJobs` | Protected Ceiling | **No** (Immutable `1`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Always `1` |
| `protectedCeilings.maxSafeIdempotentRetries` | Protected Ceiling | **No** (Immutable `2`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Always `2` |
| `protectedCeilings.allowRetriesForWriteSpendSendUncertain` | Protected Ceiling | **No** (Immutable `false`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Always `false` |
| `protectedCeilings.checkpointBeforeWrites` | Protected Ceiling | **No** (Immutable `true`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Always `true` |
| `protectedCeilings.missedScheduleRunPolicy` | Protected Ceiling | **No** (Immutable `'skip'`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Always `'skip'` |
| `protectedCeilings.maxWorkerHeapMb` | Protected Resource Limit | **No** (Immutable `128 MB`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Enforced via `--max-old-space-size=128` |
| `protectedCeilings.maxWorkerTimeoutMs` | Protected Resource Limit | **No** (Immutable `5,000 ms`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Runaway workers killed via `SIGKILL` |
| `protectedCeilings.maxFileSizeBytes` | Protected Resource Limit | **No** (Immutable `5 MB`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Rejects files `> 5,242,880` bytes |
| `protectedCeilings.maxToolOutputBytes` | Protected Resource Limit | **No** (Immutable `256 KB`) | **No** (`PROTECTED_POLICY_CEILING_IMMUTABLE`) | Bounds tool output at `262,144` bytes |

---

## 3. Model Usage Budgets (Reported vs. Estimated)

`ModelUsageBudgetController` tracks provider-reported token usage (`reportedInputTokens`, `reportedOutputTokens`, `reportedCostUsd`) separately from local deterministic estimates (`estimatedInputTokens`, `estimatedOutputTokens`, `estimatedCostUsd`):

1. **No Zero-Cost Live Usage**: Live provider calls (`mode === 'live'`) never record `$0.00` cost. If a live provider response omits usage metadata, deterministic token and cost estimates are charged and recorded under `usageSource: 'deterministic_estimate'`.
2. **Pre-Turn Safe Stop**: `evaluatePreTurnBudget()` projects mission and daily token/USD totals before each turn and halts safely (`MISSION_TOKEN_BUDGET_EXCEEDED`, `MISSION_COST_BUDGET_EXCEEDED`, `DAILY_TOKEN_BUDGET_EXCEEDED`, `DAILY_COST_BUDGET_EXCEEDED`) before exceeding hard limits.

---

## 4. Mission Queue, Concurrency Locks, Checkpoints & Orphan Recovery

- **Concurrency Locks (`DeviceConcurrencyLockManager`)**: Enforces exclusive locks on `browser:personal`, `browser:work`, `browser:testing`, `input_device:desktop`, and `workspace:<id>`. Interactive missions take priority over background jobs in lock wait queues.
- **Pre-Write Checkpoints**: `createPreWriteCheckpoint()` snapshots workspace state prior to any write/spend step and supports deterministic rollback via `restoreCheckpoint()`.
- **Orphaned Job Recovery**: On startup, `recoverOrphanedMissionsAndJobs()` transitions any mission left in `running` state from an unclean shutdown to `orphaned_recovered` and releases held locks without blindly re-executing write or spend steps.

---

## 5. Evidence-Based Health Checks & Operational Dashboard

`SubsystemHealthRegistry` performs timestamped, evidence-classified health probes across all 9 core subsystems:
1. `server` (Node process RSS, heap, uptime, load average)
2. `electron_shell` (Native Electron runtime presence vs. Node/Web server mode)
3. `database` (SQLite `PRAGMA integrity_check`, on-disk byte size, ledger event count)
4. `vault` (`PassphraseWrapVault` lock state, backend kind, key count)
5. `model_provider` (API key presence, live vs. mock mode)
6. `browser_profiles` (Partition isolation across `personal`, `work`, and `testing` profiles)
7. `native_driver` (`runBlaizeDoctorDiagnostics` across OS accessibility, screen capture, input injection, and window enumeration)
8. `skills_plugins` (`SelfExtensionManager` skill and plugin counts)
9. `scheduler` (`DurableSchedulerEngine` schedule counts and default `'skip'` missed-run policy)

---

## 6. Incident Handling, Emergency Stop & Telemetry Redaction

When `IncidentResponseAndEmergencyStopManager.triggerEmergencyStop()` is invoked:
1. New mission submissions and resumptions are blocked (`EMERGENCY_STOP_ACTIVE`).
2. All active and queued missions and background jobs are cancelled via `AbortController.abort()`.
3. All enabled schedules in `DurableSchedulerEngine` are paused.
4. All active extension/plugin workers are terminated with `SIGKILL` (`EMERGENCY_STOP_KILLED`).
5. All active single-use approval tokens (`globalApprovalTokenStore.revokeAllActiveTokens()`) and session tokens are revoked, and `PassphraseWrapVault` is locked.
6. Forensic logs are scrubbed through `redactSecretsFromOperationalText()` / `redactSecretsFromObject()` and preserved alongside step-by-step operator recovery instructions.

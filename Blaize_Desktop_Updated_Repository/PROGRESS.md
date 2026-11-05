# Blaize — Remediation Progress Log (`PROGRESS.md`)

## Final Acceptance Review — Independent Audit & Adversarial Verification (Completed 2026-11-03)
- **Branch**: `remediation/final-acceptance-audit`
- **Audit Deliverable**: `FINAL_REMEDIATION_AUDIT.md`
- **Scope**: Comprehensive independent audit of findings F-01 through F-19 against all 12 phase acceptance gates, live hostile test suite, safe self-management proofs, and real platform hardware truth.
- **Key Results**:
  1. **Audit Matrix**: 16 findings `RESOLVED`, 3 findings `PARTIALLY_RESOLVED` (`F-02`, `F-17`, `F-19`), 0 `OPEN`, 0 `BLOCKED`.
  2. **Hostile Attack Vectors Verified Blocked and Recorded (`src/packages/runtime/final_acceptance_audit.test.ts`)**:
     - Hostile Attempt 1: Permission expansion beyond HostCapabilityCeiling -> BLOCKED and recorded in ledger.
     - Hostile Attempt 2: Modification of user rules / standing instructions in protected plane -> BLOCKED and recorded in ledger.
     - Hostile Attempt 3: Deletion or bypass of immutable safety-floor controls -> BLOCKED and recorded in ledger.
     - Hostile Attempt 4: Credential extraction / vault secret theft via manifest or execution -> BLOCKED and recorded in ledger.
     - Hostile Attempt 5: Out-of-bounds directory traversal -> BLOCKED and recorded in ledger.
     - Hostile Attempt 6: Unapproved network egress -> BLOCKED and recorded in ledger.
     - Hostile Attempt 7: Unauthorized shell command spawning / child process execution -> BLOCKED and recorded in ledger.
     - Hostile Attempt 8: Audit ledger hash-chain tampering -> DETECTED via SHA-256 verification and rejected.
     - Hostile Attempt 9: Verification suppression / fake verifier injection -> BLOCKED by immutable strategy registry.
     - Hostile Attempt 10: Self-approval of plugin installation / auto-grant capabilities -> BLOCKED by HostCapabilityCeiling.
  3. **Morrow Safe Self-Management Capability Verified**:
     - Creates, tests, activates, and uses safe local plugin within existing capabilities.
     - Creates and executes safe natural-language skill without requiring new permissions.
     - Creates and installs custom visual figure with 9 pose slots and 7 facial expressions via `CharacterFactory`, with zero-click persistent pose switching.
  4. **Verification Pipeline**: 9-Gate pipeline executes 32 test suites (244 unit & integration tests) — 100% PASS, 0 failures, 0 skipped, 0 cancelled. Zero TypeScript errors.

## Phase 12 — Make Verification, Benchmarks, CI & Releases Honest (Completed 2026-11-03)
- **Branch**: `remediation/phase-12-honest-verification-benchmarks-ci-releases`
- **Addresses**: Findings 17, 18, and 19 (`F-13`, `F-17`, `F-18` in `FEATURE_STATUS.md`).
- **Deliverables Implemented**:
  1. **Strict Tri-State Verification Reporting Pipeline (`scripts/verify.ts`)**:
     - Completely overhauled the 9-gate verification script to use strict tri-state reporting (`[✓ PASS   ]`, `[✗ FAIL   ]`, `[○ NOT_RUN]`).
     - A gate or test suite fails if a required test is skipped, absent, or fails.
     - Gate 1: Real TypeScript compilation (`tsc --noEmit`) with 0 errors across `src/`, `electron/`, `server.ts`, and `scripts/`.
     - Gate 2: Runs all 31 unit & integration test suites without silent file filtering (231 tests pass cleanly, 0 failures, 0 skipped, 0 cancelled).
     - Gate 3: Credential and secret scan across all source files.
     - Gate 4: Audits 382 resolved dependencies in `node_modules` against approved SPDX open-source licenses (with SPDX `OR` parsing) and enforces Open VSX registry exclusivity.
     - Gate 5: Programmatically verifies all 25 IPC channels against Zod request/response schemas, IPC main handlers, frozen preload bridge, and sender authorization (`validateIpcSender`).
     - Gate 6: Real metric-honesty scan verifying zero `const ladderPassed = true` or synthetic claims, and confirming 3-category separation in `evals/results.md`.
     - Gate 7: Returns the actual computed `passed` boolean from live evaluation and native benchmarks.
     - Gate 8: Measures live Node process memory (`process.memoryUsage()`).
     - Gate 9: Renders semantic HTML and ARIA landmarks (`PCOperatorView` with `benchmark` tab) via `react-dom/server` `renderToStaticMarkup` and asserts accessible roles and labels.
  2. **Removal of `const ladderPassed = true` & 3-Category Honest Desktop Benchmarks (`src/packages/pc_operator/index.ts`, `src/components/PCOperatorView.tsx`, `scripts/run-eval.ts`, `evals/results.md`)**:
     - Completely removed `const ladderPassed = true` and synthetic claims.
     - Implemented `runNativeLocalBenchmarkSuite()` running 8 real empirical host tasks:
       - Directory sorting by extension
       - Batch ISO timestamp renaming
       - UTF-16LE CRLF normalization & round-trip verification
       - SHA-256 deduplication and reversible trash relocation
       - CSV financial ledger parsing and balance reconciliation
       - PolicyEngine gate enforcement
       - Linux host `/proc` process state inspection
       - 5-stage SHA-256 audit ledger hash chain verification
     - Emits full provenance per task: raw logs, task specs, OS environment, driver version, commit SHA, before/after observations, verifier output, retry counts, cost source, and intervention events.
     - Decoupled `runEverydayPcBenchmarkSuite()` as an explicit `SIMULATED BENCHMARK` harness labeled as non-empirical.
     - Added explicit `PUBLIC BENCHMARK` category labeling external benchmarks (e.g. `OSWorld-Verified`) as `UNSUPPORTED` / `NOT_CONFIGURED` without remote runner infrastructure.
  3. **Reproducible Desktop Packaging Lifecycle (`scripts/package-desktop.ts`, `package.json`)**:
     - Added honest code-signing status (`signingStatus: 'UNSIGNED' | 'SIGNED'`) to desktop package manifests.
     - Enforced `SOURCE_DATE_EPOCH` timestamp clamping for reproducible `.tar.gz` archive generation.
     - Added `runPackageLifecycleVerification()` and `npm run desktop:lifecycle` exercising clean install, upgrade (preserving user SQLite database), rollback, and clean uninstall.
  4. **GitHub Actions CI/CD Workflows (`.github/workflows/ci.yml`, `.github/workflows/release.yml`)**:
     - Created `.github/workflows/ci.yml` running lint, all 31 unit test suites, 9-gate verification, package lifecycle verification, and web build.
     - Created `.github/workflows/release.yml` generating reproducible release archives, SHA-256 checksums, and signing status manifests on version tags.
  5. **Automated Verification Test Suite (`src/packages/runtime/phase12_verification_benchmarks_packaging.test.ts`)**:
     - Added 15 comprehensive automated tests across 4 sub-suites validating native benchmarks, verification gates, package lifecycle, and cross-package contracts.

---

## Phase 11 — Implement Operational Defaults, Mission Management & Observability (Completed 2026-11-03)
- **Branch**: `remediation/phase-11-operations-and-observability`
- **Addresses**: Cross-cutting management/operational gaps and requested management defaults (Prompt 11 requirements 1–10).
- **Deliverables Implemented**:
  1. **Central Typed `RuntimePolicy` with Schema Validation, v1->v2 Migrations & Morrow Ceiling Protection (`src/packages/runtime/operations_and_observability.ts`)**:
     - Implemented `RuntimePolicy` (`schemaVersion: 2`), `validateRuntimePolicy()`, `migrateRuntimePolicy()`, and `RuntimePolicyManager`.
     - Separated user-configurable non-protected preferences (`preferences`) from immutable protected policy ceilings (`protectedCeilings`).
     - Deterministically blocked Morrow/agent/plugin/skill callers (`actor: 'morrow' | 'agent' | 'plugin' | 'skill'`) from mutating `protectedCeilings` (`PROTECTED_POLICY_CEILING_IMMUTABLE`) or altering budgets, telemetry opt-in, cloud background reflection, or notification policies (`AGENT_SAFETY_MUTATION_FORBIDDEN`).
  2. **Operational Defaults Enforced in Real Runtime Services**:
     - Enforced: `maxInteractiveMissions: 1`, `maxBackgroundJobs: 1`, `cloudBackgroundReflectionEnabled: false`, `preferDeterministicLocalFirst: true`, `maxSafeIdempotentRetries: 2` (only when `riskClass === 'read' && idempotent === true`), `allowRetriesForWriteSpendSendUncertain: false` (0 retries for `scoped_write`, `spend`, `external_send`, `destructive`, or `UNCERTAIN` outcomes), configurable per-tool timeout (`defaultToolTimeoutMs: 15_000`, `perToolTimeoutMs`), `checkpointBeforeWrites: true`, validated system local IANA timezone (`localTimeZone`), `missedScheduleRunPolicy: 'skip'`, and quiet-by-default notifications (`allowedEvents: ['approval_required', 'failure', 'uncertainty', 'final_verified_completion']`).
  3. **Per-Mission & Per-Day Model Usage Budgets (`ModelUsageBudgetController`)**:
     - Tracks provider-reported token usage (`reportedInputTokens`, `reportedOutputTokens`, `reportedCostUsd`) separately from local deterministic estimates (`estimatedInputTokens`, `estimatedOutputTokens`, `estimatedCostUsd`).
     - Enforces hard per-mission and per-day token and USD limits (`evaluatePreTurnBudget()`), stopping safely before exceeding limits (`MISSION_TOKEN_BUDGET_EXCEEDED`, `MISSION_COST_BUDGET_EXCEEDED`, `DAILY_TOKEN_BUDGET_EXCEEDED`, `DAILY_COST_BUDGET_EXCEEDED`).
     - Never invents zero-cost live model usage (`computeDeterministicModelCostUsd()` charges positive deterministic cost whenever a live provider omits usage fields).
  4. **Mission Queue, Concurrency Locks, Cancellation Tokens, Pause/Resume, Checkpoints & Orphan Recovery (`DeviceConcurrencyLockManager`, `MissionQueueAndLifecycleManager`)**:
     - Enforces `1` active interactive mission and `1` active background job with automatic queue promotion.
     - Implements concurrency resource locks (`browser:personal`, `browser:work`, `browser:testing`, `input_device:desktop`, `workspace:<id>`) with interactive-over-background priority waiting.
     - Propagates `AbortController` / `AbortSignal` cancellation tokens, supports `pauseMission()` / `resumeMission()`, persists pre-write recovery checkpoints (`createPreWriteCheckpoint()`, `restoreCheckpoint()`), and recovers orphaned `running` missions on startup (`recoverOrphanedMissionsAndJobs()`) into `orphaned_recovered` without blindly re-executing write/spend steps.
  5. **Evidence-Based, Timestamped Health Checks Across All 9 Subsystems (`SubsystemHealthRegistry`)**:
     - Probes and reports real, timestamped health with `evidenceClass` across `server`, `electron_shell`, `database` (SQLite `PRAGMA integrity_check` + file size), `vault`, `model_provider`, `browser_profiles` (partition isolation check), `native_driver` (`runBlaizeDoctorDiagnostics`), `skills_plugins`, and `scheduler`.
  6. **Resource Limits & Runaway Worker Supervisor (`ResourceLimiterAndWorkerSupervisor`)**:
     - Enforces file size limits (`checkFileSizeLimit`, 5 MB max), tool output size limits (`enforceToolOutputSizeLimit`, 256 KB max), per-mission network call limits (`recordAndCheckNetworkCall`, 25 calls/mission max), and isolated child worker V8 heap (`--max-old-space-size=128`) and wall-clock timeout limits (`runSupervisedWorkerScript`), killing runaway workers with `SIGKILL` and recording structured `WorkerTerminationRecord` entries.
  7. **Operational Dashboard Service & Server Endpoints (`OperationalDashboardService`, `server.ts`)**:
     - Built `OperationalDashboardService.getDashboardSnapshot()` reading real state across active mission, queue, job scheduler, native driver capabilities, model/provider health, reported vs. estimated usage/cost, SQLite storage on disk, vault status, plugin health, permissions, backup/restore status, and last verification.
     - Mounted `/api/operations/dashboard`, `/api/operations/health`, `/api/operations/policy`, `/api/operations/emergency-stop`, and `/api/operations/emergency-stop/clear` in `server.ts`.
  8. **Incident Handling, Emergency Stop & Local Telemetry Secret Redaction (`IncidentResponseAndEmergencyStopManager`, `LocalTelemetryCollector`)**:
     - `triggerEmergencyStop()` blocks new work (`EMERGENCY_STOP_ACTIVE`), aborts active/queued missions, pauses all enabled schedules (`scheduler.pauseAllSchedules()`), terminates active plugin workers (`SIGKILL`), revokes all active single-use approval tokens (`globalApprovalTokenStore.revokeAllActiveTokens()`) and session tokens, locks `PassphraseWrapVault`, records a `MemoryLedger` event, and preserves secret-redacted forensic logs with step-by-step recovery instructions (`clearEmergencyStop()`).
     - Telemetry stays local by default (`externalTelemetryOptIn: false`), strips prompts/screenshots/files/credentials even if opt-in is enabled, and redacts secrets (`redactSecretsFromOperationalText`, `redactSecretsFromObject`) before logging.
  9. **Documentation & Automated Tests (`docs/OPERATIONAL_POLICY_AND_DEFAULTS.md`, `src/packages/runtime/phase11_operations_observability.test.ts`)**:
     - Documented operational defaults and user preferences vs. protected policy ceilings in `docs/OPERATIONAL_POLICY_AND_DEFAULTS.md`.
     - Added 6 comprehensive test suites in `src/packages/runtime/phase11_operations_observability.test.ts`.

---

## Phase 10 — Make Connectors Real & Make Scheduling Time-Correct (Completed 2026-11-03)
- **Branch**: `remediation/phase-10-connectors-and-scheduler`
- **Addresses**: Findings 13 and 14 (`F-05`, `F-06`, `F-07`, `F-08` in `FEATURE_STATUS.md`).
- **Deliverables Implemented**:
  1. **Honest Connector Statuses & Catalogue vs. Implemented Adapter Separation (`src/packages/connectors_scheduler/provider_adapters.ts`, `src/packages/connectors_scheduler/index.ts`, `src/packages/workspace/index.ts`, `src/components/WorkingConnectorsView.tsx`)**:
     - Removed all generic connector success responses and removed fixture fallbacks from live connector checks.
     - A connector reports `status: 'connected'` (`evidenceClass: 'REAL'`) **only** after a real provider-authenticated request succeeds and passes schema validation.
     - Fixtures explicitly return `status: 'simulated'` (`evidenceClass: 'SIMULATED'`, `isSimulated: true`); missing credentials return `status: 'needs_setup'` (`NEEDS_SETUP`); catalogue-only entries (`conn-web-fetch`, `conn-web-search`, `conn-telegram`, `conn-slack`, `conn-discord`, `conn-notion`, `conn-linear`, `conn-todoist`, `conn-home-assistant`, `conn-microsoft-365`, `conn-universal-mcp`) are explicitly marked `adapterImplemented: false` and return `status: 'not_configured'` (`NOT_CONFIGURED`).
  2. **Strict Separation of Connection Test, Capability Discovery & Tool Invocation (`ConnectorProviderAdapter`)**:
     - Separated `testConnection()`, `discoverCapabilities()`, and `invokeConnectorAdapterTool()` across all adapters, enforcing `connectionTestProvesAllToolsWork: false`.
     - Built 7 real, tested provider adapters (`adapterImplemented: true`): `conn-weather` (Open-Meteo REST), `conn-wikipedia` (MediaWiki REST + Opensearch pagination), `conn-rss-atom` (deterministic RSS 2.0 / Atom XML parser `parseRssOrAtomXml` + cursor pagination), `conn-calendar-ics` (RFC 5545 `VCALENDAR`/`VEVENT` parser `parseIcsCalendarText` + pagination), `conn-local-folder` (canonical `realpathSync` scoped directory/file reader with path traversal defense), `conn-github` (GitHub REST API v3 with scope inspection, pagination & write issue creation), and `conn-google-workspace` (Google Calendar/Drive/Gmail REST adapter with OAuth scope inspection).
     - Enforced `globalPolicyEngine.evaluateToolCall`, exact capability grant (`connector:<id>:<tool>`), required OAuth/API scope check, single-use `ScopedApprovalToken` verification for write tools, per-connector token-bucket rate limiting (`ConnectorRateLimiter`), idempotent read retry/backoff, and output schema verifiers on every tool invocation.
  3. **OAuth 2.0 PKCE + Encrypted Vault Lifecycle & Server Proxy Host Allowlist (`OAuthPkceLifecycleManager`, `server.ts`)**:
     - Implemented RFC 7636 S256 `code_challenge` generation and verification, single-use anti-CSRF `state` tokens with TTL expiration, strict HTTPS/loopback `redirectUri` validation, real token exchange (`exchangeCodeForTokens`), token refresh (`refreshAccessToken`), upstream & local credential revocation (`revokeCredentials`), and scope inspection (`inspectScopes`) storing tokens exclusively in the Phase 3 `SecretVault` (`PassphraseWrapVault`).
     - Enforced `ALLOWED_CONNECTOR_HOSTS` in `/api/connectors/proxy` and replaced fake `/api/connectors/oauth/exchange` responses in `server.ts` with real upstream token POST requests and encrypted Vault storage.
  4. **5-Field Cron Parser, IANA Timezone & DST Transition Calculator (`src/packages/connectors_scheduler/cron_math.ts`, `src/packages/workspace/index.ts`, `src/packages/living/index.ts`)**:
     - Removed all hardcoded `2026-10-29...` / `2026-10-30...` next-run timestamps across `workspace/index.ts`, `living/index.ts`, and `connectors_scheduler/index.ts`.
     - Implemented `parseCronExpression()` (supporting wildcards, lists, ranges, steps, and named weekdays/months) and `computeNextRunsInTimeZone()` using `Intl.DateTimeFormat` IANA wall-clock parts (`getZonedWallClockParts`).
     - Properly handles DST spring-forward skipped hours (`strict_skip` and `shift_forward` policies) and DST fall-back repeated hours (executes once on the first occurrence and deduplicates the repeated local wall-clock hour).
  5. **Durable Scheduler Engine, Idempotency Keys, Missed-Run Policies & Runtime PolicyEngine Re-Entry (`src/packages/connectors_scheduler/cron_and_scheduler.ts`)**:
     - Implemented `DurableSchedulerEngine` persisting schedules, active execution locks, completed deterministic idempotency keys (`idem:<scheduleId>:<slotUtcIso>`), job history, and failure notifications to disk.
     - Default missed-run policy is `'skip'` (with optional `'run_when_back'` executing at most once and `'ask_me'` queuing for approval).
     - Scheduled executions re-enter `AgentRuntime` and `globalPolicyEngine.evaluateToolCall` at execution time (`executeSlotAtRuntime`), strip any pre-attached `staleApprovalToken`, block capability widening beyond `runtimeCeilingCapabilities`, pause write/sensitive tasks in `waiting_for_approval`, retry only idempotent read tasks with exponential backoff, and explicitly report `canExecuteWhilePoweredOff: false`.
  6. **Comprehensive Automated Test Suite (`src/packages/connectors_scheduler/phase10_connectors_scheduler.test.ts`, `src/packages/connectors_scheduler/index.test.ts`)**:
     - Added 9 comprehensive test suites in `phase10_connectors_scheduler.test.ts` (16 total tests across both connector/scheduler test files) covering all 12 Phase 10 requirements.

---

## Phase 9 — Figure Factory & Safe Non-Sensitive Morrow Self-Management (Completed 2026-11-03)
- **Branch**: `remediation/phase-1-truth-states`
- **Addresses**: Findings 15 and 16 and the user's figure/personality self-control requirement (Morrow creating and managing her own visual figures and non-sensitive presentation settings on explicit user request while keeping protected control-plane domains immutable).
- **Deliverables Implemented**:
  1. **Structured Character Planning Pipeline & Provider vs. Template Placeholder Honesty (`src/packages/character/index.ts`, `src/packages/character/figure_factory.ts`)**:
     - Upgraded `compileNaturalLanguageCharacterSpec()` and added `runStructuredCharacterPlanningPipeline()` to produce a validated `MasterCharacterSpec` (`figureId`, `name`, `appearanceSummary`, `proportions`, `palette`, `clothing`, `outfits`, `accessories`, `props`, `rigTarget`, `poseSlots`, `facialExpressions`, `animationStates`, `assetRequirements`).
     - Uses the configured `ImageGenerationProviderAdapter` (`generationMode: 'LIVE_PROVIDER'`, `providerStatus: 'AVAILABLE'`, `executionState: 'EXECUTED'`) only when available; when unconfigured, returns `generationMode: 'TEMPLATE_PLACEHOLDER'`, `providerStatus: 'NOT_CONFIGURED'`, `executionState: 'SIMULATED'` with an explicit `TEMPLATE_PLACEHOLDER` banner.
  2. **`CharacterFactory` Tool, Transparent PNG/WebP Binary Verification, Rig Compatibility & Executable Prohibition (`src/packages/character/figure_factory.ts`)**:
     - Implemented `buildDeterministicTransparentPngDataUrl()`, `buildDeterministicTransparentWebpDataUrl()`, and `inspectPngOrWebpDataUrl()` verifying PNG/WebP binary headers, alpha channels (`colorType === 6` / `VP8X` alpha flag), and scanning for embedded `<script>`, `javascript:`, `eval()`, or ELF/MZ/Mach-O/Wasm executable headers.
     - Implemented `validateFigurePackForInstallation()` enforcing content safety (blocking copyrighted characters, real-person likenesses, and underage/NSFW prompts), 2 MB per-slot / 15 MB per-pack size caps, explicit license and source attribution, normalized anchor bounds, dimension consistency, and strict prohibition of scripts/executables (`PACK_EXECUTABLE_CONTENT_PROHIBITED`).
  3. **Persistent Figure Library with Version Rollback & Zero-Click Pose Switching (`PersistentFigureLibrary`)**:
     - Persists installed figures, active figure, pose, facial expression, animation state, outfit, props, and version history to `figure_library_state.json`.
     - Once a figure is validated and installed on user request, Morrow can switch poses (`switchPose`), expressions (`switchExpression`), outfits (`switchOutfit`), and props (`setActiveProps`) across restarts with `requiresAdditionalApproval: false` (no second click per pose), and roll back figure versions (`rollbackFigureVersion`).
  4. **Allowlisted Non-Sensitive Soul Presentation Self-Edit API & Mixed-Request Splitting (`src/packages/workspace/soul_self_management.ts`)**:
     - Created `MorrowPresentationSelfManager` with a strict 7-field allowlist (`tone`, `concision`, `humour`, `voiceStyle`, `animationPreference`, `initiativeLevel`, `notificationStyle`) and 11 blocked protected domains (`user_rules`, `standing_instructions`, `trust_kernel_code`, `security_settings`, `identity_authentication`, `privacy_settings`, `credentials_vault`, `os_permissions`, `domain_allowlists`, `spend_limits`, `approval_rules`).
     - Converts user-requested presentation edits into a `SoulPresentationVersionedDiff`, auto-applies safe edits while preserving `# Stance & Uncertainty` safety boundaries verbatim, saves prior snapshots to `soul_presentation_state.json`, and supports one-click `rollback()`.
     - When a request mixes safe presentation changes with protected settings, applies ONLY the safe non-sensitive presentation fields (`status: 'PARTIALLY_APPLIED_SAFE_ONLY'`) and refuses the protected parts with a clear explanation.
  5. **ToolRegistry Integration & Automated Test Suite (`src/packages/character/figure_and_soul_self_management.test.ts`)**:
     - Wired `character.factory.create_figure` and `soul.presentation.self_edit` with independent target-state verifiers into `ToolRegistry`.
     - Added 5 comprehensive tests in `src/packages/character/figure_and_soul_self_management.test.ts` verifying live vs. template figure creation, pack safety/executable blocking, persistent figure library switching & rollback, mixed-request splitting, and immutability of `RULES`, safety-floor config, Vault, model keys, permission ceilings, and audit ledger.

---

## Phase 8 — Dynamic Skill/Plugin Runtime & Self-Extension Manager (Completed 2026-11-03)
- **Branch**: `remediation/phase-8-self-extension` (branched from `remediation/phase-7-browser-ide-recorder` at `c704c9eedd73cf2b679e7642e3c0dd2cc925abeb`).
- **Addresses**: Finding 12 and the core user requirement for Morrow to create, test, activate, and use her own non-sensitive skills and plugins within a deterministic capability ceiling.
- **Deliverables Implemented**:
  1. **Deterministic CapabilityPlane vs. ProtectedControlPlane Boundary (`src/packages/runtime/self_extension_manager.ts`)**:
     - Separated `CapabilityPlaneObjectKind` (`skill`, `plugin`, `app_knowledge_profile`, `local_helper_tool`, `workspace_template`, `presentation_preference`) from `ProtectedControlPlaneObjectKind` (`safety_floor_rule`, `policy_engine_config`, `approval_token_store`, `capability_ceiling`, `vault_secret`, `trust_kernel_asset`, `soul_safety_boundary`, `audit_ledger_chain`, `ipc_security_contract`).
     - Enforced the boundary deterministically in code via `evaluatePlaneBoundary()` and `SelfExtensionManager.mutatePlaneObject()`: agent and extension callers cannot write, weaken, or delete any protected control-plane object or path (`PROTECTED_CONTROL_PLANE_IMMUTABLE`), even if the prompt requests it.
  2. **Strict Plugin Manifest V1, Ed25519 Integrity & Capability Ceiling Intersection**:
     - Implemented `PluginManifestV1Schema` (`blaize.plugin.manifest.v1`) requiring version, stable ID, entryPoint, tools with strict input/output schemas and risk classes, requestedCapabilities, dependencies, publisher/origin, SHA-256 contentHash, Ed25519 integrity/signature metadata (`signPluginManifest`), healthCheck, testCommand, and declaredDataScopes.
     - Enforced zero permissions by default and computed effective grants strictly as `manifest.requestedCapabilities ∩ HostCapabilityCeiling` (`computeEffectivePluginGrant()`). If a plugin requests any capability outside the user's already-authorised ceiling (network, folder, connector, external-send, OS, credential, or system capability), it fails closed with `WAITING_FOR_CAPABILITY_GRANT` and lists the exact ungranted capabilities required.
     - Added static and structural validation (`validatePluginManifestAndCode`) blocking path escapes (`..`, absolute paths, URL schemes), dependency confusion (`file:`, `git+`, `http(s):`, `link:`, shell hooks), prohibited imports (`electron`, `child_process`, `net`, `http`, `https`, `tls`, `dgram`, `dns`, `fs`, `vm`, `worker_threads`, `cluster`, `module`, `process.binding`, `process.dlopen`), and `packages/trust` / `PolicyEngine` tampering.
  3. **Out-of-Process Restricted Worker with OS Resource Limits & Narrow JSON-RPC 2.0 Capability Bridge (`runInRestrictedPluginWorker`)**:
     - Runs plugin code outside Electron main and renderer in an isolated child worker launched via Linux `prlimit` (`--cpu`, `--nproc=32`, `--nofile=128`), Node 22 Permission Model (`--permission --allow-fs-read=<workerDir>`), V8 heap cap (`--max-old-space-size=64`), null-prototype `vm` context (`codeGeneration: { strings: false, wasm: false }`), and hard wall-clock `SIGKILL` timeout.
     - Exposes only a narrow JSON-RPC 2.0 capability bridge (`storage.get/set/list`, `workspace.readText/writeText`) backed by per-plugin isolated storage (`<storageRoot>/<pluginId>/kv.json`) and `ScopedWorkspaceManager`. Network (`fetch`, `WebSocket`, `XMLHttpRequest`) is denied by default (`NETWORK_CAPABILITY_DENIED`).
  4. **Full Plugin Lifecycle & Single-Flow "Create, Test, Activate and Use" (`SelfExtensionManager`)**:
     - Implemented `discoverPlugins`, `validatePlugin`, `createPlugin`, `dryRunPlugin`, `testPlugin`, `enablePlugin`, `disablePlugin`, `updatePlugin`, `rollbackPluginVersion`, `uninstallPlugin`, `runPluginHealthCheck`, `invokePluginTool`, and version history with cryptographic rollback.
     - Implemented `createTestActivateAndUseExtension()`: when the user's prompt explicitly requests creating and using a plugin/skill, Morrow creates, dry-runs, tests, activates, and executes it without a second routine approval ONLY if it requires zero new privileges outside `HostCapabilityCeiling` and passes all health/test checks.
  5. **Version-Pinned Skills, Natural-Language & Teach & Replay Creation Routes, and Mission Runtime Integration**:
     - Implemented `ManagedSkillDefinitionSchema` (`blaize.skill.v1`) with version-pinned steps, strict input/output schemas, preconditions, success criteria, cost/time bounds, retry/idempotency policy, and independent verifiers (`file_exists_hash`, `output_schema_match`, `custom_predicate`).
     - Unknown skill IDs fail closed (`UNKNOWN_SKILL`) and never resolve to the first skill in the list.
     - Skill execution (`executeSkill`) routes every step through the same `PolicyEngine`, `ToolRegistry` (or narrow plugin bridge), independent verifier, and `MemoryLedger` as native tools.
     - Added `createSkillFromNaturalLanguage()` and `createSkillFromTeachAndReplayTrace()` with automatic secret/credential redaction (`stripSecretsFromSkillText`) and removal of sensitive credential-capture steps.
  6. **Comprehensive Acceptance & Adversarial Test Suite (`src/packages/runtime/self_extension_manager.test.ts`)**:
     - Added 6 test groups covering the full Acceptance Gate and all 11 adversarial scenarios (malicious manifest, dependency confusion, path escape, ungranted network access, Electron/Node internal imports, policy bypass, fake verifier, version rollback, unknown skill ID, and safety rule tampering).

---

## Phase 7 — Real AI Browser, IDE Scoped Workspace & Consented Recorder (Completed 2026-11-02)
- **Branch**: `remediation/phase-7-browser-ide-recorder` (branched from `remediation/phase-6c-macos-driver` at `82fa879`).
- **Addresses**: Findings `F-10` and `F-11` (converting browser, IDE, recorder, teach & replay concepts into real, permission-scoped services).
- **Deliverables Implemented**:
  1. **AI Browser Session Architecture & Profile Isolation (`src/packages/browser_ide/browser_session.ts`)**:
     - Real Chromium session partition manager with isolated persistent profiles (`personal`, `work`, `testing`). Cookies, headers, local storage, and credential shields are partition-isolated.
     - Navigation lifecycle, history controls, tab management, text/accessibility capture with untrusted content wrapping (`untrustedWrappedText`), PolicyGuard URL/navigation destination validation, and credential shield auto-pause when login forms or sensitive input fields are detected.
     - Honest reader fallback in `ReaderEngine.navigate()` with `useOfflineFixture` requirement explicitly tagged as `SIMULATED` (`isSimulated: true`), removing hardcoded Kyoto fallback on live browser paths.
  2. **Scoped Workspace & Security Controls (`src/packages/browser_ide/scoped_workspace.ts`)**:
     - Path canonicalization and traversal / symlink escape defenses (`WORKSPACE_PATH_TRAVERSAL_DENIED`), ensuring file read/write/stat operations are strictly scoped to the workspace root.
     - Real file operations with SHA-256 hash tracking, automatic workspace checkpoints and rollback, staged diff application, and restricted command registry (`RestrictedCommandRegistry`) with allowlisted execution commands and explicit permission gating.
  3. **Consented Skill Recorder (`src/packages/recorder/consented_recorder.ts`)**:
     - Desktop capture/action event recording connected directly to native `DesktopDriver` (from Phase 6).
     - Explicit user consent enforcement (`grantConsent`/`getConsent`), sensitive screen auto-pause, typed secret redaction, event/frame preview and trimming, and compilation of recorded behavior into parameterized skill definitions with preconditions, postconditions, and verifiers.
  4. **Parameterized Skill Replay Engine (`src/packages/runtime/skill_replay_engine.ts`)**:
     - Skill replay engine executing parameterized skills by intent with precondition checks, postcondition verifiers, drift detection with accessibility anchor recovery (`accessibleName`/`role`), automatic workspace checkpoints and rollback on state modifications, and observable execution evidence (`ExecutionTruthState`).
  5. **Automated Integration Tests & 9-Gate Pipeline Integration**:
     - Created 4 comprehensive test suites: `browser_session.test.ts`, `scoped_workspace.test.ts`, `consented_recorder.test.ts`, `skill_replay_engine.test.ts`.
     - Wired Phase 7 tests into `package.json` test scripts and `scripts/verify.ts`.
     - Verification command summary:
       - `npm run lint` (`tsc --noEmit`): **PASS** (0 type errors).
       - `npm test`: **PASS** (189 tests across 26 test suites passed with 0 failures).
       - `npm run verify`: **PASS** (all 9 verification gates passed cleanly).

---

## Phase 6C — Implement and Verify the macOS Desktop Driver (Completed 2026-11-02)
- **Branch**: `remediation/phase-6c-macos-driver` (branched from `remediation/phase-6b-windows-driver` at `1b158ddee538052556cfac668e11becb5ea390c4`).
- **Addresses**: Findings `F-01` (execution truthfulness) and `F-11` / `F-12` (replacing synthetic `BaseCrossPlatformDriver` behaviour on macOS with a real macOS desktop adapter).
- **Deliverables Implemented**:
  1. **AXUIElement Window/Process Discovery, Retina 2.0x DPI Mapping & Accessibility Tree Observation (`src/packages/pc_operator/macos_driver.ts`, `scripts/macos-test-app.py`)**:
     - Implemented `MacOSDesktopDriver` (`isSimulated: false`) with real macOS Accessibility APIs (`AXUIElementCopyAttributeValue`, `kAXWindowsAttribute`, `kAXTitleAttribute`, `kAXRoleAttribute`, `kAXPositionAttribute`, `kAXSizeAttribute`), `ScreenCaptureKit` per-window Retina ROI capture, and controlled AX socket bridge `BLAIZE_MACOS_AX_SOCKET`.
     - Added Retina 2.0x display and widget bounds (`dpiScale: 2.0`, `monitorId: display-mac-retina`), foreground/focus state (`isFocused`), and protected window discovery (`SecurityAgent`).
  2. **Security Boundary, Confidential Input Defense & SecurityAgent Guard (`MacOSDesktopDriver.executeTierAction()`)**:
     - Protected system windows (`SecurityAgent`, `coreauthd`, `Keychain Access`, `1Password`, `Bitwarden`) are enforced as strict security boundaries: any action targeting `SecurityAgent` prompts or admin windows is refused with `SECURITY_AGENT_ACCESS_DENIED` (`executionState: 'UNSUPPORTED'` / `'BLOCKED'`).
     - Secure input fields (`AXSecureTextField`, password/PIN/OTP/passkey inputs) are masked as `[PROTECTED_SECURE_INPUT]` at perception capture; setting value or reading secure inputs is blocked with `SECURE_INPUT_FIELD_RESTRICTION` (`BLOCKED`).
  3. **All Supported AX Actions + T3 Keyboard Shortcut & Fresh Pre/Post OS State Verification**:
     - Implemented AX `invoke` (`AXPress`), `set_value` (`AXSetValue`), `select` (`AXSelect`), `expand` (`AXShowMenu` / `AXExpand`), and `scroll` (`AXScrollToVisibleAction`), plus `T3_SHORTCUTS_MENU` scoped keyboard shortcut (`Cmd+E`, `Cmd+L`, etc.).
     - Captures fresh `beforeSnapshot` and `afterSnapshot` from OS observation on every action without mutating caller snapshots in memory.
  4. **Dynamic Permission Probing & T4 Physical User-Input Auto-Pause Hook (`checkPermissions()`)**:
     - Removed all hardcoded `'granted'` permission values for macOS. Dynamically probes `perm-mac-ax` (`AXIsProcessTrusted`), `perm-mac-screen` (`CGPreflightScreenCaptureAccess`), `perm-mac-automation` (`AEDeterminePermissionToAutomateTarget`), and `perm-mac-user-input-hook` (`CGEventTap`) with exact System Settings remediation paths.
     - Added physical user-input detection/pause (`CGEventTap` / `MacOSUserInputMonitor`) for `T4_PIXEL_INPUT`: immediately yields cursor control (`pausedForUserInput: true`, `executionState: 'BLOCKED'`) when user physical movement is detected, and marks `T4_PIXEL_INPUT` as `UNSUPPORTED` when no hardware input monitor is armed.
  5. **PolicyEngine Integration, Electron IPC Wiring & Integration Tests (`src/packages/pc_operator/macos_driver.test.ts`, `docs/MACOS_DRIVER_TEST_CHECKLIST.md`)**:
     - Wired `MacOSDesktopDriver` into `src/packages/pc_operator/index.ts` and `electron/main.ts` (`process.platform === 'darwin'`).
     - Added 6 comprehensive integration tests in `src/packages/pc_operator/macos_driver.test.ts` against `scripts/macos-test-app.py` and documented the native macOS verification checklist in `docs/MACOS_DRIVER_TEST_CHECKLIST.md`.

---

## Phase 6B — Implement and Verify the Windows Desktop Driver (Completed 2026-11-02)
- **Branch**: `remediation/phase-6b-windows-driver` (branched from `remediation/phase-6a-linux-driver` at `f33c0cc2ae8411ecdb7089a6e6825b9ac878705a`).
- **Addresses**: Findings `F-01` (execution truthfulness) and `F-11` / `F-12` (replacing synthetic `BaseCrossPlatformDriver` behaviour on Windows with a real Windows desktop adapter).
- **Deliverables Implemented**:
  1. **Win32 Window/Process Discovery, Per-Monitor DPI v2 Mapping & UI Automation (`src/packages/pc_operator/windows_driver.ts`, `scripts/windows-test-app.py`)**:
     - Implemented `WindowsDesktopDriver` (`isSimulated: false`) with live Win32 / PowerShell process & window enumeration (`EnumWindows`, `GetWindowRect`, `GetForegroundWindow`, `GetDpiForWindow`, `MonitorFromWindow`) and UI Automation (`UIA3` / `System.Windows.Automation` / controlled UIA IPC bridge `BLAIZE_WINDOWS_UIA_SOCKET`).
     - Added Per-Monitor DPI v2 display and element bounds (`dpiScale`, `monitorId`, `workArea`), foreground/focus state (`isFocused`), and elevated-window detection (`isElevatedAdmin`).
  2. **Standard-User Security Boundary & UIPI / UAC Guard (`WindowsDesktopDriver.executeTierAction()`)**:
     - Enforced a strict Medium Integrity standard-user boundary: `WindowsDesktopDriver` never bypasses UAC, never injects into elevated Administrator windows (`isElevatedAdmin === true`), and never silently elevates.
     - Actions targeting elevated windows (`win-win32-elevated-admin` / `el_win_elevated_admin_btn`) immediately fail closed with `executionState: 'UNSUPPORTED'` or `'WAITING_FOR_APPROVAL'` (`humanInterventionRequired: true`) and a clear `UIPI_ELEVATED_WINDOW_BOUNDARY (... / WAITING_FOR_USER)` explanation.
  3. **All 5 UIA Patterns + T3 Keyboard Fallback & Fresh Pre/Post OS State Verification**:
     - Implemented UIA `invoke` (`InvokePattern`), `set_value` (`ValuePattern`), `select` (`SelectionItemPattern`), `expand` (`ExpandCollapsePattern`), and `scroll` / `scroll_into_view` (`ScrollPattern`), plus `T3_SHORTCUTS_MENU` keyboard shortcut fallback.
     - Captures a fresh `beforeSnapshot` and `afterSnapshot` from OS observation on every action without mutating caller snapshots in memory.
  4. **Dynamic Permission Probing & T4 Physical User-Input Auto-Pause Hook (`checkPermissions()`)**:
     - Removed all hardcoded `'granted'` permission values for Windows. Dynamically probes `perm-win-uia`, `perm-win-uipi`, `perm-win-dpi-monitors`, and `perm-win-user-input-hook`.
     - Added physical user-input detection/pause (`GetLastInputInfo` / `WindowsUserInputMonitor`) for `T4_PIXEL_INPUT`: immediately pauses (`pausedForUserInput: true`, `executionState: 'BLOCKED'`) when user mouse/keyboard input is active, and marks `T4_PIXEL_INPUT` as `UNSUPPORTED` when no input hook is available.
  5. **PolicyEngine Integration, Electron IPC Wiring & Integration Tests (`src/packages/pc_operator/windows_driver.test.ts`, `docs/WINDOWS_DRIVER_TEST_CHECKLIST.md`)**:
     - Wired `WindowsDesktopDriver` into `src/packages/pc_operator/index.ts` and `electron/main.ts` (`process.platform === 'win32'`).
     - Added 6 comprehensive integration tests in `src/packages/pc_operator/windows_driver.test.ts` against `scripts/windows-test-app.py` and documented the native Windows 10/11 VM verification checklist in `docs/WINDOWS_DRIVER_TEST_CHECKLIST.md`.

---

## Phase 6A — Implement and Verify the Linux Desktop Driver (Completed 2026-11-02)
- **Branch**: `remediation/phase-6a-linux-driver` (branched from `remediation/phase-5-electron-desktop` at `dabdfedba5ba3f2275a25464204bf908da5895d8`).
- **Addresses**: Findings `F-01` (execution truthfulness) and `F-11` / `F-12` (replacing synthetic `BaseCrossPlatformDriver` behaviour on Linux with a real Linux desktop adapter).
- **Deliverables Implemented**:
  1. **Real Linux Environment, Session, Display & Process Probing (`src/packages/pc_operator/linux_driver.ts`)**:
     - Implemented `probeLinuxDesktopEnvironment()` to detect session type (`wayland`, `x11`, `headless`, `unknown`), desktop environment (`XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `GNOME`, `KDE`, `headless`), AT-SPI2 availability (`org.a11y.Bus` via `gdbus` and `AF_UNIX` accessibility sockets), XDG Desktop Portal availability (`org.freedesktop.portal.Desktop`), X11 tools (`xprop`, `wmctrl`, `xdotool`, `xrandr`, `xinput`), monitor geometries, and `/proc` kernel process enumeration (`enumerateRealLinuxProcesses()`).
  2. **Dynamic Permission Checks & Exact Remediation (`LinuxDesktopDriver.checkPermissions()`)**:
     - Removed all hardcoded `'granted'` permission statuses on Linux.
     - Dynamically evaluates `perm-linux-atspi`, `perm-linux-display`, `perm-linux-portal-screencast`, and `perm-linux-user-input-hook` with exact remediation commands (`gsettings set org.gnome.desktop.interface toolkit-accessibility true`, `export QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`, `xdg-desktop-portal`, `xinput`).
     - Updated `runBlaizeDoctorDiagnostics('linux')` in `src/packages/pc_operator/index.ts` to compute subsystem health and `overallStatus` from live Linux permissions.
  3. **Read-Only Window Discovery, AT-SPI2 / `AF_UNIX` Control Enumeration & Fresh Pre/Post OS Observations (`src/packages/pc_operator/linux_driver.ts`, `scripts/linux-test-app.py`)**:
     - Created `scripts/linux-test-app.py`, a controlled Linux test application running as a real Linux process (verifiable in `/proc/<pid>`) exposing window `win-linux-test-app` and 4 AT-SPI2-structured controls (`el_linux_test_note_input`, `el_linux_test_apply_btn`, `el_linux_test_confirm_checkbox`, `el_linux_test_status_bar`) over an `AF_UNIX` (`0o600`) socket with an independent JSONL audit log on disk.
     - Implemented `LinuxDesktopDriver.capturePerception()` (`isSimulated: false`) and `executeTierAction()` to capture a fresh pre-action snapshot (`beforeSnapshot`) and post-action snapshot (`afterSnapshot`) from OS observation rather than mutating the previous snapshot in memory.
  4. **Wayland XDG Desktop Portal Consent & T4 Physical User-Input Pause Guard**:
     - Implemented `WaylandPortalSessionManager` for `ScreenCast` and `RemoteDesktop` consent (`unrequested` -> `waiting_for_consent` -> `granted` with `restoreToken` / `denied`). Rejects unconsented Wayland global coordinate injection with `executionState: 'UNSUPPORTED'` (`UNSUPPORTED_WAYLAND_GLOBAL_INPUT`).
     - Enforced physical user-input monitoring on `T4_PIXEL_INPUT`: marks `T4_PIXEL_INPUT` as `UNSUPPORTED` (`UNSUPPORTED_T4_NO_USER_INPUT_HOOK`) when no input hook is available, and immediately pauses (`pausedForUserInput: true`, `executionState: 'BLOCKED'`, `cursorMoved: false`) when physical user input is detected.
  5. **PolicyEngine Integration, Synthetic Snapshot Isolation & Electron IPC Wiring (`src/packages/pc_operator/index.ts`, `electron/main.ts`)**:
     - Tagged synthetic snapshots (`buildPerceptionSnapshot`) with `isSimulated: true` and enforced in `verifyDesktopStepOutcome()` that synthetic snapshots never return `verificationState: 'VERIFIED'` (`'SIMULATED'` instead), preventing promotion via `canPromoteRecordToReal()`.
     - Wired `pc-operator:list-windows` and `pc-operator:execute-action` in `electron/main.ts` to `LinuxDesktopDriver` on Linux.
  6. **Automated Integration Test Suite & Manual Verification Checklist (`src/packages/pc_operator/linux_driver.test.ts`, `docs/LINUX_DRIVER_TEST_CHECKLIST.md`)**:
     - Added 6 integration tests in `src/packages/pc_operator/linux_driver.test.ts` and documented the exercised runner environment and manual X11/Wayland verification steps in `docs/LINUX_DRIVER_TEST_CHECKLIST.md`.

---

## Phase 5 — Make Electron a Reproducible, Secure Desktop Application (Completed 2026-11-02)
- **Branch**: `remediation/phase-5-electron-desktop` (branched from `remediation/phase-4-meta-model-loop` at `aeff99c9a7ea6992584a1a97a7cc2c3acd0e0876`).
- **Addresses**: Finding `F-16` (Electron runtime, packaging, and durable SQLite IPC foundation), security aspects of `F-08` / `F-09`, and honest desktop vs. web preview separation.
- **Deliverables Implemented**:
  1. **Pinned Electron Runtime & Reproducible Packaging Toolchain (`package.json`, `electron-builder.yml`, `scripts/build-desktop.ts`, `scripts/package-desktop.ts`)**:
     - Added and pinned `electron` (`45.2.1`) and `electron-builder` (`26.18.0`) in `package.json`, keeping separate commands for Web Preview (`dev`, `build`, `start`) and Native Desktop (`desktop:dev`, `desktop:build`, `desktop:package`, `desktop:package:linux`, `desktop:package:win`, `desktop:package:mac`, `test:electron`).
     - Created `scripts/build-desktop.ts` to compile the Vite renderer (`dist/`) and bundle `electron/main.ts` -> `dist-electron/main.cjs` and `electron/preload.ts` -> `dist-electron/preload.cjs` with a SHA-256 `build-manifest.json`.
     - Created `scripts/package-desktop.ts` to build `release/blaize-desktop-linux-x64/` and `release/blaize-desktop-linux-x64.tar.gz` with a cryptographic SHA-256 `artifact-manifest.json`, while honestly reporting `UNSUPPORTED_HOST_OS` when `--target=mac` or `--target=win` is invoked on a Linux host without native macOS/Windows toolchains.
  2. **Hardened `BrowserWindow` Defaults & Navigation / Permission / External Link Guards (`electron/main.ts`)**:
     - Enforced `HARDENED_WEB_PREFERENCES` (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`).
     - Enforced `RESTRICTIVE_CSP_HEADER`, navigation allowlist (`isAllowedNavigationOrigin`), default-deny permissions (`evaluatePermissionRequest`), and HTTPS-only external link handling (`evaluateExternalLinkRequest` via `canonicalizeAndValidateUrl`, denying new `BrowserWindow` spawns).
  3. **Strict IPC Security Boundary & Programmatic Contract Verification (`electron/ipc-contracts.ts`, `electron/preload.ts`, `electron/main.ts`, `scripts/verify.ts`)**:
     - Defined `IPC_CONTRACT_MANIFEST` covering all 25 IPC channels with runtime Zod request and response schemas (`validateIpcRequestPayload`, `validateIpcResponsePayload`).
     - Implemented `validateIpcSender` to reject missing senders, destroyed `webContents`, child iframes/subframes (`UNTRUSTED_IPC_SUBFRAME_REJECTED`), and untrusted origins (`UNTRUSTED_IPC_ORIGIN_REJECTED`).
     - Routed non-read IPC channels through `globalPolicyEngine.evaluateToolCall` before handler execution.
     - Built a deeply frozen (`Object.freeze`) narrow preload bridge (`buildPreloadApi`) with zero exposure of `ipcRenderer`, `fs`, `child_process`, `shell`, `process`, or `require`.
     - Upgraded `scripts/verify.ts` Gate 5 from string grep to programmatic verification of all 25 IPC channels, Zod schemas, main handlers, and frozen preload methods.
  4. **Lifecycle, Single-Instance Lock, Local Redacted Crash Reports, Verified Update Staging & Honest Shell Capabilities (`electron/main.ts`, `src/packages/platform/index.ts`)**:
     - Implemented `acquireSingleInstanceLock`, `0o700` app data directory initialization (`initializeDesktopDirectories`), local secret-redacted crash reports (`recordLocalRedactedCrashReport`), Ed25519 + SHA-256 verified update staging (`stageVerifiedUpdateBundle`), and `gracefulShutdown`.
     - Wired tray, floating companion window, and global shortcuts to real Electron APIs when a display server is active, returning explicit `UNSUPPORTED` in headless or Web Preview environments (`UniversalPlatformBridge`).
  5. **Automated Test Suite (`src/packages/platform/electron_desktop.test.ts`)**:
     - Added 8 comprehensive tests covering 1:1 manifest/handler/preload conformance, BrowserWindow hardening/CSP/navigation/permissions/external links, subframe & untrusted origin rejection, Zod request/response validation, SQLite + FTS5 + blob + safeStorage restart persistence (and Linux `basic_text` fail-closed), single-instance lock + secret-redacted crash reports + Ed25519 update signature verification, honest `UNSUPPORTED` states, and clean-machine Linux package build + smoke launch.

---

## Phase 4 — Connect Meta Model Inference to the Real Mission Loop (Completed 2026-11-02)
- **Branch**: `remediation/phase-4-meta-model-loop` (branched from `remediation/phase-3-durable-security`).
- **Addresses**: Finding `F-03` (model inference telemetry & usage honesty) and remaining dynamic tool-planning parts of `F-04` / `F-09` (`AgentRuntime.runMission()` hardcoded `planToolCalls()`).
- **Deliverables Implemented**:
  1. **Hardened Server-Side Meta Responses Proxy & Real Inference Health Probe (`server.ts`)**:
     - Kept `MODEL_API_KEY` exclusively server-side; redacted any secret occurrences from error messages via `redactSecretsFromText()`.
     - Enforced model allowlist (`muse-spark-1.3`, `muse-wonder-1.0`), blocked `-contributor` model IDs, enforced a 64 KB request payload cap, and added sliding-window proxy rate limiting (`checkProxyRateLimit()`).
     - Upgraded `POST /api/model/test` to run both a `/models` catalogue connectivity check AND a live inference + tool-calling probe (`POST /responses` with `health_ping` function tool schema), returning 5 distinct diagnostic flags: `apiKeyConfigured`, `catalogueReachable`, `inferenceSucceeded`, `toolCallingSupported`, and `modelAvailable` / `modelUnavailable`.
     - Upgraded `POST /api/model` to support `requestId`, `timeoutMs`, `rateLimitPerMinute`, `latencyMs`, `provider: 'Meta AI'`, separate `reportedUsage` vs `estimatedUsage`, and structured `errorCode` (`INVALID_REQUEST`, `AUTH_MISSING`, `AUTH_INVALID`, `RATE_LIMITED`, `TIMEOUT`, `UPSTREAM_ERROR`).
  2. **Real `ModelRouter.respond()` / `generate()` & Untrusted Proposal Validation (`src/packages/runtime/index.ts`)**:
     - Added `ModelRouter.respond(req)` and `ModelRouter.generate(req)` calling `/api/model` with request IDs, client-side rate limiting, 64 KB payload validation (`PAYLOAD_TOO_LARGE`), `AbortController` timeouts (`TIMEOUT`) and caller cancellation (`ABORTED`), and structured response parsing for Meta Responses API (`output` items of `type: 'function_call' | 'tool_call'` and `type: 'message'`).
     - Added `validateUntrustedModelToolProposal()` to validate every model-proposed tool call as an untrusted proposal: blocks malformed JSON/arguments (`MALFORMED_TOOL_CALL`), blocks model attempts to supply or forge `approvalToken` (`MODEL_FORGED_APPROVAL_TOKEN`), and blocks raw shell/SQL/code/prohibited-URL proposals (`UNSAFE_MODEL_CODE_OR_COMMAND_PROPOSAL`).
     - Added `ToolRegistry.toModelToolSchemas()` to export all available registered tools as JSON-Schema function declarations.
  3. **Iterative Multi-Turn Live Agent Loop in `AgentRuntime.runMission()` (`src/packages/runtime/index.ts`)**:
     - Replaced hardcoded `planToolCalls()` as the default `live` path with a multi-turn loop: `user goal -> assembled 4-slot prompt + dynamic skill selection + registered tool schemas -> ModelRouter.respond() -> validateUntrustedModelToolProposal -> PolicyEngine/PolicyGuard -> ToolRegistry.execute -> fresh observation wrapped via wrapUntrustedData('<untrusted_data source="tool_output">') -> independent verifier -> next model turn -> final response`.
     - Uses fast model `muse-spark-1.3` (`loop_extraction`) for routine turns and escalates to `muse-wonder-1.0` (`planning_recovery`) when recovering from step failure (`allowRecoveryTurn`) or when `forcePlanningModel` is set.
     - Enforces step limits (`maxSteps`), token budgets (`maxTokensBudget`), cost budgets (`maxBudgetUsd`), duration limits (`maxDurationMs`), approval pauses (`waiting_for_approval`), and uncertainty stops (`UNCERTAIN`).
     - Retains deterministic `mock` mode explicitly labelled `SIMULATED` (`provider: 'mock'`, `outcome: 'mock_simulated'`, `estimatedCostUsd: 0`).
  4. **Durable Model Usage Persistence & 5-Badge Health Matrix UI (`src/packages/storage/sqlite_db.ts`, `src/App.tsx`, `src/components/KeyVaultPanel.tsx`)**:
     - Added `recordModelUsage()` and `listModelUsageRecords()` to `DurableSqliteDatabase`.
     - Updated `src/App.tsx` (`handleSendMessage` and `Settings > Models`) and `src/components/KeyVaultPanel.tsx` to route live-mode prompts through `agentRuntime.runMission()`, display the 5 distinct health status badges (`API Key Configured`, `Catalogue Reachable`, `Inference Succeeded`, `Tool Calling Supported`, `Model Status`), and clear the remaining `'2026'` default state in `KeyVaultPanel.tsx`.
  5. **Automated Integration Tests Added (`src/packages/runtime/meta_model_loop.test.ts`)**:
     - Added 7 integration tests (6 automated with local HTTP server mocking upstream Meta API through `createBlaizeServer()` + 1 opt-in live smoke test gated by `BLAIZE_LIVE_SMOKE_TEST=1`).
- **Verification Commands Executed**:
  - `npm run lint` (`tsc --noEmit`): **PASS** (exit code `0`).
  - `npm test`: **PASS** (exit code `0`, 143 tests across 18 test files, 142 passed, 0 failed, 1 skipped opt-in live smoke test).
  - `npm run build`: **PASS** (exit code `0`, built in 1.19s).
  - `npm run verify`: **PASS** (exit code `0`, all 9 gates passed).

---

## Phase 3 — Replace Simulated Security, Add Durable Storage & Remove Default Identity (Completed 2026-11-02)
- **Branch**: `remediation/phase-3-durable-security` (branched from `remediation/phase-2-trust-kernel` at `1644a8ee927fa83be00236a9cf5884fc5f471cb2`).
- **Addresses**: Findings `F-01` (hardcoded 2026 seed), `F-03` (simulated PBKDF2), `F-04` (fake Base64 AES-GCM envelope), `F-05` (Linux basic_text fail-closed), `F-07` (durable storage vs volatile maps), `F-09` (fresh install onboarding state), and `F-16` (Electron SQLite & FTS5 persistence).
- **Deliverables Implemented**:
  1. **Real Node Cryptographic Primitives (`src/packages/trust/crypto.ts`)**:
     - Real SHA-256 (`computeCryptographicSha256`), HMAC-SHA-256 (`computeCryptographicHmacSha256`), and AES-256-GCM (`encryptPayloadAesGcm`, `decryptPayloadAesGcm`) with 12-byte random nonces and 16-byte authentication tags. Fails closed on IV mutation, tag mismatch, or corrupted ciphertext.
     - NIST SP 800-38D AES-256-GCM & FIPS 180-4 SHA-256 isomorphic pure engine for browser Vite bundles.
     - Real KDF (`derivePassphraseKeyScrypt`) using `scrypt` with versioned parameters (`N: 16384, r: 8, p: 1, keyLen: 32`) and per-user cryptographic salt.
     - Constant-time timing-safe comparisons (`verifyTimingSafe`).
  2. **Versioned Canonical Ledger Serialization (`src/packages/trust/canonical_ledger.ts`, `src/packages/trust/index.ts`)**:
     - Defined `CanonicalLedgerFields` binding 11 fields (`sequence`, `timestamp`, `actor`, `eventType`, `mission`, `profileWorkspace`, `redactedSummary`, `payloadReference`, `payloadDigest`, `previousHash`, `schemaVersion`).
     - Set `CANONICAL_LEDGER_SCHEMA_VERSION = 2` and `GENESIS_PREVIOUS_HASH = '0'.repeat(64)`.
     - Validates schema version, hash recomputation, genesis rules, sequence monotonicity, link to previous hash, and timestamp ordering.
  3. **Durable SQLite Storage & FTS5 Migrations (`src/packages/storage/sqlite_db.ts`, `src/packages/storage/migrations.ts`, `src/packages/storage/index.ts`)**:
     - Native `DatabaseSync` engine from `node:sqlite` with WAL mode, `PRAGMA foreign_keys = ON`, and `PRAGMA synchronous = NORMAL`.
     - Versioned migrations (`001_initial_durable_schema`) for tables: `ledger_events`, `encrypted_content`, `records`, `fts_records` (real SQLite FTS5 table), `vault_metadata`, `encrypted_secrets` (foreign key cascade), `blobs`, `skills`, `plugins`, `schedules`, `jobs`, `app_profiles`, `character_packs`, and `model_usage_records`.
     - Real SQLite FTS5 full-text indexing with `bm25` ranking and sync on record delete/update.
     - Right-to-delete payload zeroing on disk.
     - Nested transactions with depth-aware SQLite `SAVEPOINT`.
     - Process restart persistence, corruption detection (`PRAGMA integrity_check`), and WAL backup.
  4. **Elimination of Default Identity "2026" & Isolated Demo Identity (`server.ts`, `src/App.tsx`, `src/packages/vault/index.ts`, `src/packages/runtime/index.ts`)**:
     - Removed default vault entry seeding with passphrase `'2026'` in `server.ts`.
     - Required user-supplied passphrase for `POST /api/vault/store`.
     - Upgraded `PBKDF2_ITERATIONS` to `210_000` in `PassphraseWrapVault`.
     - Fresh install starts with `onboardingCompleted: false`. No default PIN or secret code.
     - Isolated demo identity in `buildDemoPersistedSnapshot()` with `isDemo: true`.
     - Biometrics clearly marked `Simulated` with zero claims of real biometric hardware authentication.
  5. **Electron Main Process Upgrade (`electron/main.ts`)**:
     - Replaced volatile JS `Map` stores (`dbRecords`, `ftsIndex`, `blobStore`, `encryptedSecrets`) with `DurableSqliteDatabase`.
     - Wired `storage:*` and `vault:*` IPC handlers to SQLite persistence and real SQLite FTS5 queries.
  6. **Automated Unit Tests Added**:
     - Added 12 tests across `src/packages/storage/sqlite_db.test.ts` and `src/packages/trust/durable_security.test.ts`. All 12 pass.
- **Verification Commands Executed**:
  - `npm run lint` (`tsc --noEmit`): **PASS** (exit code `0`).
  - `npm test`: **PASS** (exit code `0`, 136 tests across 8 suites, 136 passed, 0 failed).
  - `npm run build`: **PASS** (exit code `0`, built in 1.13s).
  - `npm run verify`: **PASS** (exit code `0`, all 9 gates passed).

---

## Phase 2 — Centralise the Trust Kernel & Make PolicyGuard Default-Deny (Completed 2026-11-02)
- **Branch**: `remediation/phase-2-trust-kernel` (branched from `remediation/phase-1-truthful-execution` at `ee82e1093f950e69735af517b634b6a940370e10`).
- **Addresses**: Finding `F-06` (PolicyGuard bypasses and mockbank fallback), and security aspects of `F-05` (untrusted data injection), `F-07` (path traversal), `F-12` (approval bypasses), and `F-16` (safety-floor rule erosion).
- **Deliverables Implemented**:
  1. **Centralized Trust Kernel & PolicyEngine Boundary (`src/packages/trust/policy_engine.ts`, `src/packages/trust/index.ts`)**:
     - Created `PolicyEngine` with `evaluateToolCall()` and `evaluateProposal()`, acting as the single mandatory authorization boundary for every tool call across `ToolRegistry`, connectors, scheduler, and desktop execution.
     - Enforced default-deny on missing caller (`UNIDENTIFIED_CALLER`), unresolvable target (`UNRESOLVED_DOMAIN_DEFAULT_DENY`), unknown risk classes (`UNKNOWN_ACTION_RISK_CLASS_DENIED`), or any evaluation error/exception (`DEFAULT_DENY_FAIL_CLOSED`).
  2. **Elimination of `mockbank.local` & Strict URL / SSRF Defense (`src/packages/trust/security_checks.ts`)**:
     - Removed all trusted fallback domains. Malformed, relative, or unresolvable URLs fail closed.
     - `canonicalizeAndValidateUrl()` strictly validates schemes (`http:`, `https:` only; `file:`, `javascript:`, `data:` blocked) and prevents SSRF across loopback and private IPv4 (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `0.0.0.0`) and IPv6 (`::1`, `fe80::/10`, `fc00::/7`).
     - Added detection and blocking of Punycode IDN homographs (`xn--`) and Cyrillic/Greek homoglyphs.
  3. **Filesystem Path Validation & Safety-Floor Protection (`src/packages/trust/security_checks.ts`, `src/packages/trust/policy_engine.ts`)**:
     - Implemented `validateFilesystemPath()` blocking encoded path traversals (`..`, `%2e%2e`), symlinks, and writes targeting protected security assets (`packages/trust/*`, `SOUL.md`, `.env`, `.ssh/id_rsa`).
     - Added `canModifyRule()` enforcing that rules with `isSafetyFloor: true` can never be modified, disabled, weakened, or deleted by models or user preferences.
  4. **Single-Use Scoped Approval Tokens (`src/packages/trust/approval_tokens.ts`)**:
     - Created `SingleUseApprovalTokenStore` generating tokens bound to exact parameters: tool name, target, payload hash, amount, profile ID, and expiry (5 min).
     - Consumes tokens on execution; blocks replays (`TOKEN_ALREADY_CONSUMED`), expired tokens (`TOKEN_EXPIRED`), or parameter mutations (`TOKEN_PAYLOAD_HASH_MISMATCH`, `TOKEN_TARGET_MISMATCH`, etc.).
  5. **Untrusted Data Isolation & Injection Neutralization (`src/packages/trust/security_checks.ts`, `src/packages/contracts/index.ts`)**:
     - Created `wrapUntrustedData()` wrapping external inputs (page text, PDFs, tool/plugin outputs, imported skills) into typed `UntrustedContentWrapper<T>` containers, detecting prompt injection patterns and neutralizing instruction-override prefixes.
  6. **Automated Unit Tests Added**:
     - Added comprehensive 9-test adversarial and property suite in `src/packages/trust/trust_kernel_boundary.test.ts` covering default-deny on unidentified caller, elimination of `mockbank.local`, SSRF/private IP blocking, IDN homoglyphs, path traversal & safety-floor writes, safety-floor immutability, approval token replay/mutation prevention, untrusted data wrapping, and `ToolRegistry` pre-execution policy gating.
- **Verification Commands Executed**:
  - `npm run lint` (`tsc --noEmit`): **PASS** (exit code `0`).
  - `npm test`: **PASS** (exit code `0`, 124 tests across 6 suites, 124 passed, 0 failed).
  - `npm run build`: **PASS** (exit code `0`, built in 1.12s).
  - `npm run verify`: **PASS** (exit code `0`, all 9 gates passed).

---

## Phase 1 — Eliminate False Success & Build a Truthful Execution/Verifier Contract (Completed 2026-11-02)
- **Branch**: `remediation/phase-1-truthful-execution` (branched from `remediation/phase-0-baseline` at `98290a91a8c96ad4e6062aa98869e86e82038445`).
- **Deliverables Implemented**:
  1. **Canonical Execution & Verification Truth States (`src/packages/contracts/index.ts`, `src/packages/trust/index.ts`)**:
     - Defined `ExecutionTruthState` (`EXECUTED`, `SIMULATED`, `UNSUPPORTED`, `FAILED`, `UNCERTAIN`, `BLOCKED`, `WAITING_FOR_APPROVAL`, `NOT_CONFIGURED`), `VerificationTruthState`, `CanonicalSubsystem`, `TruthfulUiStatusLabel`, `CanonicalVerificationEvidence`, and `CanonicalExecutionResult`.
     - Added `formatTruthfulUiStatusLabel()` and `canPromoteRecordToReal()` to enforce truthful UI labelling and block promotion of simulated records to `REAL`.
  2. **Typed `ToolRegistry` & Strict Executor/Verifier Contract (`src/packages/runtime/index.ts`)**:
     - Replaced the generic `AgentRuntime` tool `switch`/`default` fallback with a typed `ToolRegistry` (`ToolRegistration` with unique `name`, `version`, `subsystem`, `inputSchema`, `outputSchema`, `riskClass`, `requiredCapabilities`, `executor`, `verifier`, `timeoutMs`, `retryPolicy`, and `availabilityStatus`).
     - Enforced that `EXECUTED` requires `realSideEffectPerformed === true` (staging a diff, mutating local state, returning a canned fixture, or emitting a model statement cannot produce `EXECUTED`).
     - Enforced that `VERIFIED` requires `independentTargetRead === true` and `criteriaMet === true`.
     - Unknown tools return `UNSUPPORTED` / `UNSUPPORTED_TOOL` (`ok: false`). Unknown skills (`UNKNOWN_SKILL`) and unknown plugins (`UNKNOWN_PLUGIN`) fail without fallback-to-first-skill (`|| ctx.skills[0]`) or fallback-to-first-file (`|| ctx.ideFiles[0]`).
     - Removed the generic `verified: true` fallback in `AgentRuntime.verifyStepOutcome()`; missing verifiers fail with `MISSING_VERIFIER`.
  3. **Hardened Desktop & Trust Verifiers (`src/packages/pc_operator/index.ts`, `src/packages/trust/index.ts`)**:
     - Updated `verifyDesktopStepOutcome()` so missing actual file hash (`file_hash`), missing DOM snapshot (`dom_snapshot`), or missing UI observation returns `passed: false`, `verificationState: 'UNCERTAIN'` (removed `?? spec.expectedValueOrHash` fallback), and unimplemented `vision_verifier` returns `passed: false`, `verificationState: 'UNSUPPORTED'`.
     - Updated `CORE_VERIFIER_STRATEGIES` (`dom_assertion`, `file_exists_hash`, `url_check`, `screenshot_check`) to return `status: 'uncertain'` when actual evidence is missing.
  4. **Simulator Isolation & Truthful Main UI Labels (`src/packages/trust/index.ts`, `src/packages/pc_operator/index.ts`, `src/packages/recorder/index.ts`, `src/packages/runtime/index.ts`, `src/App.tsx`)**:
     - Marked all canned browser, L3xi, workspace, skill, and desktop-stage implementations as `SIMULATED` (`isSimulated: true`).
     - Prevented simulated events in `MemoryLedger` from becoming standing rules (`canBecomeStandingRule: false`, `promoteEventToStandingRule` returns `SIMULATED_CANNOT_PROMOTE_TO_REAL`).
     - Updated `src/App.tsx` (`WhatIDidCard`, `handleSendMessage`, Scheduler runs, Teach & Replay bar, and Activity Ledger) to show `"Simulated (Preview)"`, `"Uncertain (Unverified)"`, `"Needs your approval"`, or `"Blocked for safety"` instead of `"Verified"` or `"Done"` for simulated/uncertain operations.
  5. **Automated Unit Tests Added**:
     - Added 5 comprehensive test suites across `src/packages/runtime/runtime.test.ts`, `src/packages/pc_operator/index.test.ts`, and `src/packages/trust/trust.test.ts` covering `success-without-side-effect`, `fake executor result`, `missing hash`, `unknown tool`, `unknown skill`, `unknown plugin`, `missing verifier`, `simulator isolation`, and `cancellation`.
- **Verification Commands Executed**:
  - `npm run lint` (`tsc --noEmit`): **PASS** (exit code `0`).
  - `npm test`: **PASS** (exit code `0`, 111 tests, 111 passed, 0 failed).
  - `npm run build`: **PASS** (exit code `0`, built in 1.11s).
  - `npm run verify`: **PASS** (exit code `0`, all 9 gates passed).

---

## Phase 0 — Baseline Audit & Feature Truth Map (Completed 2026-11-02)
- **Branch**: `remediation/phase-0-baseline` (branched from unmodified baseline `main` at `6429c892a0f73bc7e534ce19a8a9d7dd3fb03c01`).
- **Source Code Changes**: None (strict read-only baseline phase; only inventory and planning documentation updated).
- **Baseline Verification Commands Executed**:
  - `npm run lint` (`tsc --noEmit`): **PASS** (exit code `0`).
  - `npm test` (13 test suites via `tsx --test`): **PASS** (exit code `0`, 106 tests, 106 passed, 0 failed).
  - `npm run build` (`vite build`): **PASS** (exit code `0`, built in 1.08s).
  - `npm run verify` (`tsx scripts/verify.ts`): **PASS** (exit code `0`, 9 gates passed — note Gate 6 is currently a no-op stub).
  - `npm run eval` (`tsx scripts/run-eval.ts`): **PASS** (exit code `0` — note evaluation metrics currently include simulated skill replay).
  - `npx tsx scripts/perf-memory.ts`: **PASS** (exit code `0` — note profiler currently outputs static simulated PIDs/MBs).
- **Deliverables Produced**:
  - Created `/FEATURE_STATUS.md` with:
    1. Baseline command execution results and honesty assessment.
    2. Complete 18-subsystem Feature Truth Matrix (`REAL`, `PARTIAL`, `SIMULATED`, `STUB`, `UNSUPPORTED`, `NOT_CONFIGURED`).
    3. Exhaustive inventory of 20 action paths returning `success`, `verified`, `connected`, `completed`, `permission-granted`, or `encrypted` traced to actual side effects.
    4. Exact file-and-line mapping of all **19 audit findings (`F-01` through `F-19`)** with current status (`PRESENT`) and code proof.
  - Created `/REMEDIATION_PLAN.md` with the dependency DAG across `F-01..F-19` and the 7-phase remediation order.
  - Updated `/PROGRESS.md`, `/BLOCKERS.md`, and `/LIMITS.md`.

---

## Historical Pre-Audit Progress Log (Preserved from Checked-Out Baseline)

### Phase 0: Truth Ledger & Repo Reconnaissance
- Inspected full codebase (`package.json`, `server.ts`, `electron/*`, `src/packages/*`, `src/components/*`).
- Identified simulated vs real parts across all 16 packages.
- Created `PROGRESS.md`, `BLOCKERS.md`, `LIMITS.md`, and `DECISIONS.md`.

### Phase 1: Real Persistence, Encryption & Audit Ledger
- Upgraded `src/packages/vault/index.ts` to use real WebCrypto AES-256-GCM encryption and PBKDF2-SHA256 key derivation (`crypto.subtle.deriveKey` + `crypto.subtle.encrypt`/`decrypt`).
- Verified tamper detection, wrong-passphrase rejection, and real ciphertexts in unit tests.

### Phase 2: Real Local Backend Server & Model Router Proxy
- Created `server.ts` running Express + Vite middleware on port 3000.
- Added `/api/vault/*` endpoints, `/api/model` live LLM proxy (OpenAI, Anthropic, Gemini, Ollama), `/api/connectors/proxy` with SSRF protection, `/api/browser/read`, and `/api/hermes/*` webhook & outbound message routes.

### Phase 3: Real Web Reader, Code Formatting & Connector Execution
- Wired `ReaderEngine.navigate()` in `src/packages/browser_ide/index.ts` to fetch real web pages through `/api/connectors/proxy` when running in browser/server context, falling back to deterministic fixtures in offline unit tests.
- Wired `formatCodeWithPrettier()` to real `prettier` v3.8.3 AST formatting.
- Wired `testConnectorReal()` in `src/packages/connectors_scheduler/index.ts` to perform live HTTP checks in `live` mode.

### Phase 4: Real Hermes Messaging & Webhook Signature Verification
- Implemented real Ed25519 signature verification (`crypto.verify`) for Discord and HMAC-SHA256 (`crypto.timingSafeEqual`) for Slack in `server.ts` and `src/packages/hermes/index.ts`.
- Implemented real outbound HTTP delivery for Telegram (`sendMessage`) and Slack/Discord webhooks in `sendOutboundMessage()`.

### Phase 5: Honest Labelling of Simulated Previews & Verification
- Added explicit simulation badges and honesty disclosures across UI components.
- Ran `npm run lint`, `npm test`, `npm run build`, and `npm run verify` — all 9 gates pass.

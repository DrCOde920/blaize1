# Blaize — Remediation Progress Log (`PROGRESS.md`)

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

# Blaize — Remediation Plan & Phase Playbook (`REMEDIATION_PLAN.md`)

**Baseline Commit SHA:** `6429c892a0f73bc7e534ce19a8a9d7dd3fb03c01`  
**Remediation Branch:** `remediation/phase-0-baseline`  
**Status:** Phase 0 Complete — Waiting for Phase 1 Prompt

---

## 1. Guiding Principles & Execution Rules

1. **Preserve Architecture & UI**: Work inside the existing Blaize monorepo packages (`src/packages/*`), Express server (`server.ts`), Electron shell (`electron/*`), and React views (`src/components/*`). Do not rebuild from scratch or delete domain concepts.
2. **Strict Execution Honesty**: Never hide missing functionality, unconfigured credentials, or unsupported OS APIs behind a successful mock. Every subsystem must explicitly report its execution truth state:
   - `REAL`
   - `SIMULATED`
   - `UNSUPPORTED`
   - `NOT_CONFIGURED`
   - `FAILED`
   - `UNCERTAIN`
   - `BLOCKED`
   - `WAITING_FOR_APPROVAL`
3. **Fixtures for Tests & Demos Only**: Keep deterministic fixtures for automated tests and explicit demo/mock mode, but prevent fixtures from ever being counted as `live` execution, `connected` status, or measured benchmark evidence.
4. **Small, Reviewable Vertical Slices**: Implement only the requested phase per turn, add/update automated `node:test` suites for every slice, and verify via `npm run lint`, `npm test`, and `npm run build`.

---

## 2. Dependency Graph Between the 19 Audit Findings

The 19 findings discovered in `FEATURE_STATUS.md` have strict technical dependencies that dictate remediation order:

```text
[Foundation: Truth Taxonomy & Contracts]
   │
   ├──► Phase 1: Security, Auth, Vault & Cryptography (F-01, F-02, F-03, F-04, F-05)
   │       ├── F-01 (Remove hardcoded '2026' & placeholder key seeding)
   │       ├── F-02 (Enforce PER_LAUNCH_AUTH_TOKEN on /api/vault/*, /api/model, /api/connectors/*)
   │       ├── F-03 (Unify PBKDF2-SHA256 210,000 iterations & remove simulated PBKDF2)
   │       ├── F-04 (Real WebCrypto AES-256-GCM for Audit Ledger & Places Archive)
   │       └── F-05 (Strict allowlist + DNS resolution + IPv4/IPv6 private range blocking on proxy/browser routes)
   │
   ├──► Phase 2: Places ('My Places') & Unified PlacesGuard Enforcement (F-19 + F-04 archive)
   │       └── Depends on Phase 1 (real AES-GCM archive encryption)
   │       └── Wire PlacesGuard into AgentRuntime, Workspace tools, Skill replay, and FileSystemBridge
   │
   ├──► Phase 3: AgentRuntime, ModelRouter & Honest Verifier Engine (F-09, F-10, F-11)
   │       └── Depends on Phase 1 (authenticated /api/model & Vault state) and Phase 2 (PlacesGuard in runtime)
   │       ├── F-09 (Live LLM tool planning via /api/model when configured; explicit NOT_CONFIGURED/SIMULATED state otherwise)
   │       ├── F-10 (Real VerifierEngine checks against actual DOM/file/HTTP/process state; no self-certifying customParams)
   │       └── F-11 (Real step execution & verification in replayCompiledSkillByIntent)
   │
   ├──► Phase 4: Connectors, OAuth PKCE & Hermes Messaging Honesty (F-06, F-07, F-08)
   │       └── Depends on Phase 1 (SSRF proxy hardening & Vault storage for tokens)
   │       ├── F-06 (Real OAuth PKCE token exchange HTTP POST; return NOT_CONFIGURED/FAILED when client credentials absent)
   │       ├── F-07 (Remove silent fixture fallback in live mode for testConnectorReal)
   │       └── F-08 (Real HTTP tool invocation in invokeConnectorToolWithSafety or explicit NOT_CONFIGURED/SIMULATED state)
   │
   ├──► Phase 5: AI Browser & IDE Workspace Honesty (F-14, F-15)
   │       └── Depends on Phase 1 (hardened /api/browser/read & /api/connectors/proxy)
   │       ├── F-14 (Remove silent Kyoto HTML 200 OK fallback on network error; surface real HTTP/network errors)
   │       └── F-15 (Mark RemoteBrowserEngine UNSUPPORTED/NOT_CONFIGURED unless real headless browser is attached)
   │
   ├──► Phase 6: PC Operator, Assistant-First Autonomy & OS Drivers (F-12, F-13)
   │       └── Depends on Phase 2 (PlacesGuard) and Phase 3 (VerifierEngine)
   │       ├── F-12 (Clearly separate SIMULATED preview driver from UNSUPPORTED/REAL OS drivers; never fake OS permissions as 'granted')
   │       └── F-13 (Separate fixture/simulated dry-runs from live benchmark metrics in runEverydayPcBenchmarkSuite)
   │
   └──► Phase 7: Electron Main Process, Persistence, Memory Profiler & Honesty Gates (F-16, F-17, F-18)
           └── Depends on Phases 1–6 (all fake/simulated claims remediated so Gate 6 passes honestly)
           ├── F-16 (Honest platform capability reporting for Electron IPC & persistent storage fallback)
           ├── F-17 (Use real process.memoryUsage() / os.totalmem() in measurePerProcessMemory)
           └── F-18 (Implement real AST/regex Metric Honesty Scan in scripts/verify.ts Gate 6 & honest run-eval.ts output)
```

---

## 3. Phase-by-Phase Remediation Order

### Phase 0 — Establish Baseline & Produce Feature Truth Map *(COMPLETED)*
- **Scope**: Read-only audit of repository, execution of all baseline commands, creation of `FEATURE_STATUS.md` and `REMEDIATION_PLAN.md`, and updates to `PROGRESS.md`, `BLOCKERS.md`, and `LIMITS.md`.
- **Findings Mapped**: F-01 through F-19.
- **Source Code Changes**: None (documentation/inventory files only).

### Phase 1 — Security, Authentication, Vault & Cryptographic Integrity
- **Findings Addressed**: **F-01, F-02, F-03, F-04, F-05**
- **Deliverables**:
  1. Remove automatic seeding of `'meta-preview-placeholder-7f9a'` and default passphrase `'2026'` in `server.ts`. Report Vault status honestly as `NOT_CONFIGURED` / `LOCKED` until the user sets a passphrase and stores a key.
  2. Enforce `PER_LAUNCH_AUTH_TOKEN` (or same-origin session token) across sensitive server endpoints (`/api/vault/*`, `/api/model`, `/api/connectors/*`).
  3. Standardize WebCrypto PBKDF2-SHA256 at `210,000` iterations in `src/packages/vault/index.ts` and replace `deriveSecretCodePBKDF2` in `src/packages/runtime/index.ts` with real WebCrypto PBKDF2.
  4. Replace simulated Base64 `"enc:aes256gcm:"` in `MemoryLedger` (`src/packages/trust/index.ts`) and simulated hash encoding in `exportEncryptedMapArchive` (`src/packages/places/index.ts`) with real WebCrypto AES-256-GCM encryption.
  5. Harden `/api/connectors/proxy` and `/api/browser/read` in `server.ts`: enforce `ALLOWED_CONNECTOR_HOSTS` on connector proxy requests, block IPv4/IPv6 loopback/private/link-local/metadata literals and DNS-resolved private IPs, and set `redirect: 'manual'`.
- **Verification**: Unit & integration tests for Vault crypto, Ledger AES-GCM encryption, auth token enforcement, and SSRF IPv4/IPv6/redirect blocking.

### Phase 2 — File Map ('My Places') & End-to-End `PlacesGuard` Enforcement
- **Findings Addressed**: **F-19** (plus encrypted map archive integration from F-04)
- **Deliverables**:
  1. Wire `PlacesGuard` (`evaluatePlacesGuard`) as a mandatory pre-execution gate across `AgentRuntime`, workspace file tools, skill execution, shell commands, and chore execution.
  2. Ensure `BROWSER_FILE_SYSTEM_BRIDGE` honestly distinguishes real `FileSystemDirectoryHandle` traversal from fixture trees (`executionTruth: 'REAL' | 'SIMULATED'`).
  3. Verify deny-over-allow, path canonicalization (`..`, symlinks, UNC, Windows short names, case normalization), undo journal moves, and zero content reads from `Never` zones.
- **Verification**: Path-escape, symlink, UNC, short-name, and cross-tool `PlacesGuard` enforcement tests.

### Phase 3 — AgentRuntime, ModelRouter & Independent Verifier Honesty
- **Findings Addressed**: **F-09, F-10, F-11**
- **Deliverables**:
  1. Update `AgentRuntime.runMission` (`src/packages/runtime/index.ts`) so that `live` mode invokes `/api/model` for planning/tool selection, and returns `NOT_CONFIGURED` (or explicit `SIMULATED` only when demo/mock mode is selected) when no live provider key is configured.
  2. Refactor `CORE_VERIFIER_STRATEGIES` (`src/packages/trust/index.ts`) so verifiers inspect real execution artifacts/state rather than trusting caller-supplied `customParams` booleans; return `UNCERTAIN` or `FAILED` when independent evidence cannot be verified.
  3. Refactor `replayCompiledSkillByIntent` (`src/packages/runtime/index.ts`) to execute real step handlers and run independent verification instead of mapping every step to `verified: true`.
- **Verification**: Runtime mission tests covering `REAL`, `SIMULATED`, `NOT_CONFIGURED`, `FAILED`, and `UNCERTAIN` verification states.

### Phase 4 — Connectors, OAuth PKCE & Hermes Messaging Honesty
- **Findings Addressed**: **F-06, F-07, F-08**
- **Deliverables**:
  1. Update `/api/connectors/oauth/exchange` (`server.ts`) to perform a real HTTP POST token exchange when client credentials are provided, and return `NOT_CONFIGURED` / `FAILED` (never fake `authenticated`) when credentials or auth codes are invalid/missing.
  2. Update `testConnectorReal` (`src/packages/connectors_scheduler/index.ts`) so `live` mode never falls back to `RECORDED_CONNECTOR_TEST_FIXTURES`. Only return `connected` (`REAL`) when a live upstream HTTP request succeeds; return `NOT_CONFIGURED` or `FAILED` otherwise, and label mock mode explicitly as `SIMULATED`.
  3. Update `invokeConnectorToolWithSafety` to perform real connector HTTP requests where supported or return explicit `NOT_CONFIGURED` / `SIMULATED` status.
- **Verification**: Connector live vs. mock vs. unconfigured tests and OAuth PKCE negative/positive tests.

### Phase 5 — AI Browser & IDE Workspace Honesty
- **Findings Addressed**: **F-14, F-15**
- **Deliverables**:
  1. Remove the silent Kyoto HTML `statusCode: 200` fallback in `ReaderEngine.navigate` (`src/packages/browser_ide/index.ts:200-204`). When a live fetch fails or is blocked, return an explicit `FAILED` / `BLOCKED` state with the real error reason (keep Kyoto fixture strictly for explicit offline demo/test mode labeled `SIMULATED`).
  2. Update `RemoteBrowserEngine` (`src/packages/browser_ide/index.ts:294-307`) to report `isAvailable: false` / `UNSUPPORTED` when no headless browser backend is connected, rather than masquerading `ReaderEngine` output as `remote_browser_engine`.
- **Verification**: Browser navigation tests for live fetch, SSRF block, network error surfacing, and engine truth labels.

### Phase 6 — PC Operator, Assistant-First Autonomy & OS Drivers
- **Findings Addressed**: **F-12, F-13**
- **Deliverables**:
  1. Update `WindowsDesktopDriver`, `MacOSDesktopDriver`, `LinuxDesktopDriver`, and `checkPermissions()` (`src/packages/pc_operator/index.ts`) so browser/container environments report `UNSUPPORTED` or `SIMULATED` (in explicit sandbox mode) instead of claiming OS permissions (`AXIsProcessTrusted`, `CGPreflightScreenCaptureAccess`, Windows UIA, AT-SPI2) are `'granted'`.
  2. Update `runEverydayPcBenchmarkSuite` (`src/packages/pc_operator/index.ts` & `server.ts`) so simulated driver runs are labeled `SIMULATED` (`liveBenchmarkEvidence: false`) and never reported as real OS desktop benchmark completion.
- **Verification**: PC Operator driver truth classification tests, autonomy yield/scope/approval tests, and benchmark honesty checks.

### Phase 7 — Electron Main Process, Memory Profiler & Verification Pipeline Honesty
- **Findings Addressed**: **F-16, F-17, F-18**
- **Deliverables**:
  1. Update `electron/main.ts` and `src/packages/platform/index.ts` so in-memory fallback stores and stubbed `pc-operator` IPC handlers explicitly report their `SIMULATED` / `UNSUPPORTED` capability status.
  2. Update `measurePerProcessMemory` (`src/packages/living/index.ts`) and `scripts/perf-memory.ts` to report real `process.memoryUsage()` and `os.totalmem()` metrics from the running Node/Electron process instead of hardcoded PIDs (`4101`, `4108`, etc.).
  3. Implement a real `Metric Honesty Scan` in `scripts/verify.ts` Gate 6 that scans source and eval outputs for hardcoded `100%` benchmark claims, fake `verified: true` maps, and unlabeled fixture fallbacks; update `scripts/run-eval.ts` and `evals/results.md` to clearly distinguish `REAL` vs. `SIMULATED` metrics.
- **Verification**: Full 9-gate `npm run verify`, `npm test`, `npm run lint`, and `npm run build`.

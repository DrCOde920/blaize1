# Blaize — Known Limitations (`LIMITS.md`)

## Phase 0 Baseline Truth Limitations (Cataloged for Remediation in Phases 1–7)

Detailed file-and-line proofs for each limitation are recorded in `/FEATURE_STATUS.md` (`F-01` through `F-19`):

1. **Server Vault, Crypto & Durable Storage (`F-01`, `F-02`, `F-03`, `F-04`, `F-16`) — Remediated in Phase 3**
   - **Remediated in Phase 3**:
     - Removed hardcoded default vault entry seeding with passphrase `'2026'` and placeholder key in `server.ts`. Vault starts empty and locked.
     - `POST /api/vault/store` requires user-supplied passphrase; fails if absent.
     - `VaultService` upgraded to `210_000` PBKDF2 iterations (retaining decrypt compatibility for legacy records).
     - `deriveSecretCodePBKDF2` replaced with real cryptographic `scrypt` (`deriveSecretCodeScrypt`) with versioned parameters (`N: 16384, r: 8, p: 1, keyLen: 32`) and per-user salt.
     - Reversible Base64 prefix `"enc:aes256gcm:"` in `MemoryLedger` replaced with real authenticated AES-256-GCM (`encryptPayloadAesGcm` with 12-byte IV and 16-byte auth tag) and versioned canonical 11-field ledger hashing with real SHA-256.
     - Built `DurableSqliteDatabase` with native Node 22 `node:sqlite`, WAL mode, versioned migrations (`001_initial_durable_schema`), real SQLite FTS5 full-text indexing, right-to-delete payload zeroing on disk, and nested transactions.
     - `electron/main.ts` stores records, FTS index, blobs, and encrypted secrets in durable SQLite instead of volatile JS `Map`s.
     - Fresh install defaults to `onboardingCompleted: false`. Demo identity isolated with `isDemo: true`.
   - **Remaining for Future Phases**:
     - `PER_LAUNCH_AUTH_TOKEN` (`server.ts:107`) is generated at startup; enforcement headers across `/api/vault/*` and `/api/model` will be completed in Phase 4.
     - `exportEncryptedMapArchive` in `Places` (`src/packages/places/index.ts:1042-1071`) uses local string hash; will be wired to `encryptPayloadAesGcm` in Phase 4.

3. **SSRF & OAuth PKCE Limitations (`F-05`, `F-06`, `F-07`, `F-08`) — Partially Remediated in Phase 2**
   - **Remediated in Phase 2 (`F-06` PolicyGuard & Security Boundaries)**:
     - `PolicyEngine` enforces default-deny on unidentified callers, unknown risk classes, or policy errors (`fail closed`).
     - `mockbank.local` fallback has been completely eliminated. Unresolvable or relative URLs fail closed (`UNRESOLVED_DOMAIN_DEFAULT_DENY`).
     - `canonicalizeAndValidateUrl` blocks non-HTTP schemes (`file:`, `javascript:`, `data:`), Punycode IDN homographs, Cyrillic/Greek homoglyphs, and private/loopback IP literals (`127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`, `0.0.0.0`, `::1`, `fe80:`, `fc00:`).
     - Single-use scoped approval tokens have a 5-minute TTL (`300,000 ms`) and strict parameter binding (replays and parameter mutations rejected).
     - Safety-floor rules and protected paths (`packages/trust/*`, `SOUL.md`, `.env`) are immutable to model changes or file writes.
     - Untrusted external content is wrapped and stripped of instruction-hijacking prefixes.
   - **Remaining for Future Phases**:
     - Socket-level DNS rebinding resolution during upstream HTTP requests (`dns.lookup` before connection) in `server.ts` `/api/connectors/proxy` (Phase 3).
     - `/api/connectors/oauth/exchange` (`server.ts:791-807`) returns `status: 'authenticated'` without performing an upstream OAuth token exchange POST (Phase 3).
     - `testConnectorReal` (`src/packages/connectors_scheduler/index.ts:756-837`) HTTP testing for all 18 connectors (Phase 3).
   - `invokeConnectorToolWithSafety` (`src/packages/connectors_scheduler/index.ts:842-926`) returns `status: 'executed'` without calling external APIs.

4. **AgentRuntime, Verifiers & Skill Replay Simulation (`F-09`, `F-10`, `F-11`) — Partially Remediated in Phase 1**
   - **Remediated in Phase 1**:
     - `ToolRegistry` and `AgentRuntime.verifyStepOutcome()` no longer allow unknown tools (`UNSUPPORTED_TOOL`), unknown skills (`UNKNOWN_SKILL`), unknown plugins (`UNKNOWN_PLUGIN`), missing verifiers (`MISSING_VERIFIER`), or success without real side effects (`EXECUTION_WITHOUT_SIDE_EFFECT`).
     - `verifyDesktopStepOutcome()` and `CORE_VERIFIER_STRATEGIES` no longer substitute expected hashes for missing actual hashes or pass when DOM snapshots/UI observations are absent (`UNCERTAIN`), and `vision_verifier` returns `UNSUPPORTED`.
     - All canned runtime, skill, browser, L3xi, workspace, and desktop-stage implementations are explicitly marked `SIMULATED` (`isSimulated: true`) and isolated from promotion to `REAL`.
   - **Remaining for Future Phases**:
     - `AgentRuntime.runMission` still uses deterministic tool-call planning templates in `planToolCalls()` when live model tool-calling is not invoked (Phase 3/5).
     - `replayCompiledSkillByIntent` still replays against simulated in-memory state (`executionState: 'SIMULATED'`).

5. **PC Operator, Browser & Profiler Simulation (`F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`)**
   - `BaseCrossPlatformDriver` (`src/packages/pc_operator/index.ts`) and `runEverydayPcBenchmarkSuite` are now explicitly tagged `executionState: 'SIMULATED'` and `isSimulated: true` (Phase 1), but still simulate desktop windows/elements in memory and hardcode OS permission checks (`AXIsProcessTrusted`, `CGPreflightScreenCaptureAccess`, Windows UIA, Linux AT-SPI2) as `'granted'` (to be remediated in Phase 5).
   - `ReaderEngine.navigate` (`src/packages/browser_ide/index.ts:200-204`) masks network errors with a hardcoded Kyoto HTML string (`statusCode: 200`), and `RemoteBrowserEngine` (`lines 294-307`) aliases `ReaderEngine` (to be remediated in Phase 4).
   - `measurePerProcessMemory` (`src/packages/living/index.ts:879-977`) returns hardcoded PIDs and MB values (to be remediated in Phase 6).
   - `scripts/verify.ts` Gate 6 (`lines 177-180`) is a no-op stub (to be remediated in Phase 7).
   - `PlacesGuard` (`src/packages/places/index.ts`) is implemented and unit-tested as pure logic, but not yet enforced as a mandatory pre-execution hook across all workspace/runtime tools (to be remediated in Phase 4).


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

4. **AgentRuntime, Verifiers & Skill Replay Simulation (`F-09`, `F-10`, `F-11`) — Remediated in Phases 1 & 4**
   - **Remediated in Phase 1**:
     - `ToolRegistry` and `AgentRuntime.verifyStepOutcome()` no longer allow unknown tools (`UNSUPPORTED_TOOL`), unknown skills (`UNKNOWN_SKILL`), unknown plugins (`UNKNOWN_PLUGIN`), missing verifiers (`MISSING_VERIFIER`), or success without real side effects (`EXECUTION_WITHOUT_SIDE_EFFECT`).
     - `verifyDesktopStepOutcome()` and `CORE_VERIFIER_STRATEGIES` no longer substitute expected hashes for missing actual hashes or pass when DOM snapshots/UI observations are absent (`UNCERTAIN`), and `vision_verifier` returns `UNSUPPORTED`.
     - All canned runtime, skill, browser, L3xi, workspace, and desktop-stage implementations are explicitly marked `SIMULATED` (`isSimulated: true`) and isolated from promotion to `REAL`.
   - **Remediated in Phase 4 (`F-09` Meta Model Inference & Mission Loop)**:
     - `ModelRouter.respond()` / `generate()` calls `/api/model` with request IDs, rate limits, 64 KB payload caps, timeouts, abort signals, and separate reported vs estimated usage tracking.
     - `AgentRuntime.runMission()` in `live` mode executes a real multi-turn model loop sending the 4-slot prompt and `ToolRegistry.toModelToolSchemas()`, validating untrusted proposals (`validateUntrustedModelToolProposal`), enforcing `PolicyEngine`, wrapping tool observations in `<untrusted_data>`, and escalating from `muse-spark-1.3` to `muse-wonder-1.0` on recovery.
     - `/api/model/test` performs both catalogue reachability and a real inference + tool-calling probe, exposing 5 distinct health flags in the UI.
   - **Remaining for Future Phases**:
     - `replayCompiledSkillByIntent` still replays against simulated in-memory state (`executionState: 'SIMULATED'`).

5. **Electron Packaging Host Limits & PC Operator / Browser / Profiler Simulation (`F-12`, `F-13`, `F-14`, `F-15`, `F-16`, `F-17`, `F-18`, `F-19`)**
   - **Remediated in Phase 5 (`F-16` Electron Desktop Foundation)**:
     - Installed and pinned `electron` (`45.2.1`) and `electron-builder` (`26.18.0`); added `desktop:dev`, `desktop:build`, `desktop:package`, `desktop:package:linux`, `desktop:package:win`, `desktop:package:mac`, and `test:electron`.
     - Hardened `BrowserWindow` defaults, CSP, navigation allowlist, default-deny permissions, HTTPS-only external links, mainFrame/origin IPC validation, runtime Zod schemas across all 25 channels, `PolicyEngine` routing, and durable SQLite WAL + FTS5 persistence.
     - Built and smoke-tested the Linux `x64` desktop bundle (`release/blaize-desktop-linux-x64` + `.tar.gz`).
   - **Remediated in Phase 6A (`F-11` / `F-12` Linux Desktop Driver)**:
     - Replaced `LinuxDesktopDriver` synthetic `BaseCrossPlatformDriver` inheritance with a real Linux desktop adapter (`src/packages/pc_operator/linux_driver.ts`, `isSimulated: false`).
     - Dynamically probes session type (`wayland` / `x11` / `headless`), desktop environment, AT-SPI2 bus/sockets, XDG Desktop Portals (`WaylandPortalSessionManager`), X11 tools, monitors, `/proc` processes, and permissions (zero hardcoded `'granted'` values).
     - Captures fresh pre-action and post-action OS snapshots (`beforeSnapshot` / `afterSnapshot`), enforces Wayland global input restrictions (`UNSUPPORTED_WAYLAND_GLOBAL_INPUT`) and T4 user-input pause hooks (`UNSUPPORTED_T4_NO_USER_INPUT_HOOK`), and prevents synthetic snapshots (`isSimulated: true`) from being labelled `VERIFIED` or promoted to `REAL`.
   - **Remediated in Phase 6B (`F-11` / `F-12` Windows Desktop Driver)**:
     - Replaced `WindowsDesktopDriver` synthetic `BaseCrossPlatformDriver` inheritance with a real Windows desktop adapter (`src/packages/pc_operator/windows_driver.ts`, `isSimulated: false`).
     - Implements Win32 window/process discovery, Per-Monitor DPI v2 coordinate & monitor mapping, UIPI standard-user security boundary (refuses to bypass UAC or inject into elevated Administrator windows, returning `UNSUPPORTED` or `WAITING_FOR_APPROVAL`), all 5 UIA patterns (`InvokePattern`, `ValuePattern`, `SelectionItemPattern`, `ExpandCollapsePattern`, `ScrollPattern`), dynamic permission checks (zero hardcoded `'granted'` values), fresh pre/post OS observations, and T4 physical user-input auto-pause detection.
   - **Remediated in Phase 6C (`F-12` macOS Desktop Driver)**:
     - Replaced `MacOSDesktopDriver` synthetic `BaseCrossPlatformDriver` inheritance with a real macOS desktop adapter (`src/packages/pc_operator/macos_driver.ts`, `isSimulated: false`) with Retina 2.0x DPI mapping, `SecurityAgent` and `AXSecureTextField` security boundaries, dynamic permission checks, and fresh pre/post OS observations.
   - **Remediated in Phase 7 (`F-10`, `F-11`, `F-14`, `F-15` AI Browser, Scoped IDE Workspace, Consented Recorder & Skill Replay)**:
     - Implemented `ChromiumBrowserSessionManager` (`src/packages/browser_ide/browser_session.ts`) with isolated persistent profile partitions (`personal`, `work`, `testing`), PolicyEngine URL/redirect/download validation, credential shield auto-pause, untrusted page text wrapping, and removal of the silent Kyoto fallback from live browser paths (offline fixtures require explicit `useOfflineFixture: true` and are tagged `SIMULATED`).
     - Implemented `ScopedWorkspaceManager` and `RestrictedCommandRegistry` (`src/packages/browser_ide/scoped_workspace.ts`) with canonical path resolution, symlink/traversal escape prevention, SHA-256 file verification, checkpoints, staged diffs, and allowlisted test commands.
     - Implemented `ConsentedRecorder` (`src/packages/recorder/consented_recorder.ts`) and `SkillReplayEngine` (`src/packages/runtime/skill_replay_engine.ts`) with explicit capture consent, credential screen auto-pause, secret redaction, parameterized skill compilation, drift detection, checkpoints/rollback, and real file/state verification.
   - **Remediated in Phase 8 (Dynamic Skill/Plugin Runtime & Self-Extension Manager)**:
     - Implemented `SelfExtensionManager` (`src/packages/runtime/self_extension_manager.ts`) enforcing a deterministic code boundary between `CapabilityPlane` and `ProtectedControlPlane`, strict `PluginManifestV1` with Ed25519 signature & SHA-256 content hash verification, zero default permissions (`effectiveGrants = requested ∩ HostCapabilityCeiling`), out-of-process restricted worker execution (`prlimit` + Node `--permission` + `--max-old-space-size=64` + null-prototype `vm`), version-pinned skills (`blaize.skill.v1`) executing through `PolicyEngine` + `ToolRegistry` + `MemoryLedger`, and secret-redacted skill creation from natural language and Teach & Replay traces.
   - **Remaining Platform & Subsystem Limitations**:
     - Because the current CI / AI Studio runner is a headless Linux container (`process.platform === 'linux'`), `WindowsDesktopDriver` is exercised end-to-end against `scripts/windows-test-app.py` over `BLAIZE_WINDOWS_UIA_SOCKET` and `MacOSDesktopDriver` against `scripts/macos-test-app.py` over `BLAIZE_MACOS_AX_SOCKET`, while physical Windows 10/11 and macOS sessions are documented in `docs/WINDOWS_DRIVER_TEST_CHECKLIST.md` and `docs/MACOS_DRIVER_TEST_CHECKLIST.md`.
     - Cross-OS installer generation (`desktop:package:mac` `.dmg` and `desktop:package:win` `.exe`) cannot be executed on a Linux container runner and honestly exits with `UNSUPPORTED_HOST_OS` (requires native `darwin` and `win32` CI runners).
     - `measurePerProcessMemory` (`src/packages/living/index.ts:879-977`) and `scripts/verify.ts` Gate 6 remain to be remediated in future phases.

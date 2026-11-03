# Blaize — Blockers (`BLOCKERS.md`)

## Phase 0 Baseline Audit — Active Environment & Platform Blockers

1. **No Interactive GUI Display Server or macOS/Windows Host OS in Container (`UNSUPPORTED`)**
   - **Impact**: The AI Studio preview runs inside a headless Linux container without an active X11/Wayland GUI compositor or macOS/Windows host kernel.
   - **Required Handling**: `LinuxDesktopDriver` (Phase 6A), `WindowsDesktopDriver` (Phase 6B), and `MacOSDesktopDriver` (Phase 6C) exercise real child-process accessibility/UIA/AX tree discovery, UIPI/Wayland/SecurityAgent security boundaries, and action execution against `scripts/linux-test-app.py`, `scripts/windows-test-app.py`, and `scripts/macos-test-app.py`, while honestly reporting `needs_setup` / `os_limitation` / `UNSUPPORTED` when native display servers, Windows/macOS hosts, or hardware input hooks are absent.

2. **Browser Sandbox Restrictions on Arbitrary Filesystem Access (`UNSUPPORTED` / `PARTIAL`)**
   - **Impact**: In the browser preview, `window.showDirectoryPicker` (Chromium File System Access API) is blocked inside cross-origin iframes and restricted from system roots by the browser security model.
   - **Required Handling**: `FileSystemBridge` (`src/packages/places/index.ts`) must clearly separate real `FileSystemDirectoryHandle` operations from fixture/sandbox directory trees (`REAL` vs `SIMULATED` vs `UNSUPPORTED`).

3. **Unconfigured Live External API Keys & OAuth Client Secrets (`NOT_CONFIGURED`)**
   - **Impact**: Live LLM providers (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`), 3P OAuth 2.0 apps (Google Workspace, Microsoft Graph, GitHub, Slack, Notion, Linear, Stripe), and Hermes bot tokens (Telegram, Discord, Slack) are not pre-populated in `.env`.
   - **Required Handling**: Endpoints and services must return `NOT_CONFIGURED` until the user supplies real credentials in the Vault, rather than seeding fake keys (`'meta-preview-placeholder-7f9a'`) or falling back to `RECORDED_CONNECTOR_TEST_FIXTURES` with `status: 'connected'`.

4. **Cross-OS Native Installer Toolchains Unavailable on Linux Container (`UNSUPPORTED_HOST_OS`)**
   - **Impact**: While `npm run desktop:package:linux` builds and smoke-verifies the Linux `x64` desktop bundle on this runner, building signed macOS `.dmg` bundles (`hdiutil` / `codesign`) and Windows NSIS `.exe` installers (`makensis` / `signtool`) requires native `darwin` and `win32` host runners.
   - **Required Handling**: `npm run desktop:package:mac` and `npm run desktop:package:win` fail closed with `UNSUPPORTED_HOST_OS` (exit code `2`) on Linux rather than fabricating cross-OS installer success.

---

## Resolved Blockers (Remediated in Phases 1–6C)

- **Synthetic macOS Desktop Driver & Hardcoded macOS Permissions (`RESOLVED in Phase 6C`)**: Replaced `MacOSDesktopDriver` with a real macOS adapter (`src/packages/pc_operator/macos_driver.ts`) featuring dynamic permission probing (`AXIsProcessTrusted`, `CGPreflightScreenCaptureAccess`, `AEDeterminePermissionToAutomateTarget`, `CGEventTap`), Retina 2.0x DPI scaling, protected system window boundaries (`SecurityAgent`, `coreauthd`, `Keychain Access`, `1Password`, `Bitwarden` refused with `SECURITY_AGENT_ACCESS_DENIED`), secure input masking (`AXSecureTextField` masked as `[PROTECTED_SECURE_INPUT]` with injection blocked via `SECURE_INPUT_FIELD_RESTRICTION`), all supported AX actions (`AXPress`, `AXSetValue`, `AXSelect`, `AXShowMenu`, `AXScrollToVisibleAction`), T4 user-input auto-pause hook, fresh pre/post OS observations, and end-to-end verification against `scripts/macos-test-app.py`.
- **Synthetic Windows Desktop Driver & Hardcoded Windows Permissions (`RESOLVED in Phase 6B`)**: Replaced `WindowsDesktopDriver` with a real Windows adapter (`src/packages/pc_operator/windows_driver.ts`) featuring dynamic permission probing, Per-Monitor DPI v2 bounds, standard-user UIPI elevated-window refusal (`UNSUPPORTED` / `WAITING_FOR_APPROVAL`), all 5 UIA patterns (`Invoke`, `Value`, `SelectionItem`, `ExpandCollapse`, `Scroll`), T4 user-input auto-pause hook, fresh pre/post OS observations, and end-to-end verification against `scripts/windows-test-app.py`.
- **Synthetic Linux Desktop Driver & Hardcoded Linux Permissions (`RESOLVED in Phase 6A`)**: Replaced `LinuxDesktopDriver` with a real Linux adapter (`src/packages/pc_operator/linux_driver.ts`) featuring dynamic permission checks, Wayland portal token flow, T4 user-input hook enforcement, fresh pre/post OS observations, and end-to-end verification against `scripts/linux-test-app.py`.
- **Electron Runtime Binary & Hardened Desktop Packaging (`RESOLVED in Phase 5`)**: Installed and pinned `electron` (`45.2.1`) and `electron-builder` (`26.18.0`); implemented hardened `BrowserWindow`, 25 Zod-validated IPC channels, mainFrame/origin sender checks, durable SQLite IPC handlers, Ed25519 update verification, local redacted crash reports, and reproducible Linux desktop packaging (`scripts/build-desktop.ts`, `scripts/package-desktop.ts`).
- **Hardcoded Mission Planner & Unwired Live Model Loop (`RESOLVED in Phase 4`)**: Replaced with `ModelRouter.respond()`, iterative multi-turn `AgentRuntime.runMission()` in `live` mode, untrusted proposal validation, `<untrusted_data>` tool observation wrapping, and 5-flag inference health probing (`/api/model/test`).
- **Volatile In-Memory Maps as Storage of Truth (`RESOLVED in Phase 3`)**: Replaced with durable SQLite (`DatabaseSync` from `node:sqlite`), versioned migrations, real SQLite FTS5, and restart-safe file persistence.
- **Simulated Ledger Encryption & Reversible Base64 (`RESOLVED in Phase 3`)**: Replaced with real authenticated AES-256-GCM, 12-byte random IVs, 16-byte tags, and 11-field canonical ledger hashing.
- **Hardcoded Secret Code `'2026'` & Simulated PBKDF2 (`RESOLVED in Phase 3`)**: Hardcoded seed removed; `scrypt` KDF implemented with per-user random salt; fresh install onboarding defaults to incomplete.
- **Unchecked Execution & Fallback Verifiers (`RESOLVED in Phase 1`)**: Replaced with typed `ToolRegistry`, explicit truth states, and independent state verifiers.
- **`mockbank.local` Fallback & SSRF Vulnerabilities (`RESOLVED in Phase 2`)**: Replaced with centralized default-deny `PolicyEngine`, strict URL validation, private IP blocking, and IDN homoglyph rejection.





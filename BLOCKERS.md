# Blaize — Blockers (`BLOCKERS.md`)

## Phase 0 Baseline Audit — Active Environment & Platform Blockers

1. **No Native Desktop OS Window / Accessibility Server in Container (`UNSUPPORTED`)**
   - **Impact**: The AI Studio preview runs inside a headless Linux container without a user desktop session (no macOS Accessibility `AXUIElement` / `CGWindowList`, no Windows UIA3 / Win32 HWND, and no active desktop X11/Wayland AT-SPI2 user session).
   - **Required Handling**: `WindowsDesktopDriver`, `MacOSDesktopDriver`, `LinuxDesktopDriver`, and Electron `pc-operator` IPC handlers cannot exercise real OS desktop control in this environment and must report `UNSUPPORTED` (or `SIMULATED` when running against the sandbox stage) rather than claiming `status: 'granted'` or `100%` live desktop benchmark completion.

2. **Browser Sandbox Restrictions on Arbitrary Filesystem Access (`UNSUPPORTED` / `PARTIAL`)**
   - **Impact**: In the browser preview, `window.showDirectoryPicker` (Chromium File System Access API) is blocked inside cross-origin iframes and restricted from system roots by the browser security model.
   - **Required Handling**: `FileSystemBridge` (`src/packages/places/index.ts`) must clearly separate real `FileSystemDirectoryHandle` operations from fixture/sandbox directory trees (`REAL` vs `SIMULATED` vs `UNSUPPORTED`).

3. **Unconfigured Live External API Keys & OAuth Client Secrets (`NOT_CONFIGURED`)**
   - **Impact**: Live LLM providers (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`), 3P OAuth 2.0 apps (Google Workspace, Microsoft Graph, GitHub, Slack, Notion, Linear, Stripe), and Hermes bot tokens (Telegram, Discord, Slack) are not pre-populated in `.env`.
   - **Required Handling**: Endpoints and services must return `NOT_CONFIGURED` until the user supplies real credentials in the Vault, rather than seeding fake keys (`'meta-preview-placeholder-7f9a'`) or falling back to `RECORDED_CONNECTOR_TEST_FIXTURES` with `status: 'connected'`.

4. **Electron Runtime Binary Not Installed in Web Preview (`UNSUPPORTED`)**
   - **Impact**: `electron` is not installed in `package.json` because the preview runs as a web application on port 3000 via `tsx server.ts`.
   - **Required Handling**: `electron/main.ts` and `electron/preload.ts` are typechecked and contract-verified, while runtime execution uses `BrowserPlatformBridge` (`src/packages/platform/index.ts`), which must honestly label simulated/unsupported desktop capabilities.

---

## Resolved Blockers (Remediated in Phases 1–3)

- **Volatile In-Memory Maps as Storage of Truth (`RESOLVED in Phase 3`)**: Replaced with durable SQLite (`DatabaseSync` from `node:sqlite`), versioned migrations, real SQLite FTS5, and restart-safe file persistence.
- **Simulated Ledger Encryption & Reversible Base64 (`RESOLVED in Phase 3`)**: Replaced with real authenticated AES-256-GCM, 12-byte random IVs, 16-byte tags, and 11-field canonical ledger hashing.
- **Hardcoded Secret Code `'2026'` & Simulated PBKDF2 (`RESOLVED in Phase 3`)**: Hardcoded seed removed; `scrypt` KDF implemented with per-user random salt; fresh install onboarding defaults to incomplete.
- **Unchecked Execution & Fallback Verifiers (`RESOLVED in Phase 1`)**: Replaced with typed `ToolRegistry`, explicit truth states, and independent state verifiers.
- **`mockbank.local` Fallback & SSRF Vulnerabilities (`RESOLVED in Phase 2`)**: Replaced with centralized default-deny `PolicyEngine`, strict URL validation, private IP blocking, and IDN homoglyph rejection.


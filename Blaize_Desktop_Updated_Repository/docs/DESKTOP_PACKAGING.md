# Blaize Desktop Packaging & Electron Security Architecture

## 1. Security Model (`electron/main.ts`, `electron/preload.ts`, `electron/ipc-contracts.ts`)

1. **Hardened `BrowserWindow` Defaults (`HARDENED_WEB_PREFERENCES`)**:
   - `sandbox: true`
   - `contextIsolation: true`
   - `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`
   - `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`
2. **Restrictive Content Security Policy (`RESTRICTIVE_CSP_HEADER`)**:
   - Enforced via `session.defaultSession.webRequest.onHeadersReceived`.
   - Restricts `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`.
3. **Navigation Allowlist & External Link Guard**:
   - `will-navigate` and `will-redirect` block any navigation outside `http://localhost:3000`, `http://127.0.0.1:3000`, `app://blaize`, or the packaged `dist/` directory.
   - `setWindowOpenHandler` denies spawning new `BrowserWindow` instances and only opens canonical `https://` URLs via `shell.openExternal` after passing `canonicalizeAndValidateUrl` (blocking `javascript:`, `file:`, `http:`, and private/loopback IPs).
4. **Default-Deny Permission Handler**:
   - `setPermissionRequestHandler` and `setPermissionCheckHandler` deny camera, microphone, geolocation, notifications, USB, HID, and serial permissions by default, allowing only `clipboard-sanitized-write` from authorized origins.
5. **Strict IPC Security Boundary (`IPC_CONTRACT_MANIFEST`)**:
   - All IPC channels are defined in `electron/ipc-contracts.ts` with runtime Zod request and response schemas (`validateIpcRequestPayload`, `validateIpcResponsePayload`).
   - `validateIpcSender` verifies that every IPC call originates from the non-destroyed primary `mainFrame` of an allowed origin (rejecting child iframes/subframes with `UNTRUSTED_IPC_SUBFRAME_REJECTED` and untrusted URLs with `UNTRUSTED_IPC_ORIGIN_REJECTED`).
   - Non-read IPC channels are routed through `globalPolicyEngine.evaluateToolCall` before handler execution.
   - `electron/preload.ts` exposes a deeply frozen (`Object.freeze`) `window.electronAPI` bridge with narrow methods and zero exposure of `ipcRenderer`, `fs`, `child_process`, `shell`, `process`, or `require`.
6. **Durable SQLite Persistence & Fail-Closed `safeStorage`**:
   - All `storage:*` and `vault:*` IPC handlers persist directly into `DurableSqliteDatabase` (`<userData>/blaize.sqlite` with WAL mode and SQLite FTS5). Zero volatile in-memory `Map` stores are used as the source of truth.
   - On Linux, if `safeStorage.getSelectedStorageBackend()` returns `'basic_text'`, Blaize fails closed and refuses to encrypt or store secrets in plaintext.
7. **Lifecycle, Local Redacted Crash Reports & Verified Update Staging**:
   - Single-instance lock (`acquireSingleInstanceLock`) prevents concurrent processes from corrupting SQLite WAL files.
   - App data directories (`logs/`, `crashes/`, `updates-staging/`) are created with `0o700` permissions.
   - Uncaught exceptions and renderer crashes are scrubbed of API keys/tokens via `redactSensitiveText` and written locally to `<userData>/crashes/<reportId>.json` (`0o600`).
   - Update bundles (`system:stage-update`) require both a matching SHA-256 digest and a valid Ed25519 cryptographic signature (`crypto.verify`) before staging in `<userData>/updates-staging/`.

---

## 2. Reproducible Packaging & Honest Host Matrix

| Target Script | Host Required | Produced Artifacts | CI / Container Status on Linux Runner |
| :--- | :--- | :--- | :--- |
| `npm run desktop:package:linux` | Linux (`linux-x64`) | `release/blaize-desktop-linux-x64/`, `release/blaize-desktop-linux-x64.tar.gz`, `artifact-manifest.json` | **EXECUTED & SMOKE-VERIFIED** |
| `npm run desktop:package:mac` | macOS (`darwin`) with Xcode CLI & `hdiutil` | `.dmg` / `.app` bundle | **UNSUPPORTED_HOST_OS** on Linux container (fails honestly with exit code `2` and prerequisite list) |
| `npm run desktop:package:win` | Windows (`win32`) with NSIS & Windows SDK | `.exe` NSIS installer | **UNSUPPORTED_HOST_OS** on Linux container (fails honestly with exit code `2` and prerequisite list) |

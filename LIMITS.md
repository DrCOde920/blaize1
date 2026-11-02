# Operational Limits & Hardware Disclosures (LIMITS.md)

This document honestly outlines the capabilities, constraints, and platform differences between the native OS Electron shell and this Linux container build environment.

---

### 1. Display Server & Window Manager
- **Current Environment:** Linux `4.19.0-gvisor` container without an X11 server, Wayland compositor, or virtual framebuffer (`Xvfb`).
- **Capability Status:**
  - Native GUI window launching via `electron .` requires an active `$DISPLAY` or Wayland compositor on the user's host desktop.
  - In this container, the full-stack server and React UI run on port 3000, and end-to-end user journeys are verified using Playwright's headless Chromium.
  - The Electron main process (`electron/main.ts`) and preload bridge (`electron/preload.ts`) are fully built, typed, and packaged.

### 2. Native OS Input Hooks (`NativeInputSource`)
- **Desktop Shell:** When running as a native Electron app with accessibility permissions (`AXIsProcessTrusted` on macOS, UIA on Windows, AT-SPI on Linux), global OS keyboard/mouse input can be observed.
- **Web Preview / Container:** Sandboxed by the browser security boundary. `InAppSource` captures events inside Blaize Browser and Desktop Stage; `ScreenCaptureSource` uses `getDisplayMedia` when granted by the operator. `NativeInputSource` is documented and flagged as `Desktop Shell Required`.

### 3. OS Safe Storage Backend (Linux)
- **Linux Native:** Electron's `safeStorage` depends on libsecret (`gnome-keyring` or `kwallet`). If neither is running, `safeStorage.getSelectedStorageBackend()` returns `basic_text` (unencrypted).
- **Enforcement:** Blaize explicitly detects `basic_text` and refuses to store raw secrets in plaintext, falling back to AES-256-GCM passphrase wrapping (`PassphraseWrapVault`) derived from the operator's secret code.

### 4. Background Scheduled Execution
- **Operational Requirement:** The machine must be powered on and Blaize must be running (or minimized to the system tray) for scheduled tasks to execute.
- **Power Suspension / Sleep:** Handled via Electron `powerMonitor.on('resume')` or browser `visibilitychange`. Missed runs are resolved according to user policy (`Run when I'm back`, `Skip`, or `Ask me`), and money/destructive actions are never executed unattended.

### 5. Third-Party Account Authentication
- **OAuth & API Keys:** Google Workspace, Microsoft 365, GitHub, Telegram, Slack, and Notion require user-supplied client IDs or tokens. No credentials are fabricated or simulated.

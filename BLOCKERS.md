# Blockers & Escalations Log (BLOCKERS.md)

This log tracks external blockers, environmental barriers, and escalations in accordance with the Blaize Autonomy Rules.

---

### Blocker 1: Headless gVisor Linux Container (No Native Display Server)
- **Status:** Documented / Handled via Autonomous Platform Bridge
- **Impacted Capability:** Direct GUI execution of Electron main process (`electron .` requires X11 `$DISPLAY` or Wayland compositor).
- **Environment Evidence:**
  - Kernel: `Linux 4.19.0-gvisor x86_64`
  - Display Server: No X11 socket, no Wayland, `which Xvfb` is absent.
- **Resolution / Autonomous Path:**
  - Build the full Electron architecture (`electron/main.ts`, `electron/preload.ts`, `electron/ipc-contracts.ts`).
  - Implement the dual-mode runtime platform bridge (`src/packages/platform/index.ts`).
  - Serve the full-stack desktop application on port 3000 via `server.ts` with Vite middlewares.
  - Execute automated end-to-end tests, verification, and browser inspection using Playwright headless Chromium.
  - Document operational limits in `LIMITS.md`.

---

### Blocker 2: Linux Libsecret Daemon in Sandbox
- **Status:** Documented / Fallback Enforced
- **Impacted Capability:** Hardware OS keyring via Electron `safeStorage`.
- **Environment Evidence:** Sandbox environment lacks a running `gnome-keyring-daemon` or `kwalletd5`.
- **Resolution / Autonomous Path:**
  - Adhere to the security policy: refuse unencrypted `basic_text` keyrings.
  - Fall back to the AES-256-GCM `PassphraseWrapVault` with PBKDF2-SHA256 (`210,000` iterations) derived from the user's secret code.

---

### Blocker 3: Third-Party Production OAuth Client Registrations
- **Status:** Pending User Configuration
- **Impacted Capability:** Production Google Workspace and Microsoft 365 OAuth logins.
- **Environment Evidence:** Google and Microsoft require tenant registration and registered redirect URIs for live production client secrets.
- **Resolution / Autonomous Path:**
  - Server-side OAuth PKCE flow (`/api/connectors/oauth/start`) is fully implemented with cryptographic verifier, S256 challenge, and secure state.
  - Connectors honestly show `Needs setup` until the operator provides valid client credentials.

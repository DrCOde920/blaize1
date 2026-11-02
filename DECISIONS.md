# Architectural & Operational Decisions (DECISIONS.md)

This log records autonomous architectural and technical decisions made during the construction of Blaize as a cross-platform Electron and accountable AI desktop application.

---

### Decision 1: Dual-Mode Platform Architecture (Native Electron + Web Preview Bridge)
- **Context:** Blaize is built as a real cross-platform Electron app in TypeScript while simultaneously running in the AI Studio cloud sandbox which exposes a web preview on port 3000.
- **Decision:** Implement a clean abstraction layer (`src/packages/platform/index.ts`). When running under Electron, the renderer calls `window.electronAPI` exposed securely via `contextBridge` in `electron/preload.ts`. When running in the browser / preview environment, the adapter routes through local proxy routes (`/api/*`) on the Express server.
- **Rationale:** Guarantees 100% feature functionality and deterministic testability in both the native Electron shell and the cloud preview container without mock fallbacks or broken UI.

### Decision 2: Privileged Main Process & SafeStorage with Linux Backend Check
- **Context:** Security requirement: SecretVault must store credentials safely and never expose raw secrets to the renderer or third-party plugins.
- **Decision:** In the Electron main process, `ElectronSafeStorageVault` checks `safeStorage.getSelectedStorageBackend()`. If on Linux and the backend is unencrypted `basic_text`, it refuses storage and alerts the user, falling back to AES-256-GCM passphrase wrapping (`PassphraseWrapVault`) derived via PBKDF2/scrypt from the operator's secret code.
- **Rationale:** Adheres to zero-trust principles and OS security realities documented in `docs/security.md`.

### Decision 3: Open VSX as the Sole Extension Registry
- **Context:** VS Code extension registry integration for Monaco / IDE.
- **Decision:** Exclusively query `https://open-vsx.org` and accept local `.vsix` files. Strictly prohibit Microsoft Visual Studio Marketplace URLs.
- **Rationale:** Microsoft's Visual Studio Marketplace Terms of Use legally restrict usage strictly to official Microsoft Visual Studio products. Open VSX is the vendor-neutral, open standard registry.

### Decision 4: Real Formatting & Linting (No Fake Claims)
- **Context:** Code editor built-in tools.
- **Decision:** Integrate real `prettier` standalone formatting and real syntax/bracket AST linting. Eliminate any claims of fake "real-time full ESLint" when not running with a native Node.js worker.
- **Rationale:** Honesty Rule: Never present simulated or fake functionality as real.

### Decision 5: Non-X11 Container Verification via Playwright
- **Context:** The build container runs on Linux gVisor without an X11 or Wayland display server (`which Xvfb` returns not found).
- **Decision:** The Electron main process, preload, and packaging scripts are fully authored and typechecked. End-to-end browser and UI verification is driven via Playwright's headless Chromium against the full-stack server on port 3000. Real memory measurements and performance metrics are polled via `process.memoryUsage()` and Node.js APIs.
- **Rationale:** Satisfies both the real Electron codebase requirement and the live container execution constraint.

# Blaize — The Accountable AI Desktop

Blaize is a dual-mode AI desktop and web workspace engineered around a default-deny **Trust Kernel**, **Durable SQLite + FTS5 Storage**, **Meta Responses API Multi-Turn Agent Loop**, and a **Hardened Electron Desktop Shell**.

---

## 1. Web Preview vs. Native Electron Desktop Commands

Blaize maintains a strict separation between the browser-based AI Studio Web Preview and the native Electron desktop application:

### Web Preview & Server Mode
| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Express + Vite full-stack server on `http://localhost:3000` |
| `npm run build` | Builds the production Vite SPA bundle into `dist/` |
| `npm start` | Runs the full-stack server (`tsx server.ts`) |

### Native Electron Desktop Mode
| Command | Description |
| :--- | :--- |
| `npm run desktop:dev` | Builds renderer + Electron bundles (`dist-electron/main.cjs`, `dist-electron/preload.cjs`) and launches Electron (or reports headless diagnostic if no display server is attached) |
| `npm run desktop:build` | Compiles `dist/` and `dist-electron/` and writes `dist-electron/build-manifest.json` with SHA-256 digests |
| `npm run desktop:package` | Packages the native desktop bundle for the current host OS into `release/` |
| `npm run desktop:package:linux` | Packages `release/blaize-desktop-linux-x64/` and `release/blaize-desktop-linux-x64.tar.gz` with SHA-256 `artifact-manifest.json` |
| `npm run desktop:package:mac` | Packages macOS bundle (requires `darwin` host with Xcode Command Line Tools / `hdiutil`; exits with `UNSUPPORTED_HOST_OS` on non-macOS hosts) |
| `npm run desktop:package:win` | Packages Windows bundle (requires `win32` host with NSIS / Windows SDK; exits with `UNSUPPORTED_HOST_OS` on non-Windows hosts) |

### Verification, Testing & Evaluation
| Command | Description |
| :--- | :--- |
| `npm run lint` | Full TypeScript typecheck (`tsc --noEmit`) across `src/`, `electron/`, `server.ts`, and `scripts/` |
| `npm test` | Runs all 19 unit & integration test suites via `node:test` |
| `npm run test:electron` | Runs the dedicated Electron desktop security, IPC contract, SQLite restart persistence, and clean-machine packaging smoke test suite |
| `npm run verify` | Runs the 9-gate verification pipeline (`scripts/verify.ts`) |

---

## 2. Platform-Specific Prerequisites

See [`docs/DESKTOP_PACKAGING.md`](./docs/DESKTOP_PACKAGING.md) for detailed OS packaging prerequisites and security guarantees:

- **Linux (`linux-x64` / `linux-arm64`)**:
  - Node.js `>= 22.5.0` (for built-in `node:sqlite` `DatabaseSync` with WAL + FTS5).
  - Secret encryption via Electron `safeStorage` requires an active secret service (`gnome-keyring` / `libsecret-1-0` or `kwallet6`). If Linux reports `basic_text`, Blaize **fails closed** and refuses plaintext secret storage.
  - GUI window creation, system tray, floating companion window, and global shortcuts require an active `DISPLAY` (X11) or `WAYLAND_DISPLAY` session.
- **macOS (`darwin-arm64` / `darwin-x64`)**:
  - macOS 13+ with Xcode Command Line Tools (`codesign`, `hdiutil`, `notarytool`).
  - Uses macOS Keychain for `safeStorage`.
- **Windows (`win32-x64`)**:
  - Windows 10/11 x64 with DPAPI for `safeStorage`, NSIS (`makensis`) for installer generation, and Windows SDK `signtool.exe` for Authenticode signing.

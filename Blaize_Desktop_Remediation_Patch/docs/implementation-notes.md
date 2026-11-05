# Implementation notes and boundaries

## Runtime model

The Electron main process is responsible for starting the same Express application that previously had to be launched separately. The server binds only to `127.0.0.1` on an OS-selected ephemeral port. The browser window is not shown until the local health route responds successfully.

The renderer uses the normal same-origin `/api/*` paths. Electron's `webRequest` hook adds `X-Blaize-Launch-Token` only when the destination origin equals the embedded backend origin. The navigation allowlist is extended only with that exact origin, not an arbitrary loopback port.

## Data locations

`BLAIZE_USER_DATA_DIR` is set from Electron's `app.getPath('userData')`. `BLAIZE_DIST_DIR` points to the packaged renderer bundle. `BLAIZE_APP_ROOT` points to the Electron app root so the dev Vite middleware can still locate `index.html`.

## Packaging

The former `package-desktop.ts` manual tarball utility remains available for its lifecycle test helpers; the user-facing `desktop:package:*` commands now invoke electron-builder. Electron-builder includes the app files and production dependency tree according to `electron-builder.yml` and `package.json`.

## Not solved by this patch

- The PC Operator view now uses the bridge for host status, window discovery, tray/floating-companion visibility and shortcut registration. It does not yet route every AI file/browser/skill mission through `window.electronAPI.pcOperator.executeAction`; that needs a dedicated permissioned action integration and real host tests.
- Full desktop screen capture, deep accessibility enumeration and native input control require real per-OS testing and user-granted permissions. The new panel can list the windows returned by the current host bridge, but that is not proof of complete cross-platform window automation.
- It does not add signing certificates, Apple notarization, Windows code signing, auto-updates or a release publishing flow.
- It does not prove Linux, Windows and macOS installers by itself. Those builds must run on their matching native runners.
- The Electron SQLite host store and server-side durable stores share the Electron user-data root, but a full audit is still needed to consolidate conversation, artifact, skill, settings, localStorage and IndexedDB persistence into one canonical data contract.

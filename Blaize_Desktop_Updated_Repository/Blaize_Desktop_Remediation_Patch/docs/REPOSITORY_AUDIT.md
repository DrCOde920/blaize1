# Blaize Desktop Repository Audit

**Repository:** `DrCOde920/blaize1`  
**Branch:** `main`  
**Reviewed commit:** `dc905d7559445098896d9c9b5445a829fd545fb6`  
**Review date:** 2026-11-05

## Confirmed baseline findings

1. `electron/main.ts` created a `BrowserWindow`, but the Electron application lifecycle did not start the Express backend. The window expected `http://localhost:3000` or a `file://` renderer URL, while the desktop build script only built assets and launched Electron.
2. `scripts/package-desktop.ts` built a custom directory/tarball whose launcher expected an external `electron` executable. It did not create a self-contained Electron runtime package.
3. `electron-builder.yml` existed, but `package.json` release commands were routed to the manual packager rather than the electron-builder CLI.
4. `UniversalPlatformBridge` and typed Electron IPC existed, but `PCOperatorView` did not use the bridge. Its initial scenario driver was hard-coded to macOS.
5. `SkillRecorderStudio` identified full desktop recording as a stub/unavailable preview source. Native screen capture and full workflow teaching remain host-dependent work.
6. Current main-branch CI failed at `bun install --frozen-lockfile`: `package.json` pinned Electron to `45.2.1`, while `bun.lock` recorded the range `^45.2.1`. Typecheck, tests, verify and build were skipped.

## Remediation source included in this bundle

- Build the server as `dist-electron/server.mjs` alongside the renderer, main and preload bundles.
- Start the server from Electron's main process, binding to `127.0.0.1` on an OS-assigned port. Wait for `/api/health` before showing the app window.
- Use the app's own loopback origin for the renderer and API. Navigation trust is limited to that exact active origin plus the existing known dev origins.
- Scope the launch-token header to requests for the exact embedded server origin. Set `BLAIZE_ELECTRON_MODE=1` so the server does not put the launch token into the Electron renderer's HTML/JavaScript; the Electron session attaches it from the main process instead.
- Use Electron `userData` for the local application data root and the packaged renderer directory for static assets.
- Close the embedded server during application shutdown and report startup failures rather than leaving an invisible background process.
- Add a native host panel in PC Operator that reads actual Electron capabilities and open windows, and can toggle the real tray/floating companion and register a global shortcut. It clearly distinguishes native host status from the PC Operator scenario preview.
- Select the PC Operator preview driver based on the real Electron host OS rather than hard-coding macOS.
- Route user-facing installer commands through electron-builder. Produce AppImage, Debian `.deb` and tar.gz on Linux; NSIS and ZIP on Windows; DMG and ZIP on macOS. The script refuses cross-OS packaging on the wrong host.
- Align the Electron dependency range with the existing Bun lockfile and add CI compilation of the Electron runtime bundle.

## Scope boundaries still requiring work

- The `PCOperatorView` action ladder remains a scenario-driver preview. This patch adds a live host status/control panel but does not yet route every AI file/browser/skill mission through `window.electronAPI.pcOperator.executeAction`.
- Full desktop screen capture and tutorial-to-skill extraction need a proper native capture pipeline and real OS permission handling.
- The Electron SQLite store and server-side durable storage must be unified or explicitly partitioned. This patch sets the same user-data root but does not merge every existing data store into one canonical database.
- Real native automation tests still need to run on Linux desktop, Windows and macOS sessions with their actual accessibility/automation permissions.
- Code signing, macOS notarization, Windows signing, auto-update distribution and release publishing are not configured by this patch.

## Verification evidence

The GitHub source was inspected through read-only repository access. The latest checked CI run for the reviewed commit (`41837751029`) failed during frozen Bun dependency installation due to the Electron range mismatch. No actual repository build or test was run during this task because a local repository archive could not be fetched into the execution environment and the GitHub connection did not grant push access.

The remediation installer was run against a synthetic fixture containing the exact source anchors inspected in `main`. It applied all edits and the post-apply source checks reported **13/13 PASS**. The new TSX component passed TypeScript transpile syntax validation. These are bundle/patch checks, not a substitute for running Blaize's actual test suite after applying to a local checkout.

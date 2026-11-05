# Blaize Desktop Remediation Bundle

This bundle targets `DrCOde920/blaize1` at the `main` snapshot inspected on 2026-11-05, commit:

`dc905d7559445098896d9c9b5445a829fd545fb6`

It is a **source remediation patch**, not a complete copy of the Blaize repository or a prebuilt installer. The connected GitHub integration is read-only and the execution environment could not clone/download the repository archive, so this package provides an exact-anchor installer that applies changes to the matching local checkout.

## What it changes

1. Builds `server.ts` into `dist-electron/server.mjs` alongside the Electron main and preload bundles.
2. Starts the existing Express backend from the Electron main process on an ephemeral `127.0.0.1` port.
3. Waits for `/api/health` before opening the desktop window.
4. Loads the UI from the app-owned loopback origin; the launch token is attached only to requests for that exact backend origin.
5. Uses the installed app's `dist/` and Electron `userData` locations for packaged rendering and local data.
6. Closes the embedded server during desktop shutdown.
7. Switches release scripts to the real `electron-builder` CLI, including AppImage and Debian `.deb` targets on Linux, NSIS on Windows, and DMG on macOS. Cross-OS packaging fails explicitly and must run on native runners.
8. Fixes the Electron dependency semver mismatch reported by the latest checked-in Bun CI run (`^45.2.1` in `bun.lock` vs `45.2.1` in `package.json`).
9. Adds CI verification of the remediation wiring and a build step for the Electron main/preload/backend bundles.
10. Adds a live native-host panel to PC Operator for real Electron host status, open-window discovery, tray/floating-Morrow controls and global shortcut registration. It distinguishes those operations from the existing scenario-driver preview.
11. Keeps the per-launch API token out of Electron renderer HTML; the Electron main process attaches it only to requests for the exact embedded backend origin.

## Apply to your checkout

Use a clean working tree and check out the inspected revision. The installer refuses to run against a dirty Git tree or a different HEAD:

```bash
git checkout main
git pull --ff-only
# confirm the expected revision before applying
git rev-parse HEAD
node /path/to/Blaize_Desktop_Remediation_Patch/apply-desktop-remediation.mjs .
```

The script makes backups under `.blaize-desktop-remediation-backup/`. It intentionally stops if any source anchor does not match; don't force it over a newer/different branch. Review the resulting diff before accepting it.

## Verify locally

```bash
bun install --frozen-lockfile
bun run desktop:verify-bundle
bun run lint
bun test
bun run verify
bun run desktop:build
```

Build a package on the corresponding native operating-system runner:

```bash
bun run desktop:package:linux   # Linux: AppImage, .deb, tar.gz
bun run desktop:package:win     # Windows: NSIS installer and ZIP
bun run desktop:package:mac     # macOS: DMG and ZIP
```

The packaging script intentionally refuses to generate a Windows or macOS installer on Linux. Use native Windows and macOS CI runners for those artifacts. Code signing/notarization credentials are separate release prerequisites.

## Verification status of this bundle

- Repository facts and the exact file anchors were checked against the connected GitHub `main` source at the commit above.
- The bundle installer and post-apply verifier passed a synthetic-fixture application test (13/13 source checks).
- The new TSX panel passed TypeScript transpile syntax validation.
- The actual repository changes have **not** been applied or compiled in this execution environment because the repository archive could not be downloaded and the GitHub connection has read-only permissions. The actual Blaize TypeScript test suite and OS installers have therefore **not** been verified. The Electron SQLite host store and server-side persistence are pointed at the same user-data root, but every UI persistence path still needs a follow-up audit to remove duplicate localStorage/IndexedDB sources. Run the commands above after applying the patch. See `docs/REPOSITORY_AUDIT.md` for the findings and remaining boundaries.

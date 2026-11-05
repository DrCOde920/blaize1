# Validation report

Date: 2026-11-05  
Source snapshot: `DrCOde920/blaize1@dc905d7559445098896d9c9b5445a829fd545fb6`

## Completed checks in this environment

| Check | Result | Notes |
|---|---|---|
| Patch installer JavaScript syntax | PASS | `node --check apply-desktop-remediation.mjs` |
| Post-apply verifier JavaScript syntax | PASS | `node --check scripts/verify-desktop-remediation.mjs` |
| New native host panel TSX syntax | PASS | TypeScript `transpileModule` parse/transpile check |
| Generated electron-builder script TS syntax | PASS | TypeScript `transpileModule` parse/transpile check against generated fixture output |
| Patch installer application | PASS | Applied to a synthetic fixture built from the exact inspected source anchors |
| Post-apply wiring checks | PASS | 14/14 checks in fixture |
| ZIP archive integrity | PASS | `unzip -t` passed after archive creation |

## Not run (important)

- `bun install --frozen-lockfile`
- `bun run lint`
- `bun test`
- `bun run verify`
- `bun run desktop:build` on the actual checkout
- electron-builder packaging on Linux, Windows or macOS
- live Electron launch, health-check, tray, floating companion or native automation tests

The repository archive could not be downloaded into this execution environment. The GitHub connection reported read-only repository permissions, so the source changes were not pushed. The latest checked main-branch CI run stopped at dependency installation because `package.json` specified Electron `45.2.1` while `bun.lock` specified `^45.2.1`; downstream checks were skipped.

**Interpretation:** the patch bundle and its installer logic were validated against a source-shaped fixture, but it is not accurate to say the actual Blaize repository or any desktop installer has passed its full test suite yet.

# Blaize desktop safety remediation — 5 November 2026

This note records the follow-up fixes for the three release blockers identified in the previous repository review.

## 1. Main-process-enforced action approval

- The renderer's `requiresConfirmation` flag is advisory only. Native action execution now requires a UUID token issued after a native Electron confirmation dialog.
- Each token is bound to the invoking `WebContents` sender ID, a SHA-256 digest of the exact action request, and a 60-second expiry.
- The main process consumes the token on every attempt, including mismatches. A token cannot be replayed or reused for a changed action.
- The main process independently re-reads the target window and accessibility element, checks protected applications and sensitive/high-impact controls, validates supported actions, and rejects coordinate-only actions and non-allowlisted keyboard shortcuts.
- Credential-like text is rejected before the confirmation dialog; the dialog previews only the secret-redacted text.

## 2. Privacy Shield for screen recordings

The recorder no longer hands the original display `MediaStream` to `MediaRecorder`. It creates a local canvas compositor and sends only the compositor's filtered `captureStream()` to the video encoder. JPEG keyframes are sampled from that same filtered canvas.

The local deterministic detector checks:

- protected application/window titles and process names (for example, password managers, finance/mobile-money, health, payroll, authentication and mail apps);
- all native accessibility elements with editable/text-entry capabilities;
- accessible labels and values associated with credentials, account/payment fields and personal identifiers (including detected identifiers in window titles); and
- accessible values matching common email, phone, payment-card, SSN, IBAN, API-key, bearer-token and JWT-like formats.

Protected windows are masked as a whole. Sensitive controls/values are blurred and darkened before encoding. The renderer escalates to a full-frame blur or opaque mask if native detection is unavailable/stale, a region cannot be mapped completely to the selected display, or canvas blur is unsupported. Browser preview always uses full-frame redaction because it has no trusted native accessibility feed. In Electron, background throttling is disabled for the capture renderer so its bounded 10fps compositor continues while the app is minimized; native accessibility scans refresh every 250ms. If the canvas context is lost, the recorder stops and releases both capture streams.

The detector runs locally; it does not send window titles, accessibility values or screenshots to a model or network service. It is heuristic and does not run OCR. It cannot guarantee detection of all information in arbitrary non-editable document text, custom-drawn UI, unsupported accessibility trees, or unrecognized formats. A full-frame mask is the fallback when evidence is uncertain. Keep highly confidential windows closed and review a short test recording before relying on the feature.

## 3. Recording retention lifecycle

- The startup pass recovers a stale `recorder_sessions/active` row exactly once, archives it under the session's own ID, and uses the last durable update as the end time when the process stopped unexpectedly.
- The recurring 15-minute worker only expires archived sessions. It never treats an in-progress `active` row as crashed.
- Expired `keep_24h` sessions have their keyframe/media metadata and associated blobs removed. Shared blobs are kept while any remaining record still references them.
- The normal end-of-recording path still archives the session when the user stops the recorder.

## 4. Desktop persistence

Electron desktop preferences, workspace snapshots, universal project artifacts, character packs, skills and recording/session/media data use the local SQLite store. Legacy preference and snapshot keys are imported during bootstrap. Remaining `localStorage`/IndexedDB paths are browser-preview fallbacks or one-time migration code; SQLite is the desktop source of truth. This storage layer is durable but the recorder blobs/general SQLite records are not encrypted at rest.

## 5. Verification

| Check | Result |
|---|---|
| Static desktop remediation verifier | 43/43 passed |
| TypeScript/TSX syntax parse | 139 files, zero parse diagnostics |
| Targeted runtime helper assertions | 25/25 passed |
| Desktop artifact persistence smoke test | Create + rename both persisted ordered SQLite snapshots |
| Linux AT-SPI helper Python compile | Passed |
| ZIP archive integrity | Verified after packaging |
| Full TypeScript typecheck | Not run successfully: dependencies are absent; global `tsc` stops at missing `vite/client` types |
| Full Bun test suite | Not run: Bun is not installed in this environment |
| Electron build and live OS capture/accessibility | Not run: requires installed dependencies and a graphical desktop session |

The static verifier checks source wiring, not full native runtime behavior. The privacy detector is deliberately conservative, but it is not an absolute guarantee against every sensitive pixel. Validate on each target OS before release.

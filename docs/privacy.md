# Blaize Privacy & Data Protection Policy

## Privacy & Security Principles

Blaize is designed around **User Ownership, Local-First Storage, and Accountable Transparency**.

### 1. Data Minimization & Local Persistence
- Desktop preferences, workspace snapshots, universal project artifacts, active character packs, recorded-skill metadata, recording-session metadata, keyframe blobs, and video segments are persisted **locally** in the app's SQLite database (`<userData>/blaize.sqlite`). The SQLite database and recorder blobs are durable but **are not encrypted at rest by this storage layer**.
- Vault secrets use the separate vault protection flow and Electron `safeStorage` where supported. Do not interpret this as encryption of every SQLite record or every recorder blob.
- Browser preview uses `localStorage` for small preferences and IndexedDB for recorder media; browser preview data is not encrypted at rest by Blaize.
- Blaize does **not** collect telemetry, track usage analytics, or exfiltrate local files to remote analytics servers.

### 2. Secret Redaction & Zero-Leak Memory
- Secrets (API keys, OAuth tokens, passphrase credentials) stored in the `PassphraseWrapVault` are scrubbed with `redactSecretsFromText()` before any text is rendered in logs, UI diagnostics, or model prompts.
- Plaintext secrets reside in process memory only when unlocked and are zero-filled (`Buffer.fill(0)`) upon reclamation or lock timeouts.

### 3. User-Consented Desktop Screen Recording
- Full display recording starts only after the user selects a screen in the operating system's display-capture picker. Recording is video-only; audio capture is disabled.
- The original display stream is drawn into a local canvas. The Electron renderer disables background throttling so the privacy compositor continues refreshing when Blaize is minimized or another application is in front; canvas compositing runs at a bounded 10fps and the native detector refreshes every 250ms. **Only the canvas output is given to `MediaRecorder` and the keyframe sampler**; the raw display stream is not encoded or persisted.
- The Privacy Shield obtains local foreground-window metadata and the native accessibility tree. It masks protected application windows (including password managers, finance, health, payroll, authentication and mail apps), every detected editable control, controls whose accessible names or values look like credentials or personal identifiers (including PII in window titles), and accessible values matching common email, phone, payment-card, SSN, IBAN, or API-key patterns. The blur is applied before video encoding and before JPEG keyframes are generated. If a detected region cannot be mapped to the selected display, the recorder escalates to a full-frame mask instead of keeping the frame clear.
- If the native scanner is missing, returns no usable accessibility evidence, reports invalid geometry, cannot map every detected region, or its state becomes stale, Blaize applies a full-frame blur; if the browser canvas cannot apply a blur filter, it uses an opaque full-frame mask. It does not fall back to storing an unfiltered display stream. Browser preview does not have native accessibility detection and therefore keeps the entire captured frame blurred.
- **Detection is heuristic, not a guarantee.** The current implementation does not run OCR or understand the semantic meaning of arbitrary pixels. It can miss sensitive text in a non-editable document, an unsupported application with a misleading accessibility tree, a custom-drawn control, or text that does not match the configured value patterns. A short blur-preview/test recording should be reviewed before use; close sensitive windows or pause/stop capture for especially confidential work.
- The user can review, discard, or apply the configured retention policy to the local media. `keep_24h` recordings are purged automatically after 24 hours from their recorded end time (or last durable update when recovering an interrupted session). Recovery runs only once during application startup; the recurring expiry worker never closes the live `active` recording. `delete_after_compile` removes stored video segments and keyframe blobs after compilation.

### 4. File Map ('My Places') Privacy Bounds
- Folder places marked as **`Never`** are strictly excluded from model prompts, indexing, or tool operations.
- Content indexing occurs only on folders explicitly marked as **`Allowed`** with `allowContentIndexing: true`.

### 5. External Model API Requests
- In `Live` mode, prompt content and tool schemas are proxied through the server-side `/api/model` endpoint to the configured provider (e.g. Meta Model API).
- No API keys or server secrets are included in client requests or browser bundles.
- Prompt injection vectors inside external web or file content are automatically wrapped in `<untrusted_data>` boundaries to insulate model reasoning.

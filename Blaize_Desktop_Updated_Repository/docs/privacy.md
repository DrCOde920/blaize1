# Blaize Privacy & Data Protection Policy

## Privacy & Security Principles

Blaize is designed around **User Ownership, Local-First Storage, and Accountable Transparency**.

### 1. Data Minimization & Local Persistence
- Desktop preferences, workspace snapshots, recorded-skill metadata, recording-session metadata, keyframe blobs, and video segments are persisted **locally** in the app's SQLite database (`<userData>/blaize.sqlite`). The SQLite database and recorder blobs are durable but **are not encrypted at rest by this storage layer**.
- Vault secrets use the separate vault protection flow and Electron `safeStorage` where supported. Do not interpret this as encryption of every SQLite record or every recorder blob.
- Browser preview uses `localStorage` for small preferences and IndexedDB for recorder media; browser preview data is not encrypted at rest by Blaize.
- Blaize does **not** collect telemetry, track usage analytics, or exfiltrate local files to remote analytics servers.

### 2. Secret Redaction & Zero-Leak Memory
- Secrets (API keys, OAuth tokens, passphrase credentials) stored in the `PassphraseWrapVault` are scrubbed with `redactSecretsFromText()` before any text is rendered in logs, UI diagnostics, or model prompts.
- Plaintext secrets reside in process memory only when unlocked and are zero-filled (`Buffer.fill(0)`) upon reclamation or lock timeouts.

### 3. User-Consented Desktop Screen Recording
- Full display recording is started only after the user selects a screen in the operating system's display-capture picker.
- Recording is video-only; audio capture is disabled. Video is stored as local WebM segments, alongside independently hashed keyframes.
- In-app credential detection can redact or pause known semantic events, but it cannot guarantee detection of every password, banking, or private-data field rendered by arbitrary native desktop applications. Close sensitive windows or pause/stop capture before viewing them.
- The user can review, discard, or apply the configured retention policy to the local media. `delete_after_compile` removes the stored video segments and keyframe blobs after compilation.

### 4. File Map ('My Places') Privacy Bounds
- Folder places marked as **`Never`** are strictly excluded from model prompts, indexing, or tool operations.
- Content indexing occurs only on folders explicitly marked as **`Allowed`** with `allowContentIndexing: true`.

### 5. External Model API Requests
- In `Live` mode, prompt content and tool schemas are proxied through the server-side `/api/model` endpoint to the configured provider (e.g. Meta Model API).
- No API keys or server secrets are included in client requests or browser bundles.
- Prompt injection vectors inside external web or file content are automatically wrapped in `<untrusted_data>` boundaries to insulate model reasoning.

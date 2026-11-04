# Blaize Privacy & Data Protection Policy

## Privacy & Security Principles

Blaize is designed around **User Ownership, Local-First Storage, and Accountable Transparency**.

### 1. Data Minimization & Local Persistence
- All application data, vault secrets, place file maps, and audit ledgers are persisted **locally** on your device in an encrypted SQLite database (`.blaize/durable.sqlite`).
- Blaize does **not** collect telemetry, track usage analytics, or exfiltrate local files to remote analytics servers.

### 2. Secret Redaction & Zero-Leak Memory
- Secrets (API keys, OAuth tokens, passphrase credentials) stored in the `PassphraseWrapVault` are scrubbed with `redactSecretsFromText()` before any text is rendered in logs, UI diagnostics, or model prompts.
- Plaintext secrets reside in process memory only when unlocked and are zero-filled (`Buffer.fill(0)`) upon reclamation or lock timeouts.

### 3. File Map ('My Places') Privacy Bounds
- Folder places marked as **`Never`** are strictly excluded from model prompts, indexing, or tool operations.
- Content indexing occurs only on folders explicitly marked as **`Allowed`** with `allowContentIndexing: true`.

### 4. External Model API Requests
- In `Live` mode, prompt content and tool schemas are proxied through the server-side `/api/model` endpoint to the configured provider (e.g. Meta Model API).
- No API keys or server secrets are included in client requests or browser bundles.
- Prompt injection vectors inside external web or file content are automatically wrapped in `<untrusted_data>` boundaries to insulate model reasoning.

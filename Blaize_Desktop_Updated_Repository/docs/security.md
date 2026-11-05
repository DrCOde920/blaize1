# Blaize Key Vault & Security Architecture (`docs/security.md`)

## 1. Core Principle: Renderer Never Reads Raw Keys
All model and connector API keys are managed through the `SecretVault` interface (`store`, `useForRequest`, `rotate`, `delete`, `listMasked`).
- **Zero Renderer Exposure:** The browser UI (renderer) can never read a stored secret. After saving, the UI only receives masked metadata (`••••1234`, key label, spend cap, rate limit, and lock status).
- **Host-Only Resolution:** Only the main process (in the native Electron shell) or the localhost Express server resolves a key inside `useForRequest` immediately prior to an upstream HTTPS call.
- **Capability-Scoped Handles for Plugins:** Plugins never receive raw API keys or environment variables. They receive an opaque handle (`cap_secret_<id>`) scoped to specific allowed domains and risk classes, resolved exclusively by the host.

## 2. Vault Implementations & OS Backend Truth
1. **`ElectronSafeStorageVault` (Native Desktop Target):**
   - Uses Electron's `safeStorage` async IPC bridge in the main process.
   - **Linux Backend Check:** Inspects `safeStorage.getSelectedStorageBackend()`. If the backend is `basic_text` (unencrypted plaintext store), Blaize **refuses to store secrets** unless the operator explicitly enables the unprotected fallback after reviewing a clear warning.
   - **macOS Requirement:** Requires a code-signed application bundle so Keychain ACLs bind secret access to the signed binary rather than any process asking for it.
2. **`PassphraseWrapVault` (Defense-in-Depth Layer):**
   - Wraps secrets with **AES-256-GCM** using a 256-bit key derived from the operator's secret code via `scrypt` (`N=16384, r=8, p=1`) + random 16-byte salt and 12-byte IV.
   - **Why This Matters:** Default OS stores (such as Windows DPAPI or unlocked user keychains) authenticate the OS user account, meaning any process running under the same user account can ask the OS to decrypt the blob. Wrapping with a passphrase-derived key requires the operator's secret code to unlock the vault in memory and automatically locks after idle timeout.
3. **`PreviewServerVault` & `BrowserWebCryptoFallbackVault` (AI Studio Web Preview):**
   - Keeps `MODEL_API_KEY` in the server environment or in an in-memory AES-256-GCM wrapped store on the Express server.
   - A browser `WebCrypto` vault is available only when explicitly selected as a clearly labeled lower-security preview fallback.

## 3. Honest Threat Model: What Encryption Does & Does Not Protect
| Threat | Protected? | Honest Explanation |
| :--- | :--- | :--- |
| **Accidental leak in client bundle, `localStorage`, URLs, or logs** | **Yes** | Build-time bundle scanner + runtime log/output redactor strips `sk-*`, `meta-*`, `Bearer`, and known key suffixes. |
| **Disk theft / cold boot while vault is locked** | **Yes** | Keys are encrypted at rest with OS safe storage + AES-256-GCM passphrase wrapping. |
| **Background user-space app reading disk files while vault is locked** | **Yes** | Without the operator's secret code (passphrase), `PassphraseWrapVault` ciphertext cannot be decrypted by DPAPI alone. |
| **Malware running as the same OS user while the vault is unlocked** | **No** | Malware running with your user privileges can inspect process memory, capture keystrokes when you enter your secret code, or issue requests through the unlocked local proxy. Encryption is not a substitute for OS endpoint hygiene. |
| **Untrusted third-party plugin attempting key exfiltration** | **Yes** | Plugins run without raw keys and can only invoke capability-scoped host handles subject to PolicyGuard domain allowlists and spend caps. |

## 4. Proxy Hardening & Log Redaction
- **Localhost Binding & Per-Launch Token:** The Express proxy validates a per-launch session token (`X-Blaize-Launch-Token`), enforces strict same-origin CORS, caps payloads at `64 KB`, and enforces per-key rate limits and spend ceilings.
- **Universal Redaction:** Every log entry, tool output, error message, ledger payload, and model transcript passes through `redactSecretsFromText()` before storage or display.

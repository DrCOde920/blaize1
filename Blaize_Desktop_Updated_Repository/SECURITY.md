# Security Policy (`SECURITY.md`)

Blaize is committed to honest, accountable security. We treat security vulnerabilities as critical defects and follow a coordinated disclosure process.

---

## 1. Supported Versions

Only the current remediation and release line receives active security updates and vulnerability patches:

| Version / Branch | Supported | Notes |
| :--- | :---: | :--- |
| `remediation/*` | Yes | Active engineering remediation branches |
| `release/blaize-desktop-*` | Yes | Production desktop release packages |
| `< 0.9.0` (Pre-remediation baseline) | No | Deprecated; contains cataloged baseline findings F-01 through F-19 |

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability, please disclose it responsibly:

1. **Do not file public GitHub issues or forum posts** for security-sensitive bugs.
2. Email your report directly to the security maintainers with the subject `[SECURITY] Blaize Vulnerability Report`.
3. Include:
   - Clear description of the vulnerability and attack vector.
   - Proof of concept (PoC) code or exact steps to reproduce.
   - Potential impact on confidentiality, integrity, or system execution.
   - Affected platforms (`linux-x64`, `win32-x64`, `darwin-arm64`, Web Preview).
4. **Response Timeline**:
   - Initial acknowledgement: within 24 hours.
   - Severity triage and CVE assessment: within 72 hours.
   - Fix implementation and verification: prioritized according to risk class (`critical_system_change`, `credential`, `spend`, `destructive`).

---

## 3. Core Security Principles & Boundaries

### 3.1 Strict Tri-State and Truth Categorization
Blaize never masks missing functionality behind fake successes. Every operation, evaluation, and benchmark is explicitly tagged:
- `REAL` / `EXECUTED`: Genuine OS, cryptographic, or network side effects verified by independent checks.
- `SIMULATED`: In-memory models or non-empirical harnesses; never counted as live execution or benchmark proof.
- `UNSUPPORTED`: Native capabilities absent in the host environment (e.g., macOS/Windows drivers on Linux containers).
- `NOT_CONFIGURED`: Missing credentials, unconfigured keys, or unlinked OAuth providers.
- `BLOCKED` / `WAITING_FOR_APPROVAL`: Stopped at the PolicyEngine security boundary.

### 3.2 Renderer Never Reads Raw Keys
- Model and connector API keys are managed exclusively in `SecretVault` (`ElectronSafeStorageVault` on desktop or `PassphraseWrapVault`).
- The browser UI / renderer receives only masked metadata (`••••1234`, lock status, spend caps).
- Localhost Express proxy validates per-launch tokens (`X-Blaize-Launch-Token`), enforces same-origin CORS, caps payloads at 64 KB, and enforces rate limits.
- Universal secret redaction is applied to all logs, tool outputs, transcripts, and error messages before persistence or display.

### 3.3 Default-Deny PolicyEngine & Protected Control Plane
- Every side effect passes through `globalPolicyEngine.evaluateToolCall()`.
- Unidentified callers fail closed (`DEFAULT_DENY_FAIL_CLOSED`).
- Protected control plane objects (safety-floor rules, PolicyEngine configuration, approval tokens, vault secrets, trust kernel assets, soul safety boundaries, audit ledger chain, IPC contracts) are immutable to models, agents, plugins, and skills (`PROTECTED_CONTROL_PLANE_IMMUTABLE`).

### 3.4 Out-of-Process Plugin Sandbox
- Dynamic plugins run in an isolated child worker with OS-level restrictions:
  - Linux `prlimit` CPU and process count limits (`--nproc=32`, `--nofile=128`).
  - Node 22 Permission Model (`--permission`).
  - V8 heap cap (`--max-old-space-size=64`).
  - Null-prototype `vm` execution context with strings/Wasm code generation disabled.
- Plugins receive zero permissions by default. Effective grants are strictly the intersection of requested capabilities and the user-authorized host capability ceiling (`requested ∩ HostCapabilityCeiling`).

### 3.5 Honest Desktop Code Signing & Packaging
- Release packages report true signing status (`signingStatus: 'UNSIGNED' | 'SIGNED'`).
- Linux builds clamp `SOURCE_DATE_EPOCH` for reproducible archives.
- Clean-machine install, upgrade (preserving user SQLite database), rollback, and uninstall lifecycles are validated via `npm run desktop:lifecycle`.

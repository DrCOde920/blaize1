# Blaize Architecture & Security Documentation

## Subsystem Architecture Overview

```
+-------------------------------------------------------------------------+
|                              REACT FRONTEND                             |
|               (UI, KeyVaultPanel, PluginsHub, DoctorView)              |
+------------------------------------+------------------------------------+
                                     |  X-Blaize-Launch-Token + Same-Origin
                                     v
+-------------------------------------------------------------------------+
|                             EXPRESS SERVER                              |
|                                                                         |
|  +----------------+  +-----------------+  +--------------------------+  |
|  |  CORS & Auth   |  | Lockout Limiter |  | Hardened SSRF & DNS      |  |
|  | Exact Allowlist|  | Constant Padding|  | IP Pinning & 3 Hops      |  |
|  +-------+--------+  +--------+--------+  +------------+-------------+  |
|          |                    |                        |                |
|          v                    v                        v                |
|  +---------------+    +---------------+    +------------------------+   |
|  | /api/vault    |    | /api/plugins  |    | /api/connectors/proxy  |   |
|  | Encrypted     |    | Single-Use    |    | Per-Connector          |   |
|  | AES-256-GCM   |    | Approval Nonce|    | Host Allowlist         |   |
|  +---------------+    +---------------+    +------------------------+   |
|          |                    |                        |                |
|          v                    v                        v                |
|  +---------------+    +---------------+    +------------------------+   |
|  | /api/model    |    | /api/browser  |    | /api/system            |   |
|  | ProviderRouter|    | ReaderEngine  |    | Metrics & Doctor Checks|   |
|  +---------------+    +---------------+    +------------------------+   |
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                             TRUST KERNEL                                |
|  - PolicyEngine (Zod Proposal Validation & Risk Classification)          |
|  - MemoryLedger (SHA-256 Forward Hash-Chained Audit Chain)               |
|  - ScopedWorkspaceManager (Path Canonicalization & Traversal Defense)   |
|  - DurableSqliteDatabase (Node.js Native DatabaseSync & FTS5 Search)    |
+-------------------------------------------------------------------------+
```

## Security & Access Control Boundaries

1. **Launch Token Middleware**: Every `/api/*` endpoint (except the unauthenticated `/api/health` check) validates `X-Blaize-Launch-Token`. The token is cryptographically generated on server launch and injected directly into same-origin HTML page loads.
2. **Exact-Origin Allowlist**: Rejects requests missing an origin header or referencing wildcard domain patterns (`.run.app`). Validated against configured production origins or explicit localhost ports.
3. **SSRF Defense & IP Pinning**: DNS resolution occurs strictly server-side. IPv4/IPv6 loopback, link-local, multicast, cloud metadata (`169.254.169.254`), and numeric encoded representations (decimal, hex, octal, IPv4-mapped IPv6) are blocked before request dispatch. The resolved IP is pinned during TLS/HTTP execution to eliminate DNS rebinding attacks.
4. **Plugin Installation Nonces**: `/api/plugins/install` consumes server-issued, cryptographically random single-use nonces generated during `/api/plugins/prepare-install`. Client-supplied confirmation flags without a nonce are rejected.
5. **Vault Storage & Attempt Limiting**: API keys and OAuth tokens are stored exclusively in the server vault (`PassphraseWrapVault`) with AES-256-GCM encryption. Unlock attempts are rate-limited with exponential backoff and execution timing is normalized to prevent timing side channels.

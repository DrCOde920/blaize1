# Blaize

## Desktop Personal Assistant Made For and By Muse

[![CI/CD Security & Verification Pipeline](https://github.com/blaize-ai/blaize-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/blaize-ai/blaize-desktop/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Desktop OS](https://img.shields.io/badge/Desktop-Linux%20%7C%20macOS%20%7C%20Windows-sky)](docs/architecture.md)

**Blaize** is a local-first, accountable desktop personal assistant made for and by **Muse**. Built around **Morrow**—an expressive desktop companion—and powered by the **Muse** model family (`muse-spark-1.3`, `muse-wonder-1.0`, and `sam-3.1`), Blaize combines natural-language task execution, computer use, personal finance reconciliation, and self-extension inside a deterministic security boundary.

---

## Key Capabilities

- **Muse Model Router (`ProviderRouter`)**: Explicit routing across Muse API models (`muse-spark-1.3`, `muse-wonder-1.0`, `sam-3.1`), local deterministic runtime, and self-hosted endpoints with strict no-silent-switching guarantees and per-mission/daily spend budgets.
- **Morrow Desktop Companion & Figure Studio**: Interactive desktop companion that perches across workspace surfaces, backed by `CharacterFactory` (parametric character generation, 9 pose slots, 7 facial expressions, PNG/WebP alpha verification, and zero-click pose switching) and allowlisted Soul presentation self-management.
- **Deterministic Trust Kernel & `PolicyEngine`**: Default-deny authorization boundary governing all tool calls, connector requests, OAuth flows, browser navigation, file writes, scheduled jobs, skills, plugins, and native OS actions.
- **Cryptographic Memory Ledger**: Forward-chained 64-hex SHA-256 tamper-evident audit log with authenticated AES-256-GCM payload encryption, deduplicated content slots, right-to-delete zeroing, and reversible memory purge archives.
- **Owner-Authenticated Secret Vault**: PBKDF2-SHA256 (`210,000` iterations) and `scrypt` key derivation with AES-256-GCM envelope encryption, canary verification, idle auto-lock, and constant-time lockout protection.
- **AI Browser, Teach & Replay, and Consented Skill Recorder**: Partition-isolated browser profiles (`personal`, `work`, `testing`), credential shield auto-pause, consented desktop action recording, and version-pinned skill replay with precondition/postcondition verifiers.
- **Self-Extension & Restricted Plugin Sandbox**: Strict `CapabilityPlane` vs. `ProtectedControlPlane` separation. Plugins undergo Zod manifest review, SHA-256 content hashing, single-use owner approval nonces, and execution inside an out-of-process worker restricted by OS resource limits (`prlimit` and Node Permission Model).
- **L3xi Personal Finance Assistant**: Integer-cent statement reconciliation, opening/closing balance proofs, subscription detection, and Safe-to-Spend calculations.
- **My Places & Scoped Workspace**: Canonical `realpathSync` path resolution, symlink/traversal defenses, workspace checkpoints with one-click rollback, and code-enforced never-go zones.

---

## Architecture Overview

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                        Blaize Desktop & Web Shell                         │
│   Chat  │  Library (Skills/Plugins/Soul/Rules)  │  Workbench  │  Proof    │
└────────────────────────────────────┬──────────────────────────────────────┘
                                     │ Per-Launch Auth + 25 Zod IPC Channels
┌────────────────────────────────────▼──────────────────────────────────────┐
│                   Trust Kernel & Mandatory PolicyEngine                   │
│  Risk Classification │ Scoped Approval Tokens │ HostCapabilityCeiling     │
├──────────────────┬─────────────────┼──────────────────┬───────────────────┤
│   Muse Router    │  Secret Vault   │  Memory Ledger   │  Plugin Sandbox   │
│  muse-spark-1.3  │  AES-256-GCM    │  SHA-256 Chain   │  Isolated Worker  │
│  muse-wonder-1.0 │  PBKDF2 210k    │  AES-256-GCM     │  JSON-RPC Bridge  │
│  sam-3.1         │  Canary Auth    │  Right-to-Delete │  Single-Use Nonce │
└──────────────────┴─────────────────┴──────────────────┴───────────────────┘
```

---

## Quick Start

### Prerequisites

- **Node.js** `>= 22.0.0` (includes built-in `node:sqlite` for durable WAL + FTS5 storage)
- **Bun** `>= 1.1` or **npm** `>= 10.0`

### Installation & Local Development

```bash
# 1. Install dependencies
bun install --frozen-lockfile
# or: npm install

# 2. Configure environment variables
cp .env.example .env

# 3. Start the local desktop server (binds to 127.0.0.1:3000 by default)
npm run dev
```

Open `http://localhost:3000` in your browser, or launch the native Electron desktop shell:

```bash
# Build and launch the Electron desktop app
npm run desktop:dev
```

---

## Environment Configuration

Configure `.env` from `.env.example`:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `MODEL_API_KEY` | API key for Muse model inference (`muse-spark-1.3`, `muse-wonder-1.0`, `sam-3.1`) | *(Stored in Vault or `.env`)* |
| `META_API_BASE_URL` | Base URL for the Muse responses & multimodal endpoint | `https://api.meta.ai/v1` |
| `SPARK_OPEN_ENDPOINT` | Optional self-hosted open-weights inference endpoint | `""` |
| `BLAIZE_SERVER_HOST` | Bind address for the desktop HTTP server | `127.0.0.1` |
| `PORT` | Port for the local server | `3000` |

---

## Testing, Verification & Desktop Packaging

Blaize ships with a 9-Gate verification pipeline that validates compilation, unit/integration suites, secret scanning, SPDX license compliance, Electron IPC contracts, metric honesty, empirical benchmarks, process memory, and accessibility landmarks.

```bash
# TypeScript typecheck
npm run lint

# Run all 34 unit & integration test suites (403 tests)
npm test

# Run the complete 9-Gate Verification Pipeline
npm run verify

# Run the Desktop Evaluation & Benchmark Suite
npm run eval

# Build and verify the native desktop package lifecycle (install, upgrade, rollback, uninstall)
npm run desktop:build
npm run desktop:lifecycle
```

---

## Implementation Status & Platform Boundaries

| Subsystem | Status | Notes |
| :--- | :---: | :--- |
| **Trust Kernel & `PolicyEngine`** | **REAL** | Enforced across all side-effect routes, tools, connectors, browser reads, and plugin installs. |
| **Memory Ledger & Vault Cryptography** | **REAL** | Full 64-hex SHA-256 hash chain, AES-256-GCM payload encryption, and owner-verified PBKDF2/scrypt vault. |
| **Hardened OAuth 2.0 PKCE & SSRF Proxy** | **REAL** | S256 PKCE, single-use state, strict CSP, pinned `postMessage` origin, DNS resolution & IP pinning. |
| **Out-of-Process Plugin Runtime** | **REAL** | Manifest review, single-use approval nonce, worker sandbox testing, and SQLite code persistence. |
| **Muse Model Router & Mission Loop** | **REAL** | Iterative multi-turn tool loop with `<untrusted_data>` wrapping and strict token/USD budget caps. |
| **Linux Desktop Driver (`linux`)** | **REAL** | Probes `/proc`, AT-SPI2, XDG Desktop Portal, and executes native local host tasks. |
| **Windows (`win32`) & macOS (`darwin`) Drivers** | **ADAPTER / HOST-DEPENDENT** | Verified via socket test harnesses in headless containers; reports `UNSUPPORTED` when invoked outside target OS or without display permissions. |

---

## License

Distributed under the **Apache License 2.0**. See [`LICENSE`](LICENSE) and [`ASSET_LICENSE.md`](ASSET_LICENSE.md) for full license terms.

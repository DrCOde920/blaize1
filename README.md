# Blaize — The Accountable AI Desktop

[![CI/CD Security & Verification Pipeline](https://github.com/blaize-ai/blaize-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/blaize-ai/blaize-desktop/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Desktop OS](https://img.shields.io/badge/Desktop-Linux%20%7C%20macOS%20%7C%20Windows-sky)](docs/architecture.md)

**Blaize** is a memory-efficient accountable AI desktop environment featuring a deterministic **Trust Kernel**, hash-chained **Memory Ledger**, **Blaize Browser with Teach & Replay**, **L3xi money assistant**, **Meta Muse model router**, and **Morrow companion**.

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20.0.0
- npm >= 10.0.0

### Local Development
```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Start full-stack server (Express API + Vite Frontend on port 3000)
npm run dev
```
Navigate to `http://localhost:3000` in your browser.

### Verification & Testing
```bash
# Run unit & integration test suites (33 test files)
npm test

# Run 9-Gate Honest Verification Pipeline
npm run verify

# Run desktop PC benchmarks & evaluation suite
npm run eval
```

---

## 📊 Implementation Truth Matrix (Real, Stub, Simulated)

| Feature / Subsystem | Implementation Tier | Details & Provenance |
| :--- | :--- | :--- |
| **Trust Kernel & PolicyEngine** | **[REAL]** | Deterministic Zod proposal validation, risk classification, approval token verification, and constant-time secrets protection. |
| **Memory Ledger Audit Chain** | **[REAL]** | Forward SHA-256 hash-chained immutable event ledger with zero-leak right-to-delete memory reclamation. |
| **API Access Control** | **[REAL]** | Per-launch token (`X-Blaize-Launch-Token`), exact-origin CORS allowlist, server-side rate limits, and timing-attack padded secret code lockout. |
| **Hardened SSRF Proxy** | **[REAL]** | Server-side DNS resolution, blocking loopback/private/metadata/decimal/hex/octal/IPv6-mapped IPs, IP pinning, manual 3-hop redirect re-validation. |
| **Plugin Runtime & Nonce Install** | **[REAL]** | Zod manifest validation, static code analysis, permission diff, server-issued single-use approval nonces, and durable SQLite storage. |
| **Model Router & Meta API** | **[REAL]** | Real inference proxy to Meta Model API (`muse-spark-1.3`, `muse-wonder-1.0`, `sam-3.1`), explicit ProviderRouter with no silent cloud switching. |
| **L3xi Finance & Statement Reconciler** | **[REAL]** | Integer-cent financial arithmetic, CSV statement parser, opening/closing balance proof, and spend cap enforcement. |
| **Places File Map ('My Places')** | **[REAL]** | Zod `PlaceRule` schema, path canonicalization (traversal/UNC/8.3 shortname defense), `PlacesGuard` code-enforced never-go zones. |
| **CharacterFactory & Figure Library** | **[REAL]** | Parametric character generator, 9 pose slots, 7 facial expressions, alpha channel PNG/WebP inspector, and zero-click persistent pose switching. |
| **Blaize Remote Node Pairing** | **[STUB]** | Documented stub for remote PC pairing code exchange and E2EE session negotiation. |
| **OSWorld-Verified Public Benchmarks** | **[SIMULATED]** | Harness for external 64-task evaluation suite clearly labeled as non-empirical simulation without remote runner hardware. |

---

## ⚠️ Known Limitations

1. **Host OS Hardware Drivers**: Native Linux host driver interacts directly with `/proc` and local filesystem. Windows and macOS OS drivers run against simulated socket harnesses in non-native environments.
2. **Third-Party OAuth Keys**: Live Google and Microsoft OAuth integrations require user-supplied Client ID credentials stored in the encrypted server vault.

---

## 📄 License

Distributed under the **Apache 2.0 License**. See [`LICENSE`](LICENSE) and [`ASSET_LICENSE.md`](ASSET_LICENSE.md) for details.

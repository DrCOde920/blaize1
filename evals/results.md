# Blaize PC Operator — Measured Benchmark & KPI Report

- **Run ID**: `pcbench_mw1k8xgw`
- **Executed At**: `2026-11-04T03:31:59.984Z`
- **Commit SHA**: `657984d4d182`
- **Host OS / Runtime**: `linux-4.19.0-gvisor-x64`
- **Target Driver Profile**: `macos`
- **Metric Honesty Policy**: Benchmark results are strictly separated into `NATIVE LOCAL BENCHMARK`, `SIMULATED BENCHMARK`, and `PUBLIC BENCHMARK`. Synthetic/simulated tier numbers are never compared as empirical native performance.

---

## Category 1: NATIVE LOCAL BENCHMARK (Real Host Execution)

- **Category Label**: `NATIVE LOCAL BENCHMARK`
- **Execution Truth State**: `EXECUTED` (`isSimulated: false`)
- **Host OS Version**: `linux-4.19.0-gvisor-x64`
- **Total Native Host Tasks Executed**: **8**
- **Passed / Failed**: **8 PASS** / **0 FAIL** (100%)
- **False Successes**: **0**
- **Measured Wall-Clock Latency**: **13.98 ms** total (avg **1.75 ms/task**)
- **Cost Source**: `NONE` (local deterministic execution — $0.0000)

| Task ID | Category | Native Host Task | State | Verifier | Measured Latency | Retries | Cost Source |
| :--- | :--- | :--- | :--- | :--- | ---: | ---: | :--- |
| `native_01_fs_sort_by_ext` | `files` | Sort real files by extension into folders and verify SHA-256 manifest on host | `EXECUTED` / `VERIFIED` | `file_hash` | 1.71 ms | 0 | `NONE` |
| `native_02_batch_iso_rename` | `files` | Batch rename invoice files to ISO YYYY-MM-DD prefix and verify index hash | `EXECUTED` / `VERIFIED` | `file_hash` | 1 ms | 0 | `NONE` |
| `native_03_utf16_to_utf8_lf` | `files` | Convert UTF-16LE CRLF legacy log file to UTF-8 with normalized LF line endings | `EXECUTED` / `VERIFIED` | `file_hash` | 1 ms | 0 | `NONE` |
| `native_04_dedup_reversible_trash` | `files` | Detect duplicate files by SHA-256 and move extras to reversible .blaize-trash with restore verification | `EXECUTED` / `VERIFIED` | `file_hash` | 1.55 ms | 0 | `NONE` |
| `native_05_csv_sum_verification` | `documents` | Parse Q4 CSV ledger, compute department totals, and verify exact SHA-256 output | `EXECUTED` / `VERIFIED` | `file_hash` | 1.04 ms | 0 | `NONE` |
| `native_06_policy_gate_enforcement` | `settings` | Enforce PolicyEngine & AutonomyEnvelope block/approval on out-of-scope destructive path | `EXECUTED` / `VERIFIED` | `file_hash` | 1.07 ms | 0 | `NONE` |
| `native_07_linux_host_probe` | `settings` | Probe real host OS environment and enumerate live processes with truthful state | `EXECUTED` / `VERIFIED` | `file_hash` | 5.61 ms | 0 | `NONE` |
| `native_08_audit_hash_chain` | `multi_app` | Append 5 workflow audit events to SHA-256 hash chain and verify 100% chain integrity | `EXECUTED` / `VERIFIED` | `file_hash` | 1 ms | 0 | `NONE` |

---

## Category 2: SIMULATED BENCHMARK (64-Task Deterministic Verifier Harness — Non-Empirical)

> **Disclosure**: This section reports the **`SIMULATED BENCHMARK`** suite (`executionState: SIMULATED`, `canPromoteToRealEvidence: false`, `costSource: ESTIMATED`). Every task executes through `verifyDesktopStepOutcome()` against simulated perception trees and deterministic SHA-256 fixtures to test action-ladder routing, policy gates, and verifier contracts. Latency and token figures below are modeled tier estimates and **must not** be cited as empirical native desktop performance.

- **Total Everyday Tasks Verified (Simulated Harness)**: **64** (Files: 12, Browser: 11, Documents: 11, Email: 10, Settings: 10, Multi-App: 10)

### 2.1 Action Ladder-On (T1->T4) vs Vision-Only (T4) Comparison (SIMULATED BENCHMARK)

| KPI Metric (Simulated Harness) | Ladder-On (T1->T4 Remembered) | Vision-Only (T4 Pixel Baseline) | Delta |
| :--- | ---: | ---: | ---: |
| **Verifier Pass Rate** | **100%** (64/64) | 85.9% (55/64) | +14.1% |
| **Avg Steps / Task (Modeled)** | **2.31** | 6.94 | -4.63 steps |
| **Modeled Tier Latency / Task** | **119 ms** (synthetic) | 2914 ms (synthetic) | -2795 ms |
| **Estimated Tokens (64 Tasks)** | **17,090** (`ESTIMATED`) | 301,920 (`ESTIMATED`) | -94.3% |
| **Estimated Cost (USD)** | **$0.0342** (`ESTIMATED`) | $0.6038 (`ESTIMATED`) | -$0.5696 |
| **Human Interventions / 100 Tasks** | **6.3** (Strictly Credentials & Irreversible) | 14.1 | Controlled |
| **False Successes (Goal: 0)** | **0** | 0 | Verified 0 |
| **Simulated Fault Recovery Rate** | **100%** | 50% | +50.0% |

### 2.2 Speed & Cost Token Ledger (SIMULATED BENCHMARK — Cost Source: ESTIMATED)

- **Fast Grounding Model**: `muse-spark-1.3 (Fast Grounding & Digests)`
- **Strong Planning & Recovery Model**: `muse-wonder-1.0 (Planning & Escalated Recovery)`
- **Accessibility Digest Before Screenshot Hit Rate**: 90.6%
- **Cropped ROI Token Savings**: 65%
- **Prompt Cache Hit Rate**: 88.4%
- **Batched Low-Risk Actions Saved Round-Trips**: 42

### 2.3 Executed Run Tracking

| Release / Commit | Date | Category | Tasks | Ladder-On Pass | Vision-Only Pass | Est. Tokens / Task | False Successes | Recovery Rate |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `v0.0.0-phase12 (657984d4d182)` | 2026-11-04 | `SIMULATED BENCHMARK` | 64 | 100% | 85.9% | 267 | 0 | 100% |

---

## Category 3: PUBLIC BENCHMARK (OSWorld-Verified)

- **Category Label**: `PUBLIC BENCHMARK`
- **Execution Truth State**: `UNSUPPORTED`
- **Ready in Current Container**: `false`
- **Executed Public Tasks**: **0**
- **Setup Verification**: PUBLIC BENCHMARK status: UNSUPPORTED (/dev/kvm=false, OSWorld 40GB VM snapshots=false). Public OSWorld-Verified runs are strictly marked unavailable until actually executed on a KVM host.
- **Terms of Comparison Check**: Only compares against published academic OSWorld-Verified baselines under open MIT/Apache-2.0 benchmark terms; never compares synthetic fixture latency/cost as empirical public benchmark results.

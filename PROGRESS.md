# Milestone Progress Log (PROGRESS.md)

This log tracks the implementation status of all milestones for the Blaize cross-platform desktop application.

---

## Milestone Tracker

| Milestone | Scope | Status | Verification Gate |
| :--- | :--- | :--- | :--- |
| **M0** | Repo & Verification Pipeline (`scripts/verify.ts`, 9 gates) | **IN PROGRESS** | `npm run verify` passing 9/9 gates |
| **M1** | Desktop Shell & Design System (Window controls, theme, layout) | **COMPLETED** | Verified via Playwright headless |
| **M2** | Trust Kernel (PolicyGuard, immutable ledger, secrets redaction) | **COMPLETED** | `src/packages/trust` unit tests passing |
| **M3** | Model Router, Runtime & Unified Memory | **COMPLETED** | `UnifiedMemoryStore` & runtime tests passing |
| **M4** | AI Browser (ReaderEngine, remote, desktop stub, SSRF, injection scan) | **COMPLETED** | `src/packages/browser_ide` unit tests passing |
| **M5** | Code Editor (Monaco, Open VSX, Prettier, syntax linter, diffs) | **COMPLETED** | `src/packages/browser_ide` unit tests passing |
| **M6** | Projects & Artifacts (Storage, viewers, FTS5 search, blob hashes) | **COMPLETED** | `src/packages/projects_evals` tests passing |
| **M7** | Connectors SDK (18 connectors, honest status, SSRF defense, OAuth) | **COMPLETED** | `src/packages/connectors_scheduler` tests passing |
| **M8** | Everyday Scheduler (Device clock, sleep/wake re-eval, no money tasks) | **COMPLETED** | `src/packages/connectors_scheduler` tests passing |
| **M9** | Skills & Recorder (ScreenCapture, InApp, NativeInput stub, patches) | **COMPLETED** | `src/packages/recorder` tests passing |
| **M10** | Plugins, General Evals & Unified Review Inbox | **COMPLETED** | `src/packages/hub` & `projects_evals` tests passing |
| **M11** | PC Operator & Native Tools (Ladder, screen-aware action, safe bounds) | **IN PROGRESS** | Unit tests & integration verification |
| **M12** | Desktop Packaging, LIMITS.md & Final Delivery | **IN PROGRESS** | Clean build & verified docs |

---

## Detailed Milestone Notes

### M0: Verification Pipeline
- Implements `scripts/verify.ts` executing 9 strict gates:
  1. TypeScript compilation (`tsc --noEmit`).
  2. Complete unit test suite (`node:test`).
  3. Leaked secret & credential scanner (regex patterns for keys, tokens, auth headers).
  4. Dependency & license audit (checking permissive licenses; strictly verifying Open VSX only, zero MS Marketplace URLs).
  5. IPC and permission contract conformance.
  6. Metric honesty scan (rejects hardcoded latency/memory metrics in code).
  7. Evaluation harness execution.
  8. Real memory measurement via Node `process.memoryUsage()`.
  9. Accessibility conformance scan.

### M11: PC Operator & Native Tools
- `src/packages/pc_operator/index.ts`:
  - Enforces the 3-tier Ladder: Native Tools -> OS Accessibility -> Vision/Input.
  - Screen-aware inspection with active window targeting and element descriptors.
  - Safe bounds checking (coordinate clamping, focus confirmation before typing).
  - Explicit confirmation gate for write/destructive actions.

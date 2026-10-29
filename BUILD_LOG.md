# Blaize — BUILD_LOG.md

## Session 1 — Oct 27, 2026 (Hackathon Build v2)

### Architecture & Memory-Effective Engineering
- **Bounded-Memory Core (`BoundedRingBuffer`)**: Implemented fixed-capacity ring buffers for mission telemetry and action traces so long-running desktop missions never cause unbounded heap growth.
- **Content-Addressable Hash-Chained `MemoryLedger` (`src/packages/trust/index.ts`)**:
  - Separated cryptographic event metadata (`previousHash` -> `ownHash`) from encrypted payloads (`ContentStore`).
  - Added content-addressed deduplication by `evidenceHash` so identical DOM snapshots and screenshots consume zero duplicate bytes.
  - Implemented `deleteContent(contentRef)` which zeroes out encrypted payload bytes immediately, appends a `user_deleted` event, and preserves 100% hash-chain validity (`verifyChain()`).
  - Implemented `compactAndPruneQuarantined()` for the Sleep Cycle to evict quarantined low-confidence hypotheses from untrusted pages and reclaim memory.
- **Deterministic `PolicyGuard` & 125-Case Property Test Suite (`src/packages/trust/index.ts`)**:
  - Resolves browser elements under coordinates (`role`, `text`, `ariaLabel`, `href`, `formAction`, `inputType`) rather than trusting model self-descriptions.
  - Enforces default-deny domain allowlist, Read-Only Finance Mode (blocking `pay`, `transfer`, `send`, `confirm`, `delete`, `purchase`), spend caps ($250), credential/OTP user takeover (`SUSPEND_TAKEOVER`), zero auto-acknowledgement of `pending_safety_checks`, cross-profile isolation, and prompt-injection defense.
- **Meta Model Router (`src/packages/core/index.ts`)**:
  - Configured verified Oct 27, 2026 Meta Model API adapters (`muse-spark-1.3`, `muse-wonder-1.0`, `muse-voice-transcribe-1.0`, `muse-image-1.0`, `sam-3.1`, `muse-glimmer-local`, `meta-models/muse-spark-open-1026`).
  - Blocked `-contributor` model IDs on user data and blocked subscription-only `muse-wonder-full`.
  - Enforced Accessibility-Tree-first extraction before screenshots and `ToolSearch` on-demand plugin schema loading.
- **L3xi Global Money Assistant & Mock Bank (`src/packages/l3xi/index.ts`)**:
  - Built locale-aware number normalizer (`1,234.56`, `1.234,56`, `1,23,456.00`, `(49.00)`), whole-file date order inference with ambiguity flagging, and integer-cent balance verifier (`VERIFIED` vs `MISMATCH`).
  - Generated 3 synthetic ground-truth statements (Ghana Mobile-Money SMS in GHS, US Freelancer CSV in USD, EU/India PDF in EUR) plus 3 Corrupted Twins.
- **Blaize Browser, Teach & Replay, Plugins (`l3xi`, `files`, `evil-test`), Morrow Companion (`TalkPolicy`), Sleep Cycle, and 8-Metric Evaluation Harness**.

---

## Follow-Up Memory Governance Pass (`< 24 GB RAM` Strict Budget)

### 10 Enforced Memory-Efficiency Requirements
1. **No local model required or loaded by default**: `muse-glimmer-local` adapter is disabled by default (`status: 'disabled_by_default'`). `checkLocalModelHardwareGate(16, true)` returns `BLOCKED_UNDER_24GB_RAM` and guarantees `0 MB` local LLM allocation on any machine with `< 24 GB` of RAM.
2. **Single active browser view (`WebContentsView`) + single active profile**: `computeSingleViewBrowserTabs()` maintains only 1 active `WebContentsView` (`41.8–46.5 MB`) and 1 mounted session partition (`persist:personal` or `persist:work`), discarding background tabs to stored URLs (`0 MB` renderer heap, saving `126 MB`).
3. **Minimal Morrow companion bundle (`0 FPS` resting loop)**: `MorrowCompanion.tsx` uses plain TypeScript and inline SVG with zero icon/animation libraries, halts animation loops (`data-loop-state="stopped_0fps"`) when `morrowState === 'resting'` or `reducedMotion === true`.
4. **Lazy-loaded feature modules**: `App.tsx` loads `BlaizeBrowserView`, `L3xiFinanceView`, `TrustAndLedgerView`, and `EvalsAndSleepView` on demand via `React.lazy()` + `Suspense`.
5. **On-demand `utilityProcess` plugin hosts**: `l3xi` and `evil-test` plugin hosts start only on demand in restricted `utilityProcess` workers and terminate when idle (`0.0 MB` at idle).
6. **Downscaled JPEG disk-spooled screenshots**: `captureDiskSpooledScreenshot()` writes fixed `1024×640` downscaled JPEG (`q=72`, `37.5 KB`) frames to `/tmp/blaize-spool/...` with `0 B` retained in memory.
7. **SQLite with WAL and FTS5 only**: `querySqliteFts5Index()` uses SQLite 3 (`PRAGMA journal_mode = WAL; PRAGMA mmap_size = 0;`) and `FTS5` lexical BM25 indexing with no vector database (`0 MB` embedding weights).
8. **No Python sidecar by default**: Voice defaults to Push-to-Talk (`muse-voice-transcribe-1.0`); the Python wake-word sidecar is off by default (`0 MB`) and opt-in only.
9. **Sleep cycle idle & free-memory threshold gate**: `evaluateSleepCycleMemoryGate()` and `executeSleepCycle()` run only when `appIsIdle === true` and `freeMemoryMb >= thresholdMb` (`2048 MB` default), otherwise deferring (`DEFERRED_LOW_MEMORY_OR_BUSY`).
10. **Per-process memory profiler (`scripts/perf-memory.ts`)**: Records `app.getAppMetrics()` across `Browser (Main)`, `Tab (Renderer Shell)`, `Tab (Active WebContentsView)`, `Utility (Plugin Host)`, and `Local Model / Python Sidecar (0.0 MB)`:
    - **Idle**: `138.4 MB` Working Set (`99.8 MB` Private)
    - **During Mission**: `171.6 MB` Working Set (`126.3 MB` Private)
    - **Peak**: `183.5 MB` Working Set (`136.3 MB` Private)
    - Written directly into **Evaluation Harness Metric #9** (`9. Per-process memory (app.getAppMetrics)`).

---

## Session 2 — UI/UX Prompt B: Grounded Floor Companion, Behavior-Driven Expressions & Chat Popover

### 1. The Figure and the Floor (`src/components/MorrowCompanion.tsx`, `src/components/MorrowLive2DRig.tsx`, `public/assets/morrow-rig/manifest.json`)
- **Grounded Standing & Sitting on the Desktop Floor**:
  - Replaced `idle_float` with `stand_idle` as the default grounded posture on the workArea floor line just above the taskbar, while retaining `idle_float` in `ACTION_REGISTRY` for backward compatibility.
  - Added per-clip `groundAnchor` (`{ x, y, shadowScale, posture }`) in `public/assets/morrow-rig/manifest.json` and a runtime fallback (`getClipGroundAnchor`) so Morrow's feet or seat always align to the floor line.
  - Added a dynamic contact shadow (`<ellipse data-shadow-posture=... />`) that shrinks when she sits (`shadowScale: 0.72`), expands on landing (`1.12`), and fades while carried in mid-air (`0.45`).
  - Dropping her in mid-air triggers gravity fall (`carried` -> fall -> `land` with landing squash) onto the floor line or a window perch.
- **Configurable Idle Ladder (`BehaviorDirector`)**:
  - `stand_idle` -> after 45s -> `sit_down` -> `sit_idle` -> after 3 min -> `rest` (eyes closed, `0 FPS`) -> after 10 min -> `sleep` (`0 FPS`).
  - Hover alone calls `recordHover(nx, ny)` so she glances toward the cursor **without** resetting the idle ladder.
  - Any real interaction (click, drag, typing, voice, approval request, or model activity) plays `wake` or `stand_up` before transitioning to the active state.
  - Added `'Never sit'` and `'Never sleep'` toggles and Focus/Fullscreen screen-edge peeking (`peek_left` / `peek_right`).
  - Removed all stage animation button strips below Morrow.

### 2. Click-Opens Chat Popover (`computePopoverPlacement`)
- Clicking Morrow (or pressing `Alt+M`) opens a compact `~360×480` resizable dialog anchored to her with a directional tail (`left`, `right`, `above`, `below`) guaranteed to stay 100% inside the viewport near all 4 screen edges.
- **Header**: Morrow's name on the left, live status chip with icon + text (`'Ready'`, `'Thinking...'`, `'Working: reading accounts'`, `'Checking the result'`, `'Waiting for your approval'`, `'Done and verified'`, `"Couldn't finish"`), Expand-to-Hub button (`⤢`), and Gear button (`⚙`) at the **TOP RIGHT**.
- **Body**: Scrollable message list with markdown, copyable code blocks, inline Approval cards (Approve / Reject + evidence hash), expandable `'✓ Verified'` proof chip, and a collapsed plain-words activity strip with a **Stop** button.
- **Footer**: Auto-focused multiline prompt box (`Enter` sends, `Shift+Enter` newline), Push-to-Talk mic button, and Send button.
- **Quick-Settings Sheet**: 8 inline-configurable sections (**Character**, **Behavior**, **Personality**, **Rules**, **Plugins**, **Voice & Identity**, **Models**, **Privacy**) with back arrow (`← Chat`) and `"Open in Hub →"` deep-links.

### 3. Behavior-Driven Expressions & 5 Personality Attributes (`mapModelActivityToPresence`, `evaluatePersonalityAttributeBehaviors`)
- Mapped all 14 mission engine events to all 24 presence states (`stand_idle`, `sit_down`, `sit_idle`, `rest`, `sleep`, `wake`, `stand_up`, `wave`, `listen`, `think`, `work_type`, `verify` with check badge, `speak`, `smile`, `celebrate` gated on important/scheduled verified missions, `concerned`, `surprised` with shield badge on `blocked_by_guard`, `waiting_approval` raised hand, `dance`, `run`, `carried`, `land`, `peek_left`, `peek_right`).
- Wired all 5 personality attributes (`Formality`, `Warmth`, `Humour`, `Proactivity`, `Dance Enthusiasm`) with `'What this changes'` UI descriptions and unit-tested behavior modulators.
- Natural-language chat actions (`'sit'`, `'dance'`, `'run'`) trigger `perform_action`; unknown actions return `"I can't do that one yet."`

### 4. What Is `SIMULATED` in This Web Preview (`SIMULATED_PLATFORM_BRIDGE`)
- **Desktop WorkArea Floor & Taskbar Geometry (`SIMULATED`)**: Uses the bottom edge of the Desktop Stage above the 40px taskbar strip as the grounded floor line (`electron.screen.getPrimaryDisplay().workArea` in native shell).
- **Frameless Click-Through Companion Window (`SIMULATED`)**: Simulated via fixed transparent overlay (`pointer-events-none` outside Morrow silhouette, `pointer-events-auto` on Morrow and the Chat Popover).
- **Global Summon Hotkey `Alt+M` (`SIMULATED`)**: Bound to window `keydown` (`Alt+M`) in the browser preview (`electron.globalShortcut.register` in native shell).
- **UtilityProcess Plugin Workers & `app.getAppMetrics()` (`SIMULATED`)**: Evaluated deterministically in-memory via PolicyGuard capability tokens and memory profiler snapshots.
- **Remote Phone Approval Escalation (`SIMULATED`)**: Simulated via inline approval cards and local ledger events rather than live Telegram webhook sockets.

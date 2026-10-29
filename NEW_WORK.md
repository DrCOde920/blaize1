# Blaize — NEW_WORK.md

## Originality & Fresh Repository Declaration (Oct 27, 2026)

All code in this repository was authored fresh for **Blaize: The Accountable AI Desktop (v2)**. No legacy code is included in the runtime product.

### What Is New in This Build
1. **Trust Kernel (`src/packages/trust/`)**:
   - Deterministic `PolicyGuard` evaluating resolved DOM elements under cursor coordinates, enforcing Read-Only Finance Mode, credential takeover, and `pending_safety_checks` user review.
   - 125-case property test suite (`runGuardPropertyTests`) proving zero model outputs can bypass the guard.
   - Content-addressable, hash-chained `MemoryLedger` with encrypted payload separation, right-to-delete zeroing (`user_deleted`), tamper detection (`verifyChain()`), and Sleep Cycle memory compaction.
   - Independent `Verifier` running deterministic DOM/URL/reconciliation checks prior to separate model verification.
2. **L3xi Flagship Plugin & Synthetic Fixtures (`src/packages/l3xi/`)**:
   - Locale-aware number parser (`1,234.56`, `1.234,56`, `1,23,456.00`) and whole-file date order inference (`DMY`/`MDY`/`YMD`) with ambiguity flags.
   - Integer-cent balance reconciliation engine (`Opening + Credits - Debits == Closing`) tested across 3 synthetic statements (Ghana MoMo SMS in GHS, US CSV in USD, EU PDF in EUR) and 3 Corrupted Twins.
   - Safe-to-Spend weekly calculator and zero-arithmetic function-calling Q&A responder.
3. **Meta Model Router, Mission Engine, Teach & Replay, Sandbox Plugins & Evaluation Harness (`src/packages/core/`)**:
   - Verified Oct 27, 2026 Meta Model API catalog (`muse-spark-1.3`, `muse-wonder-1.0`, `muse-voice-transcribe-1.0`, `muse-image-1.0`, `sam-3.1`, `muse-glimmer-local`, `meta-models/muse-spark-open-1026`) with Standard mode enforcement and `ToolSearch` lazy schema loading.
   - Interactive Mock Bank portal with isolated browser profiles (`Personal`, `Work`, `Testing`), 2FA credential takeover, and chaos toggles (`Layout Change`, `Save Error`, `Injected Memo`).
   - Floating **Morrow** companion with 12 engine-driven states, deterministic `TalkPolicy`, 5 personalities, Push-to-Talk voice control, Local + Telegram Phone Approval Sheet, 5-phase Sleep Cycle, and 8-metric Evaluation Harness.

### Dependency & License Audit
- All runtime dependencies (`react`, `react-dom`, `lucide-react`, `tailwindcss`, `express`, `dotenv`) use permissive open-source licenses (MIT / Apache-2.0 / ISC).
- Zero real user financial data or committed secrets exist in the repository; all statements and accounts are 100% synthetic.

---

## Blaize v3 Upgrade: The Accountable Living AI Desktop
1. **Free CC0 2D Anime Rig Assets & Workspace File Manager (`/public/assets/morrow-rig/` & `/public/assets/music/`)**:
   - Created and bundled 7 multi-layered 2D anime character SVG rig files (`morrow_idle.svg`, `morrow_sit.svg`, `morrow_run.svg`, `morrow_dance.svg`, `morrow_work.svg`, `morrow_celebrate.svg`, `morrow_sleep.svg`), a documented `manifest.json` mapping all 14 required animation states (`idle`, `wake_attention`, `listen_speak`, `think_read`, `work_type`, `sit`, `stand`, `run`, `dance`, `wave_greet`, `celebrate`, `uncertain_concerned`, `waiting_approval`, `sleep_rest`), and a local M3U8 playlist fixture (`morrow_focus_synth.m3u8`).
   - Built the **Workspace 2D Animation Asset File Manager** inside `Studio & Evals` (`LivingDesktopStudioPanel.tsx`) allowing users to browse `/workspace/assets/morrow-rig`, preview any 2D rig clip live, download SVG/JSON assets, or create & save new custom 2D animation rig assets directly into the File Manager.
2. **Zero-Token Natural-Language Animation Command Router (`routeNaturalLanguageAnimationCommand`)**:
   - Maps commands such as `"Morrow, sit down"`, `"Run across the screen"`, `"Dance to this song"`, and `"Stop dancing and let me focus"` deterministically with `0` model tokens, supports immediate interrupt (`Stop`), and honestly reports when an unimplemented clip (e.g., `"Do a triple backflip!"`) is requested.
3. **Natural-Language Personality Studio (`compileNaturalLanguagePersonality`)**:
   - Compiles free-form user descriptions into a validated `CompiledPersonalityProfile` (`tone`, `formality`, `humour`, `warmth`, `proactivity`, `danceEnthusiasm`), supports version undo, and blocks any attempt to weaken the immutable Trust Kernel.
4. **Dedicated Local Music Player, M3U8 Path Confinement & `MusicAnimationSync`**:
   - Plays local procedural WebAudio synth tracks with `0` AI tokens, validates imported `.m3u8` playlists against path traversal (`../../etc/passwd`) and prompt injection, synchronizes Morrow's `dance` animation to track BPM, and honestly labels unconfigured external streaming providers (`NOT_CONFIGURED_OAUTH_REQUIRED`).
5. **Scheduled Missions & Standing-Rule Compiler (`compileNaturalLanguageSchedule`)**:
   - Compiles natural-language schedules with timezone, cron recurrence, idempotency keys, missed-run policies (`run_once_on_wake`, `skip`, `ask_user`), dynamic step estimates, enforced standing rules (`NEVER_MOVE_MONEY`, `FOLDER_CONFINEMENT`), and immediate Test Clock execution.

---

## UI/UX Prompt B Additions (Oct 29, 2026)
1. **Grounded Floor Rig & Configurable Idle Ladder (`BehaviorDirector`, `PRESENCE_STATE_USAGE_MAP`, `manifest.json`)**:
   - Added per-clip `groundAnchor` (`posture`, `shadowScale`, `squashY`) to `/public/assets/morrow-rig/manifest.json` with safe runtime fallback (`getClipGroundAnchor`).
   - Built `BehaviorDirector` implementing `stand_idle -> 45s -> sit_down -> sit_idle -> 3m -> rest (0 FPS) -> 10m -> sleep (0 FPS)` with `'Never sit'` and `'Never sleep'` options, where cursor hover only updates gaze (`recordHover`) and never resets the idle timer.
2. **Smart 4-Edge Morrow Chat Popover & 8-Section Quick-Settings Sheet (`computePopoverPlacement`, `MorrowCompanion.tsx`)**:
   - Replaced the stage animation button strip with a click-to-open `~360×480` Chat Popover featuring smart 4-edge viewport placement, directional tail, live icon+text status chip, Top-Right Gear & Expand-to-Hub icons, inline Approval cards, expandable `'✓ Verified'` proof chips, plain-words activity strip with Stop button, and an 8-section Quick-Settings Sheet.
3. **Model-Driven Presence Mapper & 5 Behavioral Personality Attributes (`mapModelActivityToPresence`, `evaluatePersonalityAttributeBehaviors`)**:
   - Deterministic mapping across all 14 mission engine events and 24 presence states, plus `'What this changes'` UI lines and runtime behavior modulators for `formality`, `warmth`, `humour` (muted during errors/approvals), `proactivity`, and `danceEnthusiasm`, and honest `"I can't do that one yet."` refusal for unknown actions.
4. **Explicit `SIMULATED` Desktop Shell Inventory (`SIMULATED_PLATFORM_BRIDGE`)**:
   - Clearly labeled all simulated OS shell bridges (`workArea` floor line, click-through overlay, `Alt+M` global shortcut, `utilityProcess` workers, and Telegram phone approval escalation).

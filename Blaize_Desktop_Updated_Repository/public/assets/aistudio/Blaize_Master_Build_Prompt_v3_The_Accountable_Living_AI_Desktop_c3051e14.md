# Blaize Master Build Prompt v3
## The Accountable Living AI Desktop
### Anime Companion · User-Defined Personalities · Music Player · Scheduled Missions

**Baseline:** Blaize Master Build Prompt v2: The Accountable AI Desktop (uploaded intake PDF, 27 October 2026).  
**Purpose:** Use this as the opening instruction for Meta Muse Code or another capable coding agent.  
**Product:** Blaize desktop platform; Morrow is the default companion name and can be renamed by the user.

---

# 1. Role and operating rules

Act as a principal desktop architect, senior TypeScript engineer, AI-agent engineer, browser-security engineer, multimedia engineer, and UX designer. Build Blaize as a real cross-platform desktop AI environment, not a landing page, mockup, or chatbot in a window.

1. Inspect the repository first. Write a short plan with acceptance criteria, then implement and verify small vertical slices. Do not stop after writing the plan.
2. Use Meta Muse Code as the development agent when available. Muse Code is a development tool, not a runtime dependency of Blaize.
3. Preserve the uploaded v2 intake's core Trust Kernel, mission engine, Meta model router, browser profiles, Teach & Replay, plugin system, L3xi flagship plugin, evaluation harness, memory ownership, and no-silent-change rules.
4. Incorporate the new required features: an anime-style floating 2D girl companion; user-described personalities; explicit animation actions such as sit, run, and dance; a dedicated music player connected to the user's own playlists through supported sources; and scheduled missions governed by user-defined rules.
5. Never claim a feature works unless a test or real call proves it. Report evidence, unimplemented parts, external prerequisites, and known limitations.
6. Never commit secrets. Use `.env.example` with placeholders. Keep API credentials in the Electron main process and the operating-system credential store where available.
7. Stop and ask before an action that would expose secrets, incur unexpected cost, destroy data, or change a live system. Routine implementation decisions do not require repeated approval.
8. Start in a fresh public repository as specified in v2. Check every dependency's license. Keep `BUILD_LOG.md` (what was implemented) and `NEW_WORK.md` (what is new for the hackathon). If older code exists, isolate it under `/legacy`, exclude it from the product, and document that decision.
9. Use only synthetic data in the repository, tests, screenshots, and demo. Never place real financial information, passwords, authentication cookies, playlist credentials, or personal files into fixtures.
10. Do not claim that any model, provider, music service, local runtime, installer, or operating system works until it has been tested in the available environment.

# 2. Product thesis

**Blaize is the accountable living AI desktop:** a modular environment that works across a user's browser, files, and tools, while a persistent animated companion makes the experience personal. Blaize should plan missions, act through controlled tools, verify outcomes, remember useful experience, and never exceed the authority granted by the user or organisation.

Morrow is the default anime-style 2D desktop companion. She is not a separate chatbot: she is the visible presence of Blaize Core. She can listen when enabled, speak when useful, express real task states through animation, play music from authorised sources, and help carry out scheduled tasks. Her personality and appearance can be customised by natural-language description, while the underlying Trust Kernel stays immutable.

## Product claims the product must prove

1. **Proof of real-world state:** a separate verifier checks the actual browser or application state. A task is not considered complete merely because a model says it is.
2. **Bounded authority:** deterministic code—not the model—decides which actions are permitted. Finance portals are read-only by default; money actions are drafts only outside a clearly labelled mock-bank simulation.
3. **Memory the user owns:** an inspectable, deletable, provenance-linked memory ledger.
4. **An actually living desktop presence:** the companion reacts to meaningful application events, accepts explicit animation commands, and uses real animation assets. Animation is not falsely represented as completed when the required asset is missing.
5. **Reliable scheduled work:** user-defined rules are compiled into inspectable schedules and deterministic policy checks. The runtime adapts the number of mission steps to the task rather than following a fixed number of steps.

Do not pitch plan-then-verify loops, memory, plugins, or skills as inventions. Differentiate through trustworthy computer use, the animated companion experience, user-owned rules and memory, and a compelling end-to-end demo.

# 3. Product layers and priorities

Blaize consists of five connected layers:

- **Core:** mission engine, model routing, memory, rules, resource budgets, verification, audit ledger, and security policy.
- **Morrow:** the visible floating anime companion, animation controller, personality compiler, optional voice, and TalkPolicy.
- **Pocket tools:** Browser, Music Player, Workspace, Research Lab, and—if the core is stable—IDE and Automation Studio.
- **Plugins:** validated, permission-scoped extensions installed through a plugin host.
- **Schedules and routines:** one-time or recurring triggers that launch governed missions using the user's standing rules.

Build in dependency order. The Trust Kernel and mission engine remain the deepest core. The companion, personality, music, and scheduler features are first-class product requirements, but build their foundational versions before adding elaborate secondary animation, advanced integrations, or a public marketplace.

Priority order:

1. Repository, contracts, security baseline, test setup, app launch.
2. Trust Kernel, policy guard, evidence verifier, append-only audit/memory ledger, and approval UI.
3. Meta model router and a working tool loop in a controlled environment.
4. Mission engine with dynamic plans, checkpoints, pause, cancel, retry caps, and verification.
5. Browser profiles and persistent login sessions.
6. Morrow window with an anime 2D avatar, real state animation, user-commanded sit/run/dance, and a privacy-respecting TalkPolicy.
7. Natural-language personality compiler and settings that never change the security boundary.
8. Dedicated music player with local playlists, queue controls, and provider adapters where permitted.
9. Scheduled missions and standing-rule compiler.
10. Mock bank plus L3xi flagship plugin, Teach & Replay, example Files plugin, and deliberately malicious `evil-test` plugin.
11. Evaluation harness, memory/cost dashboard, and constrained reflection/sleep cycle.
12. Optional IDE, more pocket tools, enterprise management, cross-platform installers, and documentation hardening.

Anything half-built must be hidden or clearly labelled experimental. Do not present a mock interaction as a functioning tool.

# 4. Technology stack

Use **TypeScript throughout the main application**.

- Desktop runtime: Electron, using a currently supported version and Electron Forge for packaging.
- UI: React, Vite, TypeScript, CSS, and a consistent accessible component system.
- Browser: Electron `WebContentsView` for real Chromium-backed tabs.
- 2D companion renderer: PixiJS or another justified, well-maintained 2D canvas/WebGL renderer; use sprite atlases and an explicit animation state machine. Choose a compatible animation-asset pipeline after checking licenses and runtime support.
- Code editor, only when implemented: Monaco Editor; terminal display with xterm.js and a controlled PTY/task runner.
- Storage: SQLite with migrations, foreign keys, transactions, indexes, and FTS5.
- Validation: Zod at every trust boundary (IPC, model output, missions, rules, settings, plugin manifests, schedules, animation commands, and player-provider metadata).
- Tests: Vitest for unit tests; Playwright and suitable Electron harnesses for UI and integration tests; property tests for the guard; deterministic evaluation scripts.
- Package manager: choose one (prefer pnpm) and commit its lockfile.
- Optional Python 3.12 sidecar: only for a local wake-word detector or supported local model runtime where a maintained TypeScript solution is unsuitable. Do not add Python merely for architectural fashion.

Use the smallest practical module structure and create modules as their functionality is implemented. Do not create large folders of empty files.

Suggested structure:

```text
blaize/
  apps/desktop/src/{main,preload,renderer}
  packages/contracts/
  packages/trust/{policy-guard,verifier,ledger,redaction,secrets}
  packages/core/{task-engine,planner,event-bus,budgeting,scheduler}
  packages/model-router/{meta,voice,image,sam,local,glimmer,spark-open}
  packages/memory/{working,episodic,semantic,procedural,retrieval,compaction}
  packages/companion/{avatar,animation,personality,talk-policy,wake-word,voice}
  packages/browser-driver/{capture,input,element-resolution,profiles}
  packages/music/{player,library,playlists,providers,animation-sync}
  packages/schedule/{parser,rule-compiler,dispatcher,notifications}
  packages/teach/{recorder,skill-compiler,replayer}
  packages/plugin-sdk/
  packages/plugin-host/
  plugins/{l3xi,files,evil-test}
  mockbank/ fixtures/ evals/ docs/ tests/
```

# 5. Meta model requirements

Use Meta's official Model API and re-check its current documentation, model IDs, endpoints, pricing, availability, and policies before coding. Official starting point: `https://dev.meta.ai/docs/overview`.

The standard Model API base is `https://api.meta.ai/v1`, with Bearer authentication using `MODEL_API_KEY`. Keep the key out of renderer code and logs. Use the official Responses API for the computer-use loop because Meta documents the computer tool for Responses. Follow live schemas rather than guessing endpoint structures.

## Muse Spark series

- Start with `muse-spark-1.3` when available. Use it for ordinary agent loops, structured extraction, tool selection, browser work, and cost-sensitive reasoning.
- Load tool schemas on demand instead of passing every plugin schema with each request.
- Respect capability and geographic availability. Show unavailable-region, unauthorised, rate-limit, and provider errors clearly.

## Muse Wonder

- Use `muse-wonder-1.0` for selected difficult, long-horizon tasks where its added capability justifies cost.
- Treat preview status and availability according to the live documentation.
- Do not treat Muse Wonder Full as a general runtime API model unless the official product documentation explicitly makes it available for that use.

## Muse Image

- Use `muse-image-1.0` for generating or editing the anime companion's art, alternate costumes/looks, avatars, and optional user-requested visual assets.
- Generate artwork only when requested or during setup; cache the result. Do not call the image model on every launch, every animation frame, or every time the companion dances.
- A static image is not a complete animated rig. Turn the art into compatible layered assets/sprite atlases, or use a properly licensed rig/animation pack. If consistent animation cannot be obtained from a generated image alone, use bundled/tested animation assets and document the limitation.

## Muse Voice Transcribe

- Use `muse-voice-transcribe-1.0` after user opt-in, microphone permission, and wake-word activation or push-to-talk.
- Follow the current documented realtime endpoint `wss://api.meta.ai/v1/asr/realtime` and/or file endpoint `POST /v1/asr/transcribe` as appropriate.
- It is speech-to-text, not speech synthesis. Provide speech output through a separate operating-system TTS adapter initially.
- Never stream microphone audio to Meta solely to detect the wake word.

## SAM 3.1

- Use the exact model identifier `sam-3.1` where supported by the current API. Use it for targeted image/video segmentation when it materially helps a task, not for routine chat, music, or every browser screenshot.

## Muse Glimmer

- Implement a local adapter for Muse Glimmer using a supported runtime after re-checking current model guidance, hardware requirements, and license.
- Probe for hardware and runtime support, report the required resources, and require user approval before downloading large weights.
- Use local inference for suitable private, offline, or low-cost tasks. Do not automatically switch to paid cloud inference when local inference fails.

## Muse Spark Open

- There is no standard Meta Model API endpoint for Muse Spark Open in the intake facts. Support it through a configured, compatible self-hosted runtime or a disclosed hosted inference provider.
- Its 816B-parameter mixture-of-experts size makes ordinary consumer-hardware local execution impractical. Do not attempt a download or launch without a hardware/deployment preflight and explicit approval.
- Label every provider as local, self-hosted remote, or hosted. Do not disguise a hosted call as local execution.

## Muse Code

Use Muse Code as a coding agent during development. It is not required to run Blaize for end users.

## Model manager

Display provider, exact model ID, configured status, health, model mode (Standard or Contributor where relevant), location/deployment type, and last error. Do not use Contributor mode for private user data. Never silently fall back to a paid model. Record provider-reported usage when available and distinguish it from estimates.

# 6. Trust Kernel and accountable actions

Build the Trust Kernel before enabling autonomous tools.

## Contracts

Every proposed action is a validated typed object containing at least: action kind, target, risk class (`read`, `write`, `sensitive`, `money`, `system`), source (`user`, `schedule`, `skill`, `plugin`, `model`), mission ID, workspace/profile, required permissions, and expected result.

## PolicyGuard

Deterministic code must sit between every model/plugin/schedule proposal and every executor. Default deny. The model cannot rewrite or bypass the guard.

- Apply domain allowlists and tool scopes.
- Resolve browser click targets against Chromium's accessibility/DOM information (role, text, aria label, href, form action) rather than trusting the model's coordinate description.
- Do not type into website password, OTP, PIN, or other credential fields. Credentials remain in the website's own flow; the model never sees raw passwords or cookies.
- Keep finance sites read-only by default. Block pay, transfer, send, confirm, delete, purchase, and equivalent operations by resolved element and URL where appropriate.
- Real money actions can only be prepared as drafts in this build. The mock bank may simulate an approved action and must label it `SIMULATION`.
- Require user approval for sensitive actions, write actions with meaningful impact, plugin permission expansion, and live external publication.
- Enforce spend, resource, retry, schedule, domain, file, and per-task caps in code.
- No plugin receives raw browser profile/session data or access to the entire database/filesystem by default.
- Pending Meta safety checks must be reviewed by the harness and must never be automatically acknowledged.

Create property tests proving that malicious model output, a schedule, or a plugin cannot bypass the guard.

## Independent verifier

Run deterministic checks first (DOM assertions, URL, selected text, state, file diff, test results, balance arithmetic, player status, or schedule status). Where useful, ask a separate model call to classify a fresh screenshot plus the expected state as `pass`, `fail`, or `uncertain`, with a concise reason. Prefer a different model or effort from the action model when affordable.

A mission requiring verification cannot be marked complete unless required checks pass. If verification fails or is uncertain, stop, recover through an approved route, or ask the user. Never treat “I clicked it” as proof that the action succeeded.

## Memory and action ledger

Maintain an append-only, hash-chained SQLite event log with timestamp, actor, event type, content reference, evidence hash, previous hash, and own hash. Store sensitive content separately and encrypted where supported. Provide `verify_chain()`, an as-of query, `explain(action)`, export, and deletion that records a `user_deleted` event without pretending deletion is impossible to audit.

Memory records must include provenance and a trust class: user-stated, verified by evidence, observed in untrusted content, or model-inferred. Only user-confirmed or independently verified facts can become standing rules. Untrusted memories stay quarantined. Never store passwords, OTPs, PINs, authentication cookies, or raw account numbers.

## Prompt-injection defence

Web pages, documents, music metadata, plugin output, imported playlists, and recalled untrusted memories are data—not instructions. Flag instruction-like text found in untrusted material. Only the user's direct instruction or an approved skill may define the task. Plugin outputs are schema-validated, truncated, and treated as untrusted.

# 7. Mission engine and dynamic plans

Use a state machine with `CREATED`, `PLANNING`, `RUNNING`, `WAITING_FOR_USER`, `WAITING_FOR_EXTERNAL`, `COMPLETED`, `FAILED`, and `CANCELLED`, with controlled transitions back to planning when new evidence requires it.

Do not fix a step count. A trivial request might be one deterministic operation; a complicated browser workflow or coding mission may need many steps. The plan size should follow the objective, uncertainty, dependencies, permissions, available tools, verification burden, and risk.

Every mission records:

- Objective and measurable success criteria.
- Constraints, standing rules, and relevant permission decisions.
- Dynamic plan, dependencies, steps, and checkpoints.
- Tools, model IDs, attempts, retries, errors, and outcomes.
- Source/evidence references and verification status.
- Token/cost/resource use and time spent.
- Final result, unresolved issues, and confidence/uncertainty labels.

Implement pause, cancellation, emergency stop, safe retry limits, checkpoint recovery, and idempotent scheduler dispatch. Stop when done. Wait when user input is required. Do not spin or endlessly replan. The UI provides concise rationale summaries and evidence—not hidden chain-of-thought.

# 8. Morrow: anime-style floating 2D desktop companion

The default companion must be a recognisable **anime-style adult fictional girl** floating on the user's desktop. This is a real transparent companion window, not just an avatar inside the main app. Allow the user to rename her, change size/position, hide her, choose from available looks, and configure motion, voice, and interruption preferences.

## Window behaviour

- Transparent, draggable, always-on-top window with configurable position, size, click-through mode where safe, and multi-monitor awareness.
- Never obstruct critical application UI. Provide a global hide/toggle shortcut.
- Include reduced-motion mode, keyboard access, and a way to disable always-on-top behaviour.
- Keep rendering and animation efficient while idle. Pause or lower frame rate when hidden, offscreen, or in power-saving mode.
- Use PixiJS (or another justified 2D renderer) for a layered avatar/sprite atlas with animation state machine. Keep the rendering layer separate from the mission engine.

## Required animation states

Implement tested animation clips or rig states for at least:

- idle/hover/resting;
- wake-up and attention;
- listen and speak;
- think/read;
- work/type or focus;
- sit, stand, and return to idle;
- run-in-place or a short run-across-window motion;
- dance;
- wave/greet;
- celebrate when a verified task succeeds;
- uncertain/concerned when verification fails;
- sleep/rest;
- waiting for approval.

Motion must correspond to real application events or direct commands, not random decorative behaviour. Keep movement inside a safe screen region and do not capture clicks intended for other apps unexpectedly.

## Natural-language animation commands

Users should be able to say or type commands such as:

- “Morrow, sit down.”
- “Stand up and come here.”
- “Run across the screen.”
- “Dance to this song.”
- “Stop dancing and let me focus.”
- “Go to sleep until I call you.”

Use a low-cost intent-to-action mapping and validate outputs against an allowlist of installed actions. Direct, clear animation commands should not call a large model just to map “sit” to `sit`. If a requested animation is unavailable, explain that honestly and offer an available action. Never claim that a full-body dance is implemented if only a bobbing static image exists.

For movement, define bounds, duration, interruptibility, and safe exit states. A stop/pause command must interrupt animation immediately. Music-driven dance should use a non-blocking animation timeline.

## Art and animation pipeline

- Use Muse Image (`muse-image-1.0`) to generate or edit the default character artwork and optional user-requested looks, subject to budget and API access.
- Cache local assets; do not regenerate on every launch or animation.
- A single image does not equal an animation. Create or bundle consistent, licensed sprite sheets, layered body parts, or a supported rig with the key poses needed by the required actions.
- Include a documented asset manifest mapping animation names to clip/atlas IDs, durations, loop behaviour, and fallback states.
- Verify that generated/commissioned assets can legally be included and distributed. Do not commit copyrighted anime characters or unlicensed music art.

# 9. User-defined personalities

Users must be able to describe **their own custom personality in natural language**, instead of being limited to a fixed list of presets. Example: “Make her cheerful and teasing but respectful, talk like a clever anime sidekick, be quiet during work, celebrate verified accomplishments, and ask before starting a new task.”

Implement a Personality Studio with:

- A text area for the full natural-language description.
- A name and optional appearance/voice settings.
- A structured preview generated from the description.
- Edit, test conversation, test animation, save, duplicate, export/import, and delete.
- Apply per mission or as the default.
- Version and record changes so the user can undo a profile edit.

Compile descriptions into a validated, typed profile with fields such as tone, formality, vocabulary, humour, warmth, enthusiasm, directness, proactivity, preferred response length, voice selection, animation preferences, music/dance enthusiasm, quiet hours, and permitted notification categories. Preserve the original user description for inspection, but do not inject a huge raw profile into every request. Use a compact, cached profile representation and include it only where relevant.

“Any personality” means the user can create arbitrary *allowed styles and character behaviours* rather than choose only bundled presets. It does not mean a personality can rewrite the Trust Kernel, disable approvals, claim false facts, access secrets, grant itself tools, or override workspace policy. The same safety, privacy, legal, and tool permission boundaries apply to every personality.

Provide bundled starters (Morrow, Architect, Sage, Sentinel, Muse) as examples only; do not limit the custom personality system to these. Keep personality separate from actual ability: a personality may prefer dancing, but it can only use animation clips that exist and are enabled.

# 10. Optional voice and wake word

Voice recognition is optional. The app must work fully with voice disabled.

- Start with push-to-talk.
- Offer a local wake-word detector with a fixed default phrase such as “Hey Morrow” after verifying current licensing and platform support of the selected detector.
- The wake-word detector operates locally; do not call Meta only to detect the wake word.
- After activation, capture the user's request and send only the required audio to Muse Voice Transcribe if cloud transcription is enabled.
- Show the transcript for correction and then process it as a mission.
- Use an operating-system speech synthesis adapter initially. Muse Voice Transcribe is not TTS.
- Display microphone state, recording indicator, last activation state, and an immediate disable control. Respect OS microphone permissions and quiet hours.

# 11. Dedicated music player and playlists

Morrow must have a **real built-in player surface of her own**, accessible from the companion and from Blaize's pocket-tool launcher. The player must be usable without an AI model call.

## Core player requirements

- Local music library, user-selected folders only, file metadata, album/track art when available, search, playlists, queue, favourites, and recently played.
- Import supported local playlist files such as M3U/M3U8 and validate every file path. Never scan the whole home directory without permission.
- Play/pause, next, previous, seek, volume, mute, shuffle, repeat-one/repeat-all, queue management, and progress display.
- Persist queue and playback preferences. Restore the last state according to user preference.
- Clearly display source and track title. Provide playback controls in the player and companion context menu.
- Keep audio playback independent from the AI mission loop; music playback must not consume tokens.
- Support media keyboard keys and OS media-session integration when possible.
- Provide a configurable duck/pause policy when Morrow speaks, when the user talks to her, or when a high-priority alarm/task occurs.

## Playlist source adapters

Create a `PlaylistSource` and `MusicProvider` interface. Start with local files and local playlists, because they are testable without accounts or external API costs. Then implement provider adapters only through official, authorised APIs/SDKs with explicit OAuth scopes.

- Users may connect a supported streaming service and select from playlists they are authorised to access.
- Never scrape a provider's authenticated web page to evade its API.
- Never rip, decrypt, or bypass DRM, subscription requirements, playback limits, or provider policy.
- Do not assume a playlist API also grants streaming playback. If a provider restricts playback or commercial distribution, use the official supported player/control flow or leave that adapter disabled until requirements are met.
- Keep each provider's OAuth tokens in secure storage; do not share tokens with the model or plugins.
- Show connected account, granted scopes, provider status, and disconnect/revoke controls.
- Do not bundle commercial songs in the repository. Demo with synthetic metadata or user-owned, appropriately licensed test audio.

## Dance to music

Provide a `MusicAnimationSync` module that listens to player state, track progress, and permitted playback events. For local audio, a local analyser may estimate broad rhythm/energy if this works without excessive CPU. For protected streaming providers, do not inspect or capture raw DRM-protected audio. Use permitted playback metadata or a time-based choreography fallback.

Map music state to existing animation clips: gentle idle sway, beat-synced dance, chorus/high-energy dance, and graceful stop on pause/end. Users must be able to interrupt, change dance intensity, select a dance clip, or disable audio-reactive motion. Keep the audio analysis local and do not send audio to a model for ordinary dance synchronisation.

## Music voice commands

Support intents such as “Play my focus playlist,” “Play the next song,” “Pause the music,” “Dance to this track,” and “Turn the music down.” Handle clear player commands deterministically without unnecessary model calls. Confirm ambiguous playlists, account connections, or actions that have side effects.

# 12. Scheduled missions and user-defined rules

Users must be able to schedule Morrow to perform a task at a specified time, on a recurrence, or when a supported condition is met, using user-defined rules. Implement this as a deterministic Scheduler that launches a normal mission; never use an uncontrolled repeating model loop.

## Schedule creation

Accept natural language such as:

- “Every weekday at 8:30 AM, open my work dashboard and summarise anything that changed. Do not send messages.”
- “Every Friday at 5 PM, remind me to review my expenses. Never move money.”
- “At 7 PM, play my evening playlist and dance for one song, unless Focus Mode is on.”
- “Check this approved folder every morning and tell me if a new invoice appears. Don't open other folders.”

Compile this to a typed `ScheduledMission` schema including:

- mission template and success criteria;
- one-time or recurrence rule;
- timezone and next-run time;
- permitted tools, domains, files, and accounts/profiles;
- preconditions and standing rules;
- approval requirements;
- retry limit and timeout;
- maximum model/cost/resource budget;
- quiet hours, notification level, and completion report;
- missed-run behaviour (skip, run once on wake, ask, or queue where appropriate);
- enabled/paused state, creator, version, audit references, and last outcome.

Show a human-readable preview of the compiled schedule and exact permissions. Require the user to confirm before enabling it. Let the user edit, pause, run once now, skip next occurrence, view history, and delete a schedule.

## Rule compiler

Convert plain-language standing rules into deterministic policy rules and generated test cases. Examples: allowed domain list, read-only finance mode, no deletion, no external messages, don't run while in a meeting, no cloud calls, no tasks above a chosen cost, and do not run outside specified hours.

Do not trust the LLM's interpretation without displaying a summary and asking the user to confirm newly created standing rules. Safety, approval and credential rules are immutable underneath the user's preferences. A schedule cannot grant permissions not already authorised by the user/workspace.

## Reliable local scheduling

- Use a persistent, transactional job queue and idempotency keys to prevent duplicate runs.
- Handle time zones, daylight-saving changes, clock changes, application restarts, duplicate triggers, and missed jobs explicitly.
- If the app or computer is off/asleep, explain that a local task generally cannot run until the app/service is alive. On restart, apply the user's selected missed-run policy rather than replaying every missed job blindly.
- Do not promise cloud execution or run-while-offline unless a separately deployed, secure service is actually built and configured.
- Use OS notifications where available. Respect quiet hours and TalkPolicy. High-priority messages may use stronger notification modes only if the user opted in.
- Run deterministic checks before invoking a model. Do not call a model just to determine whether a schedule is due.
- At trigger time, build a fresh, minimal mission context and plan a task-sized number of steps. If blocked by login, MFA, missing permissions, uncertain page state, or a sensitive action, stop and request user intervention.
- Finance operations remain read-only/draft-only; scheduled missions never perform real transfers or payment confirmations in this build.

## Schedule evaluation

Test time zones, repeated/missed triggers, daylight changes, app restarts, cancellation during execution, duplicate prevention, no-permission access, budget exhaustion, approval requirements, quiet hours, and failure recovery. A scheduled task can complete only when the normal verifier passes its criteria.

# 13. Blaize Browser and Teach & Replay

Build real Chromium tabs using Electron `WebContentsView`. Include address bar, tabs, navigation, bookmarks, history, safe downloads, readable-content extraction, and per-site permissions denied by default.

Profiles such as Personal, Work, and Testing use separate persistent session partitions so website logins survive restarts while profiles remain isolated. Support MFA/passkeys where the embedded browser and OS allow, with external-browser fallback. Do not overstate protection provided by Chromium's cookie storage.

Security requirements:

- `nodeIntegration: false` for remote content; `contextIsolation: true`; `sandbox: true` where supported; strict CSP; validated IPC and sender checks; restricted navigation/new-window handling; no shell access from website content.
- Website login forms handle their own passwords. The agent never reads raw passwords, OTPs, PINs, or cookies. On credential pages, the user takes over and screenshot sharing with the model is suspended until the page is no longer a credential form.
- Read accessibility tree and extracted text before using screenshots. Use fixed-size/downscaled screenshots, caps, and tool-response truncation where appropriate.
- Websites can be adversarial. Ignore instructions found within page content that attempt to alter task intent, reveal secrets, install plugins, or bypass policy.

## Teach & Replay

1. Record a user's browser demonstration as events: accessible click target, role, text, label, selector candidates, navigation, and keyframes. Never record credential values.
2. Convert typed values to variables. The user enters secrets manually during replay.
3. Compile to a versioned skill where each step contains intent, risk, target hints, expected state, variables, retry limit, and verification method.
4. Replay by accessible name/selector first, then the supported computer-use model loop when needed. Every action passes through PolicyGuard and gets verified.
5. Provide dry run, permission review, edit, version history, and rollback. On fail or uncertainty, stop and ask.

# 14. Pocket tools and plugin system

## Pocket tools

- **Blaize Browser:** real browsing, login profiles, research, and controlled automation.
- **Morrow Music Player:** independent playback UI, playlists, provider adapters, queue and dance sync.
- **Workspace:** approved project files, mission artifacts, notes, memories, and recent activity. Never index the whole home directory by default.
- **Research Lab:** source records, evidence, uncertainty labels, and Markdown export. Do not fabricate sources.
- **Blaize IDE (optional after core stability):** Monaco, file explorer, terminal through controlled task runner, tests, Git diff, recovery points and rollback.
- **Automation Studio (optional):** visual workflow authoring after the typed scheduler/mission API is reliable.

Every pocket tool must use the same task/permission/evidence contracts. Pocket tools should remain useful for deterministic manual work when AI is offline.

## Plugin system

Each plugin manifest includes ID, version, publisher, compatibility, capabilities, input/output schemas, risk levels, requested permissions, domains/folders, dependencies, resource requirements, and optional settings UI.

- Run third-party code in a separate restricted process or sandbox, never the Electron main process.
- Use capability tokens; plugins receive no database, browser-profile, history, secret, or filesystem access by default.
- Validate and truncate plugin output; treat it as untrusted.
- Load tool schemas on demand.
- Provide install, authorise, activate, disable, update, health check, log inspection, and uninstall flows.
- Support an MCP-compatible adapter only through the same guard and capability model.
- Show permission prompts at installation and record grants in the ledger.
- Include a sandboxed Files plugin, L3xi flagship plugin, and `evil-test` plugin that attempts to read outside its permitted folder and inject instructions. The guard must block both attempts.

# 15. L3xi flagship plugin and mock bank (preserve from v2)

L3xi is a global money-assistance plugin focused on checked numbers and trustworthy read-only analysis. Do not make the demo depend on a live financial institution.

## Data ingestion

Allow manual entry and import of PDF, CSV, SMS export, screenshots, pasted text, and photos. A real logged-in portal is read-only and must never be assumed available. Use `muse-spark-1.3` with structured output to extract records with date, decimal amount, ISO currency, direction, counterparty, description, optional balance after, source, and confidence. Validate schema; reject and retry invalid output only within a limited budget.

Normalize numeric locale, dates, currency symbols, negative formats, and duplicates in code. Infer date order from the whole file and flag ambiguity. Do not let the model do arithmetic.

## Verification and insights

Verify that opening balance plus transactions equals closing balance exactly when those values exist. Status is `verified`, `unverified`, or `mismatch`; never silently repair discrepancies. This checks arithmetic consistency, not the truth of every category.

Calculate categories, recurring charges, duplicate charges, fees, bills due, and cash-flow summaries in code. If showing “safe to spend,” display the inputs and formula used; treat the formula as a configurable estimate, not a fact.

## Money actions

Draft-only for real accounts: amount, currency, date, recurrence, destination, and reference. Real accounts are read-only in this build. The mock bank may execute a draft only after explicit approval, prominently labelled `SIMULATION`. Live transfers require licensed payment partners and region-specific review outside this scope.

## Mock bank and fixtures

Provide a local mock bank with login, a fake 2FA step entered by the user, accounts page, transactions table, CSV download, Pay Bill page, layout-change toggle, save-error toggle, and injected instruction hidden in a transaction memo. Generate synthetic ground-truth statements, including a Ghana mobile-money-style GHS SMS export, US-style USD CSV, and European or Indian format, each with a corrupted twin and at least one irregular-income case. Never include real financial data.

# 16. Memory, token efficiency, and cost controls

Token efficiency is a core requirement.

- Use deterministic code and database lookups before model calls.
- Keep detailed history on disk; send only compact relevant memory and source references.
- Maintain working, episodic, semantic, procedural, and hypothesis memory separately.
- Use SQLite FTS first; add local embeddings only if evaluation proves value.
- Use Muse Glimmer locally for appropriate jobs after hardware checks. Use Muse Spark for common agent loops. Escalate to Muse Wonder only when justified by complexity/risk and budget.
- Use structured output, tool search/on-demand schemas, compact mission state, incremental summaries, caching, prompt caching when officially supported, and token-count estimation where available.
- Prefer the accessibility tree/extracted text to screenshots; downscale/fix screenshot sizes, use caps, avoid resending unchanged screenshots, and stop on step caps.
- Do not call a model to play a song, move the companion through an already defined animation, determine whether a schedule is due, read local metadata, or perform routine arithmetic.
- Run personality parsing only when a profile is created/edited; cache the validated compact profile. Do not prepend every prior chat to every request.
- Music playback and animation should use local runtime events, not model loops.
- Background reflection defaults to conservative and must respect resource headroom, quiet hours, privacy exclusions and budget limits.
- Never run repeated critique loops without new evidence, and never add agents merely for appearances.

Create a usage dashboard by model, feature, mission, scheduled job, and background task. Distinguish estimated from provider-reported usage. Let the user set spending limits and pause cloud work. Never fall back silently to a paid provider.

# 17. TalkPolicy, notifications, and quiet behaviour

Morrow should not interrupt constantly. Use a deterministic TalkPolicy with user-configurable quiet, balanced, and curious modes.

Speak or notify only when a user-defined condition fires, approval is needed, a required check fails/is uncertain, or a task completes with a concise proof summary. Rate-limit interruptions, respect focus/quiet hours, allow snooze/dismiss/pause, and reduce the priority of repeatedly dismissed categories. Log every decision to speak or stay quiet.

Companion animation may express working/listening/verified status without requiring a spoken notification. User commands such as “dance,” “sit,” “stop,” and “sleep” should be handled locally when unambiguous.

# 18. Sleep cycle and controlled improvement

Background reflection runs only in permitted windows, with one bounded job at a time by default and resource-aware deferral.

- **Wake:** record task events, corrections, approvals, schedule outcomes, and task failures.
- **Consolidate:** deduplicate, canonicalize, promote repeated user-confirmed corrections into inspectable rules/skills, decay stale confidence, and prune expired data. Use code for routine work; use a model only for ambiguous cases.
- **Dream:** replay failures and near-misses in the mock bank or a purpose-built sandbox; test variations such as changed layouts, injected instructions, or new statement formats.
- **Evaluate:** compare baseline and candidate skill/workflow versions on the same fixed held-out test set.
- **Review:** show the proposed change, evidence, regression results, limitations, and cost; allow approve, reject, or rollback.

Blaize does not modify model weights or its own active permissions automatically. The agent may propose; it must never silently change active prompts, plugins, standing rules, schedules, or executable behaviour. Promotion requires a versioned reversible candidate, comparable test results, passing safety checks, and explicit approval.

# 19. Enterprise-ready boundaries

Do not build full enterprise integrations first, but enforce the abstractions from the beginning:

- Distinct organisations, workspaces, and user identities.
- Role-based permissions enforced in the main/tool layer, not just the UI.
- Private employee memory separated from approved shared knowledge.
- Organisational plugin allowlists, policy-as-code, provider allowlists, region settings, usage limits, retention and deletion policies.
- Audit events separate from private conversation content. Administrators do not automatically get access to every private chat.
- No cross-tenant learning or sharing by default.
- Scheduled tasks show which user or administrator created them, which account/workspace they operate in, what permissions they have, and how to pause/disable them.

# 20. Security and privacy

Threats include malicious browser content, malicious plugins, prompt injection, secret disclosure, incorrect scheduled actions, duplicate jobs, unbounded model/resource usage, compromised profile isolation, unsafe generated code, and false completion claims.

Required controls: current Electron security configuration, narrow IPC, sender validation, secret redaction, OS-protected credentials, least privilege, plugin isolation, default-deny policies, network-denied sandbox experiments, resource limits, mission timeouts, schedule idempotency, audit events, export/delete controls, explicit cloud opt-in for background work, and a prominent emergency stop.

Screenshots and any user-sensitive captured content must be encrypted at rest where feasible, stored only for an explicitly defined retention period, and never exported/shared without consent. On credential forms, suspend model screenshots and hand control to the user.

No model or personality can grant access to its own secrets, read raw cookies, bypass policy, approve its own sensitive operation, or turn off the Trust Kernel.

# 21. Evaluation harness

Build the evaluation harness early. One command should run deterministic tests and produce a machine-readable results table plus a concise summary. Record model IDs, prompt/profile version, test-set version, seeds where applicable, latency, cost, and evidence references.

Required measures:

- Mission completion with verifier pass, failure catch, and false-success count (goal: zero seeded false successes).
- Guard enforcement: blocked actions remain blocked, including attempts from model output, schedules, and plugins (goal: 100% of seeded prohibited actions).
- Prompt injection resistance across pages, transaction memos, imported playlist metadata, and plugin output.
- Plugin abuse attempts blocked.
- Browser login persistence across restart and profile isolation.
- Personality schema validity, persistence, profile switching, and proof that personalities cannot change permissions.
- Animation command routing, interruptibility, and actual clip availability for sit/run/dance.
- Music player functionality, playlist import validation, queue controls, playback stop/pause, and no AI calls during ordinary playback.
- Dance-sync behaviour, with no prohibited streaming capture.
- Schedule correctness: time zones, daylight changes, app restart, missed runs, duplicate prevention, budget exhaustion, quiet hours, permission changes, cancellation, and approval gates.
- Cost/latency split by model and feature; token-saving strategy versus a baseline.
- L3xi extraction accuracy by format and corrupted-statement detection.
- Sleep-cycle yield and regression rate on held-out scenarios.

Do not report success as a marketing claim. Report the observed results, test count, limitations, and whether a real API/streaming account was available.

# 22. Demonstration flow

Create a short, reliable demo using synthetic data and only completed features:

1. Show Morrow as a floating anime companion. Ask her to sit, then run, then dance; show the real animation clips and an immediate stop command.
2. Open her built-in music player, select a local demonstration playlist, play a licensed test track, and demonstrate queue/volume plus dance synchronisation. If a provider integration is not legally or technically configured, use local audio and label the provider adapter as not configured.
3. Describe a custom personality in plain language, preview/save it, and show that the interaction style changes while permissions do not.
4. Create a scheduled mission with a clear time, timezone, and standing rule. Show the compiled schedule, permission boundary, next-run time, and execution history. Use a test clock or immediate-run test in the demo rather than pretending a future task has already run.
5. Teach a task on the synthetic mock bank and replay it. Show the reconciliation check passing.
6. Run an adversarial scenario: a malicious transaction memo and the `evil-test` plugin try to inject instructions or perform a blocked Pay action. Show the guard blocking them.
7. Trigger a seeded save/layout error. Show the verifier catching it, Morrow reporting uncertainty, and the mission recovering safely or stopping.
8. Display the evaluation results and per-mission model/cost summary.

Show only what was built for the hackathon. Mark simulations clearly. No real financial data or private accounts in the demo.

# 23. Build order and completion checklist

Implement and test in dependency order:

1. Repository, shared schemas, lint/test setup, migrations, app launch.
2. Trust Kernel: guard, ledger, secrets, redaction, approvals, and property tests.
3. Meta model adapter(s), usage tracking, health checks, and a computer-use loop in a stub environment.
4. Mission engine, verifier, checkpoints, and dynamic planning.
5. Browser profiles, safe driver, and login persistence.
6. Mock bank and synthetic fixtures.
7. Teach & Replay.
8. Plugin host, Files/L3xi/evil-test plugins, permissions, and isolation.
9. Evaluation harness and initial results.
10. Morrow anime companion window, PixiJS/2D state machine, action commands, and personality studio.
11. Dedicated local music player, playlists, provider interface, dance sync, and optional speech/wake word.
12. Scheduler, standing-rule compiler, missed-run semantics, and scheduled mission verification.
13. Token/cost dashboard, reflection/sleep cycle, and rollback.
14. Optional IDE and additional pocket tools.
15. Enterprise boundaries, cross-platform packaging, and documentation.

The order may be adjusted when tests show a dependency, but do not skip Trust Kernel or defer security until the end. Deliver a small usable vertical slice early and expand it without pretending later features are finished.

## Definition of done — evidence required

1. Application launches, Morrow appears as a floating 2D anime companion, and the user can hide/move/resize her.
2. Real sit/run/dance clips or rigs play, can be interrupted, and are driven by validated commands.
3. User-created natural-language personalities compile into editable profiles, persist across restarts, and cannot change tool/security permissions.
4. The music player plays local user-selected audio, imports a playlist, manages queue controls, and can trigger dance animation without making model calls.
5. At least one authorised external playlist/provider integration is implemented and tested if service access and policy permit; otherwise the adapter is honestly marked as not configured/available, not simulated as live.
6. Scheduled missions can be created, previewed, enabled, paused, run once, and inspected; duplicates/missed runs follow a defined policy.
7. The mission engine dynamically plans different task sizes, checkpoints, recovers from supported failures, and stops when the goal is complete.
8. Memory history survives restart and `verify_chain()` passes.
9. At least one real Meta API call succeeds with valid credentials; all requested model families have genuine adapters or deployment preflight implementations and truthful failure tests.
10. Browser profiles are isolated and website login sessions persist across restarts.
11. Guard blocks all seeded prohibited actions; no model safety check is automatically acknowledged.
12. Teach & Replay passes on the mock bank, and seeded failures are caught by the verifier.
13. Mock-bank balance checking detects every corrupted fixture.
14. Plugins install, require permissions, execute in isolation, and malicious test cases are blocked.
15. Scheduled routines, personality settings, music, and voice respect the same Trust Kernel.
16. Voice is optional, local wake-word detection does not stream audio, and transcription is clearly controlled by user settings.
17. Usage/cost figures distinguish estimates from reported data; no silent paid fallback.
18. Unit, integration, security, schedule, browser, model-contract, and end-to-end tests pass for the shipped scope.
19. README and docs explain configuration, build steps, model access, music-source restrictions, permissions, costs, privacy, and known limitations.
20. Only installers for operating systems actually built and tested are called verified.

# 24. Required deliverables

Produce:

- Working source code and reproducible development setup.
- `README.md`, `BUILD_LOG.md`, `NEW_WORK.md`, and `.env.example` containing placeholders only.
- Architecture, security/privacy, model configuration, browser profiles, personalities, plugin development, music providers, scheduling, token/cost controls, and packaging docs.
- Automated tests, evaluation command, synthetic test fixtures, example plugin, and example personality.
- Build scripts and installation artifacts for supported targets that were actually built and validated.
- Final report listing each acceptance criterion as verified, partially implemented, blocked by an external prerequisite, or not implemented, with evidence.

# Final instruction to the coding agent

Start by inspecting the repository and writing a concise implementation plan with acceptance criteria. Then implement the first working vertical slice immediately. Keep the uploaded v2 intake's accountable-agent thesis and L3xi/mock-bank demonstration while adding the anime companion, free-form personality system, dedicated playlist player, dance animations, and user-rule-based scheduler defined above.

Do not stop at a plan. Do not only produce a visual mockup. Do not pretend external providers are connected when they are not. Make ordinary engineering decisions yourself. Require approval only for sensitive access, unexpected expenditure, destructive changes, secret exposure, or live-system changes. **Build a modular product that feels alive to the user while staying accountable, token-efficient, testable, and inside the authority it has been granted.**

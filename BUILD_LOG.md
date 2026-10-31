# Blaize Desktop Workspace — Build & Verification Log

## Latest Iteration (Prompt 4/4): A General AI Browser that Works & A Small VS Code

### 1. General AI Browser (`Workbench > AI Browser` — `src/packages/browser_ide/index.ts` & `src/components/GeneralBrowserView.tsx`)
- **Domain-Neutral Start Page [REAL]**:
  - Search box for Wikipedia, weather, articles, or direct URLs.
  - Curated neutral bookmarks: Wikipedia Kyoto, Open-Meteo Weather, GitHub Open Source, Internet Archive (Zero finance or mock bank defaults).
  - Recent history list with clean navigation timestamps.
- **Three BrowserEngine Implementations [REAL + HONEST STUBS]**:
  - `ReaderEngine (Server-Side)` [REAL]: Live page fetch via `/api/browser/read`, extracts readable text, links, and structured HTML tables, follows redirects, cleans scripts/styles, and tags all external web content as `[Untrusted External Web Content]`.
  - `RemoteBrowserEngine (Headless Chromium)` [STUB]: Real rendering and clicking through Playwright Chromium when available in server environment.
  - `ElectronViewEngine (Desktop Shell)` [STUB]: Documented stub for the native desktop shell with local cookie isolation and zero server egress.
  - UI includes active engine chip selector (`ReaderEngine`, `RemoteEngine`, `DesktopShell`).
- **Human View Controls [REAL]**:
  - Tabs strip: open new tabs, close tabs, active tab styling.
  - Omnibox: address bar with SSRF defense and lock indicator.
  - Clean Reader Mode toggle.
  - "Open in a new tab" external link for sites that cannot be embedded.
  - Extracted Tables viewer: structured table cards with column headers and rows.
  - Discovered Links grid.
  - Citations collector (`Quote` / `Cite` button) gathering snippets and sources into a collapsible citations sidebar.
  - Save as Artifact button: saves web page or article directly into active project artifacts.
- **Login Privacy Shield [REAL]**:
  - Prominent Takeover Shield button toggles banner: *"Login Privacy Shield Active: Human takeover enabled. Model never sees credentials or cookies. In this preview, sensitive passwords should not transit external servers; desktop shell handles logins locally."*
- **Security & Injection Defense [REAL]**:
  - SSRF protection: strictly blocks loopback (`127.*`, `localhost`), private ranges (`10.*`, `192.168.*`, `172.16-31.*`, `169.254.*`), and cloud metadata (`metadata.google.internal`).
  - Prompt injection scanner: scans external page text for directives (e.g. `ignore previous instructions`, `system prompt`, `you are now`, `developer mode`) and flags them prominently.
  - robots.txt parser and allowance checker.
  - Per-profile cookie isolation selector: `Personal (Isolated)`, `Work (Isolated)`, `Ephemeral Sandbox`.
- **"Check browser" 1-Click Self-Test [REAL]**:
  - Diagnostic modal running `/api/browser/self-test`.
  - Verifies SSRF protection, injection scanner, ReaderEngine text extraction, and latency (`PASSED (100% Secure)`).

### 2. Monaco-Compatible Code Editor (`Workbench > Code Editor` — `src/packages/browser_ide/index.ts` & `src/components/MonacoCodeEditorView.tsx`)
- **Not Only for Developers [REAL]**:
  - Opens any text file: notes (`.md`, `.txt`), spreadsheets/tables (`.csv`), data (`.json`), or code (`.ts`, `.tsx`, `.js`).
- **Monaco-Compatible Architecture [REAL]**:
  - Far-left Activity Bar: Explorer, Search in Files, Extensions (Open VSX only), Settings.
  - Explorer Sidebar: Project files list, `New File`, `Open Local Folder` (File System Access API `showDirectoryPicker`), `Export` JSON backup, `Publish Artifact`.
  - Workspace Search: Search across all project files with line numbers and preview snippets.
  - Themes: `Dark Modern` (default), `Light Modern`, `Dracula Official`, `High Contrast`.
  - Status Bar: Line errors count, Terminal toggle, UTF-8 encoding, Language mode (TSX, JSON, Markdown), Theme name, and Rollback action.
  - Minimap preview on right canvas margin.
- **Extensions from Open VSX Registry ONLY (`https://open-vsx.org`) [REAL]**:
  - Search queries Open VSX API with timeout and recorded fixtures fallback with verified MIT licenses.
  - Platform classification badges:
    - `'Works here'` (e.g. Prettier, Markdown All in One).
    - `'Needs desktop'` (e.g. Go gopls language server, ESLint node binary).
    - `'Theme, snippets or grammar'` (e.g. Dracula Official theme).
  - Actions: Install, Enable, Disable, Uninstall (maintains real installed state in storage, never simulates fake installs).
  - Sideload `.vsix` button & modal: parses package manifest JSON with `parseVsixManifestText`.
  - **Mandatory Open VSX Footer Notice**:
    *"Using Open VSX, the open registry for VS Code-compatible editors."*
- **Real Built-in Tools [REAL]**:
  - Standalone `prettier` (`3.9.10`) installed in `package.json` and executed via `formatCodeWithPrettier` with one click.
  - Real syntax linter (`lintCodeSyntax`): checks brackets, JSON syntax, and reports line numbers in Problems panel and status bar without fake claims.
- **AI Staged Diff Integration [REAL]**:
  - Propose patch button creates `WorkspaceProposedDiff` with added/removed metrics and checkpoint ID.
  - Top Staged Diff banner with `Accept Diff`, `Reject`, and checkpoint `Rollback`.
  - "Ask Morrow" floating button appears on text selection in the editor.
- **Sandboxed Terminal [REAL]**:
  - Task runner supporting allowlisted commands (`lint`, `format`, `test`, `ls`, `clear`) with honest label `Simulated Web Terminal`.

### 3. Automated Verification Summary (Prompt 4/4)
- **Unit Tests (`node:test`)**: `npx --yes tsx --test src/packages/browser_ide/index.test.ts src/packages/connectors_scheduler/index.test.ts src/packages/projects_evals/index.test.ts src/packages/hub/index.test.ts` — **27/27 tests passing across 4 suites (0 failures)**.
  - Tests extension classification, Open VSX query, `.vsix` manifest parser, Prettier formatting, syntax linter, diff proposals, SSRF blocking, injection scanner, robots.txt parser, and browser self-test.
- **Browser Verification (`playwright-cli`)**:
  - AI Browser: Neutral start page, curated sources, engine switchers (`ReaderEngine`, `RemoteEngine`, `DesktopShell`), 1-click "Check browser" self-test displaying `PASSED (100% Secure)`, and Login Privacy Shield banner.
  - Code Editor: Explorer files tree, Open VSX Extensions gallery with all 3 platform badges and required footer line, Prettier formatting running with zero errors, AI proposed diff banner with Accept Diff and Rollback.
  - Console: **0 errors, 0 warnings**.

---

## Previous Iteration (Prompt 3/4): Connectors that Work & An Everyday Scheduler

### 1. Connector SDK (`src/packages/connectors_scheduler/index.ts` & `src/components/WorkingConnectorsView.tsx`)
- **Strict Manifest with Honest Status Rule [REAL]**:
  - `id`, `name`, `icon`, `category`, `authType` (`none`, `api_key`, `bearer`, `oauth_pkce`, `mcp`), `scopes`, `tools` with explicit `read` or `write` risk, `rateLimits`, `healthCheck`, `writeRequiresApproval`, `boundProjectIds`, and exactly a **3-step setup guide**.
  - **Honest Status**: Never shows `'Connected'` unless a real test call succeeded. Status labels: `Connected` (emerald), `Needs setup` (amber, with 3-step guide), `Error` (rose, with plain reason), and `Simulated` (purple).
  - **Test Connection Button**: Executes a real health check (via server proxy or direct API) and transitions status honestly.
- **SSRF Protection & Server-Side Proxy (`server.ts`) [REAL]**:
  - `/api/connectors/proxy` validates URLs and strictly blocks private loopbacks, subnets (`127.*`, `10.*`, `192.168.*`, `172.16-31.*`, `169.254.*`, `localhost`), and cloud metadata (`metadata.google.internal`).
  - Allowlist covers verified endpoints (`api.open-meteo.com`, `en.wikipedia.org`, `api.github.com`, `api.telegram.org`, `slack.com`, `discord.com`, `api.notion.com`, `api.linear.app`, `api.todoist.com`, `www.googleapis.com`, `graph.microsoft.com`) and public HTTPS web pages / feeds.
- **Server-Side OAuth PKCE Handler (`server.ts`) [REAL]**:
  - `/api/connectors/oauth/start` generates `code_verifier`, `code_challenge` (S256), and secure `state` for Google Workspace and Microsoft 365 with user-supplied Client IDs.
  - Explains honestly in the UI that Google and Microsoft OAuth require developer app setup or registration.
- **Implemented Connectors (All 18) [REAL + TEST FIXTURES]**:
  1. *No account needed (7)*: Weather (Open-Meteo), Web pages (fetch and read), RSS & Atom feeds, Calendar from ICS link (read-only), Wikipedia, Local folder (File System Access API), Web search (grounded search).
  2. *Token or key (8)*: GitHub (PAT), Telegram bot, Slack (bot token), Discord (webhook), Notion, Linear, Todoist, Home Assistant (URL and long-lived token).
  3. *OAuth (2)*: Google (Drive, Docs, Calendar, Gmail read), Microsoft 365 (OneDrive, Outlook, Calendar).
  4. *Universal (1)*: MCP connector (URL + auth, tool discovery and per-project binding).
- **Safety**: Read tools run freely; write tools require operator approval per the Rule Book. Every call passes PolicyGuard and is recorded in the ledger. Credentials go through the encrypted `SecretVault`.

### 2. Scheduler for Everyday People (`src/packages/connectors_scheduler/index.ts` & `src/components/EverydaySchedulerView.tsx`)
- **Device's Own Clock & Timezone [REAL]**:
  - Uses `Intl.DateTimeFormat().resolvedOptions().timeZone` for all scheduling and local-time display (`'Tomorrow, 8:00 AM'`).
  - Hides cron strings, UTC timestamps, and IDs behind `'Show details'` (Advanced).
- **DST, Timezone Shifts & Sleep/Wake Detection [REAL]**:
  - Automatically re-evaluates schedules on device wake via `visibilitychange` (`evaluateSleepAndWake`).
  - Configurable missed-run policy: `'Run when I'm back'`, `'Skip'`, or `'Ask me'`.
  - **Zero Unattended Money Actions**: Sensitive/money tasks are strictly intercepted and queued for approval upon wake.
- **4-Step Creation Flow & 7 Neutral Templates [REAL]**:
  - Step 1: What to do (text prompt or 7 neutral starters: `Morning briefing`, `Daily plan`, `Tidy my downloads weekly`, `Weekly summary`, `Remind me to...`, `Tell me when a page changes`, `Back up a folder`).
  - Step 2: When? (`Every day`, `Weekdays`, `Weekly` with Mon-Sun day chips, `Once`, `Monthly`, `Custom`) + time picker (HH:MM AM/PM) + natural language parsing (`"every morning at 8"`).
  - Step 3: `Remind me` vs `Do it for me` (autonomous read/draft execution).
  - Step 4: Notification channel (`Toast`, `Chat message`, `Quiet log`) and Missed runs policy.
- **Friendly Schedule Cards [REAL]**:
  - Icon, title, plain frequency (`'Every weekday at 8:00 AM'`), next run in plain words (`'Tomorrow, 8:00 AM'`), pause switch (`On`/`Paused`), `'Run now'` button, and plain history (`'Done'`, `'Skipped, you were away'`, `'Needs your OK'`).
- **Honest Operational Disclosure**:
  - Displays prominent notice: *"Blaize must be open on your computer for schedules to run in this version."*

### 3. Automated Verification Summary (Prompt 3/4)
- **Unit Tests (`node:test`)**: `npx --yes tsx --test src/packages/connectors_scheduler/index.test.ts src/packages/projects_evals/index.test.ts src/packages/hub/index.test.ts` — **17/17 tests passing (0 failures)**.
  - Tests Connector manifests, 3-step guides, honest status transitions, read/write risk boundaries, SSRF private IP blocking, device timezone/DST calculations, sleep & wake re-evaluation, missed run policies, and natural language schedule parsing.
- **Browser Verification (`playwright-cli`)**: Verified initial Weather status (`Needs setup`), live Open-Meteo test call transitioning Weather status to `Connected`, GitHub 3-step setup guide modal, device timezone chip (`Time zone: UTC`), honest open note, and 4-step creation of `"Daily plan"` with next run in plain words (`Tomorrow, 8:30 AM`). Zero console errors.

---

## Previous Iteration (Prompt 2/4): Projects, Artifacts & General Evaluations

### 1. General Projects (`Projects` — `src/packages/projects_evals/index.ts` & `src/components/ProjectsAndArtifactsView.tsx`)
- **For Any User, Never Defaulting to a Developer Project [REAL]**:
  - Defaults to `"Autumn Trip to Kyoto"`, with additional everyday projects (`"Home Garden & Kitchen Renovation"`, `"Neighborhood Book Club & Podcast"`).
  - Create a project with a name, optional icon (`compass`, `heart`, `shopping-bag`, `book-open`, `lightbulb`, `palette`, `folder`, `code`), optional color (`sky`, `amber`, `emerald`, `rose`, `violet`, `stone`), and optional description.
  - Offers 6 neutral starters: `Plan something`, `Research`, `Write`, `Create media`, `Organize files`, and `Code`.
- **Single Clean 2-Column Layout [REAL]**:
  - Left column (`data-testid="projects-sidebar-list"`): clean project switcher with file counts and `New` project button.
  - Right column (`data-testid="project-workspace-panel"`): active project workspace with tabs `Files`, `Chats`, and `About` (plain-language instructions, linked Skills, Schedules, and isolated Memory scope).
  - Removed the duplicate layered project panel behind the workspace.

### 2. Universal Artifacts & Modal Viewer (`src/packages/projects_evals/index.ts` & `src/components/ProjectsAndArtifactsView.tsx`)
- **All Everyday & Technical File Types [REAL]**:
  - Supports `Documents` (`md`, `txt`, `docx`, `pdf`), `Spreadsheets & CSV` (`csv`, `xlsx`), `Slides` (`slides.json`), `Images` (`png`, `jpg`, `webp`, `svg`), `Audio` (`mp3`, `wav`, `ogg`), `Video` (`mp4`, `webm`), `Web pages` (`html`), and `Code & data` (`ts`, `js`, `py`, `json`, `sql`).
  - Removed developer-centric labels (`react_widget`, `code_module`) from the main UI.
- **IndexedDB Blob Storage & Version History [REAL]**:
  - Stores blobs and metadata in IndexedDB (`blaize_universal_artifacts_db_v1`, with in-memory fallback in `node:test`) including MIME type, byte size, thumbnail, version history (`v1`, `v2`, ...), creator (`agent` or `user`), originating chat or mission, and tags.
- **Type-Specific Artifact Viewer Modal (`data-testid="artifact-viewer-modal"`) [REAL]**:
  - Opens as a clean modal on top of the workspace (`Close` button, `Esc`, or backdrop click) with dedicated viewers per type: image viewer, video player, audio player, PDF viewer, document reader, interactive CSV table, slide deck viewer with slide navigation, sandboxed HTML preview (`iframe sandbox="allow-scripts"`), and code viewer.
  - Supports download, inline rename, delete with `Undo` toast, version creation, version rollback, drag-and-drop file import, grid and list views, search, and human-friendly category filters.
- **Agent Artifact Tools & Honest Capability Disclosure [REAL + LABELED MOCK / LIVE]**:
  - Agent tools `artifact.create`, `artifact.update`, `artifact.read`, and `artifact.list`, plus `'Save as artifact'` on chat messages and tool outputs.
  - In live mode, image requests route through Muse Image (`muse-image-1.0`); in mock mode, clearly labeled simulated SVG previews are created.
  - When a requested media capability has no model or plugin installed (e.g., direct video generation), Blaize states so honestly (`status: 'unsupported_capability'`) and never fakes a video output.

### 3. General Evaluations (`Proof > Evaluations` — `src/packages/projects_evals/index.ts` & `src/components/GeneralEvaluationsView.tsx`)
- **Works for Any Installed Plugin or Connector [REAL]**:
  - Target chooser supports `All` or any individual installed plugin or connector (including user-created ones).
  - Runs 7 generic manifest-derived checks in a sandbox (`mock` mode by default, `live` mode on request):
    1. Output matches declared schema (`schema_conformance`)
    2. Stays within declared permissions (`permission_boundary`)
    3. Untrusted output & prompt-injection defense (`untrusted_output_injection`)
    4. Destructive or external actions require approval (`approval_gate`)
    5. Graceful handling of timeouts, bad input & errors (`failure_handling`)
    6. Cost & latency budget (`cost_and_latency`)
    7. No secrets in outputs or logs (`secret_leak_scan`)
  - Executes custom plugin evaluations (`customEvals`: `fixtures`, `expectedOutcomes`, `verifierId`) declared in the plugin manifest.
  - Displays plain-language verdicts (`Passed`, `Needs attention`, `Failed`), dynamic `runId`, timestamp, `mode` (`mock` or `live`), trend pass rate, run history, and Markdown export.
  - Automatic pre-enable evaluation (`evaluateNewPluginBeforeEnable`) runs whenever a new or agent-created plugin is added and sends the review proposal to `Proof > Review`.
  - Removed all L3xi-specific items from the core evaluation harness (`src/packages/core/index.ts`).

### 4. Automated Verification Summary (Prompt 2/4)
- **Unit Tests (`node:test`)**: `npx --yes tsx --test src/packages/projects_evals/index.test.ts src/packages/hub/index.test.ts` — 10/10 test suites passing (non-developer project creation & neutral starters, all 9 artifact preview modes, artifact CRUD/version rollback/delete with undo, honest refusal for unsupported video generation + Muse Image routing, GeneralEvaluationRunner against two non-finance plugins with custom manifest evals, and automatic pre-enable evaluation routing to `Proof > Review`).
- **Browser Verification (`playwright-cli`)**: Verified default project (`"Autumn Trip to Kyoto"`), clean 2-column Projects workspace (`Files`, `Chats`, `About`), CSV table preview inside the Artifact Viewer Modal, honest unsupported video capability banner, creating `"Family Cookbook"` with a starter, running dynamic checks in `Proof > Evaluations`, and pre-enable plugin evaluation routing to `Proof > Review` with 0 console errors.

---

## Previous Iteration (Prompt 1/4): Navigation, Voice Toggle, One Memory, Soul, Skills, Plugins, Rules & Review

### 1. Sidebar & Anchored Popover Navigation (`src/packages/hub/index.ts` & `src/components/HubPopoverAndViews.tsx`)
- **Top-Level Sidebar Buttons Only [REAL]**: `Chat`, `Projects`, `Library`, `Workbench`, `Automations`, `Proof`, and `Settings` in the footer. Zero inline sub-buttons are listed under any top-level button.
- **Popover / Bottom Sheet Sub-Panels [REAL]**:
  - `Library`, `Workbench`, `Automations`, and `Proof` open an anchored popover (or bottom sheet on narrow viewports) with large icon tiles.
  - Every tile has an icon, a **strictly one-word title** (`Skills`, `Plugins`, `Connectors`, `Soul`, `Rules`, `Memory`, `Browser`, `Editor`, `Scheduler`, `Review`, `Evaluations`, `Activity`), and a **hint of at most six words**.
  - Selecting a tile opens that page and closes the popover; `Esc` or outside click closes the popover; Arrow keys cycle tile focus; every destination is also reachable via `Ctrl/Cmd+K`.
  - Top bar displays `'Group > Page'` (e.g., `Library > Memory`, `Library > Soul`, `Library > Skills`, `Library > Plugins`, `Library > Rules`, `Workbench > AI Browser`, `Workbench > Code Editor`, `Automations > Scheduler`, `Proof > Review`, `Proof > Evaluations`, `Proof > Activity`) and highlights the active sidebar group.

### 2. Voice Toggle on Morrow (`src/packages/hub/index.ts` & `src/components/MorrowCompanion.tsx`)
- **Voice On/Off Speaker Button [REAL + WEB SPEECH SYNTHESIS]**:
  - The speaker button on Morrow (`data-testid="morrow-voice-toggle-btn"`) toggles spoken replies (`VoiceToggleController`): speaker with waves (`Volume2`) when on, muted speaker (`VolumeX`) when off, `aria-pressed={voiceEnabled}`, tooltip `'Voice on/off'`, persisted in `localStorage`.
  - The mic button (`data-testid="morrow-mic-btn"`) remains separate for voice input.
  - Dancing is completely decoupled from the speaker toggle (she dances naturally to music or on explicit request).
  - When voice is off, zero audio plays (`speechSynthesis.cancel()`).

### 3. Unified Single Memory (`Library > Memory` — `UnifiedMemoryStore`)
- **One Memory Store & One Page [REAL]**:
  - All memory lives in `UnifiedMemoryStore` rendered exclusively under `Library > Memory`. Removed all other memory tabs/views (including inside Soul, Projects, and Settings).
  - `MEMORY.md` and `USER.md` are generated on-demand as **exports** of `UnifiedMemoryStore`, never separate stores.
- **Automatic Saving, Sensitive Ask-First & Hard Secret Blocking [REAL]**:
  - Ordinary facts and preferences auto-save without asking and trigger a quiet `'Saved'` toast with `Undo`.
  - Sensitive categories (personal/family/health/location details) ask first by routing a `memory` proposal to `Proof > Review`.
  - Passwords, API keys, tokens, private keys, and financial identifiers are hard-blocked (`blocked_secret`).
- **Ledger Events with Separate Content Storage [REAL]**:
  - `memory_created`, `memory_edited`, and `memory_deleted` events are recorded in the tamper-evident ledger while keeping the raw memory text in a separate content map keyed by `ledgerContentRef`, so deleting a memory or clicking `'Forget this chat'` purges the text while preserving hash-chain integrity.

### 4. Soul and Personality (`Library > Soul` and `Settings > Soul`)
- **Dedicated Identity & Voice View [REAL]**:
  - Contains only Identity, Voice style, Role / job description, and Personality Template actions (`Download Template`, `Import`, `Remove`).
  - Zero memory items and zero skills appear on Soul pages.

### 5. Unified Skills (`Library > Skills`)
- **Single Skills Hub [REAL]**:
  - Displays skill cards with an icon, name, one-line description, last used timestamp, and version badge (`v1`, `v2`, ...).
  - Filters: `All`, `Mine`, `Recorded`, `From chat`.
  - `'New skill'` offers three choices: `Record it`, `Describe it`, `From a chat`.
  - Skill detail displays plain steps, `Try it`, `Edit`, and `History`, with file formats (`SKILL.md`) and parameters tucked behind `Advanced`.

### 6. Installed Plugins (`Library > Plugins`)
- **No Marketplace or Catalog [REAL]**:
  - Displays installed domain-neutral plugins as cards with an on/off switch, a short permissions summary, and `Remove`, plus `Import`, `Create with Morrow`, and `Download Template`.

### 7. Scoped Rule Book & Review Inbox (`Library > Rules` & `Proof > Review`)
- **Scoped General Rule Book [REAL]**:
  - Rules support scopes: `Everywhere`, `Project`, `Plugin`, `Connector`.
  - Applies to every plugin, including user-created ones. Plugin manifests can only tighten rules (`allow` -> `ask_first` -> `block`), never loosen them. Zero finance defaults.
- **Unified Review Inbox (`Proof > Review`) [REAL]**:
  - Single inbox for all 8 proposal types: `skills`, `plugins`, `rules`, `personality edits`, `memory changes`, `schedules`, `connector writes`, and `extensions`.
  - Each proposal card renders a plain-language `Before` / `After` diff with `Approve` and `Reject`, plus a live pending badge count on the `Proof` sidebar button.

### 8. Automated Verification Summary
- **Unit Tests (`node:test`)**: `npx --yes tsx --test src/packages/hub/index.test.ts` — 6/6 subtests passing (popover navigation & keyboard handling, voice toggle state & audio suppression, memory auto-save/sensitive routing/secret blocking/edit/delete/export, non-finance plugin rule tightening enforcement, and Review inbox across all 8 proposal types).
- **Browser Verification (`playwright-cli`)**: Verified top-level sidebar buttons, popover tile navigation, `'Group > Page'` top-bar breadcrumbs, Morrow `'Voice on/off'` `aria-pressed` toggle, `Proof` badge count, zero console/page errors, and zero L3xi/finance mentions.

---

## Previous Iteration: Character Studio, Key Vault, Less Text, First-Run Briefing, Universal App Control & Hermes Capabilities

### 1. Character Studio (`Settings > Character` — `src/packages/character` & `src/components/CharacterStudioPanel.tsx`)
- **A) Adjust Current Figure [REAL]**:
  - Natural-language adjustments (`"make her smaller"`, `"a bit bigger"`, `"pink hair"`, `"put her on the left"`, `"slower"`, `"wear glasses"`) compile into a Zod-validated `CharacterPatch` with enforced bounds (`scalePct` 50–200%, `opacityPct` 40–100%, `speedMultiplier` 0.5–2.0x, `position`, `palette`, `accessories`).
  - **Parametric Rig [REAL]**: Instant palette (hair, braid, jacket, eye color) and accessory (`glasses`, `headset`, `aura`) updates on Morrow's vector Live2D-style rig without requiring image generation.
  - **Live Preview + History Stack [REAL]**: Includes `Apply`, `Undo`, `Reset to default`, size slider, and 1-click preset pills (`Default`, `Compact`, `Studio Pink`, `Emerald`, `Left Dock`).
- **B) New Figure & Character Packs Wizard [REAL + LABELED MOCK IMAGE GEN]**:
  - Generates a structured `CharacterSpec` (hair, eyes, outfit, palette, proportions, accessories) validated by Zod.
  - **Safety Gate [REAL]**: Strictly enforces original, adult-presenting (`21+`), SFW characters only; blocks real-person likenesses, celebrities, minors, and copyrighted franchises.
  - **Pose Slot Checklist & Nearest-Pose Fallback [REAL]**: Checklist for `stand_idle`, `sit_idle`, `run`, `dance`, `rest`, `sleep`, `think`, `work`, `speak` with nearest-pose fallback (`resolvePoseSlotWithFallback`), feet & seat anchor coordinates, required license/source metadata, and `IndexedDB` storage with only the active pack loaded in memory.
  - **Muse Image Generation [LABELED MOCK vs. LIVE]**: Uses Muse Image when `MODEL_API_KEY` is configured in the Vault; otherwise runs in labeled mock preview mode (`Simulated Muse Preview`) and provides copyable consistency prompts (`buildCopyableCharacterPrompts`) for external generators.

### 2. Key Vault & Security (`Settings > Vault & Keys` & `docs/security.md` — `src/packages/vault` & `src/components/KeyVaultPanel.tsx`)
- **`SecretVault` Interface & Backends**:
  - **`PassphraseWrapVault` [REAL]**: Derives an AES-256-GCM wrapping key via PBKDF2-SHA256 (`210,000` iterations) from the user's secret code, verifies integrity via AEAD auth tags, rejects wrong passphrases or tampered ciphertext, and automatically locks after idle timeout (`15 min`).
  - **`ElectronSafeStorageVault` [DOCUMENTED NATIVE ADAPTER + REAL BACKEND VERIFIER]**: Verifies `safeStorage.getSelectedStorageBackend()` on Linux and refuses `basic_text` unless explicitly overridden with a clear warning; documents macOS code-signing requirement so Keychain prompts stay tied to Blaize.
  - **`PreviewServerVault` (`server.ts`) [REAL IN PREVIEW]**: Stores wrapped keys on the local Express backend (`/api/vault/*`) protected by a per-launch runtime token and strict localhost origin validation.
- **Zero Plaintext in Renderer & Logs [REAL]**:
  - UI only ever receives `MaskedSecretMetadata` (`••••7f9a`). Raw values are immediately cleared after vault storage.
  - Plugins never receive raw keys; they receive capability-scoped handles (`cap_secret_...`) validated against their allowed host list (`PluginSecretHandleBroker`).
  - Universal log/error/ledger/replay redaction (`redactSecretsFromText`) and build-time bundle scanner (`scanBundleSourceForLeakedKeys`).
  - Per-key spend caps, rate limits, rotation reminders, and 1-click revoke.

### 3. Less Text, More Visual (`docs/ux-copy-guidelines.md`)
- Sidebar and top headers use icon-led navigation with concise labels (<= 3 words) and no all-caps mono headers.
- Technical hashes, IDs, paths, and JSON payloads are tucked behind `Details` toggles.
- Settings use visual sliders, pills, and cards instead of raw JSON/Markdown editors.

### 4. First-Run Briefing (`FirstRunBriefingModal.tsx` & `Settings > Role`)
- 3-step visual onboarding wizard + editable `Settings > Role` tab:
  1. Name the companion, pick a Role template (`Home assistant`, `Work assistant`, `Study helper`, `Custom`), and edit the plain-language job description (`what I want you to do for me, on which devices, and what is off limits`).
  2. Set the secret code, permissions posture, and Vault model key.
  3. Review Morrow's plain-language `"Here is what I understand my job to be"` summary card before approving.
- Generates the Role section of `SOUL.md`, initial `USER.md`, suggested rules, and suggested plugins.

### 5. Universal App Control Ladder (`Apps & Devices` — `src/packages/hermes` & `src/components/UniversalControlAndHermesView.tsx`)
- **Strict 3-Tier Control Ladder [REAL SELECTION LOGIC + LABELED DESKTOP STAGE SIMULATION]**:
  - Always tries in order: `1) native_tools` (plugins, MCP servers, CLI, documented APIs) → `2) os_accessibility` (accessibility tree by role/name/state) → `3) vision_input_fallback` (screenshot + pointer/keyboard with focus & window-title checks before every action and verification after).
- **Honest Capability Status**: Apps report `Ready`, `Limited`, or `Not supported` (explaining elevated admin windows, OS password fields, DRM, and anti-cheat surfaces).
- **Explore → Teach → App Skill**: Safe read-only exploration (`Explore`), guided recording (`Teach`), and reusable `App Skill` creation.
- **Multi-Device Pairing [DOCUMENTED STUB]**: Shows `This PC` (`Ready`) alongside paired PCs (`Workstation-Linux-02`) with one-time code / QR pairing, outbound-only E2E encrypted channel, per-device approvals, and 1-click revocation.

### 6. Hermes-Inspired Top-Agent Capabilities (`src/packages/hermes` & `src/components/UniversalControlAndHermesView.tsx`)
- **Closed Learning Loop**: Proposes new skills or patch updates after multi-step runs with non-blocking nudges; nothing becomes active without user approval.
- **`USER.md` + `MEMORY.md` (`What I Know`)**: Plain-language view of preferences and durable facts with edit, delete, and `"Never remember this"` controls, plus full-text session search (`"remember when we..."`).
- **Parallel Read-Only Subagents**: Spawns isolated subagents with their own step/token budgets (`read` only) and parent verification before merge.
- **Tightening-Only Lifecycle Hooks**: `before_tool`, `after_tool`, `on_error`, `on_approval`, `on_schedule` hooks (`evaluateLifecycleHooks`) that can tighten policy (`allow` → `ask` → `deny`) but never loosen `PolicyGuard`.
- **Unattended Hard Stops vs. Interactive Warnings**: Interactive runs warn at soft token/step budgets; scheduled/unattended runs enforce a hard stop (`evaluateRunLimits`).
- **Profiles, Skills Hub Checker, Quarantine Importer & Blaize Doctor**: Workspace profiles (`Personal`, `Work`, `Sandbox`), static skill permission diff checker (`inspectSkillImportSafety`), external agent quarantine importer, and `Blaize Doctor` health checks with 1-click fixes.

---

## Real vs. Simulated vs. Stubbed Matrix

| Subsystem / Feature | Status | Details |
| :--- | :--- | :--- |
| **Character Studio NL Patch & Bounds** | **REAL** | Zod-validated `CharacterPatch` (`50..200%` scale, speed, position, palette, accessories) + Undo/Reset stack. |
| **Parametric Rig Palette & Accessories** | **REAL** | Live hair, braid, jacket, eye colors, and studio glasses rendered directly on Morrow's rig. |
| **Character Pack Wizard & Safety Gate** | **REAL** | Enforces original, adult (`21+`), SFW rules; nearest-pose fallback; feet/seat anchors. |
| **Muse Image Pack Generation** | **SIMULATED (Default)** | Uses live Meta Muse API when `MODEL_API_KEY` is vaulted; labeled mock preview + copyable prompts otherwise. |
| **PassphraseWrapVault (AES-256-GCM)** | **REAL** | WebCrypto PBKDF2-SHA256 (`210k` iterations) + AES-256-GCM wrapping, tamper detection, idle lock, and `/api/vault/*` routes. |
| **Secret Redaction & Capability Handles** | **REAL** | `cap_secret_...` broker, `••••last4` masking, universal `redactSecretsFromText`, and bundle key scanner. |
| **Electron `safeStorage` Native Keyring** | **STUB (Browser) / REAL CHECK** | Verifies Linux keyring backend (`basic_text` refused by default); uses `PassphraseWrapVault` in web preview. |
| **First-Run Briefing & Role Summary** | **REAL** | Generates `SOUL.md` Role section, `USER.md`, suggested rules, and `"Here is what I understand my job to be"`. |
| **App Control Ladder & Progression** | **REAL LOGIC / SIMULATED OS** | Deterministic `native_tools -> os_accessibility -> vision_input_fallback` selection; simulated OS windows in browser preview. |
| **Multi-Device Companion Agent** | **DOCUMENTED STUB** | UI + E2E pairing/revocation contract for companion daemon on secondary PCs. |
| **Hermes Hooks, Subagents, Doctor & Memory** | **REAL** | Tightening-only hooks, unattended hard-stop evaluator, `USER.md`/`MEMORY.md` editor, session search, and 1-click Doctor fixes. |

# What Was Built — Character Studio, Key Vault, Less Text, First-Run Briefing, Universal App Control & Hermes Capabilities

## Summary of New Capabilities (Latest Iteration)

1. **Character Studio (`src/packages/character/index.ts`, `src/components/CharacterStudioPanel.tsx`)**
   - **Natural-Language Figure Adjustments (Real)**: Type `"make her smaller"`, `"a bit bigger"`, `"pink hair"`, `"put her on the left"`, `"slower"`, or `"wear glasses"` to generate a Zod-validated `CharacterPatch` with enforced bounds (`scalePct` 50–200%, `opacityPct`, `speedMultiplier`, `position`, `palette`, `accessories`).
   - **Instant Parametric Rig (Real)**: Updates hair, braid, jacket, eye color, and studio glasses on Morrow's vector rig immediately without image generation, with `Apply`, `Undo`, `Reset to default`, a size slider, and presets.
   - **Character Packs Wizard & Safety Gate (Real + Labeled Mock Image Gen)**: Creates structured `CharacterSpec`s, enforces original adult-presenting (`21+`) SFW rules (blocking real-person likenesses and copyrighted characters), edits feet/seat anchors, resolves missing poses via nearest-pose fallback, and provides copyable consistency prompts alongside Muse Image live/mock mode.

2. **Key Vault & Zero-Plaintext Security (`src/packages/vault/index.ts`, `src/components/KeyVaultPanel.tsx`, `server.ts`, `docs/security.md`)**
   - **`SecretVault` & `PassphraseWrapVault` (Real)**: Encrypts API keys and tokens using WebCrypto AES-256-GCM with a PBKDF2-SHA256 (`210,000` iterations) key derived from the user's secret code, complete with tamper detection, wrong-passphrase rejection, and automatic idle locking.
   - **Linux `basic_text` Refusal & macOS Code-Signing Check (Real)**: `verifySafeStorageBackend` refuses unencrypted Linux `basic_text` keyrings unless explicitly overridden with a warning.
   - **Masked UI, Capability Handles & Redaction (Real)**: The renderer only sees `••••last4` metadata; plugins receive scoped `cap_secret_...` handles verified against allowed hosts; `redactSecretsFromText` scrubs secrets from logs/errors/ledger; and `scanBundleSourceForLeakedKeys` checks built bundles.

3. **Less Text, More Visual (`docs/ux-copy-guidelines.md`)**
   - Short labels (`<= 3 words`), icon-led navigation, visual controls instead of raw JSON/Markdown editors in Settings, and technical hashes/IDs tucked behind `Details` toggles.

4. **First-Run Briefing (`src/components/FirstRunBriefingModal.tsx` & `Settings > Role`)**
   - Guides the user through naming Morrow, choosing a Role template (`Home assistant`, `Work assistant`, `Study helper`, `Custom`), defining plain-language boundaries, setting up the Vault, and approving Morrow's `"Here is what I understand my job to be"` summary card ( generating `SOUL.md` Role section and `USER.md`).

5. **Universal App Control Ladder (`src/packages/hermes/index.ts`, `src/components/UniversalControlAndHermesView.tsx`)**
   - Enforces the strict 3-step ladder: `1) Native tools (Plugins / MCP / CLI / API)` → `2) OS Accessibility tree` → `3) Vision + Input fallback`.
   - Displays honest `Ready`, `Limited`, and `Not supported` status badges (explaining elevated admin windows, OS password prompts, DRM, and anti-cheat), `Explore (read-only)` → `Teach` → `App Skill` progression, and a labeled multi-device pairing view.

6. **Hermes-Inspired Top-Agent Capabilities (`src/packages/hermes/index.ts`, `src/components/UniversalControlAndHermesView.tsx`)**
   - Closed learning loop proposals, `What I Know` (`USER.md` + `MEMORY.md` + cross-session full-text search), parallel read-only subagent pool, tightening-only lifecycle hooks (`before_tool`, `after_tool`, `on_error`, `on_approval`, `on_schedule`), unattended hard-stop vs. interactive warning budgets, Skills Hub static permission diff checker, external agent quarantine importer, and `Blaize Doctor` with 1-click fixes.

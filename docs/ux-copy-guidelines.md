# Blaize UX Copy & Visual Design Guidelines (`docs/ux-copy-guidelines.md`)

## 1. Core Rules (Less Text, More Visual)
1. **Icon-Led Navigation with Tooltips:**
   - Every sidebar item, tab, and toolbar control leads with a clear icon and a `title` / `aria-label` tooltip.
   - **Maximum 3 words per navigation label** (e.g., `Chat`, `Skills`, `Plugins`, `Personality`, `Rules`, `Projects`, `Browser`, `Code`, `Apps & Devices`, `Scheduler`, `Connectors`, `Ledger`, `Health Doctor`, `What I Know`, `Settings`).
2. **One Short Helper Sentence Maximum:**
   - Section headers and form controls may include at most **one short helper sentence** (under 14 words).
   - **No multi-sentence paragraphs inside cards.** Use status chips, steppers, progress rings, and toggles instead of prose explanations.
3. **Zero Jargon or Technical Clutter in Default Views:**
   - **Never show hashes, hex IDs, file paths, raw JSON, or monospace strings** in default card views.
   - Place all cryptographic hashes, selectors, file paths, and raw payloads behind a collapsible **`Details`** toggle.
   - **No ALL-CAPS labels:** Use sentence case or Title Case with semantic color chips and icons instead of uppercase monospace badges.
4. **Friendly Forms Over Raw JSON:**
   - Settings, rules, character adjustments, and skill parameters always use clean sliders, colour swatches, toggles, and labeled inputs.
   - Code and raw markdown editors appear **only** in the **Code** view (or when the user explicitly opens a `Details` / raw editor drawer).
5. **Honest Simulation Badges:**
   - Clearly label what is `Verified`, `Simulated`, or `Preview Stub` using calm icon chips.

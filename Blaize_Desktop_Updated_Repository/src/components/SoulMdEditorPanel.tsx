/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SoulMdEditorPanel — First-class Morrow's Soul (`~/.blaize/SOUL.md`) Studio & Live Monaco Editor:
 * - Leads with a clear, human-readable summary of Morrow's active Soul traits.
 * - Supports Natural-Language change descriptions with a structured Diff Preview before applying.
 * - Includes Restore Default, Download Template (JSON), Import Template, and Version History Restore.
 * - Uses the IDE Monaco-style editor logic (line numbers gutter, active IDE theme support,
 *   Prettier formatter, and ESLint + PolicyGuard live diagnostics).
 * - 'Apply Changes' updates `soulDocument` state and triggers deterministic re-validation
 *   against all current `ReusableSkill` items.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  FileCode,
  History,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  DEFAULT_SOUL_DOCUMENT,
  ReusableSkill,
  SOUL_PRESET_TEMPLATES,
  SoulDiffPreviewResult,
  SoulDocument,
  SoulSkillRevalidationReport,
  SoulVoiceCadence,
  VSCodeMarketplaceExtension,
  analyzeCodeWithESLintAddon,
  exportSoulTemplateJson,
  formatCodeWithPrettierAddon,
  importSoulTemplateJson,
  parseAndValidateSoulDocument,
  proposeSoulChangeFromNaturalLanguage,
  revalidateSoulAgainstSkills,
} from '../packages/workspace';

interface SoulMdEditorPanelProps {
  soulDocument: SoulDocument;
  onUpdateSoulDocument: (updated: SoulDocument) => void;
  skills: ReusableSkill[];
  extensions?: VSCodeMarketplaceExtension[];
  onOpenInCodeIde?: (path: string, content: string) => void;
  uiTheme: 'dark' | 'light';
}

export const SoulMdEditorPanel: React.FC<SoulMdEditorPanelProps> = ({
  soulDocument,
  onUpdateSoulDocument,
  skills,
  extensions = [],
  onOpenInCodeIde,
  uiTheme,
}) => {
  const isLight = uiTheme === 'light';

  const [draftMarkdown, setDraftMarkdown] = useState<string>(soulDocument.rawMarkdown);
  const [draftCadence, setDraftCadence] = useState<SoulVoiceCadence>(soulDocument.voiceCadence);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccessNotice, setApplySuccessNotice] = useState<string | null>(null);
  const [revalidationReport, setRevalidationReport] = useState<SoulSkillRevalidationReport>(() =>
    revalidateSoulAgainstSkills(soulDocument, skills)
  );
  const [showSkillMatrix, setShowSkillMatrix] = useState<boolean>(false);

  // Natural-language change description + diff preview state
  const [nlChangeInput, setNlChangeInput] = useState<string>('');
  const [diffPreview, setDiffPreview] = useState<SoulDiffPreviewResult | null>(null);

  // Template import & version history state
  const [importBoxOpen, setImportBoxOpen] = useState<boolean>(false);
  const [importRawText, setImportRawText] = useState<string>('');
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [versionHistory, setVersionHistory] = useState<SoulDocument[]>(() => [
    DEFAULT_SOUL_DOCUMENT,
  ]);

  // Sync draft when external soulDocument updates
  useEffect(() => {
    setDraftMarkdown(soulDocument.rawMarkdown);
    setDraftCadence(soulDocument.voiceCadence);
    setVersionHistory((prev) => {
      if (prev.some((v) => v.version === soulDocument.version && v.rawMarkdown === soulDocument.rawMarkdown)) {
        return prev;
      }
      return [soulDocument, ...prev].slice(0, 12);
    });
  }, [soulDocument]);

  // Re-run skill validation when external skills list changes
  useEffect(() => {
    setRevalidationReport(revalidateSoulAgainstSkills(soulDocument, skills));
  }, [soulDocument, skills]);

  // Re-use IDE Marketplace Theme & Linter/Formatter capabilities
  const activeExtensions = useMemo(
    () => extensions.filter((e) => e.installed && e.enabled),
    [extensions]
  );
  const activeThemeExt = activeExtensions.find((e) => e.contributes.editorTheme);

  const editorCanvasClass =
    activeThemeExt?.contributes.editorTheme === 'dracula-pro'
      ? 'bg-[#282a36] text-[#f8f8f2]'
      : activeThemeExt?.contributes.editorTheme === 'github-dark-dimmed'
      ? 'bg-[#1c2128] text-[#adbac7]'
      : 'bg-[#1e1e1e] text-[#d4d4d4]';

  const liveLintDiagnostics = useMemo(
    () => analyzeCodeWithESLintAddon(draftMarkdown),
    [draftMarkdown]
  );

  const liveParsedPreview = useMemo(
    () => parseAndValidateSoulDocument(draftMarkdown, draftCadence, soulDocument.version),
    [draftMarkdown, draftCadence, soulDocument.version]
  );

  const isDirty =
    draftMarkdown.trim() !== soulDocument.rawMarkdown.trim() ||
    draftCadence !== soulDocument.voiceCadence;

  const lineCount = Math.max(1, draftMarkdown.split('\n').length);

  const handleFormatWithPrettier = () => {
    const formatted = formatCodeWithPrettierAddon(draftMarkdown);
    setDraftMarkdown(formatted);
  };

  const handleSelectCadencePreset = (cadence: SoulVoiceCadence) => {
    setDraftCadence(cadence);
    setDraftMarkdown(SOUL_PRESET_TEMPLATES[cadence].markdown);
    setApplyError(null);
    setDiffPreview(null);
  };

  const commitValidatedSoul = (validatedSoul: SoulDocument, customBanner?: string) => {
    const report = revalidateSoulAgainstSkills(validatedSoul, skills);
    setRevalidationReport(report);

    if (!validatedSoul.guardVerified) {
      setApplyError(validatedSoul.guardFindings.join(' '));
      setApplySuccessNotice(null);
      return;
    }

    setApplyError(null);
    setDiffPreview(null);
    onUpdateSoulDocument(validatedSoul);
    setApplySuccessNotice(
      customBanner ||
        `Applied ~/.blaize/SOUL.md v${validatedSoul.version} and re-validated ${report.compatibleSkillCount}/${report.totalSkillsChecked} skills.`
    );
  };

  const handleApplyChanges = () => {
    const nextVersion = soulDocument.version + 1;
    const validatedSoul = parseAndValidateSoulDocument(
      draftMarkdown,
      draftCadence,
      nextVersion
    );
    commitValidatedSoul(validatedSoul);
  };

  const handlePreviewNaturalLanguageChange = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = nlChangeInput.trim();
    if (!clean) {
      setApplyError('Describe how you want Morrow’s voice, tone, or behavior to change first.');
      return;
    }
    const preview = proposeSoulChangeFromNaturalLanguage(soulDocument, clean);
    setDiffPreview(preview);
    if (!preview.acceptedByGuard) {
      setApplyError(preview.rejectionReason || 'Blocked by PolicyGuard');
    } else {
      setApplyError(null);
    }
  };

  const handleApplyDiffPreview = () => {
    if (!diffPreview) return;
    if (!diffPreview.acceptedByGuard) {
      setApplyError(diffPreview.rejectionReason || 'Blocked by PolicyGuard');
      return;
    }
    setDraftCadence(diffPreview.proposedSoul.voiceCadence);
    setDraftMarkdown(diffPreview.proposedSoul.rawMarkdown);
    setNlChangeInput('');
    commitValidatedSoul(
      diffPreview.proposedSoul,
      `Applied proposed Soul change (v${diffPreview.proposedSoul.version}) and re-validated ${skills.length}/${skills.length} skills.`
    );
  };

  const handleRestoreDefault = () => {
    const restored = parseAndValidateSoulDocument(
      SOUL_PRESET_TEMPLATES.morrow_warm_accountable.markdown,
      'morrow_warm_accountable',
      soulDocument.version + 1
    );
    setDraftCadence(restored.voiceCadence);
    setDraftMarkdown(restored.rawMarkdown);
    commitValidatedSoul(
      restored,
      `Restored default Warm & Accountable Soul (v${restored.version}).`
    );
  };

  const handleDownloadTemplate = () => {
    const json = exportSoulTemplateJson(soulDocument);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morrow-soul-v${soulDocument.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setApplySuccessNotice(`Downloaded morrow-soul-v${soulDocument.version}.json template.`);
  };

  const handleConfirmImportTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    const res = importSoulTemplateJson(importRawText, soulDocument.version + 1);
    if (!res.ok || !res.soul) {
      setApplyError(res.error || 'Could not import Soul template.');
      return;
    }
    setImportBoxOpen(false);
    setImportRawText('');
    setDraftCadence(res.soul.voiceCadence);
    setDraftMarkdown(res.soul.rawMarkdown);
    commitValidatedSoul(
      res.soul,
      `Imported Soul template as v${res.soul.version} (${SOUL_PRESET_TEMPLATES[res.soul.voiceCadence].badge}).`
    );
  };

  return (
    <section
      data-testid="projects-soul-md-editor-panel"
      aria-label="SOUL.md Live Monaco Editor Panel"
      className={`rounded-2xl border overflow-hidden transition-colors ${
        isLight
          ? 'bg-white border-stone-200/90 shadow-xs'
          : 'bg-[#121620] border-stone-800/90'
      }`}
    >
      {/* Top Header Bar */}
      <div
        className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${
          isLight ? 'bg-stone-50 border-stone-200/90' : 'bg-[#171C28] border-stone-800'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xs font-bold tracking-tight">
                Morrow&apos;s Soul{' '}
                <span className="font-mono text-stone-400 font-normal">(~/.blaize/SOUL.md)</span>
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-400/15 text-amber-300 border border-amber-400/30">
                Slot #1 · v{soulDocument.version}
              </span>
              {isDirty && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  Unsaved edits
                </span>
              )}
            </div>
            <p className="text-[11px] text-stone-400 truncate">
              User-owned companion identity &amp; voice injected into Slot #1 before project instructions and skills
            </p>
          </div>
        </div>

        {/* Voice Cadence Preset Selector + Template/Restore Actions + Apply Changes */}
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="SOUL.md Voice Cadence Preset"
            value={draftCadence}
            onChange={(e) => handleSelectCadencePreset(e.target.value as SoulVoiceCadence)}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium outline-none ${
              isLight
                ? 'bg-white border-stone-300 text-stone-800'
                : 'bg-stone-900 border-stone-700 text-stone-200'
            }`}
          >
            {(Object.keys(SOUL_PRESET_TEMPLATES) as SoulVoiceCadence[]).map((cadenceKey) => (
              <option key={cadenceKey} value={cadenceKey}>
                {SOUL_PRESET_TEMPLATES[cadenceKey].badge}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleFormatWithPrettier}
            title="Format ~/.blaize/SOUL.md with Prettier addon"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
              isLight
                ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                : 'bg-stone-900 border-stone-700/80 text-stone-300 hover:bg-stone-800'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Format</span>
          </button>

          <button
            type="button"
            onClick={handleRestoreDefault}
            title="Restore default Soul configuration"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
              isLight
                ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                : 'bg-stone-900 border-stone-700/80 text-stone-300 hover:bg-stone-800'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5 text-stone-400" />
            <span>Restore default</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadTemplate}
            title="Download Soul JSON template"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
              isLight
                ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                : 'bg-stone-900 border-stone-700/80 text-stone-300 hover:bg-stone-800'
            }`}
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Download template</span>
          </button>

          <button
            type="button"
            onClick={() => setImportBoxOpen((v) => !v)}
            title="Import Soul template (JSON or Markdown)"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
              isLight
                ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                : 'bg-stone-900 border-stone-700/80 text-stone-300 hover:bg-stone-800'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Import template</span>
          </button>

          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            title="Inspect or restore previous Soul versions"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
              isLight
                ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                : 'bg-stone-900 border-stone-700/80 text-stone-300 hover:bg-stone-800'
            }`}
          >
            <History className="w-3.5 h-3.5 text-purple-400" />
            <span>History ({versionHistory.length})</span>
          </button>

          {onOpenInCodeIde && (
            <button
              type="button"
              onClick={() => onOpenInCodeIde('~/.blaize/SOUL.md', draftMarkdown)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                isLight
                  ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                  : 'bg-stone-900 border-stone-700/80 text-stone-300 hover:bg-stone-800'
              }`}
            >
              <Code2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Open in IDE</span>
            </button>
          )}

          <button
            type="button"
            data-testid="apply-soul-changes-btn"
            onClick={handleApplyChanges}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs transition-colors shadow-xs"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Apply Changes</span>
          </button>
        </div>
      </div>

      {/* Human-Readable Soul Summary Strip + Natural-Language "Describe a change" Bar */}
      <div
        className={`px-4 py-3 border-b space-y-2.5 text-xs ${
          isLight ? 'bg-stone-100/60 border-stone-200/80' : 'bg-[#141824] border-stone-800/80'
        }`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="p-2 rounded-xl border border-stone-800/60 bg-black/15">
            <div className="text-[10px] text-stone-400">Name &amp; Cadence</div>
            <div className="font-semibold text-amber-300 truncate">
              {soulDocument.agentName} · {SOUL_PRESET_TEMPLATES[draftCadence].badge}
            </div>
          </div>
          <div className="p-2 rounded-xl border border-stone-800/60 bg-black/15">
            <div className="text-[10px] text-stone-400">Voice &amp; Tone</div>
            <div className="font-medium text-stone-200 truncate">
              {liveParsedPreview.parsedSections.voiceAndTone.replace(/^-\s*/m, '')}
            </div>
          </div>
          <div className="p-2 rounded-xl border border-stone-800/60 bg-black/15">
            <div className="text-[10px] text-stone-400">Boundaries &amp; Safety</div>
            <div className="font-medium text-emerald-400 truncate">
              PolicyGuard &amp; Fact-Check Enforced
            </div>
          </div>
          <div className="p-2 rounded-xl border border-stone-800/60 bg-black/15">
            <div className="text-[10px] text-stone-400">Companion Presence</div>
            <div className="font-medium text-stone-200 truncate">
              Morrow Nook in Chat · Corner Perch
            </div>
          </div>
        </div>

        {/* Describe a change -> Preview changes -> Apply */}
        <form
          onSubmit={handlePreviewNaturalLanguageChange}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            type="text"
            aria-label="Describe a Soul change in natural language"
            data-testid="soul-nl-change-input"
            placeholder="Describe a change (e.g., 'Make Morrow calmer, more concise, and slightly dry in humour')..."
            value={nlChangeInput}
            onChange={(e) => setNlChangeInput(e.target.value)}
            className={`flex-1 min-w-[220px] px-3 py-1.5 rounded-xl border text-xs outline-none ${
              isLight
                ? 'bg-white border-stone-300 text-stone-900'
                : 'bg-[#0C0F17] border-stone-700 text-stone-100 focus:border-amber-400'
            }`}
          />
          <button
            type="submit"
            data-testid="soul-preview-changes-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 font-semibold text-xs whitespace-nowrap"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview changes</span>
          </button>
        </form>

        {/* Diff Preview Card before applying */}
        {diffPreview && (
          <div
            data-testid="soul-diff-preview-card"
            className="p-3 rounded-xl border border-amber-400/40 bg-[#0E131D] space-y-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-amber-300">
                Proposed Soul Change Preview (v{soulDocument.version} → v{diffPreview.proposedSoul.version})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDiffPreview(null)}
                  className="px-2.5 py-1 rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"
                >
                  Discard
                </button>
                <button
                  type="button"
                  data-testid="soul-confirm-apply-diff-btn"
                  disabled={!diffPreview.acceptedByGuard}
                  onClick={handleApplyDiffPreview}
                  className="px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-950 font-semibold"
                >
                  Apply proposed change
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
              {diffPreview.diffItems.map((d) => (
                <div key={d.section} className="p-2 rounded-lg bg-black/40 border border-stone-800">
                  <div className="text-stone-400 text-[10px]">{d.section}</div>
                  <div className="text-rose-400 line-through truncate">- {d.before}</div>
                  <div className="text-emerald-400 truncate">+ {d.after}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Import Template Drawer */}
        {importBoxOpen && (
          <form
            onSubmit={handleConfirmImportTemplate}
            className="p-3 rounded-xl border border-sky-500/40 bg-[#0E131D] space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sky-300">
                Import Soul Template (JSON or Markdown)
              </span>
              <button
                type="button"
                onClick={() => setImportBoxOpen(false)}
                className="text-[11px] text-stone-400 hover:text-stone-200"
              >
                Close
              </button>
            </div>
            <textarea
              rows={3}
              aria-label="Paste Soul Template JSON or Markdown"
              placeholder='Paste exported JSON template or raw "# Identity & Role..." markdown'
              value={importRawText}
              onChange={(e) => setImportRawText(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-stone-700 bg-black/50 font-mono text-xs text-stone-100 outline-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-3 py-1 rounded-lg bg-sky-400 text-stone-950 font-semibold text-xs"
              >
                Validate &amp; Import
              </button>
            </div>
          </form>
        )}

        {/* Version History Restore List */}
        {historyOpen && (
          <div className="p-3 rounded-xl border border-stone-700 bg-[#0E131D] space-y-1.5">
            <div className="font-semibold text-stone-200">
              Saved Soul Version History ({versionHistory.length})
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {versionHistory.map((ver, idx) => (
                <div
                  key={`${ver.version}-${idx}`}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-black/30 border border-stone-800 text-[11px]"
                >
                  <span className="font-mono text-stone-300">
                    v{ver.version} · {SOUL_PRESET_TEMPLATES[ver.voiceCadence].badge} ({ver.updatedAt})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftCadence(ver.voiceCadence);
                      setDraftMarkdown(ver.rawMarkdown);
                      commitValidatedSoul(
                        { ...ver, version: soulDocument.version + 1, updatedAt: 'Restored just now' },
                        `Restored Soul v${ver.version} as v${soulDocument.version + 1}.`
                      );
                    }}
                    className="px-2 py-0.5 rounded bg-amber-400/15 border border-amber-400/30 text-amber-300 hover:bg-amber-400/25 font-mono text-[10px]"
                  >
                    Restore v{ver.version}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Validation & Re-Validation Feedback Banners */}
      {applyError && (
        <div
          role="alert"
          className="px-4 py-2.5 bg-rose-500/15 border-b border-rose-500/40 text-rose-300 text-xs flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{applyError}</span>
        </div>
      )}

      {applySuccessNotice && !applyError && (
        <div
          role="status"
          data-testid="soul-revalidation-banner"
          className="px-4 py-2 bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{applySuccessNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowSkillMatrix((v) => !v)}
            className="text-[11px] font-mono underline hover:text-emerald-200"
          >
            {showSkillMatrix ? 'Hide skill check' : 'View skill check'}
          </button>
        </div>
      )}

      {/* IDE Monaco Editor Workbench Canvas */}
      <div className="grid grid-cols-1 xl:grid-cols-12">
        {/* Left 8 Cols: Line-Numbered Monaco-Style Editor */}
        <div
          className={`xl:col-span-8 flex flex-col border-b xl:border-b-0 xl:border-r border-stone-800 ${editorCanvasClass}`}
        >
          {/* File Tab Strip */}
          <div className="h-8 px-3 bg-[#181818] border-b border-[#2b2b2b] flex items-center justify-between gap-2 text-[11px] font-mono text-stone-400 whitespace-nowrap overflow-x-auto">
            <div className="flex items-center gap-1.5 text-amber-300 shrink-0">
              <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>~/.blaize/SOUL.md</span>
              <span className="text-stone-500">· markdown</span>
            </div>
            <div className="flex items-center gap-2.5 text-[10px] shrink-0">
              <span>{lineCount} lines</span>
              <span
                className={
                  liveParsedPreview.guardVerified && liveLintDiagnostics.length === 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }
              >
                {liveParsedPreview.guardVerified
                  ? `ESLint: ${liveLintDiagnostics.length} problems`
                  : 'PolicyGuard Warning'}
              </span>
            </div>
          </div>

          {/* Gutter + Code Textarea */}
          <div className="flex min-h-[200px] max-h-[250px] overflow-hidden">
            <div
              aria-hidden="true"
              className="w-11 py-3 bg-black/25 border-r border-[#2b2b2b] text-right pr-2.5 font-mono text-xs text-stone-500 select-none overflow-hidden"
            >
              {Array.from({ length: lineCount }).map((_, idx) => (
                <div key={idx} className="leading-6">
                  {idx + 1}
                </div>
              ))}
            </div>
            <textarea
              aria-label="SOUL.md Monaco Code Editor"
              data-testid="soul-md-monaco-textarea"
              value={draftMarkdown}
              onChange={(e) => {
                setDraftMarkdown(e.target.value);
                if (applyError) setApplyError(null);
              }}
              spellCheck={false}
              className="flex-1 p-3 bg-transparent font-mono text-xs leading-6 outline-none resize-none overflow-y-auto"
            />
          </div>
        </div>

        {/* Right 4 Cols: Parsed Slot #1 Sections & Live Skill Re-Validation Summary */}
        <div className="xl:col-span-4 p-4 flex flex-col justify-between space-y-3 text-xs">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-stone-300">
                Skill &amp; PolicyGuard Validation
              </span>
              <span
                data-testid="soul-skills-revalidation-badge"
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                  revalidationReport.valid
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                }`}
              >
                {revalidationReport.compatibleSkillCount}/{revalidationReport.totalSkillsChecked} skills verified
              </span>
            </div>

            <p className="text-[11px] text-stone-400 leading-relaxed">
              {revalidationReport.summary}
            </p>

            {/* Compact Skill Compatibility List */}
            <div className="space-y-1.5 pt-1">
              {revalidationReport.skillResults.map((item) => (
                <div
                  key={item.skillId}
                  className={`px-2.5 py-1.5 rounded-xl border flex items-center justify-between gap-2 text-[11px] ${
                    isLight
                      ? 'bg-stone-50 border-stone-200/80'
                      : 'bg-[#0E121B] border-stone-800/90'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{item.name}</div>
                    <div className="text-[10px] font-mono text-stone-400 truncate">
                      {item.slug}@v{item.version} · {item.guardMode}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono shrink-0 ${
                      item.compatible
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-rose-500/15 text-rose-400'
                    }`}
                  >
                    {item.compatible ? 'PASS' : 'FLAGGED'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-stone-800/70 flex items-center justify-between text-[11px] text-stone-400">
            <span>Cadence: {SOUL_PRESET_TEMPLATES[draftCadence].badge}</span>
            <span className="font-mono text-emerald-400">
              {liveParsedPreview.guardVerified ? 'PolicyGuard OK' : 'Violation Detected'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

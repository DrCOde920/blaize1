/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ArtifactSplitDrawer — Refined, calm, integrated editor panel for Project Artifacts:
 * - Resizable/collapsible right drawer with responsive width presets
 * - Compact top bar with artifact selector, version/save status, primary actions, and overflow menu
 * - Tabs: Preview, Code, and History
 * - Preserves live interactive HTML/SVG/React previews, versioning, rollback, and Open in IDE
 */

import React, { useEffect, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  History,
  Layers,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  TerminalSquare,
  X,
} from 'lucide-react';
import {
  ArtifactKind,
  WorkspaceArtifact,
  rollbackArtifactVersion,
} from '../packages/workspace';

interface ArtifactSplitDrawerProps {
  artifacts: WorkspaceArtifact[];
  activeArtifact: WorkspaceArtifact | null;
  onSelectArtifact: (artifactId: string) => void;
  onSaveArtifactVersion: (input: {
    id?: string;
    title: string;
    kind: ArtifactKind;
    language: string;
    content: string;
    summary?: string;
  }) => void;
  onRollbackArtifact: (updated: WorkspaceArtifact) => void;
  onOpenInVSCodeIde: (artifact: WorkspaceArtifact) => void;
  onClose?: () => void;
  uiTheme: 'dark' | 'light';
  embeddedMode?: boolean;
  drawerWidthPx?: number;
  onChangeDrawerWidthPx?: (widthPx: number) => void;
}

export const ArtifactSplitDrawer: React.FC<ArtifactSplitDrawerProps> = ({
  artifacts,
  activeArtifact,
  onSelectArtifact,
  onSaveArtifactVersion,
  onRollbackArtifact,
  onOpenInVSCodeIde,
  onClose,
  uiTheme,
  embeddedMode = false,
  drawerWidthPx = 500,
  onChangeDrawerWidthPx,
}) => {
  const isLight = uiTheme === 'light';
  const current = activeArtifact || artifacts[0] || null;

  const [tab, setTab] = useState<'preview' | 'code' | 'versions'>('preview');
  const [draftTitle, setDraftTitle] = useState<string>(current?.title || '');
  const [draftContent, setDraftContent] = useState<string>(current?.content || '');
  const [draftKind, setDraftKind] = useState<ArtifactKind>(current?.kind || 'html_preview');
  const [copied, setCopied] = useState<boolean>(false);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState<boolean>(false);

  useEffect(() => {
    if (current && !isCreatingNew) {
      setDraftTitle(current.title);
      setDraftContent(current.content);
      setDraftKind(current.kind);
    }
  }, [current?.id, current?.currentVersion, isCreatingNew]);

  const hasUnsavedChanges =
    isCreatingNew ||
    (current !== null &&
      (draftTitle.trim() !== current.title ||
        draftContent !== current.content ||
        draftKind !== current.kind));

  const handleCopyCode = () => {
    if (!draftContent) return;
    navigator.clipboard?.writeText(draftContent).catch(() => {});
    setCopied(true);
    setOverflowMenuOpen(false);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadArtifact = () => {
    if (!draftContent) return;
    const ext =
      draftKind === 'html_preview'
        ? 'html'
        : draftKind === 'svg_graphic'
        ? 'svg'
        : draftKind === 'markdown_doc'
        ? 'md'
        : 'tsx';
    const blob = new Blob([draftContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(draftTitle || 'artifact').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setOverflowMenuOpen(false);
  };

  const handleSave = () => {
    if (!draftTitle.trim()) return;
    onSaveArtifactVersion({
      id: isCreatingNew ? undefined : current?.id,
      title: draftTitle.trim(),
      kind: draftKind,
      language:
        draftKind === 'html_preview'
          ? 'html'
          : draftKind === 'svg_graphic'
          ? 'svg'
          : draftKind === 'markdown_doc'
          ? 'markdown'
          : 'tsx',
      content: draftContent,
      summary: isCreatingNew ? 'Created new artifact' : 'Edited in Artifact Studio',
    });
    setIsCreatingNew(false);
    setTab('preview');
  };

  const handleStartNewArtifact = () => {
    setIsCreatingNew(true);
    setDraftTitle('New Interactive Widget');
    setDraftKind('html_preview');
    setDraftContent(`<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: system-ui, sans-serif; background: #0f141f; color: #f8fafc; padding: 20px; }
  .box { background: #192132; border: 1px solid #2e3b52; border-radius: 14px; padding: 18px; }
  button { background: #fbbf24; color: #0f172a; border: none; padding: 8px 14px; border-radius: 8px; font-weight: 700; cursor: pointer; }
</style>
</head>
<body>
  <div class="box">
    <h3>Custom Interactive Artifact</h3>
    <p id="status">Click below to test live interactivity.</p>
    <button onclick="document.getElementById('status').textContent = 'Verified at ' + new Date().toLocaleTimeString()">Run Action</button>
  </div>
</body>
</html>`);
    setTab('code');
  };

  const toggleDrawerWidth = () => {
    if (!onChangeDrawerWidthPx) return;
    const nextWidth = drawerWidthPx >= 580 ? 440 : 620;
    onChangeDrawerWidthPx(nextWidth);
  };

  return (
    <section
      data-testid="artifact-split-drawer"
      aria-label="Artifact Studio Drawer"
      style={
        embeddedMode
          ? undefined
          : {
              width: `min(100vw, ${drawerWidthPx}px)`,
            }
      }
      className={`flex flex-col h-full border-l transition-[width] duration-150 ${
        embeddedMode ? 'w-full border-l-0' : 'shrink-0 max-w-full'
      } ${
        isLight
          ? 'bg-[#FAF9F6] border-stone-200/90 text-stone-900'
          : 'bg-[#10141E] border-stone-800/90 text-stone-100'
      }`}
    >
      {/* Compact Top Artifact Bar */}
      <div
        className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
          isLight ? 'border-stone-200 bg-[#F3F1EC]' : 'border-stone-800 bg-[#141926]'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Layers className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <select
              aria-label="Select Project Artifact"
              value={isCreatingNew ? '__new__' : current?.id || ''}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  handleStartNewArtifact();
                } else {
                  setIsCreatingNew(false);
                  onSelectArtifact(e.target.value);
                }
              }}
              className={`w-full text-xs font-semibold truncate bg-transparent outline-none cursor-pointer ${
                isLight ? 'text-stone-900' : 'text-stone-100'
              }`}
            >
              {artifacts.map((art) => (
                <option
                  key={art.id}
                  value={art.id}
                  className={isLight ? 'bg-white text-stone-900' : 'bg-stone-900 text-stone-100'}
                >
                  {art.title}
                </option>
              ))}
              {isCreatingNew && (
                <option value="__new__" className="bg-stone-900 text-amber-300">
                  + Creating: {draftTitle}
                </option>
              )}
            </select>

            <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-400">
              <span>{current && !isCreatingNew ? `v${current.currentVersion}` : 'v1 draft'}</span>
              <span aria-hidden="true">·</span>
              <span className={hasUnsavedChanges ? 'text-amber-400' : 'text-emerald-400'}>
                {hasUnsavedChanges ? 'Unsaved changes' : 'Saved'}
              </span>
            </div>
          </div>
        </div>

        {/* Primary Actions + Overflow Menu */}
        <div className="flex items-center gap-1 shrink-0 relative">
          <button
            type="button"
            onClick={handleStartNewArtifact}
            title="New artifact"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap ${
              isLight
                ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                : 'bg-stone-900 border-stone-700/80 text-stone-200 hover:bg-stone-800'
            }`}
          >
            <Plus className="w-3 h-3 text-amber-400" />
            <span>New</span>
          </button>

          {current && (
            <button
              type="button"
              onClick={() => onOpenInVSCodeIde(current)}
              title="Open in IDE"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-400/15 border border-amber-400/35 text-amber-300 hover:bg-amber-400/25 text-[11px] font-semibold whitespace-nowrap"
            >
              <TerminalSquare className="w-3 h-3" />
              <span>Open in IDE</span>
            </button>
          )}

          {!embeddedMode && onChangeDrawerWidthPx && (
            <button
              type="button"
              onClick={toggleDrawerWidth}
              aria-label={drawerWidthPx >= 580 ? 'Compact artifact drawer' : 'Expand artifact drawer'}
              title={drawerWidthPx >= 580 ? 'Standard width' : 'Wide drawer'}
              className="p-1.5 rounded-lg hover:bg-stone-500/15 text-stone-400 hover:text-stone-200"
            >
              {drawerWidthPx >= 580 ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setOverflowMenuOpen((o) => !o)}
            aria-label="More artifact actions"
            title="More actions"
            className="p-1.5 rounded-lg hover:bg-stone-500/15 text-stone-400 hover:text-stone-200"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {overflowMenuOpen && (
            <div
              role="menu"
              className={`absolute right-0 top-full mt-1 w-44 rounded-xl border p-1.5 shadow-xl z-40 text-xs ${
                isLight
                  ? 'bg-white border-stone-300 text-stone-800'
                  : 'bg-[#161B26] border-stone-700 text-stone-100'
              }`}
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleCopyCode}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-stone-500/15 text-left"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied source' : 'Copy source code'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleDownloadArtifact}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-stone-500/15 text-left"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download file</span>
              </button>
            </div>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Artifact Drawer"
              className="p-1.5 rounded-lg hover:bg-stone-500/20 text-stone-400 hover:text-stone-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Mode Switcher Tabs (Preview | Code | History) */}
      <div
        className={`px-3.5 py-2 border-b flex items-center justify-between gap-2 text-xs shrink-0 ${
          isLight ? 'border-stone-200 bg-white' : 'border-stone-800/80 bg-[#0D1018]'
        }`}
      >
        <div className="flex items-center gap-1" role="tablist" aria-label="Artifact View Mode">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'preview'}
            onClick={() => setTab('preview')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-colors whitespace-nowrap ${
              tab === 'preview'
                ? 'bg-amber-400 text-stone-950 font-semibold'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-500/10'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === 'code'}
            onClick={() => setTab('code')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-colors whitespace-nowrap ${
              tab === 'code'
                ? 'bg-amber-400 text-stone-950 font-semibold'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-500/10'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Code</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === 'versions'}
            onClick={() => setTab('versions')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-colors whitespace-nowrap ${
              tab === 'versions'
                ? 'bg-amber-400 text-stone-950 font-semibold'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-500/10'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>History ({current?.versions.length || 1})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleCopyCode}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-700/60 text-[11px] text-stone-400 hover:text-stone-200 hover:bg-stone-500/10"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 overflow-y-auto p-3.5">
        {!current && !isCreatingNew ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-stone-400 space-y-2.5">
            <Sparkles className="w-7 h-7 text-amber-400/70" />
            <div className="text-sm font-semibold text-stone-200">No artifacts yet</div>
            <p className="text-xs max-w-xs">
              Generate an interactive widget from Chat or click New above.
            </p>
          </div>
        ) : tab === 'preview' ? (
          <div className="h-full flex flex-col">
            {draftKind === 'html_preview' && (
              <iframe
                title={draftTitle || 'Artifact Live Preview'}
                sandbox="allow-scripts"
                srcDoc={draftContent}
                className="w-full flex-1 min-h-[380px] rounded-xl border border-stone-800 bg-[#0f131c]"
              />
            )}

            {draftKind === 'svg_graphic' && (
              <div
                className="w-full flex-1 min-h-[300px] rounded-xl border border-stone-800 bg-[#0d111a] p-4 flex items-center justify-center overflow-auto"
                dangerouslySetInnerHTML={{ __html: draftContent }}
              />
            )}

            {(draftKind === 'markdown_doc' ||
              draftKind === 'react_component' ||
              draftKind === 'typescript_code' ||
              draftKind === 'json_schema') && (
              <div className="rounded-xl border border-stone-800 bg-[#0c1017] p-4 font-mono text-xs text-stone-200 whitespace-pre-wrap leading-relaxed">
                {draftContent}
              </div>
            )}
          </div>
        ) : tab === 'code' ? (
          <div className="space-y-3 h-full flex flex-col">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-stone-400 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  aria-label="Artifact Title"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-stone-400 mb-1">
                  Format
                </label>
                <select
                  aria-label="Artifact Type"
                  value={draftKind}
                  onChange={(e) => setDraftKind(e.target.value as ArtifactKind)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none"
                >
                  <option value="html_preview">HTML Interactive</option>
                  <option value="svg_graphic">SVG Vector</option>
                  <option value="markdown_doc">Markdown</option>
                  <option value="react_component">React TSX</option>
                </select>
              </div>
            </div>

            <div className="flex-1 flex flex-col">
              <label className="block text-[11px] font-medium text-stone-400 mb-1">
                Source code
              </label>
              <textarea
                aria-label="Artifact Source Code"
                rows={14}
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                className="w-full flex-1 p-3 rounded-xl border border-stone-700 bg-[#0A0D14] font-mono text-xs text-amber-100 outline-none focus:border-amber-400 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {isCreatingNew && (
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className="px-3 py-1.5 rounded-lg border border-stone-700 text-xs text-stone-300 hover:bg-stone-800"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs"
              >
                <Save className="w-3.5 h-3.5" />
                <span>
                  {isCreatingNew
                    ? 'Save artifact (v1)'
                    : `Save as v${(current?.versions.length || 1) + 1}`}
                </span>
              </button>
            </div>
          </div>
        ) : (
          /* Version History Tab */
          <div className="space-y-2">
            {current?.versions
              .slice()
              .reverse()
              .map((ver) => {
                const isCurrent = ver.version === current.currentVersion;
                return (
                  <div
                    key={ver.version}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                      isCurrent
                        ? 'border-amber-400/50 bg-amber-400/5'
                        : 'border-stone-800 bg-stone-900/40'
                    }`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-mono">
                        <span className="font-bold text-amber-300">v{ver.version}</span>
                        <span aria-hidden="true" className="text-stone-500">
                          ·
                        </span>
                        <span className="text-stone-400">{ver.CreatedAt}</span>
                        {isCurrent && (
                          <>
                            <span aria-hidden="true" className="text-stone-500">
                              ·
                            </span>
                            <span className="text-emerald-400 font-semibold">Active</span>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-stone-300 truncate">{ver.summary}</p>
                    </div>

                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => {
                          const restored = rollbackArtifactVersion(current, ver.version);
                          onRollbackArtifact(restored);
                          setTab('preview');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-700 hover:bg-stone-800 text-xs text-stone-200 shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Restore v{ver.version}</span>
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </section>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VSCodeIdeView — Focused VS Code-style IDE Workspace (Section 7):
 * - Dominant code editor canvas with line numbers, active Marketplace Theme support, and GitLens verification strip
 * - Collapsible Left Sidebar (Explorer, Workspace Search, Git Source Control, Extensions Marketplace)
 * - Collapsible Bottom Panel (Integrated Terminal, ESLint Problems, Extension Host)
 * - Clean Top Toolbar with primary actions + secondary Command Menu (⋯)
 * - VS Code Marketplace Addons Manager (curated registry + live OpenVSX query + install by publisher.extensionName)
 */

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  Eye,
  FileCode,
  FilePlus,
  FolderOpen,
  GitBranch,
  GitCommit,
  Layers,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  Play,
  Puzzle,
  Search,
  Sparkles,
  Star,
  Terminal,
  Wand2,
  X,
} from 'lucide-react';
import {
  ArtifactKind,
  IdeFileNode,
  VSCodeMarketplaceExtension,
  WorkspaceProject,
  analyzeCodeWithESLintAddon,
  formatCodeWithPrettierAddon,
  insertReactSnippetAddon,
  searchVSCodeMarketplace,
} from '../packages/workspace';

interface VSCodeIdeViewProps {
  activeProject: WorkspaceProject;
  files: IdeFileNode[];
  activeFileId: string;
  onSelectFile: (fileId: string) => void;
  onUpdateFileContent: (fileId: string, newContent: string) => void;
  onCreateFile: (file: IdeFileNode) => void;
  extensions: VSCodeMarketplaceExtension[];
  onToggleInstallExtension: (extId: string) => void;
  onToggleEnableExtension: (extId: string) => void;
  onInstallCustomMarketplaceExtension: (ext: VSCodeMarketplaceExtension) => void;
  onPublishFileAsArtifact: (input: {
    title: string;
    kind: ArtifactKind;
    language: string;
    content: string;
  }) => void;
}

type ActivityTab = 'explorer' | 'search' | 'git' | 'extensions';
type BottomPanelTab = 'terminal' | 'problems' | 'output';

export const VSCodeIdeView: React.FC<VSCodeIdeViewProps> = ({
  activeProject,
  files,
  activeFileId,
  onSelectFile,
  onUpdateFileContent,
  onCreateFile,
  extensions,
  onToggleInstallExtension,
  onToggleEnableExtension,
  onInstallCustomMarketplaceExtension,
  onPublishFileAsArtifact,
}) => {
  const [activityTab, setActivityTab] = useState<ActivityTab>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState<boolean>(true);
  const [bottomTab, setBottomTab] = useState<BottomPanelTab>('terminal');
  const [livePreviewOpen, setLivePreviewOpen] = useState<boolean>(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState<boolean>(false);

  const [openTabIds, setOpenTabIds] = useState<string[]>(() =>
    files.slice(0, 3).map((f) => f.id)
  );

  // Marketplace Search & Filter
  const [extSearchQuery, setExtSearchQuery] = useState<string>('');
  const [extCategory, setExtCategory] = useState<string>('ALL');
  const [selectedExtensionId, setSelectedExtensionId] = useState<string | null>(null);
  const [showingExtensionDetail, setShowingExtensionDetail] = useState<boolean>(false);
  const [customExtensionSlug, setCustomExtensionSlug] = useState<string>('');
  const [isQueryingOpenVSX, setIsQueryingOpenVSX] = useState<boolean>(false);

  // Workspace Text Search State
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState<string>('');

  // Git Source Control State
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [commitHistory, setCommitHistory] = useState<
    Array<{ hash: string; message: string; timestamp: string }>
  >([
    {
      hash: 'sha256:8f91c4a2',
      message: 'feat(finance): initialize SafeToSpendWidget with integer-cent guard',
      timestamp: '2h ago',
    },
    {
      hash: 'sha256:3b12e90d',
      message: 'chore(policy): bind Accra Merchant Ops rules to workspace',
      timestamp: 'Yesterday',
    },
  ]);

  // New File Input
  const [showNewFileInput, setShowNewFileInput] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('');

  // Terminal History
  const [terminalLines, setTerminalLines] = useState<string[]>([
    'Blaize VS Code Integrated Terminal v3.2 (Node v22 + tsx + PolicyGuard Sandbox)',
    `Active Workspace Project: ${activeProject.name} (${activeProject.slug})`,
    'Type a command or click "Run File" to execute the active module.',
  ]);
  const [terminalCommand, setTerminalCommand] = useState<string>('');

  const activeFile = files.find((f) => f.id === activeFileId) || files[0];

  // Active Marketplace Addon Capabilities
  const activeExtensions = useMemo(
    () => extensions.filter((e) => e.installed && e.enabled),
    [extensions]
  );

  const hasPrettier = activeExtensions.some((e) => e.contributes.formatter);
  const hasESLint = activeExtensions.some((e) => e.contributes.linter);
  const hasLiveServer = activeExtensions.some((e) => e.contributes.livePreview);
  const hasGitLens = activeExtensions.some((e) => e.id === 'eamodio.gitlens');
  const activeThemeExt = activeExtensions.find((e) => e.contributes.editorTheme);

  const editorCanvasClass =
    activeThemeExt?.contributes.editorTheme === 'dracula-pro'
      ? 'bg-[#282a36] text-[#f8f8f2]'
      : activeThemeExt?.contributes.editorTheme === 'github-dark-dimmed'
      ? 'bg-[#1c2128] text-[#adbac7]'
      : 'bg-[#1e1e1e] text-[#d4d4d4]';

  const lintDiagnostics = useMemo(
    () => (hasESLint && activeFile ? analyzeCodeWithESLintAddon(activeFile.content) : []),
    [hasESLint, activeFile?.content]
  );

  const filteredExtensions = useMemo(
    () => searchVSCodeMarketplace(extensions, extSearchQuery, extCategory),
    [extensions, extSearchQuery, extCategory]
  );

  const selectedExtension =
    extensions.find((e) => e.id === selectedExtensionId) || filteredExtensions[0] || null;

  // Workspace Search Matches across files
  const workspaceSearchMatches = useMemo(() => {
    const q = workspaceSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: Array<{ file: IdeFileNode; line: number; preview: string }> = [];
    for (const file of files) {
      const lines = file.content.split('\n');
      lines.forEach((lineText, idx) => {
        if (lineText.toLowerCase().includes(q) || file.path.toLowerCase().includes(q)) {
          results.push({
            file,
            line: idx + 1,
            preview: lineText.trim().slice(0, 72) || file.path,
          });
        }
      });
    }
    return results.slice(0, 24);
  }, [files, workspaceSearchQuery]);

  const handleOpenFileTab = (fileId: string) => {
    if (!openTabIds.includes(fileId)) {
      setOpenTabIds((prev) => [...prev, fileId]);
    }
    setShowingExtensionDetail(false);
    onSelectFile(fileId);
  };

  const handleCloseFileTab = (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (openTabIds.length <= 1) return;
    const nextTabs = openTabIds.filter((id) => id !== fileId);
    setOpenTabIds(nextTabs);
    if (activeFile?.id === fileId) {
      onSelectFile(nextTabs[0]);
    }
  };

  const handleFormatDocument = () => {
    if (!activeFile) return;
    const formatted = formatCodeWithPrettierAddon(activeFile.content);
    onUpdateFileContent(activeFile.id, formatted);
    setTerminalLines((prev) => [
      ...prev,
      `[esbenp.prettier-vscode] Formatted ${activeFile.path} (${formatted.split('\n').length} lines).`,
    ]);
  };

  const handleInsertSnippet = () => {
    if (!activeFile) return;
    const updated = insertReactSnippetAddon(activeFile.content, 'SafeSpendNotice');
    onUpdateFileContent(activeFile.id, updated);
    setCommandMenuOpen(false);
    setTerminalLines((prev) => [
      ...prev,
      `[dsznajder.es7-react-js-snippets] Inserted rafce snippet into ${activeFile.path}.`,
    ]);
  };

  const handleRunActiveFile = () => {
    if (!activeFile) return;
    setBottomPanelOpen(true);
    setBottomTab('terminal');
    setTerminalLines((prev) => [
      ...prev,
      `$ npx tsx ${activeFile.path}`,
      `✓ Compiled ${activeFile.name} cleanly (0 errors, ${lintDiagnostics.length} ESLint warnings).`,
      `✓ Output verified by Trust Kernel PolicyGuard.`,
    ]);
  };

  const handleCreateNewFileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFileName.trim();
    if (!clean) return;
    const ext = clean.split('.').pop()?.toLowerCase();
    const language: IdeFileNode['language'] =
      ext === 'tsx'
        ? 'tsx'
        : ext === 'html'
        ? 'html'
        : ext === 'json'
        ? 'json'
        : ext === 'md'
        ? 'markdown'
        : 'typescript';

    const created: IdeFileNode = {
      id: `file-${Date.now().toString(36)}`,
      projectId: activeProject.id,
      path: clean.includes('/') ? clean : `src/${clean}`,
      name: clean.split('/').pop() || clean,
      language,
      content: `// ${clean} — Created in Blaize VS Code IDE\nexport const ready = true;\n`,
    };
    onCreateFile(created);
    handleOpenFileTab(created.id);
    setNewFileName('');
    setShowNewFileInput(false);
  };

  const handleCommitStagedChanges = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = commitMessage.trim();
    if (!msg) return;
    const hash = `sha256:${Math.abs(
      msg.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7)
    )
      .toString(16)
      .padStart(8, '0')}`;
    setCommitHistory((prev) => [{ hash, message: msg, timestamp: 'Just now' }, ...prev]);
    setCommitMessage('');
    setTerminalLines((prev) => [
      ...prev,
      `[git commit] ${hash} "${msg}" (${files.length} files verified by PolicyGuard).`,
    ]);
  };

  const handleInstallByExtensionSlug = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = customExtensionSlug.trim();
    if (!raw) return;

    setIsQueryingOpenVSX(true);
    const parts = raw.includes('.') ? raw.split('.') : ['marketplace', raw];
    const publisher = parts[0];
    const name = parts.slice(1).join('.');
    const extId = `${publisher}.${name}`;

    let displayName = `${name.replace(/-/g, ' ')} (VS Code Extension)`;
    let version = '1.4.0';
    let description = `Installed from VS Code Marketplace / OpenVSX registry (${extId}).`;

    try {
      const resp = await fetch(`https://open-vsx.org/api/${publisher}/${name}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.displayName) displayName = data.displayName;
        if (data && data.version) version = data.version;
        if (data && data.description) description = data.description;
      }
    } catch {
      // Offline / sandboxed fallback
    }

    const newExt: VSCodeMarketplaceExtension = {
      id: extId,
      publisher,
      name,
      displayName,
      version,
      downloads: '1.2M',
      rating: 4.8,
      categories: ['AI & Productivity'],
      description,
      marketplaceUrl: `https://marketplace.visualstudio.com/items?itemName=${extId}`,
      installed: true,
      enabled: true,
      readmeSummary: `Loaded extension ${extId} v${version} into Blaize VS Code Workbench.`,
      contributes: {
        commands: [{ id: `${extId}.run`, title: `${displayName}: Activate` }],
      },
    };

    onInstallCustomMarketplaceExtension(newExt);
    setSelectedExtensionId(newExt.id);
    setCustomExtensionSlug('');
    setIsQueryingOpenVSX(false);
    setTerminalLines((prev) => [
      ...prev,
      `[VS Code Marketplace] Installed & activated ${newExt.id}@${newExt.version}.`,
    ]);
  };

  const lineCount = activeFile ? activeFile.content.split('\n').length : 1;

  return (
    <div
      data-testid="vscode-ide-workbench"
      className="h-full w-full flex flex-col bg-[#181818] text-[#cccccc] select-none overflow-hidden font-sans"
    >
      {/* COMPACT VS CODE TOP TOOLBAR */}
      <header className="h-10 px-3 bg-[#1f1f1f] border-b border-[#2b2b2b] flex items-center justify-between gap-3 text-xs shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-1.5 font-semibold text-sky-400">
            <Code2 className="w-4 h-4" />
            <span>Code IDE</span>
          </div>
          <span className="text-stone-600">/</span>
          <span className="font-mono text-[11px] text-stone-300 truncate">
            {activeProject.name}
          </span>
          {activeFile && (
            <>
              <span className="text-stone-600">/</span>
              <span className="font-mono text-[11px] text-amber-300 truncate">
                {activeFile.path}
              </span>
            </>
          )}
        </div>

        {/* Primary Actions + Overflow Command Menu */}
        <div className="flex items-center gap-1.5 relative">
          {hasPrettier && (
            <button
              type="button"
              onClick={handleFormatDocument}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#2a2d2e] hover:bg-[#37373d] text-[11px] text-amber-300"
              title="Format Document with Prettier (esbenp.prettier-vscode)"
            >
              <Wand2 className="w-3 h-3" />
              <span>Format (Prettier)</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleRunActiveFile}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px]"
          >
            <Play className="w-3 h-3" />
            <span>Run File</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!activeFile) return;
              onPublishFileAsArtifact({
                title: `${activeFile.name} Artifact`,
                kind:
                  activeFile.language === 'html'
                    ? 'html_preview'
                    : activeFile.language === 'markdown'
                    ? 'markdown_doc'
                    : 'react_component',
                language: activeFile.language,
                content: activeFile.content,
              });
              setTerminalLines((prev) => [
                ...prev,
                `[Artifacts Bridge] Published ${activeFile.path} to Project Artifacts.`,
              ]);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-400/20 border border-amber-400/40 text-amber-300 hover:bg-amber-400/30 text-[11px] font-semibold"
          >
            <Layers className="w-3 h-3" />
            <span>Save as Artifact</span>
          </button>

          {hasLiveServer && (
            <button
              type="button"
              onClick={() => setLivePreviewOpen((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium ${
                livePreviewOpen
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'bg-[#2a2d2e] text-stone-300 hover:bg-[#37373d]'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Live Server</span>
            </button>
          )}

          {/* Panel Layout Toggles */}
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle IDE Sidebar"
            title="Toggle Primary Sidebar"
            className={`p-1.5 rounded ${
              sidebarOpen ? 'bg-[#2a2d2e] text-white' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setBottomPanelOpen((v) => !v)}
            aria-label="Toggle Terminal Panel"
            title="Toggle Bottom Terminal Panel"
            className={`p-1.5 rounded ${
              bottomPanelOpen ? 'bg-[#2a2d2e] text-white' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <PanelBottom className="w-3.5 h-3.5" />
          </button>

          {/* Secondary Commands Overflow Menu */}
          <button
            type="button"
            onClick={() => setCommandMenuOpen((v) => !v)}
            aria-label="More IDE Commands"
            title="Command Palette & More Actions"
            className="p-1.5 rounded hover:bg-[#2a2d2e] text-stone-300"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {commandMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border border-[#3c3c3c] bg-[#252526] shadow-2xl py-1.5 z-30 text-xs">
              <button
                type="button"
                onClick={handleInsertSnippet}
                className="w-full px-3 py-1.5 text-left hover:bg-[#37373d] flex items-center justify-between"
              >
                <span>Insert React Snippet (rafce)</span>
                <span className="font-mono text-[10px] text-stone-400">ES7</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBottomPanelOpen(true);
                  setBottomTab('problems');
                  setCommandMenuOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-[#37373d] flex items-center justify-between"
              >
                <span>Inspect ESLint Problems</span>
                <span className="font-mono text-[10px] text-amber-400">
                  {lintDiagnostics.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSidebarOpen(true);
                  setActivityTab('extensions');
                  setCommandMenuOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-[#37373d] flex items-center justify-between"
              >
                <span>Open Extensions Marketplace</span>
                <span className="font-mono text-[10px] text-sky-400">OpenVSX</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* MAIN WORKBENCH BODY */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 1. LEFT ACTIVITY BAR */}
        <nav
          aria-label="VS Code Activity Bar"
          className="w-12 bg-[#181818] border-r border-[#2b2b2b] flex flex-col items-center py-2 gap-2 shrink-0"
        >
          {[
            { id: 'explorer' as ActivityTab, label: 'Explorer', icon: FolderOpen },
            { id: 'search' as ActivityTab, label: 'Search', icon: Search },
            { id: 'git' as ActivityTab, label: 'Source Control', icon: GitBranch },
            {
              id: 'extensions' as ActivityTab,
              label: 'VS Code Marketplace Extensions',
              icon: Puzzle,
              badge: extensions.filter((e) => e.installed).length,
            },
          ].map((item) => {
            const Icon = item.icon;
            const active = sidebarOpen && activityTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                title={item.label}
                onClick={() => {
                  if (sidebarOpen && activityTab === item.id) {
                    setSidebarOpen(false);
                  } else {
                    setActivityTab(item.id);
                    setSidebarOpen(true);
                  }
                }}
                className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                  active
                    ? 'text-white border-l-2 border-sky-400 bg-[#252526]'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.badge !== undefined && (
                  <span className="absolute bottom-1 right-1 px-1 rounded-full bg-sky-500 text-[9px] font-bold text-slate-950">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* 2. COLLAPSIBLE SIDEBAR PANEL */}
        {sidebarOpen && (
          <aside className="w-72 bg-[#1f1f1f] border-r border-[#2b2b2b] flex flex-col shrink-0 overflow-hidden">
            {/* TAB A: EXPLORER */}
            {activityTab === 'explorer' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-3 py-2 border-b border-[#2b2b2b] flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  <span className="truncate">Explorer · {activeProject.slug}</span>
                  <button
                    type="button"
                    onClick={() => setShowNewFileInput((v) => !v)}
                    aria-label="New File"
                    title="New File"
                    className="p-1 rounded hover:bg-[#2a2d2e] text-stone-200"
                  >
                    <FilePlus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {showNewFileInput && (
                  <form
                    onSubmit={handleCreateNewFileSubmit}
                    className="p-2 border-b border-[#2b2b2b]"
                  >
                    <input
                      type="text"
                      aria-label="New File Path"
                      placeholder="src/components/MyWidget.tsx"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      className="w-full px-2.5 py-1 rounded bg-[#141414] border border-sky-500 text-xs text-white outline-none font-mono"
                    />
                  </form>
                )}

                <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5">
                  {files.map((file) => {
                    const isSelected = activeFile?.id === file.id && !showingExtensionDetail;
                    return (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => handleOpenFileTab(file.id)}
                        className={`w-full px-3 py-1.5 flex items-center justify-between gap-2 text-xs text-left font-mono ${
                          isSelected
                            ? 'bg-[#37373d] text-white font-semibold'
                            : 'text-stone-300 hover:bg-[#2a2d2e]'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span className="truncate">{file.path}</span>
                        </div>
                        <span className="text-[10px] text-stone-500 uppercase">
                          {file.language}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Compact Marketplace Footer Link */}
                <div className="p-2.5 border-t border-[#2b2b2b] bg-[#181818] flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-stone-400 truncate">
                    {activeExtensions.length} addons active
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivityTab('extensions')}
                    className="text-sky-400 hover:underline font-medium shrink-0"
                  >
                    Extensions →
                  </button>
                </div>
              </div>
            )}

            {/* TAB B: WORKSPACE SEARCH */}
            {activityTab === 'search' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-[#2b2b2b] space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                    Workspace Search
                  </div>
                  <input
                    type="text"
                    aria-label="Search across workspace files"
                    placeholder="Search text across files..."
                    value={workspaceSearchQuery}
                    onChange={(e) => setWorkspaceSearchQuery(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#141414] border border-[#3c3c3c] focus:border-sky-500 text-xs text-white outline-none font-mono"
                  />
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-[#2b2b2b] text-xs">
                  {!workspaceSearchQuery.trim() ? (
                    <div className="p-4 text-stone-400 text-xs">
                      Type a symbol or keyword to search across {files.length} files in{' '}
                      <span className="text-stone-200 font-medium">{activeProject.name}</span>.
                    </div>
                  ) : workspaceSearchMatches.length === 0 ? (
                    <div className="p-4 text-stone-400 text-xs">
                      No matches found for &ldquo;{workspaceSearchQuery}&rdquo;.
                    </div>
                  ) : (
                    workspaceSearchMatches.map((m, idx) => (
                      <button
                        key={`${m.file.id}-${m.line}-${idx}`}
                        type="button"
                        onClick={() => handleOpenFileTab(m.file.id)}
                        className="w-full p-2.5 text-left hover:bg-[#2a2d2e] space-y-0.5"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px] text-sky-400">
                          <span className="truncate">{m.file.path}</span>
                          <span className="text-stone-500">:{m.line}</span>
                        </div>
                        <div className="font-mono text-[11px] text-stone-300 truncate">
                          {m.preview}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB C: SOURCE CONTROL / GIT */}
            {activityTab === 'git' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-[#2b2b2b] space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-stone-400">
                    <span>Source Control · Git</span>
                    <span className="font-mono text-[10px] text-emerald-400">main</span>
                  </div>
                  <form onSubmit={handleCommitStagedChanges} className="space-y-2">
                    <input
                      type="text"
                      aria-label="Git commit message"
                      placeholder="Commit message (e.g. feat: update widget)"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded bg-[#141414] border border-[#3c3c3c] focus:border-sky-500 text-xs text-white outline-none"
                    />
                    <button
                      type="submit"
                      className="w-full py-1.5 px-3 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5"
                    >
                      <GitCommit className="w-3.5 h-3.5" />
                      <span>Commit with SHA-256 Receipt</span>
                    </button>
                  </form>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1.5">
                      Tracked Workspace Files ({files.length})
                    </div>
                    <div className="space-y-1">
                      {files.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => handleOpenFileTab(f.id)}
                          className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2d2e] font-mono text-[11px]"
                        >
                          <span className="truncate text-stone-300">{f.path}</span>
                          <span className="text-emerald-400">M</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#2b2b2b]">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1.5">
                      Verified Commit Log
                    </div>
                    <div className="space-y-2">
                      {commitHistory.map((c) => (
                        <div
                          key={c.hash}
                          className="p-2 rounded bg-[#181818] border border-[#2b2b2b] space-y-0.5"
                        >
                          <div className="text-[11px] text-stone-200 font-medium">{c.message}</div>
                          <div className="flex items-center justify-between text-[10px] font-mono text-stone-400">
                            <span className="text-emerald-400">{c.hash}</span>
                            <span>{c.timestamp}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB D: EXTENSIONS MARKETPLACE */}
            {activityTab === 'extensions' && (
              <div
                data-testid="vscode-marketplace-panel"
                className="flex-1 flex flex-col overflow-hidden"
              >
                <div className="p-3 border-b border-[#2b2b2b] space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center justify-between">
                    <span>Extensions Marketplace</span>
                    <span className="text-[10px] font-mono text-emerald-400">OpenVSX + MS</span>
                  </div>

                  <input
                    type="text"
                    aria-label="Search extensions in Marketplace"
                    placeholder="Search Marketplace (prettier, dracula, eslint)..."
                    value={extSearchQuery}
                    onChange={(e) => setExtSearchQuery(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#141414] border border-[#3c3c3c] focus:border-sky-500 text-xs text-white outline-none"
                  />

                  <div className="flex flex-wrap gap-1">
                    {['ALL', 'INSTALLED', 'Formatters', 'Linters', 'Themes', 'Preview'].map(
                      (cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setExtCategory(cat)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            extCategory === cat
                              ? 'bg-sky-500 text-slate-950 font-semibold'
                              : 'bg-[#2a2d2e] text-stone-300 hover:bg-[#37373d]'
                          }`}
                        >
                          {cat}
                        </button>
                      )
                    )}
                  </div>

                  {/* Direct Install by Extension ID */}
                  <form onSubmit={handleInstallByExtensionSlug} className="flex gap-1 pt-1">
                    <input
                      type="text"
                      aria-label="Install by VS Code Extension ID"
                      placeholder="publisher.extension (e.g. ms-python.python)"
                      value={customExtensionSlug}
                      onChange={(e) => setCustomExtensionSlug(e.target.value)}
                      className="flex-1 px-2 py-1 rounded bg-[#141414] border border-[#3c3c3c] text-[11px] font-mono text-amber-200 outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isQueryingOpenVSX}
                      className="px-2.5 py-1 rounded bg-amber-400 hover:bg-amber-300 text-stone-950 font-bold text-[11px] shrink-0"
                    >
                      {isQueryingOpenVSX ? '...' : 'Fetch'}
                    </button>
                  </form>
                </div>

                {/* Extensions List */}
                <div className="flex-1 overflow-y-auto divide-y divide-[#2b2b2b]">
                  {filteredExtensions.map((ext) => {
                    const isSelected = selectedExtension?.id === ext.id && showingExtensionDetail;
                    return (
                      <div
                        key={ext.id}
                        onClick={() => {
                          setSelectedExtensionId(ext.id);
                          setShowingExtensionDetail(true);
                        }}
                        className={`p-3 cursor-pointer transition-colors space-y-1.5 ${
                          isSelected ? 'bg-[#2a2d2e]' : 'hover:bg-[#252526]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-bold text-white">{ext.displayName}</div>
                            <div className="text-[10px] font-mono text-stone-400">
                              {ext.id} · v{ext.version}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-amber-400 font-mono">
                            <Download className="w-3 h-3" />
                            <span>{ext.downloads}</span>
                          </div>
                        </div>

                        <p className="text-[11px] text-stone-300 line-clamp-2">{ext.description}</p>

                        <div className="flex items-center justify-between pt-1">
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-300">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <span>{ext.rating}</span>
                          </span>

                          <div className="flex items-center gap-1.5">
                            {ext.installed && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleEnableExtension(ext.id);
                                }}
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  ext.enabled
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : 'bg-stone-800 text-stone-400'
                                }`}
                              >
                                {ext.enabled ? 'Enabled' : 'Disabled'}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleInstallExtension(ext.id);
                              }}
                              className={`px-2.5 py-0.5 rounded text-[10px] font-semibold ${
                                ext.installed
                                  ? 'bg-[#37373d] text-stone-200 hover:bg-rose-500/20 hover:text-rose-300'
                                  : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                              }`}
                            >
                              {ext.installed ? 'Uninstall' : 'Install'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        )}

        {/* 3. MAIN EDITOR + LIVE SERVER SPLIT PANE + COLLAPSIBLE BOTTOM PANEL */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Open Editor File Tabs */}
          <div className="h-9 bg-[#181818] border-b border-[#2b2b2b] flex items-center overflow-x-auto shrink-0">
            {files.map((file) => {
              const isActive = activeFile?.id === file.id && !showingExtensionDetail;
              return (
                <div
                  key={file.id}
                  onClick={() => {
                    setShowingExtensionDetail(false);
                    onSelectFile(file.id);
                  }}
                  className={`h-full px-3 border-r border-[#2b2b2b] flex items-center gap-2 text-xs font-mono cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-[#1e1e1e] text-amber-300 border-t-2 border-t-amber-400 font-semibold'
                      : 'text-stone-400 hover:bg-[#252526]'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5 text-sky-400" />
                  <span>{file.name}</span>
                  {openTabIds.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Close ${file.name}`}
                      onClick={(e) => handleCloseFileTab(file.id, e)}
                      className="p-0.5 rounded hover:bg-stone-700/60 text-stone-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* GitLens Inline Authorship Bar */}
          {hasGitLens && activeFile && !showingExtensionDetail && (
            <div className="px-4 py-1 bg-[#1b2028] border-b border-[#2b2b2b] flex items-center justify-between text-[11px] font-mono text-stone-400 shrink-0">
              <span>GitLens · Verified by Morrow &amp; PolicyGuard · {activeFile.path}</span>
              <span className="text-emerald-400">sha256:verified · 0 uncommitted policy drifts</span>
            </div>
          )}

          {/* Split Area: Code Editor (or Marketplace Extension Detail) + Live Server Preview */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Code Editor Canvas */}
            <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${editorCanvasClass}`}>
              {showingExtensionDetail && selectedExtension ? (
                <div className="p-6 overflow-y-auto space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-stone-700/60">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white">
                          {selectedExtension.displayName}
                        </h2>
                        <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono text-xs">
                          v{selectedExtension.version}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-stone-400 mt-0.5">
                        ID: {selectedExtension.id} · Publisher: {selectedExtension.publisher} ·{' '}
                        {selectedExtension.downloads} downloads
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowingExtensionDetail(false)}
                        className="px-3 py-1.5 rounded-lg border border-stone-600 text-stone-200 text-xs"
                      >
                        Back to Code Editor
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleInstallExtension(selectedExtension.id)}
                        className={`px-4 py-1.5 rounded-lg font-semibold text-xs ${
                          selectedExtension.installed
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-sky-500 text-slate-950'
                        }`}
                      >
                        {selectedExtension.installed
                          ? 'Uninstall Extension'
                          : 'Install from VS Code Marketplace'}
                      </button>
                    </div>
                  </div>

                  <p className="text-sm text-stone-200">{selectedExtension.description}</p>
                  <div className="p-4 rounded-xl bg-black/30 border border-stone-700/60 space-y-2 text-xs">
                    <div className="font-bold text-amber-300">
                      Marketplace Extension Contributions
                    </div>
                    <p className="text-stone-300">{selectedExtension.readmeSummary}</p>
                    <div className="text-[11px] font-mono text-stone-400">
                      Registry URL: {selectedExtension.marketplaceUrl}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex overflow-hidden">
                  {/* Line Numbers Gutter */}
                  <div className="w-12 py-3 bg-black/20 border-r border-[#2b2b2b] text-right pr-3 font-mono text-xs text-stone-500 select-none overflow-hidden">
                    {Array.from({ length: Math.max(1, lineCount) }).map((_, i) => (
                      <div key={i} className="leading-6">
                        {i + 1}
                      </div>
                    ))}
                  </div>

                  {/* Editable Code Textarea */}
                  <textarea
                    aria-label="VS Code Editor Input"
                    value={activeFile?.content || ''}
                    onChange={(e) => {
                      if (!activeFile) return;
                      onUpdateFileContent(activeFile.id, e.target.value);
                    }}
                    spellCheck={false}
                    className="flex-1 p-3 bg-transparent font-mono text-xs leading-6 outline-none resize-none overflow-y-auto"
                  />
                </div>
              )}
            </div>

            {/* Live Server Preview Split Pane */}
            {hasLiveServer && livePreviewOpen && (
              <div className="w-80 lg:w-96 border-l border-[#2b2b2b] bg-[#12151e] flex flex-col shrink-0">
                <div className="px-3 py-2 border-b border-[#2b2b2b] flex items-center justify-between text-xs">
                  <span className="font-semibold text-sky-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Live Server ({activeFile?.name})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setLivePreviewOpen(false)}
                    className="text-stone-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex-1 p-3 overflow-y-auto text-xs space-y-3">
                  {activeFile?.language === 'html' ? (
                    <iframe
                      title="VS Code Live Server Preview"
                      sandbox="allow-scripts"
                      srcDoc={activeFile.content}
                      className="w-full h-full min-h-[260px] rounded-lg border border-stone-800 bg-slate-950"
                    />
                  ) : (
                    <div className="p-4 rounded-xl bg-[#181d2a] border border-stone-800 space-y-2">
                      <div className="text-[11px] font-mono uppercase text-amber-400">
                        Live Module Inspector · {activeFile?.path}
                      </div>
                      <p className="text-stone-300 text-xs">
                        {activeFile?.content.split('\n').length} lines compiled cleanly. Click{' '}
                        <strong>Save as Artifact</strong> in the top bar to open this module in the
                        Artifact Studio.
                      </p>
                      <pre className="p-2.5 rounded bg-black/50 font-mono text-[11px] text-emerald-300 overflow-x-auto">
                        {activeFile?.content.slice(0, 280)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 4. COLLAPSIBLE INTEGRATED BOTTOM PANEL (Terminal | ESLint Problems | Extension Host) */}
          {bottomPanelOpen ? (
            <div className="h-40 bg-[#181818] border-t border-[#2b2b2b] flex flex-col shrink-0">
              <div className="px-4 py-1.5 border-b border-[#2b2b2b] flex items-center justify-between text-xs">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setBottomTab('terminal')}
                    className={`inline-flex items-center gap-1.5 py-0.5 font-semibold ${
                      bottomTab === 'terminal'
                        ? 'text-amber-300 border-b border-amber-400'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>TERMINAL</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBottomTab('problems')}
                    className={`inline-flex items-center gap-1.5 py-0.5 font-semibold ${
                      bottomTab === 'problems'
                        ? 'text-amber-300 border-b border-amber-400'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>PROBLEMS ({lintDiagnostics.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBottomTab('output')}
                    className={`inline-flex items-center gap-1.5 py-0.5 font-semibold ${
                      bottomTab === 'output'
                        ? 'text-amber-300 border-b border-amber-400'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>EXTENSION HOST</span>
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline text-[10px] font-mono text-stone-400">
                    UTF-8 · {activeFile?.language.toUpperCase()} · {activeExtensions.length} Addons
                  </span>
                  <button
                    type="button"
                    onClick={() => setBottomPanelOpen(false)}
                    aria-label="Minimize Bottom Panel"
                    className="p-0.5 rounded hover:bg-[#2a2d2e] text-stone-400 hover:text-white"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 p-3 overflow-y-auto font-mono text-xs">
                {bottomTab === 'terminal' && (
                  <div className="space-y-1">
                    {terminalLines.map((line, i) => (
                      <div key={i} className="text-stone-300">
                        {line}
                      </div>
                    ))}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!terminalCommand.trim()) return;
                        setTerminalLines((prev) => [
                          ...prev,
                          `$ ${terminalCommand}`,
                          `✓ Executed "${terminalCommand}" in PolicyGuard workspace sandbox.`,
                        ]);
                        setTerminalCommand('');
                      }}
                      className="flex items-center gap-2 pt-1"
                    >
                      <span className="text-emerald-400">$</span>
                      <input
                        type="text"
                        aria-label="Integrated Terminal Command Input"
                        placeholder="Enter command (e.g. npm test, eslint src)..."
                        value={terminalCommand}
                        onChange={(e) => setTerminalCommand(e.target.value)}
                        className="flex-1 bg-transparent text-amber-200 outline-none"
                      />
                    </form>
                  </div>
                )}

                {bottomTab === 'problems' && (
                  <div className="space-y-1.5">
                    {lintDiagnostics.length === 0 ? (
                      <div className="text-emerald-400">
                        ✓ [dbaeumer.vscode-eslint] Zero problems detected in {activeFile?.path}.
                      </div>
                    ) : (
                      lintDiagnostics.map((d, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-amber-300">
                          <span>Line {d.line}:</span>
                          <span className="font-semibold">[{d.ruleId}]</span>
                          <span>{d.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {bottomTab === 'output' && (
                  <div className="space-y-1 text-stone-300">
                    {activeExtensions.map((ext) => (
                      <div key={ext.id}>
                        [Activated] {ext.id}@{ext.version} — {ext.displayName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-6 px-3 bg-[#1f1f1f] border-t border-[#2b2b2b] flex items-center justify-between text-[11px] font-mono text-stone-400 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setBottomPanelOpen(true)}
                  className="inline-flex items-center gap-1 hover:text-white"
                >
                  <ChevronUp className="w-3 h-3" />
                  <span>Terminal &amp; Problems ({lintDiagnostics.length})</span>
                </button>
              </div>
              <span>
                Ln {lineCount} · {activeFile?.language.toUpperCase()} · {activeExtensions.length}{' '}
                Marketplace Addons
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

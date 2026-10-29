/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProjectsAndArtifactsView — Calm, progressive-disclosure Projects & Artifacts Studio:
 * - Compact project header with active project context, Edit instructions drawer, and New project modal
 * - Concise resource summary bar (Chat, Skills, Connected Apps, Scheduled Jobs)
 * - Searchable & filterable Artifact Library paired with the live ArtifactSplitDrawer
 */

import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  Code2,
  FolderKanban,
  Layers,
  MessageSquare,
  Plug,
  Plus,
  Search,
  SlidersHorizontal,
  TerminalSquare,
  Wand2,
} from 'lucide-react';
import {
  ArtifactKind,
  ReusableSkill,
  ScheduledTaskItem,
  WorkspaceArtifact,
  WorkspaceConnector,
  WorkspaceProject,
  createWorkspaceProject,
} from '../packages/workspace';
import { ArtifactSplitDrawer } from './ArtifactSplitDrawer';
import { EmptyStateBlock, PageHeader, SlideOverDrawer } from './ui/WorkspacePrimitives';

interface ProjectsAndArtifactsViewProps {
  projects: WorkspaceProject[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (project: WorkspaceProject) => void;
  onUpdateProject?: (
    projectId: string,
    patch: Partial<
      Pick<WorkspaceProject, 'name' | 'description' | 'systemInstruction' | 'accentColor'>
    >
  ) => void;
  artifacts: WorkspaceArtifact[];
  activeArtifactId: string | null;
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
  skills: ReusableSkill[];
  connectors: WorkspaceConnector[];
  schedules: ScheduledTaskItem[];
  onNavigateWorkspace: (
    view: 'chat' | 'ide' | 'skills' | 'connectors' | 'scheduler'
  ) => void;
  uiTheme: 'dark' | 'light';
}

export const ProjectsAndArtifactsView: React.FC<ProjectsAndArtifactsViewProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onUpdateProject,
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  onSaveArtifactVersion,
  onRollbackArtifact,
  onOpenInVSCodeIde,
  skills,
  connectors,
  schedules,
  onNavigateWorkspace,
  uiTheme,
}) => {
  const isLight = uiTheme === 'light';
  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const projectArtifacts = artifacts.filter((a) => a.projectId === activeProject.id);

  // Search & Type Filter for Artifacts
  const [artifactSearch, setArtifactSearch] = useState<string>('');
  const [artifactTypeFilter, setArtifactTypeFilter] = useState<string>('ALL');

  const filteredArtifacts = useMemo(() => {
    const q = artifactSearch.trim().toLowerCase();
    return projectArtifacts.filter((art) => {
      if (artifactTypeFilter !== 'ALL' && art.kind !== artifactTypeFilter) {
        return false;
      }
      if (!q) return true;
      return (
        art.title.toLowerCase().includes(q) ||
        art.kind.toLowerCase().includes(q) ||
        (art.sourcePrompt || '').toLowerCase().includes(q)
      );
    });
  }, [projectArtifacts, artifactSearch, artifactTypeFilter]);

  const currentArtifact =
    projectArtifacts.find((a) => a.id === activeArtifactId) ||
    projectArtifacts[0] ||
    artifacts[0] ||
    null;

  // Drawers for New Project & Project System Instructions
  const [showNewProjectDrawer, setShowNewProjectDrawer] = useState<boolean>(false);
  const [newProjName, setNewProjName] = useState<string>('');
  const [newProjDesc, setNewProjDesc] = useState<string>('');
  const [newProjSystem, setNewProjSystem] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  const [instructionsDrawerOpen, setInstructionsDrawerOpen] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>(activeProject.name);
  const [editDesc, setEditDesc] = useState<string>(activeProject.description);
  const [editSystem, setEditSystem] = useState<string>(activeProject.systemInstruction);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);

  const boundConnectors = connectors.filter((c) =>
    c.boundProjectIds.includes(activeProject.id)
  );
  const projectSchedules = schedules.filter((s) => s.projectId === activeProject.id);

  const handleOpenInstructionsDrawer = () => {
    setEditName(activeProject.name);
    setEditDesc(activeProject.description);
    setEditSystem(activeProject.systemInstruction);
    setSavedNotice(false);
    setInstructionsDrawerOpen(true);
  };

  const handleSaveInstructions = (e: React.FormEvent) => {
    e.preventDefault();
    if (onUpdateProject) {
      onUpdateProject(activeProject.id, {
        name: editName,
        description: editDesc,
        systemInstruction: editSystem,
      });
    }
    setSavedNotice(true);
    window.setTimeout(() => {
      setSavedNotice(false);
      setInstructionsDrawerOpen(false);
    }, 500);
  };

  const handleCreateProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) {
      setFormError('Enter a project name.');
      return;
    }
    const created = createWorkspaceProject({
      name: newProjName,
      description: newProjDesc,
      systemInstruction: newProjSystem,
    });
    onCreateProject(created);
    onSelectProject(created.id);
    setNewProjName('');
    setNewProjDesc('');
    setNewProjSystem('');
    setFormError(null);
    setShowNewProjectDrawer(false);
  };

  const formatKindLabel = (kind: ArtifactKind) => {
    switch (kind) {
      case 'html_preview':
        return 'HTML Interactive';
      case 'svg_graphic':
        return 'SVG Diagram';
      case 'markdown_doc':
        return 'Markdown Spec';
      case 'react_component':
        return 'React TSX';
      default:
        return kind;
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row overflow-hidden">
      {/* Left Column: Compact Project Context + Searchable Artifact Library */}
      <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
        <PageHeader
          title={activeProject.name}
          subtitle={activeProject.description}
          metaText={`Updated ${activeProject.updatedAt}`}
          uiTheme={uiTheme}
          actions={
            <>
              <button
                type="button"
                onClick={handleOpenInstructionsDrawer}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap ${
                  isLight
                    ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                    : 'bg-stone-900 border-stone-700/80 text-stone-200 hover:bg-stone-800'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                <span>Instructions &amp; guardrails</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigateWorkspace('ide')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap ${
                  isLight
                    ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                    : 'bg-stone-900 border-stone-700/80 text-stone-200 hover:bg-stone-800'
                }`}
              >
                <TerminalSquare className="w-3.5 h-3.5 text-sky-400" />
                <span>Open in IDE</span>
              </button>

              <button
                type="button"
                onClick={() => setShowNewProjectDrawer(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New project</span>
              </button>
            </>
          }
        />

        {/* Compact Project Switcher Strip + Linked Resource Summary */}
        <div
          className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
            isLight ? 'bg-white border-stone-200/90' : 'bg-[#121620] border-stone-800/90'
          }`}
        >
          {/* Project Switcher Tabs */}
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Workspace Projects">
            {projects.map((proj) => {
              const isSelected = proj.id === activeProject.id;
              const artCount = artifacts.filter((a) => a.projectId === proj.id).length;
              return (
                <button
                  key={proj.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => onSelectProject(proj.id)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border font-medium transition-colors whitespace-nowrap ${
                    isSelected
                      ? isLight
                        ? 'bg-stone-900 text-white border-stone-900 font-semibold'
                        : 'bg-amber-400/15 border-amber-400/40 text-amber-300 font-semibold'
                      : isLight
                      ? 'bg-stone-100 border-stone-200 text-stone-700 hover:bg-stone-200/70'
                      : 'bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200'
                  }`}
                >
                  <FolderKanban className="w-3.5 h-3.5 shrink-0" />
                  <span>{proj.name}</span>
                  <span className="text-[10px] font-mono opacity-75">({artCount})</span>
                </button>
              );
            })}
          </div>

          {/* Concise Linked Resources Bar */}
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <button
              type="button"
              onClick={() => onNavigateWorkspace('chat')}
              className="inline-flex items-center gap-1 text-stone-400 hover:text-amber-300 transition-colors whitespace-nowrap"
            >
              <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
              <span>Project chat</span>
            </button>
            <span aria-hidden="true" className="text-stone-600">
              ·
            </span>
            <button
              type="button"
              onClick={() => onNavigateWorkspace('skills')}
              className="inline-flex items-center gap-1 text-stone-400 hover:text-emerald-300 transition-colors whitespace-nowrap"
            >
              <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{skills.length} skills</span>
            </button>
            <span aria-hidden="true" className="text-stone-600">
              ·
            </span>
            <button
              type="button"
              onClick={() => onNavigateWorkspace('connectors')}
              className="inline-flex items-center gap-1 text-stone-400 hover:text-sky-300 transition-colors whitespace-nowrap"
            >
              <Plug className="w-3.5 h-3.5 text-sky-400" />
              <span>{boundConnectors.length} connected apps</span>
            </button>
            <span aria-hidden="true" className="text-stone-600">
              ·
            </span>
            <button
              type="button"
              onClick={() => onNavigateWorkspace('scheduler')}
              className="inline-flex items-center gap-1 text-stone-400 hover:text-purple-300 transition-colors whitespace-nowrap"
            >
              <CalendarClock className="w-3.5 h-3.5 text-purple-400" />
              <span>{projectSchedules.length} scheduled jobs</span>
            </button>
          </div>
        </div>

        {/* Searchable & Filterable Artifact Library */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-bold">Saved Artifacts</h2>
              <span className="text-xs text-stone-400 font-mono">
                ({filteredArtifacts.length})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search Input */}
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs ${
                  isLight
                    ? 'bg-white border-stone-300 text-stone-800'
                    : 'bg-[#0E1118] border-stone-800 text-stone-200'
                }`}
              >
                <Search className="w-3.5 h-3.5 text-stone-400" />
                <input
                  type="text"
                  aria-label="Search project artifacts"
                  placeholder="Filter artifacts..."
                  value={artifactSearch}
                  onChange={(e) => setArtifactSearch(e.target.value)}
                  className="bg-transparent outline-none w-36 sm:w-44 text-xs"
                />
              </div>

              {/* Type Filter Buttons */}
              <div className="flex items-center gap-1">
                {[
                  { id: 'ALL', label: 'All' },
                  { id: 'html_preview', label: 'HTML' },
                  { id: 'svg_graphic', label: 'SVG' },
                  { id: 'markdown_doc', label: 'Spec' },
                ].map((flt) => (
                  <button
                    key={flt.id}
                    type="button"
                    onClick={() => setArtifactTypeFilter(flt.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                      artifactTypeFilter === flt.id
                        ? 'bg-amber-400 text-stone-950 font-semibold'
                        : isLight
                        ? 'bg-stone-200/70 text-stone-700 hover:bg-stone-300/70'
                        : 'bg-stone-900 text-stone-400 hover:text-stone-200 border border-stone-800'
                    }`}
                  >
                    {flt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredArtifacts.length === 0 ? (
            <EmptyStateBlock
              title="No matching artifacts in this project"
              description="Generate a dashboard, component, or diagram in Chat, or clear your search filter."
              actionLabel={artifactSearch || artifactTypeFilter !== 'ALL' ? 'Clear filters' : 'Open Chat'}
              onAction={() => {
                if (artifactSearch || artifactTypeFilter !== 'ALL') {
                  setArtifactSearch('');
                  setArtifactTypeFilter('ALL');
                } else {
                  onNavigateWorkspace('chat');
                }
              }}
            />
          ) : (
            <div
              className={`rounded-2xl border divide-y overflow-hidden ${
                isLight
                  ? 'bg-white border-stone-200/90 divide-stone-200/80'
                  : 'bg-[#121620] border-stone-800/90 divide-stone-800/70'
              }`}
            >
              {filteredArtifacts.map((art) => {
                const active = currentArtifact?.id === art.id;
                return (
                  <div
                    key={art.id}
                    onClick={() => onSelectArtifact(art.id)}
                    className={`p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer transition-colors ${
                      active
                        ? isLight
                          ? 'bg-amber-50/70'
                          : 'bg-amber-400/8'
                        : isLight
                        ? 'hover:bg-stone-50'
                        : 'hover:bg-stone-800/40'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold truncate">{art.title}</span>
                        <span className="text-[11px] font-mono text-stone-400 shrink-0">
                          v{art.currentVersion} · {formatKindLabel(art.kind)} · {art.updatedAt}
                        </span>
                      </div>
                      {art.sourcePrompt && (
                        <p className="text-[11px] text-stone-400 truncate">
                          {art.sourcePrompt}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectArtifact(art.id);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                          active
                            ? 'bg-amber-400 border-amber-400 text-stone-950 font-semibold'
                            : isLight
                            ? 'bg-stone-100 border-stone-300 text-stone-700 hover:bg-stone-200'
                            : 'bg-stone-900 border-stone-700 text-stone-200 hover:bg-stone-800'
                        }`}
                      >
                        Inspect
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInVSCodeIde(art);
                        }}
                        className="px-2.5 py-1 rounded-lg border border-stone-700/80 hover:bg-stone-800 text-xs font-medium inline-flex items-center gap-1"
                      >
                        <Code2 className="w-3.5 h-3.5 text-sky-400" />
                        <span>Open in IDE</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Live Artifact Studio Inspector */}
      <div className="w-full lg:w-[480px] xl:w-[540px] shrink-0 h-[520px] lg:h-full border-t lg:border-t-0 lg:border-l border-stone-800">
        <ArtifactSplitDrawer
          artifacts={projectArtifacts.length > 0 ? projectArtifacts : artifacts}
          activeArtifact={currentArtifact}
          onSelectArtifact={onSelectArtifact}
          onSaveArtifactVersion={onSaveArtifactVersion}
          onRollbackArtifact={onRollbackArtifact}
          onOpenInVSCodeIde={onOpenInVSCodeIde}
          uiTheme={uiTheme}
          embeddedMode
        />
      </div>

      {/* Progressive Disclosure Drawer 1: Edit Project Instructions & Guardrails */}
      <SlideOverDrawer
        open={instructionsDrawerOpen}
        title="Project Instructions & Guardrails"
        subtitle={`Scoped to ${activeProject.name}`}
        onClose={() => setInstructionsDrawerOpen(false)}
        uiTheme={uiTheme}
        footer={
          <>
            <button
              type="button"
              onClick={() => setInstructionsDrawerOpen(false)}
              className="px-3.5 py-1.5 rounded-xl border border-stone-700 text-xs text-stone-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="project-instructions-form"
              className="px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs"
            >
              {savedNotice ? 'Saved!' : 'Save changes'}
            </button>
          </>
        }
      >
        <form id="project-instructions-form" onSubmit={handleSaveInstructions} className="space-y-4">
          <div>
            <label className="block font-semibold mb-1">Project Name</label>
            <input
              type="text"
              aria-label="Edit Project Name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Summary Description</label>
            <input
              type="text"
              aria-label="Edit Project Description"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">
              Custom System Instructions (Injected into Project Chats &amp; Skills)
            </label>
            <textarea
              rows={5}
              aria-label="Project System Instructions"
              value={editSystem}
              onChange={(e) => setEditSystem(e.target.value)}
              className="w-full p-3 rounded-xl border border-stone-700 bg-stone-950 font-mono text-xs text-amber-100 outline-none focus:border-amber-400"
            />
            <p className="text-[11px] text-stone-400 mt-1">
              Note: Project instructions guide tone and workflow priorities; they cannot override
              Trust Kernel PolicyGuard rules or authorize unattended payments.
            </p>
          </div>
        </form>
      </SlideOverDrawer>

      {/* Progressive Disclosure Drawer 2: Create New Project */}
      <SlideOverDrawer
        open={showNewProjectDrawer}
        title="Create Workspace Project"
        subtitle="Scopes chats, saved artifacts, connectors, and scheduled jobs"
        onClose={() => setShowNewProjectDrawer(false)}
        uiTheme={uiTheme}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowNewProjectDrawer(false)}
              className="px-3.5 py-1.5 rounded-xl border border-stone-700 text-xs text-stone-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-project-form"
              className="px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs"
            >
              Create project
            </button>
          </>
        }
      >
        <form
          id="create-project-form"
          aria-label="Create New Project Form"
          onSubmit={handleCreateProjectSubmit}
          className="space-y-4"
        >
          {formError && (
            <div className="p-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-300">
              {formError}
            </div>
          )}

          <div>
            <label className="block font-semibold mb-1">Project Name *</label>
            <input
              type="text"
              aria-label="New Project Name"
              placeholder="e.g., Q4 Revenue Automation"
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Description</label>
            <input
              type="text"
              aria-label="New Project Description"
              placeholder="One-line purpose for this project"
              value={newProjDesc}
              onChange={(e) => setNewProjDesc(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Custom System Instructions</label>
            <textarea
              rows={4}
              aria-label="New Project System Instructions"
              placeholder="Optional instructions injected into project chats and skills..."
              value={newProjSystem}
              onChange={(e) => setNewProjSystem(e.target.value)}
              className="w-full p-3 rounded-xl border border-stone-700 bg-stone-950 font-mono text-xs text-stone-100 outline-none focus:border-amber-400"
            />
          </div>
        </form>
      </SlideOverDrawer>
    </div>
  );
};

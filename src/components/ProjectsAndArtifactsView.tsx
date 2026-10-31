/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProjectsAndArtifactsView (Prompt 2/4 — For Any User, Not Just Developers)
 * - Clean 2-column layout:
 *   Left: Simple project list + 'New project' modal with name, optional icon/color,
 *         optional description, and 6 neutral starters (Plan something, Research, Write,
 *         Create media, Organize files, Code) — never defaults to a developer project.
 *   Right: Project workspace with tabs 'Files', 'Chats', and 'About' (plain-language instructions,
 *          linked Skills, Schedules, and Memory scope). No duplicate panel layered behind it.
 * - Artifact Viewer opens as a clean modal on top and is easy to close (Close button, Esc, backdrop).
 * - Previews by type: Document reader, PDF viewer, CSV Table view, Slides viewer, Image viewer,
 *   Audio & Video players, Sandboxed HTML preview, and Code & data viewer.
 * - Supports Download, Rename, Delete with Undo, Version Rollback, Drag-and-drop import,
 *   Grid and List views, Search, and Type filter.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Compass,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Globe,
  GraduationCap,
  Grid,
  Heart,
  History,
  Image as ImageIcon,
  Lightbulb,
  List,
  MessageSquare,
  Music,
  Palette,
  Plus,
   Presentation,
  RotateCcw,
  Search,
  Sparkles,
  Store,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  ARTIFACT_CATEGORY_LABELS,
  ArtifactMediaCategory,
  DeletedArtifactUndoTicket,
  GeneralProject,
  PROJECT_NEUTRAL_STARTERS,
  ProjectColorName,
  ProjectIconName,
  ProjectStarterId,
  UniversalArtifact,
  UniversalArtifactStore,
  createGeneralProject,
  formatBytesHuman,
  inferCategoryAndMimeFromFileName,
  requestAgentArtifactGeneration,
  resolveArtifactPreviewDescriptor,
} from '../packages/projects_evals';
import { UnifiedSkillItem } from '../packages/hub';
import { ScheduledTaskItem } from '../packages/workspace';

export interface ProjectChatSummary {
  id: string;
  projectId: string;
  title: string;
  updatedAt: string;
  lastMessagePreview: string;
}

export interface ProjectsAndArtifactsViewProps {
  generalProjects: GeneralProject[];
  activeGeneralProjectId: string;
  onSelectGeneralProject: (projectId: string) => void;
  onCreateGeneralProject: (project: GeneralProject) => void;
  onUpdateGeneralProject: (projectId: string, patch: Partial<GeneralProject>) => void;
  artifactStore: UniversalArtifactStore;
  universalArtifacts: UniversalArtifact[];
  onRefreshArtifacts: () => void;
  unifiedSkills: UnifiedSkillItem[];
  schedules: ScheduledTaskItem[];
  chatSummaries: ProjectChatSummary[];
  onOpenChatThread: (threadId: string) => void;
  onStartNewProjectChat: (projectId: string) => void;
  onNavigateWorkspace: (view: 'chat' | 'ide' | 'skills' | 'connectors' | 'scheduler') => void;
  modelRuntimeMode?: 'mock' | 'live';
  uiTheme: 'dark' | 'light';
}

const PROJECT_ICON_MAP: Record<ProjectIconName, React.FC<{ className?: string }>> = {
  Compass,
  Heart,
  Store,
  GraduationCap,
  Lightbulb,
  Folder,
  BookOpen,
  Sparkles,
  Palette,
  Code2,
};

const COLOR_BADGE_CLASSES: Record<ProjectColorName, string> = {
  sky: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rose: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  violet: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  stone: 'bg-stone-500/15 text-stone-300 border-stone-500/30',
};

const CATEGORY_ICON_MAP: Record<ArtifactMediaCategory, React.FC<{ className?: string }>> = {
  document: FileText,
  spreadsheet: FileSpreadsheet,
  slides: Presentation,
  image: ImageIcon,
  audio: Music,
  video: Film,
  webpage: Globe,
  code_data: Code2,
};

export const ProjectsAndArtifactsView: React.FC<ProjectsAndArtifactsViewProps> = ({
  generalProjects,
  activeGeneralProjectId,
  onSelectGeneralProject,
  onCreateGeneralProject,
  onUpdateGeneralProject,
  artifactStore,
  universalArtifacts,
  onRefreshArtifacts,
  unifiedSkills,
  schedules,
  chatSummaries,
  onOpenChatThread,
  onStartNewProjectChat,
  onNavigateWorkspace,
  modelRuntimeMode = 'mock',
  uiTheme,
}) => {
  const isLight = uiTheme === 'light';
  const activeProject =
    generalProjects.find((p) => p.id === activeGeneralProjectId) || generalProjects[0];

  // Workspace Right-Hand Tabs: Files, Chats, About
  const [activeTab, setActiveTab] = useState<'files' | 'chats' | 'about'>('files');

  // Artifact Search, Type Filter & Grid/List View
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ArtifactMediaCategory | 'ALL'>('ALL');
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');

  // Active Artifact Modal Viewer (opens on top, easy to close)
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState<number>(0);
  const [imageZoomPct, setImageZoomPct] = useState<number>(100);
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  const [renameDraft, setRenameDraft] = useState<string>('');
  const [isEditingContent, setIsEditingContent] = useState<boolean>(false);
  const [editContentDraft, setEditContentDraft] = useState<string>('');
  const [editSummaryDraft, setEditSummaryDraft] = useState<string>('');

  // Undo Delete Toast
  const [undoTicket, setUndoTicket] = useState<DeletedArtifactUndoTicket | null>(null);

  // Honest Capability Notice Banner (e.g. when Video generation is requested)
  const [honestBanner, setHonestBanner] = useState<string | null>(null);

  // Drag-and-drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // New Project Modal state
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjStarter, setNewProjStarter] = useState<ProjectStarterId | undefined>(undefined);
  const [newProjIcon, setNewProjIcon] = useState<ProjectIconName>('Compass');
  const [newProjColor, setNewProjColor] = useState<ProjectColorName>('sky');

  // About Tab Editing state
  const [aboutDraft, setAboutDraft] = useState(activeProject.aboutInstructions);
  const [aboutSavedToast, setAboutSavedToast] = useState(false);
  const [newMemoryScopeNote, setNewMemoryScopeNote] = useState('');

  useEffect(() => {
    setAboutDraft(activeProject.aboutInstructions);
  }, [activeProject.id, activeProject.aboutInstructions]);

  // Close artifact viewer on Escape
  useEffect(() => {
    if (!openArtifactId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenArtifactId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openArtifactId]);

  const projectArtifacts = useMemo(
    () =>
      artifactStore.list({
        projectId: activeProject.id,
        category: categoryFilter,
        searchQuery,
      }),
    [artifactStore, universalArtifacts, activeProject.id, categoryFilter, searchQuery]
  );

  const openArtifact = useMemo(
    () => (openArtifactId ? artifactStore.read(openArtifactId) : null),
    [artifactStore, universalArtifacts, openArtifactId]
  );

  const openPreview = useMemo(
    () => (openArtifact ? resolveArtifactPreviewDescriptor(openArtifact) : null),
    [openArtifact]
  );

  const projectChats = useMemo(
    () => chatSummaries.filter((c) => c.projectId === activeProject.id),
    [chatSummaries, activeProject.id]
  );

  const projectSchedules = useMemo(
    () => schedules.filter((s) => s.projectId === activeProject.id),
    [schedules, activeProject.id]
  );

  const handleOpenArtifactModal = (art: UniversalArtifact) => {
    setOpenArtifactId(art.id);
    setSlideIndex(0);
    setImageZoomPct(100);
    setIsRenaming(false);
    setRenameDraft(art.title);
    setIsEditingContent(false);
    setEditContentDraft(art.content);
    setEditSummaryDraft('');
  };

  const handleImportBrowserFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      const inferred = inferCategoryAndMimeFromFileName(file.name, file.type);
      const isBinaryMedia =
        inferred.category === 'image' ||
        inferred.category === 'audio' ||
        inferred.category === 'video';
      const content = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve(`Imported file: ${file.name}`);
        if (isBinaryMedia) {
          reader.readAsDataURL(file);
        } else {
          reader.readAsText(file);
        }
      });

      const created = artifactStore.create({
        projectId: activeProject.id,
        title: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        category: inferred.category,
        mimeType: inferred.mimeType,
        content,
        creator: 'user',
        originChatOrMission: 'Imported by you',
        tags: [inferred.category, 'imported'],
      });
      setOpenArtifactId(created.id);
    }
    onRefreshArtifacts();
  };

  const handleQuickCreateArtifact = (category: ArtifactMediaCategory, promptLabel: string) => {
    setHonestBanner(null);
    if (category === 'video' || category === 'image') {
      const gen = requestAgentArtifactGeneration({
        projectId: activeProject.id,
        requestedCategory: category,
        prompt: `${activeProject.name} — ${promptLabel}`,
        mode: modelRuntimeMode,
        store: artifactStore,
      });
      if (gen.status === 'unsupported_capability') {
        setHonestBanner(gen.honestMessage);
        return;
      }
      if (gen.artifact) {
        onRefreshArtifacts();
        handleOpenArtifactModal(gen.artifact);
      }
      return;
    }

    const defaultBody =
      category === 'spreadsheet'
        ? `Item,Category,Status,Notes\nSample Item 1,Planning,Ready,Added in ${activeProject.name}\nSample Item 2,Checklist,In progress,Verify details`
        : category === 'slides'
          ? `# ${activeProject.name}\n- Key goal and overview\n- Timeline and milestones\n---\n# Next Steps\n- Review checklist\n- Share with collaborators`
          : category === 'webpage'
            ? `<!doctype html><html><body style="font-family:sans-serif;padding:24px;"><h1>${activeProject.name}</h1><p>Interactive web page preview.</p></body></html>`
            : `# ${promptLabel}\n\nNotes and details for ${activeProject.name}.`;

    const created = artifactStore.create({
      projectId: activeProject.id,
      title: `${activeProject.name} ${ARTIFACT_CATEGORY_LABELS[category]}`,
      category,
      content: defaultBody,
      creator: 'user',
      originChatOrMission: `Created in ${activeProject.name}`,
      tags: [category],
    });
    onRefreshArtifacts();
    handleOpenArtifactModal(created);
  };

  const handleDownloadArtifact = (art: UniversalArtifact) => {
    if (typeof Blob === 'undefined' || typeof URL === 'undefined') return;
    const blob = new Blob([art.content], { type: `${art.mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = art.fileName || `${art.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateProjectFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) return;
    const created = createGeneralProject({
      name: newProjName,
      description: newProjDesc,
      icon: newProjIcon,
      color: newProjColor,
      starterId: newProjStarter,
    });
    onCreateGeneralProject(created);
    onSelectGeneralProject(created.id);
    setNewProjName('');
    setNewProjDesc('');
    setNewProjStarter(undefined);
    setNewProjectModalOpen(false);
  };

  const ActiveProjectIcon = PROJECT_ICON_MAP[activeProject.icon] || Folder;

  return (
    <div
      className="h-full flex flex-col md:flex-row overflow-hidden text-xs"
      data-testid="projects-and-artifacts-clean-layout"
    >
      {/* LEFT COLUMN: Simple Project List */}
      <aside
        aria-label="Projects list"
        data-testid="projects-sidebar-list"
        className={`w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r flex flex-col justify-between p-4 ${
          isLight ? 'bg-stone-50/80 border-stone-200' : 'bg-stone-950/60 border-stone-800/80'
        }`}
      >
        <div className="space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Projects</h2>
            <button
              type="button"
              data-testid="open-new-project-modal-btn"
              onClick={() => {
                setNewProjName('');
                setNewProjDesc('');
                setNewProjStarter(undefined);
                setNewProjIcon('Compass');
                setNewProjColor('sky');
                setNewProjectModalOpen(true);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          </div>

          <div className="space-y-1">
            {generalProjects.map((proj) => {
              const Icon = PROJECT_ICON_MAP[proj.icon] || Folder;
              const isSelected = proj.id === activeProject.id;
              const fileCount = universalArtifacts.filter((a) => a.projectId === proj.id).length;
              return (
                <button
                  key={proj.id}
                  type="button"
                  data-testid={`project-list-item-${proj.id}`}
                  onClick={() => onSelectGeneralProject(proj.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-colors flex items-center justify-between gap-2 ${
                    isSelected
                      ? isLight
                        ? 'bg-white border-sky-500/50 shadow-2xs'
                        : 'bg-stone-900 border-sky-500/40 text-stone-100'
                      : 'border-transparent text-stone-400 hover:bg-stone-500/10 hover:text-stone-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                        COLOR_BADGE_CLASSES[proj.color]
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{proj.name}</div>
                      <div className="text-[11px] text-stone-400 truncate">
                        {fileCount} {fileCount === 1 ? 'file' : 'files'}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-3 border-t border-stone-800/50 text-[11px] text-stone-400">
          Projects keep your files, chats, instructions, and memory neatly separated.
        </div>
      </aside>

      {/* RIGHT COLUMN: Single Clean Project Workspace (Tabs: Files, Chats, About) */}
      <div
        className="flex-1 flex flex-col h-full min-w-0 overflow-hidden"
        data-testid="project-workspace-panel"
      >
        {/* Project Header & Primary Tabs */}
        <header
          className={`px-6 pt-5 pb-3 border-b space-y-4 shrink-0 ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-950/40 border-stone-800/80'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span
                className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${
                  COLOR_BADGE_CLASSES[activeProject.color]
                }`}
              >
                <ActiveProjectIcon className="w-5 h-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold" data-testid="active-project-title">
                    {activeProject.name}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[11px] bg-stone-500/10 text-stone-400 border border-stone-700/50">
                    Memory isolated
                  </span>
                </div>
                <p className="text-stone-400 mt-0.5 max-w-2xl">{activeProject.description}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="project-header-new-chat-btn"
                onClick={() => onStartNewProjectChat(activeProject.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat in project</span>
              </button>
            </div>
          </div>

          {/* Three Workspace Tabs: Files, Chats, About */}
          <div className="flex items-center gap-2" role="tablist" aria-label="Project sections">
            {(
              [
                { id: 'files', label: `Files (${projectArtifacts.length})` },
                { id: 'chats', label: `Chats (${projectChats.length})` },
                { id: 'about', label: 'About' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                data-testid={`project-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-xl font-semibold transition-colors ${
                  activeTab === tab.id
                    ? 'bg-sky-600 text-white'
                    : isLight
                      ? 'text-stone-600 hover:bg-stone-100'
                      : 'text-stone-400 hover:bg-stone-800/60 hover:text-stone-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {/* TAB 1: FILES (ARTIFACTS) */}
        {activeTab === 'files' && (
          <div
            className="flex-1 overflow-y-auto p-6 space-y-5"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              handleImportBrowserFiles(e.dataTransfer.files);
            }}
          >
            {/* Undo Delete Toast Banner */}
            {undoTicket && (
              <div
                data-testid="artifact-undo-delete-banner"
                className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 flex items-center justify-between gap-3"
              >
                <span>
                  Deleted <strong>{undoTicket.artifact.title}</strong>.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="artifact-undo-delete-btn"
                    onClick={() => {
                      artifactStore.undoDelete(undoTicket.undoId);
                      setUndoTicket(null);
                      onRefreshArtifacts();
                    }}
                    className="px-3 py-1 rounded-lg bg-amber-500 text-stone-950 font-semibold"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={() => setUndoTicket(null)}
                    className="text-stone-400 hover:text-stone-200"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Honest Capability Refusal Notice (e.g., Video Generation) */}
            {honestBanner && (
              <div
                data-testid="artifact-honest-capability-banner"
                className="p-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 flex items-start justify-between gap-3 text-amber-200"
              >
                <div className="space-y-1">
                  <div className="font-semibold">Honest capability note</div>
                  <p>{honestBanner}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setHonestBanner(null)}
                  className="text-amber-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Search, Type Filters, View Switcher & Import/Create Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border flex-1 max-w-xs ${
                    isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                  }`}
                >
                  <Search className="w-3.5 h-3.5 text-stone-400" />
                  <input
                    type="text"
                    data-testid="artifact-search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search files, tags, or chats..."
                    className="bg-transparent outline-none w-full"
                  />
                </div>

                {/* Grid / List Toggle */}
                <div
                  className={`inline-flex rounded-xl border p-0.5 ${
                    isLight ? 'bg-stone-100 border-stone-200' : 'bg-stone-900 border-stone-800'
                  }`}
                >
                  <button
                    type="button"
                    data-testid="artifact-view-grid"
                    onClick={() => setViewLayout('grid')}
                    className={`p-1.5 rounded-lg ${
                      viewLayout === 'grid' ? 'bg-sky-600 text-white' : 'text-stone-400'
                    }`}
                    title="Grid view"
                  >
                    <Grid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    data-testid="artifact-view-list"
                    onClick={() => setViewLayout('list')}
                    className={`p-1.5 rounded-lg ${
                      viewLayout === 'list' ? 'bg-sky-600 text-white' : 'text-stone-400'
                    }`}
                    title="List view"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Import & Quick Create Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleImportBrowserFiles(e.target.files)}
                />
                <button
                  type="button"
                  data-testid="artifact-import-file-btn"
                  onClick={() => fileInputRef.current?.click()}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-medium ${
                    isLight
                      ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                      : 'bg-stone-900 border-stone-800 text-stone-200 hover:bg-stone-800'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5 text-sky-400" />
                  <span>Import file</span>
                </button>

                <button
                  type="button"
                  data-testid="quick-create-doc-btn"
                  onClick={() => handleQuickCreateArtifact('document', 'Notes & Summary')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New document</span>
                </button>

                <button
                  type="button"
                  data-testid="quick-create-image-btn"
                  onClick={() => handleQuickCreateArtifact('image', 'Visual Concept Illustration')}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-medium ${
                    isLight
                      ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                      : 'bg-stone-900 border-stone-800 text-stone-200 hover:bg-stone-800'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5 text-pink-400" />
                  <span>Create image</span>
                </button>

                <button
                  type="button"
                  data-testid="request-video-honest-btn"
                  onClick={() => handleQuickCreateArtifact('video', 'Walkthrough Video')}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-medium ${
                    isLight
                      ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                      : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
                  }`}
                >
                  <Film className="w-3.5 h-3.5 text-rose-400" />
                  <span>Create video</span>
                </button>
              </div>
            </div>

            {/* Human-Friendly Type Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-testid="artifact-filter-all"
                onClick={() => setCategoryFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl font-medium border transition-colors ${
                  categoryFilter === 'ALL'
                    ? 'bg-sky-600 text-white border-sky-600'
                    : isLight
                      ? 'bg-white border-stone-200 text-stone-600'
                      : 'bg-stone-900 border-stone-800 text-stone-400'
                }`}
              >
                All
              </button>
              {(Object.keys(ARTIFACT_CATEGORY_LABELS) as ArtifactMediaCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  data-testid={`artifact-filter-${cat}`}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 rounded-xl font-medium border transition-colors ${
                    categoryFilter === cat
                      ? 'bg-sky-600 text-white border-sky-600'
                      : isLight
                        ? 'bg-white border-stone-200 text-stone-600'
                        : 'bg-stone-900 border-stone-800 text-stone-400'
                  }`}
                >
                  {ARTIFACT_CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>

            {/* Drag and Drop Hint */}
            {isDraggingOver && (
              <div className="p-8 rounded-2xl border-2 border-dashed border-sky-500 bg-sky-500/10 text-center font-semibold text-sky-300">
                Drop any file here to save it into {activeProject.name}
              </div>
            )}

            {/* Artifacts Grid or List */}
            {projectArtifacts.length === 0 ? (
              <div
                className={`p-10 rounded-2xl border text-center space-y-2 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/50 border-stone-800'
                }`}
              >
                <div className="text-sm font-semibold">No files in this view yet</div>
                <p className="text-stone-400 max-w-md mx-auto">
                  Drag and drop files from your computer, click &ldquo;New document&rdquo;, or save
                  any answer from Chat as a file.
                </p>
              </div>
            ) : viewLayout === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {projectArtifacts.map((art) => {
                  const CatIcon = CATEGORY_ICON_MAP[art.category] || FileText;
                  return (
                    <div
                      key={art.id}
                      data-testid={`artifact-card-${art.id}`}
                      onClick={() => handleOpenArtifactModal(art)}
                      className={`group cursor-pointer rounded-2xl border overflow-hidden transition-all hover:border-sky-500/50 ${
                        isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                      }`}
                    >
                      <div className="h-32 w-full bg-stone-950 relative overflow-hidden">
                        <img
                          src={art.thumbnailDataUrl}
                          alt={art.title}
                          className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform"
                        />
                        <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 text-stone-200 border border-stone-700">
                          v{art.currentVersion}
                        </span>
                      </div>
                      <div className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <CatIcon className="w-4 h-4 text-sky-400 shrink-0" />
                            <span className="font-semibold text-sm truncate">{art.title}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-stone-400">
                          <span>{ARTIFACT_CATEGORY_LABELS[art.category]}</span>
                          <span>{formatBytesHuman(art.sizeBytes)}</span>
                        </div>
                        <div className="text-[11px] text-stone-400 truncate">
                          {art.creator === 'agent' ? 'Created by Morrow' : 'Created by you'} ·{' '}
                          {art.originChatOrMission}
                        </div>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {art.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded-full text-[10px] bg-stone-500/10 text-stone-400"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className={`divide-y rounded-2xl border overflow-hidden ${
                  isLight
                    ? 'bg-white border-stone-200 divide-stone-200'
                    : 'bg-stone-900/70 border-stone-800 divide-stone-800/70'
                }`}
              >
                {projectArtifacts.map((art) => {
                  const CatIcon = CATEGORY_ICON_MAP[art.category] || FileText;
                  return (
                    <div
                      key={art.id}
                      data-testid={`artifact-row-${art.id}`}
                      onClick={() => handleOpenArtifactModal(art)}
                      className="p-3.5 flex items-center justify-between gap-4 cursor-pointer hover:bg-sky-500/5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <CatIcon className="w-4 h-4 text-sky-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{art.title}</div>
                          <div className="text-[11px] text-stone-400 truncate">
                            {ARTIFACT_CATEGORY_LABELS[art.category]} · {art.fileName} ·{' '}
                            {art.originChatOrMission}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-[11px] text-stone-400">
                        <span>v{art.currentVersion}</span>
                        <span>{formatBytesHuman(art.sizeBytes)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: CHATS IN THIS PROJECT */}
        {activeTab === 'chats' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4" data-testid="project-chats-panel">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Conversations in {activeProject.name}</h3>
                <p className="text-stone-400">
                  Every chat here uses this project&apos;s instructions, files, and memory scope.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onStartNewProjectChat(activeProject.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New chat</span>
              </button>
            </div>

            {projectChats.length === 0 ? (
              <div
                className={`p-8 rounded-2xl border text-center space-y-2 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/50 border-stone-800'
                }`}
              >
                <div className="font-semibold">No chats in {activeProject.name} yet</div>
                <p className="text-stone-400">
                  Start a conversation to plan, research, write, or create files for this project.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {projectChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
                      isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="font-semibold text-sm">{chat.title}</div>
                      <p className="text-stone-400 truncate max-w-xl">{chat.lastMessagePreview}</p>
                      <div className="text-[11px] text-stone-500">{chat.updatedAt}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid={`save-chat-as-artifact-${chat.id}`}
                        onClick={() => {
                          const saved = artifactStore.create({
                            projectId: activeProject.id,
                            title: `Notes from ${chat.title}`,
                            category: 'document',
                            content: `# ${chat.title}\n\n${chat.lastMessagePreview}`,
                            creator: 'agent',
                            originChatOrMission: `Chat: ${chat.title}`,
                            tags: ['chat-note'],
                          });
                          onRefreshArtifacts();
                          setActiveTab('files');
                          handleOpenArtifactModal(saved);
                        }}
                        className="px-3 py-1.5 rounded-xl border border-stone-700 text-stone-300 hover:bg-stone-800"
                      >
                        Save as artifact
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenChatThread(chat.id)}
                        className="px-3.5 py-1.5 rounded-xl bg-sky-600 text-white font-semibold"
                      >
                        Open chat
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ABOUT (Plain-language instructions, Linked Skills, Schedules, and Memory Scope) */}
        {activeTab === 'about' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="project-about-panel">
            {/* Plain-language Instructions */}
            <section
              className={`p-5 rounded-2xl border space-y-3 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">About &amp; Plain-Language Instructions</h3>
                  <p className="text-stone-400">
                    Tell Morrow what this project is about and how you want help here.
                  </p>
                </div>
                {aboutSavedToast && (
                  <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>
              <textarea
                rows={4}
                data-testid="project-about-instructions-textarea"
                value={aboutDraft}
                onChange={(e) => setAboutDraft(e.target.value)}
                placeholder="Write plain-language instructions for this project..."
                className={`w-full p-3 rounded-xl border outline-none ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                }`}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  data-testid="save-project-about-btn"
                  onClick={() => {
                    onUpdateGeneralProject(activeProject.id, {
                      aboutInstructions: aboutDraft,
                      updatedAt: 'Just now',
                    });
                    setAboutSavedToast(true);
                    window.setTimeout(() => setAboutSavedToast(false), 1800);
                  }}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                >
                  Save instructions
                </button>
              </div>
            </section>

            {/* Linked Skills & Schedules */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section
                className={`p-5 rounded-2xl border space-y-3 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wand2 className="w-4 h-4 text-sky-400" />
                    <h3 className="text-sm font-semibold">Linked Skills</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateWorkspace('skills')}
                    className="text-sky-400 hover:underline"
                  >
                    Library &gt; Skills
                  </button>
                </div>
                <div className="space-y-2">
                  {unifiedSkills.map((sk) => {
                    const isLinked = activeProject.linkedSkillIds.includes(sk.id);
                    return (
                      <div
                        key={sk.id}
                        className="p-2.5 rounded-xl border border-stone-800/70 flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-medium">{sk.name}</div>
                          <div className="text-[11px] text-stone-400">{sk.oneLineDescription}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const next = isLinked
                              ? activeProject.linkedSkillIds.filter((id) => id !== sk.id)
                              : [...activeProject.linkedSkillIds, sk.id];
                            onUpdateGeneralProject(activeProject.id, { linkedSkillIds: next });
                          }}
                          className={`px-2.5 py-1 rounded-lg border font-medium ${
                            isLinked
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'border-stone-700 text-stone-400'
                          }`}
                        >
                          {isLinked ? 'Linked' : 'Link'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section
                className={`p-5 rounded-2xl border space-y-3 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-semibold">Schedules ({projectSchedules.length})</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateWorkspace('scheduler')}
                    className="text-sky-400 hover:underline"
                  >
                    Automations &gt; Scheduler
                  </button>
                </div>
                {projectSchedules.length === 0 ? (
                  <p className="text-stone-400">
                    No recurring schedules attached to {activeProject.name} yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {projectSchedules.map((sch) => (
                      <div
                        key={sch.id}
                        className="p-2.5 rounded-xl border border-stone-800/70 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-medium">{sch.title}</div>
                          <div className="text-[11px] text-stone-400">{sch.naturalSchedule}</div>
                        </div>
                        <span className="text-[11px] text-emerald-400">Active</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Project Memory Scope */}
            <section
              className={`p-5 rounded-2xl border space-y-3 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">
                    Memory Scope ({activeProject.memoryScope.label})
                  </h3>
                  <p className="text-stone-400">
                    Facts and preferences specific to {activeProject.name} stay scoped here.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                {activeProject.memoryScope.notes.map((note, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl border border-stone-800/70 flex items-center justify-between"
                  >
                    <span>{note}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newMemoryScopeNote}
                  onChange={(e) => setNewMemoryScopeNote(e.target.value)}
                  placeholder={`Add a fact remembered specifically for ${activeProject.name}...`}
                  className={`flex-1 px-3 py-2 rounded-xl border outline-none ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newMemoryScopeNote.trim()) return;
                    onUpdateGeneralProject(activeProject.id, {
                      memoryScope: {
                        ...activeProject.memoryScope,
                        notes: [...activeProject.memoryScope.notes, newMemoryScopeNote.trim()],
                      },
                    });
                    setNewMemoryScopeNote('');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-sky-600 text-white font-semibold"
                >
                  Add note
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* ARTIFACT VIEWER MODAL ON TOP (Easy to close via button, Esc, or backdrop click) */}
      {openArtifact && openPreview && (
        <div
          data-testid="artifact-viewer-modal"
          onClick={() => setOpenArtifactId(null)}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-4xl max-h-[90vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden text-xs ${
              isLight
                ? 'bg-white border-stone-200 text-stone-900'
                : 'bg-stone-950 border-stone-800 text-stone-100'
            }`}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-stone-800/70 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {isRenaming ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      data-testid="artifact-rename-input"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      className={`px-2.5 py-1 rounded-lg border text-sm font-semibold ${
                        isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-900 border-stone-700'
                      }`}
                    />
                    <button
                      type="button"
                      data-testid="artifact-confirm-rename-btn"
                      onClick={() => {
                        artifactStore.rename(openArtifact.id, renameDraft);
                        setIsRenaming(false);
                        onRefreshArtifacts();
                      }}
                      className="px-2.5 py-1 rounded-lg bg-sky-600 text-white font-semibold"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold" data-testid="artifact-modal-title">
                        {openArtifact.title}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[11px] bg-sky-500/15 text-sky-400 border border-sky-500/30">
                        {openPreview.categoryLabel} · v{openArtifact.currentVersion}
                      </span>
                      {openArtifact.simulatedNote && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          {openArtifact.simulatedNote}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-stone-400 mt-0.5">
                      {openArtifact.fileName} · {openPreview.mimeType} · {openPreview.sizeLabel} ·{' '}
                      {openArtifact.creator === 'agent' ? 'Created by Morrow' : 'Created by you'} (
                      {openArtifact.originChatOrMission})
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="artifact-rename-btn"
                  onClick={() => {
                    setRenameDraft(openArtifact.title);
                    setIsRenaming((r) => !r);
                  }}
                  className="px-2.5 py-1.5 rounded-xl border border-stone-700/80 hover:bg-stone-800 inline-flex items-center gap-1"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Rename</span>
                </button>

                <button
                  type="button"
                  data-testid="artifact-edit-btn"
                  onClick={() => {
                    setEditContentDraft(openArtifact.content);
                    setIsEditingContent((e) => !e);
                  }}
                  className="px-2.5 py-1.5 rounded-xl border border-stone-700/80 hover:bg-stone-800 inline-flex items-center gap-1"
                >
                  <span>{isEditingContent ? 'Cancel edit' : 'Update version'}</span>
                </button>

                <button
                  type="button"
                  data-testid="artifact-download-btn"
                  onClick={() => handleDownloadArtifact(openArtifact)}
                  className="px-2.5 py-1.5 rounded-xl border border-stone-700/80 hover:bg-stone-800 inline-flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>

                <button
                  type="button"
                  data-testid="artifact-delete-btn"
                  onClick={() => {
                    const ticket = artifactStore.deleteWithUndo(openArtifact.id);
                    setUndoTicket(ticket);
                    setOpenArtifactId(null);
                    onRefreshArtifacts();
                  }}
                  className="px-2.5 py-1.5 rounded-xl border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>

                <button
                  type="button"
                  data-testid="close-artifact-viewer-btn"
                  onClick={() => setOpenArtifactId(null)}
                  aria-label="Close viewer"
                  className="p-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Optional Edit / Create New Version Drawer inside Modal */}
            {isEditingContent && (
              <div className="p-4 border-b border-stone-800 bg-stone-900/60 space-y-2.5">
                <div className="font-semibold">Save a new version (v{openArtifact.versions.length + 1})</div>
                <textarea
                  rows={5}
                  data-testid="artifact-edit-content-textarea"
                  value={editContentDraft}
                  onChange={(e) => setEditContentDraft(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-stone-950 border border-stone-800 font-mono text-xs"
                />
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={editSummaryDraft}
                    onChange={(e) => setEditSummaryDraft(e.target.value)}
                    placeholder="Short note on what changed..."
                    className="flex-1 px-3 py-1.5 rounded-xl bg-stone-950 border border-stone-800"
                  />
                  <button
                    type="button"
                    data-testid="artifact-save-version-btn"
                    onClick={() => {
                      artifactStore.update(openArtifact.id, {
                        content: editContentDraft,
                        summary: editSummaryDraft || 'Updated content',
                        creator: 'user',
                      });
                      setIsEditingContent(false);
                      onRefreshArtifacts();
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-sky-600 text-white font-semibold"
                  >
                    Save version
                  </button>
                </div>
              </div>
            )}

            {/* Modal Body: Type-Specific Preview + Version History Footer */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 1. DOCUMENT READER (md, txt, docx) */}
              {openPreview.viewerMode === 'document_reader' && (
                <div
                  data-testid="preview-document_reader"
                  className={`p-6 rounded-2xl border space-y-4 leading-relaxed ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900/50 border-stone-800'
                  }`}
                >
                  {(openPreview.documentSections || []).map((sec, i) => (
                    <div key={i} className="space-y-2">
                      {sec.heading && <h4 className="text-base font-semibold">{sec.heading}</h4>}
                      {sec.paragraphs.map((p, j) => (
                        <p key={j} className="text-sm text-stone-300 whitespace-pre-line">
                          {p}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* 2. PDF VIEWER */}
              {openPreview.viewerMode === 'pdf_viewer' && (
                <div
                  data-testid="preview-pdf_viewer"
                  className="p-6 rounded-2xl border border-stone-700 bg-stone-900 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                    <span className="font-semibold text-amber-300">PDF Document Reader</span>
                    <span className="text-stone-400">{openArtifact.fileName}</span>
                  </div>
                  <div className="p-6 rounded-xl bg-white text-stone-900 font-serif space-y-3 shadow-inner">
                    <p className="whitespace-pre-line text-sm leading-relaxed">
                      {openArtifact.content}
                    </p>
                  </div>
                </div>
              )}

              {/* 3. TABLE VIEW FOR CSV / SPREADSHEETS */}
              {openPreview.viewerMode === 'csv_table' && openPreview.csvTable && (
                <div
                  data-testid="preview-csv_table"
                  className="rounded-2xl border border-stone-800 overflow-x-auto"
                >
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-stone-800 bg-stone-900/80 text-stone-300">
                        {openPreview.csvTable.headers.map((h, i) => (
                          <th key={i} className="py-2.5 px-3.5 font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-800/60">
                      {openPreview.csvTable.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-stone-900/40">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="py-2.5 px-3.5 text-stone-300">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 4. SLIDES VIEWER */}
              {openPreview.viewerMode === 'slides_viewer' && openPreview.slidesDeck && (
                <div data-testid="preview-slides_viewer" className="space-y-4">
                  {(() => {
                    const slides = openPreview.slidesDeck!;
                    const safeIdx = Math.min(slideIndex, slides.length - 1);
                    const currentSlide = slides[safeIdx];
                    return (
                      <>
                        <div className="p-8 rounded-2xl border border-violet-500/30 bg-gradient-to-br from-stone-900 to-violet-950/30 min-h-[240px] flex flex-col justify-between">
                          <div className="space-y-4">
                            <div className="text-[11px] uppercase tracking-wider text-violet-300">
                              Slide {currentSlide.slideNumber} of {slides.length}
                            </div>
                            <h4 className="text-xl font-bold">{currentSlide.title}</h4>
                            <ul className="space-y-2 list-disc list-inside text-sm text-stone-200">
                              {currentSlide.bullets.map((b, idx) => (
                                <li key={idx}>{b}</li>
                              ))}
                            </ul>
                          </div>
                          {currentSlide.notes && (
                            <div className="pt-4 mt-4 border-t border-stone-800 text-stone-400">
                              Speaker note: {currentSlide.notes}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            disabled={safeIdx === 0}
                            onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
                            className="px-3 py-1.5 rounded-xl border border-stone-700 disabled:opacity-40 inline-flex items-center gap-1"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" /> Previous slide
                          </button>
                          <span className="text-stone-400">
                            {safeIdx + 1} / {slides.length}
                          </span>
                          <button
                            type="button"
                            disabled={safeIdx >= slides.length - 1}
                            onClick={() => setSlideIndex((i) => Math.min(slides.length - 1, i + 1))}
                            className="px-3 py-1.5 rounded-xl border border-stone-700 disabled:opacity-40 inline-flex items-center gap-1"
                          >
                            Next slide <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* 5. IMAGE VIEWER */}
              {openPreview.viewerMode === 'image_viewer' && (
                <div data-testid="preview-image_viewer" className="space-y-3 text-center">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setImageZoomPct((z) => Math.max(50, z - 25))}
                      className="px-2.5 py-1 rounded-lg border border-stone-700"
                    >
                      -
                    </button>
                    <span>{imageZoomPct}%</span>
                    <button
                      type="button"
                      onClick={() => setImageZoomPct((z) => Math.min(200, z + 25))}
                      className="px-2.5 py-1 rounded-lg border border-stone-700"
                    >
                      +
                    </button>
                  </div>
                  <div className="p-4 rounded-2xl border border-stone-800 bg-stone-950 flex items-center justify-center overflow-auto">
                    <img
                      src={
                        openArtifact.content.startsWith('data:image/')
                          ? openArtifact.content
                          : openArtifact.thumbnailDataUrl
                      }
                      alt={openArtifact.title}
                      style={{ width: `${imageZoomPct}%`, maxWidth: '720px' }}
                      className="rounded-xl"
                    />
                  </div>
                </div>
              )}

              {/* 6. AUDIO PLAYER */}
              {openPreview.viewerMode === 'audio_player' && (
                <div
                  data-testid="preview-audio_player"
                  className="p-6 rounded-2xl border border-stone-800 bg-stone-900/60 flex flex-col items-center gap-4"
                >
                  <Music className="w-10 h-10 text-indigo-400" />
                  <div className="font-semibold text-sm">{openArtifact.title}</div>
                  <audio controls src={openArtifact.content} className="w-full max-w-md" />
                </div>
              )}

              {/* 7. VIDEO PLAYER */}
              {openPreview.viewerMode === 'video_player' && (
                <div
                  data-testid="preview-video_player"
                  className="p-6 rounded-2xl border border-stone-800 bg-stone-900/60 flex flex-col items-center gap-4"
                >
                  <video
                    controls
                    src={openArtifact.content}
                    className="w-full max-w-2xl rounded-xl bg-black"
                  />
                </div>
              )}

              {/* 8. SANDBOXED HTML PREVIEW */}
              {openPreview.viewerMode === 'html_sandbox' && (
                <div
                  data-testid="preview-html_sandbox"
                  className="rounded-2xl border border-stone-800 overflow-hidden bg-white"
                >
                  <iframe
                    title={openArtifact.title}
                    sandbox="allow-scripts"
                    srcDoc={openArtifact.content}
                    className="w-full h-80 border-0"
                  />
                </div>
              )}

              {/* 9. CODE & DATA VIEWER */}
              {openPreview.viewerMode === 'code_viewer' && (
                <pre
                  data-testid="preview-code_viewer"
                  className="p-4 rounded-2xl border border-stone-800 bg-stone-950 font-mono text-xs overflow-x-auto whitespace-pre-wrap"
                >
                  {openArtifact.content}
                </pre>
              )}

              {/* VERSION HISTORY & ROLLBACK */}
              <div className="pt-4 border-t border-stone-800/70 space-y-2.5">
                <div className="flex items-center gap-2 font-semibold">
                  <History className="w-4 h-4 text-sky-400" />
                  <span>Version History ({openArtifact.versions.length})</span>
                </div>
                <div className="space-y-1.5">
                  {openArtifact.versions
                    .slice()
                    .reverse()
                    .map((ver) => {
                      const isCurrent = ver.version === openArtifact.currentVersion;
                      return (
                        <div
                          key={ver.version}
                          className="p-2.5 rounded-xl border border-stone-800/70 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="px-2 py-0.5 rounded bg-stone-800 font-semibold">
                              v{ver.version}
                            </span>
                            <span>{ver.summary}</span>
                            <span className="text-stone-400">· {ver.createdAt}</span>
                          </div>
                          {isCurrent ? (
                            <span className="text-emerald-400 font-semibold">Current</span>
                          ) : (
                            <button
                              type="button"
                              data-testid={`artifact-version-rollback-btn-${ver.version}`}
                              onClick={() => {
                                artifactStore.rollbackToVersion(openArtifact.id, ver.version);
                                onRefreshArtifacts();
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-700 hover:bg-stone-800 text-sky-400"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Restore v{ver.version}</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW PROJECT MODAL (Neutral Starters: Plan something, Research, Write, Create media, Organize files, Code) */}
      {newProjectModalOpen && (
        <div
          data-testid="new-project-modal"
          onClick={() => setNewProjectModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateProjectFormSubmit}
            className={`w-full max-w-lg rounded-2xl border p-6 space-y-4 text-xs shadow-2xl ${
              isLight
                ? 'bg-white border-stone-200 text-stone-900'
                : 'bg-stone-950 border-stone-800 text-stone-100'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Create a Project</h3>
                <p className="text-stone-400">
                  A trip, a wedding, a shop, homework, an idea, or an app.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewProjectModalOpen(false)}
                className="p-1.5 rounded-xl text-stone-400 hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Neutral Starters (Optional) */}
            <div className="space-y-1.5">
              <div className="text-stone-400 font-medium">Optional starter</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PROJECT_NEUTRAL_STARTERS.map((st) => {
                  const StIcon = PROJECT_ICON_MAP[st.defaultIcon] || Folder;
                  const selected = newProjStarter === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      data-testid={`project-starter-${st.id}`}
                      onClick={() => {
                        setNewProjStarter(st.id);
                        setNewProjIcon(st.defaultIcon);
                        setNewProjColor(st.defaultColor);
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-colors ${
                        selected
                          ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                          : isLight
                            ? 'border-stone-200 hover:bg-stone-50'
                            : 'border-stone-800 hover:bg-stone-900'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold">
                        <StIcon className="w-3.5 h-3.5 text-sky-400" />
                        <span>{st.label}</span>
                      </div>
                      <div className="text-[10px] text-stone-400 mt-0.5">{st.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Project Name & Description */}
            <div className="space-y-2">
              <label className="block font-medium">Project name</label>
              <input
                type="text"
                required
                data-testid="new-project-name-input"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="e.g., Summer Wedding in Sonoma, Biology Lab, Family Cookbook..."
                className={`w-full px-3 py-2 rounded-xl border outline-none ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900 border-stone-800'
                }`}
              />
            </div>

            <div className="space-y-2">
              <label className="block font-medium">Description (optional)</label>
              <input
                type="text"
                data-testid="new-project-description-input"
                value={newProjDesc}
                onChange={(e) => setNewProjDesc(e.target.value)}
                placeholder="One line on what you're working on..."
                className={`w-full px-3 py-2 rounded-xl border outline-none ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900 border-stone-800'
                }`}
              />
            </div>

            {/* Color Chooser */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-stone-400 font-medium">Color accent (optional):</span>
              <div className="flex items-center gap-1.5">
                {(['sky', 'amber', 'emerald', 'rose', 'violet', 'stone'] as ProjectColorName[]).map(
                  (col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setNewProjColor(col)}
                      className={`px-2.5 py-1 rounded-lg border capitalize ${
                        newProjColor === col
                          ? COLOR_BADGE_CLASSES[col]
                          : 'border-stone-800 text-stone-400'
                      }`}
                    >
                      {col}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewProjectModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-stone-700 text-stone-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="create-project-submit-btn"
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
              >
                Create project
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

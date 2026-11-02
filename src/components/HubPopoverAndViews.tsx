/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize Hub Popover & Domain-Neutral Views (Prompt 1/4):
 * - SidebarGroupPopover: Anchored popover (desktop) / bottom sheet (mobile) with large icon tiles,
 *   1-word titles, <=6-word hints, Esc & outside-click close, and arrow key navigation.
 * - UnifiedMemoryPageView (Library > Memory): Single Memory store with search, 6 categories,
 *   per-item savedFrom/savedAt, Edit, Delete, Pin, expiry, Bulk delete, Pause saving,
 *   Forget this chat, Export (MEMORY.md / USER.md), and quiet 'Saved' toast with Undo.
 * - UnifiedSoulPageView (Library > Soul & Settings > Soul): Only identity, voice style,
 *   role/job description, and personality template (Download Template, Import, Remove).
 *   Zero memory and zero skills.
 * - UnifiedSkillsPageView (Library > Skills): Cards with icon, name, one-line description,
 *   last used, version badge; Filters: All, Mine, Recorded, From chat; 'New skill' (Record it,
 *   Describe it, From a chat); Detail view with plain steps, Try it, Edit, History, and
 *   file formats/parameters behind 'Advanced'.
 * - UnifiedPluginsPageView (Library > Plugins): Installed plugins only (no marketplace/catalog),
 *   on/off switch, short permissions summary, Remove, plus Import, Create with Morrow,
 *   Download Template.
 * - UnifiedRulesPageView (Library > Rules): Scoped rules (Everywhere, Project, Plugin, Connector),
 *   applies to all plugins including user-created ones; manifests can only tighten rules.
 * - UnifiedReviewInboxView (Proof > Review): Single inbox for skills, plugins, rules,
 *   personality edits, memory changes, schedules, connector writes, and extensions with
 *   plain-language diff, Approve, and Reject.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  Edit3,
  FileText,
  FolderKanban,
  Globe,
  History,
  Pin,
  Play,
  Plug,
  Plus,
  Puzzle,
  RotateCcw,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  DEFAULT_SOUL_PROFILE_CONFIG,
  HubPageId,
  InstalledPluginRecord,
  NewSkillCreationMethod,
  PopoverTileItem,
  ReviewProposalItem,
  ReviewProposalType,
  RuleEnforcementMode,
  SIDEBAR_NAVIGATION_GROUPS,
  ScopedRuleItem,
  ScopedRuleScope,
  SkillOriginFilter,
  SoulProfileConfig,
  UNIFIED_MEMORY_CATEGORIES,
  UnifiedMemoryCategory,
  UnifiedMemoryItem,
  UnifiedSkillItem,
  evaluatePluginActionWithScopedRules,
  exportSoulTemplateJson,
  filterUnifiedSkills,
  generatePluginTemplateJson,
  importSoulTemplateJson,
} from '../packages/hub';

const TILE_ICONS: Record<PopoverTileItem['iconName'], React.ComponentType<{ className?: string }>> = {
  Wand2,
  Puzzle,
  Plug,
  Sparkles,
  Scale,
  BookOpen,
  Globe,
  Code2,
  CalendarClock,
  CheckCircle2,
  Activity,
  ShieldCheck,
};

const SKILL_CARD_ICONS: Record<
  UnifiedSkillItem['iconName'],
  React.ComponentType<{ className?: string }>
> = {
  FileText,
  Globe,
  Code2,
  FolderKanban,
  Sparkles,
  Wand2,
};

// ============================================================================
// 1. SIDEBAR GROUP POPOVER (Desktop Anchored Popover + Mobile Bottom Sheet)
// ============================================================================

export const SidebarGroupPopover: React.FC<{
  openGroupId: 'library' | 'workbench' | 'automations' | 'proof' | null;
  activePageId: HubPageId | 'places';
  pendingReviewCount: number;
  isLight: boolean;
  anchorTopPx: number;
  sidebarCollapsed: boolean;
  onSelectPage: (pageId: HubPageId | 'places') => void;
  onClose: () => void;
}> = ({
  openGroupId,
  activePageId,
  pendingReviewCount,
  isLight,
  anchorTopPx,
  sidebarCollapsed,
  onSelectPage,
  onClose,
}) => {
  const [focusedIdx, setFocusedIdx] = useState(0);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const baseGroup = SIDEBAR_NAVIGATION_GROUPS.find((g) => g.id === openGroupId);
  const group = baseGroup
    ? {
        ...baseGroup,
        tiles:
          baseGroup.id === 'library'
            ? [
                {
                  pageId: 'places' as unknown as HubPageId,
                  groupId: 'library' as const,
                  tileTitle: 'Places',
                  pageName: 'Places',
                  hint: 'Folder map and off-limits zones',
                  iconName: 'BookOpen' as const,
                  shortcutKeywords: ['places', 'folders', 'map', 'library'],
                },
                ...baseGroup.tiles,
              ]
            : baseGroup.tiles,
      }
    : undefined;

  useEffect(() => {
    setFocusedIdx(0);
  }, [openGroupId]);

  useEffect(() => {
    if (!group) return;
    const btn = tileRefs.current[focusedIdx];
    if (btn) {
      btn.focus();
    }
  }, [group, focusedIdx]);

  useEffect(() => {
    if (!group) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx((prev) => (prev + 1) % group.tiles.length);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx((prev) => (prev - 1 + group.tiles.length) % group.tiles.length);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [group, onClose]);

  if (!group) return null;

  return (
    <div
      data-testid="sidebar-group-popover-backdrop"
      className="fixed inset-0 z-50"
      onClick={onClose}
    >
      {/* Mobile dim backdrop */}
      <div className="fixed inset-0 bg-black/40 md:bg-transparent" />

      {/* Desktop Anchored Popover / Mobile Bottom Sheet */}
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`${group.label} navigation`}
        data-testid={`sidebar-popover-${group.id}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          top: `${Math.max(16, Math.min(anchorTopPx, typeof window !== 'undefined' ? window.innerHeight - 340 : 180))}px`,
        }}
        className={`fixed z-50 transition-all duration-150
          inset-x-0 bottom-0 top-auto rounded-t-3xl p-5 md:bottom-auto md:inset-x-auto md:rounded-2xl md:p-4
          ${sidebarCollapsed ? 'md:left-16' : 'md:left-62'}
          md:w-[420px] border shadow-2xl ${
            isLight
              ? 'bg-white border-stone-200 text-stone-900'
              : 'bg-[#121722] border-stone-800 text-stone-100'
          }`}
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-stone-500/15">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-tight">{group.label}</span>
            <span className="text-[11px] text-stone-400">· Choose a page (Esc to close)</span>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            data-testid="close-sidebar-popover-btn"
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-500/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {group.tiles.map((tile, idx) => {
            const Icon = TILE_ICONS[tile.iconName];
            const isCurrent = activePageId === tile.pageId;
            const showReviewBadge = tile.pageId === 'review' && pendingReviewCount > 0;

            return (
              <button
                key={tile.pageId}
                ref={(el) => {
                  tileRefs.current[idx] = el;
                }}
                type="button"
                data-testid={`popover-tile-${tile.pageId}`}
                onClick={() => onSelectPage(tile.pageId)}
                className={`group flex flex-col items-start gap-2 p-3.5 rounded-xl border text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                  isCurrent
                    ? isLight
                      ? 'bg-sky-50 border-sky-500/50 text-stone-900'
                      : 'bg-sky-500/15 border-sky-500/40 text-stone-100'
                    : isLight
                      ? 'bg-stone-50/70 border-stone-200/90 hover:border-sky-500/40 hover:bg-white'
                      : 'bg-stone-900/70 border-stone-800 hover:border-stone-700 hover:bg-stone-900'
                }`}
              >
                <div className="w-full flex items-center justify-between">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      isCurrent
                        ? 'bg-sky-500 text-white'
                        : 'bg-sky-500/10 text-sky-400 group-hover:bg-sky-500/20'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  {showReviewBadge && (
                    <span
                      data-testid="popover-review-badge"
                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500 text-stone-950"
                    >
                      {pendingReviewCount}
                    </span>
                  )}
                </div>
                <div className="space-y-0.5">
                  <div
                    data-testid={`popover-tile-title-${tile.pageId}`}
                    className="text-sm font-semibold leading-tight"
                  >
                    {tile.tileTitle}
                  </div>
                  <div
                    data-testid={`popover-tile-hint-${tile.pageId}`}
                    className="text-[11px] text-stone-400 leading-snug"
                  >
                    {tile.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 2. ONE MEMORY PAGE (Library > Memory)
// ============================================================================

export const UnifiedMemoryPageView: React.FC<{
  items: UnifiedMemoryItem[];
  pauseSaving: boolean;
  activeChatId: string;
  activeChatTitle: string;
  isLight: boolean;
  onTogglePauseSaving: () => void;
  onProposeOrSaveMemory: (input: {
    text: string;
    category: UnifiedMemoryCategory;
    savedFrom: string;
    chatId?: string;
    expiresAt?: string;
  }) => {
    status: 'saved_automatically' | 'needs_review' | 'blocked_secret' | 'paused';
    memoryId?: string;
    reason?: string;
  };
  onEditMemory: (
    id: string,
    patch: {
      text?: string;
      category?: UnifiedMemoryCategory;
      expiresAt?: string;
      pinned?: boolean;
    }
  ) => { ok: boolean; error?: string };
  onDeleteMemory: (id: string) => void;
  onBulkDeleteMemories: (ids: string[]) => void;
  onForgetActiveChat: () => number;
  onExportMarkdown: (target: 'MEMORY.md' | 'USER.md') => string;
  onOpenReviewPage: () => void;
}> = ({
  items,
  pauseSaving,
  activeChatId,
  activeChatTitle,
  isLight,
  onTogglePauseSaving,
  onProposeOrSaveMemory,
  onEditMemory,
  onDeleteMemory,
  onBulkDeleteMemories,
  onForgetActiveChat,
  onExportMarkdown,
  onOpenReviewPage,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<UnifiedMemoryCategory | 'All'>('All');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<UnifiedMemoryCategory>('Preferences');
  const [newExpiry, setNewExpiry] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraftText, setEditDraftText] = useState('');
  const [editDraftCategory, setEditDraftCategory] = useState<UnifiedMemoryCategory>('Facts');
  const [editDraftExpiry, setEditDraftExpiry] = useState('');

  // Quiet 'Saved' toast with Undo
  const [savedToast, setSavedToast] = useState<{ memoryId: string; text: string } | null>(null);
  const [statusNotice, setStatusNotice] = useState<{
    tone: 'amber' | 'rose' | 'emerald';
    message: string;
    showReviewLink?: boolean;
  } | null>(null);
  const [exportPreview, setExportPreview] = useState<{
    filename: 'MEMORY.md' | 'USER.md';
    content: string;
  } | null>(null);

  const filteredItems = items.filter((item) => {
    if (selectedCategory !== 'All' && item.category !== selectedCategory) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      item.text.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.savedFrom.toLowerCase().includes(q)
    );
  });

  const handleSubmitNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    const submittedText = newText.trim();
    const res = onProposeOrSaveMemory({
      text: submittedText,
      category: newCategory,
      savedFrom: `Chat: ${activeChatTitle}`,
      chatId: activeChatId,
      expiresAt: newExpiry.trim() || undefined,
    });

    if (res.status === 'saved_automatically' && res.memoryId) {
      setNewText('');
      setNewExpiry('');
      setStatusNotice(null);
      setSavedToast({ memoryId: res.memoryId, text: submittedText });
    } else if (res.status === 'needs_review') {
      setNewText('');
      setSavedToast(null);
      setStatusNotice({
        tone: 'amber',
        message:
          res.reason ||
          'Sensitive category asks first: sent to Proof > Review for your approval.',
        showReviewLink: true,
      });
    } else if (res.status === 'blocked_secret') {
      setSavedToast(null);
      setStatusNotice({
        tone: 'rose',
        message:
          res.reason ||
          'Blocked: Never store secrets, passwords, or financial identifiers in Memory.',
      });
    } else if (res.status === 'paused') {
      setSavedToast(null);
      setStatusNotice({
        tone: 'amber',
        message: 'Saving is currently paused. Turn off "Pause saving" to record memories.',
      });
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-6" data-testid="unified-memory-page">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header & Primary Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Memory</h2>
            <p className="text-xs text-stone-400">
              One unified Memory store. Ordinary facts save automatically; sensitive items ask first in
              Review; secrets and passwords are never stored.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              role="switch"
              aria-checked={pauseSaving}
              data-testid="memory-pause-saving-switch"
              onClick={onTogglePauseSaving}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                pauseSaving
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : isLight
                    ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                    : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  pauseSaving ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              <span>{pauseSaving ? 'Saving paused' : 'Pause saving'}</span>
            </button>

            <button
              type="button"
              data-testid="memory-forget-chat-btn"
              onClick={() => {
                const count = onForgetActiveChat();
                setStatusNotice({
                  tone: 'emerald',
                  message: `Forgot ${count} memory item(s) saved from "${activeChatTitle}".`,
                });
              }}
              className={`px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                isLight
                  ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                  : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
              }`}
            >
              Forget this chat
            </button>

            <button
              type="button"
              data-testid="memory-export-memory-md-btn"
              onClick={() =>
                setExportPreview({
                  filename: 'MEMORY.md',
                  content: onExportMarkdown('MEMORY.md'),
                })
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium ${
                isLight
                  ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                  : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
              }`}
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>Export MEMORY.md</span>
            </button>

            <button
              type="button"
              data-testid="memory-export-user-md-btn"
              onClick={() =>
                setExportPreview({
                  filename: 'USER.md',
                  content: onExportMarkdown('USER.md'),
                })
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium ${
                isLight
                  ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                  : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
              }`}
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>Export USER.md</span>
            </button>
          </div>
        </div>

        {/* Quiet 'Saved' Toast with Undo */}
        {savedToast && (
          <div
            data-testid="memory-saved-toast"
            className="px-4 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                <strong>Saved</strong> · &ldquo;{savedToast.text}&rdquo;
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="memory-toast-undo-btn"
                onClick={() => {
                  onDeleteMemory(savedToast.memoryId);
                  setSavedToast(null);
                }}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => setSavedToast(null)}
                className="text-stone-400 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Sensitive or Blocked Notice */}
        {statusNotice && (
          <div
            data-testid="memory-status-notice"
            className={`px-4 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
              statusNotice.tone === 'rose'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : statusNotice.tone === 'amber'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            <span>{statusNotice.message}</span>
            <div className="flex items-center gap-2">
              {statusNotice.showReviewLink && (
                <button
                  type="button"
                  data-testid="memory-open-review-btn"
                  onClick={onOpenReviewPage}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 text-stone-950 font-semibold"
                >
                  Open Proof &gt; Review
                </button>
              )}
              <button
                type="button"
                onClick={() => setStatusNotice(null)}
                className="text-stone-400 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Propose / Add Memory Form */}
        <form
          onSubmit={handleSubmitNew}
          className={`p-4 rounded-2xl border flex flex-wrap items-center gap-2.5 text-xs ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
          }`}
        >
          <select
            aria-label="Memory category"
            data-testid="memory-category-select"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as UnifiedMemoryCategory)}
            className={`px-3 py-2 rounded-xl border font-medium ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
            }`}
          >
            {UNIFIED_MEMORY_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <input
            type="text"
            aria-label="Memory fact or preference"
            data-testid="memory-new-input"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Add a fact or preference (ordinary items save automatically; sensitive items ask in Review)..."
            className={`flex-1 min-w-[240px] px-3 py-2 rounded-xl border outline-none ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
            }`}
          />

          <input
            type="text"
            aria-label="Optional expiry date"
            data-testid="memory-expiry-input"
            value={newExpiry}
            onChange={(e) => setNewExpiry(e.target.value)}
            placeholder="Expiry (optional, e.g. 2026-12-31)"
            className={`w-48 px-3 py-2 rounded-xl border outline-none ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
            }`}
          />

          <button
            type="submit"
            data-testid="memory-save-btn"
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium"
          >
            Save to Memory
          </button>
        </form>

        {/* Search, Category Filter Pills & Bulk Delete */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(['All', ...UNIFIED_MEMORY_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                data-testid={`memory-filter-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl font-medium border transition-colors ${
                  selectedCategory === cat
                    ? 'bg-sky-600 text-white border-sky-600'
                    : isLight
                      ? 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                      : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
              }`}
            >
              <Search className="w-3.5 h-3.5 text-stone-400" />
              <input
                type="text"
                aria-label="Search memories"
                data-testid="memory-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search memory..."
                className="bg-transparent outline-none w-44"
              />
            </div>

            {selectedIds.length > 0 && (
              <button
                type="button"
                data-testid="memory-bulk-delete-btn"
                onClick={() => {
                  onBulkDeleteMemories(selectedIds);
                  setSelectedIds([]);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete selected ({selectedIds.length})</span>
              </button>
            )}
          </div>
        </div>

        {/* Export Modal Preview */}
        {exportPreview && (
          <div
            data-testid="memory-export-preview"
            className={`p-4 rounded-2xl border space-y-2 text-xs ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                Export Preview: {exportPreview.filename} (Generated from Unified Memory Store)
              </span>
              <button
                type="button"
                onClick={() => setExportPreview(null)}
                className="text-stone-400 hover:text-white"
              >
                Close
              </button>
            </div>
            <pre className="p-3 rounded-xl bg-black/40 border border-stone-800 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
              {exportPreview.content}
            </pre>
          </div>
        )}

        {/* Memory Items List */}
        <div className="space-y-2.5">
          {filteredItems.length === 0 ? (
            <div
              className={`p-8 rounded-2xl border text-center text-xs text-stone-400 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/50 border-stone-800'
              }`}
            >
              No memories match this filter.
            </div>
          ) : (
            filteredItems.map((item) => {
              const isSelected = selectedIds.includes(item.id);
              const isEditing = editingId === item.id;

              return (
                <div
                  key={item.id}
                  data-testid={`memory-item-${item.id}`}
                  className={`p-4 rounded-2xl border transition-colors text-xs ${
                    isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <select
                          value={editDraftCategory}
                          onChange={(e) =>
                            setEditDraftCategory(e.target.value as UnifiedMemoryCategory)
                          }
                          className={`px-2.5 py-1.5 rounded-lg border ${
                            isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                          }`}
                        >
                          {UNIFIED_MEMORY_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={editDraftText}
                          onChange={(e) => setEditDraftText(e.target.value)}
                          className={`flex-1 px-3 py-1.5 rounded-lg border ${
                            isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                          }`}
                        />
                        <input
                          type="text"
                          value={editDraftExpiry}
                          onChange={(e) => setEditDraftExpiry(e.target.value)}
                          placeholder="Expiry (optional)"
                          className={`w-40 px-2.5 py-1.5 rounded-lg border ${
                            isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                          }`}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1 rounded-lg border border-stone-700 text-stone-400"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          data-testid={`memory-save-edit-btn-${item.id}`}
                          onClick={() => {
                            const res = onEditMemory(item.id, {
                              text: editDraftText,
                              category: editDraftCategory,
                              expiresAt: editDraftExpiry.trim() || undefined,
                            });
                            if (res.ok) {
                              setEditingId(null);
                            } else if (res.error) {
                              setStatusNotice({ tone: 'rose', message: res.error });
                            }
                          }}
                          className="px-3 py-1 rounded-lg bg-sky-600 text-white font-medium"
                        >
                          Save changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          aria-label={`Select memory ${item.id}`}
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds((prev) => [...prev, item.id]);
                            } else {
                              setSelectedIds((prev) => prev.filter((id) => id !== item.id));
                            }
                          }}
                          className="mt-1 rounded"
                        />
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/25">
                              {item.category}
                            </span>
                            {item.pinned && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-400">
                                Pinned
                              </span>
                            )}
                            {item.expiresAt && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-stone-500/15 text-stone-400">
                                Expires: {item.expiresAt}
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-medium leading-relaxed">{item.text}</p>
                          <div className="text-[11px] text-stone-400">
                            Saved from <strong>{item.savedFrom}</strong> · {item.savedAt}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          aria-label={item.pinned ? 'Unpin memory' : 'Pin memory'}
                          data-testid={`memory-pin-btn-${item.id}`}
                          onClick={() => onEditMemory(item.id, { pinned: !item.pinned })}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            item.pinned
                              ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                              : 'border-stone-700/60 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          data-testid={`memory-edit-btn-${item.id}`}
                          onClick={() => {
                            setEditingId(item.id);
                            setEditDraftText(item.text);
                            setEditDraftCategory(item.category);
                            setEditDraftExpiry(item.expiresAt || '');
                          }}
                          className="px-2.5 py-1 rounded-lg border border-stone-700/70 text-stone-300 hover:bg-stone-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          data-testid={`memory-delete-btn-${item.id}`}
                          onClick={() => onDeleteMemory(item.id)}
                          className="px-2.5 py-1 rounded-lg border border-stone-700/70 text-rose-400 hover:bg-rose-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
};

// ============================================================================
// 3. SOUL AND PERSONALITY PAGE (Library > Soul & Settings > Soul)
// Only: identity, voice style, role/job description, and personality template
// (Download Template, Import, Remove). No memory and no skills on this page.
// ============================================================================

export const UnifiedSoulPageView: React.FC<{
  soulProfile: SoulProfileConfig;
  isLight: boolean;
  onUpdateSoulProfile: (next: SoulProfileConfig) => void;
}> = ({ soulProfile, isLight, onUpdateSoulProfile }) => {
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [downloadedJsonPreview, setDownloadedJsonPreview] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-xs" data-testid="unified-soul-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Soul &amp; Personality</h2>
          <p className="text-stone-400">
            Configure identity, voice style, role and job description, and personality template.
          </p>
        </div>

        {/* Personality Template Actions: Download Template, Import, Remove */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="soul-download-template-btn"
            onClick={() => {
              const json = exportSoulTemplateJson(soulProfile);
              setDownloadedJsonPreview(json);
              setFeedback('Prepared personality template JSON.');
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium ${
              isLight
                ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                : 'bg-stone-900 border-stone-800 text-stone-200 hover:bg-stone-800'
            }`}
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>Download Template</span>
          </button>

          <button
            type="button"
            data-testid="soul-import-template-btn"
            onClick={() => {
              setImportJsonText(exportSoulTemplateJson(soulProfile));
              setImportModalOpen(true);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium ${
              isLight
                ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                : 'bg-stone-900 border-stone-800 text-stone-200 hover:bg-stone-800'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span>Import</span>
          </button>

          <button
            type="button"
            data-testid="soul-remove-template-btn"
            onClick={() => {
              onUpdateSoulProfile({
                ...DEFAULT_SOUL_PROFILE_CONFIG,
                templateName: 'Default (Custom template removed)',
                updatedAt: 'Reset just now',
              });
              setFeedback('Removed custom personality template and restored default Soul.');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-700 text-rose-400 hover:bg-rose-500/10 font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Remove</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className="px-4 py-2.5 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-300 flex items-center justify-between">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-stone-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {downloadedJsonPreview && (
        <div
          data-testid="soul-template-json-preview"
          className={`p-4 rounded-2xl border space-y-2 ${
            isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              Personality Template ({soulProfile.templateName})
            </span>
            <button
              type="button"
              onClick={() => setDownloadedJsonPreview(null)}
              className="text-stone-400 hover:text-white"
            >
              Close
            </button>
          </div>
          <pre className="p-3 rounded-xl bg-black/40 border border-stone-800 font-mono text-[11px] overflow-x-auto">
            {downloadedJsonPreview}
          </pre>
        </div>
      )}

      {importModalOpen && (
        <div
          data-testid="soul-import-modal"
          className={`p-4 rounded-2xl border space-y-3 ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
          }`}
        >
          <div className="font-semibold">Import Personality Template JSON</div>
          <textarea
            rows={6}
            value={importJsonText}
            onChange={(e) => setImportJsonText(e.target.value)}
            className={`w-full p-3 rounded-xl border font-mono text-[11px] ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
            }`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setImportModalOpen(false)}
              className="px-3 py-1.5 rounded-xl border border-stone-700 text-stone-400"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="soul-confirm-import-btn"
              onClick={() => {
                const res = importSoulTemplateJson(importJsonText);
                if (res.ok && res.profile) {
                  onUpdateSoulProfile(res.profile);
                  setImportModalOpen(false);
                  setFeedback(`Imported template "${res.profile.templateName}".`);
                } else {
                  setFeedback(res.error || 'Invalid template JSON.');
                }
              }}
              className="px-4 py-1.5 rounded-xl bg-sky-600 text-white font-medium"
            >
              Import Template
            </button>
          </div>
        </div>
      )}

      {/* 1. Identity */}
      <section
        className={`p-5 rounded-2xl border space-y-4 ${
          isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
        }`}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">1. Identity</h3>
          <span className="text-[11px] text-stone-400">
            Active template: {soulProfile.templateName}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-stone-400 mb-1 font-medium">Name</label>
            <input
              type="text"
              data-testid="soul-identity-name-input"
              value={soulProfile.identity.name}
              onChange={(e) =>
                onUpdateSoulProfile({
                  ...soulProfile,
                  identity: { ...soulProfile.identity, name: e.target.value },
                })
              }
              className={`w-full px-3 py-2 rounded-xl border ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            />
          </div>
          <div>
            <label className="block text-stone-400 mb-1 font-medium">Identity Tagline</label>
            <input
              type="text"
              data-testid="soul-identity-tagline-input"
              value={soulProfile.identity.tagline}
              onChange={(e) =>
                onUpdateSoulProfile({
                  ...soulProfile,
                  identity: { ...soulProfile.identity, tagline: e.target.value },
                })
              }
              className={`w-full px-3 py-2 rounded-xl border ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            />
          </div>
        </div>
      </section>

      {/* 2. Voice Style */}
      <section
        className={`p-5 rounded-2xl border space-y-4 ${
          isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
        }`}
      >
        <h3 className="text-sm font-semibold">2. Voice Style</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-stone-400 mb-1 font-medium">Warmth &amp; Tone</label>
            <select
              value={soulProfile.voiceStyle.warmth}
              onChange={(e) =>
                onUpdateSoulProfile({
                  ...soulProfile,
                  voiceStyle: {
                    ...soulProfile.voiceStyle,
                    warmth: e.target.value as SoulProfileConfig['voiceStyle']['warmth'],
                  },
                })
              }
              className={`w-full px-3 py-2 rounded-xl border ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            >
              <option value="warm">Warm &amp; encouraging</option>
              <option value="calm">Calm &amp; neutral</option>
              <option value="direct">Direct &amp; matter-of-fact</option>
            </select>
          </div>
          <div>
            <label className="block text-stone-400 mb-1 font-medium">Response Length</label>
            <select
              value={soulProfile.voiceStyle.conciseness}
              onChange={(e) =>
                onUpdateSoulProfile({
                  ...soulProfile,
                  voiceStyle: {
                    ...soulProfile.voiceStyle,
                    conciseness: e.target.value as SoulProfileConfig['voiceStyle']['conciseness'],
                  },
                })
              }
              className={`w-full px-3 py-2 rounded-xl border ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            >
              <option value="concise">Concise (Plain words first)</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-stone-400 mb-1 font-medium">Voice Style Description</label>
          <textarea
            rows={2}
            value={soulProfile.voiceStyle.toneDescription}
            onChange={(e) =>
              onUpdateSoulProfile({
                ...soulProfile,
                voiceStyle: { ...soulProfile.voiceStyle, toneDescription: e.target.value },
              })
            }
            className={`w-full p-3 rounded-xl border ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
            }`}
          />
        </div>
      </section>

      {/* 3. Role & Job Description */}
      <section
        className={`p-5 rounded-2xl border space-y-4 ${
          isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
        }`}
      >
        <h3 className="text-sm font-semibold">3. Role &amp; Job Description</h3>
        <div>
          <label className="block text-stone-400 mb-1 font-medium">Role Title</label>
          <input
            type="text"
            value={soulProfile.roleAndJobDescription.roleTitle}
            onChange={(e) =>
              onUpdateSoulProfile({
                ...soulProfile,
                roleAndJobDescription: {
                  ...soulProfile.roleAndJobDescription,
                  roleTitle: e.target.value,
                },
              })
            }
            className={`w-full px-3 py-2 rounded-xl border ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
            }`}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-stone-400 mb-1 font-medium">Job Description</label>
            <textarea
              rows={3}
              value={soulProfile.roleAndJobDescription.jobDescription}
              onChange={(e) =>
                onUpdateSoulProfile({
                  ...soulProfile,
                  roleAndJobDescription: {
                    ...soulProfile.roleAndJobDescription,
                    jobDescription: e.target.value,
                  },
                })
              }
              className={`w-full p-3 rounded-xl border ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            />
          </div>
          <div>
            <label className="block text-stone-400 mb-1 font-medium">Off Limits</label>
            <textarea
              rows={3}
              value={soulProfile.roleAndJobDescription.offLimits}
              onChange={(e) =>
                onUpdateSoulProfile({
                  ...soulProfile,
                  roleAndJobDescription: {
                    ...soulProfile.roleAndJobDescription,
                    offLimits: e.target.value,
                  },
                })
              }
              className={`w-full p-3 rounded-xl border ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            />
          </div>
        </div>
      </section>
    </div>
  );
};

// ============================================================================
// 4. SKILLS PAGE (Library > Skills — One place, simple)
// ============================================================================

export const UnifiedSkillsPageView: React.FC<{
  skills: UnifiedSkillItem[];
  threads: Array<{ id: string; title: string }>;
  isLight: boolean;
  onAddSkill: (skill: UnifiedSkillItem) => void;
  onUpdateSkill: (skill: UnifiedSkillItem) => void;
  onTrySkillInChat: (skill: UnifiedSkillItem) => void;
  onStartRecordingSkill: () => void;
}> = ({
  skills,
  threads,
  isLight,
  onAddSkill,
  onUpdateSkill,
  onTrySkillInChat,
  onStartRecordingSkill,
}) => {
  const [filter, setFilter] = useState<SkillOriginFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'steps' | 'edit' | 'history'>('steps');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // 'New skill' modal state (Record it, Describe it, From a chat)
  const [newSkillMenuOpen, setNewSkillMenuOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<NewSkillCreationMethod | null>(null);
  const [describeTitle, setDescribeTitle] = useState('');
  const [describeSummary, setDescribeSummary] = useState('');
  const [selectedChatId, setSelectedChatId] = useState(threads[0]?.id || '');

  // Edit skill state
  const [editName, setEditName] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editStepsText, setEditStepsText] = useState('');

  const filtered = filterUnifiedSkills(skills, filter, searchQuery);
  const selectedSkill = skills.find((s) => s.id === selectedSkillId) || null;

  return (
    <main className="flex-1 overflow-y-auto p-6" data-testid="unified-skills-page">
      <div className="max-w-5xl mx-auto space-y-6 text-xs">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Skills</h2>
            <p className="text-stone-400">
              Reusable workflows in one place. Record a task, describe a workflow, or turn a chat
              into a skill.
            </p>
          </div>

          <div className="relative">
            <button
              type="button"
              data-testid="new-skill-btn"
              onClick={() => setNewSkillMenuOpen((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
            >
              <Plus className="w-4 h-4" />
              <span>New skill</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {newSkillMenuOpen && (
              <div
                data-testid="new-skill-choices-popover"
                className={`absolute right-0 mt-2 w-64 rounded-2xl border p-2 shadow-xl z-30 space-y-1 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                }`}
              >
                <button
                  type="button"
                  data-testid="new-skill-choice-record"
                  onClick={() => {
                    setNewSkillMenuOpen(false);
                    setCreationMode('record_it');
                  }}
                  className="w-full p-2.5 rounded-xl text-left hover:bg-sky-500/10 flex items-start gap-2.5"
                >
                  <Play className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Record it</div>
                    <div className="text-[11px] text-stone-400">
                      Demonstrate steps on screen with privacy shield
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  data-testid="new-skill-choice-describe"
                  onClick={() => {
                    setNewSkillMenuOpen(false);
                    setCreationMode('describe_it');
                  }}
                  className="w-full p-2.5 rounded-xl text-left hover:bg-sky-500/10 flex items-start gap-2.5"
                >
                  <Wand2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Describe it</div>
                    <div className="text-[11px] text-stone-400">
                      Write what the skill should do in plain words
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  data-testid="new-skill-choice-from-chat"
                  onClick={() => {
                    setNewSkillMenuOpen(false);
                    setCreationMode('from_a_chat');
                  }}
                  className="w-full p-2.5 rounded-xl text-left hover:bg-sky-500/10 flex items-start gap-2.5"
                >
                  <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">From a chat</div>
                    <div className="text-[11px] text-stone-400">
                      Extract reusable steps from a conversation
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Creation Drawer for Record it / Describe it / From a chat */}
        {creationMode && (
          <div
            data-testid={`new-skill-panel-${creationMode}`}
            className={`p-5 rounded-2xl border space-y-4 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">
                {creationMode === 'record_it'
                  ? 'Record a New Skill'
                  : creationMode === 'describe_it'
                    ? 'Describe a New Skill'
                    : 'Create Skill From a Chat'}
              </div>
              <button
                type="button"
                onClick={() => setCreationMode(null)}
                className="text-stone-400 hover:text-white"
              >
                Close
              </button>
            </div>

            {creationMode === 'record_it' && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-stone-400">
                  Capture in-app actions or screen keyframes. Password and credential fields are
                  automatically paused and redacted.
                </p>
                <button
                  type="button"
                  data-testid="start-skill-recording-btn"
                  onClick={() => {
                    setCreationMode(null);
                    onStartRecordingSkill();
                  }}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold"
                >
                  Open Recording Consent
                </button>
              </div>
            )}

            {creationMode === 'describe_it' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    data-testid="describe-skill-name-input"
                    value={describeTitle}
                    onChange={(e) => setDescribeTitle(e.target.value)}
                    placeholder="Skill name (e.g. Clean Markdown Links)"
                    className={`px-3 py-2 rounded-xl border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                  <input
                    type="text"
                    data-testid="describe-skill-summary-input"
                    value={describeSummary}
                    onChange={(e) => setDescribeSummary(e.target.value)}
                    placeholder="One line on what it does..."
                    className={`px-3 py-2 rounded-xl border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    data-testid="confirm-describe-skill-btn"
                    onClick={() => {
                      if (!describeTitle.trim()) return;
                      const created: UnifiedSkillItem = {
                        id: `uskill-${Date.now()}`,
                        name: describeTitle.trim(),
                        iconName: 'Wand2',
                        oneLineDescription:
                          describeSummary.trim() ||
                          'Custom workflow created from plain-language description.',
                        origin: 'mine',
                        lastUsed: 'Just now',
                        version: 1,
                        steps: [
                          {
                            stepNumber: 1,
                            instruction: `Inspect workspace inputs for "${describeTitle.trim()}".`,
                            verificationNote: 'Confirms inputs are valid.',
                          },
                          {
                            stepNumber: 2,
                            instruction:
                              describeSummary.trim() || 'Execute described workflow steps.',
                            verificationNote: 'Verifies output artifact matches expectations.',
                          },
                        ],
                        history: [
                          {
                            version: 1,
                            updatedAt: 'Just now',
                            summary: 'Created via Describe it.',
                          },
                        ],
                        advanced: {
                          fileFormat: 'SKILL.md',
                          parameters: [
                            {
                              name: 'target_path',
                              defaultValue: 'src/',
                              description: 'Target workspace path',
                            },
                          ],
                          rawContent: `---\nname: ${describeTitle
                            .trim()
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, '-')}\nversion: 1\n---\n1. ${describeSummary.trim()}`,
                        },
                      };
                      onAddSkill(created);
                      setDescribeTitle('');
                      setDescribeSummary('');
                      setCreationMode(null);
                      setSelectedSkillId(created.id);
                    }}
                    className="px-4 py-2 rounded-xl bg-sky-600 text-white font-semibold"
                  >
                    Create skill
                  </button>
                </div>
              </div>
            )}

            {creationMode === 'from_a_chat' && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <select
                  value={selectedChatId}
                  onChange={(e) => setSelectedChatId(e.target.value)}
                  className={`px-3 py-2 rounded-xl border flex-1 ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                  }`}
                >
                  {threads.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  data-testid="confirm-from-chat-skill-btn"
                  onClick={() => {
                    const chat = threads.find((t) => t.id === selectedChatId) || threads[0];
                    const title = `${chat?.title || 'Workspace'} Workflow`;
                    const created: UnifiedSkillItem = {
                      id: `uskill-chat-${Date.now()}`,
                      name: title,
                      iconName: 'Sparkles',
                      oneLineDescription: `Extracted repeatable steps from "${chat?.title || 'Chat'}".`,
                      origin: 'from_chat',
                      lastUsed: 'Just now',
                      version: 1,
                      steps: [
                        {
                          stepNumber: 1,
                          instruction: `Gather context from project files for ${title}.`,
                          verificationNote: 'Checks workspace state.',
                        },
                        {
                          stepNumber: 2,
                          instruction: 'Run verified steps and produce summary artifact.',
                          verificationNote: 'Confirms artifact saved.',
                        },
                      ],
                      history: [
                        { version: 1, updatedAt: 'Just now', summary: 'Created from chat.' },
                      ],
                      advanced: {
                        fileFormat: 'SKILL.md',
                        parameters: [
                          { name: 'scope', defaultValue: 'project', description: 'Execution scope' },
                        ],
                        rawContent: `---\nname: from-chat-skill\nversion: 1\n---\nExtracted from ${chat?.title}`,
                      },
                    };
                    onAddSkill(created);
                    setCreationMode(null);
                    setSelectedSkillId(created.id);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold"
                >
                  Create from chat
                </button>
              </div>
            )}
          </div>
        )}

        {/* Filters: All, Mine, Recorded, From chat + Search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'mine', label: 'Mine' },
                { id: 'recorded', label: 'Recorded' },
                { id: 'from_chat', label: 'From chat' },
              ] as Array<{ id: SkillOriginFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={`skills-filter-${tab.id}`}
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl font-medium border transition-colors ${
                  filter === tab.id
                    ? 'bg-sky-600 text-white border-sky-600'
                    : isLight
                      ? 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                      : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
            }`}
          >
            <Search className="w-3.5 h-3.5 text-stone-400" />
            <input
              type="text"
              aria-label="Search skills"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter skills..."
              className="bg-transparent outline-none w-44"
            />
          </div>
        </div>

        {/* Skill Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map((skill) => {
            const Icon = SKILL_CARD_ICONS[skill.iconName] || Wand2;
            const isSelected = selectedSkill?.id === skill.id;
            return (
              <button
                key={skill.id}
                type="button"
                data-testid={`skill-card-${skill.id}`}
                onClick={() => {
                  setSelectedSkillId(skill.id);
                  setDetailTab('steps');
                  setAdvancedOpen(false);
                  setEditName(skill.name);
                  setEditSummary(skill.oneLineDescription);
                  setEditStepsText(skill.steps.map((s) => s.instruction).join('\n'));
                }}
                className={`p-4 rounded-2xl border text-left transition-all flex items-start gap-3.5 ${
                  isSelected
                    ? isLight
                      ? 'bg-sky-50 border-sky-500/60'
                      : 'bg-sky-500/10 border-sky-500/50'
                    : isLight
                      ? 'bg-white border-stone-200 hover:border-sky-500/40'
                      : 'bg-stone-900/70 border-stone-800 hover:border-stone-700'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">{skill.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-stone-500/15 text-stone-300 shrink-0">
                      v{skill.version}
                    </span>
                  </div>
                  <p className="text-stone-400 line-clamp-1">{skill.oneLineDescription}</p>
                  <div className="text-[11px] text-stone-400 pt-0.5">
                    Last used: {skill.lastUsed}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Skill Detail Panel: Plain steps, Try it, Edit, History, and Advanced toggle */}
        {selectedSkill && (
          <div
            data-testid="skill-detail-panel"
            className={`p-5 rounded-2xl border space-y-4 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900/80 border-stone-800'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-500/15 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{selectedSkill.name}</h3>
                  <span className="px-2 py-0.5 rounded-full text-[11px] bg-sky-500/15 text-sky-400 font-medium">
                    v{selectedSkill.version}
                  </span>
                </div>
                <p className="text-stone-400 mt-0.5">{selectedSkill.oneLineDescription}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="skill-try-it-btn"
                  onClick={() => onTrySkillInChat(selectedSkill)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Try it</span>
                </button>
                <button
                  type="button"
                  data-testid="skill-edit-tab-btn"
                  onClick={() => setDetailTab(detailTab === 'edit' ? 'steps' : 'edit')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium ${
                    detailTab === 'edit'
                      ? 'border-sky-500 text-sky-400'
                      : 'border-stone-700 text-stone-300'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  data-testid="skill-history-tab-btn"
                  onClick={() => setDetailTab(detailTab === 'history' ? 'steps' : 'history')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium ${
                    detailTab === 'history'
                      ? 'border-sky-500 text-sky-400'
                      : 'border-stone-700 text-stone-300'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>History</span>
                </button>
              </div>
            </div>

            {detailTab === 'steps' && (
              <div className="space-y-2.5" data-testid="skill-plain-steps-list">
                <div className="font-semibold text-stone-300">Plain Steps</div>
                {selectedSkill.steps.map((st) => (
                  <div
                    key={st.stepNumber}
                    className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/60 border-stone-800'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-sky-500/15 text-sky-400 font-semibold flex items-center justify-center shrink-0">
                        {st.stepNumber}
                      </span>
                      <div>
                        <div className="font-medium text-sm">{st.instruction}</div>
                        <div className="text-[11px] text-stone-400 mt-0.5">
                          Check: {st.verificationNote}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {detailTab === 'edit' && (
              <div className="space-y-3" data-testid="skill-edit-form">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl border ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                  }`}
                />
                <input
                  type="text"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl border ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                  }`}
                />
                <div>
                  <label className="block text-stone-400 mb-1">Plain steps (one per line)</label>
                  <textarea
                    rows={4}
                    value={editStepsText}
                    onChange={(e) => setEditStepsText(e.target.value)}
                    className={`w-full p-3 rounded-xl border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailTab('steps')}
                    className="px-3 py-1.5 rounded-xl border border-stone-700 text-stone-400"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="skill-save-edit-btn"
                    onClick={() => {
                      const nextVer = selectedSkill.version + 1;
                      const nextSteps = editStepsText
                        .split('\n')
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .map((line, i) => ({
                          stepNumber: i + 1,
                          instruction: line,
                          verificationNote: 'Verified step post-condition.',
                        }));
                      onUpdateSkill({
                        ...selectedSkill,
                        name: editName.trim() || selectedSkill.name,
                        oneLineDescription:
                          editSummary.trim() || selectedSkill.oneLineDescription,
                        version: nextVer,
                        steps: nextSteps.length > 0 ? nextSteps : selectedSkill.steps,
                        history: [
                          {
                            version: nextVer,
                            updatedAt: 'Just now',
                            summary: 'Edited plain steps.',
                          },
                          ...selectedSkill.history,
                        ],
                      });
                      setDetailTab('steps');
                    }}
                    className="px-4 py-1.5 rounded-xl bg-sky-600 text-white font-semibold"
                  >
                    Save v{selectedSkill.version + 1}
                  </button>
                </div>
              </div>
            )}

            {detailTab === 'history' && (
              <div className="space-y-2" data-testid="skill-history-list">
                {selectedSkill.history.map((h) => (
                  <div
                    key={h.version}
                    className="p-3 rounded-xl border border-stone-800 flex items-center justify-between"
                  >
                    <div>
                      <span className="font-semibold">v{h.version}</span> · {h.summary}
                    </div>
                    <span className="text-stone-400">{h.updatedAt}</span>
                  </div>
                ))}
              </div>
            )}

            {/* File formats and parameters behind 'Advanced' */}
            <div className="pt-2 border-t border-stone-500/15">
              <button
                type="button"
                data-testid="skill-advanced-toggle"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-stone-400 hover:text-stone-200 font-medium"
              >
                {advancedOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <span>Advanced (File format &amp; parameters)</span>
              </button>

              {advancedOpen && (
                <div
                  data-testid="skill-advanced-section"
                  className="mt-3 p-4 rounded-xl bg-black/30 border border-stone-800 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-stone-400">
                      Format: <strong>{selectedSkill.advanced.fileFormat}</strong>
                    </span>
                    <span className="text-stone-400">
                      Parameters ({selectedSkill.advanced.parameters.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {selectedSkill.advanced.parameters.map((p) => (
                      <div
                        key={p.name}
                        className="flex items-center justify-between text-[11px] font-mono bg-stone-900/80 px-2.5 py-1.5 rounded-lg"
                      >
                        <span className="text-sky-400">{`{{${p.name}}}`}</span>
                        <span className="text-stone-400">
                          default: &ldquo;{p.defaultValue}&rdquo; — {p.description}
                        </span>
                      </div>
                    ))}
                  </div>
                  <pre className="p-2.5 rounded-lg bg-stone-950 font-mono text-[11px] text-stone-300 overflow-x-auto">
                    {selectedSkill.advanced.rawContent}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

// ============================================================================
// 5. PLUGINS PAGE (Library > Plugins — Installed only, no marketplace/catalog)
// ============================================================================

export const UnifiedPluginsPageView: React.FC<{
  plugins: InstalledPluginRecord[];
  scopedRules: ScopedRuleItem[];
  isLight: boolean;
  companionName?: string;
  onTogglePlugin: (id: string) => void;
  onRemovePlugin: (id: string) => void;
  onAddPlugin: (plugin: InstalledPluginRecord) => void;
}> = ({
  plugins,
  scopedRules,
  isLight,
  companionName = 'Morrow',
  onTogglePlugin,
  onRemovePlugin,
  onAddPlugin,
}) => {
  const [modalMode, setModalMode] = useState<'import' | 'create' | 'template' | null>(null);
  const [importJson, setImportJson] = useState(() => generatePluginTemplateJson());
  const [createName, setCreateName] = useState('');
  const [createPermissions, setCreatePermissions] = useState(
    'Read project markdown files and export clean HTML summaries; external send blocked.'
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <main className="flex-1 overflow-y-auto p-6" data-testid="unified-plugins-page">
      <div className="max-w-5xl mx-auto space-y-6 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Plugins</h2>
            <p className="text-stone-400">
              Installed plugins. The Rule Book applies to every plugin, and plugin manifests can
              only tighten your rules.
            </p>
          </div>

          {/* Three required buttons: Import, Create with companion, Download Template */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="plugins-import-btn"
              onClick={() => setModalMode('import')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border font-medium ${
                isLight
                  ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                  : 'bg-stone-900 border-stone-800 text-stone-200 hover:bg-stone-800'
              }`}
            >
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              <span>Import</span>
            </button>

            <button
              type="button"
              data-testid="plugins-create-with-morrow-btn"
              onClick={() => setModalMode('create')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Create with {companionName}</span>
            </button>

            <button
              type="button"
              data-testid="plugins-download-template-btn"
              onClick={() => setModalMode('template')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border font-medium ${
                isLight
                  ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                  : 'bg-stone-900 border-stone-800 text-stone-200 hover:bg-stone-800'
              }`}
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>Download Template</span>
            </button>
          </div>
        </div>

        {feedback && (
          <div className="px-4 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 flex items-center justify-between">
            <span>{feedback}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-stone-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Import / Create with companion / Download Template Drawer */}
        {modalMode && (
          <div
            data-testid={`plugins-modal-${modalMode}`}
            className={`p-5 rounded-2xl border space-y-4 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">
                {modalMode === 'import'
                  ? 'Import Plugin Manifest'
                  : modalMode === 'create'
                    ? `Create Plugin with ${companionName}`
                    : 'Plugin Manifest Template (JSON)'}
              </span>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="text-stone-400 hover:text-white"
              >
                Close
              </button>
            </div>

            {modalMode === 'import' && (
              <div className="space-y-3">
                <textarea
                  rows={7}
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                  className={`w-full p-3 rounded-xl border font-mono text-[11px] ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                  }`}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    data-testid="plugins-confirm-import-btn"
                    onClick={() => {
                      try {
                        const parsed = JSON.parse(importJson);
                        const created: InstalledPluginRecord = {
                          id: `plugin-import-${Date.now()}`,
                          name: String(parsed.name || 'Imported Plugin'),
                          version: String(parsed.version || '1.0.0'),
                          enabled: true,
                          permissionsSummary: String(
                            parsed.permissionsSummary ||
                              'Sandboxed workspace access governed by the Rule Book.'
                          ),
                          permissions: Array.isArray(parsed.permissions)
                            ? parsed.permissions
                            : ['workspace:read'],
                          origin: 'imported',
                          manifestConstraints: Array.isArray(parsed.manifestConstraints)
                            ? parsed.manifestConstraints
                            : [],
                        };
                        onAddPlugin(created);
                        setModalMode(null);
                        setFeedback(`Imported plugin "${created.name}".`);
                      } catch {
                        setFeedback('Invalid plugin manifest JSON.');
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-sky-600 text-white font-semibold"
                  >
                    Install Imported Plugin
                  </button>
                </div>
              </div>
            )}

            {modalMode === 'create' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    data-testid="create-plugin-name-input"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Plugin name (e.g. Changelog Generator)"
                    className={`px-3 py-2 rounded-xl border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                  <input
                    type="text"
                    data-testid="create-plugin-permissions-input"
                    value={createPermissions}
                    onChange={(e) => setCreatePermissions(e.target.value)}
                    placeholder="Short permissions summary..."
                    className={`px-3 py-2 rounded-xl border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    data-testid="confirm-create-plugin-btn"
                    onClick={() => {
                      if (!createName.trim()) return;
                      const created: InstalledPluginRecord = {
                        id: `plugin-morrow-${Date.now()}`,
                        name: createName.trim(),
                        version: '1.0.0',
                        enabled: true,
                        permissionsSummary: createPermissions.trim(),
                        permissions: ['workspace:read', 'artifacts:write'],
                        origin: 'created_with_morrow',
                        manifestConstraints: [
                          {
                            actionClass: 'destructive',
                            mode: 'block',
                            reason: 'User-created plugin tightens destructive actions to blocked.',
                          },
                        ],
                      };
                      onAddPlugin(created);
                      setCreateName('');
                      setModalMode(null);
                      setFeedback(
                        `Created "${created.name}" with ${companionName}. Rule Book boundaries automatically enforced.`
                      );
                    }}
                    className="px-4 py-2 rounded-xl bg-sky-600 text-white font-semibold"
                  >
                    Create &amp; Enable Plugin
                  </button>
                </div>
              </div>
            )}

            {modalMode === 'template' && (
              <pre
                data-testid="plugin-template-json-preview"
                className="p-3 rounded-xl bg-black/40 border border-stone-800 font-mono text-[11px] overflow-x-auto"
              >
                {generatePluginTemplateJson()}
              </pre>
            )}
          </div>
        )}

        {/* Installed Plugin Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plugins.map((plugin) => {
            const destructiveCheck = evaluatePluginActionWithScopedRules({
              plugin,
              actionClass: 'destructive',
              actionSummary: 'Delete files',
              rules: scopedRules,
            });

            return (
              <div
                key={plugin.id}
                data-testid={`installed-plugin-card-${plugin.id}`}
                className={`p-5 rounded-2xl border flex flex-col justify-between gap-4 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Puzzle className="w-4 h-4 text-sky-400" />
                      <span className="font-semibold text-sm">{plugin.name}</span>
                      <span className="text-[11px] text-stone-400">v{plugin.version}</span>
                    </div>

                    {/* On/Off Switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={plugin.enabled}
                      data-testid={`plugin-toggle-${plugin.id}`}
                      onClick={() => onTogglePlugin(plugin.id)}
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                        plugin.enabled
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-stone-800 text-stone-400 border-stone-700'
                      }`}
                    >
                      {plugin.enabled ? 'On' : 'Off'}
                    </button>
                  </div>

                  {/* Short permissions summary */}
                  <p className="text-stone-300 leading-relaxed">{plugin.permissionsSummary}</p>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {plugin.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="px-2 py-0.5 rounded bg-stone-500/10 text-stone-400 font-mono text-[10px]"
                      >
                        {perm}
                      </span>
                    ))}
                    <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 text-[10px]">
                      Rule Book: {destructiveCheck.effectiveEnforcement.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-stone-500/15">
                  <span className="text-[11px] text-stone-400 capitalize">
                    Origin: {plugin.origin.replace(/_/g, ' ')}
                  </span>
                  <button
                    type="button"
                    data-testid={`plugin-remove-btn-${plugin.id}`}
                    onClick={() => onRemovePlugin(plugin.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-700/80 text-rose-400 hover:bg-rose-500/10 font-medium"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
};

// ============================================================================
// 6. RULE BOOK PAGE (Library > Rules — Scopes: Everywhere, Project, Plugin, Connector)
// ============================================================================

export const UnifiedRulesPageView: React.FC<{
  rules: ScopedRuleItem[];
  plugins: InstalledPluginRecord[];
  isLight: boolean;
  onAddRule: (rule: ScopedRuleItem) => void;
  onToggleRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
}> = ({ rules, plugins, isLight, onAddRule, onToggleRule, onDeleteRule }) => {
  const [scopeFilter, setScopeFilter] = useState<ScopedRuleScope | 'All'>('All');
  const [newRuleText, setNewRuleText] = useState('');
  const [newScope, setNewScope] = useState<ScopedRuleScope>('Everywhere');
  const [newTargetName, setNewTargetName] = useState('');
  const [newActionClass, setNewActionClass] =
    useState<ScopedRuleItem['actionClass']>('write');
  const [newEnforcement, setNewEnforcement] = useState<RuleEnforcementMode>('ask_first');

  const filteredRules = rules.filter(
    (r) => scopeFilter === 'All' || r.scope === scopeFilter
  );

  return (
    <main className="flex-1 overflow-y-auto p-6" data-testid="unified-rules-page">
      <div className="max-w-5xl mx-auto space-y-6 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Rule Book</h2>
            <p className="text-stone-400">
              Scoped rules (Everywhere, Project, Plugin, Connector) enforced across every plugin,
              including ones you create. Plugin manifests can only tighten rules, never loosen them.
            </p>
          </div>
        </div>

        {/* Add Scoped Rule Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newRuleText.trim()) return;
            onAddRule({
              id: `srule-${Date.now()}`,
              text: newRuleText.trim(),
              scope: newScope,
              targetName:
                newScope === 'Everywhere'
                  ? undefined
                  : newTargetName.trim() || `All ${newScope}s`,
              actionClass: newActionClass,
              enforcement: newEnforcement,
              enabled: true,
              safetyFloor: false,
            });
            setNewRuleText('');
            setNewTargetName('');
          }}
          className={`p-4 rounded-2xl border space-y-3 ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
          }`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <select
              aria-label="Rule scope"
              data-testid="rule-scope-select"
              value={newScope}
              onChange={(e) => setNewScope(e.target.value as ScopedRuleScope)}
              className={`px-3 py-2 rounded-xl border font-medium ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            >
              <option value="Everywhere">Scope: Everywhere</option>
              <option value="Place">Scope: Place</option>
              <option value="Project">Scope: Project</option>
              <option value="Plugin">Scope: Plugin</option>
              <option value="Connector">Scope: Connector</option>
            </select>

            <input
              type="text"
              aria-label="Scope target name"
              value={newTargetName}
              disabled={newScope === 'Everywhere'}
              onChange={(e) => setNewTargetName(e.target.value)}
              placeholder={
                newScope === 'Everywhere'
                  ? 'Applies everywhere'
                  : `Target ${newScope} (optional)`
              }
              className={`px-3 py-2 rounded-xl border ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            />

            <select
              aria-label="Action class"
              value={newActionClass}
              onChange={(e) =>
                setNewActionClass(e.target.value as ScopedRuleItem['actionClass'])
              }
              className={`px-3 py-2 rounded-xl border ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            >
              <option value="write">Action: Write</option>
              <option value="destructive">Action: Destructive</option>
              <option value="external_send">Action: External send</option>
              <option value="credential">Action: Credential</option>
              <option value="read">Action: Read</option>
              <option value="system">Action: System</option>
            </select>

            <select
              aria-label="Rule enforcement"
              value={newEnforcement}
              onChange={(e) => setNewEnforcement(e.target.value as RuleEnforcementMode)}
              className={`px-3 py-2 rounded-xl border ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            >
              <option value="ask_first">Needs your approval</option>
              <option value="block">Blocked for safety</option>
              <option value="allow">Allowed</option>
            </select>
          </div>

          <div className="flex gap-2.5">
            <input
              type="text"
              data-testid="new-scoped-rule-input"
              value={newRuleText}
              onChange={(e) => setNewRuleText(e.target.value)}
              placeholder="Write rule in plain words (e.g. Always ask before writing to GitHub Issues connector)..."
              className={`flex-1 px-3 py-2 rounded-xl border outline-none ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            />
            <button
              type="submit"
              data-testid="add-scoped-rule-btn"
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
            >
              Add Rule
            </button>
          </div>
        </form>

        {/* Scope Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(['All', 'Everywhere', 'Place', 'Project', 'Plugin', 'Connector'] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              data-testid={`rules-scope-filter-${sc.toLowerCase()}`}
              onClick={() => setScopeFilter(sc)}
              className={`px-3 py-1.5 rounded-xl font-medium border transition-colors ${
                scopeFilter === sc
                  ? 'bg-sky-600 text-white border-sky-600'
                  : isLight
                    ? 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                    : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
              }`}
            >
              {sc}
            </button>
          ))}
        </div>

        {/* Rules List */}
        <div className="space-y-2.5">
          {filteredRules.map((rule) => (
            <div
              key={rule.id}
              data-testid={`scoped-rule-card-${rule.id}`}
              className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="space-y-1 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                    Scope: {rule.scope}
                    {rule.targetName ? ` (${rule.targetName})` : ''}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                      rule.enforcement === 'block'
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                        : rule.enforcement === 'ask_first'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    }`}
                  >
                    {rule.enforcement === 'block'
                      ? 'Blocked for safety'
                      : rule.enforcement === 'ask_first'
                        ? 'Needs your approval'
                        : 'Allowed'}
                  </span>
                  {rule.safetyFloor && (
                    <span className="text-[11px] text-stone-400">· Safety floor</span>
                  )}
                </div>
                <div className="text-sm font-medium pt-0.5">{rule.text}</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggleRule(rule.id)}
                  className={`px-3 py-1 rounded-lg border font-medium ${
                    rule.enabled
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-stone-800 text-stone-400 border-stone-700'
                  }`}
                >
                  {rule.enabled ? 'Active' : 'Disabled'}
                </button>
                {!rule.safetyFloor && (
                  <button
                    type="button"
                    onClick={() => onDeleteRule(rule.id)}
                    className="p-1.5 rounded-lg border border-stone-700/70 text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Live Plugin Enforcement Summary Table */}
        <div
          className={`p-4 rounded-2xl border space-y-2 ${
            isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900/40 border-stone-800'
          }`}
        >
          <div className="font-semibold">
            Active Plugin Enforcement (Manifests can only tighten, never loosen)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {plugins.map((pl) => {
              const writeCheck = evaluatePluginActionWithScopedRules({
                plugin: pl,
                actionClass: 'write',
                actionSummary: 'Write file',
                rules,
              });
              const credCheck = evaluatePluginActionWithScopedRules({
                plugin: pl,
                actionClass: 'credential',
                actionSummary: 'Access credentials',
                rules,
              });
              return (
                <div
                  key={pl.id}
                  className="p-2.5 rounded-xl border border-stone-800/70 flex items-center justify-between"
                >
                  <span className="font-medium">{pl.name}</span>
                  <span className="text-[11px] text-stone-400">
                    Write: <strong className="text-amber-400">{writeCheck.effectiveEnforcement}</strong>{' '}
                    · Credentials:{' '}
                    <strong className="text-rose-400">{credCheck.effectiveEnforcement}</strong>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
};

// ============================================================================
// 7. UNIFIED REVIEW INBOX (Proof > Review)
// One inbox for every proposal: skills, plugins, rules, personality edits,
// memory changes, schedules, connector writes, and extensions.
// ============================================================================

const PROPOSAL_TYPE_LABELS: Record<ReviewProposalType, string> = {
  skill: 'Skills',
  plugin: 'Plugins',
  rule: 'Rules',
  personality: 'Personality edits',
  memory: 'Memory changes',
  schedule: 'Schedules',
  connector_write: 'Connector writes',
  extension: 'Extensions',
};

export const UnifiedReviewInboxView: React.FC<{
  proposals: ReviewProposalItem[];
  isLight: boolean;
  onDecideProposal: (id: string, decision: 'approved' | 'rejected') => void;
}> = ({ proposals, isLight, onDecideProposal }) => {
  const [typeFilter, setTypeFilter] = useState<ReviewProposalType | 'all'>('all');
  const pendingCount = proposals.filter((p) => p.status === 'pending').length;

  const filtered = proposals.filter(
    (p) => typeFilter === 'all' || p.type === typeFilter
  );

  return (
    <main className="flex-1 overflow-y-auto p-6" data-testid="unified-review-inbox-page">
      <div className="max-w-5xl mx-auto space-y-6 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-semibold">Review</h2>
              <span
                data-testid="review-page-pending-badge"
                className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500 text-stone-950"
              >
                {pendingCount} pending
              </span>
            </div>
            <p className="text-stone-400 mt-0.5">
              One inbox for every proposal: skills, plugins, rules, personality edits, memory
              changes, schedules, connector writes, and extensions.
            </p>
          </div>
        </div>

        {/* Proposal Type Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="review-filter-all"
            onClick={() => setTypeFilter('all')}
            className={`px-3 py-1.5 rounded-xl font-medium border transition-colors ${
              typeFilter === 'all'
                ? 'bg-sky-600 text-white border-sky-600'
                : isLight
                  ? 'bg-white border-stone-200 text-stone-600'
                  : 'bg-stone-900 border-stone-800 text-stone-400'
            }`}
          >
            All ({proposals.length})
          </button>
          {(Object.keys(PROPOSAL_TYPE_LABELS) as ReviewProposalType[]).map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`review-filter-${t}`}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-xl font-medium border transition-colors ${
                typeFilter === t
                  ? 'bg-sky-600 text-white border-sky-600'
                  : isLight
                    ? 'bg-white border-stone-200 text-stone-600'
                    : 'bg-stone-900 border-stone-800 text-stone-400'
              }`}
            >
              {PROPOSAL_TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Proposal Cards with Plain-Language Diff, Approve, and Reject */}
        <div className="space-y-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              data-testid={`review-proposal-card-${item.id}`}
              data-proposal-type={item.type}
              className={`p-5 rounded-2xl border space-y-3 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                      {PROPOSAL_TYPE_LABELS[item.type]}
                    </span>
                    <span className="text-stone-400">{item.scopeLabel}</span>
                    <span className="text-stone-400">· {item.createdAt}</span>
                  </div>
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="text-stone-400">{item.summary}</p>
                </div>

                <span
                  data-testid={`review-status-${item.id}`}
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${
                    item.status === 'pending'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : item.status === 'approved'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {item.status === 'pending' ? 'Needs your approval' : item.status}
                </span>
              </div>

              {/* Plain-Language Diff */}
              <div
                data-testid={`review-diff-${item.id}`}
                className={`p-3.5 rounded-xl border space-y-1.5 text-xs ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/80 border-stone-800'
                }`}
              >
                <div className="flex items-start gap-2 text-rose-400">
                  <span className="font-semibold shrink-0 w-14">Before:</span>
                  <span>{item.plainDiff.before}</span>
                </div>
                <div className="flex items-start gap-2 text-emerald-400">
                  <span className="font-semibold shrink-0 w-14">After:</span>
                  <span>{item.plainDiff.after}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-stone-400">
                  Proposed by {item.proposedBy}
                </span>
                {item.status === 'pending' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`review-approve-btn-${item.id}`}
                      onClick={() => onDecideProposal(item.id, 'approved')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>
                    <button
                      type="button"
                      data-testid={`review-reject-btn-${item.id}`}
                      onClick={() => onDecideProposal(item.id, 'rejected')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-stone-700 hover:bg-rose-500/10 text-stone-300 hover:text-rose-400 font-medium"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
};

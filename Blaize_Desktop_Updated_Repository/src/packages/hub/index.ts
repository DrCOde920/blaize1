/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize Hub Package (Prompt 1/4):
 * Pure, deterministic, domain-neutral logic for:
 * 1. Sidebar & Anchored Popover Navigation (Top-level buttons only, 1-word tile titles, <=6-word hints, 'Group > Page' breadcrumb)
 * 2. Morrow Voice Toggle (Persistent TTS toggle, aria-pressed, never triggers dancing, suppresses audio when off)
 * 3. Unified Single Memory Store (Auto-save ordinary facts with Undo, ask-first for sensitive categories via Review, hard-block secrets/passwords/financial IDs, external content storage for ledger events so deletion truly purges content, Pause saving, Forget this chat, MEMORY.md & USER.md export)
 * 4. Soul & Personality (Identity, Voice style, Role/job description, Template Download/Import/Remove — zero memory or skills)
 * 5. Unified Skills Manager (Filters: All, Mine, Recorded, From chat; New skill: Record it, Describe it, From a chat; Plain steps, Try it, Edit, History, and Advanced toggle for file formats/parameters)
 * 6. Installed Plugins Manager (No marketplace/catalog; Installed cards with on/off switch, short permissions summary, Remove; Import, Create with Morrow, Download Template; general domain-neutral plugins only)
 * 7. Scoped General Rule Book & Unified Review Inbox (Scopes: Everywhere, Project, Plugin, Connector; applies to every plugin including user-created ones; plugin manifests can only tighten rules; Proof > Review handles all 8 proposal types with plain-language diff, Approve, Reject, and badge count)
 */

import { MemoryLedger } from '../trust';

// ============================================================================
// 1. SIDEBAR & POPOVER NAVIGATION
// ============================================================================

export type TopLevelSidebarGroupId =
  | 'chat'
  | 'projects'
  | 'library'
  | 'workbench'
  | 'automations'
  | 'proof'
  | 'settings';

export type HubPageId =
  | 'chat'
  | 'projects'
  | 'skills'
  | 'plugins'
  | 'connectors'
  | 'soul'
  | 'rules'
  | 'memory'
  | 'browser'
  | 'ide'
  | 'scheduler'
  | 'review'
  | 'evaluations'
  | 'activity'
  | 'settings';

export interface PopoverTileItem {
  pageId: HubPageId;
  groupId: 'library' | 'workbench' | 'automations' | 'proof';
  /** Strictly one word as required by design rules */
  tileTitle: string;
  /** Full page name shown in 'Group > Page' top bar */
  pageName: string;
  /** At most six words */
  hint: string;
  iconName:
    | 'Wand2'
    | 'Puzzle'
    | 'Plug'
    | 'Sparkles'
    | 'Scale'
    | 'BookOpen'
    | 'Globe'
    | 'Code2'
    | 'CalendarClock'
    | 'CheckCircle2'
    | 'Activity'
    | 'ShieldCheck';
  shortcutKeywords: string[];
}

export interface SidebarGroupDefinition {
  id: TopLevelSidebarGroupId;
  label: string;
  position: 'main' | 'footer';
  hasPopover: boolean;
  directPageId?: HubPageId;
  tiles: PopoverTileItem[];
}

export const SIDEBAR_NAVIGATION_GROUPS: SidebarGroupDefinition[] = [
  {
    id: 'chat',
    label: 'Chat',
    position: 'main',
    hasPopover: false,
    directPageId: 'chat',
    tiles: [],
  },
  {
    id: 'projects',
    label: 'Projects',
    position: 'main',
    hasPopover: false,
    directPageId: 'projects',
    tiles: [],
  },
  {
    id: 'library',
    label: 'Library',
    position: 'main',
    hasPopover: true,
    tiles: [
      {
        pageId: 'skills',
        groupId: 'library',
        tileTitle: 'Skills',
        pageName: 'Skills',
        hint: 'Reusable workflows and recorded tasks',
        iconName: 'Wand2',
        shortcutKeywords: ['skills', 'workflows', 'record', 'library'],
      },
      {
        pageId: 'plugins',
        groupId: 'library',
        tileTitle: 'Plugins',
        pageName: 'Plugins',
        hint: 'Installed tools and custom extensions',
        iconName: 'Puzzle',
        shortcutKeywords: ['plugins', 'extensions', 'tools', 'library'],
      },
      {
        pageId: 'connectors',
        groupId: 'library',
        tileTitle: 'Connectors',
        pageName: 'Connectors',
        hint: 'External services and local bridges',
        iconName: 'Plug',
        shortcutKeywords: ['connectors', 'integrations', 'bridges', 'library'],
      },
      {
        pageId: 'soul',
        groupId: 'library',
        tileTitle: 'Soul',
        pageName: 'Soul',
        hint: 'Identity, voice style, and role',
        iconName: 'Sparkles',
        shortcutKeywords: ['soul', 'personality', 'voice', 'role', 'library'],
      },
      {
        pageId: 'rules',
        groupId: 'library',
        tileTitle: 'Rules',
        pageName: 'Rules',
        hint: 'Scoped boundaries for every action',
        iconName: 'Scale',
        shortcutKeywords: ['rules', 'policy', 'boundaries', 'library'],
      },
      {
        pageId: 'memory',
        groupId: 'library',
        tileTitle: 'Memory',
        pageName: 'Memory',
        hint: 'Single store of saved facts',
        iconName: 'BookOpen',
        shortcutKeywords: ['memory', 'facts', 'preferences', 'library'],
      },
    ],
  },
  {
    id: 'workbench',
    label: 'Workbench',
    position: 'main',
    hasPopover: true,
    tiles: [
      {
        pageId: 'browser',
        groupId: 'workbench',
        tileTitle: 'Browser',
        pageName: 'AI Browser',
        hint: 'Inspect pages with verified citations',
        iconName: 'Globe',
        shortcutKeywords: ['browser', 'web', 'citations', 'workbench'],
      },
      {
        pageId: 'ide',
        groupId: 'workbench',
        tileTitle: 'Editor',
        pageName: 'Code Editor',
        hint: 'Write and verify workspace code',
        iconName: 'Code2',
        shortcutKeywords: ['code', 'editor', 'ide', 'workbench'],
      },
    ],
  },
  {
    id: 'automations',
    label: 'Automations',
    position: 'main',
    hasPopover: true,
    tiles: [
      {
        pageId: 'scheduler',
        groupId: 'automations',
        tileTitle: 'Scheduler',
        pageName: 'Scheduler',
        hint: 'Recurring routines and timed jobs',
        iconName: 'CalendarClock',
        shortcutKeywords: ['scheduler', 'cron', 'automations', 'routines'],
      },
    ],
  },
  {
    id: 'proof',
    label: 'Proof',
    position: 'main',
    hasPopover: true,
    tiles: [
      {
        pageId: 'review',
        groupId: 'proof',
        tileTitle: 'Review',
        pageName: 'Review',
        hint: 'Approve or reject pending proposals',
        iconName: 'CheckCircle2',
        shortcutKeywords: ['review', 'inbox', 'proposals', 'approve', 'proof'],
      },
      {
        pageId: 'evaluations',
        groupId: 'proof',
        tileTitle: 'Evaluations',
        pageName: 'Evaluations',
        hint: 'Benchmark quality and safety checks',
        iconName: 'Activity',
        shortcutKeywords: ['evaluations', 'benchmarks', 'tests', 'proof'],
      },
      {
        pageId: 'activity',
        groupId: 'proof',
        tileTitle: 'Activity',
        pageName: 'Activity',
        hint: 'Tamper-evident ledger of actions',
        iconName: 'ShieldCheck',
        shortcutKeywords: ['activity', 'ledger', 'audit', 'proof'],
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    position: 'footer',
    hasPopover: false,
    directPageId: 'settings',
    tiles: [],
  },
];

export function validateSidebarNavigationConstraints(
  groups: SidebarGroupDefinition[] = SIDEBAR_NAVIGATION_GROUPS
): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  for (const group of groups) {
    for (const tile of group.tiles) {
      const titleWords = tile.tileTitle.trim().split(/\s+/).filter(Boolean);
      if (titleWords.length !== 1) {
        violations.push(
          `Tile "${tile.tileTitle}" in group "${group.label}" must be a single word (found ${titleWords.length}).`
        );
      }
      const hintWords = tile.hint.trim().split(/\s+/).filter(Boolean);
      if (hintWords.length === 0 || hintWords.length > 6) {
        violations.push(
          `Tile "${tile.tileTitle}" hint "${tile.hint}" must have at most 6 words (found ${hintWords.length}).`
        );
      }
    }
  }
  return {
    valid: violations.length === 0,
    violations,
  };
}

export function getActiveGroupForPage(pageId: HubPageId): TopLevelSidebarGroupId {
  if (pageId === 'chat') return 'chat';
  if (pageId === 'projects') return 'projects';
  if (pageId === 'settings') return 'settings';
  for (const group of SIDEBAR_NAVIGATION_GROUPS) {
    if (group.tiles.some((t) => t.pageId === pageId)) {
      return group.id;
    }
  }
  return 'chat';
}

export function formatTopBarBreadcrumb(pageId: HubPageId): string {
  if (pageId === 'chat') return 'Chat';
  if (pageId === 'projects') return 'Projects';
  if (pageId === 'settings') return 'Settings';
  for (const group of SIDEBAR_NAVIGATION_GROUPS) {
    const found = group.tiles.find((t) => t.pageId === pageId);
    if (found) {
      return `${group.label} > ${found.pageName}`;
    }
  }
  return 'Chat';
}

export interface PopoverUiState {
  openGroupId: 'library' | 'workbench' | 'automations' | 'proof' | null;
  activePageId: HubPageId;
  focusedTileIndex: number;
}

export function reducePopoverNavigation(
  state: PopoverUiState,
  action:
    | { type: 'CLICK_GROUP_BUTTON'; groupId: TopLevelSidebarGroupId }
    | { type: 'SELECT_TILE'; pageId: HubPageId }
    | { type: 'PRESS_ESCAPE' }
    | { type: 'OUTSIDE_CLICK' }
    | { type: 'ARROW_NEXT' }
    | { type: 'ARROW_PREV' }
): PopoverUiState {
  switch (action.type) {
    case 'CLICK_GROUP_BUTTON': {
      const group = SIDEBAR_NAVIGATION_GROUPS.find((g) => g.id === action.groupId);
      if (!group) return state;
      if (!group.hasPopover && group.directPageId) {
        return {
          openGroupId: null,
          activePageId: group.directPageId,
          focusedTileIndex: 0,
        };
      }
      const popGroupId = group.id as 'library' | 'workbench' | 'automations' | 'proof';
      if (state.openGroupId === popGroupId) {
        return { ...state, openGroupId: null, focusedTileIndex: 0 };
      }
      return {
        ...state,
        openGroupId: popGroupId,
        focusedTileIndex: 0,
      };
    }
    case 'SELECT_TILE': {
      return {
        openGroupId: null,
        activePageId: action.pageId,
        focusedTileIndex: 0,
      };
    }
    case 'PRESS_ESCAPE':
    case 'OUTSIDE_CLICK': {
      if (!state.openGroupId) return state;
      return {
        ...state,
        openGroupId: null,
        focusedTileIndex: 0,
      };
    }
    case 'ARROW_NEXT': {
      if (!state.openGroupId) return state;
      const group = SIDEBAR_NAVIGATION_GROUPS.find((g) => g.id === state.openGroupId);
      if (!group || group.tiles.length === 0) return state;
      return {
        ...state,
        focusedTileIndex: (state.focusedTileIndex + 1) % group.tiles.length,
      };
    }
    case 'ARROW_PREV': {
      if (!state.openGroupId) return state;
      const group = SIDEBAR_NAVIGATION_GROUPS.find((g) => g.id === state.openGroupId);
      if (!group || group.tiles.length === 0) return state;
      return {
        ...state,
        focusedTileIndex:
          (state.focusedTileIndex - 1 + group.tiles.length) % group.tiles.length,
      };
    }
  }
}

// ============================================================================
// 2. VOICE TOGGLE ON MORROW
// ============================================================================

export const VOICE_ENABLED_STORAGE_KEY = 'blaize_morrow_voice_enabled_v1';

export interface VoiceToggleSnapshot {
  voiceEnabled: boolean;
  iconVariant: 'speaker_waves' | 'speaker_muted';
  ariaPressed: boolean;
  tooltip: 'Voice on/off';
  triggersDancing: false;
}

export class VoiceToggleController {
  private voiceEnabled: boolean;
  private spokenUtterances: string[] = [];

  constructor(initialVoiceEnabled = false) {
    this.voiceEnabled = initialVoiceEnabled;
  }

  isEnabled(): boolean {
    return this.voiceEnabled;
  }

  toggle(): VoiceToggleSnapshot {
    this.voiceEnabled = !this.voiceEnabled;
    return this.getSnapshot();
  }

  setEnabled(enabled: boolean): VoiceToggleSnapshot {
    this.voiceEnabled = enabled;
    return this.getSnapshot();
  }

  getSnapshot(): VoiceToggleSnapshot {
    return {
      voiceEnabled: this.voiceEnabled,
      iconVariant: this.voiceEnabled ? 'speaker_waves' : 'speaker_muted',
      ariaPressed: this.voiceEnabled,
      tooltip: 'Voice on/off',
      triggersDancing: false,
    };
  }

  /**
   * Speaks text only when voiceEnabled is true. When voiceEnabled is false,
   * no audio plays and nothing is queued.
   */
  speakReply(text: string): { played: boolean; cleanText: string } {
    const cleanText = text.replace(/[*_`#]/g, '').trim();
    if (!this.voiceEnabled || !cleanText) {
      return { played: false, cleanText };
    }
    this.spokenUtterances.push(cleanText);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(cleanText.slice(0, 260));
        utter.rate = 1.02;
        window.speechSynthesis.speak(utter);
      } catch {
        // Ignore browser speech synthesis errors in headless environments
      }
    }
    return { played: true, cleanText };
  }

  getSpokenHistory(): string[] {
    return [...this.spokenUtterances];
  }
}

// ============================================================================
// 3. ONE MEMORY STORE (Single store, Auto-save ordinary, Ask-first sensitive, Block secrets)
// ============================================================================

export type UnifiedMemoryCategory =
  | 'About you'
  | 'Preferences'
  | 'People and places'
  | 'Projects'
  | 'Facts'
  | 'Habits';

export const UNIFIED_MEMORY_CATEGORIES: UnifiedMemoryCategory[] = [
  'About you',
  'Preferences',
  'People and places',
  'Projects',
  'Facts',
  'Habits',
];

export interface UnifiedMemoryItem {
  id: string;
  category: UnifiedMemoryCategory;
  text: string;
  savedFrom: string; // e.g., 'Chat: Workspace Exploration', 'Manual entry', 'Briefing'
  chatId?: string;
  savedAt: string;
  pinned: boolean;
  expiresAt?: string; // Optional ISO or human date expiry
  ledgerContentRef: string;
}

export interface MemorySaveResult {
  status: 'saved_automatically' | 'needs_review' | 'blocked_secret' | 'paused';
  item?: UnifiedMemoryItem;
  toast?: {
    message: 'Saved';
    memoryId: string;
  };
  reviewProposal?: ReviewProposalItem;
  reason?: string;
}

const SECRET_OR_CREDENTIAL_PATTERNS: RegExp[] = [
  /\b(password|passwd|passcode|pin\s*code|secret\s*key|api[_-\s]?key|private[_-\s]?key|bearer\s+[a-z0-9._-]+|sk-[a-z0-9]{12,}|ghp_[a-z0-9]{12,})\b/i,
  /\b(ssn|social\s*security|credit\s*card|cvv|cvc|iban|routing\s*number|account\s*number|card\s*number|bank\s*account|swift\s*code)\b/i,
  /\b(?:\d[ -]*?){13,19}\b/, // Card number / long identifier sequences
];

const SENSITIVE_MEMORY_PATTERNS: RegExp[] = [
  /\b(medical|diagnosis|prescription|allergy|health|passport|home\s*address|street\s*address|salary|compensation|immigration|religion|political|family\s*member|phone\s*number|birth\s*date)\b/i,
];

export function classifyMemoryProposal(
  text: string,
  category: UnifiedMemoryCategory
): {
  decision: 'auto_save' | 'ask_first_sensitive' | 'block_secret';
  reason: string;
} {
  const trimmed = text.trim();
  for (const pat of SECRET_OR_CREDENTIAL_PATTERNS) {
    if (pat.test(trimmed)) {
      return {
        decision: 'block_secret',
        reason:
          'Never store secrets, passwords, API keys, or financial identifiers in Memory.',
      };
    }
  }
  for (const pat of SENSITIVE_MEMORY_PATTERNS) {
    if (pat.test(trimmed)) {
      return {
        decision: 'ask_first_sensitive',
        reason:
          'Sensitive personal or location information requires your confirmation in Review before saving.',
      };
    }
  }
  if (category === 'People and places' && /\b(address|phone|home|kids|partner)\b/i.test(trimmed)) {
    return {
      decision: 'ask_first_sensitive',
      reason: 'People and location details ask first before saving to Memory.',
    };
  }
  return {
    decision: 'auto_save',
    reason: 'Ordinary fact or preference validated for automatic saving.',
  };
}

export const INITIAL_UNIFIED_MEMORY_ITEMS: UnifiedMemoryItem[] = [
  {
    id: 'mem-1',
    category: 'About you',
    text: 'Works across TypeScript, React, and systems architecture projects on a local workstation.',
    savedFrom: 'First-Run Briefing',
    savedAt: 'Today, 09:15',
    pinned: true,
    ledgerContentRef: 'mem_content_mem-1',
  },
  {
    id: 'mem-2',
    category: 'Preferences',
    text: 'Prefers concise, calm explanations with plain words first and technical hashes tucked behind Show details.',
    savedFrom: 'Chat: Workspace Exploration',
    chatId: 'thread-1',
    savedAt: 'Today, 09:20',
    pinned: true,
    ledgerContentRef: 'mem_content_mem-2',
  },
  {
    id: 'mem-3',
    category: 'People and places',
    text: 'Collaborates with the platform engineering team across London and Accra timezones.',
    savedFrom: 'Chat: Distributed Systems Research',
    chatId: 'thread-2',
    savedAt: 'Yesterday, 16:40',
    pinned: false,
    ledgerContentRef: 'mem_content_mem-3',
  },
  {
    id: 'mem-4',
    category: 'Projects',
    text: 'Personal and Work workspace projects use strict verification before applying code diffs.',
    savedFrom: 'Project Setup',
    savedAt: 'Oct 28',
    pinned: false,
    ledgerContentRef: 'mem_content_mem-4',
  },
  {
    id: 'mem-5',
    category: 'Facts',
    text: 'Local test runner uses node:test via tsx for deterministic package unit tests.',
    savedFrom: 'Code Editor',
    savedAt: 'Oct 29',
    pinned: false,
    ledgerContentRef: 'mem_content_mem-5',
  },
  {
    id: 'mem-6',
    category: 'Habits',
    text: 'Reviews morning project summaries at 09:00 on weekdays and exports weekly markdown notes.',
    savedFrom: 'Scheduler',
    savedAt: 'Today, 08:30',
    pinned: false,
    expiresAt: '2026-12-31',
    ledgerContentRef: 'mem_content_mem-6',
  },
];

export class UnifiedMemoryStore {
  private items: UnifiedMemoryItem[];
  private pauseSaving = false;
  /** Separate content store keyed by ledgerContentRef so deleting a memory purges its text from the ledger too */
  private externalContentMap = new Map<string, string>();
  private ledger?: MemoryLedger;
  private onEnqueueReviewProposal?: (proposal: ReviewProposalItem) => void;

  constructor(
    initialItems: UnifiedMemoryItem[] = INITIAL_UNIFIED_MEMORY_ITEMS,
    ledger?: MemoryLedger,
    onEnqueueReviewProposal?: (proposal: ReviewProposalItem) => void
  ) {
    this.items = initialItems.map((it) => ({ ...it }));
    this.ledger = ledger;
    this.onEnqueueReviewProposal = onEnqueueReviewProposal;
    for (const item of this.items) {
      this.externalContentMap.set(item.ledgerContentRef, item.text);
    }
  }

  getItems(): UnifiedMemoryItem[] {
    return [...this.items].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }

  isPaused(): boolean {
    return this.pauseSaving;
  }

  setPauseSaving(paused: boolean): void {
    this.pauseSaving = paused;
  }

  getExternalContent(contentRef: string): string | undefined {
    return this.externalContentMap.get(contentRef);
  }

  proposeOrSave(input: {
    text: string;
    category: UnifiedMemoryCategory;
    savedFrom: string;
    chatId?: string;
    expiresAt?: string;
    pinned?: boolean;
    forceApprovedSensitive?: boolean;
  }): MemorySaveResult {
    const cleanText = input.text.trim();
    if (!cleanText) {
      return { status: 'blocked_secret', reason: 'Memory text cannot be empty.' };
    }

    const classification = classifyMemoryProposal(cleanText, input.category);
    if (classification.decision === 'block_secret') {
      return {
        status: 'blocked_secret',
        reason: classification.reason,
      };
    }

    if (this.pauseSaving && !input.forceApprovedSensitive) {
      return {
        status: 'paused',
        reason: 'Memory saving is currently paused.',
      };
    }

    if (classification.decision === 'ask_first_sensitive' && !input.forceApprovedSensitive) {
      const proposal: ReviewProposalItem = {
        id: `rev-mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'memory',
        title: `Save sensitive memory (${input.category})`,
        summary: classification.reason,
        proposedBy: 'Morrow',
        createdAt: 'Just now',
        status: 'pending',
        scopeLabel: `Memory · ${input.category}`,
        plainDiff: {
          before: 'Not stored in Memory',
          after: `[${input.category}] "${cleanText}" (from ${input.savedFrom})`,
        },
        payload: {
          text: cleanText,
          category: input.category,
          savedFrom: input.savedFrom,
          chatId: input.chatId,
          expiresAt: input.expiresAt,
        },
      };
      if (this.onEnqueueReviewProposal) {
        this.onEnqueueReviewProposal(proposal);
      }
      return {
        status: 'needs_review',
        reviewProposal: proposal,
        reason: classification.reason,
      };
    }

    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const contentRef = `mem_content_${id}`;
    const newItem: UnifiedMemoryItem = {
      id,
      category: input.category,
      text: cleanText,
      savedFrom: input.savedFrom,
      chatId: input.chatId,
      savedAt: 'Just now',
      pinned: Boolean(input.pinned),
      expiresAt: input.expiresAt,
      ledgerContentRef: contentRef,
    };

    this.items = [newItem, ...this.items];
    this.externalContentMap.set(contentRef, cleanText);

    if (this.ledger) {
      // Keep content separate from immutable ledger payload so deletion purges text
      this.ledger.appendEvent({
        actor: 'agent',
        type: 'memory_created',
        summary: `Saved memory in ${input.category} (${input.savedFrom})`,
        payload: JSON.stringify({
          memoryId: id,
          category: input.category,
          savedFrom: input.savedFrom,
          contentRef,
        }),
        trustLevel: 'user_stated',
        missionId: 'memory-store',
      });
    }

    return {
      status: 'saved_automatically',
      item: newItem,
      toast: {
        message: 'Saved',
        memoryId: id,
      },
    };
  }

  edit(
    id: string,
    patch: {
      text?: string;
      category?: UnifiedMemoryCategory;
      expiresAt?: string;
      pinned?: boolean;
    }
  ): { ok: boolean; error?: string; item?: UnifiedMemoryItem } {
    const existing = this.items.find((it) => it.id === id);
    if (!existing) {
      return { ok: false, error: 'Memory item not found.' };
    }
    if (patch.text !== undefined) {
      const check = classifyMemoryProposal(patch.text, patch.category || existing.category);
      if (check.decision === 'block_secret') {
        return { ok: false, error: check.reason };
      }
    }

    const updated: UnifiedMemoryItem = {
      ...existing,
      text: patch.text !== undefined ? patch.text.trim() : existing.text,
      category: patch.category ?? existing.category,
      expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : existing.expiresAt,
      pinned: patch.pinned !== undefined ? patch.pinned : existing.pinned,
      savedAt: 'Edited just now',
    };

    this.items = this.items.map((it) => (it.id === id ? updated : it));
    this.externalContentMap.set(updated.ledgerContentRef, updated.text);

    if (this.ledger) {
      this.ledger.appendEvent({
        actor: 'user',
        type: 'memory_edited',
        summary: `Edited memory item ${id} (${updated.category})`,
        payload: JSON.stringify({
          memoryId: id,
          category: updated.category,
          contentRef: updated.ledgerContentRef,
        }),
        trustLevel: 'user_stated',
        missionId: 'memory-store',
      });
    }

    return { ok: true, item: updated };
  }

  delete(id: string): boolean {
    const target = this.items.find((it) => it.id === id);
    if (!target) return false;
    this.items = this.items.filter((it) => it.id !== id);
    this.externalContentMap.delete(target.ledgerContentRef);

    if (this.ledger) {
      this.ledger.appendEvent({
        actor: 'user',
        type: 'memory_deleted',
        summary: `Deleted memory item ${id} (${target.category})`,
        payload: JSON.stringify({
          memoryId: id,
          category: target.category,
          contentRef: target.ledgerContentRef,
          contentPurged: true,
        }),
        trustLevel: 'user_stated',
        missionId: 'memory-store',
      });
    }
    return true;
  }

  bulkDelete(ids: string[]): number {
    const idSet = new Set(ids);
    let deletedCount = 0;
    for (const id of idSet) {
      if (this.delete(id)) {
        deletedCount++;
      }
    }
    return deletedCount;
  }

  forgetChat(chatId: string): number {
    const matchingIds = this.items
      .filter((it) => it.chatId === chatId || it.savedFrom.includes(chatId))
      .map((it) => it.id);
    return this.bulkDelete(matchingIds);
  }

  exportMarkdown(target: 'MEMORY.md' | 'USER.md'): string {
    if (target === 'USER.md') {
      const aboutYou = this.items.filter((i) => i.category === 'About you');
      const prefs = this.items.filter((i) => i.category === 'Preferences');
      const habits = this.items.filter((i) => i.category === 'Habits');
      return [
        '# USER.md — Exported from Unified Memory Store',
        '',
        '## About You',
        ...(aboutYou.length > 0 ? aboutYou.map((i) => `- ${i.text}`) : ['- (None recorded)']),
        '',
        '## Preferences',
        ...(prefs.length > 0 ? prefs.map((i) => `- ${i.text}`) : ['- (None recorded)']),
        '',
        '## Habits',
        ...(habits.length > 0 ? habits.map((i) => `- ${i.text}`) : ['- (None recorded)']),
        '',
      ].join('\n');
    }

    const lines: string[] = ['# MEMORY.md — Exported from Unified Memory Store', ''];
    for (const cat of UNIFIED_MEMORY_CATEGORIES) {
      const catItems = this.items.filter((i) => i.category === cat);
      lines.push(`## ${cat}`);
      if (catItems.length === 0) {
        lines.push('- (No entries)');
      } else {
        for (const it of catItems) {
          const pinTag = it.pinned ? ' [Pinned]' : '';
          const expTag = it.expiresAt ? ` (Expires: ${it.expiresAt})` : '';
          lines.push(`- ${it.text}${pinTag}${expTag} — *${it.savedFrom}, ${it.savedAt}*`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }
}

// ============================================================================
// 4. SOUL AND PERSONALITY (Identity, Voice Style, Role/Job Description, Template)
// ============================================================================

export interface SoulProfileConfig {
  identity: {
    name: string;
    tagline: string;
  };
  voiceStyle: {
    cadenceId: string;
    toneDescription: string;
    conciseness: 'concise' | 'balanced' | 'detailed';
    warmth: 'calm' | 'warm' | 'direct';
  };
  roleAndJobDescription: {
    roleTitle: string;
    jobDescription: string;
    offLimits: string;
  };
  templateName: string;
  updatedAt: string;
}

export const DEFAULT_SOUL_PROFILE_CONFIG: SoulProfileConfig = {
  identity: {
    name: 'Morrow',
    tagline: 'Calm, accountable desktop companion for verified work.',
  },
  voiceStyle: {
    cadenceId: 'morrow_warm_accountable',
    toneDescription:
      'Plain words first, calm and direct during work, cites verified receipts, never fabricates results.',
    conciseness: 'concise',
    warmth: 'warm',
  },
  roleAndJobDescription: {
    roleTitle: 'Research, Engineering & Workspace Partner',
    jobDescription:
      'Summarize repositories, verify primary web citations, organize local project files, and run scheduled workspace checks.',
    offLimits:
      'Never modify files outside the workspace, never store passwords or secrets, and always ask before destructive or external actions.',
  },
  templateName: 'Calm Accountable Default',
  updatedAt: 'Today',
};

export function exportSoulTemplateJson(profile: SoulProfileConfig): string {
  return JSON.stringify(
    {
      schema: 'blaize.soul.template.v1',
      exportedAt: new Date().toISOString(),
      profile,
    },
    null,
    2
  );
}

export function importSoulTemplateJson(rawJson: string): {
  ok: boolean;
  profile?: SoulProfileConfig;
  error?: string;
} {
  try {
    const parsed = JSON.parse(rawJson);
    const src = parsed.profile || parsed;
    if (!src?.identity?.name || !src?.voiceStyle || !src?.roleAndJobDescription) {
      return {
        ok: false,
        error: 'Template JSON must include identity, voiceStyle, and roleAndJobDescription.',
      };
    }
    return {
      ok: true,
      profile: {
        identity: {
          name: String(src.identity.name).trim() || 'Morrow',
          tagline: String(src.identity.tagline || '').trim(),
        },
        voiceStyle: {
          cadenceId: String(src.voiceStyle.cadenceId || 'morrow_warm_accountable'),
          toneDescription: String(src.voiceStyle.toneDescription || ''),
          conciseness: src.voiceStyle.conciseness || 'concise',
          warmth: src.voiceStyle.warmth || 'warm',
        },
        roleAndJobDescription: {
          roleTitle: String(src.roleAndJobDescription.roleTitle || 'Workspace Partner'),
          jobDescription: String(src.roleAndJobDescription.jobDescription || ''),
          offLimits: String(src.roleAndJobDescription.offLimits || ''),
        },
        templateName: String(src.templateName || 'Imported Personality Template'),
        updatedAt: 'Imported just now',
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Invalid JSON format.' };
  }
}

// ============================================================================
// 5. SKILLS (One place, simple: All / Mine / Recorded / From chat)
// ============================================================================

export type SkillOriginFilter = 'all' | 'mine' | 'recorded' | 'from_chat';
export type NewSkillCreationMethod = 'record_it' | 'describe_it' | 'from_a_chat';

export interface UnifiedSkillStep {
  stepNumber: number;
  instruction: string;
  verificationNote: string;
}

export interface UnifiedSkillHistoryEntry {
  version: number;
  updatedAt: string;
  summary: string;
}

export interface UnifiedSkillItem {
  id: string;
  name: string;
  iconName: 'FileText' | 'Globe' | 'Code2' | 'FolderKanban' | 'Sparkles' | 'Wand2';
  oneLineDescription: string;
  origin: 'mine' | 'recorded' | 'from_chat';
  lastUsed: string;
  version: number;
  steps: UnifiedSkillStep[];
  history: UnifiedSkillHistoryEntry[];
  /** Hidden behind 'Advanced' in detail view */
  advanced: {
    fileFormat: 'SKILL.md' | 'skill.json';
    parameters: { name: string; defaultValue: string; description: string }[];
    rawContent: string;
  };
}

export const INITIAL_UNIFIED_SKILLS: UnifiedSkillItem[] = [
  {
    id: 'uskill-rename-batch',
    name: 'Batch Rename & Checksum Files',
    iconName: 'FolderKanban',
    oneLineDescription: 'Renames project files with clean date prefixes and verifies SHA-256 hashes.',
    origin: 'recorded',
    lastUsed: '2 hours ago',
    version: 2,
    steps: [
      {
        stepNumber: 1,
        instruction: 'Scan target project folder and list matching files.',
        verificationNote: 'Confirms all source files exist in sandbox.',
      },
      {
        stepNumber: 2,
        instruction: 'Preview normalized kebab-case filenames with YYYY-MM-DD prefix.',
        verificationNote: 'Checks for zero filename collisions.',
      },
      {
        stepNumber: 3,
        instruction: 'Apply rename and verify SHA-256 checksums match before and after.',
        verificationNote: 'Verifies identical file byte hashes.',
      },
    ],
    history: [
      { version: 2, updatedAt: 'Today', summary: 'Added collision check before rename.' },
      { version: 1, updatedAt: 'Oct 27', summary: 'Recorded initial workflow.' },
    ],
    advanced: {
      fileFormat: 'SKILL.md',
      parameters: [
        { name: 'folder_path', defaultValue: 'src/artifacts', description: 'Target workspace folder' },
        { name: 'date_prefix', defaultValue: '2026-10-30', description: 'Prefix applied to files' },
      ],
      rawContent:
        '---\nname: batch-rename-checksum\nversion: 2\n---\n1. Scan {{folder_path}}\n2. Apply {{date_prefix}} prefix\n3. Verify SHA-256 hashes',
    },
  },
  {
    id: 'uskill-citation-verify',
    name: 'Verify Web Citations & Summarize',
    iconName: 'Globe',
    oneLineDescription: 'Checks primary web sources in AI Browser and produces a cited digest.',
    origin: 'mine',
    lastUsed: 'Yesterday',
    version: 3,
    steps: [
      {
        stepNumber: 1,
        instruction: 'Open target documentation or paper URL in AI Browser.',
        verificationNote: 'Confirms HTTP 200 and DOM title match.',
      },
      {
        stepNumber: 2,
        instruction: 'Extract key claims and cross-check quotes against page text.',
        verificationNote: 'Verifies verbatim quote presence in DOM.',
      },
      {
        stepNumber: 3,
        instruction: 'Save structured markdown summary to Project Artifacts.',
        verificationNote: 'Artifact saved with citation anchors.',
      },
    ],
    history: [
      { version: 3, updatedAt: 'Yesterday', summary: 'Tightened quote matching check.' },
      { version: 2, updatedAt: 'Oct 25', summary: 'Added markdown export step.' },
    ],
    advanced: {
      fileFormat: 'SKILL.md',
      parameters: [
        { name: 'topic_query', defaultValue: 'Raft consensus paper', description: 'Research topic' },
      ],
      rawContent:
        '---\nname: verify-web-citations\nversion: 3\n---\n1. Research {{topic_query}}\n2. Verify DOM quotes\n3. Save digest artifact',
    },
  },
  {
    id: 'uskill-weekly-report',
    name: 'Compile Weekly Progress Report',
    iconName: 'FileText',
    oneLineDescription: 'Gathers completed tasks, test results, and artifacts into a clean weekly note.',
    origin: 'from_chat',
    lastUsed: '3 days ago',
    version: 1,
    steps: [
      {
        stepNumber: 1,
        instruction: 'Read recent project artifacts and verified activity items.',
        verificationNote: 'Collects entries from current week.',
      },
      {
        stepNumber: 2,
        instruction: 'Group accomplishments under Highlights, Code Changes, and Next Steps.',
        verificationNote: 'Checks all sections are populated.',
      },
      {
        stepNumber: 3,
        instruction: 'Write formatted weekly report to workspace notes.',
        verificationNote: 'Confirms markdown file saved.',
      },
    ],
    history: [
      { version: 1, updatedAt: 'Oct 26', summary: 'Created from chat conversation.' },
    ],
    advanced: {
      fileFormat: 'SKILL.md',
      parameters: [
        { name: 'week_label', defaultValue: 'Week 44', description: 'Report week header' },
      ],
      rawContent:
        '---\nname: compile-weekly-report\nversion: 1\n---\n1. Gather artifacts for {{week_label}}\n2. Format markdown report',
    },
  },
  {
    id: 'uskill-test-runner-check',
    name: 'Run Package Tests & Explain Failures',
    iconName: 'Code2',
    oneLineDescription: 'Runs unit tests in the workspace and summarizes any failing assertions.',
    origin: 'mine',
    lastUsed: 'Today',
    version: 2,
    steps: [
      {
        stepNumber: 1,
        instruction: 'Execute unit test suite across workspace packages.',
        verificationNote: 'Captures exit code and assertion output.',
      },
      {
        stepNumber: 2,
        instruction: 'If any test fails, pinpoint file and line number and propose a minimal diff.',
        verificationNote: 'Stages diff for review without auto-committing.',
      },
    ],
    history: [
      { version: 2, updatedAt: 'Today', summary: 'Added staged diff preview.' },
    ],
    advanced: {
      fileFormat: 'SKILL.md',
      parameters: [
        { name: 'target_glob', defaultValue: 'src/packages/**/*.test.ts', description: 'Test glob' },
      ],
      rawContent:
        '---\nname: run-package-tests\nversion: 2\n---\n1. Run {{target_glob}}\n2. Verify zero failures',
    },
  },
];

export function filterUnifiedSkills(
  skills: UnifiedSkillItem[],
  filter: SkillOriginFilter,
  query = ''
): UnifiedSkillItem[] {
  const q = query.trim().toLowerCase();
  return skills.filter((s) => {
    if (filter !== 'all' && s.origin !== filter) return false;
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.oneLineDescription.toLowerCase().includes(q)
    );
  });
}

// ============================================================================
// 6. PLUGINS (Installed plugins only — No marketplace/catalog, Zero finance/L3xi)
// ============================================================================

export type RuleEnforcementMode = 'allow' | 'ask_first' | 'block';

export interface PluginManifestConstraint {
  actionClass: 'read' | 'write' | 'destructive' | 'external_send' | 'credential' | 'system';
  mode: RuleEnforcementMode;
  reason: string;
}

export interface InstalledPluginRecord {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  permissionsSummary: string;
  permissions: string[];
  origin: 'built_in' | 'imported' | 'created_with_morrow';
  manifestConstraints: PluginManifestConstraint[];
}

export type InstalledPluginItem = InstalledPluginRecord;

export const INITIAL_INSTALLED_PLUGINS: InstalledPluginRecord[] = [
  {
    id: 'plugin-workspace-files',
    name: 'Workspace Files & Checksums',
    version: '2.1.0',
    enabled: true,
    permissionsSummary: 'Read and write files inside the project sandbox; asks before deleting.',
    permissions: ['fs:sandbox_read', 'fs:sandbox_write'],
    origin: 'built_in',
    manifestConstraints: [
      {
        actionClass: 'destructive',
        mode: 'ask_first',
        reason: 'File deletions always ask for confirmation first.',
      },
    ],
  },
  {
    id: 'plugin-web-research',
    name: 'Web Research & Citations',
    version: '3.0.2',
    enabled: true,
    permissionsSummary: 'Read public documentation pages and verify source quotes.',
    permissions: ['browser:read_public', 'verifier:citation_check'],
    origin: 'built_in',
    manifestConstraints: [
      {
        actionClass: 'credential',
        mode: 'block',
        reason: 'Never reads or submits password or credential fields.',
      },
    ],
  },
  {
    id: 'plugin-code-verifier',
    name: 'Code & Test Verifier',
    version: '2.4.0',
    enabled: true,
    permissionsSummary: 'Read workspace code, run unit tests, and stage diffs for review.',
    permissions: ['workspace:read_code', 'tests:execute'],
    origin: 'built_in',
    manifestConstraints: [
      {
        actionClass: 'write',
        mode: 'ask_first',
        reason: 'Code patches are staged for human review before writing.',
      },
    ],
  },
  {
    id: 'plugin-note-organizer',
    name: 'Markdown Note Organizer',
    version: '1.3.0',
    enabled: false,
    permissionsSummary: 'Organize markdown notes, tags, and weekly summaries inside your project.',
    permissions: ['notes:read', 'notes:write_markdown'],
    origin: 'built_in',
    manifestConstraints: [
      {
        actionClass: 'external_send',
        mode: 'block',
        reason: 'Local note organizer cannot send data externally.',
      },
    ],
  },
];

export function generatePluginTemplateJson(): string {
  return JSON.stringify(
    {
      schema: 'blaize.plugin.manifest.v1',
      name: 'Custom Markdown Exporter',
      version: '1.0.0',
      permissionsSummary: 'Read project notes and export formatted markdown archives locally.',
      permissions: ['notes:read', 'fs:export_markdown'],
      manifestConstraints: [
        {
          actionClass: 'destructive',
          mode: 'block',
          reason: 'Exporter plugin never deletes files.',
        },
        {
          actionClass: 'external_send',
          mode: 'ask_first',
          reason: 'Ask before sharing exported archives outside the workspace.',
        },
      ],
    },
    null,
    2
  );
}

// ============================================================================
// 7. RULE BOOK AND REVIEW (Scoped Rules + Manifest Tightening + Unified Review Inbox)
// ============================================================================

export type ScopedRuleScope = 'Everywhere' | 'Project' | 'Plugin' | 'Connector' | 'Place';

export interface ScopedRuleItem {
  id: string;
  text: string;
  scope: ScopedRuleScope;
  /** Optional target name when scope is Project, Plugin, Connector, or Place */
  targetName?: string;
  actionClass: 'read' | 'write' | 'destructive' | 'external_send' | 'credential' | 'system';
  enforcement: RuleEnforcementMode;
  enabled: boolean;
  safetyFloor: boolean;
}

export const INITIAL_SCOPED_RULES: ScopedRuleItem[] = [
  {
    id: 'srule-1',
    text: 'Never read, autofill, or store passwords, API keys, or secret tokens.',
    scope: 'Everywhere',
    actionClass: 'credential',
    enforcement: 'block',
    enabled: true,
    safetyFloor: true,
  },
  {
    id: 'srule-2',
    text: 'Always ask for approval before deleting files or running destructive commands.',
    scope: 'Everywhere',
    actionClass: 'destructive',
    enforcement: 'ask_first',
    enabled: true,
    safetyFloor: true,
  },
  {
    id: 'srule-3',
    text: 'Ask for confirmation before sending messages or payloads to external connectors.',
    scope: 'Connector',
    targetName: 'All Connectors',
    actionClass: 'external_send',
    enforcement: 'ask_first',
    enabled: true,
    safetyFloor: false,
  },
  {
    id: 'srule-4',
    text: 'Stage code edits for review in Work project before applying changes.',
    scope: 'Project',
    targetName: 'Work',
    actionClass: 'write',
    enforcement: 'ask_first',
    enabled: true,
    safetyFloor: false,
  },
  {
    id: 'srule-5',
    text: 'Require approval before any plugin writes outside its sandboxed project folder.',
    scope: 'Plugin',
    targetName: 'All Plugins',
    actionClass: 'write',
    enforcement: 'ask_first',
    enabled: true,
    safetyFloor: false,
  },
];

const ENFORCEMENT_STRICTNESS: Record<RuleEnforcementMode, number> = {
  allow: 0,
  ask_first: 1,
  block: 2,
};

export function pickStricterEnforcement(
  a: RuleEnforcementMode,
  b: RuleEnforcementMode
): RuleEnforcementMode {
  return ENFORCEMENT_STRICTNESS[a] >= ENFORCEMENT_STRICTNESS[b] ? a : b;
}

/**
 * Evaluates a plugin action against the Rule Book AND the plugin's own manifest.
 * - The Rule Book applies to every plugin, including user-created ones.
 * - Plugin manifests can only tighten rules (e.g. allow -> ask_first -> block), never loosen them.
 */
export function evaluatePluginActionWithScopedRules(input: {
  plugin: InstalledPluginRecord;
  actionClass: ScopedRuleItem['actionClass'];
  actionSummary: string;
  projectName?: string;
  connectorName?: string;
  placeName?: string;
  rules: ScopedRuleItem[];
}): {
  effectiveEnforcement: RuleEnforcementMode;
  appliedRuleIds: string[];
  manifestTightened: boolean;
  manifestAttemptedLoosenIgnored: boolean;
  explanation: string;
} {
  if (!input.plugin.enabled) {
    return {
      effectiveEnforcement: 'block',
      appliedRuleIds: [],
      manifestTightened: false,
      manifestAttemptedLoosenIgnored: false,
      explanation: `Plugin "${input.plugin.name}" is disabled.`,
    };
  }

  let ruleEnforcement: RuleEnforcementMode = 'allow';
  const appliedRuleIds: string[] = [];

  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    if (rule.actionClass !== input.actionClass) continue;

    const matchesScope =
      rule.scope === 'Everywhere' ||
      (rule.scope === 'Plugin' &&
        (!rule.targetName ||
          rule.targetName === 'All Plugins' ||
          rule.targetName.toLowerCase() === input.plugin.name.toLowerCase() ||
          rule.targetName === input.plugin.id)) ||
      (rule.scope === 'Project' &&
        (!rule.targetName ||
          !input.projectName ||
          rule.targetName.toLowerCase() === input.projectName.toLowerCase())) ||
      (rule.scope === 'Connector' &&
        Boolean(input.connectorName) &&
        (!rule.targetName ||
          rule.targetName === 'All Connectors' ||
          rule.targetName.toLowerCase() === (input.connectorName || '').toLowerCase())) ||
      (rule.scope === 'Place' &&
        (!rule.targetName ||
          rule.targetName === 'All Places' ||
          (input.placeName &&
            rule.targetName.toLowerCase() === input.placeName.toLowerCase())));

    if (matchesScope) {
      appliedRuleIds.push(rule.id);
      ruleEnforcement = pickStricterEnforcement(ruleEnforcement, rule.enforcement);
    }
  }

  let effectiveEnforcement = ruleEnforcement;
  let manifestTightened = false;
  let manifestAttemptedLoosenIgnored = false;

  for (const constraint of input.plugin.manifestConstraints) {
    if (constraint.actionClass !== input.actionClass) continue;
    if (
      ENFORCEMENT_STRICTNESS[constraint.mode] > ENFORCEMENT_STRICTNESS[effectiveEnforcement]
    ) {
      effectiveEnforcement = constraint.mode;
      manifestTightened = true;
    } else if (
      ENFORCEMENT_STRICTNESS[constraint.mode] < ENFORCEMENT_STRICTNESS[ruleEnforcement]
    ) {
      // Manifest tried to be looser than the Rule Book — ignore loosening!
      manifestAttemptedLoosenIgnored = true;
    }
  }

  const explanation =
    effectiveEnforcement === 'block'
      ? `Blocked for safety by ${
          manifestTightened ? 'plugin manifest tightening' : 'Rule Book'
        }`
      : effectiveEnforcement === 'ask_first'
        ? `Needs your approval under ${
            manifestTightened ? 'plugin manifest constraint' : 'Rule Book'
          }`
        : 'Verified and allowed by Rule Book';

  return {
    effectiveEnforcement,
    appliedRuleIds,
    manifestTightened,
    manifestAttemptedLoosenIgnored,
    explanation,
  };
}

// ============================================================================
// 8. UNIFIED REVIEW INBOX (Proof > Review)
// ============================================================================

export type ReviewProposalType =
  | 'skill'
  | 'plugin'
  | 'rule'
  | 'personality'
  | 'memory'
  | 'schedule'
  | 'connector_write'
  | 'extension';

export const ALL_REVIEW_PROPOSAL_TYPES: ReviewProposalType[] = [
  'skill',
  'plugin',
  'rule',
  'personality',
  'memory',
  'schedule',
  'connector_write',
  'extension',
];

export interface ReviewProposalItem {
  id: string;
  type: ReviewProposalType;
  title: string;
  summary: string;
  proposedBy: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  scopeLabel: string;
  plainDiff: {
    before: string;
    after: string;
  };
  payload?: Record<string, any>;
}

export const INITIAL_REVIEW_PROPOSALS: ReviewProposalItem[] = [
  {
    id: 'rev-skill-1',
    type: 'skill',
    title: 'Update "Verify Web Citations & Summarize" to v4',
    summary: 'Adds a check that archived links include a publication date.',
    proposedBy: 'Morrow',
    createdAt: '10 mins ago',
    status: 'pending',
    scopeLabel: 'Skill · Library > Skills',
    plainDiff: {
      before: 'Step 2: Extract key claims and cross-check quotes against page text.',
      after: 'Step 2: Extract key claims, verify verbatim quotes, and record publication date.',
    },
  },
  {
    id: 'rev-plugin-1',
    type: 'plugin',
    title: 'Enable "Local SVG Diagram Builder" plugin',
    summary: 'User-created plugin that renders architecture diagrams inside project artifacts.',
    proposedBy: 'Morrow',
    createdAt: '25 mins ago',
    status: 'pending',
    scopeLabel: 'Plugin · Library > Plugins',
    plainDiff: {
      before: 'Plugin not installed',
      after: 'Install Local SVG Diagram Builder (v1.0.0) with read/write artifact permissions; external send blocked.',
    },
  },
  {
    id: 'rev-rule-1',
    type: 'rule',
    title: 'Add connector rule for GitHub Issues bridge',
    summary: 'Require confirmation before creating or closing issues on remote repositories.',
    proposedBy: 'Morrow',
    createdAt: '1 hour ago',
    status: 'pending',
    scopeLabel: 'Rule · Scope: Connector',
    plainDiff: {
      before: 'Default connector write policy',
      after: 'Scope: Connector (GitHub) — Always ask before creating or closing remote issues.',
    },
  },
  {
    id: 'rev-personality-1',
    type: 'personality',
    title: 'Refine voice style for code reviews',
    summary: 'Keep code review feedback under 4 bullet points unless asked for deep dive.',
    proposedBy: 'Morrow',
    createdAt: '2 hours ago',
    status: 'pending',
    scopeLabel: 'Soul · Library > Soul',
    plainDiff: {
      before: 'Voice style: Plain words first, calm and direct during work.',
      after: 'Voice style: Plain words first, calm and direct during work; cap code review notes at 4 bullets.',
    },
  },
  {
    id: 'rev-memory-1',
    type: 'memory',
    title: 'Save office location preference (Sensitive)',
    summary: 'Location detail requires your confirmation before saving to Memory.',
    proposedBy: 'Morrow',
    createdAt: 'Today',
    status: 'pending',
    scopeLabel: 'Memory · People and places',
    plainDiff: {
      before: 'Not stored in Memory',
      after: '[People and places] "Works from the East Legon studio on Tuesdays and Thursdays."',
    },
  },
  {
    id: 'rev-schedule-1',
    type: 'schedule',
    title: 'Schedule Friday 16:00 Weekly Artifact Digest',
    summary: 'Compiles project notes every Friday afternoon in read-only mode.',
    proposedBy: 'Morrow',
    createdAt: 'Today',
    status: 'pending',
    scopeLabel: 'Schedule · Automations > Scheduler',
    plainDiff: {
      before: 'No Friday digest schedule',
      after: 'Every Friday at 16:00 (0 16 * * 5): Run "Compile Weekly Progress Report" in Personal project.',
    },
  },
  {
    id: 'rev-connector-1',
    type: 'connector_write',
    title: 'Post weekly summary to Local Docs Connector',
    summary: 'Writes 1 markdown document (`weekly-notes-w44.md`) to synced docs folder.',
    proposedBy: 'Morrow',
    createdAt: 'Just now',
    status: 'pending',
    scopeLabel: 'Connector Write · Local Docs',
    plainDiff: {
      before: 'docs/weekly-notes-w44.md (does not exist)',
      after: 'Create docs/weekly-notes-w44.md (42 lines, verified markdown summary)',
    },
  },
  {
    id: 'rev-extension-1',
    type: 'extension',
    title: 'Enable Prettier Code Formatter in Code Editor',
    summary: 'Formats TypeScript and Markdown files on save inside Workbench > Code Editor.',
    proposedBy: 'Operator',
    createdAt: 'Yesterday',
    status: 'pending',
    scopeLabel: 'Extension · Workbench > Code Editor',
    plainDiff: {
      before: 'esbenp.prettier-vscode: Installed (Disabled)',
      after: 'esbenp.prettier-vscode: Enabled for workspace formatting',
    },
  },
];

export class UnifiedReviewInbox {
  private proposals: ReviewProposalItem[];

  constructor(initialProposals: ReviewProposalItem[] = INITIAL_REVIEW_PROPOSALS) {
    this.proposals = initialProposals.map((p) => ({
      ...p,
      plainDiff: { ...p.plainDiff },
    }));
  }

  getAll(): ReviewProposalItem[] {
    return [...this.proposals];
  }

  getPendingCount(): number {
    return this.proposals.filter((p) => p.status === 'pending').length;
  }

  addProposal(proposal: ReviewProposalItem): ReviewProposalItem {
    this.proposals = [proposal, ...this.proposals];
    return proposal;
  }

  decide(
    proposalId: string,
    decision: 'approved' | 'rejected'
  ): { ok: boolean; item?: ReviewProposalItem } {
    const target = this.proposals.find((p) => p.id === proposalId);
    if (!target) return { ok: false };
    const updated: ReviewProposalItem = {
      ...target,
      status: decision,
    };
    this.proposals = this.proposals.map((p) => (p.id === proposalId ? updated : p));
    return { ok: true, item: updated };
  }
}

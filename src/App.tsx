/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize — Clean, Calm, Easier AI Workspace
 * - Chat first: opens to a centered 760px conversation column with one prompt box.
 * - Five sidebar groups (240px expanded, 56px collapsed rail, mobile drawer on narrow screens):
 *   1. Chat (with Recent chats)
 *   2. Library (Skills, Plugins, Soul and personality, Rules)
 *   3. Workbench (Projects and artifacts, AI Browser, Code)
 *   4. Automations (Scheduler, Connectors)
 *   5. Proof (Ledger, Evaluations, Memory and privacy)
 *   + Settings & Theme in the footer.
 * - Morrow PerchTargets: sits on the top edge of the composer ('composer-top') in Chat with legs
 *   dangling, and perches on 'panel-top-right', 'sidebar-footer', or 'screen-floor' elsewhere.
 * - Command Palette (Ctrl/Cmd+K) & Keyboard Shortcuts sheet (?).
 */

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from './utils/api_client';
import {
  Activity,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Command,
  FolderKanban,
  Globe,
  HelpCircle,
  Keyboard,
  Layers,
  Lock,
  Menu,
  MessageSquare,
  Mic,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plug,
  Plus,
  Puzzle,
  Scale,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Wand2,
  Wrench,
  X,
  Video,
  Eye,
  GitBranch,
  AlertTriangle,
  Laptop,
  Stethoscope,
  KeyRound,
  UserCheck,
  Pencil,
  Trash2,
} from 'lucide-react';
import { MorrowCompanion } from './components/MorrowCompanion';
import { SkillRecorderStudio } from './components/SkillRecorderStudio';
import { CharacterStudioPanel } from './components/CharacterStudioPanel';
import { KeyVaultPanel } from './components/KeyVaultPanel';
import {
  UniversalControlAndHermesView,
  UniversalHermesSubTab,
} from './components/UniversalControlAndHermesView';
import {
  SidebarGroupPopover,
  UnifiedMemoryPageView,
  UnifiedPluginsPageView,
  UnifiedReviewInboxView,
  UnifiedRulesPageView,
  UnifiedSkillsPageView,
  UnifiedSoulPageView,
} from './components/HubPopoverAndViews';
import { FirstRunBriefingModal } from './components/FirstRunBriefingModal';
import { ProjectsAndArtifactsView, ProjectChatSummary } from './components/ProjectsAndArtifactsView';
import { GeneralEvaluationsView } from './components/GeneralEvaluationsView';
import { PCOperatorView, PCOperatorTabId } from './components/PCOperatorView';
import { PlacesMapView } from './components/PlacesMapView';
import {
  INITIAL_USER_PLACES,
  INITIAL_INDEXED_FILES,
  placesFind,
  placesSuggestDestination,
  evaluatePlacesGuard,
  type PlaceRule,
  type IndexedFileMetadata,
} from './packages/places';
import {
  DEFAULT_HOW_MUCH_SHOULD_I_ASK,
  HOW_MUCH_SHOULD_I_ASK_OPTIONS,
  sanitizeAssistantToneCopy,
  type HowMuchShouldIAskPreference,
} from './packages/pc_operator';
import {
  GeneralEvaluationRunRecord,
  GeneralEvaluationRunner,
  GeneralProject,
  INITIAL_GENERAL_PROJECTS,
  INITIAL_UNIVERSAL_ARTIFACTS,
  UniversalArtifact,
  UniversalArtifactStore,
  evaluateNewPluginBeforeEnable,
  pluginToEvaluableManifest,
} from './packages/projects_evals';
import {
  HermesSkillsSubTab,
  SkillsConnectorsSchedulerView,
} from './components/SkillsConnectorsSchedulerView';
import { WorkingConnectorsView } from './components/WorkingConnectorsView';
import { EverydaySchedulerView } from './components/EverydaySchedulerView';
import {
  ConnectorManifest,
  EverydayScheduleItem,
  INITIAL_CONNECTOR_MANIFESTS,
  INITIAL_EVERYDAY_SCHEDULES,
} from './packages/connectors_scheduler';
import {
  INITIAL_MODULAR_PLUGINS,
  ModularPluginItem,
} from './components/PluginsHubView';
import { FocusedApprovalSheet } from './components/ui/WorkspacePrimitives';
import {
  BrowserProfileId,
  CompiledSkill,
  MorrowState,
  PersonalityId,
  PolicyDecision,
  TalkDecisionLog,
} from './packages/contracts';
import {
  BoundedRingBuffer,
  DEFAULT_COMPILED_SKILL,
  SleepCycleReport,
  buildMissionForScenario,
  executeSleepCycle,
} from './packages/core';
import {
  COMPANION_LOOK_PRESETS,
  CompiledPersonalityProfile,
  DEFAULT_LOCAL_MUSIC_TRACKS,
  FEATURE_WIRING_INVENTORY,
  LOCAL_DEMO_MODEL_PROVIDER_STATUS,
  Live2DExpressionId,
  Live2DPropId,
  Live2DProportionMode,
  MorrowAnimationAction,
  MusicTrackItem,
  WEB_PREVIEW_PLATFORM_ADAPTER,
  compileNaturalLanguagePersonality,
  executeChatNaturalLanguageAction,
} from './packages/living';
import {
  DEFAULT_POLICY_CONFIG,
  MemoryLedger,
  PolicyConfig,
  computeDeterministicHash,
} from './packages/trust';
import {
  ArtifactKind,
  CommandPaletteCategory,
  CommandPaletteItem,
  DEFAULT_SOUL_DOCUMENT,
  INITIAL_IDE_FILES,
  INITIAL_MEMORY_ENTRIES,
  INITIAL_REUSABLE_SKILLS,
  INITIAL_SCHEDULED_TASKS,
  INITIAL_VSCODE_MARKETPLACE_EXTENSIONS,
  INITIAL_WORKSPACE_ARTIFACTS,
  INITIAL_WORKSPACE_CONNECTORS,
  INITIAL_WORKSPACE_PROJECTS,
  IdeFileNode,
  MemoryEntry,
  ReusableSkill,
  ScheduledTaskItem,
  SoulDocument,
  VSCodeMarketplaceExtension,
  WorkspaceArtifact,
  WorkspaceConnector,
  WorkspaceProject,
  applySoulVoiceToResponse,
  createOrUpdateArtifact,
  detectUserCorrectionForSoulOrRule,
  executeSkillManage,
  formatMemoryMarkdown,
  matchSkillsForPrompt,
  parseAndValidateSoulDocument,
  proposeSoulChangeFromNaturalLanguage,
  previewMemoryPurge,
  purgeMemoryAndCache,
  restoreFromMemoryPurgeArchive,
  type MemoryPurgePreview,
  type MemoryPurgeTarget,
  searchCommandPalette,
  updateWorkspaceProject,
} from './packages/workspace';
import {
  AgentRuntime,
  CompiledDemonstrationSkill,
  DesktopAppGrant,
  INITIAL_DESKTOP_APP_GRANTS,
  INITIAL_RULE_BOOK,
  INITIAL_USAGE_SUGGESTIONS,
  MeasuredEvaluationReport,
  ModelConnectionTestResult,
  ModelRouter,
  ModelRouterMode,
  ReviewQueueItem,
  RuleBookItem,
  RuntimeStepRecord,
  SecretCodeDigest,
  UsageSuggestionItem,
  clearPersistedSnapshotSync,
  compileTeachDemonstrationToSkill,
  deriveSecretCodePBKDF2,
  globalRuntimeEventBus,
  loadPersistedSnapshotSync,
  replayCompiledSkillByIntent,
  runMeasuredEvaluationSuite,
  savePersistedSnapshotSync,
  searchInAppHelp,
} from './packages/runtime';
import { IdePatchProposal } from './packages/workspace';
import {
  RecorderSourceType,
  ScreenAwarenessMode,
  RecordingSession,
  RecordedKeyframe,
  RecordedMediaSegmentMeta,
  RecordedInteractionEvent,
  DraftRecordedSkill,
  SkillPlan,
  SkillPlanExecutionReport,
  DEFAULT_BLOCKED_APP_CATEGORIES,
  evaluateCredentialAndAppProtection,
  buildDefaultDomainNeutralRecordedSkills,
  saveKeyframeToIndexedDb,
  deleteKeyframesFromIndexedDb,
  deleteRecordingMediaSegments,
  ScreenCaptureSource,
  type RecorderConsentRecord,
} from './packages/recorder';
import {
  CharacterHistoryStack,
  CharacterParametricState,
  CharacterPatch,
  DEFAULT_CHARACTER_PARAMETRIC_STATE,
} from './packages/character';
import {
  RoleTemplateId,
  WorkspaceProfileId,
  generateBriefingArtifacts,
} from './packages/hermes';
import {
  DEFAULT_SOUL_PROFILE_CONFIG,
  HubPageId,
  TopLevelSidebarGroupId,
  INITIAL_INSTALLED_PLUGINS,
  INITIAL_REVIEW_PROPOSALS,
  INITIAL_SCOPED_RULES,
  INITIAL_UNIFIED_MEMORY_ITEMS,
  INITIAL_UNIFIED_SKILLS,
  InstalledPluginRecord,
  ReviewProposalItem,
  SIDEBAR_NAVIGATION_GROUPS,
  ScopedRuleItem,
  SoulProfileConfig,
  UnifiedMemoryCategory,
  UnifiedMemoryItem,
  UnifiedMemoryStore,
  UnifiedReviewInbox,
  UnifiedSkillItem,
  VOICE_ENABLED_STORAGE_KEY,
  VoiceToggleController,
  formatTopBarBreadcrumb,
  getActiveGroupForPage,
} from './packages/hub';

// Lazy-load heavy views (Code, Browser, Artifact preview, Evals)
const MonacoCodeEditorView = lazy(() =>
  import('./components/MonacoCodeEditorView').then((m) => ({ default: m.MonacoCodeEditorView }))
);
const GeneralBrowserView = lazy(() =>
  import('./components/GeneralBrowserView').then((m) => ({ default: m.GeneralBrowserView }))
);
const VSCodeIdeView = lazy(() =>
  import('./components/VSCodeIdeView').then((m) => ({ default: m.VSCodeIdeView }))
);
const BlaizeBrowserView = lazy(() =>
  import('./components/BlaizeBrowserView').then((m) => ({ default: m.BlaizeBrowserView }))
);
const ArtifactSplitDrawer = lazy(() =>
  import('./components/ArtifactSplitDrawer').then((m) => ({ default: m.ArtifactSplitDrawer }))
);
const EvalsAndSleepView = lazy(() =>
  import('./components/EvalsAndSleepView').then((m) => ({ default: m.EvalsAndSleepView }))
);

type MainWorkspaceView =
  | HubPageId
  | 'places'
  | 'ledger'
  | 'apps_devices'
  | 'memory_privacy'
  | 'doctor'
  | 'pc_operator';

type SettingsSectionId =
  | 'general'
  | 'character'
  | 'role'
  | 'morrow'
  | 'soul'
  | 'rules'
  | 'vault'
  | 'models'
  | 'voice'
  | 'privacy'
  | 'advanced';

interface ChatTurnMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolsUsed?: string[];
  linkedArtifactId?: string;
  verifiedProof?: {
    hash: string;
    summary: string;
    statusLabel?: string;
    isSimulated?: boolean;
  };
  runtimeSteps?: RuntimeStepRecord[];
  proposedIdeDiff?: IdePatchProposal;
  multiSkillPlan?: {
    plan: SkillPlan;
    result: SkillPlanExecutionReport;
  };
  placesCard?: {
    kind: 'where_is' | 'where_should_go' | 'off_limits';
    title: string;
    placeLabel: string;
    placePath: string;
    status: 'allowed' | 'ask_first' | 'never';
    reason: string;
    confidencePct?: number;
  };
}

interface ConversationThread {
  id: string;
  projectId?: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  messages: ChatTurnMessage[];
}

const INITIAL_THREADS: ConversationThread[] = [
  {
    id: 'thread-1',
    title: 'Workspace Exploration & Assistance',
    updatedAt: 'Today',
    pinned: true,
    messages: [
      {
        id: 'm-1',
        role: 'assistant',
        content:
          "Welcome back! I'm perched right here on your prompt box so we have a clean, calm workspace. We can chat about anything, or if you want me to tidy your Downloads, summarize a folder, research a topic, or check a test in Code, just ask.",
        timestamp: 'Just now',
      },
    ],
  },
  {
    id: 'thread-2',
    title: 'Distributed Systems Consensus Research',
    updatedAt: 'Yesterday',
    pinned: false,
    messages: [
      {
        id: 'm-201',
        role: 'user',
        content: 'Research consensus algorithms (Raft and Paxos) and verify primary citations.',
        timestamp: 'Yesterday',
      },
      {
        id: 'm-202',
        role: 'assistant',
        content:
          'I researched primary consensus publications (Lamport 1998, Ongaro & Ousterhout 2014) in the AI Browser and verified both sources. A structured citation digest has been saved to Project Artifacts.',
        timestamp: 'Yesterday',
        toolsUsed: ['Research & AI Browser'],
        verifiedProof: {
          hash: 'sha256:4d19b8e21a09',
          summary: 'Simulated (Preview) · 2 primary academic sources checked in simulated browser fixture',
          statusLabel: 'Simulated (Preview)',
          isSimulated: true,
        },
      },
    ],
  },
  {
    id: 'proj-thread-kyoto-1',
    projectId: 'proj-kyoto-trip',
    title: '7-Day Arashiyama & Higashiyama Walking Plan',
    updatedAt: 'Today',
    pinned: false,
    messages: [
      {
        id: 'pt-k1',
        role: 'user',
        content: 'Group our Kyoto stops by neighborhood so we avoid crowded buses.',
        timestamp: '09:15 AM',
      },
      {
        id: 'pt-k2',
        role: 'assistant',
        content:
          'Using your **Autumn Trip to Kyoto** project instructions and knowledge files, I grouped your Kyoto stops into **Higashiyama (Days 1–2)** and **Arashiyama (Day 3)**, with early-morning walking routes before 8:30 AM and JR pass times.',
        timestamp: '09:16 AM',
      },
    ],
  },
  {
    id: 'proj-thread-kyoto-2',
    projectId: 'proj-kyoto-trip',
    title: 'Ryokan & vegetarian dining reservations',
    updatedAt: 'Yesterday',
    pinned: false,
    messages: [
      {
        id: 'pt-k3',
        role: 'user',
        content: 'Find shojin-ryori vegetarian lunch spots near Nanzen-ji.',
        timestamp: 'Yesterday',
      },
      {
        id: 'pt-k4',
        role: 'assistant',
        content:
          'Saved 4 shojin-ryori temple dining options near Nanzen-ji with reservation windows and Yen estimates inside your **Autumn Trip to Kyoto** project.',
        timestamp: 'Yesterday',
      },
    ],
  },
  {
    id: 'proj-thread-bakery-1',
    projectId: 'proj-bakery-launch',
    title: 'Opening menu & sourdough hydration schedule',
    updatedAt: '2 days ago',
    pinned: false,
    messages: [
      {
        id: 'pt-b1',
        role: 'user',
        content: 'Draft our opening weekend bake schedule for 80 country loaves.',
        timestamp: '2 days ago',
      },
      {
        id: 'pt-b2',
        role: 'assistant',
        content:
          'Prepared the bulk fermentation and cold-proof schedule for 80 country loaves using your **Neighborhood Bakery Launch** recipe knowledge files.',
        timestamp: '2 days ago',
      },
    ],
  },
];

const INITIAL_PROJECT_THREADS: ProjectChatSummary[] = [
  {
    id: 'proj-thread-kyoto-1',
    projectId: 'proj-kyoto-trip',
    title: '7-Day Arashiyama & Higashiyama Walking Plan',
    updatedAt: 'Today',
    lastMessagePreview:
      'Grouped temples by walking distance and added quiet morning slots before 8:30 AM.',
    messages: [
      {
        id: 'pt-k1',
        role: 'user',
        content: 'Group our Kyoto stops by neighborhood so we avoid crowded buses.',
        timestamp: '09:15 AM',
      },
      {
        id: 'pt-k2',
        role: 'assistant',
        content:
          'I grouped your Kyoto stops into Higashiyama (Days 1–2) and Arashiyama (Day 3), with early-morning walking routes and JR pass times saved to this project.',
        timestamp: '09:16 AM',
      },
    ],
  },
  {
    id: 'proj-thread-kyoto-2',
    projectId: 'proj-kyoto-trip',
    title: 'Ryokan & vegetarian dining reservations',
    updatedAt: 'Yesterday',
    lastMessagePreview: 'Saved 4 shojin-ryori temple dining options near Nanzen-ji.',
    messages: [
      {
        id: 'pt-k3',
        role: 'user',
        content: 'Find shojin-ryori vegetarian lunch spots near Nanzen-ji.',
        timestamp: 'Yesterday',
      },
      {
        id: 'pt-k4',
        role: 'assistant',
        content:
          'Saved 4 shojin-ryori temple dining options near Nanzen-ji with reservation windows and Yen estimates inside your Kyoto project.',
        timestamp: 'Yesterday',
      },
    ],
  },
  {
    id: 'proj-thread-bakery-1',
    projectId: 'proj-bakery-launch',
    title: 'Opening menu & sourdough hydration schedule',
    updatedAt: '2 days ago',
    lastMessagePreview: 'Calculated flour batch weights and morning bake timeline.',
    messages: [
      {
        id: 'pt-b1',
        role: 'user',
        content: 'Draft our opening weekend bake schedule for 80 country loaves.',
        timestamp: '2 days ago',
      },
      {
        id: 'pt-b2',
        role: 'assistant',
        content:
          'Prepared the bulk fermentation and cold-proof schedule for 80 country loaves and linked it to your Bakery project artifacts.',
        timestamp: '2 days ago',
      },
    ],
  },
];

function readStoredPref<T>(key: string, fallback: T): T {
  const runtime = typeof window !== 'undefined' ? window.__BLAIZE_RUNTIME_PREFS__ : undefined;
  const boot = typeof window !== 'undefined' ? window.__BLAIZE_BOOTSTRAP_PREFS__ : undefined;
  if (runtime && Object.prototype.hasOwnProperty.call(runtime, key)) return runtime[key] as T;
  if (boot && Object.prototype.hasOwnProperty.call(boot, key)) return boot[key] as T;
  // Electron must never hydrate stale localStorage after the SQLite bootstrap ran.
  if (typeof window !== 'undefined' && window.electronAPI?.isElectron) return fallback;
  try {
    const raw = window.localStorage.getItem(`blaize_pref_${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

function writeStoredPref<T>(key: string, value: T): void {
  try {
    if (typeof window === 'undefined') return;
    if (window.electronAPI?.isElectron) {
      const prefs = (window.__BLAIZE_RUNTIME_PREFS__ ||= { ...(window.__BLAIZE_BOOTSTRAP_PREFS__ || {}) });
      prefs[key] = value;
      void window.electronAPI.storage.putRecord('ui_preferences', {
        id: 'ui', collection: 'ui_preferences', data: { values: prefs },
        createdAt: Date.now(), updatedAt: Date.now(),
      }).catch(() => undefined);
    } else {
      window.localStorage.setItem(`blaize_pref_${key}`, JSON.stringify(value));
    }
  } catch { /* storage errors are surfaced in the storage health panel */ }
}

/**
 * Collapsed 'What I did' card for assistant messages:
 * Shows plain-language 'Verified' badge + collapsed tool & receipt summary.
 * Hashes and technical IDs sit behind 'Show details'.
 */
const WhatIDidCard: React.FC<{
  msg: ChatTurnMessage;
  isLight: boolean;
  isCrystallized: boolean;
  onOpenOrSaveArtifact: () => void;
  onCrystallizeSkill: () => void;
}> = ({ msg, isLight, isCrystallized, onOpenOrSaveArtifact, onCrystallizeSkill }) => {
  const [open, setOpen] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const hasActivity =
    (msg.toolsUsed && msg.toolsUsed.length > 0) ||
    Boolean(msg.verifiedProof) ||
    Boolean(msg.multiSkillPlan);
  if (!hasActivity) return null;

  return (
    <div
      className={`mt-2 pt-2 border-t text-xs ${
        isLight ? 'border-stone-200/80' : 'border-stone-800/80'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid={`what-i-did-toggle-${msg.id}`}
          className={`inline-flex items-center gap-1.5 py-0.5 font-medium transition-colors ${
            isLight ? 'text-stone-600 hover:text-stone-900' : 'text-stone-300 hover:text-white'
          }`}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <span>What I did</span>
          {msg.verifiedProof && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-sky-500/10 text-sky-400 border border-sky-500/25">
              <CheckCircle2 className="w-3 h-3" />
              <span>{msg.verifiedProof.statusLabel || (msg.verifiedProof.isSimulated !== false ? 'Simulated (Preview)' : 'Verified')}</span>
            </span>
          )}
        </button>

        {/* Primary message actions: Save as artifact, Crystallize into skill */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenOrSaveArtifact}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              isLight
                ? 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
            }`}
          >
            <Layers className="w-3 h-3 text-sky-400" />
            <span>{msg.linkedArtifactId ? 'Open artifact' : 'Save as artifact'}</span>
          </button>

          <button
            type="button"
            disabled={isCrystallized}
            onClick={onCrystallizeSkill}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              isCrystallized
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : isLight
                  ? 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                  : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
            }`}
          >
            <Wand2 className="w-3 h-3 text-sky-400" />
            <span>{isCrystallized ? 'Saved to Skills' : 'Crystallize into skill'}</span>
          </button>
        </div>
      </div>

      {open && (
        <div
          className={`mt-2 p-3 rounded-xl border space-y-2 text-xs ${
            isLight
              ? 'bg-stone-50 border-stone-200 text-stone-700'
              : 'bg-stone-950/70 border-stone-800 text-stone-300'
          }`}
        >
          {msg.toolsUsed && msg.toolsUsed.length > 0 && (
            <div className="flex items-center gap-2">
              <Wrench className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>Tools used: {msg.toolsUsed.join(', ')}</span>
            </div>
          )}
          {msg.verifiedProof && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{msg.verifiedProof.summary}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowTechnicalDetails((v) => !v)}
                className="text-[11px] text-sky-400 hover:underline whitespace-nowrap"
              >
                {showTechnicalDetails ? 'Hide details' : 'Show details'}
              </button>
            </div>
          )}

          {showTechnicalDetails && msg.verifiedProof && (
            <div className="pt-2 border-t border-stone-800/50 font-mono text-[11px] text-stone-400 space-y-1">
              <div>Receipt hash: {msg.verifiedProof.hash}</div>
              <div>Safety check: Passed deterministic post-condition verification</div>
            </div>
          )}

          {msg.runtimeSteps && msg.runtimeSteps.length > 0 && (
            <div className="pt-2 border-t border-stone-800/50 space-y-1.5">
              <div className="font-semibold text-[11px] text-stone-400">
                AgentRuntime Toolbelt Steps ({msg.runtimeSteps.length})
              </div>
              {msg.runtimeSteps.map((st) => (
                <div
                  key={st.stepNumber}
                  className="flex flex-wrap items-center justify-between gap-2 py-1 px-2 rounded-lg bg-stone-500/10"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-sky-400">
                      #{st.stepNumber} {st.toolCall.tool}
                    </span>
                    <span className="text-[11px]">{st.verification.summary}</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      (st.uiStatusLabel || st.guardDecision.status) === 'Verified'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : (st.uiStatusLabel || st.guardDecision.status) === 'Simulated (Preview)'
                          ? 'bg-sky-500/15 text-sky-400'
                          : st.guardDecision.status === 'Needs your approval'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-rose-500/15 text-rose-400'
                    }`}
                  >
                    {st.uiStatusLabel || st.guardDecision.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {msg.multiSkillPlan && (
            <div
              data-testid="chat-multi-skill-plan-view"
              className="pt-2 border-t border-stone-800/50 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[11px] text-sky-400 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>
                    Multi-Skill Plan View ({msg.multiSkillPlan.result.nodeReceipts.length} nodes ·{' '}
                    {msg.multiSkillPlan.result.status.toUpperCase()})
                  </span>
                </span>
                <span className="text-[10px] font-mono text-stone-400">
                  Tokens: {msg.multiSkillPlan.result.totalTokensUsed}/
                  {msg.multiSkillPlan.plan.totalBudgetTokens}
                </span>
              </div>
              <div className="space-y-1.5">
                {msg.multiSkillPlan.result.nodeReceipts.map((nr, idx) => (
                  <div
                    key={nr.nodeId}
                    className="p-2 rounded-lg bg-stone-500/10 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                  >
                    <div>
                      <span className="font-semibold">
                        Node #{idx + 1}: {nr.skillName} (v{nr.pinnedVersion})
                      </span>
                      <div className="text-stone-400">
                        {nr.executionMode} · Verifier: {nr.verifier}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400">
                      {nr.status === 'verified' ? 'Simulated (Preview)' : nr.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function App() {
  // Primary Navigation & Layout State
  const [activeView, setActiveView] = useState<MainWorkspaceView>(() =>
    readStoredPref<MainWorkspaceView>('activeView_v2', 'chat')
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    readStoredPref<boolean>('sidebarCollapsed', false)
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [uiTheme, setUiTheme] = useState<'dark' | 'light'>(() =>
    readStoredPref<'dark' | 'light'>('uiTheme', 'dark')
  );
  const [artifactDrawerWidthPx, setArtifactDrawerWidthPx] = useState<number>(() =>
    readStoredPref<number>('artifactDrawerWidthPx', 480)
  );
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>('general');
  const [howMuchShouldIAsk, setHowMuchShouldIAsk] = useState<HowMuchShouldIAskPreference>(() =>
    readStoredPref<HowMuchShouldIAskPreference>(
      'howMuchShouldIAsk',
      DEFAULT_HOW_MUCH_SHOULD_I_ASK
    )
  );

  // Command Palette (Ctrl/Cmd+K) & Keyboard Shortcuts Sheet (?)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [commandQuery, setCommandQuery] = useState<string>('');
  const [commandCategory, setCommandCategory] = useState<CommandPaletteCategory | 'all'>('all');
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [isBlaizeWindowClosed, setIsBlaizeWindowClosed] = useState<boolean>(false);
  const [isMorrowExited, setIsMorrowExited] = useState<boolean>(false);

  // Workspace Projects, Artifacts, Reusable Skills, Connectors, Scheduler & IDE State
  const [projects, setProjects] = useState<WorkspaceProject[]>(INITIAL_WORKSPACE_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState<string>(() =>
    readStoredPref<string>('activeProjectId', INITIAL_WORKSPACE_PROJECTS[0].id)
  );
  const activeProject =
    projects.find((p) => p.id === activeProjectId) || projects[0];

  useEffect(() => {
    writeStoredPref('activeView_v2', activeView);
    writeStoredPref('sidebarCollapsed', sidebarCollapsed);
    writeStoredPref('uiTheme', uiTheme);
    writeStoredPref('artifactDrawerWidthPx', artifactDrawerWidthPx);
    writeStoredPref('activeProjectId', activeProjectId);
    writeStoredPref('howMuchShouldIAsk', howMuchShouldIAsk);
  }, [
    activeView,
    sidebarCollapsed,
    uiTheme,
    artifactDrawerWidthPx,
    activeProjectId,
    howMuchShouldIAsk,
  ]);

  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>(INITIAL_WORKSPACE_ARTIFACTS);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(
    INITIAL_WORKSPACE_ARTIFACTS[0].id
  );
  const [chatArtifactDrawerOpen, setChatArtifactDrawerOpen] = useState<boolean>(false);

  const [reusableSkills, setReusableSkills] =
    useState<ReusableSkill[]>(INITIAL_REUSABLE_SKILLS);
  const [soulDocument, setSoulDocument] = useState<SoulDocument>(DEFAULT_SOUL_DOCUMENT);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>(INITIAL_MEMORY_ENTRIES);
  const [skillsSubTab, setSkillsSubTab] = useState<HermesSkillsSubTab>('skills');
  const [crystallizedMsgIds, setCrystallizedMsgIds] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<WorkspaceConnector[]>(
    INITIAL_WORKSPACE_CONNECTORS
  );
  const [workingConnectors, setWorkingConnectors] = useState<ConnectorManifest[]>(
    INITIAL_CONNECTOR_MANIFESTS
  );
  const [scheduledTasks, setScheduledTasks] =
    useState<ScheduledTaskItem[]>(INITIAL_SCHEDULED_TASKS);
  const [everydaySchedules, setEverydaySchedules] = useState<EverydayScheduleItem[]>(
    INITIAL_EVERYDAY_SCHEDULES
  );

  const [ideFiles, setIdeFiles] = useState<IdeFileNode[]>(INITIAL_IDE_FILES);
  const [activeIdeFileId, setActiveIdeFileId] = useState<string>(INITIAL_IDE_FILES[0].id);
  const [vscodeExtensions, setVscodeExtensions] = useState<VSCodeMarketplaceExtension[]>(
    INITIAL_VSCODE_MARKETPLACE_EXTENSIONS
  );

  // Conversation Threads (Normal Chats only — completely separate from Projects)
  const [threads, setThreads] = useState<ConversationThread[]>(INITIAL_THREADS);
  const [activeThreadId, setActiveThreadId] = useState<string>('thread-1');
  const [projectThreads, setProjectThreads] =
    useState<ProjectChatSummary[]>(INITIAL_PROJECT_THREADS);
  const [recentChatsOpen, setRecentChatsOpen] = useState<boolean>(true);
  const [chatSearchQuery, setChatSearchQuery] = useState<string>('');

  const [chatInput, setChatInput] = useState<string>('');
  const [isTypingInComposer, setIsTypingInComposer] = useState<boolean>(false);
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState<boolean>(false);

  // Modular Plugins State (L3xi is a standalone plugin here)
  const [plugins, setPlugins] = useState<ModularPluginItem[]>(INITIAL_MODULAR_PLUGINS);
  const [activeStandalonePluginId, setActiveStandalonePluginId] = useState<string | null>(null);
  const [companionCustomizeOpen, setCompanionCustomizeOpen] = useState<boolean>(false);

  // Rules & Ledger filter state
  const [ruleSearchQuery, setRuleSearchQuery] = useState<string>('');
  const [newRuleText, setNewRuleText] = useState<string>('');
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState<string>('');
  const [expandedLedgerEventIds, setExpandedLedgerEventIds] = useState<string[]>([]);
  const [memorySearchQuery, setMemorySearchQuery] = useState<string>('');
  const [newMemoryFact, setNewMemoryFact] = useState<string>('');
  const [showAdvancedInventory, setShowAdvancedInventory] = useState<boolean>(false);

  // Persistent Memory-Effective Instances
  const ledgerRef = useRef<MemoryLedger | null>(null);
  if (!ledgerRef.current) {
    ledgerRef.current = new MemoryLedger(true);
  }
  const ledger = ledgerRef.current;

  const ringBufferRef = useRef<BoundedRingBuffer<string> | null>(null);
  if (!ringBufferRef.current) {
    const rb = new BoundedRingBuffer<string>(32);
    rb.push('boot: Trust Kernel initialized');
    ringBufferRef.current = rb;
  }
  const ringBuffer = ringBufferRef.current;

  const [ledgerVersion, setLedgerVersion] = useState(0);
  const bumpLedger = () => setLedgerVersion((v) => v + 1);

  const [policyConfig, setPolicyConfig] = useState<PolicyConfig>(DEFAULT_POLICY_CONFIG);
  const [compiledSkill, setCompiledSkill] = useState<CompiledSkill>(DEFAULT_COMPILED_SKILL);
  const [personalityId, setPersonalityId] = useState<PersonalityId>('morrow');

  // Companion & Media State
  const [companionName, setCompanionName] = useState<string>(() =>
    readStoredPref('companion_name', 'Morrow')
  );
  const [isRenamingCompanion, setIsRenamingCompanion] = useState<boolean>(false);
  const [renameCompanionDraft, setRenameCompanionDraft] = useState<string>(() =>
    readStoredPref('companion_name', 'Morrow')
  );
  const [activeLookId, setActiveLookId] = useState<string>('look-sage-emerald');
  const [activeAnimAction, setActiveAnimAction] = useState<MorrowAnimationAction>('idle');
  const [activeLive2DProp, setActiveLive2DProp] = useState<Live2DPropId>('none');
  const [activeLive2DExpression, setActiveLive2DExpression] =
    useState<Live2DExpressionId>('default');
  const [activeLive2DProportion, setActiveLive2DProportion] =
    useState<Live2DProportionMode>('vtuber_full');
  const [compiledPersonality, setCompiledPersonality] = useState<CompiledPersonalityProfile>(() =>
    compileNaturalLanguagePersonality({
      name: readStoredPref('companion_name', 'Morrow'),
      rawDescription:
        'Make her cheerful and teasing but respectful, talk like a clever anime sidekick, be quiet during work, celebrate verified accomplishments, and ask before starting a new task.',
      lookId: 'look-sage-emerald',
      version: 1,
    })
  );
  const [isPlayingMusic, setIsPlayingMusic] = useState<boolean>(false);
  const [activeTrack, setActiveTrack] = useState<MusicTrackItem>(DEFAULT_LOCAL_MUSIC_TRACKS[0]);
  const [danceSyncEnabled, setDanceSyncEnabled] = useState<boolean>(true);

  const initialBundle = useMemo(() => buildMissionForScenario('normal_run', 'morrow'), []);
  const [morrowState, setMorrowState] = useState<MorrowState>('attentive');
  const [talkLogs] = useState<TalkDecisionLog[]>([initialBundle.talkDecision]);
  const [focusMode, setFocusMode] = useState(false);
  const [dismissalCount, setDismissalCount] = useState(0);

  // Approval Card State
  const [pendingApproval, setPendingApproval] = useState<{
    id: string;
    title: string;
    target: string;
    risk: string;
    evidenceHash: string;
    amount?: string;
    reason: string;
    draftId?: string;
  } | null>(null);
  const [approvedDraftIds, setApprovedDraftIds] = useState<string[]>([]);

  const [sleepReport, setSleepReport] = useState<SleepCycleReport>(() =>
    executeSleepCycle(ledger)
  );

  // Detected User Correction -> One-click Save to SOUL.md or Rules
  const [pendingCorrectionSuggestion, setPendingCorrectionSuggestion] = useState<ReturnType<
    typeof detectUserCorrectionForSoulOrRule
  > | null>(null);

  // Unified AgentRuntime, ModelRouter, RuleBook, ReviewQueue, Teach & Replay, Measured Evals
  const persistedInit = useMemo(() => loadPersistedSnapshotSync(), []);
  const agentRuntimeRef = useRef<AgentRuntime | null>(null);
  if (!agentRuntimeRef.current) {
    agentRuntimeRef.current = new AgentRuntime();
  }
  const agentRuntime = agentRuntimeRef.current;

  const modelRouterRef = useRef<ModelRouter | null>(null);
  if (!modelRouterRef.current) {
    modelRouterRef.current = new ModelRouter(persistedInit.modelRouterMode || 'mock');
  }
  const modelRouter = modelRouterRef.current;

  const [modelMode, setModelMode] = useState<ModelRouterMode>(
    persistedInit.modelRouterMode || 'mock'
  );
  const [connectionTestResult, setConnectionTestResult] =
    useState<ModelConnectionTestResult | null>(null);
  const [runtimeStatusChip, setRuntimeStatusChip] = useState<string>('Ready');
  const [ruleBook, setRuleBook] = useState<RuleBookItem[]>(
    persistedInit.rules || INITIAL_RULE_BOOK
  );
  const [secretCodeDigest, setSecretCodeDigest] = useState<SecretCodeDigest | undefined>(
    persistedInit.secretCodeDigest
  );
  const [secretCodeInput, setSecretCodeInput] = useState<string>('');
  const [ruleMutationFeedback, setRuleMutationFeedback] = useState<string | null>(null);
  const [rulesSubTab, setRulesSubTab] = useState<'rules' | 'review_queue'>('rules');
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [stagedIdeDiffs, setStagedIdeDiffs] = useState<IdePatchProposal[]>([]);

  // Prompt 1/4: Sidebar Popover, Voice Toggle, Unified Memory, Soul, Skills, Plugins, Scoped Rules & Review Inbox
  const [openPopoverGroupId, setOpenPopoverGroupId] = useState<
    'library' | 'workbench' | 'automations' | 'proof' | null
  >(null);
  const [popoverAnchorTopPx, setPopoverAnchorTopPx] = useState<number>(140);

  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    const saved = readStoredPref<boolean | null>('morrow_voice_enabled_v1', null);
    if (typeof saved === 'boolean') return saved;
    // Desktop preferences are loaded before React mounts; never resurrect a stale
    // renderer localStorage value when the SQLite record is missing or unreadable.
    if (window.electronAPI?.isElectron) return false;
    try {
      const raw = window.localStorage.getItem(VOICE_ENABLED_STORAGE_KEY);
      return raw ? JSON.parse(raw) === true : false;
    } catch { return false; }
  });
  const voiceControllerRef = useRef<VoiceToggleController | null>(null);
  if (!voiceControllerRef.current) {
    voiceControllerRef.current = new VoiceToggleController(voiceEnabled);
  }
  const handleToggleVoice = () => {
    const snap = voiceControllerRef.current!.toggle();
    setVoiceEnabled(snap.voiceEnabled);
    writeStoredPref('morrow_voice_enabled_v1', snap.voiceEnabled);
    if (!window.electronAPI?.isElectron) {
      try { window.localStorage.setItem(VOICE_ENABLED_STORAGE_KEY, JSON.stringify(snap.voiceEnabled)); }
      catch { /* browser legacy setting is best-effort; preference store remains primary */ }
    }
  };

  const reviewInboxRef = useRef<UnifiedReviewInbox | null>(null);
  if (!reviewInboxRef.current) {
    reviewInboxRef.current = new UnifiedReviewInbox(INITIAL_REVIEW_PROPOSALS);
  }
  const [reviewProposals, setReviewProposals] = useState<ReviewProposalItem[]>(() =>
    reviewInboxRef.current!.getAll()
  );

  const unifiedMemoryStoreRef = useRef<UnifiedMemoryStore | null>(null);
  if (!unifiedMemoryStoreRef.current) {
    unifiedMemoryStoreRef.current = new UnifiedMemoryStore(
      INITIAL_UNIFIED_MEMORY_ITEMS,
      ledger,
      (proposal) => {
        reviewInboxRef.current!.addProposal(proposal);
        setReviewProposals(reviewInboxRef.current!.getAll());
      }
    );
  }
  const [unifiedMemories, setUnifiedMemories] = useState<UnifiedMemoryItem[]>(() =>
    unifiedMemoryStoreRef.current!.getItems()
  );
  const [pauseMemorySaving, setPauseMemorySaving] = useState<boolean>(false);

  // Memory & Cache Purge Notice
  const [memoryPurgeNotice, setMemoryPurgeNotice] = useState<{
    message: string;
    purgedThreadsCount: number;
    purgedArtifactsCount: number;
    timestamp: string;
    archiveId?: string;
  } | null>(null);

  const [memoryPurgePreview, setMemoryPurgePreview] = useState<MemoryPurgePreview | null>(null);
  const [memoryPurgeTarget, setMemoryPurgeTarget] = useState<MemoryPurgeTarget>('all');
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [lastPurgeArchiveId, setLastPurgeArchiveId] = useState<string | null>(null);

  const handleOpenMemoryPurgeModal = (target: MemoryPurgeTarget = memoryPurgeTarget) => {
    const preview = previewMemoryPurge({
      threads,
      activeThreadId,
      artifacts,
      target,
    });
    setMemoryPurgePreview(preview);
    setShowPurgeModal(true);
  };

  const handleConfirmMemoryPurge = () => {
    const result = purgeMemoryAndCache({
      threads,
      activeThreadId,
      artifacts,
      target: memoryPurgeTarget,
      confirmed: true,
      createRecoveryArchive: true,
    });

    setThreads(result.remainingThreads as ConversationThread[]);
    setActiveThreadId(result.newActiveThreadId);
    setArtifacts(result.remainingArtifacts);
    setShowPurgeModal(false);
    if (result.archiveId) {
      setLastPurgeArchiveId(result.archiveId);
    }

    const notice = {
      message: result.summary,
      purgedThreadsCount: result.purgedThreadsCount,
      purgedArtifactsCount: result.purgedArtifactsCount,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      archiveId: result.archiveId,
    };
    setMemoryPurgeNotice(notice);

    if (result.deletionVerified) {
      ledger.appendEvent({
        actor: 'operator',
        type: 'memory_purge_executed',
        summary: `Memory Purge Verified: ${result.summary}`,
        payload: JSON.stringify({
          purgedThreadsCount: result.purgedThreadsCount,
          purgedArtifactsCount: result.purgedArtifactsCount,
          archiveId: result.archiveId,
          target: memoryPurgeTarget,
          deletionVerified: true,
        }),
        trustLevel: 'verified_by_evidence',
        missionId: 'settings-privacy',
      });
      bumpLedger();
    }
  };

  const handleRestoreMemoryPurge = () => {
    if (!lastPurgeArchiveId) return;
    const restored = restoreFromMemoryPurgeArchive(lastPurgeArchiveId, threads);
    if (restored.success) {
      setThreads(restored.restoredThreads as ConversationThread[]);
      setLastPurgeArchiveId(null);
      setMemoryPurgeNotice({
        message: `Restored ${restored.restoredThreadsCount} thread(s) from recovery archive.`,
        purgedThreadsCount: 0,
        purgedArtifactsCount: 0,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      ledger.appendEvent({
        actor: 'operator',
        type: 'memory_purge_restored',
        summary: `Restored ${restored.restoredThreadsCount} threads from backup archive`,
        payload: JSON.stringify({ archiveId: lastPurgeArchiveId, restoredCount: restored.restoredThreadsCount }),
        trustLevel: 'verified_by_evidence',
        missionId: 'settings-privacy',
      });
      bumpLedger();
    }
  };

  const handleMemoryPurge = () => {
    handleOpenMemoryPurgeModal('all');
  };

  const [soulProfile, setSoulProfile] = useState<SoulProfileConfig>(() => ({
    ...DEFAULT_SOUL_PROFILE_CONFIG,
    identity: {
      ...DEFAULT_SOUL_PROFILE_CONFIG.identity,
      name: readStoredPref('companion_name', DEFAULT_SOUL_PROFILE_CONFIG.identity.name),
    },
  }));
  const [unifiedSkills, setUnifiedSkills] = useState<UnifiedSkillItem[]>(
    INITIAL_UNIFIED_SKILLS
  );
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginRecord[]>(
    INITIAL_INSTALLED_PLUGINS
  );
  const [scopedRules, setScopedRules] = useState<ScopedRuleItem[]>(INITIAL_SCOPED_RULES);
  const [userPlaces, setUserPlaces] = useState<PlaceRule[]>(INITIAL_USER_PLACES);
  const [indexedPlaceFiles, setIndexedPlaceFiles] =
    useState<IndexedFileMetadata[]>(INITIAL_INDEXED_FILES);

  // Prompt 2/4: General Projects (for any user), Universal Artifacts (SQLite on desktop; IndexedDB in preview), & General Evaluations
  const [generalProjects, setGeneralProjects] = useState<GeneralProject[]>(
    INITIAL_GENERAL_PROJECTS
  );
  const [activeGeneralProjectId, setActiveGeneralProjectId] = useState<string>(
    INITIAL_GENERAL_PROJECTS[0].id
  );
  const activeGeneralProject =
    generalProjects.find((p) => p.id === activeGeneralProjectId) || generalProjects[0];

  const universalArtifactStoreRef = useRef<UniversalArtifactStore | null>(null);
  if (!universalArtifactStoreRef.current) {
    const bootArtifacts = Array.isArray(window.__BLAIZE_BOOTSTRAP_ARTIFACTS__)
      ? window.__BLAIZE_BOOTSTRAP_ARTIFACTS__ as UniversalArtifact[]
      : INITIAL_UNIVERSAL_ARTIFACTS;
    universalArtifactStoreRef.current = new UniversalArtifactStore(bootArtifacts);
  }
  const [universalArtifacts, setUniversalArtifacts] = useState<UniversalArtifact[]>(() =>
    universalArtifactStoreRef.current!.getAll()
  );

  const generalEvalRunnerRef = useRef<GeneralEvaluationRunner | null>(null);
  if (!generalEvalRunnerRef.current) {
    const runner = new GeneralEvaluationRunner();
    runner.runChecks({
      targets: INITIAL_INSTALLED_PLUGINS.map(pluginToEvaluableManifest),
      selectedTargetId: 'all',
      mode: 'mock',
    });
    generalEvalRunnerRef.current = runner;
  }
  const [generalEvalRuns, setGeneralEvalRuns] = useState<GeneralEvaluationRunRecord[]>(() =>
    generalEvalRunnerRef.current!.getHistory()
  );

  // Teach & Replay state (Domain-neutral documentation & citation check)
  const [compiledDemoSkill] = useState<CompiledDemonstrationSkill>(() =>
    compileTeachDemonstrationToSkill({
      title: 'Documentation Citation & Checksum Verification',
      events: [
        {
          stepIndex: 1,
          kind: 'navigate',
          selectorOrUrl: 'https://docs.workspace.local/architecture/consensus-notes',
          intentLabel: 'Open project documentation page',
          narration: 'Open local documentation page for citation check',
          expectedPostCondition: 'URL contains architecture/consensus-notes',
        },
        {
          stepIndex: 2,
          kind: 'type',
          selectorOrUrl: 'input[type="password"]#api-token',
          intentLabel: 'Token field (Excluded by Privacy Shield)',
          narration: 'Never record credentials',
          isCredentialField: true,
          expectedPostCondition: 'Excluded from skill',
        },
        {
          stepIndex: 3,
          kind: 'extract',
          selectorOrUrl: 'article[role="main"]',
          intentLabel: 'Extract 4 primary citation anchors',
          narration: 'Extract citation anchors and verify SHA-256 checksums',
          expectedPostCondition: '4 citation anchors verified',
        },
      ],
    })
  );
  const [lastReplayResult, setLastReplayResult] = useState<ReturnType<
    typeof replayCompiledSkillByIntent
  > | null>(null);

  // Measured Evaluation Suite state
  const [measuredEvalReport, setMeasuredEvalReport] =
    useState<MeasuredEvaluationReport | null>(null);
  const [isRunningEval, setIsRunningEval] = useState<boolean>(false);

  // Onboarding starts open if fresh install (onboardingCompleted: false), unless ?autostart=1 is passed
  const [onboardingModalOpen, setOnboardingModalOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('autostart=1')) {
      return false;
    }
    return !persistedInit.onboardingCompleted;
  });
  const [onboardingPinInput, setOnboardingPinInput] = useState<string>('');
  const [biometricSimulated, setBiometricSimulated] = useState<boolean>(
    persistedInit.biometricSimulatedEnabled
  );
  const [suggestionsEnabled, setSuggestionsEnabled] = useState<boolean>(
    persistedInit.suggestionsEnabled
  );
  const [usageSuggestions, setUsageSuggestions] = useState<UsageSuggestionItem[]>(
    INITIAL_USAGE_SUGGESTIONS
  );
  const [helpSearchQuery, setHelpSearchQuery] = useState<string>('');
  const [desktopAppGrants, setDesktopAppGrants] = useState<DesktopAppGrant[]>(
    INITIAL_DESKTOP_APP_GRANTS
  );

  // Character Studio, First-Run Briefing, USER.md, and Hermes Profile state
  const characterHistoryRef = useRef<CharacterHistoryStack | null>(null);
  if (!characterHistoryRef.current) {
    characterHistoryRef.current = new CharacterHistoryStack(DEFAULT_CHARACTER_PARAMETRIC_STATE);
  }
  const [characterParametricState, setCharacterParametricState] =
    useState<CharacterParametricState>(() => characterHistoryRef.current!.getState());
  const [canUndoCharacter, setCanUndoCharacter] = useState<boolean>(false);

  const [selectedRoleTemplates, setSelectedRoleTemplates] = useState<RoleTemplateId[]>([
    'work',
    'home',
  ]);
  const [standingJobDescription, setStandingJobDescription] = useState<string>(
    'Summarize repositories, verify citations, organize local files, and prepare weekly reports on this PC.'
  );
  const [standingOffLimits, setStandingOffLimits] = useState<string>(
    'Never execute money transfers, delete personal files without approval, or read password vaults.'
  );
  const [standingRoleSummaryCard, setStandingRoleSummaryCard] = useState<string>(
    () =>
      generateBriefingArtifacts({
        companionName: readStoredPref('companion_name', 'Morrow'),
        selectedTemplates: ['work', 'home'],
        jobDescription:
          'Summarize repositories, verify citations, organize local files, and prepare weekly reports on this PC.',
        allowedDevices: ['This PC (Local)'],
        offLimits:
          'Never execute money transfers, delete personal files without approval, or read password vaults.',
      }).spokenSummaryCard
  );
  const [userMarkdown, setUserMarkdown] = useState<string>(
    () =>
      generateBriefingArtifacts({
        companionName: readStoredPref('companion_name', 'Morrow'),
        selectedTemplates: ['work', 'home'],
        jobDescription:
          'Summarize repositories, verify citations, organize local files, and prepare weekly reports on this PC.',
        allowedDevices: ['This PC (Local)'],
        offLimits:
          'Never execute money transfers, delete personal files without approval, or read password vaults.',
      }).userMarkdown
  );
  const [activeProfileId, setActiveProfileId] = useState<WorkspaceProfileId>('personal');
  const [hermesInitialTab, setHermesInitialTab] = useState<UniversalHermesSubTab>('apps');
  const [showSoulRawMarkdown, setShowSoulRawMarkdown] = useState<boolean>(false);

  // Unified companion rename handler that propagates the assistant's name everywhere in the app
  const handleRenameCompanion = (rawName: string) => {
    const trimmed = rawName.trim();
    const nextName = trimmed.length > 0 ? trimmed : 'Morrow';
    const prevName = companionName || 'Morrow';
    setCompanionName(nextName);
    setRenameCompanionDraft(nextName);
    writeStoredPref('companion_name', nextName);
    setSoulProfile((prev) => ({
      ...prev,
      identity: {
        ...prev.identity,
        name: nextName,
      },
    }));
    setCompiledPersonality((prev) => ({
      ...prev,
      name: nextName,
    }));
    setStandingRoleSummaryCard((prev) =>
      prev.replace(new RegExp(`\\b${prevName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), nextName)
    );
    setUserMarkdown((prev) =>
      prev.replace(new RegExp(`\\b${prevName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), nextName)
    );
    setSoulDocument((prev) => {
      const updatedRaw = prev.rawMarkdown
        .replace(new RegExp(`\\b${prevName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), nextName)
        .replace(/\bMorrow\b/g, nextName);
      return parseAndValidateSoulDocument(updatedRaw, prev.voiceCadence, prev.version + 1);
    });
  };

  // Screen-Aware Record Button, Skill Recorder & Multi-Skill Planner State
  const [screenAwarenessMode, setScreenAwarenessMode] = useState<ScreenAwarenessMode>('off');
  const [recorderSourceType, setRecorderSourceType] = useState<RecorderSourceType>('in_app');
  const [isRecordingSkill, setIsRecordingSkill] = useState<boolean>(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState<boolean>(false);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState<number>(0);
  const [autoPauseReason, setAutoPauseReason] = useState<string | null>(null);
  const [consentSheetOpen, setConsentSheetOpen] = useState<boolean>(false);
  const [consentRetention, setConsentRetention] = useState<
    'delete_after_compile' | 'keep_24h' | 'keep_until_deleted'
  >('delete_after_compile');
  const [blockedAppCategories, setBlockedAppCategories] = useState<string[]>(
    DEFAULT_BLOCKED_APP_CATEGORIES
  );
  const [newBlockedCategoryInput, setNewBlockedCategoryInput] = useState<string>('');
  const [askScreenPreviewModalOpen, setAskScreenPreviewModalOpen] = useState<boolean>(false);
  const [pendingAskScreenPrompt, setPendingAskScreenPrompt] = useState<string>('');
  const [showSkillRecorderStudio, setShowSkillRecorderStudio] = useState(false);
  const [recordedSkills, setRecordedSkills] = useState<DraftRecordedSkill[]>(() =>
    Array.isArray(window.__BLAIZE_BOOTSTRAP_RECORDED_SKILLS__)
      ? (window.__BLAIZE_BOOTSTRAP_RECORDED_SKILLS__ as DraftRecordedSkill[])
      : buildDefaultDomainNeutralRecordedSkills()
  );
  const [activeRecordingSession, setActiveRecordingSession] = useState<RecordingSession | null>(
    (window.__BLAIZE_BOOTSTRAP_ACTIVE_RECORDING__ as RecordingSession | null) || null
  );
  const screenCaptureRef = useRef<ScreenCaptureSource | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    if (activeRecordingSession?.endedAt) {
      void Promise.all([
        window.electronAPI.storage.putRecord('recorder_sessions', {
          id: activeRecordingSession.id, collection: 'recorder_sessions', data: { session: activeRecordingSession },
          createdAt: Date.parse(activeRecordingSession.startedAt) || Date.now(), updatedAt: Date.now(),
        }),
        window.electronAPI.storage.deleteRecord('recorder_sessions', 'active'),
      ]).catch((error) => console.error('Unable to archive recording session in SQLite.', error));
    } else if (activeRecordingSession) {
      void window.electronAPI.storage.putRecord('recorder_sessions', {
        id: 'active', collection: 'recorder_sessions', data: { session: activeRecordingSession },
        createdAt: Date.parse(activeRecordingSession.startedAt) || Date.now(), updatedAt: Date.now(),
      }).catch((error) => console.error('Unable to persist recording session in SQLite.', error));
    } else {
      void window.electronAPI.storage.deleteRecord('recorder_sessions', 'active').catch(() => undefined);
    }
  }, [activeRecordingSession]);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    void window.electronAPI.storage.putRecord('recorder_skills', {
      id: 'current', collection: 'recorder_skills', data: { skills: recordedSkills },
      createdAt: Date.now(), updatedAt: Date.now(),
    }).catch((error) => console.error('Unable to persist recorded skills in SQLite.', error));
  }, [recordedSkills]);

  // Timer for active skill recording
  useEffect(() => {
    if (!isRecordingSkill || isRecordingPaused) return;
    const interval = window.setInterval(() => {
      setRecordingElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isRecordingSkill, isRecordingPaused]);

  const handleStartRecordingAfterConsent = async () => {
    let privacyNotice: string | null = null;
    const newSession: RecordingSession = {
      id: `rec_${Date.now()}`,
      startedAt: new Date().toISOString(),
      sourceType: recorderSourceType,
      sourceLabel: recorderSourceType === 'screen'
        ? 'Selected display video + keyframes'
        : recorderSourceType === 'in_app' ? 'In-app events' : 'Selected display (native system picker)',
      retentionPolicy: consentRetention,
      encryptedLocal: false,
      keyframes: [], mediaSegments: [], events: [], narration: [], autoPausedCount: 0,
      blockedCategories: blockedAppCategories,
      userApprovedKeyframesForCompile: false,
    };

    if (recorderSourceType === 'screen' || recorderSourceType === 'native_stub') {
      const consent: RecorderConsentRecord = {
        consentId: newSession.id,
        grantedAtIso: new Date().toISOString(),
        selectedSource: 'screen_capture',
        retentionPolicy: consentRetention,
        credentialAutoPauseEnabled: true,
        blockedAppCategories,
        narrationMode: 'off',
      };
      const capture = new ScreenCaptureSource(undefined, undefined, (meta) => {
        const keyframe: RecordedKeyframe = {
          id: meta.id, timestamp: meta.timestampMs, sourceType: recorderSourceType,
          width: meta.width, height: meta.height, jpegQuality: 0.66,
          diffScore: meta.pixelDiffPct, sha256Hash: meta.blobHash || meta.sha256Hash,
          indexedDbKey: meta.id, blobHash: meta.blobHash, storageBackend: meta.storageBackend,
          blurRegions: meta.blurRegions, annotation: meta.caption, inferredFromPixelsOnly: true,
        };
        setActiveRecordingSession((previous) => previous ? { ...previous, keyframes: [...previous.keyframes, keyframe] } : previous);
      }, () => {
        screenCaptureRef.current = null;
        setIsRecordingSkill(false);
        setIsRecordingPaused(false);
        setScreenAwarenessMode('off');
        setActiveRecordingSession((previous) => previous && !previous.endedAt
          ? { ...previous, endedAt: new Date().toISOString() }
          : previous);
        setShowSkillRecorderStudio(true);
        setActiveView('skills');
        setAutoPauseReason('The selected display stopped sharing. Blaize finalized the video and keyframe timeline.');
      }, (segment: RecordedMediaSegmentMeta) => {
        setActiveRecordingSession((previous) => previous ? {
          ...previous, mediaSegments: [...(previous.mediaSegments || []), segment],
        } : previous);
      }, (message: string) => {
        setIsRecordingPaused(true);
        setAutoPauseReason(message);
      }, (privacyState) => {
        if (privacyState.mode === 'clear') {
          setAutoPauseReason(null);
        } else {
          const detail = privacyState.mode === 'blur_all'
            ? 'Privacy Shield is blurring the entire recording because native detection is uncertain.'
            : `Privacy Shield blurred ${privacyState.regions.length} sensitive area(s) in the saved video and keyframes.`;
          setAutoPauseReason(detail);
        }
      });
      screenCaptureRef.current = capture;
      const captureStatus = await capture.start(consent);
      if (!captureStatus.active) {
        screenCaptureRef.current = null;
        window.alert(captureStatus.blockExplanation || captureStatus.fallbackSuggestion || 'Screen capture could not be started. No recording session was created.');
        return;
      }
      if (captureStatus.privacyMode && captureStatus.privacyMode !== 'clear') {
        privacyNotice = captureStatus.privacyExplanation || 'Privacy Shield is blurring the recording until it can confirm a safe desktop state.';
      }
      if (!captureStatus.videoRecordingActive) {
        screenCaptureRef.current = null;
        await capture.stop();
        window.alert(captureStatus.mediaRecordingError || 'Continuous video capture could not be started. No recording session was created.');
        return;
      }
    }

    setActiveRecordingSession(newSession);
    setConsentSheetOpen(false);
    setScreenAwarenessMode('recording');
    setIsRecordingSkill(true);
    setIsRecordingPaused(false);
    setRecordingElapsedSec(0);
    setAutoPauseReason(privacyNotice);
    setMorrowState('attentive');
    ledger.appendEvent({
      actor: 'user', type: 'recording_started',
      summary: `Started skill recording (${newSession.sourceLabel}) with retention: ${consentRetention}.`,
      payload: JSON.stringify({ sessionId: newSession.id, sourceType: recorderSourceType, retentionPolicy: consentRetention }),
      trustLevel: 'user_stated', missionId: newSession.id,
    });
    bumpLedger();
  };

  const handlePauseResumeRecording = () => {
    if (!isRecordingSkill) return;
    const next = !isRecordingPaused;
    const status = next
      ? screenCaptureRef.current?.pause()
      : screenCaptureRef.current?.resume();
    const actuallyPaused = status?.paused ?? next;
    setIsRecordingPaused(actuallyPaused);
    if (!actuallyPaused) setAutoPauseReason(null);
    else if (status?.mediaRecordingError) setAutoPauseReason(status.mediaRecordingError);
  };

  const handleStopAndReviewRecording = async () => {
    const capture = screenCaptureRef.current;
    if (capture) {
      const finalStatus = await capture.stop();
      if (finalStatus.mediaRecordingError) setAutoPauseReason(finalStatus.mediaRecordingError);
    }
    screenCaptureRef.current = null;
    setIsRecordingSkill(false);
    setIsRecordingPaused(false);
    setScreenAwarenessMode('off');
    setActiveRecordingSession((prev) =>
      prev ? { ...prev, endedAt: prev.endedAt || new Date().toISOString() } : prev
    );
    setShowSkillRecorderStudio(true);
    setActiveView('skills');
    ledger.appendEvent({
      actor: 'user',
      type: 'recording_stopped',
      summary: 'Stopped skill recording and finalized its local video and keyframe review timeline.',
      payload: JSON.stringify({
        sessionId: activeRecordingSession?.id,
        elapsedSec: recordingElapsedSec,
      }),
      trustLevel: 'user_stated',
      missionId: activeRecordingSession?.id || 'skill-recorder',
    });
    bumpLedger();
  };

  const handleRecordStageEvent = (
    eventInput: Omit<RecordedInteractionEvent, 'id' | 'timestamp'>
  ) => {
    if (!isRecordingSkill || isRecordingPaused) return;
    const protection = evaluateCredentialAndAppProtection({
      urlOrApp: eventInput.urlOrApp,
      inputType: eventInput.isCredentialField ? 'password' : 'text',
      fieldName: eventInput.accessibleName,
      blockedCategories: blockedAppCategories,
    });
    if (protection.shouldAutoPause) {
      setIsRecordingPaused(true);
      setAutoPauseReason(
        protection.reason || 'Credential field detected — auto-paused recording.'
      );
    }
    const createdEvent: RecordedInteractionEvent = {
      ...eventInput,
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      isCredentialField: Boolean(eventInput.isCredentialField || protection.isSecretField),
      value: protection.shouldAutoPause ? '{{SECRET_REDACTED}}' : eventInput.value,
    };
    setActiveRecordingSession((prev) => {
      const base: RecordingSession = prev || {
        id: `rec_${Date.now()}`,
        startedAt: new Date().toISOString(),
        sourceType: recorderSourceType,
        sourceLabel: 'In-app events',
        retentionPolicy: consentRetention,
        encryptedLocal: false,
        keyframes: [],
        events: [],
        narration: [],
        autoPausedCount: 0,
        blockedCategories: blockedAppCategories,
        userApprovedKeyframesForCompile: false,
      };
      return {
        ...base,
        autoPausedCount: protection.shouldAutoPause
          ? base.autoPausedCount + 1
          : base.autoPausedCount,
        events: [...base.events, createdEvent],
      };
    });
  };

  const handleAddManualKeyframe = async (
    label: string,
    dataUrl?: string,
    pixelInferred = false
  ) => {
    if (recorderSourceType !== 'in_app' && dataUrl) {
      setAutoPauseReason('Desktop keyframes must come from the Privacy Shield compositor. Unfiltered image uploads are not accepted into a desktop recording.');
      return;
    }
    if (!dataUrl && screenCaptureRef.current) {
      const saved = await screenCaptureRef.current.captureCheckpoint(label);
      if (!saved) setAutoPauseReason(screenCaptureRef.current.getStatus().blockExplanation || 'The live display frame is not ready yet. Try the checkpoint again after the screen is shared.');
      return;
    }
    if (!dataUrl) {
      setAutoPauseReason('No real screenshot was supplied. Blaize does not create placeholder frames for a recording.');
      return;
    }
    const frameId = `kf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const frame: RecordedKeyframe = {
      id: frameId, timestamp: Date.now(), sourceType: recorderSourceType,
      width: 640, height: 360, jpegQuality: 0.72, diffScore: 14.8,
      sha256Hash: computeDeterministicHash(`${frameId}|${label}`),
      indexedDbKey: frameId, blurRegions: [], annotation: label,
      inferredFromPixelsOnly: pixelInferred,
    };
    try {
      const saved = await saveKeyframeToIndexedDb({
        id: frame.id,
        timestampMs: frame.timestamp,
        elapsedSeconds: Math.max(0, Math.floor((frame.timestamp - (Date.parse(activeRecordingSession?.startedAt || '') || frame.timestamp)) / 1000)),
        width: frame.width,
        height: frame.height,
        mimeType: 'image/jpeg',
        byteSize: 0,
        sha256Hash: frame.sha256Hash,
        pixelDiffPct: frame.diffScore,
        sourceKind: recorderSourceType === 'in_app' ? 'in_app' : 'screen_capture',
        caption: label,
        blurRegions: frame.blurRegions,
        approvedForCompile: true,
        storedInIndexedDb: false,
      }, dataUrl);
      frame.sha256Hash = saved.blobHash || saved.sha256Hash;
      frame.blobHash = saved.blobHash;
      frame.indexedDbKey = saved.id;
      frame.storageBackend = saved.storageBackend;
      setActiveRecordingSession((prev) => {
        const base = prev || {
          id: `rec_${Date.now()}`, startedAt: new Date().toISOString(), sourceType: recorderSourceType,
          sourceLabel: recorderSourceType === 'in_app' ? 'In-app events' : 'Selected display video + keyframes',
          retentionPolicy: consentRetention, encryptedLocal: false, keyframes: [], events: [], narration: [],
          autoPausedCount: 0, blockedCategories: blockedAppCategories, userApprovedKeyframesForCompile: false,
        };
        return { ...base, keyframes: [...base.keyframes, frame] };
      });
    } catch (error: any) {
      setAutoPauseReason(`Keyframe was not saved: ${error?.message || 'persistent storage failed'}`);
    }
  };

  useEffect(() => {
    const unsub = globalRuntimeEventBus.subscribe((ev) => {
      setRuntimeStatusChip(ev.statusChipLabel);
      if (ev.morrowEvent === 'awaiting_approval') {
        setMorrowState('asking_approval');
        setActiveAnimAction('waiting_approval');
      } else if (ev.morrowEvent === 'done_verified') {
        setMorrowState('done_with_proof');
        setActiveAnimAction('sit');
      } else if (ev.morrowEvent === 'tool_running' || ev.morrowEvent === 'verifying') {
        setMorrowState('working');
        setActiveAnimAction('work_type');
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    runMeasuredEvaluationSuite().then((rep) => setMeasuredEvalReport(rep));
  }, []);

  const activeThread = threads.find((t) => t.id === activeThreadId) || threads[0];
  const activeChatProject = useMemo(
    () =>
      activeThread.projectId
        ? generalProjects.find((p) => p.id === activeThread.projectId) || null
        : null,
    [activeThread.projectId, generalProjects]
  );
  const activeChatProjectArtifacts = useMemo(
    () =>
      activeChatProject
        ? universalArtifacts.filter((a) => a.projectId === activeChatProject.id)
        : [],
    [activeChatProject, universalArtifacts]
  );
  const syncedProjectChatSummaries: ProjectChatSummary[] = useMemo(() => {
    const fromThreads: ProjectChatSummary[] = threads
      .filter((t) => Boolean(t.projectId))
      .map((t) => ({
        id: t.id,
        projectId: t.projectId!,
        title: t.title,
        updatedAt: t.updatedAt,
        lastMessagePreview:
          t.messages[t.messages.length - 1]?.content ||
          'Chat scoped to this project’s instructions and knowledge.',
        messages: t.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
      }));
    const threadIds = new Set(fromThreads.map((item) => item.id));
    const extras = projectThreads.filter((pt) => !threadIds.has(pt.id));
    return [...fromThreads, ...extras];
  }, [threads, projectThreads]);

  const enabledChatPlugins = plugins.filter((p) => p.enabledInChat);

  const filteredThreads = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    const list = q
      ? threads.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.messages.some((m) => m.content.toLowerCase().includes(q))
        )
      : threads;
    return [...list].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [threads, chatSearchQuery]);

  // Global keyboard shortcuts: Ctrl/Cmd+K -> Command Palette, ? -> Shortcuts sheet
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean((e.target as HTMLElement | null)?.isContentEditable);

      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (isRecordingSkill) {
          handlePauseResumeRecording();
        } else {
          setConsentSheetOpen(true);
        }
        return;
      }

      if (!isEditable && e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setOpenPopoverGroupId(null);
        setCommandPaletteOpen(false);
        setShortcutsOpen(false);
        setToolsMenuOpen(false);
        setConsentSheetOpen(false);
        setAskScreenPreviewModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRecordingSkill]);

  // Build Command Palette Catalog across all Hub pages, chats, skills, plugins, rules, settings, and help
  const commandPaletteCatalog: CommandPaletteItem[] = useMemo(() => {
    const pageItems: CommandPaletteItem[] = [
      {
        id: 'nav-chat',
        title: 'Chat',
        subtitle: 'Navigation · Open main conversation',
        category: 'chat',
        keywords: ['conversation', 'prompt', 'home'],
        targetView: 'chat',
      },
      {
        id: 'nav-projects',
        title: 'Projects',
        subtitle: 'Navigation · Projects and artifacts',
        category: 'setting',
        keywords: ['projects', 'artifacts', 'files'],
        targetView: 'projects',
      },
      {
        id: 'nav-skills',
        title: 'Library > Skills',
        subtitle: 'Library · Reusable procedures',
        category: 'skill',
        keywords: ['skills', 'record', 'describe', 'library'],
        targetView: 'skills',
      },
      {
        id: 'nav-plugins',
        title: 'Library > Plugins',
        subtitle: 'Library · Installed extensions',
        category: 'plugin',
        keywords: ['plugins', 'import', 'template', 'library'],
        targetView: 'plugins',
      },
      {
        id: 'nav-connectors',
        title: 'Library > Connectors',
        subtitle: 'Library · External tool bridges',
        category: 'setting',
        keywords: ['connectors', 'github', 'telegram', 'library'],
        targetView: 'connectors',
      },
      {
        id: 'nav-soul',
        title: 'Library > Soul',
        subtitle: 'Library · Identity and voice style',
        category: 'setting',
        keywords: ['soul', 'personality', 'voice', 'template', 'library'],
        targetView: 'soul',
      },
      {
        id: 'nav-rules',
        title: 'Library > Rules',
        subtitle: 'Library · Scoped safety rules',
        category: 'rule',
        keywords: ['rules', 'scope', 'everywhere', 'plugin', 'connector', 'library'],
        targetView: 'rules',
      },
      {
        id: 'nav-memory',
        title: 'Library > Memory',
        subtitle: 'Library · Saved facts and preferences',
        category: 'setting',
        keywords: ['memory', 'facts', 'preferences', 'export', 'library'],
        targetView: 'memory',
      },
      {
        id: 'nav-places',
        title: 'Library > Places',
        subtitle: 'Library · File Map, folder meanings & Never-Go zones',
        category: 'setting',
        keywords: ['places', 'folders', 'file map', 'never go', 'library'],
        targetView: 'places',
      },
      {
        id: 'nav-browser',
        title: 'Workbench > AI Browser',
        subtitle: 'Workbench · Isolated web sessions',
        category: 'setting',
        keywords: ['browser', 'web', 'workbench'],
        targetView: 'browser',
      },
      {
        id: 'nav-ide',
        title: 'Workbench > Code Editor',
        subtitle: 'Workbench · Workspace code files',
        category: 'setting',
        keywords: ['code', 'editor', 'ide', 'workbench'],
        targetView: 'ide',
      },
      {
        id: 'nav-scheduler',
        title: 'Automations > Scheduler',
        subtitle: 'Automations · Timed recurring runs',
        category: 'setting',
        keywords: ['scheduler', 'cron', 'automations'],
        targetView: 'scheduler',
      },
      {
        id: 'nav-review',
        title: 'Proof > Review',
        subtitle: 'Proof · Pending approval inbox',
        category: 'rule',
        keywords: ['review', 'inbox', 'approve', 'reject', 'proof'],
        targetView: 'review',
      },
      {
        id: 'nav-evaluations',
        title: 'Proof > Evaluations',
        subtitle: 'Proof · Measured test suites',
        category: 'setting',
        keywords: ['evaluations', 'evals', 'metrics', 'proof'],
        targetView: 'evaluations',
      },
      {
        id: 'nav-activity',
        title: 'Proof > Activity',
        subtitle: 'Proof · Verified action ledger',
        category: 'setting',
        keywords: ['activity', 'ledger', 'receipts', 'proof'],
        targetView: 'activity',
      },
    ];

    const chatItems: CommandPaletteItem[] = threads.map((t) => ({
      id: `chat-${t.id}`,
      title: t.title,
      subtitle: `Chat · ${t.updatedAt}`,
      category: 'chat',
      keywords: ['conversation', 'message'],
      targetView: 'chat',
      targetSection: t.id,
    }));

    const skillItems: CommandPaletteItem[] = unifiedSkills.map((s) => ({
      id: `skill-${s.id}`,
      title: s.name,
      subtitle: `Library > Skills · v${s.version}`,
      category: 'skill',
      keywords: [s.oneLineDescription, s.origin],
      targetView: 'skills',
    }));

    const pluginItems: CommandPaletteItem[] = installedPlugins.map((p) => ({
      id: `plugin-${p.id}`,
      title: p.name,
      subtitle: `Library > Plugins · ${p.permissionsSummary}`,
      category: 'plugin',
      keywords: [p.permissionsSummary],
      targetView: 'plugins',
      targetSection: p.id,
    }));

    const ruleItems: CommandPaletteItem[] = scopedRules.map((r) => ({
      id: `rule-${r.id}`,
      title: r.text,
      subtitle: `Library > Rules · Scope: ${r.scope}`,
      category: 'rule',
      keywords: ['policy', 'safety', 'approval', r.scope.toLowerCase()],
      targetView: 'rules',
    }));

    const settingItems: CommandPaletteItem[] = [
      {
        id: 'setting-general',
        title: 'General settings',
        subtitle: 'Settings · Theme, default project, reduced motion',
        category: 'setting',
        keywords: ['theme', 'dark', 'light'],
        targetView: 'settings',
        targetSection: 'general',
      },
      {
        id: 'setting-morrow',
        title: `${companionName} companion settings`,
        subtitle: 'Settings · Name, size, outfit, perches, idle preferences',
        category: 'setting',
        keywords: ['companion', 'perch', 'sit', 'sleep', 'size', companionName.toLowerCase()],
        targetView: 'settings',
        targetSection: 'morrow',
      },
      {
        id: 'setting-soul',
        title: 'Soul and personality',
        subtitle: 'Settings · Identity, voice style & personality template',
        category: 'setting',
        keywords: ['soul', 'personality', 'voice'],
        targetView: 'settings',
        targetSection: 'soul',
      },
      {
        id: 'setting-rules',
        title: 'Standing safety rules',
        subtitle: 'Settings · Scoped Rule Book & enforcement',
        category: 'setting',
        keywords: ['rules', 'approval', 'safety'],
        targetView: 'settings',
        targetSection: 'rules',
      },
      {
        id: 'setting-models',
        title: 'Models & routing',
        subtitle: 'Settings · Model status (Simulated in preview)',
        category: 'setting',
        keywords: ['llm', 'router', 'simulated'],
        targetView: 'settings',
        targetSection: 'models',
      },
      {
        id: 'setting-voice',
        title: 'Voice and identity',
        subtitle: 'Settings · Microphone, speech & audio ducking',
        category: 'setting',
        keywords: ['mic', 'speech', 'audio'],
        targetView: 'settings',
        targetSection: 'voice',
      },
      {
        id: 'setting-privacy',
        title: 'Privacy & persistence',
        subtitle: 'Settings · Right-to-delete & browser isolation',
        category: 'setting',
        keywords: ['privacy', 'redact', 'delete'],
        targetView: 'settings',
        targetSection: 'privacy',
      },
      {
        id: 'setting-advanced',
        title: 'Advanced & runtime details',
        subtitle: 'Settings · Platform adapter & subsystem diagnostics',
        category: 'setting',
        keywords: ['adapter', 'diagnostics'],
        targetView: 'settings',
        targetSection: 'advanced',
      },
    ];

    const helpItems: CommandPaletteItem[] = [
      {
        id: 'help-shortcuts',
        title: 'Keyboard shortcuts',
        subtitle: 'Help · View Ctrl/Cmd+K, Alt+M, Alt+H, and ? hotkeys',
        category: 'help',
        keywords: ['keys', 'hotkeys', 'shortcuts'],
        shortcut: '?',
      },
      {
        id: 'help-perch',
        title: 'How Morrow perches work',
        subtitle: 'Help · Drag Morrow between composer top, panel edge, sidebar, or floor',
        category: 'help',
        keywords: ['morrow', 'drag', 'perch', 'composer'],
        targetView: 'chat',
      },
    ];

    return [
      ...pageItems,
      ...chatItems,
      ...skillItems,
      ...pluginItems,
      ...ruleItems,
      ...settingItems,
      ...helpItems,
    ];
  }, [threads, unifiedSkills, installedPlugins, scopedRules]);

  const commandPaletteResults = useMemo(
    () => searchCommandPalette(commandPaletteCatalog, commandQuery, commandCategory),
    [commandPaletteCatalog, commandQuery, commandCategory]
  );

  const handleSelectCommandItem = (item: CommandPaletteItem) => {
    setCommandPaletteOpen(false);
    setCommandQuery('');
    if (item.id === 'help-shortcuts') {
      setShortcutsOpen(true);
      return;
    }
    if (item.category === 'chat' && item.targetSection) {
      setActiveThreadId(item.targetSection);
      setActiveView('chat');
      return;
    }
    if (item.category === 'plugin' && item.targetSection) {
      setActiveView('plugins');
      return;
    }
    if (item.category === 'setting' && item.targetSection) {
      setActiveSettingsSection(item.targetSection as SettingsSectionId);
      setActiveView('settings');
      return;
    }
    if (item.targetView) {
      setActiveView(item.targetView as MainWorkspaceView);
    }
  };

  const handleTriggerAnimationAction = (action: MorrowAnimationAction, reason?: string) => {
    setActiveAnimAction(action);
    ringBuffer.push(`2d_rig:${action} (${reason || 'command'})`);
    if (action === 'sleep_rest') {
      setMorrowState('resting');
    } else if (action === 'celebrate') {
      setMorrowState('done_with_proof');
    } else if (action === 'work_type') {
      setMorrowState('working');
    } else {
      setMorrowState('attentive');
    }
  };

  const handleRequestApproval = (
    title: string,
    target: string,
    risk: string,
    reason: string,
    draftId?: string
  ) => {
    const evidenceHash = computeDeterministicHash(`${title}|${target}|${Date.now()}`);
    setPendingApproval({
      id: `appr_${Date.now()}`,
      title,
      target,
      risk,
      evidenceHash,
      reason,
      draftId,
    });
    setMorrowState('asking_approval');
    setActiveAnimAction('waiting_approval');
  };

  const handleApproveAction = (channel: 'local_sheet' | 'telegram_phone') => {
    if (!pendingApproval) return;
    if (pendingApproval.draftId) {
      setApprovedDraftIds((prev) => [...prev, pendingApproval.draftId!]);
    }
    ledger.appendEvent({
      actor: 'user',
      type: 'approval_granted',
      summary: `Approved '${pendingApproval.title}' (${channel}).`,
      payload: JSON.stringify(pendingApproval),
      trustLevel: 'user_stated',
      missionId: 'chat-approval',
    });
    setPendingApproval(null);
    setMorrowState('done_with_proof');
    setActiveAnimAction('celebrate');
    bumpLedger();
  };

  const handleRejectAction = () => {
    if (!pendingApproval) return;
    ledger.appendEvent({
      actor: 'user',
      type: 'approval_denied',
      summary: `Rejected '${pendingApproval.title}'.`,
      payload: JSON.stringify(pendingApproval),
      trustLevel: 'user_stated',
      missionId: 'chat-approval',
    });
    setPendingApproval(null);
    setMorrowState('attentive');
    setActiveAnimAction('idle');
    bumpLedger();
  };

  // Start a new chat thread (standalone by default, or scoped to a project like Claude)
  const handleNewChat = (scopedProjectId?: string) => {
    const newId = `thread-${Date.now()}`;
    const targetProj = scopedProjectId
      ? generalProjects.find((p) => p.id === scopedProjectId)
      : undefined;
    const created: ConversationThread = {
      id: newId,
      projectId: targetProj ? targetProj.id : undefined,
      title: targetProj ? `New chat in ${targetProj.name}` : 'New conversation',
      updatedAt: 'Just now',
      messages: [],
    };
    setThreads((prev) => [created, ...prev]);
    setActiveThreadId(newId);
    setActiveView('chat');
    setMobileSidebarOpen(false);
    return newId;
  };

  const handleSendMessage = (
    presetPrompt?: string,
    overrideThreadId?: string,
    overrideProjectId?: string
  ) => {
    const text = (presetPrompt ?? chatInput).trim();
    if (!text) return;

    const targetThreadId = overrideThreadId || activeThread.id;
    const currentThreadObj = threads.find((t) => t.id === targetThreadId) || activeThread;
    const effectiveProjectId = overrideProjectId ?? currentThreadObj?.projectId;
    const threadProject = effectiveProjectId
      ? generalProjects.find((p) => p.id === effectiveProjectId) || null
      : null;
    const threadProjectArtifacts = threadProject
      ? universalArtifacts.filter((a) => a.projectId === threadProject.id)
      : [];

    const userMsg: ChatTurnMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setThreads((prev) =>
      prev.map((th) =>
        th.id === targetThreadId
          ? {
              ...th,
              projectId: effectiveProjectId ?? th.projectId,
              updatedAt: 'Just now',
              title:
                th.title === 'New conversation' ||
                th.title === 'New Conversation' ||
                th.title.startsWith('New chat in ')
                  ? text.slice(0, 42)
                  : th.title,
              messages: [...th.messages, userMsg],
            }
          : th
      )
    );
    setChatInput('');
    setIsTypingInComposer(false);

    const lower = text.toLowerCase();

    // Screen-Aware "look at my screen" handling (Ask mode preview before sending)
    if (lower.includes('look at my screen') || lower.includes('check my screen')) {
      setPendingAskScreenPrompt(text);
      setAskScreenPreviewModalOpen(true);
      return;
    }

    // Natural language posture command via chat
    const isCompanionCommand =
      /^(sit|sit down|stand|stand up|dance|run|wave|sleep|rest|stretch|drink boba)\b/i.test(lower);

    if (isCompanionCommand) {
      const res = executeChatNaturalLanguageAction(text);
      if (res.allowed && res.action) {
        handleTriggerAnimationAction(res.action, res.replyMessage);
      }
      const replyMsg: ChatTurnMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: res.replyMessage,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setThreads((prev) =>
        prev.map((th) =>
          th.id === activeThread.id ? { ...th, messages: [...th.messages, replyMsg] } : th
        )
      );
      return;
    }

    // Detect behavioral correction or spending cap rule
    const detectedCorrection = detectUserCorrectionForSoulOrRule(text);
    if (detectedCorrection && detectedCorrection.detected) {
      setPendingCorrectionSuggestion(detectedCorrection);
    }

    setIsAiThinking(true);
    setMorrowState('working');
    setActiveAnimAction('work_type');

    window.setTimeout(async () => {
      const matchedSkills = matchSkillsForPrompt(text, reusableSkills);
      const isRuntimeScenario =
        modelRouter.getMode() === 'live' ||
        lower.includes('why did you') ||
        lower.includes('explain') ||
        lower.includes('consensus') ||
        lower.includes('citation');

      if (isRuntimeScenario) {
        const missionRes = await agentRuntime.runMission(text, {
          soul: soulDocument,
          memories: memoryEntries,
          project: activeProject,
          rules: ruleBook,
          skills: reusableSkills,
          ideFiles,
          connectors,
          policyConfig,
          ledger,
          modelRouter,
          eventBus: globalRuntimeEventBus,
        });

        setIsAiThinking(false);
        bumpLedger();

        if (missionRes.proposedIdeDiffs.length > 0) {
          setStagedIdeDiffs(missionRes.proposedIdeDiffs);
        }
        if (missionRes.proposedSchedules.length > 0) {
          const sched = missionRes.proposedSchedules[0];
          setScheduledTasks((prev) => [
            {
              id: `sched-rt-${Date.now()}`,
              projectId: activeProject.id,
              title: sched.title,
              cronExpression: sched.cronExpression,
              naturalSchedule: 'Every Monday at 09:00',
              timezone: 'UTC',
              actionPrompt: text,
              enabled: true,
              nextFiveRuns: sched.nextFiveRunTimesIso || ['Monday 09:00 UTC'],
              lastRunAt: 'Scheduled via AgentRuntime (Simulated)',
              lastRunStatus: 'verified_ok',
              guardNote: 'Simulated (Preview) · Checked by PolicyGuard',
            },
            ...prev,
          ]);
        }
        if (missionRes.pendingApproval) {
          setPendingApproval({
            id: missionRes.pendingApproval.id,
            title: missionRes.pendingApproval.title,
            target: missionRes.pendingApproval.target,
            risk: missionRes.pendingApproval.risk,
            evidenceHash: missionRes.pendingApproval.evidenceHash,
            reason: missionRes.pendingApproval.reason,
          });
        }

        const voicedContent = applySoulVoiceToResponse(
          missionRes.finalReply,
          soulDocument,
          matchedSkills
        );
        voiceControllerRef.current?.speakReply(voicedContent);

        const assistantMsg: ChatTurnMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: voicedContent,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          toolsUsed: missionRes.steps.map((s) => s.toolCall.tool),
          linkedArtifactId: artifacts[0]?.id,
          verifiedProof: {
            hash:
              missionRes.steps[missionRes.steps.length - 1]?.verification.evidenceHash ||
              computeDeterministicHash(text).slice(0, 16),
            summary: `${missionRes.steps.length} runtime steps (${missionRes.uiStatusLabel}) · ${
              missionRes.status === 'waiting_for_approval'
                ? 'Needs your approval before proceeding'
                : missionRes.uiStatusLabel
            }`,
            statusLabel: missionRes.uiStatusLabel,
            isSimulated: missionRes.isSimulated,
          },
          runtimeSteps: missionRes.steps,
          proposedIdeDiff: missionRes.proposedIdeDiffs[0],
        };

        setThreads((prev) =>
          prev.map((th) =>
            th.id === activeThread.id ? { ...th, messages: [...th.messages, assistantMsg] } : th
          )
        );
        return;
      }

      setIsAiThinking(false);

      const isWhereIsQuery =
        lower.includes('where is') ||
        lower.includes('find my') ||
        lower.includes('locate my');
      const isWhereShouldGoQuery =
        lower.includes('where should') ||
        lower.includes('where does') ||
        lower.includes('put this');
      const isBrowserOrDocsTask =
        lower.includes('browser') ||
        lower.includes('docs.workspace') ||
        lower.includes('check docs') ||
        lower.includes('citation');
      const isArtifactOrSummaryTask =
        lower.includes('artifact') ||
        lower.includes('report') ||
        lower.includes('summary') ||
        lower.includes('summarize') ||
        lower.includes('sha-256') ||
        lower.includes('checksum');
      const isTestOrCodeTask =
        lower.includes('run test') ||
        lower.includes('test suite') ||
        lower.includes('execute workspace test');
      const isSkillOrScheduledTask =
        lower.startsWith('run skill') ||
        lower.startsWith('scheduled run:') ||
        lower.includes('tidy');

      const isExplicitTaskJob =
        isWhereIsQuery ||
        isWhereShouldGoQuery ||
        isBrowserOrDocsTask ||
        isArtifactOrSummaryTask ||
        isTestOrCodeTask ||
        isSkillOrScheduledTask;

      // Normal conversational messages: respond naturally without turning the prompt into a job or attaching 'What I did' receipts
      if (!isExplicitTaskJob) {
        setMorrowState('attentive');
        setActiveAnimAction('sit');

        let conversationalReply = '';
        if (threadProject) {
          const topFiles = threadProjectArtifacts
            .slice(0, 2)
            .map((a) => `**${a.title}**`)
            .join(' and ');
          conversationalReply = `Using your **${threadProject.name}** project context${
            topFiles ? ` (including ${topFiles})` : ''
          } and project instructions: here's my response for "${text}". Want me to draft a new project artifact from this or refine it further?`;
        } else if (
          /^(hi|hello|hey|good morning|good afternoon|good evening|yo|sup)\b/i.test(text.trim())
        ) {
          conversationalReply = `Hey there! I'm ${companionName}. How's your day going? We can chat about anything on your mind, work inside one of your Projects, or whenever you want me to help with a task on your computer, just let me know.`;
        } else if (lower.includes('who are you') || lower.includes('your name')) {
          conversationalReply = `I'm ${companionName}, your desktop companion and assistant. You can customize my name, size, and appearance anytime in Settings!`;
        } else if (lower.includes('how are you')) {
          conversationalReply = `I'm doing great, perched right here and ready whenever you need me! What are we thinking about today?`;
        } else if (lower.includes('what can you do') || lower.includes('help')) {
          conversationalReply = `We can have a normal conversation, work inside a Project with custom instructions and project knowledge files, or—only when you ask me to—I can summarize files, organize folders using your Places map, or check pages in the AI Browser.`;
        } else {
          conversationalReply = `Here's my take on "${text}": I'm happy to talk this through with you or explore different angles. Would you like to dive deeper into any specific part, or keep brainstorming together?`;
        }

        const voicedChat = sanitizeAssistantToneCopy(conversationalReply);
        voiceControllerRef.current?.speakReply(voicedChat);

        const conversationalMsg: ChatTurnMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: voicedChat,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        setThreads((prev) =>
          prev.map((th) =>
            th.id === targetThreadId
              ? { ...th, messages: [...th.messages, conversationalMsg] }
              : th
          )
        );
        return;
      }

      // Explicit task / tool job: execute tool action and provide 'What I did' verification receipt
      setMorrowState('done_with_proof');
      setActiveAnimAction('sit');

      const enabledPluginNames = installedPlugins
        .filter((p) => p.enabled)
        .map((p) => p.name);
      const skillViewCalls = matchedSkills.map((s) => s.name);
      const activeToolNames = [...skillViewCalls, ...enabledPluginNames];
      let replyContent = `I completed **"${text}"** using ${
        enabledPluginNames.length > 0
          ? enabledPluginNames.join(' and ')
          : 'your workspace tools'
      }. Want me to save this as an artifact or turn it into a reusable skill?`;
      let proofSummary = 'Simulated (Preview) · Deterministic post-condition check passed';

      let linkedArtifactId: string | undefined;
      let placesCard: ChatTurnMessage['placesCard'] | undefined;

      if (isWhereIsQuery || isWhereShouldGoQuery) {
        if (lower.includes('.ssh') || lower.includes('family photos') || lower.includes('1password')) {
          const targetBlockedPath = lower.includes('.ssh')
            ? '/Users/alex/.ssh/id_ed25519'
            : '/Users/alex/Pictures/Family Photos';
          const guardDecision = evaluatePlacesGuard({
            targetPath: targetBlockedPath,
            operation: 'read',
            caller: 'files_plugin',
            places: userPlaces,
          });
          replyContent = `${guardDecision.blockedMessage || 'That folder is off limits'}. I never read, list, or index Never-Go places. Want to open **Library > Places** to inspect or change this rule?`;
          proofSummary = 'Blocked for safety · Never-Go zone protected by PlacesGuard';
          placesCard = {
            kind: 'off_limits',
            title: guardDecision.blockedMessage || 'That folder is off limits',
            placeLabel: guardDecision.matchedPlace?.label || 'Off-Limits Zone',
            placePath: targetBlockedPath,
            status: 'never',
            reason: guardDecision.reason,
          };
        } else if (isWhereIsQuery) {
          const findResult = placesFind(text, indexedPlaceFiles, userPlaces);
          const top = findResult.candidates[0];
          if (top) {
            replyContent = `I found **${top.file.name}** in **${top.place.label}** (${Math.round(top.confidence * 100)}% confidence — ${top.reason}). Want me to open **Library > Places**?`;
            proofSummary = `Simulated (Preview) · Matched in File Map (${top.place.label})`;
            placesCard = {
              kind: 'where_is',
              title: top.file.name,
              placeLabel: top.place.label,
              placePath: `${top.file.parentPath}/${top.file.name}`,
              status: top.place.status,
              reason: top.reason,
              confidencePct: Math.round(top.confidence * 100),
            };
          } else {
            const fallbackPlace = userPlaces.find((p) => p.status !== 'never') || userPlaces[0];
            replyContent = `I checked your File Map and the closest place is **${fallbackPlace.label}** (${fallbackPlace.purpose}). Want me to open **Library > Places** so you can browse or rescan?`;
            proofSummary = 'Simulated (Preview) · File Map searched without reading Never zones';
            placesCard = {
              kind: 'where_is',
              title: fallbackPlace.label,
              placeLabel: fallbackPlace.label,
              placePath: fallbackPlace.path,
              status: fallbackPlace.status,
              reason: fallbackPlace.purpose,
              confidencePct: 78,
            };
          }
        } else if (isWhereShouldGoQuery) {
          const suggestion = placesSuggestDestination({ name: text }, userPlaces);
          const top = suggestion.topSuggestion;
          const targetPlace =
            top?.place || userPlaces.find((p) => p.status !== 'never') || userPlaces[0];
          const conf = top?.confidence ?? 0.88;
          const reasonText = top?.reason || targetPlace.purpose;
          replyContent = `Based on your File Map rules, this belongs in **${targetPlace.label}** (${reasonText}). ${
            targetPlace.status === 'allowed'
              ? 'Since this place is Allowed, I can move it for you with one-click Undo whenever you hand it over.'
              : 'This place is set to Ask first, so I will wait for your confirmation before moving anything.'
          }`;
          proofSummary = `Simulated (Preview) · Destination suggested by PlaceRules (${targetPlace.label})`;
          placesCard = {
            kind: 'where_should_go',
            title: `Suggested: ${targetPlace.label}`,
            placeLabel: targetPlace.label,
            placePath: targetPlace.path,
            status: targetPlace.status,
            reason: reasonText,
            confidencePct: Math.round(conf * 100),
          };
        }
      } else if (isBrowserOrDocsTask) {
        replyContent =
          'I checked **docs.workspace.local** in the AI Browser preview and checked the page state. Want me to open **Workbench > AI Browser** so you can inspect the session?';
        proofSummary = 'Simulated (Preview) · Isolated browser preview session ready';
      } else if (isArtifactOrSummaryTask) {
        replyContent =
          'I prepared the workspace summary report, checked the file checksums, and opened the interactive artifact preview in the right drawer. I can export or refine it whenever you like.';
        proofSummary = 'Simulated (Preview) · Artifact checksums match workspace preview state';
        linkedArtifactId = artifacts[0]?.id;
        if (artifacts[0]?.id) {
          setActiveArtifactId(artifacts[0].id);
        }
        setChatArtifactDrawerOpen(true);
      }

      const voicedContent = sanitizeAssistantToneCopy(
        applySoulVoiceToResponse(replyContent, soulDocument, matchedSkills)
      );
      voiceControllerRef.current?.speakReply(voicedContent);

      const assistantMsg: ChatTurnMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: voicedContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolsUsed: activeToolNames.length > 0 ? activeToolNames : ['Workspace Assistant'],
        linkedArtifactId,
        placesCard,
        verifiedProof: {
          hash: computeDeterministicHash(`${text}|${Date.now()}`).slice(0, 16),
          summary: proofSummary,
          statusLabel: proofSummary.startsWith('Blocked') ? 'Blocked for safety' : 'Simulated (Preview)',
          isSimulated: true,
        },
      };

      setThreads((prev) =>
        prev.map((th) =>
          th.id === targetThreadId ? { ...th, messages: [...th.messages, assistantMsg] } : th
        )
      );
    }, 320);
  };

  // Artifact & IDE Bridge Handlers
  const handleSaveArtifactVersion = (input: {
    id?: string;
    title: string;
    kind: ArtifactKind;
    language: string;
    content: string;
    summary?: string;
    sourcePrompt?: string;
  }) => {
    const res = createOrUpdateArtifact(artifacts, {
      ...input,
      projectId: activeProject.id,
    });
    setArtifacts(res.artifacts);
    setActiveArtifactId(res.activeArtifact.id);

    // Also save into UniversalArtifactStore for the active general project
    if (universalArtifactStoreRef.current) {
      universalArtifactStoreRef.current.create({
        projectId: activeGeneralProject.id,
        title: input.title,
        category:
          input.kind === 'html_preview'
            ? 'webpage'
            : input.kind === 'svg_graphic'
              ? 'image'
              : 'document',
        content: input.content,
        creator: 'agent',
        originChatOrMission: input.sourcePrompt || 'Saved from Chat',
        summary: input.summary || 'Saved as artifact',
      });
      setUniversalArtifacts(universalArtifactStoreRef.current.getAll());
    }
    bumpLedger();
  };

  const handleOpenArtifactInIde = (artifact: WorkspaceArtifact) => {
    const existingFile = ideFiles.find((f) => f.linkedArtifactId === artifact.id);
    if (existingFile) {
      setIdeFiles((prev) =>
        prev.map((f) =>
          f.id === existingFile.id ? { ...f, content: artifact.content } : f
        )
      );
      setActiveIdeFileId(existingFile.id);
    } else {
      const ext =
        artifact.kind === 'html_preview'
          ? 'html'
          : artifact.kind === 'markdown_doc'
            ? 'md'
            : 'tsx';
      const slug = artifact.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const createdFile: IdeFileNode = {
        id: `file-art-${Date.now().toString(36)}`,
        projectId: activeProject.id,
        path: `src/artifacts/${slug}.${ext}`,
        name: `${slug}.${ext}`,
        language: ext === 'html' ? 'html' : ext === 'md' ? 'markdown' : 'tsx',
        content: artifact.content,
        linkedArtifactId: artifact.id,
      };
      setIdeFiles((prev) => [createdFile, ...prev]);
      setActiveIdeFileId(createdFile.id);
    }
    setActiveView('ide');
  };

  const renderCleanMarkdown = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 rounded bg-stone-500/15 font-mono text-xs text-sky-400"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  const ledgerEvents = useMemo(() => ledger.getEvents(), [ledger, ledgerVersion]);
  const chainReport = useMemo(() => ledger.verifyChain(), [ledger, ledgerVersion]);
  const isLight = uiTheme === 'light';

  // Starter suggestions appear ONLY on an empty chat (or fresh welcome thread with <= 1 message)
  const isEmptyOrWelcomeChat = activeThread.messages.length <= 1;

  // Normalized page id for breadcrumb & active group highlighting
  const normalizedHubPageId: HubPageId =
    activeView === 'ledger'
      ? 'activity'
      : activeView === 'memory_privacy'
        ? 'memory'
        : activeView === 'places'
          ? 'skills'
          : activeView === 'apps_devices' || activeView === 'doctor' || activeView === 'pc_operator'
            ? 'settings'
            : (activeView as HubPageId);
  const activeSidebarGroupId: TopLevelSidebarGroupId =
    getActiveGroupForPage(normalizedHubPageId);
  const topBarBreadcrumbText =
    activeView === 'places'
      ? 'Library > Places'
      : activeView === 'pc_operator'
        ? 'Workbench > PC Operator'
        : activeView === 'doctor'
          ? 'Settings > Blaize Doctor'
          : formatTopBarBreadcrumb(normalizedHubPageId);
  const pendingReviewCount = useMemo(
    () => reviewProposals.filter((p) => p.status === 'pending').length,
    [reviewProposals]
  );

  // Top-level sidebar icons (Prompt 1/4: Chat, Projects, Library, Workbench, Automations, Proof; Settings in footer)
  const topLevelGroupIcons: Record<
    TopLevelSidebarGroupId,
    React.ComponentType<{ className?: string }>
  > = {
    chat: MessageSquare,
    projects: FolderKanban,
    library: Wand2,
    workbench: Globe,
    automations: CalendarClock,
    proof: ShieldCheck,
    settings: Settings,
  };

  const filteredLedgerEvents = useMemo(() => {
    const q = ledgerSearchQuery.trim().toLowerCase();
    if (!q) return ledgerEvents;
    return ledgerEvents.filter(
      (ev) =>
        ev.summary.toLowerCase().includes(q) ||
        ev.actor.toLowerCase().includes(q) ||
        ev.type.toLowerCase().includes(q)
    );
  }, [ledgerEvents, ledgerSearchQuery]);

  return (
    <div
      data-theme={uiTheme}
      className={`h-screen w-screen overflow-hidden flex transition-colors duration-150 ${
        isLight ? 'bg-[#F8FAFC] text-stone-900' : 'bg-[#0B0E14] text-stone-100'
      }`}
    >
      {/* Mobile Drawer Backdrop */}
      {!isBlaizeWindowClosed && mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {isBlaizeWindowClosed ? (
        <div
          data-testid="desktop-backdrop-stage"
          className={`flex-1 h-full w-full relative overflow-hidden flex flex-col justify-between p-6 select-none ${
            isLight
              ? 'bg-gradient-to-br from-slate-100 via-stone-100 to-sky-50 text-stone-800'
              : 'bg-gradient-to-br from-[#060911] via-[#0B101B] to-[#0F172A] text-stone-100'
          }`}
        >
          {/* Desktop Shortcut Icons (Top-Left) */}
          <div className="flex flex-col items-start gap-3 z-10">
            <button
              type="button"
              data-testid="relaunch-blaize-desktop-btn"
              onClick={() => setIsBlaizeWindowClosed(false)}
              className={`group flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all ${
                isLight
                  ? 'bg-white/80 hover:bg-white border-stone-200/80 shadow-sm'
                  : 'bg-stone-900/70 hover:bg-stone-900 border-stone-800/80 shadow-lg'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-sky-600 text-white font-bold text-base flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
                B
              </div>
              <span className="text-[11px] font-medium">Open Blaize</span>
            </button>

            {isMorrowExited && (
              <button
                type="button"
                data-testid="relaunch-morrow-desktop-btn"
                onClick={() => setIsMorrowExited(false)}
                className={`group flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all ${
                  isLight
                    ? 'bg-white/80 hover:bg-white border-stone-200/80 shadow-sm'
                    : 'bg-stone-900/70 hover:bg-stone-900 border-stone-800/80 shadow-lg'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
                  2D
                </div>
                <span className="text-[11px] font-medium">Wake {companionName}</span>
              </button>
            )}
          </div>

          {/* Subtle Desktop Status Pill */}
          <div className="self-center z-10">
            <div
              data-testid="desktop-companion-alive-banner"
              className={`px-4 py-2 rounded-full border text-xs flex items-center gap-2.5 shadow-lg ${
                isLight
                  ? 'bg-white/90 border-stone-200 text-stone-700'
                  : 'bg-stone-900/90 border-stone-800 text-stone-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isMorrowExited ? 'bg-stone-500' : 'bg-emerald-400'
                }`}
              />
              <span>
                {isMorrowExited
                  ? `Blaize and ${companionName} are closed.`
                  : `Blaize window is closed · ${companionName} is still alive on your desktop (drag her anywhere, or right-click her → Exit).`}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* LEFT SIDEBAR: Top-level buttons ONLY (Chat, Projects, Library, Workbench, Automations, Proof; Settings in footer). No sub-buttons listed under any button. */}
          <aside
            aria-label="Primary Sidebar Navigation"
            className={`fixed md:static inset-y-0 left-0 z-50 flex flex-col justify-between border-r shrink-0 transition-all duration-150 select-none ${
              mobileSidebarOpen ? 'translate-x-0 w-60' : '-translate-x-full md:translate-x-0'
            } ${sidebarCollapsed ? 'md:w-14' : 'md:w-60'} ${
              isLight
                ? 'bg-[#F1F5F9] border-stone-200 text-stone-800'
                : 'bg-[#10141D] border-stone-800/80 text-stone-200'
            }`}
          >
            <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1">
              {/* Brand Header & Collapse Rail Toggle */}
              <div className="flex items-center justify-between px-1">
                {!sidebarCollapsed && (
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-sky-600 text-white font-semibold text-xs flex items-center justify-center">
                      B
                    </div>
                    <span className="font-semibold text-sm tracking-tight">Blaize</span>
                  </div>
                )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="p-1.5 rounded-lg hover:bg-stone-500/15 text-stone-400 hover:text-stone-200"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* New Chat & Command Palette Trigger */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => handleNewChat()}
              title="New chat"
              className={`w-full flex items-center justify-center sm:justify-start gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                isLight
                  ? 'bg-white border-stone-200 text-stone-900 hover:bg-stone-50 shadow-2xs'
                  : 'bg-stone-900 border-stone-800 text-stone-100 hover:bg-stone-800/80'
              }`}
            >
              <Plus className="w-4 h-4 text-sky-400 shrink-0" />
              {!sidebarCollapsed && <span>New chat</span>}
            </button>

            {!sidebarCollapsed && (
              <button
                type="button"
                data-testid="sidebar-command-palette-btn"
                onClick={() => setCommandPaletteOpen(true)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs border transition-colors ${
                  isLight
                    ? 'bg-stone-100/80 border-stone-200 text-stone-500 hover:text-stone-800'
                    : 'bg-stone-900/50 border-stone-800/80 text-stone-400 hover:text-stone-200'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Search className="w-3.5 h-3.5" />
                  <span>Search...</span>
                </span>
                <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-stone-500/10">Ctrl+K</kbd>
              </button>
            )}
          </div>

          {/* TOP-LEVEL SIDEBAR BUTTONS ONLY: Chat, Projects, Library, Workbench, Automations, Proof */}
          <nav
            aria-label="Top-level workspace groups"
            data-testid="sidebar-top-level-nav"
            className="space-y-1 pt-1"
          >
            {SIDEBAR_NAVIGATION_GROUPS.filter((g) => g.position === 'main').map((group) => {
              const Icon = topLevelGroupIcons[group.id];
              const isGroupActive = activeSidebarGroupId === group.id;
              const isPopoverOpen = openPopoverGroupId === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  data-testid={`sidebar-btn-${group.id}`}
                  aria-expanded={group.hasPopover ? isPopoverOpen : undefined}
                  aria-haspopup={group.hasPopover ? 'dialog' : undefined}
                  title={group.label}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPopoverAnchorTopPx(rect.top);
                    if (!group.hasPopover && group.directPageId) {
                      setOpenPopoverGroupId(null);
                      setActiveView(group.directPageId);
                      setMobileSidebarOpen(false);
                    } else if (group.hasPopover) {
                      setOpenPopoverGroupId((prev) =>
                        prev === group.id
                          ? null
                          : (group.id as 'library' | 'workbench' | 'automations' | 'proof')
                      );
                    }
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-150 ${
                    isGroupActive || isPopoverOpen
                      ? isLight
                        ? 'bg-sky-600 text-white shadow-2xs'
                        : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                      : 'text-stone-400 hover:bg-stone-500/10 hover:text-stone-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{group.label}</span>}
                  </div>
                  {!sidebarCollapsed && (
                    <div className="flex items-center gap-1.5">
                      {group.id === 'proof' && pendingReviewCount > 0 && (
                        <span
                          data-testid="sidebar-proof-badge"
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        >
                          {pendingReviewCount}
                        </span>
                      )}
                      {group.hasPopover && (
                        <ChevronRight
                          className={`w-3.5 h-3.5 transition-transform ${
                            isPopoverOpen ? 'rotate-90' : ''
                          }`}
                        />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer: Settings, Keyboard Shortcuts & Theme Toggle (also acts as 'sidebar-footer' PerchTarget) */}
        <div
          data-perch-id="sidebar-footer"
          className={`p-2.5 border-t space-y-0.5 ${
            isLight ? 'border-stone-200' : 'border-stone-800/80'
          }`}
        >
          <button
            type="button"
            data-testid="sidebar-btn-settings"
            title="Settings"
            onClick={() => {
              setOpenPopoverGroupId(null);
              setActiveView('settings');
              setMobileSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              activeSidebarGroupId === 'settings'
                ? isLight
                  ? 'bg-sky-600 text-white'
                  : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                : 'text-stone-400 hover:bg-stone-500/15 hover:text-stone-200'
            }`}
          >
            <Settings className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Settings</span>}
          </button>

          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => setUiTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label={`Switch to ${isLight ? 'dark' : 'light'} theme`}
              title={`Switch to ${isLight ? 'dark' : 'light'} theme`}
              className="flex-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-stone-400 hover:bg-stone-500/15 hover:text-stone-200"
            >
              {isLight ? (
                <Moon className="w-4 h-4 shrink-0" />
              ) : (
                <Sun className="w-4 h-4 text-sky-400 shrink-0" />
              )}
              {!sidebarCollapsed && <span>{isLight ? 'Dark theme' : 'Light theme'}</span>}
            </button>

            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => setShortcutsOpen(true)}
                aria-label="Keyboard shortcuts"
                title="Keyboard shortcuts (?)"
                className="p-1.5 rounded-xl text-stone-400 hover:bg-stone-500/15 hover:text-stone-200"
              >
                <Keyboard className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* POPOVER / BOTTOM SHEET FOR LIBRARY, WORKBENCH, AUTOMATIONS, PROOF */}
      <SidebarGroupPopover
        openGroupId={openPopoverGroupId}
        activePageId={activeView === 'places' ? 'places' : normalizedHubPageId}
        anchorTopPx={popoverAnchorTopPx}
        sidebarCollapsed={sidebarCollapsed}
        pendingReviewCount={pendingReviewCount}
        isLight={isLight}
        onSelectPage={(pageId) => {
          setOpenPopoverGroupId(null);
          setActiveView(pageId as MainWorkspaceView);
          setMobileSidebarOpen(false);
        }}
        onClose={() => setOpenPopoverGroupId(null)}
      />

      {/* MAIN WORKSPACE AREA */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
        {/* SLIM TOP BAR: 'Group > Page' breadcrumb, project, Simulated/Live chip, and context actions */}
        <header
          data-perch-id="panel-top-right"
          className={`h-12 px-4 sm:px-6 border-b flex items-center justify-between gap-4 shrink-0 ${
            isLight
              ? 'border-stone-200 bg-white/80'
              : 'border-stone-800/80 bg-[#0B0E14]/90'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open navigation drawer"
              className="p-1.5 rounded-lg hover:bg-stone-500/15 md:hidden"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1
              data-testid="top-bar-breadcrumb"
              className="text-sm font-semibold truncate"
            >
              {topBarBreadcrumbText}
            </h1>
          </div>

          <div
            className={`flex items-center gap-2 text-xs ${
              activeView !== 'chat' ? 'mr-36' : ''
            }`}
          >
            {activeView === 'chat' && (
              <button
                type="button"
                onClick={() => setChatArtifactDrawerOpen((o) => !o)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  chatArtifactDrawerOpen
                    ? 'bg-sky-600 text-white border-sky-600'
                    : isLight
                      ? 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                      : 'bg-stone-900 border-stone-800 text-stone-200 hover:bg-stone-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Artifacts ({artifacts.length})</span>
              </button>
            )}
            {isMorrowExited && (
              <button
                type="button"
                data-testid="relaunch-morrow-topbar-btn"
                onClick={() => setIsMorrowExited(false)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  isLight
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                }`}
              >
                <span>Wake {companionName}</span>
              </button>
            )}
            <button
              type="button"
              data-testid="close-blaize-window-btn"
              onClick={() => setIsBlaizeWindowClosed(true)}
              aria-label={`Close Blaize window (${companionName} stays alive on desktop)`}
              title={`Close Blaize window (${companionName} stays alive on desktop)`}
              className={`p-1.5 rounded-lg border transition-colors ${
                isLight
                  ? 'border-stone-200 text-stone-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200'
                  : 'border-stone-800 text-stone-400 hover:bg-rose-500/15 hover:text-rose-300 hover:border-rose-500/30'
              }`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* VIEW 1: CHAT PAGE (Centered 760px column, no chair stage, composer at bottom with Morrow perched on top) */}
        {activeView === 'chat' && (
          <div className="flex-1 flex h-full overflow-hidden">
            <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
              <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
                <div className="max-w-[760px] mx-auto space-y-5 pb-16">
                  {/* User Correction -> One-Click Save to Soul or Rules */}
                  {pendingCorrectionSuggestion && pendingCorrectionSuggestion.detected && (
                    <div
                      data-testid="chat-soul-correction-banner"
                      className="p-3.5 rounded-xl border border-sky-500/40 bg-sky-500/10 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
                        <span>{pendingCorrectionSuggestion.summary}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          data-testid="confirm-save-correction-btn"
                          onClick={() => {
                            if (pendingCorrectionSuggestion.kind === 'soul_preference') {
                              const prop = proposeSoulChangeFromNaturalLanguage(
                                soulDocument,
                                pendingCorrectionSuggestion.directiveText
                              );
                              setSoulDocument(prop.proposedSoul);
                            } else if (pendingCorrectionSuggestion.kind === 'standing_rule') {
                              const newId = `rule-chat-${policyConfig.standingRules.length + 1}`;
                              setPolicyConfig((prev) => ({
                                ...prev,
                                standingRules: [
                                  {
                                    id: newId,
                                    plainText: pendingCorrectionSuggestion.directiveText,
                                    compiledPattern: 'guard.custom_check()',
                                    ruleType: 'require_approval',
                                    active: true,
                                    generatedScenario: `Verify chat rule ${newId}`,
                                  },
                                  ...prev.standingRules,
                                ],
                              }));
                            }
                            bumpLedger();
                            setPendingCorrectionSuggestion(null);
                          }}
                          className="px-3 py-1 rounded-lg bg-sky-600 text-white font-medium"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingCorrectionSuggestion(null)}
                          className="px-2.5 py-1 rounded-lg border border-stone-700 text-stone-300"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}

                  {/* CLAUDE-STYLE PROJECT CONTEXT BAR (When the active chat belongs to a Project) */}
                  {activeThread.projectId &&
                    (() => {
                      const activeChatProj =
                        generalProjects.find((p) => p.id === activeThread.projectId) ||
                        activeGeneralProject;
                      const projFilesCount = universalArtifacts.filter(
                        (a) => a.projectId === activeChatProj.id
                      ).length;
                      return (
                        <div
                          data-testid="chat-project-context-bar"
                          className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
                            isLight
                              ? 'bg-sky-50/70 border-sky-200 text-stone-800'
                              : 'bg-sky-500/10 border-sky-500/30 text-stone-100'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <button
                              type="button"
                              data-testid="chat-active-project-pill"
                              onClick={() => {
                                setActiveGeneralProjectId(activeChatProj.id);
                                setActiveView('projects');
                              }}
                              title={`Back to ${activeChatProj.name} project overview`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
                            >
                              <FolderKanban className="w-3.5 h-3.5" />
                              <span>{activeChatProj.name}</span>
                              <span className="text-[10px] opacity-80">← Project</span>
                            </button>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-stone-500/10 text-[11px] text-stone-300 border border-stone-700/50">
                              <BookOpen className="w-3 h-3 text-sky-400" />
                              <span>{projFilesCount} knowledge files in context</span>
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 text-[11px] text-emerald-400 border border-emerald-500/20">
                              <Sparkles className="w-3 h-3" />
                              <span>Project instructions active</span>
                            </span>
                          </div>

                          <button
                            type="button"
                            data-testid="chat-new-in-project-btn"
                            onClick={() => handleNewChat(activeChatProj.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors ${
                              isLight
                                ? 'bg-white border-sky-200 text-sky-700 hover:bg-sky-50'
                                : 'bg-stone-900/90 border-sky-500/30 text-sky-300 hover:bg-stone-900'
                            }`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>New chat in project</span>
                          </button>
                        </div>
                      );
                    })()}

                  {/* Claude-Style Recent Chats Switcher Bar (Shows Standalone & Project Chats with Project Badges) */}
                  <div
                    data-testid="normal-chats-switcher"
                    className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2 flex-wrap ${
                      isLight
                        ? 'bg-white border-stone-200'
                        : 'bg-stone-900/60 border-stone-800/80'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 px-2">
                        Recents
                      </span>
                      {threads.map((th) => {
                        const isSelected = th.id === activeThread.id;
                        const thProj = th.projectId
                          ? generalProjects.find((p) => p.id === th.projectId)
                          : undefined;
                        return (
                          <button
                            key={th.id}
                            type="button"
                            data-testid={`normal-chat-tab-${th.id}`}
                            onClick={() => setActiveThreadId(th.id)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium transition-colors max-w-[240px] ${
                              isSelected
                                ? 'bg-sky-600 text-white'
                                : isLight
                                  ? 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                                  : 'bg-stone-800/70 text-stone-300 hover:bg-stone-800'
                            }`}
                          >
                            {thProj && (
                              <FolderKanban
                                className={`w-3 h-3 shrink-0 ${
                                  isSelected ? 'text-white' : 'text-sky-400'
                                }`}
                              />
                            )}
                            <span className="truncate">{th.title}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      data-testid="normal-chat-new-btn"
                      onClick={() => handleNewChat()}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors ${
                        isLight
                          ? 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                          : 'bg-stone-800/60 border-stone-700/80 text-stone-200 hover:bg-stone-800'
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5 text-sky-400" />
                      <span>New chat</span>
                    </button>
                  </div>

                  {/* Welcome Card & Starter Suggestions (ONLY on an empty/fresh chat — no Rename or Size/Appearance clutter) */}
                  {isEmptyOrWelcomeChat && (
                    <div className="space-y-4">
                      <div
                        className={`p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                          isLight
                            ? 'bg-white border-stone-200'
                            : 'bg-stone-900/70 border-stone-800/90'
                        }`}
                      >
                        <div className="space-y-1">
                          <h2
                            data-testid="chat-welcome-heading"
                            className="text-base font-semibold"
                          >
                            Hello, I&apos;m {companionName}
                          </h2>
                          <p className="text-xs text-stone-400 max-w-xl">
                            {activeThread.projectId
                              ? `You're chatting inside "${
                                  generalProjects.find((p) => p.id === activeThread.projectId)
                                    ?.name || 'Project'
                                }". Your project instructions and knowledge files are automatically included in this chat.`
                              : `I'm your desktop assistant. Start a standalone chat below, pick a Project in the composer to use its knowledge and instructions, or hand over a chore when you need help.`}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                        {[
                          {
                            title: 'Summarize workspace files',
                            prompt:
                              'Summarize files in the workspace and compute SHA-256 verification hashes',
                            tag: 'Files & Hash',
                          },
                          {
                            title: 'Research citations',
                            prompt:
                              'Research Paxos consensus algorithm and verify primary paper citations',
                            tag: 'Citation Verifier',
                          },
                          {
                            title: 'Run test suite',
                            prompt:
                              'Execute workspace test suite and verify zero test regressions',
                            tag: 'Code Helper',
                          },
                          {
                            title: 'Explain last ledger action',
                            prompt: 'Why did you do that? Explain the latest ledger receipt.',
                            tag: 'Ledger Proof',
                          },
                        ].map((starter) => (
                          <button
                            key={starter.title}
                            type="button"
                            data-testid={`starter-card-${starter.title
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, '-')}`}
                            onClick={() => handleSendMessage(starter.prompt)}
                            className={`p-3.5 rounded-xl border text-left transition-colors duration-150 ${
                              isLight
                                ? 'bg-white border-stone-200 hover:border-sky-500/50'
                                : 'bg-stone-900/60 border-stone-800/90 hover:border-stone-700'
                            }`}
                          >
                            <div className="text-xs font-semibold">{starter.title}</div>
                            <div className="text-[11px] text-stone-400 mt-1 line-clamp-2">
                              {starter.prompt}
                            </div>
                            <span className="inline-block mt-2 text-[11px] text-sky-400 font-medium">
                              {starter.tag} →
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Staged Workspace Code Diff Banner (when workspace.write proposes a diff) */}
                  {stagedIdeDiffs.length > 0 && (
                    <div
                      data-testid="staged-ide-diff-banner"
                      className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
                        isLight
                          ? 'bg-sky-50 border-sky-200 text-stone-800'
                          : 'bg-sky-500/10 border-sky-500/30 text-stone-200'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold flex items-center gap-1.5">
                          <Code2 className="w-3.5 h-3.5 text-sky-400" />
                          <span>
                            Proposed Code Diff: {stagedIdeDiffs[0].filePath} (+
                            {stagedIdeDiffs[0].addedLinesCount} lines)
                          </span>
                        </div>
                        <div className="text-[11px] text-stone-400">
                          Staged with rollback checkpoint by AgentRuntime · Lint clean
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const diff = stagedIdeDiffs[0];
                            setIdeFiles((prev) =>
                              prev.map((f) =>
                                f.path === diff.filePath
                                  ? { ...f, content: diff.proposedContent }
                                  : f
                              )
                            );
                            setStagedIdeDiffs([]);
                            bumpLedger();
                          }}
                          className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-medium"
                        >
                          Accept diff
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveView('ide')}
                          className="px-2.5 py-1 rounded-lg border border-stone-700 hover:bg-stone-800"
                        >
                          Inspect in Code
                        </button>
                        <button
                          type="button"
                          onClick={() => setStagedIdeDiffs([])}
                          className="px-2.5 py-1 rounded-lg border border-stone-700 text-stone-400 hover:text-rose-400"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Message Stream */}
                  <div className="space-y-4">
                    {activeThread.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 ${
                          msg.role === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="w-7 h-7 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
                            {companionName.slice(0, 1).toUpperCase()}
                          </div>
                        )}

                        <div
                          className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-sky-600 text-white'
                              : isLight
                                ? 'bg-white border border-stone-200 text-stone-800 shadow-2xs'
                                : 'bg-stone-900/80 border border-stone-800/90 text-stone-200'
                          }`}
                        >
                          <div>{renderCleanMarkdown(msg.content)}</div>

                          {/* Morrow 'where is X?' / 'where should this go?' small card with Open button */}
                          {msg.role === 'assistant' && msg.placesCard && (
                            <div
                              data-testid="morrow-chat-places-card"
                              className={`mt-2.5 p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
                                isLight
                                  ? 'bg-stone-50 border-stone-200 text-stone-800'
                                  : 'bg-stone-950/80 border-stone-800 text-stone-200'
                              }`}
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-xs">
                                    {msg.placesCard.title}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                      msg.placesCard.status === 'allowed'
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                        : msg.placesCard.status === 'ask_first'
                                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                          : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                    }`}
                                  >
                                    {msg.placesCard.status === 'allowed'
                                      ? 'Allowed'
                                      : msg.placesCard.status === 'ask_first'
                                        ? 'Ask first'
                                        : 'Never'}
                                  </span>
                                  {typeof msg.placesCard.confidencePct === 'number' && (
                                    <span className="font-mono text-[10px] text-sky-400">
                                      {msg.placesCard.confidencePct}% match
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-stone-400">
                                  Place: <span className="font-medium text-stone-300">{msg.placesCard.placeLabel}</span> · {msg.placesCard.reason}
                                </div>
                              </div>
                              <button
                                type="button"
                                data-testid="morrow-chat-places-open-btn"
                                onClick={() => setActiveView('places')}
                                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs shrink-0"
                              >
                                Open
                              </button>
                            </div>
                          )}

                          {/* Assistant 'What I did' collapsed card + actions */}
                          {msg.role === 'assistant' && (
                            <WhatIDidCard
                              msg={msg}
                              isLight={isLight}
                              isCrystallized={crystallizedMsgIds.includes(msg.id)}
                              onOpenOrSaveArtifact={() => {
                                if (msg.linkedArtifactId) {
                                  setActiveArtifactId(msg.linkedArtifactId);
                                } else {
                                  handleSaveArtifactVersion({
                                    title: `Chat Artifact (${msg.timestamp})`,
                                    kind: 'markdown_doc',
                                    language: 'markdown',
                                    content: `# ${activeThread.title}\n\n${msg.content}\n\n- Status: ${msg.verifiedProof?.summary || 'Verified'}`,
                                    summary: 'Saved from Chat',
                                  });
                                }
                                setChatArtifactDrawerOpen(true);
                              }}
                              onCrystallizeSkill={() => {
                                const skillTitle = `${activeThread.title.slice(0, 28)} Procedure`;
                                const res = executeSkillManage(reusableSkills, {
                                  action: 'create',
                                  name: skillTitle,
                                  category: 'automation',
                                  description: `Crystallized from verified chat turn.`,
                                  skillMarkdown: `---\nname: ${skillTitle
                                    .toLowerCase()
                                    .replace(/[^a-z0-9]+/g, '-')}\nversion: 1\nguard: verified\n---\n# Procedure\n1. Execute workflow for {{target_scope}}.\n2. Verify post-condition (${msg.verifiedProof?.summary || 'Verified'}).\n\n# Pitfalls & Edge Cases\n- Pause for human approval on state mutations.`,
                                  parameterNames: ['target_scope'],
                                });
                                setReusableSkills(res.skills);
                                setCrystallizedMsgIds((prev) => [...prev, msg.id]);
                              }}
                            />
                          )}
                        </div>
                      </div>
                    ))}

                    {isAiThinking && (
                      <div className="flex items-center gap-2.5 text-xs text-stone-400 pl-2">
                        <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                        <span>{companionName} is thinking...</span>
                      </div>
                    )}

                    {/* Focused Approval Sheet slides up when approval is needed */}
                    {pendingApproval && (
                      <div className="pb-4">
                        <FocusedApprovalSheet
                          approval={pendingApproval}
                          onApprove={() => handleApproveAction('local_sheet')}
                          onSimulateOnly={() => handleApproveAction('local_sheet')}
                          onReject={handleRejectAction}
                          uiTheme={uiTheme}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </main>

              {/* Pinned Composer at Bottom (Morrow sits on its top edge via data-perch-id="composer-top") */}
              <div className="px-4 sm:px-6 pb-4 pt-2 shrink-0">
                <div
                  data-perch-id="composer-top"
                  className="max-w-[760px] mx-auto relative"
                >
                  {/* Tool Toggles Popover (not a permanent row) */}
                  {toolsMenuOpen && (
                    <div
                      role="dialog"
                      aria-label="Tools in Chat"
                      className={`absolute bottom-full mb-2 left-0 w-76 rounded-2xl border p-3.5 shadow-xl z-30 space-y-2 text-xs ${
                        isLight
                          ? 'bg-white border-stone-200 text-stone-900'
                          : 'bg-stone-900 border-stone-800 text-stone-100'
                      }`}
                    >
                      <div className="flex items-center justify-between pb-1.5 border-b border-stone-700/40">
                        <span className="font-semibold">Tools in Chat</span>
                        <button
                          type="button"
                          onClick={() => setToolsMenuOpen(false)}
                          className="p-0.5 rounded hover:bg-stone-500/20"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="space-y-1 max-h-52 overflow-y-auto">
                        {plugins.map((pl) => (
                          <button
                            key={pl.id}
                            type="button"
                            onClick={() =>
                              setPlugins((prev) =>
                                prev.map((item) =>
                                  item.id === pl.id
                                    ? { ...item, enabledInChat: !item.enabledInChat }
                                    : item
                                )
                              )
                            }
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-stone-500/10 text-left"
                          >
                            <div>
                              <div className="font-medium">{pl.name}</div>
                              <div className="text-[11px] text-stone-400">{pl.category}</div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[11px] font-medium ${
                                pl.enabledInChat
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-stone-800 text-stone-400'
                              }`}
                            >
                              {pl.enabledInChat ? 'On' : 'Off'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendMessage();
                    }}
                    className={`rounded-2xl border p-3 shadow-md transition-colors ${
                      isLight
                        ? 'bg-white border-stone-200 focus-within:border-sky-500'
                        : 'bg-stone-900/95 border-stone-800 focus-within:border-sky-500/60'
                    }`}
                  >
                    <textarea
                      rows={2}
                      aria-label={`Message ${companionName}`}
                      value={chatInput}
                      onFocus={() => setIsTypingInComposer(true)}
                      onBlur={() => setIsTypingInComposer(false)}
                      onChange={(e) => {
                        setChatInput(e.target.value);
                        setIsTypingInComposer(e.target.value.length > 0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder={`Ask ${companionName} anything...`}
                      className="w-full bg-transparent outline-none resize-none text-sm placeholder:text-stone-400"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-700/20">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setToolsMenuOpen((o) => !o)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors ${
                            isLight
                              ? 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                              : 'bg-stone-950 border-stone-800 text-stone-300 hover:bg-stone-800'
                          }`}
                        >
                          <Puzzle className="w-3.5 h-3.5 text-sky-400" />
                          <span>Tools ({enabledChatPlugins.length})</span>
                        </button>

                        {/* Claude-Style Project Selector Pill in Composer */}
                        <div className="inline-flex items-center gap-1.5">
                          <FolderKanban className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <select
                            aria-label="Project scope for this chat"
                            data-testid="chat-composer-project-selector"
                            value={activeThread.projectId || ''}
                            onChange={(e) => {
                              const nextProjId = e.target.value || undefined;
                              setThreads((prev) =>
                                prev.map((th) =>
                                  th.id === activeThread.id ? { ...th, projectId: nextProjId } : th
                                )
                              );
                              if (nextProjId) {
                                setActiveGeneralProjectId(nextProjId);
                              }
                            }}
                            className={`px-2.5 py-1 rounded-xl text-xs font-medium border outline-none transition-colors ${
                              activeThread.projectId
                                ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                                : isLight
                                  ? 'bg-stone-50 border-stone-200 text-stone-700'
                                  : 'bg-stone-950 border-stone-800 text-stone-300'
                            }`}
                          >
                            <option value="">No project (Standalone chat)</option>
                            {generalProjects.map((proj) => (
                              <option key={proj.id} value={proj.id}>
                                Project: {proj.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleSendMessage(
                              'Summarize workspace files and verify SHA-256 checksums'
                            )
                          }
                          aria-label="Voice input"
                          title="Voice input"
                          className="p-2 rounded-xl text-stone-400 hover:text-stone-200 hover:bg-stone-500/15"
                        >
                          <Mic className="w-4 h-4" />
                        </button>

                        <button
                          type="submit"
                          aria-label="Send message"
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors"
                        >
                          <span>Send</span>
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            </div>

            {/* Lazy-loaded Right-Hand Artifact Drawer (Preview, Code, History) */}
            {chatArtifactDrawerOpen && (
              <Suspense
                fallback={
                  <div className="w-96 p-6 border-l border-stone-800 text-xs text-stone-400">
                    Loading artifact preview...
                  </div>
                }
              >
                <ArtifactSplitDrawer
                  artifacts={artifacts}
                  activeArtifact={
                    artifacts.find((a) => a.id === activeArtifactId) || artifacts[0] || null
                  }
                  onSelectArtifact={(id) => setActiveArtifactId(id)}
                  onSaveArtifactVersion={handleSaveArtifactVersion}
                  onRollbackArtifact={(updated) =>
                    setArtifacts((prev) =>
                      prev.map((a) => (a.id === updated.id ? updated : a))
                    )
                  }
                  onOpenInVSCodeIde={handleOpenArtifactInIde}
                  onClose={() => setChatArtifactDrawerOpen(false)}
                  drawerWidthPx={artifactDrawerWidthPx}
                  onChangeDrawerWidthPx={setArtifactDrawerWidthPx}
                  uiTheme={uiTheme}
                />
              </Suspense>
            )}
          </div>
        )}

        {/* VIEW 2: PROJECTS AND UNIVERSAL ARTIFACTS (Prompt 2/4: Clean 2-column layout + Modal Viewer) */}
        {activeView === 'projects' && (
          <main className="flex-1 overflow-hidden">
            <ProjectsAndArtifactsView
              generalProjects={generalProjects}
              activeGeneralProjectId={activeGeneralProject.id}
              onSelectGeneralProject={setActiveGeneralProjectId}
              onCreateGeneralProject={(proj) => setGeneralProjects((prev) => [proj, ...prev])}
              onUpdateGeneralProject={(projectId, patch) =>
                setGeneralProjects((prev) =>
                  prev.map((p) => (p.id === projectId ? { ...p, ...patch } : p))
                )
              }
              artifactStore={universalArtifactStoreRef.current!}
              universalArtifacts={universalArtifacts}
              onRefreshArtifacts={() =>
                setUniversalArtifacts(universalArtifactStoreRef.current!.getAll())
              }
              unifiedSkills={unifiedSkills}
              schedules={scheduledTasks}
              chatSummaries={threads
                .filter((th) => Boolean(th.projectId))
                .map((th) => ({
                  id: th.id,
                  projectId: th.projectId!,
                  title: th.title,
                  updatedAt: th.updatedAt,
                  lastMessagePreview:
                    th.messages[th.messages.length - 1]?.content ||
                    'Started a chat in this project.',
                  messages: th.messages.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp,
                  })),
                }))}
              onOpenChatThread={(threadId) => {
                const found = threads.find((t) => t.id === threadId);
                if (found?.projectId) {
                  setActiveGeneralProjectId(found.projectId);
                }
                setActiveThreadId(threadId);
                setActiveView('chat');
              }}
              onStartNewProjectChat={(projectId, initialPrompt) => {
                setActiveGeneralProjectId(projectId);
                const proj =
                  generalProjects.find((p) => p.id === projectId) || activeGeneralProject;
                const newThreadId = `proj-thread-${Date.now()}`;
                const createdThread: ConversationThread = {
                  id: newThreadId,
                  projectId,
                  title: initialPrompt
                    ? initialPrompt.slice(0, 42)
                    : `${proj.name} Discussion #${
                        threads.filter((t) => t.projectId === projectId).length + 1
                      }`,
                  updatedAt: 'Just now',
                  messages: initialPrompt
                    ? []
                    : [
                        {
                          id: `pt-init-${Date.now()}`,
                          role: 'assistant',
                          content: `Started a new chat in **${proj.name}**. Your project instructions and ${
                            universalArtifacts.filter((a) => a.projectId === projectId).length
                          } knowledge files are active in this conversation.`,
                          timestamp: 'Just now',
                        },
                      ],
                };
                setThreads((prev) => [createdThread, ...prev]);
                setActiveThreadId(newThreadId);
                setActiveView('chat');
                if (initialPrompt && initialPrompt.trim()) {
                  window.setTimeout(() => {
                    handleSendMessage(initialPrompt.trim(), newThreadId, projectId);
                  }, 10);
                }
              }}
              onSendProjectMessage={(projectId, threadId, text) => {
                handleSendMessage(text, threadId, projectId);
              }}
              onNavigateWorkspace={(view) => setActiveView(view)}
              modelRuntimeMode={modelMode}
              uiTheme={uiTheme}
              companionName={companionName}
            />
          </main>
        )}

        {/* VIEW 3: WORKBENCH -> CODE (Lazy-loaded, file tree + editor first, Open VSX behind Extensions button, terminal collapsed) */}
        {activeView === 'ide' && (
          <main className="flex-1 overflow-hidden">
            <Suspense
              fallback={
                <div className="p-8 text-center text-xs text-stone-400">
                  Loading Code editor...
                </div>
              }
            >
              <MonacoCodeEditorView
                files={ideFiles}
                activeFileId={activeIdeFileId}
                onSelectFile={setActiveIdeFileId}
                onUpdateFileContent={(fileId, newContent) =>
                  setIdeFiles((prev) =>
                    prev.map((f) => (f.id === fileId ? { ...f, content: newContent } : f))
                  )
                }
                onCreateFile={(newFile) => setIdeFiles((prev) => [...prev, newFile])}
                onDeleteFile={(fileId) => setIdeFiles((prev) => prev.filter((f) => f.id !== fileId))}
                onPublishFileAsArtifact={(artInput) => {
                  handleSaveArtifactVersion({
                    title: artInput.name,
                    kind: 'react_component',
                    language: 'typescript',
                    content: artInput.content,
                    summary: 'Published from Code editor',
                  });
                }}
                onAskMorrowInChat={(prompt) => {
                  setActiveView('chat');
                  handleSendMessage(prompt);
                }}
                companionName={companionName}
                uiTheme={uiTheme}
              />
            </Suspense>
          </main>
        )}

        {/* VIEW 4: LIBRARY -> SKILLS (One place, simple: cards, filters, New skill -> Record it / Describe it / From a chat, detail with steps, Try it, Edit, History, Advanced) */}
        {activeView === 'skills' && (
          <main className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Skill recorder</h2>
                <p className="text-xs text-[var(--text-secondary)]">Capture a real desktop task, review its video and keyframes, then compile a reusable skill.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSkillRecorderStudio((visible) => !visible)}
                className="px-3 py-2 rounded-xl border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
              >
                {showSkillRecorderStudio ? 'Hide Recorder Studio' : 'Open Recorder Studio'}
              </button>
            </div>
            {showSkillRecorderStudio && (
              <SkillRecorderStudio
                screenAwarenessMode={screenAwarenessMode}
                onChangeScreenAwarenessMode={setScreenAwarenessMode}
                activeSourceType={recorderSourceType}
                onChangeSourceType={setRecorderSourceType}
                isRecording={isRecordingSkill}
                isPaused={isRecordingPaused}
                autoPauseReason={autoPauseReason}
                activeSession={activeRecordingSession}
                recordedSkills={recordedSkills}
                onUpdateRecordedSkills={setRecordedSkills}
                onOpenConsentSheet={() => setConsentSheetOpen(true)}
                onStartRecordingAfterConsent={handleStartRecordingAfterConsent}
                onPauseResumeRecording={handlePauseResumeRecording}
                onStopAndReviewRecording={handleStopAndReviewRecording}
                onRecordStageEvent={handleRecordStageEvent}
                onAddManualKeyframe={handleAddManualKeyframe}
                onAddNarration={(note, mode) => {
                  setActiveRecordingSession((previous) => previous ? {
                    ...previous,
                    narration: [...previous.narration, { id: `nar_${Date.now()}`, timestamp: Date.now(), text: note, mode }],
                  } : previous);
                }}
                onDeleteKeyframe={(frameId) => {
                  void deleteKeyframesFromIndexedDb([frameId]);
                  setActiveRecordingSession((previous) => previous ? {
                    ...previous, keyframes: previous.keyframes.map((frame) => frame.id === frameId ? { ...frame, deleted: true } : frame),
                  } : previous);
                }}
                onAddBlurRegionToFrame={(frameId, label) => {
                  setActiveRecordingSession((previous) => previous ? {
                    ...previous,
                    keyframes: previous.keyframes.map((frame) => frame.id === frameId ? {
                      ...frame,
                      blurRegions: [...frame.blurRegions, { id: `blur_${Date.now()}`, xPct: 10, yPct: 10, widthPct: 20, heightPct: 12, label }],
                    } : frame),
                  } : previous);
                }}
                onDiscardRecording={async () => {
                  const sessionToDiscard = activeRecordingSession;
                  const capture = screenCaptureRef.current;
                  if (capture) await capture.stop();
                  screenCaptureRef.current = null;
                  if (sessionToDiscard) {
                    await deleteKeyframesFromIndexedDb(sessionToDiscard.keyframes.map((frame) => frame.id));
                    await deleteRecordingMediaSegments(sessionToDiscard.mediaSegments || []);
                    if (window.electronAPI?.isElectron) {
                      await window.electronAPI.storage.deleteRecord('recorder_sessions', sessionToDiscard.id).catch(() => undefined);
                      await window.electronAPI.storage.deleteRecord('recorder_sessions', 'active').catch(() => undefined);
                    }
                  }
                  setActiveRecordingSession(null);
                  setIsRecordingSkill(false);
                  setIsRecordingPaused(false);
                  setScreenAwarenessMode('off');
                  setRecordingElapsedSec(0);
                  setAutoPauseReason(null);
                }}
                onCompleteRecordingRetention={async (sessionToClean) => {
                  await deleteKeyframesFromIndexedDb(sessionToClean.keyframes.map((frame) => frame.id));
                  await deleteRecordingMediaSegments(sessionToClean.mediaSegments || []);
                  setActiveRecordingSession((previous) => previous?.id === sessionToClean.id ? {
                    ...previous,
                    keyframes: previous.keyframes.map((frame) => ({ ...frame, deleted: true })),
                    mediaSegments: [],
                  } : previous);
                }}
                onRecordLedgerEvent={(title, summary, details) => {
                  ledger.appendEvent({
                    actor: 'operator', type: 'skill_created', summary: `${title}: ${summary}`,
                    payload: JSON.stringify(details), trustLevel: 'verified_by_evidence', missionId: activeRecordingSession?.id || 'skill-recorder',
                  });
                  bumpLedger();
                }}
                isLiveModelMode={modelRouter.getMode() === 'live'}
              />
            )}
            <UnifiedSkillsPageView
            skills={unifiedSkills}
            threads={threads.map((t) => ({ id: t.id, title: t.title }))}
            isLight={isLight}
            onAddSkill={(newSkill) => {
              setUnifiedSkills((prev) => [newSkill, ...prev]);
              ledger.appendEvent({
                actor: 'operator',
                type: 'skill_created',
                summary: `Created skill '${newSkill.name}' (${newSkill.origin}).`,
                payload: JSON.stringify({ id: newSkill.id, name: newSkill.name }),
                trustLevel: 'verified_by_evidence',
                missionId: 'library-skills',
              });
              bumpLedger();
            }}
            onUpdateSkill={(updated) => {
              setUnifiedSkills((prev) =>
                prev.map((s) => (s.id === updated.id ? updated : s))
              );
              ledger.appendEvent({
                actor: 'operator',
                type: 'skill_updated',
                summary: `Updated skill '${updated.name}' (v${updated.version}).`,
                payload: JSON.stringify({ id: updated.id, version: updated.version }),
                trustLevel: 'verified_by_evidence',
                missionId: 'library-skills',
              });
              bumpLedger();
            }}
            onStartRecordingSkill={() => { setShowSkillRecorderStudio(true); setConsentSheetOpen(true); }}
            onTrySkillInChat={(skill) => {
              setUnifiedSkills((prev) =>
                prev.map((s) => (s.id === skill.id ? { ...s, lastUsed: 'Just now' } : s))
              );
              ledger.appendEvent({
                actor: 'agent',
                type: 'skill_executed',
                summary: `Executed skill '${skill.name}' (v${skill.version}).`,
                payload: JSON.stringify({ id: skill.id, steps: skill.steps.length }),
                trustLevel: 'verified_by_evidence',
                missionId: skill.id,
              });
              bumpLedger();
              setActiveView('chat');
              handleSendMessage(`Run skill "${skill.name}": ${skill.oneLineDescription}`);
            }}
          />
          </main>
        )}

        {/* VIEW 5: LIBRARY -> SOUL (Identity, voice style, role/job description, personality template: Download Template, Import, Remove — no memory and no skills) */}
        {activeView === 'soul' && (
          <main className="flex-1 overflow-y-auto p-6">
            <UnifiedSoulPageView
              soulProfile={soulProfile}
              onUpdateSoulProfile={(next) => {
                setSoulProfile(next);
                handleRenameCompanion(next.identity.name);
                ledger.appendEvent({
                  actor: 'operator',
                  type: 'soul_profile_updated',
                  summary: `Updated Soul profile for ${next.identity.name} (${next.voiceStyle.cadenceId}).`,
                  payload: JSON.stringify(next),
                  trustLevel: 'verified_by_evidence',
                  missionId: 'library-soul',
                });
                bumpLedger();
              }}
              isLight={isLight}
            />
          </main>
        )}

        {/* VIEW 6: LIBRARY -> MEMORY (Single Memory store under Library > Memory) */}
        {(activeView === 'memory' || activeView === 'memory_privacy') && (
          <UnifiedMemoryPageView
            items={unifiedMemories}
            pauseSaving={pauseMemorySaving}
            activeChatId={activeThread.id}
            activeChatTitle={activeThread.title}
            isLight={isLight}
            onTogglePauseSaving={() => {
              const next = !pauseMemorySaving;
              unifiedMemoryStoreRef.current!.setPauseSaving(next);
              setPauseMemorySaving(next);
            }}
            onProposeOrSaveMemory={(input) => {
              const res = unifiedMemoryStoreRef.current!.proposeOrSave(input);
              setUnifiedMemories(unifiedMemoryStoreRef.current!.getItems());
              setReviewProposals(reviewInboxRef.current!.getAll());
              bumpLedger();
              return {
                status: res.status,
                memoryId: res.item?.id,
                reason: res.reason,
              };
            }}
            onEditMemory={(id, patch) => {
              const res = unifiedMemoryStoreRef.current!.edit(id, patch);
              setUnifiedMemories(unifiedMemoryStoreRef.current!.getItems());
              bumpLedger();
              return res;
            }}
            onDeleteMemory={(id) => {
              unifiedMemoryStoreRef.current!.delete(id);
              setUnifiedMemories(unifiedMemoryStoreRef.current!.getItems());
              bumpLedger();
            }}
            onBulkDeleteMemories={(ids) => {
              unifiedMemoryStoreRef.current!.bulkDelete(ids);
              setUnifiedMemories(unifiedMemoryStoreRef.current!.getItems());
              bumpLedger();
            }}
            onForgetActiveChat={() => {
              const count = unifiedMemoryStoreRef.current!.forgetChat(activeThread.id);
              setUnifiedMemories(unifiedMemoryStoreRef.current!.getItems());
              bumpLedger();
              return count;
            }}
            onExportMarkdown={(target) => unifiedMemoryStoreRef.current!.exportMarkdown(target)}
            onOpenReviewPage={() => setActiveView('review')}
          />
        )}

        {/* VIEW 6B: LIBRARY -> PLACES ('My Places' File Map, Never-Go Zones, Teach 3 Ways, Where does this go?, Map Health) */}
        {activeView === 'places' && (
          <main className="flex-1 overflow-y-auto">
            <PlacesMapView
              places={userPlaces}
              onUpdatePlaces={(next) => {
                setUserPlaces(next);
                ledger.appendEvent({
                  actor: 'operator',
                  type: 'places_map_updated',
                  summary: `Updated File Map ('My Places') — ${next.length} places configured.`,
                  payload: JSON.stringify({ count: next.length }),
                  trustLevel: 'verified_by_evidence',
                  missionId: 'library-places',
                });
                bumpLedger();
              }}
              indexedFiles={indexedPlaceFiles}
              onUpdateIndexedFiles={setIndexedPlaceFiles}
              isLight={isLight}
              isLiveModelMode={modelMode === 'live'}
              onPromoteProposalToReview={(proposal) => {
                reviewInboxRef.current!.addProposal({
                  id: `rev-place-${Date.now()}`,
                  type: 'rule',
                  title: proposal.title,
                  summary: proposal.summary,
                  scopeLabel: 'Place',
                  proposedBy: 'agent',
                  createdAt: 'Just now',
                  status: 'pending',
                  plainDiff: {
                    before: proposal.before,
                    after: proposal.after,
                  },
                });
                setReviewProposals(reviewInboxRef.current!.getAll());
                bumpLedger();
              }}
              onScheduleFridayTidyWithPlaces={() => {
                const newSched: EverydayScheduleItem = {
                  id: `sched-places-friday-${Date.now()}`,
                  title: 'Every Friday tidy Downloads using my Places',
                  prompt:
                    'Scan ~/Downloads and move files into their matching Allowed destinations in Library > Places with Undo journal logging.',
                  frequency: 'weekly',
                  timeOfDay: '16:00',
                  daysOfWeek: ['fri'],
                  mode: 'do_for_me',
                  channel: 'chat',
                  missedRunPolicy: 'ask_me',
                  enabled: true,
                  nextRunLocal: 'Friday, 4:00 PM',
                  nextRunEpochMs: Date.now() + 86400_000,
                  lastRunAt: 'Scheduled with Places',
                  lastRunStatus: 'done',
                  advancedCron: '0 16 * * 5',
                  requiresMoneyOrSensitive: false,
                };
                setEverydaySchedules((prev) => [newSched, ...prev]);
                ledger.appendEvent({
                  actor: 'operator',
                  type: 'schedule_registered',
                  summary: `Scheduled 'Every Friday tidy Downloads using my Places'.`,
                  payload: JSON.stringify(newSched),
                  trustLevel: 'verified_by_evidence',
                  missionId: newSched.id,
                });
                bumpLedger();
              }}
            />
          </main>
        )}

        {/* VIEW 7A: LIBRARY -> CONNECTORS (WorkingConnectorsView with honest status, 3-step guides, SSRF proxy & real test buttons) */}
        {activeView === 'connectors' && (
          <main className="flex-1 overflow-y-auto">
            <WorkingConnectorsView
              connectors={workingConnectors}
              onUpdateConnector={(updated) => {
                setWorkingConnectors((prev) =>
                  prev.map((c) => (c.id === updated.id ? updated : c))
                );
                ledger.appendEvent({
                  actor: 'operator',
                  type: 'connector_status_changed',
                  summary: `Connector "${updated.name}" status: ${updated.status}.`,
                  payload: JSON.stringify(updated),
                  trustLevel: 'verified_by_evidence',
                  missionId: updated.id,
                });
                bumpLedger();
              }}
              projects={generalProjects}
              activeProjectId={activeGeneralProject.id}
              isLight={isLight}
              onOpenKeyVault={() => {
                setActiveView('settings');
                setActiveSettingsSection('vault');
              }}
              onStoreVaultKey={async (keyId, label, token) => {
                try {
                  const res = await apiFetch('/api/vault/store', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keyId, label, plainKey: token, secretCode: secretCodeInput || undefined }),
                  });
                  return res.ok;
                } catch {
                  return true;
                }
              }}
            />
          </main>
        )}

        {/* VIEW 7B: AUTOMATIONS -> SCHEDULER (EverydaySchedulerView for everyday people with device timezone & honest open notice) */}
        {activeView === 'scheduler' && (
          <main className="flex-1 overflow-y-auto">
            <EverydaySchedulerView
              schedules={everydaySchedules}
              onAddSchedule={(sched) => {
                setEverydaySchedules((prev) => [sched, ...prev]);
                ledger.appendEvent({
                  actor: 'operator',
                  type: 'schedule_registered',
                  summary: `Registered schedule "${sched.title}" (${sched.nextRunLocal}).`,
                  payload: JSON.stringify(sched),
                  trustLevel: 'verified_by_evidence',
                  missionId: sched.id,
                });
                bumpLedger();
              }}
              onUpdateSchedule={(updated) => {
                setEverydaySchedules((prev) =>
                  prev.map((s) => (s.id === updated.id ? updated : s))
                );
                bumpLedger();
              }}
              onDeleteSchedule={(schedId) => {
                setEverydaySchedules((prev) => prev.filter((s) => s.id !== schedId));
                bumpLedger();
              }}
              onRunScheduleNow={(sched) => {
                setEverydaySchedules((prev) =>
                  prev.map((s) =>
                    s.id === sched.id
                      ? {
                          ...s,
                          lastRunAt: 'Just now (Simulated)',
                          lastRunStatus: 'idle',
                        }
                      : s
                  )
                );
                ledger.appendEvent({
                  actor: 'agent',
                  type: 'scheduled_run_executed',
                  summary: `Simulated scheduled routine "${sched.title}": ${sched.prompt}`,
                  payload: JSON.stringify(sched),
                  trustLevel: 'verified_by_evidence',
                  missionId: sched.id,
                  executionState: 'SIMULATED',
                  verificationState: 'SIMULATED',
                  isSimulated: true,
                });
                bumpLedger();
                setActiveView('chat');
                handleSendMessage(`Scheduled run: "${sched.title}". Task: ${sched.prompt}`);
              }}
              isLight={isLight}
            />
          </main>
        )}

        {/* VIEW 8: LIBRARY -> RULES (Scoped Rule Book: Everywhere, Project, Plugin, Connector; applies to every plugin; manifests only tighten) */}
        {activeView === 'rules' && (
          <main className="flex-1 overflow-y-auto p-6" data-testid="rule-book-view">
            <div className="max-w-5xl mx-auto">
              <UnifiedRulesPageView
                rules={scopedRules}
                plugins={installedPlugins}
                onAddRule={(r) => {
                  setScopedRules((prev) => [r, ...prev]);
                  ledger.appendEvent({
                    actor: 'operator',
                    type: 'scoped_rule_added',
                    summary: `Added rule (${r.scope}): "${r.text}"`,
                    payload: JSON.stringify(r),
                    trustLevel: 'verified_by_evidence',
                    missionId: 'library-rules',
                  });
                  bumpLedger();
                }}
                onToggleRule={(id) => {
                  setScopedRules((prev) =>
                    prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
                  );
                  bumpLedger();
                }}
                onDeleteRule={(id) => {
                  setScopedRules((prev) => prev.filter((r) => r.id !== id));
                  bumpLedger();
                }}
                isLight={isLight}
              />
            </div>
          </main>
        )}

        {/* VIEW 9: WORKBENCH -> AI BROWSER (Lazy-loaded + Teach & Replay Bar) */}
        {activeView === 'browser' && (
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
            <div
              data-testid="teach-and-replay-bar"
              className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="space-y-0.5">
                <div className="font-semibold flex items-center gap-2">
                  <Wand2 className="w-3.5 h-3.5 text-sky-400" />
                  <span>Teach & Replay: {compiledDemoSkill.skill.name}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                    {compiledDemoSkill.steps.length} intent steps ·{' '}
                    {compiledDemoSkill.skippedCredentialEvents} credential field excluded
                  </span>
                </div>
                <div className="text-[11px] text-stone-400">
                  Records demonstrations + narration, never records credential fields, and verifies
                  every step on replay.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const res = replayCompiledSkillByIntent({
                      compiled: compiledDemoSkill,
                      dryRun: true,
                    });
                    setLastReplayResult(res);
                  }}
                  className="px-3 py-1 rounded-lg border border-stone-700 hover:bg-stone-800 font-medium"
                >
                  Dry run
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const res = replayCompiledSkillByIntent({
                      compiled: compiledDemoSkill,
                      dryRun: false,
                    });
                    setLastReplayResult(res);
                    bumpLedger();
                  }}
                  className="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium"
                >
                  Replay by intent
                </button>
              </div>

              {lastReplayResult && (
                <div className="w-full pt-2 border-t border-stone-800/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-sky-400 font-medium">
                    {lastReplayResult.dryRun ? 'Dry Run' : 'Intent Replay'} Simulated (Preview):{' '}
                    {lastReplayResult.stepsCompleted}/{lastReplayResult.totalSteps} steps checked
                    in simulation
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {lastReplayResult.stepReceipts.map((r) => (
                      <span
                        key={r.stepIndex}
                        className="px-2 py-0.5 rounded bg-stone-500/10 text-stone-300"
                      >
                        #{r.stepIndex} {r.intentLabel} ({r.postCondition})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Suspense
              fallback={
                <div className="p-8 text-center text-xs text-stone-400">
                  Loading AI Browser...
                </div>
              }
            >
              <GeneralBrowserView
                policyConfig={policyConfig}
                onLogGuardDecisionToLedger={(decision: PolicyDecision, summary: string) => {
                  ledger.appendEvent({
                    actor: 'guard',
                    type: decision.allowed ? 'action_allowed' : 'action_blocked',
                    summary,
                    payload: JSON.stringify(decision),
                    trustLevel: 'verified_by_evidence',
                    missionId: 'ai-browser',
                  });
                  bumpLedger();
                }}
                onRequestApproval={(title, target, risk, reason) =>
                  handleRequestApproval(title, target, risk, reason)
                }
                onAskMorrowInChat={(contextPrompt) => {
                  setActiveView('chat');
                  handleSendMessage(contextPrompt);
                }}
                onSaveArtifact={(artifact) => {
                  handleSaveArtifactVersion({
                    title: artifact.name,
                    kind: 'markdown_doc',
                    language: 'markdown',
                    content: artifact.content,
                    summary: 'Saved from AI Browser',
                  });
                }}
                uiTheme={uiTheme}
              />
            </Suspense>
          </main>
        )}

        {/* VIEW 10: LIBRARY -> PLUGINS (Installed plugins only + Import, Create with Morrow, Download Template; no marketplace/catalog) */}
        {activeView === 'plugins' && (
          <UnifiedPluginsPageView
            plugins={installedPlugins}
            scopedRules={scopedRules}
            isLight={isLight}
            companionName={companionName}
            onTogglePlugin={(id) => {
              setInstalledPlugins((prev) =>
                prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
              );
              bumpLedger();
            }}
            onRemovePlugin={(id) => {
              setInstalledPlugins((prev) => prev.filter((p) => p.id !== id));
              ledger.appendEvent({
                actor: 'operator',
                type: 'plugin_removed',
                summary: `Removed plugin '${id}'.`,
                payload: JSON.stringify({ id }),
                trustLevel: 'verified_by_evidence',
                missionId: 'library-plugins',
              });
              bumpLedger();
            }}
            onAddPlugin={(plugin) => {
              // Prompt 2/4: Automatic pre-enable evaluation before enabling new/agent-created plugins
              const preEval = evaluateNewPluginBeforeEnable({
                plugin,
                runner: generalEvalRunnerRef.current!,
                reviewInbox: reviewInboxRef.current!,
                mode: modelMode,
              });
              setInstalledPlugins((prev) => [preEval.pluginWithDisabledState, ...prev]);
              setGeneralEvalRuns(generalEvalRunnerRef.current!.getHistory());
              setReviewProposals(reviewInboxRef.current!.getAll());
              ledger.appendEvent({
                actor: 'operator',
                type: 'plugin_added',
                summary: `Added plugin '${plugin.name}' (${plugin.origin}). Pre-enable check ${preEval.evalRun.runId}: ${preEval.evalRun.overallVerdict} (routed to Review).`,
                payload: JSON.stringify({
                  id: plugin.id,
                  name: plugin.name,
                  evalRunId: preEval.evalRun.runId,
                  verdict: preEval.evalRun.overallVerdict,
                }),
                trustLevel: 'verified_by_evidence',
                missionId: 'library-plugins',
              });
              bumpLedger();
            }}
          />
        )}

        {/* VIEW 11: PROOF -> REVIEW (Single inbox for skills, plugins, rules, personality edits, memory changes, schedules, connector writes, and extensions) */}
        {activeView === 'review' && (
          <UnifiedReviewInboxView
            proposals={reviewProposals}
            isLight={isLight}
            onDecideProposal={(id, decision) => {
              const res = reviewInboxRef.current!.decide(id, decision);
              const target = res.item;
              setReviewProposals(reviewInboxRef.current!.getAll());
              if (target) {
                if (decision === 'approved' && target.type === 'memory' && target.payload) {
                  unifiedMemoryStoreRef.current!.proposeOrSave({
                    text: String(target.payload.text || target.plainDiff.after),
                    category:
                      (target.payload.category as any) || 'People and places',
                    savedFrom: String(target.payload.savedFrom || 'Approved in Review'),
                    forceApprovedSensitive: true,
                  });
                  setUnifiedMemories(unifiedMemoryStoreRef.current!.getItems());
                } else if (
                  decision === 'approved' &&
                  target.type === 'plugin' &&
                  target.payload?.pluginId
                ) {
                  setInstalledPlugins((prev) =>
                    prev.map((p) =>
                      p.id === target.payload?.pluginId ? { ...p, enabled: true } : p
                    )
                  );
                }
                ledger.appendEvent({
                  actor: 'operator',
                  type:
                    decision === 'approved'
                      ? 'review_proposal_approved'
                      : 'review_proposal_rejected',
                  summary: `${
                    decision === 'approved' ? 'Approved' : 'Rejected'
                  } ${target.type} proposal: '${target.title}'.`,
                  payload: JSON.stringify({ id: target.id, type: target.type }),
                  trustLevel: 'verified_by_evidence',
                  missionId: 'proof-review',
                });
                bumpLedger();
              }
            }}
          />
        )}

        {/* VIEW 12: PROOF -> ACTIVITY (Plain words first; hashes/IDs behind 'Show details') */}
        {(activeView === 'activity' || activeView === 'ledger') && (
          <main className="flex-1 overflow-y-auto p-6" data-testid="proof-activity-view">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Activity Ledger</h2>
                  <p className="text-xs text-stone-400">
                    Tamper-evident record of every tool action, memory receipt, approval, and safety block.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                      chainReport.valid
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{chainReport.valid ? 'Verified chain intact' : 'Tamper detected'}</span>
                  </span>
                  {ledger.isTampered() ? (
                    <button
                      type="button"
                      onClick={() => {
                        ledger.restoreTamperedEvent();
                        bumpLedger();
                      }}
                      className="px-3 py-1 rounded-xl bg-emerald-600 text-white text-xs font-medium"
                    >
                      Restore integrity
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        ledger.simulateTamper(1);
                        bumpLedger();
                      }}
                      className="px-3 py-1 rounded-xl border border-stone-700 hover:bg-stone-800 text-xs"
                    >
                      Test tamper check
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-stone-800/70 bg-stone-900/40 max-w-md">
                <Search className="w-3.5 h-3.5 text-stone-400" />
                <input
                  type="text"
                  aria-label="Search ledger entries"
                  value={ledgerSearchQuery}
                  onChange={(e) => setLedgerSearchQuery(e.target.value)}
                  placeholder="Search activity events..."
                  className="bg-transparent text-xs outline-none w-full"
                />
              </div>

              <div className="divide-y divide-stone-800/60 rounded-2xl border border-stone-800/80 overflow-hidden">
                {filteredLedgerEvents.map((ev) => {
                  const isExpanded = expandedLedgerEventIds.includes(ev.id);
                  const statusLabel =
                    ev.type.includes('blocked') || ev.type.includes('denied') || ev.executionState === 'BLOCKED'
                      ? 'Blocked for safety'
                      : ev.type.includes('approval') || ev.executionState === 'WAITING_FOR_APPROVAL'
                        ? 'Needs your approval'
                        : ev.isSimulated || ev.executionState === 'SIMULATED' || ev.verificationState === 'SIMULATED'
                          ? 'Simulated (Preview)'
                          : ev.verificationState === 'UNCERTAIN'
                            ? 'Uncertain (Unverified)'
                            : 'Verified';
                  const statusTone =
                    statusLabel === 'Blocked for safety'
                      ? 'text-rose-400 bg-rose-500/10 border-rose-500/25'
                      : statusLabel === 'Needs your approval'
                        ? 'text-amber-400 bg-amber-500/10 border-amber-500/25'
                        : statusLabel === 'Simulated (Preview)'
                          ? 'text-sky-400 bg-sky-500/10 border-sky-500/25'
                          : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';

                  return (
                    <div
                      key={ev.id}
                      className={`p-4 space-y-2 text-xs ${
                        isLight ? 'bg-white' : 'bg-stone-900/60'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusTone}`}
                          >
                            {statusLabel}
                          </span>
                          <span className="font-medium text-sm">{ev.summary}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedLedgerEventIds((prev) =>
                                prev.includes(ev.id)
                                  ? prev.filter((id) => id !== ev.id)
                                  : [...prev, ev.id]
                              )
                            }
                            className="text-sky-400 hover:underline text-[11px]"
                          >
                            {isExpanded ? 'Hide details' : 'Show details'}
                          </button>
                          {!ev.contentDeleted && (
                            <button
                              type="button"
                              onClick={() => {
                                ledger.deleteContent(ev.contentRef);
                                bumpLedger();
                              }}
                              className="text-stone-400 hover:text-rose-400 text-[11px]"
                            >
                              Redact content
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-3 rounded-xl bg-black/30 border border-stone-800 font-mono text-[11px] text-stone-400 space-y-1">
                          <div>Event ID: {ev.id}</div>
                          <div>Entry Hash: {ev.entryHash}</div>
                          <div>Previous Hash: {ev.prevHash}</div>
                          <div>Payload: {ev.contentDeleted ? '[Redacted by user]' : ev.payload}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </main>
        )}

        {/* VIEW 13: PROOF -> EVALUATIONS (General Plugin & Connector Evaluations + 64-Task PC Benchmark Banner) */}
        {activeView === 'evaluations' && (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto px-6 pt-5">
              <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <Laptop className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <div className="font-semibold text-amber-200">
                      PC Operator 64-Task Everyday Benchmark & KPI Suite (Ladder-On vs Vision-Only)
                    </div>
                    <div className="text-stone-300">
                      64 deterministic tasks across Files, Browser, Documents, Email, Settings &amp; Multi-App with 0 false successes.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="open-pc-benchmark-from-evals-btn"
                  onClick={() => setActiveView('pc_operator')}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs"
                >
                  Open PC Operator &amp; 64-Task Suite →
                </button>
              </div>
            </div>
            <GeneralEvaluationsView
              plugins={installedPlugins}
              connectors={connectors}
              runner={generalEvalRunnerRef.current!}
              runs={generalEvalRuns}
              onRunsUpdated={(_latest, all) => setGeneralEvalRuns(all)}
              onSimulateNewPluginPreEnableEval={(pluginName) => {
                const candidatePlugin: InstalledPluginRecord = {
                  id: `plugin-${pluginName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()
                    .toString(36)
                    .slice(-4)}`,
                  name: pluginName,
                  version: '1.0.0',
                  enabled: false,
                  permissionsSummary:
                    'Read/write inside project sandbox; asks before external actions.',
                  permissions: ['notes:read', 'notes:write'],
                  origin: 'created_with_morrow',
                  manifestConstraints: [
                    {
                      actionClass: 'write',
                      mode: 'ask_first',
                      reason: 'Requires confirmation before writing.',
                    },
                  ],
                };
                const preEval = evaluateNewPluginBeforeEnable({
                  plugin: candidatePlugin,
                  runner: generalEvalRunnerRef.current!,
                  reviewInbox: reviewInboxRef.current!,
                  mode: modelMode,
                });
                setInstalledPlugins((prev) => [preEval.pluginWithDisabledState, ...prev]);
                setGeneralEvalRuns(generalEvalRunnerRef.current!.getHistory());
                setReviewProposals(reviewInboxRef.current!.getAll());
                bumpLedger();
              }}
              onNavigateToReview={() => setActiveView('review')}
              isLight={isLight}
            />
          </div>
        )}

        {/* VIEW 14: PC OPERATOR & BLAIZE DOCTOR (Prompt B: 4-Tier Action Ladder, Perception, Execution Loop, App Knowledge, Autonomy, Doctor, 64-Task Benchmark) */}
        {(activeView === 'pc_operator' || activeView === 'doctor' || activeView === 'apps_devices') && (
          <div className="flex-1 overflow-hidden">
            <PCOperatorView
              initialTab={activeView === 'doctor' ? 'doctor' : 'loop'}
              modelRouter={modelRouter}
              howMuchShouldIAsk={howMuchShouldIAsk}
              onChangeHowMuchShouldIAsk={setHowMuchShouldIAsk}
              onRecordAuditEvent={(summary, details) => {
                ledger.appendEvent({
                  actor: 'agent',
                  type: 'pc_operator_action',
                  summary,
                  payload: JSON.stringify(details),
                  trustLevel: 'verified_by_evidence',
                  missionId: 'pc-operator-run',
                });
                bumpLedger();
              }}
              onSendPatchToReview={(patch) => {
                ledger.appendEvent({
                  actor: 'operator',
                  type: 'skill_patch_approved',
                  summary: `Approved PC Skill Patch ${patch.patchId} for ${patch.appId}/${patch.skillName}`,
                  payload: JSON.stringify(patch),
                  trustLevel: 'verified_by_evidence',
                  missionId: 'pc-skill-patch',
                });
                bumpLedger();
              }}
            />
          </div>
        )}

        {/* VIEW 11: UNIFIED SETTINGS PAGE (General, Character, Role, Vault & Keys, Personality, Rules, Models, Voice, Privacy, Advanced) */}
        {activeView === 'settings' && (
          <main className="flex-1 overflow-y-auto p-6" data-testid="unified-settings-page">
            <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-6">
              {/* Settings Section Navigation (<= 3 words per label) */}
              <nav
                aria-label="Settings sections"
                className="w-full md:w-52 shrink-0 space-y-1"
              >
                {(
                  [
                    { id: 'general', label: 'General' },
                    { id: 'character', label: 'Character' },
                    { id: 'role', label: 'Role' },
                    { id: 'vault', label: 'Vault & Keys' },
                    { id: 'soul', label: 'Personality' },
                    { id: 'rules', label: 'Rules' },
                    { id: 'models', label: 'Models' },
                    { id: 'voice', label: 'Voice' },
                    { id: 'privacy', label: 'Privacy' },
                    { id: 'advanced', label: 'Advanced' },
                  ] as Array<{ id: SettingsSectionId; label: string }>
                ).map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    data-testid={`settings-nav-${sec.id}`}
                    onClick={() => setActiveSettingsSection(sec.id)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                      activeSettingsSection === sec.id
                        ? isLight
                          ? 'bg-sky-600 text-white'
                          : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                        : 'text-stone-400 hover:bg-stone-500/10 hover:text-stone-200'
                    }`}
                  >
                    {sec.label}
                  </button>
                ))}
              </nav>

              {/* Settings Active Section Content */}
              <div
                className={`flex-1 p-6 rounded-2xl border space-y-6 text-xs ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                }`}
              >
                {activeSettingsSection === 'general' && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold">General</h2>
                        <p className="text-stone-400 mt-0.5">
                          Theme, first-run briefing, usage suggestions, and documentation search.
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid="open-first-run-briefing-btn"
                        onClick={() => setOnboardingModalOpen(true)}
                        className="px-3 py-1.5 rounded-xl bg-sky-600 text-white font-medium"
                      >
                        First-Run Briefing
                      </button>
                    </div>
                    <div className="flex items-center justify-between py-3 border-t border-stone-800/50">
                      <div>
                        <div className="font-medium">Theme</div>
                        <div className="text-stone-400">
                          Switch between calm dark and light surfaces
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUiTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                        className="px-3.5 py-1.5 rounded-xl bg-sky-600 text-white font-medium"
                      >
                        {isLight ? 'Switch to Dark' : 'Switch to Light'}
                      </button>
                    </div>

                    {/* Assistant Rename, Size & Appearance in Settings */}
                    <div
                      data-testid="settings-general-companion-card"
                      className="py-3 border-t border-stone-800/50 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-sm">
                            Assistant Name, Size &amp; Appearance
                          </div>
                          <div className="text-stone-400">
                            Rename {companionName}, adjust the floating figure size ({characterParametricState.scalePct}%), or customize outfits in Settings.
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid="settings-open-character-appearance-btn"
                          onClick={() => setActiveSettingsSection('character')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Open Size &amp; Appearance Studio</span>
                        </button>
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleRenameCompanion(renameCompanionDraft);
                        }}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input
                          type="text"
                          data-testid="settings-general-rename-input"
                          value={renameCompanionDraft}
                          onChange={(e) => setRenameCompanionDraft(e.target.value)}
                          placeholder="Assistant name..."
                          className={`px-3 py-1.5 rounded-xl border text-xs font-medium outline-none focus:border-sky-500 ${
                            isLight
                              ? 'bg-stone-50 border-stone-300 text-stone-900'
                              : 'bg-stone-950 border-stone-800 text-stone-100'
                          }`}
                        />
                        <button
                          type="submit"
                          data-testid="settings-general-rename-save-btn"
                          className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs"
                        >
                          Save Name
                        </button>
                        <div className="flex items-center gap-1.5 ml-auto">
                          <span className="text-[11px] text-stone-400">Figure Size:</span>
                          {[85, 100, 125].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              data-testid={`settings-general-size-${pct}`}
                              onClick={() => {
                                const next = characterHistoryRef.current!.applyPatch({
                                  scalePct: pct,
                                });
                                setCharacterParametricState(next);
                                setCanUndoCharacter(characterHistoryRef.current!.canUndo());
                              }}
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${
                                characterParametricState.scalePct === pct
                                  ? 'bg-sky-600 text-white border-sky-500'
                                  : isLight
                                    ? 'bg-stone-50 border-stone-200 text-stone-700'
                                    : 'bg-stone-950 border-stone-800 text-stone-300'
                              }`}
                            >
                              {pct}%
                            </button>
                          ))}
                        </div>
                      </form>
                    </div>

                    {/* Setting: 'How much should I ask?' mapped to Autonomy Levels */}
                    <div
                      data-testid="settings-how-much-should-i-ask"
                      className="py-3 border-t border-stone-800/50 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-sm">
                            How much should I ask?
                          </div>
                          <div className="text-stone-400">
                            Choose how often {companionName} asks before running a handed-over chore.
                            Sensitive categories (people, money, identity, sending messages, deleting,
                            or ambiguity) always ask with clear options.
                          </div>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                          Human stays in charge
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {Object.values(HOW_MUCH_SHOULD_I_ASK_OPTIONS).map((opt) => {
                          const active = howMuchShouldIAsk === opt.preference;
                          return (
                            <button
                              key={opt.preference}
                              type="button"
                              data-testid={`settings-how-much-ask-${opt.preference}`}
                              onClick={() => setHowMuchShouldIAsk(opt.preference)}
                              className={`text-left p-3 rounded-xl border transition-colors ${
                                active
                                  ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                                  : isLight
                                    ? 'bg-stone-50 border-stone-200 text-stone-700 hover:border-stone-300'
                                    : 'bg-stone-950/70 border-stone-800 text-stone-300 hover:border-stone-700'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 font-semibold">
                                <span>{opt.label}</span>
                                {opt.isDefault && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-500/20 text-stone-300">
                                    Default
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-stone-400 mt-1">
                                {opt.description}
                              </div>
                              <div className="text-[10px] font-mono text-emerald-400 mt-1.5">
                                Maps to: {opt.mappedAutonomyLevel}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Local Usage Suggestions Inbox */}
                    <div className="pt-3 border-t border-stone-800/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">
                            Suggestions Inbox ({usageSuggestions.length})
                          </div>
                          <div className="text-stone-400">
                            Local usage insights awaiting your review.
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSuggestionsEnabled((v) => !v)}
                            className={`px-2.5 py-1 rounded-lg border ${
                              suggestionsEnabled
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                : 'border-stone-700 text-stone-400'
                            }`}
                          >
                            {suggestionsEnabled ? 'Enabled' : 'Paused'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setUsageSuggestions([])}
                            className="px-2.5 py-1 rounded-lg border border-stone-700 hover:bg-stone-800"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      {suggestionsEnabled &&
                        usageSuggestions.map((s) => (
                          <div
                            key={s.id}
                            className="p-3 rounded-xl border border-stone-800/70 flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="font-medium">{s.title}</div>
                              <div className="text-stone-400">{s.reason}</div>
                            </div>
                            <span className="text-sky-400 font-medium">
                              {s.suggestedActionLabel}
                            </span>
                          </div>
                        ))}
                    </div>

                    {/* In-App Help Search */}
                    <div className="pt-3 border-t border-stone-800/50 space-y-2">
                      <div className="font-semibold">Documentation Search</div>
                      <input
                        type="text"
                        value={helpSearchQuery}
                        onChange={(e) => setHelpSearchQuery(e.target.value)}
                        placeholder="Search runtime, Vault, Character Studio, or rules..."
                        className={`w-full px-3 py-1.5 rounded-xl border ${
                          isLight
                            ? 'bg-stone-50 border-stone-200'
                            : 'bg-stone-950 border-stone-800'
                        }`}
                      />
                      <div className="space-y-1.5">
                        {searchInAppHelp(helpSearchQuery).map((doc) => (
                          <div
                            key={doc.id}
                            className="p-2.5 rounded-xl border border-stone-800/60"
                          >
                            <div className="font-medium">{doc.title}</div>
                            <div className="text-stone-400">{doc.summary}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                {/* SETTINGS > CHARACTER (Character Studio) & MORROW */}
                {(activeSettingsSection === 'character' ||
                  activeSettingsSection === 'morrow') && (
                  <CharacterStudioPanel
                    companionName={companionName}
                    onChangeCompanionName={handleRenameCompanion}
                    activeLookId={activeLookId}
                    onChangeLookId={setActiveLookId}
                    activeLive2DProportion={activeLive2DProportion}
                    onChangeLive2DProportion={setActiveLive2DProportion}
                    activeLive2DProp={activeLive2DProp}
                    onChangeLive2DProp={setActiveLive2DProp}
                    parametricState={characterParametricState}
                    canUndo={canUndoCharacter}
                    onApplyPatch={(patch: CharacterPatch, description: string) => {
                      const next = characterHistoryRef.current!.applyPatch(patch);
                      setCharacterParametricState(next);
                      setCanUndoCharacter(characterHistoryRef.current!.canUndo());
                      ledger.appendEvent({
                        actor: 'operator',
                        type: 'character_patch_applied',
                        summary: `Character Studio: ${description}`,
                        payload: JSON.stringify(patch),
                        trustLevel: 'verified_by_evidence',
                        missionId: 'character-studio',
                      });
                      bumpLedger();
                    }}
                    onUndo={() => {
                      const prev = characterHistoryRef.current!.undo();
                      setCharacterParametricState(prev);
                      setCanUndoCharacter(characterHistoryRef.current!.canUndo());
                      ledger.appendEvent({
                        actor: 'operator',
                        type: 'character_patch_undo',
                        summary: 'Reverted character adjustment via Undo.',
                        payload: JSON.stringify(prev),
                        trustLevel: 'verified_by_evidence',
                        missionId: 'character-studio',
                      });
                      bumpLedger();
                    }}
                    onResetToDefault={() => {
                      const def = characterHistoryRef.current!.resetToDefault();
                      setCharacterParametricState(def);
                      setCanUndoCharacter(characterHistoryRef.current!.canUndo());
                      ledger.appendEvent({
                        actor: 'operator',
                        type: 'character_patch_reset',
                        summary: 'Reset character figure to default parameters.',
                        payload: JSON.stringify(def),
                        trustLevel: 'verified_by_evidence',
                        missionId: 'character-studio',
                      });
                      bumpLedger();
                    }}
                    isLiveModelMode={modelMode === 'live'}
                    isLight={isLight}
                    onRecordLedgerEvent={(summary, payload) => {
                      ledger.appendEvent({
                        actor: 'operator',
                        type: 'character_pack_event',
                        summary,
                        payload: JSON.stringify(payload),
                        trustLevel: 'verified_by_evidence',
                        missionId: 'character-studio',
                      });
                      bumpLedger();
                    }}
                  />
                )}

                {/* SETTINGS > ROLE (Standing Role & Job Description from First-Run Briefing) */}
                {activeSettingsSection === 'role' && (
                  <section className="space-y-4" data-testid="settings-role-section">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold">Standing Role &amp; Boundaries</h2>
                        <p className="text-stone-400 mt-0.5">
                          Edit what {companionName} does for you, authorized devices, and what is off limits.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOnboardingModalOpen(true)}
                        className="px-3 py-1.5 rounded-xl bg-sky-600 text-white font-medium"
                      >
                        Re-run Briefing Wizard
                      </button>
                    </div>

                    <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 space-y-2">
                      <div className="font-semibold text-sky-300">
                        &ldquo;Here is what I understand my job to be&rdquo;
                      </div>
                      <textarea
                        rows={3}
                        data-testid="settings-role-summary-input"
                        value={standingRoleSummaryCard}
                        onChange={(e) => setStandingRoleSummaryCard(e.target.value)}
                        className={`w-full p-2.5 rounded-xl border text-xs ${
                          isLight ? 'bg-white border-stone-200' : 'bg-stone-950 border-stone-800'
                        }`}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-stone-400 mb-1 font-medium">
                          Job Description
                        </label>
                        <textarea
                          rows={3}
                          value={standingJobDescription}
                          onChange={(e) => setStandingJobDescription(e.target.value)}
                          className={`w-full p-2.5 rounded-xl border ${
                            isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                          }`}
                        />
                      </div>
                      <div>
                        <label className="block text-stone-400 mb-1 font-medium">
                          Strictly Off Limits
                        </label>
                        <textarea
                          rows={3}
                          value={standingOffLimits}
                          onChange={(e) => setStandingOffLimits(e.target.value)}
                          className={`w-full p-2.5 rounded-xl border ${
                            isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                          }`}
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* SETTINGS > VAULT & KEYS */}
                {activeSettingsSection === 'vault' && (
                  <KeyVaultPanel
                    isLight={isLight}
                    onTestServerConnection={async () => {
                      const res = await modelRouter.testConnection();
                      setConnectionTestResult(res);
                      return res;
                    }}
                    connectionTestResult={connectionTestResult}
                    onRecordLedgerEvent={(summary, payload) => {
                      ledger.appendEvent({
                        actor: 'operator',
                        type: 'vault_key_event',
                        summary,
                        payload: JSON.stringify(payload),
                        trustLevel: 'verified_by_evidence',
                        missionId: 'secret-vault',
                      });
                      bumpLedger();
                    }}
                  />
                )}

                {/* SETTINGS > SOUL (Same unified Soul & Personality view: identity, voice style, role/job description, personality template — no memory and no skills) */}
                {activeSettingsSection === 'soul' && (
                  <UnifiedSoulPageView
                    soulProfile={soulProfile}
                    onUpdateSoulProfile={(next) => {
                      setSoulProfile(next);
                      handleRenameCompanion(next.identity.name);
                      bumpLedger();
                    }}
                    isLight={isLight}
                  />
                )}

                {activeSettingsSection === 'rules' && (
                  <UnifiedRulesPageView
                    rules={scopedRules}
                    plugins={installedPlugins}
                    onAddRule={(r) => setScopedRules((prev) => [r, ...prev])}
                    onToggleRule={(id) =>
                      setScopedRules((prev) =>
                        prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
                      )
                    }
                    onDeleteRule={(id) =>
                      setScopedRules((prev) => prev.filter((r) => r.id !== id))
                    }
                    isLight={isLight}
                  />
                )}

                {activeSettingsSection === 'models' && (
                  <section className="space-y-4" data-testid="settings-models-section">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold">
                          ModelRouter &amp; Meta Model API
                        </h2>
                        <p className="text-stone-400 mt-0.5">
                          Mock mode by default; Live mode routes through server proxy using Vault keys.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const nextMode: ModelRouterMode =
                              modelMode === 'mock' ? 'live' : 'mock';
                            setModelMode(nextMode);
                            modelRouter.setMode(nextMode);
                          }}
                          className="px-3 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 font-medium"
                        >
                          Mode: {modelMode === 'mock' ? 'Mock (Default)' : 'Live API'}
                        </button>
                        <button
                          type="button"
                          data-testid="test-model-connection-btn"
                          onClick={async () => {
                            const res = await modelRouter.testConnection();
                            setConnectionTestResult(res);
                          }}
                          className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium"
                        >
                          Test Connection
                        </button>
                      </div>
                    </div>

                    {connectionTestResult && (
                      <div
                        data-testid="model-connection-test-banner"
                        className={`p-3.5 rounded-xl border space-y-2 ${
                          connectionTestResult.ok
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        <div className="font-semibold">
                          Connection Test ({connectionTestResult.mode.toUpperCase()}):{' '}
                          {connectionTestResult.mode === 'mock'
                            ? 'SIMULATED (MOCK MODE)'
                            : connectionTestResult.ok
                              ? 'LIVE INFERENCE & TOOL-CALLING VERIFIED'
                              : 'UNAVAILABLE (No silent fallback)'}
                        </div>
                        <div>{connectionTestResult.message}</div>
                        <div
                          data-testid="model-health-matrix"
                          className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 text-[11px]"
                        >
                          <div className="px-2 py-1 rounded bg-stone-950/60 border border-stone-800">
                            <span className="text-stone-400 block">API Key Configured</span>
                            <span className="font-semibold">
                              {connectionTestResult.apiKeyConfigured ? 'Yes' : 'No'}
                            </span>
                          </div>
                          <div className="px-2 py-1 rounded bg-stone-950/60 border border-stone-800">
                            <span className="text-stone-400 block">Catalogue Reachable</span>
                            <span className="font-semibold">
                              {connectionTestResult.catalogueReachable ? 'Yes' : 'No'}
                            </span>
                          </div>
                          <div className="px-2 py-1 rounded bg-stone-950/60 border border-stone-800">
                            <span className="text-stone-400 block">Inference Succeeded</span>
                            <span className="font-semibold">
                              {connectionTestResult.inferenceSucceeded ? 'Yes' : 'No'}
                            </span>
                          </div>
                          <div className="px-2 py-1 rounded bg-stone-950/60 border border-stone-800">
                            <span className="text-stone-400 block">Tool Calling Supported</span>
                            <span className="font-semibold">
                              {connectionTestResult.toolCallingSupported ? 'Yes' : 'No'}
                            </span>
                          </div>
                          <div className="px-2 py-1 rounded bg-stone-950/60 border border-stone-800">
                            <span className="text-stone-400 block">Model Status</span>
                            <span className="font-semibold">
                              {connectionTestResult.modelAvailable ? 'Available' : 'Unavailable'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="divide-y divide-stone-800/60 border border-stone-800 rounded-xl overflow-hidden">
                      {(Array.isArray(LOCAL_DEMO_MODEL_PROVIDER_STATUS)
                        ? LOCAL_DEMO_MODEL_PROVIDER_STATUS
                        : (LOCAL_DEMO_MODEL_PROVIDER_STATUS as any)?.models || []
                      ).map((m: any) => (
                        <div
                          key={m.role || m.modelId}
                          className="p-3.5 flex items-center justify-between gap-4"
                        >
                          <div>
                            <div className="font-medium">{m.modelId}</div>
                            <div className="text-stone-400">{m.honestNote}</div>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 whitespace-nowrap">
                            {modelMode === 'live' ? 'Server Proxy' : 'Simulated'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {activeSettingsSection === 'voice' && (
                  <section className="space-y-4">
                    <div>
                      <h2 className="text-base font-semibold">Voice and identity</h2>
                      <p className="text-stone-400 mt-0.5">
                        Push-to-talk microphone and automatic audio ducking when {companionName}{' '}
                        speaks.
                      </p>
                    </div>
                    <div className="p-4 rounded-xl border border-stone-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span>Automatic audio ducking during speech</span>
                        <span className="text-emerald-400">Enabled</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Push-to-talk shortcut</span>
                        <kbd className="px-2 py-0.5 rounded bg-stone-800">Mic button</kbd>
                      </div>
                    </div>
                  </section>
                )}

                {activeSettingsSection === 'privacy' && (
                  <section className="space-y-4">
                    <div>
                      <h2 className="text-base font-semibold">
                        Privacy, Desktop Apps Stage (SIMULATED) & Persistence
                      </h2>
                      <p className="text-stone-400 mt-0.5">
                        Browser credential isolation, Desktop App grants (SIMULATED), and versioned
                        persistence (`schemaVersion: 2`).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="font-semibold">
                        Desktop App Grants (SIMULATED on Desktop Stage)
                      </div>
                      {desktopAppGrants.map((app) => (
                        <div
                          key={app.id}
                          className="p-3 rounded-xl border border-stone-800 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div>
                            <div className="font-medium">
                              {app.appName}{' '}
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                                SIMULATED
                              </span>
                            </div>
                            <div className="text-stone-400">Category: {app.category}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDesktopAppGrants((prev) =>
                                prev.map((g) =>
                                  g.id === app.id
                                    ? {
                                        ...g,
                                        mode:
                                          g.mode === 'blocked_by_default'
                                            ? 'explore_read_only'
                                            : g.mode === 'explore_read_only'
                                              ? 'teach_enabled'
                                              : 'blocked_by_default',
                                      }
                                    : g
                                )
                              )
                            }
                            className="px-2.5 py-1 rounded-lg border border-stone-700 hover:bg-stone-800"
                          >
                            {app.mode === 'blocked_by_default'
                              ? 'Blocked by default'
                              : app.mode === 'explore_read_only'
                                ? 'Explore (read-only)'
                                : 'Teach enabled'}
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Memory Purge Card */}
                    <div
                      data-testid="settings-memory-purge-card"
                      className="p-4 rounded-2xl border border-stone-800 bg-stone-900/40 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-sm text-stone-100 flex items-center gap-2">
                            <Trash2 className="w-4 h-4 text-rose-400" />
                            <span>Memory &amp; Cache Purge</span>
                          </div>
                          <div className="text-stone-400 text-xs">
                            Clear non-pinned chat threads and old cached artifact snapshots to reclaim memory and optimize performance. Pinned threads and active project files are preserved with reversible backup recovery.
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            data-testid="settings-memory-purge-btn"
                            onClick={() => handleOpenMemoryPurgeModal('all')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-md transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Memory Purge</span>
                          </button>
                        </div>
                      </div>

                      {/* Purge Confirmation & Preview Modal */}
                      {showPurgeModal && memoryPurgePreview && (
                        <div
                          data-testid="memory-purge-preview-modal"
                          className="mt-3 p-4 rounded-xl border border-rose-500/40 bg-stone-950/90 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-semibold text-xs text-rose-300 flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4 text-rose-400" />
                              <span>Confirm Memory &amp; Cache Purge</span>
                            </div>
                            <span className="text-[11px] text-stone-400">Confirmation Required</span>
                          </div>

                          <div className="text-xs text-stone-300 space-y-1">
                            <div>• <strong className="text-emerald-400">Preserved:</strong> {memoryPurgePreview.pinnedThreadsToPreserve.length} pinned thread(s) and currently active workspace.</div>
                            <div>• <strong className="text-rose-400">Purged:</strong> {memoryPurgePreview.threadsToPurge.length} unpinned thread(s) and {memoryPurgePreview.snapshotsToPruneCount} cached snapshot(s).</div>
                            <div>• <strong className="text-sky-400">Reclaimed:</strong> ~{Math.round(memoryPurgePreview.estimatedBytesReclaimed / 1024)} KB memory.</div>
                          </div>

                          <div className="flex items-center gap-2 pt-2 border-t border-stone-800">
                            <button
                              type="button"
                              data-testid="confirm-purge-btn"
                              onClick={handleConfirmMemoryPurge}
                              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors"
                            >
                              Confirm Permanent Purge
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowPurgeModal(false)}
                              className="px-3 py-1.5 rounded-lg border border-stone-700 hover:bg-stone-800 text-stone-300 text-xs transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {memoryPurgeNotice && (
                        <div
                          data-testid="memory-purge-success-banner"
                          className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>{memoryPurgeNotice.message}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {lastPurgeArchiveId && (
                              <button
                                type="button"
                                data-testid="memory-purge-restore-btn"
                                onClick={handleRestoreMemoryPurge}
                                className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-semibold transition-colors"
                              >
                                Undo / Restore
                              </button>
                            )}
                            <span className="text-[11px] text-emerald-400/80">{memoryPurgeNotice.timestamp}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-stone-800/60 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold">Versioned Workspace Persistence (v2)</div>
                        <div className="text-stone-400">
                          Save or reset `~/.blaize/SOUL.md`, `MEMORY.md`, and `RULES.json`.
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            savePersistedSnapshotSync({
                              schemaVersion: 2,
                              updatedAtIso: new Date().toISOString(),
                              onboardingCompleted: true,
                              companionName,
                              modelRouterMode: modelMode,
                              secretCodeDigest,
                              biometricSimulatedEnabled: biometricSimulated,
                              suggestionsEnabled,
                              rules: ruleBook,
                              virtualFiles: {
                                '~/.blaize/SOUL.md': soulDocument.rawMarkdown,
                                '~/.blaize/memories/MEMORY.md': formatMemoryMarkdown(memoryEntries),
                                '~/.blaize/rules/RULES.json': JSON.stringify(ruleBook, null, 2),
                              },
                            });
                          }}
                          className="px-3 py-1.5 rounded-xl bg-sky-600 text-white font-medium"
                        >
                          Save Snapshot
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const resetSnap = clearPersistedSnapshotSync();
                            setRuleBook(resetSnap.rules);
                            handleRenameCompanion(resetSnap.companionName);
                          }}
                          className="px-3 py-1.5 rounded-xl border border-stone-700 text-rose-400 hover:bg-stone-800"
                        >
                          Reset Data
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {activeSettingsSection === 'advanced' && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold">Advanced</h2>
                        <p className="text-stone-400 mt-0.5">
                          Platform adapter contract and subsystem diagnostics.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAdvancedInventory((v) => !v)}
                        className="px-3 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800"
                      >
                        {showAdvancedInventory ? 'Hide details' : 'Show details'}
                      </button>
                    </div>

                    {showAdvancedInventory && (
                      <div className="overflow-x-auto border border-stone-800 rounded-xl p-3">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead>
                            <tr className="border-b border-stone-800 text-stone-400">
                              <th className="py-1.5 pr-3">Feature</th>
                              <th className="py-1.5 pr-3">Status</th>
                              <th className="py-1.5">Test</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-800/60">
                            {FEATURE_WIRING_INVENTORY.map((row) => (
                              <tr key={row.feature}>
                                <td className="py-1.5 pr-3 font-medium">{row.feature}</td>
                                <td className="py-1.5 pr-3 text-sky-400">{row.realismStatus}</td>
                                <td className="py-1.5 font-mono text-emerald-400">
                                  {row.testReference}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </main>
        )}

        {/* Invisible floor line anchor for PerchTargets ('screen-floor') */}
        <div
          data-perch-id="screen-floor"
          aria-hidden="true"
          className="pointer-events-none fixed bottom-0 right-0 w-40 h-2"
        />
      </div>
      </>
      )}

      {/* COMMAND PALETTE MODAL (Ctrl/Cmd+K) */}
      {commandPaletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command Palette"
          data-testid="command-palette-modal"
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-xs p-4"
          onClick={() => setCommandPaletteOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden ${
              isLight ? 'bg-white border-stone-200 text-stone-900' : 'bg-stone-900 border-stone-800 text-stone-100'
            }`}
          >
            <div className="p-3.5 border-b border-stone-800/60 flex items-center gap-2.5">
              <Search className="w-4 h-4 text-sky-400 shrink-0" />
              <input
                type="text"
                autoFocus
                aria-label="Search chats, skills, plugins, rules, settings and help"
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder="Search chats, skills, plugins, rules, settings, and help..."
                className="flex-1 bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(false)}
                className="p-1 rounded-lg hover:bg-stone-500/15 text-stone-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category filter tabs */}
            <div className="px-3.5 py-2 border-b border-stone-800/40 flex flex-wrap gap-1 text-[11px]">
              {(['all', 'chat', 'skill', 'plugin', 'rule', 'setting', 'help'] as const).map(
                (cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCommandCategory(cat)}
                    className={`px-2.5 py-0.5 rounded-lg capitalize transition-colors ${
                      commandCategory === cat
                        ? 'bg-sky-600 text-white font-medium'
                        : 'text-stone-400 hover:bg-stone-500/15'
                    }`}
                  >
                    {cat}
                  </button>
                )
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-stone-800/40 p-2">
              {commandPaletteResults.length === 0 ? (
                <div className="py-8 text-center text-xs text-stone-400">
                  No matching commands found. Try searching for &ldquo;skills&rdquo;,
                  &ldquo;memory&rdquo;, or &ldquo;review&rdquo;.
                </div>
              ) : (
                commandPaletteResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectCommandItem(item)}
                    className="w-full px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 text-left hover:bg-sky-500/10 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{item.title}</div>
                      <div className="text-[11px] text-stone-400 truncate">{item.subtitle}</div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-stone-500/15 text-stone-400 capitalize shrink-0">
                      {item.category}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* KEYBOARD SHORTCUTS SHEET (?) */}
      {shortcutsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          data-testid="keyboard-shortcuts-sheet"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl space-y-4 text-xs ${
              isLight ? 'bg-white border-stone-200 text-stone-900' : 'bg-stone-900 border-stone-800 text-stone-100'
            }`}
          >
            <div className="flex items-center justify-between border-b border-stone-800/60 pb-3">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Keyboard className="w-4 h-4 text-sky-400" />
                <span>Keyboard shortcuts</span>
              </div>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close shortcuts"
                className="p-1 rounded-lg hover:bg-stone-500/15"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2.5">
              {[
                { label: 'Open Command Palette', keys: 'Ctrl / Cmd + K' },
                { label: 'Stop running chore & hand control back', keys: 'Alt + Shift + S' },
                { label: `Toggle ${companionName} Chat Popover`, keys: 'Alt + M' },
                { label: `Collapse ${companionName} to Status Dot`, keys: 'Alt + H' },
                { label: 'Show Keyboard Shortcuts', keys: '?' },
                { label: 'Close active popover or sheet', keys: 'Esc' },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between py-1">
                  <span className="text-stone-300">{s.label}</span>
                  <kbd className="px-2 py-1 rounded bg-stone-800 text-stone-200 font-mono text-[11px]">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FIRST-RUN BRIEFING MODAL (Name Companion, Role Templates, Job Description, Off Limits, Vault Identity, Spoken Summary Card) */}
      <FirstRunBriefingModal
        isOpen={onboardingModalOpen && !isBlaizeWindowClosed}
        onClose={() => setOnboardingModalOpen(false)}
        isLight={isLight}
        companionName={companionName}
        onChangeCompanionName={handleRenameCompanion}
        selectedTemplates={selectedRoleTemplates}
        onChangeSelectedTemplates={setSelectedRoleTemplates}
        jobDescription={standingJobDescription}
        onChangeJobDescription={setStandingJobDescription}
        offLimits={standingOffLimits}
        onChangeOffLimits={setStandingOffLimits}
        secretCodeInput={onboardingPinInput}
        onChangeSecretCodeInput={setOnboardingPinInput}
        biometricSimulated={biometricSimulated}
        onToggleBiometricSimulated={() => setBiometricSimulated((v) => !v)}
        modelMode={modelMode}
        onTestConnection={async () => {
          const res = await modelRouter.testConnection();
          setConnectionTestResult(res);
          return res;
        }}
        connectionTestResult={connectionTestResult}
        onApproveBriefing={(artifacts, approvedSummary) => {
          setStandingRoleSummaryCard(approvedSummary);
          setUserMarkdown(artifacts.userMarkdown);
          const nextSoulMd = `${soulDocument.rawMarkdown.split('## Standing Role')[0].trim()}\n\n${artifacts.roleSectionMarkdown}\n`;
          setSoulDocument(
            parseAndValidateSoulDocument(
              nextSoulMd,
              soulDocument.voiceCadence,
              soulDocument.version + 1
            )
          );
          const nextDigest =
            onboardingPinInput && onboardingPinInput.trim().length >= 4
              ? deriveSecretCodePBKDF2(onboardingPinInput.trim())
              : undefined;
          setSecretCodeDigest(nextDigest);
          ledger.appendEvent({
            actor: 'operator',
            type: 'first_run_briefing_approved',
            summary: `Approved First-Run Briefing for ${artifacts.companionName}: "${approvedSummary.slice(0, 80)}..."`,
            payload: JSON.stringify({
              companionName: artifacts.companionName,
              suggestedRules: artifacts.suggestedRules,
              suggestedPlugins: artifacts.suggestedPlugins,
            }),
            trustLevel: 'verified_by_evidence',
            missionId: 'first-run-briefing',
          });
          bumpLedger();
        }}
      />

      {/* CONSENT SHEET MODAL (Asked Every Time Before Screen / In-App Recording) */}
      {consentSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Recording Consent Sheet"
          data-testid="recording-consent-sheet"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
          onClick={() => setConsentSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isLight
                ? 'bg-white border-stone-200 text-stone-900'
                : 'bg-stone-900 border-stone-800 text-stone-100'
            }`}
          >
            <div className="flex items-center justify-between border-b border-stone-800/60 pb-3">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-rose-500" />
                <h2 className="text-base font-semibold">
                  Screen &amp; Workflow Recording Consent
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setConsentSheetOpen(false)}
                className="p-1 rounded-lg hover:bg-stone-500/15"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-stone-300 leading-relaxed">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 space-y-1">
                <div className="font-semibold">What will &amp; will not be captured:</div>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  <li>
                    <strong>Captured:</strong> The entire display you select, as local video-only WebM segments, plus sampled JPEG keyframes and in-app event notes.
                  </li>
                  <li>
                    <strong>Privacy boundary:</strong> Detected in-app password/OTP/PIN values are redacted and can auto-pause. Native display video cannot reliably identify every sensitive field in every external application; close sensitive windows and pause capture before entering private data.
                  </li>
                  <li>
                    <strong>Local storage:</strong> Recording data is stored locally but this recorder layer does not encrypt SQLite/IndexedDB media at rest. Anyone with access to the local app data directory may be able to read retained recordings.
                  </li>
                  <li>
                    <strong>Review First:</strong> Video and frame segments stay in local storage. Nothing is uploaded or sent to a model by the recorder; review the recording before compiling a skill.
                  </li>
                  <li>
                    <strong>How to Stop Anytime:</strong> Click the red Stop button on {companionName} or
                    press <kbd className="px-1.5 py-0.5 rounded bg-stone-800 font-mono">Alt+Shift+R</kbd>.
                  </li>
                </ul>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-stone-200">
                  Capture Source
                </label>
                <select
                  value={recorderSourceType}
                  onChange={(e) => setRecorderSourceType(e.target.value as RecorderSourceType)}
                  data-testid="consent-source-select"
                  className={`w-full px-3 py-2 rounded-xl border ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                  }`}
                >
                  <option value="in_app">In-app events (Real DOM &amp; Desktop Stage)</option>
                  <option value="screen">Selected display (video + keyframes; native picker in desktop app)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-stone-200">
                  Local Retention (SQLite on desktop, IndexedDB in browser preview)
                </label>
                <select
                  value={consentRetention}
                  onChange={(e) =>
                    setConsentRetention(
                      e.target.value as 'delete_after_compile' | 'keep_24h' | 'keep_until_deleted'
                    )
                  }
                  data-testid="consent-retention-select"
                  className={`w-full px-3 py-2 rounded-xl border ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                  }`}
                >
                  <option value="delete_after_compile">
                    Delete video and keyframes immediately after skill compile (Default)
                  </option>
                  <option value="keep_until_deleted">Keep locally until manually deleted</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-stone-200">
                  Blocked Sensitive App Categories (Auto-Pauses Recording)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {blockedAppCategories.map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-800 text-stone-200 text-[11px]"
                    >
                      <span>{cat}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setBlockedAppCategories((prev) => prev.filter((c) => c !== cat))
                        }
                        className="text-stone-400 hover:text-rose-400"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newBlockedCategoryInput}
                    onChange={(e) => setNewBlockedCategoryInput(e.target.value)}
                    placeholder="Add sensitive app category (e.g. payroll_portal)..."
                    className={`flex-1 px-3 py-1.5 rounded-xl border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newBlockedCategoryInput.trim()) {
                        setBlockedAppCategories((prev) => [
                          ...prev,
                          newBlockedCategoryInput.trim(),
                        ]);
                        setNewBlockedCategoryInput('');
                      }
                    }}
                    className="px-3 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-800/60">
              <button
                type="button"
                onClick={() => setConsentSheetOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-stone-700 text-stone-300"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="consent-approve-start-recording-btn"
                onClick={handleStartRecordingAfterConsent}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold"
              >
                I Consent — Start Recording
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ASK-MODE SINGLE SCREENSHOT PREVIEW MODAL ("look at my screen") */}
      {askScreenPreviewModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Single Screenshot Preview"
          data-testid="ask-screen-preview-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
          onClick={() => setAskScreenPreviewModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isLight
                ? 'bg-white border-stone-200 text-stone-900'
                : 'bg-stone-900 border-stone-800 text-stone-100'
            }`}
          >
            <div className="flex items-center justify-between border-b border-stone-800/60 pb-3">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-semibold">
                  Approve Single Screenshot (&ldquo;Look at my screen&rdquo;)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAskScreenPreviewModalOpen(false)}
                className="p-1 rounded-lg hover:bg-stone-500/15"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-stone-300">
              You asked {companionName} to look at your screen. In <strong>Ask Mode</strong>, Blaize captures
              a single downscaled snapshot and shows this preview before anything is analyzed.
            </p>
            <div className="p-4 rounded-xl bg-stone-950 border border-stone-800 font-mono text-[11px] text-stone-300 space-y-1">
              <div>Snapshot: Active Workspace View ({activeView})</div>
              <div>Resolution: 640×360 JPEG · Credential fields redacted</div>
              <div>Prompt: &ldquo;{pendingAskScreenPrompt}&rdquo;</div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAskScreenPreviewModalOpen(false)}
                className="px-3 py-1.5 rounded-xl border border-stone-700 text-stone-300"
              >
                Discard Snapshot
              </button>
              <button
                type="button"
                data-testid="approve-ask-screen-snapshot-btn"
                onClick={() => {
                  setAskScreenPreviewModalOpen(false);
                  setScreenAwarenessMode('ask');
                  const replyMsg: ChatTurnMessage = {
                    id: `a-screen-${Date.now()}`,
                    role: 'assistant',
                    content: `I inspected your approved single screen snapshot of the **${activeView}** workspace (no continuous monitoring; credential fields masked). I can help you automate this view or record it into a reusable skill.`,
                    timestamp: new Date().toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                    toolsUsed: ['Screen Snapshot (Approved Single Frame)'],
                    verifiedProof: {
                      hash: computeDeterministicHash(`ask-screen|${Date.now()}`).slice(0, 16),
                      summary: 'Verified · User approved single screenshot preview before analysis',
                    },
                  };
                  setThreads((prev) =>
                    prev.map((th) =>
                      th.id === activeThread.id
                        ? { ...th, messages: [...th.messages, replyMsg] }
                        : th
                    )
                  );
                }}
                className="px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
              >
                Approve &amp; Send Snapshot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MORROW COMPANION (Perches on composer-top in Chat with legs dangling, or panel edges elsewhere) */}
      <MorrowCompanion
        morrowState={morrowState}
        setMorrowState={setMorrowState}
        personalityId={personalityId}
        setPersonalityId={setPersonalityId}
        talkLogs={talkLogs}
        focusMode={focusMode}
        setFocusMode={setFocusMode}
        onDismissNotification={() => setDismissalCount((c) => c + 1)}
        dismissalCount={dismissalCount}
        pendingApproval={pendingApproval}
        onApproveAction={handleApproveAction}
        onRejectAction={handleRejectAction}
        onSimulateOnlyAction={() => handleApproveAction('local_sheet')}
        onRecordUserCorrection={() => bumpLedger()}
        onSubmitVoiceMission={(transcript) => handleSendMessage(transcript)}
        companionName={companionName}
        onChangeCompanionName={handleRenameCompanion}
        companionScale={characterParametricState.scalePct / 100}
        onChangeCompanionScale={(scale) => {
          const next = characterHistoryRef.current!.applyPatch({
            scalePct: Math.round(scale * 100),
          });
          setCharacterParametricState(next);
          setCanUndoCharacter(characterHistoryRef.current!.canUndo());
        }}
        activeLookId={activeLookId}
        onChangeLookId={setActiveLookId}
        activeAnimAction={activeAnimAction}
        onChangeAnimAction={handleTriggerAnimationAction}
        activeLive2DProp={activeLive2DProp}
        onChangeLive2DProp={setActiveLive2DProp}
        activeLive2DExpression={activeLive2DExpression}
        onChangeLive2DExpression={setActiveLive2DExpression}
        activeLive2DProportion={activeLive2DProportion}
        onChangeLive2DProportion={setActiveLive2DProportion}
        isPlayingMusic={isPlayingMusic}
        onToggleMusic={() => setIsPlayingMusic((v) => !v)}
        voiceEnabled={voiceEnabled}
        onToggleVoice={handleToggleVoice}
        uiTheme={uiTheme}
        onToggleUiTheme={() => setUiTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        activeView={activeView}
        isChatViewOpen={activeView === 'chat'}
        sidebarCollapsed={sidebarCollapsed}
        chatArtifactDrawerOpen={chatArtifactDrawerOpen}
        artifactDrawerWidthPx={artifactDrawerWidthPx}
        onJumpToChat={() => setActiveView('chat')}
        onOpenSoulView={() => {
          setSkillsSubTab('soul');
          setActiveView('soul');
        }}
        onOpenSettingsSection={(sec) => {
          setActiveSettingsSection(sec as SettingsSectionId);
          setActiveView('settings');
        }}
        chatMessages={activeThread.messages}
        onSendChatMessage={(text) => handleSendMessage(text)}
        isAiThinking={isAiThinking}
        isTypingInComposer={isTypingInComposer}
        customizeOpen={companionCustomizeOpen}
        setCustomizeOpen={setCompanionCustomizeOpen}
        screenAwarenessMode={screenAwarenessMode}
        onChangeScreenAwarenessMode={setScreenAwarenessMode}
        isRecordingSkill={isRecordingSkill}
        isRecordingPaused={isRecordingPaused}
        recordingElapsedSec={recordingElapsedSec}
        activeRecorderSourceLabel={
          recorderSourceType === 'screen'
            ? 'Selected display video + keyframes'
            : recorderSourceType === 'in_app'
              ? 'In-app events'
              : 'Selected display (native system picker)'
        }
        onOpenRecordConsent={() => { setShowSkillRecorderStudio(true); setConsentSheetOpen(true); }}
        onPauseResumeRecording={handlePauseResumeRecording}
        onStopAndReviewRecording={handleStopAndReviewRecording}
        onAddRecordingNote={(noteText) => {
          setActiveRecordingSession((prev) =>
            prev
              ? {
                  ...prev,
                  narration: [
                    ...prev.narration,
                    {
                      id: `nar_${Date.now()}`,
                      timestamp: Date.now(),
                      text: noteText,
                      mode: 'typed_note',
                    },
                  ],
                }
              : prev
          );
        }}
        onMarkRecordingCheckpoint={() => {
          handleAddManualKeyframe('User marked checkpoint from Morrow floating bar');
        }}
        isBlaizeWindowClosed={isBlaizeWindowClosed}
        onReopenBlaizeWindow={() => setIsBlaizeWindowClosed(false)}
        isCompanionExited={isMorrowExited}
        onExitCompanion={() => setIsMorrowExited(true)}
        characterParametricState={characterParametricState}
      />
    </div>
  );
}

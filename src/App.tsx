/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize — Clean, Calm, Powerful Desktop AI Workspace (Argon Refinement)
 * - Left Sidebar with Active Project Switcher, grouped Workspace/Tools navigation,
 *   collapsible & searchable Recent Chats (with pinning), and icon-rail mode
 * - Grounded 2D Morrow Companion on top-center chair stage (with compact presence toggle)
 *   and contextual Pop-out Chat Box from any workspace
 * - Resizable Claude / AI Studio Artifact Split Drawer, Focused Approval Sheet,
 *   Expandable Tool Call & Verification Receipts, and persisted UI preferences
 */

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  FolderKanban,
  Globe,
  Layers,
  MessageSquare,
  Mic,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plug,
  Plus,
  Puzzle,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Wand2,
  X,
} from 'lucide-react';
import { MorrowCompanion } from './components/MorrowCompanion';
import { ArtifactSplitDrawer } from './components/ArtifactSplitDrawer';
import { ProjectsAndArtifactsView } from './components/ProjectsAndArtifactsView';
import { SkillsConnectorsSchedulerView } from './components/SkillsConnectorsSchedulerView';
import { VSCodeIdeView } from './components/VSCodeIdeView';
import {
  INITIAL_MODULAR_PLUGINS,
  ModularPluginItem,
  PluginsHubView,
} from './components/PluginsHubView';
import {
  FocusedApprovalSheet,
  ToolCallActivityRow,
  VerificationReceiptRow,
} from './components/ui/WorkspacePrimitives';
import {
  BrowserProfileId,
  CompiledSkill,
  MoneyActionDraft,
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
  CompiledPersonalityProfile,
  DEFAULT_LOCAL_MUSIC_TRACKS,
  Live2DExpressionId,
  Live2DPropId,
  Live2DProportionMode,
  MorrowAnimationAction,
  MusicTrackItem,
  ScheduledMissionRecord,
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
  INITIAL_IDE_FILES,
  INITIAL_REUSABLE_SKILLS,
  INITIAL_SCHEDULED_TASKS,
  INITIAL_VSCODE_MARKETPLACE_EXTENSIONS,
  INITIAL_WORKSPACE_ARTIFACTS,
  INITIAL_WORKSPACE_CONNECTORS,
  INITIAL_WORKSPACE_PROJECTS,
  IdeFileNode,
  ReusableSkill,
  ScheduledTaskItem,
  VSCodeMarketplaceExtension,
  WorkspaceArtifact,
  WorkspaceConnector,
  WorkspaceProject,
  createOrUpdateArtifact,
  updateWorkspaceProject,
} from './packages/workspace';

const BlaizeBrowserView = lazy(() =>
  import('./components/BlaizeBrowserView').then((m) => ({ default: m.BlaizeBrowserView }))
);
const LivingDesktopStudioPanel = lazy(() =>
  import('./components/LivingDesktopStudioPanel').then((m) => ({
    default: m.LivingDesktopStudioPanel,
  }))
);
const EvalsAndSleepView = lazy(() =>
  import('./components/EvalsAndSleepView').then((m) => ({ default: m.EvalsAndSleepView }))
);

type MainWorkspaceView =
  | 'chat'
  | 'projects'
  | 'ide'
  | 'skills'
  | 'connectors'
  | 'scheduler'
  | 'browser'
  | 'plugins';

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
    title: 'October Statement & Utility Draft',
    updatedAt: 'Today',
    pinned: true,
    messages: [
      {
        id: 'm-1',
        role: 'assistant',
        content:
          "Hi! I've walked over and taken a seat on my chair right here at the top center of your chat panel so we can talk face-to-face. Click on me anytime to open my pop-out chat box, or use the main chat below!",
        timestamp: 'Just now',
        toolsUsed: ['AI Browser Navigator', 'Trust & Audit Ledger'],
        verifiedProof: {
          hash: 'sha256:9f84c2a10e4b',
          summary: 'Session isolated · PolicyGuard active · 0 unverified claims',
        },
      },
    ],
  },
  {
    id: 'thread-2',
    title: 'Web Research & Login Session',
    updatedAt: 'Yesterday',
    pinned: false,
    messages: [
      {
        id: 'm-201',
        role: 'user',
        content: 'Open MockBank in the AI Browser and check my October transactions.',
        timestamp: 'Yesterday',
      },
      {
        id: 'm-202',
        role: 'assistant',
        content:
          'I opened **portal.mockbank.local/transactions** in the AI Browser and extracted 6 rows. Whenever you need to log in or enter a 2FA code, you can take manual control right inside the browser tab.',
        timestamp: 'Yesterday',
        toolsUsed: ['AI Browser Navigator'],
        verifiedProof: {
          hash: 'sha256:4d19b8e21a09',
          summary: '6 rows extracted · Closing balance GHS 2,457.50 verified',
        },
      },
    ],
  },
];

function readStoredPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`blaize_pref_${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  // Persisted Primary Navigation & Layout State
  const [activeView, setActiveView] = useState<MainWorkspaceView>(() =>
    readStoredPref<MainWorkspaceView>('activeView', 'chat')
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    readStoredPref<boolean>('sidebarCollapsed', false)
  );
  const [uiTheme, setUiTheme] = useState<'dark' | 'light'>(() =>
    readStoredPref<'dark' | 'light'>('uiTheme', 'dark')
  );
  const [compactChatStage, setCompactChatStage] = useState<boolean>(() =>
    readStoredPref<boolean>('compactChatStage', false)
  );
  const [artifactDrawerWidthPx, setArtifactDrawerWidthPx] = useState<number>(() =>
    readStoredPref<number>('artifactDrawerWidthPx', 500)
  );

  // Workspace Projects, Artifacts, Reusable Skills, Connectors, Scheduler & VS Code IDE State
  const [projects, setProjects] = useState<WorkspaceProject[]>(INITIAL_WORKSPACE_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState<string>(() =>
    readStoredPref<string>('activeProjectId', INITIAL_WORKSPACE_PROJECTS[0].id)
  );
  const activeProject =
    projects.find((p) => p.id === activeProjectId) || projects[0];

  useEffect(() => {
    try {
      window.localStorage.setItem('blaize_pref_activeView', JSON.stringify(activeView));
      window.localStorage.setItem('blaize_pref_sidebarCollapsed', JSON.stringify(sidebarCollapsed));
      window.localStorage.setItem('blaize_pref_uiTheme', JSON.stringify(uiTheme));
      window.localStorage.setItem('blaize_pref_compactChatStage', JSON.stringify(compactChatStage));
      window.localStorage.setItem(
        'blaize_pref_artifactDrawerWidthPx',
        JSON.stringify(artifactDrawerWidthPx)
      );
      window.localStorage.setItem('blaize_pref_activeProjectId', JSON.stringify(activeProjectId));
    } catch {
      // Ignore storage quota errors in sandboxed iframes
    }
  }, [
    activeView,
    sidebarCollapsed,
    uiTheme,
    compactChatStage,
    artifactDrawerWidthPx,
    activeProjectId,
  ]);

  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>(INITIAL_WORKSPACE_ARTIFACTS);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(
    INITIAL_WORKSPACE_ARTIFACTS[0].id
  );
  const [chatArtifactDrawerOpen, setChatArtifactDrawerOpen] = useState<boolean>(false);

  const [reusableSkills, setReusableSkills] =
    useState<ReusableSkill[]>(INITIAL_REUSABLE_SKILLS);
  const [connectors, setConnectors] = useState<WorkspaceConnector[]>(
    INITIAL_WORKSPACE_CONNECTORS
  );
  const [scheduledTasks, setScheduledTasks] =
    useState<ScheduledTaskItem[]>(INITIAL_SCHEDULED_TASKS);

  const [ideFiles, setIdeFiles] = useState<IdeFileNode[]>(INITIAL_IDE_FILES);
  const [activeIdeFileId, setActiveIdeFileId] = useState<string>(INITIAL_IDE_FILES[0].id);
  const [vscodeExtensions, setVscodeExtensions] = useState<VSCodeMarketplaceExtension[]>(
    INITIAL_VSCODE_MARKETPLACE_EXTENSIONS
  );

  // Conversation Threads & Sidebar Collapsible Groups
  const [threads, setThreads] = useState<ConversationThread[]>(INITIAL_THREADS);
  const [activeThreadId, setActiveThreadId] = useState<string>('thread-1');
  const [recentChatsOpen, setRecentChatsOpen] = useState<boolean>(true);
  const [standalonePluginsOpen, setStandalonePluginsOpen] = useState<boolean>(false);
  const [chatSearchQuery, setChatSearchQuery] = useState<string>('');
  const [showStarterPrompts, setShowStarterPrompts] = useState<boolean>(false);

  const [chatInput, setChatInput] = useState<string>('');
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState<boolean>(false);

  // Modular Plugins State (L3xi is a standalone plugin here)
  const [plugins, setPlugins] = useState<ModularPluginItem[]>(INITIAL_MODULAR_PLUGINS);
  const [activeStandalonePluginId, setActiveStandalonePluginId] = useState<string | null>(null);

  // Settings & Studio Modal
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [companionCustomizeOpen, setCompanionCustomizeOpen] = useState<boolean>(false);

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
  const [companionName, setCompanionName] = useState<string>('Morrow');
  const [activeLookId, setActiveLookId] = useState<string>('look-sage-emerald');
  const [activeAnimAction, setActiveAnimAction] = useState<MorrowAnimationAction>('idle');
  const [activeLive2DProp, setActiveLive2DProp] = useState<Live2DPropId>('none');
  const [activeLive2DExpression, setActiveLive2DExpression] =
    useState<Live2DExpressionId>('default');
  const [activeLive2DProportion, setActiveLive2DProportion] =
    useState<Live2DProportionMode>('vtuber_full');
  const [compiledPersonality, setCompiledPersonality] = useState<CompiledPersonalityProfile>(() =>
    compileNaturalLanguagePersonality({
      name: 'Morrow',
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

  const activeThread = threads.find((t) => t.id === activeThreadId) || threads[0];
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
      summary: `User approved '${pendingApproval.title}' (${channel}).`,
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
      summary: `User rejected '${pendingApproval.title}'.`,
      payload: JSON.stringify(pendingApproval),
      trustLevel: 'user_stated',
      missionId: 'chat-approval',
    });
    setPendingApproval(null);
    setMorrowState('attentive');
    setActiveAnimAction('idle');
    bumpLedger();
  };

  // Start a new chat thread
  const handleNewChat = () => {
    const newId = `thread-${Date.now()}`;
    const created: ConversationThread = {
      id: newId,
      projectId: activeProject.id,
      title: 'New Conversation',
      updatedAt: 'Just now',
      messages: [
        {
          id: `welcome-${Date.now()}`,
          role: 'assistant',
          content: `Ready in **${activeProject.name}**! ${companionName} is sitting right here beside the chat. What would you like to work on?`,
          timestamp: 'Just now',
          toolsUsed: enabledChatPlugins.map((p) => p.name),
        },
      ],
    };
    setThreads((prev) => [created, ...prev]);
    setActiveThreadId(newId);
    setActiveView('chat');
  };

  // Send a message in the main ChatGPT/Claude-style Chat interface
  const handleSendMessage = (presetPrompt?: string) => {
    const text = (presetPrompt ?? chatInput).trim();
    if (!text) return;

    const userMsg: ChatTurnMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setThreads((prev) =>
      prev.map((th) =>
        th.id === activeThread.id
          ? {
              ...th,
              title: th.title === 'New Conversation' ? text.slice(0, 34) : th.title,
              messages: [...th.messages, userMsg],
            }
          : th
      )
    );
    setChatInput('');
    setShowStarterPrompts(false);

    const lower = text.toLowerCase();

    // Check if user gave a direct companion posture/animation command
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

    // Standard multi-plugin orchestrated response
    setIsAiThinking(true);
    setMorrowState('working');
    setActiveAnimAction('work_type');

    window.setTimeout(() => {
      setIsAiThinking(false);
      setMorrowState('done_with_proof');
      setActiveAnimAction('sit');

      const activeToolNames = enabledChatPlugins.map((p) => p.name);
      let replyContent = `I completed **"${text}"** using your active tools (${
        activeToolNames.length > 0 ? activeToolNames.join(' + ') : 'Core Assistant'
      }).`;
      let proofSummary = 'Deterministic post-condition check passed (0 drift)';

      let linkedArtifactId: string | undefined;

      if (lower.includes('browser') || lower.includes('bank') || lower.includes('login')) {
        replyContent =
          'I navigated to **portal.mockbank.local** in the AI Browser and checked the page state. You can switch to **AI Browser** in the left sidebar at any time to browse manually or log into your accounts.';
        proofSummary = 'Sandboxed browser session verified · Credentials isolated';
      } else if (
        lower.includes('l3xi') ||
        lower.includes('balance') ||
        lower.includes('spend') ||
        lower.includes('artifact') ||
        lower.includes('dashboard') ||
        lower.includes('widget')
      ) {
        replyContent =
          'Using the **L3xi Finance** plugin alongside the **AI Browser**, I reconciled your October statement: Opening **GHS 1,240.00** + Credits **GHS 2,000.00** - Debits **GHS 782.50** = Closing **GHS 2,457.50**. Your Safe-to-Spend this week is **GHS 1,037.50**. I also attached the interactive **Safe-to-Spend Artifact** in the Artifact Studio drawer!';
        proofSummary = 'L3xi integer-cent equation verified: GHS 2,457.50';
        linkedArtifactId = 'art-safe-spend-widget';
        setActiveArtifactId('art-safe-spend-widget');
        setChatArtifactDrawerOpen(true);
      } else if (lower.includes('draft') || lower.includes('pay') || lower.includes('bill')) {
        replyContent =
          'I prepared a **SIMULATION Bill Draft** of **GHS 120.00** to **ECG Prepaid Meter #04291882** and paused for your approval below.';
        proofSummary = 'PolicyGuard held write action for explicit user approval';
        handleRequestApproval(
          'Approve SIMULATION Bill Draft: GHS 120.00 to ECG Prepaid Meter',
          'https://portal.mockbank.local/pay-bill#draft',
          'money',
          'Prepared via Chat multi-tool workflow (AI Browser + L3xi Finance).'
        );
      }

      const assistantMsg: ChatTurnMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: replyContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolsUsed: activeToolNames,
        linkedArtifactId,
        verifiedProof: {
          hash: computeDeterministicHash(`${text}|${Date.now()}`).slice(0, 16),
          summary: proofSummary,
        },
      };

      setThreads((prev) =>
        prev.map((th) =>
          th.id === activeThread.id ? { ...th, messages: [...th.messages, assistantMsg] } : th
        )
      );
    }, 380);
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

  // Format simple markdown bold & inline code
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
            className="px-1.5 py-0.5 rounded bg-stone-500/15 font-mono text-xs text-amber-400"
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
  const shouldShowStarters = activeThread.messages.length <= 1 || showStarterPrompts;

  return (
    <div
      data-theme={uiTheme}
      className={`h-screen w-screen overflow-hidden flex transition-colors duration-150 ${
        isLight ? 'bg-[#F7F5F0] text-stone-900' : 'bg-[#0D0F14] text-stone-100'
      }`}
    >
      {/* LEFT SIDEBAR NAVIGATION (Section 2: Active Project Switcher + Grouped Workspace/Tools) */}
      <aside
        aria-label="Primary Sidebar Navigation"
        className={`flex flex-col justify-between border-r shrink-0 transition-all duration-200 select-none ${
          sidebarCollapsed ? 'w-14' : 'w-60'
        } ${
          isLight
            ? 'bg-[#EFECE6] border-stone-300/80 text-stone-800'
            : 'bg-[#12151E] border-stone-800/80 text-stone-200'
        }`}
      >
        {/* Top Section: Brand + Active Project Switcher + Grouped Navigation */}
        <div className="p-2.5 space-y-3 overflow-y-auto flex-1">
          {/* Brand Header & Collapse Toggle */}
          <div className="flex items-center justify-between px-1">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-amber-400 text-stone-950 font-bold text-xs flex items-center justify-center shadow-xs">
                  B
                </div>
                <span className="font-bold text-sm tracking-tight">Blaize</span>
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

          {/* Prominent Active Project Switcher */}
          {!sidebarCollapsed && (
            <div
              className={`p-2 rounded-xl border space-y-0.5 ${
                isLight ? 'bg-white/90 border-stone-300/90' : 'bg-[#171C28] border-stone-800'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-stone-400 px-1">
                <span>Project Context</span>
                <button
                  type="button"
                  onClick={() => setActiveView('projects')}
                  className="hover:underline text-amber-400"
                >
                  Manage
                </button>
              </div>
              <select
                aria-label="Active Workspace Project"
                value={activeProject.id}
                onChange={(e) => setActiveProjectId(e.target.value)}
                className="w-full text-xs font-semibold bg-transparent outline-none cursor-pointer truncate px-1"
              >
                {projects.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    className={isLight ? 'bg-white text-stone-900' : 'bg-stone-900 text-stone-100'}
                  >
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* + New Chat Button */}
          <button
            type="button"
            onClick={handleNewChat}
            title="Start a new chat in the active project"
            className={`w-full flex items-center justify-center sm:justify-start gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              isLight
                ? 'bg-white border-stone-300 text-stone-900 hover:bg-stone-100 shadow-xs'
                : 'bg-[#1B202E] border-stone-700/80 text-stone-100 hover:bg-[#23293A]'
            }`}
          >
            <Plus className="w-4 h-4 text-amber-400 shrink-0" />
            {!sidebarCollapsed && <span>New Chat</span>}
          </button>

          {/* GROUP 1: WORKSPACE */}
          <div className="space-y-0.5">
            {!sidebarCollapsed && (
              <div className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                Workspace
              </div>
            )}
            {[
              { id: 'chat' as MainWorkspaceView, label: 'Chat', icon: MessageSquare },
              {
                id: 'projects' as MainWorkspaceView,
                label: 'Projects & Artifacts',
                icon: FolderKanban,
                count: artifacts.length,
              },
              { id: 'ide' as MainWorkspaceView, label: 'Code IDE', icon: Code2 },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  onClick={() => setActiveView(item.id)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                    active
                      ? isLight
                        ? 'bg-stone-900 text-white font-semibold'
                        : 'bg-amber-400/15 text-amber-300 border border-amber-400/30 font-semibold'
                      : 'text-stone-400 hover:bg-stone-500/10 hover:text-stone-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!sidebarCollapsed && item.count !== undefined && (
                    <span className="text-[10px] font-mono text-stone-400">{item.count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* GROUP 2: TOOLS */}
          <div className="space-y-0.5 pt-1">
            {!sidebarCollapsed && (
              <div className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                Tools
              </div>
            )}
            {[
              { id: 'browser' as MainWorkspaceView, label: 'AI Browser', icon: Globe },
              {
                id: 'skills' as MainWorkspaceView,
                label: 'Reusable Skills',
                icon: Wand2,
                count: reusableSkills.length,
              },
              {
                id: 'connectors' as MainWorkspaceView,
                label: 'Connectors',
                icon: Plug,
                count: connectors.filter((c) => c.status === 'connected').length,
              },
              {
                id: 'scheduler' as MainWorkspaceView,
                label: 'Scheduler',
                icon: CalendarClock,
                count: scheduledTasks.filter((s) => s.enabled).length,
              },
              {
                id: 'plugins' as MainWorkspaceView,
                label: 'Plugins & Tools',
                icon: Puzzle,
                count: plugins.length,
              },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  onClick={() => {
                    setActiveView(item.id);
                    if (item.id === 'plugins') {
                      setActiveStandalonePluginId(null);
                    }
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                    active
                      ? isLight
                        ? 'bg-stone-900 text-white font-semibold'
                        : 'bg-amber-400/15 text-amber-300 border border-amber-400/30 font-semibold'
                      : 'text-stone-400 hover:bg-stone-500/10 hover:text-stone-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!sidebarCollapsed && item.count !== undefined && (
                    <span className="text-[10px] font-mono text-stone-400">{item.count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* GROUP 3: COLLAPSIBLE RECENT CHATS WITH SEARCH & PINNING */}
          {!sidebarCollapsed && (
            <div className="pt-1 space-y-1">
              <button
                type="button"
                onClick={() => setRecentChatsOpen((v) => !v)}
                className="w-full px-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-300"
              >
                <span>Recent Chats ({threads.length})</span>
                {recentChatsOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>

              {recentChatsOpen && (
                <div className="space-y-1">
                  {threads.length > 2 && (
                    <div className="px-2">
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-stone-500/10 text-[11px]">
                        <Search className="w-3 h-3 text-stone-400" />
                        <input
                          type="text"
                          value={chatSearchQuery}
                          onChange={(e) => setChatSearchQuery(e.target.value)}
                          placeholder="Filter chats..."
                          className="bg-transparent outline-none w-full"
                        />
                      </div>
                    </div>
                  )}

                  {filteredThreads.map((th) => {
                    const isSelected = activeView === 'chat' && th.id === activeThread.id;
                    return (
                      <div
                        key={th.id}
                        className={`group flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                          isSelected
                            ? isLight
                              ? 'bg-stone-300/70 text-stone-900 font-medium'
                              : 'bg-stone-800/90 text-stone-100 font-medium'
                            : 'text-stone-400 hover:bg-stone-500/10 hover:text-stone-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveThreadId(th.id);
                            setActiveView('chat');
                          }}
                          className="truncate text-left flex-1"
                        >
                          {th.title}
                        </button>
                        <button
                          type="button"
                          aria-label={th.pinned ? 'Unpin chat' : 'Pin chat'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setThreads((prev) =>
                              prev.map((item) =>
                                item.id === th.id ? { ...item, pinned: !item.pinned } : item
                              )
                            );
                          }}
                          className={`p-0.5 rounded transition-opacity ${
                            th.pinned
                              ? 'text-amber-400 opacity-100'
                              : 'opacity-0 group-hover:opacity-70 hover:opacity-100'
                          }`}
                        >
                          <Pin className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* GROUP 4: COLLAPSIBLE STANDALONE PLUGIN WORKSPACES */}
          {!sidebarCollapsed && (
            <div className="pt-1 space-y-1">
              <button
                type="button"
                onClick={() => setStandalonePluginsOpen((v) => !v)}
                className="w-full px-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-300"
              >
                <span>Standalone Workspaces</span>
                {standalonePluginsOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>

              {standalonePluginsOpen &&
                plugins.map((pl) => (
                  <div
                    key={pl.id}
                    className="flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-xl text-xs text-stone-400 hover:bg-stone-500/10"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (pl.builtInWorkspace === 'browser') {
                          setActiveView('browser');
                        } else {
                          setActiveStandalonePluginId(pl.id);
                          setActiveView('plugins');
                        }
                      }}
                      className="truncate text-left flex-1 hover:text-stone-200"
                    >
                      {pl.name}
                    </button>
                    <span
                      title={pl.enabledInChat ? 'Enabled in Chat' : 'Standalone only'}
                      className={`w-1.5 h-1.5 rounded-full ${
                        pl.enabledInChat ? 'bg-emerald-400' : 'bg-stone-600'
                      }`}
                    />
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Bottom Sidebar Footer: Companion Appearance, Settings & Theme Toggle */}
        <div
          className={`p-2.5 border-t space-y-0.5 ${
            isLight ? 'border-stone-300/80' : 'border-stone-800/80'
          }`}
        >
          <button
            type="button"
            title={`${companionName} Appearance`}
            onClick={() => setCompanionCustomizeOpen((v) => !v)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-stone-400 hover:bg-stone-500/15 hover:text-stone-200"
          >
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            {!sidebarCollapsed && <span>{companionName} Appearance</span>}
          </button>

          <button
            type="button"
            title="Settings & Studio"
            onClick={() => setSettingsModalOpen(true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-stone-400 hover:bg-stone-500/15 hover:text-stone-200"
          >
            <Settings className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Settings &amp; Studio</span>}
          </button>

          <button
            type="button"
            onClick={() => setUiTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={`Switch to ${isLight ? 'dark' : 'light'} theme`}
            title={`Switch to ${isLight ? 'dark' : 'light'} theme`}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-stone-400 hover:bg-stone-500/15 hover:text-stone-200"
          >
            {isLight ? (
              <Moon className="w-4 h-4 shrink-0" />
            ) : (
              <Sun className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            {!sidebarCollapsed && <span>{isLight ? 'Dark Mode' : 'Light Mode'}</span>}
          </button>
        </div>
      </aside>

      {/* MAIN WORKSPACE AREA */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
        {/* VIEW 1: CLEAN CHAT WORKSPACE + RESIZABLE ARTIFACT SPLIT DRAWER */}
        {activeView === 'chat' && (
          <div className="flex-1 flex h-full overflow-hidden">
            <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
              {/* Calm Top Header */}
              <header
                className={`px-6 py-2.5 border-b flex items-center justify-between gap-4 shrink-0 ${
                  isLight
                    ? 'border-stone-200/90 bg-[#F7F5F0]/90'
                    : 'border-stone-800/70 bg-[#0D0F14]/90'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="text-xs font-mono text-amber-400 font-semibold truncate max-w-[180px]"
                    title={`Active Project: ${activeProject.name}`}
                  >
                    {activeProject.name}
                  </span>
                  <span className="text-stone-500">/</span>
                  <h1 className="text-sm font-semibold truncate">{activeThread.title}</h1>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setCompactChatStage((v) => !v)}
                    className={`hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] transition-colors ${
                      isLight
                        ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                        : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
                    }`}
                    title={
                      compactChatStage
                        ? 'Expand Morrow top-center chair stage'
                        : 'Compact Morrow stage into a minimal presence bar'
                    }
                  >
                    {compactChatStage ? (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        <span>Expand Stage</span>
                      </>
                    ) : (
                      <>
                        <ChevronUp className="w-3 h-3" />
                        <span>Compact Stage</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setChatArtifactDrawerOpen((o) => !o)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                      chatArtifactDrawerOpen
                        ? 'bg-amber-400 text-stone-950 border-amber-400 font-semibold'
                        : isLight
                        ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                        : 'bg-stone-900 border-stone-800 text-stone-200 hover:bg-stone-800'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Artifacts ({artifacts.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveView('ide')}
                    className={`hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                      isLight
                        ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                        : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Code IDE</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveView('browser')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                      isLight
                        ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                        : 'bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5 text-sky-400" />
                    <span className="hidden sm:inline">AI Browser</span>
                  </button>
                </div>
              </header>

              {/* Top-Center Companion Chair Stage — Compact & Grounded */}
              <div
                data-testid="chat-top-center-chair-stage"
                className={`relative shrink-0 border-b flex flex-col items-center justify-end overflow-hidden transition-all duration-200 ${
                  compactChatStage ? 'h-12 pb-1' : 'h-48 pb-2'
                } ${
                  isLight
                    ? 'bg-gradient-to-b from-stone-200/50 to-[#F7F5F0] border-stone-200/80'
                    : 'bg-gradient-to-b from-[#131824] to-[#0D0F14] border-stone-800/60'
                }`}
              />

              {/* Centered Conversation Stream directly below Morrow's top-center chair */}
              <main className="flex-1 overflow-y-auto px-4 sm:px-8 py-5">
                <div className="max-w-3xl mx-auto space-y-5 pb-12">
                  {/* Starter Prompts (Only shown in a fresh chat or when toggled) */}
                  {shouldShowStarters && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {[
                        {
                          title: 'Reconcile October Statement',
                          prompt:
                            'Use AI Browser and L3xi Finance to reconcile my October balance and Safe-to-Spend',
                          tool: 'L3xi + Browser',
                        },
                        {
                          title: 'Inspect Bank & Login Session',
                          prompt:
                            'Open MockBank in the AI Browser and verify my recent transactions',
                          tool: 'AI Browser',
                        },
                        {
                          title: 'Prepare Utility Bill Draft',
                          prompt:
                            'Prepare a SIMULATION bill draft of GHS 120.00 to ECG Prepaid Meter',
                          tool: 'Guarded Draft',
                        },
                      ].map((starter) => (
                        <button
                          key={starter.title}
                          type="button"
                          onClick={() => handleSendMessage(starter.prompt)}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            isLight
                              ? 'bg-white border-stone-200/90 hover:border-stone-300 shadow-xs'
                              : 'bg-[#141822] border-stone-800/90 hover:border-stone-700'
                          }`}
                        >
                          <div className="text-xs font-semibold">{starter.title}</div>
                          <div className="text-[11px] text-stone-400 mt-1 line-clamp-2">
                            {starter.prompt}
                          </div>
                          <span className="inline-block mt-1.5 text-[10px] font-mono text-amber-400">
                            {starter.tool} →
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Messages */}
                  <div className="space-y-4">
                    {activeThread.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 ${
                          msg.role === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="w-7 h-7 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                            M
                          </div>
                        )}

                        <div
                          className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed space-y-2 ${
                            msg.role === 'user'
                              ? isLight
                                ? 'bg-stone-900 text-white'
                                : 'bg-[#222836] text-stone-100 border border-stone-700/70'
                              : isLight
                              ? 'bg-white border border-stone-200/90 text-stone-800 shadow-xs'
                              : 'bg-[#141822] border border-stone-800/90 text-stone-200'
                          }`}
                        >
                          <div>{renderCleanMarkdown(msg.content)}</div>

                          {/* Progressive Disclosure: Compact Tool Call Activity Row */}
                          {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                            <ToolCallActivityRow
                              tools={msg.toolsUsed}
                              uiTheme={uiTheme}
                            />
                          )}

                          {/* Progressive Disclosure: Expandable Verification Receipt + Artifact Link */}
                          {msg.verifiedProof && (
                            <VerificationReceiptRow
                              summary={msg.verifiedProof.summary}
                              hash={msg.verifiedProof.hash}
                              linkedArtifactLabel={
                                msg.linkedArtifactId
                                  ? 'Open Interactive Artifact'
                                  : 'Save as Artifact'
                              }
                              onOpenArtifact={() => {
                                if (msg.linkedArtifactId) {
                                  setActiveArtifactId(msg.linkedArtifactId);
                                } else {
                                  handleSaveArtifactVersion({
                                    title: `Chat Artifact (${msg.timestamp})`,
                                    kind: 'markdown_doc',
                                    language: 'markdown',
                                    content: `# ${activeThread.title}\n\n${msg.content}\n\n- Proof: ${msg.verifiedProof?.summary}\n- Hash: ${msg.verifiedProof?.hash}`,
                                    summary: 'Saved directly from Chat response',
                                  });
                                }
                                setChatArtifactDrawerOpen(true);
                              }}
                              uiTheme={uiTheme}
                            />
                          )}
                        </div>
                      </div>
                    ))}

                    {isAiThinking && (
                      <div className="flex items-center gap-3 text-xs text-stone-400 pl-2">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                        <span>
                          {companionName} is coordinating active tools (
                          {enabledChatPlugins.map((p) => p.name).join(', ') || 'Core'})...
                        </span>
                      </div>
                    )}

                    {/* Focused Approval Sheet when a guarded action requires user confirmation */}
                    {pendingApproval && (
                      <FocusedApprovalSheet
                        approval={pendingApproval}
                        onApprove={() => handleApproveAction('local_sheet')}
                        onSimulateOnly={() => handleApproveAction('local_sheet')}
                        onReject={handleRejectAction}
                        uiTheme={uiTheme}
                      />
                    )}
                  </div>
                </div>
              </main>

              {/* Single Clean Composer with Compact Tool Selector */}
              <div className="px-4 sm:px-8 pb-4 pt-2 shrink-0">
                <div className="max-w-3xl mx-auto relative">
                  {toolsMenuOpen && (
                    <div
                      role="dialog"
                      aria-label="Active Chat Plugins"
                      className={`absolute bottom-full mb-2 left-0 w-80 rounded-2xl border p-3.5 shadow-2xl z-30 space-y-2 text-xs ${
                        isLight
                          ? 'bg-white border-stone-300 text-stone-900'
                          : 'bg-[#161A25] border-stone-700 text-stone-100'
                      }`}
                    >
                      <div className="flex items-center justify-between pb-1.5 border-b border-stone-700/50">
                        <span className="font-semibold">Tools &amp; Plugins in Chat</span>
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
                              <div className="text-[10px] text-stone-400">{pl.category}</div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${
                                pl.enabledInChat
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-stone-800 text-stone-400'
                              }`}
                            >
                              {pl.enabledInChat ? 'ON' : 'OFF'}
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
                    className={`rounded-2xl border p-3 shadow-lg transition-colors ${
                      isLight
                        ? 'bg-white border-stone-300 focus-within:border-stone-400'
                        : 'bg-[#151924] border-stone-700/90 focus-within:border-stone-600'
                    }`}
                  >
                    <textarea
                      rows={2}
                      aria-label="Message Blaize"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder={`Message ${companionName} or coordinate your tools...`}
                      className="w-full bg-transparent outline-none resize-none text-sm placeholder:text-stone-400"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-700/30">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setToolsMenuOpen((o) => !o)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors ${
                            isLight
                              ? 'bg-stone-100 border-stone-300 text-stone-700 hover:bg-stone-200'
                              : 'bg-stone-900 border-stone-700 text-stone-300 hover:bg-stone-800'
                          }`}
                        >
                          <Puzzle className="w-3.5 h-3.5 text-amber-400" />
                          <span>Tools ({enabledChatPlugins.length})</span>
                        </button>

                        {enabledChatPlugins.slice(0, 3).map((pl) => (
                          <span
                            key={pl.id}
                            className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-400/10 border border-amber-400/25 text-amber-300 text-[11px]"
                          >
                            <Check className="w-2.5 h-2.5" />
                            <span>{pl.name}</span>
                          </span>
                        ))}

                        {activeThread.messages.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setShowStarterPrompts((v) => !v)}
                            className="text-[11px] text-stone-400 hover:text-stone-200 px-1.5"
                          >
                            {showStarterPrompts ? 'Hide Ideas' : 'Prompt Ideas'}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleSendMessage(
                              'Check my October statement with L3xi Finance and verify Safe-to-Spend'
                            )
                          }
                          aria-label="Voice input"
                          title="Push-to-Talk Voice Prompt"
                          className="p-2 rounded-xl text-stone-400 hover:text-stone-200 hover:bg-stone-500/15"
                        >
                          <Mic className="w-4 h-4" />
                        </button>

                        <button
                          type="submit"
                          aria-label="Send message"
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs transition-colors"
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

            {/* Resizable Side-by-Side Artifact Split Drawer in Chat */}
            {chatArtifactDrawerOpen && (
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
            )}
          </div>
        )}

        {/* VIEW 1B: PROJECTS & ARTIFACTS STUDIO */}
        {activeView === 'projects' && (
          <main className="flex-1 overflow-hidden">
            <ProjectsAndArtifactsView
              projects={projects}
              activeProjectId={activeProject.id}
              onSelectProject={setActiveProjectId}
              onCreateProject={(proj) => setProjects((prev) => [proj, ...prev])}
              onUpdateProject={(projectId, patch) =>
                setProjects((prev) => updateWorkspaceProject(prev, projectId, patch))
              }
              artifacts={artifacts}
              activeArtifactId={activeArtifactId}
              onSelectArtifact={(id) => setActiveArtifactId(id)}
              onSaveArtifactVersion={handleSaveArtifactVersion}
              onRollbackArtifact={(updated) =>
                setArtifacts((prev) =>
                  prev.map((a) => (a.id === updated.id ? updated : a))
                )
              }
              onOpenInVSCodeIde={handleOpenArtifactInIde}
              skills={reusableSkills}
              connectors={connectors}
              schedules={scheduledTasks}
              onNavigateWorkspace={(view) => setActiveView(view)}
              uiTheme={uiTheme}
            />
          </main>
        )}

        {/* VIEW 1C: VS CODE IDE WITH VS CODE MARKETPLACE ADDONS */}
        {activeView === 'ide' && (
          <main className="flex-1 overflow-hidden">
            <VSCodeIdeView
              activeProject={activeProject}
              files={ideFiles}
              activeFileId={activeIdeFileId}
              onSelectFile={setActiveIdeFileId}
              onUpdateFileContent={(fileId, newContent) =>
                setIdeFiles((prev) =>
                  prev.map((f) => (f.id === fileId ? { ...f, content: newContent } : f))
                )
              }
              onCreateFile={(newFile) => setIdeFiles((prev) => [...prev, newFile])}
              extensions={vscodeExtensions}
              onToggleInstallExtension={(extId) =>
                setVscodeExtensions((prev) =>
                  prev.map((e) =>
                    e.id === extId
                      ? { ...e, installed: !e.installed, enabled: !e.installed }
                      : e
                  )
                )
              }
              onToggleEnableExtension={(extId) =>
                setVscodeExtensions((prev) =>
                  prev.map((e) => (e.id === extId ? { ...e, enabled: !e.enabled } : e))
                )
              }
              onInstallCustomMarketplaceExtension={(newExt) =>
                setVscodeExtensions((prev) => [
                  newExt,
                  ...prev.filter((e) => e.id !== newExt.id),
                ])
              }
              onPublishFileAsArtifact={(artInput) => {
                handleSaveArtifactVersion({
                  ...artInput,
                  summary: 'Published from VS Code IDE',
                });
              }}
            />
          </main>
        )}

        {/* VIEW 1D: REUSABLE SKILLS, CONNECTORS & SCHEDULER */}
        {(activeView === 'skills' ||
          activeView === 'connectors' ||
          activeView === 'scheduler') && (
          <main className="flex-1 overflow-y-auto">
            <SkillsConnectorsSchedulerView
              mode={activeView}
              activeProject={activeProject}
              projects={projects}
              skills={reusableSkills}
              onAddSkill={(sk) => setReusableSkills((prev) => [sk, ...prev])}
              onUpdateSkill={(updated) =>
                setReusableSkills((prev) =>
                  prev.map((s) => (s.id === updated.id ? updated : s))
                )
              }
              onRemoveSkill={(skillId) =>
                setReusableSkills((prev) => prev.filter((s) => s.id !== skillId))
              }
              onExecuteSkillResult={(res) => {
                handleSaveArtifactVersion({
                  title: res.artifactTitle,
                  kind: res.artifactKind,
                  language: 'html',
                  content: res.artifactContent,
                  summary: `Generated by Reusable Skill: ${res.skill.name}`,
                  sourcePrompt: res.compiledPrompt,
                });
                setReusableSkills((prev) =>
                  prev.map((s) =>
                    s.id === res.skill.id ? { ...s, usageCount: s.usageCount + 1 } : s
                  )
                );
                if (res.openInChat) {
                  setActiveView('chat');
                  setChatArtifactDrawerOpen(true);
                  handleSendMessage(
                    `Run skill "${res.skill.name}": ${res.compiledPrompt.slice(0, 120)}`
                  );
                }
              }}
              connectors={connectors}
              onToggleConnectorStatus={(connId) =>
                setConnectors((prev) =>
                  prev.map((c) =>
                    c.id === connId
                      ? {
                          ...c,
                          status: c.status === 'connected' ? 'disconnected' : 'connected',
                          lastSyncAt: c.status === 'connected' ? c.lastSyncAt : 'Just now',
                        }
                      : c
                  )
                )
              }
              onToggleConnectorProjectBind={(connId, projId) =>
                setConnectors((prev) =>
                  prev.map((c) => {
                    if (c.id !== connId) return c;
                    const bound = c.boundProjectIds.includes(projId)
                      ? c.boundProjectIds.filter((id) => id !== projId)
                      : [...c.boundProjectIds, projId];
                    return { ...c, boundProjectIds: bound };
                  })
                )
              }
              onToggleConnectorWriteApproval={(connId) =>
                setConnectors((prev) =>
                  prev.map((c) =>
                    c.id === connId
                      ? { ...c, writeRequiresApproval: !c.writeRequiresApproval }
                      : c
                  )
                )
              }
              schedules={scheduledTasks}
              onAddSchedule={(sched) => setScheduledTasks((prev) => [sched, ...prev])}
              onToggleScheduleEnabled={(schedId) =>
                setScheduledTasks((prev) =>
                  prev.map((s) => (s.id === schedId ? { ...s, enabled: !s.enabled } : s))
                )
              }
              onRunScheduleNow={(sched) => {
                setScheduledTasks((prev) =>
                  prev.map((s) =>
                    s.id === sched.id
                      ? {
                          ...s,
                          lastRunAt: 'Just now',
                          lastRunStatus:
                            s.lastRunStatus === 'blocked_by_guard'
                              ? 'blocked_by_guard'
                              : 'verified_ok',
                        }
                      : s
                  )
                );
                ledger.appendEvent({
                  actor: 'agent',
                  type: 'mission_started',
                  summary: `Scheduled task '${sched.title}' executed (${sched.cronExpression}).`,
                  payload: JSON.stringify(sched),
                  trustLevel: 'verified_by_evidence',
                  missionId: sched.id,
                });
                bumpLedger();
              }}
              uiTheme={uiTheme}
            />
          </main>
        )}

        {/* VIEW 2: FULL-FEATURED AI & USER BROWSER */}
        {activeView === 'browser' && (
          <main className="flex-1 overflow-y-auto p-3 sm:p-4">
            <Suspense
              fallback={
                <div className="p-8 text-center text-xs text-stone-400">
                  Loading AI Browser...
                </div>
              }
            >
              <BlaizeBrowserView
                activeProfile={policyConfig.activeProfileId}
                onChangeProfile={(prof: BrowserProfileId) => {
                  setPolicyConfig((prev) => ({ ...prev, activeProfileId: prof }));
                  bumpLedger();
                }}
                policyConfig={policyConfig}
                compiledSkill={compiledSkill}
                onUpdateCompiledSkill={(skill) => {
                  setCompiledSkill(skill);
                  bumpLedger();
                }}
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
                uiTheme={uiTheme}
              />
            </Suspense>
          </main>
        )}

        {/* VIEW 3: MODULAR STANDALONE PLUGINS & TOOLS HUB (L3xi Decoupled) */}
        {activeView === 'plugins' && (
          <main className="flex-1 overflow-y-auto p-4 sm:p-8">
            <PluginsHubView
              plugins={plugins}
              onTogglePluginInChat={(pluginId) =>
                setPlugins((prev) =>
                  prev.map((p) =>
                    p.id === pluginId ? { ...p, enabledInChat: !p.enabledInChat } : p
                  )
                )
              }
              onAddPlugin={(newPlugin) => setPlugins((prev) => [newPlugin, ...prev])}
              activeStandalonePluginId={activeStandalonePluginId}
              onSelectStandalonePlugin={setActiveStandalonePluginId}
              onOpenBrowserView={() => setActiveView('browser')}
              onRequestDraftApproval={(draft: MoneyActionDraft) =>
                handleRequestApproval(
                  `Execute SIMULATION Draft: ${draft.currency} ${draft.amount.toFixed(2)} to ${draft.destination}`,
                  `mockbank://transfer/simulation/${draft.id}`,
                  'money',
                  `Reference: "${draft.reference}"`,
                  draft.id
                )
              }
              approvedDraftIds={approvedDraftIds}
              isPlayingMusic={isPlayingMusic}
              setIsPlayingMusic={setIsPlayingMusic}
              activeTrack={activeTrack}
              setActiveTrack={setActiveTrack}
              danceSyncEnabled={danceSyncEnabled}
              setDanceSyncEnabled={setDanceSyncEnabled}
              onLogScheduleRunToLedger={(schedule: ScheduledMissionRecord) => {
                ledger.appendEvent({
                  actor: 'agent',
                  type: 'mission_started',
                  summary: `Scheduled task '${schedule.title}' executed.`,
                  payload: JSON.stringify(schedule),
                  trustLevel: 'verified_by_evidence',
                  missionId: schedule.id,
                });
                bumpLedger();
              }}
              ledgerEvents={ledgerEvents}
              chainReport={chainReport}
              isTampered={ledger.isTampered()}
              onSimulateTamper={() => {
                ledger.simulateTamper(1);
                bumpLedger();
              }}
              onRestoreTamper={() => {
                ledger.restoreTamperedEvent();
                bumpLedger();
              }}
              onDeleteLedgerContent={(ref) => {
                ledger.deleteContent(ref);
                bumpLedger();
              }}
              onExplainEvent={(id) => ledger.explain(id)}
              policyConfig={policyConfig}
              onAddStandingRule={(plainText, maxAmount) => {
                const newId = `rule-custom-${policyConfig.standingRules.length + 1}`;
                setPolicyConfig((prev) => ({
                  ...prev,
                  standingRules: [
                    {
                      id: newId,
                      plainText,
                      compiledPattern: maxAmount
                        ? `action.amount <= ${maxAmount}`
                        : 'guard.custom_check()',
                      ruleType: maxAmount ? 'spend_cap' : 'require_approval',
                      maxAmount,
                      active: true,
                      generatedScenario: `Verify rule ${newId}`,
                    },
                    ...prev.standingRules,
                  ],
                }));
                bumpLedger();
              }}
              onLogPluginGuardBlock={(pluginId, summary) => {
                ledger.appendEvent({
                  actor: 'guard',
                  type: 'plugin_blocked',
                  summary,
                  payload: JSON.stringify({ pluginId, summary }),
                  trustLevel: 'verified_by_evidence',
                  missionId: 'plugin-sandbox',
                });
                bumpLedger();
              }}
              uiTheme={uiTheme}
            />
          </main>
        )}
      </div>

      {/* SETTINGS & COMPANION STUDIO MODAL */}
      {settingsModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Settings and Companion Studio"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
        >
          <div
            className={`w-full max-w-5xl max-h-[88vh] rounded-2xl border flex flex-col overflow-hidden shadow-2xl ${
              isLight ? 'bg-[#F7F5F0] border-stone-300' : 'bg-[#121620] border-stone-700'
            }`}
          >
            <div className="px-6 py-4 border-b border-stone-700/60 flex items-center justify-between">
              <h2 className="text-base font-bold">Settings, Personality Studio &amp; Evaluation</h2>
              <button
                type="button"
                onClick={() => setSettingsModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-stone-500/20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              <Suspense
                fallback={
                  <div className="p-6 text-xs text-stone-400">Loading Studio settings...</div>
                }
              >
                <LivingDesktopStudioPanel
                  companionName={companionName}
                  setCompanionName={setCompanionName}
                  activeLookId={activeLookId}
                  setActiveLookId={setActiveLookId}
                  activeAnimAction={activeAnimAction}
                  onTriggerAnimationAction={handleTriggerAnimationAction}
                  activeLive2DProp={activeLive2DProp}
                  onChangeLive2DProp={setActiveLive2DProp}
                  activeLive2DExpression={activeLive2DExpression}
                  onChangeLive2DExpression={setActiveLive2DExpression}
                  activeLive2DProportion={activeLive2DProportion}
                  onChangeLive2DProportion={setActiveLive2DProportion}
                  compiledPersonality={compiledPersonality}
                  onUpdateCompiledPersonality={setCompiledPersonality}
                  isPlayingMusic={isPlayingMusic}
                  setIsPlayingMusic={setIsPlayingMusic}
                  activeTrack={activeTrack}
                  setActiveTrack={setActiveTrack}
                  danceSyncEnabled={danceSyncEnabled}
                  setDanceSyncEnabled={setDanceSyncEnabled}
                  onLogScheduleRunToLedger={() => bumpLedger()}
                />

                <EvalsAndSleepView
                  sleepReport={sleepReport}
                  onRunSleepCycle={(gateParams) => {
                    const rep = executeSleepCycle(ledger, gateParams);
                    setSleepReport(rep);
                    bumpLedger();
                  }}
                  onPromoteCandidateSkill={() =>
                    setSleepReport((prev) => ({ ...prev, promotionStatus: 'PROMOTED' }))
                  }
                  onRollbackCandidateSkill={() =>
                    setSleepReport((prev) => ({ ...prev, promotionStatus: 'ROLLED_BACK' }))
                  }
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {/* ALWAYS-FLOATING 2D COMPANION (Walks & Sits in the Chat Area whenever Chat is Open) */}
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
        onRecordUserCorrection={() => bumpLedger()}
        onSubmitVoiceMission={(transcript) => handleSendMessage(transcript)}
        companionName={companionName}
        onChangeCompanionName={setCompanionName}
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
        onToggleMusic={() => {
          const next = !isPlayingMusic;
          setIsPlayingMusic(next);
          if (next && danceSyncEnabled) {
            handleTriggerAnimationAction('dance', 'Music started');
          } else if (!next && activeAnimAction === 'dance') {
            handleTriggerAnimationAction('idle', 'Music paused');
          }
        }}
        uiTheme={uiTheme}
        onToggleUiTheme={() => setUiTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        isChatViewOpen={activeView === 'chat'}
        sidebarCollapsed={sidebarCollapsed}
        chatArtifactDrawerOpen={chatArtifactDrawerOpen}
        artifactDrawerWidthPx={artifactDrawerWidthPx}
        compactChatStage={compactChatStage}
        onToggleCompactChatStage={() => setCompactChatStage((v) => !v)}
        onJumpToChat={() => setActiveView('chat')}
        chatMessages={activeThread.messages}
        onSendChatMessage={(text) => handleSendMessage(text)}
        isAiThinking={isAiThinking}
        customizeOpen={companionCustomizeOpen}
        setCustomizeOpen={setCompanionCustomizeOpen}
      />
    </div>
  );
}

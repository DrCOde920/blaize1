/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full-Featured AI Browser (Section 11 — Clean, Calm, Powerful)
 * - Maximized web page viewport with compact Chrome/Arc-style tab strip & omnibox
 * - AI Control vs User Control switch + "Ask Morrow in Chat" handoff button
 * - Prominent Password / OTP / 2FA Privacy Shield ("Private login mode — AI screenshots & DOM access paused")
 * - Collapsible Bookmarks strip & Teach & Replay drawer governed by PolicyGuard
 */

import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Bot,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  MessageSquare,
  Play,
  Plus,
  Radio,
  RotateCw,
  Shield,
  ShieldAlert,
  Sparkles,
  Star,
  UserCheck,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  BrowserProfileId,
  CompiledSkill,
  PolicyDecision,
  RecordedSkillStep,
} from '../packages/contracts';
import { SYNTHETIC_STATEMENT_FIXTURES } from '../packages/l3xi';
import { PolicyConfig, evaluatePolicyGuard } from '../packages/trust';

interface BlaizeBrowserViewProps {
  activeProfile: BrowserProfileId;
  onChangeProfile: (profile: BrowserProfileId) => void;
  policyConfig: PolicyConfig;
  compiledSkill: CompiledSkill;
  onUpdateCompiledSkill: (skill: CompiledSkill) => void;
  onLogGuardDecisionToLedger: (decision: PolicyDecision, summary: string) => void;
  onRequestApproval: (title: string, target: string, risk: string, reason: string) => void;
  onAskMorrowInChat?: (contextPrompt: string) => void;
  uiTheme?: 'dark' | 'light';
}

interface BrowserTabItem {
  id: string;
  title: string;
  url: string;
  history: string[];
  historyIndex: number;
  isLoggedIn: boolean;
  loggedInUser: string;
  subPage?: 'accounts' | 'transactions' | 'pay_bill' | 'login_2fa';
}

const BOOKMARKS = [
  {
    title: 'MockBank Portal',
    url: 'https://portal.mockbank.local/accounts',
    badge: 'Banking',
  },
  {
    title: 'Ghana MoMo Hub',
    url: 'https://momo.telecom.gh/wallet',
    badge: 'Mobile Money',
  },
  {
    title: 'Workspace Mail',
    url: 'https://mail.workspace.local/inbox',
    badge: 'Mail',
  },
  {
    title: 'Workspace Docs',
    url: 'https://docs.workspace.local/notes',
    badge: 'Docs',
  },
  {
    title: 'Market & FX Wire',
    url: 'https://wire.markets.local/rates',
    badge: 'Rates',
  },
];

export const BlaizeBrowserView: React.FC<BlaizeBrowserViewProps> = ({
  activeProfile,
  onChangeProfile,
  policyConfig,
  compiledSkill,
  onUpdateCompiledSkill,
  onLogGuardDecisionToLedger,
  onRequestApproval,
  onAskMorrowInChat,
  uiTheme = 'dark',
}) => {
  const isLight = uiTheme === 'light';

  // Multi-tab browser state (Active tab is mounted; background tabs are suspended to URLs for <24GB RAM efficiency)
  const [tabs, setTabs] = useState<BrowserTabItem[]>([
    {
      id: 'tab-1',
      title: 'MockBank Portal — Accounts',
      url: 'https://portal.mockbank.local/accounts',
      history: ['https://portal.mockbank.local/accounts'],
      historyIndex: 0,
      isLoggedIn: true,
      loggedInUser: 'kofi.mensah@accra.gh',
      subPage: 'accounts',
    },
    {
      id: 'tab-2',
      title: 'Ghana MoMo Wallet',
      url: 'https://momo.telecom.gh/wallet',
      history: ['https://momo.telecom.gh/wallet'],
      historyIndex: 0,
      isLoggedIn: true,
      loggedInUser: '+233 24 819 0421',
    },
    {
      id: 'tab-3',
      title: 'Workspace Mail — Inbox',
      url: 'https://mail.workspace.local/inbox',
      history: ['https://mail.workspace.local/inbox'],
      historyIndex: 0,
      isLoggedIn: true,
      loggedInUser: 'kofi@blaize.work',
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Address bar input state
  const [addressInput, setAddressInput] = useState<string>(activeTab.url);
  const [zoomPct, setZoomPct] = useState<number>(100);
  const [bookmarkedUrls, setBookmarkedUrls] = useState<string[]>(
    BOOKMARKS.map((b) => b.url)
  );
  const [bookmarksVisible, setBookmarksVisible] = useState<boolean>(true);

  // AI Control vs Manual User Control
  const [controlMode, setControlMode] = useState<'ai_autopilot' | 'user_manual'>('ai_autopilot');
  const [aiStatusText, setAiStatusText] = useState<string>(
    'Morrow ready · Watching active tab under PolicyGuard'
  );
  const [aiTaskPrompt, setAiTaskPrompt] = useState<string>('');
  const [isAiExecuting, setIsAiExecuting] = useState<boolean>(false);

  // User Login / Credential Takeover Modal
  const [loginModalOpen, setLoginModalOpen] = useState<boolean>(false);
  const [loginUsername, setLoginUsername] = useState<string>('kofi.mensah@accra.gh');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginOtp, setLoginOtp] = useState<string>('');

  // Collapsible Teach & Replay Studio Drawer
  const [teachDrawerOpen, setTeachDrawerOpen] = useState<boolean>(false);
  const [isRecordingTeach, setIsRecordingTeach] = useState(false);
  const [narrationText] = useState(compiledSkill.narrationTranscript);
  const [recordedEvents, setRecordedEvents] = useState<string[]>([
    'navigate https://portal.mockbank.local/transactions',
    'extract_a11y table#mockbank-tx-table -> 6 rows',
    'draft_money button#prepare-draft-btn -> GHS 120.00',
  ]);
  const [replayMode, setReplayMode] = useState<
    'idle' | 'replaying' | 'dry_run_complete' | 'replay_complete' | 'replay_halted'
  >('idle');

  // Interactive page states
  const [billPayee, setBillPayee] = useState('ECG Prepaid Meter #04291882');
  const [billAmount, setBillAmount] = useState('120.00');
  const [lastGuardBanner, setLastGuardBanner] = useState<PolicyDecision | null>(null);
  const [csvExportDownloaded, setCsvExportDownloaded] = useState(false);
  const [docNoteContent, setDocNoteContent] = useState(
    'Q4 Settlement Checklist:\n1. Reconcile October Ghana MoMo wallet (GHS 2,457.50 verified)\n2. Review ECG utility draft before approval\n3. Export clean audit CSV for accountant'
  );

  const ghsRecords = SYNTHETIC_STATEMENT_FIXTURES.ghana_momo_sms_clean.records;

  // Helper to update a tab
  const updateTab = (tabId: string, updater: (prev: BrowserTabItem) => BrowserTabItem) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? updater(t) : t)));
  };

  const deriveTitleFromUrl = (url: string): string => {
    if (url.includes('mockbank.local/transactions')) return 'MockBank — Transactions';
    if (url.includes('mockbank.local/pay_bill')) return 'MockBank — Pay Bill';
    if (url.includes('mockbank.local/login_2fa')) return 'MockBank — 2FA Login';
    if (url.includes('mockbank.local')) return 'MockBank Portal — Accounts';
    if (url.includes('momo.telecom.gh')) return 'Ghana MoMo Wallet';
    if (url.includes('mail.workspace.local')) return 'Workspace Mail — Inbox';
    if (url.includes('docs.workspace.local')) return 'Workspace Docs — Notes';
    if (url.includes('wire.markets.local')) return 'Market & FX Wire';
    return url.replace(/^https?:\/\//, '').slice(0, 28) || 'New Tab';
  };

  // Navigate current tab to a URL or search query
  const navigateToUrl = (rawTarget: string, triggeredBy: 'user' | 'ai' = 'user') => {
    let normalized = rawTarget.trim();
    if (!normalized) return;

    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      if (normalized.includes('.') && !normalized.includes(' ')) {
        normalized = `https://${normalized}`;
      } else {
        normalized = `https://search.blaize.local/?q=${encodeURIComponent(normalized)}`;
      }
    }

    let subPage: BrowserTabItem['subPage'] = 'accounts';
    if (normalized.includes('/transactions')) subPage = 'transactions';
    else if (normalized.includes('/pay_bill')) subPage = 'pay_bill';
    else if (normalized.includes('/login_2fa')) {
      subPage = 'login_2fa';
      setControlMode('user_manual');
    }

    updateTab(activeTab.id, (t) => {
      const nextHistory = [...t.history.slice(0, t.historyIndex + 1), normalized];
      return {
        ...t,
        url: normalized,
        title: deriveTitleFromUrl(normalized),
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
        subPage,
      };
    });
    setAddressInput(normalized);

    if (isRecordingTeach) {
      setRecordedEvents((prev) => [...prev, `${triggeredBy}_navigate -> ${normalized}`]);
    }
    if (triggeredBy === 'ai') {
      setAiStatusText(`Morrow navigated to ${normalized}`);
    }
  };

  // Switch active tab
  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    const target = tabs.find((t) => t.id === tabId);
    if (target) {
      setAddressInput(target.url);
    }
  };

  // Open new tab
  const handleNewTab = () => {
    const newId = `tab-${Date.now()}`;
    const defaultUrl = 'https://wire.markets.local/rates';
    const newTab: BrowserTabItem = {
      id: newId,
      title: 'Market & FX Wire',
      url: defaultUrl,
      history: [defaultUrl],
      historyIndex: 0,
      isLoggedIn: false,
      loggedInUser: 'Guest',
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
    setAddressInput(defaultUrl);
  };

  // Close tab
  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length <= 1) return;
    const filtered = tabs.filter((t) => t.id !== tabId);
    setTabs(filtered);
    if (activeTabId === tabId) {
      setActiveTabId(filtered[0].id);
      setAddressInput(filtered[0].url);
    }
  };

  // Back / Forward / Reload
  const handleBack = () => {
    if (activeTab.historyIndex <= 0) return;
    const nextIdx = activeTab.historyIndex - 1;
    const prevUrl = activeTab.history[nextIdx];
    updateTab(activeTab.id, (t) => ({
      ...t,
      url: prevUrl,
      title: deriveTitleFromUrl(prevUrl),
      historyIndex: nextIdx,
    }));
    setAddressInput(prevUrl);
  };

  const handleForward = () => {
    if (activeTab.historyIndex >= activeTab.history.length - 1) return;
    const nextIdx = activeTab.historyIndex + 1;
    const nextUrl = activeTab.history[nextIdx];
    updateTab(activeTab.id, (t) => ({
      ...t,
      url: nextUrl,
      title: deriveTitleFromUrl(nextUrl),
      historyIndex: nextIdx,
    }));
    setAddressInput(nextUrl);
  };

  const handleReload = () => {
    setAiStatusText(`Reloaded ${activeTab.url} (persist:${activeProfile})`);
  };

  // Run an AI Browser command in the active tab
  const handleRunAiBrowserTask = (presetCommand?: string) => {
    const task = (presetCommand || aiTaskPrompt).trim();
    if (!task) return;
    setControlMode('ai_autopilot');
    setIsAiExecuting(true);
    setAiStatusText(`Morrow executing: "${task}"...`);

    const lower = task.toLowerCase();
    window.setTimeout(() => {
      if (lower.includes('transaction') || lower.includes('statement') || lower.includes('csv')) {
        navigateToUrl('https://portal.mockbank.local/transactions', 'ai');
        setCsvExportDownloaded(true);
        setAiStatusText(
          'Extracted 6 transactions from MockBank & verified closing balance GHS 2,457.50'
        );
      } else if (lower.includes('login') || lower.includes('2fa') || lower.includes('sign in')) {
        navigateToUrl('https://portal.mockbank.local/login_2fa', 'ai');
        setControlMode('user_manual');
        setLoginModalOpen(true);
        setAiStatusText(
          'Private login mode — AI screenshots & DOM access paused while you sign in'
        );
      } else if (lower.includes('pay') || lower.includes('draft') || lower.includes('bill')) {
        navigateToUrl('https://portal.mockbank.local/pay_bill', 'ai');
        handleMockBankActionClick('prepare_draft');
        setAiStatusText('Prepared SIMULATION bill draft and requested your approval');
      } else if (lower.includes('mail') || lower.includes('inbox')) {
        navigateToUrl('https://mail.workspace.local/inbox', 'ai');
        setAiStatusText('Summarized 3 priority messages in Workspace Mail');
      } else {
        navigateToUrl(task, 'ai');
      }
      setIsAiExecuting(false);
      setAiTaskPrompt('');
    }, 350);
  };

  // PolicyGuard checks on MockBank actions
  const handleMockBankActionClick = (
    actionKind: 'direct_pay_click' | 'prepare_draft' | 'agent_type_2fa'
  ) => {
    if (actionKind === 'direct_pay_click') {
      const decision = evaluatePolicyGuard(
        {
          id: `browser_pay_${Date.now()}`,
          kind: 'click',
          target: 'https://portal.mockbank.local/pay-bill#execute',
          risk: 'money',
          source: 'model',
          missionId: 'mission-browser-interactive',
          profileId: activeProfile,
          amount: Number.parseFloat(billAmount) || 120,
          currency: 'GHS',
          resolvedElement: {
            tagName: 'BUTTON',
            role: 'button',
            text: `Pay Bill Immediately (GHS ${billAmount})`,
            ariaLabel: 'Pay Bill Immediately',
            formAction: '/api/transfer/execute',
            isCredentialField: false,
            selector: 'button#execute-live-pay',
            coordinates: { x: 612, y: 448 },
            domain: 'portal.mockbank.local',
          },
        },
        { ...policyConfig, activeProfileId: activeProfile }
      );
      setLastGuardBanner(decision);
      onLogGuardDecisionToLedger(
        decision,
        `PolicyGuard blocked direct 'Pay Bill Immediately' click on portal.mockbank.local (Read-Only Finance Mode).`
      );
      return;
    }

    if (actionKind === 'prepare_draft') {
      const decision = evaluatePolicyGuard(
        {
          id: `browser_draft_${Date.now()}`,
          kind: 'draft_money',
          target: 'https://portal.mockbank.local/pay-bill#draft',
          risk: 'money',
          source: 'skill',
          missionId: 'mission-browser-interactive',
          profileId: activeProfile,
          amount: Number.parseFloat(billAmount) || 120,
          currency: 'GHS',
          resolvedElement: {
            tagName: 'BUTTON',
            role: 'button',
            text: `Prepare SIMULATION Bill Draft (GHS ${billAmount})`,
            ariaLabel: 'Prepare Draft Only',
            isCredentialField: false,
            selector: 'button#prepare-simulation-draft',
            coordinates: { x: 420, y: 448 },
            domain: 'portal.mockbank.local',
          },
        },
        { ...policyConfig, activeProfileId: activeProfile }
      );
      setLastGuardBanner(decision);
      onLogGuardDecisionToLedger(
        decision,
        `Prepared SIMULATION draft for ${billPayee} (GHS ${billAmount}) -> Routed to Approval Sheet.`
      );
      onRequestApproval(
        `Approve SIMULATION Bill Draft: GHS ${billAmount} to ${billPayee}`,
        'https://portal.mockbank.local/pay-bill#draft',
        'money',
        decision.reason
      );
      return;
    }

    if (actionKind === 'agent_type_2fa') {
      const decision = evaluatePolicyGuard(
        {
          id: `browser_2fa_${Date.now()}`,
          kind: 'type',
          target: 'input#mockbank-2fa-otp',
          risk: 'sensitive',
          source: 'model',
          missionId: 'mission-browser-interactive',
          profileId: activeProfile,
          typedText: '991204',
          resolvedElement: {
            tagName: 'INPUT',
            role: 'textbox',
            text: '',
            ariaLabel: 'Enter 6-digit SMS 2FA Code',
            inputType: 'password',
            isCredentialField: true,
            selector: 'input#mockbank-2fa-otp',
            domain: 'portal.mockbank.local',
          },
        },
        { ...policyConfig, activeProfileId: activeProfile }
      );
      setLastGuardBanner(decision);
      onLogGuardDecisionToLedger(
        decision,
        'Credential field detected: suspended model screenshots & triggered user takeover.'
      );
    }
  };

  // User completes login / 2FA in browser
  const handleCompleteUserLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim()) return;
    updateTab(activeTab.id, (t) => ({
      ...t,
      isLoggedIn: true,
      loggedInUser: loginUsername.trim(),
      subPage: t.url.includes('mockbank.local') ? 'accounts' : t.subPage,
      url: t.url.includes('login_2fa') ? 'https://portal.mockbank.local/accounts' : t.url,
    }));
    if (activeTab.url.includes('login_2fa')) {
      setAddressInput('https://portal.mockbank.local/accounts');
    }
    setLoginPassword('');
    setLoginOtp('');
    setLoginModalOpen(false);
    setControlMode('ai_autopilot');
    setAiStatusText(
      `Signed in as ${loginUsername.trim()} (persist:${activeProfile}). Control returned to Morrow.`
    );
  };

  const handleCompileRecording = () => {
    const nextVersion = compiledSkill.version + 1;
    const newStep: RecordedSkillStep = {
      id: `step-custom-${nextVersion}`,
      intent: `Verify ${activeProfile} session & export transactions (${recordedEvents.length} events)`,
      risk: 'read',
      actionHint: {
        type: 'extract_a11y',
        role: 'region',
        accessibleName: 'Transactions & Balance Summary',
        selectorCandidates: ['table#mockbank-tx-table', '[role="table"]'],
      },
      expectedState: 'Opening GHS 1,240.00 + Transactions == Closing GHS 2,457.50',
      domCheck: '#mockbank-balance-summary',
      variables: ['profileId', 'statementMonth', 'draftAmount'],
      retryCount: 1,
    };

    onUpdateCompiledSkill({
      ...compiledSkill,
      version: nextVersion,
      profileId: activeProfile,
      narrationTranscript: narrationText,
      steps: [...compiledSkill.steps.slice(0, 3), newStep],
    });
    setIsRecordingTeach(false);
  };

  const isBookmarked = bookmarkedUrls.includes(activeTab.url);
  const currentBankSubPage = activeTab.subPage || 'accounts';
  const isPrivacyShieldActive =
    controlMode === 'user_manual' ||
    currentBankSubPage === 'login_2fa' ||
    loginModalOpen;

  return (
    <div className="flex flex-col h-full">
      {/* Main Browser Window Frame */}
      <div
        className={`rounded-2xl border overflow-hidden shadow-xl flex flex-col flex-1 ${
          isLight ? 'bg-white border-stone-300' : 'bg-[#0F131C] border-stone-800'
        }`}
      >
        {/* 1. BROWSER TAB STRIP */}
        <div
          className={`flex items-center justify-between px-3 pt-2 border-b select-none ${
            isLight ? 'bg-stone-200/90 border-stone-300' : 'bg-[#090C12] border-stone-800'
          }`}
        >
          <div className="flex items-center gap-1 overflow-x-auto max-w-full pb-0.5">
            {/* Window traffic dots */}
            <div className="hidden sm:flex items-center gap-1.5 px-2 pb-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            </div>

            {tabs.map((tab) => {
              const isCurrent = tab.id === activeTab.id;
              return (
                <div
                  key={tab.id}
                  role="tab"
                  aria-selected={isCurrent}
                  onClick={() => handleSelectTab(tab.id)}
                  className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-xl text-xs font-medium cursor-pointer transition-colors min-w-[144px] max-w-[220px] border-t border-x ${
                    isCurrent
                      ? isLight
                        ? 'bg-white border-stone-300 text-stone-900 shadow-xs'
                        : 'bg-[#161B26] border-stone-700/80 text-stone-100'
                      : isLight
                      ? 'bg-stone-200/60 border-transparent text-stone-600 hover:bg-stone-100'
                      : 'bg-transparent border-transparent text-stone-400 hover:bg-stone-900/70 hover:text-stone-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                  <span className="truncate flex-1">{tab.title}</span>
                  {isCurrent && !isPrivacyShieldActive && (
                    <span
                      title="Controlled by Morrow AI Agent"
                      className="text-[10px] font-mono text-sky-400 shrink-0"
                    >
                      AI
                    </span>
                  )}
                  {!isCurrent && (
                    <span
                      title="Suspended in background (0 MB)"
                      className="text-[9px] text-stone-500 font-mono shrink-0"
                    >
                      zZz
                    </span>
                  )}
                  {tabs.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Close ${tab.title}`}
                      onClick={(e) => handleCloseTab(tab.id, e)}
                      className="p-0.5 rounded hover:bg-stone-500/20 opacity-70 hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={handleNewTab}
              aria-label="Open new browser tab"
              title="New Tab"
              className={`p-1.5 rounded-lg mb-1 transition-colors ${
                isLight
                  ? 'hover:bg-stone-300/70 text-stone-700'
                  : 'hover:bg-stone-800 text-stone-300'
              }`}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Right side of tab bar: Profile Partition & Bookmarks toggle */}
          <div className="flex items-center gap-2 pb-1.5 pl-2 shrink-0">
            <button
              type="button"
              onClick={() => setBookmarksVisible((v) => !v)}
              className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-stone-400 hover:text-stone-200"
              title="Toggle Bookmarks & Teach Strip"
            >
              <Bookmark className="w-3 h-3" />
              <span>Bookmarks</span>
            </button>
            <select
              aria-label="Browser profile partition"
              value={activeProfile}
              onChange={(e) => onChangeProfile(e.target.value as BrowserProfileId)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-lg border outline-none ${
                isLight
                  ? 'bg-stone-100 border-stone-300 text-stone-800'
                  : 'bg-[#161B26] border-stone-700 text-stone-200'
              }`}
            >
              <option value="personal">Profile: Personal</option>
              <option value="work">Profile: Work</option>
              <option value="testing">Profile: Testing</option>
            </select>
          </div>
        </div>

        {/* 2. NAVIGATION OMNIBOX TOOLBAR */}
        <div
          className={`flex flex-wrap items-center gap-2 px-3 py-2 border-b ${
            isLight ? 'bg-stone-50 border-stone-200' : 'bg-[#161B26] border-stone-800'
          }`}
        >
          {/* Back / Forward / Reload */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleBack}
              disabled={activeTab.historyIndex <= 0}
              aria-label="Browser Back"
              className="p-1.5 rounded-lg disabled:opacity-30 hover:bg-stone-500/15 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleForward}
              disabled={activeTab.historyIndex >= activeTab.history.length - 1}
              aria-label="Browser Forward"
              className="p-1.5 rounded-lg disabled:opacity-30 hover:bg-stone-500/15 transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleReload}
              aria-label="Reload page"
              className="p-1.5 rounded-lg hover:bg-stone-500/15 transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Editable URL / Search Omnibox */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigateToUrl(addressInput, 'user');
            }}
            className={`flex-1 min-w-[200px] flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-colors ${
              isLight
                ? 'bg-white border-stone-300 focus-within:border-sky-500 text-stone-800'
                : 'bg-[#0B0E15] border-stone-700/90 focus-within:border-sky-500 text-stone-100'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <input
              type="text"
              aria-label="Browser address and search bar"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Enter URL or search query..."
              className="flex-1 bg-transparent outline-none font-mono text-xs"
            />
            <button
              type="button"
              onClick={() =>
                setBookmarkedUrls((prev) =>
                  prev.includes(activeTab.url)
                    ? prev.filter((u) => u !== activeTab.url)
                    : [...prev, activeTab.url]
                )
              }
              aria-label="Bookmark current page"
              className="p-0.5 text-stone-400 hover:text-amber-400"
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  isBookmarked ? 'fill-amber-400 text-amber-400' : ''
                }`}
              />
            </button>
          </form>

          {/* Zoom Controls */}
          <div className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-700/50 text-[11px]">
            <button
              type="button"
              onClick={() => setZoomPct((z) => Math.max(80, z - 10))}
              aria-label="Zoom out"
              className="p-0.5 hover:text-sky-400"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono w-9 text-center">{zoomPct}%</span>
            <button
              type="button"
              onClick={() => setZoomPct((z) => Math.min(125, z + 10))}
              aria-label="Zoom in"
              className="p-0.5 hover:text-sky-400"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* User Login / Account Session Button */}
          <button
            type="button"
            onClick={() => {
              setControlMode('user_manual');
              setLoginModalOpen(true);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
              activeTab.isLoggedIn
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {activeTab.isLoggedIn ? activeTab.loggedInUser : 'Log in'}
            </span>
          </button>

          {/* AI Control vs User Control Mode Switch */}
          <div
            className={`inline-flex items-center p-0.5 rounded-xl border text-xs ${
              isLight ? 'bg-stone-200 border-stone-300' : 'bg-[#0B0E15] border-stone-700'
            }`}
          >
            <button
              type="button"
              onClick={() => setControlMode('ai_autopilot')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-colors ${
                controlMode === 'ai_autopilot'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>AI Control</span>
            </button>
            <button
              type="button"
              onClick={() => setControlMode('user_manual')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-colors ${
                controlMode === 'user_manual'
                  ? 'bg-amber-400 text-stone-950 font-semibold'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>User Control</span>
            </button>
          </div>

          {/* Ask Morrow in Chat handoff button */}
          {onAskMorrowInChat && (
            <button
              type="button"
              onClick={() =>
                onAskMorrowInChat(
                  `Inspect my active browser tab (${activeTab.title} at ${activeTab.url}) and summarize the key numbers.`
                )
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 text-xs font-medium"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Ask Morrow in Chat</span>
            </button>
          )}
        </div>

        {/* 2B. PASSWORD / OTP / 2FA PRIVACY SHIELD BANNER */}
        {isPrivacyShieldActive && (
          <div
            data-testid="browser-privacy-shield-banner"
            className="px-4 py-2 bg-amber-500/15 border-b border-amber-500/40 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200"
          >
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Private login mode — AI screenshots &amp; DOM access paused.</strong> Your
                credentials and 2FA codes stay inside <code className="font-mono">persist:{activeProfile}</code>.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setControlMode('ai_autopilot');
                if (currentBankSubPage === 'login_2fa') {
                  navigateToUrl('https://portal.mockbank.local/accounts', 'user');
                }
                setAiStatusText('Control returned to Morrow · PolicyGuard watching active tab');
              }}
              className="px-3 py-1 rounded-lg bg-amber-400 text-stone-950 font-semibold hover:bg-amber-300 shrink-0"
            >
              Return control to Morrow
            </button>
          </div>
        )}

        {/* 3. COLLAPSIBLE BOOKMARKS & TEACH BAR */}
        {bookmarksVisible && (
          <div
            className={`flex items-center justify-between gap-2 px-3 py-1.5 border-b text-xs overflow-x-auto ${
              isLight ? 'bg-stone-100 border-stone-200' : 'bg-[#121620] border-stone-800/80'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-stone-400 shrink-0 mr-1" />
              {BOOKMARKS.map((bm) => (
                <button
                  key={bm.url}
                  type="button"
                  onClick={() => navigateToUrl(bm.url, 'user')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                    activeTab.url.startsWith(bm.url.split('/').slice(0, 3).join('/'))
                      ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                      : 'hover:bg-stone-500/15 text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {bm.title}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setTeachDrawerOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:underline whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3 h-3" />
              <span>Teach &amp; Replay ({compiledSkill.steps.length} steps)</span>
              {teachDrawerOpen ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>
        )}

        {/* 4. COMPACT AI BROWSER TASK BAR */}
        <div
          className={`px-3 py-1.5 border-b flex flex-wrap items-center justify-between gap-2 text-xs ${
            isLight
              ? 'bg-stone-100/80 border-stone-200 text-stone-700'
              : 'bg-[#101520] border-stone-800/80 text-stone-300'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                controlMode === 'ai_autopilot' ? 'bg-sky-400' : 'bg-amber-400'
              }`}
            />
            <span className="truncate text-[11px]">{aiStatusText}</span>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRunAiBrowserTask();
            }}
            className="flex items-center gap-1.5 flex-1 max-w-md"
          >
            <input
              type="text"
              value={aiTaskPrompt}
              onChange={(e) => setAiTaskPrompt(e.target.value)}
              placeholder="Instruct Morrow on this page (e.g. 'Extract transactions')..."
              className={`flex-1 px-2.5 py-1 rounded-lg border text-xs outline-none ${
                isLight
                  ? 'bg-white border-stone-300 text-stone-900'
                  : 'bg-[#0B0E15] border-stone-700 text-stone-100'
              }`}
            />
            <button
              type="submit"
              disabled={isAiExecuting}
              className="px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-[11px] whitespace-nowrap"
            >
              {isAiExecuting ? 'Running...' : 'AI Run'}
            </button>
          </form>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleRunAiBrowserTask('Extract transactions & verify balance')}
              className="px-2 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-[11px] font-medium whitespace-nowrap text-sky-300"
            >
              Extract Statement
            </button>
            <button
              type="button"
              onClick={() => handleRunAiBrowserTask('Draft utility bill payment')}
              className="px-2 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-[11px] font-medium whitespace-nowrap text-sky-300"
            >
              Draft Bill
            </button>
          </div>
        </div>

        {/* PolicyGuard Banner (only when triggered) */}
        {lastGuardBanner && (
          <div
            className={`px-4 py-2 border-b flex items-center justify-between gap-4 text-xs ${
              lastGuardBanner.status === 'DENY'
                ? 'bg-rose-950/60 border-rose-800 text-rose-200'
                : 'bg-amber-950/60 border-amber-800 text-amber-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 shrink-0" />
              <span>
                <strong>PolicyGuard [{lastGuardBanner.status}]:</strong> {lastGuardBanner.reason}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setLastGuardBanner(null)}
              className="text-xs underline opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 5. DOMINANT WEB PAGE VIEWPORT CONTENT */}
        <div
          style={{ zoom: `${zoomPct}%` }}
          className={`flex-1 p-6 overflow-y-auto ${
            isLight ? 'bg-[#FAF8F5] text-stone-900' : 'bg-[#0B0F17] text-stone-100'
          }`}
        >
          {/* SITE A: MOCKBANK PORTAL */}
          {activeTab.url.includes('mockbank.local') && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-stone-800/60">
                <div>
                  <div className="flex items-center gap-2 text-xs text-stone-400 font-mono">
                    <span className="text-emerald-400 font-semibold">
                      SIMULATED SANDBOX · READ-ONLY FINANCE GUARD
                    </span>
                    <span>·</span>
                    <span>User: {activeTab.loggedInUser}</span>
                  </div>
                  <h2 className="text-lg font-bold mt-1">
                    Accra &amp; Global Merchant Banking Portal
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'accounts' as const, label: 'Accounts' },
                    { id: 'transactions' as const, label: 'Transactions & CSV' },
                    { id: 'pay_bill' as const, label: 'Pay Bill' },
                    { id: 'login_2fa' as const, label: 'Login & 2FA' },
                  ].map((nav) => (
                    <button
                      key={nav.id}
                      type="button"
                      onClick={() =>
                        navigateToUrl(`https://portal.mockbank.local/${nav.id}`, 'user')
                      }
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        currentBankSubPage === nav.id
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : isLight
                          ? 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                          : 'bg-stone-900 text-stone-300 hover:bg-stone-800 border border-stone-800'
                      }`}
                    >
                      {nav.label}
                    </button>
                  ))}
                </div>
              </div>

              {currentBankSubPage === 'accounts' && (
                <div id="mockbank-accounts-root" className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div
                    className={`rounded-xl border p-4 ${
                      isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                    }`}
                  >
                    <span className="text-xs text-stone-400">Makola Trader MoMo Wallet</span>
                    <div className="text-2xl font-bold font-mono mt-1">GHS 2,457.50</div>
                    <p className="text-xs text-emerald-400 font-mono mt-1">
                      Opening: GHS 1,240.00 · Verified
                    </p>
                  </div>

                  <div
                    className={`rounded-xl border p-4 ${
                      isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                    }`}
                  >
                    <span className="text-xs text-stone-400">US Freelance Settlement</span>
                    <div className="text-2xl font-bold font-mono mt-1">USD 4,706.00</div>
                    <p className="text-xs text-amber-400 font-mono mt-1">
                      1 Duplicate Charge ($49.00) Flagged
                    </p>
                  </div>

                  <div
                    className={`rounded-xl border p-4 ${
                      isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                    }`}
                  >
                    <span className="text-xs text-stone-400">SEPA Euro Commercial Reserve</span>
                    <div className="text-2xl font-bold font-mono mt-1">EUR 5.115,25</div>
                    <p className="text-xs text-sky-400 font-mono mt-1">
                      EU Locale Normalized
                    </p>
                  </div>
                </div>
              )}

              {currentBankSubPage === 'transactions' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div id="mockbank-balance-summary" className="text-xs font-mono">
                      Opening: GHS 1,240.00 · Credits: +GHS 2,000.00 · Debits: -GHS 782.50 ·{' '}
                      <span className="text-emerald-400 font-semibold">
                        Closing: GHS 2,457.50 (VERIFIED)
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setCsvExportDownloaded(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {csvExportDownloaded ? 'CSV Exported' : 'Download Statement CSV'}
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-stone-800/80">
                    <table id="mockbank-tx-table" className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-stone-800 text-stone-400 bg-stone-900/40">
                          <th className="py-2.5 px-4">Date</th>
                          <th className="py-2.5 px-4">Counterparty</th>
                          <th className="py-2.5 px-4">Description</th>
                          <th className="py-2.5 px-4 text-right">Amount</th>
                          <th className="py-2.5 px-4 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-800/60 font-mono">
                        {ghsRecords.map((r) => (
                          <tr key={r.id}>
                            <td className="py-2.5 px-4 whitespace-nowrap">{r.date}</td>
                            <td className="py-2.5 px-4 font-sans font-medium">{r.counterparty}</td>
                            <td className="py-2.5 px-4 font-sans text-stone-400">
                              {r.description}
                            </td>
                            <td
                              className={`py-2.5 px-4 text-right whitespace-nowrap ${
                                r.direction === 'credit' ? 'text-emerald-400' : ''
                              }`}
                            >
                              {r.direction === 'credit' ? '+' : '-'}GHS {r.amount.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              GHS {(r.balanceAfter || 2457.5).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {currentBankSubPage === 'pay_bill' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div
                    className={`rounded-xl border p-5 space-y-4 ${
                      isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                    }`}
                  >
                    <h3 className="text-sm font-semibold">Bill Payment &amp; Transfer</h3>
                    <div className="space-y-3 text-xs">
                      <div>
                        <label
                          htmlFor="mockbank-payee-input"
                          className="block text-stone-400 mb-1"
                        >
                          Payee / Recipient
                        </label>
                        <input
                          id="mockbank-payee-input"
                          type="text"
                          value={billPayee}
                          onChange={(e) => setBillPayee(e.target.value)}
                          className={`w-full rounded-lg border px-3 py-2 ${
                            isLight
                              ? 'bg-stone-50 border-stone-300'
                              : 'bg-stone-950 border-stone-700'
                          }`}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="mockbank-amount-input"
                          className="block text-stone-400 mb-1"
                        >
                          Amount (GHS)
                        </label>
                        <input
                          id="mockbank-amount-input"
                          type="text"
                          value={billAmount}
                          onChange={(e) => setBillAmount(e.target.value)}
                          className={`w-full rounded-lg border px-3 py-2 font-mono ${
                            isLight
                              ? 'bg-stone-50 border-stone-300'
                              : 'bg-stone-950 border-stone-700'
                          }`}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 pt-2">
                      <button
                        id="prepare-draft-btn"
                        type="button"
                        onClick={() => handleMockBankActionClick('prepare_draft')}
                        className="px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 hover:bg-sky-400 rounded-lg"
                      >
                        Prepare SIMULATION Draft (Requires Approval)
                      </button>
                      <button
                        id="execute-pay-now"
                        type="button"
                        onClick={() => handleMockBankActionClick('direct_pay_click')}
                        className="px-3.5 py-2 text-xs font-semibold bg-rose-950/80 border border-rose-700 text-rose-200 hover:bg-rose-900 rounded-lg"
                      >
                        Test Direct Pay Click (Blocked by Guard)
                      </button>
                    </div>
                  </div>

                  <div
                    className={`rounded-xl border p-5 space-y-2 text-xs ${
                      isLight ? 'bg-stone-100 border-stone-200' : 'bg-stone-900/40 border-stone-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-amber-400 font-semibold">
                      <ShieldAlert className="w-4 h-4" />
                      <span>PolicyGuard Protection</span>
                    </div>
                    <p className="text-stone-400 leading-relaxed">
                      Direct money execution is deterministically blocked by PolicyGuard. Morrow can
                      only prepare a simulation draft and request your explicit approval.
                    </p>
                  </div>
                </div>
              )}

              {currentBankSubPage === 'login_2fa' && (
                <div
                  className={`max-w-lg rounded-xl border border-amber-500/40 p-5 space-y-4 ${
                    isLight ? 'bg-amber-50/60' : 'bg-stone-900/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-amber-400">
                      PRIVATE LOGIN MODE · AI SCREENSHOTS PAUSED
                    </span>
                    <UserCheck className="w-4 h-4 text-amber-400" />
                  </div>
                  <h3 className="text-sm font-semibold">
                    Sign In / Complete 2FA Verification
                  </h3>
                  <p className="text-xs text-stone-400">
                    Morrow automatically pauses screenshots and DOM reading when a password or 2FA
                    field appears so you can log in privately.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setLoginModalOpen(true)}
                      className="px-4 py-2 text-xs font-semibold bg-emerald-500 text-slate-950 rounded-lg hover:bg-emerald-400"
                    >
                      Open User Login &amp; 2FA Dialog
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMockBankActionClick('agent_type_2fa')}
                      className="px-3 py-2 text-xs font-mono bg-stone-800 text-amber-300 rounded-lg hover:bg-stone-700"
                    >
                      Test AI Typing OTP (Blocked)
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SITE B: GHANA MOMO WALLET */}
          {activeTab.url.includes('momo.telecom.gh') && (
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                <div>
                  <span className="text-xs font-mono text-amber-400">GHANA TELECOM MOMO</span>
                  <h2 className="text-lg font-bold">Mobile Money Merchant Wallet</h2>
                </div>
                <span className="text-xs font-mono text-emerald-400">
                  Wallet: {activeTab.loggedInUser}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl border border-stone-800 bg-stone-900/60">
                  <div className="text-xs text-stone-400">Available Wallet Balance</div>
                  <div className="text-xl font-bold font-mono mt-1">GHS 2,457.50</div>
                </div>
                <div className="p-4 rounded-xl border border-stone-800 bg-stone-900/60">
                  <div className="text-xs text-stone-400">October Collections</div>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    +GHS 2,000.00
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-stone-800 bg-stone-900/60">
                  <div className="text-xs text-stone-400">Supplier &amp; Utility Payouts</div>
                  <div className="text-xl font-bold font-mono text-amber-300 mt-1">
                    -GHS 782.50
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SITE C: WORKSPACE MAIL */}
          {activeTab.url.includes('mail.workspace.local') && (
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                <div>
                  <span className="text-xs font-mono text-sky-400">WORKSPACE MAIL</span>
                  <h2 className="text-lg font-bold">Inbox ({activeTab.loggedInUser})</h2>
                </div>
              </div>
              <div className="divide-y divide-stone-800 rounded-xl border border-stone-800 overflow-hidden">
                {[
                  {
                    from: 'ECG Billing Desk',
                    subject: 'October Prepaid Meter Statement #04291882 (GHS 120.00)',
                    time: '10:15 AM',
                  },
                  {
                    from: 'Accra Textile Wholesale',
                    subject: 'Invoice Confirmed — Cotton Bale Restock',
                    time: 'Yesterday',
                  },
                  {
                    from: 'Stripe Settlement',
                    subject: 'Payout of USD 1,850.00 initiated to US Checking',
                    time: 'Oct 26',
                  },
                ].map((email, i) => (
                  <div
                    key={i}
                    className="p-3.5 flex items-center justify-between gap-4 hover:bg-stone-900/50 text-xs"
                  >
                    <div>
                      <div className="font-semibold">{email.from}</div>
                      <div className="text-stone-400">{email.subject}</div>
                    </div>
                    <span className="font-mono text-stone-500">{email.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SITE D: WORKSPACE DOCS */}
          {activeTab.url.includes('docs.workspace.local') && (
            <div className="max-w-4xl mx-auto space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold">Workspace Notes &amp; Mission Scratchpad</h2>
                <span className="text-xs text-emerald-400 font-mono">Saved locally</span>
              </div>
              <textarea
                aria-label="Workspace document editor"
                rows={7}
                value={docNoteContent}
                onChange={(e) => setDocNoteContent(e.target.value)}
                className={`w-full rounded-xl border p-4 text-xs font-mono leading-relaxed outline-none ${
                  isLight
                    ? 'bg-white border-stone-300 text-stone-900'
                    : 'bg-stone-900/70 border-stone-800 text-stone-100'
                }`}
              />
            </div>
          )}

          {/* SITE E: MARKET & FX WIRE OR CUSTOM SEARCH / URL */}
          {!activeTab.url.includes('mockbank.local') &&
            !activeTab.url.includes('momo.telecom.gh') &&
            !activeTab.url.includes('mail.workspace.local') &&
            !activeTab.url.includes('docs.workspace.local') && (
              <div className="max-w-4xl mx-auto space-y-4">
                <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                  <div>
                    <span className="text-xs font-mono text-sky-400">{activeTab.url}</span>
                    <h2 className="text-lg font-bold mt-0.5">{activeTab.title}</h2>
                  </div>
                  <span className="text-xs font-mono text-stone-400">
                    Session: {activeTab.loggedInUser}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-4 rounded-xl border border-stone-800 bg-stone-900/50">
                    <div className="text-stone-400">USD / GHS Interbank</div>
                    <div className="text-lg font-bold font-mono mt-1">15.42 GHS</div>
                  </div>
                  <div className="p-4 rounded-xl border border-stone-800 bg-stone-900/50">
                    <div className="text-stone-400">EUR / USD Spot</div>
                    <div className="text-lg font-bold font-mono mt-1">1.084 USD</div>
                  </div>
                  <div className="p-4 rounded-xl border border-stone-800 bg-stone-900/50">
                    <div className="text-stone-400">Browser Isolation</div>
                    <div className="text-sm font-semibold text-emerald-400 mt-1">
                      Sandboxed · Persist:{activeProfile}
                    </div>
                  </div>
                </div>
              </div>
            )}
        </div>

        {/* 6. COLLAPSIBLE TEACH & REPLAY STUDIO DRAWER */}
        {teachDrawerOpen && (
          <div
            className={`border-t p-3.5 space-y-2.5 text-xs ${
              isLight ? 'bg-stone-100 border-stone-300' : 'bg-[#121620] border-stone-800'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                <span>
                  Teach &amp; Replay Skill: {compiledSkill.name} (v{compiledSkill.version})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsRecordingTeach(!isRecordingTeach)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border ${
                    isRecordingTeach
                      ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                      : 'border-stone-700 hover:bg-stone-800'
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  <span>{isRecordingTeach ? 'Stop Recording' : 'Record Demo'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCompileRecording}
                  className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100"
                >
                  Compile v{compiledSkill.version + 1}
                </button>
                <button
                  type="button"
                  onClick={() => setReplayMode('dry_run_complete')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-500/40 text-amber-300"
                >
                  <Eye className="w-3 h-3" />
                  <span>Dry Run</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReplayMode('replay_complete')}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-sky-500 text-slate-950 font-semibold"
                >
                  <Play className="w-3 h-3" />
                  <span>Replay ({replayMode})</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* USER LOGIN & 2FA CREDENTIAL TAKEOVER MODAL */}
      {loginModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Browser Account Login"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <div
            className={`w-full max-w-md rounded-2xl border p-6 space-y-4 shadow-2xl ${
              isLight ? 'bg-white border-stone-300 text-stone-900' : 'bg-[#151923] border-stone-700 text-stone-100'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold">Private Login Mode (AI Blindfolded)</h3>
              </div>
              <button
                type="button"
                onClick={() => setLoginModalOpen(false)}
                className="p-1 rounded-lg hover:bg-stone-500/20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-stone-400 leading-relaxed">
              Log into <strong>{activeTab.title}</strong> directly. Your password and 2FA code stay in
              your isolated browser session (<code className="font-mono">persist:{activeProfile}</code>)
              and are never sent to the AI model.
            </p>

            <form onSubmit={handleCompleteUserLogin} className="space-y-3 text-xs">
              <div>
                <label className="block text-stone-400 mb-1">Username / Email / Phone</label>
                <input
                  type="text"
                  required
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border ${
                    isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-700'
                  }`}
                />
              </div>
              <div>
                <label className="block text-stone-400 mb-1">Password</label>
                <input
                  type="password"
                  placeholder="••••••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border ${
                    isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-700'
                  }`}
                />
              </div>
              <div>
                <label className="block text-stone-400 mb-1">6-Digit 2FA Code (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 482910"
                  value={loginOtp}
                  onChange={(e) => setLoginOtp(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border font-mono ${
                    isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-700'
                  }`}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setLoginModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-stone-700 text-stone-400 hover:text-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400"
                >
                  Sign In &amp; Return Control to Morrow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

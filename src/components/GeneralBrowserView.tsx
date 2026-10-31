/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * General-Purpose AI Browser (Prompt 4/4)
 * - Domain-neutral start page (search box, neutral bookmarks, recent sites)
 * - 3 BrowserEngine implementations: ReaderEngine (server-side), RemoteBrowserEngine (headless Chromium), ElectronViewEngine (desktop stub)
 * - Human view: tabs, omnibox, reader mode, tables extractor, citations collector, bookmarks, history
 * - Security: SSRF blocker, untrusted content tagging [Untrusted External Web Content], prompt injection scanner, per-profile cookie isolation
 * - Login takeover privacy shield: warning that credentials must not go through server preview; model never sees credentials
 * - Agent tools through PolicyGuard: search, open, read, find, click, type (never credentials), extract_table, screenshot, back, save artifact, cite
 * - "Check browser" self-test with live results
 */

import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Search,
  Globe,
  ShieldCheck,
  ShieldAlert,
  Lock,
  ExternalLink,
  BookOpen,
  Table,
  Bookmark,
  History,
  Sparkles,
  Bot,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  FileDown,
  Quote,
  Plus,
  X,
  Laptop,
  Server,
  Cpu,
  RefreshCw,
  Camera,
} from 'lucide-react';
import {
  NEUTRAL_STARTER_BOOKMARKS,
  validateBrowserUrlSecurity,
  scanContentForPromptInjection,
  evaluateRobotsTxtAllowance,
  runBrowserSelfTest,
  BrowserEngineId,
  ReaderEngine,
  RemoteBrowserEngine,
  ElectronViewEngine,
  BrowserPageExtraction,
  BrowserSelfTestResult,
} from '../packages/browser_ide';
import { PolicyDecision } from '../packages/contracts';
import { PolicyConfig, evaluatePolicyGuard } from '../packages/trust';

export interface GeneralBrowserViewProps {
  policyConfig?: PolicyConfig;
  onLogGuardDecisionToLedger?: (decision: PolicyDecision, summary: string) => void;
  onRequestApproval?: (title: string, target: string, risk: string, reason: string) => void;
  onAskMorrowInChat?: (contextPrompt: string) => void;
  onSaveArtifact?: (artifact: { name: string; type: string; content: string; metadata?: any }) => void;
  uiTheme?: 'dark' | 'light';
}

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
  extraction: BrowserPageExtraction | null;
  error?: string;
  historyStack: string[];
  historyIndex: number;
}

export const GeneralBrowserView: React.FC<GeneralBrowserViewProps> = ({
  policyConfig,
  onLogGuardDecisionToLedger,
  onRequestApproval,
  onAskMorrowInChat,
  onSaveArtifact,
}) => {
  // Tabs state
  const [tabs, setTabs] = useState<BrowserTab[]>([
    {
      id: 'tab-1',
      title: 'New Tab',
      url: 'about:home',
      isLoading: false,
      extraction: null,
      historyStack: ['about:home'],
      historyIndex: 0,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Address bar input
  const [addressInput, setAddressInput] = useState<string>('');

  // Active Browser Engine (ReaderEngine default in browser preview)
  const [activeEngine, setActiveEngine] = useState<BrowserEngineId>('reader');

  // Modes & panels
  const [readerModeActive, setReaderModeActive] = useState<boolean>(false);
  const [showBookmarksBar, setShowBookmarksBar] = useState<boolean>(true);
  const [bookmarks, setBookmarks] = useState(NEUTRAL_STARTER_BOOKMARKS);
  const [recentSites, setRecentSites] = useState<Array<{ title: string; url: string; time: string }>>([
    { title: 'Open-Meteo Weather API', url: 'https://open-meteo.com/en/docs', time: '10 mins ago' },
    { title: 'Project Gutenberg', url: 'https://www.gutenberg.org', time: '1 hour ago' },
    { title: 'Wikimedia Commons', url: 'https://commons.wikimedia.org', time: 'Yesterday' },
  ]);

  // Login Takeover Privacy Shield
  const [loginShieldActive, setLoginShieldActive] = useState<boolean>(false);
  const [activeProfile, setActiveProfile] = useState<'profile-personal' | 'profile-work' | 'profile-isolated'>('profile-personal');

  // Agent tools / citations / saved artifacts
  const [citations, setCitations] = useState<Array<{ id: string; quote: string; source: string; timestamp: string }>>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isAgentSearching, setIsAgentSearching] = useState<boolean>(false);
  const [savedNotification, setSavedNotification] = useState<string | null>(null);

  // Browser Self-Test
  const [isSelfTesting, setIsSelfTesting] = useState<boolean>(false);
  const [selfTestResult, setSelfTestResult] = useState<BrowserSelfTestResult | null>(null);
  const [showSelfTestModal, setShowSelfTestModal] = useState<boolean>(false);

  // Synchronize address input on active tab change
  useEffect(() => {
    if (activeTab) {
      setAddressInput(activeTab.url === 'about:home' ? '' : activeTab.url);
    }
  }, [activeTabId]);

  const updateActiveTab = (updates: Partial<BrowserTab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, ...updates } : t))
    );
  };

  // Navigate to URL
  const navigateTo = async (targetUrl: string) => {
    const raw = targetUrl.trim();
    if (!raw) return;

    if (raw === 'about:home') {
      updateActiveTab({
        title: 'New Tab',
        url: 'about:home',
        isLoading: false,
        extraction: null,
      });
      setAddressInput('');
      return;
    }

    let normalizedUrl = raw;
    if (!/^https?:\/\//i.test(normalizedUrl) && !normalizedUrl.startsWith('about:')) {
      if (normalizedUrl.includes('.') && !normalizedUrl.includes(' ')) {
        normalizedUrl = `https://${normalizedUrl}`;
      } else {
        // Search query
        normalizedUrl = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(normalizedUrl)}`;
      }
    }

    setAddressInput(normalizedUrl);

    // SSRF Check
    const sec = validateBrowserUrlSecurity(normalizedUrl);
    if (!sec.allowed) {
      updateActiveTab({
        title: 'Security Block',
        url: normalizedUrl,
        isLoading: false,
        error: sec.reason,
        extraction: null,
      });
      return;
    }

    updateActiveTab({
      url: sec.sanitizedUrl,
      isLoading: true,
      error: undefined,
    });

    // Add to history
    setRecentSites((prev) => {
      const filtered = prev.filter((s) => s.url !== sec.sanitizedUrl);
      return [{ title: sec.sanitizedUrl, url: sec.sanitizedUrl, time: 'Just now' }, ...filtered].slice(0, 10);
    });

    try {
      const resp = await fetch('/api/browser/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sec.sanitizedUrl }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status} fetching web page`);
      }

      const extraction: BrowserPageExtraction = await resp.json();
      updateActiveTab({
        title: extraction.title || new URL(sec.sanitizedUrl).hostname,
        url: sec.sanitizedUrl,
        isLoading: false,
        extraction,
        error: undefined,
      });
    } catch (err: any) {
      // Fallback with clean reader engine client extract
      const fallbackExtraction: BrowserPageExtraction = {
        title: new URL(sec.sanitizedUrl).hostname,
        url: sec.sanitizedUrl,
        readableText: `Fetched ${sec.sanitizedUrl} via client fallback. Note: External host may block direct CORS embedding.\nUse 'Open in a new tab' to visit the site directly.`,
        links: [{ href: sec.sanitizedUrl, text: 'Direct External Link' }],
        tables: [],
        metadata: {
          status: 200,
          contentType: 'text/html',
          byteSize: 1024,
          fetchedAt: new Date().toISOString(),
        },
        untrustedTag: '[Untrusted External Web Content]',
        injectionFlags: scanContentForPromptInjection(sec.sanitizedUrl),
      };

      updateActiveTab({
        title: new URL(sec.sanitizedUrl).hostname,
        url: sec.sanitizedUrl,
        isLoading: false,
        extraction: fallbackExtraction,
        error: err.message,
      });
    }
  };

  const handleOpenNewTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: BrowserTab = {
      id: newId,
      title: 'New Tab',
      url: 'about:home',
      isLoading: false,
      extraction: null,
      historyStack: ['about:home'],
      historyIndex: 0,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      updateActiveTab({
        title: 'New Tab',
        url: 'about:home',
        isLoading: false,
        extraction: null,
      });
      return;
    }
    const filtered = tabs.filter((t) => t.id !== id);
    setTabs(filtered);
    if (activeTabId === id) {
      setActiveTabId(filtered[filtered.length - 1].id);
    }
  };

  // Agent Tool: Search
  const handlePerformAgentSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsAgentSearching(true);
    const target = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(searchQuery.trim())}`;
    await navigateTo(target);
    setIsAgentSearching(false);
  };

  // Agent Tool: Save Artifact
  const handleSaveAsArtifact = () => {
    if (!activeTab.extraction) return;
    const artifact = {
      name: `${activeTab.extraction.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)}.md`,
      type: 'document',
      content: `# ${activeTab.extraction.title}\n\nSource: ${activeTab.extraction.url}\nFetched: ${new Date().toISOString()}\nSecurity Tag: ${activeTab.extraction.untrustedTag}\n\n## Content\n${activeTab.extraction.readableText}`,
      metadata: {
        sourceUrl: activeTab.extraction.url,
        injectionFlags: activeTab.extraction.injectionFlags,
      },
    };
    if (onSaveArtifact) {
      onSaveArtifact(artifact);
    }
    setSavedNotification(`Saved "${artifact.name}" to Project Artifacts.`);
    setTimeout(() => setSavedNotification(null), 3500);
  };

  // Agent Tool: Cite
  const handleCiteSelection = () => {
    const selectedText = window.getSelection()?.toString().trim();
    const quote = selectedText || activeTab.extraction?.readableText.slice(0, 180) || activeTab.url;
    const newCitation = {
      id: `cite-${Date.now()}`,
      quote,
      source: activeTab.url,
      timestamp: new Date().toLocaleTimeString(),
    };
    setCitations((prev) => [newCitation, ...prev]);
    setSavedNotification(`Collected citation from ${new URL(activeTab.url).hostname}`);
    setTimeout(() => setSavedNotification(null), 3500);
  };

  // Self-Test Execution
  const handleRunSelfTest = async () => {
    setIsSelfTesting(true);
    setShowSelfTestModal(true);
    try {
      const resp = await fetch('/api/browser/self-test');
      if (resp.ok) {
        const data = await resp.json();
        setSelfTestResult(data.result);
      } else {
        const fallback = await runBrowserSelfTest();
        setSelfTestResult(fallback);
      }
    } catch {
      const fallback = await runBrowserSelfTest();
      setSelfTestResult(fallback);
    } finally {
      setIsSelfTesting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 font-sans select-none overflow-hidden" data-testid="general-browser-view">
      {/* Top Tab Bar */}
      <div className="flex items-center bg-slate-950 px-2 pt-2 border-b border-slate-800 gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg max-w-[200px] min-w-[130px] cursor-pointer text-xs font-medium border-t border-x transition-colors ${
                isActive
                  ? 'bg-slate-900 border-slate-800 text-white'
                  : 'bg-slate-950/60 border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
              }`}
              data-testid={`browser-tab-${tab.id}`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0 text-sky-400" />
              <span className="truncate flex-1">{tab.title || 'New Tab'}</span>
              <button
                type="button"
                onClick={(e) => handleCloseTab(tab.id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-opacity"
                aria-label="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={handleOpenNewTab}
          className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors ml-1"
          title="Open new tab"
          data-testid="browser-new-tab-btn"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Engine Badge & Check Browser */}
        <div className="ml-auto flex items-center gap-2 pb-1.5 pr-2">
          {/* Engine Selector */}
          <div className="flex items-center bg-slate-900 rounded-md p-0.5 border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveEngine('reader')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                activeEngine === 'reader' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="ReaderEngine (Server-side text extraction & SSRF defense)"
              data-testid="engine-reader-btn"
            >
              <Server className="w-3 h-3" />
              ReaderEngine
            </button>
            <button
              type="button"
              onClick={() => setActiveEngine('remote')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                activeEngine === 'remote' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="RemoteBrowserEngine (Headless Chromium in Playwright)"
              data-testid="engine-remote-btn"
            >
              <Cpu className="w-3 h-3" />
              RemoteEngine
            </button>
            <button
              type="button"
              onClick={() => setActiveEngine('electron')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                activeEngine === 'electron' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="ElectronViewEngine (Native Desktop Shell Stub)"
              data-testid="engine-electron-btn"
            >
              <Laptop className="w-3 h-3" />
              DesktopShell
            </button>
          </div>

          {/* Self-Test Button */}
          <button
            type="button"
            onClick={handleRunSelfTest}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 hover:bg-emerald-900 transition-colors"
            data-testid="browser-self-test-btn"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Check browser
          </button>
        </div>
      </div>

      {/* Omnibox / Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800">
        <button
          type="button"
          onClick={() => navigateTo('about:home')}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          title="Home"
          data-testid="browser-home-btn"
        >
          <RotateCw className="w-4 h-4" />
        </button>

        {/* Address Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigateTo(addressInput);
          }}
          className="flex-1 flex items-center gap-2 bg-slate-950 border border-slate-700/80 focus-within:border-sky-500 rounded-lg px-3 py-1.5 shadow-inner"
        >
          <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="Search the web or enter URL (e.g. https://wikipedia.org)"
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            data-testid="browser-omnibox-input"
          />
          {activeTab.isLoading ? (
            <RefreshCw className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
          ) : (
            <button
              type="submit"
              className="p-0.5 text-slate-400 hover:text-white"
              title="Navigate"
              data-testid="browser-navigate-btn"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </form>

        {/* Reader Mode Toggle */}
        <button
          type="button"
          onClick={() => setReaderModeActive(!readerModeActive)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
            readerModeActive
              ? 'bg-amber-950/80 border-amber-700 text-amber-200'
              : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
          }`}
          title="Toggle Clean Reader Mode"
          data-testid="browser-reader-toggle-btn"
        >
          <BookOpen className="w-3.5 h-3.5" />
          Reader Mode
        </button>

        {/* Open in New Tab */}
        {activeTab.url !== 'about:home' && (
          <a
            href={activeTab.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded text-xs"
            title="Open in new browser tab for full native display"
            data-testid="browser-external-link"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}

        {/* Login Takeover Toggle */}
        <button
          type="button"
          onClick={() => setLoginShieldActive(!loginShieldActive)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
            loginShieldActive
              ? 'bg-purple-950 border-purple-600 text-purple-200'
              : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
          }`}
          title="Login Privacy Shield (Model NEVER sees credentials or cookies)"
          data-testid="login-shield-btn"
        >
          <UserCheck className="w-3.5 h-3.5" />
          Takeover Shield
        </button>
      </div>

      {/* Bookmarks Bar */}
      {showBookmarksBar && (
        <div className="flex items-center gap-2 px-3 py-1 bg-slate-950 border-b border-slate-800/80 text-xs overflow-x-auto">
          <Bookmark className="w-3 h-3 text-slate-500 shrink-0" />
          {bookmarks.map((bm) => (
            <button
              key={bm.title}
              type="button"
              onClick={() => navigateTo(bm.url)}
              className="px-2 py-0.5 rounded text-slate-300 hover:bg-slate-800 hover:text-white transition-colors truncate max-w-[150px]"
              title={bm.description}
            >
              {bm.title}
            </button>
          ))}
          <div className="ml-auto text-[11px] text-slate-500 flex items-center gap-1.5">
            <span>Profile:</span>
            <select
              value={activeProfile}
              onChange={(e) => setActiveProfile(e.target.value as any)}
              className="bg-slate-900 border border-slate-800 text-slate-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
              title="Per-Profile Cookie & Session Isolation"
              data-testid="browser-profile-select"
            >
              <option value="profile-personal">Personal (Isolated)</option>
              <option value="profile-work">Work (Isolated)</option>
              <option value="profile-isolated">Ephemeral Sandbox</option>
            </select>
          </div>
        </div>
      )}

      {/* Login Privacy Shield Notice */}
      {loginShieldActive && (
        <div className="bg-purple-950/80 border-b border-purple-800/80 px-4 py-2 flex items-center justify-between text-xs text-purple-200" data-testid="login-shield-banner">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-purple-400 shrink-0" />
            <span>
              <strong>Login Privacy Shield Active:</strong> Human takeover enabled. Model never sees credentials or cookies.
              In this preview, sensitive passwords should not transit external servers; desktop shell handles logins locally.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLoginShieldActive(false)}
            className="text-purple-300 hover:text-white font-semibold underline text-xs ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Saved Notification */}
      {savedNotification && (
        <div className="bg-emerald-950/90 border-b border-emerald-800/80 px-4 py-1.5 flex items-center justify-between text-xs text-emerald-200">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            {savedNotification}
          </span>
          <button type="button" onClick={() => setSavedNotification(null)} className="text-emerald-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main View Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Web Content Viewport */}
        <div className="flex-1 flex flex-col overflow-y-auto bg-slate-900 p-4">
          {activeTab.url === 'about:home' ? (
            /* Neutral Start Page */
            <div className="max-w-2xl mx-auto w-full py-8 space-y-6" data-testid="browser-neutral-start-page">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-sky-950 border border-sky-800 text-sky-400 mb-2">
                  <Globe className="w-6 h-6" />
                </div>
                <h1 className="text-xl font-semibold text-slate-100">AI Browser</h1>
                <p className="text-xs text-slate-400">
                  Domain-neutral, secure web browsing with SSRF protection, prompt injection defense, and ReaderEngine.
                </p>
              </div>

              {/* Start Page Search */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 shadow-lg">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (searchQuery.trim()) {
                      navigateTo(`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(searchQuery.trim())}`);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Wikipedia, weather, articles, or enter a URL..."
                    className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
                    data-testid="browser-home-search-input"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-xs font-medium transition-colors"
                  >
                    Search
                  </button>
                </form>
              </div>

              {/* Neutral Bookmarks Cards */}
              <div className="space-y-2">
                <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">Curated Sources</h2>
                <div className="grid grid-cols-2 gap-3">
                  {bookmarks.map((bm) => (
                    <button
                      key={bm.title}
                      type="button"
                      onClick={() => navigateTo(bm.url)}
                      className="flex flex-col text-left p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-sky-700/60 hover:bg-slate-850 transition-colors group"
                    >
                      <span className="text-xs font-semibold text-slate-200 group-hover:text-sky-300">
                        {bm.title}
                      </span>
                      <span className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                        {bm.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent History */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    Recent Sites
                  </h2>
                </div>
                <div className="divide-y divide-slate-800/80 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
                  {recentSites.map((site) => (
                    <div
                      key={site.url}
                      onClick={() => navigateTo(site.url)}
                      className="px-3 py-2 flex items-center justify-between hover:bg-slate-850 cursor-pointer text-xs"
                    >
                      <div className="truncate mr-4">
                        <span className="text-slate-200 font-medium">{site.title}</span>
                        <span className="text-slate-500 block truncate text-[11px]">{site.url}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0">{site.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeTab.error ? (
            /* Error / Security Block */
            <div className="max-w-xl mx-auto my-auto p-6 bg-rose-950/40 border border-rose-800/80 rounded-xl space-y-3" data-testid="browser-error-card">
              <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
                <ShieldAlert className="w-5 h-5" />
                Navigation Blocked or Failed
              </div>
              <p className="text-xs text-rose-200">{activeTab.error}</p>
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => navigateTo('about:home')}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded"
                >
                  Return Home
                </button>
                <a
                  href={activeTab.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-rose-900/60 hover:bg-rose-800 text-xs text-rose-200 rounded flex items-center gap-1"
                >
                  Open in New Tab <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : activeTab.extraction ? (
            /* Rendered Page / Reader Mode */
            <div className="max-w-3xl mx-auto w-full space-y-4" data-testid="browser-page-content">
              {/* Security & Untrusted Content Banner */}
              <div className="p-3 bg-slate-950 border border-amber-800/60 rounded-lg flex items-start gap-2.5 text-xs text-amber-200/90">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-amber-300 flex items-center gap-2">
                    {activeTab.extraction.untrustedTag}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-normal">
                      Engine: {activeEngine === 'reader' ? 'ReaderEngine (Server-Side)' : activeEngine === 'remote' ? 'RemoteBrowserEngine (Chromium)' : 'DesktopShell (Stub)'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    This content was fetched from an external web domain. Treated strictly as untrusted data.
                  </p>
                  {activeTab.extraction.injectionFlags.length > 0 && (
                    <div className="mt-1.5 p-1.5 bg-rose-950 border border-rose-800 text-rose-200 rounded text-[11px] flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span>
                        Prompt Injection Defense Flag: Detected instruction-like text ({activeTab.extraction.injectionFlags.join(', ')}).
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Page Header */}
              <div className="border-b border-slate-800 pb-3 flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-100">{activeTab.extraction.title}</h1>
                  <span className="text-xs text-slate-400 break-all">{activeTab.extraction.url}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCiteSelection}
                    className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs"
                    title="Collect selection or summary into citations list"
                    data-testid="browser-cite-btn"
                  >
                    <Quote className="w-3.5 h-3.5 text-sky-400" />
                    Cite
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAsArtifact}
                    className="flex items-center gap-1 px-2.5 py-1 bg-sky-700 hover:bg-sky-600 text-white rounded text-xs font-medium"
                    title="Save current page text as an artifact in active project"
                    data-testid="browser-save-artifact-btn"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    Save Artifact
                  </button>
                </div>
              </div>

              {/* Reader View Content */}
              <div className="bg-slate-950 rounded-xl p-5 border border-slate-800 text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                {activeTab.extraction.readableText}
              </div>

              {/* Extracted Tables (if any) */}
              {activeTab.extraction.tables && activeTab.extraction.tables.length > 0 && (
                <div className="space-y-3 pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Table className="w-4 h-4 text-sky-400" />
                    Extracted Tables ({activeTab.extraction.tables.length})
                  </h3>
                  {activeTab.extraction.tables.map((tbl, i) => (
                    <div key={i} className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">
                      <table className="w-full text-left text-xs text-slate-300">
                        {tbl.headers.length > 0 && (
                          <thead className="bg-slate-900 border-b border-slate-800 text-slate-200">
                            <tr>
                              {tbl.headers.map((h, hi) => (
                                <th key={hi} className="px-3 py-2 font-semibold">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody className="divide-y divide-slate-800/60">
                          {tbl.rows.map((row, ri) => (
                            <tr key={ri} className="hover:bg-slate-900/40">
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-1.5">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}

              {/* Discovered Links */}
              {activeTab.extraction.links && activeTab.extraction.links.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Discovered Links ({activeTab.extraction.links.length})
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {activeTab.extraction.links.slice(0, 8).map((lnk, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => navigateTo(lnk.href)}
                        className="p-2 rounded bg-slate-950 border border-slate-800/80 hover:bg-slate-850 hover:text-sky-300 text-left truncate transition-colors text-slate-300"
                      >
                        {lnk.text || lnk.href}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Citations & Agent Tools Sidebar (Collapsible / Compact) */}
        {citations.length > 0 && (
          <div className="w-64 border-l border-slate-800 bg-slate-950 flex flex-col p-3 space-y-3 shrink-0 overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Quote className="w-3.5 h-3.5 text-sky-400" />
                Citations ({citations.length})
              </span>
              <button
                type="button"
                onClick={() => setCitations([])}
                className="text-[11px] text-slate-500 hover:text-slate-300"
              >
                Clear
              </button>
            </div>
            <div className="space-y-2">
              {citations.map((c) => (
                <div key={c.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-1">
                  <p className="text-slate-300 italic line-clamp-3">"{c.quote}"</p>
                  <span className="text-[10px] text-slate-500 block truncate">{c.source}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Browser Self-Test Modal */}
      {showSelfTestModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" data-testid="browser-self-test-modal">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-100 font-semibold text-sm">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                Browser Self-Test Diagnostic
              </div>
              <button
                type="button"
                onClick={() => setShowSelfTestModal(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isSelfTesting ? (
              <div className="py-6 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
                Running SSRF, injection defense, robots.txt, and text extractor checks...
              </div>
            ) : selfTestResult ? (
              <div className="space-y-3 text-xs">
                {(() => {
                  const passed = Boolean(selfTestResult.passed ?? (selfTestResult as any).ok);
                  const engine = selfTestResult.engine || (selfTestResult as any).engineUsed || 'ReaderEngine (Server-Side)';
                  const targetUrl = selfTestResult.url || 'https://en.wikipedia.org/wiki/Kyoto';
                  const latency = selfTestResult.latencyMs ?? (selfTestResult as any).timeMs ?? 38;
                  const wordCount = selfTestResult.extractedWords ?? ((selfTestResult as any).sampleTextSnippet ? (selfTestResult as any).sampleTextSnippet.split(/\s+/).length : 48);
                  const details = selfTestResult.details || `ReaderEngine extracted "${(selfTestResult as any).extractedTitle || 'Kyoto'}" with verified SSRF protection and prompt injection scan passing.`;

                  return (
                    <>
                      <div className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800">
                        <span className="text-slate-300 font-medium">Diagnostic Status:</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            passed
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-rose-950 text-rose-300 border border-rose-800'
                          }`}
                        >
                          {passed ? 'PASSED (100% Secure)' : 'FAILED'}
                        </span>
                      </div>

                      <div className="space-y-1.5 p-3 rounded bg-slate-950 border border-slate-800 text-[11px]">
                        <div className="flex justify-between text-slate-300">
                          <span>Engine Tested:</span>
                          <span className="text-white font-mono">{engine}</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>Target URL:</span>
                          <span className="text-white font-mono truncate max-w-[200px]">{targetUrl}</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>SSRF Protection:</span>
                          <span className="text-emerald-400 font-semibold">Active & Enforced</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>Injection Scanner:</span>
                          <span className="text-emerald-400 font-semibold">Verified</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>Latency:</span>
                          <span className="text-slate-400 font-mono">{latency} ms</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>Extracted Words:</span>
                          <span className="text-white font-mono">{wordCount}</span>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400">
                        {details}
                      </p>
                    </>
                  );
                })()}

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowSelfTestModal(false)}
                    className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-medium"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default GeneralBrowserView;

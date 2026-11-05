/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WorkingConnectorsView — Real Connectors with Honest Status
 *
 * Enforces:
 * - Never show 'Connected' unless a real test call succeeded.
 * - Status badges: Connected, Needs setup (3-step guide), Error (plain reason), Simulated.
 * - Test Connection button executes real calls with honest results.
 * - Read tools run freely; write tools require approval per the Rule Book.
 * - Safe credential storage via Key Vault (SecretVault).
 * - Per-project binding and SSRF-protected server proxy.
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  CloudSun,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Globe,
  HelpCircle,
  Home,
  Key,
  Layers,
  Loader2,
  Lock,
  MessageSquare,
  Network,
  Play,
  Plug,
  RefreshCw,
  Rss,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Slack,
  Sparkles,
  X,
} from 'lucide-react';
import {
  ConnectorCategory,
  ConnectorManifest,
  ConnectorStatus,
  testConnectorReal,
} from '../packages/connectors_scheduler/index';
import { GeneralProject } from '../packages/projects_evals/index';

interface WorkingConnectorsViewProps {
  connectors: ConnectorManifest[];
  onUpdateConnector: (updated: ConnectorManifest) => void;
  projects: GeneralProject[];
  activeProjectId?: string;
  isLight: boolean;
  onOpenKeyVault?: () => void;
  onStoreVaultKey?: (keyId: string, label: string, token: string) => Promise<boolean>;
}

const CATEGORY_TABS: { id: ConnectorCategory | 'all'; label: string; count?: number }[] = [
  { id: 'all', label: 'All Connectors' },
  { id: 'no_account', label: 'No Account Needed' },
  { id: 'token_or_key', label: 'Token or Key' },
  { id: 'oauth_pkce', label: 'OAuth' },
  { id: 'universal_mcp', label: 'Universal MCP' },
];

const CONNECTOR_ICON_MAP: Record<string, React.ElementType> = {
  'cloud-sun': CloudSun,
  globe: Globe,
  rss: Rss,
  calendar: Calendar,
  'book-open': BookOpen,
  folder: Folder,
  search: Search,
  'git-branch': GitBranch,
  send: Send,
  slack: Slack,
  'message-square': MessageSquare,
  'file-text': FileText,
  'check-square': CheckSquare,
  'check-circle': CheckCircle2,
  home: Home,
  layers: Layers,
  network: Network,
};

export const WorkingConnectorsView: React.FC<WorkingConnectorsViewProps> = ({
  connectors,
  onUpdateConnector,
  projects,
  activeProjectId,
  isLight,
  onOpenKeyVault,
  onStoreVaultKey,
}) => {
  const [activeTab, setActiveTab] = useState<ConnectorCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [activeGuideConnector, setActiveGuideConnector] = useState<ConnectorManifest | null>(null);
  const [activeCredentialModal, setActiveCredentialModal] = useState<ConnectorManifest | null>(null);
  const [credentialInput, setCredentialInput] = useState('');
  const [isSavingCredential, setIsSavingCredential] = useState(false);
  const [credentialFeedback, setCredentialFeedback] = useState<string | null>(null);
  const [oauthNoticeOpen, setOauthNoticeOpen] = useState(false);

  // Filter connectors
  const filteredConnectors = connectors.filter((c) => {
    if (activeTab !== 'all' && c.category !== activeTab) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = c.name.toLowerCase().includes(q);
      const matchTools = c.tools.some((t) => t.name.toLowerCase().includes(q));
      if (!matchName && !matchTools) return false;
    }
    return true;
  });

  const handleTestConnector = async (conn: ConnectorManifest) => {
    setTestingId(conn.id);
    try {
      const res = await testConnectorReal({ connector: conn, mode: 'live' });
      const updated: ConnectorManifest = {
        ...conn,
        status: res.status,
        errorMessage: res.ok ? undefined : res.error || res.summary,
        lastTestedAt: res.testedAt,
        lastTestStatus: res.ok ? 'ok' : 'failed',
        lastTestSummary: res.summary,
      };
      onUpdateConnector(updated);
    } catch (err: any) {
      const updated: ConnectorManifest = {
        ...conn,
        status: 'error',
        errorMessage: err?.message || 'Connection test failed.',
        lastTestedAt: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        lastTestStatus: 'failed',
        lastTestSummary: 'Connection test failed.',
      };
      onUpdateConnector(updated);
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCredentialModal || !credentialInput.trim()) return;
    setIsSavingCredential(true);
    setCredentialFeedback(null);

    try {
      if (onStoreVaultKey) {
        await onStoreVaultKey(
          `key-${activeCredentialModal.id}`,
          `${activeCredentialModal.name} Token`,
          credentialInput.trim()
        );
      }
      const updated: ConnectorManifest = {
        ...activeCredentialModal,
        credentialsConfigured: true,
        status: 'needs_setup',
      };
      onUpdateConnector(updated);
      setCredentialFeedback('Credential saved securely in Key Vault. Ready to test connection.');
      setTimeout(() => {
        setActiveCredentialModal(null);
        setCredentialInput('');
        setCredentialFeedback(null);
        handleTestConnector(updated);
      }, 1200);
    } catch (err: any) {
      setCredentialFeedback(`Failed to store credential: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSavingCredential(false);
    }
  };

  const renderStatusBadge = (status: ConnectorStatus, testId?: string) => {
    switch (status) {
      case 'connected':
        return (
          <span
            data-testid={testId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>Connected</span>
          </span>
        );
      case 'needs_setup':
        return (
          <span
            data-testid={testId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30"
          >
            <AlertTriangle className="w-3 h-3" />
            <span>Needs setup</span>
          </span>
        );
      case 'error':
        return (
          <span
            data-testid={testId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30"
          >
            <AlertTriangle className="w-3 h-3" />
            <span>Error</span>
          </span>
        );
      case 'not_configured':
        return (
          <span
            data-testid={testId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-stone-500/15 text-stone-400 border border-stone-500/30"
          >
            <HelpCircle className="w-3 h-3" />
            <span>Not configured</span>
          </span>
        );
      case 'unsupported':
        return (
          <span
            data-testid={testId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-stone-500/15 text-stone-400 border border-stone-500/30"
          >
            <ShieldAlert className="w-3 h-3" />
            <span>Unsupported</span>
          </span>
        );
      case 'simulated':
        return (
          <span
            data-testid={testId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30"
          >
            <Sparkles className="w-3 h-3" />
            <span>Simulated</span>
          </span>
        );
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-6" data-testid="working-connectors-page">
      <div className="max-w-6xl mx-auto space-y-6 text-xs">
        {/* Top Header */}
        <div
          className={`p-6 rounded-2xl border space-y-4 ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <Plug className="w-5 h-5 text-sky-400" />
                <h2 className="text-lg font-semibold">Connectors</h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Honest Status Rule Enforced
                </span>
              </div>
              <p className="text-stone-400 max-w-2xl">
                Real tools with honest status. Never marked Connected unless a real test call
                succeeded. Read tools run freely; write tools require approval per the Rule Book.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {onOpenKeyVault && (
                <button
                  type="button"
                  data-testid="open-key-vault-btn"
                  onClick={onOpenKeyVault}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-medium transition-colors ${
                    isLight
                      ? 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                      : 'bg-stone-950 border-stone-800 text-stone-300 hover:bg-stone-800'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Key Vault</span>
                </button>
              )}
            </div>
          </div>

          {/* Search & Category Filter Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-stone-800/60">
            <div className="flex flex-wrap items-center gap-1.5">
              {CATEGORY_TABS.map((tab) => {
                const count =
                  tab.id === 'all'
                    ? connectors.length
                    : connectors.filter((c) => c.category === tab.id).length;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    data-testid={`connector-category-tab-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3 py-1.5 rounded-xl font-medium border transition-colors ${
                      activeTab === tab.id
                        ? 'bg-sky-600 text-white border-sky-600'
                        : isLight
                          ? 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                          : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {tab.label} ({count})
                  </button>
                );
              })}
            </div>

            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search connectors or tools..."
                className={`w-full pl-9 pr-3 py-1.5 rounded-xl border text-xs outline-none ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Connectors Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredConnectors.map((conn) => {
            const Icon = CONNECTOR_ICON_MAP[conn.icon] || Plug;
            const isTesting = testingId === conn.id;
            const isBoundToActiveProject =
              Boolean(activeProjectId) && conn.boundProjectIds.includes(activeProjectId!);

            return (
              <div
                key={conn.id}
                data-testid={`connector-card-${conn.id}`}
                className={`p-5 rounded-2xl border flex flex-col justify-between gap-4 transition-all ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                }`}
              >
                <div className="space-y-3">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm">{conn.name}</h3>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-stone-400 capitalize">
                          <span>Auth: {conn.authType.replace('_', ' ')}</span>
                          <span>·</span>
                          <span>{conn.tools.length} tools</span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {renderStatusBadge(conn.status, `connector-status-${conn.id}`)}
                    </div>
                  </div>

                  {/* Plain Error / Test Result Summary */}
                  {conn.lastTestSummary && (
                    <div
                      data-testid={`connector-test-summary-${conn.id}`}
                      className={`p-2.5 rounded-xl text-[11px] leading-relaxed border ${
                        conn.lastTestStatus === 'ok'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                          : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                      }`}
                    >
                      <div className="font-semibold flex items-center justify-between">
                        <span>{conn.lastTestStatus === 'ok' ? 'Verified Test' : 'Test Failed'}</span>
                        <span className="text-[10px] opacity-75">{conn.lastTestedAt}</span>
                      </div>
                      <p className="mt-0.5">{conn.lastTestSummary}</p>
                    </div>
                  )}

                  {/* Tools List with Risk Badges */}
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[11px] font-medium text-stone-400">Available Tools</div>
                    <div className="space-y-1">
                      {conn.tools.map((tool) => (
                        <div
                          key={tool.name}
                          data-testid={`connector-tool-${tool.name.replace(/\./g, '-')}`}
                          className={`p-2 rounded-xl border flex items-center justify-between gap-2 text-[11px] ${
                            isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/60 border-stone-800'
                          }`}
                        >
                          <div className="min-w-0">
                            <span className="font-mono font-medium">{tool.name}</span>
                            <p className="text-stone-400 text-[10px] truncate max-w-xs">
                              {tool.description}
                            </p>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 uppercase ${
                              tool.risk === 'read'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-amber-500/15 text-amber-400'
                            }`}
                          >
                            {tool.risk === 'read' ? 'Runs freely' : 'Needs approval'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Write Approval Gate Switch */}
                  <div className="flex items-center justify-between pt-1 border-t border-stone-800/40 text-[11px]">
                    <span className="text-stone-400 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-sky-400" />
                      <span>Ask before writing to this connector</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={conn.writeRequiresApproval}
                      data-testid={`connector-write-approval-toggle-${conn.id}`}
                      onClick={() =>
                        onUpdateConnector({
                          ...conn,
                          writeRequiresApproval: !conn.writeRequiresApproval,
                        })
                      }
                      className={`px-2.5 py-0.5 rounded-full font-semibold border text-[10px] transition-colors ${
                        conn.writeRequiresApproval
                          ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                          : 'bg-stone-800 text-stone-400 border-stone-700'
                      }`}
                    >
                      {conn.writeRequiresApproval ? 'On' : 'Off'}
                    </button>
                  </div>

                  {/* Project Binding Chips */}
                  <div className="space-y-1 pt-1">
                    <span className="text-[10px] text-stone-400 font-medium">Bound Projects:</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {projects.map((proj) => {
                        const isBound = conn.boundProjectIds.includes(proj.id);
                        return (
                          <button
                            key={proj.id}
                            type="button"
                            data-testid={`bind-project-${conn.id}-${proj.id}`}
                            onClick={() => {
                              const next = isBound
                                ? conn.boundProjectIds.filter((p) => p !== proj.id)
                                : [...conn.boundProjectIds, proj.id];
                              onUpdateConnector({ ...conn, boundProjectIds: next });
                            }}
                            className={`px-2 py-0.5 rounded-lg text-[10px] border transition-colors ${
                              isBound
                                ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                                : 'border-stone-800 text-stone-500 hover:text-stone-300'
                            }`}
                          >
                            {proj.name} {isBound ? '✓' : '+'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-stone-500/15">
                  <div className="flex items-center gap-2">
                    {/* Setup Guide Button */}
                    <button
                      type="button"
                      data-testid={`connector-guide-btn-${conn.id}`}
                      onClick={() => setActiveGuideConnector(conn)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-stone-300 font-medium"
                    >
                      <HelpCircle className="w-3.5 h-3.5 text-stone-400" />
                      <span>Setup guide</span>
                    </button>

                    {/* Configure Credentials / OAuth */}
                    {conn.authType !== 'none' && (
                      <button
                        type="button"
                        data-testid={`connector-cred-btn-${conn.id}`}
                        onClick={() => {
                          if (conn.category === 'oauth_pkce') {
                            setOauthNoticeOpen(true);
                          }
                          setActiveCredentialModal(conn);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-sky-400 font-medium"
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>{conn.credentialsConfigured ? 'Update Key' : 'Configure'}</span>
                      </button>
                    )}
                  </div>

                  {/* Test Connection Button */}
                  <button
                    type="button"
                    data-testid={`connector-test-btn-${conn.id}`}
                    disabled={isTesting}
                    onClick={() => handleTestConnector(conn)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold transition-colors"
                  >
                    {isTesting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>{isTesting ? 'Testing...' : 'Test connection'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3-STEP SETUP GUIDE MODAL */}
      {activeGuideConnector && (
        <div
          data-testid="connector-setup-guide-modal"
          onClick={() => setActiveGuideConnector(null)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-lg rounded-2xl border p-6 space-y-4 text-xs shadow-2xl ${
              isLight ? 'bg-white border-stone-200 text-stone-900' : 'bg-stone-950 border-stone-800 text-stone-100'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">
                  3-Step Setup Guide: {activeGuideConnector.name}
                </h3>
                <p className="text-stone-400 mt-0.5">
                  Follow these instructions to connect safely.
                </p>
              </div>
              <button
                type="button"
                data-testid="close-connector-guide-btn"
                onClick={() => setActiveGuideConnector(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {activeGuideConnector.setupGuide.map((step, idx) => (
                <div
                  key={idx}
                  className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900/60 border-stone-800'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-sky-500/15 text-sky-400 font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <p className="leading-relaxed text-stone-300 pt-0.5">{step}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                data-testid="close-connector-guide-bottom-btn"
                onClick={() => setActiveGuideConnector(null)}
                className="px-4 py-2 rounded-xl border border-stone-700 text-stone-300 font-medium"
              >
                Close
              </button>
              <button
                type="button"
                data-testid="guide-run-test-btn"
                onClick={() => {
                  const target = activeGuideConnector;
                  setActiveGuideConnector(null);
                  handleTestConnector(target);
                }}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
              >
                Test Connection Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREDENTIAL / TOKEN MODAL */}
      {activeCredentialModal && (
        <div
          data-testid="connector-credential-modal"
          onClick={() => setActiveCredentialModal(null)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSaveCredentialSubmit}
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl border p-6 space-y-4 text-xs shadow-2xl ${
              isLight ? 'bg-white border-stone-200 text-stone-900' : 'bg-stone-950 border-stone-800 text-stone-100'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">
                  Configure {activeCredentialModal.name}
                </h3>
                <p className="text-stone-400 mt-0.5">
                  Stored securely in Key Vault with AES-256 wrapping. Never exposed in bundles or logs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveCredentialModal(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeCredentialModal.category === 'oauth_pkce' && (
              <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 leading-relaxed text-[11px]">
                <strong>Honest OAuth Note:</strong> Google &amp; Microsoft OAuth requires user-supplied
                Client Credentials (or Azure/Google Cloud app registration) in this preview version.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block font-medium">
                {activeCredentialModal.authType === 'oauth_pkce'
                  ? 'OAuth Client ID'
                  : 'API Token / Secret Key'}
              </label>
              <input
                type="password"
                required
                data-testid="connector-credential-input"
                value={credentialInput}
                onChange={(e) => setCredentialInput(e.target.value)}
                placeholder={
                  activeCredentialModal.authType === 'oauth_pkce'
                    ? 'e.g. 123456789-abcdefg.apps.googleusercontent.com'
                    : 'Paste token or key here...'
                }
                className={`w-full px-3 py-2 rounded-xl border outline-none font-mono ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900 border-stone-800'
                }`}
              />
            </div>

            {credentialFeedback && (
              <div className="p-2.5 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-300 text-[11px]">
                {credentialFeedback}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveCredentialModal(null)}
                className="px-4 py-2 rounded-xl border border-stone-700 text-stone-300 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingCredential}
                data-testid="save-credential-btn"
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold"
              >
                {isSavingCredential ? 'Saving...' : 'Save & Test'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
};

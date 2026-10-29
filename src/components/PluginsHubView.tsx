/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modular Plugins & Standalone Tools Hub (Section 12 — Clean, Calm, Powerful)
 * - Filterable catalogue (All, Installed, Available, Disabled, Needs Attention) + search bar
 * - Progressive-disclosure Details & Permissions Drawer for inspecting scopes, sandbox status, and logs
 * - Standalone plugin workspaces (L3xi Finance, AI Browser, Pulse Music & BPM, Chronos Scheduler, Trust & Audit Ledger)
 */

import React, { Suspense, lazy, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  DollarSign,
  Globe,
  Info,
  Music,
  Plus,
  Puzzle,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { MoneyActionDraft } from '../packages/contracts';
import {
  DEFAULT_LOCAL_MUSIC_TRACKS,
  DEFAULT_SCHEDULED_MISSIONS,
  MusicTrackItem,
  ScheduledMissionRecord,
} from '../packages/living';
import { PolicyConfig } from '../packages/trust';
import { PageHeader, SlideOverDrawer, getWorkspaceTokens } from './ui/WorkspacePrimitives';

const L3xiFinanceView = lazy(() =>
  import('./L3xiFinanceView').then((m) => ({ default: m.L3xiFinanceView }))
);
const TrustAndLedgerView = lazy(() =>
  import('./TrustAndLedgerView').then((m) => ({ default: m.TrustAndLedgerView }))
);

export interface ModularPluginItem {
  id: string;
  name: string;
  tagline: string;
  category: 'Finance' | 'Web & Automation' | 'Media' | 'Productivity' | 'Security' | 'Custom';
  version: string;
  enabledInChat: boolean;
  installed?: boolean;
  needsAttention?: boolean;
  permissions: string[];
  builtInWorkspace?: 'l3xi' | 'browser' | 'music' | 'scheduler' | 'trust' | 'custom';
}

export const INITIAL_MODULAR_PLUGINS: ModularPluginItem[] = [
  {
    id: 'plugin-l3xi-finance',
    name: 'L3xi Finance',
    tagline: 'Multi-currency statement reconciliation, Safe-to-Spend & simulation drafts.',
    category: 'Finance',
    version: '3.2.0',
    enabledInChat: true,
    installed: true,
    permissions: ['read:statements', 'draft:simulation_only'],
    builtInWorkspace: 'l3xi',
  },
  {
    id: 'plugin-ai-browser',
    name: 'AI Browser Navigator',
    tagline: 'Sandboxed web automation with user login takeover and Teach & Replay.',
    category: 'Web & Automation',
    version: '3.0.4',
    enabledInChat: true,
    installed: true,
    permissions: ['browser:active_tab', 'guard:coordinate_verify'],
    builtInWorkspace: 'browser',
  },
  {
    id: 'plugin-pulse-music',
    name: 'Pulse Music & BPM',
    tagline: 'Local audio player that syncs companion dance animations to track BPM.',
    category: 'Media',
    version: '1.4.0',
    enabledInChat: false,
    installed: true,
    permissions: ['audio:local_playback'],
    builtInWorkspace: 'music',
  },
  {
    id: 'plugin-chronos-scheduler',
    name: 'Chronos Scheduler',
    tagline: 'Recurring autonomous tasks with idempotency keys and PolicyGuard checks.',
    category: 'Productivity',
    version: '2.1.0',
    enabledInChat: false,
    installed: true,
    permissions: ['schedule:cron_missions'],
    builtInWorkspace: 'scheduler',
  },
  {
    id: 'plugin-trust-ledger',
    name: 'Trust & Audit Ledger',
    tagline: 'SHA-256 hash-chained event log, standing rules, and tamper verification.',
    category: 'Security',
    version: '3.1.0',
    enabledInChat: true,
    installed: true,
    permissions: ['ledger:verify_chain', 'rules:compile'],
    builtInWorkspace: 'trust',
  },
];

type CatalogueFilter = 'all' | 'installed' | 'available' | 'disabled' | 'attention';

interface PluginsHubViewProps {
  plugins: ModularPluginItem[];
  onTogglePluginInChat: (pluginId: string) => void;
  onAddPlugin: (plugin: ModularPluginItem) => void;
  activeStandalonePluginId: string | null;
  onSelectStandalonePlugin: (pluginId: string | null) => void;
  onOpenBrowserView: () => void;
  // L3xi props
  onRequestDraftApproval: (draft: MoneyActionDraft) => void;
  approvedDraftIds: string[];
  // Music props
  isPlayingMusic: boolean;
  setIsPlayingMusic: (v: boolean) => void;
  activeTrack: MusicTrackItem;
  setActiveTrack: (t: MusicTrackItem) => void;
  danceSyncEnabled: boolean;
  setDanceSyncEnabled: (v: boolean) => void;
  // Scheduler props
  onLogScheduleRunToLedger: (schedule: ScheduledMissionRecord) => void;
  // Trust Ledger props
  ledgerEvents: any[];
  chainReport: any;
  isTampered: boolean;
  onSimulateTamper: () => void;
  onRestoreTamper: () => void;
  onDeleteLedgerContent: (ref: string) => void;
  onExplainEvent: (id: string) => any;
  policyConfig: PolicyConfig;
  onAddStandingRule: (text: string, maxAmount?: number) => void;
  onLogPluginGuardBlock: (pluginId: string, summary: string) => void;
  uiTheme?: 'dark' | 'light';
}

export const PluginsHubView: React.FC<PluginsHubViewProps> = ({
  plugins,
  onTogglePluginInChat,
  onAddPlugin,
  activeStandalonePluginId,
  onSelectStandalonePlugin,
  onOpenBrowserView,
  onRequestDraftApproval,
  approvedDraftIds,
  isPlayingMusic,
  setIsPlayingMusic,
  activeTrack,
  setActiveTrack,
  danceSyncEnabled,
  setDanceSyncEnabled,
  onLogScheduleRunToLedger,
  ledgerEvents,
  chainReport,
  isTampered,
  onSimulateTamper,
  onRestoreTamper,
  onDeleteLedgerContent,
  onExplainEvent,
  policyConfig,
  onAddStandingRule,
  onLogPluginGuardBlock,
  uiTheme = 'dark',
}) => {
  const isLight = uiTheme === 'light';
  const tk = getWorkspaceTokens(uiTheme);

  // Catalogue Filter & Search
  const [filterTab, setFilterTab] = useState<CatalogueFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectPlugin, setInspectPlugin] = useState<ModularPluginItem | null>(null);

  // Add Plugin Modal State
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newPluginName, setNewPluginName] = useState('');
  const [newPluginTagline, setNewPluginTagline] = useState('');
  const [newPluginCategory, setNewPluginCategory] =
    useState<ModularPluginItem['category']>('Productivity');
  const [newPluginPermission, setNewPluginPermission] = useState('read:workspace_notes');

  // Standalone Scheduler state
  const [schedules, setSchedules] = useState<ScheduledMissionRecord[]>(DEFAULT_SCHEDULED_MISSIONS);
  const [customToolInput, setCustomToolInput] = useState('');
  const [customToolOutput, setCustomToolOutput] = useState<string | null>(null);

  const activePlugin = plugins.find((p) => p.id === activeStandalonePluginId) || null;

  const filteredPlugins = useMemo(() => {
    return plugins.filter((p) => {
      const isInstalled = p.installed !== false;
      const needsAttn = Boolean(p.needsAttention) || (p.builtInWorkspace === 'trust' && isTampered);
      if (filterTab === 'installed' && !isInstalled) return false;
      if (filterTab === 'available' && isInstalled) return false;
      if (filterTab === 'disabled' && p.enabledInChat) return false;
      if (filterTab === 'attention' && !needsAttn) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.tagline.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [plugins, filterTab, searchQuery, isTampered]);

  const handleCreateCustomPlugin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPluginName.trim()) return;
    const created: ModularPluginItem = {
      id: `plugin-custom-${Date.now()}`,
      name: newPluginName.trim(),
      tagline:
        newPluginTagline.trim() ||
        'Custom standalone tool connected to Chat & PolicyGuard sandbox.',
      category: newPluginCategory,
      version: '1.0.0',
      enabledInChat: true,
      installed: true,
      permissions: [newPluginPermission.trim() || 'read:sandbox'],
      builtInWorkspace: 'custom',
    };
    onAddPlugin(created);
    setNewPluginName('');
    setNewPluginTagline('');
    setAddModalOpen(false);
  };

  const renderPluginIcon = (plugin: ModularPluginItem) => {
    switch (plugin.builtInWorkspace) {
      case 'l3xi':
        return <DollarSign className="w-5 h-5 text-emerald-400" />;
      case 'browser':
        return <Globe className="w-5 h-5 text-sky-400" />;
      case 'music':
        return <Music className="w-5 h-5 text-purple-400" />;
      case 'scheduler':
        return <CalendarClock className="w-5 h-5 text-amber-400" />;
      case 'trust':
        return <ShieldCheck className="w-5 h-5 text-teal-400" />;
      default:
        return <Wrench className="w-5 h-5 text-indigo-400" />;
    }
  };

  // If a standalone plugin is opened, render its clean dedicated workspace
  if (activePlugin) {
    return (
      <div className="space-y-5">
        <div
          className={`flex flex-wrap items-center justify-between gap-4 pb-4 border-b ${
            isLight ? 'border-stone-300' : 'border-stone-800'
          }`}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onSelectStandalonePlugin(null)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                isLight
                  ? 'bg-white border-stone-300 text-stone-800 hover:bg-stone-100'
                  : 'bg-stone-900 border-stone-800 text-stone-200 hover:bg-stone-800'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All Plugins</span>
            </button>
            <div className="flex items-center gap-2">
              {renderPluginIcon(activePlugin)}
              <div>
                <h2 className="text-base font-bold leading-tight">{activePlugin.name}</h2>
                <p className="text-xs text-stone-400">{activePlugin.tagline}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onTogglePluginInChat(activePlugin.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                activePlugin.enabledInChat
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                  : 'border-stone-700 text-stone-400'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {activePlugin.enabledInChat ? 'Enabled in Chat Tasks' : 'Enable in Chat Tasks'}
              </span>
            </button>
          </div>
        </div>

        {/* Standalone Plugin Workspace Content */}
        <Suspense
          fallback={
            <div className="p-8 text-center text-xs text-stone-400">
              Loading standalone plugin workspace...
            </div>
          }
        >
          {activePlugin.builtInWorkspace === 'l3xi' && (
            <L3xiFinanceView
              onRequestDraftApproval={onRequestDraftApproval}
              approvedDraftIds={approvedDraftIds}
            />
          )}

          {activePlugin.builtInWorkspace === 'trust' && (
            <TrustAndLedgerView
              events={ledgerEvents}
              chainReport={chainReport}
              isTampered={isTampered}
              onSimulateTamper={onSimulateTamper}
              onRestoreTamper={onRestoreTamper}
              onDeleteLedgerContent={onDeleteLedgerContent}
              onExplainEvent={onExplainEvent}
              policyConfig={policyConfig}
              onAddStandingRule={onAddStandingRule}
              onLogPluginGuardBlock={onLogPluginGuardBlock}
            />
          )}

          {activePlugin.builtInWorkspace === 'music' && (
            <div
              className={`rounded-2xl border p-6 space-y-5 max-w-3xl ${
                isLight ? 'bg-white border-stone-300' : 'bg-[#121620] border-stone-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold">Pulse Local Audio &amp; Companion Dance Sync</h3>
                  <p className="text-xs text-stone-400">
                    Plays local tracks and syncs Morrow&apos;s dance animation to track BPM.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPlayingMusic(!isPlayingMusic)}
                  className="px-4 py-2 rounded-xl bg-amber-400 text-stone-950 font-semibold text-xs hover:bg-amber-300"
                >
                  {isPlayingMusic ? 'Pause Track' : 'Play Track'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {DEFAULT_LOCAL_MUSIC_TRACKS.map((track) => {
                  const selected = track.id === activeTrack.id;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => {
                        setActiveTrack(track);
                        setIsPlayingMusic(true);
                      }}
                      className={`p-3.5 rounded-xl border text-left text-xs transition-colors ${
                        selected
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                          : isLight
                          ? 'bg-stone-50 border-stone-200 hover:bg-stone-100'
                          : 'bg-stone-900/60 border-stone-800 hover:bg-stone-900'
                      }`}
                    >
                      <div className="font-semibold truncate">{track.title}</div>
                      <div className="text-stone-400 mt-0.5">{track.artist}</div>
                      <div className="font-mono text-[11px] text-amber-400 mt-1">
                        {track.bpm} BPM · {track.durationLabel}
                      </div>
                    </button>
                  );
                })}
              </div>

              <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={danceSyncEnabled}
                  onChange={(e) => setDanceSyncEnabled(e.target.checked)}
                  className="accent-amber-400"
                />
                <span>Sync Morrow 2D companion dance choreography when music plays</span>
              </label>
            </div>
          )}

          {activePlugin.builtInWorkspace === 'scheduler' && (
            <div
              className={`rounded-2xl border p-6 space-y-4 max-w-4xl ${
                isLight ? 'bg-white border-stone-300' : 'bg-[#121620] border-stone-800'
              }`}
            >
              <div>
                <h3 className="text-sm font-bold">Chronos Scheduled Missions</h3>
                <p className="text-xs text-stone-400">
                  Autonomous recurring tasks governed by PolicyGuard and idempotency keys.
                </p>
              </div>
              <div className="divide-y divide-stone-800/70">
                {schedules.map((sch) => (
                  <div
                    key={sch.id}
                    className="py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs"
                  >
                    <div>
                      <div className="font-semibold">{sch.title}</div>
                      <div className="text-stone-400 font-mono text-[11px] mt-0.5">
                        {sch.cronExpression} · Status: {sch.lastRunStatus}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const updated: ScheduledMissionRecord = {
                          ...sch,
                          lastRunStatus: 'COMPLETED_VERIFIED',
                        };
                        setSchedules((prev) =>
                          prev.map((item) => (item.id === sch.id ? updated : item))
                        );
                        onLogScheduleRunToLedger(updated);
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-semibold hover:bg-sky-400"
                    >
                      Run Now
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activePlugin.builtInWorkspace === 'custom' && (
            <div
              className={`rounded-2xl border p-6 space-y-4 max-w-2xl ${
                isLight ? 'bg-white border-stone-300' : 'bg-[#121620] border-stone-800'
              }`}
            >
              <div>
                <h3 className="text-sm font-bold">{activePlugin.name} — Standalone Sandbox</h3>
                <p className="text-xs text-stone-400">
                  Permissions: {activePlugin.permissions.join(', ')} · Isolated Utility Process
                </p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!customToolInput.trim()) return;
                  setCustomToolOutput(
                    `[${activePlugin.name}] Processed "${customToolInput.trim()}" cleanly under PolicyGuard supervision.`
                  );
                }}
                className="flex gap-2 text-xs"
              >
                <input
                  type="text"
                  value={customToolInput}
                  onChange={(e) => setCustomToolInput(e.target.value)}
                  placeholder={`Enter input for ${activePlugin.name}...`}
                  className={`flex-1 px-3 py-2 rounded-xl border ${
                    isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-700'
                  }`}
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-400 text-stone-950 font-semibold"
                >
                  Run Tool
                </button>
              </form>
              {customToolOutput && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono">
                  {customToolOutput}
                </div>
              )}
            </div>
          )}
        </Suspense>
      </div>
    );
  }

  // Default Plugins Catalogue
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Plugins & Standalone Tools"
        subtitle="Each plugin opens in its own dedicated workspace or collaborates in Chat under PolicyGuard."
        uiTheme={uiTheme}
        primaryAction={
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Plugin</span>
          </button>
        }
      />

      {/* Catalogue Filter Tabs + Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={`inline-flex items-center p-1 rounded-xl border text-xs ${
            isLight ? 'bg-stone-200/70 border-stone-300' : 'bg-[#121620] border-stone-800'
          }`}
        >
          {(
            [
              { id: 'all', label: `All (${plugins.length})` },
              {
                id: 'installed',
                label: `Installed (${plugins.filter((p) => p.installed !== false).length})`,
              },
              {
                id: 'disabled',
                label: `Disabled in Chat (${plugins.filter((p) => !p.enabledInChat).length})`,
              },
              {
                id: 'attention',
                label: `Needs Attention (${
                  plugins.filter(
                    (p) => p.needsAttention || (p.builtInWorkspace === 'trust' && isTampered)
                  ).length
                })`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterTab === tab.id
                  ? isLight
                    ? 'bg-white text-stone-900 shadow-xs font-semibold'
                    : 'bg-stone-800 text-stone-100 font-semibold'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs w-full sm:w-64 ${tk.inputBg}`}
        >
          <Search className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          <input
            type="text"
            aria-label="Search plugins"
            placeholder="Search plugins & tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent outline-none flex-1"
          />
        </div>
      </div>

      {/* Plugins Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPlugins.map((plugin) => (
          <div
            key={plugin.id}
            className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 transition-all ${
              isLight
                ? 'bg-white border-stone-200/90 shadow-xs hover:border-stone-300'
                : 'bg-[#131722] border-stone-800/90 hover:border-stone-700'
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2.5 rounded-xl border ${
                      isLight ? 'bg-stone-100 border-stone-200' : 'bg-stone-900 border-stone-800'
                    }`}
                  >
                    {renderPluginIcon(plugin)}
                  </div>
                  <div>
                    <h2 className="text-sm font-bold leading-snug">{plugin.name}</h2>
                    <span className="text-[11px] text-stone-400">
                      {plugin.category} · v{plugin.version}
                    </span>
                  </div>
                </div>

                {/* Toggle for Chat Collaboration */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={plugin.enabledInChat}
                  aria-label={`Use ${plugin.name} in Chat`}
                  onClick={() => onTogglePluginInChat(plugin.id)}
                  title="Allow Chat AI to use this plugin alongside other active tools"
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
                    plugin.enabledInChat
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'bg-stone-800/40 border-stone-700 text-stone-400'
                  }`}
                >
                  {plugin.enabledInChat ? 'In Chat: ON' : 'In Chat: OFF'}
                </button>
              </div>

              <p className="text-xs text-stone-400 leading-relaxed">{plugin.tagline}</p>
            </div>

            <div className="pt-3 border-t border-stone-800/40 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setInspectPlugin(plugin)}
                className="inline-flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-200"
              >
                <Info className="w-3.5 h-3.5" />
                <span>Permissions ({plugin.permissions.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (plugin.builtInWorkspace === 'browser') {
                    onOpenBrowserView();
                  } else {
                    onSelectStandalonePlugin(plugin.id);
                  }
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  isLight
                    ? 'bg-stone-900 text-white hover:bg-stone-800'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-100'
                }`}
              >
                Open Tool →
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* PROGRESSIVE DISCLOSURE: PLUGIN PERMISSIONS & SANDBOX DRAWER */}
      <SlideOverDrawer
        open={Boolean(inspectPlugin)}
        onClose={() => setInspectPlugin(null)}
        title={inspectPlugin ? `${inspectPlugin.name} — Permissions & Sandbox` : 'Plugin Details'}
        subtitle={
          inspectPlugin ? `${inspectPlugin.category} · v${inspectPlugin.version}` : undefined
        }
        uiTheme={uiTheme}
      >
        {inspectPlugin && (
          <div className="space-y-4 text-xs">
            <p className={tk.textSecondary}>{inspectPlugin.tagline}</p>

            <div className={`p-3.5 rounded-xl border space-y-2 ${tk.surfaceElevated}`}>
              <div className="font-semibold">Granted Sandbox Scopes</div>
              <div className="flex flex-wrap gap-1.5">
                {inspectPlugin.permissions.map((perm) => (
                  <span
                    key={perm}
                    className="px-2 py-1 rounded bg-stone-500/15 font-mono text-[11px] text-amber-400"
                  >
                    {perm}
                  </span>
                ))}
              </div>
            </div>

            <div className={`p-3.5 rounded-xl border space-y-1.5 ${tk.surfaceElevated}`}>
              <div className="font-semibold">Trust Kernel Isolation</div>
              <p className={tk.textSecondary}>
                Runs in an isolated utility worker. Cannot escalate permissions or bypass
                PolicyGuard approval gates.
              </p>
            </div>
          </div>
        )}
      </SlideOverDrawer>

      {/* ADD PLUGIN MODAL */}
      {addModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add New Plugin"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <div
            className={`w-full max-w-md rounded-2xl border p-6 space-y-4 shadow-2xl ${
              isLight
                ? 'bg-white border-stone-300 text-stone-900'
                : 'bg-[#151923] border-stone-700 text-stone-100'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Puzzle className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold">Install / Create Standalone Plugin</h3>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="p-1 rounded-lg hover:bg-stone-500/20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] text-stone-400">Quick Templates:</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  {
                    name: 'Invoice OCR & Tax Helper',
                    tagline: 'Extracts VAT/NHIL line items from receipts and exports to L3xi.',
                    cat: 'Finance' as const,
                    perm: 'read:invoices',
                  },
                  {
                    name: 'GitHub PR Reviewer',
                    tagline: 'Inspects pull requests and verifies test suite results.',
                    cat: 'Productivity' as const,
                    perm: 'read:repos',
                  },
                ].map((tpl) => (
                  <button
                    key={tpl.name}
                    type="button"
                    onClick={() => {
                      setNewPluginName(tpl.name);
                      setNewPluginTagline(tpl.tagline);
                      setNewPluginCategory(tpl.cat);
                      setNewPluginPermission(tpl.perm);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-stone-700 text-[11px] hover:border-amber-400 transition-colors"
                  >
                    + {tpl.name}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleCreateCustomPlugin} className="space-y-3 text-xs">
              <div>
                <label className="block text-stone-400 mb-1">Plugin Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Invoice OCR & Tax Helper"
                  value={newPluginName}
                  onChange={(e) => setNewPluginName(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border ${
                    isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-700'
                  }`}
                />
              </div>

              <div>
                <label className="block text-stone-400 mb-1">Description</label>
                <input
                  type="text"
                  placeholder="What does this tool do?"
                  value={newPluginTagline}
                  onChange={(e) => setNewPluginTagline(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border ${
                    isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-700'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-400 mb-1">Category</label>
                  <select
                    value={newPluginCategory}
                    onChange={(e) =>
                      setNewPluginCategory(e.target.value as ModularPluginItem['category'])
                    }
                    className={`w-full px-3 py-2 rounded-lg border ${
                      isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-700'
                    }`}
                  >
                    <option value="Productivity">Productivity</option>
                    <option value="Finance">Finance</option>
                    <option value="Web & Automation">Web &amp; Automation</option>
                    <option value="Security">Security</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-stone-400 mb-1">Sandbox Scope</label>
                  <input
                    type="text"
                    value={newPluginPermission}
                    onChange={(e) => setNewPluginPermission(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border font-mono ${
                      isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-700'
                    }`}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-stone-700 text-stone-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-400 text-stone-950 font-semibold hover:bg-amber-300"
                >
                  Install Plugin
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

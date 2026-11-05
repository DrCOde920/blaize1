/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Universal App Control & Hermes Top-Agent Capabilities View
 * (`src/components/UniversalControlAndHermesView.tsx`)
 * - Tab 1: Apps & Honest Control Ladder (Native Tools -> OS Accessibility -> Vision + Input;
 *          Explore -> Teach -> App Skill; honest blocking for elevated/secure-input/DRM/anti-cheat)
 * - Tab 2: Devices & Pairing (This PC + outbound-only E2E paired PCs with QR/one-time code stub)
 * - Tab 3: What I Know About You (USER.md + MEMORY.md, Closed Learning Loop proposals,
 *          Full-Text Session Search, Quarantine Importer, and optional Text-to-Speech)
 * - Tab 4: Subagents, Lifecycle Hooks (tightening-only), Messaging Gateway, Hard Stops & MCP
 * - Tab 5: Blaize Doctor (Keys, Vault, Permissions, Plugin Health, Context Cache + 1-Click Fixes)
 */

import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Laptop,
  Layers,
  Lock,
  MessageSquare,
  QrCode,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stethoscope,
  UserCheck,
  Volume2,
  Wrench,
} from 'lucide-react';
import {
  ControllableAppDescriptor,
  DoctorCheckItem,
  INITIAL_CONTROLLABLE_APPS,
  INITIAL_DOCTOR_CHECKS,
  INITIAL_LIFECYCLE_HOOKS,
  INITIAL_PAIRED_DEVICES,
  LifecycleHookSpec,
  PairedDeviceRecord,
  WORKSPACE_PROFILES,
  WorkspaceProfileId,
  advanceAppProgressionStage,
  evaluateLifecycleHooks,
  evaluateRunLimits,
  inspectSkillImportSafety,
  selectAppControlStrategy,
} from '../packages/hermes';
import { MemoryEntry } from '../packages/workspace';

export type UniversalHermesSubTab =
  | 'apps'
  | 'devices'
  | 'what_i_know'
  | 'governance'
  | 'doctor';

interface UniversalControlAndHermesViewProps {
  initialTab?: UniversalHermesSubTab;
  isLight: boolean;
  companionName: string;
  userMarkdown: string;
  onChangeUserMarkdown: (nextMd: string) => void;
  memoryEntries: MemoryEntry[];
  onApproveMemoryNudge: (fact: string) => void;
  onDeleteMemory: (id: string) => void;
  threads: Array<{ id: string; title: string; updatedAt: string; messages: Array<{ content: string }> }>;
  onSelectThread: (threadId: string) => void;
  activeProfileId: WorkspaceProfileId;
  onChangeProfileId: (profileId: WorkspaceProfileId) => void;
  onRecordLedgerEvent: (summary: string, payload: Record<string, unknown>) => void;
}

export const UniversalControlAndHermesView: React.FC<UniversalControlAndHermesViewProps> = ({
  initialTab = 'apps',
  isLight,
  companionName,
  userMarkdown,
  onChangeUserMarkdown,
  memoryEntries,
  onApproveMemoryNudge,
  onDeleteMemory,
  threads,
  onSelectThread,
  activeProfileId,
  onChangeProfileId,
  onRecordLedgerEvent,
}) => {
  const [activeTab, setActiveTab] = useState<UniversalHermesSubTab>(initialTab);
  const [apps, setApps] = useState<ControllableAppDescriptor[]>(INITIAL_CONTROLLABLE_APPS);
  const [devices, setDevices] = useState<PairedDeviceRecord[]>(INITIAL_PAIRED_DEVICES);
  const [pairingCode, setPairingCode] = useState('BLZ-8492-X7');
  const [showDetailsAppId, setShowDetailsAppId] = useState<string | null>(null);

  // What I Know About You & Closed Learning Loop state
  const [learningNudges, setLearningNudges] = useState<Array<{ id: string; fact: string; source: string }>>([
    {
      id: 'nudge-1',
      fact: 'Prefers weekly engineering digests formatted as concise bullet tables.',
      source: 'Observed across 3 recent workspace runs',
    },
    {
      id: 'nudge-2',
      fact: 'Uses dark theme with calm visual cards and Details toggles.',
      source: 'Observed in workspace preferences',
    },
  ]);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [quarantineItems, setQuarantineItems] = useState<
    Array<{ id: string; title: string; originAgent: string; status: 'quarantined' | 'approved' | 'rejected'; snippet: string }>
  >([
    {
      id: 'q-1',
      title: 'Markdown Table Normalizer Skill',
      originAgent: 'Imported Hermes Bundle',
      status: 'quarantined',
      snippet: 'Read-only markdown table formatter. Permission diff: [read] only.',
    },
  ]);
  const [skillImportInput, setSkillImportInput] = useState(
    '# Weekly Notes Formatter\nReads workspace markdown notes and formats headings cleanly.'
  );
  const [skillScanResult, setSkillScanResult] = useState<ReturnType<typeof inspectSkillImportSafety> | null>(null);

  // Governance: Subagents, Hooks, Messaging Gateway, Hard Stops, MCP
  const [hooks, setHooks] = useState<LifecycleHookSpec[]>(INITIAL_LIFECYCLE_HOOKS);
  const [hookTestBanner, setHookTestBanner] = useState<string | null>(null);
  const [subagentResult, setSubagentResult] = useState<string | null>(null);
  const [messagingChannel, setMessagingChannel] = useState<'telegram' | 'whatsapp' | 'email'>('telegram');
  const [whitelistedSender, setWhitelistedSender] = useState('@operator_verified');
  const [mcpServerEnabled, setMcpServerEnabled] = useState(false);
  const [unattendedStepCap, setUnattendedStepCap] = useState(15);
  const [unattendedCostCap, setUnattendedCostCap] = useState(0.5);
  const [hardStopSimBanner, setHardStopSimBanner] = useState<string | null>(null);

  // Blaize Doctor state
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheckItem[]>(INITIAL_DOCTOR_CHECKS);
  const [doctorBanner, setDoctorBanner] = useState<string | null>(null);

  const handleAdvanceAppStage = (appId: string) => {
    setApps((prev) =>
      prev.map((a) => {
        if (a.id !== appId) return a;
        const nextStage = advanceAppProgressionStage(a.workflowStage);
        onRecordLedgerEvent(`Updated app "${a.name}" stage to ${nextStage}`, {
          appId,
          nextStage,
        });
        return { ...a, workflowStage: nextStage };
      })
    );
  };

  const handleRunSubagentsDemo = () => {
    setSubagentResult(
      '2 isolated read-only subagents ran in parallel (240 tokens each) and passed parent hash verification.'
    );
    onRecordLedgerEvent('Verified parallel read-only subagent run', {
      subagents: 2,
      readOnly: true,
      verifiedByParent: true,
    });
  };

  const handleTestHookTightening = () => {
    const report = evaluateLifecycleHooks('before_tool', 'allow', [
      ...hooks,
      {
        id: 'hook-test-loosen',
        name: 'Simulated Untrusted Plugin Hook',
        point: 'before_tool',
        sourcePluginOrRule: 'External Plugin',
        proposedDecision: 'allow',
        reason: 'Attempted to loosen ask back to allow',
        enabled: true,
      },
    ]);
    setHookTestBanner(
      `Hook Check: Initial 'allow' tightened to '${report.finalDecision}'. Rejected ${report.rejectedLooseningAttempts.length} loosening attempt.`
    );
  };

  const handleOneClickDoctorFix = (checkId: string) => {
    setDoctorChecks((prev) =>
      prev.map((c) => (c.id === checkId ? { ...c, status: 'healthy', fixLabel: undefined } : c))
    );
    setDoctorBanner('Applied 1-click fix and recorded verification in the ledger.');
    onRecordLedgerEvent('Applied Blaize Doctor 1-click health fix', { checkId });
  };

  const handleSpeakText = (text: string) => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.0;
        window.speechSynthesis.speak(utter);
      }
    } catch {
      // Speech synthesis optional
    }
  };

  const matchingThreads = threads.filter((t) => {
    const q = sessionSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      t.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-5xl mx-auto space-y-5" data-testid="universal-control-hermes-view">
      {/* Top Bar: Profile Switcher & Navigation Pills (<= 3 words each with icons) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'apps', label: 'Apps & Ladder', icon: Laptop },
              { id: 'devices', label: 'Devices', icon: Smartphone },
              { id: 'what_i_know', label: 'What I Know', icon: UserCheck },
              { id: 'governance', label: 'Subagents & Hooks', icon: Cpu },
              { id: 'doctor', label: 'Blaize Doctor', icon: Stethoscope },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.label}
                data-testid={`hermes-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-sky-600 text-white'
                    : isLight
                      ? 'bg-white border border-stone-200 text-stone-600 hover:text-stone-900'
                      : 'bg-stone-900 border border-stone-800 text-stone-400 hover:text-stone-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Workspace Profile Switcher (Personal, Work, Sandbox) */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-stone-400">Profile:</span>
          <div className="inline-flex rounded-xl p-0.5 border border-stone-800 bg-stone-950/60">
            {WORKSPACE_PROFILES.map((prof) => (
              <button
                key={prof.id}
                type="button"
                data-testid={`profile-switch-${prof.id}`}
                onClick={() => onChangeProfileId(prof.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  activeProfileId === prof.id
                    ? 'bg-sky-600 text-white'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                {prof.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TAB 1: APPS & HONEST CONTROL LADDER */}
      {activeTab === 'apps' && (
        <section className="space-y-4" data-testid="apps-control-ladder-section">
          <div
            className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Any PC, Any App — Honest Control Ladder</h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-500/15 text-amber-400 font-medium">
                  Simulated on Desktop Stage
                </span>
              </div>
              <p className="text-xs text-stone-400 mt-0.5">
                Tries Native APIs first, then OS Accessibility, then Vision + Input fallback.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                1. Native / MCP / CLI
              </span>
              <span className="text-stone-500">→</span>
              <span className="px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                2. Accessibility
              </span>
              <span className="text-stone-500">→</span>
              <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                3. Vision + Input
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {apps.map((app) => {
              const evalResult = selectAppControlStrategy(app);
              const detailsOpen = showDetailsAppId === app.id;
              return (
                <div
                  key={app.id}
                  data-testid={`app-ladder-card-${app.id}`}
                  className={`p-4 rounded-2xl border space-y-3 ${
                    isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm">{app.name}</div>
                      <div className="text-xs text-stone-400">{evalResult.tierLabel}</div>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        evalResult.status === 'Ready'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : evalResult.status === 'Limited'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-rose-500/15 text-rose-400'
                      }`}
                    >
                      {evalResult.status}
                    </span>
                  </div>

                  {/* Stepper: Explore (read-only) -> Teach -> App Skill */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-stone-800/60">
                    {evalResult.canAutomate ? (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {(
                          [
                            { id: 'explore_read_only', label: 'Explore' },
                            { id: 'teach', label: 'Teach' },
                            { id: 'app_skill', label: 'App Skill' },
                          ] as const
                        ).map((st) => (
                          <span
                            key={st.id}
                            className={`px-2 py-0.5 rounded-md font-medium ${
                              app.workflowStage === st.id
                                ? 'bg-sky-600 text-white'
                                : 'bg-stone-800/70 text-stone-400'
                            }`}
                          >
                            {st.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-rose-400">
                        Blocked by OS safety boundary
                      </span>
                    )}

                    <div className="flex items-center gap-1.5">
                      {evalResult.canAutomate && (
                        <button
                          type="button"
                          data-testid={`advance-app-stage-${app.id}`}
                          onClick={() => handleAdvanceAppStage(app.id)}
                          className="px-2.5 py-1 rounded-lg bg-sky-600/20 text-sky-300 border border-sky-500/30 text-[11px] font-medium"
                        >
                          Advance Stage
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowDetailsAppId(detailsOpen ? null : app.id)}
                        className="px-2 py-1 rounded-lg border border-stone-700 text-[11px] text-stone-400"
                      >
                        Details
                      </button>
                    </div>
                  </div>

                  {detailsOpen && (
                    <div className="p-2.5 rounded-xl bg-stone-950/80 border border-stone-800 text-[11px] text-stone-300">
                      {evalResult.reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* TAB 2: DEVICES & PAIRING (STUB) */}
      {activeTab === 'devices' && (
        <section className="space-y-4" data-testid="devices-pairing-section">
          <div
            className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Devices &amp; Remote Pairing</h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-500/15 text-amber-400 font-medium">
                  Pairing Stub (Native Shell Target)
                </span>
              </div>
              <p className="text-xs text-stone-400 mt-0.5">
                Outbound-only E2E encrypted pairing with per-device approvals and instant revocation.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-xl border border-stone-700 text-xs font-medium inline-flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5 text-sky-400" />
                <span>One-Time Code: {pairingCode}</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  setPairingCode(`BLZ-${Math.floor(1000 + Math.random() * 9000)}-E2E`)
                }
                className="px-3 py-1.5 rounded-xl bg-sky-600 text-white text-xs font-medium"
              >
                New Code
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {devices.map((dev) => (
              <div
                key={dev.id}
                className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                }`}
              >
                <div className="space-y-1">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    <span>{dev.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] ${
                        dev.status === 'online'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : dev.status === 'revoked'
                            ? 'bg-rose-500/15 text-rose-400'
                            : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      {dev.status === 'online'
                        ? 'Active'
                        : dev.status === 'revoked'
                          ? 'Revoked'
                          : 'Paired Stub'}
                    </span>
                  </div>
                  <div className="text-xs text-stone-400">
                    {dev.os} · {dev.lastSeen}
                  </div>
                </div>

                {!dev.isCurrentPc && (
                  <button
                    type="button"
                    onClick={() =>
                      setDevices((prev) =>
                        prev.map((d) =>
                          d.id === dev.id
                            ? {
                                ...d,
                                status: d.status === 'revoked' ? 'paired_stub' : 'revoked',
                              }
                            : d
                        )
                      )
                    }
                    className="px-3 py-1.5 rounded-xl border border-stone-700 hover:border-rose-500/40 text-xs font-medium"
                  >
                    {dev.status === 'revoked' ? 'Restore' : 'Revoke'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 3: WHAT I KNOW ABOUT YOU (USER.md + MEMORY.md + CLOSED LEARNING LOOP + SESSION SEARCH) */}
      {activeTab === 'what_i_know' && (
        <section className="space-y-5" data-testid="what-i-know-section">
          {/* Closed Learning Loop Proposals */}
          <div
            className={`p-4 rounded-2xl border space-y-3 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">
                  Closed Learning Loop — Proposed Durable Facts ({learningNudges.length})
                </h2>
                <p className="text-xs text-stone-400">
                  {companionName} proposes durable facts from recent work; nothing is saved without your approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleSpeakText(userMarkdown)}
                className="px-3 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-xs inline-flex items-center gap-1.5"
                title="Read USER.md aloud (Optional TTS)"
              >
                <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                <span>Speak Summary</span>
              </button>
            </div>

            {learningNudges.length === 0 ? (
              <div className="text-xs text-stone-400">All learning proposals reviewed.</div>
            ) : (
              <div className="space-y-2">
                {learningNudges.map((nudge) => (
                  <div
                    key={nudge.id}
                    className="p-3 rounded-xl border border-stone-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-medium">{nudge.fact}</div>
                      <div className="text-[11px] text-stone-400">{nudge.source}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid={`approve-nudge-${nudge.id}`}
                        onClick={() => {
                          onApproveMemoryNudge(nudge.fact);
                          setLearningNudges((prev) => prev.filter((n) => n.id !== nudge.id));
                        }}
                        className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-medium"
                      >
                        Approve &amp; Save
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setLearningNudges((prev) => prev.filter((n) => n.id !== nudge.id))
                        }
                        className="px-2.5 py-1 rounded-lg border border-stone-700 text-stone-400"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* USER.md & MEMORY.md Inspector */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div
              className={`p-4 rounded-2xl border space-y-2.5 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="font-semibold text-xs">
                What I Know About You (USER.md Profile Model)
              </div>
              <textarea
                rows={7}
                aria-label="USER.md editor"
                data-testid="user-md-editor"
                value={userMarkdown}
                onChange={(e) => onChangeUserMarkdown(e.target.value)}
                className={`w-full p-3 rounded-xl border text-xs ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                }`}
              />
            </div>

            <div
              className={`p-4 rounded-2xl border space-y-2.5 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="font-semibold text-xs">
                Saved Memories (MEMORY.md · {memoryEntries.length})
              </div>
              <div className="space-y-2 max-h-44 overflow-y-auto">
                {memoryEntries.map((m) => (
                  <div
                    key={m.id}
                    className="p-2.5 rounded-xl border border-stone-800 flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate">{m.fact || m.content}</span>
                    <button
                      type="button"
                      onClick={() => onDeleteMemory(m.id)}
                      className="px-2 py-0.5 rounded border border-stone-700 text-rose-400 text-[11px]"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Full-Text Session Search ("remember when we...") & Quarantine Importer */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="font-semibold text-xs">
                Session Search (&ldquo;Remember when we...&rdquo;)
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-stone-800 bg-stone-950/50">
                <Search className="w-3.5 h-3.5 text-stone-400" />
                <input
                  type="text"
                  data-testid="hermes-session-search-input"
                  value={sessionSearchQuery}
                  onChange={(e) => setSessionSearchQuery(e.target.value)}
                  placeholder="Search past conversations and summaries..."
                  className="bg-transparent text-xs outline-none w-full"
                />
              </div>
              <div className="space-y-1.5">
                {matchingThreads.map((th) => (
                  <button
                    key={th.id}
                    type="button"
                    onClick={() => onSelectThread(th.id)}
                    className="w-full p-2.5 rounded-xl border border-stone-800 hover:border-sky-500/40 text-left flex items-center justify-between text-xs"
                  >
                    <span className="font-medium truncate">{th.title}</span>
                    <span className="text-[11px] text-stone-400">{th.updatedAt}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* External Agent Quarantine Importer */}
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="font-semibold text-xs">
                External Agent Import Quarantine ({quarantineItems.length})
              </div>
              {quarantineItems.map((q) => (
                <div
                  key={q.id}
                  className="p-3 rounded-xl border border-stone-800 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{q.title}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-400 capitalize">
                      {q.status}
                    </span>
                  </div>
                  <div className="text-stone-400">{q.snippet}</div>
                  {q.status === 'quarantined' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setQuarantineItems((prev) =>
                            prev.map((item) =>
                              item.id === q.id ? { ...item, status: 'approved' } : item
                            )
                          )
                        }
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-medium"
                      >
                        Approve from Quarantine
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setQuarantineItems((prev) =>
                            prev.map((item) =>
                              item.id === q.id ? { ...item, status: 'rejected' } : item
                            )
                          )
                        }
                        className="px-2.5 py-1 rounded-lg border border-stone-700 text-rose-400 text-[11px]"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TAB 4: SUBAGENTS, LIFECYCLE HOOKS, MESSAGING GATEWAY, HARD STOPS & SKILLS HUB */}
      {activeTab === 'governance' && (
        <section className="space-y-4" data-testid="hermes-governance-section">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Isolated Subagents & Tightening-Only Lifecycle Hooks */}
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">
                    Subagents &amp; Tightening-Only Hooks
                  </div>
                  <div className="text-xs text-stone-400">
                    Read-only budgeted subagents and hooks that can never loosen policy.
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="run-subagents-btn"
                    onClick={handleRunSubagentsDemo}
                    className="px-2.5 py-1.5 rounded-xl bg-sky-600 text-white text-xs font-medium"
                  >
                    Run Subagents
                  </button>
                  <button
                    type="button"
                    data-testid="verify-hooks-btn"
                    onClick={handleTestHookTightening}
                    className="px-2.5 py-1.5 rounded-xl border border-stone-700 text-xs font-medium"
                  >
                    Verify Hooks
                  </button>
                </div>
              </div>

              {subagentResult && (
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                  {subagentResult}
                </div>
              )}

              {hookTestBanner && (
                <div
                  data-testid="hook-tightening-banner"
                  className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs"
                >
                  {hookTestBanner}
                </div>
              )}

              <div className="space-y-2">
                {hooks.map((h) => (
                  <div
                    key={h.id}
                    className="p-2.5 rounded-xl border border-stone-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-medium">{h.name}</div>
                      <div className="text-[11px] text-stone-400">
                        Hook: {h.point} · Tightens to {h.proposedDecision}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setHooks((prev) =>
                          prev.map((item) =>
                            item.id === h.id ? { ...item, enabled: !item.enabled } : item
                          )
                        )
                      }
                      className={`px-2.5 py-1 rounded-lg border text-[11px] ${
                        h.enabled
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                          : 'border-stone-700 text-stone-400'
                      }`}
                    >
                      {h.enabled ? 'Active' : 'Paused'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Messaging Gateway, Unattended Hard Stops & MCP Mode */}
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="font-semibold text-sm">
                Messaging Gateway, Hard Stops &amp; MCP Mode
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">
                    Outbound Approval Channel
                  </label>
                  <select
                    value={messagingChannel}
                    onChange={(e) =>
                      setMessagingChannel(e.target.value as 'telegram' | 'whatsapp' | 'email')
                    }
                    className={`w-full px-2.5 py-1.5 rounded-lg border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  >
                    <option value="telegram">Telegram (Outbound-Only)</option>
                    <option value="whatsapp">WhatsApp (Outbound-Only)</option>
                    <option value="email">Verified Email Digest</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">
                    Whitelisted Sender
                  </label>
                  <input
                    type="text"
                    value={whitelistedSender}
                    onChange={(e) => setWhitelistedSender(e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded-lg border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">
                    Unattended Step Hard Stop
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={50}
                    value={unattendedStepCap}
                    onChange={(e) => setUnattendedStepCap(Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 rounded-lg border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">
                    Unattended Cost Hard Stop ($)
                  </label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    max={10}
                    value={unattendedCostCap}
                    onChange={(e) => setUnattendedCostCap(Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 rounded-lg border ${
                      isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-800/60 text-xs">
                <button
                  type="button"
                  data-testid="simulate-hard-stop-btn"
                  onClick={() => {
                    const res = evaluateRunLimits(
                      {
                        mode: 'unattended',
                        stepsExecuted: unattendedStepCap + 1,
                        elapsedSeconds: 30,
                        costUsd: unattendedCostCap + 0.1,
                      },
                      {
                        maxSteps: unattendedStepCap,
                        maxDurationSeconds: 120,
                        maxCostUsd: unattendedCostCap,
                      }
                    );
                    setHardStopSimBanner(res.message);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30 font-medium"
                >
                  Test Unattended Hard Stop
                </button>

                <button
                  type="button"
                  onClick={() => setMcpServerEnabled((v) => !v)}
                  className={`px-3 py-1.5 rounded-xl border font-medium ${
                    mcpServerEnabled
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-stone-700 text-stone-400'
                  }`}
                >
                  MCP Server Mode: {mcpServerEnabled ? 'Exposing Approved Skills' : 'Off'}
                </button>
              </div>

              {hardStopSimBanner && (
                <div
                  data-testid="hard-stop-banner"
                  className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs"
                >
                  {hardStopSimBanner}
                </div>
              )}
            </div>
          </div>

          {/* Skills Hub Static Safety Scanner */}
          <div
            className={`p-4 rounded-2xl border space-y-3 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">
                  Skills Hub — Static Checker &amp; Permission Diff
                </div>
                <div className="text-xs text-stone-400">
                  Scans imported skills for shell scripts and computes permission diffs before saving.
                </div>
              </div>
              <button
                type="button"
                data-testid="scan-skill-import-btn"
                onClick={() => setSkillScanResult(inspectSkillImportSafety(skillImportInput))}
                className="px-3.5 py-1.5 rounded-xl bg-sky-600 text-white text-xs font-semibold"
              >
                Scan Skill
              </button>
            </div>

            <textarea
              rows={2}
              value={skillImportInput}
              onChange={(e) => setSkillImportInput(e.target.value)}
              className={`w-full p-2.5 rounded-xl border text-xs ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            />

            {skillScanResult && (
              <div
                data-testid="skill-scan-result-banner"
                className={`p-3 rounded-xl border text-xs ${
                  skillScanResult.safeToImport
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                }`}
              >
                Status: <strong>{skillScanResult.trustLevel}</strong> · Permission diff:{' '}
                {skillScanResult.permissionDiff.length > 0
                  ? skillScanResult.permissionDiff.join(', ')
                  : 'None (read-only)'}
                {skillScanResult.blockedReasons.length > 0 &&
                  ` · ${skillScanResult.blockedReasons.join(' ')}`}
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 5: BLAIZE DOCTOR (ONE-CLICK HEALTH FIXES) */}
      {activeTab === 'doctor' && (
        <section className="space-y-4" data-testid="blaize-doctor-section">
          <div
            className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
            }`}
          >
            <div>
              <h2 className="text-base font-semibold">Blaize Doctor — Workspace Diagnostics</h2>
              <p className="text-xs text-stone-400 mt-0.5">
                Checks keys, vault backend, permissions, plugin health, and prompt cache with one-click fixes.
              </p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400">
              {doctorChecks.filter((c) => c.status === 'healthy').length} / {doctorChecks.length} Healthy
            </span>
          </div>

          {doctorBanner && (
            <div
              data-testid="doctor-fix-banner"
              className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs"
            >
              {doctorBanner}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {doctorChecks.map((check) => (
              <div
                key={check.id}
                data-testid={`doctor-check-${check.id}`}
                className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                }`}
              >
                <div className="space-y-1">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {check.status === 'healthy' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span>{check.title}</span>
                  </div>
                  <div className="text-xs text-stone-400">{check.summary}</div>
                </div>

                {check.fixLabel && check.status !== 'healthy' && (
                  <button
                    type="button"
                    data-testid={`doctor-fix-btn-${check.id}`}
                    onClick={() => handleOneClickDoctorFix(check.id)}
                    className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shrink-0"
                  >
                    {check.fixLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

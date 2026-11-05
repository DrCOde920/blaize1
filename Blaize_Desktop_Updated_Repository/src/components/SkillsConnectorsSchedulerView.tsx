/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SkillsConnectorsSchedulerView — Refined, progressive-disclosure studios for:
 * 1. Reusable Skills (searchable list, parameter form, collapsed Compiled Prompt preview, Duplicate/Export/Edit)
 * 2. Connectors (compact integration rows, accurate Connected vs Simulated Sandbox vs Disconnected state, Scopes & Project Binding drawer)
 * 3. Scheduler (compact local-time schedule table, expandable Next-5-Runs UTC preview, 4-step schedule wizard with PolicyGuard money block)
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Database,
  Download,
  FileCode2,
  GitBranch,
  Landmark,
  Layers,
  MessageSquare,
  Play,
  Plug,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  ArtifactKind,
  DEFAULT_SOUL_DOCUMENT,
  INITIAL_MEMORY_ENTRIES,
  MemoryEntry,
  OfflineMissedRunPolicy,
  ReusableSkill,
  SOUL_PRESET_TEMPLATES,
  ScheduledTaskItem,
  SoulDocument,
  SoulVoiceCadence,
  WorkspaceConnector,
  WorkspaceProject,
  assembleHermesSystemPrompt,
  compileAndExecuteReusableSkill,
  createScheduledTask,
  duplicateReusableSkill,
  executeSkillManage,
  formatScheduleRunLocal,
  parseAndValidateSoulDocument,
  testConnectorReadSandbox,
} from '../packages/workspace';
import { SoulMdEditorPanel } from './SoulMdEditorPanel';
import {
  EmptyStateBlock,
  GuardBlockedNotice,
  PageHeader,
  SlideOverDrawer,
} from './ui/WorkspacePrimitives';

export type HermesSkillsSubTab = 'skills' | 'soul' | 'memory' | 'prompt_slots';

interface SkillsConnectorsSchedulerViewProps {
  mode: 'skills' | 'connectors' | 'scheduler';
  activeProject: WorkspaceProject;
  projects: WorkspaceProject[];
  skills: ReusableSkill[];
  onAddSkill: (skill: ReusableSkill) => void;
  onUpdateSkill?: (updated: ReusableSkill) => void;
  onReplaceSkills?: (skills: ReusableSkill[]) => void;
  onRemoveSkill?: (skillId: string) => void;
  onExecuteSkillResult: (result: {
    skill: ReusableSkill;
    compiledPrompt: string;
    artifactTitle: string;
    artifactKind: ArtifactKind;
    artifactContent: string;
    openInChat?: boolean;
  }) => void;
  soulDocument?: SoulDocument;
  onUpdateSoulDocument?: (soul: SoulDocument) => void;
  memoryEntries?: MemoryEntry[];
  onAddMemoryEntry?: (entry: MemoryEntry) => void;
  onRemoveMemoryEntry?: (id: string) => void;
  onOpenPathInIde?: (path: string, content: string) => void;
  initialSkillsSubTab?: HermesSkillsSubTab;
  connectors: WorkspaceConnector[];
  onToggleConnectorStatus: (connectorId: string) => void;
  onToggleConnectorProjectBind: (connectorId: string, projectId: string) => void;
  onToggleConnectorWriteApproval: (connectorId: string) => void;
  schedules: ScheduledTaskItem[];
  onAddSchedule: (schedule: ScheduledTaskItem) => void;
  onToggleScheduleEnabled: (scheduleId: string) => void;
  onRunScheduleNow: (schedule: ScheduledTaskItem) => void;
  uiTheme: 'dark' | 'light';
}

export const SkillsConnectorsSchedulerView: React.FC<SkillsConnectorsSchedulerViewProps> = ({
  mode,
  activeProject,
  projects,
  skills,
  onAddSkill,
  onUpdateSkill,
  onReplaceSkills,
  onRemoveSkill,
  onExecuteSkillResult,
  soulDocument = DEFAULT_SOUL_DOCUMENT,
  onUpdateSoulDocument,
  memoryEntries = INITIAL_MEMORY_ENTRIES,
  onAddMemoryEntry,
  onRemoveMemoryEntry,
  onOpenPathInIde,
  initialSkillsSubTab = 'skills',
  connectors,
  onToggleConnectorStatus,
  onToggleConnectorProjectBind,
  onToggleConnectorWriteApproval,
  schedules,
  onAddSchedule,
  onToggleScheduleEnabled,
  onRunScheduleNow,
  uiTheme,
}) => {
  const isLight = uiTheme === 'light';

  // ==========================================================================
  // 1. HERMES SKILLS, SOUL.MD & MEMORY.MD STATE
  // ==========================================================================
  const [activeSubTab, setActiveSubTab] = useState<HermesSkillsSubTab>(initialSkillsSubTab);
  const [skillSearch, setSkillSearch] = useState<string>('');
  const [selectedSkillId, setSelectedSkillId] = useState<string>(skills[0]?.id || '');
  const [disabledSkillIds, setDisabledSkillIds] = useState<string[]>([]);
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({});
  const [showCompiledPrompt, setShowCompiledPrompt] = useState<boolean>(false);
  const [showGuardFindings, setShowGuardFindings] = useState<boolean>(false);
  const [editingSkillMd, setEditingSkillMd] = useState<boolean>(false);
  const [draftSkillMd, setDraftSkillMd] = useState<string>('');
  const [disclosureTier, setDisclosureTier] = useState<'tier0_index' | 'tier1_full'>('tier1_full');
  const [skillDryRunMode, setSkillDryRunMode] = useState<boolean>(false);

  // Hermes skill_manage(patch) state
  const [patchPanelOpen, setPatchPanelOpen] = useState<boolean>(false);
  const [patchPitfallNote, setPatchPitfallNote] = useState<string>('');
  const [patchAppendStep, setPatchAppendStep] = useState<string>('');
  const [patchAddTrigger, setPatchAddTrigger] = useState<string>('');

  // Hermes skill_manage(create) drawer state
  const [skillBuilderOpen, setSkillBuilderOpen] = useState<boolean>(false);
  const [newSkillName, setNewSkillName] = useState<string>('');
  const [newSkillCategory, setNewSkillCategory] =
    useState<ReusableSkill['category']>('automation');
  const [newSkillDesc, setNewSkillDesc] = useState<string>('');
  const [newSkillTriggers, setNewSkillTriggers] = useState<string>('report, weekly, summary');
  const [newSkillMd, setNewSkillMd] = useState<string>(
    '---\nname: custom-workflow\nversion: 1\nguard: verified\ntriggers: [report, weekly, summary]\n---\n# Procedure\n1. Inspect {{target_resource}}\n2. Emit verified summary artifact.\n\n# Pitfalls & Edge Cases\n- Verify source schema before aggregation.'
  );
  const [newSkillParams, setNewSkillParams] = useState<string>('target_resource');
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillSuccessBanner, setSkillSuccessBanner] = useState<string | null>(null);

  // SOUL.md Editor State
  const [draftSoulMarkdown, setDraftSoulMarkdown] = useState<string>(soulDocument.rawMarkdown);
  const [draftSoulCadence, setDraftSoulCadence] = useState<SoulVoiceCadence>(
    soulDocument.voiceCadence
  );

  // MEMORY.md Editor State
  const [newMemoryContent, setNewMemoryContent] = useState<string>('');
  const [newMemoryCategory, setNewMemoryCategory] =
    useState<MemoryEntry['category']>('verified_fact');

  // System Prompt Slot #4 Live Matcher Input
  const [testMatcherPrompt, setTestMatcherPrompt] = useState<string>(
    'Reconcile my October statement balance and build a Safe-to-Spend dashboard'
  );

  const filteredSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.triggers || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [skills, skillSearch]);

  const selectedSkill =
    skills.find((s) => s.id === selectedSkillId) || filteredSkills[0] || skills[0];

  const compiledPreviewText = useMemo(() => {
    if (!selectedSkill) return '';
    let text = selectedSkill.skillMarkdown;
    selectedSkill.parameters.forEach((p) => {
      const val = (paramInputs[p.name] ?? p.defaultValue ?? '').trim();
      text = text.split(`{{${p.name}}}`).join(val);
    });
    return text;
  }, [selectedSkill, paramInputs]);

  const assembledPrompt = useMemo(
    () =>
      assembleHermesSystemPrompt({
        soul: soulDocument,
        memoryEntries,
        project: activeProject,
        skills,
        disabledSkillIds,
        activePrompt: testMatcherPrompt,
      }),
    [soulDocument, memoryEntries, activeProject, skills, disabledSkillIds, testMatcherPrompt]
  );

  // ==========================================================================
  // 2. CONNECTORS STATE
  // ==========================================================================
  const [configuredConnectorId, setConfiguredConnectorId] = useState<string | null>(null);
  const [connectorBanner, setConnectorBanner] = useState<string | null>(null);
  const configuredConnector =
    connectors.find((c) => c.id === configuredConnectorId) || null;

  // ==========================================================================
  // 3. SCHEDULER STATE
  // ==========================================================================
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);
  const [scheduleDrawerOpen, setScheduleDrawerOpen] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [newSchedTitle, setNewSchedTitle] = useState<string>('');
  const [newSchedPrompt, setNewSchedPrompt] = useState<string>('');
  const [newSchedSkillId, setNewSchedSkillId] = useState<string>('');
  const [newSchedNatural, setNewSchedNatural] = useState<string>('Every weekday at 09:00');
  const [newSchedCron, setNewSchedCron] = useState<string>('0 9 * * 1-5');
  const [newSchedTimezone, setNewSchedTimezone] = useState<string>('UTC');
  const [newSchedProjectId, setNewSchedProjectId] = useState<string>(activeProject.id);
  const [newSchedOfflinePolicy, setNewSchedOfflinePolicy] =
    useState<OfflineMissedRunPolicy>('run_once_on_wake');
  const [schedBanner, setSchedBanner] = useState<string | null>(null);

  // --- SKILL HANDLERS ---
  const handleRunSelectedSkill = (openInChat = false) => {
    if (!selectedSkill) return;
    if (disabledSkillIds.includes(selectedSkill.id)) {
      setSkillError('This skill is currently disabled. Enable it first to run.');
      return;
    }
    const mergedParams: Record<string, string> = {};
    selectedSkill.parameters.forEach((p) => {
      mergedParams[p.name] = paramInputs[p.name] ?? p.defaultValue;
    });

    const res = compileAndExecuteReusableSkill(selectedSkill, mergedParams);
    if (!res.ok) {
      setSkillError(res.error || 'Failed to run skill');
      return;
    }
    setSkillError(null);
    if (skillDryRunMode) {
      setShowCompiledPrompt(true);
      setSkillSuccessBanner(
        `Sandbox Dry-Run passed for "${selectedSkill.name}" (v${selectedSkill.version || 1}) · 0 external writes · Compiled prompt verified below.`
      );
      return;
    }
    setSkillSuccessBanner(
      `Executed "${selectedSkill.name}" (v${selectedSkill.version || 1}) and saved "${res.generatedArtifactTitle}" to Project Artifacts.`
    );
    onExecuteSkillResult({
      skill: selectedSkill,
      compiledPrompt: res.compiledPrompt,
      artifactTitle: res.generatedArtifactTitle,
      artifactKind: res.generatedArtifactKind,
      artifactContent: res.generatedArtifactContent,
      openInChat,
    });
  };

  const handleDuplicateSkill = () => {
    if (!selectedSkill) return;
    const copy = duplicateReusableSkill(selectedSkill);
    onAddSkill(copy);
    setSelectedSkillId(copy.id);
    setSkillSuccessBanner(`Duplicated "${selectedSkill.name}".`);
  };

  const handleExportSkill = () => {
    if (!selectedSkill) return;
    const blob = new Blob([selectedSkill.skillMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSkill.slug}.SKILL.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateCustomSkill = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = executeSkillManage(skills, {
        action: 'create',
        name: newSkillName,
        category: newSkillCategory,
        description: newSkillDesc,
        skillMarkdown: newSkillMd,
        parameterNames: newSkillParams.split(','),
        triggers: newSkillTriggers
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      if (res.targetSkill) {
        onAddSkill(res.targetSkill);
        setSelectedSkillId(res.targetSkill.id);
      }
      setNewSkillName('');
      setNewSkillDesc('');
      setSkillBuilderOpen(false);
      setSkillError(null);
      setSkillSuccessBanner(`${res.operationSummary} · Verified by PolicyGuard.`);
    } catch (err: any) {
      setSkillError(err?.message || 'Could not create skill');
    }
  };

  const handleApplySkillPatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSkill) return;
    if (!patchPitfallNote.trim() && !patchAppendStep.trim() && !patchAddTrigger.trim()) {
      setSkillError('Provide at least one pitfall note, procedure step, or trigger to patch.');
      return;
    }
    try {
      const res = executeSkillManage(skills, {
        action: 'patch',
        skillId: selectedSkill.id,
        pitfallNote: patchPitfallNote,
        appendStep: patchAppendStep,
        addTrigger: patchAddTrigger,
      });
      if (onReplaceSkills) {
        onReplaceSkills(res.skills);
      } else if (res.targetSkill && onUpdateSkill) {
        onUpdateSkill(res.targetSkill);
      }
      setPatchPitfallNote('');
      setPatchAppendStep('');
      setPatchAddTrigger('');
      setPatchPanelOpen(false);
      setSkillError(null);
      setSkillSuccessBanner(`${res.operationSummary} · Self-improving procedural patch applied.`);
    } catch (err: any) {
      setSkillError(err?.message || 'PolicyGuard blocked skill patch');
    }
  };

  const handleSaveSoulDocument = () => {
    const parsed = parseAndValidateSoulDocument(
      draftSoulMarkdown,
      draftSoulCadence,
      soulDocument.version + 1
    );
    if (!parsed.guardVerified) {
      setSkillError(parsed.guardFindings.join(' '));
      return;
    }
    setSkillError(null);
    if (onUpdateSoulDocument) {
      onUpdateSoulDocument(parsed);
    }
    setSkillSuccessBanner(
      `Saved ~/.blaize/SOUL.md (v${parsed.version} · ${SOUL_PRESET_TEMPLATES[draftSoulCadence].badge}) to Slot #1 of the System Prompt.`
    );
  };

  const handleSelectSoulPreset = (cadence: SoulVoiceCadence) => {
    const preset = SOUL_PRESET_TEMPLATES[cadence];
    setDraftSoulCadence(cadence);
    setDraftSoulMarkdown(preset.markdown);
    const parsed = parseAndValidateSoulDocument(
      preset.markdown,
      cadence,
      soulDocument.version + 1
    );
    if (parsed.guardVerified && onUpdateSoulDocument) {
      onUpdateSoulDocument(parsed);
      setSkillError(null);
      setSkillSuccessBanner(
        `Activated SOUL.md preset "${preset.badge}" in Slot #1 of Morrow's System Prompt.`
      );
    }
  };

  const handleAddMemorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newMemoryContent.trim();
    if (!clean) return;
    if (
      /\b(bypass policyguard|ignore approval|send wire without approval)\b/i.test(
        clean.toLowerCase()
      )
    ) {
      setSkillError('PolicyGuard blocked MEMORY.md entry: cannot store guardrail bypass instructions.');
      return;
    }
    const created: MemoryEntry = {
      id: `mem-${Date.now().toString(36)}`,
      category: newMemoryCategory,
      content: clean,
      source: 'user_pinned',
      updatedAt: 'Just now',
    };
    if (onAddMemoryEntry) {
      onAddMemoryEntry(created);
    }
    setNewMemoryContent('');
    setSkillError(null);
    setSkillSuccessBanner('Appended persistent note to ~/.blaize/memories/MEMORY.md (Slot #2).');
  };

  // --- SCHEDULER HANDLERS ---
  const previewScheduleDraft = useMemo(() => {
    const title = newSchedTitle.trim() || 'Untitled Scheduled Mission';
    const prompt = newSchedPrompt.trim() || 'Run verified project check';
    return createScheduledTask({
      projectId: newSchedProjectId || activeProject.id,
      title,
      naturalSchedule: newSchedNatural,
      cronExpression: newSchedCron,
      timezone: newSchedTimezone,
      actionPrompt: prompt,
      linkedSkillId: newSchedSkillId || undefined,
      offlineMissedRunPolicy: newSchedOfflinePolicy,
    });
  }, [
    newSchedTitle,
    newSchedPrompt,
    newSchedNatural,
    newSchedCron,
    newSchedTimezone,
    newSchedProjectId,
    newSchedSkillId,
    newSchedOfflinePolicy,
    activeProject.id,
  ]);

  const handleCreateScheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSchedTitle.trim() || !newSchedPrompt.trim()) {
      setSchedBanner('Enter both a job title and an action prompt.');
      return;
    }
    const created = createScheduledTask({
      projectId: newSchedProjectId || activeProject.id,
      title: newSchedTitle,
      naturalSchedule: newSchedNatural,
      cronExpression: newSchedCron,
      timezone: newSchedTimezone,
      actionPrompt: newSchedPrompt,
      linkedSkillId: newSchedSkillId || undefined,
      offlineMissedRunPolicy: newSchedOfflinePolicy,
    });
    onAddSchedule(created);
    setNewSchedTitle('');
    setNewSchedPrompt('');
    setWizardStep(1);
    setScheduleDrawerOpen(false);
    setExpandedScheduleId(created.id);
    setSchedBanner(
      created.lastRunStatus === 'blocked_by_guard'
        ? created.guardNote
        : `Scheduled "${created.title}" (${created.cronExpression}) · Offline policy: ${created.offlineMissedRunPolicy || 'run_once_on_wake'}.`
    );
  };

  // ==========================================================================
  // VIEW A: HERMES SKILLS & SOUL STUDIO (SKILL.md + SOUL.md + MEMORY.md + 4-Slot Prompt)
  // ==========================================================================
  if (mode === 'skills') {
    const isSkillDisabled = selectedSkill ? disabledSkillIds.includes(selectedSkill.id) : false;

    return (
      <div className="p-5 sm:p-7 max-w-6xl mx-auto space-y-5">
        <PageHeader
          title="Skills & Soul (Hermes Architecture)"
          subtitle="Self-improving procedural SKILL.md library, ~/.blaize/SOUL.md Slot #1 identity, and persistent MEMORY.md."
          metaText={`SOUL.md v${soulDocument.version} (${SOUL_PRESET_TEMPLATES[soulDocument.voiceCadence].badge}) · ${skills.length} skills · ${activeProject.name}`}
          uiTheme={uiTheme}
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveSubTab('soul')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                  activeSubTab === 'soul'
                    ? 'border-amber-400 bg-amber-400/15 text-amber-300 font-semibold'
                    : isLight
                    ? 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                    : 'border-stone-700 bg-stone-900 text-stone-300 hover:bg-stone-800'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>SOUL.md</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSkillError(null);
                  setSkillBuilderOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Skill</span>
              </button>
            </div>
          }
        />

        {/* Hermes Architecture Sub-Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Hermes Skills and Soul Sections"
          className={`inline-flex flex-wrap items-center gap-1 p-1 rounded-xl border text-xs ${
            isLight ? 'bg-stone-200/70 border-stone-300' : 'bg-[#121620] border-stone-800'
          }`}
        >
          {[
            {
              id: 'skills' as HermesSkillsSubTab,
              label: `Skills (${skills.length})`,
              icon: Wand2,
            },
            {
              id: 'soul' as HermesSkillsSubTab,
              label: "Morrow's Soul",
              icon: Sparkles,
            },
            {
              id: 'memory' as HermesSkillsSubTab,
              label: `Memory (${memoryEntries.length})`,
              icon: Brain,
            },
            {
              id: 'prompt_slots' as HermesSkillsSubTab,
              label: 'Prompt Slots',
              icon: Layers,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSubTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  active
                    ? isLight
                      ? 'bg-stone-900 text-white font-semibold shadow-xs'
                      : 'bg-amber-400 text-stone-950 font-semibold'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {skillError && (
          <GuardBlockedNotice
            reason={skillError}
            nextStep="Remove any instruction that attempts to bypass PolicyGuard or fill required fields."
          />
        )}

        {skillSuccessBanner && (
          <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{skillSuccessBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setSkillSuccessBanner(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* SUB-TAB 1: PROCEDURAL SKILLS (SKILL.md + skill_manage) */}
        {activeSubTab === 'skills' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Compact Searchable Skill List + Tier-0 Index Toggle */}
            <div
              className={`lg:col-span-5 rounded-2xl border overflow-hidden ${
                isLight ? 'bg-white border-stone-200/90' : 'bg-[#121620] border-stone-800/90'
              }`}
            >
              <div
                className={`p-3 border-b flex items-center justify-between gap-2 ${
                  isLight ? 'border-stone-200' : 'border-stone-800'
                }`}
              >
                <div className="flex items-center gap-2 flex-1">
                  <Search className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                  <input
                    type="text"
                    aria-label="Search reusable skills"
                    placeholder="Search SKILL.md or triggers..."
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    className="w-full bg-transparent text-xs outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDisclosureTier((t) =>
                      t === 'tier0_index' ? 'tier1_full' : 'tier0_index'
                    )
                  }
                  title="Toggle between Tier-0 Compact Index (injected in base prompt) and Tier-1 Full SKILL.md (loaded on demand via skill_view)"
                  className="px-2 py-0.5 rounded-lg border border-stone-700 text-[10px] font-mono text-amber-300 hover:bg-stone-800 shrink-0"
                >
                  {disclosureTier === 'tier0_index' ? 'Tier-0 Index' : 'Tier-1 Full'}
                </button>
              </div>

              <div className="divide-y divide-stone-800/60 max-h-[540px] overflow-y-auto">
                {filteredSkills.map((sk) => {
                  const active = selectedSkill?.id === sk.id;
                  const disabled = disabledSkillIds.includes(sk.id);
                  return (
                    <button
                      key={sk.id}
                      type="button"
                      onClick={() => {
                        setSelectedSkillId(sk.id);
                        setParamInputs({});
                        setEditingSkillMd(false);
                        setPatchPanelOpen(false);
                      }}
                      className={`w-full p-3.5 text-left transition-colors space-y-1 ${
                        active
                          ? isLight
                            ? 'bg-amber-50/80'
                            : 'bg-amber-400/10'
                          : isLight
                          ? 'hover:bg-stone-50'
                          : 'hover:bg-stone-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs truncate">{sk.name}</span>
                        <span className="text-[10px] font-mono text-stone-400 shrink-0">
                          v{sk.version || 1} · {disabled ? 'Disabled' : 'Verified'} · {sk.usageCount} runs
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-400 line-clamp-1">{sk.description}</p>
                      {sk.triggers && sk.triggers.length > 0 && (
                        <div className="text-[10px] font-mono text-amber-400/80 truncate">
                          triggers: {sk.triggers.slice(0, 4).join(', ')}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Parameter Form, Hermes skill_manage(patch), & Progressive Disclosure */}
            {selectedSkill ? (
              <div
                className={`lg:col-span-7 rounded-2xl border p-5 space-y-4 ${
                  isLight ? 'bg-white border-stone-200/90' : 'bg-[#121620] border-stone-800/90'
                }`}
              >
                {/* Top Skill Header & Primary Actions */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3.5 border-b border-stone-800/70">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold">{selectedSkill.name}</h2>
                      <span className="text-[11px] font-mono text-amber-400">
                        ~/.blaize/skills/{selectedSkill.slug}/SKILL.md (v{selectedSkill.version || 1})
                      </span>
                    </div>
                    <p className="text-xs text-stone-400">{selectedSkill.description}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <label
                      title="Run in Dry-Run Sandbox mode (compiles & validates without creating artifacts or side effects)"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-stone-700 text-[11px] font-mono text-stone-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={skillDryRunMode}
                        onChange={(e) => setSkillDryRunMode(e.target.checked)}
                        className="accent-amber-400"
                      />
                      <span>Dry-Run Sandbox</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => handleRunSelectedSkill(false)}
                      disabled={isSkillDisabled}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-950 font-semibold text-xs whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{skillDryRunMode ? 'Dry-Run skill' : 'Run skill'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRunSelectedSkill(true)}
                      disabled={isSkillDisabled}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 disabled:opacity-40 text-xs font-medium whitespace-nowrap"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                      <span>Run in Chat</span>
                    </button>
                  </div>
                </div>

                {/* Generated Typed Inputs Form */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Input parameters</span>
                    <span className="text-[11px] text-stone-400 font-mono">
                      {selectedSkill.parameters.length} fields
                    </span>
                  </div>

                  {selectedSkill.parameters.length === 0 ? (
                    <div className="text-xs text-stone-400 py-2">
                      No input parameters required for this skill.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {selectedSkill.parameters.map((param) => (
                        <div key={param.name}>
                          <label className="block text-[11px] font-medium text-stone-300 mb-1">
                            {param.label}{' '}
                            <span className="font-mono text-[10px] text-stone-500">
                              ({`{{${param.name}}}`})
                            </span>
                          </label>
                          <input
                            type="text"
                            aria-label={`Parameter ${param.label}`}
                            value={paramInputs[param.name] ?? param.defaultValue}
                            onChange={(e) =>
                              setParamInputs((prev) => ({
                                ...prev,
                                [param.name]: e.target.value,
                              }))
                            }
                            className="w-full px-3 py-1.5 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none focus:border-amber-400"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Concise PolicyGuard Status + Hermes skill_manage Lifecycle Actions */}
                <div className="pt-2 border-t border-stone-800/60 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowGuardFindings((v) => !v)}
                      aria-expanded={showGuardFindings}
                      className="inline-flex items-center gap-1.5 text-emerald-400 font-medium hover:underline"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>PolicyGuard: Pass · Read &amp; artifact sandbox</span>
                      {showGuardFindings ? (
                        <ChevronDown className="w-3 h-3 text-stone-400" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-stone-400" />
                      )}
                    </button>

                    {/* Hermes skill_manage & Secondary Skill Lifecycle Actions */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setPatchPanelOpen((v) => !v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 font-medium"
                      >
                        <Wand2 className="w-3 h-3" />
                        <span>skill_manage: Patch</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDuplicateSkill}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-700/80 hover:bg-stone-800 text-stone-300"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Duplicate</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDraftSkillMd(selectedSkill.skillMarkdown);
                          setEditingSkillMd((v) => !v);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-700/80 hover:bg-stone-800 text-stone-300"
                      >
                        <FileCode2 className="w-3 h-3" />
                        <span>{editingSkillMd ? 'Close editor' : 'Edit SKILL.md'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExportSkill}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-700/80 hover:bg-stone-800 text-stone-300"
                      >
                        <Download className="w-3 h-3" />
                        <span>Export</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDisabledSkillIds((prev) =>
                            prev.includes(selectedSkill.id)
                              ? prev.filter((id) => id !== selectedSkill.id)
                              : [...prev, selectedSkill.id]
                          )
                        }
                        className="px-2 py-1 rounded-lg border border-stone-700/80 hover:bg-stone-800 text-stone-300"
                      >
                        {isSkillDisabled ? 'Enable' : 'Disable'}
                      </button>
                      {onRemoveSkill && skills.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemoveSkill(selectedSkill.id)}
                          aria-label={`Remove ${selectedSkill.name}`}
                          className="p-1 rounded-lg border border-stone-700/80 hover:bg-rose-500/20 text-stone-400 hover:text-rose-300"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {showGuardFindings && (
                    <div className="p-3 rounded-xl bg-black/30 border border-stone-800 font-mono text-[11px] text-stone-300 space-y-1">
                      <div>Static scan: 0 unguarded money calls · 0 prompt-injection overrides</div>
                      <div>
                        Triggers:{' '}
                        {(selectedSkill.triggers || [selectedSkill.slug]).join(', ')}
                      </div>
                      <div>
                        Required connectors:{' '}
                        {selectedSkill.requiredConnectors.length > 0
                          ? selectedSkill.requiredConnectors.join(', ')
                          : 'None'}
                      </div>
                    </div>
                  )}
                </div>

                {/* Hermes skill_manage(patch) Self-Improving Procedural Diff Panel */}
                {patchPanelOpen && (
                  <form
                    onSubmit={handleApplySkillPatch}
                    aria-label="Hermes skill_manage Patch Form"
                    className="p-3.5 rounded-xl border border-amber-400/40 bg-amber-400/5 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-amber-300">
                        Hermes skill_manage(action: &apos;patch&apos;) — Self-Improving Update
                      </div>
                      <span className="text-[10px] font-mono text-stone-400">
                        v{selectedSkill.version || 1} → v{(selectedSkill.version || 1) + 1}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] text-stone-300 mb-1">
                          Learned Pitfall / Edge Case Note
                        </label>
                        <input
                          type="text"
                          aria-label="Patch Pitfall Note"
                          placeholder="e.g., Verify 8-digit meter checksum before draft"
                          value={patchPitfallNote}
                          onChange={(e) => setPatchPitfallNote(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-stone-300 mb-1">
                          Append Procedure Step
                        </label>
                        <input
                          type="text"
                          aria-label="Patch Procedure Step"
                          placeholder="e.g., Emit SHA-256 receipt to ledger"
                          value={patchAppendStep}
                          onChange={(e) => setPatchAppendStep(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        aria-label="Patch Trigger Keyword"
                        placeholder="Optional new trigger keyword (e.g., tariff)"
                        value={patchAddTrigger}
                        onChange={(e) => setPatchAddTrigger(e.target.value)}
                        className="flex-1 px-2.5 py-1 rounded-lg border border-stone-700 bg-stone-900 text-xs font-mono text-stone-100 outline-none"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs whitespace-nowrap"
                      >
                        Apply Patch (v{(selectedSkill.version || 1) + 1})
                      </button>
                    </div>
                  </form>
                )}

                {/* Optional Inline SKILL.md Editor */}
                {editingSkillMd && (
                  <div className="space-y-2 pt-2 border-t border-stone-800/60">
                    <label className="block text-xs font-semibold">Edit SKILL.md Template</label>
                    <textarea
                      rows={6}
                      aria-label="Edit SKILL.md Template"
                      value={draftSkillMd}
                      onChange={(e) => setDraftSkillMd(e.target.value)}
                      className="w-full p-3 rounded-xl border border-stone-700 bg-[#0A0D14] font-mono text-xs text-amber-200 outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const res = executeSkillManage(skills, {
                              action: 'edit',
                              skillId: selectedSkill.id,
                              skillMarkdown: draftSkillMd,
                            });
                            if (onReplaceSkills) {
                              onReplaceSkills(res.skills);
                            } else if (res.targetSkill && onUpdateSkill) {
                              onUpdateSkill(res.targetSkill);
                            }
                            setEditingSkillMd(false);
                            setSkillError(null);
                            setSkillSuccessBanner(res.operationSummary);
                          } catch (err: any) {
                            setSkillError(err?.message || 'Failed to edit SKILL.md');
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-amber-400 text-stone-950 font-semibold text-xs"
                      >
                        Save SKILL.md
                      </button>
                    </div>
                  </div>
                )}

                {/* Progressive Disclosure: Compiled Prompt Preview & Patch History */}
                <div className="pt-2 border-t border-stone-800/60 space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowCompiledPrompt((v) => !v)}
                    aria-expanded={showCompiledPrompt}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-400 hover:text-stone-200"
                  >
                    {showCompiledPrompt ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {disclosureTier === 'tier0_index'
                        ? 'Tier-0 System Prompt Index Entry (1-line token-saving stub)'
                        : 'Compiled SKILL.md & skill_manage Revision History'}
                    </span>
                  </button>

                  {showCompiledPrompt && (
                    <div className="space-y-2.5">
                      <pre className="p-3.5 rounded-xl bg-[#0A0D14] border border-stone-800 font-mono text-xs text-amber-200 overflow-x-auto whitespace-pre-wrap">
                        {disclosureTier === 'tier0_index'
                          ? `- ${selectedSkill.slug} (v${selectedSkill.version || 1}, ${
                              selectedSkill.category
                            }): ${selectedSkill.description} [triggers: ${(
                              selectedSkill.triggers || [selectedSkill.slug]
                            ).join(', ')}]`
                          : compiledPreviewText}
                      </pre>
                      {selectedSkill.patchHistory && selectedSkill.patchHistory.length > 0 && (
                        <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/40 space-y-1">
                          <div className="text-[11px] font-semibold text-stone-300">
                            Procedural Memory Log (skill_manage)
                          </div>
                          {selectedSkill.patchHistory.map((ph, idx) => (
                            <div
                              key={`${ph.version}-${idx}`}
                              className="text-[11px] font-mono text-stone-400 flex items-center justify-between gap-2"
                            >
                              <span>
                                <strong className="text-amber-300">v{ph.version}</strong> ·{' '}
                                {ph.summary}
                              </span>
                              <span className="text-[10px] text-stone-500">{ph.timestamp}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="lg:col-span-7">
                <EmptyStateBlock
                  title="Select or create a skill"
                  description="Choose a reusable skill on the left to inspect its parameters and run it."
                />
              </div>
            )}
          </div>
        )}

        {/* SUB-TAB 2: SOUL IDENTITY (~/.blaize/SOUL.md · Slot #1) */}
        {activeSubTab === 'soul' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Hermes SOUL.md Voice Presets & Parsed Section Cards */}
            <div className="lg:col-span-5 space-y-4">
              <div
                className={`rounded-2xl border p-4 space-y-3 ${
                  isLight ? 'bg-white border-stone-200/90' : 'bg-[#121620] border-stone-800/90'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">SOUL.md Voice &amp; Cadence Presets</span>
                  <span className="text-[10px] font-mono text-amber-400">Slot #1 Priority</span>
                </div>
                <p className="text-[11px] text-stone-400">
                  Like Nous Hermes Agent, <code className="text-amber-300">~/.blaize/SOUL.md</code>{' '}
                  occupies Slot #1 of the system prompt and is owned by you—never silently
                  overwritten by the agent.
                </p>

                <div className="space-y-2">
                  {(Object.keys(SOUL_PRESET_TEMPLATES) as SoulVoiceCadence[]).map((cadenceKey) => {
                    const preset = SOUL_PRESET_TEMPLATES[cadenceKey];
                    const active = soulDocument.voiceCadence === cadenceKey;
                    return (
                      <button
                        key={cadenceKey}
                        type="button"
                        onClick={() => handleSelectSoulPreset(cadenceKey)}
                        className={`w-full p-3 rounded-xl border text-left transition-all space-y-1 ${
                          active
                            ? 'border-amber-400 bg-amber-400/10'
                            : isLight
                            ? 'border-stone-200 hover:bg-stone-50'
                            : 'border-stone-800 hover:bg-stone-800/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold">{preset.label}</span>
                          {active && (
                            <span className="text-[10px] font-mono text-amber-400 font-semibold">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-stone-400">{preset.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Parsed SOUL.md Section Summary */}
              <div
                className={`rounded-2xl border p-4 space-y-2.5 text-xs ${
                  isLight ? 'bg-white border-stone-200/90' : 'bg-[#121620] border-stone-800/90'
                }`}
              >
                <div className="font-bold flex items-center justify-between">
                  <span>Parsed Slot #1 Directives</span>
                  <span className="text-[10px] font-mono text-emerald-400">
                    PolicyGuard &amp; Anti-Coercion Verified
                  </span>
                </div>
                <div className="space-y-2 text-[11px]">
                  <div className="p-2.5 rounded-xl bg-stone-500/5 border border-stone-800/60">
                    <div className="font-mono text-[10px] text-amber-400 uppercase">
                      # Identity &amp; Role
                    </div>
                    <div className="text-stone-300 mt-0.5 line-clamp-2">
                      {soulDocument.parsedSections.identityAndRole}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-stone-500/5 border border-stone-800/60">
                    <div className="font-mono text-[10px] text-amber-400 uppercase">
                      # Stance &amp; Uncertainty
                    </div>
                    <div className="text-stone-300 mt-0.5 line-clamp-2">
                      {soulDocument.parsedSections.stanceAndUncertainty}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Dedicated SoulMdEditorPanel with NL Change Preview Diff, Restore Default, Import/Export & Version History */}
            <div className="lg:col-span-7">
              <SoulMdEditorPanel
                soulDocument={soulDocument}
                skills={skills}
                onUpdateSoulDocument={(nextSoul) => {
                  if (onUpdateSoulDocument) {
                    onUpdateSoulDocument(nextSoul);
                  }
                  setSkillError(null);
                  setSkillSuccessBanner(
                    `Saved ~/.blaize/SOUL.md (v${nextSoul.version} · ${SOUL_PRESET_TEMPLATES[nextSoul.voiceCadence].badge}) to Slot #1 of the System Prompt.`
                  );
                }}
                onOpenInCodeIde={onOpenPathInIde}
                uiTheme={uiTheme}
              />
            </div>
          </div>
        )}

        {/* SUB-TAB 3: PERSISTENT MEMORY (~/.blaize/memories/MEMORY.md · Slot #2) */}
        {activeSubTab === 'memory' && (
          <div className="space-y-4">
            <form
              onSubmit={handleAddMemorySubmit}
              aria-label="Add Persistent Memory Note Form"
              className={`p-4 rounded-2xl border grid grid-cols-1 sm:grid-cols-12 gap-3 items-end ${
                isLight ? 'bg-white border-stone-200/90' : 'bg-[#121620] border-stone-800/90'
              }`}
            >
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-medium text-stone-400 mb-1">
                  Category
                </label>
                <select
                  aria-label="Memory Note Category"
                  value={newMemoryCategory}
                  onChange={(e) =>
                    setNewMemoryCategory(e.target.value as MemoryEntry['category'])
                  }
                  className="w-full px-3 py-1.5 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                >
                  <option value="verified_fact">verified_fact</option>
                  <option value="user_preference">user_preference</option>
                  <option value="tool_quirk">tool_quirk</option>
                  <option value="environment">environment</option>
                </select>
              </div>
              <div className="sm:col-span-7">
                <label className="block text-[11px] font-medium text-stone-400 mb-1">
                  Persistent Cross-Session Note (~/.blaize/memories/MEMORY.md)
                </label>
                <input
                  type="text"
                  aria-label="Persistent Memory Note"
                  placeholder="e.g., Always format currency tables in integer-cent GHS columns..."
                  value={newMemoryContent}
                  onChange={(e) => setNewMemoryContent(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="w-full px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs"
                >
                  Add to MEMORY.md
                </button>
              </div>
            </form>

            <div
              className={`rounded-2xl border divide-y overflow-hidden ${
                isLight
                  ? 'bg-white border-stone-200/90 divide-stone-200'
                  : 'bg-[#121620] border-stone-800/90 divide-stone-800/70'
              }`}
            >
              {memoryEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 flex items-center justify-between gap-4 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="text-amber-400 font-semibold">[{entry.category}]</span>
                      <span className="text-stone-400">
                        source: {entry.source} · {entry.updatedAt}
                      </span>
                    </div>
                    <p className="text-stone-200">{entry.content}</p>
                  </div>
                  {onRemoveMemoryEntry && (
                    <button
                      type="button"
                      aria-label={`Delete memory ${entry.id}`}
                      onClick={() => onRemoveMemoryEntry(entry.id)}
                      className="p-1.5 rounded-lg border border-stone-700/80 hover:bg-rose-500/20 text-stone-400 hover:text-rose-300 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SUB-TAB 4: HERMES 4-SLOT SYSTEM PROMPT INSPECTOR */}
        {activeSubTab === 'prompt_slots' && (
          <div className="space-y-4">
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-white border-stone-200/90' : 'bg-[#121620] border-stone-800/90'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold">
                    Live Hermes 4-Slot System Prompt Assembly (~{assembledPrompt.estimatedTokens}{' '}
                    tokens)
                  </h2>
                  <p className="text-xs text-stone-400">
                    Test how a user prompt triggers on-demand <code className="text-amber-300">skill_view</code>{' '}
                    loading in Slot #4 while keeping Slot #1 <code className="text-amber-300">SOUL.md</code>{' '}
                    authoritative.
                  </p>
                </div>
                <span className="text-xs font-mono text-emerald-400">
                  {assembledPrompt.activeSkillBodies.length} full SKILL.md loaded on demand
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-400 mb-1">
                  Simulate User Prompt for Slot #4 Progressive Skill Matching:
                </label>
                <input
                  type="text"
                  aria-label="Simulate Prompt for Skill Matching"
                  value={testMatcherPrompt}
                  onChange={(e) => setTestMatcherPrompt(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-xs">
                {[
                  {
                    slot: 'Slot #1',
                    title: '~/.blaize/SOUL.md',
                    meta: `v${soulDocument.version} · ${SOUL_PRESET_TEMPLATES[soulDocument.voiceCadence].badge}`,
                  },
                  {
                    slot: 'Slot #2',
                    title: '~/.blaize/memories/MEMORY.md',
                    meta: `${memoryEntries.length} persistent facts`,
                  },
                  {
                    slot: 'Slot #3',
                    title: 'Project AGENTS.md',
                    meta: activeProject.name,
                  },
                  {
                    slot: 'Slot #4',
                    title: 'Progressive SKILL.md Index',
                    meta: `${skills.length} indexed · ${assembledPrompt.activeSkillBodies.length} loaded`,
                  },
                ].map((item) => (
                  <div
                    key={item.slot}
                    className="p-3 rounded-xl border border-stone-800 bg-stone-950/60 space-y-0.5"
                  >
                    <div className="text-[10px] font-mono text-amber-400 uppercase">
                      {item.slot}
                    </div>
                    <div className="font-semibold text-stone-100 truncate">{item.title}</div>
                    <div className="text-[11px] text-stone-400 truncate">{item.meta}</div>
                  </div>
                ))}
              </div>

              <pre className="p-4 rounded-xl bg-[#0A0D14] border border-stone-800 font-mono text-xs text-amber-200 overflow-x-auto whitespace-pre-wrap max-h-[420px]">
                {assembledPrompt.fullSystemPrompt}
              </pre>
            </div>
          </div>
        )}

        {/* Progressive Disclosure Drawer: Create Reusable Skill via skill_manage(create) */}
        <SlideOverDrawer
          open={skillBuilderOpen}
          title="skill_manage: Create Procedural Skill (SKILL.md)"
          subtitle="Crystallizes a reusable procedure into ~/.blaize/skills/<slug>/SKILL.md"
          onClose={() => setSkillBuilderOpen(false)}
          uiTheme={uiTheme}
          footer={
            <>
              <button
                type="button"
                onClick={() => setSkillBuilderOpen(false)}
                className="px-3.5 py-1.5 rounded-xl border border-stone-700 text-xs text-stone-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="create-skill-form"
                className="px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs"
              >
                Compile &amp; save SKILL.md
              </button>
            </>
          }
        >
          <form
            id="create-skill-form"
            aria-label="Create Reusable Skill Form"
            onSubmit={handleCreateCustomSkill}
            className="space-y-4"
          >
            <div>
              <label className="block font-semibold mb-1">Skill Name *</label>
              <input
                type="text"
                aria-label="New Skill Name"
                placeholder="e.g., Weekly KPI Report Compiler"
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Category</label>
                <select
                  aria-label="New Skill Category"
                  value={newSkillCategory}
                  onChange={(e) =>
                    setNewSkillCategory(e.target.value as ReusableSkill['category'])
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none"
                >
                  <option value="automation">Automation</option>
                  <option value="financial">Financial</option>
                  <option value="engineering">Engineering</option>
                  <option value="research">Research</option>
                  <option value="creative">Creative</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Parameters (comma-separated)</label>
                <input
                  type="text"
                  aria-label="New Skill Parameters"
                  value={newSkillParams}
                  onChange={(e) => setNewSkillParams(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 font-mono outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1">
                Progressive-Disclosure Triggers (comma-separated)
              </label>
              <input
                type="text"
                aria-label="New Skill Triggers"
                value={newSkillTriggers}
                onChange={(e) => setNewSkillTriggers(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-amber-300 font-mono outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">One-line Purpose (Tier-0 Index)</label>
              <input
                type="text"
                aria-label="New Skill Description"
                placeholder="What this reusable skill accomplishes..."
                value={newSkillDesc}
                onChange={(e) => setNewSkillDesc(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">SKILL.md Template (Tier-1 Body)</label>
              <textarea
                rows={5}
                aria-label="SKILL.md Instructions"
                value={newSkillMd}
                onChange={(e) => setNewSkillMd(e.target.value)}
                className="w-full p-3 rounded-xl border border-stone-700 bg-stone-950 font-mono text-xs text-amber-200 outline-none"
              />
            </div>
          </form>
        </SlideOverDrawer>
      </div>
    );
  }

  // ==========================================================================
  // VIEW B: CONNECTORS
  // ==========================================================================
  if (mode === 'connectors') {
    const getConnectorDisplayStatus = (conn: WorkspaceConnector) => {
      if (conn.status !== 'connected') {
        return { label: 'Disconnected', tone: 'text-stone-400' };
      }
      if (
        conn.category === 'Finance Sandbox' ||
        conn.endpointSummary.includes('.local') ||
        conn.endpointSummary.includes('.internal')
      ) {
        return { label: 'Simulated Sandbox', tone: 'text-amber-300' };
      }
      return { label: 'Connected', tone: 'text-emerald-400' };
    };

    const renderConnectorIcon = (conn: WorkspaceConnector) => {
      if (conn.category === 'Code & Git') return <GitBranch className="w-4 h-4 text-sky-400" />;
      if (conn.category === 'Database') return <Database className="w-4 h-4 text-purple-400" />;
      if (conn.category === 'Finance Sandbox')
        return <Landmark className="w-4 h-4 text-amber-400" />;
      return <Plug className="w-4 h-4 text-emerald-400" />;
    };

    return (
      <div className="p-5 sm:p-7 max-w-6xl mx-auto space-y-5">
        <PageHeader
          title="Connectors"
          subtitle="Service integrations with project-scoped bindings and PolicyGuard write gates."
          metaText={`Active project: ${activeProject.name}`}
          uiTheme={uiTheme}
        />

        {connectorBanner && (
          <div
            data-testid="connector-sandbox-banner"
            className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{connectorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setConnectorBanner(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        <div
          className={`rounded-2xl border divide-y overflow-hidden ${
            isLight
              ? 'bg-white border-stone-200/90 divide-stone-200/80'
              : 'bg-[#121620] border-stone-800/90 divide-stone-800/70'
          }`}
        >
          {connectors.map((conn) => {
            const isConnected = conn.status === 'connected';
            const isBoundToProject = conn.boundProjectIds.includes(activeProject.id);
            const stateInfo = getConnectorDisplayStatus(conn);

            return (
              <div
                key={conn.id}
                className="p-4 flex flex-wrap items-center justify-between gap-4 transition-colors hover:bg-stone-500/5"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div
                    className={`p-2.5 rounded-xl border shrink-0 mt-0.5 ${
                      isLight ? 'bg-stone-100 border-stone-200' : 'bg-stone-900 border-stone-800'
                    }`}
                  >
                    {renderConnectorIcon(conn)}
                  </div>

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm">{conn.name}</span>
                      <span className="text-xs font-mono text-stone-400">
                        <span className={stateInfo.tone}>{stateInfo.label}</span>
                        {' · '}
                        {isBoundToProject ? `Bound to ${activeProject.name}` : 'Unbound'}
                        {' · '}
                        {conn.writeRequiresApproval ? 'Writes require approval' : 'Read-only'}
                      </span>
                    </div>
                    <p className="text-xs text-stone-400 line-clamp-1">{conn.description}</p>
                  </div>
                </div>

                {/* Compact Primary & Secondary Controls */}
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  <button
                    type="button"
                    data-testid={`connector-test-read-${conn.id}`}
                    onClick={() => {
                      const res = testConnectorReadSandbox(conn, activeProject.id);
                      setConnectorBanner(
                        `${res.summary} · Receipt: ${res.evidenceHash}`
                      );
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-amber-300 font-mono text-[11px] whitespace-nowrap"
                  >
                    <Play className="w-3 h-3" />
                    <span>Test Read</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleConnectorProjectBind(conn.id, activeProject.id)}
                    className={`px-2.5 py-1.5 rounded-xl border font-medium transition-colors whitespace-nowrap ${
                      isBoundToProject
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-stone-700 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {isBoundToProject ? `Bound to ${activeProject.name}` : 'Bind to project'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfiguredConnectorId(conn.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-stone-200 font-medium whitespace-nowrap"
                  >
                    <Settings2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Configure</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleConnectorStatus(conn.id)}
                    className={`px-3 py-1.5 rounded-xl font-semibold transition-colors whitespace-nowrap ${
                      isConnected
                        ? 'border border-stone-700 text-stone-300 hover:bg-stone-800'
                        : 'bg-amber-400 text-stone-950 hover:bg-amber-300'
                    }`}
                  >
                    {isConnected ? 'Disconnect' : 'Connect'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Connector Details & Scopes Drawer */}
        <SlideOverDrawer
          open={Boolean(configuredConnector)}
          title={configuredConnector?.name || 'Connector Configuration'}
          subtitle={configuredConnector?.endpointSummary}
          onClose={() => setConfiguredConnectorId(null)}
          uiTheme={uiTheme}
          footer={
            <button
              type="button"
              onClick={() => setConfiguredConnectorId(null)}
              className="px-4 py-1.5 rounded-xl bg-amber-400 text-stone-950 font-semibold text-xs"
            >
              Done
            </button>
          }
        >
          {configuredConnector && (
            <div className="space-y-5">
              <div>
                <div className="font-semibold text-stone-200 mb-1">Connection Mode</div>
                <p className="text-stone-400">
                  {getConnectorDisplayStatus(configuredConnector).label} · Last synced{' '}
                  {configuredConnector.lastSyncAt}
                </p>
              </div>

              {/* Project Binding Checkboxes */}
              <div className="space-y-2">
                <div className="font-semibold text-stone-200">Project Access Binding</div>
                <p className="text-stone-400 text-[11px]">
                  Select which projects are permitted to query this connector:
                </p>
                <div className="space-y-1.5">
                  {projects.map((proj) => {
                    const bound = configuredConnector.boundProjectIds.includes(proj.id);
                    return (
                      <label
                        key={proj.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-stone-800 bg-stone-900/50 cursor-pointer"
                      >
                        <span className="font-medium">{proj.name}</span>
                        <input
                          type="checkbox"
                          checked={bound}
                          onChange={() =>
                            onToggleConnectorProjectBind(configuredConnector.id, proj.id)
                          }
                          className="accent-amber-400"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Exact Granted Scopes */}
              <div className="space-y-2">
                <div className="font-semibold text-stone-200">Granted Scopes</div>
                <div className="space-y-1.5 font-mono text-[11px]">
                  {configuredConnector.scopes.map((sc) => (
                    <div
                      key={sc}
                      className="px-3 py-1.5 rounded-lg border border-stone-800 bg-stone-950 text-amber-300 flex items-center justify-between"
                    >
                      <span>{sc}</span>
                      <span className="text-emerald-400">Active</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Write Gate & Approval Control */}
              <div className="p-3.5 rounded-xl border border-stone-800 bg-stone-900/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                    <span>Write &amp; Mutation Policy Gate</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleConnectorWriteApproval(configuredConnector.id)}
                    className="px-3 py-1 rounded-lg bg-amber-400/15 border border-amber-400/40 text-amber-300 font-mono text-[11px]"
                  >
                    {configuredConnector.writeRequiresApproval
                      ? 'Writes: Require Human Approval'
                      : 'Writes: Strictly Read-Only'}
                  </button>
                </div>
                <p className="text-[11px] text-stone-400">
                  PolicyGuard intercepts any mutation or draft call on this connector and requires
                  your confirmation before execution.
                </p>
              </div>
            </div>
          )}
        </SlideOverDrawer>
      </div>
    );
  }

  // ==========================================================================
  // VIEW C: SCHEDULER
  // ==========================================================================
  return (
    <div className="p-5 sm:p-7 max-w-6xl mx-auto space-y-5">
      <PageHeader
        title="Scheduler"
        subtitle="Recurring autonomous tasks with local-time previews. Unattended money transfers are blocked by PolicyGuard."
        metaText={`${schedules.filter((s) => s.enabled).length} active · ${activeProject.name}`}
        uiTheme={uiTheme}
        actions={
          <button
            type="button"
            onClick={() => {
              setWizardStep(1);
              setScheduleDrawerOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New schedule</span>
          </button>
        }
      />

      {schedBanner && (
        <div className="p-3 rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{schedBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSchedBanner(null)}
            className="text-[11px] underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Compact Quick Create Bar (plus 4-step wizard in drawer) */}
      <form
        onSubmit={handleCreateScheduleSubmit}
        aria-label="Create Scheduled Task Form"
        className={`p-4 rounded-2xl border grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end ${
          isLight ? 'bg-white border-stone-200/90' : 'bg-[#121620] border-stone-800/90'
        }`}
      >
        <div className="sm:col-span-3">
          <label className="block text-[11px] font-medium text-stone-400 mb-1">Job Title *</label>
          <input
            type="text"
            aria-label="Schedule Job Title"
            placeholder="e.g., Morning Statement Digest"
            value={newSchedTitle}
            onChange={(e) => setNewSchedTitle(e.target.value)}
            className="w-full px-3 py-1.5 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium text-stone-400 mb-1">When</label>
          <input
            type="text"
            aria-label="Natural Schedule"
            value={newSchedNatural}
            onChange={(e) => setNewSchedNatural(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium text-stone-400 mb-1">Cron (UTC)</label>
          <input
            type="text"
            aria-label="Cron Expression"
            value={newSchedCron}
            onChange={(e) => setNewSchedCron(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-stone-700 bg-stone-900/90 text-xs font-mono text-amber-300 outline-none"
          />
        </div>
        <div className="sm:col-span-3">
          <label className="block text-[11px] font-medium text-stone-400 mb-1">
            Mission Prompt / Skill *
          </label>
          <input
            type="text"
            aria-label="Scheduled Mission Prompt"
            placeholder="What should happen?"
            value={newSchedPrompt}
            onChange={(e) => setNewSchedPrompt(e.target.value)}
            className="w-full px-3 py-1.5 rounded-xl border border-stone-700 bg-stone-900/90 text-xs text-stone-100 outline-none"
          />
        </div>
        <div className="sm:col-span-2 flex justify-end">
          <button
            type="submit"
            className="w-full px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs whitespace-nowrap"
          >
            Compile &amp; Schedule Job
          </button>
        </div>
      </form>

      {/* Compact Schedule Table with Progressive Disclosure for Next-5-Runs UTC */}
      <div
        className={`rounded-2xl border divide-y overflow-hidden ${
          isLight
            ? 'bg-white border-stone-200/90 divide-stone-200/80'
            : 'bg-[#121620] border-stone-800/90 divide-stone-800/70'
        }`}
      >
        {schedules.map((job) => {
          const isExpanded = expandedScheduleId === job.id;
          const nextRunFormatted = formatScheduleRunLocal(job.nextFiveRuns[0] || '');
          const isBlocked = job.lastRunStatus === 'blocked_by_guard';

          return (
            <div key={job.id} className="p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedScheduleId((prev) => (prev === job.id ? null : job.id))
                      }
                      aria-expanded={isExpanded}
                      className="font-bold text-sm hover:text-amber-300 text-left inline-flex items-center gap-1.5"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
                      )}
                      <span>{job.title}</span>
                    </button>

                    <span className="text-xs font-mono text-stone-400">
                      {job.naturalSchedule} · Next: {nextRunFormatted.localLabel} ·{' '}
                      <span
                        className={
                          isBlocked
                            ? 'text-rose-400 font-semibold'
                            : job.enabled
                            ? 'text-emerald-400'
                            : 'text-stone-500'
                        }
                      >
                        {isBlocked ? 'Blocked by Guard' : job.enabled ? 'Active' : 'Paused'}
                      </span>
                    </span>
                  </div>

                  <p className="text-xs text-stone-400 pl-5 line-clamp-1">{job.actionPrompt}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      onRunScheduleNow(job);
                      setSchedBanner(
                        `Executed "${job.title}" and logged receipt to Trust Ledger.`
                      );
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 font-semibold whitespace-nowrap"
                  >
                    <Play className="w-3 h-3" />
                    <span>Run Now</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleScheduleEnabled(job.id)}
                    className={`px-3 py-1.5 rounded-xl border font-medium whitespace-nowrap ${
                      job.enabled
                        ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                        : 'border-stone-700 text-stone-400'
                    }`}
                  >
                    {job.enabled ? 'Active' : 'Paused'}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedScheduleId((prev) => (prev === job.id ? null : job.id))
                    }
                    className="px-2.5 py-1.5 rounded-xl border border-stone-700/80 hover:bg-stone-800 text-stone-300"
                  >
                    {isExpanded ? 'Hide runs' : 'Next 5 runs'}
                  </button>
                </div>
              </div>

              {/* Expanded Deterministic Next-5-Runs UTC & PolicyGuard Details */}
              {isExpanded && (
                <div className="pl-5 pt-2 border-t border-stone-800/60 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-stone-400">
                      Cron: <strong className="text-amber-300">{job.cronExpression}</strong> ·
                      Timezone: {job.timezone} · Offline Policy:{' '}
                      <strong className="text-sky-300">
                        {job.offlineMissedRunPolicy === 'skip'
                          ? 'Skip missed run'
                          : job.offlineMissedRunPolicy === 'ask'
                          ? 'Ask before running'
                          : 'Run once when available'}
                      </strong>
                    </span>
                    <span
                      className={`font-mono text-[11px] ${
                        isBlocked ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {job.guardNote}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-[11px] text-stone-400">Deterministic Next 5 Runs (UTC):</span>
                    {job.nextFiveRuns.map((r) => (
                      <span
                        key={r}
                        className="px-2 py-0.5 rounded bg-stone-900 border border-stone-800 font-mono text-[10px] text-stone-300 tabular-nums"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 4-Step Schedule Creation Drawer */}
      <SlideOverDrawer
        open={scheduleDrawerOpen}
        title="Schedule Recurring Job"
        subtitle={`Step ${wizardStep} of 4 · PolicyGuard validated`}
        onClose={() => setScheduleDrawerOpen(false)}
        uiTheme={uiTheme}
        footer={
          <div className="flex items-center justify-between w-full">
            <button
              type="button"
              onClick={() =>
                wizardStep > 1
                  ? setWizardStep((s) => (s - 1) as 1 | 2 | 3 | 4)
                  : setScheduleDrawerOpen(false)
              }
              className="px-3.5 py-1.5 rounded-xl border border-stone-700 text-xs text-stone-300"
            >
              {wizardStep > 1 ? 'Back' : 'Cancel'}
            </button>

            {wizardStep < 4 ? (
              <button
                type="button"
                onClick={() => setWizardStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
                className="px-4 py-1.5 rounded-xl bg-amber-400 text-stone-950 font-semibold text-xs"
              >
                Next step →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCreateScheduleSubmit}
                className="px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs"
              >
                Save schedule
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {/* Step Indicator */}
          <div className="grid grid-cols-4 gap-1.5 text-[10px] font-mono">
            {[
              { step: 1, label: '1. What' },
              { step: 2, label: '2. When' },
              { step: 3, label: '3. Scope' },
              { step: 4, label: '4. Review' },
            ].map((item) => (
              <button
                key={item.step}
                type="button"
                onClick={() => setWizardStep(item.step as 1 | 2 | 3 | 4)}
                className={`py-1.5 px-2 rounded-lg border text-center ${
                  wizardStep === item.step
                    ? 'border-amber-400 bg-amber-400/15 text-amber-300 font-bold'
                    : 'border-stone-800 text-stone-400'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {wizardStep === 1 && (
            <div className="space-y-3">
              <div className="font-semibold text-sm">1. What should happen?</div>
              <div>
                <label className="block font-medium mb-1">Job Title *</label>
                <input
                  type="text"
                  value={newSchedTitle}
                  onChange={(e) => setNewSchedTitle(e.target.value)}
                  placeholder="e.g., Weekly Statement Reconciliation"
                  className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Mission Prompt / Action *</label>
                <textarea
                  rows={3}
                  value={newSchedPrompt}
                  onChange={(e) => setNewSchedPrompt(e.target.value)}
                  placeholder="Describe the verification or report task to run..."
                  className="w-full p-3 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Optional Linked Skill</label>
                <select
                  value={newSchedSkillId}
                  onChange={(e) => setNewSchedSkillId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                >
                  <option value="">None (Prompt only)</option>
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3">
              <div className="font-semibold text-sm">2. When should it happen?</div>
              <div>
                <label className="block font-medium mb-1">Natural Recurrence</label>
                <input
                  type="text"
                  value={newSchedNatural}
                  onChange={(e) => setNewSchedNatural(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Cron Expression</label>
                  <input
                    type="text"
                    value={newSchedCron}
                    onChange={(e) => setNewSchedCron(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 font-mono text-xs text-amber-300 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Time Zone</label>
                  <select
                    value={newSchedTimezone}
                    onChange={(e) => setNewSchedTimezone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                  >
                    <option value="UTC">UTC</option>
                    <option value="Africa/Accra">Africa/Accra (GMT)</option>
                    <option value="America/New_York">America/New_York (EST)</option>
                    <option value="Europe/London">Europe/London (BST)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-3">
              <div className="font-semibold text-sm">3. Which project &amp; rules apply?</div>
              <div>
                <label className="block font-medium mb-1">Target Workspace Project</label>
                <select
                  value={newSchedProjectId}
                  onChange={(e) => setNewSchedProjectId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">
                  If Blaize is offline or asleep at run time
                </label>
                <select
                  aria-label="Offline Missed Run Policy"
                  value={newSchedOfflinePolicy}
                  onChange={(e) =>
                    setNewSchedOfflinePolicy(e.target.value as OfflineMissedRunPolicy)
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 outline-none"
                >
                  <option value="run_once_on_wake">Run once when available</option>
                  <option value="skip">Skip missed run</option>
                  <option value="ask">Ask before running</option>
                </select>
              </div>
              <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50 space-y-1">
                <div className="font-semibold text-stone-200">Permissions &amp; Failure Behaviour</div>
                <p className="text-stone-400 text-[11px]">
                  Runs in a read/draft sandbox with idempotency keys. On failure or policy block,
                  execution halts immediately and logs to the Trust Ledger.
                </p>
              </div>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-3">
              <div className="font-semibold text-sm">4. Review and save</div>
              <div className="p-3.5 rounded-xl border border-stone-800 bg-stone-900/60 space-y-2">
                <div>
                  <span className="text-stone-400">Title:</span>{' '}
                  <strong>{previewScheduleDraft.title}</strong>
                </div>
                <div>
                  <span className="text-stone-400">Recurrence:</span>{' '}
                  <span className="font-mono text-amber-300">
                    {previewScheduleDraft.cronExpression} ({previewScheduleDraft.timezone})
                  </span>
                </div>
                <div>
                  <span className="text-stone-400">Next run:</span>{' '}
                  <span className="font-mono">{previewScheduleDraft.nextFiveRuns[0]}</span>
                </div>
                <div>
                  <span className="text-stone-400">Policy check:</span>{' '}
                  <span
                    className={
                      previewScheduleDraft.lastRunStatus === 'blocked_by_guard'
                        ? 'text-rose-400 font-semibold'
                        : 'text-emerald-400 font-semibold'
                    }
                  >
                    {previewScheduleDraft.guardNote}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </SlideOverDrawer>
    </div>
  );
};

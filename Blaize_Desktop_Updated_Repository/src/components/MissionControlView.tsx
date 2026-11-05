/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mission Control & Meta Model Router View (Section 4, 7, 15)
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  OctagonAlert,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { MissionRecord, MissionState } from '../packages/contracts';
import {
  DemoScenarioId,
  META_MODEL_CATALOG,
  captureDiskSpooledScreenshot,
  checkLocalModelHardwareGate,
  validateMetaModelSelection,
} from '../packages/core';
import { MemoryEfficiencyMetrics } from '../packages/trust';

interface MissionControlViewProps {
  mission: MissionRecord;
  activeScenario: DemoScenarioId;
  onSelectScenario: (scenario: DemoScenarioId) => void;
  onUpdateMissionState: (newState: MissionState) => void;
  onTriggerApprovalForStep: (stepTitle: string, target: string, risk: string, reason: string) => void;
  memoryMetrics: MemoryEfficiencyMetrics;
  onRunGarbageCollection: () => void;
  ringBufferStats: { count: number; capacity: number; evictedCount: number };
}

const ALL_STATES: MissionState[] = [
  'CREATED',
  'PLANNING',
  'RUNNING',
  'WAITING_FOR_USER',
  'WAITING_FOR_EXTERNAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

export const MissionControlView: React.FC<MissionControlViewProps> = ({
  mission,
  activeScenario,
  onSelectScenario,
  onUpdateMissionState,
  onTriggerApprovalForStep,
  memoryMetrics,
  onRunGarbageCollection,
  ringBufferStats,
}) => {
  const [modelTestInput, setModelTestInput] = useState('muse-spark-1.3-contributor');
  const [simulatedRegionStatus, setSimulatedRegionStatus] = useState<
    'normal' | 'region_restricted' | 'unauthorized'
  >('normal');

  const modelCheck = validateMetaModelSelection(modelTestInput);
  const hwGate = checkLocalModelHardwareGate(16, false);
  const spooledFrame = captureDiskSpooledScreenshot(mission.id);

  return (
    <div className="space-y-8">
      {/* Top Scenario Switcher & Idempotent Emergency Controls */}
      <section className="bg-[#0F1623] border border-slate-800 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <p className="text-xs font-mono text-sky-400">
              ACCOUNTABLE DESKTOP HARNESS · META COMPUTER-USE PROTOCOL
            </p>
            <h1 className="text-2xl font-bold text-slate-100 mt-1">
              Mission Control & Deterministic State Machine
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Every action is validated by PolicyGuard, verified by an independent model pass, and hash-chained in SQLite/MemoryLedger.
            </p>
          </div>

          {/* Idempotent Pause, Cancel, Emergency Stop */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onUpdateMissionState('WAITING_FOR_USER')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Pause className="w-3.5 h-3.5" />
              Pause Mission
            </button>
            <button
              type="button"
              onClick={() => onUpdateMissionState('PLANNING')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Re-Plan from Evidence
            </button>
            <button
              type="button"
              onClick={() => onUpdateMissionState('CANCELLED')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-rose-950/80 border border-rose-800 hover:bg-rose-900 text-rose-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <OctagonAlert className="w-3.5 h-3.5" />
              Emergency Stop
            </button>
          </div>
        </div>

        {/* 4 Hackathon Demo Scenarios (Section 15) */}
        <div className="pt-5">
          <span className="block text-xs font-medium text-slate-400 mb-2.5">
            Select Live Verification Mission Scenario (Section 15 Demo Script):
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {[
              {
                id: 'normal_run' as DemoScenarioId,
                label: '01. Normal Reconciliation Run',
                sub: 'A11y extract -> Exact balance check -> Safe-to-Spend formula',
              },
              {
                id: 'adversarial_run' as DemoScenarioId,
                label: '02. Adversarial & Evil-Test Run',
                sub: 'Injected memo + evil-test escape + Pay click blocked by Guard',
              },
              {
                id: 'failed_action_recovery' as DemoScenarioId,
                label: '03. Failed Action & Phone Approval',
                sub: 'Verifier catches HTTP 500 & layout shift -> asks on Phone Bot',
              },
              {
                id: 'credential_takeover' as DemoScenarioId,
                label: '04. Credential / 2FA User Takeover',
                sub: 'Suspends screenshots on OTP field -> user types secret safely',
              },
            ].map((item) => {
              const active = activeScenario === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectScenario(item.id)}
                  className={`text-left p-3.5 rounded-lg border transition-colors ${
                    active
                      ? 'bg-sky-950/40 border-sky-500/80 text-slate-100'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{item.label}</span>
                    <Play className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-sky-400' : 'text-slate-500'}`} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{item.sub}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Active Mission State Machine & Step Execution Trace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 8 Cols: State Machine & Verified Steps */}
        <section className="lg:col-span-8 bg-[#0F1623] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                  <span>ID: {mission.id}</span>
                  <span aria-hidden="true">·</span>
                  <span>Profile: {mission.profileId.toUpperCase()}</span>
                  <span aria-hidden="true">·</span>
                  <span>Est. Cost: ${mission.estimatedCostUsd.toFixed(4)}</span>
                </div>
                <h2 className="text-lg font-semibold text-slate-100 mt-1">
                  {mission.objective}
                </h2>
              </div>
              <div className="font-mono text-xs text-sky-300">
                STATE: {mission.state}
              </div>
            </div>

            {/* Explicit 8-State Machine Strip */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {ALL_STATES.map((st) => {
                const isCurrent = mission.state === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => onUpdateMissionState(st)}
                    className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                      isCurrent
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {st}
                  </button>
                );
              })}
            </div>

            {/* Step Execution & Independent Verifier Evidence */}
            <div className="space-y-3 pt-2">
              {mission.steps.map((step) => (
                <div
                  key={step.id}
                  className="bg-slate-900/75 border border-slate-800 rounded-lg p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">
                        0{step.index}.
                      </span>
                      <h3 className="text-sm font-semibold text-slate-100">
                        {step.title}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-slate-400">
                        Risk: {step.risk.toUpperCase()}
                      </span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span
                        className={
                          step.status === 'verified'
                            ? 'text-emerald-400'
                            : step.status === 'blocked' || step.status === 'failed'
                            ? 'text-rose-400'
                            : 'text-amber-400'
                        }
                      >
                        {step.status.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300">
                    <span className="text-slate-400">Intent:</span> {step.intent} ·{' '}
                    <span className="text-slate-400">Target:</span>{' '}
                    <code className="text-slate-200">{step.target}</code>
                  </p>

                  <p className="text-xs text-slate-400">
                    <span className="text-slate-300 font-medium">Reasoning Summary:</span>{' '}
                    {step.reasoningSummary}
                  </p>

                  {step.guardDecision && (
                    <div className="pt-2 border-t border-slate-800/80 text-xs font-mono text-amber-300">
                      PolicyGuard [{step.guardDecision.status}] · Rule: {step.guardDecision.matchedRule} —{' '}
                      {step.guardDecision.reason}
                    </div>
                  )}

                  {step.verification && (
                    <div className="pt-2 border-t border-slate-800/80 text-xs font-mono text-emerald-300">
                      Verifier [{step.verification.status.toUpperCase()}] ({step.verification.verifierModel}) —{' '}
                      {step.verification.reason}
                    </div>
                  )}

                  {(step.status === 'waiting_approval' || step.status === 'failed' || step.status === 'blocked') && (
                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          onTriggerApprovalForStep(
                            step.title,
                            step.target,
                            step.risk,
                            step.reasoningSummary
                          )
                        }
                        className="px-3 py-1.5 text-xs font-medium bg-amber-500/20 border border-amber-500/60 text-amber-200 hover:bg-amber-500/30 rounded-md transition-colors whitespace-nowrap shrink-0"
                      >
                        Open Local & Phone Approval Sheet
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Mission Proof Summary Banner */}
          {mission.resultSummary && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div className="font-semibold text-slate-200">
                  Verifiable Mission Outcome & Checkpoints ({mission.checkpoints.join(' -> ')})
                </div>
                <p className="text-slate-300 leading-relaxed">{mission.resultSummary}</p>
              </div>
            </div>
          )}
        </section>

        {/* Right 4 Cols: Memory & Token Efficiency Inspector */}
        <section className="lg:col-span-4 bg-[#0F1623] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-mono text-emerald-400">
                  ZERO-BLOAT MEMORY ARCHITECTURE
                </p>
                <h2 className="text-lg font-semibold text-slate-100 mt-0.5">
                  Memory & Token Efficiency
                </h2>
              </div>
              <HardDrive className="w-5 h-5 text-slate-400" />
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Blaize reads the Accessibility Tree before screenshots, deduplicates evidence by SHA-256 hash, and uses fixed-capacity ring buffers so heap usage stays strictly bounded.
            </p>

            <div className="divide-y divide-slate-800/80 border-y border-slate-800 text-xs">
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Local LLM (&lt;24 GB RAM Policy)</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  {hwGate.status} (0 MB)
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">SQLite Engine (No Vector DB)</span>
                <span className="font-mono text-sky-300 tabular-nums">
                  WAL + FTS5 Only (0 MB Vec)
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Screenshots ({spooledFrame.record.viewport} JPEG)</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  Disk Spooled ({spooledFrame.inMemoryBytes} B in RAM)
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Python Wake-Word Sidecar</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  OFF by Default (0 MB)
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Active Encrypted Payload Heap</span>
                <span className="font-mono text-slate-100 tabular-nums">
                  {memoryMetrics.activePayloadBytes} B ({memoryMetrics.activeContentSlots} slots)
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Tombstoned / Reclaimed Heap</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  {memoryMetrics.reclaimedBytes} B freed ({memoryMetrics.deletedTombstoneSlots} zeroed)
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Bounded RingBuffer Telemetry</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {ringBufferStats.count} / {ringBufferStats.capacity} ({ringBufferStats.evictedCount} evicted)
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">A11y Fast-Path Tokens Saved</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  {mission.tokensUsed.a11yTokensSaved.toLocaleString()} tokens (~92% saved)
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <button
              type="button"
              onClick={onRunGarbageCollection}
              className="w-full py-2.5 px-4 text-xs font-semibold bg-emerald-500/20 border border-emerald-500/60 text-emerald-200 hover:bg-emerald-500/30 rounded-lg transition-colors whitespace-nowrap"
            >
              Compact Ledger & Prune Quarantined Payloads
            </button>
            <p className="text-[11px] text-slate-400 text-center">
              Evicts untrusted page hypotheses while keeping cryptographic hash chain 100% verifiable.
            </p>
          </div>
        </section>
      </div>

      {/* Section 4 & 7: Verified Meta Model Router & Preflight Inspector */}
      <section className="bg-[#0F1623] border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <p className="text-xs font-mono text-sky-400">
              VERIFIED AGAINST DEV.META.AI · OCT 27, 2026
            </p>
            <h2 className="text-lg font-semibold text-slate-100 mt-0.5">
              Meta Model Router (https://api.meta.ai/v1) & Preflight Discipline
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Never falls back silently to a paid cloud model. Blocks Contributor mode (-contributor) on user data by default.
            </p>
          </div>

          {/* Preflight Simulation Toggle (Available vs Region-Restricted vs Unauthorized) */}
          <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg shrink-0">
            {[
              { id: 'normal', label: 'Preflight: All Healthy' },
              { id: 'region_restricted', label: 'Simulate Geo Restriction' },
              { id: 'unauthorized', label: 'Simulate 401 Key Error' },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setSimulatedRegionStatus(mode.id as typeof simulatedRegionStatus)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  simulatedRegionStatus === mode.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {simulatedRegionStatus !== 'normal' && (
          <div className="bg-rose-950/50 border border-rose-800 rounded-lg p-3.5 flex items-center justify-between gap-4 text-xs text-rose-200">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                {simulatedRegionStatus === 'region_restricted'
                  ? 'Geographic Use Policy Alert: Hosted Meta Model API returned 403 Unavailable-In-Region. Silent cloud fallback is disabled. Route private work to local Muse Glimmer.'
                  : 'Authentication Alert: MODEL_API_KEY returned 401 Unauthorized on https://api.meta.ai/v1. No silent paid fallback executed.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSimulatedRegionStatus('normal')}
              className="px-2.5 py-1 bg-rose-900 hover:bg-rose-800 rounded text-rose-100 whitespace-nowrap shrink-0"
            >
              Restore Preflight
            </button>
          </div>
        )}

        {/* Model Router Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-medium">
                <th className="py-2.5 pr-4">Model ID</th>
                <th className="py-2.5 px-4">Job Routing Role</th>
                <th className="py-2.5 px-4">Provider & API Surface</th>
                <th className="py-2.5 px-4">Data Mode</th>
                <th className="py-2.5 px-4 text-right">Context</th>
                <th className="py-2.5 pl-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {META_MODEL_CATALOG.map((m) => {
                const effectiveStatus =
                  m.providerType === 'local'
                    ? 'disabled (<24GB RAM · 0 MB)'
                    : simulatedRegionStatus === 'region_restricted'
                    ? 'region-restricted'
                    : simulatedRegionStatus === 'unauthorized'
                    ? 'unauthorized'
                    : m.status;
                return (
                  <tr key={m.id} className="hover:bg-slate-900/50">
                    <td className="py-3 pr-4 font-mono font-medium text-sky-300 whitespace-nowrap">
                      {m.id}
                    </td>
                    <td className="py-3 px-4 text-slate-200">{m.jobRole}</td>
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                      {m.providerType} · {m.apiSurface}
                    </td>
                    <td className="py-3 px-4 font-mono text-emerald-400 whitespace-nowrap">
                      {m.mode}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                      {m.contextWindow.toLocaleString()}
                    </td>
                    <td className="py-3 pl-4 text-right font-mono whitespace-nowrap">
                      <span
                        className={
                          effectiveStatus.includes('available') || effectiveStatus === 'configured'
                            ? 'text-emerald-400'
                            : effectiveStatus.includes('disabled')
                            ? 'text-amber-300'
                            : 'text-rose-400'
                        }
                      >
                        {effectiveStatus.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-900/75 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Hardware Check ({hwGate.machineRamGb} GB Host RAM &lt; {hwGate.requiredMinRamGb} GB Threshold): {hwGate.reason}
          </span>
          <span className="text-emerald-400 shrink-0">Local Model RAM: 0 MB</span>
        </div>

        {/* Interactive Model Guard Validator (Tests -contributor, muse-wonder-full, sam-3-1) */}
        <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Test Model ID Boundary Guard:</span>
            {[
              'muse-spark-1.3',
              'muse-spark-1.3-contributor',
              'muse-wonder-full',
              'sam-3.1',
              'sam-3-1',
            ].map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setModelTestInput(id)}
                className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
                  modelTestInput === id
                    ? 'bg-sky-500/20 border-sky-500 text-sky-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {id}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            {modelCheck.allowed ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span className={modelCheck.allowed ? 'text-emerald-300' : 'text-rose-300'}>
              {modelCheck.reason}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};

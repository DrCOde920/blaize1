/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GeneralEvaluationsView (Proof > Evaluations — Prompt 2/4)
 * - Works for any installed plugin or connector, including user-created ones:
 *   choose one (or All), click 'Run checks', and read plain-language results
 *   ('Passed', 'Needs attention', 'Failed') with history, trends, and export.
 * - Executes the 7 generic manifest checks + plugin-shipped custom evals in a sandbox,
 *   in mock mode by default (clearly labeled) and live mode on request.
 * - Shows unique run ID, timestamp, and mode on every run (no hard-coded results).
 * - Demonstrates & triggers automatic pre-enable evaluation for new or agent-created plugins
 *   with results routed to Proof > Review.
 */

import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Play,
  Plug,
  Puzzle,
  ShieldCheck,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { InstalledPluginRecord } from '../packages/hub';
import { WorkspaceConnector } from '../packages/workspace';
import {
  EvaluableTargetManifest,
  GeneralEvaluationRunRecord,
  GeneralEvaluationRunner,
  PlainEvalVerdict,
  pluginToEvaluableManifest,
} from '../packages/projects_evals';

export interface GeneralEvaluationsViewProps {
  plugins: InstalledPluginRecord[];
  connectors: WorkspaceConnector[];
  runner: GeneralEvaluationRunner;
  runs: GeneralEvaluationRunRecord[];
  onRunsUpdated: (latestRun: GeneralEvaluationRunRecord, allRuns: GeneralEvaluationRunRecord[]) => void;
  onSimulateNewPluginPreEnableEval?: (pluginName: string) => void;
  onNavigateToReview?: () => void;
  isLight: boolean;
}

function connectorToEvaluableManifest(conn: WorkspaceConnector): EvaluableTargetManifest {
  return {
    id: conn.id,
    name: conn.name,
    kind: 'connector',
    version: '1.0.0',
    author: conn.provider,
    permissionsSummary: `${conn.readAllowed ? 'Read allowed' : 'No read'} · ${
      conn.writeRequiresApproval ? 'Writes require approval' : 'Direct write'
    }`,
    allowedRiskClasses: conn.readAllowed ? ['read', 'external_send'] : ['external_send'],
    declaredOutputFields: ['status', 'records', 'syncTimestamp'],
    requiresApprovalForWriteOrExternal: conn.writeRequiresApproval,
    customEvals: [
      {
        id: `custom-conn-${conn.id}`,
        title: `${conn.name} read/write scope boundary check`,
        fixtureInput: `{"connector":"${conn.id}","action":"sync_preview"}`,
        expectedOutcome: 'Read succeeds in sandbox; external write pauses for approval',
        verifierId: 'dom_assertion',
      },
    ],
  };
}

export const GeneralEvaluationsView: React.FC<GeneralEvaluationsViewProps> = ({
  plugins,
  connectors,
  runner,
  runs,
  onRunsUpdated,
  onSimulateNewPluginPreEnableEval,
  onNavigateToReview,
  isLight,
}) => {
  const [selectedTargetId, setSelectedTargetId] = useState<string | 'all'>('all');
  const [mode, setMode] = useState<'mock' | 'live'>('mock');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [exportedMarkdown, setExportedMarkdown] = useState<string | null>(null);
  const [newPluginTestName, setNewPluginTestName] = useState<string>('');
  const [preEnableNotice, setPreEnableNotice] = useState<string | null>(null);

  const allTargets = useMemo<EvaluableTargetManifest[]>(() => {
    const pluginManifests = plugins.map(pluginToEvaluableManifest);
    const connectorManifests = connectors.map(connectorToEvaluableManifest);
    return [...pluginManifests, ...connectorManifests];
  }, [plugins, connectors]);

  const activeRun: GeneralEvaluationRunRecord | null = useMemo(() => {
    if (selectedRunId) {
      return runs.find((r) => r.runId === selectedRunId) || runs[0] || null;
    }
    return runs[0] || null;
  }, [runs, selectedRunId]);

  const trends = useMemo(() => runner.computeTrends(), [runner, runs]);

  const handleRunChecks = () => {
    const record = runner.runChecks({
      targets: allTargets,
      selectedTargetId,
      mode,
    });
    setSelectedRunId(record.runId);
    onRunsUpdated(record, runner.getHistory());
  };

  const handleExport = () => {
    const md = runner.exportLatestMarkdown(activeRun || undefined);
    setExportedMarkdown(md);
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
      try {
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeRun?.runId || 'evaluation-report'}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // Fallback modal preview shown via exportedMarkdown state
      }
    }
  };

  const renderVerdictBadge = (verdict: PlainEvalVerdict, testId?: string) => {
    if (verdict === 'Passed') {
      return (
        <span
          data-testid={testId}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Passed</span>
        </span>
      );
    }
    if (verdict === 'Needs attention') {
      return (
        <span
          data-testid={testId}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Needs attention</span>
        </span>
      );
    }
    return (
      <span
        data-testid={testId}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30"
      >
        <XCircle className="w-3.5 h-3.5" />
        <span>Failed</span>
      </span>
    );
  };

  return (
    <main className="flex-1 overflow-y-auto p-6" data-testid="general-evaluations-page">
      <div className="max-w-5xl mx-auto space-y-6 text-xs">
        {/* Top Header & Controls */}
        <div
          className={`p-5 rounded-2xl border space-y-4 ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4 pr-24">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Evaluations</h2>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                    mode === 'live'
                      ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                      : 'bg-stone-500/15 text-stone-300 border-stone-700'
                  }`}
                >
                  {mode === 'live' ? 'Live Sandbox Mode' : 'Mock Mode (Simulated Sandbox)'}
                </span>
              </div>
              <p className="text-stone-400 max-w-2xl">
                Check any installed plugin or connector against its manifest permissions, schema,
                prompt-injection fixtures, approval gates, failure recovery, and secret redaction.
              </p>
            </div>
          </div>

          {/* Target Chooser (All, Plugins, Connectors) + Primary Actions + Mode Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-stone-800/60">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="eval-target-select" className="text-stone-400 font-medium">
                Target:
              </label>
              <select
                id="eval-target-select"
                data-testid="eval-target-select"
                value={selectedTargetId}
                onChange={(e) => setSelectedTargetId(e.target.value)}
                className={`px-3 py-1.5 rounded-xl border font-medium ${
                  isLight
                    ? 'bg-stone-50 border-stone-200 text-stone-800'
                    : 'bg-stone-950 border-stone-800 text-stone-200'
                }`}
              >
                <option value="all">All plugins &amp; connectors ({allTargets.length})</option>
                <optgroup label="Installed Plugins">
                  {plugins.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      Plugin: {pl.name} (v{pl.version})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Connectors">
                  {connectors.map((cn) => (
                    <option key={cn.id} value={cn.id}>
                      Connector: {cn.name}
                    </option>
                  ))}
                </optgroup>
              </select>

              <button
                type="button"
                data-testid="run-general-evals-btn"
                onClick={handleRunChecks}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Run checks</span>
              </button>

              <button
                type="button"
                data-testid="export-general-evals-btn"
                onClick={handleExport}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                  isLight
                    ? 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                    : 'bg-stone-950 border-stone-800 text-stone-300 hover:bg-stone-800'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-stone-400">Mode:</span>
              <button
                type="button"
                data-testid="eval-mode-mock"
                onClick={() => setMode('mock')}
                className={`px-3 py-1 rounded-lg border font-medium ${
                  mode === 'mock'
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'border-stone-700 text-stone-400'
                }`}
              >
                Mock (Default)
              </button>
              <button
                type="button"
                data-testid="eval-mode-live"
                onClick={() => setMode('live')}
                className={`px-3 py-1 rounded-lg border font-medium ${
                  mode === 'live'
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'border-stone-700 text-stone-400'
                }`}
              >
                Live
              </button>
            </div>
          </div>
        </div>

        {/* Trends & Current Run Summary Strip */}
        {activeRun && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div
              className={`p-4 rounded-2xl border flex items-center justify-between ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div>
                <div className="text-stone-400">Result</div>
                <div className="mt-1.5">
                  {renderVerdictBadge(activeRun.overallVerdict, 'eval-overall-verdict')}
                </div>
              </div>
              <ShieldCheck className="w-6 h-6 text-sky-400 opacity-80" />
            </div>

            <div
              className={`p-4 rounded-2xl border ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="text-stone-400">Checks passed</div>
              <div className="text-base font-semibold mt-1" data-testid="eval-passed-summary">
                {activeRun.totalPassed} / {activeRun.totalChecksRun} passed
              </div>
              <div className="text-[11px] text-stone-400 mt-0.5">
                {activeRun.totalNeedsAttention} needs attention · {activeRun.totalFailed} failed
              </div>
            </div>

            <div
              className={`p-4 rounded-2xl border ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="text-stone-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Run details</span>
              </div>
              <div
                className="font-mono text-[11px] font-semibold mt-1 truncate"
                data-testid="eval-run-id"
              >
                {activeRun.runId}
              </div>
              <div className="text-[11px] text-stone-400 mt-0.5" data-testid="eval-run-time">
                {activeRun.displayTime} · {activeRun.mode} mode · {activeRun.totalDurationMs} ms
              </div>
            </div>

            <div
              className={`p-4 rounded-2xl border ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
              }`}
            >
              <div className="text-stone-400 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span>Trend ({trends.totalRuns} runs)</span>
              </div>
              <div className="text-base font-semibold text-emerald-400 mt-1">
                {trends.latestPassRatePct}% pass rate
              </div>
              <div className="text-[11px] text-stone-400 mt-0.5">
                Avg latency {trends.averageLatencyMs} ms ({trends.trendDirection})
              </div>
            </div>
          </div>
        )}

        {/* Exported Markdown Preview (when Export is clicked) */}
        {exportedMarkdown && (
          <div
            data-testid="eval-exported-markdown-card"
            className={`p-4 rounded-2xl border space-y-2 ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">Exported Evaluation Report (Markdown)</span>
              <button
                type="button"
                onClick={() => setExportedMarkdown(null)}
                className="text-stone-400 hover:text-stone-200"
              >
                Close
              </button>
            </div>
            <pre className="p-3 rounded-xl bg-black/30 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">
              {exportedMarkdown}
            </pre>
          </div>
        )}

        {/* Per-Target Check Results */}
        {activeRun && (
          <div className="space-y-4">
            {activeRun.targetReports.map((rep) => (
              <div
                key={rep.targetId}
                data-testid={`eval-target-card-${rep.targetId}`}
                className={`p-5 rounded-2xl border space-y-4 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-stone-800/60">
                  <div className="flex items-center gap-2.5">
                    {rep.targetKind === 'plugin' ? (
                      <Puzzle className="w-4 h-4 text-sky-400" />
                    ) : (
                      <Plug className="w-4 h-4 text-amber-400" />
                    )}
                    <div>
                      <div className="font-semibold text-sm">{rep.targetName}</div>
                      <div className="text-[11px] text-stone-400 capitalize">
                        {rep.targetKind} · {rep.passedCount}/{rep.checks.length} checks passed ·{' '}
                        {rep.totalLatencyMs} ms
                      </div>
                    </div>
                  </div>
                  {renderVerdictBadge(rep.verdict, `eval-target-verdict-${rep.targetId}`)}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {rep.checks.map((chk) => (
                    <div
                      key={chk.checkId}
                      data-testid={`eval-check-${rep.targetId}-${chk.checkId}`}
                      className={`p-3.5 rounded-xl border space-y-1 ${
                        isLight
                          ? 'bg-stone-50/70 border-stone-200'
                          : 'bg-stone-950/60 border-stone-800/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{chk.title}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            chk.plainStatus === 'Passed'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : chk.plainStatus === 'Needs attention'
                                ? 'bg-amber-500/15 text-amber-400'
                                : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {chk.plainStatus}
                        </span>
                      </div>
                      <p className="text-stone-400 text-[11px] leading-relaxed">
                        {chk.plainExplanation}
                      </p>
                      <div className="text-[10px] text-stone-500 pt-0.5">
                        Verifier: {chk.verifierUsed} · {chk.latencyMs} ms
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Automatic Pre-Enable Evaluation for New or Agent-Created Plugins */}
        <div
          data-testid="pre-enable-eval-card"
          className={`p-5 rounded-2xl border space-y-3 ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">
                Pre-Enable Safety Check for New &amp; Agent-Created Plugins
              </h3>
              <p className="text-stone-400 mt-0.5">
                Whenever you import a plugin or create one with Morrow, Blaize automatically runs
                these checks in a sandbox before the plugin can be enabled and sends the result to
                Proof &gt; Review.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input
              type="text"
              data-testid="pre-enable-plugin-name-input"
              value={newPluginTestName}
              onChange={(e) => setNewPluginTestName(e.target.value)}
              placeholder="New plugin name (e.g. Study Flashcard Builder)..."
              className={`flex-1 min-w-[220px] px-3 py-2 rounded-xl border outline-none ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
              }`}
            />
            <button
              type="button"
              data-testid="trigger-pre-enable-eval-btn"
              onClick={() => {
                const targetName = newPluginTestName.trim() || 'Study Flashcard Builder';
                if (onSimulateNewPluginPreEnableEval) {
                  onSimulateNewPluginPreEnableEval(targetName);
                }
                setNewPluginTestName('');
                setPreEnableNotice(
                  `Evaluated "${targetName}" in sandbox and sent result to Proof > Review before enabling.`
                );
              }}
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
            >
              Test pre-enable evaluation
            </button>
          </div>

          {preEnableNotice && (
            <div
              data-testid="pre-enable-eval-notice"
              className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex flex-wrap items-center justify-between gap-2 text-emerald-300"
            >
              <span>{preEnableNotice}</span>
              {onNavigateToReview && (
                <button
                  type="button"
                  data-testid="pre-enable-open-review-btn"
                  onClick={onNavigateToReview}
                  className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                >
                  Open Proof &gt; Review
                </button>
              )}
            </div>
          )}
        </div>

        {/* Run History Table */}
        <div
          className={`p-5 rounded-2xl border space-y-3 ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-900/70 border-stone-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold">Run History ({runs.length})</h3>
          </div>
          <div className="divide-y divide-stone-800/60">
            {runs.map((r) => (
              <button
                key={r.runId}
                type="button"
                data-testid={`eval-history-row-${r.runId}`}
                onClick={() => setSelectedRunId(r.runId)}
                className={`w-full py-2.5 px-3 text-left flex flex-wrap items-center justify-between gap-2 rounded-xl transition-colors ${
                  activeRun?.runId === r.runId
                    ? 'bg-sky-500/10 border border-sky-500/30'
                    : 'hover:bg-stone-800/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono font-medium">{r.runId}</span>
                  <span className="text-stone-400">{r.displayTime}</span>
                  <span className="px-2 py-0.5 rounded bg-stone-500/10 text-stone-300 uppercase text-[10px]">
                    {r.mode}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-stone-400">
                    {r.totalPassed}/{r.totalChecksRun} passed · {r.totalDurationMs} ms
                  </span>
                  {renderVerdictBadge(r.overallVerdict)}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize System Doctor & Live Diagnostics View (`src/components/DoctorView.tsx`)
 *
 * Runs real diagnostic probes across:
 * - Durable SQLite key-value store read/write
 * - Process memory and heap headroom
 * - Encrypted vault status and passphrase wrapper
 * - SSRF and DNS blocking filters
 * - PolicyEngine safety floor invariants
 * - MemoryLedger SHA-256 forward audit chain
 * - Exportable redacted diagnostics bundle download
 */

import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Download,
  ShieldCheck,
  Cpu,
  Database,
  Lock,
  Network,
  Activity,
  FileText,
} from 'lucide-react';

interface DoctorCheckItem {
  id: string;
  label: string;
  passed: boolean;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string;
  latencyMs: number;
}

interface DoctorResponse {
  ok: boolean;
  overallStatus: 'HEALTHY' | 'DEGRADED';
  totalChecks: number;
  passedChecks: number;
  checks: DoctorCheckItem[];
  diagnosticsLogsCount: number;
  evaluatedAtIso: string;
}

export const DoctorView: React.FC = () => {
  const [data, setData] = useState<DoctorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const runDoctor = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/system/doctor');
      if (!resp.ok) {
        throw new Error(`Doctor API returned HTTP ${resp.status}`);
      }
      const json = await resp.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Failed to execute system doctor checks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runDoctor();
  }, []);

  const downloadDiagnosticsBundle = async () => {
    setDownloading(true);
    try {
      const resp = await fetch('/api/system/diagnostics-bundle');
      if (!resp.ok) {
        throw new Error(`Failed to download bundle (HTTP ${resp.status})`);
      }
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blaize-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(err?.message || 'Failed to export bundle');
    } finally {
      setDownloading(false);
    }
  };

  const getIconForCheck = (id: string) => {
    switch (id) {
      case 'storage_sqlite':
        return <Database className="w-5 h-5 text-indigo-400" />;
      case 'memory_headroom':
        return <Cpu className="w-5 h-5 text-sky-400" />;
      case 'vault_protection':
        return <Lock className="w-5 h-5 text-amber-400" />;
      case 'ssrf_security_filter':
        return <Network className="w-5 h-5 text-emerald-400" />;
      case 'policy_safety_floor':
        return <ShieldCheck className="w-5 h-5 text-rose-400" />;
      case 'audit_ledger_integrity':
        return <Activity className="w-5 h-5 text-purple-400" />;
      default:
        return <FileText className="w-5 h-5 text-stone-400" />;
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 text-stone-100 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-sky-400" />
            Blaize System Doctor
          </h1>
          <p className="text-sm text-stone-400 mt-1">
            Real hardware and subsystem diagnostics: storage durability, memory headroom, vault protection,
            SSRF filter, and audit ledger integrity.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={downloadDiagnosticsBundle}
            disabled={downloading}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-stone-800 hover:bg-stone-700 border border-stone-700 flex items-center gap-2 text-stone-200 transition-colors shadow-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {downloading ? 'Exporting...' : 'Export Bundle (JSON)'}
          </button>
          <button
            type="button"
            onClick={runDoctor}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Run Diagnostics
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-950/20 text-rose-300 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary KPI Banner */}
      {data && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between ${
            data.overallStatus === 'HEALTHY'
              ? 'border-emerald-500/30 bg-emerald-950/10'
              : 'border-amber-500/30 bg-amber-950/10'
          }`}
        >
          <div className="flex items-center gap-3">
            {data.overallStatus === 'HEALTHY' ? (
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-7 h-7 text-amber-400" />
            )}
            <div>
              <div className="text-base font-bold text-white">
                Subsystems Status:{' '}
                <span
                  className={
                    data.overallStatus === 'HEALTHY' ? 'text-emerald-400' : 'text-amber-400'
                  }
                >
                  {data.overallStatus}
                </span>
              </div>
              <div className="text-xs text-stone-400">
                {data.passedChecks} of {data.totalChecks} automated security and performance probes passed.
              </div>
            </div>
          </div>
          <div className="text-right text-xs text-stone-400 hidden sm:block">
            Evaluated at: <span className="font-mono text-stone-300">{new Date(data.evaluatedAtIso).toLocaleTimeString()}</span>
          </div>
        </div>
      )}

      {/* Diagnostic Probes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data?.checks.map((item) => (
          <div
            key={item.id}
            className="p-4 rounded-xl border border-stone-800 bg-stone-900/40 hover:bg-stone-900/70 transition-colors flex flex-col justify-between space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-stone-800 border border-stone-700/60">
                  {getIconForCheck(item.id)}
                </div>
                <div>
                  <div className="text-sm font-semibold text-stone-200">{item.label}</div>
                  <div className="text-xs font-mono text-stone-500">{item.id}</div>
                </div>
              </div>

              <div>
                {item.status === 'PASS' && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-500/30">
                    PASS
                  </span>
                )}
                {item.status === 'WARN' && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-950/80 text-amber-400 border border-amber-500/30">
                    WARN
                  </span>
                )}
                {item.status === 'FAIL' && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-950/80 text-rose-400 border border-rose-500/30">
                    FAIL
                  </span>
                )}
              </div>
            </div>

            <div className="text-xs text-stone-300 font-mono bg-black/30 p-2.5 rounded-lg border border-stone-800/80 break-words">
              {item.details}
            </div>

            <div className="text-[11px] text-stone-500 flex items-center justify-between pt-1 border-t border-stone-800/60">
              <span>Measured execution latency</span>
              <span className="font-mono text-stone-400">{item.latencyMs} ms</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

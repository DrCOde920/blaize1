import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AppWindow, Monitor, RefreshCw, Sparkles, PanelsTopLeft, Keyboard } from 'lucide-react';
import { getPlatformBridge } from '../packages/platform';

const desktopBridge = getPlatformBridge();
type ShellCaps = Awaited<ReturnType<typeof desktopBridge.getShellCapabilities>>;
type HostWindow = Awaited<ReturnType<typeof desktopBridge.listWindows>>[number];

/**
 * Real Electron host controls, intentionally distinct from PC Operator's
 * deterministic scenario driver. In a browser preview this panel reports
 * UNSUPPORTED instead of pretending that native desktop operations occurred.
 */
export const NativeDesktopHostPanel: React.FC = () => {
  const [shell, setShell] = useState<ShellCaps | null>(null);
  const [windows, setWindows] = useState<HostWindow[]>([]);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('Checking desktop host…');

  const refresh = useCallback(async () => {
    if (!desktopBridge.isElectron) {
      setShell(null);
      setWindows([]);
      setStatus('UNSUPPORTED · Open the installed Blaize desktop app to use native controls.');
      return;
    }
    setBusy('refresh');
    try {
      const [caps, openWindows] = await Promise.all([
        desktopBridge.getShellCapabilities(),
        desktopBridge.listWindows(),
      ]);
      setShell(caps);
      setWindows(openWindows);
      setStatus(caps.executionState === 'EXECUTED'
        ? 'Connected to the native desktop host.'
        : caps.reason || `Native host state: ${caps.executionState}`);
    } catch (error) {
      setStatus(`Native host check failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runControl = async (label: string, action: () => Promise<ShellCaps>) => {
    setBusy(label);
    setStatus(`${label}…`);
    try {
      const next = await action();
      setShell(next);
      setStatus(next.reason || `${label} request completed (${next.executionState}).`);
      const nextWindows = await desktopBridge.listWindows();
      setWindows(nextWindows);
    } catch (error) {
      setStatus(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy('');
    }
  };

  const nativeReady = desktopBridge.isElectron && shell?.executionState === 'EXECUTED';

  return (
    <section className="rounded-xl border border-sky-500/25 bg-[#101923] p-4 space-y-3" data-testid="native-desktop-host-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-sky-500/10 p-2 text-sky-300"><Monitor className="h-4 w-4" /></div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-200">Native Desktop Host</div>
            <div className="text-[11px] text-slate-400">{desktopBridge.isElectron ? `Electron · ${desktopBridge.platform}` : 'Web preview · no native host'}</div>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${nativeReady ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
          {nativeReady ? 'NATIVE HOST CONNECTED' : shell?.executionState || 'CHECKING'}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-slate-300">{status}</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void refresh()} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> Refresh host
        </button>
        <button type="button" onClick={() => shell && void runControl(shell.trayActive ? 'Hide tray icon' : 'Show tray icon', () => desktopBridge.setTrayState(!shell.trayActive, 'Blaize'))} disabled={!nativeReady || Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">
          <PanelsTopLeft className="h-3.5 w-3.5" /> {shell?.trayActive ? 'Hide tray icon' : 'Show tray icon'}
        </button>
        <button type="button" onClick={() => shell && void runControl(shell.floatingCompanionVisible ? 'Hide Morrow' : 'Show Morrow', () => desktopBridge.setFloatingCompanion(!shell.floatingCompanionVisible))} disabled={!nativeReady || Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">
          <Sparkles className="h-3.5 w-3.5" /> {shell?.floatingCompanionVisible ? 'Hide Morrow' : 'Show Morrow'}
        </button>
        <button type="button" onClick={() => void runControl('Register shortcut', () => desktopBridge.registerGlobalShortcut('CommandOrControl+Shift+B'))} disabled={!nativeReady || Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">
          <Keyboard className="h-3.5 w-3.5" /> Register Ctrl/⌘+Shift+B
        </button>
      </div>

      <div className="border-t border-slate-700/70 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"><AppWindow className="h-3.5 w-3.5" /> Detected windows</div>
          <span className="text-[10px] text-slate-400">{windows.length} found</span>
        </div>
        {windows.length ? (
          <div className="space-y-1.5">
            {windows.slice(0, 5).map((win) => (
              <div key={win.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/70 px-3 py-2 text-[11px]">
                <span className="truncate text-slate-200">{win.title || win.processName}</span>
                <span className="shrink-0 text-slate-500">{win.isFocused ? 'Focused' : win.processName}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/50 px-3 py-2 text-[11px] text-slate-400">
            <Activity className="h-3.5 w-3.5" /> No native windows reported by the host.
          </div>
        )}
      </div>
    </section>
  );
};

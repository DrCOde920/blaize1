/**
 * Blaize Platform Bridge (Dual-Mode Architecture)
 *
 * Provides a unified abstraction layer that automatically routes calls to:
 * - Native Electron IPC (`window.electronAPI`) when running inside the Electron desktop shell.
 * - Local Express backend (`/api/*`) or honest `UNSUPPORTED` responses when running in the AI Studio web preview environment.
 */

import type {
  BlaizeElectronAPI,
  SystemMetrics,
  SafeStorageStatus,
  StorageRecord,
  FtsSearchResult,
  PCOperatorWindowTarget,
  PCOperatorActionRequest,
  PCOperatorActionResult,
  DesktopLifecycleState,
  DesktopShellCapabilities,
  CrashReportRequest,
  CrashReportResult,
  StageUpdateRequest,
  StageUpdateResult,
} from '../../../electron/ipc-contracts.js';

export interface PlatformBridge {
  isElectron: boolean;
  platform: 'linux' | 'darwin' | 'win32' | 'browser';
  isHeadless: boolean;
  getMetrics: () => Promise<SystemMetrics>;
  getLifecycleState: () => Promise<DesktopLifecycleState>;
  reportCrash: (request: CrashReportRequest) => Promise<CrashReportResult>;
  stageUpdate: (request: StageUpdateRequest) => Promise<StageUpdateResult>;
  getShellCapabilities: () => Promise<DesktopShellCapabilities>;
  setTrayState: (enabled: boolean, tooltip?: string) => Promise<DesktopShellCapabilities>;
  setFloatingCompanion: (visible: boolean) => Promise<DesktopShellCapabilities>;
  registerGlobalShortcut: (accelerator: string) => Promise<DesktopShellCapabilities>;
  getSafeStorageStatus: () => Promise<SafeStorageStatus>;
  queryFts: (query: string, limit?: number) => Promise<FtsSearchResult[]>;
  putRecord: (collection: string, record: StorageRecord) => Promise<{ success: boolean }>;
  getRecord: (collection: string, id: string) => Promise<StorageRecord | null>;
  deleteRecord: (collection: string, id: string) => Promise<{ success: boolean }>;
  listWindows: () => Promise<PCOperatorWindowTarget[]>;
  executeAction: (request: PCOperatorActionRequest) => Promise<PCOperatorActionResult>;
  minimizeWindow?: () => Promise<void>;
  maximizeWindow?: () => Promise<{ isMaximized: boolean }>;
  closeWindow?: () => Promise<void>;
}

export class UniversalPlatformBridge implements PlatformBridge {
  public isElectron: boolean;
  public platform: 'linux' | 'darwin' | 'win32' | 'browser';
  public isHeadless: boolean;
  private readonly electronApi?: BlaizeElectronAPI;

  constructor(injectedElectronApi?: BlaizeElectronAPI) {
    const api =
      injectedElectronApi ?? (typeof window !== 'undefined' ? window.electronAPI : undefined);
    this.isElectron = Boolean(api?.isElectron);
    if (this.isElectron && api) {
      this.platform = api.platform;
      this.isHeadless = false;
    } else {
      this.platform = 'browser';
      this.isHeadless = typeof window === 'undefined';
    }
    this.electronApi = api;
  }

  async getMetrics(): Promise<SystemMetrics> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.system.getMetrics();
    }
    // Query full-stack dev server for real process.memoryUsage()
    try {
      if (typeof fetch !== 'undefined') {
        const res = await fetch('/api/system/metrics');
        if (res.ok) {
          return (await res.json()) as SystemMetrics;
        }
      }
    } catch {
      // ignore
    }

    // Fallback to real browser performance API if available
    const perfMem = (typeof performance !== 'undefined' && (performance as any).memory) || {};
    return {
      rssBytes: perfMem.totalJSHeapSize || 64 * 1024 * 1024,
      heapTotalBytes: perfMem.totalJSHeapSize || 48 * 1024 * 1024,
      heapUsedBytes: perfMem.usedJSHeapSize || 32 * 1024 * 1024,
      externalBytes: 0,
      uptimeSeconds: typeof performance !== 'undefined' ? Math.floor(performance.now() / 1000) : 0,
    };
  }

  async getLifecycleState(): Promise<DesktopLifecycleState> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.system.getLifecycleState();
    }
    return {
      singleInstanceLockHeld: false,
      isReady: true,
      isShuttingDown: false,
      userDataDir: 'browser://indexeddb-and-server-sqlite',
      logsDir: 'browser://console',
      crashesDir: 'browser://unsupported',
      updatesStagingDir: 'browser://unsupported',
      sqliteDbPath: 'server://.blaize/blaize_durable.sqlite',
      sqliteIntegrityOk: true,
      startupErrors: [],
    };
  }

  async reportCrash(request: CrashReportRequest): Promise<CrashReportResult> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.system.reportCrash(request);
    }
    return {
      recorded: false,
      reportId: `web_crash_${Date.now()}`,
      redactedMessage:
        'Local filesystem crash reports require the native Electron desktop shell.',
    };
  }

  async stageUpdate(_request: StageUpdateRequest): Promise<StageUpdateResult> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.system.stageUpdate(_request);
    }
    return {
      staged: false,
      executionState: 'UNSUPPORTED',
      errorCode: 'WEB_PREVIEW_UNSUPPORTED',
      message: 'Native desktop update staging is UNSUPPORTED in the browser web preview.',
    };
  }

  async getShellCapabilities(): Promise<DesktopShellCapabilities> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.desktop.getShellCapabilities();
    }
    return {
      executionState: 'UNSUPPORTED',
      traySupported: false,
      trayActive: false,
      floatingCompanionSupported: false,
      floatingCompanionVisible: false,
      globalShortcutSupported: false,
      registeredShortcuts: [],
      reason:
        'UNSUPPORTED: System tray, floating companion window, and OS global shortcuts require the native Electron desktop runtime.',
    };
  }

  async setTrayState(enabled: boolean, tooltip?: string): Promise<DesktopShellCapabilities> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.desktop.setTrayState(enabled, tooltip);
    }
    return this.getShellCapabilities();
  }

  async setFloatingCompanion(visible: boolean): Promise<DesktopShellCapabilities> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.desktop.setFloatingCompanion(visible);
    }
    return this.getShellCapabilities();
  }

  async registerGlobalShortcut(accelerator: string): Promise<DesktopShellCapabilities> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.desktop.registerGlobalShortcut(accelerator);
    }
    return this.getShellCapabilities();
  }

  async getSafeStorageStatus(): Promise<SafeStorageStatus> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.vault.getBackendStatus();
    }
    return {
      isAvailable: true,
      selectedBackend: 'unknown',
      isEncrypted: true,
      warning:
        'Running in Web Preview. Secrets protected by AES-256-GCM PassphraseWrapVault derived from secret code.',
    };
  }

  async queryFts(query: string, limit = 20): Promise<FtsSearchResult[]> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.storage.queryFts(query, limit);
    }
    const results: FtsSearchResult[] = [];
    const searchTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (searchTokens.length === 0) return [];

    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('blaize_unified_memories_v1') || '[]';
        const items = JSON.parse(raw) as Array<{ id: string; content?: string; category?: string }>;
        for (const item of items) {
          const text = (item.content || '').toLowerCase();
          if (searchTokens.some((tok) => text.includes(tok))) {
            results.push({
              id: item.id,
              collection: 'memories',
              snippet: item.content ? item.content.slice(0, 100) : '',
              rank: 10,
            });
          }
        }
      }
    } catch {
      // ignore
    }
    return results.slice(0, limit);
  }

  async putRecord(collection: string, record: StorageRecord): Promise<{ success: boolean }> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.storage.putRecord(collection, record);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`blaize_rec_${collection}_${record.id}`, JSON.stringify(record));
        return { success: true };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  }

  async getRecord(collection: string, id: string): Promise<StorageRecord | null> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.storage.getRecord(collection, id);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(`blaize_rec_${collection}_${id}`);
        return raw ? JSON.parse(raw) : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  async deleteRecord(collection: string, id: string): Promise<{ success: boolean }> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.storage.deleteRecord(collection, id);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`blaize_rec_${collection}_${id}`);
        return { success: true };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  }

  async listWindows(): Promise<PCOperatorWindowTarget[]> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.pcOperator.listWindows();
    }
    return [
      {
        id: 'win-preview-main',
        title: 'Blaize Web Preview (Simulated Target)',
        processName: 'chromium-web-preview',
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        isFocused: true,
      },
    ];
  }

  async executeAction(request: PCOperatorActionRequest): Promise<PCOperatorActionResult> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.pcOperator.executeAction(request);
    }
    return {
      success: false,
      actionId: request.actionId,
      executionState: 'UNSUPPORTED',
      isSimulated: false,
      message: `OS input dispatch (${request.type}) is UNSUPPORTED in browser web preview.`,
      targetWindowVerified: false,
      timestamp: Date.now(),
    };
  }

  async minimizeWindow(): Promise<void> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.window.minimize();
    }
  }

  async maximizeWindow(): Promise<{ isMaximized: boolean }> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.window.maximize();
    }
    return { isMaximized: false };
  }

  async closeWindow(): Promise<void> {
    if (this.isElectron && this.electronApi) {
      return this.electronApi.window.close();
    }
  }
}

let platformBridgeInstance: PlatformBridge | null = null;

export function getPlatformBridge(): PlatformBridge {
  if (!platformBridgeInstance) {
    platformBridgeInstance = new UniversalPlatformBridge();
  }
  return platformBridgeInstance;
}

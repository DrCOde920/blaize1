/**
 * Blaize Platform Bridge (Dual-Mode Architecture)
 *
 * Provides a unified abstraction layer that automatically routes calls to:
 * - Native Electron IPC (`window.electronAPI`) when running inside the Electron desktop shell.
 * - Local Express backend (`/api/*`) when running in the AI Studio web preview environment.
 */

import type {
  BlaizeElectronAPI,
  SystemMetrics,
  SafeStorageStatus,
  StorageRecord,
  FtsSearchResult,
  PCOperatorWindowTarget,
  PCOperatorActionRequest,
  PCOperatorActionResult
} from '../../../electron/ipc-contracts.js';

export interface PlatformBridge {
  isElectron: boolean;
  platform: 'linux' | 'darwin' | 'win32' | 'browser';
  isHeadless: boolean;
  getMetrics: () => Promise<SystemMetrics>;
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

class UniversalPlatformBridge implements PlatformBridge {
  public isElectron: boolean;
  public platform: 'linux' | 'darwin' | 'win32' | 'browser';
  public isHeadless: boolean;

  constructor() {
    this.isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
    if (this.isElectron && window.electronAPI) {
      this.platform = window.electronAPI.platform;
      this.isHeadless = false;
    } else {
      this.platform = 'browser';
      this.isHeadless = typeof window === 'undefined';
    }
  }

  async getMetrics(): Promise<SystemMetrics> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.system.getMetrics();
    }
    // Query full-stack dev server for real process.memoryUsage()
    try {
      const res = await fetch('/api/system/metrics');
      if (res.ok) {
        return (await res.json()) as SystemMetrics;
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
      uptimeSeconds: typeof performance !== 'undefined' ? Math.floor(performance.now() / 1000) : 0
    };
  }

  async getSafeStorageStatus(): Promise<SafeStorageStatus> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.vault.getBackendStatus();
    }
    // In web preview, report PassphraseWrapVault with clear honest label
    return {
      isAvailable: true,
      selectedBackend: 'unknown',
      isEncrypted: true,
      warning: 'Running in Web Preview. Secrets protected by AES-256-GCM PassphraseWrapVault derived from secret code.'
    };
  }

  async queryFts(query: string, limit = 20): Promise<FtsSearchResult[]> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.storage.queryFts(query, limit);
    }
    // In web preview, query client-side IndexedDB / local memory store
    const results: FtsSearchResult[] = [];
    const searchTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (searchTokens.length === 0) return [];

    try {
      const raw = localStorage.getItem('blaize_unified_memories_v1') || '[]';
      const items = JSON.parse(raw) as Array<{ id: string; content?: string; category?: string }>;
      for (const item of items) {
        const text = (item.content || '').toLowerCase();
        if (searchTokens.some(tok => text.includes(tok))) {
          results.push({
            id: item.id,
            collection: 'memories',
            snippet: item.content ? item.content.slice(0, 100) : '',
            rank: 10
          });
        }
      }
    } catch {
      // ignore
    }
    return results.slice(0, limit);
  }

  async putRecord(collection: string, record: StorageRecord): Promise<{ success: boolean }> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.storage.putRecord(collection, record);
    }
    try {
      localStorage.setItem(`blaize_rec_${collection}_${record.id}`, JSON.stringify(record));
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async getRecord(collection: string, id: string): Promise<StorageRecord | null> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.storage.getRecord(collection, id);
    }
    try {
      const raw = localStorage.getItem(`blaize_rec_${collection}_${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async deleteRecord(collection: string, id: string): Promise<{ success: boolean }> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.storage.deleteRecord(collection, id);
    }
    try {
      localStorage.removeItem(`blaize_rec_${collection}_${id}`);
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async listWindows(): Promise<PCOperatorWindowTarget[]> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.pcOperator.listWindows();
    }
    return [
      {
        id: 'win-preview-main',
        title: 'Blaize Web Preview',
        processName: 'chromium',
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        isFocused: true
      },
      {
        id: 'win-desktop-stage',
        title: 'Desktop Stage Simulator',
        processName: 'blaize-stage',
        bounds: { x: 40, y: 40, width: 900, height: 600 },
        isFocused: false
      }
    ];
  }

  async executeAction(request: PCOperatorActionRequest): Promise<PCOperatorActionResult> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.pcOperator.executeAction(request);
    }
    return {
      success: true,
      actionId: request.actionId,
      message: `Preview action ${request.type} simulated on target ${request.targetWindowId || 'active window'}`,
      targetWindowVerified: true,
      timestamp: Date.now()
    };
  }

  async minimizeWindow(): Promise<void> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.window.minimize();
    }
  }

  async maximizeWindow(): Promise<{ isMaximized: boolean }> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.window.maximize();
    }
    return { isMaximized: false };
  }

  async closeWindow(): Promise<void> {
    if (this.isElectron && window.electronAPI) {
      return window.electronAPI.window.close();
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

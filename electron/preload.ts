/**
 * Blaize Electron Preload Script
 *
 * Exposes a typed, hardened IPC bridge (`window.electronAPI`) into the renderer world.
 * Does not expose raw `ipcRenderer`, preventing unauthorized IPC invocation.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  BlaizeElectronAPI,
  SystemMetrics,
  SafeStorageStatus,
  StorageRecord,
  FtsSearchResult,
  PCOperatorWindowTarget,
  PCOperatorActionRequest,
  PCOperatorActionResult
} from './ipc-contracts.js';

const electronAPI: BlaizeElectronAPI = {
  isElectron: true,
  platform: (process.platform as 'linux' | 'darwin' | 'win32') || 'linux',
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    maximize: () => ipcRenderer.invoke('window:maximize') as Promise<{ isMaximized: boolean }>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>
  },
  system: {
    getMetrics: () => ipcRenderer.invoke('system:get-metrics') as Promise<SystemMetrics>,
    getPlatformInfo: () =>
      ipcRenderer.invoke('system:get-platform-info') as Promise<{
        platform: 'linux' | 'darwin' | 'win32';
        arch: string;
        nodeVersion: string;
        electronVersion: string;
        isHeadless: boolean;
      }>,
    onPowerEvent: (callback: (event: 'suspend' | 'resume' | 'lock' | 'unlock') => void) => {
      const listener = (_event: unknown, ...args: unknown[]) =>
        callback((args[0] as 'suspend' | 'resume' | 'lock' | 'unlock') || 'resume');
      ipcRenderer.on('power:event', listener);
      return () => {
        ipcRenderer.removeListener('power:event', listener);
      };
    }
  },
  vault: {
    getBackendStatus: () => ipcRenderer.invoke('vault:get-backend-status') as Promise<SafeStorageStatus>,
    encryptSecret: (keyId: string, plaintext: string) =>
      ipcRenderer.invoke('vault:encrypt-secret', { keyId, plaintext }) as Promise<{ success: boolean; error?: string }>,
    decryptSecret: (keyId: string) =>
      ipcRenderer.invoke('vault:decrypt-secret', { keyId }) as Promise<{ plaintext?: string; error?: string }>,
    deleteSecret: (keyId: string) => ipcRenderer.invoke('vault:delete-secret', { keyId }) as Promise<{ success: boolean }>
  },
  storage: {
    queryFts: (query: string, limit?: number) =>
      ipcRenderer.invoke('storage:query-fts', { query, limit }) as Promise<FtsSearchResult[]>,
    putRecord: (collection: string, record: StorageRecord) =>
      ipcRenderer.invoke('storage:put-record', { collection, record }) as Promise<{ success: boolean }>,
    getRecord: (collection: string, id: string) =>
      ipcRenderer.invoke('storage:get-record', { collection, id }) as Promise<StorageRecord | null>,
    deleteRecord: (collection: string, id: string) =>
      ipcRenderer.invoke('storage:delete-record', { collection, id }) as Promise<{ success: boolean }>,
    saveBlob: (hash: string, dataBase64: string, mimeType: string) =>
      ipcRenderer.invoke('storage:save-blob', { hash, dataBase64, mimeType }) as Promise<{ path: string; size: number }>,
    readBlob: (hash: string) =>
      ipcRenderer.invoke('storage:read-blob', { hash }) as Promise<{ dataBase64: string; mimeType: string } | null>
  },
  pcOperator: {
    listWindows: () => ipcRenderer.invoke('pc-operator:list-windows') as Promise<PCOperatorWindowTarget[]>,
    executeAction: (request: PCOperatorActionRequest) =>
      ipcRenderer.invoke('pc-operator:execute-action', request) as Promise<PCOperatorActionResult>
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

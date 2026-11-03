/**
 * Blaize Electron Preload Script (`electron/preload.ts`)
 *
 * Exposes a narrow, frozen, typed IPC bridge (`window.electronAPI`) into the renderer world.
 * - Never exposes raw `ipcRenderer`, `fs`, `child_process`, `shell`, `process.env`, or `require`.
 * - Every method maps 1:1 to a Zod-validated channel in `IPC_CONTRACT_MANIFEST`.
 */

import * as electronPkg from 'electron';
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
} from './ipc-contracts.js';

export interface MinimalIpcRenderer {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
  removeListener: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void
  ) => void;
}

export function buildPreloadApi(
  ipc: MinimalIpcRenderer,
  platform: 'linux' | 'darwin' | 'win32' = (process.platform as 'linux' | 'darwin' | 'win32') ||
    'linux'
): BlaizeElectronAPI {
  const api: BlaizeElectronAPI = {
    isElectron: true,
    platform,
    window: Object.freeze({
      minimize: () => ipc.invoke('window:minimize') as Promise<void>,
      maximize: () => ipc.invoke('window:maximize') as Promise<{ isMaximized: boolean }>,
      close: () => ipc.invoke('window:close') as Promise<void>,
      isMaximized: () => ipc.invoke('window:is-maximized') as Promise<boolean>,
    }),
    system: Object.freeze({
      getMetrics: () => ipc.invoke('system:get-metrics') as Promise<SystemMetrics>,
      getPlatformInfo: () =>
        ipc.invoke('system:get-platform-info') as Promise<{
          platform: 'linux' | 'darwin' | 'win32';
          arch: string;
          nodeVersion: string;
          electronVersion: string;
          isHeadless: boolean;
        }>,
      getLifecycleState: () =>
        ipc.invoke('system:get-lifecycle-state') as Promise<DesktopLifecycleState>,
      reportCrash: (req: CrashReportRequest) =>
        ipc.invoke('system:report-crash', req) as Promise<CrashReportResult>,
      stageUpdate: (req: StageUpdateRequest) =>
        ipc.invoke('system:stage-update', req) as Promise<StageUpdateResult>,
      onPowerEvent: (callback: (event: 'suspend' | 'resume' | 'lock' | 'unlock') => void) => {
        const listener = (_event: unknown, ...args: unknown[]) => {
          const ev = args[0];
          if (ev === 'suspend' || ev === 'resume' || ev === 'lock' || ev === 'unlock') {
            callback(ev);
          }
        };
        ipc.on('power:event', listener);
        return () => {
          ipc.removeListener('power:event', listener);
        };
      },
    }),
    desktop: Object.freeze({
      getShellCapabilities: () =>
        ipc.invoke('desktop:get-shell-capabilities') as Promise<DesktopShellCapabilities>,
      setTrayState: (enabled: boolean, tooltip?: string) =>
        ipc.invoke('desktop:set-tray-state', {
          enabled,
          ...(tooltip !== undefined ? { tooltip } : {}),
        }) as Promise<DesktopShellCapabilities>,
      setFloatingCompanion: (visible: boolean) =>
        ipc.invoke('desktop:set-floating-companion', {
          visible,
        }) as Promise<DesktopShellCapabilities>,
      registerGlobalShortcut: (accelerator: string) =>
        ipc.invoke('desktop:register-shortcut', {
          accelerator,
        }) as Promise<DesktopShellCapabilities>,
    }),
    vault: Object.freeze({
      getBackendStatus: () =>
        ipc.invoke('vault:get-backend-status') as Promise<SafeStorageStatus>,
      encryptSecret: (keyId: string, plaintext: string) =>
        ipc.invoke('vault:encrypt-secret', { keyId, plaintext }) as Promise<{
          success: boolean;
          error?: string;
        }>,
      decryptSecret: (keyId: string) =>
        ipc.invoke('vault:decrypt-secret', { keyId }) as Promise<{
          plaintext?: string;
          error?: string;
        }>,
      deleteSecret: (keyId: string) =>
        ipc.invoke('vault:delete-secret', { keyId }) as Promise<{ success: boolean }>,
    }),
    storage: Object.freeze({
      queryFts: (query: string, limit?: number) =>
        ipc.invoke('storage:query-fts', {
          query,
          ...(limit !== undefined ? { limit } : {}),
        }) as Promise<FtsSearchResult[]>,
      putRecord: (collection: string, record: StorageRecord) =>
        ipc.invoke('storage:put-record', { collection, record }) as Promise<{ success: boolean }>,
      getRecord: (collection: string, id: string) =>
        ipc.invoke('storage:get-record', { collection, id }) as Promise<StorageRecord | null>,
      deleteRecord: (collection: string, id: string) =>
        ipc.invoke('storage:delete-record', { collection, id }) as Promise<{ success: boolean }>,
      saveBlob: (hash: string, dataBase64: string, mimeType: string) =>
        ipc.invoke('storage:save-blob', { hash, dataBase64, mimeType }) as Promise<{
          path: string;
          size: number;
        }>,
      readBlob: (hash: string) =>
        ipc.invoke('storage:read-blob', { hash }) as Promise<{
          dataBase64: string;
          mimeType: string;
        } | null>,
    }),
    pcOperator: Object.freeze({
      listWindows: () =>
        ipc.invoke('pc-operator:list-windows') as Promise<PCOperatorWindowTarget[]>,
      executeAction: (request: PCOperatorActionRequest) =>
        ipc.invoke('pc-operator:execute-action', request) as Promise<PCOperatorActionResult>,
    }),
  };

  return Object.freeze(api);
}

// Automatically expose in Electron preload context when contextBridge & ipcRenderer are present
const maybeContextBridge = (electronPkg as any)?.contextBridge;
const maybeIpcRenderer = (electronPkg as any)?.ipcRenderer;

if (maybeContextBridge && typeof maybeContextBridge.exposeInMainWorld === 'function' && maybeIpcRenderer) {
  const electronAPI = buildPreloadApi(maybeIpcRenderer);
  maybeContextBridge.exposeInMainWorld('electronAPI', electronAPI);
}

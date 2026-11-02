/**
 * Typed IPC Contracts for Blaize Electron Desktop Shell
 *
 * Defines strictly typed channels and payload interfaces for bidirectional
 * communication between Electron Main process and Renderer via ContextBridge.
 */

export interface SystemMetrics {
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  uptimeSeconds: number;
  cpuPercent?: number;
  electronAppMetrics?: {
    pid: number;
    type: string;
    memoryKb: number;
  }[];
}

export interface StorageRecord {
  id: string;
  collection: string;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface FtsSearchResult {
  id: string;
  collection: string;
  snippet: string;
  rank: number;
}

export interface SafeStorageStatus {
  isAvailable: boolean;
  selectedBackend: 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'basic_text' | 'unknown' | 'macos_keychain' | 'windows_dpapi';
  isEncrypted: boolean;
  warning?: string;
}

export interface PCOperatorWindowTarget {
  id: string;
  title: string;
  processName: string;
  bounds: { x: number; y: number; width: number; height: number };
  isFocused: boolean;
}

export interface PCOperatorActionRequest {
  actionId: string;
  type: 'click' | 'type' | 'scroll' | 'key' | 'navigate';
  targetWindowId?: string;
  coordinates?: { x: number; y: number };
  text?: string;
  key?: string;
  deltaY?: number;
  requiresConfirmation: boolean;
}

export interface PCOperatorActionResult {
  success: boolean;
  actionId: string;
  message?: string;
  targetWindowVerified: boolean;
  timestamp: number;
}

/**
 * IPC Channel Map: channel name -> { request: TReq, response: TRes }
 */
export interface ElectronIpcChannels {
  // Window controls
  'window:minimize': { req: void; res: void };
  'window:maximize': { req: void; res: { isMaximized: boolean } };
  'window:close': { req: void; res: void };
  'window:is-maximized': { req: void; res: boolean };

  // System & Metrics
  'system:get-metrics': { req: void; res: SystemMetrics };
  'system:get-platform-info': {
    req: void;
    res: {
      platform: 'linux' | 'darwin' | 'win32';
      arch: string;
      nodeVersion: string;
      electronVersion: string;
      isHeadless: boolean;
    };
  };

  // SafeStorage / Vault
  'vault:get-backend-status': { req: void; res: SafeStorageStatus };
  'vault:encrypt-secret': { req: { keyId: string; plaintext: string }; res: { success: boolean; error?: string } };
  'vault:decrypt-secret': { req: { keyId: string }; res: { plaintext?: string; error?: string } };
  'vault:delete-secret': { req: { keyId: string }; res: { success: boolean } };

  // SQLite & FTS5 Search
  'storage:query-fts': { req: { query: string; limit?: number }; res: FtsSearchResult[] };
  'storage:put-record': { req: { collection: string; record: StorageRecord }; res: { success: boolean } };
  'storage:get-record': { req: { collection: string; id: string }; res: StorageRecord | null };
  'storage:delete-record': { req: { collection: string; id: string }; res: { success: boolean } };
  'storage:save-blob': { req: { hash: string; dataBase64: string; mimeType: string }; res: { path: string; size: number } };
  'storage:read-blob': { req: { hash: string }; res: { dataBase64: string; mimeType: string } | null };

  // PC Operator (Desktop control)
  'pc-operator:list-windows': { req: void; res: PCOperatorWindowTarget[] };
  'pc-operator:execute-action': { req: PCOperatorActionRequest; res: PCOperatorActionResult };
}

/**
 * Interface exposed on `window.electronAPI`
 */
export interface BlaizeElectronAPI {
  isElectron: true;
  platform: 'linux' | 'darwin' | 'win32';
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<{ isMaximized: boolean }>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  system: {
    getMetrics: () => Promise<SystemMetrics>;
    getPlatformInfo: () => Promise<{
      platform: 'linux' | 'darwin' | 'win32';
      arch: string;
      nodeVersion: string;
      electronVersion: string;
      isHeadless: boolean;
    }>;
    onPowerEvent: (callback: (event: 'suspend' | 'resume' | 'lock' | 'unlock') => void) => () => void;
  };
  vault: {
    getBackendStatus: () => Promise<SafeStorageStatus>;
    encryptSecret: (keyId: string, plaintext: string) => Promise<{ success: boolean; error?: string }>;
    decryptSecret: (keyId: string) => Promise<{ plaintext?: string; error?: string }>;
    deleteSecret: (keyId: string) => Promise<{ success: boolean }>;
  };
  storage: {
    queryFts: (query: string, limit?: number) => Promise<FtsSearchResult[]>;
    putRecord: (collection: string, record: StorageRecord) => Promise<{ success: boolean }>;
    getRecord: (collection: string, id: string) => Promise<StorageRecord | null>;
    deleteRecord: (collection: string, id: string) => Promise<{ success: boolean }>;
    saveBlob: (hash: string, dataBase64: string, mimeType: string) => Promise<{ path: string; size: number }>;
    readBlob: (hash: string) => Promise<{ dataBase64: string; mimeType: string } | null>;
  };
  pcOperator: {
    listWindows: () => Promise<PCOperatorWindowTarget[]>;
    executeAction: (request: PCOperatorActionRequest) => Promise<PCOperatorActionResult>;
  };
}

declare global {
  interface Window {
    electronAPI?: BlaizeElectronAPI;
  }
}

/**
 * Typed IPC Contracts & Runtime Zod Schemas for Blaize Electron Desktop Shell
 *
 * Every IPC channel is a strict security boundary:
 * - Validated at runtime with Zod schemas for both request and response payloads.
 * - Annotated with risk class, preload namespace/method mapping, and frame requirements.
 * - Never exposes raw `ipcRenderer`, `fs`, `child_process`, or unrestricted `shell` APIs.
 */

import { z } from 'zod';
import type { ExecutionTruthState, GenericRiskClass } from '../src/packages/contracts/index.js';

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
  selectedBackend:
    | 'gnome_libsecret'
    | 'kwallet'
    | 'kwallet5'
    | 'kwallet6'
    | 'basic_text'
    | 'unknown'
    | 'macos_keychain'
    | 'windows_dpapi';
  isEncrypted: boolean;
  warning?: string;
}

export interface PCOperatorWindowTarget {
  id: string;
  title: string;
  processName: string;
  bounds: { x: number; y: number; width: number; height: number };
  isFocused: boolean;
  elements?: Array<{ id: string; role: string; name: string; bounds: { x: number; y: number; width: number; height: number }; supportedActions: string[] }>;
}

export interface PCOperatorActionRequest {
  actionId: string;
  type: 'click' | 'type' | 'scroll' | 'key' | 'navigate';
  targetWindowId?: string;
  targetElementId?: string;
  coordinates?: { x: number; y: number };
  text?: string;
  key?: string;
  deltaY?: number;
  /** Renderer confirmation is advisory only; the main process enforces its own approval token. */
  requiresConfirmation: boolean;
  approvalToken?: string;
}

export interface PCOperatorActionResult {
  success: boolean;
  actionId: string;
  executionState?: ExecutionTruthState;
  isSimulated?: boolean;
  message?: string;
  targetWindowVerified: boolean;
  timestamp: number;
}

export interface PCOperatorActionApprovalResult {
  approved: boolean;
  approvalToken?: string;
  message: string;
}

export interface RecordingPrivacyRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface RecordingPrivacyState {
  available: boolean;
  mode: 'clear' | 'blur_regions' | 'blur_window' | 'blur_all';
  capturedAtMs: number;
  displayBounds?: { x: number; y: number; width: number; height: number };
  regions: RecordingPrivacyRegion[];
  windowLabel?: string;
  reason: string;
}

export interface DesktopLifecycleState {
  singleInstanceLockHeld: boolean;
  isReady: boolean;
  isShuttingDown: boolean;
  userDataDir: string;
  logsDir: string;
  crashesDir: string;
  updatesStagingDir: string;
  sqliteDbPath: string;
  sqliteIntegrityOk: boolean;
  startupErrors: string[];
}

export interface DesktopShellCapabilities {
  executionState: ExecutionTruthState;
  traySupported: boolean;
  trayActive: boolean;
  floatingCompanionSupported: boolean;
  floatingCompanionVisible: boolean;
  globalShortcutSupported: boolean;
  registeredShortcuts: string[];
  reason?: string;
}

export interface StageUpdateRequest {
  version: string;
  bundlePath: string;
  expectedSha256Hex: string;
  signatureBase64: string;
  publicKeyPem: string;
}

export interface StageUpdateResult {
  staged: boolean;
  executionState: ExecutionTruthState;
  stagedPath?: string;
  errorCode?: string;
  message: string;
}

export interface CrashReportRequest {
  source: 'renderer' | 'main' | 'preload';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface CrashReportResult {
  recorded: boolean;
  reportId: string;
  redactedFilePath?: string;
  redactedMessage: string;
}

// ============================================================================
// RUNTIME ZOD SCHEMAS FOR EVERY IPC CHANNEL
// ============================================================================

export const VoidOrEmptySchema = z.union([z.undefined(), z.null(), z.object({}).strict()]).optional();

export const StorageRecordSchema = z.object({
  id: z.string().min(1).max(256),
  collection: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const PCOperatorActionRequestSchema = z.object({
  actionId: z.string().min(1).max(128),
  type: z.enum(['click', 'type', 'scroll', 'key', 'navigate']),
  targetWindowId: z.string().max(128).optional(),
  targetElementId: z.string().max(256).optional(),
  coordinates: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .optional(),
  text: z.string().max(4096).optional(),
  key: z.string().max(64).optional(),
  deltaY: z.number().finite().optional(),
  requiresConfirmation: z.boolean(),
});

export const PCOperatorActionExecutionRequestSchema = PCOperatorActionRequestSchema.extend({
  approvalToken: z.string().uuid(),
});


export const StageUpdateRequestSchema = z.object({
  version: z.string().min(1).max(64).regex(/^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/),
  bundlePath: z.string().min(1).max(1024),
  expectedSha256Hex: z.string().regex(/^[a-f0-9]{64}$/i),
  signatureBase64: z.string().min(16).max(4096),
  publicKeyPem: z.string().min(32).max(4096),
});

export const CrashReportRequestSchema = z.object({
  source: z.enum(['renderer', 'main', 'preload']),
  message: z.string().min(1).max(4096),
  stack: z.string().max(16384).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export interface IpcChannelContractSpec<TReq = unknown, TRes = unknown> {
  channel: keyof ElectronIpcChannels;
  preloadNamespace: 'window' | 'system' | 'desktop' | 'vault' | 'storage' | 'pcOperator';
  preloadMethod: string;
  riskClass: GenericRiskClass;
  requiresMainFrame: true;
  reqSchema: z.ZodType<TReq>;
  resSchema: z.ZodType<TRes>;
}

/**
 * IPC Channel Map: channel name -> { req, res }
 */
export interface ElectronIpcChannels {
  // Window controls
  'window:minimize': { req: void; res: void };
  'window:maximize': { req: void; res: { isMaximized: boolean } };
  'window:close': { req: void; res: void };
  'window:is-maximized': { req: void; res: boolean };

  // System, Lifecycle, Crash Reporting & Safe Update Staging
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
  'system:get-lifecycle-state': { req: void; res: DesktopLifecycleState };
  'system:report-crash': { req: CrashReportRequest; res: CrashReportResult };
  'system:stage-update': { req: StageUpdateRequest; res: StageUpdateResult };

  // Desktop Shell (Tray, Floating Companion, Global Shortcut)
  'desktop:get-shell-capabilities': { req: void; res: DesktopShellCapabilities };
  'desktop:set-tray-state': {
    req: { enabled: boolean; tooltip?: string };
    res: DesktopShellCapabilities;
  };
  'desktop:set-floating-companion': {
    req: { visible: boolean };
    res: DesktopShellCapabilities;
  };
  'desktop:register-shortcut': {
    req: { accelerator: string };
    res: DesktopShellCapabilities;
  };

  // SafeStorage / Vault
  'vault:get-backend-status': { req: void; res: SafeStorageStatus };
  'vault:encrypt-secret': {
    req: { keyId: string; plaintext: string };
    res: { success: boolean; error?: string };
  };
  'vault:decrypt-secret': {
    req: { keyId: string };
    res: { plaintext?: string; error?: string };
  };
  'vault:delete-secret': { req: { keyId: string }; res: { success: boolean } };

  // Durable SQLite & FTS5 Search
  'storage:query-fts': { req: { query: string; limit?: number }; res: FtsSearchResult[] };
  'storage:put-record': {
    req: { collection: string; record: StorageRecord };
    res: { success: boolean };
  };
  'storage:get-record': {
    req: { collection: string; id: string };
    res: StorageRecord | null;
  };
  'storage:delete-record': {
    req: { collection: string; id: string };
    res: { success: boolean };
  };
  'storage:save-blob': {
    req: { hash: string; dataBase64: string; mimeType: string };
    res: { path: string; size: number };
  };
  'storage:read-blob': {
    req: { hash: string };
    res: { dataBase64: string; mimeType: string } | null;
  };
  'storage:delete-blob': { req: { hash: string }; res: { success: boolean } };

  // PC Operator (Desktop control)
  'pc-operator:list-windows': { req: void; res: PCOperatorWindowTarget[] };
  'pc-operator:approve-action': { req: PCOperatorActionRequest; res: PCOperatorActionApprovalResult };
  'pc-operator:execute-action': { req: PCOperatorActionRequest & { approvalToken: string }; res: PCOperatorActionResult };
  'pc-operator:get-recording-privacy': { req: void; res: RecordingPrivacyState };
}

export const IPC_CONTRACT_MANIFEST: Record<
  keyof ElectronIpcChannels,
  IpcChannelContractSpec<any, any>
> = {
  'window:minimize': {
    channel: 'window:minimize',
    preloadNamespace: 'window',
    preloadMethod: 'minimize',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.undefined(),
  },
  'window:maximize': {
    channel: 'window:maximize',
    preloadNamespace: 'window',
    preloadMethod: 'maximize',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.object({ isMaximized: z.boolean() }),
  },
  'window:close': {
    channel: 'window:close',
    preloadNamespace: 'window',
    preloadMethod: 'close',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.undefined(),
  },
  'window:is-maximized': {
    channel: 'window:is-maximized',
    preloadNamespace: 'window',
    preloadMethod: 'isMaximized',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.boolean(),
  },
  'system:get-metrics': {
    channel: 'system:get-metrics',
    preloadNamespace: 'system',
    preloadMethod: 'getMetrics',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.object({
      rssBytes: z.number(),
      heapTotalBytes: z.number(),
      heapUsedBytes: z.number(),
      externalBytes: z.number(),
      uptimeSeconds: z.number(),
      cpuPercent: z.number().optional(),
      electronAppMetrics: z
        .array(
          z.object({
            pid: z.number(),
            type: z.string(),
            memoryKb: z.number(),
          })
        )
        .optional(),
    }),
  },
  'system:get-platform-info': {
    channel: 'system:get-platform-info',
    preloadNamespace: 'system',
    preloadMethod: 'getPlatformInfo',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.object({
      platform: z.enum(['linux', 'darwin', 'win32']),
      arch: z.string(),
      nodeVersion: z.string(),
      electronVersion: z.string(),
      isHeadless: z.boolean(),
    }),
  },
  'system:get-lifecycle-state': {
    channel: 'system:get-lifecycle-state',
    preloadNamespace: 'system',
    preloadMethod: 'getLifecycleState',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.object({
      singleInstanceLockHeld: z.boolean(),
      isReady: z.boolean(),
      isShuttingDown: z.boolean(),
      userDataDir: z.string(),
      logsDir: z.string(),
      crashesDir: z.string(),
      updatesStagingDir: z.string(),
      sqliteDbPath: z.string(),
      sqliteIntegrityOk: z.boolean(),
      startupErrors: z.array(z.string()),
    }),
  },
  'system:report-crash': {
    channel: 'system:report-crash',
    preloadNamespace: 'system',
    preloadMethod: 'reportCrash',
    riskClass: 'scoped_write',
    requiresMainFrame: true,
    reqSchema: CrashReportRequestSchema,
    resSchema: z.object({
      recorded: z.boolean(),
      reportId: z.string(),
      redactedFilePath: z.string().optional(),
      redactedMessage: z.string(),
    }),
  },
  'system:stage-update': {
    channel: 'system:stage-update',
    preloadNamespace: 'system',
    preloadMethod: 'stageUpdate',
    riskClass: 'software_installation',
    requiresMainFrame: true,
    reqSchema: StageUpdateRequestSchema,
    resSchema: z.object({
      staged: z.boolean(),
      executionState: z.string(),
      stagedPath: z.string().optional(),
      errorCode: z.string().optional(),
      message: z.string(),
    }),
  },
  'desktop:get-shell-capabilities': {
    channel: 'desktop:get-shell-capabilities',
    preloadNamespace: 'desktop',
    preloadMethod: 'getShellCapabilities',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.object({
      executionState: z.string(),
      traySupported: z.boolean(),
      trayActive: z.boolean(),
      floatingCompanionSupported: z.boolean(),
      floatingCompanionVisible: z.boolean(),
      globalShortcutSupported: z.boolean(),
      registeredShortcuts: z.array(z.string()),
      reason: z.string().optional(),
    }),
  },
  'desktop:set-tray-state': {
    channel: 'desktop:set-tray-state',
    preloadNamespace: 'desktop',
    preloadMethod: 'setTrayState',
    riskClass: 'system_privilege',
    requiresMainFrame: true,
    reqSchema: z.object({
      enabled: z.boolean(),
      tooltip: z.string().max(128).optional(),
    }),
    resSchema: z.object({
      executionState: z.string(),
      traySupported: z.boolean(),
      trayActive: z.boolean(),
      floatingCompanionSupported: z.boolean(),
      floatingCompanionVisible: z.boolean(),
      globalShortcutSupported: z.boolean(),
      registeredShortcuts: z.array(z.string()),
      reason: z.string().optional(),
    }),
  },
  'desktop:set-floating-companion': {
    channel: 'desktop:set-floating-companion',
    preloadNamespace: 'desktop',
    preloadMethod: 'setFloatingCompanion',
    riskClass: 'system_privilege',
    requiresMainFrame: true,
    reqSchema: z.object({
      visible: z.boolean(),
    }),
    resSchema: z.object({
      executionState: z.string(),
      traySupported: z.boolean(),
      trayActive: z.boolean(),
      floatingCompanionSupported: z.boolean(),
      floatingCompanionVisible: z.boolean(),
      globalShortcutSupported: z.boolean(),
      registeredShortcuts: z.array(z.string()),
      reason: z.string().optional(),
    }),
  },
  'desktop:register-shortcut': {
    channel: 'desktop:register-shortcut',
    preloadNamespace: 'desktop',
    preloadMethod: 'registerGlobalShortcut',
    riskClass: 'system_privilege',
    requiresMainFrame: true,
    reqSchema: z.object({
      accelerator: z.string().min(1).max(64).regex(/^[a-zA-Z0-9+_-]+$/),
    }),
    resSchema: z.object({
      executionState: z.string(),
      traySupported: z.boolean(),
      trayActive: z.boolean(),
      floatingCompanionSupported: z.boolean(),
      floatingCompanionVisible: z.boolean(),
      globalShortcutSupported: z.boolean(),
      registeredShortcuts: z.array(z.string()),
      reason: z.string().optional(),
    }),
  },
  'vault:get-backend-status': {
    channel: 'vault:get-backend-status',
    preloadNamespace: 'vault',
    preloadMethod: 'getBackendStatus',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.object({
      isAvailable: z.boolean(),
      selectedBackend: z.enum([
        'gnome_libsecret',
        'kwallet',
        'kwallet5',
        'kwallet6',
        'basic_text',
        'unknown',
        'macos_keychain',
        'windows_dpapi',
      ]),
      isEncrypted: z.boolean(),
      warning: z.string().optional(),
    }),
  },
  'vault:encrypt-secret': {
    channel: 'vault:encrypt-secret',
    preloadNamespace: 'vault',
    preloadMethod: 'encryptSecret',
    riskClass: 'credential',
    requiresMainFrame: true,
    reqSchema: z.object({
      keyId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/),
      plaintext: z.string().min(1).max(8192),
    }),
    resSchema: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'vault:decrypt-secret': {
    channel: 'vault:decrypt-secret',
    preloadNamespace: 'vault',
    preloadMethod: 'decryptSecret',
    riskClass: 'credential',
    requiresMainFrame: true,
    reqSchema: z.object({
      keyId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/),
    }),
    resSchema: z.object({
      plaintext: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'vault:delete-secret': {
    channel: 'vault:delete-secret',
    preloadNamespace: 'vault',
    preloadMethod: 'deleteSecret',
    riskClass: 'credential',
    requiresMainFrame: true,
    reqSchema: z.object({
      keyId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/),
    }),
    resSchema: z.object({
      success: z.boolean(),
    }),
  },
  'storage:query-fts': {
    channel: 'storage:query-fts',
    preloadNamespace: 'storage',
    preloadMethod: 'queryFts',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: z.object({
      query: z.string().max(512),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    resSchema: z.array(
      z.object({
        id: z.string(),
        collection: z.string(),
        snippet: z.string(),
        rank: z.number(),
      })
    ),
  },
  'storage:put-record': {
    channel: 'storage:put-record',
    preloadNamespace: 'storage',
    preloadMethod: 'putRecord',
    riskClass: 'scoped_write',
    requiresMainFrame: true,
    reqSchema: z.object({
      collection: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/),
      record: StorageRecordSchema,
    }),
    resSchema: z.object({
      success: z.boolean(),
    }),
  },
  'storage:get-record': {
    channel: 'storage:get-record',
    preloadNamespace: 'storage',
    preloadMethod: 'getRecord',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: z.object({
      collection: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/),
      id: z.string().min(1).max(256),
    }),
    resSchema: StorageRecordSchema.nullable(),
  },
  'storage:delete-record': {
    channel: 'storage:delete-record',
    preloadNamespace: 'storage',
    preloadMethod: 'deleteRecord',
    riskClass: 'scoped_write',
    requiresMainFrame: true,
    reqSchema: z.object({
      collection: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/),
      id: z.string().min(1).max(256),
    }),
    resSchema: z.object({
      success: z.boolean(),
    }),
  },
  'storage:save-blob': {
    channel: 'storage:save-blob',
    preloadNamespace: 'storage',
    preloadMethod: 'saveBlob',
    riskClass: 'scoped_write',
    requiresMainFrame: true,
    reqSchema: z.object({
      hash: z.string().regex(/^[a-f0-9]{64}$/i),
      dataBase64: z.string().min(1).max(16 * 1024 * 1024),
      mimeType: z.string().min(1).max(128),
    }),
    resSchema: z.object({
      path: z.string(),
      size: z.number().int().nonnegative(),
    }),
  },
  'storage:read-blob': {
    channel: 'storage:read-blob',
    preloadNamespace: 'storage',
    preloadMethod: 'readBlob',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: z.object({
      hash: z.string().regex(/^[a-f0-9]{64}$/i),
    }),
    resSchema: z
      .object({
        dataBase64: z.string(),
        mimeType: z.string(),
      })
      .nullable(),
  },
  'storage:delete-blob': {
    channel: 'storage:delete-blob',
    preloadNamespace: 'storage',
    preloadMethod: 'deleteBlob',
    riskClass: 'scoped_write',
    requiresMainFrame: true,
    reqSchema: z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/i) }),
    resSchema: z.object({ success: z.boolean() }),
  },
  'pc-operator:list-windows': {
    channel: 'pc-operator:list-windows',
    preloadNamespace: 'pcOperator',
    preloadMethod: 'listWindows',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        processName: z.string(),
        bounds: z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }),
        isFocused: z.boolean(),
        elements: z.array(z.object({
          id: z.string(),
          role: z.string(),
          name: z.string(),
          bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
          supportedActions: z.array(z.string()),
        })).optional(),
      })
    ),
  },
  'pc-operator:approve-action': {
    channel: 'pc-operator:approve-action',
    preloadNamespace: 'pcOperator',
    preloadMethod: 'approveAction',
    riskClass: 'system_privilege',
    requiresMainFrame: true,
    reqSchema: PCOperatorActionRequestSchema,
    resSchema: z.object({ approved: z.boolean(), approvalToken: z.string().uuid().optional(), message: z.string() }),
  },
  'pc-operator:execute-action': {
    channel: 'pc-operator:execute-action',
    preloadNamespace: 'pcOperator',
    preloadMethod: 'executeAction',
    riskClass: 'system_privilege',
    requiresMainFrame: true,
    reqSchema: PCOperatorActionExecutionRequestSchema,
    resSchema: z.object({
      success: z.boolean(),
      actionId: z.string(),
      executionState: z.string().optional(),
      isSimulated: z.boolean().optional(),
      message: z.string().optional(),
      targetWindowVerified: z.boolean(),
      timestamp: z.number(),
    }),
  },
  'pc-operator:get-recording-privacy': {
    channel: 'pc-operator:get-recording-privacy',
    preloadNamespace: 'pcOperator',
    preloadMethod: 'getRecordingPrivacyState',
    riskClass: 'read',
    requiresMainFrame: true,
    reqSchema: VoidOrEmptySchema,
    resSchema: z.object({
      available: z.boolean(),
      mode: z.enum(['clear', 'blur_regions', 'blur_window', 'blur_all']),
      capturedAtMs: z.number(),
      displayBounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
      regions: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), label: z.string() })),
      windowLabel: z.string().optional(),
      reason: z.string(),
    }),
  },
};

export function validateIpcRequestPayload<K extends keyof ElectronIpcChannels>(
  channel: K,
  rawPayload: unknown
): { ok: true; data: ElectronIpcChannels[K]['req'] } | { ok: false; error: string } {
  const spec = IPC_CONTRACT_MANIFEST[channel];
  if (!spec) {
    return { ok: false, error: `Unknown or unregistered IPC channel '${String(channel)}'.` };
  }
  const parsed = spec.reqSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `IPC request schema validation failed for '${String(channel)}': ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
    };
  }
  return { ok: true, data: parsed.data };
}

export function validateIpcResponsePayload<K extends keyof ElectronIpcChannels>(
  channel: K,
  rawResponse: unknown
): { ok: true; data: ElectronIpcChannels[K]['res'] } | { ok: false; error: string } {
  const spec = IPC_CONTRACT_MANIFEST[channel];
  if (!spec) {
    return { ok: false, error: `Unknown or unregistered IPC channel '${String(channel)}'.` };
  }
  const parsed = spec.resSchema.safeParse(rawResponse);
  if (!parsed.success) {
    return {
      ok: false,
      error: `IPC response schema validation failed for '${String(channel)}': ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Interface exposed on `window.electronAPI` via ContextBridge
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
    getLifecycleState: () => Promise<DesktopLifecycleState>;
    reportCrash: (req: CrashReportRequest) => Promise<CrashReportResult>;
    stageUpdate: (req: StageUpdateRequest) => Promise<StageUpdateResult>;
    onPowerEvent: (
      callback: (event: 'suspend' | 'resume' | 'lock' | 'unlock') => void
    ) => () => void;
  };
  desktop: {
    getShellCapabilities: () => Promise<DesktopShellCapabilities>;
    setTrayState: (enabled: boolean, tooltip?: string) => Promise<DesktopShellCapabilities>;
    setFloatingCompanion: (visible: boolean) => Promise<DesktopShellCapabilities>;
    registerGlobalShortcut: (accelerator: string) => Promise<DesktopShellCapabilities>;
  };
  vault: {
    getBackendStatus: () => Promise<SafeStorageStatus>;
    encryptSecret: (
      keyId: string,
      plaintext: string
    ) => Promise<{ success: boolean; error?: string }>;
    decryptSecret: (keyId: string) => Promise<{ plaintext?: string; error?: string }>;
    deleteSecret: (keyId: string) => Promise<{ success: boolean }>;
  };
  storage: {
    queryFts: (query: string, limit?: number) => Promise<FtsSearchResult[]>;
    putRecord: (collection: string, record: StorageRecord) => Promise<{ success: boolean }>;
    getRecord: (collection: string, id: string) => Promise<StorageRecord | null>;
    deleteRecord: (collection: string, id: string) => Promise<{ success: boolean }>;
    saveBlob: (
      hash: string,
      dataBase64: string,
      mimeType: string
    ) => Promise<{ path: string; size: number }>;
    readBlob: (hash: string) => Promise<{ dataBase64: string; mimeType: string } | null>;
    deleteBlob: (hash: string) => Promise<{ success: boolean }>;
  };
  pcOperator: {
    listWindows: () => Promise<PCOperatorWindowTarget[]>;
    approveAction: (request: PCOperatorActionRequest) => Promise<PCOperatorActionApprovalResult>;
    executeAction: (request: PCOperatorActionRequest & { approvalToken: string }) => Promise<PCOperatorActionResult>;
    getRecordingPrivacyState: () => Promise<RecordingPrivacyState>;
  };
}

declare global {
  interface Window {
    electronAPI?: BlaizeElectronAPI;
    __BLAIZE_BOOTSTRAP_SNAPSHOT__?: unknown;
    __BLAIZE_BOOTSTRAP_PREFS__?: Record<string, unknown>;
    __BLAIZE_BOOTSTRAP_ACTIVE_RECORDING__?: unknown;
    __BLAIZE_BOOTSTRAP_RECORDED_SKILLS__?: unknown;
    __BLAIZE_BOOTSTRAP_ARTIFACTS__?: unknown;
    __BLAIZE_BOOTSTRAP_CHARACTER_PACK__?: unknown;
    __BLAIZE_RUNTIME_PREFS__?: Record<string, unknown>;
  }
}

/**
 * Blaize Electron Main Process (`electron/main.ts`)
 *
 * Implements the hardened privileged desktop host environment:
 * 1. Hardened BrowserWindow defaults (sandbox, contextIsolation, nodeIntegration: false,
 *    webSecurity: true, restrictive CSP, navigation allowlist, default-deny permissions,
 *    and validated HTTPS-only external link handling).
 * 2. Strict IPC security boundary: sender main-frame & origin verification + Zod request/response
 *    schema validation + PolicyEngine authorization on every channel in `IPC_CONTRACT_MANIFEST`.
 * 3. Durable SQLite database (`DurableSqliteDatabase` with WAL + FTS5) as the sole source of truth
 *    (zero volatile Maps for records, FTS index, blobs, or secrets).
 * 4. Full desktop lifecycle: single-instance lock, `0o700` app data directories, startup failure
 *    capture, local redacted crash reporting, Ed25519 + SHA-256 verified update staging, and
 *    graceful shutdown with WAL checkpointing.
 * 5. Honest Tray, Floating Companion, and Global Shortcut wiring (real Electron APIs when display
 *    server is active; `UNSUPPORTED` when headless or unavailable).
 */

import * as electronPkg from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  IPC_CONTRACT_MANIFEST,
  validateIpcRequestPayload,
  validateIpcResponsePayload,
  type ElectronIpcChannels,
  type SystemMetrics,
  type SafeStorageStatus,
  type StorageRecord,
  type FtsSearchResult,
  type PCOperatorWindowTarget,
  type PCOperatorActionRequest,
  type PCOperatorActionResult,
  type PCOperatorActionApprovalResult,
  type RecordingPrivacyState,
  type DesktopLifecycleState,
  type DesktopShellCapabilities,
  type CrashReportRequest,
  type CrashReportResult,
  type StageUpdateRequest,
  type StageUpdateResult,
} from './ipc-contracts.js';
import { DurableSqliteDatabase } from '../src/packages/storage/sqlite_db.js';
import {
  canonicalizeAndValidateUrl,
  globalPolicyEngine,
  redactSensitiveText,
} from '../src/packages/trust/index.js';
import { LinuxDesktopDriver } from '../src/packages/pc_operator/linux_driver.js';
import { WindowsDesktopDriver } from '../src/packages/pc_operator/windows_driver.js';
import { MacOSDesktopDriver } from '../src/packages/pc_operator/macos_driver.js';
import { OneTimeActionApprovalVault } from '../src/packages/pc_operator/action_approval.js';
import { SENSITIVE_CONTROL_PATTERN, SENSITIVE_WINDOW_PATTERN, isSensitiveAccessibleValue } from '../src/packages/recorder/privacy_detector.js';

function redactSecretsFromText(raw: string): string {
  const base = redactSensitiveText(raw).redacted;
  return base
    .replace(/sk-[a-zA-Z0-9-_]{16,}/g, '[REDACTED_API_KEY]')
    .replace(/ghp_[a-zA-Z0-9]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]');
}

const { app, BrowserWindow, ipcMain, safeStorage, powerMonitor, session, shell, Tray, Menu, globalShortcut, nativeImage, desktopCapturer, dialog, screen } =
  (electronPkg as any) || {};

const CURRENT_DIR =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.resolve(process.cwd(), 'electron');

let desktopBackendServer: any = null;
let desktopBackendOrigin = '';

/** Starts the existing Express/Vite application inside the Electron main process. */
export async function startEmbeddedBackend(): Promise<string> {
  if (desktopBackendServer && desktopBackendOrigin) return desktopBackendOrigin + '/';

  const appRoot = typeof app?.getAppPath === 'function' ? app.getAppPath() : path.resolve(CURRENT_DIR, '..');
  process.env.BLAIZE_APP_ROOT = appRoot;
  process.env.BLAIZE_DIST_DIR = path.resolve(appRoot, 'dist');
  process.env.BLAIZE_USER_DATA_DIR = app?.getPath?.('userData') || path.join(os.homedir(), '.blaize');
  process.env.BLAIZE_SERVER_HOST = '127.0.0.1';
  process.env.BLAIZE_ELECTRON_MODE = '1';
  process.env.NODE_ENV = app?.isPackaged ? 'production' : (process.env.NODE_ENV || 'development');

  const backendPath = path.join(CURRENT_DIR, 'server.mjs');
  if (!fs.existsSync(backendPath)) {
    throw new Error('Embedded backend bundle is missing: ' + backendPath + '. Run desktop:build first.');
  }
  const backendModule = await import(pathToFileURL(backendPath).href);
  if (typeof backendModule.createBlaizeServer !== 'function') {
    throw new Error('Embedded backend does not export createBlaizeServer().');
  }

  const expressApp = await backendModule.createBlaizeServer();
  const server = expressApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Embedded backend did not bind to a TCP loopback port.');
  }

  desktopBackendServer = server;
  desktopBackendOrigin = 'http://127.0.0.1:' + address.port;

  // Confirm that the server is actually serving its health endpoint before opening UI.
  const health = await fetch(desktopBackendOrigin + '/api/health');
  if (!health.ok) {
    server.close();
    desktopBackendServer = null;
    desktopBackendOrigin = '';
    throw new Error('Embedded backend health check failed with HTTP ' + health.status + '.');
  }
  return desktopBackendOrigin + '/';
}

// ============================================================================
// 1. HARDENED SECURITY CONSTANTS & NAVIGATION / PERMISSION GUARDS
// ============================================================================

export const HARDENED_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  spellcheck: false,
});

export const RESTRICTIVE_CSP_HEADER =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' ws://127.0.0.1:* https://api.meta.ai; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "frame-ancestors 'none'; " +
  "form-action 'self'";

export const ALLOWED_DEV_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'app://blaize',
]);

export function isHeadlessEnvironment(): boolean {
  if (process.platform === 'linux') {
    return !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  }
  return false;
}

/**
 * Validates whether a renderer URL is an authorized navigation/IPC origin.
 * Allows only localhost:3000 dev server, `app://blaize`, or the packaged `dist/index.html` file.
 */
export function isAllowedNavigationOrigin(
  rawUrl: string,
  allowedDistRoot: string = path.resolve(CURRENT_DIR, '..', 'dist')
): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return ALLOWED_DEV_ORIGINS.has(parsed.origin) || Boolean(desktopBackendOrigin && parsed.origin === desktopBackendOrigin);
    }
    if (parsed.protocol === 'app:') {
      return parsed.origin === 'app://blaize' || parsed.host === 'blaize';
    }
    if (parsed.protocol === 'file:') {
      const filePath = path.resolve(decodeURIComponent(parsed.pathname));
      const normalizedRoot = path.resolve(allowedDistRoot);
      return (
        filePath === normalizedRoot ||
        filePath.startsWith(normalizedRoot + path.sep)
      );
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Default-deny permission handler for Electron `session.setPermissionRequestHandler`.
 */
export function evaluatePermissionRequest(
  permission: string,
  requestingUrl: string,
  allowedDistRoot?: string
): boolean {
  if (!isAllowedNavigationOrigin(requestingUrl, allowedDistRoot)) {
    return false;
  }
  // Only clipboard-sanitized-write is allowed by default; camera/mic/geolocation/usb/hid/etc. are denied
  if (permission === 'clipboard-sanitized-write') {
    return true;
  }
  return false;
}

/**
 * Validates external link requests (`setWindowOpenHandler`).
 * Never opens a new Electron BrowserWindow; only permits canonical HTTPS URLs via OS browser.
 */
export function evaluateExternalLinkRequest(rawUrl: string): {
  allowBrowserOpen: boolean;
  canonicalUrl?: string;
  reason: string;
} {
  const check = canonicalizeAndValidateUrl(rawUrl, { requireHttpHttps: true });
  if (!check.valid || !check.canonicalUrl) {
    return {
      allowBrowserOpen: false,
      reason: check.rejectionReason || 'Blocked invalid external URL.',
    };
  }
  if (!check.canonicalUrl.startsWith('https://')) {
    return {
      allowBrowserOpen: false,
      reason: 'Only HTTPS external links may be opened in the system browser.',
    };
  }
  return {
    allowBrowserOpen: true,
    canonicalUrl: check.canonicalUrl,
    reason: 'Validated HTTPS external URL.',
  };
}

export interface IpcSenderEventLike {
  sender?: {
    id?: number;
    isDestroyed?: () => boolean;
    getURL?: () => string;
    mainFrame?: { routingId?: number; frameId?: number; url?: string };
  };
  senderFrame?: {
    routingId?: number;
    frameId?: number;
    url?: string;
    parent?: unknown | null;
  } | null;
  frameId?: number;
}

/**
 * Validates that an IPC message originated from the primary, non-destroyed main frame
 * of an authorized Blaize origin. Rejects subframes, iframes, and untrusted URLs.
 */
export function validateIpcSender(
  event: IpcSenderEventLike,
  allowedDistRoot?: string
): { valid: boolean; reason?: string; senderUrl?: string } {
  if (!event || !event.sender) {
    return { valid: false, reason: 'UNTRUSTED_IPC_SENDER_MISSING: Missing event.sender.' };
  }
  if (typeof event.sender.isDestroyed === 'function' && event.sender.isDestroyed()) {
    return { valid: false, reason: 'UNTRUSTED_IPC_SENDER_DESTROYED: Sender webContents is destroyed.' };
  }

  // Reject any subframe / iframe sender
  if (event.senderFrame) {
    if (event.senderFrame.parent !== undefined && event.senderFrame.parent !== null) {
      return {
        valid: false,
        reason: 'UNTRUSTED_IPC_SUBFRAME_REJECTED: IPC calls from child iframes/subframes are forbidden.',
      };
    }
    if (
      event.sender.mainFrame &&
      event.senderFrame !== event.sender.mainFrame &&
      event.senderFrame.routingId !== undefined &&
      event.sender.mainFrame.routingId !== undefined &&
      event.senderFrame.routingId !== event.sender.mainFrame.routingId
    ) {
      return {
        valid: false,
        reason: 'UNTRUSTED_IPC_SUBFRAME_REJECTED: Sender frame does not match mainFrame.',
      };
    }
  }

  const senderUrl =
    event.senderFrame?.url ||
    (typeof event.sender.getURL === 'function' ? event.sender.getURL() : '') ||
    event.sender.mainFrame?.url ||
    '';

  if (!isAllowedNavigationOrigin(senderUrl, allowedDistRoot)) {
    return {
      valid: false,
      senderUrl,
      reason: `UNTRUSTED_IPC_ORIGIN_REJECTED: Origin '${senderUrl || '<empty>'}' is not in the navigation allowlist.`,
    };
  }

  return { valid: true, senderUrl };
}

// ============================================================================
// 2. DESKTOP LIFECYCLE, APP DATA DIRECTORIES & DURABLE SQLITE STORAGE
// ============================================================================

let mainWindow: any = null;
let floatingCompanionWindow: any = null;
let systemTray: any = null;
let desktopDurableDb: DurableSqliteDatabase | null = null;
let singleInstanceLockHeld = false;
let isReady = false;
let isShuttingDown = false;
const startupErrors: string[] = [];
const registeredShortcuts = new Set<string>();

const nativeActionApprovalVault = new OneTimeActionApprovalVault();
let selectedCaptureDisplayId: string | null = null;
let recorderRetentionSweepTimer: ReturnType<typeof setInterval> | null = null;

export interface DesktopDirectories {
  userDataDir: string;
  logsDir: string;
  crashesDir: string;
  updatesStagingDir: string;
  sqliteDbPath: string;
}

let activeDirectories: DesktopDirectories | null = null;

export function initializeDesktopDirectories(customBaseDir?: string): DesktopDirectories {
  const baseDir =
    customBaseDir ||
    process.env.BLAIZE_USER_DATA_DIR ||
    (app && typeof app.getPath === 'function'
      ? app.getPath('userData')
      : path.join(os.tmpdir(), 'blaize-desktop-userdata'));

  const logsDir = path.join(baseDir, 'logs');
  const crashesDir = path.join(baseDir, 'crashes');
  const updatesStagingDir = path.join(baseDir, 'updates-staging');
  const sqliteDbPath = path.join(baseDir, 'blaize.sqlite');

  for (const dir of [baseDir, logsDir, crashesDir, updatesStagingDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  activeDirectories = {
    userDataDir: baseDir,
    logsDir,
    crashesDir,
    updatesStagingDir,
    sqliteDbPath,
  };

  if (!desktopDurableDb) {
    desktopDurableDb = new DurableSqliteDatabase(sqliteDbPath);
  }

  return activeDirectories;
}

export function getDesktopDurableDb(): DurableSqliteDatabase {
  if (!desktopDurableDb) {
    initializeDesktopDirectories();
  }
  return desktopDurableDb!;
}

export function resetDesktopHostForTesting(customBaseDir?: string): DesktopDirectories {
  if (desktopDurableDb) {
    try {
      desktopDurableDb.close();
    } catch {
      // ignore
    }
    desktopDurableDb = null;
  }
  registeredShortcuts.clear();
  nativeActionApprovalVault.clear();
  selectedCaptureDisplayId = null;
  if (recorderRetentionSweepTimer) { clearInterval(recorderRetentionSweepTimer); recorderRetentionSweepTimer = null; }
  startupErrors.length = 0;
  isShuttingDown = false;
  isReady = true;
  singleInstanceLockHeld = true;
  return initializeDesktopDirectories(customBaseDir);
}

/**
 * Acquires the Electron single-instance lock so two desktop instances never corrupt SQLite WAL.
 */
export function acquireSingleInstanceLock(appLike: any = app): boolean {
  if (!appLike || typeof appLike.requestSingleInstanceLock !== 'function') {
    singleInstanceLockHeld = false;
    return false;
  }
  const locked = Boolean(appLike.requestSingleInstanceLock());
  singleInstanceLockHeld = locked;
  if (!locked) {
    if (typeof appLike.quit === 'function') {
      appLike.quit();
    }
    return false;
  }
  if (typeof appLike.on === 'function') {
    appLike.on('second-instance', () => {
      if (mainWindow) {
        if (typeof mainWindow.isMinimized === 'function' && mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        if (typeof mainWindow.focus === 'function') {
          mainWindow.focus();
        }
      }
    });
  }
  return true;
}

/**
 * Writes a local, secret-redacted crash report to `<userData>/crashes/`.
 * Never transmits crash data over the network.
 */
export function recordLocalRedactedCrashReport(req: CrashReportRequest): CrashReportResult {
  const dirs = activeDirectories || initializeDesktopDirectories();
  const reportId = `crash-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const redactedMessage = redactSecretsFromText(req.message);
  const redactedStack = req.stack ? redactSecretsFromText(req.stack) : undefined;
  const redactedContext = req.context
    ? JSON.parse(redactSecretsFromText(JSON.stringify(req.context)))
    : undefined;

  const payload = {
    reportId,
    timestampIso: new Date().toISOString(),
    source: req.source,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    message: redactedMessage,
    stack: redactedStack,
    context: redactedContext,
  };

  const filePath = path.join(dirs.crashesDir, `${reportId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });

  return {
    recorded: true,
    reportId,
    redactedFilePath: filePath,
    redactedMessage,
  };
}

/**
 * Verifies SHA-256 digest and Ed25519 signature of an update bundle before staging it in
 * `<userData>/updates-staging/`. Rejects missing files, hash mismatches, or invalid signatures.
 */
export function stageVerifiedUpdateBundle(req: StageUpdateRequest): StageUpdateResult {
  const dirs = activeDirectories || initializeDesktopDirectories();
  const resolvedSource = path.resolve(req.bundlePath);
  if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) {
    return {
      staged: false,
      executionState: 'FAILED',
      errorCode: 'UPDATE_BUNDLE_NOT_FOUND',
      message: `Update bundle file not found at '${resolvedSource}'.`,
    };
  }

  const bundleBytes = fs.readFileSync(resolvedSource);
  const actualSha256Hex = crypto.createHash('sha256').update(bundleBytes).digest('hex');
  if (actualSha256Hex.toLowerCase() !== req.expectedSha256Hex.toLowerCase()) {
    return {
      staged: false,
      executionState: 'BLOCKED',
      errorCode: 'UPDATE_HASH_MISMATCH',
      message: `Update bundle SHA-256 mismatch (expected ${req.expectedSha256Hex}, computed ${actualSha256Hex}).`,
    };
  }

  try {
    const signatureBytes = Buffer.from(req.signatureBase64, 'base64');
    const verified = crypto.verify(null, bundleBytes, req.publicKeyPem, signatureBytes);
    if (!verified) {
      return {
        staged: false,
        executionState: 'BLOCKED',
        errorCode: 'UPDATE_SIGNATURE_INVALID',
        message: 'Update bundle Ed25519 signature verification failed; staging refused.',
      };
    }
  } catch (err: any) {
    return {
      staged: false,
      executionState: 'BLOCKED',
      errorCode: 'UPDATE_SIGNATURE_INVALID',
      message: `Update signature verification error: ${err?.message || 'invalid key or signature'}.`,
    };
  }

  const stagedPath = path.join(dirs.updatesStagingDir, `blaize-update-${req.version}.bin`);
  fs.copyFileSync(resolvedSource, stagedPath);
  fs.chmodSync(stagedPath, 0o600);

  return {
    staged: true,
    executionState: 'EXECUTED',
    stagedPath,
    message: `Verified SHA-256 and Ed25519 signature for v${req.version}; staged at ${stagedPath}.`,
  };
}

/**
 * Gracefully unregisters shortcuts, closes auxiliary windows/tray, and checkpoints + closes SQLite.
 */
export function gracefulShutdown(): void {
  isShuttingDown = true;
  if (recorderRetentionSweepTimer) { clearInterval(recorderRetentionSweepTimer); recorderRetentionSweepTimer = null; }
  nativeActionApprovalVault.clear();
  try {
    if (globalShortcut && typeof globalShortcut.unregisterAll === 'function') {
      globalShortcut.unregisterAll();
    }
  } catch {
    // ignore
  }
  registeredShortcuts.clear();

  try {
    if (floatingCompanionWindow && typeof floatingCompanionWindow.destroy === 'function') {
      floatingCompanionWindow.destroy();
    }
  } catch {
    // ignore
  }
  floatingCompanionWindow = null;

  try {
    if (systemTray && typeof systemTray.destroy === 'function') {
      systemTray.destroy();
    }
  } catch {
    // ignore
  }
  systemTray = null;

  if (desktopBackendServer) {
    try { desktopBackendServer.close(); } catch { /* ignore shutdown race */ }
    desktopBackendServer = null;
    desktopBackendOrigin = '';
  }

  if (desktopDurableDb) {
    try {
      desktopDurableDb.close();
    } catch {
      // ignore
    }
    desktopDurableDb = null;
  }
}

// ============================================================================
// 3. SAFESTORAGE VERIFICATION (FAIL-CLOSED ON LINUX BASIC_TEXT)
// ============================================================================

export function verifySafeStorage(safeStorageOverride?: any): SafeStorageStatus {
  const targetSafeStorage = safeStorageOverride ?? safeStorage;
  if (!targetSafeStorage || typeof targetSafeStorage.isEncryptionAvailable !== 'function') {
    return {
      isAvailable: false,
      selectedBackend: 'unknown',
      isEncrypted: false,
      warning:
        'Native OS safeStorage is not available in this runtime. Configure Keychain/DPAPI/libsecret or use PassphraseWrapVault.',
    };
  }

  const rawBackend =
    typeof targetSafeStorage.getSelectedStorageBackend === 'function'
      ? targetSafeStorage.getSelectedStorageBackend()
      : 'unknown';

  if (process.platform === 'linux' && rawBackend === 'basic_text') {
    return {
      isAvailable: true,
      selectedBackend: 'basic_text',
      isEncrypted: false,
      warning:
        'Linux storage backend is unencrypted basic_text (no running gnome-keyring/libsecret or kwallet). Blaize fails closed and refuses plaintext secret storage.',
    };
  }

  if (!targetSafeStorage.isEncryptionAvailable()) {
    return {
      isAvailable: false,
      selectedBackend: (rawBackend as SafeStorageStatus['selectedBackend']) || 'unknown',
      isEncrypted: false,
      warning: 'OS safeStorage reports encryption is unavailable. Secret storage refused.',
    };
  }

  return {
    isAvailable: true,
    selectedBackend:
      rawBackend && rawBackend !== 'unknown'
        ? (rawBackend as SafeStorageStatus['selectedBackend'])
        : process.platform === 'darwin'
          ? 'macos_keychain'
          : process.platform === 'win32'
            ? 'windows_dpapi'
            : 'gnome_libsecret',
    isEncrypted: true,
  };
}

// ============================================================================
// 4. HARDENED WINDOW CREATION & DESKTOP SHELL (TRAY / COMPANION / SHORTCUTS)
// ============================================================================

export function getShellCapabilitiesState(): DesktopShellCapabilities {
  const guiAvailable =
    Boolean(app && BrowserWindow && Tray && globalShortcut) && !isHeadlessEnvironment();
  if (!guiAvailable) {
    return {
      executionState: 'UNSUPPORTED',
      traySupported: false,
      trayActive: false,
      floatingCompanionSupported: false,
      floatingCompanionVisible: false,
      globalShortcutSupported: false,
      registeredShortcuts: [],
      reason:
        'UNSUPPORTED: Native system tray, floating companion window, and global shortcuts require an active desktop GUI display server.',
    };
  }
  return {
    executionState: 'EXECUTED',
    traySupported: true,
    trayActive: Boolean(systemTray),
    floatingCompanionSupported: true,
    floatingCompanionVisible: Boolean(
      floatingCompanionWindow &&
        typeof floatingCompanionWindow.isVisible === 'function' &&
        floatingCompanionWindow.isVisible()
    ),
    globalShortcutSupported: true,
    registeredShortcuts: Array.from(registeredShortcuts),
  };
}

export function createWindow(startUrlOverride?: string): any {
  if (!BrowserWindow) return null;

  const preloadPath = fs.existsSync(path.join(CURRENT_DIR, 'preload.cjs'))
    ? path.join(CURRENT_DIR, 'preload.cjs')
    : path.join(CURRENT_DIR, 'preload.js');

  const allowedDistRoot = path.resolve(CURRENT_DIR, '..', 'dist');

  if (session?.defaultSession) {
    session.defaultSession.webRequest.onHeadersReceived((details: any, callback: any) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [RESTRICTIVE_CSP_HEADER],
          'X-Content-Type-Options': ['nosniff'],
          'X-Frame-Options': ['DENY'],
        },
      });
    });

    // Secure Electron session authentication mechanism:
    // Attaches X-Blaize-Launch-Token on all internal requests from the renderer session to local server
    if (session.defaultSession.webRequest?.onBeforeSendHeaders) {
      session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ['http://localhost:*/*', 'http://127.0.0.1:*/*', 'http://[::1]:*/*'] },
        (details: any, callback: any) => {
          const requestHeaders = { ...details.requestHeaders };
          let requestOrigin = '';
          try { requestOrigin = new URL(details.url).origin; } catch { /* malformed URL: do not attach token */ }
          if (desktopBackendOrigin && requestOrigin === desktopBackendOrigin) {
            const token = process.env.BLAIZE_LAUNCH_TOKEN;
            if (token) requestHeaders['X-Blaize-Launch-Token'] = token;
          }
          callback({ requestHeaders });
        }
      );
    }

    session.defaultSession.setPermissionRequestHandler(
      (webContents: any, permission: string, callback: (granted: boolean) => void) => {
        const reqUrl = typeof webContents?.getURL === 'function' ? webContents.getURL() : '';
        callback(evaluatePermissionRequest(permission, reqUrl, allowedDistRoot));
      }
    );

    if (typeof session.defaultSession.setPermissionCheckHandler === 'function') {
      session.defaultSession.setPermissionCheckHandler(
        (webContents: any, permission: string, requestingOrigin: string) => {
          const reqUrl =
            requestingOrigin ||
            (typeof webContents?.getURL === 'function' ? webContents.getURL() : '');
          return evaluatePermissionRequest(permission, reqUrl, allowedDistRoot);
        }
      );
    }
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Blaize — The Accountable AI Desktop',
    backgroundColor: '#0a0a0c',
    webPreferences: {
      ...HARDENED_WEB_PREFERENCES,
      // Keep the 10fps privacy compositor and native detector running while the window is minimized
      // or another desktop app is foregrounded for a consented recording session.
      backgroundThrottling: false,
      preload: preloadPath,
    },
  });

  // Navigation allowlist enforcement
  mainWindow.webContents.on('will-navigate', (event: any, targetUrl: string) => {
    if (!isAllowedNavigationOrigin(targetUrl, allowedDistRoot)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('will-redirect', (event: any, targetUrl: string) => {
    if (!isAllowedNavigationOrigin(targetUrl, allowedDistRoot)) {
      event.preventDefault();
    }
  });

  // Safe external link handling: deny new BrowserWindows; open validated HTTPS URLs externally
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    const ext = evaluateExternalLinkRequest(url);
    if (ext.allowBrowserOpen && ext.canonicalUrl && shell?.openExternal) {
      void shell.openExternal(ext.canonicalUrl);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('render-process-gone', (_event: any, details: any) => {
    recordLocalRedactedCrashReport({
      source: 'renderer',
      message: `Renderer process exited (${details?.reason || 'unknown'})`,
      context: { exitCode: details?.exitCode },
    });
  });

  const packagedIndexHtml = path.join(allowedDistRoot, 'index.html');
  const startUrl = startUrlOverride || process.env.VITE_DEV_SERVER_URL || ('file://' + packagedIndexHtml);

  mainWindow.loadURL(startUrl).catch((err: any) => {
    const msg = redactSecretsFromText(err?.message || String(err));
    startupErrors.push(msg);
    recordLocalRedactedCrashReport({
      source: 'main',
      message: `Failed to load startUrl: ${msg}`,
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Keep the 2D companion alive on the desktop when the Blaize main window is closed
    if (floatingCompanionWindow && typeof floatingCompanionWindow.show === 'function') {
      floatingCompanionWindow.show();
    }
  });

  return mainWindow;
}

// ============================================================================
// 5. VALIDATED IPC HANDLER REGISTRY & DISPATCHER
// ============================================================================

type IpcHandlerFn<K extends keyof ElectronIpcChannels> = (
  payload: ElectronIpcChannels[K]['req'],
  event: IpcSenderEventLike
) => Promise<ElectronIpcChannels[K]['res']> | ElectronIpcChannels[K]['res'];

const registeredIpcHandlers = new Map<
  keyof ElectronIpcChannels,
  (event: IpcSenderEventLike, rawPayload?: unknown) => Promise<unknown>
>();

export function getRegisteredIpcChannels(): Array<keyof ElectronIpcChannels> {
  return Array.from(registeredIpcHandlers.keys());
}

/**
 * Invokes a registered IPC channel through the full security boundary:
 * 1. Sender frame & origin validation (`validateIpcSender`)
 * 2. Zod request schema validation (`validateIpcRequestPayload`)
 * 3. Trust Kernel `PolicyEngine` authorization check
 * 4. Handler execution
 * 5. Zod response schema validation (`validateIpcResponsePayload`)
 */
export async function invokeValidatedIpcChannel<K extends keyof ElectronIpcChannels>(
  channel: K,
  event: IpcSenderEventLike,
  rawPayload?: unknown,
  options?: { allowedDistRoot?: string }
): Promise<ElectronIpcChannels[K]['res']> {
  const handler = registeredIpcHandlers.get(channel);
  if (!handler) {
    throw new Error(`UNREGISTERED_IPC_CHANNEL: No handler registered for '${String(channel)}'.`);
  }

  const senderCheck = validateIpcSender(event, options?.allowedDistRoot);
  if (!senderCheck.valid) {
    throw new Error(senderCheck.reason || 'UNTRUSTED_IPC_SENDER');
  }

  return (await handler(event, rawPayload)) as ElectronIpcChannels[K]['res'];
}

function registerChannel<K extends keyof ElectronIpcChannels>(
  channel: K,
  fn: IpcHandlerFn<K>,
  ipcMainOverride?: { handle: (ch: string, listener: (ev: any, arg: any) => any) => void }
): void {
  const spec = IPC_CONTRACT_MANIFEST[channel];
  if (!spec) {
    throw new Error(`Cannot register unknown IPC channel '${String(channel)}'.`);
  }

  const wrapped = async (event: IpcSenderEventLike, rawPayload?: unknown) => {
    const senderCheck = validateIpcSender(event);
    if (!senderCheck.valid) {
      throw new Error(senderCheck.reason || 'UNTRUSTED_IPC_SENDER');
    }

    const reqCheck = validateIpcRequestPayload(channel, rawPayload);
    if (!reqCheck.ok) {
      throw new Error(reqCheck.error);
    }

    // Route non-read IPC channels through central PolicyEngine authorization boundary
    if (spec.riskClass !== 'read') {
      const policyDecision = globalPolicyEngine.evaluateToolCall({
        callerId: `electron-ipc:${senderCheck.senderUrl || 'main-window'}`,
        toolName: `ipc.${String(channel)}`,
        target: `ipc:${String(channel)}`,
        args:
          reqCheck.data && typeof reqCheck.data === 'object'
            ? (reqCheck.data as Record<string, unknown>)
            : {},
        riskClass: spec.riskClass,
        profileId: 'personal',
        isSimulated: false,
      });
      if (!policyDecision.allowed && policyDecision.decision === 'DENY') {
        throw new Error(`IPC_POLICY_DENIED: ${policyDecision.reason}`);
      }
    }

    const rawResult = await fn(reqCheck.data, event);
    const resCheck = validateIpcResponsePayload(channel, rawResult);
    if (!resCheck.ok) {
      throw new Error(resCheck.error);
    }
    return resCheck.data;
  };

  registeredIpcHandlers.set(channel, wrapped);
  const targetIpcMain = ipcMainOverride ?? ipcMain;
  if (targetIpcMain && typeof targetIpcMain.handle === 'function') {
    try {
      if (typeof (targetIpcMain as any).removeHandler === 'function') {
        (targetIpcMain as any).removeHandler(channel);
      }
    } catch {
      // ignore
    }
    targetIpcMain.handle(channel, (ev: any, arg: any) => wrapped(ev, arg));
  }
}


function actionDigest(request: PCOperatorActionRequest): string {
  const canonical = {
    actionId: request.actionId,
    type: request.type,
    targetWindowId: request.targetWindowId || null,
    targetElementId: request.targetElementId || null,
    coordinates: request.coordinates || null,
    text: request.text || null,
    key: request.key || null,
    deltaY: request.deltaY ?? null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function createNativeDesktopDriver(): LinuxDesktopDriver | WindowsDesktopDriver | MacOSDesktopDriver {
  return process.platform === 'win32'
    ? new WindowsDesktopDriver()
    : process.platform === 'darwin' ? new MacOSDesktopDriver() : new LinuxDesktopDriver();
}

function fullFramePrivacyState(reason: string): RecordingPrivacyState {
  return { available: false, mode: 'blur_all', capturedAtMs: Date.now(), regions: [], reason };
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 &&
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * A local, deterministic privacy detector. It never transmits screen contents or labels
 * to a model. Protected applications are masked as a whole; sensitive/editable controls
 * are masked by their native accessibility bounds. Missing/stale native evidence fails closed.
 */
export function captureRecordingPrivacyState(): RecordingPrivacyState {
  try {
    if (isHeadlessEnvironment() || !screen?.getAllDisplays) {
      return fullFramePrivacyState('Native display geometry is unavailable; the entire recording frame is redacted.');
    }
    const displays = screen.getAllDisplays();
    const selectedDisplay = selectedCaptureDisplayId
      ? displays.find((d: any) => String(d.id) === String(selectedCaptureDisplayId))
      : displays.length === 1 ? displays[0] : undefined;
    if (!selectedDisplay) {
      return fullFramePrivacyState('The selected capture display could not be matched to native display geometry.');
    }
    const displayBounds = {
      x: Number(selectedDisplay.bounds?.x), y: Number(selectedDisplay.bounds?.y),
      width: Number(selectedDisplay.bounds?.width), height: Number(selectedDisplay.bounds?.height),
    };
    if (![displayBounds.x, displayBounds.y, displayBounds.width, displayBounds.height].every(Number.isFinite) || displayBounds.width <= 0 || displayBounds.height <= 0) {
      return fullFramePrivacyState('Native display bounds are invalid; the entire recording frame is redacted.');
    }

    const snapshot = createNativeDesktopDriver().capturePerception();
    if (!snapshot || snapshot.isSimulated || Date.now() - snapshot.capturedAtMs > 3000) {
      return fullFramePrivacyState('Fresh, real accessibility evidence is unavailable; the entire recording frame is redacted.');
    }
    if (!Array.isArray(snapshot.windows) || snapshot.windows.length === 0) {
      return fullFramePrivacyState('No native windows were detected; the entire recording frame is redacted.');
    }
    if (!Array.isArray(snapshot.elements) || snapshot.elements.length === 0) {
      return fullFramePrivacyState('The desktop accessibility tree is empty; the entire recording frame is redacted rather than assuming the screen is safe.');
    }
    const regions: RecordingPrivacyState['regions'] = [];
    let maskedWindowCount = 0;
    let visibleWindowCount = 0;
    let accessibilityUncertain = false;
    let windowLabel: string | undefined;

    for (const win of snapshot.windows) {
      const bounds = { x: win.bounds.x, y: win.bounds.y, width: win.bounds.width, height: win.bounds.height };
      if (win.isMinimized) continue;
      if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
        accessibilityUncertain = true;
        continue;
      }
      if (!intersects(bounds, displayBounds)) continue;
      visibleWindowCount++;
      const label = `${win.appName || ''} ${win.title || ''} ${win.processName || ''}`.trim();
      const isProtectedApp = SENSITIVE_WINDOW_PATTERN.test(label) || isSensitiveAccessibleValue(label);
      const elements = snapshot.elements.filter((el) => el.windowId === win.id);
      // If any visible app window cannot provide its own accessibility tree, obscure the
      // whole window. This protects background dialogs/forms as well as the focused app.
      const missingWindowTree = elements.length === 0;
      if (isProtectedApp || missingWindowTree) {
        regions.push({ ...bounds, label: isProtectedApp ? 'Protected application window' : 'Uninspected application window' });
        maskedWindowCount++;
        windowLabel = win.appName || win.title || win.processName;
        continue;
      }

      for (const element of elements) {
        const role = String(element.role || '').toLowerCase();
        const name = String(element.name || '');
        const editable = element.supportedActions?.includes('set_value') || /text|password|secure|entry|input|searchbox/.test(role);
        // Mask every editable control, not only fields whose labels match known secret words.
        // This is deliberately conservative: unknown form fields can still contain private data.
        const sensitive = /password|secure|secret|pin|otp|credential/.test(role) ||
          SENSITIVE_CONTROL_PATTERN.test(name) || isSensitiveAccessibleValue(name) || isSensitiveAccessibleValue(element.value) || editable;
        if (!sensitive) continue;
        const elementBounds = { x: element.bounds.x, y: element.bounds.y, width: element.bounds.width, height: element.bounds.height };
        if (![elementBounds.x, elementBounds.y, elementBounds.width, elementBounds.height].every(Number.isFinite) || elementBounds.width <= 0 || elementBounds.height <= 0) {
          accessibilityUncertain = true;
          continue;
        }
        if (intersects(elementBounds, displayBounds)) {
          regions.push({ ...elementBounds, label: `Sensitive ${role || 'editable'} control` });
        }
      }
    }

    if (accessibilityUncertain) {
      return fullFramePrivacyState('Native accessibility returned invalid control geometry; the entire recording frame is redacted.');
    }
    if (visibleWindowCount === 0) {
      return fullFramePrivacyState('No visible windows could be confidently mapped to the selected display; the entire recording frame is redacted.');
    }
    if (regions.length > 150) {
      return fullFramePrivacyState('The privacy scanner found too many regions to map safely; the entire recording frame is redacted.');
    }
    const mode: RecordingPrivacyState['mode'] = regions.length === 0 ? 'clear' : maskedWindowCount > 0 ? 'blur_window' : 'blur_regions';
    return {
      available: true, mode, capturedAtMs: Date.now(), displayBounds, regions,
      windowLabel,
      reason: regions.length ? `Privacy shield detected ${regions.length} sensitive region(s) and redacted them before video encoding.` : 'Native window and accessibility scan found no configured sensitive app or field.',
    };
  } catch (error: any) {
    return fullFramePrivacyState(`Privacy scan failed closed: ${redactSecretsFromText(error?.message || String(error))}`);
  }
}

function startRecorderRetentionSweep(): void {
  const runSweep = (recoverInterruptedActive = false) => {
    try { pruneExpiredRecordingSessions(Date.now(), recoverInterruptedActive); }
    catch (error: any) { startupErrors.push(`Recording retention sweep failed: ${redactSecretsFromText(error?.message || String(error))}`); }
  };
  // Only the first pass runs at process startup, before a new UI recording can be active.
  runSweep(true);
  if (recorderRetentionSweepTimer) clearInterval(recorderRetentionSweepTimer);
  // Recurring passes only expire archived recordings; they must never recover/close live sessions.
  recorderRetentionSweepTimer = setInterval(() => runSweep(false), 15 * 60 * 1000);
  (recorderRetentionSweepTimer as any).unref?.();
}

/** Expire archived keep_24h recordings and delete unreferenced binary blobs. */
export function pruneExpiredRecordingSessions(
  nowMs = Date.now(),
  recoverInterruptedActive = false
): { sessionsDeleted: number; blobsDeleted: number } {
  const db = getDesktopDurableDb();
  const activeRow = recoverInterruptedActive
    ? db.listRecords('recorder_sessions').find((record) => record.id === 'active')
    : undefined;
  const activeSession = (activeRow?.data as any)?.session;
  if (activeRow && activeSession) {
    // A process restart means a previous capture cannot still be active. Use the row's last
    // durable update as the best available end time; this prevents crashed sessions from
    // becoming immortal and allows an already-expired session to be purged on this startup.
    const lastPersistedAt = Date.parse(String(activeRow.updatedAt || ''));
    const recoveredEnd = activeSession.endedAt || new Date(Number.isFinite(lastPersistedAt) ? Math.min(nowMs, lastPersistedAt) : nowMs).toISOString();
    const interrupted = { ...activeSession, endedAt: recoveredEnd, interrupted: !activeSession.endedAt };
    if (interrupted.id) db.setRecord('recorder_sessions', interrupted.id, { session: interrupted });
    db.deleteRecord(activeRow.id);
  }
  const sessions = db.listRecords('recorder_sessions');
  let sessionsDeleted = 0;
  let blobsDeleted = 0;
  for (const row of sessions) {
    if (row.id === 'active') continue;
    const session = (row.data as any)?.session || row.data;
    if (!session || session.retentionPolicy !== 'keep_24h') continue;
    const expiryBase = Date.parse(String(session.endedAt || session.startedAt || ''));
    if (!Number.isFinite(expiryBase) || nowMs - expiryBase < 24 * 60 * 60 * 1000) continue;

    const keyframeIds = new Set<string>((Array.isArray(session.keyframes) ? session.keyframes : []).map((frame: any) => String(frame.id || '')).filter(Boolean));
    const mediaIds = new Set<string>((Array.isArray(session.mediaSegments) ? session.mediaSegments : []).map((segment: any) => String(segment.id || '')).filter(Boolean));
    const blobs = new Set<string>();
    for (const rowFrame of db.listRecords('recorder_keyframes')) {
      if (keyframeIds.has(String(rowFrame.data?.id || rowFrame.id.split(':').pop()))) {
        if (typeof rowFrame.data?.blobHash === 'string') blobs.add(rowFrame.data.blobHash);
        db.deleteRecord(rowFrame.id);
      }
    }
    for (const rowSegment of db.listRecords('recorder_media_segments')) {
      if (mediaIds.has(String(rowSegment.data?.id || rowSegment.id.split(':').pop())) || rowSegment.data?.sessionId === session.id) {
        if (typeof rowSegment.data?.blobHash === 'string') blobs.add(rowSegment.data.blobHash);
        db.deleteRecord(rowSegment.id);
      }
    }
    db.deleteRecord(row.id);
    sessionsDeleted++;
    const remainingRecords = db.listRecords();
    for (const hash of blobs) {
      const referenced = remainingRecords.some((record) => JSON.stringify(record.data).includes(hash));
      if (!referenced && db.deleteBlob(hash)) blobsDeleted++;
    }
  }
  return { sessionsDeleted, blobsDeleted };
}

export function registerIpcHandlers(options?: {
  ipcMainOverride?: { handle: (ch: string, listener: (ev: any, arg: any) => any) => void };
  safeStorageOverride?: any;
  dialogOverride?: any;
}): void {
  initializeDesktopDirectories();

  // 1. Window controls
  registerChannel(
    'window:minimize',
    () => {
      mainWindow?.minimize?.();
      return undefined;
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'window:maximize',
    () => {
      if (!mainWindow) return { isMaximized: false };
      if (mainWindow.isMaximized?.()) {
        mainWindow.unmaximize?.();
        return { isMaximized: false };
      }
      mainWindow.maximize?.();
      return { isMaximized: true };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'window:close',
    () => {
      mainWindow?.close?.();
      return undefined;
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'window:is-maximized',
    () => {
      return mainWindow && typeof mainWindow.isMaximized === 'function'
        ? Boolean(mainWindow.isMaximized())
        : false;
    },
    options?.ipcMainOverride
  );

  // 2. System, Lifecycle, Crash Reporting & Safe Update Staging
  registerChannel(
    'system:get-metrics',
    (): SystemMetrics => {
      const mem = process.memoryUsage();
      let appMetrics: SystemMetrics['electronAppMetrics'] = [];
      try {
        if (app && typeof app.getAppMetrics === 'function') {
          const raw = app.getAppMetrics();
          appMetrics = raw.map((m: any) => ({
            pid: Number(m.pid),
            type: String(m.type),
            memoryKb: Number(m.memory?.workingSetSize || 0),
          }));
        }
      } catch {
        // ignore
      }
      return {
        rssBytes: mem.rss,
        heapTotalBytes: mem.heapTotal,
        heapUsedBytes: mem.heapUsed,
        externalBytes: mem.external,
        uptimeSeconds: Math.floor(process.uptime()),
        electronAppMetrics: appMetrics,
      };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'system:get-platform-info',
    () => {
      const plat =
        process.platform === 'darwin' || process.platform === 'win32'
          ? process.platform
          : 'linux';
      return {
        platform: plat,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron || 'unknown',
        isHeadless: isHeadlessEnvironment(),
      };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'system:get-lifecycle-state',
    (): DesktopLifecycleState => {
      const dirs = activeDirectories || initializeDesktopDirectories();
      const db = getDesktopDurableDb();
      const integrity = db.checkIntegrity();
      return {
        singleInstanceLockHeld,
        isReady,
        isShuttingDown,
        userDataDir: dirs.userDataDir,
        logsDir: dirs.logsDir,
        crashesDir: dirs.crashesDir,
        updatesStagingDir: dirs.updatesStagingDir,
        sqliteDbPath: dirs.sqliteDbPath,
        sqliteIntegrityOk: integrity.ok,
        startupErrors: [...startupErrors],
      };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'system:report-crash',
    (req) => {
      return recordLocalRedactedCrashReport(req);
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'system:stage-update',
    (req) => {
      return stageVerifiedUpdateBundle(req);
    },
    options?.ipcMainOverride
  );

  // 3. Desktop Shell (Tray, Floating Companion, Global Shortcut)
  registerChannel(
    'desktop:get-shell-capabilities',
    (): DesktopShellCapabilities => {
      return getShellCapabilitiesState();
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'desktop:set-tray-state',
    ({ enabled, tooltip }): DesktopShellCapabilities => {
      const caps = getShellCapabilitiesState();
      if (!caps.traySupported) {
        return caps;
      }
      if (enabled && !systemTray && Tray && nativeImage) {
        const icon = nativeImage.createEmpty();
        systemTray = new Tray(icon);
        if (tooltip && typeof systemTray.setToolTip === 'function') {
          systemTray.setToolTip(tooltip);
        }
        if (Menu && typeof Menu.buildFromTemplate === 'function') {
          const menu = Menu.buildFromTemplate([
            { label: 'Show Blaize', click: () => mainWindow?.show?.() },
            { label: 'Quit Blaize', click: () => app?.quit?.() },
          ]);
          systemTray.setContextMenu?.(menu);
        }
      } else if (!enabled && systemTray) {
        systemTray.destroy?.();
        systemTray = null;
      }
      return getShellCapabilitiesState();
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'desktop:set-floating-companion',
    ({ visible }): DesktopShellCapabilities => {
      const caps = getShellCapabilitiesState();
      if (!caps.floatingCompanionSupported) {
        return caps;
      }
      if (visible) {
        if (!floatingCompanionWindow && BrowserWindow) {
          floatingCompanionWindow = new BrowserWindow({
            width: 320,
            height: 420,
            frame: false,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: true,
            webPreferences: {
              ...HARDENED_WEB_PREFERENCES,
            },
          });
          floatingCompanionWindow.on?.('closed', () => {
            floatingCompanionWindow = null;
          });
        }
        floatingCompanionWindow?.show?.();
      } else if (floatingCompanionWindow) {
        floatingCompanionWindow?.hide?.();
      }
      return getShellCapabilitiesState();
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'desktop:register-shortcut',
    ({ accelerator }): DesktopShellCapabilities => {
      const caps = getShellCapabilitiesState();
      if (!caps.globalShortcutSupported || !globalShortcut) {
        return caps;
      }
      const ok = globalShortcut.register(accelerator, () => {
        if (mainWindow) {
          mainWindow.show?.();
          mainWindow.focus?.();
        }
      });
      if (ok) {
        registeredShortcuts.add(accelerator);
      }
      return getShellCapabilitiesState();
    },
    options?.ipcMainOverride
  );

  // 4. SafeStorage / Vault (Persisted in DurableSqliteDatabase — zero volatile Maps)
  registerChannel(
    'vault:get-backend-status',
    (): SafeStorageStatus => {
      return verifySafeStorage(options?.safeStorageOverride);
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'vault:encrypt-secret',
    ({ keyId, plaintext }) => {
      const status = verifySafeStorage(options?.safeStorageOverride);
      if (!status.isEncrypted) {
        return {
          success: false,
          error:
            status.warning ||
            'Secure native safeStorage is unencrypted or unavailable. Plaintext fallback refused.',
        };
      }
      const targetSafeStorage = options?.safeStorageOverride ?? safeStorage;
      try {
        const buffer: Buffer = targetSafeStorage.encryptString(plaintext);
        const db = getDesktopDurableDb();
        db.setRecord('electron_safe_secrets', `electron_safe_secrets:${keyId}`, {
          keyId,
          selectedBackend: status.selectedBackend,
          bufferB64: buffer.toString('base64'),
          updatedAtIso: new Date().toISOString(),
        });
        return { success: true };
      } catch (err: any) {
        return {
          success: false,
          error: redactSecretsFromText(err?.message || 'SafeStorage encryption failed.'),
        };
      }
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'vault:decrypt-secret',
    ({ keyId }) => {
      const status = verifySafeStorage(options?.safeStorageOverride);
      if (!status.isEncrypted) {
        return {
          error:
            status.warning ||
            'Secure native safeStorage is unencrypted or unavailable. Decryption refused.',
        };
      }
      const db = getDesktopDurableDb();
      const stored = db.getRecord(`electron_safe_secrets:${keyId}`);
      if (!stored || !stored.data?.bufferB64) {
        return { error: 'Secret not found in durable SQLite vault.' };
      }
      const targetSafeStorage = options?.safeStorageOverride ?? safeStorage;
      try {
        const buf = Buffer.from(String(stored.data.bufferB64), 'base64');
        const plaintext = String(targetSafeStorage.decryptString(buf));
        return { plaintext };
      } catch (err: any) {
        return {
          error: redactSecretsFromText(err?.message || 'SafeStorage decryption failed.'),
        };
      }
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'vault:delete-secret',
    ({ keyId }) => {
      const db = getDesktopDurableDb();
      const deleted = db.deleteRecord(`electron_safe_secrets:${keyId}`);
      return { success: deleted };
    },
    options?.ipcMainOverride
  );

  // 5. Durable SQLite Storage & Real SQLite FTS5 (Zero volatile Maps)
  registerChannel(
    'storage:put-record',
    ({ collection, record }) => {
      const db = getDesktopDurableDb();
      db.setRecord(collection, `${collection}:${record.id}`, {
        ...record.data,
        __recordId: record.id,
        __collection: collection,
        __createdAt: record.createdAt,
        __updatedAt: record.updatedAt,
      });
      return { success: true };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'storage:get-record',
    ({ collection, id }): StorageRecord | null => {
      const db = getDesktopDurableDb();
      const row = db.getRecord(`${collection}:${id}`) || db.getRecord(id);
      if (!row || row.collection !== collection) {
        return null;
      }
      const rawData = { ...(row.data || {}) };
      const createdAt =
        typeof rawData.__createdAt === 'number'
          ? rawData.__createdAt
          : Date.parse(row.createdAt) || Date.now();
      const updatedAt =
        typeof rawData.__updatedAt === 'number'
          ? rawData.__updatedAt
          : Date.parse(row.updatedAt) || Date.now();
      delete rawData.__recordId;
      delete rawData.__collection;
      delete rawData.__createdAt;
      delete rawData.__updatedAt;

      return {
        id,
        collection: row.collection,
        data: rawData,
        createdAt,
        updatedAt,
      };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'storage:delete-record',
    ({ collection, id }) => {
      const db = getDesktopDurableDb();
      const deletedComposite = db.deleteRecord(`${collection}:${id}`);
      const deletedPlain = db.deleteRecord(id);
      return { success: deletedComposite || deletedPlain };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'storage:query-fts',
    ({ query, limit = 20 }): FtsSearchResult[] => {
      const db = getDesktopDurableDb();
      const results = db.searchFts(query, undefined, limit);
      return results.map((r) => {
        const cleanId = r.id.includes(':') ? r.id.split(':').slice(1).join(':') : r.id;
        return {
          id: cleanId,
          collection: r.collection,
          snippet:
            r.snippet ||
            (r.data ? JSON.stringify(r.data).slice(0, 140) : `Matched '${query}'`),
          rank: Number(r.rank),
        };
      });
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'storage:save-blob',
    ({ hash, dataBase64, mimeType }) => {
      const buffer = Buffer.from(dataBase64, 'base64');
      const computedHash = crypto.createHash('sha256').update(buffer).digest('hex');
      if (computedHash.toLowerCase() !== hash.toLowerCase()) {
        throw new Error(`Blob SHA-256 mismatch: expected ${hash}, computed ${computedHash}`);
      }
      const db = getDesktopDurableDb();
      db.setBlob(hash.toLowerCase(), mimeType, dataBase64);
      return { path: `blob://${hash.toLowerCase()}`, size: buffer.length };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'storage:read-blob',
    ({ hash }) => {
      const db = getDesktopDurableDb();
      const blob = db.getBlob(hash.toLowerCase());
      if (!blob) return null;
      return { dataBase64: blob.dataBase64, mimeType: blob.mimeType };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'storage:delete-blob',
    ({ hash }) => {
      const db = getDesktopDurableDb();
      const normalizedHash = hash.toLowerCase();
      const stillReferenced = ['recorder_keyframes', 'recorder_media_segments'].some((collection) =>
        db.listRecords(collection).some((record) => record.data?.blobHash === normalizedHash)
      );
      if (stillReferenced) return { success: false };
      return { success: db.deleteBlob(normalizedHash) };
    },
    options?.ipcMainOverride
  );

  // 6. PC Operator (Honest truth state reporting + real LinuxDesktopDriver on Linux)
  registerChannel(
    'pc-operator:list-windows',
    (): PCOperatorWindowTarget[] => {
      const results: PCOperatorWindowTarget[] = [];
      if (mainWindow && typeof mainWindow.getBounds === 'function') {
        const b = mainWindow.getBounds();
        results.push({
          id: 'win-blaize-main',
          title:
            typeof mainWindow.getTitle === 'function'
              ? mainWindow.getTitle()
              : 'Blaize — The Accountable AI Desktop',
          processName: 'electron',
          bounds: {
            x: Number(b.x || 0),
            y: Number(b.y || 0),
            width: Number(b.width || 1280),
            height: Number(b.height || 840),
          },
          isFocused:
            typeof mainWindow.isFocused === 'function' ? Boolean(mainWindow.isFocused()) : true,
        });
      }
      if (process.platform === 'linux' || process.platform === 'win32' || process.platform === 'darwin') {
        try {
          const driver =
            process.platform === 'win32'
              ? new WindowsDesktopDriver()
              : process.platform === 'darwin'
                ? new MacOSDesktopDriver()
                : new LinuxDesktopDriver();
          const snap = driver.capturePerception();
          for (const w of snap.windows) {
            if (!results.some((r) => r.id === w.id)) {
              results.push({
                id: w.id,
                title: w.title,
                processName: w.processName,
                bounds: {
                  x: w.bounds.x,
                  y: w.bounds.y,
                  width: w.bounds.width,
                  height: w.bounds.height,
                },
                isFocused: w.isFocused,
                elements: snap.elements
                  .filter((element) => element.windowId === w.id)
                  .slice(0, 120)
                  .map((element) => ({
                    id: element.id,
                    role: element.role,
                    name: redactSecretsFromText(element.name).slice(0, 180),
                    bounds: { x: element.bounds.x, y: element.bounds.y, width: element.bounds.width, height: element.bounds.height },
                    supportedActions: element.supportedActions,
                  })),
              });
            }
          }
        } catch {
          // ignore
        }
      }
      return results;
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'pc-operator:get-recording-privacy',
    () => captureRecordingPrivacyState(),
    options?.ipcMainOverride
  );

  registerChannel(
    'pc-operator:approve-action',
    async (request: PCOperatorActionRequest, event: any): Promise<PCOperatorActionApprovalResult> => {
      if (!request.requiresConfirmation) return { approved: false, message: 'A fresh native confirmation is required.' };
      if (request.type === 'type' && request.text && request.text.length > 240) {
        return { approved: false, message: 'Long text entry is not eligible for one-action desktop approval. Use a separately reviewed file or editor workflow.' };
      }
      if (request.type === 'type' && request.text && (/(password|passcode|one.?time.?code|otp|\bpin\b|api.?key|secret|bearer\s+)/i.test(request.text) || isSensitiveAccessibleValue(request.text))) {
        return { approved: false, message: 'Credential-like or personal-identifier text is blocked before approval and cannot be entered by the autonomous desktop channel.' };
      }
      if (isHeadlessEnvironment()) return { approved: false, message: 'Native approval dialog is unavailable in a headless session.' };
      const driver = createNativeDesktopDriver();
      const snapshot = driver.capturePerception();
      const target = request.targetWindowId
        ? snapshot.windows.find((window) => window.id === request.targetWindowId)
        : snapshot.windows.find((window) => window.isFocused);
      if (!target) return { approved: false, message: 'Target window is no longer present. Refresh desktop perception.' };
      if (SENSITIVE_WINDOW_PATTERN.test(`${target.title} ${target.processName} ${target.appName}`)) {
        return { approved: false, message: 'Sensitive applications cannot be controlled by the autonomous PC Operator.' };
      }
      const element = request.targetElementId
        ? snapshot.elements.find((candidate) => candidate.id === request.targetElementId && candidate.windowId === target.id)
        : undefined;
      if (request.targetElementId && !element) return { approved: false, message: 'Target accessibility element is no longer present.' };
      if (element && (SENSITIVE_CONTROL_PATTERN.test(element.name) || isSensitiveAccessibleValue(element.name) || isSensitiveAccessibleValue(element.value) || /pay|payment|transfer|send money|purchase|checkout|delete|remove account|confirm|approve|submit|security settings/i.test(element.name))) {
        return { approved: false, message: 'This control is too sensitive for autonomous execution.' };
      }
      const dialogApi = options?.dialogOverride ?? dialog;
      if (!dialogApi || typeof dialogApi.showMessageBox !== 'function') {
        return { approved: false, message: 'Native approval dialog is unavailable; action rejected.' };
      }
      const actionLabel = request.type === 'type'
        ? `Enter ${String(request.text || '').length} character(s) in a visible control`
        : request.type === 'click' ? 'Click a visible control'
          : request.type === 'scroll' ? 'Scroll the selected window'
            : request.type === 'key' ? `Send shortcut: ${request.key || 'unknown'}` : 'Navigate';
      const safeTextPreview = request.type === 'type'
        ? `\nText to enter: ${JSON.stringify(redactSecretsFromText(String(request.text || '')))}`
        : '';
      const dialogResult = await dialogApi.showMessageBox(mainWindow || undefined, {
        type: 'warning',
        title: 'Approve one Blaize desktop action?',
        message: actionLabel,
        detail: `Application: ${redactSecretsFromText(target.appName || target.processName).slice(0, 120)}\nWindow: ${redactSecretsFromText(target.title).slice(0, 160)}\nControl: ${redactSecretsFromText(element?.name || 'focused window').slice(0, 120)}${safeTextPreview}\n\nThis approval applies to this exact action only and expires after 60 seconds.`,
        buttons: ['Approve this action', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (dialogResult?.response !== 0) return { approved: false, message: 'You declined the native desktop action.' };
      const approvalToken = crypto.randomUUID();
      nativeActionApprovalVault.issue(approvalToken, {
        senderId: Number(event?.sender?.id),
        actionDigest: actionDigest(request),
        expiresAtMs: Date.now() + 60_000,
      });
      return { approved: true, approvalToken, message: 'Native one-time approval granted.' };
    },
    options?.ipcMainOverride
  );

  registerChannel(
    'pc-operator:execute-action',
    (request: PCOperatorActionRequest & { approvalToken: string }, event: any): PCOperatorActionResult => {
      const fail = (state: PCOperatorActionResult['executionState'], message: string): PCOperatorActionResult => ({
        success: false, actionId: request.actionId, executionState: state, isSimulated: false,
        message, targetWindowVerified: false, timestamp: Date.now(),
      });
      const approvalValid = nativeActionApprovalVault.consume(
        request.approvalToken, Number(event?.sender?.id), actionDigest(request), Date.now()
      );
      if (!approvalValid) {
        return fail('BLOCKED', 'APPROVAL_INVALID: A fresh, unexpired, action-specific native approval is required.');
      }
      if (request.type === 'navigate') {
        return fail('UNSUPPORTED', 'DIRECT_NAVIGATION_UNSUPPORTED: Use the visible browser address bar with a separately reviewed keyboard action.');
      }
      if (request.type === 'type' && (!request.text || !request.targetElementId)) {
        return fail('BLOCKED', 'TARGET_REQUIRED: Typing requires a grounded accessibility element and explicit text.');
      }
      if ((request.type === 'click' || request.type === 'scroll') && !request.targetElementId) {
        return fail('BLOCKED', 'TARGET_REQUIRED: Click and scroll require a fresh accessibility element target.');
      }
      if (request.coordinates) {
        return fail('BLOCKED', 'PIXEL_INPUT_DISABLED: Autonomous AI actions must use fresh accessibility targets; coordinate-only input is disabled.');
      }
      if (request.type === 'key' && !request.key) {
        return fail('BLOCKED', 'KEY_REQUIRED: Keyboard action requires an explicit key or shortcut.');
      }
      const safeShortcuts = new Set([
        'escape', 'tab', 'shift+tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
        'home', 'end', 'pageup', 'pagedown', 'ctrl+f', 'ctrl+s', 'ctrl+a', 'ctrl+c',
        'ctrl+z', 'ctrl+y', 'ctrl+tab', 'ctrl+shift+tab', 'ctrl+shift+s', 'alt+tab',
        'cmd+f', 'cmd+s', 'cmd+a', 'cmd+c', 'cmd+z', 'cmd+shift+z', 'cmd+tab',
      ]);
      if (request.type === 'key' && !safeShortcuts.has(String(request.key || '').toLowerCase().replace(/\s+/g, ''))) {
        return fail('BLOCKED', 'KEY_SHORTCUT_BLOCKED: This shortcut is outside Blaize’s allowlist. Use a visible accessibility control instead.');
      }
      if (request.type === 'scroll' && request.deltaY !== undefined && (!Number.isFinite(request.deltaY) || Math.abs(request.deltaY) > 100)) {
        return fail('BLOCKED', 'SCROLL_RANGE_BLOCKED: Scroll movement must be within -100 to 100.');
      }
      if (request.type === 'type' && request.text && request.text.length > 240) {
        return fail('BLOCKED', 'TEXT_LENGTH_BLOCKED: Long text must use a separately reviewed content workflow.');
      }
      if (request.type === 'type' && request.text && (/(password|passcode|one.?time.?code|otp|\bpin\b|api.?key|secret|bearer\s+)/i.test(request.text) || isSensitiveAccessibleValue(request.text))) {
        return fail('BLOCKED', 'SENSITIVE_INPUT_BLOCKED: Blaize will not type credentials or detected personal identifiers through the autonomous desktop channel.');
      }
      if (process.platform !== 'linux' && process.platform !== 'win32' && process.platform !== 'darwin') {
        return fail('UNSUPPORTED', 'UNSUPPORTED: Native desktop control is unavailable on this platform.');
      }
      if (isHeadlessEnvironment()) {
        return fail('UNSUPPORTED', 'UNSUPPORTED: Native OS input dispatch requires an active display session (X11/Wayland/Quartz/Win32).');
      }
      const driver = createNativeDesktopDriver();
      const beforeSnap = driver.capturePerception();
      const target = request.targetWindowId
        ? beforeSnap.windows.find((window) => window.id === request.targetWindowId)
        : beforeSnap.windows.find((window) => window.isFocused);
      if (!target) return fail('BLOCKED', 'TARGET_WINDOW_NOT_FOUND: The requested application window is no longer present.');
      if (target.isElevatedAdmin) return fail('BLOCKED', 'UIPI_ELEVATION_DENIED: Elevated administrative windows cannot be controlled.');
      if (SENSITIVE_WINDOW_PATTERN.test(`${target.title} ${target.processName} ${target.appName}`)) {
        return fail('BLOCKED', 'SENSITIVE_APPLICATION_BLOCKED: Blaize will not autonomously control password, banking, brokerage, tax, payroll, or medical applications.');
      }
      if (request.coordinates) {
        const { x, y } = request.coordinates;
        const b = target.bounds;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) {
          return fail('BLOCKED', 'COORDINATE_OUT_OF_BOUNDS: Coordinates must lie inside the freshly verified target window.');
        }
      }
      if (request.type === 'key' && !target.isFocused) {
        return fail('BLOCKED', 'WINDOW_NOT_FOCUSED: Keyboard input is only allowed in the currently focused target window.');
      }
      const targetElement = request.targetElementId
        ? beforeSnap.elements.find((element) => element.id === request.targetElementId && element.windowId === target.id)
        : undefined;
      if (request.targetElementId && !targetElement) {
        return fail('BLOCKED', 'TARGET_ELEMENT_NOT_FOUND: The accessibility element changed or belongs to another window. Refresh perception and retry.');
      }
      const requiredCapability = request.type === 'click' ? 'invoke' : request.type === 'type' ? 'set_value' : request.type === 'scroll' ? 'scroll' : undefined;
      if (requiredCapability && !targetElement?.supportedActions?.includes(requiredCapability)) {
        return fail('BLOCKED', `ACTION_NOT_SUPPORTED: The refreshed accessibility target does not expose ${requiredCapability}.`);
      }
      if (targetElement && (SENSITIVE_CONTROL_PATTERN.test(targetElement.name) || isSensitiveAccessibleValue(targetElement.name) || isSensitiveAccessibleValue(targetElement.value) || /(pay|payment|transfer|send money|purchase|checkout|delete|remove account|confirm|approve|submit|sign in|log in|security settings)/i.test(targetElement.name))) {
        return fail('BLOCKED', 'SENSITIVE_CONTROL_BLOCKED: This control could commit a payment, delete data, submit a form, or modify security settings. Use a separately reviewed workflow.');
      }
      const action = request.type === 'type' ? 'set_value'
        : request.type === 'scroll' ? 'scroll'
          : request.type === 'click' ? 'invoke' : undefined;
      const outcome = driver.executeTierAction({
        appId: target.appId,
        windowId: target.id,
        intent: `${request.type} on reviewed target ${target.title}`,
        tier: request.type === 'key' ? 'T3_SHORTCUTS_MENU' : 'T2_ACCESSIBILITY',
        targetElementId: request.targetElementId,
        accessibilityAction: action,
        valueToSet: request.type === 'type' ? request.text : request.type === 'scroll' ? String(request.deltaY ?? 50) : undefined,
        shortcutKeys: request.type === 'key' ? request.key : undefined,
        pixelCoordinates: request.coordinates,
        riskClass: request.type === 'type' || request.type === 'click' || request.type === 'scroll' ? 'write_in_scope' : 'read',
      }, beforeSnap);
      const targetStillPresent = outcome.resultingSnapshot.windows.some((window) => window.id === target.id);
      return {
        success: outcome.ok,
        actionId: request.actionId,
        executionState: outcome.executionState,
        isSimulated: outcome.isSimulated,
        message: redactSecretsFromText(outcome.logMessage),
        targetWindowVerified: Boolean(outcome.ok && targetStillPresent),
        timestamp: Date.now(),
      };
    },
    options?.ipcMainOverride
  );
}

// ============================================================================
// 6. APPLICATION ENTRYPOINT & LIFECYCLE HOOKS
// ============================================================================

export function initApp(): void {
  if (!app || typeof app.whenReady !== 'function') return;

  if (!acquireSingleInstanceLock(app)) {
    return;
  }

  process.on('uncaughtException', (err) => {
    const msg = redactSecretsFromText(err?.message || String(err));
    startupErrors.push(msg);
    try {
      recordLocalRedactedCrashReport({
        source: 'main',
        message: msg,
        stack: err?.stack,
      });
    } catch {
      // ignore
    }
  });

  process.on('unhandledRejection', (reason: any) => {
    const msg = redactSecretsFromText(reason?.message || String(reason));
    startupErrors.push(msg);
    try {
      recordLocalRedactedCrashReport({
        source: 'main',
        message: `UnhandledRejection: ${msg}`,
        stack: reason?.stack,
      });
    } catch {
      // ignore
    }
  });

  app.on('before-quit', () => {
    gracefulShutdown();
  });

  app.on('window-all-closed', () => {
    // Only quit the process once both the Blaize main window and the 2D companion figure have been exited
    if (process.platform !== 'darwin' && !floatingCompanionWindow) {
      app.quit();
    }
  });

  app
    .whenReady()
    .then(async () => {
      initializeDesktopDirectories();
      registerIpcHandlers();
      startRecorderRetentionSweep();
      // getDisplayMedia is handled in the privileged process so the user chooses an
      // actual desktop display. This handler only runs after the app's consent sheet
      // has explicitly initiated capture; cancelling the picker grants no stream.
      if (session?.defaultSession && typeof session.defaultSession.setDisplayMediaRequestHandler === 'function' && desktopCapturer?.getSources) {
        session.defaultSession.setDisplayMediaRequestHandler(async (_request: any, callback: (selection: any) => void) => {
          try {
            const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false });
            if (!sources?.length) { callback({}); return; }
            const labels = sources.map((source: any, index: number) => `${index + 1}. ${String(source.name || 'Display').slice(0, 80)}`);
            labels.push('Cancel');
            const picked = await dialog.showMessageBox(mainWindow || undefined, {
              type: 'question', title: 'Blaize screen recording',
              message: 'Choose the display to capture. Only the selected display is recorded.',
              detail: 'Capture begins only for this consented session. You can stop at any time from Blaize.',
              buttons: labels, cancelId: labels.length - 1, defaultId: 0,
            });
            const source = sources[picked.response];
            if (!source) { selectedCaptureDisplayId = null; callback({}); return; }
            selectedCaptureDisplayId = source.display_id ? String(source.display_id) : null;
            callback({ video: source, audio: undefined });
          } catch (err: any) {
            startupErrors.push(`Display capture picker failed: ${redactSecretsFromText(err?.message || String(err))}`);
            callback({});
          }
        }, { useSystemPicker: false });
      }
      isReady = true;

      if (process.env.BLAIZE_ELECTRON_SMOKE_TEST === '1') {
        const dirs = activeDirectories!;
        const db = getDesktopDurableDb();
        const integrity = db.checkIntegrity();
        console.log(
          JSON.stringify({
            smokeTest: 'BLAIZE_ELECTRON_MAIN_READY',
            singleInstanceLockHeld,
            sqliteIntegrityOk: integrity.ok,
            registeredIpcChannelCount: getRegisteredIpcChannels().length,
            userDataDir: dirs.userDataDir,
          })
        );
        gracefulShutdown();
        app.quit();
        return;
      }

      const desktopStartUrl = await startEmbeddedBackend();
      createWindow(desktopStartUrl);

      if (powerMonitor && typeof powerMonitor.on === 'function') {
        powerMonitor.on('suspend', () => {
          mainWindow?.webContents?.send?.('power:event', 'suspend');
        });
        powerMonitor.on('resume', () => {
          mainWindow?.webContents?.send?.('power:event', 'resume');
        });
      }

      app.on('activate', () => {
        if (BrowserWindow && mainWindow === null) {
          void startEmbeddedBackend().then((url) => createWindow(url)).catch((err) => {
            const msg = redactSecretsFromText(err?.message || String(err));
            startupErrors.push(msg);
            recordLocalRedactedCrashReport({ source: 'main', message: 'Backend restart failed: ' + msg });
          });
        }
      });
    })
    .catch((err: any) => {
      const msg = redactSecretsFromText(err?.message || String(err));
      startupErrors.push(msg);
      recordLocalRedactedCrashReport({
        source: 'main',
        message: `Startup failure: ${msg}`,
        stack: err?.stack,
      });
      try { app?.showErrorBox?.('Blaize startup failed', msg); } catch { /* ignore UI reporting failures */ }
      try { app?.quit?.(); } catch { /* ignore shutdown failures */ }
    });
}

// Auto-initialize when launched directly by the Electron binary
if (process.versions?.electron && process.env.BLAIZE_SKIP_AUTO_INIT !== '1') {
  initApp();
} else if (process.argv.includes('--smoke-verify')) {
  const dirs = initializeDesktopDirectories();
  registerIpcHandlers();
  isReady = true;
  const db = getDesktopDurableDb();
  db.setRecord('smoke_test', 'smoke_test:boot', {
    bootedAt: new Date().toISOString(),
    pid: process.pid,
  });
  const roundTrip = db.getRecord('smoke_test:boot');
  const integrity = db.checkIntegrity();
  const registeredCount = getRegisteredIpcChannels().length;
  const manifestCount = Object.keys(IPC_CONTRACT_MANIFEST).length;
  gracefulShutdown();

  const summary = {
    smokeVerified:
      Boolean(roundTrip) && integrity.ok && registeredCount === manifestCount,
    registeredChannels: registeredCount,
    manifestChannels: manifestCount,
    sqliteIntegrityOk: integrity.ok,
    sqliteDbPath: dirs.sqliteDbPath,
    userDataDir: dirs.userDataDir,
  };
  console.log(JSON.stringify(summary));
  process.exit(summary.smokeVerified ? 0 : 1);
}


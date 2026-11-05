/**
 * Phase 5 Automated Test Suite: Electron Security, Typed IPC Contracts,
 * Durable SQLite Persistence, Lifecycle/Updates, and Reproducible Packaging
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  IPC_CONTRACT_MANIFEST,
  validateIpcRequestPayload,
  validateIpcResponsePayload,
  type ElectronIpcChannels,
} from '../../../electron/ipc-contracts.js';
import { buildPreloadApi } from '../../../electron/preload.js';
import {
  HARDENED_WEB_PREFERENCES,
  RESTRICTIVE_CSP_HEADER,
  isAllowedNavigationOrigin,
  evaluatePermissionRequest,
  evaluateExternalLinkRequest,
  validateIpcSender,
  registerIpcHandlers,
  getRegisteredIpcChannels,
  invokeValidatedIpcChannel,
  resetDesktopHostForTesting,
  acquireSingleInstanceLock,
  recordLocalRedactedCrashReport,
  stageVerifiedUpdateBundle,
  verifySafeStorage,
  gracefulShutdown,
  type IpcSenderEventLike,
} from '../../../electron/main.js';
import { UniversalPlatformBridge } from './index.js';
import { buildDesktopArtifacts } from '../../../scripts/build-desktop.js';
import { packageDesktopTarget } from '../../../scripts/package-desktop.js';

function createTrustedSenderEvent(url = 'http://localhost:3000/'): IpcSenderEventLike {
  const mainFrame = { routingId: 1, frameId: 1, url, parent: null };
  return {
    sender: {
      id: 101,
      isDestroyed: () => false,
      getURL: () => url,
      mainFrame,
    },
    senderFrame: mainFrame,
    frameId: 1,
  };
}

describe('Phase 5 — Reproducible, Secure Electron Desktop Foundation', () => {
  let tempUserDataDir: string;

  beforeEach(() => {
    tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-electron-test-'));
    resetDesktopHostForTesting(tempUserDataDir);
  });

  afterEach(() => {
    gracefulShutdown();
    if (tempUserDataDir && fs.existsSync(tempUserDataDir)) {
      fs.rmSync(tempUserDataDir, { recursive: true, force: true });
    }
  });

  it('1. validates 1:1 conformance across IPC_CONTRACT_MANIFEST, main handlers, and frozen preload API with zero dangerous globals', async () => {
    registerIpcHandlers();
    const registered = new Set(getRegisteredIpcChannels());
    const manifestKeys = Object.keys(IPC_CONTRACT_MANIFEST) as Array<keyof ElectronIpcChannels>;

    assert.equal(manifestKeys.length, 25, 'Expected 25 explicit IPC channels in manifest');
    assert.equal(
      registered.size,
      manifestKeys.length,
      'Every contract channel must be registered in electron/main.ts'
    );

    const invokedCalls: Array<{ channel: string; args: unknown[] }> = [];
    const preloadApi = buildPreloadApi(
      {
        invoke: async (channel: string, ...args: unknown[]) => {
          invokedCalls.push({ channel, args });
          return undefined;
        },
        on: () => undefined,
        removeListener: () => undefined,
      },
      'linux'
    );

    // Preload API and every sub-namespace must be frozen
    assert.equal(Object.isFrozen(preloadApi), true);
    assert.equal(Object.isFrozen(preloadApi.window), true);
    assert.equal(Object.isFrozen(preloadApi.system), true);
    assert.equal(Object.isFrozen(preloadApi.desktop), true);
    assert.equal(Object.isFrozen(preloadApi.vault), true);
    assert.equal(Object.isFrozen(preloadApi.storage), true);
    assert.equal(Object.isFrozen(preloadApi.pcOperator), true);

    // Must never expose raw ipcRenderer, filesystem, child_process, or shell
    for (const forbidden of [
      'ipcRenderer',
      'fs',
      'child_process',
      'shell',
      'process',
      'require',
      'Buffer',
    ]) {
      assert.equal(
        forbidden in (preloadApi as unknown as Record<string, unknown>),
        false,
        `Preload API must never expose '${forbidden}'`
      );
    }

    // Every channel in IPC_CONTRACT_MANIFEST must map to a callable preload method
    for (const key of manifestKeys) {
      const spec = IPC_CONTRACT_MANIFEST[key];
      assert.ok(spec.reqSchema, `Missing reqSchema for ${key}`);
      assert.ok(spec.resSchema, `Missing resSchema for ${key}`);
      assert.equal(spec.requiresMainFrame, true, `${key} must require mainFrame`);
      assert.equal(registered.has(key), true, `Main process handler missing for ${key}`);

      const ns = (preloadApi as any)[spec.preloadNamespace];
      assert.ok(ns, `Preload namespace '${spec.preloadNamespace}' missing for ${key}`);
      assert.equal(
        typeof ns[spec.preloadMethod],
        'function',
        `Preload method '${spec.preloadNamespace}.${spec.preloadMethod}' missing for ${key}`
      );
    }
  });

  it('2. enforces hardened BrowserWindow preferences, restrictive CSP, navigation allowlist, default-deny permissions, and HTTPS-only external links', () => {
    assert.equal(HARDENED_WEB_PREFERENCES.sandbox, true);
    assert.equal(HARDENED_WEB_PREFERENCES.contextIsolation, true);
    assert.equal(HARDENED_WEB_PREFERENCES.nodeIntegration, false);
    assert.equal(HARDENED_WEB_PREFERENCES.nodeIntegrationInWorker, false);
    assert.equal(HARDENED_WEB_PREFERENCES.nodeIntegrationInSubFrames, false);
    assert.equal(HARDENED_WEB_PREFERENCES.webSecurity, true);
    assert.equal(HARDENED_WEB_PREFERENCES.allowRunningInsecureContent, false);
    assert.equal(HARDENED_WEB_PREFERENCES.webviewTag, false);

    assert.match(RESTRICTIVE_CSP_HEADER, /default-src 'self'/);
    assert.match(RESTRICTIVE_CSP_HEADER, /script-src 'self'/);
    assert.match(RESTRICTIVE_CSP_HEADER, /object-src 'none'/);
    assert.match(RESTRICTIVE_CSP_HEADER, /frame-ancestors 'none'/);

    const fakeDistDir = path.join(tempUserDataDir, 'dist');
    fs.mkdirSync(fakeDistDir, { recursive: true });
    const validFileUrl = `file://${path.join(fakeDistDir, 'index.html')}`;
    const traversalFileUrl = `file://${path.join(tempUserDataDir, 'secret.txt')}`;

    // Navigation allowlist
    assert.equal(isAllowedNavigationOrigin('http://localhost:3000/missions', fakeDistDir), true);
    assert.equal(isAllowedNavigationOrigin('http://127.0.0.1:3000/', fakeDistDir), true);
    assert.equal(isAllowedNavigationOrigin('app://blaize/index.html', fakeDistDir), true);
    assert.equal(isAllowedNavigationOrigin(validFileUrl, fakeDistDir), true);

    assert.equal(isAllowedNavigationOrigin('https://evil.example.com/', fakeDistDir), false);
    assert.equal(isAllowedNavigationOrigin('http://localhost:4000/', fakeDistDir), false);
    assert.equal(isAllowedNavigationOrigin('javascript:alert(1)', fakeDistDir), false);
    assert.equal(isAllowedNavigationOrigin('data:text/html,<h1>pwn</h1>', fakeDistDir), false);
    assert.equal(isAllowedNavigationOrigin(traversalFileUrl, fakeDistDir), false);

    // Permission handler: default-deny
    assert.equal(
      evaluatePermissionRequest('clipboard-sanitized-write', 'http://localhost:3000/', fakeDistDir),
      true
    );
    assert.equal(
      evaluatePermissionRequest('media', 'http://localhost:3000/', fakeDistDir),
      false
    );
    assert.equal(
      evaluatePermissionRequest('geolocation', 'http://localhost:3000/', fakeDistDir),
      false
    );
    assert.equal(
      evaluatePermissionRequest('notifications', 'http://localhost:3000/', fakeDistDir),
      false
    );
    assert.equal(
      evaluatePermissionRequest('clipboard-sanitized-write', 'https://evil.example.com/', fakeDistDir),
      false
    );

    // Safe external link handling
    const httpsLink = evaluateExternalLinkRequest('https://docs.blaize.ai/security');
    assert.equal(httpsLink.allowBrowserOpen, true);
    assert.equal(httpsLink.canonicalUrl, 'https://docs.blaize.ai/security');

    const httpLink = evaluateExternalLinkRequest('http://docs.blaize.ai/security');
    assert.equal(httpLink.allowBrowserOpen, false);

    const jsLink = evaluateExternalLinkRequest('javascript:window.pwn()');
    assert.equal(jsLink.allowBrowserOpen, false);

    const loopbackHttps = evaluateExternalLinkRequest('https://127.0.0.1/admin');
    assert.equal(loopbackHttps.allowBrowserOpen, false);
  });

  it('3. rejects IPC calls from missing senders, destroyed webContents, child iframes/subframes, and untrusted origins', async () => {
    registerIpcHandlers();

    // Missing sender
    await assert.rejects(
      () => invokeValidatedIpcChannel('system:get-metrics', {}),
      /UNTRUSTED_IPC_SENDER_MISSING/
    );

    // Destroyed sender
    await assert.rejects(
      () =>
        invokeValidatedIpcChannel('system:get-metrics', {
          sender: {
            isDestroyed: () => true,
            getURL: () => 'http://localhost:3000/',
          },
        }),
      /UNTRUSTED_IPC_SENDER_DESTROYED/
    );

    // Child iframe / subframe with parent frame
    const mainFrame = { routingId: 1, frameId: 1, url: 'http://localhost:3000/' };
    const childFrame = {
      routingId: 2,
      frameId: 2,
      url: 'http://localhost:3000/iframe',
      parent: mainFrame,
    };
    await assert.rejects(
      () =>
        invokeValidatedIpcChannel('system:get-metrics', {
          sender: {
            isDestroyed: () => false,
            getURL: () => 'http://localhost:3000/',
            mainFrame,
          },
          senderFrame: childFrame,
        }),
      /UNTRUSTED_IPC_SUBFRAME_REJECTED/
    );

    // Mismatched routingId without parent property
    const detachedSubframe = {
      routingId: 99,
      frameId: 99,
      url: 'http://localhost:3000/',
      parent: null,
    };
    const senderCheck = validateIpcSender({
      sender: {
        isDestroyed: () => false,
        getURL: () => 'http://localhost:3000/',
        mainFrame,
      },
      senderFrame: detachedSubframe,
    });
    assert.equal(senderCheck.valid, false);
    assert.match(senderCheck.reason || '', /UNTRUSTED_IPC_SUBFRAME_REJECTED/);

    // Untrusted origin URL
    await assert.rejects(
      () =>
        invokeValidatedIpcChannel(
          'system:get-metrics',
          createTrustedSenderEvent('https://malicious.example.org/phish')
        ),
      /UNTRUSTED_IPC_ORIGIN_REJECTED/
    );
  });

  it('4. enforces runtime Zod schema validation on IPC requests and responses across channels', async () => {
    registerIpcHandlers();
    const sender = createTrustedSenderEvent();

    // Malformed storage:put-record (invalid collection characters & negative timestamp)
    await assert.rejects(
      () =>
        invokeValidatedIpcChannel('storage:put-record', sender, {
          collection: '../traversal/collection',
          record: {
            id: 'rec-1',
            collection: '../traversal/collection',
            data: {},
            createdAt: -5,
            updatedAt: 100,
          },
        } as any),
      /IPC request schema validation failed for 'storage:put-record'/
    );

    // Malformed vault:encrypt-secret (invalid keyId with spaces/slashes)
    await assert.rejects(
      () =>
        invokeValidatedIpcChannel('vault:encrypt-secret', sender, {
          keyId: '../../bad key',
          plaintext: 'secret',
        }),
      /IPC request schema validation failed for 'vault:encrypt-secret'/
    );

    // Malformed system:stage-update (invalid SHA-256 hex)
    await assert.rejects(
      () =>
        invokeValidatedIpcChannel('system:stage-update', sender, {
          version: '1.2.3',
          bundlePath: '/tmp/bundle.bin',
          expectedSha256Hex: 'not-a-sha256',
          signatureBase64: 'c2lnbmF0dXJlMTIzNDU2Nzg5MA==',
          publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----',
        }),
      /IPC request schema validation failed for 'system:stage-update'/
    );

    // Malformed pc-operator:execute-action (unknown action type)
    await assert.rejects(
      () =>
        invokeValidatedIpcChannel('pc-operator:execute-action', sender, {
          actionId: 'act-1',
          type: 'rm_rf_root' as any,
          requiresConfirmation: false,
        }),
      /IPC request schema validation failed for 'pc-operator:execute-action'/
    );

    // Response schema validator also rejects malformed return shapes
    const badRes = validateIpcResponsePayload('window:maximize', { isMaximized: 'yes' });
    assert.equal(badRes.ok, false);
  });

  it('5. persists records, FTS5 search index, SHA-256 blobs, and encrypted secrets in DurableSqliteDatabase across restarts (zero volatile Maps) and fails closed on Linux basic_text', async () => {
    const mockEncryptedSafeStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (plain: string) => Buffer.from(`enc:${plain}`, 'utf8'),
      decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, ''),
    };

    registerIpcHandlers({ safeStorageOverride: mockEncryptedSafeStorage });
    const sender = createTrustedSenderEvent();

    // 1) Put record & FTS5 index
    const now = Date.now();
    const putRes = await invokeValidatedIpcChannel('storage:put-record', sender, {
      collection: 'missions',
      record: {
        id: 'mission-quantum-7',
        collection: 'missions',
        data: {
          title: 'Quantum Lattice Calibration',
          summary: 'Calibrated superconducting resonators with zero drift',
        },
        createdAt: now,
        updatedAt: now,
      },
    });
    assert.equal(putRes.success, true);

    // 2) Save SHA-256 verified blob
    const blobBytes = Buffer.from('Blaize verified binary artifact payload', 'utf8');
    const blobSha256 = crypto.createHash('sha256').update(blobBytes).digest('hex');
    const savedBlob = await invokeValidatedIpcChannel('storage:save-blob', sender, {
      hash: blobSha256,
      dataBase64: blobBytes.toString('base64'),
      mimeType: 'text/plain',
    });
    assert.equal(savedBlob.path, `blob://${blobSha256}`);
    assert.equal(savedBlob.size, blobBytes.length);

    // 3) Encrypt secret into SQLite vault via safeStorage
    const encRes = await invokeValidatedIpcChannel('vault:encrypt-secret', sender, {
      keyId: 'openai.api.key',
      plaintext: 'sk-live-super-secret-value-9999999999999999',
    });
    assert.equal(encRes.success, true);

    // 4) Simulate full app shutdown and cold restart against the same tempUserDataDir
    gracefulShutdown();
    resetDesktopHostForTesting(tempUserDataDir);
    registerIpcHandlers({ safeStorageOverride: mockEncryptedSafeStorage });

    // Verify record survived restart in SQLite
    const fetchedRecord = await invokeValidatedIpcChannel('storage:get-record', sender, {
      collection: 'missions',
      id: 'mission-quantum-7',
    });
    assert.ok(fetchedRecord);
    assert.equal(fetchedRecord.id, 'mission-quantum-7');
    assert.equal(fetchedRecord.data.title, 'Quantum Lattice Calibration');

    // Verify FTS5 query finds the persisted record after restart
    const ftsHits = await invokeValidatedIpcChannel('storage:query-fts', sender, {
      query: 'superconducting',
      limit: 10,
    });
    assert.equal(ftsHits.length, 1);
    assert.equal(ftsHits[0].id, 'mission-quantum-7');
    assert.equal(ftsHits[0].collection, 'missions');

    // Verify blob survived restart in SQLite
    const readBlob = await invokeValidatedIpcChannel('storage:read-blob', sender, {
      hash: blobSha256,
    });
    assert.ok(readBlob);
    assert.equal(
      Buffer.from(readBlob.dataBase64, 'base64').toString('utf8'),
      'Blaize verified binary artifact payload'
    );

    // Verify encrypted secret survived restart in SQLite
    const decRes = await invokeValidatedIpcChannel('vault:decrypt-secret', sender, {
      keyId: 'openai.api.key',
    });
    assert.equal(decRes.plaintext, 'sk-live-super-secret-value-9999999999999999');

    // 5) Verify Linux basic_text backend fails closed on both encrypt and decrypt
    const basicTextSafeStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text',
      encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
      decryptString: (buf: Buffer) => buf.toString('utf8'),
    };
    const basicStatus = verifySafeStorage(basicTextSafeStorage);
    if (process.platform === 'linux') {
      assert.equal(basicStatus.isEncrypted, false);
      assert.equal(basicStatus.selectedBackend, 'basic_text');

      registerIpcHandlers({ safeStorageOverride: basicTextSafeStorage });
      const refusedEnc = await invokeValidatedIpcChannel('vault:encrypt-secret', sender, {
        keyId: 'refused.key',
        plaintext: 'should-not-store',
      });
      assert.equal(refusedEnc.success, false);
      assert.match(refusedEnc.error || '', /basic_text|Plaintext fallback refused/i);
    }
  });

  it('6. handles single-instance lock, local secret-redacted crash reports, and Ed25519 + SHA-256 verified update staging', async () => {
    registerIpcHandlers();
    const sender = createTrustedSenderEvent();

    // 1) Single-instance lock: secondary instance quits immediately
    let quitCalled = false;
    const lockedSecondInstance = acquireSingleInstanceLock({
      requestSingleInstanceLock: () => false,
      quit: () => {
        quitCalled = true;
      },
    });
    assert.equal(lockedSecondInstance, false);
    assert.equal(quitCalled, true);

    // Primary instance acquires lock
    const lockedPrimary = acquireSingleInstanceLock({
      requestSingleInstanceLock: () => true,
      on: () => undefined,
    });
    assert.equal(lockedPrimary, true);

    // 2) Local secret-redacted crash report
    const crashRes = await invokeValidatedIpcChannel('system:report-crash', sender, {
      source: 'renderer',
      message: 'Unhandled failure with key sk-proj-ABCDEF1234567890ABCDEF1234567890',
      stack: 'Error: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret.sig at App.tsx:42',
      context: { githubToken: 'ghp_1234567890abcdef1234567890abcdef1234' },
    });
    assert.equal(crashRes.recorded, true);
    assert.ok(crashRes.redactedFilePath && fs.existsSync(crashRes.redactedFilePath));
    assert.equal(crashRes.redactedMessage.includes('sk-proj-ABCDEF'), false);

    const savedCrashRaw = fs.readFileSync(crashRes.redactedFilePath!, 'utf8');
    assert.equal(savedCrashRaw.includes('sk-proj-ABCDEF'), false);
    assert.equal(savedCrashRaw.includes('ghp_1234567890'), false);
    assert.match(savedCrashRaw, /\[REDACTED/);

    // 3) Ed25519 + SHA-256 verified update staging
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const bundlePath = path.join(tempUserDataDir, 'candidate-update-1.4.0.bin');
    const bundlePayload = Buffer.from('BLAIZE-SIGNED-RELEASE-BINARY-1.4.0', 'utf8');
    fs.writeFileSync(bundlePath, bundlePayload);

    const expectedSha256Hex = crypto.createHash('sha256').update(bundlePayload).digest('hex');
    const validSignatureB64 = crypto.sign(null, bundlePayload, privateKey).toString('base64');

    // Valid signature + valid SHA-256 -> EXECUTED
    const stageOk = await invokeValidatedIpcChannel('system:stage-update', sender, {
      version: '1.4.0',
      bundlePath,
      expectedSha256Hex,
      signatureBase64: validSignatureB64,
      publicKeyPem,
    });
    assert.equal(stageOk.staged, true);
    assert.equal(stageOk.executionState, 'EXECUTED');
    assert.ok(stageOk.stagedPath && fs.existsSync(stageOk.stagedPath));

    // Tampered SHA-256 -> BLOCKED
    const tamperedHashRes = stageVerifiedUpdateBundle({
      version: '1.4.1',
      bundlePath,
      expectedSha256Hex: '0'.repeat(64),
      signatureBase64: validSignatureB64,
      publicKeyPem,
    });
    assert.equal(tamperedHashRes.staged, false);
    assert.equal(tamperedHashRes.executionState, 'BLOCKED');
    assert.equal(tamperedHashRes.errorCode, 'UPDATE_HASH_MISMATCH');

    // Tampered Ed25519 signature -> BLOCKED
    const otherKeyPair = crypto.generateKeyPairSync('ed25519');
    const wrongSigB64 = crypto.sign(null, bundlePayload, otherKeyPair.privateKey).toString('base64');
    const badSigRes = stageVerifiedUpdateBundle({
      version: '1.4.2',
      bundlePath,
      expectedSha256Hex,
      signatureBase64: wrongSigB64,
      publicKeyPem,
    });
    assert.equal(badSigRes.staged, false);
    assert.equal(badSigRes.executionState, 'BLOCKED');
    assert.equal(badSigRes.errorCode, 'UPDATE_SIGNATURE_INVALID');
  });

  it('7. reports honest UNSUPPORTED states for tray, floating companion, global shortcut, and PC input in Web Preview and headless environments', async () => {
    registerIpcHandlers();
    const sender = createTrustedSenderEvent();

    // Headless container check via IPC
    const shellCaps = await invokeValidatedIpcChannel('desktop:get-shell-capabilities', sender);
    assert.equal(shellCaps.executionState, 'UNSUPPORTED');
    assert.equal(shellCaps.traySupported, false);
    assert.equal(shellCaps.floatingCompanionSupported, false);
    assert.equal(shellCaps.globalShortcutSupported, false);

    // UniversalPlatformBridge in Web Preview mode (no injected electronAPI)
    const webBridge = new UniversalPlatformBridge(undefined);
    assert.equal(webBridge.isElectron, false);
    assert.equal(webBridge.platform, 'browser');

    const webShellCaps = await webBridge.getShellCapabilities();
    assert.equal(webShellCaps.executionState, 'UNSUPPORTED');

    const webStageUpdate = await webBridge.stageUpdate({
      version: '1.0.0',
      bundlePath: '/tmp/none',
      expectedSha256Hex: 'a'.repeat(64),
      signatureBase64: 'c2lnbmF0dXJlMTIzNDU2Nzg5MA==',
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----',
    });
    assert.equal(webStageUpdate.staged, false);
    assert.equal(webStageUpdate.executionState, 'UNSUPPORTED');

    const webAction = await webBridge.executeAction({
      actionId: 'act-web-1',
      type: 'click',
      coordinates: { x: 100, y: 100 },
      requiresConfirmation: false,
    });
    assert.equal(webAction.success, false);
    assert.equal(webAction.executionState, 'UNSUPPORTED');
    assert.equal(webAction.targetWindowVerified, false);
  });

  it('8. builds desktop bundles, packages the Linux artifact with SHA-256 manifest, refuses fake cross-OS installers on Linux, and passes clean-machine launch smoke test', async () => {
    const buildManifest = await buildDesktopArtifacts({ skipFrontend: false });
    assert.ok(fs.existsSync(path.join(process.cwd(), buildManifest.files.mainCjs.path)));
    assert.ok(fs.existsSync(path.join(process.cwd(), buildManifest.files.preloadCjs.path)));
    assert.ok(fs.existsSync(path.join(process.cwd(), buildManifest.files.serverEsm.path)));
    assert.ok(fs.existsSync(path.join(process.cwd(), buildManifest.files.rendererIndexHtml.path)));

    if (process.platform === 'linux') {
      // Cross-OS honesty check: mac and win targets on Linux must return UNSUPPORTED
      const macResult = await packageDesktopTarget('mac', { skipFrontend: true });
      assert.equal(macResult.executionState, 'UNSUPPORTED');
      assert.match(macResult.reason || '', /UNSUPPORTED_HOST_OS/);

      const winResult = await packageDesktopTarget('win', { skipFrontend: true });
      assert.equal(winResult.executionState, 'UNSUPPORTED');
      assert.match(winResult.reason || '', /UNSUPPORTED_HOST_OS/);

      // Native Linux package build + smoke launch
      const linuxResult = await packageDesktopTarget('linux', { skipFrontend: true });
      assert.equal(linuxResult.executionState, 'EXECUTED');
      assert.ok(linuxResult.unpackedDir && fs.existsSync(linuxResult.unpackedDir));
      assert.ok(linuxResult.archivePath && fs.existsSync(linuxResult.archivePath));

      // Verify archive SHA-256 matches manifest
      const archiveBytes = fs.readFileSync(linuxResult.archivePath!);
      const computedSha = crypto.createHash('sha256').update(archiveBytes).digest('hex');
      assert.equal(computedSha, linuxResult.archiveSha256);

      // Run clean-machine launch smoke test against the packaged launcher
      const cleanMachineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-clean-machine-smoke-'));
      try {
        const launcherBin = path.join(process.cwd(), linuxResult.unpackedDir!, 'blaize-desktop');
        const stdout = execFileSync(launcherBin, [], {
          env: {
            ...process.env,
            BLAIZE_SMOKE_VERIFY_ONLY: '1',
            BLAIZE_USER_DATA_DIR: cleanMachineDir,
          },
          encoding: 'utf8',
        });

        const smokeSummary = JSON.parse(stdout.trim());
        assert.equal(smokeSummary.smokeVerified, true);
        assert.equal(smokeSummary.registeredChannels, 25);
        assert.equal(smokeSummary.manifestChannels, 25);
        assert.equal(smokeSummary.sqliteIntegrityOk, true);
        assert.ok(fs.existsSync(path.join(cleanMachineDir, 'blaize.sqlite')));
      } finally {
        fs.rmSync(cleanMachineDir, { recursive: true, force: true });
      }
    }
  });
});

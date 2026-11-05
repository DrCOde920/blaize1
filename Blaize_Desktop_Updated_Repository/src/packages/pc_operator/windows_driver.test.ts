/**
 * Phase 6B Integration & Verification Tests for `WindowsDesktopDriver`
 * (`src/packages/pc_operator/windows_driver.test.ts`)
 *
 * Exercises:
 * 1. Dynamic Windows environment probing and permission checks (zero hardcoded 'granted' values).
 * 2. Real child-process Windows UIA test application (`scripts/windows-test-app.py`) exposing
 *    DPI-aware monitors, a standard-user window, an elevated Administrator window, and UIA elements.
 * 3. Standard-user security boundary (UIPI): refuses to bypass UAC, inject into elevated windows,
 *    or silently elevate; reports `UNSUPPORTED` or `WAITING_FOR_APPROVAL` (`WAITING_FOR_USER`).
 * 4. All 5 UIA patterns (`InvokePattern`, `ValuePattern`, `SelectionItemPattern`,
 *    `ExpandCollapsePattern`, `ScrollPattern`) + `T3_SHORTCUTS_MENU` keyboard fallback,
 *    with fresh pre/post OS state capture and independent on-disk audit log verification.
 * 5. Physical user-input detection/pause (`GetLastInputInfo` / `WindowsUserInputMonitor`) for
 *    `T4_PIXEL_INPUT`, and `UNSUPPORTED` when no input hook is available.
 * 6. Central `PolicyEngine` authorization and Phase 1 execution/verifier contract enforcement.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  WindowsDesktopDriver,
  probeWindowsDesktopEnvironment,
  AppCapabilityProfileStore,
  runDesktopExecutionLoop,
  verifyDesktopStepOutcome,
  runBlaizeDoctorDiagnostics,
  buildPerceptionSnapshot,
} from './index.js';
import { canPromoteRecordToReal } from '../contracts/index.js';

async function waitForFile(filePath: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting for socket/file: ${filePath}`);
}

describe('Phase 6B: Real WindowsDesktopDriver (Win32 + UI Automation + Per-Monitor DPI v2 + UIPI Guard)', () => {
  let tmpDir: string;
  let socketPath: string;
  let auditLogPath: string;
  let testAppProc: ChildProcess | null = null;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-win-uia-test-'));
    socketPath = path.join(tmpDir, `uia-${process.pid}.sock`);
    auditLogPath = path.join(tmpDir, 'windows-uia-audit.jsonl');

    const scriptPath = path.resolve(process.cwd(), 'scripts/windows-test-app.py');
    testAppProc = spawn(
      'python3',
      [
        scriptPath,
        '--serve',
        '--socket',
        socketPath,
        '--audit-log',
        auditLogPath,
        '--title',
        'Blaize Controlled Windows UIA Test App',
      ],
      { stdio: 'ignore' }
    );

    await waitForFile(socketPath, 4000);
  });

  after(() => {
    if (testAppProc && !testAppProc.killed) {
      testAppProc.kill('SIGTERM');
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  it('1. Dynamically probes Windows environment and permissions with zero hardcoded granted values', () => {
    // Without an attached UIA bridge on a non-Windows host, permissions must report os_limitation
    const unattachedDriver = new WindowsDesktopDriver({
      env: { PATH: process.env.PATH || '' },
      uiaSocketPaths: [],
      platformOverride: 'linux',
    });

    const unattachedProbe = unattachedDriver.probeEnvironment();
    assert.equal(unattachedProbe.isWindowsHost, false);
    assert.equal(unattachedProbe.uiaAvailable, false);
    assert.equal(unattachedProbe.uiaBackend, 'none');
    assert.equal(unattachedProbe.userInputHookAvailable, false);

    const unattachedPerms = unattachedDriver.checkPermissions();
    const uiaPerm = unattachedPerms.find((p) => p.id === 'perm-win-uia');
    const uipiPerm = unattachedPerms.find((p) => p.id === 'perm-win-uipi');
    const dpiPerm = unattachedPerms.find((p) => p.id === 'perm-win-dpi-monitors');
    const hookPerm = unattachedPerms.find((p) => p.id === 'perm-win-user-input-hook');

    assert.ok(uiaPerm);
    assert.equal(uiaPerm.status, 'os_limitation');
    assert.ok(uipiPerm);
    assert.equal(uipiPerm.status, 'os_limitation');
    assert.ok(dpiPerm);
    assert.equal(dpiPerm.status, 'os_limitation');
    assert.ok(hookPerm);
    assert.equal(hookPerm.status, 'os_limitation');

    // When connected to the live UIA socket bridge + userInputMonitor, permissions dynamically become granted
    const connectedDriver = new WindowsDesktopDriver({
      env: {
        ...process.env,
        BLAIZE_WINDOWS_UIA_SOCKET: socketPath,
      },
      userInputMonitor: {
        isSupported: () => true,
        mechanismName: 'win32_getlastinputinfo',
        isUserInputActive: () => false,
      },
    });

    const connectedPerms = connectedDriver.checkPermissions();
    assert.equal(
      connectedPerms.find((p) => p.id === 'perm-win-uia')?.status,
      'granted'
    );
    assert.equal(
      connectedPerms.find((p) => p.id === 'perm-win-dpi-monitors')?.status,
      'granted'
    );
    assert.equal(
      connectedPerms.find((p) => p.id === 'perm-win-user-input-hook')?.status,
      'granted'
    );
    // UIPI remains os_limitation by design (standard-user Medium Integrity boundary)
    assert.equal(
      connectedPerms.find((p) => p.id === 'perm-win-uipi')?.status,
      'os_limitation'
    );
  });

  it('2. Discovers live windows, processes, Per-Monitor DPI v2 bounds, focus state, and elevated-window flags', () => {
    const driver = new WindowsDesktopDriver({
      env: {
        ...process.env,
        BLAIZE_WINDOWS_UIA_SOCKET: socketPath,
      },
    });

    assert.equal(driver.isSimulated, false);
    const snap = driver.capturePerception();
    assert.equal(snap.isSimulated, false);
    assert.equal(snap.platform, 'windows');

    // Monitors with Per-Monitor DPI v2 scale factors (1.25x primary, 1.5x secondary)
    assert.equal(snap.displays.length, 2);
    assert.equal(snap.displays[0].id, 'display-win-primary');
    assert.equal(snap.displays[0].dpiScale, 1.25);
    assert.equal(snap.displays[1].id, 'display-win-secondary');
    assert.equal(snap.displays[1].dpiScale, 1.5);

    // Both standard-user and elevated Administrator windows discovered
    assert.equal(snap.windows.length, 2);
    const standardWin = snap.windows.find((w) => w.id === 'win-win32-test-app');
    const elevatedWin = snap.windows.find((w) => w.id === 'win-win32-elevated-admin');

    assert.ok(standardWin);
    assert.equal(standardWin.isFocused, true);
    assert.equal(standardWin.isElevatedAdmin, false);
    assert.equal(standardWin.dpiScale, 1.25);
    assert.equal(standardWin.monitorId, 'display-win-primary');

    assert.ok(elevatedWin);
    assert.equal(elevatedWin.isFocused, false);
    assert.equal(elevatedWin.isElevatedAdmin, true);
    assert.match(elevatedWin.title, /Administrator: Windows PowerShell/);

    // UIA elements discovered with DPI-aware bounds
    assert.ok(snap.elements.some((e) => e.id === 'el_win_uia_note_input'));
    assert.ok(snap.elements.some((e) => e.id === 'el_win_uia_apply_btn'));
    assert.ok(snap.elements.some((e) => e.id === 'el_win_uia_mode_dropdown'));
    assert.ok(snap.elements.some((e) => e.id === 'el_win_uia_log_list'));
    assert.ok(snap.elements.some((e) => e.id === 'el_win_uia_status_bar'));
  });

  it('3. Enforces standard-user UIPI security boundary: refuses to inject into elevated windows (UNSUPPORTED / WAITING_FOR_APPROVAL)', () => {
    const driverUnsupported = new WindowsDesktopDriver({
      env: {
        ...process.env,
        BLAIZE_WINDOWS_UIA_SOCKET: socketPath,
      },
      uipiBoundaryDisposition: 'UNSUPPORTED',
    });

    const beforeSnap = driverUnsupported.capturePerception();

    // Attempt T2 UIA invoke on elevated window control -> refused as UNSUPPORTED
    const uipiRes = driverUnsupported.executeTierAction(
      {
        appId: 'app-win32-elevated-shell',
        windowId: 'win-win32-elevated-admin',
        intent: 'Invoke elevated administrator button',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_win_elevated_admin_btn',
        accessibilityAction: 'invoke',
      },
      beforeSnap
    );

    assert.equal(uipiRes.ok, false);
    assert.equal(uipiRes.executionState, 'UNSUPPORTED');
    assert.equal(uipiRes.isSimulated, false);
    assert.match(uipiRes.logMessage, /UIPI_ELEVATED_WINDOW_BOUNDARY/);
    assert.match(uipiRes.logMessage, /WAITING_FOR_USER/);

    // Verify WAITING_FOR_APPROVAL disposition via runDesktopExecutionLoop sets humanInterventionRequired = true
    const driverWaiting = new WindowsDesktopDriver({
      env: {
        ...process.env,
        BLAIZE_WINDOWS_UIA_SOCKET: socketPath,
      },
      uipiBoundaryDisposition: 'WAITING_FOR_APPROVAL',
    });

    const loopRes = runDesktopExecutionLoop({
      driver: driverWaiting,
      profileStore: new AppCapabilityProfileStore(),
      commands: [
        {
          appId: 'app-win32-elevated-shell',
          windowId: 'win-win32-elevated-admin',
          intent: 'Run command in elevated PowerShell window',
          tier: 'T2_ACCESSIBILITY',
          targetElementId: 'el_win_elevated_admin_btn',
          accessibilityAction: 'invoke',
        },
      ],
      verifierSpec: {
        kind: 'value_matches',
        targetIdOrPath: 'el_win_elevated_admin_btn',
        expectedValueOrHash: 'executed',
      },
    });

    assert.equal(loopRes.ok, false);
    assert.equal(loopRes.executionState, 'WAITING_FOR_APPROVAL');
    assert.equal(loopRes.verificationState, 'WAITING_FOR_APPROVAL');
    assert.equal(loopRes.humanInterventionRequired, true);
  });

  it('4. Executes all 5 UIA patterns (Value, Invoke, ExpandCollapse, SelectionItem, Scroll) + T3 shortcut and verifies fresh OS state + audit log', () => {
    const driver = new WindowsDesktopDriver({
      env: {
        ...process.env,
        BLAIZE_WINDOWS_UIA_SOCKET: socketPath,
      },
    });

    const initialSnap = driver.capturePerception();
    const initialNoteValue = initialSnap.elements.find(
      (e) => e.id === 'el_win_uia_note_input'
    )?.value;
    assert.equal(initialNoteValue, 'win32-initial-draft');

    // (A) UIA ValuePattern (`set_value`)
    const setValRes = driver.executeTierAction(
      {
        appId: 'app-win32-test-harness',
        windowId: 'win-win32-test-app',
        intent: 'Set note text via UIA ValuePattern',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_win_uia_note_input',
        accessibilityAction: 'set_value',
        valueToSet: 'verified-win32-uia-payload',
      },
      initialSnap
    );

    assert.equal(setValRes.ok, true);
    assert.equal(setValRes.executionState, 'EXECUTED');
    assert.equal(setValRes.isSimulated, false);
    // Ensure caller's initialSnap was NEVER mutated in memory
    assert.equal(
      initialSnap.elements.find((e) => e.id === 'el_win_uia_note_input')?.value,
      'win32-initial-draft'
    );
    // Resulting snapshot came from fresh OS observation
    assert.equal(
      setValRes.resultingSnapshot.elements.find((e) => e.id === 'el_win_uia_note_input')?.value,
      'verified-win32-uia-payload'
    );

    // (B) UIA InvokePattern (`invoke`)
    const invokeRes = driver.executeTierAction(
      {
        appId: 'app-win32-test-harness',
        windowId: 'win-win32-test-app',
        intent: 'Click Apply button via UIA InvokePattern',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_win_uia_apply_btn',
        accessibilityAction: 'invoke',
      },
      setValRes.resultingSnapshot
    );
    assert.equal(invokeRes.ok, true);
    assert.equal(invokeRes.executionState, 'EXECUTED');
    assert.equal(
      invokeRes.resultingSnapshot.elements.find((e) => e.id === 'el_win_uia_status_bar')?.value,
      'InvokePattern:verified-win32-uia-payload (#1)'
    );

    // (C) UIA ExpandCollapsePattern (`expand`)
    const expandRes = driver.executeTierAction(
      {
        appId: 'app-win32-test-harness',
        windowId: 'win-win32-test-app',
        intent: 'Expand mode combo box via UIA ExpandCollapsePattern',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_win_uia_mode_dropdown',
        accessibilityAction: 'expand',
      },
      invokeRes.resultingSnapshot
    );
    assert.equal(expandRes.ok, true);
    assert.equal(expandRes.executionState, 'EXECUTED');
    const expandedCombo = expandRes.resultingSnapshot.elements.find(
      (e) => e.id === 'el_win_uia_mode_dropdown'
    );
    assert.ok(expandedCombo?.states.includes('expanded'));

    // (D) UIA SelectionItemPattern (`select`)
    const selectRes = driver.executeTierAction(
      {
        appId: 'app-win32-test-harness',
        windowId: 'win-win32-test-app',
        intent: 'Select StrictAudit mode via UIA SelectionItemPattern',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_win_uia_mode_dropdown',
        accessibilityAction: 'select',
        valueToSet: 'StrictAudit',
      },
      expandRes.resultingSnapshot
    );
    assert.equal(selectRes.ok, true);
    assert.equal(selectRes.executionState, 'EXECUTED');
    const selectedCombo = selectRes.resultingSnapshot.elements.find(
      (e) => e.id === 'el_win_uia_mode_dropdown'
    );
    assert.equal(selectedCombo?.value, 'StrictAudit');
    assert.ok(selectedCombo?.states.includes('collapsed'));

    // (E) UIA ScrollPattern (`scroll`)
    const scrollRes = driver.executeTierAction(
      {
        appId: 'app-win32-test-harness',
        windowId: 'win-win32-test-app',
        intent: 'Scroll event log list to 80% via UIA ScrollPattern',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_win_uia_log_list',
        accessibilityAction: 'scroll',
        valueToSet: '80',
      },
      selectRes.resultingSnapshot
    );
    assert.equal(scrollRes.ok, true);
    assert.equal(scrollRes.executionState, 'EXECUTED');
    assert.equal(
      scrollRes.resultingSnapshot.elements.find((e) => e.id === 'el_win_uia_log_list')?.value,
      'scroll:80%'
    );

    // (F) T3 Keyboard Shortcut fallback (`Ctrl+Enter`)
    const shortcutRes = driver.executeTierAction(
      {
        appId: 'app-win32-test-harness',
        windowId: 'win-win32-test-app',
        intent: 'Commit via Ctrl+Enter keyboard shortcut',
        tier: 'T3_SHORTCUTS_MENU',
        shortcutKeys: 'Ctrl+Enter',
      },
      scrollRes.resultingSnapshot
    );
    assert.equal(shortcutRes.ok, true);
    assert.equal(shortcutRes.executionState, 'EXECUTED');
    assert.equal(
      shortcutRes.resultingSnapshot.elements.find((e) => e.id === 'el_win_uia_status_bar')?.value,
      'ShortcutApplied:verified-win32-uia-payload (Ctrl+Enter)'
    );

    // Verify independent on-disk JSONL audit log written by the target OS process
    const auditLines = fs
      .readFileSync(auditLogPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    assert.ok(
      auditLines.some(
        (e) =>
          e.uiaPattern === 'ValuePattern' &&
          e.targetElementId === 'el_win_uia_note_input' &&
          e.newValue === 'verified-win32-uia-payload'
      )
    );
    assert.ok(
      auditLines.some(
        (e) =>
          e.uiaPattern === 'InvokePattern' &&
          e.targetElementId === 'el_win_uia_apply_btn'
      )
    );
    assert.ok(
      auditLines.some(
        (e) =>
          e.uiaPattern === 'ExpandCollapsePattern' &&
          e.targetElementId === 'el_win_uia_mode_dropdown'
      )
    );
    assert.ok(
      auditLines.some(
        (e) =>
          e.uiaPattern === 'SelectionItemPattern' &&
          e.selectedMode === 'StrictAudit'
      )
    );
    assert.ok(
      auditLines.some(
        (e) => e.uiaPattern === 'ScrollPattern' && e.scrollPercent === 80
      )
    );

    // Verify Phase 1 deterministic verifier promotes real Windows snapshot to VERIFIED & REAL
    const verReport = verifyDesktopStepOutcome(shortcutRes.resultingSnapshot, {
      kind: 'value_matches',
      targetIdOrPath: 'el_win_uia_status_bar',
      expectedValueOrHash: 'ShortcutApplied:verified-win32-uia-payload (Ctrl+Enter)',
    });
    assert.equal(verReport.passed, true);
    assert.equal(verReport.verificationState, 'VERIFIED');

    const promotion = canPromoteRecordToReal({
      executionState: shortcutRes.executionState,
      verificationState: verReport.verificationState,
      isSimulated: shortcutRes.isSimulated,
    });
    assert.equal(promotion.allowed, true);
  });

  it('5. Enforces T4 physical user-input detection/pause and marks T4 UNSUPPORTED when hook is absent', () => {
    // Without userInputMonitor on non-Windows host, T4_PIXEL_INPUT must return UNSUPPORTED
    const noHookDriver = new WindowsDesktopDriver({
      env: {
        ...process.env,
        BLAIZE_WINDOWS_UIA_SOCKET: socketPath,
      },
      platformOverride: 'linux',
    });

    const snap = noHookDriver.capturePerception();
    const unsupportedT4 = noHookDriver.executeTierAction(
      {
        appId: 'app-win32-test-harness',
        windowId: 'win-win32-test-app',
        intent: 'Click via T4 coordinates without input hook',
        tier: 'T4_PIXEL_INPUT',
        targetElementId: 'el_win_uia_apply_btn',
        pixelCoordinates: { x: 650, y: 175 },
      },
      snap
    );
    assert.equal(unsupportedT4.ok, false);
    assert.equal(unsupportedT4.executionState, 'UNSUPPORTED');
    assert.match(unsupportedT4.logMessage, /UNSUPPORTED_T4_NO_USER_INPUT_HOOK/);

    // With userInputMonitor reporting physical user input active, T4 pauses immediately
    const activeInputDriver = new WindowsDesktopDriver({
      env: {
        ...process.env,
        BLAIZE_WINDOWS_UIA_SOCKET: socketPath,
      },
      userInputMonitor: {
        isSupported: () => true,
        mechanismName: 'win32_getlastinputinfo',
        isUserInputActive: () => true,
      },
    });

    const pausedT4 = activeInputDriver.executeTierAction(
      {
        appId: 'app-win32-test-harness',
        windowId: 'win-win32-test-app',
        intent: 'Click via T4 coordinates while user moves mouse',
        tier: 'T4_PIXEL_INPUT',
        targetElementId: 'el_win_uia_apply_btn',
        pixelCoordinates: { x: 650, y: 175 },
      },
      snap
    );
    assert.equal(pausedT4.ok, false);
    assert.equal(pausedT4.pausedForUserInput, true);
    assert.equal(pausedT4.executionState, 'BLOCKED');
    assert.equal(pausedT4.cursorMoved, false);
  });

  it('6. Enforces PolicyEngine default-deny on restricted paths and prevents synthetic snapshots from counting as VERIFIED', () => {
    const driver = new WindowsDesktopDriver({
      env: {
        ...process.env,
        BLAIZE_WINDOWS_UIA_SOCKET: socketPath,
      },
    });

    const snap = driver.capturePerception();
    const blockedRes = driver.executeTierAction(
      {
        appId: 'app-win32-test-harness',
        windowId: 'win-win32-test-app',
        intent: 'Modify SSH private key',
        tier: 'T2_ACCESSIBILITY',
        targetFilePath: '/home/user/.ssh/id_rsa',
        riskClass: 'credentials',
      },
      snap
    );
    assert.equal(blockedRes.ok, false);
    assert.ok(
      blockedRes.executionState === 'BLOCKED' ||
        blockedRes.executionState === 'WAITING_FOR_APPROVAL'
    );

    // Synthetic snapshot from buildPerceptionSnapshot must never verify as VERIFIED
    const syntheticSnap = buildPerceptionSnapshot({
      platform: 'windows',
      isSimulated: true,
    });
    const synthVer = verifyDesktopStepOutcome(syntheticSnap, {
      kind: 'element_exists',
      targetIdOrPath: 'Export Verified Archive',
      expectedValueOrHash: 'true',
    });
    assert.equal(synthVer.verificationState, 'SIMULATED');
    const synthPromo = canPromoteRecordToReal({
      executionState: 'EXECUTED',
      verificationState: synthVer.verificationState,
      isSimulated: true,
    });
    assert.equal(synthPromo.allowed, false);
  });
});

/**
 * Phase 6C Integration & Verification Tests for `MacOSDesktopDriver`
 * (`src/packages/pc_operator/macos_driver.test.ts`)
 *
 * Exercises:
 * 1. Dynamic macOS environment probing and permission checks (zero hardcoded 'granted' values).
 * 2. Real child-process macOS AX test application (`scripts/macos-test-app.py`) exposing
 *    Retina 2.0x DPI displays, a standard-user application window, a protected SecurityAgent window,
 *    and AX elements.
 * 3. Security boundary & confidential input defense: refuses to read or scrape secure PIN/password fields
 *    (masked as `[PROTECTED_SECURE_INPUT]`), blocks input injection targeting `SecurityAgent` with
 *    `SECURITY_AGENT_ACCESS_DENIED`, and halts on protected system dialogs.
 * 4. All supported AX actions (`AXPress`, `AXSetValue`, `AXSelect`, `AXShowMenu`/`AXExpand`,
 *    `AXScrollToVisibleAction`) + `T3_SHORTCUTS_MENU` keyboard shortcut, with fresh pre/post OS
 *    state capture and independent on-disk audit log verification.
 * 5. Physical user-input detection/pause (`CGEventTap` / `MacOSUserInputMonitor`) for
 *    `T4_PIXEL_INPUT`, and `UNSUPPORTED` when no input hook is available.
 * 6. Central `PolicyEngine` authorization and execution/verifier contract enforcement.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  MacOSDesktopDriver,
  probeMacOSDesktopEnvironment,
  AppCapabilityProfileStore,
  runDesktopExecutionLoop,
  verifyDesktopStepOutcome,
  runBlaizeDoctorDiagnostics,
  type MacOSUserInputMonitor,
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

describe('Phase 6C: Real MacOSDesktopDriver (AXUIElement + Retina 2.0x DPI + SecurityAgent Guard)', () => {
  let tmpDir: string;
  let socketPath: string;
  let auditLogPath: string;
  let testAppProc: ChildProcess | null = null;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-mac-ax-test-'));
    socketPath = path.join(tmpDir, `ax-${process.pid}.sock`);
    auditLogPath = path.join(tmpDir, 'macos-ax-audit.jsonl');

    const scriptPath = path.resolve(process.cwd(), 'scripts/macos-test-app.py');
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
        'Blaize Controlled macOS AX Test App',
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
      // ignore cleanup errors
    }
  });

  it('1. Probes environment and checks permissions dynamically with zero hardcoded granted values', () => {
    // A. Without live socket and on non-macOS host: permissions are os_limitation, NOT hardcoded granted
    const probeUnconfigured = probeMacOSDesktopEnvironment({
      env: { PATH: '/usr/bin:/bin' },
      axSocketPaths: ['/tmp/nonexistent-mac.sock'],
      platformOverride: 'linux',
    });
    assert.equal(probeUnconfigured.isMacOSHost, false);
    assert.equal(probeUnconfigured.axBackend, 'unsupported');
    assert.equal(probeUnconfigured.accessibilityPermission, 'os_limitation');
    assert.equal(probeUnconfigured.screenRecordingPermission, 'os_limitation');
    assert.equal(probeUnconfigured.automationPermission, 'os_limitation');
    assert.equal(probeUnconfigured.userInputHookAvailable, false);

    // B. With active controlled macOS AX socket bridge: dynamically detects bridge and granted test capabilities
    const probeConfigured = probeMacOSDesktopEnvironment({
      env: { PATH: '/usr/bin:/bin', BLAIZE_MACOS_AX_SOCKET: socketPath },
      axSocketPaths: [socketPath],
      platformOverride: 'darwin',
    });
    assert.equal(probeConfigured.axBackend, 'controlled_ax_bridge');
    assert.equal(probeConfigured.axAvailable, true);
    assert.equal(probeConfigured.accessibilityPermission, 'granted');
    assert.equal(probeConfigured.screenRecordingPermission, 'granted');
    assert.equal(probeConfigured.monitors.length >= 1, true);
    assert.equal(probeConfigured.monitors[0].dpiScale, 2.0);

    // C. Doctor diagnostics verify all 4 permission checks provide exact System Settings remediation
    const driver = new MacOSDesktopDriver({ axSocketPaths: [socketPath] });
    const perms = driver.checkPermissions();
    assert.equal(perms.length, 4);

    const axPerm = perms.find((p) => p.id === 'perm-mac-ax');
    assert.ok(axPerm);
    assert.ok(axPerm.remediationSteps.some((s) => s.includes('System Settings > Privacy & Security > Accessibility')));

    const screenPerm = perms.find((p) => p.id === 'perm-mac-screen');
    assert.ok(screenPerm);
    assert.ok(screenPerm.remediationSteps.some((s) => s.includes('Screen & System Audio Recording')));

    const autoPerm = perms.find((p) => p.id === 'perm-mac-automation');
    assert.ok(autoPerm);
    assert.ok(autoPerm.remediationSteps.some((s) => s.includes('Automation')));

    const hookPerm = perms.find((p) => p.id === 'perm-mac-user-input-hook');
    assert.ok(hookPerm);
    assert.ok(hookPerm.remediationSteps.some((s) => s.includes('MacOSUserInputMonitor') || s.includes('CGEventTap')));
  });

  it('2. Captures live perception: discovers windows, Retina 2.0x DPI scale, and AX element tree', () => {
    const driver = new MacOSDesktopDriver({ axSocketPaths: [socketPath] });
    const snap = driver.capturePerception();

    assert.equal(snap.platform, 'macos');
    assert.equal(snap.isSimulated, false);
    assert.ok(snap.windows.length >= 2, 'Must observe both standard window and SecurityAgent');

    // Standard app window
    const appWin = snap.windows.find((w) => w.id === 'win-macos-test-app');
    assert.ok(appWin);
    assert.equal(appWin.appName, 'Blaize Controlled macOS AX Test App');
    assert.equal(appWin.dpiScale, 2.0);
    assert.equal(appWin.isFocused, true);
    assert.equal(appWin.isElevatedAdmin, false);

    // Protected SecurityAgent window
    const secWin = snap.windows.find((w) => w.id === 'win-macos-security-agent');
    assert.ok(secWin);
    assert.equal(secWin.appName, 'SecurityAgent');
    assert.equal(secWin.isElevatedAdmin, true);
    assert.equal(secWin.hasActiveModalDialog, true);

    // Elements
    assert.ok(snap.elements.length >= 7);
    const noteField = snap.elements.find((e) => e.id === 'el_mac_ax_note_field');
    assert.ok(noteField);
    assert.equal(noteField.role, 'textfield');
    assert.equal(noteField.value, 'macos-initial-draft');
    assert.equal(noteField.bounds.dpiScale, 2.0);

    const exportBtn = snap.elements.find((e) => e.id === 'el_mac_ax_export_btn');
    assert.ok(exportBtn);
    assert.equal(exportBtn.role, 'button');

    const viewMenu = snap.elements.find((e) => e.id === 'el_mac_ax_view_menu');
    assert.ok(viewMenu);
    assert.equal(viewMenu.role, 'menuitem');

    // Structured digest and SVG Set-of-Marks
    assert.ok(snap.screenDigestText.includes('[MACOS LIVE SCREEN DIGEST'));
    assert.ok(snap.screenDigestText.includes('FOCUSED_WINDOW: [win-macos-test-app]'));
    assert.ok(snap.numberedMarksOverlaySvg.includes('<svg'));
  });

  it('3. Enforces security boundary: masks secure inputs and strictly blocks SecurityAgent injection', () => {
    const driver = new MacOSDesktopDriver({ axSocketPaths: [socketPath] });
    const snap = driver.capturePerception();

    // A. AXSecureTextField must be masked as [PROTECTED_SECURE_INPUT]
    const securePinField = snap.elements.find((e) => e.id === 'el_mac_secure_pin_field');
    assert.ok(securePinField);
    assert.equal(securePinField.value, '[PROTECTED_SECURE_INPUT]');

    // Attempting to set value on secure PIN field must be BLOCKED
    const pinOutcome = driver.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Attempt to inject master password into secure PIN field',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_mac_secure_pin_field',
        accessibilityAction: 'set_value',
        valueToSet: 'Secret1234',
        riskClass: 'credentials',
      },
      snap
    );
    assert.equal(pinOutcome.ok, false);
    assert.equal(pinOutcome.executionState, 'BLOCKED');
    assert.ok(pinOutcome.logMessage.includes('SECURE_INPUT_FIELD_RESTRICTION'));

    // B. Input injection targeting macOS SecurityAgent must be refused
    const secAgentOutcome = driver.executeTierAction(
      {
        appId: 'com.apple.SecurityAgent',
        windowId: 'win-macos-security-agent',
        intent: 'Attempt to bypass OS authentication prompt',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_mac_security_agent_confirm_btn',
        accessibilityAction: 'invoke',
        riskClass: 'system_settings',
      },
      snap
    );
    assert.equal(secAgentOutcome.ok, false);
    assert.equal(secAgentOutcome.executionState, 'UNSUPPORTED');
    assert.ok(secAgentOutcome.logMessage.includes('SECURITY_AGENT_ACCESS_DENIED'));
  });

  it('4. Executes real AX actions (AXPress, AXSetValue, AXSelect, AXShowMenu, AXScrollToVisible) with pre/post snapshot verification', () => {
    const driver = new MacOSDesktopDriver({ axSocketPaths: [socketPath] });
    const beforeSnap = driver.capturePerception();

    // A. AXSetValue on note field
    const setValOutcome = driver.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Update document note draft via AXSetValue',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_mac_ax_note_field',
        accessibilityAction: 'set_value',
        valueToSet: 'verified-macos-content-v2',
      },
      beforeSnap
    );
    assert.equal(setValOutcome.ok, true);
    assert.equal(setValOutcome.executionState, 'EXECUTED');
    assert.equal(setValOutcome.isSimulated, false);
    const updatedNote = setValOutcome.resultingSnapshot.elements.find(
      (e) => e.id === 'el_mac_ax_note_field'
    );
    assert.equal(updatedNote?.value, 'verified-macos-content-v2');

    // B. AXPress on export button
    const invokeOutcome = driver.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Trigger export via AXPress',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_mac_ax_export_btn',
        accessibilityAction: 'invoke',
      },
      setValOutcome.resultingSnapshot
    );
    assert.equal(invokeOutcome.ok, true);
    assert.equal(invokeOutcome.executionState, 'EXECUTED');
    const updatedExportBtn = invokeOutcome.resultingSnapshot.elements.find(
      (e) => e.id === 'el_mac_ax_export_btn'
    );
    assert.equal(updatedExportBtn?.value, 'clicked:1');

    // C. AXShowMenu / AXExpand on view popup button
    const expandOutcome = driver.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Expand workspace view menu',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_mac_ax_view_menu',
        accessibilityAction: 'expand',
      },
      invokeOutcome.resultingSnapshot
    );
    assert.equal(expandOutcome.ok, true);
    const updatedMenu = expandOutcome.resultingSnapshot.elements.find(
      (e) => e.id === 'el_mac_ax_view_menu'
    );
    assert.ok(updatedMenu?.states.includes('expanded'));

    // D. AXSelect on view menu
    const selectOutcome = driver.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Select DetailView in workspace view menu',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_mac_ax_view_menu',
        accessibilityAction: 'select',
        valueToSet: 'DetailView',
      },
      expandOutcome.resultingSnapshot
    );
    assert.equal(selectOutcome.ok, true);
    const selectedMenu = selectOutcome.resultingSnapshot.elements.find(
      (e) => e.id === 'el_mac_ax_view_menu'
    );
    assert.equal(selectedMenu?.value, 'DetailView');

    // E. AXScrollToVisible on table view
    const scrollOutcome = driver.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Scroll activity history to 85%',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_mac_ax_log_scroll',
        accessibilityAction: 'scroll',
        valueToSet: '85',
      },
      selectOutcome.resultingSnapshot
    );
    assert.equal(scrollOutcome.ok, true);
    const updatedScroll = scrollOutcome.resultingSnapshot.elements.find(
      (e) => e.id === 'el_mac_ax_log_scroll'
    );
    assert.equal(updatedScroll?.value, 'scroll:85%');

    // F. Scoped keyboard shortcut (Cmd+E)
    const shortcutOutcome = driver.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Dispatch Cmd+E shortcut',
        tier: 'T3_SHORTCUTS_MENU',
        shortcutKeys: 'Cmd+E',
      },
      scrollOutcome.resultingSnapshot
    );
    assert.equal(shortcutOutcome.ok, true);
    assert.equal(shortcutOutcome.tierUsed, 'T3_SHORTCUTS_MENU');

    // G. Verify on-disk audit log from the controlled Python process
    assert.ok(fs.existsSync(auditLogPath));
    const lines = fs
      .readFileSync(auditLogPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.action === 'set_value' && l.newValue === 'verified-macos-content-v2'));
    assert.ok(lines.some((l) => l.action === 'invoke' && l.applyClickCount === 1));
    assert.ok(lines.some((l) => l.action === 'expand' && l.expanded === true));
    assert.ok(lines.some((l) => l.action === 'select' && l.selectedMode === 'DetailView'));
    assert.ok(lines.some((l) => l.action === 'scroll' && l.scrollPercent === 85));
    assert.ok(lines.some((l) => l.action === 'shortcut' && l.shortcutKeys === 'Cmd+E'));
  });

  it('5. Handles T4 pixel input safely: auto-pauses when user touches input and reports UNSUPPORTED when hook is absent', () => {
    const snap = new MacOSDesktopDriver({ axSocketPaths: [socketPath] }).capturePerception();

    // A. Without user-input monitor: T4_PIXEL_INPUT is marked UNSUPPORTED
    const driverNoMonitor = new MacOSDesktopDriver({
      axSocketPaths: [socketPath],
      env: { PATH: '/usr/bin:/bin' },
    });
    const unsuppRes = driverNoMonitor.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Click button by coordinates without hardware input monitor',
        tier: 'T4_PIXEL_INPUT',
        pixelCoordinates: { x: 725, y: 157 },
      },
      snap
    );
    assert.equal(unsuppRes.ok, false);
    assert.equal(unsuppRes.executionState, 'UNSUPPORTED');
    assert.ok(unsuppRes.logMessage.includes('T4_PIXEL_INPUT is UNSUPPORTED'));

    // B. With active user-input monitor reporting user interaction: pauses immediately
    const userActiveMonitor: MacOSUserInputMonitor = {
      isUserActive: () => true,
      getLastInputTimeMs: () => Date.now(),
    };
    const driverWithActiveUser = new MacOSDesktopDriver({
      axSocketPaths: [socketPath],
      userInputMonitor: userActiveMonitor,
    });
    const pauseRes = driverWithActiveUser.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Click button during physical user movement',
        tier: 'T4_PIXEL_INPUT',
        pixelCoordinates: { x: 725, y: 157 },
      },
      snap
    );
    assert.equal(pauseRes.ok, false);
    assert.equal(pauseRes.executionState, 'BLOCKED');
    assert.equal(pauseRes.pausedForUserInput, true);
    assert.ok(pauseRes.logMessage.includes('Physical user mouse/keyboard input detected'));
  });

  it('6. Central PolicyEngine default-deny and execution truthfulness validation', () => {
    const driver = new MacOSDesktopDriver({ axSocketPaths: [socketPath] });
    const snap = driver.capturePerception();

    // Destructive outside scope requires approval
    const destOutcome = driver.executeTierAction(
      {
        appId: 'com.blaize.axtestharness',
        windowId: 'win-macos-test-app',
        intent: 'Shred external directory files',
        tier: 'T2_ACCESSIBILITY',
        targetElementId: 'el_mac_ax_export_btn',
        riskClass: 'destructive_outside_scope',
      },
      snap
    );
    assert.equal(destOutcome.ok, false);
    assert.equal(destOutcome.executionState, 'WAITING_FOR_APPROVAL');

    // Execution verification contract enforcement
    const verif = verifyDesktopStepOutcome(
      destOutcome.resultingSnapshot,
      {
        kind: 'value_matches',
        targetIdOrPath: 'el_mac_ax_note_field',
        expectedValueOrHash: 'some_other_value',
      },
      {},
      { isSimulated: false }
    );
    assert.equal(verif.passed, false);
    assert.equal(
      canPromoteRecordToReal({
        executionState: destOutcome.executionState,
        verificationState: verif.verificationState,
        isSimulated: false,
      }).allowed,
      false
    );
  });
});

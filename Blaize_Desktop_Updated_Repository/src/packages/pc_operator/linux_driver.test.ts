import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  LinuxDesktopDriver,
  WaylandPortalSessionManager,
  probeLinuxDesktopEnvironment,
  enumerateRealLinuxProcesses,
  AppCapabilityProfileStore,
  buildPerceptionSnapshot,
  verifyDesktopStepOutcome,
  runDesktopExecutionLoop,
  runBlaizeDoctorDiagnostics,
} from './index.js';
import { canPromoteRecordToReal } from '../contracts/index.js';

async function waitForFile(filePath: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Timed out waiting for socket file at ${filePath}`);
}

describe('Phase 6A: Real Linux Desktop Driver (AT-SPI2 / D-Bus / Wayland Portal / Verifier)', () => {
  it('1. Detects Linux session type (Wayland/X11/headless), desktop environment, AT-SPI2, portals, and real /proc processes', () => {
    // Headless environment detection
    const headlessProbe = probeLinuxDesktopEnvironment({
      env: {
        PATH: process.env.PATH,
        LANG: 'en_US.UTF-8',
      },
    });
    assert.equal(headlessProbe.sessionType, 'headless');
    assert.equal(headlessProbe.desktopEnvironment, 'headless');
    assert.equal(headlessProbe.atSpiAvailable, false);
    assert.equal(headlessProbe.userInputHookAvailable, false);

    // X11 environment detection
    const x11Probe = probeLinuxDesktopEnvironment({
      env: {
        XDG_SESSION_TYPE: 'x11',
        DISPLAY: ':0',
        XDG_CURRENT_DESKTOP: 'XFCE',
        PATH: '/nonexistent',
      },
    });
    assert.equal(x11Probe.sessionType, 'x11');
    assert.equal(x11Probe.desktopEnvironment, 'XFCE');

    // Wayland environment detection
    const waylandProbe = probeLinuxDesktopEnvironment({
      env: {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
        XDG_CURRENT_DESKTOP: 'ubuntu:GNOME',
        PATH: '/nonexistent',
      },
    });
    assert.equal(waylandProbe.sessionType, 'wayland');
    assert.equal(waylandProbe.desktopEnvironment, 'ubuntu:GNOME');

    // Real /proc process enumeration on Linux
    const procs = enumerateRealLinuxProcesses(10);
    assert.ok(procs.length >= 1, 'Expected at least 1 real process from /proc');
    assert.ok(
      procs.some((p) => p.pid === process.pid || p.pid > 0),
      'Expected real OS PIDs from /proc'
    );
  });

  it('2. Checks Linux permissions dynamically with zero hardcoded granted values and provides exact remediation commands', () => {
    const headlessDriver = new LinuxDesktopDriver({
      env: {
        PATH: '/nonexistent',
      },
    });
    assert.equal(headlessDriver.isSimulated, false);
    assert.equal(headlessDriver.platform, 'linux');

    const perms = headlessDriver.checkPermissions();
    assert.equal(perms.length, 4);

    // None of the permissions may be hardcoded to 'granted' in a bare headless environment
    for (const perm of perms) {
      assert.notEqual(
        perm.status,
        'granted',
        `Permission ${perm.id} must not be hardcoded to granted when environment lacks service`
      );
      assert.ok(perm.remediationSteps.length >= 1, `Expected remediation steps for ${perm.id}`);
    }

    const atSpiPerm = perms.find((p) => p.id === 'perm-linux-atspi')!;
    assert.equal(atSpiPerm.status, 'needs_setup');
    assert.ok(
      atSpiPerm.remediationSteps.some((s) => s.includes('toolkit-accessibility true')),
      'Expected gsettings toolkit-accessibility remediation command'
    );
    assert.ok(
      atSpiPerm.remediationSteps.some((s) => s.includes('QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1')),
      'Expected QT_LINUX_ACCESSIBILITY_ALWAYS_ON remediation command'
    );

    const portalPerm = perms.find((p) => p.id === 'perm-linux-portal-screencast')!;
    assert.ok(
      portalPerm.remediationSteps.some((s) => s.includes('xdg-desktop-portal')),
      'Expected xdg-desktop-portal remediation command'
    );

    // Doctor diagnostics on Linux reflects real permission state
    const doctor = runBlaizeDoctorDiagnostics('linux');
    assert.ok(doctor.permissions.some((p) => p.id === 'perm-linux-atspi'));
    assert.ok(doctor.checks.some((c) => c.id === 'doc-a11y'));
  });

  it('3. Enumerates real Linux test app window & controls, executes authorized click/type/read, and verifies fresh OS observation + audit log', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-linux-a11y-'));
    const sockPath = path.join(tmpDir, 'atspi-test-app.sock');
    const auditLogPath = path.join(tmpDir, 'audit.jsonl');
    const scriptPath = path.resolve(process.cwd(), 'scripts/linux-test-app.py');

    let child: ChildProcess | null = null;
    try {
      child = spawn('python3', [scriptPath, '--serve', '--socket', sockPath, '--audit-log', auditLogPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await waitForFile(sockPath);

      const driver = new LinuxDesktopDriver({
        env: {
          ...process.env,
          BLAIZE_LINUX_ATSPI_SOCKET: sockPath,
          XDG_SESSION_TYPE: 'x11',
          DISPLAY: ':99',
          XDG_CURRENT_DESKTOP: 'GNOME',
        },
      });

      // Dynamic permission check now sees the live AT-SPI2 socket as granted
      const perms = driver.checkPermissions();
      const atSpiPerm = perms.find((p) => p.id === 'perm-linux-atspi')!;
      assert.equal(atSpiPerm.status, 'granted');

      // 1. Read-only perception enumerates the real Python test application window and its 4 controls
      const initialSnap = driver.capturePerception();
      assert.equal(initialSnap.isSimulated, false);
      assert.equal(initialSnap.windows.length, 1);

      const appWin = initialSnap.windows[0];
      assert.equal(appWin.id, 'win-linux-test-app');
      assert.equal(appWin.title, 'Blaize Controlled Linux Test App');
      assert.equal(appWin.processId, child.pid);
      assert.equal(fs.existsSync(`/proc/${appWin.processId}/comm`), true);

      assert.equal(initialSnap.elements.length, 4);
      const noteInput = initialSnap.elements.find((e) => e.id === 'el_linux_test_note_input')!;
      const applyBtn = initialSnap.elements.find((e) => e.id === 'el_linux_test_apply_btn')!;
      const statusBar = initialSnap.elements.find((e) => e.id === 'el_linux_test_status_bar')!;
      assert.ok(noteInput);
      assert.ok(applyBtn);
      assert.ok(statusBar);
      assert.equal(noteInput.value, 'initial-draft');
      assert.equal(statusBar.value, 'Ready');

      // 2. Execute authorized type (set_value) + click (invoke) via runDesktopExecutionLoop
      const profileStore = new AppCapabilityProfileStore();
      const loopResult = runDesktopExecutionLoop({
        driver,
        profileStore,
        commands: [
          {
            appId: 'app-linux-test',
            windowId: 'win-linux-test-app',
            intent: 'Type verification note into Linux test app input field',
            tier: 'T2_ACCESSIBILITY',
            targetElementId: 'el_linux_test_note_input',
            accessibilityAction: 'set_value',
            valueToSet: 'verified-linux-note-42',
            riskClass: 'write_in_scope',
          },
          {
            appId: 'app-linux-test',
            windowId: 'win-linux-test-app',
            intent: 'Click Apply Note button via AT-SPI2 Action.DoAction',
            tier: 'T2_ACCESSIBILITY',
            targetElementId: 'el_linux_test_apply_btn',
            accessibilityAction: 'invoke',
            riskClass: 'write_in_scope',
          },
        ],
        verifierSpec: {
          kind: 'value_matches',
          targetIdOrPath: 'el_linux_test_status_bar',
          expectedValueOrHash: 'Applied:verified-linux-note-42 (#1)',
        },
      });

      assert.equal(loopResult.ok, true);
      assert.equal(loopResult.isSimulated, false);
      assert.equal(loopResult.executionState, 'EXECUTED');
      assert.equal(loopResult.verificationState, 'VERIFIED');
      assert.equal(loopResult.verification.deterministicCheckPassed, true);

      // Promotion gate allows this record because it is genuinely EXECUTED + VERIFIED + non-simulated
      assert.equal(
        canPromoteRecordToReal({
          executionState: loopResult.executionState,
          verificationState: loopResult.verificationState,
          isSimulated: loopResult.isSimulated,
        }).allowed,
        true
      );

      // 3. Independent OS re-observation confirms the test app process state changed
      const independentAfterSnap = driver.capturePerception();
      assert.notEqual(independentAfterSnap.snapshotId, initialSnap.snapshotId);
      const afterNote = independentAfterSnap.elements.find((e) => e.id === 'el_linux_test_note_input')!;
      const afterStatus = independentAfterSnap.elements.find((e) => e.id === 'el_linux_test_status_bar')!;
      assert.equal(afterNote.value, 'verified-linux-note-42');
      assert.equal(afterStatus.value, 'Applied:verified-linux-note-42 (#1)');

      // 4. Independent audit log written by the Python process on disk confirms real IPC execution
      assert.equal(fs.existsSync(auditLogPath), true);
      const auditLines = fs
        .readFileSync(auditLogPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.ok(auditLines.some((entry) => entry.pid === child?.pid));
      assert.ok(
        auditLines.some(
          (entry) =>
            entry.action === 'set_value' &&
            entry.targetElementId === 'el_linux_test_note_input' &&
            entry.newValue === 'verified-linux-note-42'
        )
      );
      assert.ok(
        auditLines.some(
          (entry) =>
            entry.action === 'invoke' &&
            entry.targetElementId === 'el_linux_test_apply_btn' &&
            entry.applyClickCount === 1
        )
      );
    } finally {
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. Enforces Wayland XDG Desktop Portal ScreenCast/RemoteDesktop consent and accurately reports unsupported Wayland global input', () => {
    const portalManager = new WaylandPortalSessionManager();
    assert.equal(portalManager.getState().consentStatus, 'unrequested');

    const waylandDriver = new LinuxDesktopDriver({
      portalManager,
      env: {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
        XDG_CURRENT_DESKTOP: 'GNOME',
        PATH: '/nonexistent',
      },
      userInputMonitor: {
        isSupported: () => true,
        mechanismName: 'hardware_monitor_callback',
        isUserInputActive: () => false,
      },
    });

    const snap = waylandDriver.capturePerception();

    // Global coordinate injection on Wayland without portal RemoteDesktop consent is UNSUPPORTED
    const unconsentedT4 = waylandDriver.executeTierAction(
      {
        appId: 'app-linux-test',
        windowId: 'win-linux-test-app',
        intent: 'Attempt global coordinate click on Wayland without portal consent',
        tier: 'T4_PIXEL_INPUT',
        pixelCoordinates: { x: 200, y: 200 },
      },
      snap
    );
    assert.equal(unconsentedT4.ok, false);
    assert.equal(unconsentedT4.executionState, 'UNSUPPORTED');
    assert.equal(unconsentedT4.isSimulated, false);
    assert.match(unconsentedT4.logMessage, /UNSUPPORTED_WAYLAND_GLOBAL_INPUT/);

    // Requesting consent transitions through waiting_for_consent -> granted with restoreToken
    const waitingState = portalManager.requestPortalSession({
      portalAvailable: true,
      requestScreenCast: true,
      requestRemoteDesktopInput: true,
    });
    assert.equal(waitingState.consentStatus, 'waiting_for_consent');

    const grantedState = portalManager.requestPortalSession({
      portalAvailable: true,
      requestScreenCast: true,
      requestRemoteDesktopInput: true,
      restoreToken: 'wayland-portal-restore-token-xyz987',
      userApprovedConsentDialog: true,
    });
    assert.equal(grantedState.consentStatus, 'granted');
    assert.equal(grantedState.restoreToken, 'wayland-portal-restore-token-xyz987');
    assert.equal(grantedState.remoteDesktopAvailable, true);
  });

  it('5. Enforces T4 physical user-input detection and marks T4 UNSUPPORTED when no user-input hook is available', () => {
    // Case A: No userInputMonitor hook -> T4_PIXEL_INPUT is marked UNSUPPORTED (never falsely claims protection)
    const driverWithoutHook = new LinuxDesktopDriver({
      env: {
        XDG_SESSION_TYPE: 'x11',
        DISPLAY: ':0',
        PATH: '/nonexistent',
      },
    });
    const snap = driverWithoutHook.capturePerception();
    const unsupportedT4 = driverWithoutHook.executeTierAction(
      {
        appId: 'app-linux-test',
        windowId: 'win-linux-test-app',
        intent: 'Click coordinate without user input monitor hook',
        tier: 'T4_PIXEL_INPUT',
        pixelCoordinates: { x: 150, y: 150 },
      },
      snap
    );
    assert.equal(unsupportedT4.ok, false);
    assert.equal(unsupportedT4.executionState, 'UNSUPPORTED');
    assert.match(unsupportedT4.logMessage, /UNSUPPORTED_T4_NO_USER_INPUT_HOOK/);

    // Case B: userInputMonitor hook is armed and detects physical user mouse/keyboard input -> pauses immediately
    const physicalTouchActive = true;
    const driverWithArmedHook = new LinuxDesktopDriver({
      env: {
        XDG_SESSION_TYPE: 'x11',
        DISPLAY: ':0',
        PATH: '/nonexistent',
      },
      userInputMonitor: {
        isSupported: () => true,
        mechanismName: 'hardware_monitor_callback',
        isUserInputActive: () => physicalTouchActive,
      },
    });
    const pausedT4 = driverWithArmedHook.executeTierAction(
      {
        appId: 'app-linux-test',
        windowId: 'win-linux-test-app',
        intent: 'Click coordinate while user is moving mouse',
        tier: 'T4_PIXEL_INPUT',
        pixelCoordinates: { x: 150, y: 150 },
      },
      snap
    );
    assert.equal(pausedT4.ok, false);
    assert.equal(pausedT4.pausedForUserInput, true);
    assert.equal(pausedT4.executionState, 'BLOCKED');
    assert.equal(pausedT4.cursorMoved, false);
    assert.match(pausedT4.logMessage, /PAUSED: Physical user mouse\/keyboard input detected/);
  });

  it('6. Enforces PolicyEngine default-deny on LinuxDesktopDriver and prevents synthetic snapshots from being labelled VERIFIED or REAL', () => {
    const driver = new LinuxDesktopDriver({
      env: { PATH: '/nonexistent' },
    });
    const snap = driver.capturePerception();

    // Credential / destructive action is halted by PolicyEngine before touching any OS socket
    const blockedCred = driver.executeTierAction(
      {
        appId: '1password',
        windowId: 'win-1p',
        intent: 'Read master password from vault',
        tier: 'T2_ACCESSIBILITY',
        riskClass: 'credentials',
      },
      snap
    );
    assert.equal(blockedCred.ok, false);
    assert.ok(
      blockedCred.executionState === 'BLOCKED' ||
        blockedCred.executionState === 'WAITING_FOR_APPROVAL'
    );

    // Synthetic snapshot produced by buildPerceptionSnapshot has isSimulated: true
    const syntheticSnap = buildPerceptionSnapshot({ platform: 'linux' });
    assert.equal(syntheticSnap.isSimulated, true);

    // Passing a synthetic snapshot to verifyDesktopStepOutcome NEVER produces verificationState === 'VERIFIED'
    const syntheticVerification = verifyDesktopStepOutcome(syntheticSnap, {
      kind: 'element_exists',
      targetIdOrPath: syntheticSnap.elements[0].id,
      expectedValueOrHash: 'present',
    });
    assert.equal(syntheticVerification.passed, true);
    assert.equal(
      syntheticVerification.verificationState,
      'SIMULATED',
      'Synthetic snapshot must never be labelled VERIFIED'
    );
    assert.equal(
      canPromoteRecordToReal({
        executionState: 'EXECUTED',
        verificationState: syntheticVerification.verificationState,
        isSimulated: syntheticSnap.isSimulated,
      }).allowed,
      false,
      'Synthetic snapshot must never be promotable to REAL evidence'
    );
  });
});

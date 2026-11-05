# Blaize Linux Desktop Driver — Integration & Manual Verification Checklist (`Phase 6A`)

## 1. Exercised Runner Environment Details (Automated Integration Run)

- **Kernel / Architecture**: `Linux x86_64` (`/proc` filesystem active)
- **Python Runtime**: `Python 3.10.12` (`/usr/bin/python3`)
- **Display / Session State in Container**: `headless` (`DISPLAY` unset, `WAYLAND_DISPLAY` unset, `XDG_SESSION_TYPE` unset, `DBUS_SESSION_BUS_ADDRESS` unset)
- **AT-SPI2 Bridge Exercised**: Live `AF_UNIX` accessibility socket bridge (`scripts/linux-test-app.py --serve --socket <path> --audit-log <path>`)
- **Automated Integration Suite**: `npx tsx --test src/packages/pc_operator/linux_driver.test.ts` (6/6 tests passing)

### What Was Exercised Live on This Linux Host
1. **Kernel Process & Window Verification**:
   - Spawned `scripts/linux-test-app.py` as a real child process with verifiable `/proc/<pid>/comm` and `/proc/<pid>/statm`.
   - `LinuxDesktopDriver.capturePerception()` queried the running process over `AF_UNIX` (`0o600` permissions) and enumerated `win-linux-test-app` (`"Blaize Controlled Linux Test App"`) and its 4 accessibility controls (`el_linux_test_note_input`, `el_linux_test_apply_btn`, `el_linux_test_confirm_checkbox`, `el_linux_test_status_bar`) with `isSimulated: false`.
2. **Authorized T2 Accessibility Actions & Independent Pre/Post Observation**:
   - Dispatched `set_value` (`"verified-linux-note-42"`) to `el_linux_test_note_input` and `invoke` (click) to `el_linux_test_apply_btn` through `runDesktopExecutionLoop`.
   - Verified that `beforeSnapshot` and `afterSnapshot` are distinct fresh OS observations (`linux_obs_1_*` vs `linux_obs_3_*`).
   - Verified that `el_linux_test_status_bar` updated to `"Applied:verified-linux-note-42 (#1)"` (`executionState: 'EXECUTED'`, `verificationState: 'VERIFIED'`, `isSimulated: false`).
   - Verified the independent JSONL audit log on disk written by the Python process.
3. **Wayland XDG Desktop Portal & T4 User-Input Guard**:
   - Verified that on Wayland without `org.freedesktop.portal.RemoteDesktop` consent, `T4_PIXEL_INPUT` returns `executionState: 'UNSUPPORTED'` (`UNSUPPORTED_WAYLAND_GLOBAL_INPUT`).
   - Verified that when no physical user-input monitoring hook (`XInput2` / `libinput` / hardware callback) is available, `T4_PIXEL_INPUT` returns `executionState: 'UNSUPPORTED'` (`UNSUPPORTED_T4_NO_USER_INPUT_HOOK`).
   - Verified that when a user-input monitor detects physical mouse/keyboard movement during `T4_PIXEL_INPUT`, execution immediately halts (`pausedForUserInput: true`, `executionState: 'BLOCKED'`, `cursorMoved: false`).
4. **Synthetic Snapshot Isolation**:
   - Verified that synthetic snapshots (`buildPerceptionSnapshot` with `isSimulated: true`) never produce `verificationState: 'VERIFIED'` in `verifyDesktopStepOutcome` and are rejected by `canPromoteRecordToReal`.

---

## 2. Manual Verification Checklist for Interactive Linux Desktop Sessions

### A. X11 Desktop Session (GNOME on Xorg / XFCE / KDE Plasma X11)
1. **Install Required System Packages (Ubuntu/Debian)**:
   ```bash
   sudo apt-get update
   sudo apt-get install -y at-spi2-core gir1.2-atspi-2.0 x11-utils wmctrl xdotool x11-xserver-utils xinput libsecret-1-0 gnome-keyring
   ```
2. **Enable Toolkit Accessibility**:
   ```bash
   gsettings set org.gnome.desktop.interface toolkit-accessibility true
   export QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1
   ```
3. **Verify Session & Permissions**:
   - Check `echo $XDG_SESSION_TYPE $DISPLAY` outputs `x11 :0` (or active display).
   - Run `gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus --method org.a11y.Bus.GetAddress` and confirm an AT-SPI2 bus address is returned.
   - Start Blaize Desktop (`npm run desktop:dev`) and open **PC Operator -> Blaize Doctor**.
   - Confirm `perm-linux-atspi`, `perm-linux-display`, and `perm-linux-user-input-hook` report `granted`.
4. **Verify Window Enumeration & T2 Action**:
   - Launch the controlled test app:
     ```bash
     python3 scripts/linux-test-app.py --serve --socket /tmp/blaize-atspi.sock --audit-log /tmp/blaize-atspi-audit.jsonl
     export BLAIZE_LINUX_ATSPI_SOCKET=/tmp/blaize-atspi.sock
     ```
   - Trigger a read/type/click mission in Blaize and verify `/tmp/blaize-atspi-audit.jsonl` records the real actions without moving the physical X11 cursor.

### B. Wayland Desktop Session (GNOME Wayland / KDE Plasma Wayland)
1. **Install XDG Desktop Portal Backend**:
   ```bash
   sudo apt-get install -y xdg-desktop-portal xdg-desktop-portal-gnome at-spi2-core
   ```
2. **Verify Wayland Session & Portal Introspection**:
   - Check `echo $XDG_SESSION_TYPE $WAYLAND_DISPLAY` outputs `wayland wayland-0`.
   - Run:
     ```bash
     gdbus introspect --session --dest org.freedesktop.portal.Desktop --object-path /org/freedesktop/portal/desktop
     ```
   - Confirm `org.freedesktop.portal.ScreenCast` and `org.freedesktop.portal.RemoteDesktop` interfaces are present.
3. **Verify Wayland Global Input Restriction & Portal Consent Flow**:
   - Before granting portal consent, attempt a `T4_PIXEL_INPUT` coordinate click. Confirm Blaize reports `UNSUPPORTED` (`UNSUPPORTED_WAYLAND_GLOBAL_INPUT`) and recommends `T1_DIRECT_TOOLS` or `T2_ACCESSIBILITY`.
   - Grant `ScreenCast` + `RemoteDesktop` consent via the desktop portal prompt and confirm a `restoreToken` is issued for the session.

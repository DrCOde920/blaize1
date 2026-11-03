# Windows Desktop Driver (`WindowsDesktopDriver`) Verification & Manual Test Checklist

This document specifies both the **automated integration test suite** (`src/packages/pc_operator/windows_driver.test.ts` + `scripts/windows-test-app.py`) and the **native Windows 10/11 VM / host verification checklist** for Phase 6B (`WindowsDesktopDriver`).

---

## 1. Automated Integration Test Harness (Cross-Host & CI)

Run the automated Windows driver test suite:

```bash
npx tsx --test src/packages/pc_operator/windows_driver.test.ts
```

What the automated suite exercises:
1. **Dynamic Capability & Permission Probing**:
   - Verifies `probeWindowsDesktopEnvironment()` and `checkPermissions()` contain zero hardcoded `'granted'` strings.
   - Confirms `perm-win-uia`, `perm-win-dpi-monitors`, and `perm-win-user-input-hook` report `'os_limitation'` when no Windows host or UIA socket bridge is present, and transition to `'granted'` when connected to a live UIA bridge (`BLAIZE_WINDOWS_UIA_SOCKET`).
   - Confirms `perm-win-uipi` (`Windows Elevated-Window Boundary (UIPI Integrity Guard)`) reports `'os_limitation'` by design.
2. **Real OS Process & Window/Monitor Discovery**:
   - Spawns `scripts/windows-test-app.py` as a live OS child process.
   - Verifies Per-Monitor DPI v2 display bounds (`1.25x` primary monitor, `1.5x` secondary monitor), foreground/focus state (`isFocused`), and elevated-window detection (`isElevatedAdmin: false` on `win-win32-test-app` vs `isElevatedAdmin: true` on `win-win32-elevated-admin`).
3. **Standard-User Security Boundary (UIPI / UAC Guard)**:
   - Verifies `WindowsDesktopDriver` never bypasses UAC, never injects into elevated Administrator windows (`isElevatedAdmin === true`), and never silently elevates.
   - Verifies actions targeting `win-win32-elevated-admin` or `el_win_elevated_admin_btn` return `ok: false`, `executionState: 'UNSUPPORTED'` (or `'WAITING_FOR_APPROVAL'` with `humanInterventionRequired: true`), and log `UIPI_ELEVATED_WINDOW_BOUNDARY (... / WAITING_FOR_USER)`.
4. **All 5 UIA Patterns + T3 Shortcut Fallback & Fresh Pre/Post Snapshot Verification**:
   - Exercises:
     - `ValuePattern` (`set_value` on `el_win_uia_note_input`)
     - `InvokePattern` (`invoke` on `el_win_uia_apply_btn`)
     - `ExpandCollapsePattern` (`expand` on `el_win_uia_mode_dropdown`)
     - `SelectionItemPattern` (`select` on `el_win_uia_mode_dropdown`)
     - `ScrollPattern` (`scroll` on `el_win_uia_log_list`)
     - `T3_SHORTCUTS_MENU` (`Ctrl+Enter` shortcut fallback)
   - Confirms `beforeSnapshot` is never mutated in memory, `afterSnapshot` is freshly queried from the live target process, and the independent JSONL audit log (`--audit-log`) records each UIA pattern invocation.
5. **Physical User-Input Detection & Pause (`T4_PIXEL_INPUT`)**:
   - Confirms `T4_PIXEL_INPUT` returns `UNSUPPORTED` when no physical input monitor (`GetLastInputInfo` / `WindowsUserInputMonitor`) is available.
   - Confirms `T4_PIXEL_INPUT` immediately pauses (`pausedForUserInput: true`, `executionState: 'BLOCKED'`) when physical user mouse/keyboard activity is detected.
6. **Trust Kernel (`PolicyEngine`) & Verifier Contract**:
   - Confirms restricted paths (e.g. `~/.ssh/id_rsa`) are denied by `globalPolicyEngine` before execution.
   - Confirms synthetic snapshots (`isSimulated: true`) never verify as `VERIFIED` or promote via `canPromoteRecordToReal`.

---

## 2. Native Windows 10 / 11 Host or VM Manual Test Checklist

When exercising `WindowsDesktopDriver` on a native Windows 10 (22H2+) or Windows 11 (23H2+) desktop VM:

- [ ] **Standard-User Integrity Verification**:
  - Launch Blaize from a standard (Medium Integrity) user shell (`whoami /groups` shows `Mandatory Label\Medium Mandatory Level`).
  - Run `Blaize Doctor` (`runBlaizeDoctorDiagnostics('windows')`) and confirm `perm-win-uia` is `granted` via `dotnet_uia3` and `perm-win-uipi` is `os_limitation`.
- [ ] **Win32 Window Discovery & Per-Monitor DPI v2**:
  - Configure primary display at `125%` or `150%` scaling and secondary display at `100%`.
  - Open Notepad (`notepad.exe`) and Calculator (`calc.exe`).
  - Trigger `capturePerception()` and verify both windows appear with accurate `processId`, `title`, `dpiScale`, and `monitorId`.
- [ ] **UIPI Elevated Window Refusal**:
  - Launch an elevated PowerShell window (`Run as Administrator` -> `"Administrator: Windows PowerShell"`).
  - Attempt a PC Operator action targeting the elevated PowerShell window.
  - Verify Blaize immediately refuses with `UIPI_ELEVATED_WINDOW_BOUNDARY (UNSUPPORTED / WAITING_FOR_USER)` without injecting keys or mouse events.
- [ ] **T4 Physical Mouse/Keyboard Interrupt**:
  - Trigger a `T4_PIXEL_INPUT` action while moving the physical mouse cursor.
  - Verify `GetLastInputInfo` detects user activity and yields the cursor (`pausedForUserInput: true`, `executionState: 'BLOCKED'`).

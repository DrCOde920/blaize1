# macOS Desktop Driver (`MacOSDesktopDriver`) Verification & Checklist

This document details the architecture, permissions model, security boundaries, and automated/manual verification checklist for Blaize's native macOS Desktop Driver (`MacOSDesktopDriver`).

---

## 1. Architecture Overview

`MacOSDesktopDriver` (`src/packages/pc_operator/macos_driver.ts`) implements the full cross-platform PC Operator protocol for macOS environments:
- **Observation**: Discovers windows and top-level application hierarchies via `ApplicationServices AXUIElement` APIs (`AXUIElementCopyAttributeValue`, `kAXWindowsAttribute`, `kAXTitleAttribute`, `kAXRoleAttribute`, `kAXPositionAttribute`, `kAXSizeAttribute`) and `ScreenCaptureKit` per-window Retina ROI captures.
- **Actions**: Dispatches real accessibility actions (`AXPress`, `AXSetValue`, `AXSelect`, `AXShowMenu` / `AXExpand`, `AXScrollToVisibleAction`) and scoped AppleEvents / JXA automation.
- **Retina Scaling**: Accurately tracks Retina 2.0x DPI scaling across native Liquid Retina XDR displays and external 4K/5K displays without blur or coordinate truncation.
- **Truthful Status**: Reports `isSimulated: false` and `executionState: 'EXECUTED'` when interacting with live applications, and accurately surfaces `UNSUPPORTED`, `BLOCKED`, or `WAITING_FOR_APPROVAL` when OS security constraints prevent execution.

---

## 2. Security Boundaries & Invariants

1. **macOS SecurityAgent & Protected System Windows**:
   - `SecurityAgent`, `coreauthd`, `Keychain Access`, `1Password`, `Bitwarden`, and macOS system authentication dialogs are treated as absolute security boundaries.
   - Any attempt to inject input or synthetic keystrokes targeting `win-macos-security-agent` or `SecurityAgent` authentication prompts is refused with `SECURITY_AGENT_ACCESS_DENIED` (`BLOCKED` / `UNSUPPORTED`).
   - Standard-user desktop processes must never attempt to hijack Touch ID prompts or admin authentication windows.

2. **Secure Input Fields (`AXSecureTextField`)**:
   - Master passwords, PINs, OTP codes, and passkey prompts are never scraped or logged.
   - Any password or secure text field is masked as `[PROTECTED_SECURE_INPUT]` at the perception boundary.
   - Direct accessibility injection (`set_value`) on secure input fields is refused with `SECURE_INPUT_FIELD_RESTRICTION` (`BLOCKED`).

3. **Physical User-Input Auto-Pause (Requirement 6)**:
   - For `T4_PIXEL_INPUT` operations, an active user-input monitor (`CGEventTap` / `MacOSUserInputMonitor`) must be armed.
   - If user physical movement (mouse move or keystroke) is detected during pixel-tier execution, execution immediately yields cursor control with `pausedForUserInput: true` and `executionState: 'BLOCKED'`.
   - If no hardware input monitor is available in the current macOS session, `T4_PIXEL_INPUT` is marked `UNSUPPORTED`.

4. **Central Policy Engine Boundary**:
   - Every driver invocation is evaluated by `globalPolicyEngine.evaluateToolCall` immediately before execution.
   - High-risk operations (e.g. destructive file deletes outside workspace, system privilege changes) trigger `WAITING_FOR_APPROVAL` or default-deny `BLOCKED`.

---

## 3. Native macOS Host Configuration Checklist

When deploying or testing on a physical macOS machine (macOS Ventura 13+, Sonoma 14+, or Sequoia 15+):

### A. Accessibility Permission (`perm-mac-ax`)
- Open **System Settings > Privacy & Security > Accessibility**.
- Enable the toggle next to **Blaize Desktop** (or Terminal / iTerm2 if executing via CLI test runner).
- Verify via command:
  ```bash
  python3 -c "import ApplicationServices; print(ApplicationServices.AXIsProcessTrusted())"
  ```
- Driver dynamic status: `checkPermissions()` will transition from `'needs_setup'` to `'granted'`.

### B. Screen Recording Permission (`perm-mac-screen`)
- Open **System Settings > Privacy & Security > Screen & System Audio Recording**.
- Grant permission to **Blaize Desktop** to allow Retina ROI window captures via `ScreenCaptureKit`.
- Driver dynamic status: `checkPermissions()` will transition from `'needs_setup'` to `'granted'`.

### C. Automation / AppleEvents Permission (`perm-mac-automation`)
- Open **System Settings > Privacy & Security > Automation**.
- Under **Blaize Desktop**, ensure permission is granted to automate target apps (e.g., Finder, Mail).
- Driver dynamic status: `checkPermissions()` will transition from `'needs_setup'` to `'granted'`.

### D. User Input Monitoring (`perm-mac-user-input-hook`)
- Open **System Settings > Privacy & Security > Input Monitoring**.
- Enable the toggle for Blaize to permit `CGEventTapCreate` hardware interrupt monitoring for instant `<15ms` cursor yield.

---

## 4. Controlled Test Application (`scripts/macos-test-app.py`)

For automated CI environments (including Linux/Docker test runners where native macOS APIs are absent), Blaize provides a controlled AX test application:

```bash
# Start test harness daemon
python3 scripts/macos-test-app.py --serve --socket /tmp/ax-test.sock --audit-log /tmp/ax-audit.jsonl

# Query perception hierarchy
python3 scripts/macos-test-app.py --query --socket /tmp/ax-test.sock

# Dispatch action
python3 scripts/macos-test-app.py --action --socket /tmp/ax-test.sock --payload '{"actionType":"invoke","targetElementId":"el_mac_ax_export_btn"}'
```

This harness exposes:
- **Retina 2.0x display geometry**: `1728x1117` Liquid Retina XDR display + `2560x1440` external display.
- **Application window**: `win-macos-test-app` with 7 real AX controls (text fields, buttons, pop-up menus, tables, status bar, secure PIN input).
- **Protected window**: `win-macos-security-agent` (`SecurityAgent`, elevated admin: true).
- **Independent on-disk JSONL audit log**: Validates that every dispatched action mutates real state on disk.

---

## 5. Verification Commands

Run the full automated test suite and verification gates:

```bash
# Run the macOS driver unit & integration tests
npx tsx --test src/packages/pc_operator/macos_driver.test.ts

# Run the complete test suite (22 test suites)
npm test

# Run the full 9-gate verification pipeline
npm run verify

# Verify browser preview compilation
npm run build
```

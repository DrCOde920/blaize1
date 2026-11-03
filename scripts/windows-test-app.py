#!/usr/bin/env python3
"""
Blaize Controlled Windows UI Automation (UIA) Test Application & IPC Bridge
(`scripts/windows-test-app.py`)

Runs as a real OS process and exposes a Windows UIA-structured window and control tree
(including Per-Monitor DPI v2 bounds, foreground/focus state, a standard-user window,
an elevated Administrator window for UIPI boundary testing, and UIA patterns:
InvokePattern, ValuePattern, SelectionItemPattern, ExpandCollapsePattern, ScrollPattern)
over a local IPC domain socket (`uia-<pid>.sock`).

Modes:
1. Daemon mode:
   python3 scripts/windows-test-app.py --serve --socket <path> [--audit-log <path>] [--title <str>]
2. Query mode (reads live windows + UIA element tree from running daemon):
   python3 scripts/windows-test-app.py --query --socket <path>
3. Action mode (dispatches UIA pattern or shortcut to running daemon):
   python3 scripts/windows-test-app.py --action --socket <path> --payload '<json>'
"""

import argparse
import json
import os
import signal
import socket
import sys
import time
from typing import Any, Dict, List


class ControlledWindowsUiaTestApp:
    def __init__(self, socket_path: str, audit_log_path: str, window_title: str) -> None:
        self.socket_path = socket_path
        self.audit_log_path = audit_log_path
        self.pid = os.getpid()
        self.elevated_pid = self.pid + 10000
        self.window_id = "win-win32-test-app"
        self.app_id = "app-win32-test-harness"
        self.app_name = "Blaize Controlled Windows UIA Test App"
        self.window_title = window_title
        self.is_focused = True
        self.is_minimized = False
        self.dpi_scale = 1.25
        self.monitor_id = "display-win-primary"
        self.bounds = {"x": 150, "y": 110, "width": 840, "height": 580}

        # Live UIA pattern states (only mutated by real action handlers)
        self.note_value = "win32-initial-draft"
        self.apply_click_count = 0
        self.dropdown_expanded = False
        self.selected_mode = "StandardUser"
        self.scroll_percent = 0
        self.status_text = "Ready"
        self.last_shortcut = ""

    def append_audit(self, event: Dict[str, Any]) -> None:
        if not self.audit_log_path:
            return
        record = {
            "timestampMs": int(time.time() * 1000),
            "pid": self.pid,
            **event,
        }
        with open(self.audit_log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")

    def get_uia_snapshot(self) -> Dict[str, Any]:
        dropdown_states: List[str] = ["enabled", "selected"]
        dropdown_states.append("expanded" if self.dropdown_expanded else "collapsed")

        elements: List[Dict[str, Any]] = [
            {
                "id": "el_win_uia_note_input",
                "windowId": self.window_id,
                "role": "textfield",
                "name": "UIA ValuePattern Note Box",
                "value": self.note_value,
                "bounds": {
                    "x": 180,
                    "y": 165,
                    "width": 440,
                    "height": 36,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled", "focused"],
                "supportedActions": ["set_value", "invoke"],
                "shortcutHint": "Ctrl+L",
            },
            {
                "id": "el_win_uia_apply_btn",
                "windowId": self.window_id,
                "role": "button",
                "name": "UIA InvokePattern Apply Button",
                "value": f"invoked:{self.apply_click_count}",
                "bounds": {
                    "x": 640,
                    "y": 165,
                    "width": 160,
                    "height": 36,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled"],
                "supportedActions": ["invoke"],
                "shortcutHint": "Ctrl+Enter",
            },
            {
                "id": "el_win_uia_mode_dropdown",
                "windowId": self.window_id,
                "role": "menuitem",
                "name": "UIA ExpandCollapse & SelectionItem Combo",
                "value": self.selected_mode,
                "bounds": {
                    "x": 180,
                    "y": 225,
                    "width": 280,
                    "height": 32,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": dropdown_states,
                "supportedActions": ["expand", "select", "invoke"],
            },
            {
                "id": "el_win_uia_log_list",
                "windowId": self.window_id,
                "role": "listitem",
                "name": "UIA ScrollPattern Event List",
                "value": f"scroll:{self.scroll_percent}%",
                "bounds": {
                    "x": 180,
                    "y": 280,
                    "width": 620,
                    "height": 220,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled"],
                "supportedActions": ["scroll", "scroll_into_view", "select"],
            },
            {
                "id": "el_win_uia_status_bar",
                "windowId": self.window_id,
                "role": "statusbar",
                "name": "Win32 Application Status Bar",
                "value": self.status_text,
                "bounds": {
                    "x": 150,
                    "y": 650,
                    "width": 840,
                    "height": 36,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled"],
                "supportedActions": ["invoke"],
            },
            {
                "id": "el_win_elevated_admin_btn",
                "windowId": "win-win32-elevated-admin",
                "role": "button",
                "name": "Execute Elevated Administrator Command",
                "value": "uipi_protected",
                "bounds": {
                    "x": 310,
                    "y": 240,
                    "width": 260,
                    "height": 36,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled"],
                "supportedActions": ["invoke"],
            },
        ]

        standard_window = {
            "id": self.window_id,
            "appId": self.app_id,
            "appName": self.app_name,
            "title": self.window_title,
            "processId": self.pid,
            "processName": "WindowsTestHarness.exe",
            "virtualDesktopId": "vdesk-win-1",
            "monitorId": self.monitor_id,
            "dpiScale": self.dpi_scale,
            "bounds": self.bounds,
            "isFocused": self.is_focused,
            "isMinimized": self.is_minimized,
            "isOccluded": False,
            "isElevatedAdmin": False,
            "isSlowOrNotResponding": False,
            "hasActiveModalDialog": False,
        }

        elevated_window = {
            "id": "win-win32-elevated-admin",
            "appId": "app-win32-elevated-shell",
            "appName": "Windows PowerShell (Elevated)",
            "title": "Administrator: Windows PowerShell",
            "processId": self.elevated_pid,
            "processName": "powershell.exe",
            "virtualDesktopId": "vdesk-win-1",
            "monitorId": self.monitor_id,
            "dpiScale": self.dpi_scale,
            "bounds": {"x": 280, "y": 180, "width": 780, "height": 500},
            "isFocused": False,
            "isMinimized": False,
            "isOccluded": True,
            "isElevatedAdmin": True,
            "isSlowOrNotResponding": False,
            "hasActiveModalDialog": False,
        }

        monitors = [
            {
                "id": self.monitor_id,
                "name": "Win32 Primary Monitor (Per-Monitor DPI v2 125%)",
                "bounds": {"x": 0, "y": 0, "width": 1920, "height": 1080},
                "workArea": {"x": 0, "y": 0, "width": 1920, "height": 1032},
                "dpiScale": self.dpi_scale,
                "isPrimary": True,
            },
            {
                "id": "display-win-secondary",
                "name": "Win32 Secondary Monitor (Per-Monitor DPI v2 150%)",
                "bounds": {"x": 1920, "y": 0, "width": 2560, "height": 1440},
                "workArea": {"x": 1920, "y": 0, "width": 2560, "height": 1392},
                "dpiScale": 1.5,
                "isPrimary": False,
            },
        ]

        return {
            "ok": True,
            "pid": self.pid,
            "socketPath": self.socket_path,
            "monitors": monitors,
            "windows": [standard_window, elevated_window],
            "elements": elements,
        }

    def execute_action(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        action_type = payload.get("actionType", "invoke")
        target_id = payload.get("targetElementId", "")
        value = payload.get("valueToSet")
        shortcut = payload.get("shortcutKeys")

        # Hard defense in test app too: reject any attempt to touch elevated window element
        if target_id == "el_win_elevated_admin_btn":
            self.append_audit(
                {
                    "action": "blocked_uipi_violation",
                    "targetElementId": target_id,
                }
            )
            return {
                "ok": False,
                "error": "UIPI_ACCESS_DENIED: Cannot interact with High-Integrity elevated window from standard user process.",
            }

        if action_type == "set_value" and target_id == "el_win_uia_note_input":
            self.note_value = str(value if value is not None else "")
            self.status_text = f"ValuePattern:{self.note_value}"
            self.append_audit(
                {
                    "action": "set_value",
                    "uiaPattern": "ValuePattern",
                    "targetElementId": target_id,
                    "newValue": self.note_value,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"UIA ValuePattern.SetValue on {target_id} -> '{self.note_value}'",
            }

        if action_type in ("invoke", "click") and target_id == "el_win_uia_apply_btn":
            self.apply_click_count += 1
            self.status_text = f"InvokePattern:{self.note_value} (#{self.apply_click_count})"
            self.append_audit(
                {
                    "action": "invoke",
                    "uiaPattern": "InvokePattern",
                    "targetElementId": target_id,
                    "applyClickCount": self.apply_click_count,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"UIA InvokePattern.Invoke on {target_id} (count={self.apply_click_count})",
            }

        if action_type == "expand" and target_id == "el_win_uia_mode_dropdown":
            self.dropdown_expanded = not self.dropdown_expanded
            state_label = "Expanded" if self.dropdown_expanded else "Collapsed"
            self.status_text = f"ExpandCollapsePattern:{state_label}"
            self.append_audit(
                {
                    "action": "expand",
                    "uiaPattern": "ExpandCollapsePattern",
                    "targetElementId": target_id,
                    "expanded": self.dropdown_expanded,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"UIA ExpandCollapsePattern on {target_id} -> {state_label}",
            }

        if action_type == "select" and target_id == "el_win_uia_mode_dropdown":
            self.selected_mode = str(value if value is not None else "AuditMode")
            self.dropdown_expanded = False
            self.status_text = f"SelectionItemPattern:{self.selected_mode}"
            self.append_audit(
                {
                    "action": "select",
                    "uiaPattern": "SelectionItemPattern",
                    "targetElementId": target_id,
                    "selectedMode": self.selected_mode,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"UIA SelectionItemPattern.Select on {target_id} -> '{self.selected_mode}'",
            }

        if action_type in ("scroll", "scroll_into_view") and target_id == "el_win_uia_log_list":
            try:
                requested_pct = int(str(value)) if value is not None else 75
            except ValueError:
                requested_pct = 75
            self.scroll_percent = max(0, min(100, requested_pct))
            self.status_text = f"ScrollPattern:{self.scroll_percent}%"
            self.append_audit(
                {
                    "action": "scroll",
                    "uiaPattern": "ScrollPattern",
                    "targetElementId": target_id,
                    "scrollPercent": self.scroll_percent,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"UIA ScrollPattern.SetScrollPercent on {target_id} -> {self.scroll_percent}%",
            }

        if action_type == "shortcut" and shortcut:
            self.last_shortcut = str(shortcut)
            if shortcut in ("Ctrl+Enter", "Ctrl+S"):
                self.apply_click_count += 1
                self.status_text = f"ShortcutApplied:{self.note_value} ({shortcut})"
            else:
                self.status_text = f"Shortcut:{shortcut}"
            self.append_audit(
                {
                    "action": "shortcut",
                    "shortcutKeys": shortcut,
                    "statusText": self.status_text,
                }
            )
            return {"ok": True, "detail": f"Dispatched Win32 shortcut {shortcut}"}

        return {
            "ok": False,
            "error": f"Unsupported UIA action '{action_type}' on target '{target_id}'",
        }


def run_server(socket_path: str, audit_log_path: str, title: str) -> None:
    if os.path.exists(socket_path):
        os.unlink(socket_path)

    app = ControlledWindowsUiaTestApp(socket_path, audit_log_path, title)
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(socket_path)
    os.chmod(socket_path, 0o600)
    srv.listen(16)

    def handle_sig(_signum: int, _frame: Any) -> None:
        try:
            srv.close()
        except Exception:
            pass
        if os.path.exists(socket_path):
            try:
                os.unlink(socket_path)
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_sig)
    signal.signal(signal.SIGINT, handle_sig)

    app.append_audit({"action": "server_started", "title": title, "socketPath": socket_path})

    while True:
        try:
            conn, _ = srv.accept()
        except Exception:
            break
        with conn:
            raw = b""
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                raw += chunk
                if b"\n" in raw:
                    break
            try:
                req = json.loads(raw.decode("utf-8").strip())
                cmd = req.get("cmd", "query")
                if cmd == "query":
                    resp = app.get_uia_snapshot()
                elif cmd == "action":
                    resp = app.execute_action(req.get("payload", {}))
                else:
                    resp = {"ok": False, "error": f"Unknown cmd: {cmd}"}
            except Exception as exc:
                resp = {"ok": False, "error": str(exc)}
            conn.sendall((json.dumps(resp) + "\n").encode("utf-8"))


def send_client_request(socket_path: str, req: Dict[str, Any]) -> Dict[str, Any]:
    cli = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    cli.settimeout(2.5)
    cli.connect(socket_path)
    with cli:
        cli.sendall((json.dumps(req) + "\n").encode("utf-8"))
        buf = b""
        while True:
            chunk = cli.recv(4096)
            if not chunk:
                break
            buf += chunk
            if b"\n" in buf:
                break
        return json.loads(buf.decode("utf-8").strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Controlled Windows UIA Test Application")
    parser.add_argument("--serve", action="store_true", help="Run as UIA socket server")
    parser.add_argument("--query", action="store_true", help="Query UIA tree from socket")
    parser.add_argument("--action", action="store_true", help="Dispatch UIA action to socket")
    parser.add_argument("--socket", required=True, help="Socket path")
    parser.add_argument("--audit-log", default="", help="Path to JSONL audit log")
    parser.add_argument(
        "--title",
        default="Blaize Controlled Windows UIA Test App",
        help="Window title",
    )
    parser.add_argument("--payload", default="{}", help="JSON payload for --action")
    args = parser.parse_args()

    if args.serve:
        run_server(args.socket, args.audit_log, args.title)
        return

    if args.query:
        res = send_client_request(args.socket, {"cmd": "query"})
        print(json.dumps(res))
        return

    if args.action:
        payload = json.loads(args.payload)
        res = send_client_request(args.socket, {"cmd": "action", "payload": payload})
        print(json.dumps(res))
        return

    print(json.dumps({"ok": False, "error": "Specify --serve, --query, or --action"}))
    sys.exit(1)


if __name__ == "__main__":
    main()

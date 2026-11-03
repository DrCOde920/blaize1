#!/usr/bin/env python3
"""
Blaize Controlled macOS Accessibility (AX) Test Application & IPC Bridge
(`scripts/macos-test-app.py`)

Runs as a real OS process and exposes an AXUIElement-structured window and accessibility
hierarchy (including Retina 2.0x DPI scaling, foreground/focus state, a standard-user
application window, a protected SecurityAgent authentication window, and AX actions:
AXPress, AXSetValue, AXSelect, AXShowMenu/AXExpand, AXScrollToVisible) over a local
IPC domain socket (`ax-<pid>.sock`).

Modes:
1. Daemon mode:
   python3 scripts/macos-test-app.py --serve --socket <path> [--audit-log <path>] [--title <str>]
2. Query mode (reads live windows + AX element tree from running daemon):
   python3 scripts/macos-test-app.py --query --socket <path>
3. Action mode (dispatches AX action or shortcut to running daemon):
   python3 scripts/macos-test-app.py --action --socket <path> --payload '<json>'
"""

import argparse
import json
import os
import signal
import socket
import sys
import time
from typing import Any, Dict, List


class ControlledMacOSAxTestApp:
    def __init__(self, socket_path: str, audit_log_path: str, window_title: str) -> None:
        self.socket_path = socket_path
        self.audit_log_path = audit_log_path
        self.pid = os.getpid()
        self.security_agent_pid = self.pid + 8000
        self.window_id = "win-macos-test-app"
        self.app_id = "app-macos-test-harness"
        self.app_name = "Blaize Controlled macOS AX Test App"
        self.bundle_id = "com.blaize.axtestharness"
        self.window_title = window_title
        self.is_focused = True
        self.is_minimized = False
        self.dpi_scale = 2.0
        self.monitor_id = "display-mac-retina"
        self.bounds = {"x": 140, "y": 80, "width": 860, "height": 560}

        # Live AX widget state (only mutated by real action handlers)
        self.note_value = "macos-initial-draft"
        self.apply_click_count = 0
        self.menu_expanded = False
        self.selected_view_mode = "GridView"
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

    def get_ax_snapshot(self) -> Dict[str, Any]:
        menu_states: List[str] = ["enabled", "selected"]
        menu_states.append("expanded" if self.menu_expanded else "collapsed")

        elements: List[Dict[str, Any]] = [
            {
                "id": "el_mac_ax_note_field",
                "windowId": self.window_id,
                "role": "textfield",
                "name": "Note Document Content Field",
                "value": self.note_value,
                "bounds": {
                    "x": 170,
                    "y": 140,
                    "width": 460,
                    "height": 34,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled", "focused"],
                "supportedActions": ["set_value", "invoke"],
                "shortcutHint": "Cmd+L",
            },
            {
                "id": "el_mac_ax_export_btn",
                "windowId": self.window_id,
                "role": "button",
                "name": "Export Verified Archive Button",
                "value": f"clicked:{self.apply_click_count}",
                "bounds": {
                    "x": 650,
                    "y": 140,
                    "width": 150,
                    "height": 34,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled"],
                "supportedActions": ["invoke"],
                "shortcutHint": "Cmd+E",
            },
            {
                "id": "el_mac_ax_view_menu",
                "windowId": self.window_id,
                "role": "menuitem",
                "name": "Workspace View Mode PopUpButton",
                "value": self.selected_view_mode,
                "bounds": {
                    "x": 170,
                    "y": 200,
                    "width": 260,
                    "height": 32,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": menu_states,
                "supportedActions": ["expand", "select", "invoke"],
            },
            {
                "id": "el_mac_ax_log_scroll",
                "windowId": self.window_id,
                "role": "listitem",
                "name": "Activity History Table View",
                "value": f"scroll:{self.scroll_percent}%",
                "bounds": {
                    "x": 170,
                    "y": 260,
                    "width": 630,
                    "height": 210,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled"],
                "supportedActions": ["scroll", "scroll_into_view", "select"],
            },
            {
                "id": "el_mac_ax_status_bar",
                "windowId": self.window_id,
                "role": "statusbar",
                "name": "macOS Window Status Indicator",
                "value": self.status_text,
                "bounds": {
                    "x": 140,
                    "y": 605,
                    "width": 860,
                    "height": 35,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled"],
                "supportedActions": ["invoke"],
            },
            # Requirement 4: Secure input field (AXSecureTextField)
            {
                "id": "el_mac_secure_pin_field",
                "windowId": self.window_id,
                "role": "textfield",
                "name": "User Master PIN Input",
                # Passwords/PINs/secrets are NEVER exposed in plain text in perception tree
                "value": "[PROTECTED_SECURE_INPUT]",
                "bounds": {
                    "x": 170,
                    "y": 485,
                    "width": 240,
                    "height": 32,
                    "dpiScale": self.dpi_scale,
                    "monitorId": self.monitor_id,
                },
                "states": ["enabled"],
                "supportedActions": ["invoke"],
                "shortcutHint": "",
            },
            # Protected SecurityAgent window control (Touch ID / Admin password prompt)
            {
                "id": "el_mac_security_agent_confirm_btn",
                "windowId": "win-macos-security-agent",
                "role": "button",
                "name": "SecurityAgent Unlock System Keychain",
                "value": "system_protected",
                "bounds": {
                    "x": 310,
                    "y": 250,
                    "width": 240,
                    "height": 34,
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
            "processName": "AXTestHarness",
            "virtualDesktopId": "space-mac-1",
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

        # Protected macOS SecurityAgent window
        security_agent_window = {
            "id": "win-macos-security-agent",
            "appId": "com.apple.SecurityAgent",
            "appName": "SecurityAgent",
            "title": "SecurityAgent — Authentication Required",
            "processId": self.security_agent_pid,
            "processName": "SecurityAgent",
            "virtualDesktopId": "space-mac-1",
            "monitorId": self.monitor_id,
            "dpiScale": self.dpi_scale,
            "bounds": {"x": 280, "y": 180, "width": 580, "height": 340},
            "isFocused": False,
            "isMinimized": False,
            "isOccluded": True,
            "isElevatedAdmin": True,
            "isSlowOrNotResponding": False,
            "hasActiveModalDialog": True,
        }

        monitors = [
            {
                "id": self.monitor_id,
                "name": "Built-in Liquid Retina XDR Display (2.0x)",
                "bounds": {"x": 0, "y": 0, "width": 1728, "height": 1117},
                "workArea": {"x": 0, "y": 25, "width": 1728, "height": 1092},
                "dpiScale": self.dpi_scale,
                "isPrimary": True,
            },
            {
                "id": "display-mac-secondary",
                "name": "Studio Display 5K External Display (2.0x)",
                "bounds": {"x": 1728, "y": 0, "width": 2560, "height": 1440},
                "workArea": {"x": 1728, "y": 0, "width": 2560, "height": 1440},
                "dpiScale": 2.0,
                "isPrimary": False,
            },
        ]

        return {
            "ok": True,
            "pid": self.pid,
            "socketPath": self.socket_path,
            "monitors": monitors,
            "windows": [standard_window, security_agent_window],
            "elements": elements,
        }

    def execute_action(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        action_type = payload.get("actionType", "invoke")
        target_id = payload.get("targetElementId", "")
        value = payload.get("valueToSet")
        shortcut = payload.get("shortcutKeys")

        # Requirement 4: Reject any interaction targeting SecurityAgent or secure input fields
        if target_id == "el_mac_security_agent_confirm_btn":
            self.append_audit(
                {
                    "action": "blocked_security_agent_violation",
                    "targetElementId": target_id,
                }
            )
            return {
                "ok": False,
                "error": "SECURITY_AGENT_ACCESS_DENIED: Direct input injection into macOS SecurityAgent authentication prompts is strictly forbidden.",
            }

        if target_id == "el_mac_secure_pin_field" and action_type in ("set_value", "read"):
            self.append_audit(
                {
                    "action": "blocked_secure_field_access",
                    "targetElementId": target_id,
                }
            )
            return {
                "ok": False,
                "error": "SECURE_INPUT_FIELD_RESTRICTION: Accessibility APIs cannot scrape passwords or PINs from AXSecureTextField.",
            }

        if action_type == "set_value" and target_id == "el_mac_ax_note_field":
            self.note_value = str(value if value is not None else "")
            self.status_text = f"AXSetValue:{self.note_value}"
            self.append_audit(
                {
                    "action": "set_value",
                    "axAction": "AXSetValue",
                    "targetElementId": target_id,
                    "newValue": self.note_value,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"AXSetValue on {target_id} -> '{self.note_value}'",
            }

        if action_type in ("invoke", "click") and target_id == "el_mac_ax_export_btn":
            self.apply_click_count += 1
            self.status_text = f"AXPress:{self.note_value} (#{self.apply_click_count})"
            self.append_audit(
                {
                    "action": "invoke",
                    "axAction": "AXPress",
                    "targetElementId": target_id,
                    "applyClickCount": self.apply_click_count,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"AXPress on {target_id} (count={self.apply_click_count})",
            }

        if action_type == "expand" and target_id == "el_mac_ax_view_menu":
            self.menu_expanded = not self.menu_expanded
            state_label = "Expanded" if self.menu_expanded else "Collapsed"
            self.status_text = f"AXShowMenu:{state_label}"
            self.append_audit(
                {
                    "action": "expand",
                    "axAction": "AXShowMenu",
                    "targetElementId": target_id,
                    "expanded": self.menu_expanded,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"AXShowMenu on {target_id} -> {state_label}",
            }

        if action_type == "select" and target_id == "el_mac_ax_view_menu":
            self.selected_view_mode = str(value if value is not None else "CompactList")
            self.menu_expanded = False
            self.status_text = f"AXSelect:{self.selected_view_mode}"
            self.append_audit(
                {
                    "action": "select",
                    "axAction": "AXSelect",
                    "targetElementId": target_id,
                    "selectedMode": self.selected_view_mode,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"AXSelect on {target_id} -> '{self.selected_view_mode}'",
            }

        if action_type in ("scroll", "scroll_into_view") and target_id == "el_mac_ax_log_scroll":
            try:
                requested_pct = int(str(value)) if value is not None else 65
            except ValueError:
                requested_pct = 65
            self.scroll_percent = max(0, min(100, requested_pct))
            self.status_text = f"AXScrollToVisible:{self.scroll_percent}%"
            self.append_audit(
                {
                    "action": "scroll",
                    "axAction": "AXScrollToVisible",
                    "targetElementId": target_id,
                    "scrollPercent": self.scroll_percent,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"AXScroll on {target_id} -> {self.scroll_percent}%",
            }

        if action_type == "shortcut" and shortcut:
            self.last_shortcut = str(shortcut)
            if shortcut in ("Cmd+E", "Cmd+S"):
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
            return {"ok": True, "detail": f"Dispatched macOS shortcut {shortcut}"}

        return {
            "ok": False,
            "error": f"Unsupported AX action '{action_type}' on target '{target_id}'",
        }


def run_server(socket_path: str, audit_log_path: str, title: str) -> None:
    if os.path.exists(socket_path):
        os.unlink(socket_path)

    app = ControlledMacOSAxTestApp(socket_path, audit_log_path, title)
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
                    resp = app.get_ax_snapshot()
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
    parser = argparse.ArgumentParser(description="Controlled macOS AX Test Application")
    parser.add_argument("--serve", action="store_true", help="Run as AX socket server")
    parser.add_argument("--query", action="store_true", help="Query AX tree from socket")
    parser.add_argument("--action", action="store_true", help="Dispatch AX action to socket")
    parser.add_argument("--socket", required=True, help="Socket path")
    parser.add_argument("--audit-log", default="", help="Path to JSONL audit log")
    parser.add_argument(
        "--title",
        default="Blaize Controlled macOS AX Test App",
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

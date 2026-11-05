#!/usr/bin/env python3
"""
Blaize Controlled Linux Desktop Test Application & AT-SPI2 Unix Socket Bridge
(`scripts/linux-test-app.py`)

Runs as a real Linux process (with a verifiable /proc/<pid> entry) and exposes an
AT-SPI2-structured window and accessibility widget tree over a real AF_UNIX domain
socket (`atspi-<pid>.sock`).

Modes:
1. Daemon mode:
   python3 scripts/linux-test-app.py --serve --socket <path> [--audit-log <path>] [--title <str>]
2. Query mode (reads live window + accessibility tree from running daemon over AF_UNIX):
   python3 scripts/linux-test-app.py --query --socket <path>
3. Action mode (dispatches AT-SPI2 action to running daemon over AF_UNIX):
   python3 scripts/linux-test-app.py --action --socket <path> --payload '<json>'
"""

import argparse
import json
import os
import signal
import socket
import sys
import time
from typing import Any, Dict, List


class ControlledLinuxTestApp:
    def __init__(self, socket_path: str, audit_log_path: str, window_title: str) -> None:
        self.socket_path = socket_path
        self.audit_log_path = audit_log_path
        self.pid = os.getpid()
        self.window_id = "win-linux-test-app"
        self.app_id = "app-linux-test-harness"
        self.app_name = "Blaize Controlled Linux Test App"
        self.window_title = window_title
        self.is_focused = True
        self.is_minimized = False
        self.bounds = {"x": 120, "y": 90, "width": 760, "height": 520}

        # Live widget state (never mutated by caller; only mutated by real action handlers)
        self.note_value = "initial-draft"
        self.checkbox_checked = False
        self.apply_click_count = 0
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

    def get_accessibility_snapshot(self) -> Dict[str, Any]:
        elements: List[Dict[str, Any]] = [
            {
                "id": "el_linux_test_note_input",
                "windowId": self.window_id,
                "role": "textfield",
                "name": "Note Input Field",
                "value": self.note_value,
                "bounds": {
                    "x": 150,
                    "y": 150,
                    "width": 420,
                    "height": 34,
                    "dpiScale": 1.0,
                    "monitorId": "display-linux-0",
                },
                "states": ["enabled", "focused"],
                "supportedActions": ["set_value", "invoke", "select"],
                "shortcutHint": "Ctrl+L",
            },
            {
                "id": "el_linux_test_apply_btn",
                "windowId": self.window_id,
                "role": "button",
                "name": "Apply Note Button",
                "value": f"clicked:{self.apply_click_count}",
                "bounds": {
                    "x": 590,
                    "y": 150,
                    "width": 140,
                    "height": 34,
                    "dpiScale": 1.0,
                    "monitorId": "display-linux-0",
                },
                "states": ["enabled"],
                "supportedActions": ["invoke"],
                "shortcutHint": "Ctrl+Return",
            },
            {
                "id": "el_linux_test_confirm_checkbox",
                "windowId": self.window_id,
                "role": "checkbox",
                "name": "Confirm Verification Flag",
                "value": "true" if self.checkbox_checked else "false",
                "bounds": {
                    "x": 150,
                    "y": 210,
                    "width": 220,
                    "height": 28,
                    "dpiScale": 1.0,
                    "monitorId": "display-linux-0",
                },
                "states": ["enabled", "checked"] if self.checkbox_checked else ["enabled"],
                "supportedActions": ["invoke", "select"],
            },
            {
                "id": "el_linux_test_status_bar",
                "windowId": self.window_id,
                "role": "statusbar",
                "name": "Application Status Bar",
                "value": self.status_text,
                "bounds": {
                    "x": 120,
                    "y": 575,
                    "width": 760,
                    "height": 35,
                    "dpiScale": 1.0,
                    "monitorId": "display-linux-0",
                },
                "states": ["enabled"],
                "supportedActions": ["invoke"],
            },
        ]

        window = {
            "id": self.window_id,
            "appId": self.app_id,
            "appName": self.app_name,
            "title": self.window_title,
            "processId": self.pid,
            "processName": "python3",
            "virtualDesktopId": "vdesk-linux-0",
            "monitorId": "display-linux-0",
            "dpiScale": 1.0,
            "bounds": self.bounds,
            "isFocused": self.is_focused,
            "isMinimized": self.is_minimized,
            "isOccluded": False,
            "isElevatedAdmin": False,
            "isSlowOrNotResponding": False,
            "hasActiveModalDialog": False,
        }

        return {
            "ok": True,
            "pid": self.pid,
            "socketPath": self.socket_path,
            "windows": [window],
            "elements": elements,
        }

    def execute_action(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        action_type = payload.get("actionType", "invoke")
        target_id = payload.get("targetElementId", "")
        value = payload.get("valueToSet")
        shortcut = payload.get("shortcutKeys")

        if action_type == "set_value" and target_id == "el_linux_test_note_input":
            self.note_value = str(value if value is not None else "")
            self.status_text = f"Edited:{self.note_value}"
            self.append_audit(
                {
                    "action": "set_value",
                    "targetElementId": target_id,
                    "newValue": self.note_value,
                    "statusText": self.status_text,
                }
            )
            return {"ok": True, "detail": f"Set value on {target_id} to '{self.note_value}'"}

        if action_type in ("invoke", "click") and target_id == "el_linux_test_apply_btn":
            self.apply_click_count += 1
            self.status_text = f"Applied:{self.note_value} (#{self.apply_click_count})"
            self.append_audit(
                {
                    "action": "invoke",
                    "targetElementId": target_id,
                    "applyClickCount": self.apply_click_count,
                    "statusText": self.status_text,
                }
            )
            return {
                "ok": True,
                "detail": f"Invoked {target_id} (count={self.apply_click_count})",
            }

        if action_type in ("invoke", "select") and target_id == "el_linux_test_confirm_checkbox":
            self.checkbox_checked = not self.checkbox_checked
            self.status_text = f"Checkbox:{'checked' if self.checkbox_checked else 'unchecked'}"
            self.append_audit(
                {
                    "action": action_type,
                    "targetElementId": target_id,
                    "checked": self.checkbox_checked,
                }
            )
            return {"ok": True, "detail": f"Toggled {target_id} -> {self.checkbox_checked}"}

        if action_type == "shortcut" and shortcut:
            self.last_shortcut = str(shortcut)
            if shortcut in ("Ctrl+Return", "Ctrl+S"):
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
            return {"ok": True, "detail": f"Dispatched shortcut {shortcut}"}

        return {
            "ok": False,
            "error": f"Unsupported action '{action_type}' on target '{target_id}'",
        }


def run_server(socket_path: str, audit_log_path: str, title: str) -> None:
    if os.path.exists(socket_path):
        os.unlink(socket_path)

    app = ControlledLinuxTestApp(socket_path, audit_log_path, title)
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(socket_path)
    os.chmod(socket_path, 0o600)
    srv.listen(16)

    running = True

    def handle_sig(_signum: int, _frame: Any) -> None:
        nonlocal running
        running = False
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

    while running:
        try:
            conn, _ = srv.accept()
        except Exception:
            break
        with conn:
            raw = b""
            while True:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                raw += chunk
                if b"\n" in raw:
                    break
            try:
                req = json.loads(raw.decode("utf-8").strip())
                cmd = req.get("cmd", "query")
                if cmd == "query":
                    res = app.get_accessibility_snapshot()
                elif cmd == "action":
                    res = app.execute_action(req.get("payload", {}))
                elif cmd == "shutdown":
                    res = {"ok": True, "shuttingDown": True}
                    conn.sendall((json.dumps(res) + "\n").encode("utf-8"))
                    handle_sig(signal.SIGTERM, None)
                    return
                else:
                    res = {"ok": False, "error": f"Unknown cmd '{cmd}'"}
            except Exception as exc:
                res = {"ok": False, "error": str(exc)}
            conn.sendall((json.dumps(res) + "\n").encode("utf-8"))


def send_unix_request(socket_path: str, message: Dict[str, Any]) -> Dict[str, Any]:
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(3.0)
    client.connect(socket_path)
    with client:
        client.sendall((json.dumps(message) + "\n").encode("utf-8"))
        data = b""
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            data += chunk
            if b"\n" in data:
                break
        return json.loads(data.decode("utf-8").strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Blaize Controlled Linux Test Application")
    parser.add_argument("--serve", action="store_true", help="Run as AF_UNIX accessibility daemon")
    parser.add_argument("--query", action="store_true", help="Query live accessibility tree")
    parser.add_argument("--action", action="store_true", help="Dispatch accessibility action")
    parser.add_argument("--shutdown", action="store_true", help="Shut down running daemon")
    parser.add_argument("--socket", required=True, help="AF_UNIX socket path")
    parser.add_argument("--audit-log", default="", help="Path to write independent audit JSONL")
    parser.add_argument("--title", default="Blaize Controlled Linux Test App", help="Window title")
    parser.add_argument("--payload", default="{}", help="JSON payload for --action")
    args = parser.parse_args()

    if args.serve:
        run_server(args.socket, args.audit_log, args.title)
    elif args.query:
        res = send_unix_request(args.socket, {"cmd": "query"})
        print(json.dumps(res))
    elif args.action:
        payload = json.loads(args.payload)
        res = send_unix_request(args.socket, {"cmd": "action", "payload": payload})
        print(json.dumps(res))
        if not res.get("ok"):
            sys.exit(1)
    elif args.shutdown:
        res = send_unix_request(args.socket, {"cmd": "shutdown"})
        print(json.dumps(res))
    else:
        parser.error("Specify one of --serve, --query, --action, or --shutdown")


if __name__ == "__main__":
    main()

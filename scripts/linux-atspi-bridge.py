#!/usr/bin/env python3
"""Live Linux desktop accessibility adapter for Blaize.

Requires the system Python AT-SPI bindings (pyatspi) and an active user D-Bus
session. It deliberately supports only semantic accessibility actions; it does
not inject arbitrary shell commands or infer pixel coordinates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from typing import Any

SECRET_LABEL = re.compile(r"password|passcode|one.?time.?code|\botp\b|\bpin\b|secret|api.?key|token", re.I)
MAX_DEPTH = 10
MAX_ELEMENTS_PER_WINDOW = 220


def safe_text(value: Any, limit: int = 180) -> str:
    text = str(value or "").replace("\x00", " ").strip()
    text = re.sub(r"[\r\n\t]+", " ", text)
    return text[:limit]


def import_atspi():
    try:
        import pyatspi  # type: ignore
        return pyatspi
    except Exception as exc:
        raise RuntimeError(
            "AT-SPI2 Python bindings are unavailable. Install the system package "
            "python3-pyatspi (and at-spi2-core), then restart Blaize."
        ) from exc


def get_pid(accessible: Any, fallback: int = 0) -> int:
    try:
        value = accessible.get_process_id()
        return int(value) if value else fallback
    except Exception:
        return fallback


def get_bounds(accessible: Any, pyatspi: Any) -> dict[str, int]:
    try:
        extents = accessible.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
        return {
            "x": int(extents.x), "y": int(extents.y),
            "width": max(0, int(extents.width)), "height": max(0, int(extents.height)),
        }
    except Exception:
        return {"x": 0, "y": 0, "width": 0, "height": 0}


def state_names(accessible: Any, pyatspi: Any) -> list[str]:
    names: list[str] = []
    try:
        state = accessible.getState()
        for label, constant in (
            ("enabled", "STATE_ENABLED"), ("focused", "STATE_FOCUSED"),
            ("checked", "STATE_CHECKED"), ("selected", "STATE_SELECTED"),
            ("sensitive", "STATE_SENSITIVE"), ("showing", "STATE_SHOWING"),
        ):
            flag = getattr(pyatspi, constant, None)
            if flag is not None and state.contains(flag):
                names.append(label)
    except Exception:
        pass
    return names


def role_name(accessible: Any) -> str:
    try:
        return safe_text(accessible.getRoleName(), 48).lower() or "unknown"
    except Exception:
        return "unknown"


def accessible_name(accessible: Any) -> str:
    try:
        return safe_text(accessible.name, 180)
    except Exception:
        return ""


def accessible_value(accessible: Any, pyatspi: Any, secret: bool) -> str:
    if secret:
        return "[PROTECTED]"
    try:
        value = accessible.queryValue().currentValue
        if value not in (None, ""):
            return safe_text(value, 200)
    except Exception:
        pass
    try:
        text_iface = accessible.queryText()
        count = int(text_iface.characterCount)
        if count > 0:
            return safe_text(text_iface.getText(0, min(count, 200)), 200)
    except Exception:
        pass
    return ""


def action_names(accessible: Any) -> list[str]:
    result: list[str] = []
    try:
        actions = accessible.queryAction()
        for idx in range(int(actions.nActions)):
            result.append(safe_text(actions.getName(idx), 48).lower())
    except Exception:
        pass
    return result


def can_edit(accessible: Any) -> bool:
    try:
        accessible.queryEditableText()
        return True
    except Exception:
        try:
            accessible.queryValue()
            return True
        except Exception:
            return False


def collect_snapshot(pyatspi: Any) -> dict[str, Any]:
    desktop = pyatspi.Registry.getDesktop(0)
    windows: list[dict[str, Any]] = []
    elements: list[dict[str, Any]] = []
    max_top = min(int(desktop.childCount), 80)

    def children_of(node: Any):
        count = min(int(getattr(node, "childCount", 0)), 500)
        for idx in range(count):
            try:
                child = node.getChildAtIndex(idx)
                if child is not None:
                    yield idx, child
            except Exception:
                continue

    for app_index, app in children_of(desktop):
        app_pid = get_pid(app)
        app_name = accessible_name(app) or "Linux application"
        for win_index, window in children_of(app):
            role = role_name(window)
            if role not in ("frame", "window", "dialog", "alert"):
                continue
            pid = get_pid(window, app_pid)
            title = accessible_name(window) or app_name
            window_id = f"win-atspi-{pid or app_index}-{win_index}-{hashlib.sha1((app_name + title).encode()).hexdigest()[:8]}"
            bounds = get_bounds(window, pyatspi)
            try:
                states = state_names(window, pyatspi)
            except Exception:
                states = []
            windows.append({
                "id": window_id,
                "appId": f"app-atspi-{pid or app_index}",
                "appName": app_name,
                "title": title,
                "processId": pid,
                "processName": app_name.lower().replace(" ", "-")[:64],
                "virtualDesktopId": "vdesk-linux-atspi",
                "monitorId": "display-linux-atspi",
                "dpiScale": 1.0,
                "bounds": bounds,
                "isFocused": "focused" in states,
                "isMinimized": "showing" not in states,
                "isOccluded": False,
                "isElevatedAdmin": False,
                "isSlowOrNotResponding": False,
                "hasActiveModalDialog": role in ("dialog", "alert"),
            })

            emitted = 0

            def visit(node: Any, path: tuple[int, ...], depth: int) -> None:
                nonlocal emitted
                if depth > MAX_DEPTH or emitted >= MAX_ELEMENTS_PER_WINDOW:
                    return
                name = accessible_name(node)
                role_name_value = role_name(node)
                secret = bool(SECRET_LABEL.search(name) or role_name_value in ("password text", "password field", "secure text field"))
                states_value = state_names(node, pyatspi)
                actions = action_names(node)
                supported: list[str] = []
                if actions:
                    supported.append("invoke")
                if not secret and can_edit(node):
                    supported.append("set_value")
                if role_name_value in ("scroll pane", "list", "table", "tree", "document frame"):
                    try:
                        node.queryComponent()
                        supported.append("scroll")
                    except Exception:
                        pass
                if name or role_name_value not in ("unknown", "container", "filler"):
                    suffix = "_".join(str(x) for x in path)
                    stable = hashlib.sha1(f"{window_id}:{suffix}:{role_name_value}:{name}".encode()).hexdigest()[:10]
                    element_id = f"el-atspi-{pid or app_index}-{win_index}-{suffix}-{stable}"[:240]
                    rect = get_bounds(node, pyatspi)
                    elements.append({
                        "id": element_id,
                        "markNumber": len(elements) + 1,
                        "windowId": window_id,
                        "role": role_name_value,
                        "name": "[PROTECTED INPUT]" if secret else name,
                        "value": accessible_value(node, pyatspi, secret),
                        "bounds": {**rect, "dpiScale": 1.0, "monitorId": "display-linux-atspi"},
                        "states": states_value,
                        "supportedActions": supported,
                    })
                    emitted += 1
                for child_index, child in children_of(node):
                    visit(child, path + (child_index,), depth + 1)

            for child_index, child in children_of(window):
                visit(child, (child_index,), 1)

            if len(windows) >= max_top:
                break

    return {"ok": True, "windows": windows, "elements": elements}


def do_action(pyatspi: Any, args: dict[str, Any]) -> dict[str, Any]:
    target_window_id = str(args.get("targetWindowId") or "")
    target_element_id = str(args.get("targetElementId") or "")
    action_type = str(args.get("actionType") or "")
    snapshot = collect_snapshot(pyatspi)
    window = next((w for w in snapshot["windows"] if w["id"] == target_window_id), None)
    if window is None:
        raise RuntimeError("TARGET_WINDOW_NOT_FOUND: the requested application window is no longer present")

    if action_type == "shortcut":
        shortcut = str(args.get("shortcutKeys") or "")
        safe_shortcuts = {
            "escape", "tab", "shift+tab", "arrowup", "arrowdown", "arrowleft", "arrowright",
            "home", "end", "pageup", "pagedown", "ctrl+f", "ctrl+s", "ctrl+a", "ctrl+c",
            "ctrl+z", "ctrl+y", "ctrl+tab", "ctrl+shift+tab", "ctrl+shift+s", "alt+tab",
            "cmd+f", "cmd+s", "cmd+a", "cmd+c", "cmd+z", "cmd+shift+z", "cmd+tab",
        }
        normalized_shortcut = re.sub(r"\s+", "", shortcut).lower()
        if normalized_shortcut not in safe_shortcuts:
            raise RuntimeError("KEY_SHORTCUT_BLOCKED: shortcut is outside the Blaize allowlist")
        if not window.get("isFocused"):
            raise RuntimeError("WINDOW_NOT_FOCUSED: focus the target window before sending a shortcut")
        key = shortcut.lower().replace("cmd", "super").replace("meta", "super")
        try:
            subprocess.run(["xdotool", "key", "--clearmodifiers", key], check=True, timeout=2, capture_output=True, text=True)
        except Exception as exc:
            raise RuntimeError("KEY_DISPATCH_UNAVAILABLE: install xdotool and use an X11 session for keyboard shortcuts") from exc
        return {"ok": True, "detail": f"Sent approved shortcut to focused window {window['title']}"}

    target = next((e for e in snapshot["elements"] if e["id"] == target_element_id and e["windowId"] == target_window_id), None)
    if target is None:
        raise RuntimeError("TARGET_ELEMENT_NOT_FOUND: refresh the accessibility snapshot and retry")
    if action_type == "set_value" and "set_value" not in target["supportedActions"]:
        raise RuntimeError("ACTION_UNSUPPORTED: target is not an editable, non-sensitive field")
    if action_type in ("invoke", "scroll") and action_type not in target["supportedActions"]:
        raise RuntimeError("ACTION_UNSUPPORTED: target does not expose the requested accessibility action")

    # Resolve the accessible object by the exact deterministic id in the fresh tree.
    desktop = pyatspi.Registry.getDesktop(0)
    located = None

    def scan(node: Any, app_index: int, app: Any, win_index: int, window_obj: Any, path: tuple[int, ...], depth: int) -> None:
        nonlocal located
        if located is not None or depth > MAX_DEPTH:
            return
        name = accessible_name(node)
        role = role_name(node)
        pid = get_pid(window_obj, get_pid(app))
        app_name = accessible_name(app) or "Linux application"
        title = accessible_name(window_obj) or app_name
        window_id = f"win-atspi-{pid or app_index}-{win_index}-{hashlib.sha1((app_name + title).encode()).hexdigest()[:8]}"
        suffix = "_".join(str(x) for x in path)
        stable = hashlib.sha1(f"{window_id}:{suffix}:{role}:{name}".encode()).hexdigest()[:10]
        element_id = f"el-atspi-{pid or app_index}-{win_index}-{suffix}-{stable}"[:240]
        if element_id == target_element_id and window_id == target_window_id:
            located = node
            return
        for child_index, child in children_of(node):
            scan(child, app_index, app, win_index, window_obj, path + (child_index,), depth + 1)

    def children_of(node: Any):
        for idx in range(min(int(getattr(node, "childCount", 0)), 500)):
            try:
                child = node.getChildAtIndex(idx)
                if child is not None:
                    yield idx, child
            except Exception:
                continue

    for app_index, app in children_of(desktop):
        for win_index, window_obj in children_of(app):
            if role_name(window_obj) not in ("frame", "window", "dialog", "alert"):
                continue
            for child_index, child in children_of(window_obj):
                scan(child, app_index, app, win_index, window_obj, (child_index,), 1)
                if located is not None:
                    break
            if located is not None:
                break
        if located is not None:
            break
    if located is None:
        raise RuntimeError("TARGET_ELEMENT_NOT_FOUND: element moved while the action was being prepared")

    if action_type == "invoke":
        iface = located.queryAction()
        count = int(iface.nActions)
        if count < 1:
            raise RuntimeError("ACTION_UNSUPPORTED: the element exposes no AT-SPI action")
        preferred = ("click", "press", "activate", "toggle", "open", "select")
        names = [safe_text(iface.getName(i), 48).lower() for i in range(count)]
        index = next((names.index(wanted) for wanted in preferred if wanted in names), 0)
        if not iface.doAction(index):
            raise RuntimeError("ACTION_FAILED: AT-SPI did not accept the action")
        return {"ok": True, "detail": f"Invoked accessible control ({names[index] or 'action'})"}

    if action_type == "set_value":
        if SECRET_LABEL.search(accessible_name(located)) or role_name(located) in ("password text", "password field", "secure text field"):
            raise RuntimeError("SENSITIVE_INPUT_BLOCKED: secret fields cannot be filled")
        value = str(args.get("valueToSet") or "")
        if len(value) > 4096:
            raise RuntimeError("TEXT_TOO_LONG: text input exceeds 4096 characters")
        try:
            located.queryEditableText().setTextContents(value)
        except Exception:
            value_iface = located.queryValue()
            value_iface.currentValue = float(value)
        return {"ok": True, "detail": "Set value on the approved accessible field"}

    if action_type == "scroll":
        component = located.queryComponent()
        component.scrollTo(pyatspi.SCROLL_ANYWHERE)
        return {"ok": True, "detail": "Scrolled the target element into view"}

    raise RuntimeError("ACTION_UNSUPPORTED: unsupported AT-SPI action type")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", action="store_true")
    parser.add_argument("--action", action="store_true")
    parser.add_argument("--payload", default="")
    ns = parser.parse_args()
    try:
        pyatspi = import_atspi()
        if ns.snapshot:
            print(json.dumps(collect_snapshot(pyatspi)))
            return 0
        if ns.action:
            payload = json.loads(ns.payload or "{}")
            print(json.dumps(do_action(pyatspi, payload)))
            return 0
        raise RuntimeError("choose --snapshot or --action")
    except Exception as exc:
        print(json.dumps({"ok": False, "error": safe_text(exc, 500)}))
        return 2


if __name__ == "__main__":
    sys.exit(main())

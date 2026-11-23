"""Read-only observer for a locally installed herdr agent runtime.

This module is deliberately NOT an execution engine.  Herdr runs coding agents
in terminals that outlive the client; it does not expose a model API, does not
write this workbench's task.json/result.json, and does not route through the
accounting relay.  Treating it as a model executor would break the
completed != accepted contract, so the only thing this module does is read the
public ``hc`` CLI status and present it as observation data.

Guarantees:
* Read-only: every command is a query (``server status`` / ``ls --json``).  No
  dispatch, no send, no state mutation, no model call, no credential access.
* Fail-closed: an unavailable / malformed / timed-out core reports ready=False
  with a message; it never fabricates terminals or statuses.
* Bounded: fixed timeout, fixed output cap, no shell, no argument injection.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
TIMEOUT_SECONDS = 5
OUTPUT_LIMIT = 256 * 1024
KNOWN_STATES = {'working', 'blocked', 'idle', 'done', 'live', 'finished'}


def _resolve_core():
    """Locate hc from an explicit env override, PATH, or the official install dir.

    No drive letter or author path is assumed: the LocalAppData location comes
    from the environment, and PATH is the documented install mechanism.
    """
    override = os.environ.get('MODEL_DESK_HERDR_CORE')
    candidates = []
    if override:
        candidates.append(Path(override))
    local = os.environ.get('LOCALAPPDATA')
    if local:
        candidates.append(Path(local) / 'Programs' / 'herdr-core' / 'herdr-core.exe')
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _run(args):
    """Run one read-only hc command and return (ok, parsed_or_error)."""
    core = _resolve_core()
    if core is None:
        return False, {'kind': 'not_installed',
                       'message': '未找到 herdr-core：请安装 Herdr，或用 MODEL_DESK_HERDR_CORE 指定 herdr-core.exe'}
    try:
        process = subprocess.run(
            [str(core), *args, '--json'],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            timeout=TIMEOUT_SECONDS,
            stdin=subprocess.DEVNULL,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if os.name == 'nt' else 0,
        )
    except subprocess.TimeoutExpired:
        return False, {'kind': 'timeout', 'message': 'herdr-core 查询超时；已跳过观测'}
    except OSError as exc:
        return False, {'kind': 'unavailable', 'message': f'herdr-core 不可执行：{type(exc).__name__}'}
    if process.returncode != 0:
        return False, {'kind': 'command_failed',
                       'message': 'herdr-core 查询失败；已跳过观测', 'exit_code': process.returncode}
    text = (process.stdout or '')[:OUTPUT_LIMIT].strip()
    if not text:
        return False, {'kind': 'empty', 'message': 'herdr-core 返回空结果；已跳过观测'}
    try:
        return True, json.loads(text)
    except (ValueError, TypeError):
        return False, {'kind': 'malformed', 'message': 'herdr-core 返回格式无法解析；已跳过观测'}


def _terminal_view(row):
    """Project one hc Terminal into a small, public, status-only view."""
    if not isinstance(row, dict):
        return None
    status = row.get('status')
    if not isinstance(status, dict):
        status = None
    reported = status.get('state') if status else None
    state = row.get('state')
    # hc 'state' is process liveness (live/finished); 'status.state' is the
    # agent's OSC 7501 word (working/blocked/idle).  Keep both, never merge:
    # a finished terminal must not be shown as a working agent.
    if state not in KNOWN_STATES:
        state = None
    if reported is not None and str(reported).lower() not in KNOWN_STATES:
        reported = None
    return {
        'address': str(row.get('address') or ''),
        'agent': str(row.get('agent') or ''),
        'title': str(row.get('title') or '')[:120],
        'cwd': str(row.get('cwd') or '')[:260],
        'live_state': state,
        'agent_state': str(reported).lower() if reported is not None else None,
        'turn': row.get('turn') if isinstance(row.get('turn'), int) and row.get('turn') >= 0 else 0,
        'needs_you': str(reported).lower() == 'blocked' if reported is not None else False,
    }


def snapshot():
    """Public read-only herdr status snapshot.

    Never raises for an unavailable core.  ``ready`` means the herdr-core
    server answered, not that any agent is doing useful work.  ``terminals``
    is empty when the server cannot be reached or the payload is malformed.
    """
    ok_server, server = _run(['server', 'status'])
    if not ok_server:
        return {'ready': False, 'reason': server.get('kind'), 'message': server.get('message'),
                'version': None, 'terminals': [], 'counts': {'total': 0, 'working': 0, 'blocked': 0, 'idle': 0, 'needs_you': 0}}
    ok_list, listing = _run(['ls'])
    if not ok_list:
        return {'ready': False, 'reason': listing.get('kind'), 'message': listing.get('message'),
                'version': server.get('version'), 'terminals': [],
                'counts': {'total': 0, 'working': 0, 'blocked': 0, 'idle': 0, 'needs_you': 0}}
    rows = listing.get('terminals') if isinstance(listing, dict) else None
    if not isinstance(rows, list):
        return {'ready': False, 'reason': 'malformed', 'message': 'herdr-core 终端列表格式无效',
                'version': server.get('version'), 'terminals': [],
                'counts': {'total': 0, 'working': 0, 'blocked': 0, 'idle': 0, 'needs_you': 0}}
    terminals = [view for view in (_terminal_view(row) for row in rows[:200]) if view]
    counts = {'total': len(terminals), 'working': 0, 'blocked': 0, 'idle': 0, 'needs_you': 0}
    for term in terminals:
        agent_state = term['agent_state']
        if agent_state in counts:
            counts[agent_state] += 1
        if term['needs_you']:
            counts['needs_you'] += 1
    return {'ready': True, 'reason': '', 'message': '', 'version': server.get('version'),
            'terminals': terminals, 'counts': counts}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(snapshot(), ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

"""Offline regression for the read-only herdr observer.

No real model calls, no terminal mutation.  hc output is stubbed so the tests
prove: fail-closed behaviour, exact status mapping, and that the observer never
issues a write command.
"""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import herdr_observer as observer


class ObserverTests(unittest.TestCase):
    def test_status_maps_working_blocked_idle_without_merging_liveness(self):
        row = {'address': 't7', 'agent': 'claude', 'title': 'review', 'cwd': 'C:/p',
               'state': 'live', 'status': {'state': 'blocked'}, 'turn': 3}
        view = observer._terminal_view(row)
        self.assertEqual(view['agent_state'], 'blocked')
        self.assertEqual(view['live_state'], 'live')
        self.assertTrue(view['needs_you'])
        self.assertEqual(view['turn'], 3)

    def test_finished_terminal_is_not_shown_as_working(self):
        row = {'address': 't1', 'state': 'finished', 'status': {'state': 'working'}, 'turn': 99}
        view = observer._terminal_view(row)
        self.assertEqual(view['live_state'], 'finished')
        # A stale OSC word on a finished terminal must still surface as finished
        # liveness; the UI keys off live_state first.  The observer keeps both.
        self.assertEqual(view['agent_state'], 'working')

    def test_unknown_status_is_dropped_not_guessed(self):
        view = observer._terminal_view({'address': 't2', 'state': 'live', 'status': {'state': 'banana'}})
        self.assertIsNone(view['agent_state'])
        self.assertFalse(view['needs_you'])

    def test_not_installed_is_fail_closed(self):
        with patch.object(observer, '_resolve_core', return_value=None):
            ok, result = observer._run(['ls'])
        self.assertFalse(ok)
        self.assertEqual(result['kind'], 'not_installed')
        self.assertIn('MODEL_DESK_HERDR_CORE', result['message'])

    def test_snapshot_without_core_never_fabricates_terminals(self):
        with patch.object(observer, '_run', return_value=(False, {'kind': 'not_installed', 'message': 'x'})):
            snap = observer.snapshot()
        self.assertFalse(snap['ready'])
        self.assertEqual(snap['terminals'], [])
        self.assertEqual(snap['counts']['total'], 0)

    def test_snapshot_reads_only_status_and_list(self):
        calls = []

        def fake_run(args):
            calls.append(args)
            if args[0] == 'server':
                return True, {'version': '0.1.22'}
            return True, {'terminals': [
                {'address': 't1', 'agent': 'powershell', 'state': 'live', 'status': None, 'turn': 0},
                {'address': 't2', 'agent': 'claude', 'state': 'live', 'status': {'state': 'working'}, 'turn': 2},
            ]}

        with patch.object(observer, '_run', side_effect=fake_run):
            snap = observer.snapshot()
        self.assertTrue(snap['ready'])
        self.assertEqual(snap['counts']['total'], 2)
        self.assertEqual(snap['counts']['working'], 1)
        self.assertEqual([c[0] for c in calls], ['server', 'ls'])
        self.assertTrue(all('--json' not in c for c in calls), 'observer must not add --json itself')

    def test_observer_has_no_write_commands(self):
        source = (Path(observer.__file__).resolve()).read_text(encoding='utf-8')
        for forbidden in ('terminal.run', 'terminal.send', 'hc send', 'hc run', "'send'", '"send"'):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main(verbosity=2)

"""A task resumes its main Codex session, never the internal approval reviewer."""
import home_guard  # noqa: F401
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/tasks/bin"))
from herdr_task import sessions


class CodexSessions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.logs = []
        self.files = []
        for obj, key, value in ((sessions, "HOME", str(self.root)), (sessions, "kids", lambda pid: []),
                                (sessions.shutil, "which", lambda name: "lsof"),
                                (sessions, "run", lambda args: SimpleNamespace(stdout="".join("n" + str(p) + "\n" for p in self.files)))):
            p = patch.object(obj, key, value); p.start(); self.addCleanup(p.stop)

    def log(self, source):
        sid = f"12345678-1234-1234-1234-{len(self.logs):012d}"
        path = self.root / f"rollout-2026-11-13T10-00-00-{sid}.jsonl"
        path.write_text(json.dumps({"type": "session_meta", "payload": {"source": source}}) + "\n")
        self.logs.append(path)
        return sid, path

    def test_resume_keeps_the_main_session_in_either_open_file_order(self):
        sid, main = self.log("cli")
        _, review = self.log({"subagent": {"other": "guardian"}})
        for paths in ([main, review], [review, main]):
            with self.subTest(paths=paths):
                self.files = paths
                self.assertEqual(sessions.session_of(99999999), (sid, str(main)))

    def test_helpers_and_partial_headers_do_not_replace_the_main_session(self):
        _, helper = self.log({"subagent": {"thread_spawn": {"parent_thread_id": "parent"}}})
        _, partial = self.log("cli"); partial.write_text('{"type":"session_meta"')
        sid, main = self.log("cli")
        self.files = [helper, partial, main]
        self.assertEqual(sessions.session_of(99999999), (sid, str(main)))

    def test_no_main_session_does_not_save_a_review_session_for_resume(self):
        _, review = self.log({"subagent": {"other": "guardian"}})
        self.files = [review]
        self.assertEqual(sessions.session_of(99999999), (None, None))

    def test_older_session_metadata_without_a_source_is_supported(self):
        sid, main = self.log(None)
        main.write_text('{"type":"session_meta","payload":{}}\n')
        self.files = [main]
        self.assertEqual(sessions.session_of(99999999), (sid, str(main)))

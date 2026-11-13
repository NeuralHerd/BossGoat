"""Task permissions follow the live Assistant, while explicit task choices and reviews stay intact."""
import home_guard  # noqa: F401
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/tasks/bin"))
from herdr_task import commands, launch, settings

AUTO = ["codex", "-s", "workspace-write", "-a", "on-request", "-c", 'approvals_reviewer="auto_review"']
ASK = ["codex", "-s", "workspace-write", "-a", "on-request", "-c", 'approvals_reviewer="user"']


class TaskPermissions(unittest.TestCase):
    def test_inherit_auto_review_keeps_model_effort_and_restrictions(self):
        argv = [*ASK, "-m", "worker-model", "-c", 'model_reasoning_effort="high"', "--no-daemon"]
        got = settings.inherit_permission(argv, AUTO)
        self.assertIn('approvals_reviewer="auto_review"', got)
        self.assertNotIn('approvals_reviewer="user"', got)
        self.assertIn("workspace-write", got)
        self.assertIn("on-request", got)
        self.assertIn("worker-model", got)
        self.assertIn('model_reasoning_effort="high"', got)
        self.assertIn("--no-daemon", got)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", got)
        self.assertIn('approvals_reviewer="user"', argv, "the configured worker default is not mutated")

    def test_automatic_review_maps_across_all_three_clis(self):
        for source in (AUTO, ["claude", "--permission-mode", "auto"], ["cursor-agent", "--auto-review"]):
            for worker, flags in ((["codex"], ['approvals_reviewer="auto_review"']),
                                  (["claude"], ["--permission-mode", "auto"]),
                                  (["cursor-agent"], ["--auto-review"])):
                with self.subTest(source=source, worker=worker):
                    got = settings.inherit_permission(worker, source)
                    for flag in flags:
                        self.assertIn(flag, got)
                    self.assertFalse(set(got) & {"--force", "--dangerously-skip-permissions", "--dangerously-bypass-approvals-and-sandbox"})

    def test_asking_mode_removes_a_more_permissive_worker_default(self):
        for argv in (["codex", "--yolo", "--sandbox=danger-full-access", "--config=approvals_reviewer=auto_review"],
                     ["claude", "--dangerously-skip-permissions"], ["cursor-agent", "--force", "--auto-review"]):
            got = settings.inherit_permission(argv, ASK)
            self.assertFalse(set(got) & {"--yolo", "--dangerously-skip-permissions", "--force", "--auto-review"})
            self.assertEqual(settings.permission_mode(got), "ask")

    def test_explicit_read_only_workers_are_never_broadened(self):
        for argv in (["codex", "-s", "read-only"], ["claude", "--permission-mode", "plan"], ["cursor-agent", "--mode", "ask"]):
            self.assertEqual(settings.inherit_permission(argv, ["codex", "--yolo"]), argv)

    def test_read_only_assistant_restricts_each_worker(self):
        for argv in (["codex", "--yolo"], ["claude", "--dangerously-skip-permissions"], ["cursor-agent", "--force"]):
            self.assertEqual(settings.permission_mode(settings.inherit_permission(argv, ["codex", "-s", "read-only"])), "read-only")

    def test_unknown_defaults_and_prompt_text_do_not_grant_permissions(self):
        for source in ([], ["codex"], ["sh", "-c", "codex --yolo"],
                       ["codex", 'explain approvals_reviewer="auto_review"'], ["codex", "--", "-c", 'approvals_reviewer="auto_review"']):
            self.assertEqual(settings.inherit_permission(ASK, source), ASK)
        self.assertEqual(settings.permission_mode([*AUTO, "--config=approvals_reviewer='user'"]), "ask")

    def test_only_the_live_coordinator_supplies_permissions(self):
        coordinator = {"state": "live", "labels": {"herdr.role": "coordinator"}, "argv": ["sh"], "foreground": {"argv": AUTO}}
        with patch.object(launch, "hc_json", return_value=coordinator):
            self.assertEqual(settings.permission_mode(launch.inherit_permissions(ASK, "t1")), "approve")
        for terminal in ({**coordinator, "state": "done"}, {**coordinator, "labels": {"herdr.role": "reviewer"}}, None):
            with patch.object(launch, "hc_json", return_value=terminal):
                self.assertEqual(launch.inherit_permissions(ASK, "t1"), ASK)

    def test_new_and_queued_tasks_inherit_but_explicit_task_argv_wins(self):
        s = SimpleNamespace(loc={"kind": "folder", "folder": "/project"})
        for custom, queued in ((False, False), (False, True), (True, False), (True, True)):
            with self.subTest(custom=custom, queued=queued):
                task = {"state": "queued" if queued else "todo", "mode": "here", "skill": "hc-build"}
                if queued:
                    task["queue"] = {"argv": ASK, "custom": custom}
                with patch.object(commands, "holycow_brief"), patch.object(commands, "folder_for"), \
                     patch.object(commands, "parent_for", return_value="t1"), \
                     patch.object(launch, "hc_json", return_value={"state": "live", "template": "assistant", "argv": AUTO}), \
                     patch.object(commands, "brief", return_value="brief") as brief, \
                     patch.object(commands, "launch", side_effect=lambda s, t, argv, *a, **kw: argv):
                    got = commands.begin(s, task, ASK, "sp1", custom=custom and not queued)
                    self.assertEqual(settings.permission_mode(got), "ask" if custom else "approve")
                    self.assertEqual(brief.call_args.args[-1], got, "the brief and launched worker must agree")

    def test_resume_preserves_the_manual_task_selection(self):
        s = SimpleNamespace()
        task = {"skill": "hc-build", "agents": [{"argv": ASK, "agent": "codex", "at": 1, "session": "session-1"}]}
        with patch.object(commands, "unarchive"), patch.object(commands, "parent_for", return_value="t1"), \
             patch.object(commands, "inherit_permissions") as inherit, \
             patch.object(commands, "launch", side_effect=lambda s, t, argv, *a, **kw: argv):
            got, resumed = commands.start_again(s, task, "sp1")
            self.assertTrue(resumed)
            self.assertEqual(got, ASK)
            inherit.assert_not_called()


if __name__ == "__main__":
    unittest.main()

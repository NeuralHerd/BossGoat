"""Preview the real launch choices without starting a worker or creating its worktree."""
import home_guard  # noqa: F401
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/tasks/bin"))
from herdr_task import commands, holycow, launch, settings


class TaskPreview(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cfg = self.root / "settings.json"
        self.cfg.write_text(json.dumps({"everywhere": {"tasks": {"review": False}, "holycow": {
            "hc-build": {"agent": "cursor", "model": "chosen-model", "perm": "ask"},
            "hc-review": {"agent": "codex", "model": "review-model", "perm": "full"}}}}))
        self.store = SimpleNamespace(loc={"folder": str(self.root), "kind": "repo"}, ref=lambda _: "TEST-1")
        self.task = {"state": "todo", "skill": "hc-build", "mode": "worktree", "title": "A task"}
        for obj, key, val in [(settings, "SETTINGS", str(self.cfg)), (holycow, "HOME", str(self.root)),
                              (launch, "default_space", lambda: "space-one"), (launch, "parent_for", lambda *a: "assistant"),
                              (launch, "hc_json", lambda *a: {"state": "live", "labels": {"herdr.role": "coordinator"},
                               "argv": settings.argv_for({"agent": "codex", "perm": "approve"})})]:
            p = patch.object(obj, key, val); p.start(); self.addCleanup(p.stop)

    def skill(self, name):
        path = self.root / ".agents/skills" / name / "SKILL.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("Fixture skill")

    def test_matches_effective_launch_including_assistant_permissions_without_mutation(self):
        self.skill("hc-build")
        before = copy.deepcopy(self.task)
        plan = launch.start_choices(self.store, self.task)
        argv, _ = launch.effective_launch(**plan)
        got = launch.launch_preview(self.store, self.task)
        rows = {r["label"]: r["text"] for r in got["rows"]}
        self.assertTrue(got["ready"])
        self.assertEqual(rows["Agent"], settings.agent_key(argv))
        self.assertEqual(rows["Model"], settings.argv_model(argv)[0])
        self.assertEqual(rows["Permissions"], "Approve for me")
        self.assertIn("Assistant", rows["Permission source"])
        self.assertEqual(self.task, before)
        self.assertNotIn("worktree", self.task)

    def test_missing_worker_and_reviewer_are_reported_before_start(self):
        self.task["set"] = {"review": "on"}
        got = launch.launch_preview(self.store, self.task)
        self.assertFalse(got["ready"])
        self.assertEqual(len(got["problems"]), 2)
        self.assertIn("hc-build is not installed", got["problems"][0])
        self.assertIn("hc-review is not installed", got["problems"][1])
        self.skill("hc-build"); self.skill("hc-review")
        self.assertTrue(launch.launch_preview(self.store, self.task)["ready"])

    def test_explicit_task_model_and_custom_queue_permissions_match_launch(self):
        self.skill("hc-build")
        self.task["model"] = "task-model"
        rows = {r["label"]: r["text"] for r in launch.launch_preview(self.store, self.task)["rows"]}
        self.assertEqual(rows["Model"], "task-model")
        self.task["queue"] = {"custom": True, "argv": ["cursor-agent", "--mode", "ask"], "space": "queued-space"}
        plan = launch.start_choices(self.store, self.task)
        self.assertEqual(plan["space"], "queued-space")
        rows = {r["label"]: r["text"] for r in launch.launch_preview(self.store, self.task)["rows"]}
        self.assertEqual(rows["Permissions"], "Read-only")
        self.assertEqual(rows["Model"], "CLI default")

    def test_review_skill_cannot_inherit_broader_assistant_access(self):
        self.skill("hc-review")
        self.task["skill"] = "hc-review"
        rows = {r["label"]: r["text"] for r in launch.launch_preview(self.store, self.task)["rows"]}
        self.assertEqual(rows["Permissions"], "Read-only")

    def test_unassigned_software_is_blocked_and_nonsoftware_is_explicit(self):
        del self.task["skill"]
        self.assertFalse(launch.launch_preview(self.store, self.task)["ready"])
        self.task["kind"] = "non-software"
        got = launch.launch_preview(self.store, self.task)
        self.assertTrue(got["ready"])
        self.assertIn("non-software", got["rows"][0]["text"])

    def test_preview_command_opens_store_read_only_and_never_launches(self):
        self.skill("hc-build")
        args = SimpleNamespace(id="TEST-1", space="space-one", agent=None, argv=None, parent=None)
        self.store.find = lambda _: self.task
        with patch.object(commands, "open_store") as store, patch.object(commands, "say") as say, patch.object(commands, "begin") as begin:
            store.return_value.__enter__.return_value = self.store
            commands.cmd_preview(args)
        store.assert_called_once_with(args, write=False)
        begin.assert_not_called()
        self.assertTrue(say.call_args.args[1]["ready"])

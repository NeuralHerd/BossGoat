"""Research survives agent loss without entering the coding/merge workflow."""
import home_guard  # noqa: F401
import contextlib
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/tasks/bin"))
from herdr_task import cli, commands, launch, settings, store, research, proof, output, news
from herdr_task.base import Fail


class Research(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.folder = self.root / "project"
        self.folder.mkdir()
        cfg = self.root / "settings.json"
        cfg.write_text(json.dumps({"everywhere": {"tasks": {"review_rounds": 3, "proof": True, "merge": "auto"},
                                                   "worker": {"agent": "codex", "perm": "full"}}}))
        self.loc = {"folder": str(self.folder), "kind": "folder", "name": "project", "common": None}
        for obj, name, value in [(store, "STORE", str(self.root / "tasks")), (store, "LEGACY", str(self.root / "legacy")),
                                  (settings, "SETTINGS", str(cfg)), (store, "retag_tabs", lambda *a: None),
                                  (commands, "open_store", lambda args, **kw: store.Store(self.loc, **kw)),
                                  (commands, "live_agents", lambda *a: []), (output, "subagents", lambda *a: []),
                                  (launch, "hc_json", lambda *a: None), (launch, "browser_path", lambda: None)]:
            p = patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)

    def command(self, *args):
        buf = io.StringIO()
        with patch.object(sys, "argv", ["herdr-task", *args, "--json"]), contextlib.redirect_stdout(buf):
            rc = cli.main()
        self.assertEqual(rc, 0, buf.getvalue())
        return json.loads(buf.getvalue())

    def add(self):
        return self.command("add", "Compare evidence", "--research", "--kind", "non-software", "--prompt", "Which option fits?")

    def checkpoint(self, ref, **fields):
        return self.command("checkpoint", ref, *[v for k, value in fields.items() for v in ("--" + k.replace("_", "-"), value)])

    def test_saved_sections_survive_reopening_without_filling_task_lists(self):
        t = self.add()
        self.assertEqual(t["mode"], "here")
        self.assertTrue(Path(t["research_report"]).is_file())
        self.checkpoint(t["ref"], findings="A supports the requirement.", sources="https://example.test/a — requirement", open_questions="Cost?", next_steps="Compare B")
        self.checkpoint(t["ref"], next_steps="Check the quoted cost")
        with store.Store(self.loc) as s:
            task = s.find(t["ref"])
            self.assertEqual(task["research_notes"]["open_questions"], "Cost?")
            self.assertEqual(task["research_notes"]["sources"], "https://example.test/a — requirement")
            self.assertEqual(task["research_notes"]["question"], "Which option fits?")
            self.assertNotIn("research_notes", output.view(s, task))
            text = Path(task["research_report"]).read_text()
            self.assertIn("A supports the requirement.", text)
            self.assertIn("Check the quoted cost", text)
            self.assertNotIn("Compare B", text)
            self.assertNotIn(str(self.folder), task["research_report"])
            with patch.object(proof, "find_proof", return_value=None), patch.object(proof, "task_artifacts", return_value=[]), patch.object(proof, "git") as git:
                evidence = proof.evidence(s, task)
            git.assert_not_called()
            self.assertEqual(evidence["details"], text)
            self.assertEqual(evidence["commits"]["count"], 0)
            handoff = launch.handoff(s, task, {"agent": "cursor"}, argv=["codex"])
            self.assertIn(task["research_report"], handoff)
            self.assertIn("read it before continuing", handoff)
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_ready_requires_saved_evidence_and_never_opens_a_pr(self):
        t = self.add()
        with patch.object(sys, "argv", ["herdr-task", "ready", t["ref"], "--json"]), contextlib.redirect_stdout(io.StringIO()) as buf:
            self.assertEqual(cli.main(), 1)
        self.assertIn("checkpoint", buf.getvalue())
        self.checkpoint(t["ref"], findings="A is appropriate.", sources="Documentation A", open_questions="None", next_steps="Complete")
        with patch.object(commands, "pr_open") as pr, patch.object(commands, "git") as git:
            result = self.command("ready", t["ref"], "--summary", "A meets the requirements.")
        pr.assert_not_called(); git.assert_not_called()
        self.assertEqual(result["state"], "ready")
        self.assertNotIn("auto_merge", result)
        with store.Store(self.loc) as s:
            task = s.find(t["ref"])
            text = news.news_line(s, task, {"status": "ready"}, "ready")
            self.assertIn(task["research_report"], text)
            self.assertNotIn("Documentation A", text)

    def test_coding_settings_do_not_add_review_or_proof_to_research(self):
        t = self.add()
        with store.Store(self.loc) as s:
            task = s.find(t["ref"])
            task["set"] = {"review": "on", "proof": "on", "merge": "auto"}
            self.assertEqual(settings.review_limits(s, task), (False, 0))
            rows = {r["label"]: r["value"] for r in settings.task_settings(s, task)}
            self.assertFalse(rows["Proof"])
            with patch.object(launch, "git") as git:
                self.assertEqual(launch.folder_for(s, task), str(self.folder))
            git.assert_not_called()
            with patch.object(launch, "instructions", return_value="Coding worker: commit changes"):
                text = launch.brief(s, task, argv=["codex"])
            self.assertNotIn("Coding worker", text)
            self.assertNotIn("git add", text)
            self.assertIn("checkpoint", text)

    def test_read_only_applies_to_custom_launch_and_resume_arguments(self):
        t = {"research": True}
        for argv in (["codex", "--yolo", "-c", 'sandbox_mode="danger-full-access"', "resume", "session"],
                     ["claude", "--dangerously-skip-permissions", "--resume", "session"],
                     ["cursor-agent", "--force", "--auto-review", "--resume", "session"]):
            original = list(argv)
            fixed = settings.research_argv(t, argv)
            self.assertEqual(settings.permission_mode(fixed), "read-only")
            self.assertIn("session", fixed)
            self.assertEqual(argv, original)
        with self.assertRaises(Fail):
            settings.research_argv(t, ["sh", "-c", "codex --yolo"])

    def test_research_cannot_be_changed_into_a_worktree_or_added_after_start(self):
        for task, args in [({"research": True, "mode": "here"}, SimpleNamespace(worktree=True)),
                           ({"state": "running", "agents": []}, SimpleNamespace(research=True))]:
            with self.assertRaises(Fail):
                research.configure(task, args)

    def test_failed_checkpoint_preserves_the_previous_report_and_task(self):
        t = self.add()
        with store.Store(self.loc) as s:
            task = s.find(t["ref"])
            previous = copy.deepcopy(task)
            text = Path(task["research_report"]).read_text()
            with patch.object(research.os, "replace", side_effect=OSError("disk unavailable")):
                with self.assertRaises(OSError):
                    research.checkpoint(s, task, SimpleNamespace(findings="New evidence"))
            self.assertEqual(task, previous)
            self.assertEqual(Path(task["research_report"]).read_text(), text)

    def test_recovered_assistant_receives_news_from_its_previous_spaces(self):
        with patch.object(launch, "coordinators", return_value=["t1"]), patch.object(launch, "hc_json", return_value={
            "state": "live", "labels": {"herdr.coordinator.space": "new", "herdr.coordinator.previous": "old,older"}}):
            self.assertEqual(launch.coordinator_in("old"), "t1")
            self.assertIsNone(launch.coordinator_in("unrelated"))


    def test_research_permission_hook_allows_checkpoints_but_not_git_writes(self):
        ht = "/tools/herdr-task"
        self.assertTrue(launch.own_command(ht, ht + " checkpoint TEST-1 --findings 'Evidence'", True, True))
        for command in ("git add file.py", "git commit -m change", "herdr-artifact publish /report"):
            self.assertFalse(launch.own_command(ht, command, True, True))
        with patch.object(launch, "own_path", return_value=ht), patch.object(launch, "trust_roots", return_value=[]):
            argv = launch.own_argv(["codex"], research=True)
        self.assertIn("--research", " ".join(argv))

    def test_launch_and_resume_keep_read_only_and_outlive_the_assistant(self):
        t = self.add()
        with store.Store(self.loc) as s:
            task = s.find(t["ref"])
            for resume in (None, ["codex", "--yolo", "resume", "session"]):
                with patch.object(launch, "run", return_value=SimpleNamespace(returncode=0, stdout='{"address":"worker"}', stderr="")) as run, \
                     patch.object(launch, "track"), patch.object(launch, "in_shell", side_effect=lambda argv: argv), \
                     patch.object(launch, "low_priority", side_effect=lambda argv, *a: argv), \
                     patch.object(launch, "own_argv", side_effect=lambda argv, *a, **kw: argv):
                    a = launch.launch(s, task, ["codex", "--yolo"], "space", message="Continue", parent="assistant", resume=resume)
                cmd = run.call_args.args[0]
                self.assertIn("--outlive-parent", cmd)
                self.assertIn("--keep", cmd)
                self.assertNotIn("--yolo", cmd)
                self.assertEqual(settings.permission_mode(a["argv"]), "read-only")
                if resume:
                    self.assertIn(task["research_report"], cmd[-1])


    def test_new_current_owner_takes_precedence_over_recovery_history(self):
        def record(*args):
            return {"state": "live", "labels": {"herdr.coordinator.space": "new", "herdr.coordinator.previous": "old"}} if args[-1] == "recovered" else {"state": "live", "labels": {"herdr.coordinator.space": "old"}}
        with patch.object(launch, "coordinators", return_value=["recovered", "current"]), patch.object(launch, "hc_json", side_effect=record):
            self.assertEqual(launch.coordinator_in("old"), "current")

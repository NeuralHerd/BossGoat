"""Keep task briefs small without dropping the active workflow or personal instructions."""
import home_guard  # noqa: F401
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mods/tasks/bin"))
from herdr_task import browsers, launch, settings, templates


class WorkerBrief(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.tpl = self.root / "templates"
        self.tpl.mkdir()
        self.file = self.root / "settings.json"
        self.cfg = {"everywhere": {"tasks": {"proof": False, "review_rounds": 0},
                                  "agents": {"suggestions": False, "feedback": False},
                                  "worker": {"agent": "claude"}, "reviewer": {"agent": "claude"}}}
        self.file.write_text(json.dumps(self.cfg))
        self.s = SimpleNamespace(loc={"folder": str(self.root), "kind": "repo"}, ref=lambda t: "TEST-1")
        self.task = {"id": 1, "title": "Check the task", "prompt": "Only inspect the requested feature.",
                     "kind": "non-software", "mode": "here"}
        for obj, name, value in [(settings, "SETTINGS", str(self.file)), (templates, "TEMPLATES", str(self.tpl)),
                                 (launch, "browser_path", lambda: None), (browsers, "browser_path", lambda: None),
                                 (launch, "own_path", lambda: "/tools/herdr-task")]:
            p = patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)

    def brief(self):
        self.file.write_text(json.dumps(self.cfg))
        return launch.brief(self.s, self.task, argv=["claude"])

    def test_core_keeps_contract_checks_status_and_permission_boundaries_once(self):
        text = self.brief()
        for rule in (self.task["prompt"], "Preserve unrelated edits", "unless authorized", "Never mark done yourself",
                     "Run required project checks", "failing before and passing after", "Never fabricate evidence",
                     "Secrets stay unread", "question tool", "at most 160 characters", "--agents-md",
                     "/tools/herdr-task ready TEST-1", "/tools/herdr-task status TEST-1", "--done", "--left"):
            self.assertIn(rule, text)
        self.assertEqual(text.count("at least every 5 minutes"), 1)
        for unused in ("Launch an independent", "hc run --bg", "herdr-artifact guide", "snapshot -i",
                       "sync-shared", "hc suggest=", "- Feedback:", "<!-- bossgoat:"):
            self.assertNotIn(unused, text)
        self.assertLess(len(text.split()), 750)

    def test_review_and_proof_are_selected_by_effective_settings(self):
        self.task["set"] = {"review": "on", "proof": "on", "review_rounds": 2}
        text = self.brief()
        for rule in ("--label herdr.role=reviewer", "exactly as the Reviewer line gives it", "read-only reviewer",
                     "Must fix", "unreviewed final commit", "--commit <sha>", "At most 2 rounds", "Not proven",
                     "--proof <id>", "herdr-artifact preview", "- Review: on", "- Proof:"):
            self.assertIn(rule, text)
        self.assertLess(len(text.split()), 1100)
        self.task["set"] = {"review": "off", "proof": "off"}
        text = self.brief()
        self.assertNotIn("hc run --bg", text)
        self.assertNotIn("herdr-artifact guide", text)
        self.assertIn("Run required project checks", text)

    def test_browser_and_bossgoat_guidance_require_their_actual_context(self):
        with patch.object(launch, "browser_path", return_value="/tools/herdr-browser"), \
                patch.object(browsers, "browser_path", return_value="/tools/herdr-browser"):
            text = self.brief()
        self.assertIn("snapshot -i", text)
        self.assertIn("/tools/herdr-browser", text)
        self.assertNotIn("sync-shared", text)
        for name in ("lib/COPIES", "bin/sync-shared"):
            file = self.root / name; file.parent.mkdir(exist_ok=True); file.write_text("fixture")
        self.assertIn("bin/sync-shared --check", self.brief())
        self.task["worktree"] = str(self.root / "elsewhere")
        self.assertNotIn("sync-shared", launch.worker_instructions(self.s, self.task, argv=["claude"]))

    def test_optional_suggestions_and_feedback_follow_their_switches(self):
        self.cfg["everywhere"]["agents"] = {"suggestions": True, "feedback": True}
        text = self.brief()
        self.assertIn('<hc suggest="…"/>', text)
        self.assertIn("never file an issue yourself", text)
        self.assertIn("/tools/herdr-task feedback", text)

    def test_personal_rules_survive_rendering_and_handoffs_verbatim(self):
        personal = "\n\n## My workflow\nUse existing Chrome. No isolated profile or worktree. Keep this exact wording.\n"
        path = self.tpl / "worker.md"
        path.write_text(templates.TEMPLATE_HEADS["worker"] + templates.WORKER_MD + personal)
        before = path.read_text()
        self.assertIn(personal.strip(), self.brief())
        handoff = launch.handoff(self.s, self.task, {"agent": "claude", "log": "/saved/session.jsonl"}, argv=["claude"])
        self.assertIn(personal.strip(), handoff)
        self.assertIn("/saved/session.jsonl", handoff)
        self.assertNotIn("own browser", handoff)
        self.assertNotIn("hc run --bg", handoff)
        self.assertEqual(path.read_text(), before)

    def test_old_defaults_migrate_but_custom_templates_are_not_rewritten(self):
        path = self.tpl / "worker.md"
        path.write_text(templates.TEMPLATE_HEADS["worker"] + templates.WORKER_MD_BEFORE_COMPACT)
        self.assertEqual(templates.instructions("worker"), templates.WORKER_MD.strip())
        first = path.read_text()
        templates.instructions("worker")
        self.assertEqual(path.read_text(), first)
        custom = templates.WORKER_MD_BEFORE_COMPACT + "\nPreserve my changes.\n"
        path.write_text(custom)
        self.assertEqual(templates.instructions("worker"), custom.strip())
        self.assertIn(custom.strip(), path.read_text())

    def test_shipped_and_embedded_defaults_match_and_stay_within_budget(self):
        text = templates.FRONT.sub("", (ROOT / "templates/worker.md").read_text()).strip()
        self.assertEqual(text, templates.WORKER_MD.strip())
        self.assertLessEqual(len(text.split()), 900)

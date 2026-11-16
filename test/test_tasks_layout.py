"""Updates move Tasks without replacing a person's customized window or saved clicks."""
import home_guard  # noqa: F401
import copy
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from test_install import run, tree

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("tasks_layout_installer", str(ROOT / "bin/shepherdr"))
spec = importlib.util.spec_from_loader(loader.name, loader)
I = importlib.util.module_from_spec(spec)
loader.exec_module(I)
SHIPPED = (ROOT / "layouts/BossGoat.json").read_bytes()
REL = f"{I.APP}/layouts/BossGoat.json"


def encode(value):
    return (json.dumps(value, indent=2) + "\n").encode()


def nodes(tree):
    out = {tree["id"]: tree}
    for child in tree.get("children", []):
        for ident, node in nodes(child).items():
            if ident in out:
                raise AssertionError(f"duplicate {ident}")
            out[ident] = node
    return out


def old_layout():
    root = json.loads(SHIPPED)
    n = nodes(root)
    n["sidebar-lists"]["children"].remove(n["tasks-list"])
    n["sidebar-lists"]["resizable"] = False
    n["tasks-list"].pop("size")
    n["tasks-list"].pop("min")
    n["work-body"]["children"][0] = n["main"]
    n["tasks"]["children"][0] = n["tasks-list"]
    n["tasks"]["active"] = "tasks-list"
    n["panel-body"]["children"].insert(2, n["tasks"])
    n["panel-body"]["active"] = "tasks"
    return root


class TasksLayout(unittest.TestCase):
    def migrate(self, root):
        return json.loads(I.migrate_tasks_layout(encode(root), SHIPPED))

    def assert_sidebar(self, root):
        n = nodes(root)
        self.assertIn(n["tasks-list"], n["sidebar-lists"]["children"])
        self.assertIn(n["tasks"], n["work-body"]["children"])
        self.assertIn(n["main"], n["tasks"]["children"])
        self.assertIn(n["tasks-thread"], n["tasks"]["children"])
        self.assertNotIn(n["tasks"], n["panel-body"]["children"])
        self.assertEqual(n["tasks"]["active"], "main")
        self.assertNotEqual(n["panel-body"]["active"], "tasks")
        self.assertFalse(n["tasks-list"].get("hidden"))
        return n

    def test_custom_appearance_panels_and_live_content_survive(self):
        root = old_layout()
        n = nodes(root)
        root["background"] = {"image": "my-wallpaper.png", "fit": "cover"}
        n["sidebar"]["size"] = {"px": 333}
        n["panel"]["size"] = {"px": 615}
        n["main"]["background"] = "#abcdef80"
        n["main"]["size"] = {"weight": 3}
        n["tasks-thread"]["radius"] = 17
        n["tasks-thread-term"]["content"] = {"terminal": "test-worker"}
        n["artifacts-view-body"]["content"] = {"mod": "my-artifact"}
        n["sidebar-lists"]["children"].append({"id": "my-agents", "type": "block", "content": {"mod": "my-agents"}})
        n["panel-body"]["children"].append({"id": "notes", "type": "block", "content": {"mod": "notes"}})
        n["panel-body"]["active"] = "notes"
        n = nodes(root)
        before = copy.deepcopy(root)
        result = self.migrate(root)
        got = self.assert_sidebar(result)
        self.assertEqual(root, before, "migration must not mutate its input")
        self.assertEqual(result["background"], root["background"])
        for ident in ("main", "sidebar-footer", "panel", "tasks-thread", "my-agents", "notes", "artifacts-view-body"):
            if ident == "panel":
                self.assertEqual(got[ident]["size"], n[ident]["size"])
            else:
                self.assertEqual(got[ident], n[ident], ident)
        self.assertEqual(got["sidebar"]["size"], {"px": 333})
        self.assertEqual(got["tasks"]["size"], {"weight": 3})
        self.assertEqual(got["panel-body"]["active"], "notes")
        self.assertEqual([c["id"] for c in got["sidebar-lists"]["children"]], ["spaces", "tasks-list", "my-agents"])

    def test_unmodified_legacy_layout_still_tracks_the_shipped_default(self):
        self.assertEqual(self.migrate(old_layout()), json.loads(SHIPPED))

    def test_old_layout_with_no_task_panel_gets_the_missing_nodes(self):
        root = old_layout()
        n = nodes(root)
        n["panel-body"]["children"].remove(n["tasks"])
        n["panel-body"]["active"] = "files"
        self.assert_sidebar(self.migrate(root))

    def test_partly_moved_list_is_not_duplicated(self):
        root = old_layout()
        n = nodes(root)
        n["tasks"]["children"].remove(n["tasks-list"])
        n["sidebar-lists"]["children"].append(n["tasks-list"])
        self.assert_sidebar(self.migrate(root))

    def test_moving_list_finishes_a_partly_moved_main_stack(self):
        root = old_layout()
        n = nodes(root)
        n["panel-body"]["children"].remove(n["tasks"])
        n["panel-body"]["active"] = "files"
        n["work-body"]["children"][0] = n["tasks"]
        n["tasks"]["children"].insert(0, n["main"])
        self.assert_sidebar(self.migrate(root))

    def test_repeat_updates_preserve_new_sizes_and_visibility_choices(self):
        migrated = self.migrate(old_layout())
        n = nodes(migrated)
        n["tasks-list"].update(size={"px": 385}, hidden=True)
        n["tasks"]["active"] = "tasks-thread"
        raw = encode(migrated)
        self.assertEqual(I.migrate_tasks_layout(raw, SHIPPED), raw)
        self.assertEqual(I.migrate_tasks_layout(SHIPPED, SHIPPED), SHIPPED)

    def test_unsupported_layouts_fail_with_an_actionable_error(self):
        for change in (lambda n: n["sidebar-lists"].update(type="block"),
                       lambda n: n["work-body"]["children"].remove(n["main"]),
                       lambda n: n["sidebar-lists"]["children"].append(copy.deepcopy(n["spaces"]))):
            root = old_layout()
            change(nodes(root))
            with self.assertRaisesRegex(I.Stop, "Cannot migrate.*left unchanged"):
                self.migrate(root)
        with self.assertRaisesRegex(I.Stop, "Cannot migrate"):
            I.migrate_tasks_layout(b"broken json", SHIPPED)

    def test_update_installs_migration_once_with_backup_and_keeps_saved_clicks(self):
        with tempfile.TemporaryDirectory(prefix="bossgoat-layout-") as tmp:
            root = Path(tmp)
            run("install", "--root", tmp, "--yes")
            layout = root / REL
            old = old_layout()
            old["background"] = {"image": "my-wallpaper.png"}
            original = encode(old)
            layout.write_bytes(original)
            state = layout.parent / ".state/BossGoat.json"
            state.parent.mkdir()
            state.write_bytes(encode({"nodes": {"sidebar": {"size": {"px": 325}}, "panel": {"hidden": True}},
                                     "theme": "paper", "file": old}))
            keys = (root / I.APP / "keys.json").read_bytes()
            before = tree(tmp)
            preview = run("update", "--root", tmp, "--yes", "--dry-run").stdout
            self.assertIn("migrate", preview)
            self.assertEqual(tree(tmp), before, "preview must not write the layout or saved clicks")
            output = run("update", "--root", tmp, "--yes").stdout
            self.assertIn("migrated BossGoat Tasks", output)
            self.assert_sidebar(json.loads(layout.read_bytes()))
            self.assertEqual(json.loads(layout.read_bytes())["background"], old["background"])
            self.assertTrue(any(p.read_bytes() == original for p in (root / I.APP / ".shepherdr-backup").rglob("BossGoat.json")))
            self.assertEqual(state.read_bytes(), before[str(state.relative_to(root))])
            self.assertEqual((root / I.APP / "keys.json").read_bytes(), keys)
            migrated = layout.read_bytes()
            second = run("update", "--root", tmp, "--yes").stdout
            self.assertNotIn("migrated BossGoat Tasks", second)
            self.assertEqual(layout.read_bytes(), migrated)
            run("doctor", "--root", tmp)
            # Recording a merged layout as the pristine default would let the next release overwrite it.
            future = root / "future.json"
            future.write_bytes(SHIPPED.replace(b'"px": 391', b'"px": 400'))
            actions, clashes = I.plan_files(I.Run(tmp, True), I.load_record(tmp), [("layout", REL, str(future))], False)
            self.assertFalse(clashes)
            self.assertEqual(actions[0][2], "keep")

    def test_unsupported_layout_stops_update_before_any_install_writes(self):
        with tempfile.TemporaryDirectory(prefix="bossgoat-layout-") as tmp:
            run("install", "--root", tmp, "--yes")
            layout = Path(tmp) / REL
            layout.write_text('{"id":"root","type":"row","children":[]}')
            before = tree(tmp)
            result = run("update", "--root", tmp, "--yes", ok=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Cannot migrate", result.stdout + result.stderr)
            self.assertEqual(tree(tmp), before)

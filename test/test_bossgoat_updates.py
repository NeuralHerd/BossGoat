"""Updates follow the installed checkout without discarding local work or claiming failed installs succeeded."""
import home_guard  # noqa: F401
import contextlib
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("bossgoat_updates_test", str(ROOT / "bin/bossgoat-updates"))
spec = importlib.util.spec_from_loader(loader.name, loader)
U = importlib.util.module_from_spec(spec)
loader.exec_module(U)


class Updates(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.remote, self.src, self.publisher, self.root = [self.base / n for n in ("remote", "source", "publisher", "home")]
        self.run_git("init", "--bare", "--initial-branch=main", str(self.remote))
        self.run_git("clone", str(self.remote), str(self.src))
        for folder in (self.src,):
            self.run_git("-C", str(folder), "config", "user.name", "Update Test")
            self.run_git("-C", str(folder), "config", "user.email", "update@example.test")
        (self.src / "lib").mkdir()
        (self.src / "lib/addons.json").write_text("{}")
        (self.src / "install.sh").write_text("# test source")
        (self.src / "content").write_text("old")
        self.commit(self.src, "initial")
        self.run_git("-C", str(self.src), "push", "-u", "origin", "main")
        self.run_git("clone", str(self.remote), str(self.publisher))
        self.run_git("-C", str(self.publisher), "config", "user.name", "Update Test")
        self.run_git("-C", str(self.publisher), "config", "user.email", "update@example.test")
        self.root.mkdir()
        U.I.save_record(str(self.root), {"source": str(self.src), "version": "3.1.30", "files": {}})
        self.patch = mock.patch.object(U, "matches", return_value=True)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def run_git(self, *args):
        return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, folder, message):
        self.run_git("-C", str(folder), "add", ".")
        self.run_git("-C", str(folder), "commit", "-m", message)

    def publish(self):
        (self.publisher / "content").write_text("new")
        self.commit(self.publisher, "new version")
        self.run_git("-C", str(self.publisher), "push")

    def test_check_detects_new_commits_without_changing_the_checkout(self):
        self.publish()
        result = U.check(str(self.root))
        self.assertTrue(result["available"])
        self.assertEqual((self.src / "content").read_text(), "old")
        self.assertEqual(U.check(str(self.root))["revision"], result["revision"])

    def test_same_version_with_changed_installed_files_still_offers_update(self):
        self.assertFalse(U.check(str(self.root))["available"])
        with mock.patch.object(U, "matches", return_value=False):
            self.assertTrue(U.check(str(self.root))["available"])

    def test_dirty_checkout_is_not_overwritten(self):
        (self.src / "content").write_text("my edits")
        with self.assertRaisesRegex(U.UpdateError, "uncommitted"):
            U.check(str(self.root))
        self.assertEqual((self.src / "content").read_text(), "my edits")

    def test_diverged_checkout_is_not_reset(self):
        self.publish()
        (self.src / "local-file").write_text("keep")
        self.commit(self.src, "local work")
        before = self.run_git("-C", str(self.src), "rev-parse", "HEAD")
        with self.assertRaisesRegex(U.UpdateError, "differs"):
            U.check(str(self.root))
        self.assertEqual(self.run_git("-C", str(self.src), "rev-parse", "HEAD"), before)

    def test_missing_remote_returns_json_error(self):
        self.run_git("-C", str(self.src), "remote", "set-url", "origin", str(self.base / "missing"))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = U.main(["check", "--root", str(self.root), "--json"])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(output.getvalue())["state"], "error")

    def test_install_rechecks_before_fast_forwarding_and_uses_normal_installer(self):
        self.publish()
        actual = U.subprocess.run
        calls = []
        def run(argv, **kwargs):
            if len(argv) > 1 and str(argv[1]).endswith("/bin/shepherdr"):
                calls.append(argv)
                return subprocess.CompletedProcess(argv, 0, "done")
            return actual(argv, **kwargs)
        with mock.patch.object(U.subprocess, "run", side_effect=run), contextlib.redirect_stdout(io.StringIO()):
            U.install_job(str(self.root))
        self.assertEqual((self.src / "content").read_text(), "new")
        self.assertIn("--keys", calls[0])
        self.assertIn("keep", calls[0])
        self.assertNotIn("--force", calls[0])
        self.assertEqual(U.status(str(self.root))["state"], "current")

    def test_incomplete_installer_does_not_report_success_even_with_zero_exit(self):
        actual = U.subprocess.run
        def run(argv, **kwargs):
            if len(argv) > 1 and str(argv[1]).endswith("/bin/shepherdr"):
                return subprocess.CompletedProcess(argv, 0, "  NOT DONE: failed checks")
            return actual(argv, **kwargs)
        with mock.patch.object(U.subprocess, "run", side_effect=run), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(U.UpdateError, "did not finish"):
                U.install_job(str(self.root))
        self.assertNotEqual(U.status(str(self.root))["state"], "current")

    def test_running_job_blocks_another_install_and_survives_settings_reopening(self):
        U.save(str(self.root), {"state": "installing", "message": "Updating"})
        with U.locked(str(self.root)):
            self.assertEqual(U.status(str(self.root))["state"], "installing")
            with self.assertRaisesRegex(U.UpdateError, "already running"):
                U.install(str(self.root))
        self.assertEqual(U.status(str(self.root))["state"], "error")

    def test_missing_checkout_and_untracked_branch_explain_how_to_recover(self):
        self.run_git("-C", str(self.src), "branch", "--unset-upstream")
        with self.assertRaisesRegex(U.UpdateError, "upstream"):
            U.check(str(self.root))
        (self.src / "install.sh").unlink()
        with self.assertRaisesRegex(U.UpdateError, "missing"):
            U.check(str(self.root))

    def test_detached_installer_keeps_lock_and_reports_completion(self):
        (self.src / "bin").mkdir()
        (self.src / "bin/shepherdr").write_text("""import pathlib, sys, time
root = pathlib.Path(sys.argv[sys.argv.index('--root') + 1])
(root / 'started').touch()
for _ in range(200):
    if (root / 'release').exists(): break
    time.sleep(0.05)
else: sys.exit(1)
print('done')
""")
        self.commit(self.src, "test installer")
        self.run_git("-C", str(self.src), "push")
        self.run_git("-C", str(self.publisher), "pull", "--ff-only")
        self.publish()
        state = U.install(str(self.root))
        self.assertEqual(state["state"], "installing")
        try:
            for _ in range(100):
                if (self.root / "started").exists(): break
                time.sleep(0.05)
            self.assertTrue((self.root / "started").exists())
            self.assertEqual(U.status(str(self.root))["state"], "installing")
            with self.assertRaisesRegex(U.UpdateError, "already running"):
                U.install(str(self.root))
        finally:
            (self.root / "release").touch()
            for _ in range(100):
                if U.status(str(self.root))["state"] != "installing": break
                time.sleep(0.05)
        self.assertEqual(U.status(str(self.root))["state"], "current")

"""A task's preview must stay attached to that task, and missing skills must prevent launch."""
import home_guard  # noqa: F401
from pathlib import Path
import re
import subprocess
import unittest

SOURCE = (Path(__file__).resolve().parents[1] / "mods/chat/panel.js").read_text()
SOURCE = re.sub(r'^import .*?;\n', '', SOURCE, flags=re.M)
HARNESS = r'''
import assert from 'node:assert/strict';
const state = new Map(), requests = [], controls = [], texts = [];
const shared = k => state.get(k), setShared = (k, v) => state.set(k, v);
const appHome = () => '/app';
const theme = () => ({popover: 'theme-popover', foreground: 'theme-foreground', border: 'theme-border'});
const red = () => 'theme-error';
const dirs = () => ({tasks: '/tasks'}), layout = () => null;
let taskFile;
const readTextFile = async () => JSON.stringify(taskFile);
let respond;
const exec = async (program, args) => {
  requests.push({program, args});
  return await new Promise(resolve => { respond = out => resolve({code: 0, stdout: JSON.stringify(out)}); });
};
const cx = {notify() {}};
const toast = () => { throw new Error('Unexpected error toast'); };
function element() {
  const el = new Proxy({}, {get: (_, name) => name === 'when' ? (yes, fn) => yes ? fn(el) : el : (...args) => {
    if (name === 'child' && typeof args[0] === 'string') texts.push(args[0]); return el;
  }});
  return el;
}
const div = element, v_flex = element, h_flex = element;
const button = (id, label, options) => { controls.push({id, label, ...options}); return element(); };
const panel = new PanelHost(null, false);
panel.cur = {key: {machine: 'remote', id: 7, slug: 'project', folder: '/project', space: 'remote/s3'}};
const render = () => { controls.length = 0; texts.length = 0; panel.previewCard(cx); };
'''


class TaskPreviewUI(unittest.TestCase):
    def run_js(self, body):
        result = subprocess.run(['node', '--input-type=module'], input=SOURCE + HARNESS + body,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_skill_blocks_start_and_refresh_clears_stale_settings(self):
        self.run_js(r'''
let pending = panel.loadPreview(cx);
render();
assert.equal(controls.find(c => c.id === 'task-preview-start').disabled, true);
respond({ready: false, rows: [], problems: ['hc-build is not installed']});
await pending;
render();
assert.ok(texts.includes('hc-build is not installed'));
assert.equal(controls.find(c => c.id === 'task-preview-start').disabled, true);
pending = panel.loadPreview(cx);
respond({ready: true, rows: [{label: 'Permissions', text: 'Approve for me'}], problems: []});
await pending;
render();
assert.equal(controls.find(c => c.id === 'task-preview-start').disabled, false);
pending = panel.loadPreview(cx);
render();
assert.equal(controls.find(c => c.id === 'task-preview-start').disabled, true);
respond({ready: false, rows: [], problems: ['hc-build was removed']});
await pending;
''')

    def test_late_preview_cannot_replace_a_different_tasks_settings(self):
        self.run_js(r'''
const pending = panel.loadPreview(cx);
panel.cur = {key: {...panel.cur.key, id: 8}};
respond({ready: true, rows: [], problems: []});
await pending;
render();
assert.equal(controls.find(c => c.id === 'task-preview-start').disabled, true);
''')

    def test_start_uses_preview_machine_folder_and_space_once_then_opens_worker(self):
        self.run_js(r'''
const pending = panel.startTask(cx);
await panel.startTask(cx);
assert.equal(requests.length, 1);
assert.deepEqual(requests[0].args, ['--on', 'remote', 'start', '7', '--folder', '/project', '--space', 'remote/s3', '--json']);
respond({terminal: 't8'});
await pending;
assert.equal(shared('tasks.thread').terminal, 'remote/t8');
assert.equal(panel.starting, false);
''')

    def test_preview_follows_a_worker_started_by_the_scheduler(self):
        self.run_js(r'''
panel.head = true;
panel.cur.key.machine = null;
taskFile = {folder: '/project', prefix: 'TASK', tasks: [{id: 7, started: 123, state: 'running', agents: [{address: 't10', agent: 'cursor', log: '/log'}]}]};
await panel.loadTask(null, cx);
assert.equal(shared('tasks.thread').terminal, 't10');
assert.deepEqual(shared('tasks.thread').log, {path: '/log', kind: 'cursor'});
assert.equal(requests.length, 0);
''')

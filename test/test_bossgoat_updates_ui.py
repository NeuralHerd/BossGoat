"""Settings prevents duplicate update requests and resumes an installation after reopening."""
import home_guard  # noqa: F401
from pathlib import Path
import re
import subprocess
import unittest

SOURCE = (Path(__file__).resolve().parents[1] / 'mods/shepherdr-settings/updates-section.js').read_text()
SOURCE = re.sub(r'^import .*?;\n', '', SOURCE, flags=re.M)

HARNESS = r'''
import assert from 'node:assert/strict';
let reply = {state: 'current', version: '3.1.30', available: false}, request;
const requests = [], timers = [], jobs = [], controls = [];
const appHome = () => '/example/app';
const exec = async (program, args) => {
  requests.push({program, args});
  return await new Promise(resolve => { request = () => resolve({stdout: JSON.stringify(reply)}); });
};
const cx = {notify() {}, spawn: fn => jobs.push(fn(cx)), timer: {after: (ms, fn) => timers.push(fn)}};
function element() {
  const el = new Proxy({}, {get: (_, name) => name === 'when' ? (yes, fn) => yes ? fn(el) : el : () => el});
  return el;
}
const div = element, v_flex = element, h_flex = element;
const button = (id, label, options) => { controls.push({id, label, ...options}); return element(); };
const render = view => { controls.length = 0; updatesSection(view, {}, cx); };
const settle = async () => { request(); await jobs.shift(); };
'''


class UpdatesSettings(unittest.TestCase):
    def run_js(self, body):
        result = subprocess.run(['node', '--input-type=module'], input=HARNESS + SOURCE + body,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_available_update_has_one_install_action_and_disables_while_busy(self):
        self.run_js(r'''
const view = {updates: updatesInit()};
runUpdate(view, 'check', cx);
runUpdate(view, 'check', cx);
assert.equal(requests.length, 1);
render(view);
assert.equal(controls.find(c => c.id === 'updates-check').disabled, true);
assert.equal(controls.some(c => c.id === 'updates-install'), false);
reply = {state: 'available', available: true};
await settle();
render(view);
controls.find(c => c.id === 'updates-install').onClick({}, cx);
assert.equal(requests[1].args[2], 'install');
render(view);
assert.equal(controls.find(c => c.id === 'updates-install').disabled, true);
reply = {state: 'installing', available: false};
await settle();
assert.equal(timers.length, 1);
''')

    def test_reopening_resumes_status_polling_without_starting_another_install(self):
        self.run_js(r'''
const view = {updates: updatesInit()};
runUpdate(view, 'status', cx);
reply = {state: 'installing', available: false};
await settle();
render(view);
assert.equal(controls.find(c => c.id === 'updates-check').disabled, true);
timers.shift()(cx);
assert.equal(requests[1].args[2], 'status');
reply = {state: 'current', available: false};
await settle();
assert.equal(timers.length, 0);
render(view);
assert.equal(controls.find(c => c.id === 'updates-check').disabled, false);
''')

    def test_failed_install_offers_log_and_recheck(self):
        self.run_js(r'''
const view = {updates: updatesInit()};
runUpdate(view, 'status', cx);
reply = {state: 'error', available: false, message: 'Failed', log: '/example/update.log'};
await settle();
render(view);
assert.equal(controls.find(c => c.id === 'updates-check').disabled, false);
assert.equal(controls.some(c => c.id === 'updates-install'), false);
assert.equal(controls.some(c => c.id === 'updates-log'), true);
assert.equal(timers.length, 0);
''')

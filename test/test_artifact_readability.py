"""Native artifact Markdown must override the app's dark text color and use a normal line height."""
import home_guard  # noqa: F401
import json
from pathlib import Path
import re
import subprocess
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "mods/artifacts/recipe-view.js"


class ArtifactReadability(unittest.TestCase):
    def test_markdown_is_readable_inside_a_dark_herdr_window(self):
        source = SOURCE.read_text()
        method = re.search(r"\n  md\(id, text, t\) \{\n.*?\n  \}\n", source, re.S)
        self.assertIsNotNone(method)
        harness = r"""
const element = (defaults = {}) => {
  const state = { styles: { ...defaults }, children: [] };
  const view = new Proxy(state, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      if (name === 'child') target.children.push(args[0]);
      else target.styles[name] = args[0];
      return view;
    };
  } });
  return view;
};
const div = () => element();
const TextView = { markdown: () => element({ text_color: '#eeeeef', text_size: 13, line_height: 1.5 }) };
const renderer = { METHOD };
const text = renderer.md('report', '**Readable** text', { foreground: '#1d1d1f' }).children[0];
console.log(JSON.stringify(text.styles));
"""
        result = subprocess.run(["node", "--input-type=module"], input=harness.replace("METHOD", method.group().strip()),
                                text=True, capture_output=True, check=True)
        style = json.loads(result.stdout)
        self.assertEqual(style["text_color"], "#1d1d1f", "TextView must override Herdr's pale dark-mode foreground directly")
        height = style["line_height"]
        pixels = style["text_size"] * height if isinstance(height, (float, int)) else float(height.removesuffix("px"))
        self.assertGreaterEqual(pixels, 20)
        self.assertLessEqual(pixels, 32, "GPUI numeric line heights are multipliers, not pixels")

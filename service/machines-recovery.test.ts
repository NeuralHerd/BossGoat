import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as core from "../core/machines.js";

// Exercise the rendered recovery action without initializing a live settings window.
function recovery(machine: string | null, cli = "codex") {
  const buttons: { label: string; onClick: Function }[] = [], calls: unknown[][] = [];
  const el = (): any => {
    const self: any = new Proxy({}, { get: (_, key) => key === "when"
      ? (yes: boolean, fn: Function) => yes ? fn(self) : self : () => self });
    return self;
  };
  const source = readFileSync(new URL("../lib/machines.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function cliBlock("), source.indexOf("// The whole block for one machine"));
  const deps = { ...core, h_flex: el, v_flex: el, div: el,
    button: (_id: string, label: string, opts: any) => { buttons.push({ label, ...opts }); return el(); },
    home: () => "/fixture-home", exec: async (...args: unknown[]) => { calls.push(args); }, pollNow: async () => {},
  };
  const render = new Function(...Object.keys(deps), `${body}; return cliBlock;`)(...Object.values(deps));
  render({}, "local", { cli, name: cli === "codex" ? "Codex" : "Cursor", read: {
    state: "ok", at: 1, windows: [], failed: "Sign-in needs renewal.",
  } }, 2, machine);
  return { buttons, calls };
}

test("stale Codex usage opens the actual login flow, not an idle chat", async () => {
  const { buttons, calls } = recovery(null);
  const login = buttons.find(b => b.label === "Sign in to Codex");
  expect(login).toBeDefined();
  await login!.onClick(null, { spawn: (fn: Function) => fn() });
  expect(calls).toEqual([["herdr-app", ["do", "tab.new", "--name", "Codex sign-in", "--folder", "/fixture-home", "--argv", '["codex","login"]']]]);
});

test("a remote machine never signs in to the local account", () => {
  expect(recovery("other-machine").buttons.map(b => b.label)).toEqual(["Refresh usage"]);
});

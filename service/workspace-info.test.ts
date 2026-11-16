import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit, built, byId, handler } from "./fake-gpui";

const state = new Map<string, any>(), actions: string[] = [];
let spaces: any[] = [], info = true;
mock.module("herdr", () => fakeHerdr({
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  hc: async () => ({ code: 1, stdout: "", stderr: "" }),
  appHome: () => "/nonexistent-app", home: () => "/nonexistent-home",
  shared: (key: string) => state.get(key), spaces: () => spaces,
  terminals: () => [], agents: () => [], panes: () => [],
  props: () => ({ info }), window: () => ({ platform: "macos" }),
  keys: () => [{ section: "global", action: "app.palette", keys: "cmd-shift-p" }],
  theme: () => ({ popover: "#ffffff", chrome: "#f9f9fa", foreground: "#1d1d1f", muted: "#333333" }),
  closeOverlay: () => actions.push("close"), run: (action: string) => actions.push(action),
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
const { default: WorkspaceStatus } = await import("../mods/workspace-status-chat/main.js");
const text = (el: any): string => typeof el === "string" ? el : (el?.kids ?? []).map(text).join(" ");
const render = () => new WorkspaceStatus().render({});
beforeEach(() => { state.clear(); actions.length = 0; built.length = 0; spaces = []; info = true; });

test("header info shows the current computer and the configured Commands shortcut", () => {
  spaces = [{ id: "local", active: true, branch: "feature/glass" }];
  const contents = text(render());
  expect(contents).toContain("Workspace info");
  expect(contents).toContain("This computer");
  expect(contents).toContain("feature/glass");
  expect(contents).toContain("⌘⇧P  Commands");
  handler(byId("workspace-commands")!, "on_click")!();
  expect(actions).toEqual(["close", "app.palette"]);
});

test("info follows the selected space and uses the machine's custom display name", () => {
  state.set("spaces-chat", { machines: { remote: { name: "Build Mac" } } });
  spaces = [{ id: "local", active: true, branch: "local-branch" },
    { id: "remote", machine: "remote", active: false, branch: "release" }];
  expect(text(render())).toContain("local-branch");
  spaces[0].active = false; spaces[1].active = true;
  const contents = text(render());
  expect(contents).toContain("Build Mac");
  expect(contents).toContain("release");
  expect(contents).not.toContain("local-branch");
});

test("custom layouts can still show the original footer", () => {
  info = false;
  expect(text(render())).toContain("This computer");
  expect(byId("workspace-commands")).toBeUndefined();
  handler(byId("palette")!, "on_click")!();
  expect(actions).toEqual(["app.palette"]);
});

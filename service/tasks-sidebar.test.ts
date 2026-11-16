import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit, built, byId, handler, element } from "./fake-gpui";

import bossgoat from "../layouts/BossGoat.json";

let tree: any;
const actions: [string, any][] = [];
const node = (n: any, id: string): any => n?.id === id ? n : (n?.children ?? []).map((c: any) => node(c, id)).find(Boolean);
const state = new Map<string, any>(), storage = new Map<string, string>(), overlays: any[] = [];
const knownSpaces = [
  { id: "shop", name: "Shop", folder: "/shop", tabs: [], active: true },
  { id: "other", name: "Other", folder: "/other", tabs: [] },
];
mock.module("herdr", () => fakeHerdr({
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), hc: async () => ({ code: 1, stdout: "", stderr: "" }),
  readTextFile: async () => null,
  layout: () => tree, run: (cmd: string, args: any) => actions.push([cmd, args]),
  shared: (k: string) => state.get(k), setShared: (k: string, v: any) => state.set(k, v),
  spaces: () => knownSpaces, terminals: () => [], agents: () => [], panes: () => [], machines: () => [],
  openOverlay: (o: any) => overlays.push(o), theme: () => ({ chrome: "chrome", foreground: "ink", dim: "dim", border: "border" }),
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
(globalThis as any).localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) };
const { default: Tasks } = await import("../mods/tasks/main.js");
const cx: any = { spawn() {}, timer: { every() {}, after() {} }, focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {} };
const text = (el: any): string => typeof el === "string" ? el : (el?.kids ?? []).map(text).join(" ");
const make = (tasks = [{ id: 1, title: "In progress", state: "working" }, { id: 2, title: "Finished", state: "done" }]) => {
  const view: any = new Tasks(); view.init({}, cx);
  view.query = { value: () => "", on() {}, focus() {} }; view.ready = true;
  view.lists = [{ folder: "/shop", name: "Shop", prefix: "SHOP", tasks }];
  view.place = (list: any, task: any) => ({ list, task, live: [], section: task.state });
  view.shelved = () => false;
  return view;
};
beforeEach(() => { tree = structuredClone(bossgoat); actions.length = 0; built.length = 0; overlays.length = 0; state.clear(); storage.clear(); state.set("layout", "BossGoat"); });

test("Working is the default, filters start closed, and Done is absent until selected", () => {
  storage.set("filter", "all");
  const view = make();
  expect(view.filter).toBe("working");
  const root = view.render(cx);
  expect(text(root)).toContain("In progress"); expect(text(root)).not.toContain("Finished");
  expect(byId("task-search")).toBeUndefined(); expect(byId("task-filter-controls")).toBeUndefined();
  expect(root.calls).toContainEqual(["bg", ["#00000000"]]);
  view.pickFilter("done"); built.length = 0;
  expect(text(view.render(cx))).toContain("Finished");
  expect(text(view.render(cx))).not.toContain("In progress");
});

test("zero Working tasks stays empty instead of falling back to Done", () => {
  const view = make([{ id: 2, title: "Finished", state: "done" }]);
  const result = text(view.render(cx));
  expect(result).toContain("No working tasks."); expect(result).not.toContain("Finished");
});

test("icon buttons expose names and reveal explicit status and space selectors on click", () => {
  const view = make(); view.render(cx);
  for (const [id, label] of [["tasks-view-0", "List"], ["tasks-view-1", "Dependencies"], ["task-filters", "Filters"]]) {
    expect(byId(id).calls).toContainEqual(["tooltip", [label]]);
    expect(byId(id).calls).toContainEqual(["accessibility_label", [label]]);
  }
  handler(byId("task-filters"), "on_click")!({}, cx); built.length = 0; view.render(cx);
  expect(byId("task-search")).toBeDefined();
  handler(byId("task-status-filter"), "on_click")!();
  expect(overlays.at(-1).props.items.some((o: any) => o.key === "done")).toBe(true);
  handler(byId("task-space-filter"), "on_click")!();
  expect(overlays.at(-1).props.items.map((o: any) => o.label)).toEqual(["All spaces", "Shop", "Other"]);
  state.set("tasks.scopereq", { key: "other", at: 1 }); built.length = 0;
  expect(text(view.render(cx))).not.toContain("In progress");
  handler(byId("task-filters"), "on_click")!({}, cx); built.length = 0; view.render(cx);
  expect(byId("task-filter-controls")).toBeUndefined();
});

test("minimized Tasks shows status buttons and hover details, without clipped controls", () => {
  const view = make(); view.width = 76; view.filtersOpen = true;
  const root = view.render(cx), task = byId("task-:/shop#1");
  expect(text(root)).toContain("SHOP-1");
  expect(text(root)).not.toContain("In progress");
  expect(task.calls).toContainEqual(["tooltip", ["SHOP-1\nIn progress\nShop"]]);
  expect(byId("task-:/shop#2")).toBeUndefined();
  expect(byId("tasks-expand")).toBeDefined();
  expect(byId("tasks-view-0")).toBeUndefined();
  expect(byId("tasks-view-1")).toBeUndefined();
  expect(byId("task-filters")).toBeUndefined();
  expect(byId("task-search")).toBeUndefined();
  handler(task, "on_click")!({}, cx);
  expect(state.get("tasks.thread")).toMatchObject({ key: { folder: "/shop", id: 1 }, title: "In progress" });
  expect(actions).toContainEqual(["layout.select", { stack: "tasks", child: "tasks-thread" }]);
});

test("expanding Tasks restores the saved width, filters and dependency view", () => {
  const view = make(); view.width = 44; view.filtersOpen = true; view.dependencyMode = true;
  state.set("sidebar.width", 312);
  let graphs = 0;
  view.dependencies = () => { graphs++; return element(); };
  view.render(cx);
  expect(graphs).toBe(0);
  handler(byId("tasks-expand"), "on_click")!();
  expect(actions).toContainEqual(["layout.resize", { id: "sidebar", px: 312 }]);
  expect(view.filter).toBe("working"); expect(view.dependencyMode).toBe(true);
  handler(byId("tasks"), "on_size_change")!({ width: 312 }, cx);
  built.length = 0; view.render(cx);
  expect(byId("task-search")).toBeDefined(); expect(byId("tasks-view-1")).toBeDefined();
  expect(graphs).toBe(1);
});

test("compact filters keep Done hidden until selected and never squeeze in empty messages", () => {
  const view = make([{ id: 2, title: "Finished", state: "done" }]); view.width = 76;
  const root = view.render(cx);
  expect(text(root).trim()).toBe("");
  expect(built.some(el => el.calls.some(([name, args]: any) => name === "tooltip" && args[0] === "No working tasks."))).toBe(true);
  expect(byId("task-:/shop#2")).toBeUndefined();
  view.pickFilter("done"); built.length = 0; view.render(cx);
  expect(byId("task-:/shop#2")).toBeDefined();
});

test("compact task selection and keyboard search work while the sidebar stays minimized", () => {
  const view = make(); view.width = 76;
  node(tree, "tasks").active = "tasks-thread";
  state.set("tasks.thread", { key: { folder: "/shop", id: 1 } });
  view.render(cx);
  expect(byId("task-:/shop#1").calls.some(([name]: any) => name === "bg")).toBe(true);
  handler(byId("task-list"), "on_key_down")!({ keystroke: "f" }, cx);
  expect(actions).toContainEqual(["layout.resize", { id: "sidebar", px: 268 }]);
  expect(view.filtersOpen).toBe(true);
});

test("compact search includes archived results and identifies their space without headings", () => {
  const view = make([{ id: 2, title: "Finished", state: "done" }]); view.width = 76;
  view.shelved = () => true;
  view.pickFilter("all"); view.query.value = () => "Finished";
  state.set("tasks.group", "space");
  view.render(cx);
  expect(byId("task-:/shop#2").calls.some(([name, args]: any) => name === "tooltip" && args[0].includes("Shop"))).toBe(true);
});

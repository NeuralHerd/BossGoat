// A task opened from the Tasks panel shows its chat, not the terminal the last task showed (GitHub #756's idea): the
// drill-in has one terminal block, so after one task's Terminal, the next task opened on the old worker's terminal.
import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit, built, byId, handler } from "./fake-gpui";

const ran: [string, any][] = [];
const shared = new Map<string, unknown>();
const none = async () => ({ code: 1, stdout: "", stderr: "" });
// The panel's layout: the Tasks stack with the list and the drill-in, whose body is Chat or Terminal.
const legacyTree = {
  id: "root", children: [{ id: "tasks", children: [{ id: "tasks-list" }, { id: "tasks-thread", children: [
    { id: "tasks-thread-body", active: "tasks-thread-term", children: [{ id: "tasks-thread-chat" }, { id: "tasks-thread-term" }] },
  ] }] }],
};
let tree: any = legacyTree;
let knownSpaces: any[] = [], knownTerminals: any[] = [];
mock.module("herdr", () => fakeHerdr({
  theme: () => ({ dim: "dim", muted: "muted", foreground: "ink" }),
  run: (cmd: string, args: any) => { ran.push([cmd, args]); }, layout: () => tree, exec: none, hc: none,
  shared: (k: string) => shared.get(k), setShared: (k: string, v: unknown) => { shared.set(k, v); },
  agents: () => [], panes: () => [], terminals: () => knownTerminals, spaces: () => knownSpaces, machines: () => [],
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: Tasks } = await import("../mods/tasks/main.js");

beforeEach(() => { ran.length = 0; shared.clear(); tree = legacyTree; knownSpaces = []; knownTerminals = []; });

const list = { machine: null, folder: "/tmp/shop", slug: "shop", prefix: "SHOP", tasks: [] };
const open = (live: any[], task: any = { id: 3, title: "Third", agents: [] }) => {
  const tasks: any = Object.create(Tasks.prototype);
  tasks.target({ list, task, live, section: "working" })();
};

test("a task with a live worker opens on its chat", () => {
  open([{ address: "t15", role: "worker", status: "working" }]);
  expect(shared.get("tasks.thread")).toMatchObject({ terminal: "t15", title: "Third" });
  expect(ran).toContainEqual(["layout.select", { stack: "tasks", child: "tasks-thread" }]);
  expect(ran).toContainEqual(["layout.select", { stack: "tasks-thread-body", child: "tasks-thread-chat" }]);
});

test("an ended task opens on its chat too", () => {
  open([], { id: 2, title: "Second", agents: [{ address: "t9", log: "/tmp/log.jsonl", agent: "claude" }] });
  expect(ran).toContainEqual(["layout.select", { stack: "tasks-thread-body", child: "tasks-thread-chat" }]);
});

const { dependencyView } = await import("../mods/tasks/dependencies.js");

test("dependency cards open the exact prerequisite and its results, including outside the filter", () => {
  built.length = 0;
  const opened: string[] = [], results: string[] = [];
  const nodes = [
    { key: "local:/app#1", ref: "APP-1", name: "Local", where: "App", state: "done", dependencies: [], proof: "proof-1" },
    { key: "vm:/app#1", ref: "APP-1", name: "Remote", where: "vm", state: "queued",
      dependencies: [{ key: "local:/app#1", ref: "APP-1", state: "done" }] },
  ];
  dependencyView(nodes, ["vm:/app#1"], { surface: "surface", foreground: "ink", border: "line" },
    (n: any) => opened.push(n.key), (n: any) => results.push(n.proof));
  handler(byId("dependency-edge-vm:/app#1-0"), "on_click")!();
  expect(byId("dependency-local:/app#1")).toBeUndefined();
  built.length = 0;
  dependencyView(nodes, ["local:/app#1"], { surface: "surface", foreground: "ink", border: "line" },
    (n: any) => opened.push(n.key), (n: any) => results.push(n.proof));
  handler(byId("dependency-results-local:/app#1"), "on_click")!();
  expect(opened).toEqual(["local:/app#1"]);
  expect(results).toEqual(["proof-1"]);
});

test("a dependency results shortcut opens artifacts for the task after opening its chat", () => {
  ran.length = 0;
  const tasks: any = Object.create(Tasks.prototype);
  const list = { machine: null, folder: "/tmp/shop", slug: "shop", prefix: "SHOP", tasks: [] };
  const p = { list, task: { id: 3, title: "Third", state: "done", proof: { id: "proof-1" } }, section: "done", live: [] };
  (list.tasks as any[]).push(p.task);
  tasks.lists = [list];
  tasks.statusLine = () => "Done";
  const stack: any = (tree as any).children[0].children[1].children[0];
  stack.children.push({ id: "tasks-thread-artifacts" });
  try {
    built.length = 0;
    tasks.dependencies([p], [p], { surface: "surface", foreground: "ink", border: "line" });
    handler(byId("dependency-results-:/tmp/shop#3"), "on_click")!();
    expect(shared.get("tasks.thread")).toMatchObject({ task: "SHOP-3", key: { folder: "/tmp/shop", id: 3 } });
    expect(ran.at(-1)).toEqual(["layout.select", { stack: "tasks-thread-body", child: "tasks-thread-artifacts" }]);
  } finally { stack.children.pop(); }
});

const bossgoat = (await import("../layouts/BossGoat.json")).default;
const { showMain, showTaskView, showTaskAssistant, taskAssistant } = await import("../mods/tasks/task-navigation.js");
const findNode = (n: any, id: string): any => n.id === id ? n : (n.children ?? []).map((c: any) => findNode(c, id)).find(Boolean);

test("sidebar tasks switch the main conversation while leaving the list available", () => {
  tree = structuredClone(bossgoat);
  const sidebar = findNode(tree, "sidebar-lists");
  expect(sidebar.children.map((n: any) => n.id)).toEqual(["spaces", "tasks-list"]);
  expect(findNode(tree, "work-body").children[0].id).toBe("tasks");
  expect(findNode(tree, "tasks").children.map((n: any) => n.id)).toEqual(["main", "tasks-thread"]);
  expect(findNode(tree, "panel-body").children.some((n: any) => n.id === "tasks")).toBe(false);
  open([{ address: "t15", role: "worker", status: "working" }]);
  expect(shared.get("tasks.thread")).toMatchObject({ terminal: "t15", key: { id: 3 } });
  expect(ran).toContainEqual(["layout.select", { stack: "tasks", child: "tasks-thread" }]);
  expect(ran.some(([, a]) => a.stack === "panel-body" || a.id === "panel")).toBe(false);
  ran.length = 0;
  open([], { id: 4, title: "Another task", agents: [] });
  expect(shared.get("tasks.thread")).toMatchObject({ terminal: null, key: { id: 4 } });
  expect(ran).toContainEqual(["layout.select", { stack: "tasks", child: "tasks-thread" }]);
});

test("Assistant navigation restores the main pane; revealing tasks keeps its conversation", () => {
  tree = structuredClone(bossgoat);
  showMain();
  expect(ran).toEqual([["layout.select", { stack: "tasks", child: "main" }]]);
  ran.length = 0;
  showTaskView("tasks-list");
  expect(ran).toEqual([["layout.show", { id: "sidebar" }]]);
});

test("the selected task stays highlighted until returning to the Assistant", () => {
  tree = structuredClone(bossgoat);
  findNode(tree, "tasks").active = "tasks-thread";
  shared.set("tasks.thread", { key: { machine: null, folder: list.folder, id: 3 } });
  const tasks: any = Object.create(Tasks.prototype);
  tasks.statusLine = () => "Done"; tasks.glyph = () => "";
  tasks.shelved = () => true; tasks.line = (_id: string, row: any) => row;
  const row = { list, task: { id: 3, title: "Third", state: "done" }, live: [], section: "done" };
  expect(tasks.row(row, {}, true).selected).toBe(true);
  expect(tasks.row({ ...row, list: { ...list, machine: "remote" } }, {}, true).selected).toBe(false);
  findNode(tree, "tasks").active = "main";
  expect(tasks.row(row, {}, true).selected).toBe(false);
});

const { default: Chat } = await import("../mods/chat/main.js");
const { backToTasks } = await import("../mods/chat/panel.js");

test("chat task links and the task back button use the main pane", () => {
  tree = structuredClone(bossgoat);
  const chat: any = Object.create(Chat.prototype);
  chat.openTask(3, { id: 3, ref: "SHOP-3", title: "Third", live: [{ address: "t15", role: "worker" }] });
  expect(ran).toContainEqual(["layout.select", { stack: "tasks", child: "tasks-thread" }]);
  expect(ran.some(([, a]) => a.stack === "panel-body" || a.id === "panel")).toBe(false);
  ran.length = 0;
  knownSpaces = [{ id: "shop", machine: null, folder: list.folder, tabs: [{ id: "shop-assistant" }] }];
  shared.set("coordinator.slots", { shop: { space: "shop", tab: "shop-assistant" } });
  shared.set("tasks.thread", { key: { space: "shop", folder: list.folder, id: 3 } });
  backToTasks();
  expect(ran).toEqual([["space.select", { id: "shop" }], ["tab.select", { id: "shop-assistant" }], ["layout.select", { stack: "tasks", child: "main" }]]);
  ran.length = 0;
  chat.openTask(4, { id: 4, title: "Queued", live: [] });
  expect(ran).toEqual([["layout.show", { id: "sidebar" }]]);
});


test("Assistant returns to the task's space even when a different Assistant is selected", () => {
  tree = structuredClone(bossgoat);
  knownSpaces = [
    { id: "other", machine: null, active: true, folder: "/other", tabs: [{ id: "other-assistant", active: true }] },
    { id: "shop", machine: null, folder: list.folder, tabs: [{ id: "shop-terminal", active: true }, { id: "shop-assistant" }] },
  ];
  shared.set("coordinator.slots", { shop: { space: "shop", tab: "shop-assistant" } });
  shared.set("tasks.thread", { key: { space: "shop", folder: list.folder, id: 3 } });
  expect(showTaskAssistant()).toBe(true);
  expect(ran).toEqual([["space.select", { id: "shop" }], ["tab.select", { id: "shop-assistant" }], ["layout.select", { stack: "tasks", child: "main" }]]);
});

test("worker ownership and remote machine identity take priority over the selected space", () => {
  knownSpaces = [
    { id: "shop", machine: null, folder: list.folder, tabs: [{ id: "assistant" }] },
    { id: "vm/shop", machine: "vm", folder: list.folder, tabs: [{ id: "vm/assistant" }] },
  ];
  knownTerminals = [{ address: "vm/t1", labels: { "herdr.coordinator": "assistant" } }];
  shared.set("tasks.thread", { terminal: "vm/t1" });
  expect(taskAssistant()).toEqual({ space: "vm/shop", tab: "vm/assistant" });
});

test("an unavailable owner never silently opens an unrelated Assistant", () => {
  tree = structuredClone(bossgoat);
  knownSpaces = [{ id: "other", folder: "/other", tabs: [{ id: "other-assistant" }] }];
  shared.set("tasks.thread", { key: { space: "missing", folder: list.folder, id: 3 } });
  expect(showTaskAssistant()).toBe(false);
  expect(ran).toEqual([]);
});

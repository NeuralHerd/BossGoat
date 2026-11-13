// A task opened from the Tasks panel shows its chat, not the terminal the last task showed (GitHub #756's idea): the
// drill-in has one terminal block, so after one task's Terminal, the next task opened on the old worker's terminal.
import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit, built, byId, handler } from "./fake-gpui";

const ran: [string, any][] = [];
const shared = new Map<string, unknown>();
const none = async () => ({ code: 1, stdout: "", stderr: "" });
// The panel's layout: the Tasks stack with the list and the drill-in, whose body is Chat or Terminal.
const tree = {
  id: "root", children: [{ id: "tasks", children: [{ id: "tasks-list" }, { id: "tasks-thread", children: [
    { id: "tasks-thread-body", active: "tasks-thread-term", children: [{ id: "tasks-thread-chat" }, { id: "tasks-thread-term" }] },
  ] }] }],
};
mock.module("herdr", () => fakeHerdr({
  run: (cmd: string, args: any) => { ran.push([cmd, args]); }, layout: () => tree, exec: none, hc: none,
  shared: (k: string) => shared.get(k), setShared: (k: string, v: unknown) => { shared.set(k, v); },
  agents: () => [], panes: () => [], terminals: () => [], spaces: () => [], machines: () => [],
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: Tasks } = await import("../mods/tasks/main.js");

beforeEach(() => { ran.length = 0; shared.clear(); });

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

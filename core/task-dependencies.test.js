import { expect, test } from "bun:test";
import { dependencyReader, dependencyLevels, dependencyStatus, dependencyLabel } from "./task-dependencies.js";
import { taskKey } from "./tasks.js";

const list = (machine, folder, prefix, tasks) => ({ machine, folder, prefix, tasks });
const node = (key, dependencies = [], more = {}) => ({ key, dependencies, ...more });
const dep = (key, state = "queued") => ({ key, ref: key, state });

test("local and external prerequisites resolve on the owning machine, never by ref alone", () => {
  const a = list(null, "/a", "APP", [{ id: 1, state: "done" }]);
  const b = list("vm-b", "/a", "APP", [{ id: 1, state: "running" }, { id: 2, after: [1],
    after_ext: [{ ref: "WEB-1", prefix: "WEB", id: 1, state: "queued" }, { ref: "vm-c:APP-1", machine: "vm-c", prefix: "APP", id: 1, state: "done" }] }]);
  const web = list("vm-b", "/web", "WEB", [{ id: 1, state: "queued" }]);
  const c = list("vm-c", "/c", "APP", [{ id: 1, state: "done" }]);
  const read = dependencyReader([a, b, web, c]);
  expect(read(b, b.tasks[1]).map(d => d.key)).toEqual([taskKey(b, { id: 1 }), taskKey(web, { id: 1 }), taskKey(c, { id: 1 })]);
  expect(read(b, b.tasks[1])[0].state).toBe("running");
});

test("a missing local task is removed; an unavailable external task still holds its queue", () => {
  const a = list(null, "/a", "APP", []);
  const deps = dependencyReader([a])(a, { after: [9], after_ext: [{ ref: "vm:WEB-3", state: "unknown", error: "Machine offline" }] });
  expect(dependencyLabel(deps[0])).toBe("Removed");
  expect(dependencyLabel(deps[1])).toBe("Unavailable: Machine offline");
  expect(dependencyStatus({ state: "queued", dependencies: deps })).toBe("Waiting for vm:WEB-3");
});

test("an external observation remains authoritative until the scheduler refreshes it", () => {
  const a = list(null, "/a", "APP", []);
  const b = list("vm", "/b", "WEB", [{ id: 3, state: "done" }]);
  const deps = dependencyReader([a, b])(a, { after_ext: [{ ref: "vm:WEB-3", machine: "vm", prefix: "WEB", id: 3, state: "running" }] });
  expect(deps[0]).toMatchObject({ key: taskKey(b, { id: 3 }), state: "running" });
  expect(dependencyStatus({ state: "queued", dependencies: deps })).toBe("Waiting for vm:WEB-3");
});

test("ambiguous external refs never open the wrong folder's task", () => {
  const a = list(null, "/a", "APP", [{ id: 1 }]);
  const b = list(null, "/b", "APP", [{ id: 1 }]);
  const other = list(null, "/web", "WEB", []);
  expect(dependencyReader([a, b, other])(other, { after_ext: [{ ref: "APP-1" }] })[0].key).toBeNull();
});

test("a filtered dependent keeps completed and cross-space prerequisites, without unrelated work", () => {
  const nodes = [node("a"), node("b", [dep("a", "done")]), node("c", [dep("a")]), node("d", [dep("b"), dep("c"), dep("b")]), node("other")];
  const graph = dependencyLevels(nodes, ["d"]);
  expect(graph.levels.map(l => l.map(n => n.key))).toEqual([["a"], ["b", "c"], ["d"]]);
  expect(graph.loops).toEqual([]);
  expect(dependencyLevels(nodes, []).levels).toEqual([]);
});

test("cross-machine cycles and tasks behind them are shown, never ranked as independent", () => {
  const nodes = [node("a", [dep("vm:b")]), node("vm:b", [dep("a")]), node("later", [dep("a")]), node("free")];
  const graph = dependencyLevels(nodes, nodes.map(n => n.key));
  expect(graph.levels.map(l => l.map(n => n.key))).toEqual([["free"]]);
  expect(graph.loops.map(n => n.key)).toEqual(["a", "vm:b", "later"]);
});

test("long chains do not overflow the stack", () => {
  const nodes = Array.from({ length: 12000 }, (_, i) => node(String(i), i ? [dep(String(i - 1))] : []));
  expect(dependencyLevels(nodes, ["11999"]).levels.length).toBe(12000);
});

test("approvals, recovery and capacity remain distinct from task dependencies", () => {
  expect(dependencyStatus(node("a", [], { state: "needs", needs: "asks" }))).toBe("Approval or answer needed");
  expect(dependencyStatus(node("a", [], { state: "needs", needs: "stopped" }))).toBe("Recovery needed");
  expect(dependencyStatus(node("a", [], { state: "queued", sub: "Waits: 2 tasks are running here" }))).toBe("Waits: 2 tasks are running here");
  expect(dependencyStatus(node("a", [dep("b")], { state: "todo" }))).toBe("Not queued");
});

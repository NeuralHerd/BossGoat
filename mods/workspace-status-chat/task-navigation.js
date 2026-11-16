import { layout, run, shared, setShared, spaces, terminals, panes } from "herdr";
import { assistantOf, chatPane, machineOf } from "./core/spaces.js";
import { toast } from "./ui.js";

const find = (node, id) => node?.id === id ? node : (node?.children ?? []).map((c) => find(c, id)).find(Boolean);
export const tasksInMain = () => Boolean(find(layout(), "tasks")?.children?.some((c) => c.id === "main"));

export const taskViewShown = () => find(layout(), "tasks")?.active === "tasks-thread";

export function showTaskView(child = "tasks-thread") {
  if (tasksInMain()) {
    run("layout.show", { id: "sidebar" });
    if (child !== "tasks-list") {
      setShared("tasks.assistant", taskAssistant());
      run("layout.select", { stack: "tasks", child });
    }
  } else {
    run("layout.select", { stack: "panel-body", child: "tasks" });
    run("layout.select", { stack: "tasks", child });
    run("layout.show", { id: "panel" });
  }
}

export function showMain() {
  if (tasksInMain()) run("layout.select", { stack: "tasks", child: "main" });
}

export function taskAssistant() {
  const thread = shared("tasks.thread"), key = thread?.key;
  if (!thread) return null;
  const all = spaces(), ts = terminals(), ps = panes();
  const worker = ts.find((t) => t.address === thread.terminal);
  const machine = key?.machine ?? machineOf(thread.terminal);
  const onMachine = all.filter((s) => (s.machine ?? null) === (machine ?? null));
  const qualify = (id) => id && machine && !id.includes("/") ? `${machine}/${id}` : id;
  const owner = qualify(worker?.labels?.["herdr.coordinator"]);
  const ownerSpace = owner && onMachine.find((s) => s.tabs?.some((t) => t.id === owner));
  if (ownerSpace) return { space: ownerSpace.id, tab: owner };
  const parent = worker?.parent && ts.find((t) => t.address === qualify(worker.parent));
  const origin = key?.space ?? parent?.labels?.["herdr.coordinator.space"];
  const sameFolder = key?.folder ? onMachine.filter((s) => s.folder === key.folder) : [];
  const space = onMachine.find((s) => s.id === qualify(origin)) ?? (sameFolder.length === 1 ? sameFolder[0] : null);
  if (!space) return null;
  const assistant = assistantOf(space, ts);
  const pane = assistant && ps.find((p) => p.pane === chatPane(assistant));
  const tab = pane?.tab ?? qualify(assistant?.labels?.["herdr.coordinator.tab"] ?? assistant?.labels?.["herdr.tab"])
    ?? Object.values(shared("coordinator.slots") ?? {}).find((s) => s.space === space.id && space.tabs?.some((t) => t.id === s.tab))?.tab;
  return tab && space.tabs?.some((t) => t.id === tab) ? { space: space.id, tab } : null;
}

export function showTaskAssistant() {
  const target = taskAssistant() ?? shared("tasks.assistant");
  if (!target || !spaces().some((s) => s.id === target.space && s.tabs?.some((t) => t.id === target.tab))) {
    toast({ title: "Assistant unavailable", body: "This task's original Assistant is no longer open.", level: "info" });
    return false;
  }
  run("space.select", { id: target.space });
  run("tab.select", { id: target.tab });
  showMain();
  return true;
}

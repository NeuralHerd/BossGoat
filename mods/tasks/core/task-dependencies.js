import { refOf, taskKey, STATUS } from "./tasks.js";

// A reference without a machine is local to the task's machine, not the viewer's.
export function dependencyReader(lists) {
  const refs = new Map();
  const locals = new Map(lists.map((list) => [list, new Map(list.tasks.map((t) => [t.id, t]))]));
  for (const list of lists) for (const task of list.tasks) {
    const ref = `${list.machine ?? ""}:${refOf(list, task)}`;
    refs.set(ref, refs.has(ref) ? null : { list, task });
  }
  return (list, task) => {
    const local = locals.get(list) ?? new Map();
    return [
      ...(task.after ?? []).map((id) => ({
        key: local.has(id) ? taskKey(list, { id }) : null,
        ref: refOf(list, { id }), state: local.get(id)?.state ?? "gone",
      })),
      ...(task.after_ext ?? []).map((d) => {
        const machine = d.machine ?? list.machine ?? "";
        const ref = d.prefix ? `${d.prefix}-${d.id}` : d.ref.split(/[:/]/).pop();
        const target = refs.get(`${machine}:${ref}`);
        return { key: target ? taskKey(target.list, target.task) : null, ref: d.ref,
          // Use the scheduler's last observation; seeing a different snapshot does not unblock a queue.
          state: d.state ?? "unknown", ...(d.error ? { error: d.error } : {}) };
      }),
    ];
  };
}

export const dependencyLabel = (d) => d.error ? `Unavailable: ${d.error}`
  : d.state === "gone" ? "Removed" : d.state === "done" ? "Complete"
  : d.state === "unknown" ? "Status unavailable" : "Waiting";

export function dependencyStatus(node) {
  if (node.state === "needs") {
    if (node.needs === "asks") return "Approval or answer needed";
    if (["stopped", "provider"].includes(node.needs)) return "Recovery needed";
    return node.sub || "Needs your attention";
  }
  if (node.state === "queued") {
    const waits = node.dependencies.filter((d) => !["done", "gone"].includes(d.state));
    return waits.length ? `Waiting for ${waits.map((d) => d.ref).join(", ")}` : node.sub || "Starts soon";
  }
  return node.state === "todo" ? "Not queued" : STATUS[node.state] ?? node.state;
}

// Keep prerequisites outside the selected space/filter visible. Iterative traversal also handles
// cross-machine loops and long chains without recursion or pretending that a loop can start.
export function dependencyLevels(nodes, selected) {
  const known = new Map(nodes.map((n) => [n.key, n]));
  const included = new Set(), pending = [...selected];
  while (pending.length) {
    const key = pending.pop();
    if (included.has(key) || !known.has(key)) continue;
    included.add(key);
    for (const d of known.get(key).dependencies) if (d.key) pending.push(d.key);
  }
  const visible = nodes.filter((n) => included.has(n.key));
  const remaining = new Map(), next = new Map();
  for (const n of visible) {
    const deps = new Set(n.dependencies.map((d) => d.key).filter((k) => included.has(k)));
    remaining.set(n.key, deps.size);
    for (const key of deps) {
      if (!next.has(key)) next.set(key, []);
      next.get(key).push(n.key);
    }
  }
  const levels = [];
  let layer = visible.filter((n) => !remaining.get(n.key));
  while (layer.length) {
    levels.push(layer);
    const ready = [];
    for (const n of layer) {
      remaining.delete(n.key);
      for (const key of next.get(n.key) ?? []) {
        remaining.set(key, remaining.get(key) - 1);
        if (remaining.get(key) === 0) ready.push(known.get(key));
      }
    }
    layer = ready;
  }
  return { levels, loops: visible.filter((n) => remaining.has(n.key)) };
}

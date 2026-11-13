import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { dependencyLevels, dependencyLabel, dependencyStatus } from "./core/task-dependencies.js";
import { red } from "./ui.js";

export function dependencyView(nodes, selected, t, open, results) {
  const graph = dependencyLevels(nodes, selected);
  const chosen = new Set(selected);
  const known = new Map(nodes.map((n) => [n.key, n]));
  const link = (id, label, go) => div().id(id).rounded(6).px(8).py(5).cursor_pointer()
    .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(go).child(label);
  const card = (n) => v_flex().id(`dependency-${n.key}`).flex_none().gap(7).p(12).rounded(8)
    .bg(t.surface).border_1().border_color(t.border)
    .child(div().text_size(12).text_color(t.dim).child(`${n.ref} · ${n.where}${chosen.has(n.key) ? "" : " · Prerequisite"}`))
    .child(link(`dependency-open-${n.key}`, n.name, () => open(n)).text_size(13).font_semibold())
    .child(div().text_size(12).text_color(n.state === "needs" ? red() : t.muted).child(dependencyStatus(n)))
    .when(Boolean(n.skill || n.agent), (e) => e.child(div().text_size(12).text_color(t.dim)
      .child([n.skill, n.agent].filter(Boolean).join(" · "))))
    .when(n.progress != null, (e) => e.child(div().text_size(12).text_color(t.muted).child(`${n.progress}% complete`)))
    .children(n.dependencies.map((d, i) => {
      const label = `← ${d.ref} · ${dependencyLabel(d)}`;
      return d.key && known.has(d.key) ? link(`dependency-edge-${n.key}-${i}`, label, () => open(known.get(d.key)))
        : div().text_size(12).text_color(d.error || d.state === "unknown" ? red() : t.dim).child(label);
    }))
    .child(h_flex().gap(8).child(link(`dependency-chat-${n.key}`, "Open task", () => open(n)))
      .when(Boolean(n.proof), (e) => e.child(link(`dependency-results-${n.key}`, "Results", () => results(n)))));
  return v_flex().flex_none().gap(12).p(6)
    .child(div().text_size(12).text_color(t.dim).child("Tasks in the same step have no dependency on each other. Approvals and capacity can still delay a start. Select a prerequisite to open it. Completed tasks appear as prerequisites or in search."))
    .when(!graph.levels.length && !graph.loops.length, (e) => e.child(div().py(18).text_color(t.dim).child("No tasks match this view.")))
    .children(graph.levels.map((level, i) => v_flex().flex_none().gap(8)
      .child(div().text_size(12).font_semibold().text_color(t.muted).child(`${i ? "↓ " : ""}Step ${i + 1} · ${level.length} task${level.length === 1 ? "" : "s"}`))
      .children(level.map(card))))
    .when(Boolean(graph.loops.length), (e) => e.child(v_flex().flex_none().gap(8)
      .child(div().text_color(red()).child("Dependency loop: these tasks are in or depend on a loop. Check their prerequisites."))
      .children(graph.loops.map(card))));
}

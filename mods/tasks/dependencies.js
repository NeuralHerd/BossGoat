import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { dependencyLevels, dependencyLabel, dependencyStatus } from "./core/task-dependencies.js";
import { taskDot } from "./dot.js";
import { red } from "./ui.js";

export function dependencyView(nodes, selected, t, open, results) {
  const graph = dependencyLevels(nodes, selected), chosen = new Set(selected);
  const known = new Map(nodes.map((n) => [n.key, n]));
  const looped = new Set(graph.loops.map((n) => n.key));
  const visible = [...graph.levels.flat(), ...graph.loops].filter((n) => chosen.has(n.key));
  return v_flex().flex_none().gap(8)
    .when(!visible.length, (e) => e.child(div().px(8).py(18).text_size(12).text_color(t.dim).child("No tasks match this view.")))
    .children(visible.map((n) => v_flex().id(`dependency-${n.key}`).flex_none().gap(3).py(4)
      .child(h_flex().gap(4).items_center()
        .child(v_flex().id(`dependency-open-${n.key}`).flex_1().min_w(0).px(8).py(5).gap(3).rounded(6)
          .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => open(n))
          .child(h_flex().gap(8).items_center().child(taskDot(n.state))
            .child(div().flex_1().truncate().text_size(13).text_color(t.foreground).child(n.name)))
          .child(div().pl(22).truncate().text_size(11).text_color(n.state === "needs" ? red() : t.dim)
            .child(`${n.ref} · ${dependencyStatus(n)}`)))
        .when(Boolean(n.proof), (e) => e.child(div().id(`dependency-results-${n.key}`).size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .accessibility_label("Results").tooltip("Results").on_click(() => results(n))
          .child(svg("mods/artifacts/artifacts.svg").size(14)))))
      .when(looped.has(n.key), (e) => e.child(div().pl(30).text_size(11).text_color(red()).child("Dependency loop")))
      .when(!n.dependencies.length, (e) => e.child(div().pl(30).text_size(11).text_color(t.dim).child("No dependencies")))
      .children(n.dependencies.map((d, i) => {
        const target = d.key && known.get(d.key);
        return h_flex().id(`dependency-edge-${n.key}-${i}`).ml(30).mr(8).px(6).py(4).gap(6).items_center().rounded(5)
          .when(Boolean(target), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => open(target)))
          .child(div().text_size(11).text_color(t.dim).child("↳"))
          .child(div().flex_1().truncate().text_size(11).text_color(t.muted).child(`Needs ${d.ref}`))
          .child(div().text_size(11).text_color(d.error || d.state === "unknown" ? red() : t.dim).child(dependencyLabel(d)));
      }))));
}

import { div } from "gpui-kit";
import { shared } from "herdr";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

export function spaceAvatar(name, id, t) {
  const color = shared("space.colors")?.[id] ?? "ansi6";
  const fill = (color.startsWith("#") ? color : MARK[color] ?? t[color] ?? MARK.ansi6).slice(0, 7);
  const initial = (String(name ?? "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  return div().relative().size(20).flex_none().flex().items_center().justify_center().rounded(6)
    .bg(`${fill}66`).shadow_sm().text_size(11).font_bold().text_color(t.foreground)
    .child(div().absolute().top(0).left(4).right(4).h(1).rounded(1).bg("#ffffff4d"))
    .child(initial);
}

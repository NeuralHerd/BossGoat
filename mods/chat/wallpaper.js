import { div, image } from "gpui-kit";
import { shared } from "herdr";
import { wallpaper, cover, WALLPAPER_KEY } from "./core/wallpaper.js";

export const currentWallpaper = () => wallpaper(shared(WALLPAPER_KEY), shared("layout"));
export function wallpaperLayer(value, width, height) {
  const box = cover(value, width, height);
  return div().absolute().inset_0().overflow_hidden().bg("#f9f9fa")
    .when(Boolean(box), (el) => el.child(image(value.path).absolute().left(box.left).top(box.top).w(box.w).h(box.h).opacity(1 - value.fade / 100)));
}
export function wallpaperTheme(t, value) {
  return value ? { ...t, wallpaper: true, background: "#ffffff", foreground: "#1d1d1f", muted: "#1d1d1fcc", dim: "#1d1d1f80",
    surface: "#ffffff", popover: "#ffffff", chrome: "#f9f9fa", canvas: "#f9f9fa", raised: "#f5f5f7", border: "#1d1d1f21", input: "#1d1d1f21", hover: "#f0f0f2", selected: "#e3edff",
    accent: "#0070d9", accent_foreground: "#ffffff", solid: "#1d1d1f", solid_foreground: "#ffffff" } : t;
}

// Desktop wallpaper preferences stay in this window's shared state, outside synced agent settings.
export const WALLPAPER_KEY = "bossgoat.wallpaper";
export const WALLPAPER_DIR = "data/bossgoat-wallpaper";
export const DEFAULT_FADE = 75;
export const APPEARANCE = { id: "appearance", title: "Appearance", icon: "image" };
export const WALLPAPER = {
  title: "Wallpaper", scope: "BossGoat on this computer.",
  about: "Add a picture behind your conversations. Messages and controls stay on light surfaces.",
  choose: "Choose image…", choosing: "Choosing image…", reset: "Reset wallpaper",
  empty: "Choose a picture or drop one here", formats: "PNG, JPEG or WebP · up to 30 MB · stored locally",
  fade: "Fade", fadeAbout: "More fade makes the picture softer.",
  inactive: "Select the BossGoat layout to see your wallpaper.",
  saved: "Saved on this computer", failed: "Couldn’t load this image. Try a PNG, JPEG or WebP file.",
};
export function wallpaper(value, layout = "BossGoat") {
  if (layout !== "BossGoat" || !value || !new RegExp(`^${WALLPAPER_DIR}/[a-f0-9]{64}\\.png$`).test(value.path)) return null;
  if (![value.width, value.height].every((n) => Number.isInteger(n) && n > 0 && n <= 4096)) return null;
  const fade = Number.isFinite(value.fade) ? Math.max(0, Math.min(95, value.fade)) : DEFAULT_FADE;
  return { path: value.path, width: value.width, height: value.height, fade, name: String(value.name ?? "Wallpaper").slice(0, 200) };
}
export function cover(image, width, height) {
  if (!image || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale, h = image.height * scale;
  return { w, h, left: (width - w) / 2, top: (height - h) / 2 };
}

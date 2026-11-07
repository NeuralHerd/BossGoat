// Desktop wallpaper preferences stay in this window's shared state, outside synced agent settings.
export const WALLPAPER_KEY = "bossgoat.wallpaper";
export const WALLPAPER_DIR = "data/bossgoat-wallpaper";
export const DEFAULT_TRANSPARENCY = 0;
export const DEFAULT_WALLPAPER = { path: "mods/chat/Warp_bg.png", width: 1588, height: 991,
  transparency: DEFAULT_TRANSPARENCY, name: "Warp_bg.png" };
export const APPEARANCE = { id: "appearance", title: "Appearance", icon: "image" };
export const WALLPAPER = {
  title: "Wallpaper", scope: "BossGoat on this computer.",
  about: "Add a picture behind your conversations. Messages and controls stay on light surfaces.",
  choose: "Choose image…", choosing: "Choosing image…", reset: "Reset to default",
  empty: "Choose a picture or drop one here", formats: "PNG, JPEG or WebP · up to 30 MB · stored locally",
  transparency: "Transparency", transparencyAbout: "0% shows the full image. 100% hides it.",
  inactive: "Select the BossGoat layout to see your wallpaper.",
  saved: "Saved on this computer", failed: "Couldn’t load this image. Try a PNG, JPEG or WebP file.",
};
export function wallpaper(value, layout = "BossGoat") {
  if (layout !== "BossGoat") return null;
  if (value == null) return { ...DEFAULT_WALLPAPER };
  if (value.path === DEFAULT_WALLPAPER.path) value = { ...DEFAULT_WALLPAPER, ...value };
  else if (!new RegExp(`^${WALLPAPER_DIR}/[a-f0-9]{64}\\.png$`).test(value.path)) return null;
  if (![value.width, value.height].every((n) => Number.isInteger(n) && n > 0 && n <= 4096)) return null;
  const saved = Number.isFinite(value.transparency) ? value.transparency : value.fade;
  const transparency = Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : DEFAULT_TRANSPARENCY;
  return { path: value.path, width: value.width, height: value.height, transparency, name: String(value.name ?? "Wallpaper").slice(0, 200) };
}
export function cover(image, width, height) {
  if (!image || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale, h = image.height * scale;
  return { w, h, left: (width - w) / 2, top: (height - h) / 2 };
}

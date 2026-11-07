import { expect, test } from "bun:test";
import { wallpaper, cover, DEFAULT_FADE, WALLPAPER_DIR } from "./wallpaper.js";

const chosen = { path: `${WALLPAPER_DIR}/${"a".repeat(64)}.png`, width: 1920, height: 1080, name: "A picture.png", fade: 60 };

test("a saved image is shown only in BossGoat, including after switching away and back", () => {
  expect(wallpaper(chosen, "BossGoat")).toEqual(chosen);
  for (const layout of ["main", "terminals", "shepherdr", "BossGoat-copy", null]) expect(wallpaper(chosen, layout)).toBeNull();
  expect(wallpaper(chosen, "BossGoat")).toEqual(chosen);
  expect(wallpaper(null)).toBeNull();
});

test("preferences cannot load remote URLs, arbitrary files or invalid image dimensions", () => {
  for (const path of ["https://example.com/photo.png", "/etc/passwd", `${WALLPAPER_DIR}/../photo.png`, "data/photo.svg"])
    expect(wallpaper({ ...chosen, path })).toBeNull();
  for (const width of [0, -1, 4097, NaN, Infinity, "1920", 1.5]) expect(wallpaper({ ...chosen, width })).toBeNull();
  expect(wallpaper({ ...chosen, height: 0 })).toBeNull();
});

test("missing and invalid fade values remain usable, and transparency stays bounded", () => {
  expect(wallpaper({ ...chosen, fade: undefined }).fade).toBe(DEFAULT_FADE);
  expect(wallpaper({ ...chosen, fade: NaN }).fade).toBe(DEFAULT_FADE);
  expect(wallpaper({ ...chosen, fade: -50 }).fade).toBe(0);
  expect(wallpaper({ ...chosen, fade: 200 }).fade).toBe(95);
});

test("cover fills a resized workspace without stretching the photo", () => {
  for (const [width, height] of [[800, 600], [400, 900], [2400, 300]]) {
    const box = cover(chosen, width, height);
    expect(box.w).toBeGreaterThanOrEqual(width);
    expect(box.h).toBeGreaterThanOrEqual(height);
    expect(box.w / box.h).toBeCloseTo(chosen.width / chosen.height);
    expect(box.left * 2 + box.w).toBeCloseTo(width);
    expect(box.top * 2 + box.h).toBeCloseTo(height);
  }
  expect(cover(chosen, 0, 100)).toBeNull();
  expect(cover(chosen, 100, NaN)).toBeNull();
});

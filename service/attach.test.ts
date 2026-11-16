// The chat's attach button and image paste on macOS (GitHub #774): the picker was a GTK portal script (no gi on a Mac)
// and paste read wl-paste only, so both failed there, paste without a word. attach.js now asks macOS's own picker and
// clipboard (osascript) there and says when the clipboard can't be read. No Mac here: exec is a stand-in that answers
// as osascript and wl-paste would; the JXA script itself is checked as JavaScript.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeHerdr } from "./fake-herdr";

let os = "macos";
let app = "/app";
let answer: (argv: string[]) => { code: number; stdout: string } = () => ({ code: 0, stdout: "" });
const calls: string[][] = [];
mock.module("herdr", () => fakeHerdr({
  exec: async (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return { stderr: "", ...answer([cmd, ...args]) }; },
  window: () => ({ platform: os }), appHome: () => app, settings: () => ({}), theme: () => new Proxy({}, { get: () => "#000000" }),
  shared: () => undefined, setShared: () => {}, agents: () => [], panes: () => [], terminals: () => [], spaces: () => [],
  machines: () => [], knownAgents: () => [], focused: () => null, home: () => "/nonexistent-home", props: () => ({}),
  hc: async () => ({ code: 1, stdout: "", stderr: "" }), readTextFile: async () => null, writeTextFile: async () => {}, watchFolder: () => {},
}));
const attach = await import("../mods/chat/attach.js");

describe("attach and paste on macOS (GitHub #774)", () => {
  beforeEach(() => { calls.length = 0; os = "macos"; });

  test("the attach button opens macOS's own picker, several files at once", async () => {
    answer = () => ({ code: 0, stdout: "/tmp/demo/a.png\n/tmp/demo/notes.txt\n" });
    const r = await attach.pick("Attach files");
    expect(calls[0][0]).toBe("osascript");
    expect(calls[0].join(" ")).toContain("with multiple selections allowed");
    expect(calls[0].at(-1)).toBe("Attach files");
    expect(r).toEqual({ code: 0, paths: ["/tmp/demo/a.png", "/tmp/demo/notes.txt"] });
  });

  test("cancelling the picker attaches nothing", async () => {
    answer = () => ({ code: 0, stdout: "\n" });
    expect(await attach.pick()).toEqual({ code: 0, paths: [] });
  });

  test("Linux keeps the desktop portal's picker", async () => {
    os = "linux";
    answer = () => ({ code: 0, stdout: "/tmp/demo/a.png\n" });
    const r = await attach.pick();
    expect(calls[0].join(" ")).toContain("pick-files.py");
    expect(r.paths).toEqual(["/tmp/demo/a.png"]);
  });

  test("a pasted screenshot becomes an image attachment", async () => {
    answer = () => ({ code: 0, stdout: "image\n" });
    const got = await attach.fromClipboard();
    expect(calls[0].join(" ")).toContain("osascript -l JavaScript");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ image: true, temp: true });
    expect(got[0].path).toMatch(/^\/app\/data\/chat-attach\/pasted-\d{8}T\d{6}\.png$/);
  });

  test("pasted Finder files become attachments", async () => {
    answer = () => ({ code: 0, stdout: "file\t/tmp/demo/a b.jpg\nfile\t/tmp/demo/c.pdf\n" });
    const got = await attach.fromClipboard();
    expect(got.map((f: any) => [f.path, f.image])).toEqual([["/tmp/demo/a b.jpg", true], ["/tmp/demo/c.pdf", false]]);
  });

  test("a clipboard that can't be read says so", async () => {
    answer = () => ({ code: 1, stdout: "" });
    await expect(attach.fromClipboard()).rejects.toThrow("Couldn't read the clipboard");
    os = "linux";
    answer = () => ({ code: 127, stdout: "" });
    await expect(attach.fromClipboard()).rejects.toThrow("wl-paste");
  });

  test("the clipboard script is valid JavaScript", () => {
    const dir = mkdtempSync(join(tmpdir(), "jxa-"));
    try {
      writeFileSync(join(dir, "clip.js"), attach.MAC_CLIPBOARD);
      const r = Bun.spawnSync(["node", "--check", join(dir, "clip.js")]);
      expect(r.exitCode).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    expect(attach.MAC_CLIPBOARD).toContain('"file\\t"');
  });
});


describe("attachment preview dimensions", () => {
  let root: string, source: string, bin: string;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5l8AAAAASUVORK5CYII=", "base64");
  const tool = (name: string, body: string) => writeFileSync(join(bin, name), "#!/bin/sh\n" + body, { mode: 0o755 });
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "chat-preview-")); app = root;
    bin = join(root, "bin"); mkdirSync(bin);
    source = join(root, "Image's $(touch unexpected) 🌞.png"); writeFileSync(source, png);
    tool("magick", "exit 1\n"); tool("ffprobe", "exit 1\n");
    tool("sips", "printf '  pixelWidth: 3\\n  pixelHeight: 2\\n'\n");
    answer = (argv) => {
      const r = Bun.spawnSync(argv, { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } });
      return { code: r.exitCode, stdout: r.stdout.toString() };
    };
  });
  afterEach(() => { app = "/app"; rmSync(root, { recursive: true, force: true }); });

  test("the macOS fallback creates a preview when both optional tools fail", async () => {
    const views: any = await attach.viewable([source]);
    expect(views[source]).toMatchObject({ w: 3, h: 2 });
    expect(readFileSync(join(root, views[source].rel))).toEqual(png);
    expect(readFileSync(source)).toEqual(png);
  });

  test("ImageMagick and ffprobe remain usable without macOS tools", async () => {
    tool("sips", "exit 1\n");
    tool("magick", "printf '7 5'\n");
    let views: any = await attach.viewable([source]);
    expect(views[source]).toMatchObject({ w: 7, h: 5 });
    tool("magick", "exit 1\n"); tool("ffprobe", "printf '9,6'\n");
    views = await attach.viewable([source]);
    expect(views[source]).toMatchObject({ w: 9, h: 6 });
  });

  test("missing images and unreadable dimensions do not produce broken previews", async () => {
    tool("sips", "printf '  pixelWidth: <nil>\\n  pixelHeight: <nil>\\n'\n");
    expect(await attach.viewable([source, join(root, "missing.png")])).toEqual({});
  });

  test("invalid dimensions cannot reach the image renderer", async () => {
    answer = () => ({ code: 0, stdout: `${source}\tbad.png\t-3 Infinity\n` });
    expect(await attach.viewable([source])).toEqual({});
  });
});

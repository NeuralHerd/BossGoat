import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { built, byId, element, fakeGpuiBase, fakeGpuiKit, handler } from "./fake-gpui";

let picked: string | null;
let reply: { code: number; stdout: string; stderr: string };
let jobs: Promise<unknown>[];
let calls: { command: string; args: string[]; options: unknown }[];
let view: any;
let rendering = false;
const theme = new Proxy({}, { get: () => "#1d1d1f" });
mock.module("herdr", () => fakeHerdr({
  appHome: () => "/nonexistent-app", theme: () => theme,
  pickFolder: async () => picked,
  exec: async (command: string, args: string[], options: unknown) => { calls.push({ command, args, options }); return reply; },
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
const { artifactLocationInit, artifactLocationRow } = await import("../mods/shepherdr-settings/artifact-location.js");
const cx: any = { notify() { if (rendering) throw new Error("Cannot notify during render"); }, stop_propagation() {}, spawn(fn: (cx: any) => Promise<unknown>) { jobs.push(fn(cx)); } };
const flush = async () => { while (jobs.length) await Promise.all(jobs.splice(0)); };
const open = () => { view.artifactLocation = artifactLocationInit(cx); };
const draw = () => {
  built.length = 0;
  rendering = true;
  try { artifactLocationRow(view, theme); } finally { rendering = false; }
};
const click = (id: string) => {
  const fn = handler(byId(id), "on_click");
  expect(fn).toBeDefined();
  fn!({}, cx);
};
const loaded = async () => { open(); draw(); await flush(); draw(); };

beforeEach(() => {
  picked = null;
  reply = { code: 0, stdout: JSON.stringify({ directory: "/old/artifacts" }), stderr: "" };
  jobs = []; calls = []; built.length = 0; rendering = false;
  view = { row: (_t: any, title: string, about: string, control: any, _sc: any, below: any) =>
    element().child(title).child(about).child(control).child(below) };
});

test("Settings initialization starts the lookup before rendering, which cannot request a redraw", async () => {
  open();
  expect(calls).toHaveLength(1);
  expect(() => draw()).not.toThrow();
  expect(handler(byId("artifact-folder-choose"), "on_click")).toBeUndefined();
  await flush(); draw();
  expect(view.artifactLocation.directory).toBe("/old/artifacts");
  expect(calls).toEqual([{ command: "python3", args: ["/nonexistent-app/mods/artifacts/bin/herdr-artifact", "location", "--json"], options: { timeout: 30000 } }]);
  expect(built.some((el) => el.kids.includes("/old/artifacts"))).toBe(true);
  draw();
  expect(calls).toHaveLength(1);
});

test("choosing a folder waits for Move artifacts and preserves unusual path characters", async () => {
  await loaded();
  picked = "/data/Anil's $(touch never) 🌞";
  click("artifact-folder-choose"); await flush(); draw();
  expect(calls).toHaveLength(1);
  expect(view.artifactLocation.directory).toBe("/old/artifacts");
  expect(view.artifactLocation.pending).toBe(picked);
  reply.stdout = JSON.stringify({ directory: picked, backup: "/old/artifacts.before-location-123" });
  click("artifact-folder-move");
  draw();
  expect(handler(byId("artifact-folder-choose"), "on_click")).toBeUndefined();
  expect(handler(byId("artifact-folder-move"), "on_click")).toBeUndefined();
  await flush(); draw();
  expect(calls[1]).toEqual({ command: "python3", args: ["/nonexistent-app/mods/artifacts/bin/herdr-artifact", "location", "--json", picked], options: { timeout: 600000 } });
  expect(view.artifactLocation.directory).toBe(picked);
  expect(view.artifactLocation.pending).toBeNull();
  expect(view.artifactLocation.message).toContain("/old/artifacts.before-location-123");
});

test("cancelling either the picker or a pending move leaves artifacts where they were", async () => {
  await loaded();
  click("artifact-folder-choose"); await flush(); draw();
  expect(view.artifactLocation.pending).toBeNull();
  picked = "/new/artifacts";
  click("artifact-folder-choose"); await flush(); draw();
  click("artifact-folder-cancel"); draw();
  expect(calls).toHaveLength(1);
  expect(view.artifactLocation.pending).toBeNull();
  expect(view.artifactLocation.directory).toBe("/old/artifacts");
});

test("picking the current folder does not offer a move", async () => {
  await loaded(); picked = "/old/artifacts";
  click("artifact-folder-choose"); await flush(); draw();
  expect(byId("artifact-folder-move")).toBeUndefined();
  expect(calls).toHaveLength(1);
});

test("a destination conflict is shown without claiming a move or losing the selected folder", async () => {
  await loaded(); picked = "/new/artifacts";
  click("artifact-folder-choose"); await flush(); draw();
  reply = { code: 1, stdout: JSON.stringify({ error: "Nothing moved: the destination already contains files" }), stderr: "" };
  click("artifact-folder-move"); await flush(); draw();
  expect(view.artifactLocation.directory).toBe("/old/artifacts");
  expect(view.artifactLocation.pending).toBe(picked);
  expect(view.artifactLocation.message).toBe("");
  expect(built.some((el) => el.kids.includes("Nothing moved: the destination already contains files"))).toBe(true);
  expect(handler(byId("artifact-folder-choose"), "on_click")).toBeDefined();
});

test("a failed read shows the error and can be retried", async () => {
  reply = { code: 1, stdout: "", stderr: "Permission denied" };
  await loaded();
  expect(view.artifactLocation.error).toBe("Permission denied");
  expect(handler(byId("artifact-folder-choose"), "on_click")).toBeUndefined();
  reply = { code: 0, stdout: JSON.stringify({ directory: "/old/artifacts" }), stderr: "" };
  click("artifact-folder-refresh"); await flush(); draw();
  expect(view.artifactLocation.error).toBe("");
  expect(handler(byId("artifact-folder-choose"), "on_click")).toBeDefined();
});

test("an invalid command reply cannot replace the current location", async () => {
  await loaded(); picked = "/new/artifacts";
  click("artifact-folder-choose"); await flush(); draw();
  reply.stdout = "{}";
  click("artifact-folder-move"); await flush();
  expect(view.artifactLocation.directory).toBe("/old/artifacts");
  expect(view.artifactLocation.error).toContain("no artifact folder");
  expect(view.artifactLocation.message).toBe("");
});

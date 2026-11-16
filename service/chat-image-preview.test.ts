import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { built, fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

let output = "", reads = 0;
let timers: ((cx: any) => void)[] = [], jobs: Promise<unknown>[] = [];
const theme = new Proxy({}, { get: () => "#1d1d1f" });
mock.module("herdr", () => fakeHerdr({
  appHome: () => "/nonexistent-app", home: () => "/nonexistent-home", theme: () => theme,
  exec: async () => { reads++; return { code: 0, stdout: output, stderr: "" }; },
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
const { default: Chat } = await import("../mods/chat/main.js");
const cx: any = {
  notify() {},
  timer: { after: (_ms: number, fn: (cx: any) => void) => timers.push(fn) },
  spawn: (fn: (cx: any) => Promise<unknown>) => jobs.push(fn(cx)),
};
const flush = async () => {
  while (timers.length) timers.shift()!(cx);
  while (jobs.length) await Promise.all(jobs.splice(0));
};
const path = "/pasted.png";
const row = { id: "image-row", kind: "imgs", paths: [path] };
let chat: any;
beforeEach(() => {
  output = ""; reads = 0; timers = []; jobs = []; built.length = 0;
  chat = Object.assign(Object.create(Chat.prototype), { views: {}, viewAsked: new Set(), findQuery: () => "" });
});

test("a failed preview is labelled, invalidates the row, and does not retry on every render", async () => {
  const pending = chat.key(row);
  chat.needViews([path], cx);
  expect(reads).toBe(0);
  await flush();
  expect(chat.views[path]).toBeNull();
  expect(chat.key(row)).not.toBe(pending);
  chat.shot(theme, { path, w: 200, h: 100 });
  chat.thumb(theme, path);
  expect(built.some((el) => el.kids.includes("Preview unavailable · Click to retry"))).toBe(true);
  expect(built.some((el) => el.kids.includes("Retry preview"))).toBe(true);
  chat.needViews([path], cx); await flush();
  expect(reads).toBe(1);
});

test("clicking a failed preview retries it and renders the recovered image", async () => {
  chat.needViews([path], cx); await flush();
  const failed = chat.key(row);
  output = `${path}\tpreview.png\t300 200\n`;
  chat.openImages([path], 0, cx);
  expect(chat.views[path]).toBeUndefined();
  await flush();
  expect(reads).toBe(2);
  expect(chat.views[path]).toMatchObject({ rel: "data/chat-attach/view/preview.png", w: 300, h: 200 });
  expect(chat.key(row)).not.toBe(failed);
  chat.shot(theme, { path, w: 200, h: 100 });
  chat.thumb(theme, path);
  expect(built.filter((el) => el.kind === "image")).toHaveLength(2);
  expect(built.some((el) => el.kids.includes("Preview unavailable · Click to retry"))).toBe(false);
});

test("each image's loaded or failed state invalidates a multi-image row", () => {
  const multi = { ...row, paths: [path, "/second.png"] };
  const loading = chat.key(multi);
  chat.views[path] = { rel: "view.png", w: 3, h: 2 };
  const partial = chat.key(multi);
  expect(partial).not.toBe(loading);
  chat.views["/second.png"] = null;
  expect(chat.key(multi)).not.toBe(partial);
});

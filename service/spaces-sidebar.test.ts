// The window's Spaces sidebar (mods/spaces-chat) draws with no voice row (GitHub #869, SHEP-158): voiceRow() is null on
// a wide sidebar and with the voice add-on off, and herdr-app's child() throws on null, which blanked the whole sidebar.
// No window runs here, so gpui and herdr are stand-ins: an element's child()/children() refuse what herdr-app refuses.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

const built: any[] = [];
const EL = Symbol("element");
const ok = (v: unknown) => typeof v === "string" || typeof v === "number" || (v !== null && typeof v === "object" && (v as any)[EL]);
function el(): any {
  const kids: any[] = [], calls: any[] = [];
  const self: any = new Proxy({ [EL]: true }, {
    get(target, k) {
      if (k === EL) return true;
      if (k === "kids") return kids;
      if (k === "calls") return calls;
      if (k === "child") return (v: unknown) => {
        if (!ok(v)) throw new TypeError(`child(value) expects an element, a string, or an entity from cx.new(Class, props); got ${v}`);
        kids.push(v);
        return self;
      };
      if (k === "children") return (vs: unknown[]) => {
        for (const v of vs) if (!ok(v)) throw new TypeError(`children() got ${v}`);
        kids.push(...vs);
        return self;
      };
      if (k === "when") return (c: unknown, f: (e: any) => any) => (c ? f(self) : self);
      if (k === "then") return undefined;
      return (target as any)[k] ?? ((...args: any[]) => { calls.push([k, args]); return self; });
    },
  });
  built.push(self);
  return self;
}

const shared = new Map<string, unknown>();
let sidebarPx = 260;
const space = (id: string, active = false) => ({ id, name: id, active, machine: null, tabs: [], folder: "/tmp/x" });
const theme = new Proxy({}, { get: () => "#000000" });
const herdr = {
  agents: () => [], panes: () => [], terminals: () => [], spaces: () => [space("s1", true), space("s2")],
  appHome: () => "/nonexistent-app", home: () => "/nonexistent-home",
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), hc: async () => ({ code: 1, stdout: "", stderr: "" }),
  run: () => {}, openOverlay: () => {}, closeOverlay: () => {}, notify: () => {}, playSound: () => {},
  shared: (k: string) => shared.get(k), setShared: (k: string, v: unknown) => { shared.set(k, v); },
  machines: () => [], focused: () => null, knownAgents: () => [], settings: () => ({}),
  readTextFile: async () => null, writeTextFile: async () => {}, watchFolder: () => {},
  props: () => ({}), theme: () => theme, window: () => ({ platform: "linux" }), nextCommand: () => null,
  layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px: sidebarPx } }] }),
};
mock.module("herdr", () => fakeHerdr(herdr));
mock.module("gpui-kit", () => fakeGpuiKit({ View: class {}, div: el, svg: el, image: el }));
mock.module("gpui-base", () => fakeGpuiBase({
  v_flex: el, h_flex: el, Input: Object.assign(el, { new: el }), InputState: class {}, VirtualListScrollHandle: class {}, v_virtual_list: el, Scrollbar: { vertical: el },
}));
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: Spaces } = await import("../mods/spaces-chat/main.js");
const cx: any = new Proxy({ timer: { every: () => {}, after: () => {} } }, { get: (t, k) => (t as any)[k] ?? (() => {}) });
const sidebar = () => { const s: any = new Spaces(); s.init({}, cx); return s.render(cx); };

describe("Spaces sidebar without a voice row (GitHub #869)", () => {
  beforeEach(() => { shared.clear(); sidebarPx = 260; });

  test("wide sidebar, voice on: no voice row, still draws", () => {
    expect(sidebar()[EL]).toBe(true);
  });

  test("voice add-on off: no voice row, wide or narrow", () => {
    shared.set("addons.off", ["voice"]);
    expect(sidebar()[EL]).toBe(true);
    sidebarPx = 100;
    expect(sidebar()[EL]).toBe(true);
  });

  test("the narrow rail keeps its voice button", () => {
    sidebarPx = 100;
    const s: any = new Spaces(); s.init({}, cx);
    expect(s.voiceRow(theme, true)?.[EL]).toBe(true);
    expect(s.render(cx)[EL]).toBe(true);
  });
});

const { spaceAvatar } = await import("../mods/spaces-chat/avatar.js");
const { IconPicker } = await import("../mods/spaces-chat/icon.js");
const text = (el: any): string => typeof el === "string" ? el : (el?.kids ?? []).map(text).join(" ");
const avatarSidebar = () => {
  const view: any = new Spaces();
  Object.assign(view, { unread: new Set(), pressed: null, needs: () => 0, readyIn: () => 0, pilotMark: () => null });
  return view;
};
const row = { w: { id: "s1", active: true, tabs: [] }, name: "HealthApp" };
beforeEach(() => { shared.clear(); built.length = 0; });

test("wide and narrow space rows default to the displayed name's letter", () => {
  for (const mode of ["row", "compact"]) {
    const rendered = avatarSidebar()[mode](row, theme);
    expect(text(rendered).split(" ")).toContain("H");
  }
  expect(text(spaceAvatar("🏝 école", "s1", theme))).toContain("É");
  expect(text(spaceAvatar("", "s1", theme))).toContain("?");
});

test("chosen emojis still override letters in wide and narrow rows and section headings", () => {
  const saved = { icons: { s1: "🏝" } };
  shared.set("spaces-chat", saved);
  for (const mode of ["row", "compact"]) {
    const words = text(avatarSidebar()[mode](row, theme)).split(" ");
    expect(words).toContain("🏝");
    expect(words).not.toContain("H");
  }
  const section = { id: "section", name: "Analysis", machine: null };
  expect(text(avatarSidebar().sectionHead(section, [], theme, true)).split(" ")).toContain("A");
  expect(text(avatarSidebar().sectionHead({ ...section, icon: "🌍" }, [], theme, true))).toContain("🌍");
  expect(shared.get("spaces-chat")).toBe(saved);
});

test("renaming a space changes its letter without changing its assigned color", () => {
  shared.set("space.colors", { s1: "#884de6", s2: "ansi3" });
  const before = spaceAvatar("HealthApp", "s1", theme), after = spaceAvatar("Portal", "s1", theme);
  const background = (el: any) => el.calls.find(([name]: any) => name === "bg")[1][0];
  expect(background(after)).toBe(background(before));
  expect(background(after)).not.toBe(background(spaceAvatar("Portal", "s2", theme)));
  expect(text(after).trim()).toBe("P");
});

test("emoji picker offers a first-letter reset without saving until the rename dialog does", () => {
  shared.set("spaces-chat", { icons: { s1: "🏝" } });
  const picker: any = new IconPicker();
  Object.assign(picker, { p: { name: "HealthApp", space: "s1", current: "🏝", for: "rename" }, search: { value: () => "" }, scroll: {} });
  expect(text(picker.render())).toContain("Use first letter");
  const reset = built.find(el => el.calls.some(([key, args]: any) => key === "id" && args[0] === "reset"));
  reset.calls.find(([key]: any) => key === "on_click")[1][0]();
  expect(shared.get("spaces-chat.iconpick")).toMatchObject({ for: "rename", emoji: null });
  expect((shared.get("spaces-chat") as { icons: Record<string, string> }).icons.s1).toBe("🏝");
});

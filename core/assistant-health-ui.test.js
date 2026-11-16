import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assistantHealth } from "./assistant-health.js";
import { UNCONFIRMED } from "./delivery.js";

const native = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
const web = readFileSync(new URL("../web/plugins/chat/client.tsx", import.meta.url), "utf8");

// Run the window's methods with element stand-ins, without starting a live agent or window.
function element() {
  const node = { items: [], attrs: {} };
  let proxy;
  proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    if (key === "child") return (child) => { node.items.push(child); return proxy; };
    if (key === "children") return (children) => { node.items.push(...children); return proxy; };
    if (key === "when") return (yes, fn) => yes ? fn(proxy) : proxy;
    if (key === "hover") return () => proxy;
    return (...args) => { node.attrs[key] = args; return proxy; };
  } });
  return proxy;
}
const methods = ["button", "round", "healthButton", "healthCard", "healthFooter"].map((name) => {
  const found = native.match(new RegExp(`\n  ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?\\n  \\}`));
  if (!found) throw new Error(`Missing ${name}`);
  return found[0];
}).join(",");
const prototype = new Function("div", "h_flex", "v_flex", "svg", "props", "assistantHealth", "UNCONFIRMED", "excerpt", "COLUMN", "ROUND",
  `return {${methods}}`)(element, element, element, element, () => ({}), assistantHealth, UNCONFIRMED, (s) => s, 720, 28);
const theme = { background: "#101820", foreground: "#f1f2f3", border: "#334455", muted: "#aabbcc", input: "#445566", hover: "#223344" };
function setup(extra = {}) {
  let checks = 0;
  const chat = Object.assign(Object.create(prototype), { healthOpen: false, phase: "fresh", pending: [], queue: [], checkHealth: () => checks++, ...extra });
  const cx = { stop_propagation() {}, notify() {}, spawn: (fn) => fn(cx) };
  return { chat, cx, checks: () => checks };
}
function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.attrs.id?.[0] === id) return node;
  for (const child of node.items) { const hit = find(child, id); if (hit) return hit; }
  return null;
}
function click(node, cx) { node.attrs.on_click[0]({}, cx); }

test("startup, errors, and pending delivery never open health without a click", () => {
  for (const state of [
    { phase: "fresh" }, { phase: "finding" }, { phase: "starting", healthSince: 1 },
    { phase: "ended" }, { phase: "ready", error: "Permission denied" },
    { health: { installed: false } }, { pending: [{ late: true, attempted: true }] },
    { pending: [{ failed: "offline", restored: true }] }, { queue: [{ text: "saved" }] },
  ]) {
    const { chat, cx, checks } = setup(state);
    expect(chat.healthCard(theme, cx)).toBeNull();
    expect(find(chat.healthFooter(theme, cx), "show-health")).not.toBeNull();
    expect(checks()).toBe(0);
  }
});

test("Health opens on click, closes on click or Hide, and stays closed through errors", () => {
  const { chat, cx, checks } = setup({ error: "Permission denied" });
  click(chat.healthButton(theme), cx);
  expect(checks()).toBe(1);
  expect(chat.healthCard(theme, cx)).not.toBeNull();
  click(chat.healthButton(theme), cx);
  expect(chat.healthCard(theme, cx)).toBeNull();
  expect(checks()).toBe(1);
  click(chat.healthButton(theme), cx);
  click(find(chat.healthCard(theme, cx), "health-hide"), cx);
  expect(chat.healthCard(theme, cx)).toBeNull();
  expect(checks()).toBe(2);
});

test("health uses the current theme and keeps delivery recovery accessible", () => {
  const retries = [];
  const pending = { late: true, attempted: true, checked: true, text: "saved" };
  const { chat, cx } = setup({ healthOpen: true, pending: [pending], retry: (...args) => retries.push(args) });
  for (const t of [theme, { ...theme, background: "#ffffff", foreground: "#1d1d1f", border: "#dddddd" }]) {
    const card = chat.healthCard(t, cx);
    expect(card.attrs.bg).toEqual([t.background]);
    expect(card.attrs.text_color).toEqual([t.foreground]);
    expect(card.attrs.border_color).toEqual([t.border]);
    expect(find(card, "health-check").attrs.text_color).toEqual([t.muted]);
  }
  const card = chat.healthCard(theme, cx);
  click(find(card, "delivery-check"), cx);
  click(find(card, "delivery-resend"), cx);
  expect(retries).toEqual([[pending, cx], [pending, cx, true]]);
});

const component = web.slice(web.indexOf("function AssistantHealth("), web.indexOf("\nfunction ChatView("));
const compiled = new Bun.Transpiler({ loader: "tsx", tsconfig: { compilerOptions: { jsx: "react" } } }).transformSync(component);
function healthMarkup(notice) {
  const View = new Function("React", "useChat", `const {useRef, useState, useEffect} = React; ${compiled}; return AssistantHealth;`)(React, () => ({ notice }));
  return renderToStaticMarkup(React.createElement(View, { chatKey: "p:test" }));
}

test("the web health disclosure stays closed even when the chat has a notice", () => {
  for (const notice of [undefined, "opening", "ended", "unsupported", "none"]) {
    const html = healthMarkup(notice);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(html).toContain('aria-label="Assistant health"');
    expect(html).toMatch(/<summary[^>]*><svg/);
    expect(html).not.toContain(">Health</summary>");
    expect(html).not.toContain("Sign-in:");
    expect(html).toContain("bg-bg");
    expect(html).toContain("text-fg");
    expect(html).not.toContain("color-scheme:");
    expect(html).not.toContain("background:");
  }
});

test("health belongs beside the permission and model controls, not above the conversation", () => {
  expect(native).toContain('.child(this.permissionsButton(t) ?? div())\n        .child(this.healthButton(t))');
  expect(native).not.toContain("root.child(this.healthCard(t, cx))");
  expect(web).toContain('<PermissionLineKept chatKey={chatKey} />\n              <AssistantHealth chatKey={chatKey} />');
  expect(web).not.toMatch(/<DropFiles[^>]*>\s*<AssistantHealth/);
});

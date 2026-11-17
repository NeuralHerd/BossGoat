import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AgentWatch } from "./watch";
import { SCREEN } from "../core/screens.js";

const source = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
const method = (name: string) => source.match(new RegExp(`\\n  ${name}\\([^]*?\\n  \\}`))![0].trim();

test("a stale chat label cannot focus a pane removed by the Terminal switch", () => {
  const list: any[] = [];
  const view = new Function("panes", "terminals", "chatPane", `return { ${method("myPane")} };`)(
    () => list, () => [{ address: "t1", pane: "old-chat" }], (t: any) => t?.pane);
  Object.assign(view, { addr: "t1", lastPane: "old-chat", swapping: true });
  expect(view.myPane()).toBeNull();
  list.push({ pane: "old-chat", mod: "chat" });
  expect(view.myPane()).toBe("old-chat");
  list[0].mod = null;
  expect(view.myPane()).toBeNull();
});

test("the chat stops reporting Working while the native question card is open", () => {
  let card: any = { state: "open", runtime: true };
  const view = new Function("openCard", "agents", "terminals", `return { ${method("status")} };`)(
    () => card, () => [], () => [{ address: "t1", status: "working" }]);
  view.addr = "t1";
  expect(view.status()).toBe("blocked");
  card = null;
  expect(view.status()).toBe("working");
});

test("the web service also refuses startup-menu keys for a window's Cursor checkbox question", async () => {
  const calls: string[][] = [];
  const watch = new AgentWatch({} as any, async (a) => { calls.push(a); return { code: 0, stdout: "" }; }, {
    watched: () => [], windowCards: () => ({ t1: [{ id: "scr-test", state: "open", runtime: true, opened: 1 }] }),
    windowLost: () => ({}), changed: () => {},
  });
  expect(await watch.press("scr-test", 0)).toBe(SCREEN.terminalOnly);
  expect(calls).toEqual([]);
});


test("the Terminal switch waits for the new pane's focus before removing the chat", async () => {
  const src = readFileSync(new URL("../mods/pane-chat/main.js", import.meta.url), "utf8");
  const swap = src.match(/\n  toTerminal\(chat, cx\) \{[^]*?\n  \}/)![0].trim();
  const calls: string[] = [];
  let release!: () => void, started!: () => void, done!: Promise<void>;
  const focused = new Promise<void>((r) => { release = r; });
  const focusing = new Promise<void>((r) => { started = r; });
  const app = async (name: string, args: any) => {
    calls.push(`${name}:${args.pane ?? args.terminal}`);
    if (name === "terminal.keep") return { pane: "new-terminal" };
    if (name === "pane.focus" && args.pane === "new-terminal") { started(); await focused; }
    return {};
  };
  const view = new Function("agentOf", "panes", "app", "hc", "LABEL", "toast", "plainError", `return { ${swap} };`)(
    () => "t1", () => [], app, async () => {}, "herdr.chat", (e: any) => { throw new Error(JSON.stringify(e)); }, String);
  const cx = { spawn: (fn: any) => { done = fn(cx); }, notify: () => {} };
  view.toTerminal("old-chat", cx);
  await focusing;
  expect(calls).toEqual(["pane.focus:old-chat", "terminal.keep:t1", "pane.focus:new-terminal"]);
  release();
  await done;
  expect(calls.at(-1)).toBe("pane.close:old-chat");
});


test("the question card displays its choices as context and offers the terminal without answering", () => {
  const src = readFileSync(new URL("../mods/chat/screens.js", import.meta.url), "utf8");
  const render = new Function("SCREEN", "headStrip", "linkCtl", `${src.slice(src.indexOf("export function screenStrips")).replace("export ", "")}\nreturn screenStrips;`)(
    SCREEN, (x: any) => ({ kind: "head", ...x }), (id: string, label: string, fn: any) => ({ id, label, fn }));
  let opened = 0;
  const strips = render({ id: "scr-test", cli: "Cursor", runtime: true, words: "Choose a setup\n[ ] Existing tenant\n[ ] Change service", choices: [] },
    { toTerminal: () => { opened++; } });
  expect(strips.find((s: any) => s.key === "words").lines).toContain("[ ] Change service");
  expect(strips.some((s: any) => s.kind === "option")).toBe(false);
  expect(strips.find((s: any) => s.key === "terminal").text).toBe(SCREEN.terminalOnly);
  strips[0].links[0].fn();
  expect(opened).toBe(1);
});

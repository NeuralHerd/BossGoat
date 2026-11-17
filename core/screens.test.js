import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readScreen, cursorQuestion, ScreenWatch, starting, watching, pressKeys, SCREEN } from "./screens.js";

const TRUST = [
  "Do you trust the files in this folder?",
  "",
  " ❯ 1. Yes, proceed",
  "   2. No, exit",
  "",
  "Enter to confirm · Esc to exit",
].join("\n");

describe("a CLI's start screen, read the same by the window and the service", () => {
  test("its words and choices, the cursor's one", () => {
    expect(readScreen(TRUST)).toEqual({ words: "Do you trust the files in this folder?", choices: [{ label: "Yes, proceed" }, { label: "No, exit" }], at: 0 });
    expect(pressKeys(0, 1)).toEqual(["down", "enter"]);
  });
  test("starting: live, no status, no turn, a CLI", () => {
    expect(starting({ state: "live", foreground: { name: "claude" } })).toBe(true);
    expect(starting({ state: "live", status: { state: "working" }, foreground: { name: "claude" } })).toBe(false);
  });
  test("two matching reads put a card up; a press on it presses the choice", async () => {
    const store = new Map();
    const sent = [];
    const io = { hc: async (a) => (a[0] === "read" ? { code: 0, stdout: TRUST } : (sent.push(a), { code: 0, stdout: "" })), cards: (x) => store.get(x) ?? [], save: (x, l) => store.set(x, l) };
    const w = new ScreenWatch(io);
    const k = { address: "t1", state: "live", foreground: { name: "claude" }, created_ms: 0 };
    await w.tick("t1", k, 100000);
    expect(store.get("t1")).toBeUndefined();
    await w.tick("t1", k, 102000);
    const card = store.get("t1")[0];
    expect(card).toMatchObject({ cli: "Claude Code", state: "open", choices: [{ label: "Yes, proceed" }, { label: "No, exit" }] });
    expect(await w.press(card, 0)).toBe(null);
    expect(sent).toEqual([["keys", "t1", "enter"]]);
    expect(store.get("t1")[0]).toMatchObject({ state: "answered", how: SCREEN.answered("Yes, proceed") });
  });
  test("the window's chat watches with this core", () => {
    expect(readFileSync(join(import.meta.dir, "..", "mods/chat/screens.js"), "utf8")).toContain('from "./core/screens.js"');
  });
});

const QUESTION = [
  "Earlier research output",
  "┌──────────────────────────────────────────────────────────────────────┐",
  "│ Which setup should I use?                                            │",
  "│                                                                      │",
  "│ Question 1 of 1                                                      │",
  "│ 1. Choose how the worker should be configured.                        │",
  "│                                                                      │",
  "│     [ ] Use an existing tenant                                       │",
  "│         and deploy the worker                                        │",
  "│   › [ ] Change the service                                           │",
  "│     [ ] Other: (type to answer)                                      │",
  "│                                                                      │",
  "│ ↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip │",
  "└──────────────────────────────────────────────────────────────────────┘",
].join("\n");

const cursor = { address: "t1", state: "live", status: "working", turn: 3,
  foreground: { name: "node", argv: ["/bin/cursor-agent"] }, created_ms: 1 };

describe("Cursor questions during an active session", () => {
  test("recognizes the live checkbox dialog, including wrapped choices", () => {
    const q = cursorQuestion(QUESTION);
    expect(q).toMatchObject({ runtime: true, choices: [] });
    expect(q.words).toContain("Which setup should I use?");
    expect(q.words).toContain("and deploy the worker");
    expect(q.words).not.toContain("Earlier research output");
    expect(cursorQuestion(QUESTION.replace("[ ]", "[x]"))).not.toBeNull();
  });
  test("does not mistake research, old questions, or startup menus for a live question", () => {
    for (const text of [TRUST, "Reading a file", QUESTION + "\nQuestions skipped by user\nThinking",
      QUESTION.replace("Space select", "press Enter"), QUESTION.replace("Question 1 of 1", "Previous question")]) {
      expect(cursorQuestion(text)).toBeNull();
    }
  });
  test("watches Cursor despite working hooks and completed turns, but not other running agents", () => {
    expect(starting(cursor)).toBe(false);
    expect(watching(cursor)).toBe(true);
    expect(watching({ ...cursor, state: "exited" })).toBe(false);
    expect(watching({ ...cursor, foreground: { name: "claude" } })).toBe(false);
  });
  test("shows the question while working and retires it as soon as the dialog goes away", async () => {
    const cards = new Map(), calls = [], posted = [];
    let text = QUESTION;
    const w = new ScreenWatch({ hc: async (a) => { calls.push(a); return { code: 0, stdout: text }; },
      cards: (a) => cards.get(a) ?? [], save: (a, c) => cards.set(a, c) }, (c) => posted.push(c));
    await w.tick("t1", cursor);
    expect(w.open("t1")).toBeNull();
    await w.tick("t1", cursor);
    expect(w.open("t1")).toMatchObject({ cli: "Cursor", runtime: true, state: "open" });
    const card = w.open("t1");
    // Native checkbox Enter can skip an unselected choice. No startup-menu keys are allowed here.
    expect(await w.press(card, 0)).toBe(SCREEN.terminalOnly);
    expect(calls.every((a) => a[0] === "read")).toBe(true);
    text += "\nQuestions skipped by user\nThinking";
    await w.tick("t1", cursor);
    expect(w.open("t1")).toBeNull();
    expect(cards.get("t1")[0].state).toBe("closed");
    await w.tick("t1", cursor);
    expect(posted).toHaveLength(1);
  });
  test("an ordinary active Cursor screen never becomes a startup menu", async () => {
    let cards = [];
    const w = new ScreenWatch({ hc: async () => ({ code: 0, stdout: TRUST }), cards: () => cards, save: (_, c) => { cards = c; } });
    await w.tick("t1", cursor);
    await w.tick("t1", cursor);
    expect(cards).toEqual([]);
  });
});

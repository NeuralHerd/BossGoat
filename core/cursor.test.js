import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argvFor, current, freshArgv, forkArgv, menuFor, parseDefaults, sessionOf } from "./agents.js";
import { choicesFrom, chooseModel, modelLabel } from "./settings.js";
import { kindOf } from "./chat-reader.js";
import { receipt } from "./delivery.js";
import { cliOf } from "./screens.js";
import { FIND, LOG, Conversation, records, afterSend } from "./chat-log.js";

const sid = "12345678-1234-1234-1234-123456789abc";

test("Cursor lists account models and Auto without inventing separate effort controls", () => {
  const d = parseDefaults("cursor", "installed\ttrue\nmodel\tauto\ncursor-model\tauto - Auto (current, default)\ncursor-model\topus-high - Opus High\n");
  expect(d.installed).toBe(true);
  expect(menuFor("cursor", d).models.map((m) => m.id)).toEqual(["auto", "opus-high"]);
  expect(menuFor("cursor", d).models.every((m) => m.efforts.length === 0 && !m.fast)).toBe(true);
  expect(parseDefaults("cursor", "").installed).toBe(false);
  expect(choicesFrom({ cursor: d }, { cursor: true }).defaults).toMatchObject({ agent: "cursor", model: "auto", perm: "auto" });
});

test("Cursor launches and resumes with its own flags and explicit permissions", () => {
  const old = { agent: "cursor", argv: ["cursor-agent", "--force", "--model", "old", "--resume", sid, "old prompt", "--add-dir", "/project/docs"], session: sid };
  const pick = { agent: "cursor", model: "auto", perm: "read-only" };
  const r = argvFor(pick, old);
  expect(r.base).toEqual(["cursor-agent", "--add-dir", "/project/docs", "--model", "auto", "--mode", "ask"]);
  expect(r.argv).toEqual([...r.base, "--resume", sid]);
  expect(r.resume).toBe(true);
  expect(argvFor({ ...pick, perm: "auto" }, { agent: "codex", argv: ["codex", "-c", "x=y"], session: sid }).argv)
    .toEqual(["cursor-agent", "--model", "auto", "--auto-review"]);
  expect(current("cursor", r.argv, {}, { mode: "unrestricted" }).perm).toBe("read-only");
  expect(current("cursor", ["cursor-agent", "--auto-review"], {}, { mode: "unrestricted" }).perm).toBe("auto");
  expect(() => argvFor({ ...pick, effort: "high" }, old)).toThrow("model ID");
  expect(() => argvFor({ agent: "unknown" }, old)).toThrow("Unknown agent");
});

test("switching to Cursor clears unsupported effort and keeps permission intent", () => {
  const menus = { cursor: menuFor("cursor", {}) };
  expect(chooseModel(menus, { cursor: "auto" }, { agent: "claude", effort: "high", fast: true, perm: "manual" }, "cursor", "auto"))
    .toMatchObject({ agent: "cursor", model: "auto", effort: null, fast: false, perm: "ask" });
});

test("Cursor recovery keeps flags without replaying old prompts or pretending it can fork", () => {
  expect(freshArgv("cursor", ["cursor-agent", "--model", "auto", `--resume=${sid}`, "old prompt", "--mode", "ask"]))
    .toEqual(["cursor-agent", "--model", "auto", "--mode", "ask"]);
  expect(forkArgv("cursor", ["cursor-agent"], sid)).toBeNull();
  expect(sessionOf("cursor", `/logs/${sid}/${sid}.jsonl`)).toBe(sid);
  for (const app of ["cursor", "cursor-agent", "agent"]) {
    expect(kindOf({ status: { app } })).toBe("cursor");
    expect(cliOf({ status: { app } })).toBe("cursor");
  }
});

test("native Cursor transcripts retain separate replies and distinct tool requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-log-"));
  try {
    const f = join(dir, "log.jsonl");
    const lines = [
      { role: "user", message: { content: [{ type: "text", text: "Please inspect the project" }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "Reading the project" }, { type: "tool_use", name: "Read", input: { path: "README.md" } }] } },
      { role: "assistant", message: { content: [{ type: "tool_use", name: "Shell", input: { command: "git status" } }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "Inspection complete" }] } },
    ];
    writeFileSync(f, lines.map(JSON.stringify).join("\n") + "\n");
    const p = Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe" });
    const c = new Conversation("cursor"); c.feed(records(await new Response(p.stdout).text()).records);
    expect(await p.exited).toBe(0);
    expect(c.items.filter((x) => x.kind === "user").length).toBe(1);
    expect(c.items.filter((x) => x.kind === "agent").map((x) => x.text)).toEqual(["Reading the project", "Inspection complete"]);
    const steps = c.items.filter((x) => x.kind === "tools").flatMap((x) => x.steps);
    expect(new Set(steps.map((x) => x.id)).size).toBe(2);
    expect(steps.every((x) => x.out == null)).toBe(true);
    expect(c.open.size).toBe(0);
    expect(c.doing).toBeNull();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Cursor log discovery uses its open database's ID, never the newest chat in the folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-find-"));
  try {
    const bin = join(dir, "bin"), logs = join(dir, ".cursor/projects/project/agent-transcripts", sid);
    mkdirSync(bin); mkdirSync(logs, { recursive: true });
    const path = join(logs, `${sid}.jsonl`); writeFileSync(path, "");
    writeFileSync(join(bin, "pgrep"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(join(bin, "lsof"), `#!/bin/sh\nprintf '%s\\n' 'n${dir}/.cursor/chats/project/${sid}/store.db'\n`, { mode: 0o755 });
    const p = Bun.spawn(["sh", "-c", FIND, "find", "cursor", "99999999"], { env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe" });
    expect((await new Response(p.stdout).text()).trim()).toBe(path);
    expect(await p.exited).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("Cursor Auto is identifiable in menus and selected labels without changing its model ID", () => {
  const old = { models: [{ id: "auto", label: "Auto" }] };
  for (const d of [{}, old, parseDefaults("cursor", "installed\ttrue")]) {
    const menu = menuFor("cursor", d);
    expect(menu.models.find((m) => m.id === "auto").name).toBe("Cursor Auto");
    expect(modelLabel({ cursor: menu }, { agent: "cursor", model: "auto" })).toBe("Cursor Auto");
    expect(current("cursor", ["cursor-agent", "--model", "auto"], {}, d)).toMatchObject({ model: "auto", label: "Cursor Auto" });
  }
});

test("a live Node-hosted Cursor is recognized before hooks, without reviving an exited agent", () => {
  const cursor = { state: "live", agent: "sh", status: null, foreground: {
    name: "node", argv: ["/tools/cursor-agent", "--use-system-ca", "/tools/cursor-agent/versions/current/index.js", "--model", "auto"], pid: 123,
  } };
  for (const identify of [kindOf, cliOf]) {
    expect(identify(cursor)).toBe("cursor");
    expect(identify({ ...cursor, foreground: { name: "zsh", argv: ["zsh"] }, argv: ["cursor-agent"] })).toBeNull();
    expect(identify({ foreground: { name: "node", argv: ["node", "server.js", "cursor-agent"] } })).toBeNull();
    expect(identify({ foreground: { name: "sh", argv: ["sh", "-c", "cursor-agent"] } })).toBeNull();
    expect(identify({ ...cursor, status: { app: "codex", state: "idle" } })).toBe("codex");
  }
});

const cursorUser = (text, off = 100) => ({ kind: "J", off, data: JSON.stringify({ role: "user", message: { content: [{ type: "text", text }] } }) });
const stamp = "Wednesday, Nov 11, 2026, 7:19 PM (UTC+5:30)";

test("Cursor envelopes show the user's words, suppress empty wakes, and retain literal examples", () => {
  const c = new Conversation("cursor");
  c.feed([cursorUser(`<timestamp>${stamp}</timestamp>\n<user_query>Explain login methods</user_query>`),
    cursorUser(`<timestamp>${stamp}</timestamp>\n<user_query>\n</user_query>`, 200)]);
  const users = c.items.filter((x) => x.kind === "user");
  expect(users).toHaveLength(1);
  expect(users[0]).toMatchObject({ text: "Explain login methods", at: Date.parse("2026-11-11T13:49:00Z"), cursorOffset: 100 });
  const example = "Show this literally:\n```xml\n<timestamp>example</timestamp>\n<user_query>example</user_query>\n```";
  c.feed([cursorUser(`<timestamp>${stamp}</timestamp>\n<user_query>${example}</user_query>`, 300)]);
  expect(c.items.at(-1).text).toBe(example);
  const claude = new Conversation("claude");
  claude.feed([{ kind: "J", off: 1, data: JSON.stringify({ type: "user", message: { content: `<timestamp>${stamp}</timestamp>\n<user_query>Example</user_query>` } }) }]);
  expect(claude.items[0].text).toContain("<timestamp>");
});

test("Cursor delivery uses newly appended records, including messages in the same minute", () => {
  const c = new Conversation("cursor");
  const text = `<timestamp>${stamp}</timestamp>\n<user_query>Continue</user_query>`;
  c.feed([cursorUser(text, 10), cursorUser(text, 150)]);
  const send = { at: Date.parse("2026-11-11T13:49:55Z"), cursorAfter: 100 };
  const users = c.items.filter((x) => x.kind === "user");
  expect(afterSend(users[0], send)).toBe(false);
  expect(afterSend(users[1], send)).toBe(true);
  c.feed([cursorUser("Continue", 250)]);
  expect(afterSend(c.items.at(-1), send)).toBe(true);
  expect(afterSend({ at: send.at - 60_000 }, send)).toBe(false);
});

test("Cursor unwraps internal task news before filtering it", () => {
  const c = new Conversation("cursor");
  c.feed([cursorUser(`<timestamp>${stamp}</timestamp>\n<user_query><herdr-news task="TASK-1" event="done">Done</herdr-news></user_query>`)]);
  expect(c.items.some((x) => x.kind === "user" && /timestamp|user_query/.test(x.text))).toBe(false);
});

test("Cursor discovery checks the parent first without resolving network names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-discovery-"));
  try {
    const bin = join(dir, "bin"), logs = join(dir, ".cursor/projects/project/agent-transcripts", sid);
    mkdirSync(bin); mkdirSync(logs, { recursive: true });
    const path = join(logs, `${sid}.jsonl`); writeFileSync(path, "");
    const marker = join(dir, "children-scanned");
    writeFileSync(join(bin, "pgrep"), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
    writeFileSync(join(bin, "lsof"), `#!/bin/sh\n[ "$1" = "-nP" ] || exit 1\nprintf '%s\\n' 'n${dir}/.cursor/chats/project/${sid}/store.db'\n`, { mode: 0o755 });
    const p = Bun.spawn(["sh", "-c", FIND, "find", "cursor", "99999999"], { env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe" });
    expect((await new Response(p.stdout).text()).trim()).toBe(path);
    expect(await p.exited).toBe(0);
    expect(await Bun.file(marker).exists()).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Cursor discovery retries a startup with no database instead of reporting a missing conversation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-start-"));
  try {
    const bin = join(dir, "bin"); mkdirSync(bin);
    for (const cmd of ["pgrep", "lsof"]) writeFileSync(join(bin, cmd), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const p = Bun.spawn(["sh", "-c", FIND, "find", "cursor", "99999999"], { env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe" });
    expect((await new Response(p.stdout).text()).trim()).toBe("pending");
    expect(await p.exited).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("desktop Cursor delivery clears the pending bubble only after a new matching record", () => {
  const source = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
  const method = source.match(/\n  settlePending\(\) \{\n[\s\S]*?\n  \}/)[0];
  const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const settle = new Function("afterSend", "norm", "same", "ownWords", "receipt", `return ({${method}}).settlePending`)(afterSend, norm, (a, b) => norm(a) === norm(b), () => [], receipt);
  const conv = new Conversation("cursor"), text = `<timestamp>${stamp}</timestamp>\n<user_query>Continue</user_query>`;
  const self = { conv, saveDraft: async () => {}, pending: [{ sent: "Continue", match: "Continue", cursorAfter: 100, at: Date.parse("2026-11-11T13:49:55Z") }] };
  conv.feed([cursorUser(text, 10)]);
  settle.call(self);
  expect(self.pending).toHaveLength(1);
  conv.feed([cursorUser(text, 150)]);
  settle.call(self);
  expect(self.pending).toHaveLength(0);
});

test("a stalled Cursor file lookup is bounded and can recover through a child process", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-stalled-"));
  try {
    const bin = join(dir, "bin"), logs = join(dir, ".cursor/projects/project/agent-transcripts", sid);
    mkdirSync(bin); mkdirSync(logs, { recursive: true });
    const path = join(logs, `${sid}.jsonl`); writeFileSync(path, "");
    writeFileSync(join(bin, "pgrep"), '#!/bin/sh\n[ "$2" = "99999999" ] && echo 99999998\n', { mode: 0o755 });
    writeFileSync(join(bin, "lsof"), `#!/bin/sh\n[ "$3" = "99999999" ] && exec sleep 60\nprintf '%s\\n' 'n${dir}/.cursor/chats/project/${sid}/store.db'\n`, { mode: 0o755 });
    const start = Date.now();
    const p = Bun.spawn(["sh", "-c", FIND, "find", "cursor", "99999999"], { env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe" });
    expect((await new Response(p.stdout).text()).trim()).toBe(path);
    expect(await p.exited).toBe(0);
    expect(Date.now() - start).toBeLessThan(5000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 7000);


test("a Cursor chat recovers from missing-log state while its first transcript is still pending", async () => {
  const source = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
  const method = source.match(/\n  async locate\(cx\) \{\n[\s\S]*?\n  \}/)[0];
  const terminal = { state: "live", status: { app: "cursor-agent", state: "idle" }, foreground: { pid: 999 }, labels: {} };
  const locate = new Function("hc", "cliOf", "exec", "starting", "Conversation", "FIND", `return ({${method}}).locate`)(
    async () => ({ stdout: JSON.stringify(terminal) }), cliOf, async () => ({ stdout: "pending\n" }), () => false, Conversation, FIND);
  const self = { addr: "fixture", thread: true, phase: "none", dfltFor: "cursor|999", loadFirst() {}, set(phase) { this.phase = phase; } };
  await locate.call(self, {});
  expect(self.phase).toBe("ready");
  expect(self.conv.kind).toBe("cursor");
});


test("Cursor tailing survives replacement of the previous turn's completion marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-rewrite-"));
  try {
    const file = join(dir, "log.jsonl"), end = '{"type":"turn_ended","status":"success"}\n';
    const old = cursorUser(`<timestamp>${stamp}</timestamp>\n<user_query>Continue 🌞</user_query>`).data + "\n";
    const read = async (mode, offset) => {
      const p = Bun.spawn(["sh", "-c", LOG, "log", mode, file, String(offset), "30"], { stdout: "pipe" });
      const r = records(await new Response(p.stdout).text());
      expect(await p.exited).toBe(0);
      return r;
    };
    writeFileSync(file, old + end);
    const first = await read("page", 999999999999999);
    const boundary = Number(first.head[2]);
    expect(boundary).toBe(Buffer.byteLength(old));
    const c = new Conversation("cursor"); c.feed(first.records);
    const pending = { text: "Continue 🌞", at: Date.parse("2026-11-11T13:49:55Z"), cursorAfter: boundary, prior: c.items.map((m) => m.id) };
    expect(receipt(c.items, pending)).toBeNull();
    expect((await read("tail", boundary)).records).toHaveLength(0);
    writeFileSync(file, old + '{"role":"user"');
    const partial = await read("tail", boundary);
    expect(partial.records).toHaveLength(0);
    expect(Number(partial.head[3])).toBe(boundary);
    writeFileSync(file, old + cursorUser(`<timestamp>${stamp}</timestamp>\n<user_query>Continue 🌞</user_query>`).data + "\n" + end);
    const next = await read("tail", boundary); c.feed(next.records);
    expect(c.items.filter((m) => m.kind === "user")).toHaveLength(2);
    expect(receipt(c.items, pending)?.cursorOffset).toBe(boundary);
    expect(Number(next.head[3])).toBe(Buffer.byteLength(readFileSync(file)) - Buffer.byteLength(end));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Cursor receipts recover saved boundaries that included the replaced completion marker", () => {
  const c = new Conversation("cursor"), at = Date.parse("2026-11-11T13:49:55Z");
  c.feed([cursorUser(`<timestamp>${stamp}</timestamp>\n<user_query>Continue</user_query>`, 100)]);
  const pending = { text: "Continue", at, cursorAfter: 141 };
  expect(receipt(c.items, pending)?.id).toBe("u100");
  expect(receipt(c.items, { ...pending, prior: ["u100"] })).toBeNull();
  expect(receipt(c.items, { ...pending, at: at + 60000 })).toBeNull();
  expect(receipt(c.items, { ...pending, cursorAfter: 142 })).toBeNull();
});

test("Cursor image envelopes confirm the full sent message and keep previews after confirmation", () => {
  const c = new Conversation("cursor"), at = Date.parse("2026-11-11T13:49:55Z");
  const wrapper = (text) => `[Image]\n<image_files>\nThe following images were provided by the user and saved to disk for future use:\n1. /saved/asset.jpg\n\nThese files can be read with tools.\n</image_files>\n<timestamp>${stamp}</timestamp>\n<user_query>${text}</user_query>`;
  const sent = "Explain this\n\n/saved/pasted.png";
  c.feed([cursorUser(wrapper(sent), 100)]);
  expect(c.items[0]).toMatchObject({ text: sent, paths: ["/saved/asset.jpg"], images: 1, at: Date.parse("2026-11-11T13:49:00Z") });
  expect(receipt(c.items, { text: "Explain this", sent, at, cursorAfter: 100 })?.id).toBe("u100");
  c.feed([cursorUser(wrapper("/saved/pasted.png"), 500)]);
  expect(receipt(c.items, { text: "", sent: "/saved/pasted.png", at, cursorAfter: 500 })?.id).toBe("u500");
  expect(receipt(c.items, { text: "", sent: "/saved/different.png", at, cursorAfter: 500 })).toBeNull();
  expect(receipt(c.items, { text: "", at, cursorAfter: 500 })).toBeNull();
  expect(receipt([{ kind: "user", id: "other-image", text: "", images: 1, at }], { text: "", sent: "/saved/pasted.png", at })).toBeNull();
});

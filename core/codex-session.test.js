import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIND } from "./chat-log.js";
import { ChatReader } from "./chat-reader.js";
import { cliOf } from "./screens.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "codex-session-"));
  const bin = join(dir, "bin"); mkdirSync(bin);
  const logs = [];
  const log = (source, text = "Main conversation") => {
    const path = join(dir, `rollout-test-${logs.length}.jsonl`);
    writeFileSync(path, [
      { type: "session_meta", payload: { source } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n");
    logs.push(path); return path;
  };
  const opened = (paths) => writeFileSync(join(bin, "lsof"), `#!/bin/sh\nprintf '%s\\n' ${paths.map((p) => `'n${p}'`).join(" ")}\n`, { mode: 0o755 });
  writeFileSync(join(bin, "pgrep"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const sh = async (script, args) => {
    const p = Bun.spawn(["sh", "-c", script, ...args], { env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    return { code: 0, stdout };
  };
  return { dir, bin, log, opened, sh, find: async () => (await sh(FIND, ["chat", "codex", "99999999"])).stdout.trim(), close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("reopening Chat while Codex reviews an approval keeps the main conversation", async () => {
  const f = fixture();
  try {
    const main = f.log("cli"), review = f.log({ subagent: { other: "guardian" } }, '{"outcome":"allow"}');
    const terminal = { status: { app: "codex", state: "working" }, foreground: { pid: 99999999 } };
    for (const paths of [[main, review], [review, main]]) {
      f.opened(paths);
      const reader = new ChatReader({ sh: f.sh }, "t1");
      await reader.locate(terminal); await reader.pull();
      expect(reader.path).toBe(main);
      expect(reader.conv.items.filter((x) => x.kind === "agent").map((x) => x.text)).toEqual(["Main conversation"]);
    }
  } finally { f.close(); }
});

test("Codex discovery skips internal workers and incomplete metadata without guessing by file order", async () => {
  const f = fixture();
  try {
    const helper = f.log({ subagent: { thread_spawn: { parent_thread_id: "parent" } } });
    const partial = f.log("cli"); writeFileSync(partial, '{"type":"session_meta"');
    const main = f.log("cli");
    f.opened([helper, partial, main]);
    expect(await f.find()).toBe(main);
  } finally { f.close(); }
});

test("a lone approval reviewer is never substituted for a main session still starting", async () => {
  const f = fixture();
  try {
    f.opened([f.log({ subagent: { other: "guardian" } })]);
    expect(await f.find()).toBe("pending");
  } finally { f.close(); }
});

test("Codex discovers the main session in a CLI wrapper's child process", async () => {
  const f = fixture();
  try {
    const review = f.log({ subagent: { other: "guardian" } }), main = f.log("cli");
    writeFileSync(join(f.bin, "pgrep"), '#!/bin/sh\n[ "$2" = "99999999" ] && echo 99999998\n', { mode: 0o755 });
    writeFileSync(join(f.bin, "lsof"), `#!/bin/sh\ncase "$*" in *99999999*) printf '%s\\n' 'n${review}';; *) printf '%s\\n' 'n${main}';; esac\n`, { mode: 0o755 });
    expect(await f.find()).toBe(main);
  } finally { f.close(); }
});

test("older Codex session metadata without a source remains readable", async () => {
  const f = fixture();
  try {
    const main = f.log(undefined); f.opened([main]);
    expect(await f.find()).toBe(main);
  } finally { f.close(); }
});

test("desktop view switches never replace or clear the main chat while the approval log changes", async () => {
  const f = fixture();
  try {
    const main = f.log("cli"), review = f.log({ subagent: { other: "guardian" } });
    const terminal = { state: "live", keep: true, labels: { "herdr.chat": "fixture" }, status: { app: "codex", state: "working" }, foreground: { pid: 99999999 } };
    const source = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
    const method = source.match(/\n  async locate\(cx\) \{\n[\s\S]*?\n  \}/)[0];
    const locate = new Function("hc", "cliOf", "exec", "FIND", `return ({${method}}).locate`)(
      async () => ({ stdout: JSON.stringify(terminal) }), cliOf, (_cmd, args) => f.sh(args[1], args.slice(2)), FIND);
    let resets = 0;
    const chat = { addr: "t1", phase: "ready", dfltFor: "codex|99999999", loadFirst() {}, reset() { resets++; } };
    for (const paths of [[main, review], [review, main], [review], [main]]) {
      f.opened(paths);
      await locate.call(chat, {});
      expect(chat.path).toBe(main);
      expect(chat.kind).toBe("codex");
      expect(resets).toBe(1);
    }
  } finally { f.close(); }
});

test("Claude's process session file still identifies its exact conversation", async () => {
  const f = fixture();
  try {
    const sessions = join(f.dir, ".claude/sessions"), project = join(f.dir, ".claude/projects/project");
    mkdirSync(sessions, { recursive: true }); mkdirSync(project, { recursive: true });
    writeFileSync(join(sessions, "99999999.json"), JSON.stringify({ sessionId: "1234-abcd" }));
    const path = join(project, "1234-abcd.jsonl"); writeFileSync(path, "");
    expect((await f.sh(FIND, ["chat", "claude", "99999999"])).stdout.trim()).toBe(path);
  } finally { f.close(); }
});

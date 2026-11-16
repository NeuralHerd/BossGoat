import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { voiceProvider } from "./voice-provider.js";

const source = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
const method = source.match(/\n  async runCall\(cx\) \{\n[\s\S]*?\n  \}/)?.[0];
if (!method) throw new Error("Missing desktop voice launch method");

function setup(file) {
  const commands = [];
  let secretReads = 0, followed = 0;
  const prototype = new Function("appHome", "exec", "secrets", "readTextFile", "dirsReady", "voiceProvider", "CallScreen", "agent", "BUN_PATH",
    `return {${method}}`)(() => "/app", async (...args) => { commands.push(args); return { stdout: "" }; },
      { entries: async () => { secretReads++; return []; } }, async () => file, async () => ({ settings: "/settings.json" }),
      voiceProvider, class {}, { NAMES: {} }, "");
  const chat = Object.assign(Object.create(prototype), { callDir: "/call", addr: "test", call: {}, callHelp: true,
    callShared() {}, callRecent() {}, followCall() { followed++; } });
  return { chat, commands, secretReads: () => secretReads, followed: () => followed };
}

test.each(["codex", "claude", "cursor"])("the desktop call button launches %s without requiring or reading ElevenLabs credentials", async (provider) => {
  const s = setup(JSON.stringify({ everywhere: { voice: { provider } } }));
  await s.chat.runCall({ notify() {} });
  expect(s.secretReads()).toBe(0);
  expect(s.commands.some(([, args]) => args.includes("/app/secrets/elevenlabs.env"))).toBe(false);
  expect(s.commands.some(([, args]) => args.includes("/app/mods/chat/voice.ts"))).toBe(true);
  expect(s.followed()).toBe(1);
  expect(s.chat.callHelp).toBe(false);
});

test("existing ElevenLabs users still get setup help before a call when their key is missing", async () => {
  const s = setup("{}");
  await s.chat.runCall({ notify() {} });
  expect(s.secretReads()).toBe(1);
  expect(s.followed()).toBe(0);
  expect(s.chat.call).toBeNull();
  expect(s.chat.callHelp).toBe(true);
});

test("unreadable provider settings reach the voice helper's settings error instead of ElevenLabs setup help", async () => {
  const s = setup("broken JSON");
  await s.chat.runCall({ notify() {} });
  expect(s.secretReads()).toBe(0);
  expect(s.followed()).toBe(1);
});

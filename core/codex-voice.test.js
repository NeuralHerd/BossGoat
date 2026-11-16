import { expect, test } from "bun:test";
import { CodexVoiceSocket, pcm16k, codexVoiceConfig } from "../lib/codex-voice.js";
import { TOOLS, hangUpGuard } from "./voice.js";
import { voiceProvider } from "./voice-provider.js";

class Call extends CodexVoiceSocket {
  sent = [];
  events = [];
  async open() {}
  write(m) { this.sent.push(m); }
  constructor() {
    super(TOOLS); this.readyState = 1; this.threadId = "call";
    this.onmessage = (e) => this.events.push(JSON.parse(e.data));
  }
}

test("Codex is an explicit choice; existing ElevenLabs setups retain their provider", () => {
  expect(voiceProvider({})).toBe("elevenlabs");
  expect(voiceProvider({ everywhere: { voice: { provider: "codex" } } })).toBe("codex");
  expect(voiceProvider({ spaces: { x: { voice: { provider: "codex" } } } })).toBe("elevenlabs");
});

test("stereo WebRTC speech becomes mono at BossGoat's playback rate without changing duration", () => {
  const input = new Int16Array(480 * 2).fill(600);
  for (let i = 1; i < input.length; i += 2) input[i] = -200;
  const output = pcm16k(input, 48000, 2);
  expect(output.length).toBe(160);
  expect([...output].every((x) => x === 200)).toBe(true);
  expect(() => pcm16k(input, 0)).toThrow();
});

test("the voice backend cannot inherit MCP connections or command execution", () => {
  const cfg = codexVoiceConfig();
  expect(cfg.mcp_servers).toEqual({});
  expect(cfg["features.shell_tool"]).toBe(false);
  expect(cfg["features.code_mode"]).toBe(false);
  expect(cfg["features.plugins"]).toBe(false);
  expect(cfg.web_search).toBe("disabled");
});

test("Codex's transcript events retain the existing explicit hang-up confirmation", async () => {
  const c = new Call(), guard = hangUpGuard();
  await c.receive({ method: "thread/realtime/transcript/done", params: { threadId: "call", role: "assistant", text: "Are you sure you want to end the call?" } });
  await c.receive({ method: "thread/realtime/transcript/delta", params: { threadId: "call", role: "user", delta: "Yes" } });
  await c.receive({ method: "thread/realtime/transcript/done", params: { threadId: "call", role: "user", text: "Yes" } });
  for (const m of c.events) guard.seen(m.type, m.agent_response_event?.agent_response);
  expect(c.events.filter((m) => m.type === "user_transcript").length).toBe(1);
  expect(c.events.some((m) => m.type === "interruption")).toBe(true);
  expect(guard.may()).toBe(true);
  c.close();
});

test("only this call's declared BossGoat tools can reach the existing action guards", async () => {
  const c = new Call();
  await c.receive({ id: 1, method: "item/tool/call", params: { threadId: "other", callId: "wrong", tool: "act", arguments: { what: "delete" } } });
  await c.receive({ id: 2, method: "item/commandExecution/requestApproval", params: {} });
  await c.receive({ id: 3, method: "item/tool/call", params: { threadId: "call", callId: "unknown", tool: "exec", arguments: {} } });
  expect(c.events).toEqual([]);
  expect(c.sent.every((m) => m.error)).toBe(true);
  await c.receive({ id: 4, method: "item/tool/call", params: { threadId: "call", callId: "act", tool: "act", arguments: { what: "delete", confirmed: false } } });
  expect(c.events[0].client_tool_call.parameters.confirmed).toBe(false);
  c.send(JSON.stringify({ type: "client_tool_result", tool_call_id: "act", result: "Ask first", is_error: true }));
  expect(c.sent.at(-1)).toEqual({ id: 4, result: { contentItems: [{ type: "inputText", text: "Ask first" }], success: false } });
  expect(c.toolRequests.size).toBe(0);
  c.close();
});

test("ending during startup rejects outstanding work and drops queued microphone audio", async () => {
  const c = new Call();
  const pending = c.rpc("thread/start", {});
  c.send(JSON.stringify({ user_audio_chunk: Buffer.alloc(320).toString("base64") }));
  expect(c.input.length).toBe(320);
  c.close();
  await expect(pending).rejects.toThrow("ended");
  expect(c.input.length).toBe(0);
  expect(c.pending.size).toBe(0);
  c.send(JSON.stringify({ user_audio_chunk: "AAAA" }));
  expect(c.input.length).toBe(0);
});

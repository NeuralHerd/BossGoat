import { expect, test } from "bun:test";
import { speechSegments, voiceReply } from "./local-voice.js";
import { TOOLS } from "./voice.js";
import { voiceProvider } from "./voice-provider.js";
import { LocalVoiceSocket } from "../lib/local-voice.js";
import { agentCommand, agentEnvironment, VOICE_PERMISSIONS, subscriptionSignIn } from "../lib/local-agent.js";
import { pcmWave, wavePcm } from "../lib/local-speech.js";

function sound(ms, level = 2000) {
  const pcm = Buffer.alloc(ms * 32);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 4 ? level : -level, i);
  return pcm;
}
const waitFor = async (fn) => { for (let i = 0; !fn() && i < 100; i++) await Bun.sleep(10); expect(fn()).toBeTruthy(); };

test("silence and brief clicks do not become prompts, and real speech retains its beginning", () => {
  const gate = speechSegments();
  expect(gate.push(sound(2000, 0))).toEqual([]);
  expect(gate.push(sound(30))).toEqual([]);
  expect(gate.push(sound(1000, 0))).toEqual([]);
  const start = gate.push(sound(500));
  expect(start.map((e) => e.type)).toEqual(["start"]);
  const end = gate.push(sound(1000, 0));
  expect(end.length).toBe(1);
  expect(end[0].pcm.length).toBeGreaterThanOrEqual(1300 * 32);
  expect(gate.push(sound(2000, 0))).toEqual([]);
});

test("mute/silence cannot produce an utterance and reset discards partial audio", () => {
  const gate = speechSegments();
  gate.push(sound(300)); gate.reset();
  expect(gate.push(sound(1000, 0))).toEqual([]);
  expect(gate.push(new Uint8Array([1]))).toEqual([]);
  gate.reset();
});

test("control validation rejects fabricated tools and string confirmations before existing action guards", () => {
  expect(() => voiceReply('{"say":"","tool":{"name":"shell","arguments":{}}}', TOOLS)).toThrow();
  expect(() => voiceReply('{"say":"","tool":{"name":"act","arguments":{"action":"delete_artifact","confirmed":"true"}}}', TOOLS)).toThrow();
  expect(() => voiceReply('{"say":"","tool":{"name":"look","arguments":{}}}', TOOLS)).toThrow();
  expect(voiceReply('{"say":"Checking","tool":{"name":"look","arguments":{"what":"spaces"}}}', TOOLS).tool.name).toBe("look");
});

test("both providers retain normal CLI sign-in, exclude API-key overrides, and restrict direct agent tools", () => {
  const env = agentEnvironment({ HOME: "/test", ANTHROPIC_API_KEY: "private", CURSOR_API_KEY: "private", CLAUDE_CODE_SIMPLE: "1" });
  expect(env).toEqual({ HOME: "/test" });
  const claude = agentCommand("claude"), cursor = agentCommand("cursor");
  expect(claude).not.toContain("--bare");
  expect(claude[claude.indexOf("--tools") + 1]).toBe("");
  expect(claude).toContain("--strict-mcp-config");
  expect(cursor[cursor.indexOf("--mode") + 1]).toBe("ask");
  expect(VOICE_PERMISSIONS.deny).toContain("Shell(*)");
  expect(VOICE_PERMISSIONS.deny).toContain("Mcp(*:*)");
  for (const provider of ["claude", "cursor", "codex"]) expect(voiceProvider({ everywhere: { voice: { provider } } })).toBe(provider);
});

test("local speech audio round trips without changing duration or accepting a mismatched format", () => {
  const pcm = sound(200);
  expect(wavePcm(pcmWave(pcm))).toEqual(pcm);
  const wav = pcmWave(pcm); wav.writeUInt32LE(48000, 24);
  expect(() => wavePcm(wav)).toThrow();
});

function call(provider, reply) {
  const events = [], prompts = [];
  let stopped = false;
  const speech = { async ready() {}, async transcribe() { return "What spaces are available?"; }, async speak() { return sound(10); }, close() { stopped = true; } };
  const agent = { async reply(p) { prompts.push(p); return await reply(prompts.length); }, close() {} };
  const c = new LocalVoiceSocket(provider, TOOLS, { speechSegments, voiceReply }, { speech, agent });
  c.onopen = () => c.send(JSON.stringify({ type: "conversation_initiation_client_data", conversation_config_override: { agent: { prompt: { prompt: "Use BossGoat controls." } } } }));
  c.onmessage = ({ data }) => {
    const m = JSON.parse(data); events.push(m);
    if (m.type === "client_tool_call") c.send(JSON.stringify({ type: "client_tool_result", tool_call_id: m.client_tool_call.tool_call_id, result: "Voice test is the only space." }));
  };
  return { c, events, prompts, stopped: () => stopped };
}
function feed(c) {
  for (const pcm of [sound(500), sound(900, 0)]) {
    for (let i = 0; i < pcm.length; i += 3200) c.send(JSON.stringify({ user_audio_chunk: pcm.subarray(i, i + 3200).toString("base64") }));
  }
}

test.each(["claude", "cursor"])("%s uses recognized speech, the existing BossGoat control handler, and local spoken output", async (provider) => {
  const s = call(provider, (n) => n === 1 ? '{"say":"","tool":{"name":"look","arguments":{"what":"spaces"}}}' : '{"say":"Voice test is available.","tool":null}');
  try {
    await waitFor(() => s.c.started); feed(s.c);
    await waitFor(() => s.events.some((e) => e.type === "audio"));
    expect(s.events.some((e) => e.type === "user_transcript")).toBe(true);
    expect(s.prompts[1]).toContain("Voice test is the only space.");
    expect(s.events.filter((e) => e.type === "client_tool_call").length).toBe(1);
  } finally { s.c.close(); }
  expect(s.stopped()).toBe(true);
  expect(s.c.pending.size).toBe(0);
});

test("ending while an agent answers prevents later speech and controls", async () => {
  let resolve;
  const reply = new Promise((done) => { resolve = done; });
  const s = call("claude", () => reply);
  await waitFor(() => s.c.started); feed(s.c);
  await waitFor(() => s.prompts.length > 0);
  s.c.close(); resolve('{"say":"Late","tool":{"name":"look","arguments":{"what":"spaces"}}}');
  await Bun.sleep(20);
  expect(s.events.some((e) => ["audio", "client_tool_call"].includes(e.type))).toBe(false);
});

test("talking over an unfinished answer discards its controls and answers the new utterance", async () => {
  let resolve;
  const old = new Promise((done) => { resolve = done; });
  const s = call("cursor", (n) => n === 1 ? old : '{"say":"New answer","tool":null}');
  await waitFor(() => s.c.started); feed(s.c);
  await waitFor(() => s.prompts.length === 1);
  feed(s.c);
  resolve('{"say":"Old answer","tool":{"name":"look","arguments":{"what":"spaces"}}}');
  try {
    await waitFor(() => s.events.some((e) => e.agent_response_event?.agent_response === "New answer"));
    expect(s.events.some((e) => e.type === "client_tool_call")).toBe(false);
    expect(s.events.some((e) => e.agent_response_event?.agent_response === "Old answer")).toBe(false);
  } finally { s.c.close(); }
});


test("subscription sign-in is required instead of silently charging a configured API account", () => {
  expect(subscriptionSignIn("claude", { loggedIn: true, authMethod: "api_key" })).toBe(false);
  expect(subscriptionSignIn("claude", { loggedIn: true, authMethod: "claude.ai" })).toBe(true);
  expect(subscriptionSignIn("cursor", { isAuthenticated: true, hasAccessToken: false })).toBe(false);
  expect(subscriptionSignIn("cursor", { isAuthenticated: true, hasAccessToken: true, hasRefreshToken: true })).toBe(true);
});


test("muting a browser mid-utterance discards audio rather than sending it on unmute", async () => {
  const s = call("cursor", () => '{"say":"Ready","tool":null}');
  try {
    await waitFor(() => s.c.started);
    s.c.send(JSON.stringify({ user_audio_chunk: sound(300).toString("base64") }));
    expect(s.c.hearing).toBe(true);
    s.c.lastInput = Date.now() - 2000;
    s.c.idleInput();
    expect(s.c.hearing).toBe(false);
    s.c.send(JSON.stringify({ user_audio_chunk: sound(900, 0).toString("base64") }));
    expect(s.prompts.length).toBe(0);
    feed(s.c);
    await waitFor(() => s.events.some((e) => e.type === "audio"));
    expect(s.prompts.length).toBe(1);
  } finally { s.c.close(); }
});

// Adapts Codex's experimental WebRTC calls to the voice messages both BossGoat clients already handle.
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

export function pcm16k(samples, rate, channels = 1) {
  if (!Number.isFinite(rate) || rate < 16000 || !Number.isInteger(channels) || channels < 1) throw new Error("Unsupported Codex audio format.");
  const frames = Math.floor(samples.length / channels), ratio = rate / 16000;
  const out = new Int16Array(Math.floor(frames / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(frames, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let f = start; f < end; f++) for (let ch = 0; ch < channels; ch++) sum += samples[f * channels + ch];
    out[i] = Math.round(sum / ((end - start) * channels));
  }
  return out;
}

export function codexVoiceConfig() {
  return {
    mcp_servers: {}, web_search: "disabled",
    "features.shell_tool": false, "features.code_mode": false, "features.js_repl": false,
    "features.apps": false, "features.plugins": false, "features.connectors": false,
    "features.browser_use": false, "features.computer_use": false, "features.multi_agent": false,
    "features.memory_tool": false, "features.hooks": false,
  };
}

function rtcModule() {
  const require = createRequire(import.meta.url);
  try { return require("@roamhq/wrtc"); } catch {}
  // A window mod is installed away from the service's dependencies.
  try { return createRequire(join(homedir(), ".local/share/shepherdr/package.json"))("@roamhq/wrtc"); }
  catch { throw new Error("Codex voice needs WebRTC audio support. Run bossgoat update on this machine."); }
}

export class CodexVoiceSocket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  pending = new Map();
  toolRequests = new Map();
  seq = 0;
  threadId = null;
  pc = null;
  sink = null;
  track = null;
  proc = null;
  audioTimer = null;
  connectTimer = null;
  input = Buffer.alloc(0);
  heardUser = false;
  lastSound = 0;
  started = false;

  constructor(tools) { this.tools = tools; queueMicrotask(() => this.open().catch((e) => this.fail(e))); }
  emit(m) { if (this.readyState !== 3) this.onmessage?.({ data: JSON.stringify(m) }); }
  write(m) { this.proc?.stdin.write(JSON.stringify(m) + "\n"); }
  rpc(method, params) {
    if (this.readyState === 3) return Promise.reject(new Error("The call ended."));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex voice timed out (${method}).`)); }, 25000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  async open() {
    if (this.readyState === 3) return;
    this.rtc = rtcModule();
    if (!Bun.which("codex")) throw new Error("Install Codex and sign in with ChatGPT on this machine to use Codex voice.");
    const env = { ...process.env };
    delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
    this.proc = Bun.spawn(["codex", "app-server", "--stdio", "-c", "mcp_servers={}"], { env, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    void this.read().catch((e) => this.fail(e));
    void this.proc.exited.then(() => { if (this.readyState !== 3) this.fail(new Error("Codex stopped during the voice call.")); });
    await this.rpc("initialize", { clientInfo: { name: "bossgoat_voice", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    this.write({ method: "initialized", params: {} });
    const { account } = await this.rpc("account/read", { refreshToken: false });
    if (account?.type !== "chatgpt") throw new Error("Codex voice needs ChatGPT sign-in. Run codex login on this machine; API-key sign-in is not used.");
    if (this.readyState === 3) return;
    this.readyState = 1;
    this.onopen?.({});
  }
  async read() {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of this.proc.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      if (buf.length > 4 * 1024 * 1024) throw new Error("Codex returned an oversized voice message.");
      let end;
      while ((end = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, end); buf = buf.slice(end + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        await this.receive(m);
      }
    }
  }
  async receive(m) {
    if (this.readyState === 3) return;
    if (m.id != null && !m.method) {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer); this.pending.delete(m.id);
      if (m.error) p.reject(new Error(String(m.error.message ?? "Codex rejected the voice request."))); else p.resolve(m.result);
      return;
    }
    const p = m.params ?? {};
    if (m.id != null) {
      if (m.method !== "item/tool/call" || p.threadId !== this.threadId || !this.tools.some((t) => t.name === p.tool)) {
        this.write({ id: m.id, error: { code: -32601, message: "This voice call only allows BossGoat's voice controls." } });
        return;
      }
      const timer = setTimeout(() => this.toolResult(p.callId, "The voice control timed out.", true), 30000);
      this.toolRequests.set(p.callId, { id: m.id, timer });
      this.emit({ type: "client_tool_call", client_tool_call: { tool_call_id: p.callId, tool_name: p.tool, parameters: p.arguments } });
      return;
    }
    if (p.threadId && p.threadId !== this.threadId) return;
    if (m.method === "thread/realtime/error") this.fail(new Error(p.message));
    else if (m.method === "thread/realtime/closed") this.close(1000, "Codex ended the voice session.");
    else if (m.method === "thread/realtime/sdp") await this.pc.setRemoteDescription({ type: "answer", sdp: p.sdp });
    else if (m.method === "thread/realtime/transcript/delta" && p.role === "user" && !this.heardUser) {
      this.heardUser = true;
      this.emit({ type: "interruption" });
      this.emit({ type: "user_transcript", user_transcription_event: { user_transcript: p.delta } });
    } else if (m.method === "thread/realtime/transcript/done") {
      if (p.role === "user") {
        if (!this.heardUser) this.emit({ type: "user_transcript", user_transcription_event: { user_transcript: p.text } });
        this.heardUser = false;
      } else if (p.role === "assistant") this.emit({ type: "agent_response", agent_response_event: { agent_response: p.text } });
    }
  }
  async begin(instructions) {
    if (this.started) return;
    this.started = true;
    const r = await this.rpc("thread/start", { ephemeral: true, sandbox: "read-only", approvalPolicy: "on-request",
      selectedCapabilityRoots: [], config: codexVoiceConfig(),
      baseInstructions: instructions + "\nOnly use the provided BossGoat voice controls. Do not execute commands or edit files yourself. Pass coding work to the existing Assistant with send.",
      dynamicTools: this.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
    });
    if (this.readyState === 3) return;
    this.threadId = r.thread.id;
    const { RTCPeerConnection, nonstandard } = this.rtc;
    this.pc = new RTCPeerConnection();
    const source = new nonstandard.RTCAudioSource();
    this.track = source.createTrack();
    this.pc.addTrack(this.track);
    const dc = this.pc.createDataChannel("oai-events");
    dc.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === "error") this.fail(new Error(m.error?.message ?? m.message ?? m.code ?? "Codex voice failed."));
    };
    this.pc.ontrack = ({ track }) => {
      this.sink = new nonstandard.RTCAudioSink(track);
      this.sink.ondata = ({ samples, sampleRate, channelCount }) => {
        if (this.readyState === 3) return;
        const pcm = pcm16k(samples, sampleRate, channelCount);
        if (pcm.some((s) => Math.abs(s) > 40)) this.lastSound = Date.now();
        if (Date.now() - this.lastSound < 200) this.emit({ type: "audio", audio_event: { audio_base_64: Buffer.from(pcm.buffer).toString("base64") } });
      };
    };
    this.connectTimer = setTimeout(() => this.fail(new Error("Codex voice could not establish its audio connection.")), 30000);
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed") return this.fail(new Error("Codex voice lost its audio connection."));
      if (this.pc.connectionState !== "connected" || this.audioTimer) return;
      clearTimeout(this.connectTimer);
      this.emit({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000" } });
      this.audioTimer = setInterval(() => {
        const frame = Buffer.alloc(320);
        if (this.input.length >= 320) { this.input.copy(frame, 0, 0, 320); this.input = this.input.subarray(320); }
        source.onData({ samples: new Int16Array(frame.buffer, frame.byteOffset, 160), sampleRate: 16000, channelCount: 1, numberOfFrames: 160 });
      }, 10);
    };
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.rpc("thread/realtime/start", { threadId: this.threadId, outputModality: "audio", version: "v3",
      includeStartupContext: false, prompt: instructions, transport: { type: "webrtc", sdp: this.pc.localDescription.sdp } });
  }
  toolResult(id, text, failed) {
    const p = this.toolRequests.get(id);
    if (!p) return;
    clearTimeout(p.timer); this.toolRequests.delete(id);
    this.write({ id: p.id, result: { contentItems: [{ type: "inputText", text: String(text ?? "") }], success: !failed } });
  }
  send(data) {
    if (this.readyState !== 1) return;
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === "conversation_initiation_client_data") {
      void this.begin(m.conversation_config_override?.agent?.prompt?.prompt ?? "Use only BossGoat voice controls.").catch((e) => this.fail(e));
    } else if (typeof m.user_audio_chunk === "string") {
      const b = Buffer.from(m.user_audio_chunk, "base64");
      if (b.length % 2 || b.length > 32768 || this.input.length + b.length > 32768) return;
      this.input = Buffer.concat([this.input, b]);
    } else if (m.type === "client_tool_result") this.toolResult(m.tool_call_id, m.result, m.is_error);
    else if (this.threadId && (m.type === "user_message" || m.type === "contextual_update")) {
      void this.rpc("thread/realtime/appendText", { threadId: this.threadId, role: "developer", text: String(m.text) }).catch((e) => this.fail(e));
    }
  }
  fail(e) { if (this.readyState !== 3) { this.onerror?.({}); this.close(1011, String(e?.message ?? e)); } }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    clearInterval(this.audioTimer); clearTimeout(this.connectTimer);
    this.input = Buffer.alloc(0);
    this.sink?.stop(); this.track?.stop(); this.pc?.close();
    for (const p of this.toolRequests.values()) clearTimeout(p.timer);
    this.toolRequests.clear();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("The call ended.")); }
    this.pending.clear();
    if (this.threadId) this.write({ id: ++this.seq, method: "thread/realtime/stop", params: { threadId: this.threadId } });
    const proc = this.proc;
    if (proc) { try { proc.stdin.end(); } catch {} setTimeout(() => { try { proc.kill(); } catch {} }, 500); }
    this.onclose?.({ code, reason });
  }
}

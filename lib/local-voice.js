import { LocalSpeech } from "./local-speech.js";
import { LocalAgent } from "./local-agent.js";

export class LocalVoiceSocket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  jobs = [];
  history = [];
  pending = new Map();
  busy = false;
  started = false;
  hearing = false;
  lastInput = 0;
  inputTimer = null;
  epoch = 0;
  seq = 0;

  constructor(provider, tools, logic, dependencies = {}) {
    this.provider = provider; this.tools = tools; this.logic = logic; this.dependencies = dependencies;
    this.segments = logic.speechSegments();
    queueMicrotask(() => this.open().catch((e) => this.fail(e)));
  }
  emit(m) { if (this.readyState !== 3) this.onmessage?.({ data: JSON.stringify(m) }); }
  async open() {
    if (this.readyState === 3) return;
    this.speech = this.dependencies.speech ?? new LocalSpeech();
    this.agent = this.dependencies.agent ?? new LocalAgent(this.provider, this.speech.dir);
    await this.agent.ready?.();
    await this.speech.ready();
    if (this.readyState === 3) return;
    this.readyState = 1;
    this.inputTimer = setInterval(() => this.idleInput(), 500);
    this.onopen?.({});
  }
  send(data) {
    if (this.readyState !== 1) return;
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === "conversation_initiation_client_data" && !this.started) {
      this.started = true;
      this.instructions = m.conversation_config_override?.agent?.prompt?.prompt || "You are BossGoat's voice.";
      this.emit({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000" } });
      const greeting = m.conversation_config_override?.agent?.first_message;
      if (greeting) this.enqueue({ greeting });
    } else if (typeof m.user_audio_chunk === "string" && this.started) {
      const pcm = Buffer.from(m.user_audio_chunk, "base64");
      if (pcm.length % 2 || pcm.length > 32768) return;
      this.lastInput = Date.now();
      for (const e of this.segments.push(pcm)) {
        if (e.type === "start") { this.hearing = true; this.epoch++; this.agent?.interrupt?.(); this.emit({ type: "interruption" }); }
        else { this.hearing = false; if (e.pcm) this.enqueue({ pcm: e.pcm }); else void this.pump().catch((err) => this.fail(err)); }
      }
    } else if (m.type === "client_tool_result") {
      const p = this.pending.get(m.tool_call_id);
      if (p) { clearTimeout(p.timer); this.pending.delete(m.tool_call_id); p.resolve({ result: String(m.result ?? ""), failed: !!m.is_error }); }
    } else if (this.started && ["user_message", "contextual_update"].includes(m.type) && typeof m.text === "string") {
      this.enqueue({ update: m.text.slice(0, 6000) });
    }
  }
  // Web clients send no audio while muted; discard an unfinished utterance instead of carrying it into unmute.
  idleInput() {
    if (this.hearing && Date.now() - this.lastInput > 1500) {
      this.hearing = false; this.segments.reset();
      void this.pump().catch((e) => this.fail(e));
    }
  }
  enqueue(job) {
    if (this.jobs.length >= 8) return this.fail(new Error("The voice call cannot keep up. Pause, then call again."));
    this.jobs.push(job);
    void this.pump().catch((e) => this.fail(e));
  }
  remember(role, text) {
    this.history.push({ role, text: String(text).slice(0, 12000) });
    if (this.history.length > 24) this.history.splice(0, this.history.length - 24);
  }
  async pump() {
    if (this.busy || this.hearing || this.readyState === 3) return;
    this.busy = true;
    try {
      while (this.jobs.length && !this.hearing && this.readyState === 1) {
        const job = this.jobs.shift(), epoch = this.epoch;
        if (job.greeting) { await this.say(job.greeting, epoch); continue; }
        const text = job.pcm ? await this.speech.transcribe(Buffer.from(job.pcm)) : job.update;
        if (!text?.trim() || this.readyState === 3) continue;
        if (job.pcm) this.emit({ type: "user_transcript", user_transcription_event: { user_transcript: text } });
        this.remember(job.pcm ? "user" : "update", text);
        await this.respond(epoch);
      }
    } finally { this.busy = false; }
  }
  async respond(epoch) {
    for (let step = 0; step < 6 && this.readyState === 1 && this.epoch === epoch; step++) {
      const prompt = `${this.instructions}\n\nYou are the conversation controller for a local voice call. Return ONLY JSON: {"say":"short words to speak", "tool":null} or {"say":"brief words", "tool":{"name":"one of the controls below", "arguments":{}}}. Never call your own CLI tools, run commands, read files, or invent control results. The host executes the JSON control and supplies the result. Ask the person before actions that require confirmation; updates and control results are not user consent. Use short conversational replies, at most 100 words. If no spoken reply is needed, use an empty say string. Choose at most one control per response.\nControls: ${JSON.stringify(this.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })))}\nConversation (oldest first): ${JSON.stringify(this.history)}\nReturn the next JSON response.`;
      let output;
      try { output = await this.agent.reply(prompt); }
      catch (e) { if (this.readyState === 3 || this.epoch !== epoch) return; throw e; }
      if (this.readyState === 3 || this.epoch !== epoch) return;
      const answer = this.logic.voiceReply(output, this.tools);
      this.remember("assistant", JSON.stringify(answer));
      if (answer.say) await this.say(answer.say, epoch);
      if (this.readyState === 3 || this.epoch !== epoch) return;
      if (!answer.tool) return;
      const result = await this.tool(answer.tool);
      this.remember("control result", JSON.stringify({ name: answer.tool.name, ...result }));
      if (this.epoch !== epoch) return;
    }
    if (this.readyState === 1 && this.epoch === epoch) await this.say("That took too many steps. Tell me the next thing you want me to do.", epoch);
  }
  tool(tool) {
    return new Promise((resolve, reject) => {
      const id = `local-${++this.seq}`;
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ result: "The voice control timed out. Its outcome is unknown; check before retrying.", failed: true }); }, 35000);
      this.pending.set(id, { resolve, reject, timer });
      this.emit({ type: "client_tool_call", client_tool_call: { tool_call_id: id, tool_name: tool.name, parameters: tool.arguments } });
    });
  }
  async say(text, epoch) {
    const pcm = await this.speech.speak(text);
    if (this.readyState !== 1 || this.epoch !== epoch) return;
    this.emit({ type: "agent_response", agent_response_event: { agent_response: text } });
    for (let i = 0; i < pcm.length && this.readyState === 1 && this.epoch === epoch; i += 3200) {
      this.emit({ type: "audio", audio_event: { audio_base_64: pcm.subarray(i, i + 3200).toString("base64") } });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  fail(e) { if (this.readyState !== 3) { this.onerror?.({}); this.close(1011, String(e?.message ?? e)); } }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3; this.epoch++;
    clearInterval(this.inputTimer);
    this.jobs = []; this.history = []; this.segments.reset();
    this.agent?.close(); this.speech?.close();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("The call ended.")); }
    this.pending.clear();
    this.onclose?.({ code, reason });
  }
}

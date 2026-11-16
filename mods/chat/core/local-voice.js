// Incoming audio is 16 kHz mono PCM, in 10 ms frames. Keep the beginning of words before speech is detected.
export function speechSegments() {
  let tail = new Uint8Array(), before = [], frames = [], active = false, voiced = 0, quiet = 0, onset = 0;
  const join = (parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out;
  };
  return {
    push(bytes) {
      const events = [], data = join([tail, bytes]);
      let i = 0;
      for (; i + 320 <= data.length; i += 320) {
        const frame = data.slice(i, i + 320), view = new DataView(frame.buffer);
        let power = 0;
        for (let j = 0; j < 320; j += 2) power += view.getInt16(j, true) ** 2;
        const loud = Math.sqrt(power / 160) >= 450;
        if (!active) {
          before.push(frame); if (before.length > 15) before.shift();
          onset = loud ? onset + 1 : 0;
          if (onset < 8) continue;
          active = true; frames = before; before = []; voiced = onset; quiet = 0;
          events.push({ type: "start" });
        } else {
          frames.push(frame); voiced += loud ? 1 : 0; quiet = loud ? 0 : quiet + 1;
        }
        if (quiet >= 80 || frames.length >= 2500) {
          events.push({ type: "speech", pcm: voiced >= 20 ? join(frames) : null });
          active = false; frames = []; voiced = quiet = onset = 0;
        }
      }
      tail = data.slice(i);
      return events;
    },
    reset() { tail = new Uint8Array(); before = []; frames = []; active = false; voiced = quiet = onset = 0; },
  };
}

export function voiceReply(text, tools) {
  const raw = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error("The agent did not return a valid voice response. Try saying that again."); }
  if (!value || typeof value.say !== "string" || value.say.length > 2000) throw new Error("The agent returned an unsupported voice response.");
  if (value.tool != null) {
    const tool = tools.find((t) => t.name === value.tool.name), args = value.tool.arguments;
    if (!tool || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("The agent requested an unknown voice control.");
    const schema = tool.parameters;
    if (!(schema.required ?? []).every((k) => Object.hasOwn(args, k))) throw new Error("The voice control is missing required details.");
    for (const [key, val] of Object.entries(args)) {
      const spec = schema.properties[key];
      if (!spec || (spec.type === "integer" ? !Number.isInteger(val) : typeof val !== spec.type) || (spec.enum && !spec.enum.includes(val))) throw new Error("The agent returned invalid voice control details.");
    }
  }
  return { say: value.say.trim(), tool: value.tool ?? null };
}

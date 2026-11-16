import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.herdr.shepherdr.speech</string>
<key>CFBundleName</key><string>herdr-speech</string>
<key>NSSpeechRecognitionUsageDescription</key><string>BossGoat converts speech to text on this Mac for voice calls. Audio stays on this Mac.</string>
</dict></plist>`;
let building;
export function speechHelper() {
  building ??= (async () => {
    if (process.platform !== "darwin") throw new Error("Claude and Cursor local speech currently need a Mac. Choose Codex or ElevenLabs on this machine.");
    const src = join(import.meta.dir, "mac-speech.swift");
    const hash = createHash("sha256").update(readFileSync(src)).update(PLIST).update(process.arch).digest("hex").slice(0, 16);
    const cache = join(process.env.HERDR_APP_HOME || join(homedir(), ".config/herdr-app"), "data/chat-speech", hash);
    mkdirSync(cache, { recursive: true, mode: 0o700 });
    const exe = join(cache, "herdr-speech");
    if (existsSync(exe)) return exe;
    if (!Bun.which("swiftc")) throw new Error("Local speech needs Apple's command line tools. Run xcode-select --install, then try again.");
    const build = mkdtempSync(join(cache, "build-"));
    try {
      const plist = join(build, "Info.plist"), out = join(build, "herdr-speech");
      writeFileSync(plist, PLIST);
      const p = Bun.spawn(["swiftc", "-O", "-swift-version", "5", "-o", out, src, "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", plist], { stdout: "ignore", stderr: "pipe" });
      const error = await new Response(p.stderr).text();
      if (await p.exited) throw new Error("Local speech could not be built: " + error.slice(-700));
      renameSync(out, exe);
      return exe;
    } finally { rmSync(build, { recursive: true, force: true }); }
  })().catch((e) => { building = null; throw e; });
  return building;
}

export function pcmWave(pcm) {
  const head = Buffer.alloc(44);
  head.write("RIFF"); head.writeUInt32LE(pcm.length + 36, 4); head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

export function wavePcm(wav) {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Local speech returned invalid audio.");
  let format = false;
  for (let i = 12; i + 8 <= wav.length;) {
    const n = wav.readUInt32LE(i + 4), kind = wav.toString("ascii", i, i + 4);
    if (i + 8 + n > wav.length) break;
    if (kind === "fmt " && n >= 16) format = wav.readUInt16LE(i + 8) === 1 && wav.readUInt16LE(i + 10) === 1 && wav.readUInt32LE(i + 12) === 16000 && wav.readUInt16LE(i + 22) === 16;
    if (kind === "data" && format && n % 2 === 0) return wav.subarray(i + 8, i + 8 + n);
    i += 8 + n + (n % 2);
  }
  throw new Error("Local speech needs 16 kHz mono PCM audio.");
}

export class LocalSpeech {
  processes = new Set();
  closed = false;
  constructor() { this.dir = mkdtempSync(join(tmpdir(), "bossgoat-speech-")); }
  async run(argv, input) {
    if (this.closed) throw new Error("The call ended.");
    const p = Bun.spawn(argv, { stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
    this.processes.add(p);
    if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
    const timer = setTimeout(() => p.kill(), 60000);
    try {
      const [text, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      if (this.closed) throw new Error("The call ended.");
      if (code) throw new Error(err.trim() || "Local speech stopped. Check Speech Recognition permission and try again.");
      return text.trim();
    } finally { clearTimeout(timer); this.processes.delete(p); }
  }
  async ready() { this.helper = await speechHelper(); await this.run([this.helper, "check"]); }
  async transcribe(pcm) {
    const file = join(this.dir, "heard.wav");
    writeFileSync(file, pcmWave(pcm), { mode: 0o600 });
    try { return await this.run([this.helper, file]); }
    finally { rmSync(file, { force: true }); }
  }
  async speak(text) {
    const file = join(this.dir, "spoken.wav");
    try {
      await this.run(["say", "-v", "Samantha", "-o", file, "--file-format=WAVE", "--data-format=LEI16@16000", "-f", "-"], text);
      return wavePcm(readFileSync(file));
    } finally { rmSync(file, { force: true }); }
  }
  close() { this.closed = true; for (const p of this.processes) p.kill(); rmSync(this.dir, { recursive: true, force: true }); }
}

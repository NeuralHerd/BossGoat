import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function agentCommand(provider) {
  if (provider === "claude") return ["claude", "-p", "--output-format", "json", "--restricted", "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence", "--permission-mode", "dontAsk", "--no-chrome"];
  if (provider === "cursor") return ["cursor-agent", "-p", "--output-format", "json", "--mode", "ask", "--trust"];
  throw new Error("Unknown local voice provider.");
}

export function agentEnvironment(env = process.env) {
  const clean = { ...env };
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CURSOR_API_KEY", "CURSOR_API_ENDPOINT", "CLAUDE_CODE_SIMPLE", "CLAUDE_CODE_BARE", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_CHILD_SESSION"]) delete clean[key];
  return clean;
}

export function subscriptionSignIn(provider, status) {
  return provider === "claude" ? status?.loggedIn === true && status.authMethod === "claude.ai"
    : provider === "cursor" && status?.isAuthenticated === true && status.hasAccessToken === true && status.hasRefreshToken === true;
}

export const VOICE_PERMISSIONS = { allow: [], deny: ["Shell(*)", "Read(**)", "Write(**)", "WebFetch(*)", "Mcp(*:*)"] };
export class LocalAgent {
  closed = false;
  constructor(provider, dir) {
    this.provider = provider;
    this.dir = dir;
    this.command = agentCommand(provider);
    if (!Bun.which(this.command[0])) throw new Error(`Install ${provider === "claude" ? "Claude Code" : "Cursor CLI"} and sign in on this machine to use its voice option.`);
    mkdirSync(join(dir, ".cursor"), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, ".cursor/cli.json"), JSON.stringify({ permissions: VOICE_PERMISSIONS }), { mode: 0o600 });
  }
  async ready() {
    if (this.closed) throw new Error("The call ended.");
    const args = this.provider === "claude"
      ? ["claude", "--restricted", "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "auth", "status", "--json"]
      : ["cursor-agent", "status", "--format", "json"];
    const p = this.proc = Bun.spawn(args, { cwd: this.dir, env: agentEnvironment(), stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), 15000);
    try {
      const out = await new Response(p.stdout).text();
      let status; try { status = JSON.parse(out); } catch {}
      if (await p.exited || !subscriptionSignIn(this.provider, status)) {
        throw new Error(`Sign in to ${this.provider === "claude" ? "Claude Code with claude auth login" : "Cursor CLI with cursor-agent login"} on this machine. Local voice requires subscription sign-in; API keys are not used.`);
      }
      if (this.closed) throw new Error("The call ended.");
    } finally { clearTimeout(timer); if (this.proc === p) this.proc = null; }
  }
  async reply(prompt) {
    if (this.closed) throw new Error("The call ended.");
    const p = this.proc = Bun.spawn(this.command, { cwd: this.dir, env: agentEnvironment(), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    p.stdin.write(prompt); p.stdin.end();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill(); }, 90000);
    try {
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      if (this.closed) throw new Error("The call ended.");
      if (timedOut) throw new Error(`${this.provider} took too long to answer. Try again.`);
      let result;
      try { result = JSON.parse(out.trim()); } catch {}
      if (code || result?.is_error) throw new Error(`${this.provider} voice: ${String(result?.result || err || "Could not get a response. Check your CLI sign-in and subscription limits.").trim().slice(0, 500)}`);
      if (typeof result?.result !== "string") throw new Error(`${this.provider} returned an unsupported voice response.`);
      return result.result;
    } finally { clearTimeout(timer); if (this.proc === p) this.proc = null; }
  }
  interrupt() { this.proc?.kill(); }
  close() { this.closed = true; this.interrupt(); }
}

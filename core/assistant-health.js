// Shared, evidence-based Assistant status. A running process alone does not prove sign-in.
export const HEALTH_COLORS = { background: "#ffffff", ink: "#1d1d1f", muted: "#1d1d1fcc", border: "#1d1d1f21", link: "#0070d9" };
export function assistantHealth({ agent = "Agent", installed = null, workspace = null, phase = "fresh", active = false, screen = "", error = "", since = 0, now = Date.now() } = {}) {
  const text = `${screen} ${error}`;
  const login = /not authenticated|not logged in|authentication (?:required|failed)|unauthorized|invalid api key|(?:please|must|need to) (?:sign|log)[ -]?in|(?:sign|log)[ -]?in (?:required|to (?:continue|start|use)|with (?:your|browser|ChatGPT))|^\s*[>›❯]?\s*(?:sign|log)[ -]?in\s*$/im.test(text);
  const access = /permission denied|EACCES|folder.*(?:not found|does not exist)|no such file or directory/i.test(text);
  const missing = installed === false || /command not found|(?:codex|claude|cursor-agent): not found/i.test(text);
  const slow = ["starting", "finding", "pending"].includes(phase) && since > 0 && now - since > 30000;
  const issue = missing ? "agent" : login ? "login" : workspace?.readable === false || access ? "workspace" : error ? "error" : slow ? "slow" : null;
  const rows = [
    { label: "Agent", text: missing ? `${agent} is not installed` : `${agent}${installed === true ? " · Available" : " · Not checked yet"}` },
    { label: "Sign-in", text: login ? "Sign-in required" : active ? "Session active" : "Not verified yet" },
    { label: "Workspace", text: workspace ? !workspace.readable ? "Folder unavailable or unreadable" : workspace.writable ? "Read and write access" : "Read-only access" : "Not checked yet" },
    { label: "Startup", text: issue === "slow" ? "Taking longer than expected" : phase === "fresh" ? "Ready to start" : active ? "Conversation connected" : phase === "ended" ? "Agent stopped" : "Waiting for the agent" },
  ];
  const detail = { agent: "Choose an installed agent, then retry your saved message.", login: "Complete sign-in in the agent’s screen, then check again.", workspace: "Check this space’s folder and its access permissions, then check again.", slow: "Your message is saved. Check the agent’s startup screen before retrying.", error: `${String(error).slice(0, 240)} Check again after resolving this error.` }[issue] ?? "";
  return { rows, issue, detail, action: issue === "agent" ? "choose" : issue === "login" || issue === "slow" ? "terminal" : "check" };
}
// Arguments are passed separately; neither a folder nor a CLI name becomes shell source.
export const HEALTH_PROBE = `PATH="$PATH:$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin"
command -v "$1" >/dev/null 2>&1 && a=1 || a=0
[ -d "$2" ] && [ -r "$2" ] && [ -x "$2" ] && r=1 || r=0
[ -w "$2" ] && w=1 || w=0
printf '{"installed":%s,"workspace":{"readable":%s,"writable":%s}}' "$a" "$r" "$w"`;
export function healthProbe(text) {
  const p = JSON.parse(text);
  return { installed: p.installed === 1, workspace: { readable: p.workspace?.readable === 1, writable: p.workspace?.writable === 1 } };
}

import { expect, test } from "bun:test";
import { assistantHealth, HEALTH_PROBE, healthProbe } from "./assistant-health.js";
import { receipt, restorePending } from "./delivery.js";
import { nextRead, usageRecovery, usageStamp, failedWords } from "./machines.js";

test("health distinguishes confirmed checks from unverified sign-in and gives a specific recovery", () => {
  const healthy = assistantHealth({ agent: "Cursor", installed: true, workspace: { readable: true, writable: false } });
  expect(healthy.rows.find((r) => r.label === "Sign-in").text).toBe("Not verified yet");
  expect(healthy.rows.find((r) => r.label === "Workspace").text).toBe("Read-only access");
  expect(assistantHealth({ installed: false }).action).toBe("choose");
  expect(assistantHealth({ screen: "Please sign in to continue" })).toMatchObject({ issue: "login", action: "terminal" });
  expect(assistantHealth({ active: true, screen: "Signed in successfully" }).issue).toBeNull();
  expect(assistantHealth({ workspace: { readable: false } }).issue).toBe("workspace");
  expect(assistantHealth({ phase: "starting", since: 1, now: 31002 }).issue).toBe("slow");
});

test("health checks use arguments literally, and distinguish a missing program from a missing folder", async () => {
  const p = Bun.spawn(["sh", "-c", HEALTH_PROBE, "health", "sh", "/path/that/does/not/exist;echo wrong"], { stdout: "pipe" });
  expect(healthProbe(await new Response(p.stdout).text())).toEqual({ installed: true, workspace: { readable: false, writable: false } });
  expect(await p.exited).toBe(0);
});

test("only a new exact receipt confirms a message; unrelated replies and images do not", () => {
  const p = { text: "Run the check", at: 10000, prior: ["old"] };
  expect(receipt([{ kind: "user", id: "old", text: p.text, at: 10001 }], p)).toBeNull();
  expect(receipt([{ kind: "agent", id: "new", text: p.text, at: 10001 }], p)).toBeNull();
  expect(receipt([{ kind: "user", id: "new", text: p.text + " tomorrow", at: 10001 }], p)).toBeNull();
  expect(receipt([{ kind: "user", id: "new", text: p.text, at: 10001 }], p)?.id).toBe("new");
  expect(receipt([{ kind: "user", id: "image", images: 1, at: 10001 }], { ...p, text: "" })).toBeNull();
  expect(receipt([{ kind: "user", id: "image", cid: "c", at: 10001 }], { ...p, text: "", cid: "c" })?.id).toBe("image");
});

test("restart restores files and separates never-dispatched messages from ambiguous attempts", () => {
  const msg = { text: "Use this", files: [{ path: "/saved/image.png" }] };
  const [waiting, uncertain] = restorePending([{ id: "1", msg }, { id: "2", msg, attempted: true }]);
  expect(waiting.late).toBeUndefined();
  expect(uncertain.late).toBe(true);
  expect(uncertain.msg.files).toEqual(msg.files);
});

test("failed usage refresh keeps the last reading but labels it stale with a recovery; success clears it", () => {
  const before = { state: "ok", at: 1000, windows: [{ name: "Weekly", used: 53 }] };
  const failed = nextRead(before, { state: "unknown", why: "Its sign-in is due for renewal: the next agent here will do it" });
  expect(failed.at).toBe(before.at);
  expect(usageStamp(failed, 2000)).toStartWith("Last known usage");
  expect(failedWords(failed)).not.toContain("the next agent");
  expect(usageRecovery(failed, "Codex")).toContain("complete sign-in");
  const fresh = nextRead(failed, { ...before, at: 2000 });
  expect(fresh.failed).toBeUndefined();
  expect(usageStamp(fresh, 2000)).toStartWith("Read");
});

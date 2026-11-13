import { afterAll, expect, test, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failedOf, forgetAll, noteFailed, once, waitingSends, sendReceipt, confirmSend } from "./send-once.ts";

const was = process.env.SHEPHERDR_DATA;
beforeAll(() => { process.env.SHEPHERDR_DATA = mkdtempSync(join(tmpdir(), "send-once-")); forgetAll(); });
afterAll(() => { if (was === undefined) delete process.env.SHEPHERDR_DATA; else process.env.SHEPHERDR_DATA = was; forgetAll(); });

// SHEP-93: a phone that lost the answer asks again with the same id: it never goes twice
test("a send asked again while on its way waits for it, and one that went in answers again without going", async () => {
  let went = 0;
  let finish!: () => void;
  const go = () => { went++; return new Promise((r) => { finish = () => r({ ok: true, at: 1 }); }); };
  const first = once("c-1", go);
  const again = once("c-1", go);
  await Promise.resolve();
  finish();
  expect(await first).toEqual({ ok: true, at: 1 });
  expect(await again).toEqual({ ok: true, at: 1 });
  expect(await once("c-1", go)).toEqual({ ok: true, at: 1 });
  // the service restarted between the send and the page asking again
  forgetAll();
  expect(await once("c-1", go)).toEqual({ ok: true, at: 1 });
  expect(went).toBe(1);
});

test("one that failed may go again (Retry); one that stayed in the box goes again as only its Enter", async () => {
  const tries: boolean[] = [];
  const bad = (again: boolean) => { tries.push(again); return Promise.reject(Object.assign(new Error("It's still in the agent's message box"), { stuck: tries.length === 1 })); };
  await expect(once("c-2", bad)).rejects.toThrow("message box");
  await expect(once("c-2", bad)).rejects.toThrow("message box");
  expect(tries).toEqual([false, true]);
});

test("a held one that couldn't go is told to its page, and its Retry goes again", async () => {
  let went = 0;
  const hold = async () => { went++; return { ok: true, waiting: true, waitsFor: "turn" }; };
  await once("c-3", hold);
  noteFailed("t9", "c-3", "That agent isn't running.");
  expect(failedOf("t9")).toEqual([{ cid: "c-3", error: "That agent isn't running." }]);
  await once("c-3", hold);
  expect(went).toBe(2);
  // The durable queue survives restart and does not duplicate on a repeated request.
  forgetAll();
  await once("c-3", hold);
  expect(went).toBe(2);
});


test("a waiting message survives restart with its attachments, and explicit recovery dispatches it once", async () => {
  const request = { type: "send", addr: "t4", text: "Review this", attachments: ["/saved/a.png"] };
  await once("durable-wait", async () => ({ ok: true, waiting: true }), { request });
  forgetAll();
  expect(waitingSends().find((m) => m.cid === "durable-wait")?.request).toEqual(request);
  let sent = 0;
  const go = async () => { sent++; return { ok: true, at: 55 }; };
  await once("durable-wait", go, { request });
  expect(sent).toBe(0);
  await once("durable-wait", go, { request, resume: true });
  forgetAll();
  await once("durable-wait", go, { request, resume: true });
  expect(sent).toBe(1);
});

test("a process dying after dispatch leaves an ambiguous receipt and never replays it silently", async () => {
  const module = new URL("./send-once.ts", import.meta.url).pathname;
  const p = Bun.spawn([process.execPath, "-e", `import { once } from ${JSON.stringify(module)}; await once("crashed-send", async () => { process.exit(9); }, { request: { addr: "t4", text: "once" } });`], { env: { ...process.env }, stdout: "ignore", stderr: "pipe" });
  expect(await p.exited).toBe(9);
  forgetAll();
  expect(sendReceipt("crashed-send")?.state).toBe("sending");
  let sent = 0;
  expect(await once("crashed-send", async () => { sent++; return { ok: true }; })).toMatchObject({ unconfirmed: true });
  expect(sent).toBe(0);
  confirmSend("crashed-send");
  forgetAll();
  expect(await once("crashed-send", async () => { sent++; return {}; })).toMatchObject({ ok: true });
  expect(sent).toBe(0);
});

test("a corrupt delivery journal fails closed on every attempt instead of forgetting sent messages", async () => {
  const file = join(process.env.SHEPHERDR_DATA!, "sent.json"), saved = readFileSync(file, "utf8");
  writeFileSync(file, "broken"); forgetAll();
  let sent = 0;
  try {
    for (let i = 0; i < 2; i++) expect(() => once("no-send", async () => { sent++; return {}; })).toThrow();
    expect(sent).toBe(0);
  } finally { writeFileSync(file, saved); forgetAll(); }
});

test("failure to save prevents transport", async () => {
  const base = process.env.SHEPHERDR_DATA!, blocked = join(base, "not-a-directory");
  writeFileSync(blocked, "x");
  process.env.SHEPHERDR_DATA = blocked; forgetAll();
  let sent = 0;
  try {
    await expect(once("no-disk", async () => { sent++; return {}; })).rejects.toThrow("Couldn't save");
    expect(sent).toBe(0);
  } finally { process.env.SHEPHERDR_DATA = base; unlinkSync(blocked); forgetAll(); }
});

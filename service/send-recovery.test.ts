import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, recoverSends } from "./actions.ts";
import { forgetAll, waitingSends, once } from "./send-once.ts";

test("service restart resumes a queued message when the agent becomes idle, exactly once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "send-recovery-")), before = process.env.SHEPHERDR_DATA;
  process.env.SHEPHERDR_DATA = dir; forgetAll();
  try {
    const sent: string[] = [];
    const terminal = { address: "t1", state: "live", status: { state: "working" }, foreground: { pid: 42, argv: ["codex"] } };
    const hub: any = { terminals: new Map([["t1", terminal]]), send: async (_addr: string, text: string) => { sent.push(text); return { code: 0, stdout: "{}", stderr: "" }; } };
    const compat: any = { reader: () => null, addrOf: () => "t1", noteSend: () => {} };
    expect(await act(hub, { type: "send", cid: "queued", addr: "t1", text: "once", hold: true }, compat)).toMatchObject({ waiting: true });
    forgetAll();
    await recoverSends(hub, compat);
    expect(sent).toEqual([]);
    expect(waitingSends()).toHaveLength(1);
    terminal.status.state = "idle";
    await recoverSends(hub, compat);
    forgetAll();
    await recoverSends(hub, compat);
    expect(sent).toEqual(["once"]);
    expect(waitingSends()).toHaveLength(0);
  } finally { if (before === undefined) delete process.env.SHEPHERDR_DATA; else process.env.SHEPHERDR_DATA = before; forgetAll(); rmSync(dir, { recursive: true, force: true }); }
});


test("one transcript record cannot confirm two identical interrupted sends, even after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "send-receipts-")), before = process.env.SHEPHERDR_DATA;
  process.env.SHEPHERDR_DATA = dir; forgetAll();
  try {
    const request = { type: "send", addr: "t1", text: "Continue", prior: [] };
    for (const cid of ["first", "second"]) await once(cid, async () => { throw new Error("connection lost"); }, { request }).catch(() => {});
    const reader = { locate: async () => {}, pull: async () => {}, conv: { items: [{ kind: "user", id: "receipt-1", text: "Continue", at: Date.now() + 1 }] } };
    const hub: any = { terminals: new Map([["t1", { state: "live", foreground: { pid: 42 } }]]) };
    const compat: any = { reader: () => reader };
    expect(await act(hub, { type: "delivery-check", cid: "first", addr: "t1" }, compat)).toMatchObject({ delivered: true });
    forgetAll();
    expect(await act(hub, { type: "delivery-check", cid: "second", addr: "t1" }, compat)).toMatchObject({ delivered: false });
  } finally { if (before === undefined) delete process.env.SHEPHERDR_DATA; else process.env.SHEPHERDR_DATA = before; forgetAll(); rmSync(dir, { recursive: true, force: true }); }
});

test("cancelled waiting messages stay cancelled across a service restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "send-cancel-")), before = process.env.SHEPHERDR_DATA;
  process.env.SHEPHERDR_DATA = dir; forgetAll();
  try {
    await once("cancel", async () => ({ ok: true, waiting: true }), { request: { type: "send", addr: "t1", text: "cancel me" } });
    expect(await act({} as any, { type: "held-drop", cid: "cancel" }, {} as any)).toMatchObject({ ok: true });
    forgetAll();
    expect(waitingSends()).toHaveLength(0);
  } finally { if (before === undefined) delete process.env.SHEPHERDR_DATA; else process.env.SHEPHERDR_DATA = before; forgetAll(); rmSync(dir, { recursive: true, force: true }); }
});

// A page's send, once (SHEP-93): a phone that lost the answer asks again with the same id, and gets the same answer.
// Waiting messages and in-flight attempts are journaled before dispatch. After a restart only waiting messages
// replay; an in-flight attempt needs a conversation receipt or an explicit resend decision.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "./paths.ts";

const KEEP = 30 * 24 * 60 * 60_000;
const FILE = () => join(process.env.SHEPHERDR_DATA || DATA, "sent.json");
type Done = { at: number; result?: any; state?: "sending" | "waiting" | "done" | "failed"; request?: any; stuck?: boolean; receipt?: { address: string; id: string } };
let done: Map<string, Done> | null = null;
function load(): Map<string, Done> {
  if (done) return done;
  const loaded = new Map<string, Done>();
  if (existsSync(FILE())) {
    const parsed = JSON.parse(readFileSync(FILE(), "utf8")) as Record<string, Done>;
    for (const [k, v] of Object.entries(parsed)) if (v.state !== "done" || Date.now() - v.at < KEEP) loaded.set(k, v);
  }
  done = loaded;
  return done;
}
function save() {
  mkdirSync(dirname(FILE()), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(load())), { mode: 0o600 });
  renameSync(tmp, FILE());
}
const going = new Map<string, Promise<unknown>>();
const stuck = new Set<string>();
export function waitingSends(): { cid: string; at: number; request: any }[] {
  return [...load()].filter(([, d]) => d.state === "waiting" && d.request).map(([cid, d]) => ({ cid, at: d.at, request: d.request })).sort((a, b) => a.at - b.at);
}
export function cancelWaiting(cid: string) {
  if (load().get(cid)?.state !== "waiting") return false;
  load().delete(cid); save(); return true;
}
export function sendReceipt(cid: string) { return load().get(cid) ?? null; }
export function confirmedReceipts(address: string, except: string) {
  return new Set([...load()].filter(([cid, d]) => cid !== except && d.receipt?.address === address).map(([, d]) => d.receipt!.id));
}
export function confirmSend(cid: string, receipt?: { address: string; id: string }) {
  const was = load().get(cid);
  if (was) { load().set(cid, { ...was, state: "done", result: { ok: true, at: was.at }, receipt }); save(); }
}
/** Save before any transport side effect. A crash while sending is ambiguous and cannot silently replay. */
export function once(cid: string, go: (again: boolean) => Promise<unknown>, options: { request?: any; resume?: boolean } = {}): Promise<unknown> {
  const on = going.get(cid);
  if (on) return on;
  const d = load(), was = d.get(cid);
  if (was?.state === "sending") return Promise.resolve({ ok: true, unconfirmed: true, at: was.at });
  if (was?.result && was.state !== "failed" && !(was.state === "waiting" && options.resume)) return Promise.resolve(was.result);
  const at = was?.at ?? Date.now();
  d.set(cid, { at, state: "sending", request: options.request ?? was?.request, stuck: was?.stuck });
  try { save(); } catch (e) { if (was) d.set(cid, was); else d.delete(cid); return Promise.reject(new Error("Couldn't save the message. Check disk space before trying again.")); }
  const p = Promise.resolve().then(() => go(stuck.has(cid) || !!was?.stuck)).then((raw: any) => {
    const { retry, ...result } = raw ?? {};
    d.set(cid, { at, state: result.waiting ? "waiting" : "done", result, request: retry ?? options.request ?? was?.request });
    save();
    stuck.delete(cid);
    return result;
  }, (e) => {
    if (e.stuck) stuck.add(cid);
    // A known refusal can be retried. An interrupted/unanswered transport stays ambiguous.
    d.set(cid, { at, state: e.definite || e.stuck ? "failed" : "sending", request: options.request ?? was?.request, stuck: !!e.stuck });
    save();
    throw e;
  }).finally(() => going.delete(cid));
  going.set(cid, p);
  return p;
}

/** held messages that couldn't go once the agent was free, by agent address: the page shows them failed with Retry */
const heldFailed = new Map<string, { cid: string; error: string; at: number }[]>();
export function noteFailed(addr: string, cid: string, error: string, stayed = false) {
  // it stayed in Claude Code's box: its Retry presses Enter only
  if (stayed) stuck.add(cid);
  // its Retry goes again (its answer was "held", not "in")
  if (load().delete(cid)) save();
  const list = (heldFailed.get(addr) ?? []).filter((f) => f.cid !== cid && Date.now() - f.at < KEEP);
  heldFailed.set(addr, [...list, { cid, error, at: Date.now() }]);
}
export function failedOf(addr: string | null | undefined): { cid: string; error: string }[] {
  return (heldFailed.get(addr ?? "") ?? []).filter((f) => Date.now() - f.at < KEEP).map(({ cid, error }) => ({ cid, error }));
}

/** tests: a restart (what is on disk is read again) */
export function forgetAll() {
  done = null;
  going.clear();
  stuck.clear();
  heldFailed.clear();
}

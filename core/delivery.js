// A transport acknowledgement is not a conversation receipt. Never replay an ambiguous send automatically.
import { afterSend } from "./chat-log.js";
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export const UNCONFIRMED = "Delivery unconfirmed. Check delivery before resending.";
export function receipt(items, pending) {
  const prior = new Set(pending.prior ?? []);
  const expected = norm(pending.text ?? pending.msg?.text ?? pending.sent);
  const body = norm(pending.sent);
  return (items ?? []).find((m) => {
    if (!(m.kind === "user" || m.who === "you") || m.waiting || prior.has(m.id)) return false;
    if (pending.cid && m.cid === pending.cid) return true;
    if (!expected || !Number.isFinite(pending.at) || !afterSend(m, pending)) return false;
    const text = norm(m.text);
    return text === expected || (body && text === body) || (pending.first && text.endsWith(expected));
  }) ?? null;
}
export function restorePending(pending = []) {
  return pending.filter((p) => p?.id && p.msg && typeof p.msg.text === "string").map((p) => ({ ...p,
    ...(p.attempted ? { late: true, failed: undefined, checking: false } : {}), restored: true,
  }));
}

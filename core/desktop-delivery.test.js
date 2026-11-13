import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restorePending, receipt } from "./delivery.js";

const source = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
const method = (name) => source.match(new RegExp(String.raw`\n  (?:async )?${name}\([^\n]*\) \{\n[\s\S]*?\n  \}`))[0];
const methods = ["loadDraft", "saveDraft", "settlePending", "retry"].map(method).join(",");
const make = (dir) => new Function("fs", "appHome", "restorePending", "receipt", "norm", `return ({${methods}})`)(fs, () => dir, restorePending, receipt, (s) => s.trim());
const state = (dir) => ({ box: { value: () => "", set_value() {} }, files: [], quote: null, queue: [], pending: [], markTyping() {}, draftFile: join(dir, "data/chat-drafts/assistant.json") });

test("desktop reopen keeps full messages and files; checking does not resend an ambiguous send", async () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-delivery-"));
  try {
    const original = Object.assign(state(dir), make(dir));
    original.pending = [{ id: "p1", text: "Read this", at: 10000, attempted: true, msg: { id: "m1", text: "Read this", files: [{ path: "/saved/image.png" }] } }];
    await original.saveDraft(true);
    const reopened = Object.assign(state(dir), make(dir));
    await reopened.loadDraft({ notify() {} });
    expect(reopened.pending[0]).toMatchObject({ late: true, msg: original.pending[0].msg });
    let sent = 0, job;
    Object.assign(reopened, { addr: "t1", locate: async () => {}, pull: async () => {}, conv: { items: [] }, deliver: () => sent++ });
    const cx = { notify() {}, spawn: (fn) => { job = fn(cx); } };
    reopened.retry(reopened.pending[0], cx); await job;
    expect(sent).toBe(0);
    expect(reopened.pending[0].checked).toBe(true);
    reopened.conv.items = [{ kind: "user", id: "new", text: "Read this", at: 10001 }];
    reopened.retry(reopened.pending[0], cx, true); await job;
    expect(sent).toBe(0);
    expect(reopened.pending).toHaveLength(0);
    const final = Object.assign(state(dir), make(dir));
    await final.loadDraft({ notify() {} });
    expect(final.pending).toHaveLength(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("attachment cleanup preserves files referenced by every saved chat, including older messages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-attachments-"));
  try {
    const attach = join(dir, "data/chat-attach"), drafts = join(dir, "data/chat-drafts");
    await fs.mkdir(attach, { recursive: true }); await fs.mkdir(drafts);
    for (const name of ["pasted-kept.png", "pasted-old.png"]) {
      const file = join(attach, name); await fs.writeFile(file, "image"); await fs.utimes(file, new Date(0), new Date(0));
    }
    await fs.writeFile(join(drafts, "other.json"), JSON.stringify({ pending: [{ msg: { files: [{ path: join(attach, "pasted-kept.png") }] } }] }));
    const src = readFileSync(new URL("../mods/chat/attach.js", import.meta.url), "utf8");
    const code = src.match(/export async function prune\(\) \{[\s\S]*?\n\}/)[0].replace("export ", "");
    const prune = new Function("fs", "appHome", `${code}; return prune`)(fs, () => dir);
    await prune();
    expect(await fs.readdir(attach)).toEqual(["pasted-kept.png"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("a corrupt draft is preserved and blocks new dispatch rather than erasing pending messages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-draft-corrupt-"));
  try {
    const self = Object.assign(state(dir), make(dir));
    await fs.mkdir(join(dir, "data/chat-drafts"), { recursive: true });
    await fs.writeFile(self.draftFile, "damaged");
    await self.loadDraft({ notify() {} });
    await expect(self.saveDraft(true)).rejects.toThrow("Couldn't read saved messages");
    expect(await fs.readFile(self.draftFile, "utf8")).toBe("damaged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

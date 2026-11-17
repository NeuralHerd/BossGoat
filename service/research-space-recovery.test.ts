import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "research-space-"));
const app = join(root, "app"), folder = join(root, "project"), calls = join(root, "calls");
mkdirSync(app); mkdirSync(folder);
for (const name of ["hc", "herdr-app"]) writeFileSync(join(root, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\necho '{}'\n`, { mode: 0o755 });
const env = { HERDR_APP_HOME: process.env.HERDR_APP_HOME, SHEPHERDR_HC: process.env.SHEPHERDR_HC, SHEPHERDR_HERDR_APP: process.env.SHEPHERDR_HERDR_APP };
let newSpace: typeof import("./spaces.ts").newSpace;
let act: typeof import("./actions.ts").act;
beforeAll(async () => {
  process.env.HERDR_APP_HOME = app;
  process.env.SHEPHERDR_HC = join(root, "hc");
  process.env.SHEPHERDR_HERDR_APP = join(root, "herdr-app");
  ({ newSpace } = await import("./spaces.ts"));
  ({ act } = await import("./actions.ts"));
});
afterAll(() => { for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
const assistant = { address: "t1", state: "live", cwd: folder, labels: { "herdr.role": "coordinator", "herdr.coordinator.space": "old" } };
const shared = () => {
  const data: Record<string, any> = { spaces: [] };
  return { data, value: (key: string) => data[key], set: async (key: string, value: any) => { data[key] = value; } };
};

test("a web-only closed space reopens with its original Assistant, not a new worker", async () => {
  writeFileSync(calls, "");
  const hub: any = { terminals: new Map([[assistant.address, assistant]]), async call(method: string, params: any) {
    if (method === "machine.exec" && ["test", "git"].includes(params.argv[0]))
      return { code: params.argv[0] === "test" ? 0 : 1, stdout: "", stderr: "" };
    if (method === "doc.get") return { value: { spaces: [] }, version: 1 };
    throw new Error("Unexpected core call: " + method);
  } };
  const s = shared();
  const place = await newSpace(hub, { machine: null, path: folder, store: s });
  const log = readFileSync(calls, "utf8");
  expect(log).toContain("hc label t1 herdr.coordinator.space=" + place);
  expect(log).toContain("herdr.coordinator.previous=old");
  expect(log).not.toContain("hc run");
  expect(s.data.spaces[0].folder).toBe(folder);
});

test("closing a web-owned space removes its view without ending its Assistant", async () => {
  writeFileSync(calls, "");
  const s = shared(); s.data.spaces = [{ id: "old", folder, machine: null }];
  const hub: any = { terminals: new Map([[assistant.address, assistant]]), on() { return () => {}; } };
  expect(await act(hub, { type: "space-remove", place: "old" }, { shared: s } as any)).toEqual({ ok: true });
  expect(s.data.spaces).toEqual([]);
  expect(readFileSync(calls, "utf8")).toBe("");
});

test("web closure parks visible task terminals and restores keep before closing the native space", async () => {
  writeFileSync(calls, "");
  const worker = { address: "t2", state: "live", labels: { "herdr.task": "project#1", "herdr.task.space": "old", "herdr.tab": "tab" } };
  const hub: any = { terminals: new Map([[worker.address, worker]]), on() { return () => {}; } };
  const compat: any = { shared: shared(), spaceOf: () => ({ id: "old", folder, machine: null }) };
  expect(await act(hub, { type: "space-remove", place: "old" }, compat)).toEqual({ ok: true });
  const log = readFileSync(calls, "utf8").trim().split("\n");
  expect(log).toEqual(["herdr-app status", "herdr-app do terminal.park --terminal t2", "hc keep t2", "herdr-app do space.close --id old --confirmed true"]);
});

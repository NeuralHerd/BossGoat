import { expect, test } from "bun:test";
import { Model } from "./model.ts";
import { Compat } from "./compat.ts";

test("task dependencies reach the web with skills, agents, and old completed prerequisites as context only", () => {
  const rows: any[] = [];
  const hub: any = { terminals: new Map() };
  const model: any = new Model(hub, { put: (key: string, value: any) => { if (key === "tasks") rows.push(...value); } } as any);
  model.lists.set(null, [{ machine: null, folder: "/srv/app", slug: "app", prefix: "APP", name: "App", tasks: [
    { id: 1, title: "Foundation", state: "done", done_at: Date.now() - 10 * 86400000, archived: 1 },
    { id: 2, title: "Feature", state: "queued", after: [1], skill: "hc-build", agents: [{ agent: "cursor" }] },
    { id: 3, title: "Unrelated old task", state: "done", done_at: 1 },
  ] }]);
  model.build();
  const snap = new Compat().snapshot({ host: "local", user: "me", machines: [], spaces: [], sections: [], rows });
  expect(snap.tasks.map(t => t.id)).toEqual(["APP-2"]);
  expect(snap.tasks[0]).toMatchObject({ skill: "hc-build", workerAgent: "cursor",
    dependencies: [{ key: ":/srv/app#1", ref: "APP-1", state: "done" }] });
  expect(snap.dependencyTasks?.map(t => t.id)).toEqual(["APP-1"]);
});

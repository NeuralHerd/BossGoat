import { expect, test } from "bun:test";
import { detachedAssistant, assistantLabels, keepsWork } from "./spaces.js";

const agent = (address = "t1", owner = "old", folder = "/repo") => ({ address, state: "live", cwd: folder,
  labels: { "herdr.role": "coordinator", "herdr.coordinator.space": owner } });
const space = { id: "new", folder: "/repo", machine: null };

test("reopening a closed folder reuses its unshown Assistant", () => {
  const a = agent();
  expect(detachedAssistant(space, [a], [space], () => false)).toBe(a);
  expect(assistantLabels(a, space.id, space.folder)).toContain("herdr.coordinator.previous=old");
  const again = { ...a, labels: { ...a.labels, "herdr.coordinator.space": "new", "herdr.coordinator.previous": "old" } };
  expect(assistantLabels(again, "third", "/repo")).toContain("herdr.coordinator.previous=old,new");
});

test("recovery never steals a shown, still-owned, ambiguous or remote Assistant", () => {
  const a = agent();
  expect(detachedAssistant(space, [a], [space], () => true)).toBeNull();
  expect(detachedAssistant(space, [a], [{ id: "old" }, space], () => false)).toBeNull();
  expect(detachedAssistant(space, [a, agent("t2")], [space], () => false)).toBeNull();
  expect(detachedAssistant(space, [agent("vm/t1")], [space], () => false)).toBeNull();
  expect(detachedAssistant({ ...space, folder: "/different" }, [a], [space], () => false)).toBeNull();
});

test("the same space takes precedence and ended work is not resurrected", () => {
  const a = agent("t1", "new");
  expect(detachedAssistant(space, [a, agent("t2", "new")], [space], () => false)).toBeNull();
  expect(detachedAssistant(space, [agent("t2"), a], [space], () => false)).toBe(a);
  expect(detachedAssistant(space, [{ ...a, state: "exited" }], [], () => false)).toBeNull();
  expect(keepsWork({ ...agent(), labels: {} })).toBeFalse();
  expect(keepsWork({ ...agent(), labels: { "herdr.task": "repo#1" } })).toBeTrue();
});


test("task list snapshots carry the report link without copying its research notes", async () => {
  const { taskLists } = await import("./tasklists.js");
  const file = { folder: "/repo", tasks: [{ id: 1, research: true, research_report: "/data/report.md", research_notes: { findings: "long research" } }] };
  const task = taskLists("repo.json\n" + JSON.stringify(file) + "\n@@herdr-task-list@@\n")[0].tasks[0];
  expect(task.research_report).toBe("/data/report.md");
  expect(task).not.toHaveProperty("research_notes");
});

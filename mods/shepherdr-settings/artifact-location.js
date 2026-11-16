import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, exec, pickFolder } from "herdr";
import { TEXT, button } from "./ui.js";

function run(state, cx, directory) {
  if (state.busy) return;
  state.busy = directory ? "moving" : "loading";
  state.error = "";
  state.message = "";
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const result = await exec("python3", [`${appHome()}/mods/artifacts/bin/herdr-artifact`, "location", "--json", ...(directory ? [directory] : [])],
        { timeout: directory ? 600000 : 30000 });
      let value;
      try { value = JSON.parse(result.stdout); } catch { /* Command failures can return plain stderr. */ }
      if (result.code !== 0 || value?.error) throw new Error(value?.error || result.stderr?.trim() || "Couldn’t read the artifact folder. Try again.");
      if (typeof value?.directory !== "string" || !value.directory) throw new Error("BossGoat returned no artifact folder. Try again.");
      state.directory = value.directory;
      if (directory) {
        state.pending = null;
        state.message = value.backup ? `Artifacts moved. Previous files kept in: ${value.backup}` : "Artifact folder updated. Existing artifacts are preserved.";
      }
    } catch (error) {
      state.error = String(error?.message ?? error);
    } finally {
      state.busy = false;
      cx.notify();
    }
  });
}

function choose(state, cx) {
  if (state.busy) return;
  state.busy = "choosing";
  state.error = "";
  state.message = "";
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const directory = await pickFolder({ prompt: "Choose" });
      if (directory) state.pending = directory === state.directory ? null : directory;
    } catch (error) {
      state.error = String(error?.message ?? error);
    } finally {
      state.busy = false;
      cx.notify();
    }
  });
}

export function artifactLocationInit(cx) {
  const state = { directory: "", pending: null, busy: false, error: "", message: "" };
  run(state, cx);
  return state;
}

export function artifactLocationRow(view, t) {
  const state = view.artifactLocation;
  const line = (text, color = t.muted) => div().text_size(TEXT.label).line_height("18px").whitespace_normal().text_color(color).child(text);
  const below = v_flex().min_w(0).gap(8)
    .child(line(state.directory || (state.busy ? "Loading…" : "Folder unavailable")))
    .when(Boolean(state.pending), (el) => el
      .child(line(`Move to: ${state.pending}`, t.foreground))
      .child(h_flex().gap(8)
        .child(button("artifact-folder-move", state.busy === "moving" ? "Moving…" : "Move artifacts", {
          kind: "primary", disabled: state.busy, onClick: (_e, cx) => run(state, cx, state.pending),
        }))
        .child(button("artifact-folder-cancel", "Cancel", {
          disabled: state.busy, onClick: () => { state.pending = null; state.error = ""; },
        }))))
    .when(Boolean(state.error), (el) => el.child(line(state.error, t.blocked))
      .child(button("artifact-folder-refresh", "Refresh", { disabled: state.busy, onClick: (_e, cx) => run(state, cx) })))
    .when(Boolean(state.message), (el) => el.child(line(state.message)));
  return view.row(t, "Local artifact folder", "For every space on this computer. Moving preserves existing artifacts.",
    button("artifact-folder-choose", "Choose folder…", { disabled: state.busy || !state.directory, onClick: (_e, cx) => choose(state, cx) }), null, below);
}

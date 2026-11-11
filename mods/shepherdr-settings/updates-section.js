import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, exec } from "herdr";
import { button, red } from "./ui.js";

export const UPDATES = { id: "updates", title: "Updates", icon: "refresh" };
const CHANGELOG = "https://github.com/NeuralHerd/BossGoat/commits/main/";

export function updatesInit() {
  return { busy: false, result: null };
}

export async function updateRequest(action) {
  const r = await exec("python3", [`${appHome()}/bin/shepherdr`, "updates", action, "--json"], { timeout: 90000 });
  try { return JSON.parse(r.stdout); }
  catch { throw new Error("BossGoat could not check for updates. Try again."); }
}

export function runUpdate(view, action, cx) {
  const state = view.updates;
  if (state.busy) return;
  state.busy = true;
  cx.notify();
  cx.spawn(async (cx) => {
    try { state.result = await updateRequest(action); }
    catch (error) { state.result = { state: "error", message: error.message }; }
    state.busy = false;
    cx.notify();
    if (state.result?.state === "installing") cx.timer.after(1500, (cx) => runUpdate(view, "status", cx));
  });
}

export function updatesSection(view, t, cx) {
  const state = view.updates;
  const result = state.result;
  const busy = state.busy || result?.state === "installing";
  const message = result?.state === "installing" ? result.message : state.busy ? "Checking…" : result?.message ?? "Loading…";
  const control = (id, label, onClick, primary = false, disabled = false) => button(id, label, { kind: primary ? "primary" : "secondary", disabled, onClick })
    .h(36).px(14).rounded(18);
  return v_flex().gap(22).p(24).rounded(16).bg(t.popover).text_color(t.foreground)
    .child(div().text_size(22).font_semibold().child("Updates"))
    .child(div().text_size(13).text_color(t.muted).child("BossGoat on this computer"))
    .child(v_flex().gap(16).p(20).rounded(14).bg(t.background).border_1().border_color(t.border)
      .child(div().text_size(17).font_semibold().child(result?.version ? `BossGoat ${result.version}` : "BossGoat"))
      .child(div().text_size(14).line_height("22px").whitespace_normal().text_color(result?.state === "error" ? red() : t.muted).child(message))
      .when(Boolean(result?.checked_at), (el) => el.child(div().text_size(12).text_color(t.muted)
        .child(`Last checked ${new Date(result.checked_at).toLocaleString()}`)))
      .child(h_flex().flex_wrap().gap(10)
        .child(control("updates-changes", "What’s new", (_e, cx) => cx.open_url(CHANGELOG)))
        .child(control("updates-check", "Check now", (_e, cx) => runUpdate(view, "check", cx), false, busy))
        .when(Boolean(result?.available), (el) => el.child(control("updates-install", "Update now", (_e, cx) => runUpdate(view, "install", cx), true, busy)))))
    .child(div().text_size(13).line_height("21px").text_color(t.muted).whitespace_normal()
      .child("Updates follow this installation’s tracked branch and use the normal BossGoat installer, including its backups. Herdr and herdr-core update separately in Herdr’s settings."))
    .when(Boolean(result?.state === "error" && result?.log), (el) => el.child(control("updates-log", "View update log", (_e, cx) => cx.open_url(`file://${result.log}`))));
}

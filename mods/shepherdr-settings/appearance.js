import { div } from "gpui-kit";
import { h_flex, v_flex, SliderState, Slider, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { appHome, exec, readTextFile, shared, setShared } from "herdr";
import * as fs from "fs/promises";
import { button, TEXT } from "./ui.js";
import { wallpaper, WALLPAPER_KEY, WALLPAPER_DIR, DEFAULT_TRANSPARENCY, DEFAULT_WALLPAPER, WALLPAPER, APPEARANCE } from "./core/wallpaper.js";
import { wallpaperLayer } from "./wallpaper.js";

export function appearanceInit() {
  const current = wallpaper(shared(WALLPAPER_KEY));
  const state = { busy: false, error: null, width: 500, generation: 0,
    transparency: SliderState.new({ min: 0, max: 100, step: 5, value: current?.transparency ?? DEFAULT_TRANSPARENCY }) };
  state.transparency.on("change", (value, cx) => {
    const current = wallpaper(shared(WALLPAPER_KEY));
    if (current) setShared(WALLPAPER_KEY, { ...current, transparency: value });
    cx.notify();
  });
  return state;
}

function choose(state, cx, paths) {
  if (state.busy) return;
  if (paths && paths.length !== 1) { state.error = "Choose one image at a time."; cx.notify(); return; }
  state.busy = true;
  state.error = null;
  const generation = ++state.generation;
  cx.notify();
  const fail = (error, cx) => { state.busy = false; state.error = String(error?.message ?? error); cx.notify(); };
  cx.spawn(async (cx) => {
    try {
      const helper = `${appHome()}/mods/shepherdr-settings/wallpaper.py`;
      const result = await exec("python3", [helper, paths ? "import" : "pick", appHome(), ...(paths ?? [])]);
      if (result.code !== 0) throw new Error("Couldn’t open the wallpaper picker.");
      const { request } = JSON.parse(result.stdout);
      if (!/^[a-f0-9]{32}$/.test(request ?? "")) throw new Error(WALLPAPER.failed);
      const path = `${appHome()}/${WALLPAPER_DIR}/${request}.json`;
      const poll = (cx) => cx.spawn(async (cx) => {
        if (generation !== state.generation) return;
        try {
          const raw = await readTextFile(path);
          if (raw === null) { cx.timer.after(500, poll); return; }
          const value = JSON.parse(raw);
          await fs.unlink(path).catch(() => {});
          state.busy = false;
          if (value.error) throw new Error(value.error);
          if (!value.cancelled) {
            const next = wallpaper({ ...value, transparency: state.transparency.value() });
            if (!next) throw new Error(WALLPAPER.failed);
            setShared(WALLPAPER_KEY, next);
          }
          cx.notify();
        } catch (error) { fail(error, cx); }
      });
      poll(cx);
    } catch (error) { fail(error, cx); }
  });
}

export function appearanceSection(view, t) {
  const state = view.appearance, value = wallpaper(shared(WALLPAPER_KEY));
  const slider = Slider.new(state.transparency).w(190).child(
    SliderTrack.new(state.transparency).flex().items_center().h(28).w_full().child(
      SliderIndicator.new(state.transparency).relative().w_full().h(5).rounded(3).bg("#1d1d1f21")
        .range_style((fill) => fill.rounded(3).bg("#0070d9"))
        .child(SliderThumb.new(state.transparency).size(16).rounded(8).bg("#0070d9").ml(-8))));
  const preview = v_flex().id("wallpaper-preview").relative().w_full().h(230).overflow_hidden().rounded(12)
    .border_1().border_color("#1d1d1f21").bg("#f9f9fa").items_center().justify_center()
    .on_size_change((size, cx) => { if (state.width !== size.width) { state.width = size.width; cx.notify(); } })
    .on_drop((e, cx) => { cx.stop_propagation(); choose(state, cx, e.paths ?? []); })
    .when(Boolean(value), (el) => el.child(wallpaperLayer(value, state.width, 230)))
    .child(v_flex().relative().px(20).py(14).gap(7).rounded(10).bg("#ffffff").border_1().border_color("#1d1d1f21")
      .child(div().text_size(TEXT.body).font_medium().text_color("#1d1d1f").child(value ? "Your workspace, your style." : WALLPAPER.empty))
      .child(div().text_size(TEXT.label).text_color("#1d1d1fcc").child(value ? "Conversations stay easy to read." : WALLPAPER.formats)));
  return v_flex().gap(12)
    .child(view.title(t, APPEARANCE.title))
    .child(div().text_size(TEXT.body).font_medium().text_color(t.foreground).child(WALLPAPER.title))
    .child(div().text_size(TEXT.label).text_color(t.dim).child(WALLPAPER.about))
    .child(preview)
    .child(h_flex().gap(8).items_center()
      .child(button("wallpaper-choose", state.busy ? WALLPAPER.choosing : WALLPAPER.choose,
        { disabled: state.busy, onClick: (_e, cx) => choose(state, cx) })
        .bg(t.solid).text_color(t.solid_foreground).hover((s) => s.bg(t.solid).opacity(0.88)))
      .child(button("wallpaper-reset", WALLPAPER.reset, { kind: "plain", disabled: state.busy || (value?.path === DEFAULT_WALLPAPER.path && value.transparency === DEFAULT_TRANSPARENCY),
        onClick: (_e, cx) => { setShared(WALLPAPER_KEY, null); state.transparency.set_value(DEFAULT_TRANSPARENCY); state.error = null; cx.notify(); } })
        .text_color(t.foreground).hover((s) => s.bg(t.hover).text_color(t.foreground))))
    .when(Boolean(value), (el) => el
      .child(div().text_size(TEXT.label).text_color(t.dim).truncate().child(value.name))
      .child(view.row(t, WALLPAPER.transparency, WALLPAPER.transparencyAbout,
        h_flex().gap(12).items_center().child(div().w(34).text_right().text_size(TEXT.label).text_color(t.foreground).child(`${Math.round(value.transparency)}%`))
          .child(slider))))
    .when(Boolean(state.error), (el) => el.child(div().text_size(TEXT.label).text_color(t.blocked).child(state.error)))
    .when(Boolean(value), (el) => el.child(div().text_size(TEXT.label).text_color(t.dim)
      .child(shared("layout") === "BossGoat" ? WALLPAPER.saved : WALLPAPER.inactive)));
}

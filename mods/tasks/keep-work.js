// Park visible task agents before closing their panes; then restore keep, which parking clears.
import { exec, hc } from "herdr";

export async function keepWork(agents) {
  for (const k of agents) {
    if (k.attached) {
      const r = await exec("herdr-app", ["do", "terminal.park", "--terminal", k.address]);
      if (r.code !== 0) throw new Error(r.stderr || "Couldn't preserve the running agent.");
    }
    const r = await hc(["keep", k.address]);
    if (r.code !== 0) throw new Error(r.stderr || "Couldn't keep the running agent.");
  }
}

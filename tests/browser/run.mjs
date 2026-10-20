// Runs every browser harness sequentially (they share localhost:5500) and prints one summary line each.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = path.dirname(fileURLToPath(import.meta.url));
const suites = ["n1-search-picker.mjs", "n2-modal-calendar.mjs", "d4-savings-display.mjs", "u5b-search-regression.mjs", "ux1-property-routes.mjs", "ux2b-property-gallery.mjs", "ux2c-property-info.mjs", "ux3-booking-panel.mjs", "ux4a-calendar-parity.mjs", "ux4b-date-editor.mjs", "ux5-guest-editing.mjs", "ux6-search-calendar.mjs", "ux7a-card-navigation.mjs", "ux7b1-guest-corrections.mjs", "ux7b2-back-link.mjs", "ux7b2-property-save.mjs"];
let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(dir, s)], { encoding: "utf8", env: process.env });
  const out = (r.stdout || "") + (r.stderr || "");
  const summary = out.match(/\n(\d+\/\d+ passed)/)?.[1] || (/ALL PASS/.test(out) ? "ALL PASS" : null);
  const fails = [...out.matchAll(/^FAIL .*$/gm)].map((m) => m[0]);
  console.log(`${r.status === 0 ? "PASS" : "FAIL"}  ${s}  ${summary || "(no summary)"}`);
  for (const f of fails) console.log("      " + f.slice(0, 200));
  if (r.status !== 0) { failed += 1; if (!fails.length) console.log(out.split("\n").slice(-25).join("\n")); }
}
process.exit(failed ? 1 : 0);

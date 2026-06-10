/** Run the standalone parser on all 5 trackers and compare to the 08/06 oracle. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTracker } from "./parse-tracker";

const CACHE = join(process.cwd(), "qa/golden-oracle/.cache");
const OPTS = { asAt: "2026-06-08", fyStart: "2025-09-01", fyEnd: "2026-08-31" };

const ORACLE: Record<number, { rev: number; cos: number; gp: number }> = {
  19: { rev: 50222621.62, cos: 46258307.86, gp: 3964313.76 },
  8: { rev: 13730976.65, cos: 10492741.49, gp: 3238235.16 },
  27: { rev: 10447228.82, cos: 7626862.68, gp: 2820366.13 },
  7: { rev: 5542316.91, cos: 4553804.89, gp: 988512.02 },
  39: { rev: 4499896.88, cos: 3734959.55, gp: 764937.33 },
};

async function main() {
  const manifest = JSON.parse(readFileSync(join(CACHE, "manifest.json"), "utf8"));
  for (const f of manifest.files) {
    const res = await parseTracker(join(CACHE, f.savedAs), { projectId: f.projectId, projectName: f.projectName, fileName: f.fileName }, OPTS);
    const o = ORACLE[f.projectId];
    const dR = res.totals.realisedRev - o.rev, dC = res.totals.realisedCos - o.cos, dG = res.totals.realisedGp - o.gp;
    const tie = (d: number) => (Math.abs(d) < 1 ? "TIE" : Math.abs(d) < o.cos * 0.01 ? "~1%" : "OFF");
    console.log(`\n### ${res.projectName} (#${f.projectId})  lines=${res.totals.lineCount} realised=${res.totals.realisedCount}`);
    console.log(`  COS  golden=${res.totals.realisedCos.toFixed(2).padStart(15)}  oracle=${o.cos.toFixed(2).padStart(15)}  Δ=${dC.toFixed(2).padStart(12)} [${tie(dC)}]`);
    console.log(`  REV  golden=${res.totals.realisedRev.toFixed(2).padStart(15)}  oracle=${o.rev.toFixed(2).padStart(15)}  Δ=${dR.toFixed(2).padStart(12)} [${tie(dR)}]`);
    console.log(`  GP   golden=${res.totals.realisedGp.toFixed(2).padStart(15)}  oracle=${o.gp.toFixed(2).padStart(15)}  Δ=${dG.toFixed(2).padStart(12)} [${tie(dG)}]`);
    // category X cross-check vs sheet X (validates grouping)
    const bad = res.categories.filter((c) => c.sheetX != null && Math.abs(c.X - (c.sheetX ?? 0)) > 1);
    if (bad.length) console.log(`  ⚠ X≠sheetX for cats: ${bad.map((c) => `${c.number}(${c.X.toFixed(0)}≠${c.sheetX?.toFixed(0)})`).join(", ")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

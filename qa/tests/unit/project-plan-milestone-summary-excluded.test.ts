/**
 * Locks in that the bottom "Milestone" rollup/summary table some trackers
 * append below the WBS programme is NEVER imported as plan tasks.
 *
 * The Project Plan sheet ends the real programme (numbered WBS rows like
 * 1, 1.1, … 8.3), then — after a blank gap — repeats a high-level rollup
 * under a header row `Milestone | Start Date | Duration | End Date | Progress`
 * (e.g. "Project Initiation", "AC Installation", "Commissioning",
 * "Project Closure"). Those rollup rows carry dates but no WBS number, so
 * without an explicit guard they leak into `planTasks` as phantom tasks and
 * surface on the Execution board.
 *
 * The normalizer detects that summary header and excludes the header plus
 * every row that follows it. This must hold for ALL imports, so the test
 * runs the real Smart Import preview over a workbook that contains the block.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runSmartImportPreview } from "../../../server/lib/import";

const UNITRANS = "attached_assets/Unitrans_Brackenfell_Tracker_1779108373978.xlsm";

// Labels that appear ONLY in the bottom Milestone summary table for the
// Unitrans tracker (the rollup rows). None of these carry a WBS number.
const ROLLUP_ONLY_LABELS = [
  "Client Wall Civil Works",
  "IBR Roof Install",
  "Container Plinth Civils",
];

function workbook(relPath: string): Buffer {
  return fs.readFileSync(path.join(process.cwd(), relPath));
}

async function previewWorkbook(relPath: string, fileName: string) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    return await runSmartImportPreview(workbook(relPath), fileName);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

describe("Project Plan — bottom Milestone summary table is excluded", () => {
  it("imports the WBS programme but drops the bottom Milestone rollup rows", async () => {
    const preview = await previewWorkbook(UNITRANS, "Unitrans_Brackenfell_Tracker.xlsm");
    const tasks = preview.normalization.planTasks;

    // The real programme still imports.
    expect(tasks.length).toBeGreaterThan(10);

    // Every imported plan task carries a WBS number — the summary rollup rows
    // (which have none) must not be present.
    const numberedRows = tasks.filter((t) => t.taskNo && String(t.taskNo).trim());
    expect(numberedRows.length).toBe(tasks.length);

    // The rollup-only labels (which exist solely under the Milestone summary
    // header) must not appear among the imported tasks.
    const names = new Set(tasks.map((t) => (t.taskName || "").trim()));
    for (const label of ROLLUP_ONLY_LABELS) {
      expect(names.has(label), `rollup label "${label}" must not be imported`).toBe(false);
    }
  });

  it("still imports the real WBS rows that share a name with a rollup milestone", async () => {
    // "Project Initiation", "AC Installation", "Commissioning" etc. appear BOTH
    // as a numbered WBS parent (real plan) AND as a rollup row (summary). The
    // numbered WBS version must survive; only the summary copy is dropped.
    const preview = await previewWorkbook(UNITRANS, "Unitrans_Brackenfell_Tracker.xlsm");
    const tasks = preview.normalization.planTasks;

    const initiation = tasks.filter((t) => (t.taskName || "").trim() === "AC Installation");
    expect(initiation.length).toBe(1);
    expect(initiation[0].taskNo).toBeTruthy();
  });
});

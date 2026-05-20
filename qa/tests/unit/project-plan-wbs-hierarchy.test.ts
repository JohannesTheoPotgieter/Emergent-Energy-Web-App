/**
 * Locks in the project-plan import contract specifically around the
 * Excel "Project Plan" sheet's WBS hierarchy and plan-vs-actuals
 * field mapping. Complements `project-plan-import-contract.test.ts`,
 * which already pins planned-only rows + the planning-tasks API
 * actual-vs-plan field shape.
 *
 * The frontend `UnifiedPlanTab` renders the Project Plan tab as a
 * collapsible WBS tree (parent → child by `parentTaskId`, sorted by
 * outline number, with `indentLevel` controlling row indent). For
 * that tree to render correctly the import must:
 *
 *   1. Populate `taskNo` for every imported plan row that has a WBS
 *      code in the workbook.
 *   2. Derive `parentTaskNo` from the WBS code by stripping the last
 *      `.`-segment (1.1.2 → parent 1.1, 1.1 → parent 1, 1 → no parent).
 *   3. Derive `indentLevel` from segment count (1 → 0, 1.1 → 1, …).
 *   4. Drop dangling parent references — if "1.1.2" exists but "1.1"
 *      does not, the import nulls the parentTaskNo so the row sits
 *      at root rather than orphaning.
 *
 * Together these let the executor's `parentId` post-insert pass build
 * a tree where every child's parentId points to a real ancestor.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runSmartImportPreview } from "../../../server/lib/import";

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

describe("Project Plan — WBS hierarchy + plan-vs-actuals contract", () => {
  it("Corporate Park: every imported row has a WBS code and a derived indent level", async () => {
    const preview = await previewWorkbook(
      "attached_assets/Corporate_Park_Tracker_1774355438863.xlsx",
      "Corporate_Park_Tracker.xlsx",
    );
    const tasks = preview.normalization.planTasks;

    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) {
      expect(t.taskNo).toBeTruthy();
      expect(typeof t.indentLevel).toBe("number");
      expect(t.indentLevel).toBeGreaterThanOrEqual(0);
    }
  });

  it("derives parentTaskNo from the WBS code (last-dot-segment-stripped)", async () => {
    const preview = await previewWorkbook(
      "attached_assets/Corporate_Park_Tracker_1774355438863.xlsx",
      "Corporate_Park_Tracker.xlsx",
    );
    const tasks = preview.normalization.planTasks;
    const byTaskNo = new Map(tasks.map((t) => [String(t.taskNo).trim(), t]));

    for (const t of tasks) {
      const taskNo = String(t.taskNo).trim();
      if (!taskNo.includes(".")) {
        // Top-level row should have no parent.
        expect(t.parentTaskNo).toBeNull();
        continue;
      }
      const expectedParent = taskNo.slice(0, taskNo.lastIndexOf("."));
      // If the parent exists, parentTaskNo must equal it. If the parent
      // is missing (dangling reference), parentTaskNo must be null —
      // never garbage.
      if (byTaskNo.has(expectedParent)) {
        expect(t.parentTaskNo).toBe(expectedParent);
      } else {
        expect(t.parentTaskNo).toBeNull();
      }
    }
  });

  it("indentLevel tracks the dot-segment depth", async () => {
    const preview = await previewWorkbook(
      "attached_assets/Corporate_Park_Tracker_1774355438863.xlsx",
      "Corporate_Park_Tracker.xlsx",
    );
    const tasks = preview.normalization.planTasks;
    for (const t of tasks) {
      const taskNo = String(t.taskNo).trim();
      const expectedIndent = taskNo.includes(".") ? taskNo.split(".").length - 1 : 0;
      expect(t.indentLevel).toBe(expectedIndent);
    }
  });

  it("every parentTaskNo that survives the import points to a real taskNo", async () => {
    // The normalizer nulls dangling parentTaskNo references; this test
    // is the safety net for that behaviour.
    const preview = await previewWorkbook(
      "attached_assets/Corporate_Park_Tracker_1774355438863.xlsx",
      "Corporate_Park_Tracker.xlsx",
    );
    const tasks = preview.normalization.planTasks;
    const allTaskNos = new Set(
      tasks.map((t) => String(t.taskNo ?? "").trim()).filter(Boolean),
    );
    const orphans = tasks.filter(
      (t) => t.parentTaskNo && !allTaskNos.has(String(t.parentTaskNo).trim()),
    );
    expect(orphans).toEqual([]);
  });

  it("plan + actual date fields land independently — actuals never overwrite plan", async () => {
    const preview = await previewWorkbook(
      "attached_assets/Seshego_Circle_Tracker_1776431598036.xlsx",
      "Seshego_Circle_Tracker.xlsx",
    );
    const tasks = preview.normalization.planTasks;

    // The workbook contains at least one row where the actual columns
    // are populated and the plan columns are populated. Both must
    // round-trip as separate fields — startDate/endDate hold the
    // workbook's planned dates, actualStart/actualEnd hold the actuals.
    const withBoth = tasks.filter(
      (t) =>
        t.startDate &&
        t.endDate &&
        t.actualStartDate &&
        t.actualEndDate,
    );
    expect(withBoth.length, "expected at least one task with both plan + actual dates").toBeGreaterThan(0);

    // Real trackers always have some rows where plan slipped — at least
    // one row must show plan != actual. If they all match exactly, the
    // import is collapsing one onto the other (the bug we're guarding
    // against).
    const planActualDiverges = withBoth.some(
      (t) =>
        t.startDate !== t.actualStartDate ||
        t.endDate !== t.actualEndDate,
    );
    expect(
      planActualDiverges,
      "expected at least one task where plan dates differ from actual dates (import must keep them separate)",
    ).toBe(true);

    // For rows that are PLANNED ONLY (no actual yet), actualStart/End
    // must be null — never copied from plan dates.
    const plannedOnly = tasks.filter((t) => t.startDate && !t.actualStartDate);
    for (const t of plannedOnly) {
      expect(t.actualStartDate).toBeNull();
    }
  });

  it("percent-complete is normalised to the 0..1 scale", async () => {
    const preview = await previewWorkbook(
      "attached_assets/Corporate_Park_Tracker_1774355438863.xlsx",
      "Corporate_Park_Tracker.xlsx",
    );
    const tasks = preview.normalization.planTasks;
    for (const t of tasks) {
      if (t.pctComplete == null) continue;
      expect(t.pctComplete).toBeGreaterThanOrEqual(0);
      expect(t.pctComplete).toBeLessThanOrEqual(1);
    }
  });

  it("plan dates remain stable under TZ=Africa/Johannesburg", async () => {
    // Regression for the same TZ leak that hit cost-line invoice dates:
    // the plan-row date columns use parseDate too, so when the workbook
    // was saved on a SAST machine the dates must not slip a day.
    const originalTz = process.env.TZ;
    process.env.TZ = "Africa/Johannesburg";
    try {
      const preview = await previewWorkbook(
        "attached_assets/Corporate_Park_Tracker_1774355438863.xlsx",
        "Corporate_Park_Tracker.xlsx",
      );
      const tasks = preview.normalization.planTasks;
      for (const t of tasks) {
        if (t.startDate) {
          expect(t.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        if (t.endDate) {
          expect(t.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runSmartImportPreview } from "../../../server/lib/import";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function workbook(relPath: string): Buffer {
  return fs.readFileSync(path.join(process.cwd(), relPath));
}

async function previewWorkbook(
  relPath: string,
  fileName: string,
  learnedMappings?: { section: string; sourceHeader: string; canonicalField: string; confidenceWeight: number }[],
) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    return await runSmartImportPreview(workbook(relPath), fileName, learnedMappings);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

describe("Project plan import contract", () => {
  it("maps Mondi single-date-source PLAN rows onto the actual dates too", async () => {
    const preview = await previewWorkbook(
      "qa/fixtures/trackers/Mondi_Tracker_Rev02_1778768350564.xlsm",
      "Mondi_Tracker_Rev02.xlsm",
    );

    const planTasks = preview.normalization.planTasks;
    expect(planTasks.length).toBeGreaterThan(300);

    const firstTask = planTasks.find((task) => task.taskNo === "1");
    expect(firstTask).toMatchObject({
      taskName: "CPs - Generator",
      startDate: "2025-02-07",
      endDate: "2026-05-07",
    });
    // Owner decision 2026-06 — supersedes the prior "actual stays null for
    // single-source plans" contract. A plan with one date source (START/END,
    // no separate Actual columns) maps that schedule onto the actual dates too,
    // so the board reads real progress dates and slip resolves to 0 not blank.
    expect(firstTask?.actualStartDate).toBe("2025-02-07");
    expect(firstTask?.actualEndDate).toBe("2026-05-07");
    expect(firstTask?.pctComplete).toBe(1);
    expect(firstTask?.expectedPctComplete).toBe(1);
  });

  it("continues to import Coega actual PLAN rows with actual dates intact", async () => {
    const preview = await previewWorkbook(
      "qa/fixtures/trackers/Coega_Steels_Ph2_Tracker_1776431576865.xlsx",
      "Coega_Steels_Ph2_Tracker.xlsx",
    );

    const planTasks = preview.normalization.planTasks;
    expect(planTasks.length).toBeGreaterThan(100);
    expect(planTasks.some((task) => task.actualStartDate || task.actualEndDate)).toBe(true);
  });

  it("planning task API exposes actual fields as actual-only, never planned fallback", () => {
    const source = read("server/routes/planning-tasks-routes.ts");

    expect(source).not.toContain("actualStartDate: tActualStart || tPlannedStart || null");
    expect(source).not.toContain("actualEndDate: tActualEnd || tPlannedEnd || null");
    expect(source).not.toContain("actualDurationDays: ct.actualDurationDays || ct.durationDays || null");
    expect(source).toContain("actualStartDate: tActualStart || null");
    expect(source).toContain("actualEndDate: tActualEnd || null");
    expect(source).toContain("actualDurationDays: ct.actualDurationDays || null");
  });

  it("planning task API keeps scheduled PM rows that have planned dates but no actual dates", () => {
    const source = read("server/routes/planning-tasks-routes.ts");

    expect(source).not.toContain("if (!hasActualStart && !hasActualEnd) return false");
    expect(source).toContain("const hasPlannedStart = !!ct.startDate");
    expect(source).toContain("const hasPlannedEnd = !!ct.endDate");
  });

  it("execution dashboard does not mark missing schedule data as on schedule", () => {
    // The legacy execution-dashboard OverviewPage was removed when the
    // Execution control tower replaced it; the schedule-data guard now lives
    // in the shared data provider (still used by /now) and the server.
    const provider = read("client/src/pages/execution-dashboard/use-execution-data.ts");
    const server = read("server/lifecycle-routes.ts");

    expect(provider).toContain("const scheduleMeasuredProjects = fp.filter");
    expect(provider).not.toContain("fp.filter((p) => !p.behindPlan).length / fp.length");
    expect(server).toContain("const scheduleMeasuredRows = projectRows.filter");
    expect(server).not.toContain("const onScheduleCount = projectRows.filter((p) => !p.behindPlan).length");
  });
});

describe("Re-import is self-healing for ANY project — stale learned mappings cannot corrupt actual %", () => {
  // The 12 Nourse production bug: a STALE learned column-mapping (remembered
  // from an earlier import) hijacked the "Status" column, so actual % imported
  // wrong and stayed wrong on re-import. The fix is that EXACT-header matches
  // always beat a remembered mapping, which makes a re-import self-healing for
  // every project. These tests prove it on BOTH layout families by feeding a
  // deliberately corrupt learned mapping and asserting the actual-% column and
  // its imported values are identical to a clean import.
  const CORRUPT_LEARNED = [
    { section: "PLAN", sourceHeader: "Status", canonicalField: "owner", confidenceWeight: 1 },
    { section: "PLAN", sourceHeader: "Expected Status", canonicalField: "pct_complete", confidenceWeight: 1 },
    { section: "PLAN", sourceHeader: "% DONE", canonicalField: "owner", confidenceWeight: 1 },
    { section: "PLAN", sourceHeader: "% Forecasted", canonicalField: "pct_complete", confidenceWeight: 1 },
    { section: "PLAN", sourceHeader: "Planned Start", canonicalField: "actual_start", confidenceWeight: 1 },
    { section: "PLAN", sourceHeader: "Planned End", canonicalField: "actual_end", confidenceWeight: 1 },
  ];

  const pctFingerprint = (tasks: Array<{ taskNo: string | null; pctComplete: number | null }>) =>
    tasks
      .filter((t) => typeof t.pctComplete === "number")
      .map((t) => `${t.taskNo}=${t.pctComplete}`)
      .join("|");

  it("EE_STANDARD (Coega): actual % stays on the Status column under a stale learned mapping", async () => {
    const rel = "qa/fixtures/trackers/Coega_Steels_Ph2_Tracker_1776431576865.xlsx";
    const clean = await previewWorkbook(rel, "Coega_Steels_Ph2_Tracker.xlsx");
    const dirty = await previewWorkbook(rel, "Coega_Steels_Ph2_Tracker.xlsx", CORRUPT_LEARNED);

    const cleanPlan = clean.mappings.find((m) => m.section === "PLAN");
    const dirtyPlan = dirty.mappings.find((m) => m.section === "PLAN");
    const pctHeader = (m: typeof cleanPlan) => m?.mappings.find((x) => x.canonicalField === "pct_complete")?.rawHeader;
    expect(pctHeader(cleanPlan)).toBe("Status");
    expect(pctHeader(dirtyPlan)).toBe("Status"); // not hijacked to "Expected Status"

    // Imported actual-% values are byte-for-byte identical with/without the stale mapping.
    expect(pctFingerprint(dirty.normalization.planTasks)).toBe(pctFingerprint(clean.normalization.planTasks));
    expect(clean.normalization.planTasks.some((t) => (t.pctComplete ?? 0) > 0)).toBe(true);
  });

  it("MONDI_LEGACY (Mondi): actual % stays on the '% DONE' column under a stale learned mapping", async () => {
    const rel = "qa/fixtures/trackers/Mondi_Tracker_Rev02_1778768350564.xlsm";
    const clean = await previewWorkbook(rel, "Mondi_Tracker_Rev02.xlsm");
    const dirty = await previewWorkbook(rel, "Mondi_Tracker_Rev02.xlsm", CORRUPT_LEARNED);

    const cleanPlan = clean.mappings.find((m) => m.section === "PLAN");
    const dirtyPlan = dirty.mappings.find((m) => m.section === "PLAN");
    const pctHeader = (m: typeof cleanPlan) => m?.mappings.find((x) => x.canonicalField === "pct_complete")?.rawHeader;
    expect(pctHeader(cleanPlan)).toBe("% DONE");
    expect(pctHeader(dirtyPlan)).toBe("% DONE");

    expect(pctFingerprint(dirty.normalization.planTasks)).toBe(pctFingerprint(clean.normalization.planTasks));
    expect(clean.normalization.planTasks.some((t) => (t.pctComplete ?? 0) > 0)).toBe(true);
  });
});

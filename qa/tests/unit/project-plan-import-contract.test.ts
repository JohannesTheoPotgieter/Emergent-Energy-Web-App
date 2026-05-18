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

describe("Project plan import contract", () => {
  it("imports Mondi planned-only PLAN rows instead of dropping them for blank actual dates", async () => {
    const preview = await previewWorkbook(
      "attached_assets/Mondi_Tracker_Rev02_1778768350564.xlsm",
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
    expect(firstTask?.actualStartDate).toBeNull();
    expect(firstTask?.actualEndDate).toBeNull();
    expect(firstTask?.pctComplete).toBe(1);
    expect(firstTask?.expectedPctComplete).toBe(1);
  });

  it("continues to import Coega actual PLAN rows with actual dates intact", async () => {
    const preview = await previewWorkbook(
      "attached_assets/Coega_Steels_Ph2_Tracker_1776431576865.xlsx",
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
    const overview = read("client/src/pages/execution-dashboard/OverviewPage.tsx");
    const provider = read("client/src/pages/execution-dashboard/use-execution-data.ts");
    const server = read("server/lifecycle-routes.ts");

    expect(overview).not.toContain("const onSchedule = !p.behindPlan");
    expect(overview).toContain(
      "const hasScheduleData = p.actualProgressPct != null && p.expectedProgressPct != null",
    );
    expect(overview).toContain("No Schedule Data");
    expect(provider).toContain("const scheduleMeasuredProjects = fp.filter");
    expect(provider).not.toContain("fp.filter((p) => !p.behindPlan).length / fp.length");
    expect(server).toContain("const scheduleMeasuredRows = projectRows.filter");
    expect(server).not.toContain("const onScheduleCount = projectRows.filter((p) => !p.behindPlan).length");
  });
});

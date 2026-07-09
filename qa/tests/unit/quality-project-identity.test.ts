/**
 * Task 3.2 — unify project identity on projectId.
 *
 * Concrete slice: the /all-items project filter matched project names with a
 * strict `===` (case/whitespace-sensitive), and the startup backfill only
 * linked project_id for qc_checklist + deliverables. This pins the
 * case-insensitive filter and the extended backfill coverage. (Removing the
 * normalize/dedupe-by-name read paths is the larger follow-up.)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = fs.readFileSync(path.join(process.cwd(), "server/quality-routes.ts"), "utf8");
const BACKFILL = fs.readFileSync(path.join(process.cwd(), "server/lib/backfill-project-ids.ts"), "utf8");

describe("all-items project filter is case-insensitive (Task 3.2)", () => {
  it("normalizes both sides instead of a strict === on project name", () => {
    const handler = ROUTES.slice(
      ROUTES.indexOf('app.get("/api/quality/all-items"'),
      ROUTES.indexOf('app.get("/api/quality/checklists"'),
    );
    expect(handler).toContain("normalizeProjectName(cl.projectName) === normalizedFilter");
    expect(handler).not.toContain("cl.projectName === projectFilter");
  });
});

describe("projectId backfill covers the deprecated quality tables", () => {
  it("backfills qc_checklist, qc_warning, qc_plan_link, qc_postmortem, deliverables", () => {
    for (const table of ["qcChecklist", "qcWarning", "qcPlanLink", "qcPostmortem", "deliverables"]) {
      expect(BACKFILL).toContain(`db.update(${table})`);
    }
  });

  it("matches project name case/whitespace-insensitively and only fills nulls", () => {
    expect(BACKFILL).toContain("lower(btrim(");
    expect(BACKFILL).toMatch(/projectId} IS NULL/);
  });
});

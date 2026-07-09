/**
 * Task 2.1 — de-scan the three Quality aggregation endpoints.
 *
 * /api/quality/all-items, /checklists and /dashboard loaded whole tables
 * (qc_item_instance, qc_checklist, qc_risk_answer) and filtered in JS. They
 * now push the project scope into the SQL WHERE via a shared repository so a
 * scoped role loads only its projects' rows. The endpoints keep their existing
 * final scope filter (output unchanged). Source-contract test — a live DB is
 * not available in unit tests.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = fs.readFileSync(path.join(process.cwd(), "server/quality-routes.ts"), "utf8");
const REPO = fs.readFileSync(path.join(process.cwd(), "server/repositories/quality-dashboard-repository.ts"), "utf8");

function sliceHandler(marker: string, until: string): string {
  const start = ROUTES.indexOf(marker);
  const end = ROUTES.indexOf(until, start + 1);
  return ROUTES.slice(start, end === -1 ? start + 4000 : end);
}

describe("scoped-load repository", () => {
  it("scopes checklists by project_id (reliable NOT NULL FK, not the deprecated name)", () => {
    expect(REPO).toContain("inArray(qcChecklist.projectId, scopedIds)");
    expect(REPO).toContain("if (scopedIds === null) return db.select().from(qcChecklist)");
    expect(REPO).toContain("if (scopedIds.length === 0) return []");
  });

  it("scopes item instances + risk answers by checklist id", () => {
    expect(REPO).toContain("inArray(qcItemInstance.checklistId, scopedChecklistIds)");
    expect(REPO).toContain("inArray(qcRiskAnswer.checklistId, scopedChecklistIds)");
  });
});

describe("all-items scopes its reads", () => {
  const handler = sliceHandler('app.get("/api/quality/all-items"', 'app.get("/api/quality/checklists"');
  it("uses the scoped repository, not a bare whole-table select", () => {
    expect(handler).toContain("loadScopedChecklists(scopedIds)");
    expect(handler).toContain("loadScopedItemInstances(scopedIds");
    expect(handler).not.toMatch(/await db\.select\(\)\.from\(qcItemInstance\)\s*;/);
  });
});

describe("checklists scopes its reads", () => {
  const handler = sliceHandler('app.get("/api/quality/checklists"', 'app.get("/api/quality/dashboard"');
  it("uses the scoped repository for checklists, items and risk answers", () => {
    expect(handler).toContain("loadScopedChecklists(scopedIdsForChecklists)");
    expect(handler).toContain("loadScopedItemInstances(scopedIdsForChecklists");
    expect(handler).toContain("loadScopedRiskAnswers(scopedIdsForChecklists");
    expect(handler).not.toMatch(/await db\.select\(\)\.from\(qcItemInstance\)\s*;/);
    expect(handler).not.toMatch(/await db\.select\(\)\.from\(qcRiskAnswer\)\s*;/);
  });
});

describe("dashboard scopes its reads", () => {
  const handler = sliceHandler('app.get("/api/quality/dashboard"', "// ========== ");
  it("uses the scoped repository for checklists, items and risk answers", () => {
    expect(handler).toContain("loadScopedChecklists(dashboardScopedIds)");
    expect(handler).toContain("loadScopedItemInstances(dashboardScopedIds");
    expect(handler).toContain("loadScopedRiskAnswers(dashboardScopedIds");
    expect(handler).not.toMatch(/await db\.select\(\)\.from\(qcItemInstance\)\s*;/);
    expect(handler).not.toMatch(/await db\.select\(\)\.from\(qcRiskAnswer\)\s*;/);
  });
});

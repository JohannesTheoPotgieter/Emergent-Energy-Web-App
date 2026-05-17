import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("quality governance execution surfaces", () => {
  it("keeps the quality dashboard tied to existing routes while adding governance visibility", () => {
    const source = read("client/src/pages/qm-dashboard.tsx");

    expect(source).toContain("/api/quality/checklists");
    expect(source).toContain("/api/quality/all-items");
    expect(source).toContain("/api/quality/dashboard");
    expect(source).toContain("Overdue actions");
    expect(source).toContain("Failed QC");
    expect(source).toContain("Evidence gaps");
    expect(source).toContain("Blocked handover");
    expect(source).toContain("At-risk projects");
    // Governance drill-down is now first-class open-NCR visibility
    // (superseded the vestigial ?qualityItemId= deep link).
    expect(source).toContain("/api/quality/ncrs");
  });

  it("keeps the project quality tab on existing checklist and evidence flows while adding workspace drill-down", () => {
    const source = read("client/src/components/tabs/QualityTab.tsx");

    expect(source).toContain("/api/quality/project/${encodeURIComponent(projectName)}/checklist");
    expect(source).toContain("/api/quality/project/${encodeURIComponent(projectName)}/workspace");
    expect(source).toContain("/api/quality/project/${encodeURIComponent(projectName)}/item/${itemInstanceId}/send-for-approval");
    expect(source).toContain("Priority quality queue");
    expect(source).toContain("Relevant Microsoft-linked quality items");
    // Handover blocked copy moved to extracted QualityGovernanceSummary component
    expect(source).toContain("QualityGovernanceSummary");
  });

  it("keeps server quality routes additive with project-linked governance and microsoft context", () => {
    const routes = read("server/quality-routes.ts");
    const linkingService = read("server/project-linking-service.ts");
    const myWorkLinks = read("server/lib/my-work-source-links.ts");

    expect(routes).toContain('app.get("/api/quality/project/:projectName/workspace"');
    expect(routes).toContain('app.get("/api/quality/project/:projectName/summary"');
    expect(routes).toContain('app.get("/api/quality/all-items"');
    expect(routes).toContain('app.get("/api/quality/checklists"');
    expect(routes).toContain('app.get("/api/quality/dashboard"');
    expect(linkingService).toContain("qualityContext");
    expect(linkingService).toContain("linkedQualityItemInstanceId");
    expect(myWorkLinks).toContain("Open linked quality item");
  });

  it("exports canonical status constants and governance functions from shared/quality-governance.ts", () => {
    const governance = read("shared/quality-governance.ts");

    expect(governance).toContain("QUALITY_ITEM_STATUSES");
    expect(governance).toContain("VALID_QM_STATUS_TRANSITIONS");
    expect(governance).toContain("isValidQmStatusTransition");
    expect(governance).toContain("isQualityItemComplete");
    expect(governance).toContain("getApprovalBlockReason");
    expect(governance).toContain("evaluateChecklistHandoverReadiness");
    expect(governance).toContain("QualityChecklistReadiness");
  });

  it("uses canonical statuses and evidence filtering in quality routes", () => {
    const routes = read("server/quality-routes.ts");

    // Evidence queries filter by deletedAt
    expect(routes).toContain("isNull(qcItemEvidence.deletedAt)");
    // Uses canonical status constants instead of hardcoded array
    expect(routes).toContain("QUALITY_ITEM_STATUSES");
    // Evidence-required gate on approval
    expect(routes).toContain("evidence_required");
    expect(routes).toContain("getApprovalBlockReason");
    // Status transition validation
    expect(routes).toContain("isValidQmStatusTransition");
    // Workspace includes checklist readiness
    expect(routes).toContain("checklistReadiness");
  });

  it("has soft-delete columns on qcItemEvidence schema", () => {
    const schema = read("shared/schema/quality.ts");

    // qcItemEvidence must have deletedAt and deletedBy
    const evidenceTableStart = schema.indexOf('qcItemEvidence = pgTable("qc_item_evidence"');
    expect(evidenceTableStart).toBeGreaterThan(-1);
    const evidenceTableEnd = schema.indexOf("});", evidenceTableStart);
    const evidenceTableDef = schema.slice(evidenceTableStart, evidenceTableEnd + 3);
    expect(evidenceTableDef).toContain("deleted_at");
    expect(evidenceTableDef).toContain("deleted_by");
  });
});

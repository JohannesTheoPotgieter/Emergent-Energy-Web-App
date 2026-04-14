import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const financialQueuePage = readFileSync(resolve(process.cwd(), "client/src/pages/financial-review-queue.tsx"), "utf8");
const pmHandoverQueuePage = readFileSync(resolve(process.cwd(), "client/src/pages/pm-handover-review.tsx"), "utf8");
const approvalsPage = readFileSync(resolve(process.cwd(), "client/src/pages/admin-approvals.tsx"), "utf8");
const handoverRoutes = readFileSync(resolve(process.cwd(), "server/handover-routes.ts"), "utf8");
const financialService = readFileSync(resolve(process.cwd(), "server/services/financial-review-service.ts"), "utf8");

describe("live approval workflow actions", () => {
  it("wires financial review queue approve and reject decisions to existing backend endpoint", () => {
    expect(financialQueuePage).toContain('/financial-review/${reviewId}/approve');
    expect(financialQueuePage).toContain('outcome: "GO"');
    expect(financialQueuePage).toContain('outcome: "NO_GO"');
    expect(financialQueuePage).toContain('usePermission("pd_finance", "approve")');
  });

  it("wires PM handover review accept and reject actions to existing backend endpoint", () => {
    expect(pmHandoverQueuePage).toContain('/api/pd-pm-handover/${projectId}/${action}');
    expect(pmHandoverQueuePage).toContain('action: "accept"');
    expect(pmHandoverQueuePage).toContain('action: "reject"');
    expect(pmHandoverQueuePage).toContain('usePermission("handover", "approve")');
  });

  it("keeps PM approvals action buttons hidden for view-only users", () => {
    expect(approvalsPage).toContain("const { allowed: canApprove } = usePermission('approvals', 'approve');");
    expect(approvalsPage).toContain("View only");
    expect(approvalsPage).toContain("Permission required");
  });

  it("retains backend audit/event logging for handover and financial decisions", () => {
    expect(handoverRoutes).toContain('logAuditFromReq(req, { entityType: "pd_pm_handover"');
    expect(handoverRoutes).toContain('action: "accepted"');
    expect(handoverRoutes).toContain('action: "rejected"');

    expect(financialService).toContain("createProjectEvent({");
    expect(financialService).toContain("eventType: `financial_review.${params.outcome.toLowerCase()}`");
  });
});


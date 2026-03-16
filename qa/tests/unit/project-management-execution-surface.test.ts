import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("project management execution surfaces", () => {
  it("keeps the Project List execution view tracker-linked with Latest Update visible", () => {
    const source = read("client/src/pages/projects.tsx");

    expect(source).toContain('title="Project List"');
    expect(source).toContain('header: "Latest Update"');
    expect(source).toContain('key: "execution_attention"');
    expect(source).toContain("Tracker-fed schedule and finance fields remain authoritative here.");
    expect(source).toContain("Latest Update stays app-managed, text only, and visible for execution scanning.");
  });

  it("keeps the PM deliverables surface tied to existing deliverable, approval, and Microsoft routes", () => {
    const source = read("client/src/pages/pm-deliverables.tsx");

    expect(source).toContain('title="Deliverables"');
    expect(source).toContain("/api/projects-summary");
    expect(source).toContain("/api/deliverable-capture/list/");
    expect(source).toContain("/api/approvals/pending?showAll=true");
    expect(source).toContain("/api/ms-objects/project/");
    expect(source).toContain("Tracker-linked execution truth");
    expect(source).toContain("Latest Update remains the canonical text-only app update with history retained.");
  });

  it("keeps execution workflow toggles and assignment controls in the board and task drawer", () => {
    const boardView = read("client/src/components/BoardView.tsx");
    const taskDrawer = read("client/src/components/TaskDetailDrawer.tsx");

    expect(boardView).toContain("newTaskApprovalRequired");
    expect(boardView).toContain("newTaskDeliverableRequired");
    expect(boardView).toContain("withDeliverableRequirementTag");
    expect(taskDrawer).toContain('data-testid="checkbox-approval-required"');
    expect(taskDrawer).toContain('data-testid="checkbox-deliverable-required"');
    expect(taskDrawer).toContain("UserAssignmentPicker");
    expect(taskDrawer).toContain("Approval-required work must use Send for Approval.");
    expect(taskDrawer).toContain("Deliverable-required work must use Send Deliverable.");
  });

  it("keeps the PM approvals, board, and site controls pages execution-oriented", () => {
    const approvals = read("client/src/pages/admin-approvals.tsx");
    const board = read("client/src/pages/execution-board.tsx");
    const controls = read("client/src/pages/handover-control.tsx");

    expect(approvals).toContain("Execution approvals queue for post-handover delivery work.");
    expect(approvals).toContain("Approval-required items must use Send for Approval only.");
    expect(board).toContain("Work Plan / Board");
    expect(board).toContain("Post-handover execution view");
    expect(controls).toContain("Site / Execution Controls");
    expect(controls).toContain("Execution enablement and handover controls");
  });

  it("keeps the server touchpoints for project summary, assignments, deliverables, approvals, and Microsoft links", () => {
    const routes = read("server/routes.ts");
    const msSyncRoutes = read("server/ms-sync-routes.ts");
    const deliverableRoutes = read("server/deliverable-capture-routes.ts");
    const approvalsRoutes = read("server/approvals-routes.ts");

    expect(routes).toContain('app.get("/api/projects-summary"');
    expect(routes).toContain("project_pd_pm_handover");
    expect(msSyncRoutes).toContain('app.get("/api/ms-objects/project/:projectId"');
    expect(msSyncRoutes).toContain('app.patch("/api/tasks/reassign"');
    expect(deliverableRoutes).toContain('app.get("/api/deliverable-capture/list/:projectId"');
    expect(deliverableRoutes).toContain("setEntityAssignment");
    expect(approvalsRoutes).toContain('app.get("/api/approvals/pending"');
  });
});

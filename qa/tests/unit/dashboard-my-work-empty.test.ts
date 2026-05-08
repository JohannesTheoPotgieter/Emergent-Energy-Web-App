import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Defect 1 from the T1.x reporting trust audit: /api/dashboard/my-work
// previously returned hard-coded fixture rows ("Solar Farm Alpha",
// "INV-3442") to production. This test pins the route to an honest
// empty-state response until real per-user queries are wired up.
describe("/api/dashboard/my-work — no fixture data leak", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/dashboard-routes.ts"),
    "utf8",
  );

  it("does not reference the demo project name", () => {
    expect(source).not.toContain("Solar Farm Alpha");
  });

  it("does not reference the demo invoice number", () => {
    expect(source).not.toContain("INV-3442");
  });

  it("does not reference any of the demo task titles", () => {
    expect(source).not.toContain("Review delayed milestone");
    expect(source).not.toContain("Approve contractor invoice");
    expect(source).not.toContain("CAPEX change request #128");
    expect(source).not.toContain("@you in Engineering blocker thread");
  });

  it("returns empty arrays for every list field", () => {
    expect(source).toMatch(/overdueTasks:\s*\[\]/);
    expect(source).toMatch(/dueTodayTasks:\s*\[\]/);
    expect(source).toMatch(/upcomingTasks:\s*\[\]/);
    expect(source).toMatch(/pendingApprovals:\s*\[\]/);
    expect(source).toMatch(/recentMentions:\s*\[\]/);
    expect(source).toMatch(/assignedProjects:\s*\[\]/);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("finance analysis hardening", () => {
  it("registers finance analysis routes in the startup chain", () => {
    const startup = read("server/bootstrap/startup-orchestrator.ts");
    const allRoutes = read("server/routes/register-all-routes.ts");
    const deptRoutes = read("server/routes/register-department-routes.ts");

    expect(startup).toContain('registerAllRoutes({');
    expect(allRoutes).toContain("await registerDepartmentRoutes(app);");
    expect(deptRoutes).toContain('registerFinanceAnalysisRoutes(app);');
  });

  it("keeps finance analysis endpoints role-gated and tolerance writes restricted", () => {
    const source = read("server/routes/finance-analysis.routes.ts");
    const cosPageSource = read("client/src/pages/cos-analysis.tsx");
    // Server side: every endpoint runs through the entity-registry
    // `requirePermission` gate (cashflow:view, cos:view, cos:override).
    // The tolerance PUT specifically uses cos:override which the registry
    // pins to COO / CEO / CFO / PROGRAM_FINANCE_MANAGER — same set as the
    // legacy hardcoded TOLERANCE_WRITE_ROLES list.
    expect(source).toContain('requirePermission("cashflow", "view")');
    expect(source).toContain('requirePermission("cos", "view")');
    expect(source).toContain('requirePermission("cos", "override")');
    // Client side: page-level guard mirrors the registry's cos:override
    // role set so the UI doesn't expose the tolerance edit button to
    // unauthorised users.
    expect(cosPageSource).toContain('const { user } = useAuth();');
    expect(cosPageSource).toContain('const canEditTolerance = ["COO_ADMIN", "CEO_ADMIN", "CFO", "PROGRAM_FINANCE_MANAGER"].includes(');
    expect(cosPageSource).toContain('if (!canEditTolerance) throw new Error("You are not allowed to update tolerance bands.");');
  });

  it("keeps snapshot effectiveTo null guards on finance snapshot reads", () => {
    const repo = read("server/repositories/finance-analysis-repository.ts");
    expect(repo).toContain("isNull(normalizedRevenueLines.effectiveTo)");
    expect(repo).toContain("isNull(normalizedCostLines.effectiveTo)");
    expect(repo).toContain("isNull(projectRevenueSummary.effectiveTo)");
    expect(repo).toContain("isNull(cashflowPoints.effectiveTo)");
  });
});

/**
 * Smart Import — Commit Path Persistence Tests (S09, S10, S11, S22)
 *
 * Verifies:
 * 1. S22: Emergency v1 mode is COO-only (backend + frontend)
 * 2. S09: category_revenue_allocations written on v2 commit
 * 3. S10: category_key and category_allocation_id set on NCL rows
 * 4. S11: pre_import_snapshot captured before plan writes
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// S22: Emergency v1 mode restriction
// ---------------------------------------------------------------------------
describe("S22: Emergency v1 mode COO-only restriction", () => {
  const routesCode = read("server/smart-import-routes.ts");
  const frontendCode = read("client/src/pages/smart-import.tsx");

  it("backend checks for emergencyV1Mode parameter", () => {
    expect(routesCode).toContain("emergencyV1Mode");
    expect(routesCode).toContain("req.body?.emergencyV1Mode === true");
  });

  it("backend also accepts legacy skipV2ConflictCheck for backward compat", () => {
    expect(routesCode).toContain("req.body?.skipV2ConflictCheck === true");
  });

  it("backend rejects non-COO users with 403", () => {
    expect(routesCode).toContain("emergency_v1_coo_only");
    expect(routesCode).toContain('userRole === "COO_ADMIN"');
  });

  it("backend requires justification reason with minimum length", () => {
    expect(routesCode).toContain("emergency_v1_reason_required");
    expect(routesCode).toContain("reason.trim().length < 20");
  });

  it("backend logs emergency v1 usage to audit", () => {
    expect(routesCode).toContain('"emergency_v1_mode"');
  });

  it("frontend defines isCOO check separate from isAdmin", () => {
    expect(frontendCode).toContain('const isCOO = companyRole === "COO_ADMIN"');
  });

  it("frontend wraps v1 toggle in isCOO conditional render", () => {
    expect(frontendCode).toContain("{isCOO && (");
  });

  it("frontend v1 toggle is labeled as emergency/COO-only", () => {
    expect(frontendCode).toContain("Emergency v1 (COO only)");
  });

  it("frontend sends emergencyV1Mode and reason in commit request", () => {
    expect(frontendCode).toContain("emergencyV1Mode: true");
    expect(frontendCode).toContain("emergencyV1Reason:");
  });

  it("frontend does NOT send old skipV2ConflictCheck directly", () => {
    // The frontend should use the new parameter name, not the old one
    expect(frontendCode).not.toContain("skipV2ConflictCheck: true");
  });
});

// ---------------------------------------------------------------------------
// S09: Write category_revenue_allocations on v2 commit
// ---------------------------------------------------------------------------
describe("S09: category_revenue_allocations persistence", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("imports categoryRevenueAllocations from schema", () => {
    expect(routesCode).toContain("categoryRevenueAllocations,");
  });

  it("imports normalizeCategoryKey from normalizer", () => {
    expect(routesCode).toContain('import { normalizeCategoryKey } from "./lib/import/normalizer"');
  });

  it("soft-closes existing active allocations before inserting new ones", () => {
    expect(routesCode).toContain("tx.update(categoryRevenueAllocations)");
    expect(routesCode).toContain("effectiveTo: commitTimestamp");
  });

  it("inserts new allocation rows with correct confidence classification", () => {
    expect(routesCode).toContain("tx.insert(categoryRevenueAllocations).values(");
    expect(routesCode).toContain('"DIRECT"');
    expect(routesCode).toContain('"HEADER_ERROR_POSITIONAL"');
    expect(routesCode).toContain('"PROVISIONAL"');
  });

  it("reads categoryAllocations from normalization result", () => {
    expect(routesCode).toContain("norm.categoryAllocations");
  });

  it("builds catAllocIdByKey map for S10 FK resolution", () => {
    expect(routesCode).toContain("catAllocIdByKey.set(ca.categoryKey, inserted.id)");
  });
});

// ---------------------------------------------------------------------------
// S10: Populate category_key and category_allocation_id on NCL
// ---------------------------------------------------------------------------
describe("S10: NCL category_key population", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("fetches ALL active NCL rows for the project (including UNCHANGED)", () => {
    // Must select active rows broadly, not just those from this import run
    expect(routesCode).toContain("normalizedCostLines.projectId, projectId");
    expect(routesCode).toContain("isNull(normalizedCostLines.effectiveTo)");
  });

  it("builds lookup from both stripped name and full key", () => {
    expect(routesCode).toContain("catNameToKeyId.set(ca.categoryName.toLowerCase()");
    expect(routesCode).toContain("catNameToKeyId.set(ca.categoryKey.toLowerCase()");
  });

  it("updates category_key on rows that need it", () => {
    expect(routesCode).toContain("categoryKey: match.key");
    expect(routesCode).toContain("categoryAllocationId: match.id");
  });

  it("handles rows that already have categoryKey but missing FK", () => {
    expect(routesCode).toContain("!row.categoryKey");
  });
});

// ---------------------------------------------------------------------------
// S11: Pre-import work_items snapshot
// ---------------------------------------------------------------------------
describe("S11: pre-import work_items snapshot", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("captures snapshot BEFORE plan write", () => {
    // The snapshot code must appear before writePlanIncremental
    const snapshotIdx = routesCode.indexOf("preImportSnapshot");
    const planWriteIdx = routesCode.indexOf("writePlanIncremental({");
    expect(snapshotIdx).toBeGreaterThan(-1);
    expect(planWriteIdx).toBeGreaterThan(-1);
    expect(snapshotIdx).toBeLessThan(planWriteIdx);
  });

  it("stores snapshot as JSON in smart_import_runs.preImportSnapshot", () => {
    expect(routesCode).toContain("preImportSnapshot: snapshotRows");
  });

  it("includes key fields in the snapshot", () => {
    const block = routesCode.slice(
      routesCode.indexOf("const snapshotRows = planRows.map"),
      routesCode.indexOf("const snapshotRows = planRows.map") + 900,
    );
    expect(block).toContain("taskName:");
    expect(block).toContain("status:");
    expect(block).toContain("pctComplete:");
    expect(block).toContain("startDate:");
    expect(block).toContain("endDate:");
    expect(block).toContain("importRunId:");
  });

  it("is non-blocking (catches errors)", () => {
    expect(routesCode).toContain("Pre-import snapshot failed (non-blocking)");
  });

  it("only runs when there are existing plan rows", () => {
    expect(routesCode).toContain("if (planRows.length > 0)");
  });
});

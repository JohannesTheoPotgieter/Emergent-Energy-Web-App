/**
 * Smart Import — Commit Path Persistence Tests (S09, S10, S11, S22)
 *
 * Verifies:
 * 1. S22: v1 fallback path removed; commit fails fast when projectId missing
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
// S22: v1 fallback path removed — v2 is always-on
// ---------------------------------------------------------------------------
describe("S22: v1 fallback removed; v2 is always-on", () => {
  const routesCode = read("server/smart-import-routes.ts");
  const frontendCode = read("client/src/pages/smart-import.tsx");

  it("backend has no emergencyV1Mode handling", () => {
    expect(routesCode).not.toContain("emergencyV1Mode");
    expect(routesCode).not.toContain("emergency_v1_coo_only");
    expect(routesCode).not.toContain("emergency_v1_reason_required");
    expect(routesCode).not.toContain("emergency_v1_mode");
  });

  it("backend has no skipV2ConflictCheck handling", () => {
    expect(routesCode).not.toContain("skipV2ConflictCheck");
  });

  it("backend has no useV2 branching", () => {
    expect(routesCode).not.toContain("useV2");
  });

  it("backend fails fast when projectId is missing before commit", () => {
    expect(routesCode).toContain("project_id_missing");
    expect(routesCode).toContain(
      "Smart Import requires a resolved project_info.id before commit. Ensure the upsert pass ran first.",
    );
  });

  it("frontend sends no emergencyV1Mode or skipV2ConflictCheck flags", () => {
    expect(frontendCode).not.toContain("emergencyV1Mode");
    expect(frontendCode).not.toContain("emergencyV1Reason");
    expect(frontendCode).not.toContain("skipV2ConflictCheck");
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

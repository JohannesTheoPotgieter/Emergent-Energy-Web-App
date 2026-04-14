import { describe, expect, it } from "vitest";
import {
  WRITE_AUTHORITY_REGISTRY,
  LEGACY_ONLY_COST_FIELDS,
  LEGACY_ONLY_REVENUE_FIELDS,
  BLOCKED_WRITE_TARGETS,
  requiresBridgeSync,
  isWriteBlocked,
} from "../../../server/policies/write-authority";
import {
  requireProjectId,
  MissingProjectIdError,
} from "../../../server/policies/finance-policy";
import fs from "node:fs";
import path from "node:path";

const serverDir = path.join(process.cwd(), "server");

// ===========================================================================
// Write Cutover Validation Tests
//
// These tests validate POLICY ADOPTION by importing the actual policy modules
// and checking their exports, types, and values. Source-file assertions use
// fs.readFileSync only for modules that depend on a live DB and therefore
// cannot be imported directly in a unit test.
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. Write Authority Policy (server/policies/write-authority.ts)
// ---------------------------------------------------------------------------
describe("Write Authority Policy", () => {
  it("WRITE_AUTHORITY_REGISTRY is a non-empty array", () => {
    expect(Array.isArray(WRITE_AUTHORITY_REGISTRY)).toBe(true);
    expect(WRITE_AUTHORITY_REGISTRY.length).toBeGreaterThan(0);
  });

  it("WRITE_AUTHORITY_REGISTRY covers all core write targets", () => {
    const targets = WRITE_AUTHORITY_REGISTRY.map((r) => r.target);
    expect(targets).toContain("normalized_cost_lines");
    expect(targets).toContain("normalized_revenue_lines");
    expect(targets).toContain("project_info");
    expect(targets).toContain("finance.cost_lines");
    expect(targets).toContain("finance.revenue_lines");
  });

  it("promoted tables are bridge_only authority", () => {
    const costBridge = WRITE_AUTHORITY_REGISTRY.find(
      (r) => r.target === "finance.cost_lines",
    );
    const revBridge = WRITE_AUTHORITY_REGISTRY.find(
      (r) => r.target === "finance.revenue_lines",
    );
    expect(costBridge?.authority).toBe("bridge_only");
    expect(revBridge?.authority).toBe("bridge_only");
  });

  it("legacy tables use write_service authority", () => {
    const cost = WRITE_AUTHORITY_REGISTRY.find(
      (r) => r.target === "normalized_cost_lines",
    );
    const rev = WRITE_AUTHORITY_REGISTRY.find(
      (r) => r.target === "normalized_revenue_lines",
    );
    expect(cost?.authority).toBe("write_service");
    expect(rev?.authority).toBe("write_service");
  });

  it("every registry entry has a writeService path", () => {
    for (const entry of WRITE_AUTHORITY_REGISTRY) {
      expect(entry.writeService).toBeTruthy();
      expect(entry.writeService.length).toBeGreaterThan(0);
    }
  });

  it("BLOCKED_WRITE_TARGETS is an empty (or string-typed) list post PE/PI cutover", () => {
    // program_expense and program_inflow were removed from the block list
    // when the tables were retired. The array stays as infrastructure so
    // future cutovers can add entries while in flight.
    expect(Array.isArray(BLOCKED_WRITE_TARGETS)).toBe(true);
    expect(BLOCKED_WRITE_TARGETS).not.toContain("program_expense");
    expect(BLOCKED_WRITE_TARGETS).not.toContain("program_inflow");
  });

  it("isWriteBlocked returns false for former legacy targets after cutover", () => {
    expect(isWriteBlocked("program_expense")).toBe(false);
    expect(isWriteBlocked("program_inflow")).toBe(false);
    expect(isWriteBlocked("normalized_cost_lines")).toBe(false);
    expect(isWriteBlocked("project_info")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Legacy-Only Fields
// ---------------------------------------------------------------------------
describe("Legacy-Only Fields", () => {
  it("LEGACY_ONLY_COST_FIELDS is non-empty", () => {
    expect(LEGACY_ONLY_COST_FIELDS.length).toBeGreaterThan(0);
  });

  it("LEGACY_ONLY_COST_FIELDS includes patternRuleId", () => {
    expect(LEGACY_ONLY_COST_FIELDS).toContain("patternRuleId");
  });

  it("LEGACY_ONLY_COST_FIELDS includes adminDateOverride", () => {
    expect(LEGACY_ONLY_COST_FIELDS).toContain("adminDateOverride");
  });

  it("LEGACY_ONLY_COST_FIELDS includes counterpartyId", () => {
    expect(LEGACY_ONLY_COST_FIELDS).toContain("counterpartyId");
  });

  it("LEGACY_ONLY_REVENUE_FIELDS is non-empty", () => {
    expect(LEGACY_ONLY_REVENUE_FIELDS.length).toBeGreaterThan(0);
  });

  it("LEGACY_ONLY_REVENUE_FIELDS includes adminDateOverride", () => {
    expect(LEGACY_ONLY_REVENUE_FIELDS).toContain("adminDateOverride");
  });

  it("requiresBridgeSync returns false for legacy-only cost fields", () => {
    expect(requiresBridgeSync("cost", "patternRuleId")).toBe(false);
    expect(requiresBridgeSync("cost", "adminDateOverride")).toBe(false);
    expect(requiresBridgeSync("cost", "counterpartyId")).toBe(false);
  });

  it("requiresBridgeSync returns true for promoted cost fields", () => {
    expect(requiresBridgeSync("cost", "amount")).toBe(true);
    expect(requiresBridgeSync("cost", "description")).toBe(true);
  });

  it("requiresBridgeSync returns false for legacy-only revenue fields", () => {
    expect(requiresBridgeSync("revenue", "adminDateOverride")).toBe(false);
  });

  it("requiresBridgeSync returns true for promoted revenue fields", () => {
    expect(requiresBridgeSync("revenue", "amount")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Finance Line Write Service Exports
// ---------------------------------------------------------------------------
describe("Finance Line Write Service Exports", () => {
  const svcPath = path.join(serverDir, "services/finance-line-write-service.ts");
  const svcSource = fs.readFileSync(svcPath, "utf8");

  const expectedCostExports = [
    "createCostLine",
    "createCostLines",
    "updateCostLineFields",
    "softCloseCostLinesByProject",
  ];

  const expectedRevenueExports = [
    "createRevenueLine",
    "createRevenueLines",
    "updateRevenueLineFields",
    "softCloseRevenueLinesByProject",
  ];

  const expectedBulkExports = [
    "renameCostLineCounterparty",
    "batchSyncFinanceLines",
  ];

  for (const name of expectedCostExports) {
    it(`exports cost line function: ${name}`, () => {
      expect(svcSource).toContain(`export async function ${name}`);
    });
  }

  for (const name of expectedRevenueExports) {
    it(`exports revenue line function: ${name}`, () => {
      expect(svcSource).toContain(`export async function ${name}`);
    });
  }

  for (const name of expectedBulkExports) {
    it(`exports bulk operation: ${name}`, () => {
      expect(svcSource).toContain(`export async function ${name}`);
    });
  }

  it("all write functions accept txOrDb parameter for transaction support", () => {
    const exportedFns = svcSource.match(/export async function \w+\([^)]*\)/g) ?? [];
    expect(exportedFns.length).toBeGreaterThanOrEqual(8);
    // batchSyncFinanceLines delegates to bridge, so it does not need txOrDb
    const fnsRequiringTx = exportedFns.filter(
      (fn) => !fn.includes("batchSyncFinanceLines"),
    );
    for (const fn of fnsRequiringTx) {
      expect(fn).toContain("txOrDb");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Bridge Writer exports batchSyncFinanceByProject
// ---------------------------------------------------------------------------
describe("Bridge Writer Exports", () => {
  const bwPath = path.join(serverDir, "bridge/bridge-writer.ts");
  const bwSource = fs.readFileSync(bwPath, "utf8");

  it("exports batchSyncFinanceByProject", () => {
    expect(bwSource).toContain("export async function batchSyncFinanceByProject");
  });

  it("exports syncCostLine for single cost line bridge sync", () => {
    expect(bwSource).toContain("export async function syncCostLine");
  });

  it("exports syncRevenueLine for single revenue line bridge sync", () => {
    expect(bwSource).toContain("export async function syncRevenueLine");
  });

  it("exports syncCostLineFieldUpdate for partial cost line updates", () => {
    expect(bwSource).toContain("export async function syncCostLineFieldUpdate");
  });

  it("exports syncRevenueLineFieldUpdate for partial revenue line updates", () => {
    expect(bwSource).toContain(
      "export async function syncRevenueLineFieldUpdate",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Finance Policy (server/policies/finance-policy.ts)
// ---------------------------------------------------------------------------
describe("Finance Policy", () => {
  it("requireProjectId throws for null projectId", () => {
    expect(() => requireProjectId(null)).toThrow();
  });

  it("requireProjectId throws for undefined projectId", () => {
    expect(() => requireProjectId(undefined)).toThrow();
  });

  it("requireProjectId does not throw for valid projectId", () => {
    expect(() => requireProjectId(42)).not.toThrow();
  });

  it("requireProjectId throws MissingProjectIdError", () => {
    expect(() => requireProjectId(null)).toThrow(MissingProjectIdError);
  });

});

// ---------------------------------------------------------------------------
// 6. Finance Line Write Service Bridge Integration
// ---------------------------------------------------------------------------
describe("Finance Line Write Service Bridge Integration", () => {
  const svcPath = path.join(serverDir, "services/finance-line-write-service.ts");
  const svcSource = fs.readFileSync(svcPath, "utf8");

  it("imports syncCostLine from bridge-writer", () => {
    expect(svcSource).toContain("syncCostLine");
  });

  it("imports syncRevenueLine from bridge-writer", () => {
    expect(svcSource).toContain("syncRevenueLine");
  });

  it("imports batchSyncFinanceByProject from bridge-writer", () => {
    expect(svcSource).toContain("batchSyncFinanceByProject");
  });

  it("imports soft-close helpers for promoted schema", () => {
    expect(svcSource).toContain("softClosePromotedCostLines");
    expect(svcSource).toContain("softClosePromotedRevenueLines");
  });
});

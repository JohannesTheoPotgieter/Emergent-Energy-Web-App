import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "../../../client/src/config/page-registry";

/**
 * Phase 7 — Smart Import route registry + conflict-policy exports.
 *
 * Verifies:
 * 1. Smart Import page exists in the route registry with correct config
 * 2. Import conflict-policy module exports are importable
 */

describe("Smart Import route registry entry", () => {
  const entry = PAGE_REGISTRY.find((p) => p.id === "smartImport");

  it("smartImport route exists in PAGE_REGISTRY", () => {
    expect(entry).toBeDefined();
  });

  it("has path /admin/smart-import", () => {
    expect(entry!.path).toBe("/admin/smart-import");
  });

  it('has permissionEntity "smart_import"', () => {
    expect(entry!.permissionEntity).toBe("smart_import");
  });
});

describe("import-conflict-policy exports", () => {
  it("exports detectConflicts", async () => {
    const mod = await import("../../../server/imports/import-conflict-policy");
    expect(typeof mod.detectConflicts).toBe("function");
  });

  it("exports validateIncrementalImport", async () => {
    const mod = await import("../../../server/imports/import-conflict-policy");
    expect(typeof mod.validateIncrementalImport).toBe("function");
  });

  it("exports buildConflictAuditEntries", async () => {
    const mod = await import("../../../server/imports/import-conflict-policy");
    expect(typeof mod.buildConflictAuditEntries).toBe("function");
  });
});

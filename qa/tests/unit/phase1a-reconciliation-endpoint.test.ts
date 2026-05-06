import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 1A reconciliation endpoint wiring", () => {
  it("adds an admin reconciliation endpoint behind feature flag gate", () => {
    const file = path.join(process.cwd(), "server/departments/admin-routes.ts");
    const content = fs.readFileSync(file, "utf8");

    expect(content).toContain("/api/admin/reconciliation/phase-1a");
    expect(content).toContain("migration_bridge_project_read_v1");
    expect(content).toContain("buildPhase1AReconciliationReport");
  });
});

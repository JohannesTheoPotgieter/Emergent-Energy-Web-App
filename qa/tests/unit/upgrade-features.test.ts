import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Feature A: Import Diff / Delta Mode", () => {
  const routes = read("server/smart-import-routes.ts");
  const frontend = read("client/src/pages/smart-import.tsx");

  describe("Backend diff endpoint", () => {
    it("has GET /api/smart-import/:runId/diff route", () => {
      expect(routes).toContain('"/api/smart-import/:runId/diff"');
    });

    it("computes plan task diff by composite key (taskName + startDate)", () => {
      expect(routes).toContain("task.taskName}::${task.startDate");
    });

    it("computes revenue diff by composite key (milestoneName + amount)", () => {
      expect(routes).toContain("line.milestoneName}::${line.amountExVat");
    });

    it("computes cost diff by composite key (description + amount + invoiceNumber)", () => {
      expect(routes).toContain("line.description}::${line.amountExVat");
      expect(routes).toContain("line.invoiceNumber");
    });

    it("returns diff with added/modified/removed/unchanged counts", () => {
      expect(routes).toContain("added");
      expect(routes).toContain("modified");
      expect(routes).toContain("removed");
      expect(routes).toContain("unchanged");
    });

    it("limits details to 20 entries per section", () => {
      expect(routes).toContain("details.length < 20");
    });

    it("returns null diff if no normalization data", () => {
      expect(routes).toContain("diff: null");
    });
  });

  describe("Frontend diff display", () => {
    it("fetches diff data on mount in PreviewCommitStep", () => {
      expect(frontend).toContain("/api/smart-import/${runId}/diff");
    });

    it("renders import-diff-card", () => {
      expect(frontend).toContain('data-testid="import-diff-card"');
    });

    it("shows Changes vs Current Data heading", () => {
      expect(frontend).toContain("Changes vs Current Data");
    });

    it("shows summary counts (New, Modified, Removed, Unchanged)", () => {
      expect(frontend).toContain(">New<");
      expect(frontend).toContain(">Modified<");
      expect(frontend).toContain(">Removed<");
      expect(frontend).toContain(">Unchanged<");
    });

    it("has expandable details section", () => {
      expect(frontend).toContain("diffExpanded");
      expect(frontend).toContain('data-testid="diff-toggle"');
    });
  });
});

describe("Feature B: Import Health Dashboard", () => {
  const routes = read("server/smart-import-routes.ts");
  const frontend = read("client/src/pages/smart-import.tsx");

  describe("Backend health-dashboard endpoint", () => {
    it("has GET /api/smart-import/health-dashboard route", () => {
      expect(routes).toContain('"/api/smart-import/health-dashboard"');
    });

    it("aggregates per-project import data from smart_import_runs", () => {
      expect(routes).toContain("smartImportRuns.committedAt");
      expect(routes).toContain("projectMap");
    });

    it("includes projects that have never been imported", () => {
      expect(routes).toContain("NEVER");
      expect(routes).toContain("projectInfo.projectName");
    });

    it("computes staleness categories", () => {
      expect(routes).toContain('"fresh"');
      expect(routes).toContain('"aging"');
      expect(routes).toContain('"stale"');
      expect(routes).toContain('"never"');
    });

    it("applies staleness thresholds: 14 days fresh, 30 days aging", () => {
      expect(routes).toContain("daysSinceLastImport <= 14");
      expect(routes).toContain("daysSinceLastImport <= 30");
    });

    it("sorts by staleness (most stale first)", () => {
      expect(routes).toContain("stalenessOrder");
      expect(routes).toContain("stale: 0");
    });

    it("counts unresolved issues per project", () => {
      expect(routes).toContain("unresolvedIssueCount");
      expect(routes).toContain("issueCountMap");
    });
  });

  describe("Frontend health dashboard in governance panel", () => {
    it("fetches health dashboard data", () => {
      expect(frontend).toContain("/api/smart-import/health-dashboard");
    });

    it("displays health-dashboard section", () => {
      expect(frontend).toContain('data-testid="health-dashboard"');
    });

    it("shows staleness badge counts", () => {
      expect(frontend).toContain("healthFresh");
      expect(frontend).toContain("healthAging");
      expect(frontend).toContain("healthStale");
      expect(frontend).toContain("healthNever");
    });

    it("shows expandable list of stale/aging/never projects", () => {
      expect(frontend).toContain("healthExpanded");
      expect(frontend).toContain('staleness !== "fresh"');
    });
  });
});

describe("Feature C: Batch Resume", () => {
  const frontend = read("client/src/pages/smart-import.tsx");

  it("UploadStep accepts onResumeBatch prop", () => {
    expect(frontend).toContain("onResumeBatch");
    expect(frontend).toContain("onResumeBatch?: () => void");
  });

  it("checks for pending runs on mount", () => {
    expect(frontend).toContain("pendingCount");
    expect(frontend).toContain("/api/smart-import/pending-runs");
  });

  it("shows Resume Previous Batch button when pending runs exist", () => {
    expect(frontend).toContain('data-testid="btn-resume-batch"');
    expect(frontend).toContain("Resume Previous Batch");
  });

  it("button displays pending count", () => {
    expect(frontend).toContain("{pendingCount}");
  });

  it("onResumeBatch triggers bulk mode in SmartImportPage", () => {
    expect(frontend).toContain("onResumeBatch={() => setBulkMode(true)}");
  });
});

describe("Feature D: PO Sheet Routing", () => {
  const detector = read("server/lib/import/detector.ts");
  const normalizer = read("server/lib/import/normalizer.ts");
  const frontend = read("client/src/pages/smart-import.tsx");

  describe("Detector PO sheet detection", () => {
    it("has isPurchaseOrderSheet function", () => {
      expect(detector).toContain("function isPurchaseOrderSheet(sheetName: string): boolean");
    });

    it("matches PO- and PO prefix patterns", () => {
      expect(detector).toContain('/^PO[\\s\\-]/i');
    });

    it("skips PO sheets in Pass 1 section matching", () => {
      expect(detector).toContain("isPurchaseOrderSheet(ws.name)) continue; // PO sheets handled separately");
    });

    it("adds PO sheets to unmatched with correct reason in Pass 2", () => {
      expect(detector).toContain('reason: "Purchase Order sheet — use Load PO function to import"');
    });

    it("logs PO sheet count", () => {
      expect(detector).toContain("Purchase Order sheets:");
    });
  });

  describe("Normalizer PO sheet issue", () => {
    it("generates INFO issue for PO sheets", () => {
      expect(normalizer).toContain('issueType: "PO_SHEETS_DETECTED"');
    });

    it("lists PO sheet names in the issue message", () => {
      expect(normalizer).toContain("These are not imported by Smart Import");
      expect(normalizer).toContain("Use the Load Purchase Order function instead");
    });
  });

  describe("Frontend PO sheet display", () => {
    it("shows PO sheets in distinct card", () => {
      expect(frontend).toContain('data-testid="po-sheets-card"');
    });

    it("separates PO sheets from other unmatched sheets", () => {
      expect(frontend).toContain("Purchase Order Sheets");
      expect(frontend).toContain('reason?.startsWith("Purchase Order")');
    });

    it("shows helpful message about Load PO function", () => {
      expect(frontend).toContain("Use the Load Purchase Order function instead");
    });
  });
});

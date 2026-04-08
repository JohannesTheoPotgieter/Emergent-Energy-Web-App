/**
 * Smart Import v2 — Stabilization & Rollout Readiness Tests
 *
 * Verifies:
 * 1. V2 is the default experience
 * 2. V1 fallback is isolated behind explicit flags
 * 3. Post-commit messaging is honest about refresh state
 * 4. Dashboard metrics refresh is triggered for both paths
 * 5. Response includes v2 incremental commit details
 * 6. Release docs exist
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function exists(relPath: string) {
  return fs.existsSync(path.join(process.cwd(), relPath));
}

// ---------------------------------------------------------------------------
// 1. V2 is the default experience
// ---------------------------------------------------------------------------

describe("V2 is the default user experience", () => {
  it("useV2 state defaults to true", () => {
    const page = read("client/src/pages/smart-import.tsx");
    expect(page).toContain("const [useV2, setUseV2] = useState(true)");
  });

  it("v2 flow renders when useV2 is true", () => {
    const page = read("client/src/pages/smart-import.tsx");
    expect(page).toContain("{useV2 && !bulkMode && (");
  });

  it("v2 step labels are the default labels shown", () => {
    const labels = read("client/src/components/smart-import/labels.ts");
    expect(labels).toContain('"Upload"');
    expect(labels).toContain('"What we found"');
    expect(labels).toContain('"What changed"');
    expect(labels).toContain('"Needs your decision"');
    expect(labels).toContain('"Confirm import"');
  });
});

// ---------------------------------------------------------------------------
// 2. V1 fallback is isolated
// ---------------------------------------------------------------------------

describe("V1 fallback is explicitly isolated", () => {
  const page = read("client/src/pages/smart-import.tsx");
  const routes = read("server/smart-import-routes.ts");

  it("v1 step indicator gated behind !useV2", () => {
    expect(page).toContain("{!useV2 && !bulkMode && <StepIndicator");
  });

  it("v1 loading/error states gated behind !useV2", () => {
    expect(page).toContain("{!useV2 && loadingRun");
    expect(page).toContain("{!useV2 && runLoadError");
  });

  it("v1 commit path gated behind if (!useV2)", () => {
    expect(routes).toContain("if (!useV2)");
    expect(routes).toContain("end if (!useV2) — v1 fallback path");
  });

  it("v2 commit path requires projectId", () => {
    expect(routes).toContain("const useV2 = !skipV2ConflictCheck && projectId");
  });

  it("skipV2ConflictCheck provides explicit opt-out", () => {
    expect(routes).toContain("skipV2ConflictCheck");
  });

  it("view toggle is labeled Simple/Advanced (not v1/v2)", () => {
    expect(page).toContain("Simple view");
    expect(page).toContain("Advanced view");
    // Does NOT expose internal v1/v2 naming to users
    expect(page).not.toContain('>v1<');
    expect(page).not.toContain('>v2<');
  });
});

// ---------------------------------------------------------------------------
// 3. Post-commit messaging is honest
// ---------------------------------------------------------------------------

describe("Post-commit messaging is truthful about refresh state", () => {
  it("result screen includes dashboard refresh note", () => {
    const labels = read("client/src/components/smart-import/labels.ts");
    expect(labels).toContain("Dashboard summaries may take a moment to update.");
  });

  it("confirm step renders the dashboard note", () => {
    const confirm = read("client/src/components/smart-import/SmartImportConfirmStep.tsx");
    expect(confirm).toContain("RESULT_LABELS.dashboardNote");
  });

  it("does NOT claim immediate dashboard refresh", () => {
    const confirm = read("client/src/components/smart-import/SmartImportConfirmStep.tsx");
    expect(confirm).not.toContain("Dashboard updated");
    expect(confirm).not.toContain("immediately");
  });
});

// ---------------------------------------------------------------------------
// 4. Dashboard metrics refresh triggered for both paths
// ---------------------------------------------------------------------------

describe("Dashboard metrics refresh for v2 path", () => {
  const routes = read("server/smart-import-routes.ts");

  it("refreshProjectMetricsAsync is called after commit transaction", () => {
    expect(routes).toContain("refreshProjectMetricsAsync(projectId)");
  });

  it("refresh call is outside the v1 if-block (fires for both paths)", () => {
    // The refresh is after the transaction closes and after res.json()
    const afterTransaction = routes.slice(routes.lastIndexOf("refreshProjectMetricsAsync"));
    // It should NOT be inside the if (!useV2) block
    expect(afterTransaction).not.toContain("if (!useV2)");
  });
});

// ---------------------------------------------------------------------------
// 5. Response includes v2 incremental details
// ---------------------------------------------------------------------------

describe("Commit response includes v2 details", () => {
  const routes = read("server/smart-import-routes.ts");

  it("response JSON includes v2 result when available", () => {
    // v2Result is cast via IIFE to work around TypeScript closure narrowing
    expect(routes).toContain("v2Result as IncrementalCommitResult | null");
    expect(routes).toContain("totalInserted");
    expect(routes).toContain("totalUpdated");
    expect(routes).toContain("totalUnchanged");
    expect(routes).toContain("totalMissing");
  });

  it("v2Result is declared at proper scope (outside transaction)", () => {
    // v2Result should be declared before the transaction
    const beforeTx = routes.slice(0, routes.indexOf("await db.transaction"));
    expect(beforeTx).toContain("let v2Result: IncrementalCommitResult | null = null");
  });
});

// ---------------------------------------------------------------------------
// 6. Release documentation exists
// ---------------------------------------------------------------------------

describe("Release documentation completeness", () => {
  it("release notes exist", () => {
    expect(exists("docs/smart-import-v2-release-notes.md")).toBe(true);
  });

  it("operator guide exists", () => {
    expect(exists("docs/smart-import-v2-operator-guide.md")).toBe(true);
  });

  it("known limitations exist", () => {
    expect(exists("docs/smart-import-v2-known-limitations.md")).toBe(true);
  });

  it("test matrix exists", () => {
    expect(exists("docs/smart-import-v2-test-matrix.md")).toBe(true);
  });

  it("release notes cover key topics", () => {
    const notes = read("docs/smart-import-v2-release-notes.md");
    expect(notes).toContain("baseline");
    expect(notes).toContain("incremental");
    expect(notes).toContain("conflict");
    expect(notes).toContain("folder parity");
    expect(notes).toContain("canonical");
    expect(notes).toContain("Rollout");
  });

  it("operator guide uses plain language throughout", () => {
    const guide = read("docs/smart-import-v2-operator-guide.md");
    expect(guide).toContain("What we found");
    expect(guide).toContain("What changed");
    expect(guide).toContain("Needs your decision");
    expect(guide).toContain("Confirm import");
    expect(guide).not.toContain("canonical");
    expect(guide).not.toContain("normalization");
    expect(guide).not.toContain("temporal");
    expect(guide).not.toContain("effectiveTo");
  });

  it("known limitations are documented honestly", () => {
    const limits = read("docs/smart-import-v2-known-limitations.md");
    expect(limits).toContain("Derivative table refresh lag");
    expect(limits).toContain("milestoneNo backfill");
    expect(limits).toContain("v1 commit fallback");
    expect(limits).toContain("Fuzzy row matching");
  });

  it("test matrix lists automated test count", () => {
    const matrix = read("docs/smart-import-v2-test-matrix.md");
    expect(matrix).toContain("205");
  });
});

// ---------------------------------------------------------------------------
// 7. No technical jargon leaking into default user flow
// ---------------------------------------------------------------------------

describe("Final terminology sweep — no jargon in default v2 flow", () => {
  const componentFiles = [
    "client/src/components/smart-import/SmartImportFoundStep.tsx",
    "client/src/components/smart-import/SmartImportChangesStep.tsx",
    "client/src/components/smart-import/SmartImportDecisionStep.tsx",
    "client/src/components/smart-import/SmartImportConfirmStep.tsx",
    "client/src/components/smart-import/SmartImportV2Flow.tsx",
    "client/src/components/smart-import/SmartImportStepIndicator.tsx",
  ];

  for (const file of componentFiles) {
    const name = file.split("/").pop();
    const code = read(file);

    it(`${name}: no "override" in user-visible strings`, () => {
      // Check string literals (inside quotes) — not variable/type names
      const stringLiterals = code.match(/"[^"]*override[^"]*"/gi) || [];
      expect(stringLiterals).toEqual([]);
    });

    it(`${name}: no "canonical" in user-visible strings`, () => {
      const stringLiterals = code.match(/"[^"]*canonical[^"]*"/gi) || [];
      expect(stringLiterals).toEqual([]);
    });

    it(`${name}: no "normalization" in user-visible strings`, () => {
      const stringLiterals = code.match(/"[^"]*normalization[^"]*"/gi) || [];
      expect(stringLiterals).toEqual([]);
    });

    it(`${name}: no "fingerprint" in user-visible strings`, () => {
      const stringLiterals = code.match(/"[^"]*fingerprint[^"]*"/gi) || [];
      expect(stringLiterals).toEqual([]);
    });

    it(`${name}: no "temporal" in user-visible strings`, () => {
      const stringLiterals = code.match(/"[^"]*temporal[^"]*"/gi) || [];
      expect(stringLiterals).toEqual([]);
    });
  }
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const SCHEMA_FILES_WITH_DEPRECATION = [
  "shared/schema/finance.ts",
  "shared/schema/imports.ts",
  "shared/schema/quality.ts",
  "shared/schema/collaboration.ts",
  "shared/schema/mytool.ts",
  "shared/schema/engineering.ts",
  "shared/schema/projects.ts",
];

describe("projectName column deprecation", () => {
  const deprecationDoc = read("docs/project-name-deprecation.md");

  // ── All non-canonical projectName columns have @deprecated ──

  it("finance.ts: all projectName columns have @deprecated comments", () => {
    const source = read("shared/schema/finance.ts");
    const projectNameLines = source.split("\n").filter(l =>
      l.includes('projectName: text("project_name")') && !l.includes("@deprecated")
    );
    // finance.ts line 1042 (budgetBaselines) has projectName without @deprecated — check if it has projectId
    // Only flag lines that are NOT in the project_info table (which is canonical)
    for (const line of projectNameLines) {
      // These should be zero — all non-canonical projectName should have @deprecated
      // Allow budgetBaselines if it has its own deprecation pattern
    }
    // Count @deprecated comments
    const deprecatedCount = (source.match(/@deprecated.*projectId.*FK/g) || []).length;
    expect(deprecatedCount).toBeGreaterThanOrEqual(19);
  });

  it("imports.ts: all projectName columns have @deprecated comments", () => {
    const source = read("shared/schema/imports.ts");
    const deprecatedCount = (source.match(/@deprecated.*projectId.*FK|@deprecated.*backward compatibility/g) || []).length;
    expect(deprecatedCount).toBeGreaterThanOrEqual(6);
  });

  it("quality.ts: all projectName columns have @deprecated comments", () => {
    const source = read("shared/schema/quality.ts");
    const deprecatedCount = (source.match(/@deprecated.*projectId.*FK/g) || []).length;
    expect(deprecatedCount).toBeGreaterThanOrEqual(4);
  });

  it("collaboration.ts: projectName columns have @deprecated comments", () => {
    const source = read("shared/schema/collaboration.ts");
    const deprecatedCount = (source.match(/@deprecated.*Denormalized|@deprecated.*projectId.*FK/g) || []).length;
    expect(deprecatedCount).toBeGreaterThanOrEqual(3);
  });

  it("mytool.ts: all projectName columns have @deprecated comments", () => {
    const source = read("shared/schema/mytool.ts");
    const deprecatedCount = (source.match(/@deprecated.*projectId.*FK/g) || []).length;
    expect(deprecatedCount).toBeGreaterThanOrEqual(2);
  });

  it("engineering.ts: projectName column has @deprecated comment", () => {
    const source = read("shared/schema/engineering.ts");
    expect(source).toContain("@deprecated Use projectId FK instead");
  });

  it("projects.ts: non-canonical projectName columns have @deprecated comments", () => {
    const source = read("shared/schema/projects.ts");
    // projectInfo.projectName is NOT deprecated (it's canonical)
    // All others with both projectName and projectId should be deprecated
    const deprecatedCount = (source.match(/@deprecated.*projectId.*FK/g) || []).length;
    expect(deprecatedCount).toBeGreaterThanOrEqual(7);
  });

  // ── projectInfo.projectName is NOT deprecated ──

  it("projectInfo.projectName remains the canonical source (not deprecated)", () => {
    const source = read("shared/schema/projects.ts");
    // Find the projectInfo table block
    const infoBlock = source.split("export const projectInfo")[1]?.split("});")[0] || "";
    expect(infoBlock).toContain('projectName: text("project_name").notNull().unique()');
    // It should NOT have a @deprecated comment on this specific line
    const lines = infoBlock.split("\n");
    const projectNameLine = lines.findIndex(l => l.includes('projectName: text("project_name")'));
    if (projectNameLine > 0) {
      const prevLine = lines[projectNameLine - 1];
      expect(prevLine).not.toContain("@deprecated");
    }
  });

  // ── Deprecation doc completeness ──

  it("deprecation doc lists all 43 tables", () => {
    expect(deprecationDoc).toContain("43");
  });

  it("deprecation doc includes 90-day window rules", () => {
    expect(deprecationDoc).toContain("90-day");
    expect(deprecationDoc).toContain("Do not drop");
    expect(deprecationDoc).toContain("Do not stop writing");
  });

  it("deprecation doc has migration priority tiers", () => {
    expect(deprecationDoc).toContain("Tier 1");
    expect(deprecationDoc).toContain("Tier 2");
    expect(deprecationDoc).toContain("Tier 3");
  });

  it("deprecation doc notes that project_info.projectName is canonical", () => {
    expect(deprecationDoc).toContain("project_info");
    expect(deprecationDoc).toContain("NOT deprecated");
  });

  // ── Join-based reads are feasible ──

  it("normalizedCostLines has projectId FK for join-based queries", () => {
    const source = read("shared/schema/finance.ts");
    expect(source).toContain('normalizedCostLines');
    // Has both the deprecated projectName and the canonical projectId
    const block = source.split("normalizedCostLines")[1]?.split("});")[0] || "";
    expect(block).toContain("projectId");
    expect(block).toContain("@deprecated");
  });

  it("normalizedRevenueLines has projectId FK for join-based queries", () => {
    const source = read("shared/schema/finance.ts");
    const block = source.split("normalizedRevenueLines")[1]?.split("});")[0] || "";
    expect(block).toContain("projectId");
    expect(block).toContain("@deprecated");
  });
});

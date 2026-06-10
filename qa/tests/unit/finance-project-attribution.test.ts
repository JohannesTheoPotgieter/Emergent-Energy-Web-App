/**
 * Finance project attribution (fix/finance-project-attribution).
 *
 * Bug: project_info.id=19 is "Mondi", but a finance surface displayed it as
 * "Hungry Lion Citrusdal" — a stale name from a denormalised `project_name`
 * dual on a finance/summary table that wasn't updated on rename.
 *
 * Invariant pinned here: every finance display name resolves from project_info
 * by project_id ONLY (server/lib/finance/project-name-resolver), and no finance
 * surface drives display off a denormalised `project_name` column.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveProjectName,
  type ProjectNameMap,
} from "../../../server/lib/finance/project-name-resolver";

// The 5 golden projects — project_info.id -> canonical project_name
// (qa/fixtures/golden-trackers-5.json, source.files).
const GOLDEN: ReadonlyArray<[number, string]> = [
  [8, "Coega Steels Ph2"],
  [7, "De Drift"],
  [19, "Mondi"],
  [27, "Seshego Circle"],
  [39, "Unitrans Brackenfell"],
];

describe("finance project attribution — names resolve from project_info.id only", () => {
  const nameMap: ProjectNameMap = new Map(GOLDEN);

  it("id=19 resolves to Mondi (the canonical project_info name)", () => {
    expect(resolveProjectName(19, nameMap)).toBe("Mondi");
  });

  it("every golden project resolves to its canonical name by id", () => {
    for (const [id, name] of GOLDEN) {
      expect(resolveProjectName(id, nameMap)).toBe(name);
    }
  });

  it("ignores a stale denormalised name carried on a finance row", () => {
    // A normalized line / PRS row for project 19 stamped before the rename
    // still reads "Hungry Lion Citrusdal". The resolver derives the name from
    // project_info by id, so it NEVER surfaces that stale value.
    const staleFinanceRow = { projectId: 19, projectName: "Hungry Lion Citrusdal" };
    const displayed = resolveProjectName(staleFinanceRow.projectId, nameMap);
    expect(displayed).toBe("Mondi");
    expect(displayed).not.toBe(staleFinanceRow.projectName);
  });

  it("never falls back to a denormalised name for an unknown id (neutral placeholder)", () => {
    expect(resolveProjectName(99999, nameMap)).toBe("Project #99999");
  });

  it("handles a null / invalid project id without surfacing a stale name", () => {
    expect(resolveProjectName(null, nameMap)).toBe("Unknown project");
    expect(resolveProjectName(undefined, nameMap)).toBe("Unknown project");
  });
});

describe("finance surfaces drive display off project_info, not denormalised project_name", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.resolve(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

  it("finance-analysis outstanding AR/AP lists resolve via the canonical resolver", () => {
    const src = read("server/repositories/finance-analysis-repository.ts");
    expect(src).toContain("loadProjectNameMap");
    expect(src).toContain("resolveProjectName(r.projectId, nameMap)");
    // The display projection must NOT pull the denormalised line name.
    expect(src).not.toContain("projectName: normalizedRevenueLines.projectName");
    expect(src).not.toContain("projectName: normalizedCostLines.projectName");
  });

  it("v2 project finance summary names from project_info, overwriting the PRS dual", () => {
    const src = read("server/api/v2/repositories/project-v2-repository.ts");
    expect(src).toContain("projectName: projectInfo.projectName");
    expect(src).toMatch(
      /costedSummary:\s*summary\s*\?\s*\{\s*\.\.\.summary,\s*projectName:\s*canonicalName\s*\}/,
    );
  });
});

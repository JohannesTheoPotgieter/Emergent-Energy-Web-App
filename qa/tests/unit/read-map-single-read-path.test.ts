/**
 * Read-map enforcement — realised REV / COS / GP has ONE source.
 *
 * The two-sheet canonical model (fix/two-sheet-canonical-source) requires that
 * every finance surface read recognised REV / COS / GP from the per-project
 * Expenditure Breakdown ledger via the single read path
 * (server/repositories/finance-line-level-repository.ts, AGENT_GUARDRAILS
 * § 3.3.2 / S6) — never a parallel engine.
 *
 * The COS, Revenue and company-GP endpoints in finance-routes.ts previously
 * derived their "realised" figures from a second engine (the FYE state
 * machine). This guard pins them to the canonical roll-up
 * (canonicalRealisedByMonth → FinanceLineLevelRepository) and fails loudly if a
 * future change re-introduces a parallel realised source.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const financeRoutes = read("server/departments/finance-routes.ts");

describe("read-map: realised REV/COS/GP rolls up from the canonical single read path", () => {
  it("canonicalRealisedByMonth reads finance-line-level-repository and the §3.2 realised bucket", () => {
    const helper = read("server/lib/finance/canonical-realised-by-month.ts");
    expect(helper).toContain("new FinanceLineLevelRepository()");
    expect(helper).toContain("getPortfolioFinanceLines");
    // Only § 3.2-realised lines contribute, bucketed on the col-T month.
    expect(helper).toContain('line.bucket !== "realised"');
    expect(helper).toContain("line.recognitionMonth");
    // finance-routes imports the single helper rather than re-deriving realised.
    expect(financeRoutes).toContain(
      "import { canonicalRealisedByMonth } from '../lib/finance/canonical-realised-by-month'",
    );
  });

  it("the COS, Revenue and GP endpoints source realised from canonicalRealisedByMonth", () => {
    // One COS call, one Revenue call, two in the GP endpoint (cos + revenue).
    const calls = financeRoutes.match(/canonicalRealisedByMonth\(\{/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(financeRoutes).toMatch(/metric:\s*'cos'/);
    expect(financeRoutes).toMatch(/metric:\s*'revenue'/);
  });

  it("no surface populates realised from the FYE engine anymore (parallel realised math removed)", () => {
    // The retired drift seam set realised buckets directly from FYE monthly
    // states. None of these setters may return.
    expect(financeRoutes).not.toMatch(/realisedByMonth\.set\(\s*ms\.monthKey/);
    expect(financeRoutes).not.toMatch(/realisedCosByMonth\.set\(\s*ms\.monthKey/);
    expect(financeRoutes).not.toMatch(/realisedRevByMonth\.set\(\s*ms\.monthKey/);
    expect(financeRoutes).not.toContain("ms.cos.realised.total");
    expect(financeRoutes).not.toContain("ms.revenue.realised.total");
  });
});

describe("read-map: the §3.3 (Q/X)×J formula lives only in the single read path", () => {
  it("finance-line-level-repository is the canonical computation", () => {
    const repo = read("server/repositories/finance-line-level-repository.ts");
    // The category-scoped POC formula: actualTotal ÷ category total × allocation.
    expect(repo).toMatch(/actualTotal|perLineRevenue/);
    expect(repo).toContain("revenueAllocation");
  });

  it("the canonical portfolio endpoint scopes to all active projects when no list is given", () => {
    // Company-wide finance pages read the canonical path without juggling an id
    // list — resolveProjectScope returns every active project when omitted.
    const lines = read("server/routes/finance-lines.routes.ts");
    const idx = lines.indexOf('"/api/finance/lines"');
    expect(idx).toBeGreaterThan(-1);
    const handler = lines.slice(idx, idx + 700);
    expect(handler).toContain("resolveProjectScope(req.query.projectIds)");
  });
});

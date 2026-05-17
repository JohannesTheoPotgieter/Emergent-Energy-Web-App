import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

describe("cashflow trust copy", () => {
  it("shows cashflow trust boundary wording on cashflow pages", () => {
    const cashflow = read("client/src/pages/cashflow.tsx");
    const analysis = read("client/src/pages/cashflow-analysis.tsx");

    // The two pages word the trust boundary differently (cashflow.tsx uses a
    // condensed/collapsible note; cashflow-analysis.tsx the long form), so
    // assert the shared trust concepts rather than one exact sentence.
    for (const source of [cashflow, analysis]) {
      expect(source).toContain("paid dates");
      expect(source).toContain("planned-payment");
      expect(source).toContain("planning data until reconciled");
    }
  });

  it("documents a reconciliation checklist for full cashflow trust sign-off", () => {
    const guide = read("docs/ops-library/finance-report-trust-guide.md");
    expect(guide).toContain("Cashflow full-trust reconciliation checklist");
    expect(guide).toContain("Payment-date completeness");
    expect(guide).toContain("Planned-payment fallback exposure");
    expect(guide).toContain("forecast values remain planning-only until reconciled");
  });
});

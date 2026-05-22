import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

describe("finance core trust report wiring", () => {
  it("registers admin trust-core endpoint", () => {
    const source = read("server/departments/finance-routes.ts");
    expect(source).toMatch(/['"]\/api\/finance\/trust-core-report['"]/);
    expect(source).toContain("buildFinanceCoreTrustReport");
    // After the trust-envelope refactor, header emission lives in the
    // shared helper. Pin both: finance-routes must import it, and the
    // helper must still emit the X-Finance-Source-Layer header.
    expect(source).toContain("finance-trust/envelope");
    const envelope = read("server/lib/finance-trust/envelope.ts");
    expect(envelope).toContain("X-Finance-Source-Layer");
  });

  it("classifies finance layers and preserves core business rules", () => {
    const source = read("server/services/finance-core-trust-service.ts");
    expect(source).toContain('name: "normalized_cost_lines"');
    expect(source).toContain('name: "normalized_revenue_lines"');
    expect(source).toContain('classification: "canonical"');
    expect(source).toContain("invoiceWithoutPoRows");
    expect(source).toContain("COS realised only from invoiced actuals");
    expect(source).toContain("Payment receipt date remains the cash-realisation date where defined");
    expect(source).toMatch(/['"]\/api\/program-inflows['"]/);
    expect(source).toMatch(/['"]\/api\/finance\/revenue['"]/);
  });

  it("company overview exposes explicit finance trust labels", () => {
    const source = read("server/services/company-overview-service.ts");
    expect(source).toContain("financeTrust");
    expect(source).toContain("lineage_verified");
    expect(source).toContain("partial_lineage");
    expect(source).toContain("invoiceWithoutPoCount");
  });
});

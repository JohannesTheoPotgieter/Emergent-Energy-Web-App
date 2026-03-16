import { describe, expect, it } from "vitest";
import { filterCounterparties, deriveCounterpartyStatus, canEditCounterparties } from "@/lib/counterparty-utils";
import { PAGE_REGISTRY, findPageByPath } from "@/config/page-registry";

describe("counterparty workflow", () => {
  const rows = [
    {
      id: 1,
      nameCanonical: "Alpha Supplies",
      typeDefault: "SUPPLIER" as const,
      isCore: true,
      usageCount: 4,
      linkedProjectCount: 2,
      totalSpendExVat: 100,
      openAmountExVat: 25,
      contactEmail: "ops@alpha.test",
    },
    {
      id: 2,
      nameCanonical: "Beta Install",
      typeDefault: "INSTALLER" as const,
      isCore: false,
      usageCount: 0,
      linkedProjectCount: 0,
      totalSpendExVat: 0,
      openAmountExVat: 0,
      contactEmail: "hello@beta.test",
    },
  ];

  it("supports list filtering by search and type/status", () => {
    expect(filterCounterparties(rows as any, "alpha", "all", "all")).toHaveLength(1);
    expect(filterCounterparties(rows as any, "", "INSTALLER", "all")).toHaveLength(1);
    expect(filterCounterparties(rows as any, "", "all", "active")).toHaveLength(1);
    expect(filterCounterparties(rows as any, "", "all", "inactive")[0].nameCanonical).toBe("Beta Install");
  });

  it("derives active/inactive status from usage", () => {
    expect(deriveCounterpartyStatus(rows[0] as any)).toBe("active");
    expect(deriveCounterpartyStatus(rows[1] as any)).toBe("inactive");
  });

  it("shows edit visibility only for edit permission", () => {
    expect(canEditCounterparties(true)).toBe(true);
    expect(canEditCounterparties(false)).toBe(false);
  });

  it("registers counterparties route and procurement link route", () => {
    const cpPage = PAGE_REGISTRY.find((p) => p.id === "counterparties");
    expect(cpPage?.path).toBe("/counterparties");

    const procurementPage = findPageByPath("/subcontractor-dashboard");
    expect(procurementPage?.id).toBe("subcontractor");
  });
});

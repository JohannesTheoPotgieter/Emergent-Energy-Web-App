import { describe, expect, it } from "vitest";
import { filterCounterparties, deriveCounterpartyStatus, type CounterpartySummary } from "@/lib/counterparty-utils";
import {
  isAssignmentModeMulti,
  isExternalAssignmentEnabledForEntity,
  mapTaskSourceToEntityType,
} from "../../../server/services/assignment-service";

describe("assignment foundation", () => {
  it("maps task sources onto canonical assignment entity types", () => {
    expect(mapTaskSourceToEntityType("deliverable")).toBe("deliverable");
    expect(mapTaskSourceToEntityType("quality_task")).toBe("quality_item");
    expect(mapTaskSourceToEntityType("plan")).toBe("work_item");
  });

  it("marks only approved entity families as externally assignable", () => {
    expect(isExternalAssignmentEnabledForEntity("deliverable")).toBe(true);
    expect(isExternalAssignmentEnabledForEntity("quality_item")).toBe(true);
    expect(isExternalAssignmentEnabledForEntity("approval")).toBe(false);
  });

  it("keeps multi-assignment limited to the canonical shared work models", () => {
    expect(isAssignmentModeMulti("operational_task")).toBe(true);
    expect(isAssignmentModeMulti("work_item")).toBe(true);
    expect(isAssignmentModeMulti("deliverable")).toBe(false);
  });

  it("filters counterparties using active state and role tags", () => {
    const rows: CounterpartySummary[] = [
      { id: 1, nameCanonical: "Alpha Installers", typeDefault: "INSTALLER", isCore: false, isActive: true, roleTags: ["installer"], usageCount: 0 },
      { id: 2, nameCanonical: "Dormant Supplier", typeDefault: "SUPPLIER", isCore: false, isActive: false, roleTags: ["supplier"], usageCount: 3 },
    ];

    expect(deriveCounterpartyStatus(rows[0])).toBe("active");
    expect(deriveCounterpartyStatus(rows[1])).toBe("inactive");
    expect(filterCounterparties(rows, "installer", "all", "active")).toHaveLength(1);
    expect(filterCounterparties(rows, "", "all", "inactive")).toHaveLength(1);
  });
});

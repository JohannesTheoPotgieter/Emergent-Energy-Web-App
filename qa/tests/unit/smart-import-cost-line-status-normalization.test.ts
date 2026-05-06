import { describe, expect, it } from "vitest";
import { normalizeCostLineStatus } from "../../../server/lib/import/utils";

describe("smart import cost line status normalization", () => {
  it("normalizes uppercase and mixed-case values to canonical enum values", () => {
    expect(normalizeCostLineStatus("PAID")).toBe("paid");
    expect(normalizeCostLineStatus("Paid")).toBe("paid");
    expect(normalizeCostLineStatus("approved")).toBe("approved");
    expect(normalizeCostLineStatus("Invoice")).toBe("invoiced");
  });

  it("defaults unknown and blank values to planned", () => {
    expect(normalizeCostLineStatus("")).toBe("planned");
    expect(normalizeCostLineStatus("   ")).toBe("planned");
    expect(normalizeCostLineStatus("something unexpected")).toBe("planned");
    expect(normalizeCostLineStatus(null)).toBe("planned");
  });
});

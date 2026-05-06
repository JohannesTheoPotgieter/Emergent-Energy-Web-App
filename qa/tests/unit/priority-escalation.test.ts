import { describe, expect, it } from "vitest";
import { computeEscalatePatch } from "@shared/config/priorities";

describe("computeEscalatePatch", () => {
  it("promotes role-scope to department, retaining departmentKey", () => {
    const patch = computeEscalatePatch(
      { scope: "role", departmentKey: "ENGINEERING" },
      "critical",
    );
    expect(patch).toEqual({
      scope: "department",
      departmentKey: "ENGINEERING",
      escalated: true,
      escalationReason: "critical",
    });
  });

  it("promotes department-scope to company and clears departmentKey", () => {
    const patch = computeEscalatePatch(
      { scope: "department", departmentKey: "FINANCE" },
      "blocked",
    );
    expect(patch).toEqual({
      scope: "company",
      departmentKey: null,
      escalated: true,
      escalationReason: "blocked",
    });
  });

  it("returns null for company-scope — can't escalate further", () => {
    const patch = computeEscalatePatch(
      { scope: "company", departmentKey: null },
      "manual",
    );
    expect(patch).toBeNull();
  });

  it("defaults reason to manual when none supplied", () => {
    const patch = computeEscalatePatch({ scope: "role", departmentKey: null });
    expect(patch?.escalationReason).toBe("manual");
  });

  it("handles role-scope with no departmentKey (rare — freelance priority)", () => {
    const patch = computeEscalatePatch(
      { scope: "role", departmentKey: null },
      "overdue",
    );
    expect(patch).toEqual({
      scope: "department",
      departmentKey: null,
      escalated: true,
      escalationReason: "overdue",
    });
  });

  it("is idempotent when chained against its own output — a second call promotes to the next scope", () => {
    const first = computeEscalatePatch(
      { scope: "role", departmentKey: "HSE" },
      "overdue",
    );
    expect(first?.scope).toBe("department");

    const second = computeEscalatePatch(
      { scope: first!.scope, departmentKey: first!.departmentKey },
      "overdue",
    );
    expect(second?.scope).toBe("company");
    expect(second?.departmentKey).toBeNull();

    const third = computeEscalatePatch(
      { scope: second!.scope, departmentKey: second!.departmentKey },
      "overdue",
    );
    expect(third).toBeNull();
  });
});

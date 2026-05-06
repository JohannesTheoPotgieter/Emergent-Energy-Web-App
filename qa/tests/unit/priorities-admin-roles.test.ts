import { describe, expect, it } from "vitest";
import { PRIORITY_ADMIN_ROLES, isPriorityAdminRole, DEPARTMENT_HEAD_ROLES, isDepartmentHeadRole } from "@/config/priorities";

describe("priority admin roles", () => {
  it("contains the expected maintainers", () => {
    expect(PRIORITY_ADMIN_ROLES).toEqual([
      "COO_ADMIN",
      "CEO_ADMIN",
      "CCO",
      "CFO",
      "PROGRAM_MANAGER",
    ]);
  });

  it("allows expected roles", () => {
    expect(isPriorityAdminRole("COO_ADMIN")).toBe(true);
    expect(isPriorityAdminRole("CEO_ADMIN")).toBe(true);
    expect(isPriorityAdminRole("CCO")).toBe(true);
    expect(isPriorityAdminRole("CFO")).toBe(true);
    expect(isPriorityAdminRole("PROGRAM_MANAGER")).toBe(true);
  });

  it("rejects non-admin roles", () => {
    expect(isPriorityAdminRole("ENGINEER")).toBe(false);
    expect(isPriorityAdminRole("PROJECT_MANAGER" as any)).toBe(false);
    expect(isPriorityAdminRole(undefined)).toBe(false);
    expect(isPriorityAdminRole(null)).toBe(false);
  });
});

describe("department head roles", () => {
  it("includes all department heads", () => {
    expect(isDepartmentHeadRole("ENGINEERING_MANAGER")).toBe(true);
    expect(isDepartmentHeadRole("CONSTRUCTION_MANAGER")).toBe(true);
    expect(isDepartmentHeadRole("QUALITY_MANAGER")).toBe(true);
    expect(isDepartmentHeadRole("HSE_MANAGER")).toBe(true);
    expect(isDepartmentHeadRole("PROGRAM_FINANCE_MANAGER")).toBe(true);
  });

  it("includes all priority admin roles as department heads", () => {
    for (const role of PRIORITY_ADMIN_ROLES) {
      expect(isDepartmentHeadRole(role)).toBe(true);
    }
  });

  it("rejects non-head roles", () => {
    expect(isDepartmentHeadRole("ENGINEER")).toBe(false);
    expect(isDepartmentHeadRole("ACCOUNTANT")).toBe(false);
    expect(isDepartmentHeadRole(null)).toBe(false);
  });
});

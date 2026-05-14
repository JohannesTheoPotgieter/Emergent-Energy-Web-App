import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isPriorityParentAllowed,
  type PriorityParentCandidate,
} from "@shared/config/priorities";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function routeBlock(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `${start} should exist`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `${end} should exist after ${start}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("priorities sprint 3 hierarchy integrity", () => {
  const companyParent: PriorityParentCandidate = {
    id: 1,
    scope: "company",
    departmentKey: null,
  };
  const engineeringDepartmentParent: PriorityParentCandidate = {
    id: 2,
    scope: "department",
    departmentKey: "ENGINEERING",
  };
  const financeDepartmentParent: PriorityParentCandidate = {
    id: 3,
    scope: "department",
    departmentKey: "FINANCE",
  };

  it("allows only valid parent-child scope relationships", () => {
    expect(isPriorityParentAllowed({
      scope: "department",
      departmentKey: "ENGINEERING",
    }, companyParent)).toBe(true);

    expect(isPriorityParentAllowed({
      scope: "role",
      departmentKey: "ENGINEERING",
    }, companyParent)).toBe(true);

    expect(isPriorityParentAllowed({
      scope: "role",
      departmentKey: "ENGINEERING",
    }, engineeringDepartmentParent)).toBe(true);

    expect(isPriorityParentAllowed({
      scope: "role",
      departmentKey: "ENGINEERING",
    }, financeDepartmentParent)).toBe(false);

    expect(isPriorityParentAllowed({
      scope: "company",
      departmentKey: null,
    }, companyParent)).toBe(false);

    expect(isPriorityParentAllowed({
      scope: "department",
      departmentKey: "ENGINEERING",
    }, engineeringDepartmentParent)).toBe(false);
  });

  it("requires a department key for role priorities attached to department parents", () => {
    expect(isPriorityParentAllowed({
      scope: "role",
      departmentKey: null,
    }, engineeringDepartmentParent)).toBe(false);
  });

  it("validates parent links server-side during create and update", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const createBlock = routeBlock(
      source,
      "// ==================== POST /api/priorities ====================",
      "// ==================== PUT /api/priorities/:id ====================",
    );
    const updateBlock = routeBlock(
      source,
      "// ==================== PUT /api/priorities/:id ====================",
      "// Progress-source options handler.",
    );

    expect(source).toContain("assertPriorityParentLink");
    expect(source).toContain("collectDescendantIds");
    expect(createBlock).toContain("assertPriorityParentLink");
    expect(updateBlock).toContain("assertPriorityParentLink");
    expect(updateBlock).toContain("nextParentId");
    expect(updateBlock).toContain("nextDepartmentKey");
  });

  it("keeps parent candidate queries department-scoped and cache-keyed by department", () => {
    const source = read("client/src/components/priorities/PriorityFormFields.tsx");

    expect(source).toContain('form.department_key');
    expect(source).toContain('department=${encodeURIComponent(form.department_key)}');
    expect(source).toContain('queryKey: ["/api/priorities", "parent-candidates", form.scope, form.department_key]');
    expect(source).toContain("include_team_roles=false");
  });
});

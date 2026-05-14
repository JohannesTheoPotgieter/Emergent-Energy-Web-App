import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canPriorityRoleEditPriority,
  type PriorityAccessUser,
  type PriorityMutabilityRow,
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

describe("priorities sprint 2 lifecycle permissions", () => {
  const owner: PriorityAccessUser = {
    role: "ENGINEER",
    userId: 42,
    departmentKey: "ENGINEERING",
  };

  const ownRolePriority: PriorityMutabilityRow = {
    scope: "role",
    departmentKey: "ENGINEERING",
    ownerUserId: 42,
    assignedUserId: null,
  };

  it("lets regular users edit only their own role-scoped priorities", () => {
    expect(canPriorityRoleEditPriority(owner, ownRolePriority)).toBe(true);
    expect(canPriorityRoleEditPriority(owner, { ...ownRolePriority, ownerUserId: 7 })).toBe(false);
    expect(canPriorityRoleEditPriority(owner, { ...ownRolePriority, scope: "department" })).toBe(false);
    expect(canPriorityRoleEditPriority(owner, { ...ownRolePriority, scope: "company" })).toBe(false);
  });

  it("lets department heads edit their department priorities but not company priorities", () => {
    const manager: PriorityAccessUser = {
      role: "ENGINEERING_MANAGER",
      userId: 5,
      departmentKey: "ENGINEERING",
    };

    expect(canPriorityRoleEditPriority(manager, {
      scope: "department",
      departmentKey: "ENGINEERING",
      ownerUserId: null,
      assignedUserId: null,
    })).toBe(true);
    expect(canPriorityRoleEditPriority(manager, {
      scope: "department",
      departmentKey: "FINANCE",
      ownerUserId: null,
      assignedUserId: null,
    })).toBe(false);
    expect(canPriorityRoleEditPriority(manager, {
      scope: "company",
      departmentKey: null,
      ownerUserId: null,
      assignedUserId: null,
    })).toBe(false);
  });

  it("keeps priority admins unrestricted for priority edit surfaces", () => {
    expect(canPriorityRoleEditPriority({
      role: "COO_ADMIN",
      userId: 1,
      departmentKey: "LEADERSHIP",
    }, {
      scope: "company",
      departmentKey: null,
      ownerUserId: null,
      assignedUserId: null,
    })).toBe(true);
  });

  it("routes PUT priority updates through view permission plus row-level edit checks", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const putBlock = routeBlock(
      source,
      "// ==================== PUT /api/priorities/:id ====================",
      "// Progress-source options handler.",
    );

    expect(putBlock).not.toContain("requirePriorityCreator");
    expect(putBlock).toContain('requirePermission("company_priorities", "view")');
    expect(putBlock).toContain("canPriorityRoleEditPriority");
    expect(putBlock).toContain("assertRegularPriorityUpdateFields");
  });

  it("does not allow regular priority creation to attach hierarchy or projects directly", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const createBlock = routeBlock(
      source,
      "// ==================== POST /api/priorities ====================",
      "// ==================== PUT /api/priorities/:id ====================",
    );

    expect(createBlock).toContain("effectiveParentId = null");
    expect(createBlock).toContain("effectiveProjectIds = []");
  });

  it("uses row-level edit helpers on the priority detail page instead of admin-only edit controls", () => {
    const source = read("client/src/pages/priority-detail.tsx");

    expect(source).toContain("canPriorityRoleEditPriority");
    expect(source).toContain("canEditPriority");
    expect(source).not.toContain("{isAdmin && <Button size=\"sm\" variant=\"outline\" onClick={openEditDialog}");
    expect(source).not.toContain("{isAdmin && priority.status !== \"closed\" && priority.status !== \"complete\"");
  });

  it("constrains the shared priority form by allowed scopes and advanced-field flags", () => {
    const formSource = read("client/src/components/priorities/PriorityFormFields.tsx");
    const createSource = read("client/src/components/priorities/CreatePriorityDialog.tsx");

    expect(formSource).toContain("scopeOptions");
    expect(formSource).toContain("showOwnerFields");
    expect(formSource).toContain("showProjectPicker");
    expect(createSource).toContain("allowedScopes");
    expect(createSource).toContain("showProjectPicker={canUseAdvancedPriorityFields}");
  });
});

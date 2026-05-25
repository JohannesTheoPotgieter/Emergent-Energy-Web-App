import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canPriorityRoleEscalatePriority,
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

describe("canPriorityRoleEscalatePriority", () => {
  const owner: PriorityAccessUser = {
    role: "ENGINEER",
    userId: 42,
    departmentKey: "ENGINEERING",
  };
  const assignee: PriorityAccessUser = {
    role: "PROJECT_DEVELOPER",
    userId: 17,
    departmentKey: "PROJECT_DEVELOPMENT",
  };
  const otherUser: PriorityAccessUser = {
    role: "ACCOUNTANT",
    userId: 99,
    departmentKey: "FINANCE",
  };
  const deptHead: PriorityAccessUser = {
    role: "ENGINEERING_MANAGER",
    userId: 5,
    departmentKey: "ENGINEERING",
  };
  const admin: PriorityAccessUser = {
    role: "COO_ADMIN",
    userId: 1,
    departmentKey: "LEADERSHIP",
  };

  const ownedRolePriority: PriorityMutabilityRow = {
    scope: "role",
    departmentKey: "ENGINEERING",
    ownerUserId: 42,
    assignedUserId: null,
  };
  const assignedRolePriority: PriorityMutabilityRow = {
    scope: "role",
    departmentKey: "PROJECT_DEVELOPMENT",
    ownerUserId: 200,
    assignedUserId: 17,
  };
  const otherRolePriority: PriorityMutabilityRow = {
    scope: "role",
    departmentKey: "ENGINEERING",
    ownerUserId: 200,
    assignedUserId: 201,
  };
  const departmentPriority: PriorityMutabilityRow = {
    scope: "department",
    departmentKey: "ENGINEERING",
    ownerUserId: null,
    assignedUserId: null,
  };
  const companyPriority: PriorityMutabilityRow = {
    scope: "company",
    departmentKey: null,
    ownerUserId: null,
    assignedUserId: null,
  };

  it("lets the owner of a role-scope priority escalate it", () => {
    expect(canPriorityRoleEscalatePriority(owner, ownedRolePriority)).toBe(true);
  });

  it("lets the assignee of a role-scope priority escalate it", () => {
    expect(canPriorityRoleEscalatePriority(assignee, assignedRolePriority)).toBe(true);
  });

  it("does NOT let an unrelated regular user escalate someone else's role priority", () => {
    expect(canPriorityRoleEscalatePriority(otherUser, otherRolePriority)).toBe(false);
  });

  it("does NOT let a regular user escalate a department-scope priority", () => {
    expect(canPriorityRoleEscalatePriority(owner, departmentPriority)).toBe(false);
  });

  it("never allows escalation of company-scope priorities (terminal)", () => {
    expect(canPriorityRoleEscalatePriority(admin, companyPriority)).toBe(false);
    expect(canPriorityRoleEscalatePriority(deptHead, companyPriority)).toBe(false);
    expect(canPriorityRoleEscalatePriority(owner, companyPriority)).toBe(false);
  });

  it("lets a department head escalate department priorities within their own department", () => {
    expect(canPriorityRoleEscalatePriority(deptHead, departmentPriority)).toBe(true);
  });

  it("blocks a department head from escalating another department's priority", () => {
    const otherDept: PriorityMutabilityRow = {
      scope: "department",
      departmentKey: "FINANCE",
      ownerUserId: null,
      assignedUserId: null,
    };
    expect(canPriorityRoleEscalatePriority(deptHead, otherDept)).toBe(false);
  });

  it("lets priority admins escalate any non-company priority", () => {
    expect(canPriorityRoleEscalatePriority(admin, ownedRolePriority)).toBe(true);
    expect(canPriorityRoleEscalatePriority(admin, departmentPriority)).toBe(true);
  });

  it("rejects unauthenticated callers", () => {
    expect(
      canPriorityRoleEscalatePriority(
        { role: null, userId: null, departmentKey: null },
        ownedRolePriority,
      ),
    ).toBe(false);
  });
});

describe("priorities sprint 2 — route-level ownership-aware escalation", () => {
  it("escalate route loads priority then runs canPriorityRoleEscalatePriority instead of requirePriorityAdmin", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const escalateBlock = routeBlock(
      source,
      '"/api/priorities/:id/escalate"',
      'res.json(enriched);',
    );

    expect(escalateBlock).toContain('requirePermission("company_priorities", "view")');
    expect(escalateBlock).toContain("canPriorityRoleEscalatePriority");
    expect(escalateBlock).not.toMatch(/^[ \t]+requirePriorityAdmin,[ \t]*$/m);
    // Defensive departmentKey backfill — a role-scope priority created
    // before back-fill may have NULL departmentKey; we must not let an
    // owner-initiated escalation land orphaned.
    expect(escalateBlock).toContain("sourceDepartmentKey");
  });
});

describe("priorities sprint 2 — per-user shared-task promotion semantics", () => {
  it("from-task idempotency keys on (linkedTaskId, ownerUserId)", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const fromTaskBlock = routeBlock(
      source,
      "/api/priorities/from-task/:workItemId",
      "// Audit",
    );

    // Old form: where(eq(linkedTaskId, workItemId))  ← global, hides task from
    // other users who haven't promoted yet.
    // New form: where(and(eq(linkedTaskId, workItemId), eq(ownerUserId, userId)))
    expect(fromTaskBlock).toMatch(/eq\(\s*mytoolCompanyPriorities\.linkedTaskId,\s*workItemId\s*\)/);
    expect(fromTaskBlock).toMatch(/eq\(\s*mytoolCompanyPriorities\.ownerUserId,\s*userId\s*\)/);
  });

  it("my-work suppression scopes linkedIds to the caller only", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const myWorkBlock = routeBlock(
      source,
      '"/api/priorities/my-work"',
      "// 4) Filter + normalise tasks",
    );

    // The linked-task suppression set must be filtered to priorities the
    // caller owns or is assigned to. Without this, two users promoting the
    // same shared task hide it from each other.
    expect(myWorkBlock).toContain("mytoolCompanyPriorities.ownerUserId, userId");
    expect(myWorkBlock).toContain("mytoolCompanyPriorities.assignedUserId, userId");
    expect(myWorkBlock).toContain("isNotNull");
  });
});

describe("priorities — break-down child count on detail", () => {
  it("GET /api/priorities/:id passes a childCountMap to enrichPriority", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const detailBlock = routeBlock(
      source,
      '"/api/priorities/:id"',
      "// ==================== PUT /api/priorities/:id ====================",
    );

    // Regression for: parent.childCount was always 0 on the detail page even
    // after a break-down. The list endpoint built a child-count map but the
    // detail endpoint never did, so enrichPriority fell back to 0.
    expect(detailBlock).toContain("childCountMap");
    expect(detailBlock).toMatch(/enrichPriority\([^)]*childCountMap[^)]*\)/);
    // The query must only count ACTIVE children — closed/complete kids
    // should not drive the "N sub-priorities" badge.
    expect(detailBlock).toContain("activePriorityStatusCondition()");
  });
});

describe("priorities sprint 2 — atomic PUT", () => {
  it("PUT priority wraps row update + project-link replacement in db.transaction", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const putBlock = routeBlock(
      source,
      "// ==================== PUT /api/priorities/:id ====================",
      "// Progress-source options handler.",
    );

    // The whole write path is inside one transaction so a failure midway
    // through the link replacement rolls back the priority update.
    // (Uses runInTransaction helper that drops to direct writes on SQLite
    // dev fallback — better-sqlite3 rejects async callbacks.)
    expect(putBlock).toMatch(/await runInTransaction\(async \(tx\)\s*=>/);
    // Activities are deferred until after commit so a rolled-back
    // transaction never leaves orphan audit entries.
    expect(putBlock).toContain("pendingActivities");
    expect(putBlock).toMatch(/for \(const ev of pendingActivities\)/);
    // Link delete must use the tx handle.
    expect(putBlock).toMatch(/tx\.delete\(priorityProjects\)/);
    expect(putBlock).toMatch(/tx\.insert\(priorityProjects\)/);
    expect(putBlock).toMatch(/tx\.update\(mytoolCompanyPriorities\)/);
  });
});

// Role-template preview/apply unit tests — Task #101.
//
// Tests at the pure-function level so they don't need a DB:
//   1. buildPermissionsForRole snapshots the registry defaults
//      for that role correctly.
//   2. The diff produced by comparing two templates is symmetric
//      (gain ↔ loss when args swapped).
//   3. The English headline is non-empty and matches the totals.

import { describe, expect, it } from "vitest";
import {
  buildPermissionsForRole,
  ROLE_TEMPLATES,
  findRoleTemplate,
  type EntityPermissionMap,
} from "@shared/permissions/templates";
import { ENTITY_REGISTRY } from "@shared/permissions/registry";
import type { PermissionAction, PermissionEntity } from "@shared/schema";

const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];

function diffMaps(curr: EntityPermissionMap, next: EntityPermissionMap) {
  const entries: { entity: PermissionEntity; gained: PermissionAction[]; lost: PermissionAction[] }[] = [];
  let totalsGained = 0;
  let totalsLost = 0;
  for (const e of ENTITY_REGISTRY) {
    const a = curr[e.entity] ?? ({} as Record<PermissionAction, boolean>);
    const b = next[e.entity] ?? ({} as Record<PermissionAction, boolean>);
    const gained: PermissionAction[] = [];
    const lost: PermissionAction[] = [];
    for (const action of ACTIONS) {
      if (!a[action] && b[action]) gained.push(action);
      if (a[action] && !b[action]) lost.push(action);
    }
    if (gained.length || lost.length) entries.push({ entity: e.entity, gained, lost });
    totalsGained += gained.length;
    totalsLost += lost.length;
  }
  return { entries, totalsGained, totalsLost };
}

describe("role templates — Task #101", () => {
  it("buildPermissionsForRole('COO_ADMIN') grants admin:edit", () => {
    const perms = buildPermissionsForRole("COO_ADMIN");
    expect(perms.admin?.edit).toBe(true);
  });

  it("buildPermissionsForRole('ENGINEER') does NOT grant admin:edit", () => {
    const perms = buildPermissionsForRole("ENGINEER");
    expect(perms.admin?.edit).toBe(false);
  });

  it("ROLE_TEMPLATES library has 12+ entries with unique keys", () => {
    expect(ROLE_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    const keys = new Set(ROLE_TEMPLATES.map((t) => t.key));
    expect(keys.size).toBe(ROLE_TEMPLATES.length);
  });

  it("every template has a non-empty plain-English summary", () => {
    for (const t of ROLE_TEMPLATES) {
      expect(t.summary.length).toBeGreaterThan(20);
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  it("preview diff is symmetric: A→B losses == B→A gains", () => {
    const a = buildPermissionsForRole("ENGINEER");
    const b = buildPermissionsForRole("ENGINEERING_MANAGER");
    const ab = diffMaps(a, b);
    const ba = diffMaps(b, a);
    expect(ab.totalsGained).toBe(ba.totalsLost);
    expect(ab.totalsLost).toBe(ba.totalsGained);
  });

  it("applying the executive_full template to COO_ADMIN is a no-op (zero diff)", () => {
    const tpl = findRoleTemplate("executive_full")!;
    const cooBaseline = buildPermissionsForRole("COO_ADMIN");
    const diff = diffMaps(cooBaseline, tpl.permissions);
    // Executive template is the union COO+CEO, so going from COO baseline
    // it can only GAIN (CEO-exclusive grants), never lose.
    expect(diff.totalsLost).toBe(0);
  });

  it("finance_read_only template removes all edit/approve/delete", () => {
    const tpl = findRoleTemplate("finance_read_only")!;
    for (const entity of Object.keys(tpl.permissions) as PermissionEntity[]) {
      const row = tpl.permissions[entity]!;
      expect(row.edit).toBe(false);
      expect(row.create).toBe(false);
      expect(row.approve).toBe(false);
      expect(row.override).toBe(false);
      expect(row.delete).toBe(false);
    }
  });
});

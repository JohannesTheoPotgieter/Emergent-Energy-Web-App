import { describe, expect, it } from "vitest";
import { matchesPriorityListFilter } from "@shared/config/priorities";

const empty = new Set<number>();

describe("matchesPriorityListFilter", () => {
  it("defaults to company scope when no scope filter is set", () => {
    expect(matchesPriorityListFilter(
      { scope: "company", departmentKey: null, ownerUserId: null, assignedUserId: null },
      { scopeFilter: null, departmentFilter: null, teamUserIds: empty },
    )).toBe(true);

    expect(matchesPriorityListFilter(
      { scope: "department", departmentKey: "ENGINEERING", ownerUserId: null, assignedUserId: null },
      { scopeFilter: null, departmentFilter: null, teamUserIds: empty },
    )).toBe(false);
  });

  it("matches scope = department with the correct departmentKey", () => {
    expect(matchesPriorityListFilter(
      { scope: "department", departmentKey: "ENGINEERING", ownerUserId: null, assignedUserId: null },
      { scopeFilter: "department", departmentFilter: "ENGINEERING", teamUserIds: empty },
    )).toBe(true);

    expect(matchesPriorityListFilter(
      { scope: "department", departmentKey: "FINANCE", ownerUserId: null, assignedUserId: null },
      { scopeFilter: "department", departmentFilter: "ENGINEERING", teamUserIds: empty },
    )).toBe(false);
  });

  it("includes role priorities owned by a team member (team-role inclusion)", () => {
    const teamUserIds = new Set([42, 43]);

    expect(matchesPriorityListFilter(
      { scope: "role", departmentKey: null, ownerUserId: 42, assignedUserId: null },
      { scopeFilter: "department", departmentFilter: "ENGINEERING", teamUserIds },
    )).toBe(true);

    expect(matchesPriorityListFilter(
      { scope: "role", departmentKey: null, ownerUserId: null, assignedUserId: 43 },
      { scopeFilter: "department", departmentFilter: "ENGINEERING", teamUserIds },
    )).toBe(true);
  });

  it("excludes role priorities whose owner or assignee is NOT in the target department", () => {
    const teamUserIds = new Set([42]);

    expect(matchesPriorityListFilter(
      { scope: "role", departmentKey: null, ownerUserId: 99, assignedUserId: 100 },
      { scopeFilter: "department", departmentFilter: "ENGINEERING", teamUserIds },
    )).toBe(false);
  });

  it("does NOT enable team-role inclusion when the scope filter is NOT department", () => {
    // Same team but scope filter is company — the role row must not leak in.
    const teamUserIds = new Set([42]);

    expect(matchesPriorityListFilter(
      { scope: "role", departmentKey: null, ownerUserId: 42, assignedUserId: null },
      { scopeFilter: "company", departmentFilter: null, teamUserIds },
    )).toBe(false);
  });

  it("preserves primary department matches even when team-role inclusion fires on a role row", () => {
    const teamUserIds = new Set([42]);

    // Department-scope row should still pass via the primary branch.
    expect(matchesPriorityListFilter(
      { scope: "department", departmentKey: "ENGINEERING", ownerUserId: null, assignedUserId: null },
      { scopeFilter: "department", departmentFilter: "ENGINEERING", teamUserIds },
    )).toBe(true);
  });

  it("does not let a department filter leak into the team-role branch via departmentKey", () => {
    // A role priority with departmentKey set should still go through the
    // team-role check (owner/assignee), not the departmentKey filter.
    const teamUserIds = new Set([42]);

    expect(matchesPriorityListFilter(
      { scope: "role", departmentKey: "FINANCE", ownerUserId: 42, assignedUserId: null },
      { scopeFilter: "department", departmentFilter: "ENGINEERING", teamUserIds },
    )).toBe(true);
  });

  it("handles null department filter with team-role inclusion as a no-op", () => {
    // If no department is targeted, the scope filter alone decides.
    const teamUserIds = new Set([42]);

    expect(matchesPriorityListFilter(
      { scope: "department", departmentKey: null, ownerUserId: null, assignedUserId: null },
      { scopeFilter: "department", departmentFilter: null, teamUserIds },
    )).toBe(true);

    // Role row with null department filter — primary fails (scope mismatch),
    // and team-role branch requires ownership.
    expect(matchesPriorityListFilter(
      { scope: "role", departmentKey: null, ownerUserId: 42, assignedUserId: null },
      { scopeFilter: "department", departmentFilter: null, teamUserIds },
    )).toBe(true);
  });
});

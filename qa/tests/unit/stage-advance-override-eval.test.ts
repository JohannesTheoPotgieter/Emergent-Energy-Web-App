import { describe, expect, it } from "vitest";

import { evaluateStageAdvanceDecision } from "../../../server/lib/stage-advance-override-eval";

const DEFAULT_ROLES = new Set(["COO_ADMIN", "CEO_ADMIN"]);
const OVERRIDE_ROLES = new Set([
  "COO_ADMIN",
  "CEO_ADMIN",
  "PROGRAM_MANAGER",
  "CONSTRUCTION_MANAGER",
]);

describe("evaluateStageAdvanceDecision", () => {
  it("default path: COO_ADMIN with no reason advances cleanly", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "COO_ADMIN",
      rawReason: undefined,
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision).toEqual({
      kind: "advance",
      overrideApplied: false,
      reason: null,
    });
  });

  it("default path: CEO_ADMIN with reason preserves the reason for audit", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "CEO_ADMIN",
      rawReason: "  bulk-aligning project to current reality  ",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision).toEqual({
      kind: "advance",
      overrideApplied: false,
      reason: "bulk-aligning project to current reality",
    });
  });

  it("default path: COO_ADMIN with non-string reason still advances (reason becomes null)", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "COO_ADMIN",
      rawReason: { not: "a string" },
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("advance");
    if (decision.kind !== "advance") return;
    expect(decision.reason).toBeNull();
  });

  it("override path: PROGRAM_MANAGER with valid reason → advance_with_override", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "PROGRAM_MANAGER",
      rawReason: "client signed; aligning lifecycle to actual progress",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision).toEqual({
      kind: "advance_with_override",
      overrideApplied: true,
      reason: "client signed; aligning lifecycle to actual progress",
    });
  });

  it("override path: CONSTRUCTION_MANAGER with valid reason → advance_with_override (registry expansion)", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "CONSTRUCTION_MANAGER",
      rawReason: "site mobilised; commissioning gate ready",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("advance_with_override");
  });

  it("override path: PROGRAM_MANAGER without reason → reject 400 with hint", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "PROGRAM_MANAGER",
      rawReason: undefined,
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(400);
    expect(decision.body.field).toBe("reason");
    expect(decision.body.hint).toMatch(/non-empty/);
  });

  it("override path: PROGRAM_MANAGER with whitespace-only reason → reject 400", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "PROGRAM_MANAGER",
      rawReason: "    \t  \n  ",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(400);
  });

  it("override path: PROGRAM_MANAGER with non-string reason → reject 400 (defensive)", () => {
    const cases: unknown[] = [["a", "b"], { msg: "x" }, 42, true, null];
    for (const bad of cases) {
      const decision = evaluateStageAdvanceDecision({
        userRole: "PROGRAM_MANAGER",
        rawReason: bad,
        defaultRoles: DEFAULT_ROLES,
        overrideRoles: OVERRIDE_ROLES,
      });
      expect(decision.kind).toBe("reject");
    }
  });

  it("forbidden: PROJECT_MANAGER_SITE → reject 403 listing authorised roles", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "PROJECT_MANAGER_SITE",
      rawReason: "I tried to advance",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
    expect(decision.body.error).toMatch(/CEO_ADMIN/);
    expect(decision.body.error).toMatch(/COO_ADMIN/);
    expect(decision.body.error).toMatch(/PROGRAM_MANAGER/);
    expect(decision.body.error).toMatch(/CONSTRUCTION_MANAGER/);
  });

  it("forbidden: ENGINEER → reject 403", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "ENGINEER",
      rawReason: "yes",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
  });

  it("forbidden: undefined userRole → reject 403", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: undefined,
      rawReason: "anything",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
  });

  it("forbidden: empty-string userRole → reject 403 (does not collide with empty-set lookup)", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "",
      rawReason: "anything",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
  });

  it("respects custom default-role set (defensive: helper not coupled to one entity)", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "CFO",
      rawReason: undefined,
      defaultRoles: new Set(["CFO"]),
      overrideRoles: new Set(["CFO", "CCO"]),
    });
    expect(decision.kind).toBe("advance");
  });

  it("respects custom override-role set (defensive)", () => {
    const ccoBlocked = evaluateStageAdvanceDecision({
      userRole: "CCO",
      rawReason: "yes",
      defaultRoles: new Set(["CFO"]),
      overrideRoles: new Set(["CFO"]), // CCO removed
    });
    expect(ccoBlocked.kind).toBe("reject");

    const ccoAllowed = evaluateStageAdvanceDecision({
      userRole: "CCO",
      rawReason: "yes",
      defaultRoles: new Set(["CFO"]),
      overrideRoles: new Set(["CFO", "CCO"]),
    });
    expect(ccoAllowed.kind).toBe("advance_with_override");
  });
});

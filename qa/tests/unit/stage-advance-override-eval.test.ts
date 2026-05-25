import { describe, expect, it } from "vitest";

import { evaluateStageAdvanceDecision } from "../../../server/lib/stage-advance-override-eval";

const DEFAULT_ROLES = new Set(["COO_ADMIN"]);
const OVERRIDE_ROLES = new Set([
  "COO_ADMIN",
  "CEO_ADMIN",
  "PROGRAM_MANAGER",
  "CONSTRUCTION_MANAGER",
]);

describe("evaluateStageAdvanceDecision", () => {
  it("allows COO_ADMIN only when a written reason is provided", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "COO_ADMIN",
      rawReason: "  client signed; aligning lifecycle to actual progress  ",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });

    expect(decision).toEqual({
      kind: "advance_with_override",
      overrideApplied: true,
      reason: "client signed; aligning lifecycle to actual progress",
    });
  });

  it("rejects COO_ADMIN without a reason", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "COO_ADMIN",
      rawReason: undefined,
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });

    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(400);
    expect(decision.body.field).toBe("reason");
    expect(decision.body.error).toMatch(/written reason/);
  });

  it("rejects COO_ADMIN with a non-string reason", () => {
    for (const bad of [["a", "b"], { msg: "x" }, 42, true, null]) {
      const decision = evaluateStageAdvanceDecision({
        userRole: "COO_ADMIN",
        rawReason: bad,
        defaultRoles: DEFAULT_ROLES,
        overrideRoles: OVERRIDE_ROLES,
      });
      expect(decision.kind).toBe("reject");
      if (decision.kind !== "reject") return;
      expect(decision.status).toBe(400);
    }
  });

  it("rejects CEO_ADMIN even when the registry lists CEO as an override role", () => {
    const decision = evaluateStageAdvanceDecision({
      userRole: "CEO_ADMIN",
      rawReason: "executive alignment",
      defaultRoles: new Set(["COO_ADMIN", "CEO_ADMIN"]),
      overrideRoles: OVERRIDE_ROLES,
    });

    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
    expect(decision.body.error).toMatch(/COO_ADMIN/);
  });

  it("rejects operational roles even with a reason", () => {
    for (const role of ["PROGRAM_MANAGER", "CONSTRUCTION_MANAGER", "PROJECT_MANAGER_SITE", "ENGINEER"]) {
      const decision = evaluateStageAdvanceDecision({
        userRole: role,
        rawReason: "work is already complete",
        defaultRoles: DEFAULT_ROLES,
        overrideRoles: OVERRIDE_ROLES,
      });
      expect(decision.kind).toBe("reject");
      if (decision.kind !== "reject") return;
      expect(decision.status).toBe(403);
      expect(decision.body.error).toMatch(/COO_ADMIN/);
    }
  });

  it("rejects missing or blank user roles", () => {
    for (const userRole of [undefined, ""]) {
      const decision = evaluateStageAdvanceDecision({
        userRole,
        rawReason: "anything",
        defaultRoles: DEFAULT_ROLES,
        overrideRoles: OVERRIDE_ROLES,
      });
      expect(decision.kind).toBe("reject");
      if (decision.kind !== "reject") return;
      expect(decision.status).toBe(403);
    }
  });

  it("does not grant bypass from custom default or override role sets", () => {
    const cfoDefault = evaluateStageAdvanceDecision({
      userRole: "CFO",
      rawReason: "yes",
      defaultRoles: new Set(["CFO"]),
      overrideRoles: new Set(["CFO"]),
    });
    expect(cfoDefault.kind).toBe("reject");

    const ccoOverride = evaluateStageAdvanceDecision({
      userRole: "CCO",
      rawReason: "yes",
      defaultRoles: new Set(["CFO"]),
      overrideRoles: new Set(["CFO", "CCO"]),
    });
    expect(ccoOverride.kind).toBe("reject");
  });
});

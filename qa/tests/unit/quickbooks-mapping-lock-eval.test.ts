import { describe, expect, it } from "vitest";

import { evaluateQbMappingLockDecision } from "../../../server/lib/quickbooks-mapping-lock-eval";

const DEFAULT_ROLES = new Set(["COO_ADMIN", "CEO_ADMIN"]);
const OVERRIDE_ROLES = new Set([
  "COO_ADMIN",
  "CEO_ADMIN",
  "CFO",
  "PROGRAM_FINANCE_MANAGER",
]);

describe("evaluateQbMappingLockDecision", () => {
  it("default path: COO_ADMIN with no reason proceeds cleanly", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "COO_ADMIN",
      rawOverrideReason: undefined,
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision).toEqual({
      kind: "proceed",
      overrideApplied: false,
      reason: null,
    });
  });

  it("default path: CEO_ADMIN with reason preserves and trims it for audit", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "CEO_ADMIN",
      rawOverrideReason: "  rebinding to merged QB customer record  ",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision).toEqual({
      kind: "proceed",
      overrideApplied: false,
      reason: "rebinding to merged QB customer record",
    });
  });

  it("default path: COO_ADMIN with non-string reason still proceeds (reason → null)", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "COO_ADMIN",
      rawOverrideReason: { ignored: true },
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("proceed");
    if (decision.kind !== "proceed") return;
    expect(decision.reason).toBeNull();
  });

  it("override path: CFO with valid reason → proceed_with_override", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "CFO",
      rawOverrideReason: "QB customer ID changed during reconciliation",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision).toEqual({
      kind: "proceed_with_override",
      overrideApplied: true,
      reason: "QB customer ID changed during reconciliation",
    });
  });

  it("override path: PROGRAM_FINANCE_MANAGER with valid reason → proceed_with_override", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "PROGRAM_FINANCE_MANAGER",
      rawOverrideReason: "consolidating duplicate vendor records",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("proceed_with_override");
  });

  it("override path: CFO without reason → reject 400 with hint", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "CFO",
      rawOverrideReason: undefined,
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(400);
    expect(decision.body.error).toBe("override_reason_required");
    expect(decision.body.field).toBe("override_reason");
    expect(decision.body.hint).toMatch(/audit/);
  });

  it("override path: PFM with whitespace-only reason → reject 400", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "PROGRAM_FINANCE_MANAGER",
      rawOverrideReason: "    \t  \n   ",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(400);
  });

  it("override path: CFO with non-string reason → reject 400 (defensive)", () => {
    const cases: unknown[] = [["a", "b"], { msg: "x" }, 42, true, null];
    for (const bad of cases) {
      const decision = evaluateQbMappingLockDecision({
        userRole: "CFO",
        rawOverrideReason: bad,
        defaultRoles: DEFAULT_ROLES,
        overrideRoles: OVERRIDE_ROLES,
      });
      expect(decision.kind).toBe("reject");
      if (decision.kind !== "reject") continue;
      expect(decision.status).toBe(400);
    }
  });

  it("forbidden: ACCOUNTANT → reject 403 listing authorised roles", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "ACCOUNTANT",
      rawOverrideReason: "I do reconciliation work",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
    expect(decision.body.error).toBe("mapping_locked");
    expect(decision.body.message).toMatch(/COO_ADMIN/);
    expect(decision.body.message).toMatch(/CFO/);
    expect(decision.body.message).toMatch(/PROGRAM_FINANCE_MANAGER/);
  });

  it("forbidden: PROJECT_MANAGER_SITE → reject 403", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "PROJECT_MANAGER_SITE",
      rawOverrideReason: "irrelevant",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
  });

  it("forbidden: ENGINEER → reject 403", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "ENGINEER",
      rawOverrideReason: undefined,
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
  });

  it("forbidden: undefined userRole → reject 403", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: undefined,
      rawOverrideReason: "anything",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
  });

  it("forbidden: empty-string userRole → reject 403 (no empty-set match)", () => {
    const decision = evaluateQbMappingLockDecision({
      userRole: "",
      rawOverrideReason: "anything",
      defaultRoles: DEFAULT_ROLES,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(403);
  });

  it("respects custom default-role and override-role sets (defensive: helper not coupled to one entity)", () => {
    const cooDeniedByCustomSet = evaluateQbMappingLockDecision({
      userRole: "COO_ADMIN",
      rawOverrideReason: "anything",
      defaultRoles: new Set(["CFO"]),
      overrideRoles: new Set(["CFO"]),
    });
    expect(cooDeniedByCustomSet.kind).toBe("reject");

    const cfoAllowed = evaluateQbMappingLockDecision({
      userRole: "CFO",
      rawOverrideReason: undefined,
      defaultRoles: new Set(["CFO"]),
      overrideRoles: new Set(["CFO"]),
    });
    expect(cfoAllowed.kind).toBe("proceed");
  });
});

import { describe, expect, it } from "vitest";

import { evaluateHandoverAcceptDecision } from "../../../server/lib/handover-accept-override-eval";

const OVERRIDE_ROLES = new Set(["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"]);

describe("evaluateHandoverAcceptDecision", () => {
  it("returns accept when there are no missing items", () => {
    const decision = evaluateHandoverAcceptDecision({
      userRole: "PROJECT_MANAGER_SITE",
      missingItems: [],
      rawOverrideReason: undefined,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision).toEqual({ kind: "accept", overrideApplied: false });
  });

  it("returns accept when there are no missing items and reason is irrelevantly present", () => {
    const decision = evaluateHandoverAcceptDecision({
      userRole: "PROJECT_MANAGER_SITE",
      missingItems: [],
      rawOverrideReason: "ignored when not needed",
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("accept");
  });

  it("rejects with a reason hint when missing items + no reason", () => {
    const decision = evaluateHandoverAcceptDecision({
      userRole: "COO_ADMIN",
      missingItems: [{ section: "Charter" }, { section: "Stakeholders" }],
      rawOverrideReason: undefined,
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.status).toBe(400);
    expect(decision.body.field).toBe("override_reason");
    expect(decision.body.missingItems).toHaveLength(2);
    expect(decision.body.hint).toMatch(/COO_ADMIN/);
    expect(decision.body.hint).toMatch(/PROGRAM_MANAGER/);
  });

  it("rejects when reason is whitespace-only", () => {
    const decision = evaluateHandoverAcceptDecision({
      userRole: "COO_ADMIN",
      missingItems: [{ section: "Charter" }],
      rawOverrideReason: "    \t  ",
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.body.field).toBe("override_reason");
  });

  it("rejects when reason is a non-string (array, object, number, boolean, null)", () => {
    const cases: unknown[] = [["a", "b"], { msg: "x" }, 42, true, null];
    for (const bad of cases) {
      const decision = evaluateHandoverAcceptDecision({
        userRole: "COO_ADMIN",
        missingItems: [{ section: "Charter" }],
        rawOverrideReason: bad,
        overrideRoles: OVERRIDE_ROLES,
      });
      expect(decision.kind).toBe("reject");
    }
  });

  it("rejects when role is not in override_roles even with valid reason", () => {
    const decision = evaluateHandoverAcceptDecision({
      userRole: "ENGINEER",
      missingItems: [{ section: "Charter" }],
      rawOverrideReason: "we need to push this through for the site visit on Friday",
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") return;
    expect(decision.body.error).toMatch(/not authorised to override/);
    expect(decision.body.error).toMatch(/COO_ADMIN/);
    expect(decision.body.missingItems).toHaveLength(1);
  });

  it("rejects when userRole is undefined", () => {
    const decision = evaluateHandoverAcceptDecision({
      userRole: undefined,
      missingItems: [{ section: "Charter" }],
      rawOverrideReason: "trying anyway",
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("reject");
  });

  it("accepts with override when COO + valid reason and trims the reason", () => {
    const decision = evaluateHandoverAcceptDecision({
      userRole: "COO_ADMIN",
      missingItems: [{ section: "Charter" }],
      rawOverrideReason: "  client deadline locked, deferring stakeholder list  ",
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision).toEqual({
      kind: "accept_with_override",
      overrideApplied: true,
      reason: "client deadline locked, deferring stakeholder list",
    });
  });

  it("accepts with override for PROGRAM_MANAGER (per registry expansion in this PR)", () => {
    const decision = evaluateHandoverAcceptDecision({
      userRole: "PROGRAM_MANAGER",
      missingItems: [{ section: "Stakeholders" }],
      rawOverrideReason: "PD off sick; PM picking up next week",
      overrideRoles: OVERRIDE_ROLES,
    });
    expect(decision.kind).toBe("accept_with_override");
  });

  it("respects a custom override-role set (defensive: not coupled to one entity)", () => {
    const customRoles = new Set(["CFO"]);
    const cooDenied = evaluateHandoverAcceptDecision({
      userRole: "COO_ADMIN",
      missingItems: [{ section: "Charter" }],
      rawOverrideReason: "anything",
      overrideRoles: customRoles,
    });
    expect(cooDenied.kind).toBe("reject");

    const cfoAllowed = evaluateHandoverAcceptDecision({
      userRole: "CFO",
      missingItems: [{ section: "Charter" }],
      rawOverrideReason: "finance authority on this one",
      overrideRoles: customRoles,
    });
    expect(cfoAllowed.kind).toBe("accept_with_override");
  });
});

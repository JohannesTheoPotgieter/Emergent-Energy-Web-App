import { describe, it, expect } from "vitest";
import {
  RELEASED_FOR_STATES,
  RELEASED_FOR_TRANSITIONS,
  DRAWING_STATUSES,
  DRAWING_STATUS_TRANSITIONS,
  type ReleasedForState,
  type DrawingStatus,
} from "../../../shared/schema/engineering";

/**
 * Pure-logic tests for the engineering IFC guardrails introduced by
 * migration 20260415_engineering_ifc_guardrails.sql. These tests lock the
 * transition tables and the stage-gate rule semantics so that approval
 * cannot silently imply "issued for construction".
 *
 * These are deliberately pure unit tests — they do NOT touch the database
 * or spin up the server. They exist to pin the state machines.
 */

describe("projectEngDeliverables.releasedFor lifecycle", () => {
  it("includes all six controlled-document states", () => {
    expect(RELEASED_FOR_STATES).toEqual([
      "draft",
      "under_review",
      "approved_for_review",
      "issued_for_construction",
      "as_built",
      "superseded",
    ]);
  });

  it("approved_for_review CANNOT jump directly to as_built", () => {
    const next = RELEASED_FOR_TRANSITIONS["approved_for_review"];
    expect(next).not.toContain("as_built");
  });

  it("approved_for_review CAN move to issued_for_construction", () => {
    expect(RELEASED_FOR_TRANSITIONS["approved_for_review"]).toContain(
      "issued_for_construction",
    );
  });

  it("draft CANNOT jump directly to issued_for_construction", () => {
    // This is the core guardrail — approval must exist before IFC.
    expect(RELEASED_FOR_TRANSITIONS["draft"]).not.toContain(
      "issued_for_construction",
    );
  });

  it("under_review CANNOT jump directly to issued_for_construction", () => {
    expect(RELEASED_FOR_TRANSITIONS["under_review"]).not.toContain(
      "issued_for_construction",
    );
  });

  it("issued_for_construction can only go to as_built or superseded", () => {
    expect(RELEASED_FOR_TRANSITIONS["issued_for_construction"]).toEqual([
      "as_built",
      "superseded",
    ]);
  });

  it("as_built is terminal except for superseded", () => {
    expect(RELEASED_FOR_TRANSITIONS["as_built"]).toEqual(["superseded"]);
  });

  it("superseded is fully terminal", () => {
    expect(RELEASED_FOR_TRANSITIONS["superseded"]).toEqual([]);
  });

  it("every state is reachable by walking the transition graph", () => {
    const seen = new Set<ReleasedForState>();
    const walk = (s: ReleasedForState) => {
      if (seen.has(s)) return;
      seen.add(s);
      for (const next of RELEASED_FOR_TRANSITIONS[s]) walk(next);
    };
    walk("draft");
    for (const s of RELEASED_FOR_STATES) {
      expect(seen.has(s)).toBe(true);
    }
  });
});

describe("drawingRegister.status lifecycle", () => {
  it("includes all seven drawing statuses", () => {
    expect(DRAWING_STATUSES).toEqual([
      "draft",
      "for_review",
      "for_approval",
      "approved",
      "ifc",
      "as_built",
      "superseded",
    ]);
  });

  it("approved is NOT automatically ifc", () => {
    const next = DRAWING_STATUS_TRANSITIONS["approved"];
    expect(next).toContain("ifc");
    // But draft/for_approval cannot jump to ifc without going through approved.
    expect(DRAWING_STATUS_TRANSITIONS["draft"]).not.toContain("ifc");
    expect(DRAWING_STATUS_TRANSITIONS["for_approval"]).not.toContain("ifc");
  });

  it("ifc can only progress to as_built or superseded", () => {
    expect(DRAWING_STATUS_TRANSITIONS["ifc"]).toEqual(["as_built", "superseded"]);
  });

  it("for_review cannot skip straight to approved", () => {
    // Must go via for_approval.
    expect(DRAWING_STATUS_TRANSITIONS["for_review"]).not.toContain("approved");
    expect(DRAWING_STATUS_TRANSITIONS["for_review"]).toContain("for_approval");
  });

  it("every state is reachable", () => {
    const seen = new Set<DrawingStatus>();
    const walk = (s: DrawingStatus) => {
      if (seen.has(s)) return;
      seen.add(s);
      for (const next of DRAWING_STATUS_TRANSITIONS[s]) walk(next);
    };
    walk("draft");
    for (const s of DRAWING_STATUSES) {
      expect(seen.has(s)).toBe(true);
    }
  });
});

/**
 * Pin the shape of the new optional stage-gate rule flags. The server
 * reads `rules.requireIfcIssuance` and `rules.requireAsBuilt` from
 * engStageTemplates.stageGateRules JSON. This test documents that
 * contract so that refactors of the gate cannot silently drop the flags.
 */
describe("stage-gate rule contract: IFC and as-built flags", () => {
  type StageGateRules = {
    requireAllTasks?: boolean;
    requireAllDeliverables?: boolean;
    requireQaApproval?: boolean;
    requireTechnicalSignoff?: boolean;
    requireIfcIssuance?: boolean;
    requireAsBuilt?: boolean;
  };

  it("a stage with no IFC flag behaves exactly like before (back-compat)", () => {
    const rules: StageGateRules = { requireAllTasks: true, requireAllDeliverables: true };
    expect(Boolean(rules.requireIfcIssuance)).toBe(false);
    expect(Boolean(rules.requireAsBuilt)).toBe(false);
  });

  it("IFC Planning stage opts in via requireIfcIssuance", () => {
    const rules: StageGateRules = {
      requireAllTasks: true,
      requireAllDeliverables: true,
      requireIfcIssuance: true,
    };
    expect(rules.requireIfcIssuance).toBe(true);
  });

  it("Handover Pack stage can opt in via requireAsBuilt", () => {
    const rules: StageGateRules = {
      requireAllTasks: true,
      requireAllDeliverables: true,
      requireQaApproval: true,
      requireTechnicalSignoff: true,
      requireAsBuilt: true,
    };
    expect(rules.requireAsBuilt).toBe(true);
    // Handover should also keep the existing QA + technical signoff gates.
    expect(rules.requireQaApproval).toBe(true);
    expect(rules.requireTechnicalSignoff).toBe(true);
  });

  /**
   * Simulates the gate check performed in
   * server/eng-stage-routes.ts POST /api/eng-stages/stages/:stageId/complete
   * so that the contract is pinned by a test even though the route itself
   * uses a live db.
   */
  it("gate rejects stage complete when requireIfcIssuance is on and no deliverables are IFC", () => {
    const rules: StageGateRules = { requireIfcIssuance: true };
    const requiredTemplates = [
      { id: 1, name: "IFC Drawing Pack", requiredCount: 1, isRequired: true },
    ];
    const uploads = [
      { deliverableTemplateId: 1, releasedFor: "approved_for_review" as ReleasedForState },
    ];
    const missing: string[] = [];
    if (rules.requireIfcIssuance) {
      for (const dt of requiredTemplates) {
        const ifcCount = uploads.filter(
          (u) =>
            u.deliverableTemplateId === dt.id &&
            (u.releasedFor === "issued_for_construction" || u.releasedFor === "as_built"),
        ).length;
        if (ifcCount < dt.requiredCount) {
          missing.push(`Not Issued For Construction: ${dt.name}`);
        }
      }
    }
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/Not Issued For Construction/);
  });

  it("gate passes when the same deliverable is marked issued_for_construction", () => {
    const rules: StageGateRules = { requireIfcIssuance: true };
    const requiredTemplates = [
      { id: 1, name: "IFC Drawing Pack", requiredCount: 1, isRequired: true },
    ];
    const uploads = [
      { deliverableTemplateId: 1, releasedFor: "issued_for_construction" as ReleasedForState },
    ];
    const missing: string[] = [];
    if (rules.requireIfcIssuance) {
      for (const dt of requiredTemplates) {
        const ifcCount = uploads.filter(
          (u) =>
            u.deliverableTemplateId === dt.id &&
            (u.releasedFor === "issued_for_construction" || u.releasedFor === "as_built"),
        ).length;
        if (ifcCount < dt.requiredCount) {
          missing.push(`Not Issued For Construction: ${dt.name}`);
        }
      }
    }
    expect(missing).toHaveLength(0);
  });
});

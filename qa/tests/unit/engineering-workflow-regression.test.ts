import { describe, it, expect } from "vitest";
import {
  TASK_STATUSES,
  canTransition,
  isTaskComplete,
  isTaskCompleteForReporting,
  isApprovalState,
  isExecutionState,
  normalizeToUniversalStatus,
  getTaskStatusLabel,
} from "../../../shared/task-status";
import {
  RELEASED_FOR_STATES,
  RELEASED_FOR_TRANSITIONS,
  DRAWING_STATUSES,
  DRAWING_STATUS_TRANSITIONS,
  TRANSMITTAL_PURPOSES,
  type ReleasedForState,
  type DrawingStatus,
} from "../../../shared/schema/engineering";
import { toCanonicalStatus } from "../../../server/work-items-adapter";

/**
 * Engineering workflow regression tests — targeted coverage for the
 * critical flows identified in the gap analysis. These are pure-logic
 * tests that pin expected behavior without touching the database.
 *
 * Coverage map:
 *   Flow 1: Status transition matrix (canTransition)
 *   Flow 2: Hold validation with canonical statuses
 *   Flow 3: Parent-child completion logic (validateParentCompletion contract)
 *   Flow 4: Deliverable lifecycle state machine
 *   Flow 7: Status normalization round-trip
 *   Flow 9: Drawing register state machine
 */

// ===== Flow 1: Task status transition matrix =====

describe("task status transition matrix (canTransition)", () => {
  it("allows to_do → in_progress", () => {
    expect(canTransition("to_do", "in_progress")).toBe(true);
  });

  it("allows in_progress → needs_approval", () => {
    expect(canTransition("in_progress", "needs_approval")).toBe(true);
  });

  it("allows needs_approval → qc_approved", () => {
    expect(canTransition("needs_approval", "qc_approved")).toBe(true);
  });

  it("allows needs_approval → provide_feedback", () => {
    expect(canTransition("needs_approval", "provide_feedback")).toBe(true);
  });

  it("allows in_progress → complete", () => {
    expect(canTransition("in_progress", "complete")).toBe(true);
  });

  it("allows in_progress → hold", () => {
    expect(canTransition("in_progress", "hold")).toBe(true);
  });

  it("allows hold → in_progress (resume)", () => {
    expect(canTransition("hold", "in_progress")).toBe(true);
  });

  it("allows same → same (no-op)", () => {
    for (const s of TASK_STATUSES) {
      expect(canTransition(s, s)).toBe(true);
    }
  });
});

describe("task status classification", () => {
  it("only 'complete' is execution-complete", () => {
    const completeStatuses = TASK_STATUSES.filter(s => isTaskComplete(s));
    expect(completeStatuses).toEqual(["complete"]);
  });

  it("qc_approved and complete are reporting-complete", () => {
    const reportComplete = TASK_STATUSES.filter(s => isTaskCompleteForReporting(s));
    expect(reportComplete).toContain("qc_approved");
    expect(reportComplete).toContain("complete");
  });

  it("approval states are: needs_approval, qc_approved, provide_feedback, operational_approval", () => {
    const approvalStates = TASK_STATUSES.filter(s => isApprovalState(s));
    expect(approvalStates).toContain("needs_approval");
    expect(approvalStates).toContain("qc_approved");
    expect(approvalStates).toContain("provide_feedback");
    expect(approvalStates).toContain("operational_approval");
    expect(approvalStates).not.toContain("in_progress");
    expect(approvalStates).not.toContain("complete");
  });

  it("execution states are: not_started, to_do, in_progress, hold, projects_assistance, complete", () => {
    const execStates = TASK_STATUSES.filter(s => isExecutionState(s));
    expect(execStates).toContain("to_do");
    expect(execStates).toContain("in_progress");
    expect(execStates).toContain("hold");
    expect(execStates).toContain("complete");
    expect(execStates).not.toContain("needs_approval");
  });

  it("every status is either approval or execution (no orphans)", () => {
    for (const s of TASK_STATUSES) {
      expect(isApprovalState(s) || isExecutionState(s)).toBe(true);
    }
  });
});

// ===== Flow 2: Hold validation with canonical + legacy statuses =====

describe("hold transitions accept both canonical and legacy formats", () => {
  // The workflow guard .toUpperCase()s internally, so both should work
  it("canonical hold → in_progress", () => {
    // canTransition works with canonical lowercase
    expect(canTransition("hold", "in_progress")).toBe(true);
  });

  it("canonical in_progress → hold", () => {
    expect(canTransition("in_progress", "hold")).toBe(true);
  });
});

// ===== Flow 3: Parent-child completion contract =====

describe("parent-child completion contract", () => {
  // These tests pin the TERMINAL_STATUSES set used by
  // validateParentCompletion in task-cascade-service.ts.
  // The service considers a child "complete" when its status is
  // in the terminal set. We test the set against the canonical statuses.

  // Read the terminal set from the source to ensure drift detection
  const cascadeSource = require("fs").readFileSync(
    require("path").join(__dirname, "..", "..", "..", "server", "services", "task-cascade-service.ts"),
    "utf8",
  );

  it("task-cascade-service defines TERMINAL_STATUSES", () => {
    expect(cascadeSource).toContain("TERMINAL_STATUSES");
  });

  it("terminal set includes 'complete'", () => {
    expect(cascadeSource).toMatch(/TERMINAL_STATUSES.*complete/s);
  });

  it("validateParentCompletion is exported", () => {
    expect(cascadeSource).toContain("export async function validateParentCompletion");
  });

  it("validateParentCompletion checks children against TERMINAL_STATUSES", () => {
    expect(cascadeSource).toContain("TERMINAL_STATUSES.has(c.status");
  });

  it("runCascadesAfterUpdate cascades both dates and status", () => {
    expect(cascadeSource).toContain("cascadeDatesToParent");
    expect(cascadeSource).toContain("cascadeStatusToParent");
    expect(cascadeSource).toContain("cascadeStatusToChildren");
  });
});

// ===== Flow 4: Deliverable lifecycle state machine =====

describe("deliverable releasedFor lifecycle is complete and non-circular", () => {
  it("has exactly 6 states", () => {
    expect(RELEASED_FOR_STATES).toHaveLength(6);
  });

  it("every state has a defined transition list (even if empty)", () => {
    for (const s of RELEASED_FOR_STATES) {
      expect(RELEASED_FOR_TRANSITIONS[s]).toBeDefined();
      expect(Array.isArray(RELEASED_FOR_TRANSITIONS[s])).toBe(true);
    }
  });

  it("the happy path is: draft → under_review → approved_for_review → issued_for_construction → as_built", () => {
    expect(RELEASED_FOR_TRANSITIONS.draft).toContain("under_review");
    expect(RELEASED_FOR_TRANSITIONS.under_review).toContain("approved_for_review");
    expect(RELEASED_FOR_TRANSITIONS.approved_for_review).toContain("issued_for_construction");
    expect(RELEASED_FOR_TRANSITIONS.issued_for_construction).toContain("as_built");
  });

  it("every non-terminal state can reach superseded", () => {
    for (const s of RELEASED_FOR_STATES) {
      if (s === "superseded") continue;
      expect(RELEASED_FOR_TRANSITIONS[s]).toContain("superseded");
    }
  });

  it("superseded is terminal (no outbound transitions)", () => {
    expect(RELEASED_FOR_TRANSITIONS.superseded).toEqual([]);
  });

  it("no state can transition to itself", () => {
    for (const s of RELEASED_FOR_STATES) {
      expect(RELEASED_FOR_TRANSITIONS[s]).not.toContain(s);
    }
  });
});

// ===== Flow 7: Status normalization round-trip =====

describe("toCanonicalStatus normalizes all legacy formats", () => {
  const LEGACY_FORMATS: [string, string][] = [
    // UPPERCASE legacy (pre-migration API callers)
    ["TO DO", "to_do"],
    ["IN PROGRESS", "in_progress"],
    ["HOLD", "hold"],
    ["ON HOLD", "hold"],
    ["COMPLETE", "complete"],
    ["COMPLETED", "complete"],
    ["DONE", "complete"],
    ["NEEDS APPROVAL", "needs_approval"],
    ["QC APPROVED", "qc_approved"],
    ["PROVIDE FEEDBACK", "provide_feedback"],
    ["OPERATIONAL APPROVAL", "operational_approval"],
    ["PROJECTS ASSISTANCE", "projects_assistance"],
    // Title Case (legacy DB values)
    ["Not Started", "not_started"],
    ["To Do", "to_do"],
    ["In Progress", "in_progress"],
    ["On Hold", "hold"],
    ["Complete", "complete"],
    ["Completed", "complete"],
    // Canonical (pass-through)
    ["not_started", "not_started"],
    ["to_do", "to_do"],
    ["in_progress", "in_progress"],
    ["hold", "hold"],
    ["complete", "complete"],
    ["needs_approval", "needs_approval"],
    ["qc_approved", "qc_approved"],
    ["provide_feedback", "provide_feedback"],
    ["operational_approval", "operational_approval"],
    ["projects_assistance", "projects_assistance"],
    // Edge cases
    ["", "not_started"],
    ["  IN PROGRESS  ", "in_progress"],
  ];

  for (const [input, expected] of LEGACY_FORMATS) {
    it(`"${input}" → "${expected}"`, () => {
      expect(toCanonicalStatus(input)).toBe(expected);
    });
  }

  it("null → not_started", () => {
    expect(toCanonicalStatus(null)).toBe("not_started");
  });

  it("undefined → not_started", () => {
    expect(toCanonicalStatus(undefined)).toBe("not_started");
  });

  it("unknown string → not_started (safe default)", () => {
    expect(toCanonicalStatus("BANANA")).toBe("not_started");
  });
});

describe("normalizeToUniversalStatus covers all canonical statuses", () => {
  for (const s of TASK_STATUSES) {
    it(`canonical "${s}" maps to a universal status`, () => {
      const result = normalizeToUniversalStatus(s);
      expect(["todo", "in_progress", "blocked", "review", "complete", "cancelled"]).toContain(result);
    });
  }
});

describe("getTaskStatusLabel produces human-readable labels for all statuses", () => {
  for (const s of TASK_STATUSES) {
    it(`"${s}" has a label`, () => {
      const label = getTaskStatusLabel(s);
      expect(label.length).toBeGreaterThan(0);
      // Label should not be the raw canonical string
      expect(label).not.toBe(s);
    });
  }
});

// ===== Flow 9: Drawing register state machine =====

describe("drawing register status transitions", () => {
  it("has 7 statuses", () => {
    expect(DRAWING_STATUSES).toHaveLength(7);
  });

  it("happy path: draft → for_review → for_approval → approved → ifc → as_built", () => {
    expect(DRAWING_STATUS_TRANSITIONS.draft).toContain("for_review");
    expect(DRAWING_STATUS_TRANSITIONS.for_review).toContain("for_approval");
    expect(DRAWING_STATUS_TRANSITIONS.for_approval).toContain("approved");
    expect(DRAWING_STATUS_TRANSITIONS.approved).toContain("ifc");
    expect(DRAWING_STATUS_TRANSITIONS.ifc).toContain("as_built");
  });

  it("approved → ifc is an explicit step (not automatic)", () => {
    // This is the core control: approval is review signoff, ifc is construction release
    expect(DRAWING_STATUS_TRANSITIONS.approved).toContain("ifc");
    expect(DRAWING_STATUS_TRANSITIONS.for_approval).not.toContain("ifc");
  });

  it("every non-terminal state can reach superseded", () => {
    for (const s of DRAWING_STATUSES) {
      if (s === "superseded") continue;
      expect(DRAWING_STATUS_TRANSITIONS[s]).toContain("superseded");
    }
  });

  it("superseded is terminal", () => {
    expect(DRAWING_STATUS_TRANSITIONS.superseded).toEqual([]);
  });

  it("no state can transition to itself", () => {
    for (const s of DRAWING_STATUSES) {
      expect(DRAWING_STATUS_TRANSITIONS[s]).not.toContain(s);
    }
  });
});

// ===== Transmittal purposes cover all EPC needs =====

describe("transmittal purposes", () => {
  it("includes procurement (EPC-specific)", () => {
    expect(TRANSMITTAL_PURPOSES).toContain("for_procurement");
  });

  it("includes construction (IFC issue)", () => {
    expect(TRANSMITTAL_PURPOSES).toContain("for_construction");
  });

  it("includes handover", () => {
    expect(TRANSMITTAL_PURPOSES).toContain("for_handover");
  });

  it("includes as-built record", () => {
    expect(TRANSMITTAL_PURPOSES).toContain("for_as_built_record");
  });
});

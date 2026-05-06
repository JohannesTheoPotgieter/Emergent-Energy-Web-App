/**
 * C6 — Status casing normalization.
 *
 * Pure-logic tests for the normalizer + canonical sets. The DB
 * migration (20260413_status_casing_normalization.sql) is covered by
 * the release gate; this file pins:
 *   - The pure normalizer transform
 *   - The legacy map's exhaustive coverage
 *   - The label round-trip (canonical -> "Title Case")
 *   - The canonical sets in shared/schema (STAGE_STATUSES, TASK_STATUSES, etc)
 *     so a future refactor can't silently re-introduce UPPER values
 */

import { describe, expect, it } from "vitest";
import {
  normalizeStatus,
  normalizeWithLegacy,
  formatStatusLabel,
  LEGACY_STATUS_MAP,
  KNOWN_LEGACY_INPUTS,
} from "../../../shared/utils/status-normalization";
import {
  STAGE_STATUSES,
  REQUIREMENT_STATUSES,
  EXCEPTION_STATUSES,
  DEPENDENCY_STATUSES,
  RISK_LEVELS,
  DECISION_TYPES,
} from "../../../shared/schema/stage-lifecycle";
import { TASK_STATUSES } from "../../../shared/schema/tasks";
import { DELIVERABLE_STATUSES } from "../../../shared/schema/engineering";

describe("C6 — normalizeStatus (pure)", () => {
  it("returns empty string for null/undefined/empty input", () => {
    expect(normalizeStatus(null)).toBe("");
    expect(normalizeStatus(undefined)).toBe("");
    expect(normalizeStatus("")).toBe("");
    expect(normalizeStatus("   ")).toBe("");
  });

  it("lowercases UPPER + spaces to lowercase_underscore", () => {
    expect(normalizeStatus("TO DO")).toBe("to_do");
    expect(normalizeStatus("IN PROGRESS")).toBe("in_progress");
    expect(normalizeStatus("NEEDS APPROVAL")).toBe("needs_approval");
    expect(normalizeStatus("OPERATIONAL APPROVAL")).toBe("operational_approval");
  });

  it("lowercases UPPER_UNDERSCORE", () => {
    expect(normalizeStatus("NOT_STARTED")).toBe("not_started");
    expect(normalizeStatus("IN_PROGRESS")).toBe("in_progress");
    expect(normalizeStatus("READY_FOR_REVIEW")).toBe("ready_for_review");
    expect(normalizeStatus("EXCEPTION_APPROVED")).toBe("exception_approved");
  });

  it("lowercases Title Case", () => {
    expect(normalizeStatus("Not Started")).toBe("not_started");
    expect(normalizeStatus("Active")).toBe("active");
    expect(normalizeStatus("Completed")).toBe("completed");
  });

  it("lowercases color names", () => {
    expect(normalizeStatus("Red")).toBe("red");
    expect(normalizeStatus("Amber")).toBe("amber");
    expect(normalizeStatus("Green")).toBe("green");
  });

  it("collapses repeated spaces and dashes to a single underscore", () => {
    expect(normalizeStatus("on   hold")).toBe("on_hold");
    expect(normalizeStatus("on-hold")).toBe("on_hold");
    expect(normalizeStatus("multi--dash--input")).toBe("multi_dash_input");
  });

  it("trims leading/trailing whitespace and underscores", () => {
    expect(normalizeStatus("  in progress  ")).toBe("in_progress");
    expect(normalizeStatus("_in_progress_")).toBe("in_progress");
  });

  it("is idempotent — already-canonical inputs pass through", () => {
    expect(normalizeStatus("not_started")).toBe("not_started");
    expect(normalizeStatus("in_progress")).toBe("in_progress");
    expect(normalizeStatus("ready_for_review")).toBe("ready_for_review");
  });
});

describe("C6 — normalizeWithLegacy (legacy-map aware)", () => {
  it("uses the legacy map for ambiguous strings the pure transform would mishandle", () => {
    // "TaskCreated" -> the pure transform would return "taskcreated"
    expect(normalizeStatus("TaskCreated")).toBe("taskcreated");
    // The legacy-aware form should return the correct canonical form
    expect(normalizeWithLegacy("TaskCreated")).toBe("task_created");
  });

  it("falls back to the pure transform when the input isn't in the map", () => {
    expect(normalizeWithLegacy("SOMETHING_NEW")).toBe("something_new");
    expect(normalizeWithLegacy("brand new state")).toBe("brand_new_state");
  });

  it("handles the full legacy work_items / deliverables surface", () => {
    expect(normalizeWithLegacy("TO DO")).toBe("to_do");
    expect(normalizeWithLegacy("IN PROGRESS")).toBe("in_progress");
    expect(normalizeWithLegacy("HOLD")).toBe("hold");
    expect(normalizeWithLegacy("PROJECTS ASSISTANCE")).toBe("projects_assistance");
    expect(normalizeWithLegacy("NEEDS APPROVAL")).toBe("needs_approval");
    expect(normalizeWithLegacy("QC APPROVED")).toBe("qc_approved");
    expect(normalizeWithLegacy("PROVIDE FEEDBACK")).toBe("provide_feedback");
    expect(normalizeWithLegacy("OPERATIONAL APPROVAL")).toBe("operational_approval");
    expect(normalizeWithLegacy("COMPLETE")).toBe("complete");
    expect(normalizeWithLegacy("Not Started")).toBe("not_started");
  });

  it("handles the full stage lifecycle surface", () => {
    expect(normalizeWithLegacy("NOT_STARTED")).toBe("not_started");
    expect(normalizeWithLegacy("IN_PROGRESS")).toBe("in_progress");
    expect(normalizeWithLegacy("READY_FOR_REVIEW")).toBe("ready_for_review");
    expect(normalizeWithLegacy("APPROVED")).toBe("approved");
    expect(normalizeWithLegacy("PROGRESSED")).toBe("progressed");
    expect(normalizeWithLegacy("EXCEPTION_APPROVED")).toBe("exception_approved");
    expect(normalizeWithLegacy("BLOCKED")).toBe("blocked");
    expect(normalizeWithLegacy("REQUESTED")).toBe("requested");
    expect(normalizeWithLegacy("APPROVED_WITH_CONDITIONS")).toBe("approved_with_conditions");
    expect(normalizeWithLegacy("RE_OPENED")).toBe("re_opened");
  });

  it("handles the finance line item surface", () => {
    expect(normalizeWithLegacy("PLANNED")).toBe("planned");
    expect(normalizeWithLegacy("INVOICED")).toBe("invoiced");
    expect(normalizeWithLegacy("PAID")).toBe("paid");
    expect(normalizeWithLegacy("IN_BANK")).toBe("in_bank");
    expect(normalizeWithLegacy("REALISED")).toBe("realised");
  });

  it("handles the TR register surface (Title Case + color names)", () => {
    expect(normalizeWithLegacy("Active")).toBe("active");
    expect(normalizeWithLegacy("Completed")).toBe("completed");
    expect(normalizeWithLegacy("Red")).toBe("red");
    expect(normalizeWithLegacy("Amber")).toBe("amber");
    expect(normalizeWithLegacy("Green")).toBe("green");
    expect(normalizeWithLegacy("Linked")).toBe("linked");
    expect(normalizeWithLegacy("TaskCreated")).toBe("task_created");
    expect(normalizeWithLegacy("Done")).toBe("done");
  });

  it("handles the smart_import_status surface", () => {
    expect(normalizeWithLegacy("PREVIEW")).toBe("preview");
    expect(normalizeWithLegacy("AWAITING_REVIEW")).toBe("awaiting_review");
    expect(normalizeWithLegacy("COMMITTED")).toBe("committed");
    expect(normalizeWithLegacy("ROLLED_BACK")).toBe("rolled_back");
    expect(normalizeWithLegacy("FAILED")).toBe("failed");
    expect(normalizeWithLegacy("SUPERSEDED")).toBe("superseded");
  });

  it("every legacy map entry survives a round-trip through normalizeStatus on its value", () => {
    // The canonical form of a canonical value must equal itself.
    for (const canonical of Object.values(LEGACY_STATUS_MAP)) {
      expect(normalizeStatus(canonical)).toBe(canonical);
    }
  });

  it("KNOWN_LEGACY_INPUTS contains every key in the map", () => {
    expect(KNOWN_LEGACY_INPUTS.length).toBe(Object.keys(LEGACY_STATUS_MAP).length);
  });
});

describe("C6 — formatStatusLabel (canonical -> display)", () => {
  it("returns empty string for null/undefined/empty input", () => {
    expect(formatStatusLabel(null)).toBe("");
    expect(formatStatusLabel(undefined)).toBe("");
    expect(formatStatusLabel("")).toBe("");
  });

  it("turns lowercase_underscore into Title Case With Spaces", () => {
    expect(formatStatusLabel("not_started")).toBe("Not Started");
    expect(formatStatusLabel("in_progress")).toBe("In Progress");
    expect(formatStatusLabel("ready_for_review")).toBe("Ready For Review");
    expect(formatStatusLabel("exception_approved")).toBe("Exception Approved");
    expect(formatStatusLabel("approved_with_conditions")).toBe("Approved With Conditions");
  });

  it("handles single-word inputs", () => {
    expect(formatStatusLabel("approved")).toBe("Approved");
    expect(formatStatusLabel("blocked")).toBe("Blocked");
  });

  it("round-trips: normalize -> format gives back a sensible label", () => {
    const inputs = ["TO DO", "IN PROGRESS", "NOT_STARTED", "Not Started", "Active"];
    for (const input of inputs) {
      const canonical = normalizeWithLegacy(input);
      const label = formatStatusLabel(canonical);
      // The label should be non-empty and not contain underscores
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/_/);
    }
  });
});

describe("C6 — canonical schema constants", () => {
  it("STAGE_STATUSES is exactly the 7 canonical values", () => {
    expect([...STAGE_STATUSES].sort()).toEqual(
      ["approved", "blocked", "exception_approved", "in_progress", "not_started", "progressed", "ready_for_review"].sort(),
    );
  });

  it("REQUIREMENT_STATUSES is exactly the 5 canonical values", () => {
    expect([...REQUIREMENT_STATUSES].sort()).toEqual(
      ["complete", "in_progress", "not_applicable", "not_started", "waived"].sort(),
    );
  });

  it("EXCEPTION_STATUSES is canonical lowercase_underscore", () => {
    for (const s of EXCEPTION_STATUSES) {
      expect(s).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("DEPENDENCY_STATUSES is canonical lowercase_underscore", () => {
    for (const s of DEPENDENCY_STATUSES) {
      expect(s).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("RISK_LEVELS is exactly 4 lowercase values", () => {
    expect([...RISK_LEVELS].sort()).toEqual(["critical", "high", "low", "medium"].sort());
  });

  it("DECISION_TYPES is canonical lowercase_underscore", () => {
    for (const d of DECISION_TYPES) {
      expect(d).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("TASK_STATUSES is canonical lowercase_underscore and includes not_started", () => {
    expect(TASK_STATUSES).toContain("not_started");
    expect(TASK_STATUSES).toContain("to_do");
    expect(TASK_STATUSES).toContain("in_progress");
    expect(TASK_STATUSES).toContain("complete");
    for (const s of TASK_STATUSES) {
      expect(s).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("DELIVERABLE_STATUSES is canonical lowercase_underscore", () => {
    for (const s of DELIVERABLE_STATUSES) {
      expect(s).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("the union of all canonical status values contains no UPPER characters", () => {
    const allStatuses = [
      ...STAGE_STATUSES,
      ...REQUIREMENT_STATUSES,
      ...EXCEPTION_STATUSES,
      ...DEPENDENCY_STATUSES,
      ...RISK_LEVELS,
      ...DECISION_TYPES,
      ...TASK_STATUSES,
      ...DELIVERABLE_STATUSES,
    ];
    for (const s of allStatuses) {
      expect(s).not.toMatch(/[A-Z]/);
      expect(s).not.toMatch(/\s/);
    }
  });
});

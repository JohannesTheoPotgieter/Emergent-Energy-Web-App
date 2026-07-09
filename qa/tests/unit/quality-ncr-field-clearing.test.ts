/**
 * Task 0.2 — NCR update: `null` clears, omitted keeps.
 *
 * The PUT handler built updates with `body.x ?? current.x`, so an explicit
 * `null` collapsed to the existing value — an NCR could never be
 * un-assigned and a due date could never be cleared. The field-selection
 * logic now lives in a pure builder that only emits fields present in the
 * request body, so a `null` is written through and an omitted field falls
 * back to the DB value untouched.
 */
import { describe, expect, it } from "vitest";
import { buildNcrFieldUpdates } from "../../../server/lib/quality-ncr-update";

describe("buildNcrFieldUpdates — null clears, undefined keeps", () => {
  it("clears assigned_to when explicitly null", () => {
    const updates = buildNcrFieldUpdates({ assigned_to: null });
    expect("assignedTo" in updates).toBe(true);
    expect(updates.assignedTo).toBeNull();
  });

  it("clears due_date when explicitly null", () => {
    const updates = buildNcrFieldUpdates({ due_date: null });
    expect("dueDate" in updates).toBe(true);
    expect(updates.dueDate).toBeNull();
  });

  it("omits assigned_to entirely when the field is not sent (keeps current)", () => {
    const updates = buildNcrFieldUpdates({ title: "New title" });
    expect("assignedTo" in updates).toBe(false);
    expect("dueDate" in updates).toBe(false);
    expect(updates.title).toBe("New title");
  });

  it("writes a new assignee when a positive id is provided", () => {
    const updates = buildNcrFieldUpdates({ assigned_to: 17 });
    expect(updates.assignedTo).toBe(17);
  });

  it("maps snake_case body fields to camelCase columns", () => {
    const updates = buildNcrFieldUpdates({
      root_cause: "cable spec mismatch",
      corrective_action: "reissue drawing",
      preventive_action: null,
    });
    expect(updates.rootCause).toBe("cable spec mismatch");
    expect(updates.correctiveAction).toBe("reissue drawing");
    expect("preventiveAction" in updates).toBe(true);
    expect(updates.preventiveAction).toBeNull();
  });

  it("returns an empty object when the body carries no field updates", () => {
    // e.g. a status-only transition — status/updatedAt are added by the caller.
    expect(buildNcrFieldUpdates({})).toEqual({});
  });

  it("clears description while keeping unspecified fields out", () => {
    const updates = buildNcrFieldUpdates({ description: null });
    expect(updates).toEqual({ description: null });
  });
});

/**
 * Unit coverage for `isInActiveExecutionWindow` — the lifecycle gate that
 * scopes Engineering project pickers to live delivery work (Financial Close
 * onward + Hold, excluding Done and pre-Financial-Close stages).
 */

import { describe, expect, it } from "vitest";
import { isInActiveExecutionWindow } from "@shared/phases";

describe("isInActiveExecutionWindow", () => {
  it("excludes the two pre-Financial-Close stages", () => {
    expect(isInActiveExecutionWindow("S01_FIRST_ASSESSMENT")).toBe(false);
    expect(isInActiveExecutionWindow("S02_DESIGN_COST_PROPOSAL")).toBe(false);
  });

  it("includes Financial Close and every stage after it", () => {
    expect(isInActiveExecutionWindow("S03_SIGNATURE_FINANCIAL_CLOSE")).toBe(true);
    expect(isInActiveExecutionWindow("S04_PLANNING")).toBe(true);
    expect(isInActiveExecutionWindow("S06_CONSTRUCTION")).toBe(true);
    expect(isInActiveExecutionWindow("S08_OM_HANDOVER")).toBe(true);
    expect(isInActiveExecutionWindow("S09_CLIENT_HANDOVER")).toBe(true);
    expect(isInActiveExecutionWindow("S10_POST_HANDOVER_REVIEW")).toBe(true);
    expect(isInActiveExecutionWindow("S9B_COMPLIANCE_HANDOVER")).toBe(true);
  });

  it("includes Hold (resumable) but excludes Done (terminal)", () => {
    expect(isInActiveExecutionWindow("S_HOLD")).toBe(true);
    expect(isInActiveExecutionWindow("S_DONE")).toBe(false);
  });

  it("resolves canonical labels and aliases, not just codes", () => {
    expect(isInActiveExecutionWindow("Financial Close")).toBe(true);
    expect(isInActiveExecutionWindow("Construction")).toBe(true);
    expect(isInActiveExecutionWindow("First Assessment")).toBe(false);
    expect(isInActiveExecutionWindow("Done")).toBe(false);
  });

  it("returns false for empty / unrecognised input", () => {
    expect(isInActiveExecutionWindow(null)).toBe(false);
    expect(isInActiveExecutionWindow(undefined)).toBe(false);
    expect(isInActiveExecutionWindow("")).toBe(false);
    expect(isInActiveExecutionWindow("not-a-phase")).toBe(false);
  });
});

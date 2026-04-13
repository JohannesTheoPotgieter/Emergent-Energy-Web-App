/**
 * B7 (audit closeout) — Safety File default seed list + traffic-light math.
 *
 * Pure-logic tests. The seed function's DB side-effects are covered
 * by the release gate against a live test DB; this file pins the
 * static list of OHSA items and the completeness thresholds.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SAFETY_FILE_SEED, SAFETY_FILE_COMPLIANCE_STATUSES } from "../../../shared/schema/hse";
import { SAFETY_FILE_APPROVER_ROLES } from "../../../server/services/safety-file-service";

describe("B7 — DEFAULT_SAFETY_FILE_SEED", () => {
  it("seeds exactly the 12 OHSA statutory items we agreed on", () => {
    expect(DEFAULT_SAFETY_FILE_SEED).toHaveLength(12);
  });

  it("every item has a unique, non-empty itemCode", () => {
    const codes = new Set<string>();
    for (const item of DEFAULT_SAFETY_FILE_SEED) {
      expect(item.itemCode).toBeTruthy();
      expect(item.itemCode.length).toBeGreaterThan(0);
      expect(codes.has(item.itemCode)).toBe(false);
      codes.add(item.itemCode);
    }
  });

  it("every item has a human-readable itemName", () => {
    for (const item of DEFAULT_SAFETY_FILE_SEED) {
      expect(item.itemName).toBeTruthy();
      expect(item.itemName.length).toBeGreaterThan(5);
    }
  });

  it("every item has a valid category", () => {
    const validCategories = new Set(["statutory", "registers", "appointments", "method_statements", "emergency", "other"]);
    for (const item of DEFAULT_SAFETY_FILE_SEED) {
      expect(validCategories.has(item.category)).toBe(true);
    }
  });

  it("includes the OHSA statutory fundamentals", () => {
    const codes = DEFAULT_SAFETY_FILE_SEED.map((i) => i.itemCode);
    // These four are the bare minimum for a SA site to operate legally.
    expect(codes).toContain("letter_of_good_standing");
    expect(codes).toContain("public_liability_insurance");
    expect(codes).toContain("health_safety_plan");
    expect(codes).toContain("baseline_risk_assessment");
  });

  it("includes the on-site registers the SOP requires within 7 days", () => {
    const codes = DEFAULT_SAFETY_FILE_SEED.map((i) => i.itemCode);
    expect(codes).toContain("site_induction_register");
    expect(codes).toContain("ppe_register");
    expect(codes).toContain("incident_register");
  });

  it("includes the emergency preparedness plan", () => {
    const codes = DEFAULT_SAFETY_FILE_SEED.map((i) => i.itemCode);
    expect(codes).toContain("emergency_plan");
  });
});

describe("B7 — SAFETY_FILE_COMPLIANCE_STATUSES enum values", () => {
  it("exposes the 6 canonical statuses", () => {
    expect(SAFETY_FILE_COMPLIANCE_STATUSES).toEqual([
      "pending",
      "submitted",
      "approved",
      "rejected",
      "expired",
      "not_applicable",
    ]);
  });
});

describe("B7 — SAFETY_FILE_APPROVER_ROLES whitelist", () => {
  it("matches the B3 HSE incident approver set: HSE_MANAGER + COO + CEO", () => {
    expect(SAFETY_FILE_APPROVER_ROLES.has("HSE_MANAGER")).toBe(true);
    expect(SAFETY_FILE_APPROVER_ROLES.has("COO_ADMIN")).toBe(true);
    expect(SAFETY_FILE_APPROVER_ROLES.has("CEO_ADMIN")).toBe(true);
  });

  it("does NOT include PROGRAM_MANAGER / PROGRAM_FINANCE_MANAGER / PM_SITE", () => {
    expect(SAFETY_FILE_APPROVER_ROLES.has("PROGRAM_MANAGER")).toBe(false);
    expect(SAFETY_FILE_APPROVER_ROLES.has("PROGRAM_FINANCE_MANAGER")).toBe(false);
    expect(SAFETY_FILE_APPROVER_ROLES.has("PROJECT_MANAGER_SITE")).toBe(false);
  });

  it("has exactly 3 members (tight scope)", () => {
    expect(SAFETY_FILE_APPROVER_ROLES.size).toBe(3);
  });
});

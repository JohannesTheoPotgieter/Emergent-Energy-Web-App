/**
 * B8 (audit closeout) — O&M handover readiness calculator + role whitelist.
 *
 * Pure-logic tests. The DB integration (dashboard query, mark-complete
 * write path) is covered by the release gate against a live test DB;
 * this file pins the checklist math and threshold boundaries so future
 * changes to the calculator cannot silently shift the traffic light.
 */

import { describe, expect, it } from "vitest";
import {
  computeOmHandoverReadiness,
  OM_HANDOVER_COMPLETE_ROLES,
  OM_HANDOVER_DASHBOARD_DEFAULT_DAYS,
} from "../../../server/services/om-handover-service";
import { OM_HANDOVER_CHECKLIST } from "../../../shared/schema/handover";

// Helper to build a fake OmHandover row with specified checklist booleans.
function mkRow(bools: Partial<Record<string, boolean>> = {}): any {
  return {
    id: 1,
    projectId: 1,
    status: "scheduled",
    plannedHandoverDate: null,
    actualHandoverDate: null,
    asBuiltsUploaded: !!bools.asBuiltsUploaded,
    warrantiesUploaded: !!bools.warrantiesUploaded,
    omManualUploaded: !!bools.omManualUploaded,
    serialNumbersUploaded: !!bools.serialNumbersUploaded,
    targetsConfirmed: !!bools.targetsConfirmed,
    monitoringAccessConfirmed: !!bools.monitoringAccessConfirmed,
    trainingComplete: !!bools.trainingComplete,
    handedOverByUserId: null,
    acceptedByUserId: null,
    acceptedAt: null,
    handoverPackLink: null,
    notes: null,
    markedCompleteByUserId: null,
    markedCompleteByRole: null,
    markedCompleteAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

describe("B8 — OM_HANDOVER_CHECKLIST shape", () => {
  it("has exactly 7 items matching stage8DataSchema", () => {
    expect(OM_HANDOVER_CHECKLIST).toHaveLength(7);
    const keys = OM_HANDOVER_CHECKLIST.map((c) => String(c.key));
    expect(keys).toContain("asBuiltsUploaded");
    expect(keys).toContain("warrantiesUploaded");
    expect(keys).toContain("omManualUploaded");
    expect(keys).toContain("serialNumbersUploaded");
    expect(keys).toContain("targetsConfirmed");
    expect(keys).toContain("monitoringAccessConfirmed");
    expect(keys).toContain("trainingComplete");
  });

  it("every item has a non-empty human-readable label", () => {
    for (const item of OM_HANDOVER_CHECKLIST) {
      expect(typeof item.label).toBe("string");
      expect(item.label.length).toBeGreaterThan(5);
    }
  });
});

describe("B8 — computeOmHandoverReadiness", () => {
  it("returns red 0% when the row is null", () => {
    const r = computeOmHandoverReadiness(null);
    expect(r.total).toBe(7);
    expect(r.complete).toBe(0);
    expect(r.readinessPct).toBe(0);
    expect(r.trafficLight).toBe("red");
    expect(r.missingLabels).toHaveLength(7);
  });

  it("returns red 0% when no checklist items are true", () => {
    const r = computeOmHandoverReadiness(mkRow());
    expect(r.complete).toBe(0);
    expect(r.readinessPct).toBe(0);
    expect(r.trafficLight).toBe("red");
  });

  it("returns green 100% when all 7 items are true", () => {
    const r = computeOmHandoverReadiness(
      mkRow({
        asBuiltsUploaded: true,
        warrantiesUploaded: true,
        omManualUploaded: true,
        serialNumbersUploaded: true,
        targetsConfirmed: true,
        monitoringAccessConfirmed: true,
        trainingComplete: true,
      }),
    );
    expect(r.complete).toBe(7);
    expect(r.readinessPct).toBe(100);
    expect(r.trafficLight).toBe("green");
    expect(r.missingLabels).toHaveLength(0);
  });

  it("returns amber when 6/7 items are true (86% > 80%)", () => {
    const r = computeOmHandoverReadiness(
      mkRow({
        asBuiltsUploaded: true,
        warrantiesUploaded: true,
        omManualUploaded: true,
        serialNumbersUploaded: true,
        targetsConfirmed: true,
        monitoringAccessConfirmed: true,
        trainingComplete: false,
      }),
    );
    expect(r.complete).toBe(6);
    expect(r.readinessPct).toBe(86);
    expect(r.trafficLight).toBe("amber");
    expect(r.missingLabels).toEqual(["Training complete"]);
  });

  it("returns red when 5/7 items are true (71% < 80%)", () => {
    const r = computeOmHandoverReadiness(
      mkRow({
        asBuiltsUploaded: true,
        warrantiesUploaded: true,
        omManualUploaded: true,
        serialNumbersUploaded: true,
        targetsConfirmed: true,
      }),
    );
    expect(r.complete).toBe(5);
    expect(r.readinessPct).toBe(71);
    expect(r.trafficLight).toBe("red");
    expect(r.missingLabels).toContain("Monitoring access confirmed");
    expect(r.missingLabels).toContain("Training complete");
  });

  it("items array is always in the canonical checklist order", () => {
    const r = computeOmHandoverReadiness(mkRow());
    const keys = r.items.map((i) => i.key);
    expect(keys).toEqual([
      "asBuiltsUploaded",
      "warrantiesUploaded",
      "omManualUploaded",
      "serialNumbersUploaded",
      "targetsConfirmed",
      "monitoringAccessConfirmed",
      "trainingComplete",
    ]);
  });
});

describe("B8 — OM_HANDOVER_COMPLETE_ROLES whitelist", () => {
  it("matches the user spec exactly: COO, CEO, Program Manager, Construction Manager", () => {
    expect(OM_HANDOVER_COMPLETE_ROLES.has("COO_ADMIN")).toBe(true);
    expect(OM_HANDOVER_COMPLETE_ROLES.has("CEO_ADMIN")).toBe(true);
    expect(OM_HANDOVER_COMPLETE_ROLES.has("PROGRAM_MANAGER")).toBe(true);
    expect(OM_HANDOVER_COMPLETE_ROLES.has("CONSTRUCTION_MANAGER")).toBe(true);
    expect(OM_HANDOVER_COMPLETE_ROLES.size).toBe(4);
  });

  it("does NOT include roles the user excluded (PM_SITE, PFM, CFO, HSE_MANAGER)", () => {
    expect(OM_HANDOVER_COMPLETE_ROLES.has("PROJECT_MANAGER_SITE")).toBe(false);
    expect(OM_HANDOVER_COMPLETE_ROLES.has("PROGRAM_FINANCE_MANAGER")).toBe(false);
    expect(OM_HANDOVER_COMPLETE_ROLES.has("CFO")).toBe(false);
    expect(OM_HANDOVER_COMPLETE_ROLES.has("HSE_MANAGER")).toBe(false);
  });
});

describe("B8 — dashboard default window", () => {
  it("defaults to 30 days per user direction", () => {
    expect(OM_HANDOVER_DASHBOARD_DEFAULT_DAYS).toBe(30);
  });
});

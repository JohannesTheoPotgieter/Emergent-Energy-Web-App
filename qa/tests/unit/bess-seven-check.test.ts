/**
 * Task 1.3 — BESS 7-check commissioning checklist.
 *
 * Behavioural tests over the pure sign-off rules + the seven definitions,
 * plus source-contract checks that the gate (is_bess_hybrid), idempotent
 * seed, CM countersignature, close gate, and COO-on-closure notification are
 * wired into the commissioning routes.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BESS_ITEM_TYPE,
  BESS_CATEGORY,
  BESS_SEVEN_CHECKS,
  BESS_SEVEN_CHECK_COUNT,
  bessItemCloseBlockedReason,
  isBessCommissioningItem,
  isBessSevenCheckComplete,
  bessSevenCheckProgress,
} from "../../../server/lib/bess-seven-check";

describe("BESS 7-check definitions", () => {
  it("defines exactly seven checks with unique keys/titles", () => {
    expect(BESS_SEVEN_CHECK_COUNT).toBe(7);
    expect(BESS_SEVEN_CHECKS).toHaveLength(7);
    expect(new Set(BESS_SEVEN_CHECKS.map((c) => c.key)).size).toBe(7);
    expect(new Set(BESS_SEVEN_CHECKS.map((c) => c.title)).size).toBe(7);
  });

  it("covers the seven required checks", () => {
    const keys = BESS_SEVEN_CHECKS.map((c) => c.key);
    expect(keys).toEqual([
      "motorised_breaker_soc",
      "eskom_fail_alarm_direct",
      "battery_charge_rate_setpoint",
      "phantom_pv_load_ct",
      "huawei_active_grid_ct_placement",
      "battery_overvolt_mppt",
      "gen_eskom_transfer_priority",
    ]);
  });

  it("is titled 'BESS 7-Check' (not Mayo Macs)", () => {
    expect(BESS_CATEGORY).toBe("BESS 7-Check");
    expect(JSON.stringify(BESS_SEVEN_CHECKS)).not.toMatch(/mayo/i);
  });
});

describe("isBessCommissioningItem", () => {
  it("matches only the bess_commissioning item type", () => {
    expect(isBessCommissioningItem({ itemType: BESS_ITEM_TYPE })).toBe(true);
    expect(isBessCommissioningItem({ itemType: "commissioning" })).toBe(false);
    expect(isBessCommissioningItem({ itemType: null })).toBe(false);
  });
});

describe("bessItemCloseBlockedReason — CM countersign required to close", () => {
  it("blocks closing a BESS item that has not been countersigned", () => {
    const reason = bessItemCloseBlockedReason(
      { itemType: BESS_ITEM_TYPE, countersignedByUserId: null },
      "closed",
    );
    expect(reason).toMatch(/Construction Manager countersignature/i);
  });

  it("allows closing once countersigned", () => {
    expect(
      bessItemCloseBlockedReason({ itemType: BESS_ITEM_TYPE, countersignedByUserId: 12 }, "closed"),
    ).toBeNull();
  });

  it("never gates non-closed transitions", () => {
    expect(
      bessItemCloseBlockedReason({ itemType: BESS_ITEM_TYPE, countersignedByUserId: null }, "approved"),
    ).toBeNull();
  });

  it("never gates non-BESS items", () => {
    expect(
      bessItemCloseBlockedReason({ itemType: "commissioning", countersignedByUserId: null }, "closed"),
    ).toBeNull();
  });
});

describe("completion + progress", () => {
  const items = (statuses: string[]) => statuses.map((status, i) => ({ status, countersignedByUserId: i < 3 ? i + 1 : null }));

  it("is complete only when all seven have closed", () => {
    expect(isBessSevenCheckComplete(items(Array(7).fill("closed")))).toBe(true);
    expect(isBessSevenCheckComplete(items([...Array(6).fill("closed"), "approved"]))).toBe(false);
  });

  it("progress reports closed + countersigned counts", () => {
    const p = bessSevenCheckProgress(items(["closed", "closed", "approved", "not_started", "not_started", "not_started", "not_started"]));
    expect(p.total).toBe(7);
    expect(p.closed).toBe(2);
    expect(p.countersigned).toBe(3);
    expect(p.complete).toBe(false);
  });
});

describe("commissioning routes wire the BESS 7-check (source contract)", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/commissioning-routes.ts"), "utf8");

  it("gates seeding on the project's is_bess_hybrid flag", () => {
    expect(source).toContain("projectInfo.isBessHybrid");
    expect(source).toContain("Project is not flagged as BESS/hybrid");
  });

  it("seeds idempotently (existence guard, no duplicates)", () => {
    expect(source).toContain("async function ensureBessSevenCheck");
    expect(source).toContain("existingTitles.has(c.title)");
  });

  it("exposes GET checklist, POST seed, POST countersign routes", () => {
    expect(source).toContain('"/api/commissioning/project/:projectId/bess-seven-check"');
    expect(source).toContain('"/api/commissioning/project/:projectId/bess-seven-check/seed"');
    expect(source).toContain('"/api/commissioning/:id/countersign"');
  });

  it("enforces the CM countersign close gate", () => {
    expect(source).toContain("bessItemCloseBlockedReason(old, parsed.data.status)");
    expect(source).toContain("canCountersignBess(user?.role)");
  });

  it("notifies the COO on BESS item closure", () => {
    expect(source).toContain("bess.closure.coo_notified");
  });

  it("a migration adds the is_bess_hybrid + countersign columns", () => {
    const migration = fs.readFileSync(path.join(process.cwd(), "migrations/0120_bess_hybrid_seven_check.sql"), "utf8");
    expect(migration).toContain('"is_bess_hybrid"');
    expect(migration).toContain('"countersigned_by_user_id"');
    expect(migration).toContain('"countersigned_at"');
  });
});

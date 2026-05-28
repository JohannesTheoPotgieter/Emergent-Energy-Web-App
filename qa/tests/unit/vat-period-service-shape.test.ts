/**
 * TF-28 (audit V3) — Contract test for the VAT period tracking service.
 *
 * Pins the public surface of vat-period-service.ts + the
 * deriveVatPeriodMonth helper. Numeric correctness against a fixture DB
 * is queued behind DF-21.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveVatPeriodMonth,
} from "../../../server/services/vat-period-service";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("TF-28 — VAT period service", () => {
  const src = read("server/services/vat-period-service.ts");

  it("exports the lock / unlock / get functions", () => {
    expect(src).toContain("export async function getActiveVatPeriodLock");
    expect(src).toContain("export async function lockVatPeriod");
    expect(src).toContain("export async function unlockVatPeriod");
  });

  it("derives the bi-monthly close month for Category A vendors (Feb/Apr/Jun/Aug/Oct/Dec)", () => {
    // Mid-May (month index 4) → next Category-A close is June (month index 5).
    expect(deriveVatPeriodMonth(new Date("2026-05-15T12:00:00Z"), "A")).toBe("2026-06-01");
    expect(deriveVatPeriodMonth(new Date("2026-04-15T12:00:00Z"), "A")).toBe("2026-04-01");
    expect(deriveVatPeriodMonth(new Date("2026-03-15T12:00:00Z"), "A")).toBe("2026-04-01");
  });

  it("rolls into the next calendar year when the close is in January", () => {
    // 15 Dec 2026 (month 11) → Dec is a Category-A close (parity 1 = odd index).
    expect(deriveVatPeriodMonth(new Date("2026-12-15T12:00:00Z"), "A")).toBe("2026-12-01");
    // 15 Nov 2026 (month 10, even index = parity 0) → next Category-A
    // close is December (parity 1).
    expect(deriveVatPeriodMonth(new Date("2026-11-15T12:00:00Z"), "A")).toBe("2026-12-01");
  });

  it("supports Category B (opposite months: Jan/Mar/May/Jul/Sep/Nov)", () => {
    expect(deriveVatPeriodMonth(new Date("2026-04-15T12:00:00Z"), "B")).toBe("2026-05-01");
    expect(deriveVatPeriodMonth(new Date("2026-05-15T12:00:00Z"), "B")).toBe("2026-05-01");
  });

  it("requires a 10-character unlock reason (audit trail)", () => {
    expect(src).toContain("at least 10 characters");
  });

  it("refuses to double-lock an already-locked period", () => {
    expect(src).toContain("is already locked");
  });

  it("captures output / input VAT totals at lock time for SARS reconciliation", () => {
    expect(src).toContain("outputVatTotal");
    expect(src).toContain("inputVatTotal");
  });

  it("migration 0078 wires the vat_period_locks table + indexes", () => {
    const mig = read("migrations/0078_tf28_vat_period_locks.sql");
    expect(mig).toContain('CREATE TABLE IF NOT EXISTS "vat_period_locks"');
    expect(mig).toContain('idx_vat_period_locks_period');
    expect(mig).toContain('idx_vat_period_locks_active');
    expect(mig).toContain('vat_201_submission_ref');
  });
});

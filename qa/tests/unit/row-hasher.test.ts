/**
 * Smart Import — row-hasher unit tests.
 *
 * Pins the determinism + collision-resistance + version-sensitivity
 * properties of the per-section identity hashes. The merge engine uses
 * these hashes to look up an incoming row's existing version in the DB
 * across re-imports; if the hash is non-deterministic or collides
 * across sections, manual edits get attached to the wrong row.
 */

import { describe, it, expect } from "vitest";
import {
  hashPlanRow,
  hashRevenueRow,
  hashExpenditureRow,
  hashActualRow,
} from "../../../server/lib/import/row-hasher";

describe("hashPlanRow", () => {
  it("is deterministic — same identity columns produce the same hash", () => {
    const a = hashPlanRow({ projectId: 1, wbsCode: "1.2.3", title: "irrelevant" });
    const b = hashPlanRow({ projectId: 1, wbsCode: "1.2.3", title: "different title" });
    expect(a).toBe(b); // title is a tiebreaker only when WBS is empty
  });

  it("uses title as tiebreaker only when WBS is missing", () => {
    const a = hashPlanRow({ projectId: 1, title: "Task A" });
    const b = hashPlanRow({ projectId: 1, title: "Task B" });
    expect(a).not.toBe(b);
  });

  it("falls back through wbsCode → outlineNumber → externalRef", () => {
    const w = hashPlanRow({ projectId: 1, wbsCode: "1.2", outlineNumber: "X", externalRef: "Y" });
    const o = hashPlanRow({ projectId: 1, outlineNumber: "X", externalRef: "Y" });
    const e = hashPlanRow({ projectId: 1, externalRef: "Y" });
    expect(w).not.toBe(o);
    expect(o).not.toBe(e);
  });

  it("absorbs whitespace + casing differences in WBS codes", () => {
    const a = hashPlanRow({ projectId: 1, wbsCode: " 1.2.3 " });
    const b = hashPlanRow({ projectId: 1, wbsCode: "1.2.3" });
    expect(a).toBe(b);
  });

  it("differs by project — same WBS in different projects has different hashes", () => {
    expect(hashPlanRow({ projectId: 1, wbsCode: "1.1" })).not.toBe(
      hashPlanRow({ projectId: 2, wbsCode: "1.1" }),
    );
  });
});

describe("hashRevenueRow", () => {
  it("is deterministic on milestoneNo", () => {
    const a = hashRevenueRow({ projectId: 5, milestoneNo: "3", milestoneName: "anything", amountExVat: "999" });
    const b = hashRevenueRow({ projectId: 5, milestoneNo: "3", milestoneName: "different", amountExVat: "1" });
    expect(a).toBe(b); // name + amount are tiebreakers only when milestoneNo is missing
  });

  it("falls back to (name, amount) when milestoneNo is empty", () => {
    const a = hashRevenueRow({ projectId: 5, milestoneName: "Procurement Deposit", amountExVat: "40000000" });
    const b = hashRevenueRow({ projectId: 5, milestoneName: "Procurement Deposit", amountExVat: "40000000" });
    const c = hashRevenueRow({ projectId: 5, milestoneName: "Different", amountExVat: "40000000" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("hashExpenditureRow", () => {
  it("uses project + category + description + invoice for identity", () => {
    const a = hashExpenditureRow({
      projectId: 7,
      categoryKey: "1. Panels",
      description: "Panels Budget",
      invoiceNumber: "INV-001",
    });
    const b = hashExpenditureRow({
      projectId: 7,
      categoryKey: "1. Panels",
      description: "Panels Budget",
      invoiceNumber: "INV-001",
    });
    expect(a).toBe(b);
  });

  it("treats different invoice numbers on the same description as different rows", () => {
    const a = hashExpenditureRow({
      projectId: 7,
      categoryKey: "1. Panels",
      description: "Panels - Batch",
      invoiceNumber: "INV-001",
    });
    const b = hashExpenditureRow({
      projectId: 7,
      categoryKey: "1. Panels",
      description: "Panels - Batch",
      invoiceNumber: "INV-002",
    });
    expect(a).not.toBe(b);
  });

  it("falls back from categoryKey to costCategory", () => {
    const ck = hashExpenditureRow({ projectId: 7, categoryKey: "1. Panels", description: "x" });
    const cc = hashExpenditureRow({ projectId: 7, costCategory: "1. Panels", description: "x" });
    expect(ck).toBe(cc);
  });
});

describe("hashActualRow", () => {
  it("composes identity from costLineId + actualNo + invoice metadata", () => {
    const a = hashActualRow({ costLineId: 100, actualNo: 1, invoiceNumber: "INV-001", invoiceDate: "2026-04-01" });
    const b = hashActualRow({ costLineId: 100, actualNo: 1, invoiceNumber: "INV-001", invoiceDate: "2026-04-01" });
    expect(a).toBe(b);
  });

  it("disambiguates same invoice number across batches via actualNo", () => {
    const first = hashActualRow({ costLineId: 100, actualNo: 1, invoiceNumber: "INV", invoiceDate: "2026-04-01" });
    const second = hashActualRow({ costLineId: 100, actualNo: 2, invoiceNumber: "INV", invoiceDate: "2026-04-01" });
    expect(first).not.toBe(second);
  });

  it("disambiguates same invoice number across periods via date", () => {
    const apr = hashActualRow({ costLineId: 100, actualNo: 1, invoiceNumber: "INV", invoiceDate: "2026-04-01" });
    const may = hashActualRow({ costLineId: 100, actualNo: 1, invoiceNumber: "INV", invoiceDate: "2026-05-01" });
    expect(apr).not.toBe(may);
  });
});

describe("cross-section hash isolation", () => {
  it("plan, revenue, expenditure, actual all produce disjoint hash spaces", () => {
    // Same identity columns shouldn't collide across sections — the
    // section name is mixed into the hash input so a PLAN row with
    // wbsCode="1" can't ever be confused with a REVENUE row with
    // milestoneNo="1" in the same project.
    const plan = hashPlanRow({ projectId: 1, wbsCode: "1" });
    const rev = hashRevenueRow({ projectId: 1, milestoneNo: "1" });
    const exp = hashExpenditureRow({ projectId: 1, categoryKey: "1", description: "1", invoiceNumber: "1" });
    const act = hashActualRow({ costLineId: 1, actualNo: 1 });
    const set = new Set([plan, rev, exp, act]);
    expect(set.size).toBe(4);
  });
});

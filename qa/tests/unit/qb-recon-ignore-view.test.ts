/**
 * Company recon-ignore merge + worklist filter (G4). Pure tests — no DB / no QB.
 *
 * An accepted difference (qb_recon_line_ignores) is keyed on the recon line
 * identity (stream + normalized invoice number): it drops the line out of the
 * actionable worklist while staying on the audit list (restorable). The legacy
 * per-project tracker-gap ignores are merged in read-only.
 */
import { describe, expect, it } from "vitest";

import {
  lineIgnoreKey,
  activeLineIgnoreKeySet,
  isLineIgnored,
  filterOutIgnoredLines,
  lineIgnoreToView,
  buildMergedIgnoreViews,
  type LineIgnoreRow,
  type QbDocIgnoreView,
} from "../../../server/lib/finance/qb-recon-ignore-view";

const ignoreRow = (over: Partial<LineIgnoreRow>): LineIgnoreRow => ({
  id: 1,
  stream: "COS",
  invoiceNoNorm: "123",
  invoiceNoRaw: "ACME-00123",
  trackerAmountExVat: "1000.00",
  qbAmountExVat: null,
  reason: "genuine timing",
  ignoredByName: "Jo",
  ignoredAt: new Date("2026-06-11T08:00:00Z"),
  ...over,
});

describe("key + active set", () => {
  it("keys on stream + normalized number", () => {
    expect(lineIgnoreKey("COS", "123")).toBe("COS|123");
    expect(lineIgnoreKey("REV", "123")).not.toBe(lineIgnoreKey("COS", "123"));
  });
  it("builds the active key set", () => {
    const set = activeLineIgnoreKeySet([ignoreRow({}), ignoreRow({ id: 2, stream: "REV", invoiceNoNorm: "9" })]);
    expect(set.has("COS|123")).toBe(true);
    expect(set.has("REV|9")).toBe(true);
    expect(set.size).toBe(2);
  });
});

describe("filterOutIgnoredLines", () => {
  const lines = [
    { stream: "COS", invoiceNoNorm: "123", status: "tracker_only" },
    { stream: "COS", invoiceNoNorm: "456", status: "amount_variance" },
    { stream: "REV", invoiceNoNorm: "123", status: "qb_only" }, // same number, different stream → NOT ignored
  ];

  it("drops only the matching (stream, number) line", () => {
    const keys = activeLineIgnoreKeySet([ignoreRow({})]); // COS|123
    const out = filterOutIgnoredLines(lines, keys);
    expect(out.map((l) => `${l.stream}|${l.invoiceNoNorm}`)).toEqual(["COS|456", "REV|123"]);
    expect(isLineIgnored({ stream: "COS", invoiceNoNorm: "123" }, keys)).toBe(true);
    expect(isLineIgnored({ stream: "REV", invoiceNoNorm: "123" }, keys)).toBe(false);
  });

  it("returns everything when nothing is ignored", () => {
    expect(filterOutIgnoredLines(lines, new Set()).length).toBe(3);
  });
});

describe("merged ignore views", () => {
  it("recon_line ignores are restorable (carry id + stream); side derives from stream", () => {
    const v = lineIgnoreToView(ignoreRow({ id: 7, stream: "REV", invoiceNoRaw: "INV-7", trackerAmountExVat: null, qbAmountExVat: "500.00" }));
    expect(v.source).toBe("recon_line");
    expect(v.id).toBe(7);
    expect(v.side).toBe("revenue");
    expect(v.stream).toBe("REV");
    expect(v.qbDocNumber).toBe("INV-7");
    expect(v.amountExVat).toBe(500);
  });

  it("merges recon_line + legacy qb_doc ignores; qb_doc has no restore id", () => {
    const docIgnore: QbDocIgnoreView = {
      side: "cost",
      qbDocNumber: "BILL-1",
      counterpartyName: "Eskom",
      amountExVat: 2000,
      reason: "OPEX not project COS",
      ignoredByName: "Jo",
      ignoredAt: "2026-06-01",
    };
    const merged = buildMergedIgnoreViews([ignoreRow({})], [docIgnore]);
    expect(merged).toHaveLength(2);
    expect(merged[0].source).toBe("recon_line");
    expect(merged[0].id).not.toBeNull();
    expect(merged[1].source).toBe("qb_doc");
    expect(merged[1].id).toBeNull();
    expect(merged[1].counterpartyName).toBe("Eskom");
  });
});

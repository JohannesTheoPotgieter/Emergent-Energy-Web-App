/**
 * Task 1.2 — NCR analytics + export.
 *
 * Behavioural tests over the pure aging/trend/CSV helpers (the aggregation
 * the endpoint actually runs), plus source-anchored checks that the
 * analytics + export routes are scoped and registered ahead of the /:id
 * route (so "analytics"/"export" aren't captured as an id).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ncrAgeDays,
  ncrAgeBucket,
  computeNcrAging,
  computeNcrTrend,
  rowsToCsv,
} from "../../../server/lib/quality-ncr-analytics";

const NOW = new Date("2026-02-01T00:00:00.000Z");

describe("ncrAgeDays / ncrAgeBucket", () => {
  it("computes whole-day age, never negative", () => {
    expect(ncrAgeDays("2026-01-25T00:00:00.000Z", NOW)).toBe(7);
    expect(ncrAgeDays("2026-01-01T00:00:00.000Z", NOW)).toBe(31);
    // A future createdAt clamps to 0.
    expect(ncrAgeDays("2026-03-01T00:00:00.000Z", NOW)).toBe(0);
  });

  it("bucket boundaries are 0-7 / 8-30 / 30+", () => {
    expect(ncrAgeBucket(0)).toBe("0-7");
    expect(ncrAgeBucket(7)).toBe("0-7");
    expect(ncrAgeBucket(8)).toBe("8-30");
    expect(ncrAgeBucket(30)).toBe("8-30");
    expect(ncrAgeBucket(31)).toBe("30+");
    expect(ncrAgeBucket(500)).toBe("30+");
  });
});

describe("computeNcrAging", () => {
  it("buckets a mixed set correctly", () => {
    const rows = [
      { createdAt: "2026-01-30T00:00:00.000Z" }, // 2 days → 0-7
      { createdAt: "2026-01-28T00:00:00.000Z" }, // 4 days → 0-7
      { createdAt: "2026-01-20T00:00:00.000Z" }, // 12 days → 8-30
      { createdAt: "2026-01-01T00:00:00.000Z" }, // 31 days → 30+
      { createdAt: "2025-11-01T00:00:00.000Z" }, // ~92 days → 30+
    ];
    expect(computeNcrAging(rows, NOW)).toEqual({ "0-7": 2, "8-30": 1, "30+": 2, total: 5 });
  });

  it("returns all-zero on an empty set", () => {
    expect(computeNcrAging([], NOW)).toEqual({ "0-7": 0, "8-30": 0, "30+": 0, total: 0 });
  });
});

describe("computeNcrTrend", () => {
  it("groups by raise month with status + severity counts, ascending", () => {
    const rows = [
      { createdAt: "2026-01-05T00:00:00.000Z", status: "open", severity: "major" },
      { createdAt: "2026-01-20T00:00:00.000Z", status: "closed", severity: "minor" },
      { createdAt: "2025-12-15T00:00:00.000Z", status: "open", severity: "critical" },
    ];
    const trend = computeNcrTrend(rows);
    expect(trend.map((p) => p.month)).toEqual(["2025-12", "2026-01"]);
    const jan = trend.find((p) => p.month === "2026-01")!;
    expect(jan.total).toBe(2);
    expect(jan.byStatus).toEqual({ open: 1, closed: 1 });
    expect(jan.bySeverity).toEqual({ major: 1, minor: 1 });
  });

  it("returns [] on empty input", () => {
    expect(computeNcrTrend([])).toEqual([]);
  });
});

describe("rowsToCsv", () => {
  it("quotes cells containing commas, quotes and newlines (RFC 4180)", () => {
    const csv = rowsToCsv(["A", "B"], [["plain", 'has,comma'], ['has"quote', "line\nbreak"]]);
    // Strip the UTF-8 BOM for assertions.
    const body = csv.replace(/^﻿/, "");
    expect(body).toContain("A,B");
    expect(body).toContain('plain,"has,comma"');
    expect(body).toContain('"has""quote","line\nbreak"');
    expect(body.endsWith("\r\n")).toBe(true);
  });

  it("prefixes a UTF-8 BOM for Excel", () => {
    expect(rowsToCsv(["A"], []).charCodeAt(0)).toBe(0xfeff);
  });

  it("neutralises spreadsheet formula injection in user-controlled cells", () => {
    const body = rowsToCsv(
      ["Title"],
      [
        ['=HYPERLINK("http://evil","x")'],
        ["+1+1"],
        ["-2"],
        ["@SUM(A1)"],
        ["\tleadingtab"],
      ],
    ).replace(/^﻿/, "");
    // Each dangerous cell is prefixed with a single quote so Excel/Sheets
    // treats it as text; the leading = also forces RFC-4180 quoting via ".
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(body).toContain("'+1+1");
    expect(body).toContain("'-2");
    expect(body).toContain("'@SUM(A1)");
    // A plain title is untouched.
    expect(rowsToCsv(["T"], [["Cracked busbar"]])).toContain("Cracked busbar");
  });
});

describe("NCR analytics + export routes (source contract)", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/quality-ncr-routes.ts"), "utf8");

  it("analytics + export are registered before the /:id route", () => {
    const analytics = source.indexOf('"/api/quality/ncrs/analytics"');
    const exportRoute = source.indexOf('"/api/quality/ncrs/export"');
    const getOne = source.indexOf('"/api/quality/ncrs/:id"');
    expect(analytics).toBeGreaterThan(0);
    expect(exportRoute).toBeGreaterThan(0);
    expect(analytics).toBeLessThan(getOne);
    expect(exportRoute).toBeLessThan(getOne);
  });

  it("analytics is project-scoped", () => {
    const block = source.slice(source.indexOf('"/api/quality/ncrs/analytics"'), source.indexOf('"/api/quality/ncrs/export"'));
    expect(block).toContain("getQualityHseScope(req)");
    expect(block).toContain("scopedProjectIdsArray(scope)");
    expect(block).toContain("computeNcrAging");
    expect(block).toContain("computeNcrTrend");
  });

  it("export honours scope + filters and emits CSV", () => {
    const block = source.slice(source.indexOf('"/api/quality/ncrs/export"'), source.indexOf('"/api/quality/ncrs/:id"'));
    expect(block).toContain("text/csv");
    expect(block).toContain("Content-Disposition");
    expect(block).toContain("scopeAllowsProject(scope, projectId)");
    expect(block).toContain("rowsToCsv(NCR_EXPORT_HEADER");
  });
});

describe("qm-dashboard renders aging tiles + export button", () => {
  const client = fs.readFileSync(path.join(process.cwd(), "client/src/pages/qm-dashboard.tsx"), "utf8");

  it("fetches the analytics endpoint", () => {
    expect(client).toContain('"/api/quality/ncrs/analytics"');
  });

  it("renders the three aging tiles", () => {
    expect(client).toContain('data-testid="qm-ncr-aging"');
    expect(client).toContain('qm-ncr-aging-${b.key}');
  });

  it("has an export button that downloads the register CSV", () => {
    expect(client).toContain('data-testid="btn-export-ncrs"');
    expect(client).toContain('"/api/quality/ncrs/export"');
    expect(client).toContain('a.download = "ncr-register.csv"');
  });
});

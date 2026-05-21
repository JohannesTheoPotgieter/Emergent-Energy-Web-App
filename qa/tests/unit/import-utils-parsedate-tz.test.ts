/**
 * Locks in the calendar-day invariant for `parseDate` and
 * `excelSerialToDate` across server timezones and date input formats.
 *
 * Background. Excel cost-line workbooks store invoice dates as calendar
 * days (no timezone). ExcelJS returns date cells as JS Date objects —
 * usually UTC-midnight for serial-stored dates, sometimes local-midnight
 * for typed-in dates. The original `parseDate` flattened everything to
 * UTC via `.toISOString().split("T")[0]`, which silently shifted any
 * non-UTC-midnight Date back by a day. On a server running with
 * TZ=Africa/Johannesburg the regression bites start-of-month values
 * (e.g. a workbook "1 May 2026" landing as "30 April" in the database),
 * which then bucket into the wrong Recon-Grid column.
 *
 * The fix anchors `excelSerialToDate` on UTC midnight (so the offset is
 * server-TZ-independent) and adds `dateObjectToYmd` which extracts the
 * calendar day from whichever end (UTC or local) is at midnight. The
 * string regex paths also accept additional separator forms common in
 * South African trackers: "2026.04.30", "30-04-2026", and US-style
 * "04/30/2026" via JS Date fallback.
 */

import { describe, expect, it } from "vitest";
import { parseDate, lastDayOfMonthFromDate } from "../../../server/lib/import/utils";

describe("parseDate — calendar form strings", () => {
  const cases: Array<[string, string]> = [
    ["2026-04-30", "2026-04-30"],
    ["2026/04/30", "2026-04-30"],
    ["2026.04.30", "2026-04-30"],
    ["30/04/2026", "2026-04-30"],
    ["30-04-2026", "2026-04-30"],
    ["2026-04-30 00:00:00", "2026-04-30"],
    ["2026-04-30T00:00:00", "2026-04-30"],
    ["2026-04-30T00:00:00.000Z", "2026-04-30"],
    ["  2026-04-30  ", "2026-04-30"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → ${expected}`, () => {
      expect(parseDate(input)).toBe(expected);
    });
  }
});

describe("parseDate — month-end dates (the workbook's invoice-raised-date convention)", () => {
  const cases: Array<[string, string]> = [
    ["2026-03-31", "2026-03-31"],
    ["2026/04/30", "2026-04-30"],
    ["31/05/2026", "2026-05-31"],
    ["30/06/2026", "2026-06-30"],
    ["31/07/2026", "2026-07-31"],
    ["31/08/2026", "2026-08-31"],
    ["30/09/2026", "2026-09-30"],
    ["31/10/2026", "2026-10-31"],
    ["30/11/2026", "2026-11-30"],
    ["31/12/2026", "2026-12-31"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → ${expected}`, () => {
      expect(parseDate(input)).toBe(expected);
    });
  }
});

describe("parseDate — ExcelJS Date objects", () => {
  it("UTC-midnight Date (ExcelJS standard for date-typed cells)", () => {
    const d = new Date(Date.UTC(2026, 3, 30));
    expect(parseDate(d)).toBe("2026-04-30");
  });

  it("UTC-midnight Date for 1 May 2026", () => {
    const d = new Date(Date.UTC(2026, 4, 1));
    expect(parseDate(d)).toBe("2026-05-01");
  });

  it("Date with explicit zero UTC time components survives round-trip", () => {
    // Equivalent to ExcelJS reading a workbook authored on any machine.
    const iso = "2026-04-30T00:00:00.000Z";
    expect(parseDate(new Date(iso))).toBe("2026-04-30");
  });

  it("Formula cell with cached Date result is unwrapped", () => {
    const cell = { formula: "EOMONTH(W6,0)", result: new Date(Date.UTC(2026, 3, 30)) };
    expect(parseDate(cell)).toBe("2026-04-30");
  });

  it("Shared formula cell with cached Date result is unwrapped", () => {
    const cell = { sharedFormula: "T7", result: new Date(Date.UTC(2026, 6, 31)) };
    expect(parseDate(cell)).toBe("2026-07-31");
  });
});

describe("parseDate — Excel date serial numbers (1900 system)", () => {
  // Excel serial 46147 = 5 May 2026 in the 1900 system. (Excel includes the
  // phantom 29 Feb 1900 so serials above 59 are off-by-one vs the unix epoch
  // arithmetic. The fix anchors on UTC midnight Dec 31 1899 so the math
  // produces the same day regardless of process.env.TZ.)
  it("46147 → 2026-05-05", () => {
    expect(parseDate(46147)).toBe("2026-05-05");
  });

  // Cross-check: a known serial near today's date.
  it("45777 → 2025-04-30 (known reference)", () => {
    expect(parseDate(45777)).toBe("2025-04-30");
  });

  it("returns null for negative serials", () => {
    expect(parseDate(-1)).toBe(null);
  });
});

describe("parseDate — null / empty / error inputs", () => {
  it("null → null", () => expect(parseDate(null)).toBe(null));
  it("undefined → null", () => expect(parseDate(undefined)).toBe(null));
  it("empty string → null", () => expect(parseDate("")).toBe(null));
  it("whitespace only → null", () => expect(parseDate("   ")).toBe(null));
  it("Excel #REF! string → null", () => expect(parseDate("#REF!")).toBe(null));
  it("Excel #DIV/0! string → null", () => expect(parseDate("#DIV/0!")).toBe(null));
  it("Structured Excel error → null", () => expect(parseDate({ error: "#NAME?" })).toBe(null));
  it("Junk string → null", () => expect(parseDate("not a date")).toBe(null));
});

describe("parseDate — calendar-day invariant on TZ=Africa/Johannesburg", () => {
  // Pre-flight: only run if the test process actually picked up SAST.
  // Vitest reads process.env.TZ at worker startup, so this block is the
  // realistic check that the regression we shipped is gone in CI.
  const tzNow = new Date().getTimezoneOffset();
  const isSAST = tzNow === -120; // SAST is UTC+2, getTimezoneOffset returns -120 minutes.

  it.runIf(isSAST)("YYYY/MM/DD does not slip a day on SAST", () => {
    expect(parseDate("2026/04/30")).toBe("2026-04-30");
  });

  it.runIf(isSAST)("Date('2026/04/30') string does not slip a day on SAST", () => {
    expect(parseDate("2026/04/30")).toBe("2026-04-30");
  });

  it.runIf(isSAST)("Locally-constructed 1-May Date does not slip back to 30-April on SAST", () => {
    // new Date(year, monthIndex, day) constructs in local time. On a SAST
    // worker this produces 2026-04-30T22:00:00.000Z — the previous regression
    // returned "2026-04-30"; the fix returns the intended local "2026-05-01".
    expect(parseDate(new Date(2026, 4, 1, 0, 0, 0))).toBe("2026-05-01");
  });
});

describe("lastDayOfMonthFromDate — server-TZ-independent EOMONTH replica", () => {
  it("returns the EOMONTH for a mid-month date", () => {
    expect(lastDayOfMonthFromDate("2026-04-15")).toBe("2026-04-30");
  });

  it("returns the same date when given a month-end input", () => {
    expect(lastDayOfMonthFromDate("2026-04-30")).toBe("2026-04-30");
  });

  it("rolls over to next-month EOMONTH for start-of-month inputs", () => {
    expect(lastDayOfMonthFromDate("2026-05-01")).toBe("2026-05-31");
  });

  it("handles February in a non-leap year", () => {
    expect(lastDayOfMonthFromDate("2026-02-15")).toBe("2026-02-28");
  });

  it("handles February in a leap year", () => {
    expect(lastDayOfMonthFromDate("2024-02-15")).toBe("2024-02-29");
  });

  it("returns null for invalid month", () => {
    expect(lastDayOfMonthFromDate("2026-13-15")).toBe(null);
  });

  it("returns null for null input", () => {
    expect(lastDayOfMonthFromDate(null)).toBe(null);
  });
});

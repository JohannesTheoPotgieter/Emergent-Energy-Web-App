import { describe, expect, it } from "vitest";

import {
  FRESHNESS_THRESHOLD_DAYS,
  parseLastVerified,
  daysBetween,
  parseRoleCount,
  parseSnapshotList,
  diffSets,
} from "../../../scripts/lib/check-agent-docs-lib";

describe("parseLastVerified", () => {
  it("matches the canonical bold-markdown form", () => {
    const text = "# Title\n\n**Last verified:** 2026-05-08\nbody";
    expect(parseLastVerified(text)).toEqual({ date: "2026-05-08", line: 3 });
  });

  it("matches a plain-text form (replit.md / AGENTS.md)", () => {
    expect(parseLastVerified("Last verified: 2026-05-07")).toEqual({
      date: "2026-05-07",
      line: 1,
    });
  });

  it("matches a quoted form (CLAUDE.md style)", () => {
    expect(parseLastVerified("> **Last verified:** 2026-05-08. Owner: ...")).toEqual({
      date: "2026-05-08",
      line: 1,
    });
  });

  it("returns null when no Last verified line exists", () => {
    expect(parseLastVerified("nothing here\nstill nothing")).toBeNull();
  });

  it("returns the FIRST occurrence when multiple exist", () => {
    const text = "Last verified: 2026-01-01\nLast verified: 2026-12-31";
    expect(parseLastVerified(text)).toEqual({ date: "2026-01-01", line: 1 });
  });
});

describe("daysBetween", () => {
  it("zero for the same date", () => {
    expect(daysBetween("2026-05-08", "2026-05-08")).toBe(0);
  });

  it("positive forward, negative backward", () => {
    expect(daysBetween("2026-05-08", "2026-05-09")).toBe(1);
    expect(daysBetween("2026-05-09", "2026-05-08")).toBe(-1);
  });

  it("crosses month + year boundary correctly", () => {
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2026-04-01")).toBe(90);
  });
});

describe("parseRoleCount", () => {
  it("matches the canonical CLAUDE.md form", () => {
    const text = "- **Auth & RBAC:** see foo. 16 company roles as of 2026-05-08.";
    expect(parseRoleCount(text)).toEqual({ count: 16, line: 1 });
  });

  it("returns null when no role-count claim exists", () => {
    expect(parseRoleCount("no claim here")).toBeNull();
  });

  it("ignores numbers in unrelated contexts (no false positive on '16 documents')", () => {
    expect(parseRoleCount("There are 16 documents and 5 reports.")).toBeNull();
  });

  it("returns the FIRST occurrence", () => {
    expect(parseRoleCount("12 company roles\n8 company roles")).toEqual({
      count: 12,
      line: 1,
    });
  });
});

describe("parseSnapshotList", () => {
  it("parses the canonical § 3.1 line with backticks and trailing period", () => {
    const text = "Snapshot tables today: `a`, `b`, `c`.";
    expect(parseSnapshotList(text)).toEqual({
      tables: ["a", "b", "c"],
      line: 1,
    });
  });

  it("strips backticks and trims whitespace per element", () => {
    const text = "Snapshot tables today:  ` a ` ,  `b`,  `c`  .";
    const got = parseSnapshotList(text);
    expect(got?.tables).toEqual(["a", "b", "c"]);
  });

  it("works without trailing period", () => {
    expect(parseSnapshotList("Snapshot tables today: `a`, `b`")?.tables).toEqual(["a", "b"]);
  });

  it("returns null when the line is absent", () => {
    expect(parseSnapshotList("nothing relevant\nhere")).toBeNull();
  });
});

describe("diffSets", () => {
  it("reports nothing missing and nothing extra when sets match", () => {
    expect(diffSets(["a", "b"], ["a", "b"])).toEqual({ missing: [], extra: [] });
  });

  it("reports schema-only entries as missing-from-doc", () => {
    expect(diffSets(["a"], ["a", "b", "c"])).toEqual({ missing: ["b", "c"], extra: [] });
  });

  it("reports doc-only entries as extra-in-doc", () => {
    expect(diffSets(["a", "b", "c"], ["a"])).toEqual({ missing: [], extra: ["b", "c"] });
  });

  it("reports both when each side has unique entries", () => {
    expect(diffSets(["a", "old"], ["a", "new"])).toEqual({
      missing: ["new"],
      extra: ["old"],
    });
  });

  it("output is sorted (deterministic)", () => {
    expect(diffSets([], ["zeta", "alpha", "mu"])).toEqual({
      missing: ["alpha", "mu", "zeta"],
      extra: [],
    });
  });
});

describe("FRESHNESS_THRESHOLD_DAYS", () => {
  it("is 90 days per AGENT_GUARDRAILS.md § 11/12", () => {
    expect(FRESHNESS_THRESHOLD_DAYS).toBe(90);
  });
});

import { describe, expect, it } from "vitest";
import {
  isQualityTaskRecord,
  parseQualityTaskQuery,
} from "../../../server/routes/quality-tasks.routes";

describe("quality tasks API contract", () => {
  it("normalizes supported filters from query params", () => {
    expect(parseQualityTaskQuery({
      status: "blocked",
      owner: "17",
      project: "42",
      dueBefore: "2026-06-30",
      source: "ncr",
      search: " inverter ",
    })).toEqual({
      status: "blocked",
      ownerUserId: 17,
      projectId: 42,
      dueBefore: "2026-06-30",
      source: "ncr",
      search: "inverter",
    });
  });

  it("ignores invalid numeric and date filters instead of forwarding bad values", () => {
    expect(parseQualityTaskQuery({
      owner: "abc",
      project: "-2",
      dueBefore: "not-a-date",
      search: "   ",
    })).toEqual({});
  });

  it("captures NCR, evidence, QA, and quality-owned tasks server-side", () => {
    expect(isQualityTaskRecord({ source: "NCR" })).toBe(true);
    expect(isQualityTaskRecord({ source: "missing_evidence" })).toBe(true);
    expect(isQualityTaskRecord({ discipline: "Quality" })).toBe(true);
    expect(isQualityTaskRecord({ taskTypeTag: "qa-check" })).toBe(true);
    expect(isQualityTaskRecord({ source: "engineering", discipline: "electrical" })).toBe(false);
  });
});

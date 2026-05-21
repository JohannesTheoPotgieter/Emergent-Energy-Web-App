import { describe, expect, it } from "vitest";
import {
  accountNameMatchesAnyPattern,
  classifyBillAccounts,
  parseAccountNamePatterns,
} from "../../../shared/config/qb-account-classification";

describe("parseAccountNamePatterns", () => {
  it("returns an empty list when the env var is undefined", () => {
    expect(parseAccountNamePatterns(undefined)).toEqual([]);
  });

  it("returns an empty list when the env var is null", () => {
    expect(parseAccountNamePatterns(null)).toEqual([]);
  });

  it("returns an empty list when the env var is empty / whitespace", () => {
    expect(parseAccountNamePatterns("")).toEqual([]);
    expect(parseAccountNamePatterns("   ")).toEqual([]);
    expect(parseAccountNamePatterns(",,,")).toEqual([]);
  });

  it("splits on commas, trims whitespace, lowercases", () => {
    expect(parseAccountNamePatterns("Cost of Sales, Materials ,SUBCONTRACTOR")).toEqual([
      "cost of sales",
      "materials",
      "subcontractor",
    ]);
  });

  it("drops empty segments without affecting the rest", () => {
    expect(parseAccountNamePatterns("cogs,,materials, ,labour")).toEqual([
      "cogs",
      "materials",
      "labour",
    ]);
  });
});

describe("accountNameMatchesAnyPattern", () => {
  const patterns = ["cost of sales", "materials"];

  it("returns false when the account name is null / undefined / empty", () => {
    expect(accountNameMatchesAnyPattern(null, patterns)).toBe(false);
    expect(accountNameMatchesAnyPattern(undefined, patterns)).toBe(false);
    expect(accountNameMatchesAnyPattern("", patterns)).toBe(false);
  });

  it("returns false when patterns is empty", () => {
    expect(accountNameMatchesAnyPattern("Cost of Sales", [])).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(accountNameMatchesAnyPattern("Cost Of Sales", patterns)).toBe(true);
    expect(accountNameMatchesAnyPattern("MATERIALS - panels", patterns)).toBe(true);
  });

  it("matches substring (not just prefix)", () => {
    expect(accountNameMatchesAnyPattern("Project — Cost of Sales", patterns)).toBe(true);
  });

  it("returns false when no pattern matches", () => {
    expect(accountNameMatchesAnyPattern("Rent", patterns)).toBe(false);
    expect(accountNameMatchesAnyPattern("Office Supplies", patterns)).toBe(false);
  });
});

describe("classifyBillAccounts", () => {
  it("treats empty patterns as inactive (everything is COS)", () => {
    const verdict = classifyBillAccounts({ accountNames: ["Rent", "Insurance"] }, []);
    expect(verdict.isCos).toBe(true);
    expect(verdict.matchedAccountNames).toEqual([]);
    expect(verdict.unmatchedAccountNames).toEqual([]);
  });

  it("treats synthetic header-only bills (no accountNames) as keep-with-unknown", () => {
    const verdict = classifyBillAccounts({ accountNames: [] }, ["cost of sales"]);
    expect(verdict.isCos).toBe(true);
    expect(verdict.matchedAccountNames).toEqual([]);
    expect(verdict.unmatchedAccountNames).toEqual([]);
  });

  it("returns isCos=true when any account matches the whitelist", () => {
    const verdict = classifyBillAccounts(
      { accountNames: ["Cost of Sales — Panels", "Rent"] },
      ["cost of sales"],
    );
    expect(verdict.isCos).toBe(true);
    expect(verdict.matchedAccountNames).toEqual(["Cost of Sales — Panels"]);
    expect(verdict.unmatchedAccountNames).toEqual(["Rent"]);
  });

  it("returns isCos=false when no account matches the whitelist", () => {
    const verdict = classifyBillAccounts(
      { accountNames: ["Rent", "Insurance", "Office Supplies"] },
      ["cost of sales", "materials", "subcontractor"],
    );
    expect(verdict.isCos).toBe(false);
    expect(verdict.matchedAccountNames).toEqual([]);
    expect(verdict.unmatchedAccountNames).toEqual([
      "Rent",
      "Insurance",
      "Office Supplies",
    ]);
  });

  it("classifies mixed bills correctly — even one matching line is enough", () => {
    const verdict = classifyBillAccounts(
      { accountNames: ["Rent", "Materials — Panels"] },
      ["materials"],
    );
    expect(verdict.isCos).toBe(true);
    expect(verdict.matchedAccountNames).toEqual(["Materials — Panels"]);
    expect(verdict.unmatchedAccountNames).toEqual(["Rent"]);
  });
});

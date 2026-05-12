import { describe, expect, it } from "vitest";
import { evaluateSafeFormula } from "../../../shared/lib/safe-formula";

describe("evaluateSafeFormula", () => {
  describe("seeded postmortem formulas (regression)", () => {
    it("`(100-(count*10))/100` with count=3 evaluates to 0.7", () => {
      expect(evaluateSafeFormula("(100-(count*10))/100", { count: 3 })).toBeCloseTo(0.7, 5);
    });

    it("`(100-(count*15))/100` with count=2 evaluates to 0.7", () => {
      expect(evaluateSafeFormula("(100-(count*15))/100", { count: 2 })).toBeCloseTo(0.7, 5);
    });

    it("`(100-(days*12.5))/100` with days=4 evaluates to 0.5", () => {
      expect(evaluateSafeFormula("(100-(days*12.5))/100", { days: 4 })).toBeCloseTo(0.5, 5);
    });

    it("`(100-(days*2.5))/100` with days=10 evaluates to 0.75", () => {
      expect(evaluateSafeFormula("(100-(days*2.5))/100", { days: 10 })).toBeCloseTo(0.75, 5);
    });
  });

  describe("arithmetic", () => {
    it("respects operator precedence", () => {
      expect(evaluateSafeFormula("2 + 3 * 4")).toBe(14);
      expect(evaluateSafeFormula("(2 + 3) * 4")).toBe(20);
      expect(evaluateSafeFormula("10 - 2 - 3")).toBe(5); // left-assoc
      expect(evaluateSafeFormula("100 / 4 / 5")).toBe(5);
    });

    it("supports decimals", () => {
      expect(evaluateSafeFormula("1.5 + 2.5")).toBe(4);
      expect(evaluateSafeFormula("0.1 * 10")).toBeCloseTo(1, 5);
    });

    it("supports unary minus", () => {
      expect(evaluateSafeFormula("-5")).toBe(-5);
      expect(evaluateSafeFormula("-(2+3)")).toBe(-5);
      expect(evaluateSafeFormula("5 + -3")).toBe(2);
    });
  });

  describe("variable substitution", () => {
    it("looks up identifiers from the vars map", () => {
      expect(evaluateSafeFormula("a + b", { a: 1, b: 2 })).toBe(3);
    });

    it("returns null for unknown identifiers", () => {
      expect(evaluateSafeFormula("count + 1", {})).toBeNull();
      expect(evaluateSafeFormula("count", { days: 5 })).toBeNull();
    });
  });

  describe("safety — REFUSE non-numeric grammar", () => {
    it("refuses function calls", () => {
      expect(evaluateSafeFormula("fetch()")).toBeNull();
      expect(evaluateSafeFormula("alert(1)")).toBeNull();
    });

    it("refuses property access", () => {
      expect(evaluateSafeFormula("a.b", { a: 1 })).toBeNull();
      expect(evaluateSafeFormula("console.log")).toBeNull();
    });

    it("refuses string literals", () => {
      expect(evaluateSafeFormula("'abc'")).toBeNull();
      expect(evaluateSafeFormula('"abc"')).toBeNull();
    });

    it("refuses semicolons and statements", () => {
      expect(evaluateSafeFormula("1; 2")).toBeNull();
      expect(evaluateSafeFormula("1, 2")).toBeNull();
    });

    it("refuses bracket / member access", () => {
      expect(evaluateSafeFormula("[1,2,3]")).toBeNull();
      expect(evaluateSafeFormula("a[0]", { a: 1 })).toBeNull();
    });

    it("refuses ternary and logical operators", () => {
      expect(evaluateSafeFormula("1 ? 2 : 3")).toBeNull();
      expect(evaluateSafeFormula("1 && 2")).toBeNull();
      expect(evaluateSafeFormula("1 || 2")).toBeNull();
    });

    it("refuses comparison operators", () => {
      expect(evaluateSafeFormula("1 < 2")).toBeNull();
      expect(evaluateSafeFormula("1 == 1")).toBeNull();
    });

    it("refuses common JS escape attempts", () => {
      expect(evaluateSafeFormula("constructor")).toBeNull();
      expect(evaluateSafeFormula("global")).toBeNull();
      expect(evaluateSafeFormula("process")).toBeNull();
    });
  });

  describe("safety — REFUSE malformed input", () => {
    it("returns null for empty / non-string", () => {
      expect(evaluateSafeFormula("")).toBeNull();
      expect(evaluateSafeFormula(null as unknown as string)).toBeNull();
      expect(evaluateSafeFormula(undefined as unknown as string)).toBeNull();
    });

    it("returns null for unbalanced parens", () => {
      expect(evaluateSafeFormula("(1 + 2")).toBeNull();
      expect(evaluateSafeFormula("1 + 2)")).toBeNull();
    });

    it("returns null for trailing garbage", () => {
      expect(evaluateSafeFormula("1 + 2 garbage")).toBeNull();
    });

    it("returns null for division by zero", () => {
      expect(evaluateSafeFormula("1 / 0")).toBeNull();
      expect(evaluateSafeFormula("10 / (5 - 5)")).toBeNull();
    });

    it("rejects inputs longer than the 200-char bound", () => {
      const longExpr = "1 + ".repeat(100) + "1"; // 401 chars
      expect(evaluateSafeFormula(longExpr)).toBeNull();
    });

    it("returns null for non-finite results", () => {
      expect(evaluateSafeFormula("0 / 0")).toBeNull();
    });
  });
});

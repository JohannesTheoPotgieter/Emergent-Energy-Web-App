import { describe, expect, it } from "vitest";
import {
  calculateDepartmentScore,
  calculateCompanyScore,
} from "@shared/config/kpi-registry";

// T1.x audit Surprise 1: a department with no data was rendered as RED,
// not grey. Per the audit a department with null score is "we don't know
// yet" rather than "performing badly", and a fresh tenant should not
// glow scarlet.
describe("KPI registry — null score → grey, not red (T1.x Surprise 1)", () => {
  it("calculateDepartmentScore returns rag='grey' when no KPI has data", () => {
    const empty = new Map();
    const result = calculateDepartmentScore("Finance", empty);
    expect(result.score).toBeNull();
    expect(result.rag).toBe("grey");
    expect(result.dataAvailable).toBe(false);
  });

  it("calculateDepartmentScore still returns red/amber/green when data is present", () => {
    const lowScore = new Map([
      [
        "fin_revenue_vs_target",
        { actual: 10_000_000, target: 100_000_000 }, // 10% of target → very low score
      ],
    ]);
    const result = calculateDepartmentScore("Finance", lowScore);
    expect(result.score).not.toBeNull();
    expect(["green", "amber", "red"]).toContain(result.rag);
    expect(result.rag).not.toBe("grey");
  });

  it("calculateCompanyScore returns rag='grey' when no department has data", () => {
    const allEmpty = [
      { department: "Finance" as const, score: null, rag: "grey" as const, kpis: [], dataAvailable: false, provisional: false },
      { department: "Engineering" as const, score: null, rag: "grey" as const, kpis: [], dataAvailable: false, provisional: false },
    ];
    const result = calculateCompanyScore(allEmpty);
    expect(result.score).toBeNull();
    expect(result.rag).toBe("grey");
  });

  it("calculateCompanyScore returns a coloured rag when at least one department has data", () => {
    const mixed = [
      { department: "Finance" as const, score: 75, rag: "amber" as const, kpis: [], dataAvailable: true, provisional: false },
      { department: "Engineering" as const, score: null, rag: "grey" as const, kpis: [], dataAvailable: false, provisional: false },
    ];
    const result = calculateCompanyScore(mixed);
    expect(result.score).not.toBeNull();
    expect(["green", "amber", "red"]).toContain(result.rag);
    expect(result.rag).not.toBe("grey");
  });
});

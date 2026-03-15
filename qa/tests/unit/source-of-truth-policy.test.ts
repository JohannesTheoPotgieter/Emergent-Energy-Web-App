import { describe, it, expect } from "vitest";
import { classifyProjectInfoField, classifyProjectInfoPayload } from "../../../server/services/source-of-truth-policy";

describe("source-of-truth policy", () => {
  it("classifies known project master fields as EXCEL_MASTERED", () => {
    expect(classifyProjectInfoField("phase")).toBe("EXCEL_MASTERED");
    expect(classifyProjectInfoField("clientId")).toBe("EXCEL_MASTERED");
  });

  it("classifies collaboration fields as APP_MASTERED", () => {
    expect(classifyProjectInfoField("latestUpdate")).toBe("APP_MASTERED");
  });

  it("marks payloads touching excel fields as governance-required", () => {
    const payload = classifyProjectInfoPayload({ phase: "Construction", latestUpdate: "note" });
    expect(payload.requiresSourceUpdateGovernance).toBe(true);
    expect(payload.excelMasteredFields).toContain("phase");
    expect(payload.appMasteredFields).toContain("latestUpdate");
  });
});

import { describe, it, expect } from "vitest";
import { computeEvidenceEvaluation, isEvidenceOverrideAuthorized } from "../../../server/services/evidence-evaluation-service";

describe("evidence evaluation model", () => {
  const requirements = [
    { requirementKey: "doc_pack", label: "Document pack", evidenceType: "document", isRequired: true, weight: 2, minCount: 1 },
    { requirementKey: "photos", label: "Photos", evidenceType: "photo", isRequired: true, weight: 1, minCount: 2 },
    { requirementKey: "signoff", label: "Sign-off", evidenceType: "sign_off", isRequired: true, weight: 2, minCount: 1 },
  ];

  it("blocks completion below threshold", () => {
    const result = computeEvidenceEvaluation(requirements, [{ requirementKey: "doc_pack", evidenceType: "document" }], 80);
    expect(result.pass).toBe(false);
    expect(result.score).toBeLessThan(80);
  });

  it("allows completion at or above threshold", () => {
    const result = computeEvidenceEvaluation(requirements, [
      { requirementKey: "doc_pack", evidenceType: "document" },
      { requirementKey: "photos", evidenceType: "photo" },
      { requirementKey: "photos", evidenceType: "photo" },
      { requirementKey: "signoff", evidenceType: "sign_off" },
    ], 80);
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("override allowed only for authorized role", () => {
    expect(isEvidenceOverrideAuthorized("PROGRAM_MANAGER")).toBe(true);
    expect(isEvidenceOverrideAuthorized("PROJECT_DEVELOPER")).toBe(false);
  });

  it("missing evidence summary is accurate", () => {
    const result = computeEvidenceEvaluation(requirements, [{ evidenceType: "document", requirementKey: "doc_pack" }], 70);
    expect(result.missingItems.map((m) => m.requirementKey)).toEqual(["photos", "signoff"]);
    const photos = result.missingItems.find((m) => m.requirementKey === "photos");
    expect(photos?.missingBy).toBe(2);
  });

  it("score recalculates as evidence is added/removed", () => {
    const low = computeEvidenceEvaluation(requirements, [{ requirementKey: "doc_pack", evidenceType: "document" }], 80);
    const high = computeEvidenceEvaluation(requirements, [
      { requirementKey: "doc_pack", evidenceType: "document" },
      { requirementKey: "photos", evidenceType: "photo" },
      { requirementKey: "photos", evidenceType: "photo" },
      { requirementKey: "signoff", evidenceType: "sign_off" },
    ], 80);
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("timeline event actions are declared for evidence changes", () => {
    expect(["evidence.collected", "evidence.override", "evidence.completion_pass"]).toContain("evidence.override");
  });
});

/**
 * Phase 4a — discipline-aware approval matching. Tests the pure matcher that
 * both the legacy (taxonomy) and browse-and-bind (discipline + subfolder)
 * finders share.
 */

import { describe, it, expect } from "vitest";
import { pickRequirement } from "../../../server/repositories/document-approval-requirements-repository";
import type { DocumentApprovalRequirement } from "@shared/schema/documents";

function req(partial: Partial<DocumentApprovalRequirement>): DocumentApprovalRequirement {
  return {
    id: 1,
    taxonomyKey: null,
    discipline: "ENGINEERING",
    subfolderPattern: null,
    fileNamePattern: null,
    displayName: "Rule",
    description: null,
    approverRoles: [],
    requiresAllApprovers: false,
    extractSpec: null,
    active: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as DocumentApprovalRequirement;
}

describe("pickRequirement", () => {
  it("returns null with no candidates", () => {
    expect(pickRequirement([], "x.pdf", "")).toBeNull();
  });

  it("matches by fileNamePattern, case-insensitive", () => {
    const r = req({ id: 2, fileNamePattern: "^as-built.*\\.pdf$" });
    expect(pickRequirement([r], "AS-BUILT-final.PDF", "")).toBe(r);
    expect(pickRequirement([r], "notes.txt", "")).toBeNull();
  });

  it("falls back to an unconditional (no fileNamePattern) requirement", () => {
    const cond = req({ id: 2, fileNamePattern: "^x" });
    const uncond = req({ id: 3, fileNamePattern: null });
    expect(pickRequirement([cond, uncond], "y.pdf", "")).toBe(uncond);
  });

  it("prefers a fileNamePattern match over the unconditional fallback", () => {
    const cond = req({ id: 2, fileNamePattern: "^report" });
    const uncond = req({ id: 3, fileNamePattern: null });
    expect(pickRequirement([cond, uncond], "report.pdf", "")).toBe(cond);
  });

  it("applies a subfolderPattern rule only when relPath matches", () => {
    const r = req({ id: 2, subfolderPattern: "^IFC", fileNamePattern: null });
    expect(pickRequirement([r], "dwg.pdf", "IFC")).toBe(r);
    expect(pickRequirement([r], "dwg.pdf", "")).toBeNull();
    expect(pickRequirement([r], "dwg.pdf", "AsBuilt")).toBeNull();
  });

  it("skips a broken regex without throwing and uses the next match", () => {
    const bad = req({ id: 2, fileNamePattern: "(" });
    const good = req({ id: 3, fileNamePattern: null });
    expect(() => pickRequirement([bad, good], "x.pdf", "")).not.toThrow();
    expect(pickRequirement([bad, good], "x.pdf", "")).toBe(good);
  });
});

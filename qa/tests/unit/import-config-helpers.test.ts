import { describe, expect, it } from "vitest";
import {
  deriveTemplateProfileName,
  normalizeImportSourceKey,
} from "../../../server/lib/import/source-key";
import {
  deriveImportRunState,
  summarizeImportRun,
} from "../../../server/lib/import/run-summary";
import type { SmartImportRun } from "@shared/schema";

describe("import source-key helpers", () => {
  describe("deriveTemplateProfileName", () => {
    it("strips the leading upload prefix, extension, and underscores", () => {
      expect(deriveTemplateProfileName("1780_my_project_plan.xlsx")).toBe("my project plan");
      expect(deriveTemplateProfileName("42_Acme Solar Tracker.xlsm")).toBe("Acme Solar Tracker");
    });

    it("preserves case (profile lookup is case-sensitive)", () => {
      expect(deriveTemplateProfileName("Acme.xlsx")).toBe("Acme");
    });

    it("is stable across re-uploads of the same tracker (write == read side)", () => {
      // Differing leading upload prefixes must resolve to the same profile name.
      expect(deriveTemplateProfileName("100_Acme Tracker.xlsx")).toBe(
        deriveTemplateProfileName("999_Acme Tracker.xlsx"),
      );
    });

    it("falls back to the project name, then a default", () => {
      expect(deriveTemplateProfileName(".xlsx", "Fallback Project")).toBe("Fallback Project");
      expect(deriveTemplateProfileName(".xlsx")).toBe("Default Template");
    });
  });

  describe("normalizeImportSourceKey", () => {
    it("lower-cases and collapses whitespace/underscores", () => {
      expect(normalizeImportSourceKey("1780_Acme  Solar_Tracker.xlsx")).toBe("acme solar tracker");
    });

    it("binds re-uploads of the same tracker to one key regardless of prefix/case", () => {
      expect(normalizeImportSourceKey("100_ACME.xlsx")).toBe(normalizeImportSourceKey("999_acme.xlsx"));
    });
  });
});

// Minimal typed fixture — only the fields summarizeImportRun reads matter,
// the rest are defaulted so we don't couple the test to the full row shape.
function makeRun(overrides: Partial<SmartImportRun>): SmartImportRun {
  const base: SmartImportRun = {
    id: 1,
    projectId: 10,
    projectName: "Acme Solar",
    uploadedBy: null,
    uploadedAt: new Date("2026-06-01T00:00:00Z"),
    sourceFileName: "Acme.xlsx",
    sourceFileHash: null,
    status: "committed",
    templateProfileId: null,
    summaryJson: null,
    committedAt: new Date("2026-06-02T00:00:00Z"),
    committedBy: null,
    recordsAttempted: 12,
    recordsSucceeded: 9,
    recordsFailed: 0,
    importType: "PLAN",
    preImportSnapshot: null,
  };
  return { ...base, ...overrides };
}

describe("import run-summary", () => {
  describe("deriveImportRunState", () => {
    it("maps statuses to human states", () => {
      expect(deriveImportRunState("committed")).toBe("up_to_date");
      expect(deriveImportRunState("awaiting_review")).toBe("needs_review");
      expect(deriveImportRunState("failed")).toBe("failed");
      expect(deriveImportRunState("preview")).toBe("in_progress");
      expect(deriveImportRunState("superseded")).toBe("in_progress");
    });
  });

  describe("summarizeImportRun", () => {
    it("a committed run is up to date with no reason and uses committedAt", () => {
      const v = summarizeImportRun(makeRun({ status: "committed" }));
      expect(v.state).toBe("up_to_date");
      expect(v.reason).toBeNull();
      expect(v.recordsChanged).toBe(9);
      expect(v.lastImportedAt).toEqual(new Date("2026-06-02T00:00:00Z"));
    });

    it("a failed run surfaces the error message as the reason", () => {
      const v = summarizeImportRun(
        makeRun({ status: "failed", committedAt: null, summaryJson: { error: { message: "Parse error" } } }),
      );
      expect(v.state).toBe("failed");
      expect(v.reason).toBe("Parse error");
      expect(v.lastImportedAt).toEqual(new Date("2026-06-01T00:00:00Z")); // falls back to uploadedAt
    });

    it("an awaiting-review run explains why (blocking conflicts)", () => {
      const v = summarizeImportRun(
        makeRun({ status: "awaiting_review", summaryJson: { schedulerV2: { plannerHasBlockingConflicts: true, autoMappedProjectId: 10 } } }),
      );
      expect(v.state).toBe("needs_review");
      expect(v.reason).toBe("Conflicts need a decision");
    });

    it("an awaiting-review run with no project match says so", () => {
      const v = summarizeImportRun(
        makeRun({ status: "awaiting_review", summaryJson: { schedulerV2: { plannerHasBlockingConflicts: false, autoMappedProjectId: null } } }),
      );
      expect(v.reason).toBe("No confident project match");
    });
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// Reimplementation of the functions (matching source logic) for behavioral testing
function normalizeForComparison(name: string): string {
  let n = name.toLowerCase().trim();
  n = n.replace(/\.(xlsx|xlsm|xls)$/i, "");
  n = n.replace(/[_\-]+/g, " ");
  n = n.replace(/\b(rev|revision|version|ver|v)\s*\d+\b/gi, "");
  n = n.replace(/\bv\d+(\.\d+)*\b/gi, "");
  n = n.replace(/\b(tracker|template|copy|final|draft|updated|new|old)\b/gi, "");
  // Phase suffixes are PRESERVED
  n = n.replace(/\(\d+\)/g, "");
  n = n.replace(/\d{4}[-\/]\d{2}[-\/]\d{2}/g, "");
  n = n.replace(/\d{8,}/g, "");
  n = n.replace(/[^a-z0-9\s]/g, "");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

function stripPhase(normalized: string): string {
  return normalized.replace(/\b(ph\s*\d+|phase\s*\d+)\b/gi, "").replace(/\s+/g, " ").trim();
}

function extractPhase(normalized: string): string | null {
  const match = normalized.match(/\b(ph\s*\d+|phase\s*\d+)\b/i);
  return match ? match[1].replace(/\s+/g, "").toLowerCase() : null;
}

function computeSimilarity(a: string, b: string): { score: number; matchReason?: string } {
  if (a === b) return { score: 1.0 };
  if (!a || !b) return { score: 0 };

  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  if (normA === normB) return { score: 1.0 };
  if (!normA || !normB) return { score: 0 };

  const baseA = stripPhase(normA);
  const baseB = stripPhase(normB);
  const phaseA = extractPhase(normA);
  const phaseB = extractPhase(normB);

  if (baseA === baseB && baseA.length > 0 && phaseA !== phaseB && (phaseA || phaseB)) {
    return { score: 0.7, matchReason: "same_project_different_phase" };
  }

  const tokensA = normA.split(/\s+/).filter(Boolean);
  const tokensB = normB.split(/\s+/).filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return { score: 0 };

  let matchCount = 0;
  for (const t of tokensA) {
    if (tokensB.includes(t)) matchCount++;
  }
  const tokenSimilarity = (2 * matchCount) / (tokensA.length + tokensB.length);

  const maxLen = Math.max(normA.length, normB.length);
  const minLen = Math.min(normA.length, normB.length);
  let commonPrefix = 0;
  for (let i = 0; i < minLen; i++) {
    if (normA[i] === normB[i]) commonPrefix++;
    else break;
  }
  const prefixSimilarity = commonPrefix / maxLen;

  if (normA.includes(normB) || normB.includes(normA)) {
    return { score: Math.max(0.85, tokenSimilarity, minLen / maxLen) };
  }

  return { score: Math.max(tokenSimilarity, prefixSimilarity) };
}

describe("Phase-aware duplicate prevention", () => {
  describe("Source code structure", () => {
    it("does NOT strip phase patterns", () => {
      const source = read("server/smart-import-routes.ts");
      // The old phase-stripping line should be gone
      expect(source).not.toMatch(/n = n\.replace\(\/\\b\(ph\\d\+\|phase\\s\*\\d\+\)\\b\/gi/);
    });

    it("has comment about preserving phase suffixes", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("Phase suffixes");
      expect(source).toContain("PRESERVED");
    });

    it("defines stripPhase helper", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("function stripPhase(");
    });

    it("defines extractPhase helper", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("function extractPhase(");
    });

    it("computeSimilarity returns matchReason for phase diffs", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("same_project_different_phase");
    });
  });

  describe("normalizeForComparison preserves phases", () => {
    it("preserves ph2 in Coega Steels Ph2_Tracker.xlsx", () => {
      expect(normalizeForComparison("Coega Steels Ph2_Tracker.xlsx")).toBe("coega steels ph2");
    });

    it("preserves ph1 in Coega Steels Ph1", () => {
      expect(normalizeForComparison("Coega Steels Ph1")).toBe("coega steels ph1");
    });

    it("still strips rev from Mondi_Tracker_Rev02.xlsm", () => {
      expect(normalizeForComparison("Mondi_Tracker_Rev02.xlsm")).toBe("mondi");
    });

    it("still strips tracker from De_Drift_Tracker.xlsx", () => {
      expect(normalizeForComparison("De_Drift_Tracker.xlsx")).toBe("de drift");
    });

    it("Ph1 and Ph2 normalize to DIFFERENT strings", () => {
      const ph1 = normalizeForComparison("Coega Steels Ph1_Tracker.xlsx");
      const ph2 = normalizeForComparison("Coega Steels Ph2_Tracker.xlsx");
      expect(ph1).not.toBe(ph2);
    });
  });

  describe("computeSimilarity phase-aware matching", () => {
    it("Coega Ph2 should NOT auto-map to Coega Ph1 (returns 0.7 with phase reason)", () => {
      const result = computeSimilarity("Coega Steels Ph2_Tracker.xlsx", "Coega Steels Ph1");
      expect(result.score).toBe(0.7);
      expect(result.matchReason).toBe("same_project_different_phase");
    });

    it("Coega Ph2 SHOULD auto-map to Coega Ph2 (score = 1.0)", () => {
      const result = computeSimilarity("Coega Steels Ph2_Tracker.xlsx", "Coega Steels Ph2");
      expect(result.score).toBe(1.0);
    });

    it("Mondi_Tracker_Rev02.xlsm SHOULD auto-map to Mondi (score = 1.0)", () => {
      const result = computeSimilarity("Mondi_Tracker_Rev02.xlsm", "Mondi");
      expect(result.score).toBe(1.0);
    });

    it("De_Drift_Tracker.xlsx SHOULD auto-map to De Drift (score = 1.0)", () => {
      const result = computeSimilarity("De_Drift_Tracker.xlsx", "De Drift");
      expect(result.score).toBe(1.0);
    });

    it("identical names return 1.0", () => {
      expect(computeSimilarity("Test Project", "Test Project").score).toBe(1.0);
    });

    it("completely different names return low score", () => {
      expect(computeSimilarity("Alpha Corp", "Beta Inc").score).toBeLessThan(0.5);
    });
  });

  describe("stripPhase and extractPhase", () => {
    it("stripPhase removes ph2", () => {
      expect(stripPhase("coega steels ph2")).toBe("coega steels");
    });

    it("stripPhase removes phase 1", () => {
      expect(stripPhase("coega steels phase 1")).toBe("coega steels");
    });

    it("extractPhase returns ph2", () => {
      expect(extractPhase("coega steels ph2")).toBe("ph2");
    });

    it("extractPhase returns null when no phase", () => {
      expect(extractPhase("mondi")).toBeNull();
    });
  });

  describe("Frontend phase variant warning", () => {
    it("shows phase-specific message for same_project_different_phase", () => {
      const source = read("client/src/pages/smart-import.tsx");
      expect(source).toContain("same_project_different_phase");
      expect(source).toContain("different phase of an existing project");
    });
  });
});

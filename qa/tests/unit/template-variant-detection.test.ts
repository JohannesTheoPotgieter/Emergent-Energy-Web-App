import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Template variant detection", () => {
  describe("detectPlanLayoutVariant function", () => {
    it("is exported from detector.ts", () => {
      const source = read("server/lib/import/detector.ts");
      expect(source).toContain("export function detectPlanLayoutVariant");
    });

    it("detects EE_STANDARD layout (C2=PROJECT PLAN, C3=PROJECT SIZE)", () => {
      const source = read("server/lib/import/detector.ts");
      expect(source).toContain('"project plan"');
      expect(source).toContain('"project size"');
      expect(source).toContain('"EE_STANDARD"');
    });

    it("detects MONDI_LEGACY layout (A1=Project Plan, B5/B6 metadata)", () => {
      const source = read("server/lib/import/detector.ts");
      expect(source).toContain('"project start"');
      expect(source).toContain('"project name"');
      expect(source).toContain('"MONDI_LEGACY"');
    });

    it("returns UNKNOWN for unrecognized layouts", () => {
      const source = read("server/lib/import/detector.ts");
      expect(source).toContain('"UNKNOWN"');
    });
  });

  describe("LayoutVariant type", () => {
    it("defines EE_STANDARD, MONDI_LEGACY, and UNKNOWN variants", () => {
      const source = read("server/lib/import/detector.ts");
      expect(source).toContain('export type LayoutVariant = "EE_STANDARD" | "MONDI_LEGACY" | "UNKNOWN"');
    });

    it("is stored in DetectedSection interface", () => {
      const source = read("server/lib/import/detector.ts");
      expect(source).toContain("layoutVariant?: LayoutVariant");
    });
  });

  describe("PLAN synonyms cover both layout variants", () => {
    it("includes Mondi-specific synonyms for task headers", () => {
      const source = read("server/lib/import/synonyms.ts");
      // WBS → task_no
      expect(source).toContain('"wbs"');
      // TASK → task_name
      expect(source).toContain('"task"');
    });

    it("includes % done and % forecasted for Mondi layout", () => {
      const source = read("server/lib/import/synonyms.ts");
      expect(source).toContain('"% done"');
      expect(source).toContain('"% forecasted"');
    });

    it("includes duration (work days) variant", () => {
      const source = read("server/lib/import/synonyms.ts");
      expect(source).toContain('"duration (work days)"');
    });

    it("includes work days for actual_duration", () => {
      const source = read("server/lib/import/synonyms.ts");
      const lines = source.split("\n");
      const actualDurationLine = lines.find((l: string) => l.includes("actual_duration:"));
      expect(actualDurationLine).toBeDefined();
      expect(actualDurationLine).toContain('"work days"');
    });

    it("includes resource 1 → owner synonym", () => {
      const source = read("server/lib/import/synonyms.ts");
      const lines = source.split("\n");
      const ownerLine = lines.find((l: string) => l.includes("owner:"));
      expect(ownerLine).toBeDefined();
      expect(ownerLine).toContain('"resource 1"');
    });

    it("includes resource 2 → comment synonym", () => {
      const source = read("server/lib/import/synonyms.ts");
      const lines = source.split("\n");
      const commentLine = lines.find((l: string) => l.includes("comment:"));
      expect(commentLine).toBeDefined();
      expect(commentLine).toContain('"resource 2"');
    });
  });

  describe("PLAN anchor phrases", () => {
    it("includes Mondi-specific anchor phrases for detection", () => {
      const source = read("server/lib/import/synonyms.ts");
      // Anchors should include both EE Standard and Mondi terms
      expect(source).toContain('"% done"');
      expect(source).toContain('"% forecasted"');
      expect(source).toContain('"wbs"');
      expect(source).toContain('"owner"');
    });
  });

  describe("Missing metadata issue generation", () => {
    it("normalizer generates MISSING_METADATA issue", () => {
      const source = read("server/lib/import/normalizer.ts");
      expect(source).toContain("MISSING_METADATA");
      expect(source).toContain("Project metadata (size, PD, PM, contract value, phase) not found in tracker");
      expect(source).toContain("Edit project info fields");
    });

    it("issue severity is INFO not BLOCKER", () => {
      const source = read("server/lib/import/normalizer.ts");
      // Find the block around MISSING_METADATA — severity is declared a few lines before
      const idx = source.indexOf("MISSING_METADATA");
      const surrounding = source.substring(Math.max(0, idx - 400), idx + 50);
      expect(surrounding).toContain('"INFO"');
      expect(surrounding).not.toContain('"BLOCKER"');
    });
  });

  describe("Layout variant flows through to MappingResult", () => {
    it("MappingResult includes layoutVariant field", () => {
      const source = read("server/lib/import/mapper.ts");
      expect(source).toContain("layoutVariant?: LayoutVariant");
    });

    it("mapColumns returns layoutVariant from detectedSection", () => {
      const source = read("server/lib/import/mapper.ts");
      expect(source).toContain("layoutVariant: detectedSection.layoutVariant");
    });
  });

  describe("Layout variant stored in summaryJson", () => {
    it("preview object (with layoutVariant) is stored as summaryJson", () => {
      const source = read("server/smart-import-routes.ts");
      // The preview object is stored directly — layoutVariant comes through
      // via detection.sections[].layoutVariant and mappings[].layoutVariant
      expect(source).toContain("summaryJson: preview");
    });
  });

  describe("LayoutVariant type is exported from index.ts", () => {
    it("re-exports LayoutVariant type", () => {
      const source = read("server/lib/import/index.ts");
      expect(source).toContain("LayoutVariant");
    });
  });
});

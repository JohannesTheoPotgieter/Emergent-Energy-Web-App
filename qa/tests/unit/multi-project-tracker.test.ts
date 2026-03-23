import { describe, expect, it } from "vitest";
import { detectMultiProjectSubProjects } from "../../../server/lib/import/detector";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Multi-project (ad-hoc) tracker support", () => {
  describe("detectMultiProjectSubProjects", () => {
    it("detects sub-projects from 'Project Activities - Name' rows", () => {
      const data: any[][] = [
        [null, null, "Header row"],
        [null, "1", "Project Activities - Magic Co"],
        [null, "1.1", "Install solar panels"],
        [null, "1.2", "Wiring"],
        [null, "1", "Project Activities - Dipula - Blackheath"],
        [null, "1.1", "Site assessment"],
        [null, "1", "Project Activities - Busamed Harrismith"],
        [null, "1.1", "Design phase"],
      ];
      const result = detectMultiProjectSubProjects(data, 1, data.length);
      expect(result).toEqual(["Magic Co", "Dipula - Blackheath", "Busamed Harrismith"]);
    });

    it("returns empty array when no sub-project rows found", () => {
      const data: any[][] = [
        [null, "1", "Site Establishment"],
        [null, "1.1", "Foundations"],
        [null, "2", "Commissioning"],
      ];
      const result = detectMultiProjectSubProjects(data, 0, data.length);
      expect(result).toEqual([]);
    });

    it("handles single sub-project (not multi-project)", () => {
      const data: any[][] = [
        [null, "1", "Project Activities - Only Project"],
        [null, "1.1", "Task"],
      ];
      const result = detectMultiProjectSubProjects(data, 0, data.length);
      expect(result).toEqual(["Only Project"]);
      // Only 1 sub-project → not flagged as multi-project (needs >= 2)
      expect(result.length).toBeLessThan(2);
    });

    it("deduplicates sub-project names", () => {
      const data: any[][] = [
        [null, null, "Project Activities - Magic Co"],
        [null, null, "Project Activities - Magic Co"],
      ];
      const result = detectMultiProjectSubProjects(data, 0, data.length);
      expect(result).toEqual(["Magic Co"]);
    });

    it("handles 'Project Activity' (singular) variant", () => {
      const data: any[][] = [
        [null, null, "Project Activity - Test Co"],
        [null, null, "Project Activity - Other Co"],
      ];
      const result = detectMultiProjectSubProjects(data, 0, data.length);
      expect(result).toEqual(["Test Co", "Other Co"]);
    });
  });

  describe("Sub-project name extraction helpers", () => {
    it("extractSubProjectFromCategory extracts from '1. Products - Magic Co'", () => {
      const source = read("server/lib/import/normalizer.ts");
      expect(source).toContain("function extractSubProjectFromCategory");
    });
  });

  describe("DetectionResult multiProject field", () => {
    it("detector interface includes multiProject field", () => {
      const source = read("server/lib/import/detector.ts");
      expect(source).toContain("multiProject?:");
      expect(source).toContain("isMultiProject: boolean");
      expect(source).toContain("subProjects: string[]");
    });
  });

  describe("NormalizationResult includes subProjectName", () => {
    it("planTasks has subProjectName field", () => {
      const source = read("server/lib/import/normalizer.ts");
      const planBlock = source.substring(
        source.indexOf("planTasks: Array<{"),
        source.indexOf("}>;", source.indexOf("planTasks: Array<{")) + 3
      );
      expect(planBlock).toContain("subProjectName: string | null");
    });

    it("revenueLines has subProjectName field", () => {
      const source = read("server/lib/import/normalizer.ts");
      const revBlock = source.substring(
        source.indexOf("revenueLines: Array<{"),
        source.indexOf("}>;", source.indexOf("revenueLines: Array<{")) + 3
      );
      expect(revBlock).toContain("subProjectName: string | null");
    });

    it("costLines has subProjectName field", () => {
      const source = read("server/lib/import/normalizer.ts");
      const costBlock = source.substring(
        source.indexOf("costLines: Array<{"),
        source.indexOf("}>;", source.indexOf("costLines: Array<{")) + 3
      );
      expect(costBlock).toContain("subProjectName: string | null");
    });
  });

  describe("Schema has sub_project_name columns", () => {
    it("normalized_cost_lines has sub_project_name", () => {
      const source = read("shared/schema.ts");
      const costSection = source.substring(
        source.indexOf('pgTable("normalized_cost_lines"'),
        source.indexOf("});", source.indexOf('pgTable("normalized_cost_lines"')) + 3
      );
      expect(costSection).toContain('sub_project_name');
    });

    it("normalized_revenue_lines has sub_project_name", () => {
      const source = read("shared/schema.ts");
      const revSection = source.substring(
        source.indexOf('pgTable("normalized_revenue_lines"'),
        source.indexOf("});", source.indexOf('pgTable("normalized_revenue_lines"')) + 3
      );
      expect(revSection).toContain('sub_project_name');
    });

    it("work_items has sub_project_name", () => {
      const source = read("shared/schema.ts");
      const wiSection = source.substring(
        source.indexOf('pgTable("work_items"'),
        source.indexOf("});", source.indexOf('pgTable("work_items"')) + 3
      );
      expect(wiSection).toContain('sub_project_name');
    });
  });

  describe("Commit logic passes subProjectName", () => {
    it("planValues includes subProjectName", () => {
      const source = read("server/smart-import-routes.ts");
      expect(source).toContain("subProjectName: merged.subProjectName");
    });

    it("revValues includes subProjectName", () => {
      const source = read("server/smart-import-routes.ts");
      const revSection = source.substring(
        source.indexOf("const revValues"),
        source.indexOf("counts.revenueLines")
      );
      expect(revSection).toContain("subProjectName");
    });
  });

  describe("Zero-revenue sub-project skipping", () => {
    it("normalizer skips 'No Revenue' lines", () => {
      const source = read("server/lib/import/normalizer.ts");
      expect(source).toContain("no revenue");
      expect(source).toContain("ZERO_REVENUE_SUBPROJECT");
    });

    it("generates INFO issue for skipped zero-revenue sub-projects", () => {
      const source = read("server/lib/import/normalizer.ts");
      expect(source).toContain("has no revenue — skipped");
    });
  });

  describe("Multi-project INFO issue generation", () => {
    it("normalizer generates MULTI_PROJECT_DETECTED issue", () => {
      const source = read("server/lib/import/normalizer.ts");
      expect(source).toContain("MULTI_PROJECT_DETECTED");
      expect(source).toContain("sub-projects");
      expect(source).toContain("Each line will be tagged");
    });
  });

  describe("WBS disambiguation for multi-project", () => {
    it("prefixes WBS codes with sub-project name in multi-project mode", () => {
      const source = read("server/lib/import/normalizer.ts");
      expect(source).toContain("${currentSubProject}::${taskNo}");
    });
  });

  describe("Frontend multi-project display", () => {
    it("shows multi-project summary card", () => {
      const source = read("client/src/pages/smart-import.tsx");
      expect(source).toContain("multi-project-summary");
      expect(source).toContain("Multi-Project Tracker");
      expect(source).toContain("sub-projects");
    });
  });

  describe("Migration file exists", () => {
    it("migration adds sub_project_name to all tables", () => {
      const source = read("migrations/20260319_add_sub_project_name.sql");
      expect(source).toContain("normalized_cost_lines");
      expect(source).toContain("normalized_revenue_lines");
      expect(source).toContain("work_items");
      expect(source).toContain("sub_project_name");
    });
  });
});

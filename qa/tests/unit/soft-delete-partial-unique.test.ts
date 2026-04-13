import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { projectInfo } from "../../../shared/schema/projects";
import { workItems } from "../../../shared/schema/tasks";

describe("Soft-delete partial unique indexes", () => {
  describe("projectInfo", () => {
    const config = getTableConfig(projectInfo);

    it("should NOT have a global unique constraint on projectName", () => {
      const col = config.columns.find((c) => c.name === "project_name");
      expect(col).toBeDefined();
      expect(col!.isUnique).toBe(false);
    });

    it("should have a partial unique index uq_project_info_project_name_active", () => {
      const idx = config.indexes.find(
        (i) => i.config.name === "uq_project_info_project_name_active"
      );
      expect(idx).toBeDefined();
      expect(idx!.config.where).toBeDefined();
    });
  });

  describe("workItems", () => {
    const config = getTableConfig(workItems);

    it("should NOT have a global unique constraint on externalRef", () => {
      const col = config.columns.find((c) => c.name === "external_ref");
      expect(col).toBeDefined();
      expect(col!.isUnique).toBe(false);
    });

    it("should have a partial unique index uq_work_items_external_ref_active", () => {
      const idx = config.indexes.find(
        (i) => i.config.name === "uq_work_items_external_ref_active"
      );
      expect(idx).toBeDefined();
      expect(idx!.config.where).toBeDefined();
    });
  });
});

/**
 * Document Management v2 (D6) — schema, validation, and migration shape.
 *
 * Pure unit tests — no DB. Validates that:
 *   1. The new schema tables export the expected types.
 *   2. Insert schemas reject invalid disciplines / approver roles / regexes.
 *   3. The permission registry has the new documents entities wired up.
 *   4. Migration 0038 contains the FK constraints we declared.
 *   5. The migration journal has every SQL file in /migrations referenced.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  folderTaxonomy,
  projectFolders,
  documentApprovalRequirements,
  managedDocuments,
  insertFolderTaxonomySchema,
  insertDocumentApprovalRequirementSchema,
  FOLDER_LIFECYCLE_MODES,
} from "@shared/schema/documents";
import { ENTITY_REGISTRY } from "@shared/permissions/registry";
import { LIFECYCLE_DEPARTMENTS } from "@shared/schema/stage-lifecycle";
import { COMPANY_ROLES } from "@shared/schema/users";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const migrationPath = path.join(repoRoot, "migrations", "0038_document_management_v2_taxonomy.sql");
const journalPath = path.join(repoRoot, "migrations", "meta", "_journal.json");

describe("D6 schema — table shapes", () => {
  it("exports the four canonical tables", () => {
    expect(folderTaxonomy).toBeDefined();
    expect(projectFolders).toBeDefined();
    expect(documentApprovalRequirements).toBeDefined();
    expect(managedDocuments).toBeDefined();
  });

  it("exposes lifecycle modes that match the migration enum", () => {
    expect(FOLDER_LIFECYCLE_MODES).toEqual(["pre_construction", "full_lifecycle", "both"]);
  });
});

describe("D6 schema — insertFolderTaxonomySchema validation", () => {
  const baseValid = {
    internalKey: "07_construction",
    displayName: "07_Construction",
    parentKey: null,
    lifecycleMode: "full_lifecycle" as const,
    stageCode: "S06_CONSTRUCTION",
    disciplines: ["ENGINEERING", "CONSTRUCTION", "QUALITY"],
    description: null,
    sortOrder: 70,
    active: true,
  };

  it("accepts a well-formed row", () => {
    const result = insertFolderTaxonomySchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it("rejects an internalKey with disallowed characters", () => {
    const result = insertFolderTaxonomySchema.safeParse({
      ...baseValid,
      internalKey: "07 Construction!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects disciplines values that aren't in LIFECYCLE_DEPARTMENTS", () => {
    const result = insertFolderTaxonomySchema.safeParse({
      ...baseValid,
      disciplines: ["ENGINEERING", "NOT_A_REAL_DEPARTMENT"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts every actual LIFECYCLE_DEPARTMENT value", () => {
    const result = insertFolderTaxonomySchema.safeParse({
      ...baseValid,
      disciplines: [...LIFECYCLE_DEPARTMENTS],
    });
    expect(result.success).toBe(true);
  });

  it("requires lifecycleMode", () => {
    const { lifecycleMode: _omit, ...withoutMode } = baseValid;
    const result = insertFolderTaxonomySchema.safeParse(withoutMode);
    expect(result.success).toBe(false);
  });
});

describe("D6 schema — insertDocumentApprovalRequirementSchema validation", () => {
  const baseValid = {
    taxonomyKey: "pre_cost_proposal/cp_costing",
    fileNamePattern: "^costing.*\\.xlsx$",
    displayName: "Costing Excel",
    description: null,
    approverRoles: ["CEO_ADMIN"],
    requiresAllApprovers: false,
    extractSpec: { sheetName: "Summary", cells: { revenue: "B12", cos: "B14" } },
    active: true,
    sortOrder: 0,
  };

  it("accepts a well-formed row", () => {
    const result = insertDocumentApprovalRequirementSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it("rejects empty approverRoles", () => {
    const result = insertDocumentApprovalRequirementSchema.safeParse({
      ...baseValid,
      approverRoles: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects approverRoles values that aren't in COMPANY_ROLES", () => {
    const result = insertDocumentApprovalRequirementSchema.safeParse({
      ...baseValid,
      approverRoles: ["CEO_ADMIN", "NOT_A_ROLE"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts every actual COMPANY_ROLES value", () => {
    const result = insertDocumentApprovalRequirementSchema.safeParse({
      ...baseValid,
      approverRoles: [...COMPANY_ROLES],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid regex", () => {
    const result = insertDocumentApprovalRequirementSchema.safeParse({
      ...baseValid,
      fileNamePattern: "*invalid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a null fileNamePattern (means any file in the folder)", () => {
    const result = insertDocumentApprovalRequirementSchema.safeParse({
      ...baseValid,
      fileNamePattern: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("D6 permissions — registry entries", () => {
  it("registers the documents, documents_provision, and documents_admin entities", () => {
    const entities = ENTITY_REGISTRY.map((r) => r.entity);
    expect(entities).toContain("documents");
    expect(entities).toContain("documents_provision");
    expect(entities).toContain("documents_admin");
  });

  it("documents_provision defaults to COO/CEO only at create level", () => {
    const entry = ENTITY_REGISTRY.find((r) => r.entity === "documents_provision");
    expect(entry).toBeDefined();
    expect(entry!.create_roles.sort()).toEqual(["CEO_ADMIN", "COO_ADMIN"].sort());
  });

  it("documents has all roles in view, but only super-users can override", () => {
    const entry = ENTITY_REGISTRY.find((r) => r.entity === "documents");
    expect(entry).toBeDefined();
    expect(entry!.view_roles.length).toBeGreaterThan(8);
    expect(entry!.override_roles.sort()).toEqual(["CEO_ADMIN", "COO_ADMIN"].sort());
  });
});

describe("D6 migration 0038 — SQL shape", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("creates folder_taxonomy with a unique constraint on internal_key", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "folder_taxonomy"/);
    expect(sql).toMatch(/folder_taxonomy_internal_key_uq/);
  });

  it("creates the folder_lifecycle_mode_enum type with the right values", () => {
    expect(sql).toMatch(/CREATE TYPE "folder_lifecycle_mode_enum"/);
    expect(sql).toMatch(/'pre_construction'.*'full_lifecycle'.*'both'/s);
  });

  it("declares a self-referential FK on folder_taxonomy.parent_key", () => {
    expect(sql).toMatch(/folder_taxonomy_parent_fk[\s\S]*FOREIGN KEY \("parent_key"\)/);
  });

  it("declares an FK from folder_taxonomy.stage_code to stage_definitions.stage_code", () => {
    expect(sql).toMatch(/folder_taxonomy_stage_fk[\s\S]*REFERENCES "stage_definitions"\("stage_code"\)/);
  });

  it("declares an FK from project_folders.project_id to project_info.id (CASCADE)", () => {
    expect(sql).toMatch(/project_folders_project_fk[\s\S]*REFERENCES "project_info"\("id"\) ON DELETE CASCADE/);
  });

  it("declares an FK from project_folders.taxonomy_key to folder_taxonomy.internal_key", () => {
    expect(sql).toMatch(/project_folders_taxonomy_fk[\s\S]*REFERENCES "folder_taxonomy"\("internal_key"\)/);
  });

  it("declares the project_folders unique index on (project_id, taxonomy_key)", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "project_folders_project_taxonomy_uq"/);
  });

  it("declares the FK from managed_documents.parent_folder_id to project_folders.id (SET NULL)", () => {
    expect(sql).toMatch(
      /managed_documents_parent_folder_fk[\s\S]*REFERENCES "project_folders"\("id"\) ON DELETE SET NULL/,
    );
  });

  it("uses ADD COLUMN IF NOT EXISTS for managed_documents.parent_folder_id (additive guarantee)", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "parent_folder_id"/);
  });
});

describe("D6 — migration journal integrity", () => {
  it("registers every .sql file in /migrations as a journal entry (no drift)", () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag?: string }>;
    };
    const tracked = new Set(journal.entries.map((e) => `${e.tag ?? ""}.sql`));
    const onDisk = fs
      .readdirSync(path.join(repoRoot, "migrations"))
      .filter((f) => f.endsWith(".sql"));
    const untracked = onDisk.filter((f) => !tracked.has(f));
    expect(untracked).toEqual([]);
  });

  it("includes a journal entry for migration 0038", () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag?: string }>;
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0038_document_management_v2_taxonomy");
  });
});

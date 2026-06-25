/**
 * Document Management v2 (D6) — schema, validation, and migration shape.
 *
 * Pure unit tests — no DB. Validates that:
 *   1. The surviving schema tables export the expected types.
 *   2. The approval-requirement insert schema validates approver roles /
 *      regexes and accepts both bases (legacy taxonomyKey OR discipline).
 *   3. The permission registry has the documents entities wired up.
 *   4. The Phase 5 migrations declare the browse-and-bind discipline surface
 *      and drop the legacy folder-taxonomy / parent_folder_id surface.
 *   5. The migration journal references every SQL file in /migrations.
 *
 * PHASE 5 DECOMMISSION: the legacy `folder_taxonomy` + `project_folders`
 * tables, `managed_documents.parent_folder_id`, the
 * `folder_lifecycle_mode_enum`, and their exports/schemas were removed. The
 * sole project document surface is now browse-and-bind discipline folders
 * (`project_discipline_folders` + `managed_documents.discipline_folder_id` +
 * discipline-based `document_approval_requirements`).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  projectDisciplineFolders,
  documentApprovalRequirements,
  managedDocuments,
  insertDocumentApprovalRequirementSchema,
} from "@shared/schema/documents";
import { ENTITY_REGISTRY } from "@shared/permissions/registry";
import { COMPANY_ROLES } from "@shared/schema/users";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const journalPath = path.join(repoRoot, "migrations", "meta", "_journal.json");

describe("D6 schema — table shapes (post Phase 5)", () => {
  it("exports the surviving canonical tables", () => {
    expect(managedDocuments).toBeDefined();
    expect(documentApprovalRequirements).toBeDefined();
    expect(projectDisciplineFolders).toBeDefined();
  });

  it("managed_documents carries discipline_folder_id and NOT parent_folder_id", () => {
    const cols = Object.keys(managedDocuments);
    expect(cols).toContain("disciplineFolderId");
    expect(cols).not.toContain("parentFolderId");
  });

  it("document_approval_requirements keeps taxonomyKey (dormant) and adds discipline", () => {
    const cols = Object.keys(documentApprovalRequirements);
    expect(cols).toContain("taxonomyKey");
    expect(cols).toContain("discipline");
  });

  it("the retired folder-taxonomy exports are gone from the documents schema barrel", async () => {
    const mod = (await import("@shared/schema/documents")) as Record<string, unknown>;
    for (const sym of [
      "folderTaxonomy",
      "projectFolders",
      "insertFolderTaxonomySchema",
      "FOLDER_LIFECYCLE_MODES",
      "folderLifecycleModeEnum",
    ]) {
      expect(mod[sym]).toBeUndefined();
    }
  });
});

describe("D6 schema — insertDocumentApprovalRequirementSchema validation", () => {
  // Browse-and-bind basis: a discipline + filename pattern.
  const baseValid = {
    discipline: "FINANCE" as const,
    subfolderPattern: "^cost",
    fileNamePattern: "^costing.*\\.xlsx$",
    displayName: "Costing Excel",
    description: null,
    approverRoles: ["CEO_ADMIN"],
    requiresAllApprovers: false,
    extractSpec: { sheetName: "Summary", cells: { revenue: "B12", cos: "B14" } },
    active: true,
    sortOrder: 0,
  };

  it("accepts a well-formed discipline-based row", () => {
    const result = insertDocumentApprovalRequirementSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it("accepts a legacy taxonomyKey-based row (retained for dormant rows)", () => {
    const { discipline: _omit, ...rest } = baseValid;
    const result = insertDocumentApprovalRequirementSchema.safeParse({
      ...rest,
      taxonomyKey: "pre_cost_proposal/cp_costing",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a discipline value that isn't a LIFECYCLE_DEPARTMENT", () => {
    const result = insertDocumentApprovalRequirementSchema.safeParse({
      ...baseValid,
      discipline: "NOT_A_REAL_DEPARTMENT",
    });
    expect(result.success).toBe(false);
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

  it("documents_provision defaults to COO/CEO only at the mutating (edit) level", () => {
    // Collapsed model: create folded into edit. documents_provision stays
    // super-user-only — its edit_roles is exactly the admin pair.
    const entry = ENTITY_REGISTRY.find((r) => r.entity === "documents_provision");
    expect(entry).toBeDefined();
    expect(entry!.edit_roles.sort()).toEqual(["CEO_ADMIN", "COO_ADMIN"].sort());
    expect((entry as { create_roles?: string[] }).create_roles).toBeUndefined();
  });

  it("documents has all roles in view, and edit_roles is the de-duplicated mutator union", () => {
    // Collapsed model: there is no override_roles surface — override folded
    // into edit. The old "only super-users can override" invariant no longer
    // holds: documents:edit is a BROAD set (the de-duplicated union of the old
    // create/edit/approve/override/delete lists), so most delivery roles can
    // now mutate documents. Assert the exact edit_roles set so the broadening
    // is pinned rather than silently widened further.
    const entry = ENTITY_REGISTRY.find((r) => r.entity === "documents");
    expect(entry).toBeDefined();
    expect(entry!.view_roles.length).toBeGreaterThan(8);
    expect((entry as { override_roles?: string[] }).override_roles).toBeUndefined();
    expect(entry!.edit_roles.sort()).toEqual(
      [
        "COO_ADMIN",
        "CEO_ADMIN",
        "CCO",
        "PROGRAM_MANAGER",
        "PROGRAM_FINANCE_MANAGER",
        "CONSTRUCTION_MANAGER",
        "QUALITY_MANAGER",
        "ENGINEERING_MANAGER",
        "PROJECT_MANAGER_SITE",
        "PROJECT_DEVELOPER",
        "HSE_MANAGER",
        "ENGINEER",
        "CFO",
      ].sort(),
    );
  });
});

describe("D6 Phase 5 — browse-and-bind migration shape", () => {
  const disciplineFolders = fs.readFileSync(
    path.join(repoRoot, "migrations", "0112_project_discipline_folders.sql"),
    "utf8",
  );
  const approvalBasis = fs.readFileSync(
    path.join(repoRoot, "migrations", "0113_discipline_approval_basis.sql"),
    "utf8",
  );
  const phase5Drop = fs.readFileSync(
    path.join(repoRoot, "migrations", "0114_phase5_drop_folder_taxonomy.sql"),
    "utf8",
  );

  it("creates project_discipline_folders with the (project_id, discipline) unique index", () => {
    expect(disciplineFolders).toMatch(/CREATE TABLE "project_discipline_folders"/);
    expect(disciplineFolders).toMatch(
      /CREATE UNIQUE INDEX "project_discipline_folders_project_discipline_uq"/,
    );
  });

  it("declares the project_discipline_folders FK to project_info (CASCADE)", () => {
    expect(disciplineFolders).toMatch(
      /project_discipline_folders_project_id_project_info_id_fk[\s\S]*REFERENCES "public"\."project_info"\("id"\) ON DELETE cascade/,
    );
  });

  it("adds discipline_folder_id to managed_documents with an FK to project_discipline_folders (SET NULL)", () => {
    expect(approvalBasis).toMatch(/ALTER TABLE "managed_documents" ADD COLUMN "discipline_folder_id" integer/);
    expect(approvalBasis).toMatch(
      /managed_documents_discipline_folder_id_project_discipline_folders_id_fk[\s\S]*REFERENCES "public"\."project_discipline_folders"\("id"\) ON DELETE set null/,
    );
  });

  it("adds the discipline basis to document_approval_requirements (discipline + subfolder pattern)", () => {
    expect(approvalBasis).toMatch(/ALTER TABLE "document_approval_requirements" ADD COLUMN "discipline" text/);
    expect(approvalBasis).toMatch(/ALTER TABLE "document_approval_requirements" ADD COLUMN "subfolder_pattern" text/);
    // taxonomy_key is retained as a plain nullable column (dormant legacy rows).
    expect(approvalBasis).toMatch(/ALTER TABLE "document_approval_requirements" ALTER COLUMN "taxonomy_key" DROP NOT NULL/);
  });

  it("Phase 5 drop removes parent_folder_id + the folder-taxonomy surface", () => {
    expect(phase5Drop).toMatch(/ALTER TABLE "managed_documents" DROP COLUMN IF EXISTS "parent_folder_id"/);
    expect(phase5Drop).toMatch(/DROP TABLE IF EXISTS "project_folders" CASCADE/);
    expect(phase5Drop).toMatch(/DROP TABLE IF EXISTS "folder_taxonomy" CASCADE/);
    expect(phase5Drop).toMatch(/DROP TYPE IF EXISTS "public"\."folder_lifecycle_mode_enum"/);
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

  it("includes the Phase 5 browse-and-bind + drop journal entries", () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag?: string }>;
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0112_project_discipline_folders");
    expect(tags).toContain("0113_discipline_approval_basis");
    expect(tags).toContain("0114_phase5_drop_folder_taxonomy");
  });
});

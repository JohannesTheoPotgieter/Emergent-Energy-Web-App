import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("document permission entities — bridge guard", () => {
  const registry = read("shared/permissions/registry.ts");

  it("declares documents, documents_provision, and documents_admin entities", () => {
    expect(registry).toMatch(/entity:\s*'documents'/);
    expect(registry).toMatch(/entity:\s*'documents_provision'/);
    expect(registry).toMatch(/entity:\s*'documents_admin'/);
  });
});

describe("document migration safety — non-destructive guard", () => {
  // controlled_documents + controlled_document_types + project_sharepoint_roots
  // (drop_controlled_documents) and folder_taxonomy + project_folders (Phase 5
  // 0114_phase5_drop_folder_taxonomy) were intentionally dropped; this guard
  // protects the CURRENT document tables from accidental drops.
  const CURRENT_DOC_TABLES = [
    "managed_documents",
    "company_sharepoint_roots",
    "project_discipline_folders",
    "document_approval_requirements",
  ];

  it("contains no DROP TABLE targeting legacy/bridge document tables", () => {
    const migrationsDir = path.join(process.cwd(), "migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

    const offenders: string[] = [];

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8").toLowerCase();
      for (const table of CURRENT_DOC_TABLES) {
        const dropRe = new RegExp(`drop\\s+table(?:\\s+if\\s+exists)?\\s+[^;]*\\b${table}\\b`, "i");
        if (dropRe.test(sql)) offenders.push(`${file}:${table}`);
      }
    }

    expect(offenders, `Found destructive document-table migration statements: ${offenders.join(", ")}`).toEqual([]);
  });
});

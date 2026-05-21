import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("project document migration contract", () => {
  it("creates SharePoint document foundation tables before project document links", () => {
    const sql = readRepoFile("migrations/0068_project_document_links.sql");

    const companyRootsIndex = sql.indexOf('CREATE TABLE IF NOT EXISTS "company_sharepoint_roots"');
    const projectRootsIndex = sql.indexOf('CREATE TABLE IF NOT EXISTS "project_sharepoint_roots"');
    const managedDocumentsIndex = sql.indexOf('CREATE TABLE IF NOT EXISTS "managed_documents"');
    const projectLinksIndex = sql.indexOf("CREATE TABLE IF NOT EXISTS project_document_links");

    expect(companyRootsIndex).toBeGreaterThanOrEqual(0);
    expect(projectRootsIndex).toBeGreaterThanOrEqual(0);
    expect(managedDocumentsIndex).toBeGreaterThanOrEqual(0);
    expect(projectLinksIndex).toBeGreaterThan(managedDocumentsIndex);
  });

  it("registers the migration with the Drizzle bootstrap probe", () => {
    const journal = JSON.parse(readRepoFile("migrations/meta/_journal.json")) as {
      entries: Array<{ tag: string }>;
    };
    const bootstrap = readRepoFile("scripts/drizzle-bootstrap.ts");

    expect(journal.entries.some((entry) => entry.tag === "0068_project_document_links")).toBe(true);
    expect(bootstrap).toContain('"0068_project_document_links"');
    expect(bootstrap).toContain('tableExists(c, "project_document_links")');
  });

  it("keeps the SQLite development bootstrap aligned with document tables", () => {
    const sqliteBootstrap = readRepoFile("server/db.ts");

    expect(sqliteBootstrap).toContain("CREATE TABLE IF NOT EXISTS company_sharepoint_roots");
    expect(sqliteBootstrap).toContain("CREATE TABLE IF NOT EXISTS project_sharepoint_roots");
    expect(sqliteBootstrap).toContain("CREATE TABLE IF NOT EXISTS managed_documents");
    expect(sqliteBootstrap).toContain("CREATE TABLE IF NOT EXISTS project_document_links");
  });

  it("loads local environment variables before running database migrations", () => {
    expect(readRepoFile("drizzle.config.ts")).toContain('import "dotenv/config"');
    expect(readRepoFile("scripts/drizzle-bootstrap.ts")).toContain('import "dotenv/config"');
  });
});

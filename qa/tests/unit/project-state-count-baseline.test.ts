/**
 * Baseline harness for markProjectsActive + getProjectCounts.
 *
 * PURPOSE: Lock down the behavioral invariants of the project-state/count
 * cluster before extraction into a repository.
 *
 * In-scope methods:
 *   - markProjectsActive(activeNames: string[])  (server/storage.ts)
 *   - getProjectCounts()                          (server/storage.ts)
 *
 * These tests are source-structural: they read the implementation source and
 * assert that critical contracts have not drifted.  They do NOT require
 * a running database or mocks.
 *
 * After extraction, these tests verify the invariants hold in the new locations.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const STORAGE_PATH = path.join(process.cwd(), "server/storage.ts");
const SCHEMA_PATH = path.join(process.cwd(), "shared/schema/projects.ts");
const CONSUMER_PATH = path.join(
  process.cwd(),
  "server/routes/imports-admin-extracted-routes.ts",
);

const storageSource = fs.readFileSync(STORAGE_PATH, "utf8");
const schemaSource = fs.readFileSync(SCHEMA_PATH, "utf8");
const consumerSource = fs.readFileSync(CONSUMER_PATH, "utf8");

// ────────────────────────────────────────────────────────
// SECTION 1 — markProjectsActive: method structure
// ────────────────────────────────────────────────────────

describe("markProjectsActive — method structure", () => {
  // Extract the method body for targeted assertions
  const methodStart = storageSource.indexOf(
    "async markProjectsActive(activeNames: string[])",
  );
  const methodBlock = storageSource.slice(methodStart, methodStart + 1200);

  it("exists as a public method on DatabaseStorage", () => {
    expect(methodStart).toBeGreaterThan(-1);
  });

  it("declares correct signature: (activeNames: string[]) => Promise<void>", () => {
    expect(storageSource).toContain(
      "async markProjectsActive(activeNames: string[]): Promise<void>",
    );
  });

  it("early-returns on empty array input", () => {
    expect(methodBlock).toContain("if (activeNames.length === 0) return;");
  });

  it("is declared in the IStorage interface", () => {
    expect(storageSource).toContain(
      "markProjectsActive(activeNames: string[]): Promise<void>",
    );
  });
});

// ────────────────────────────────────────────────────────
// SECTION 2 — markProjectsActive: projectInfo table writes (post-remediation)
// ────────────────────────────────────────────────────────

describe("markProjectsActive — projectInfo table writes (post-remediation)", () => {
  const methodStart = storageSource.indexOf(
    "async markProjectsActive(activeNames: string[])",
  );
  const methodBlock = storageSource.slice(methodStart, methodStart + 1500);

  it("touches updatedAt on projectInfo for active projects", () => {
    expect(methodBlock).toContain(".update(projectInfo)");
    expect(methodBlock).toContain("updatedAt: new Date()");
    expect(methodBlock).toContain(
      "inArray(projectInfo.projectName, activeNames)",
    );
  });

  it("does NOT set isActive on projectInfo (column dropped in migration 20260337)", () => {
    // After remediation: only updatedAt is set on projectInfo.
    // The .set() call should contain ONLY updatedAt, not isActive.
    const setCallStart = methodBlock.indexOf(".set({ updatedAt: new Date() })");
    expect(setCallStart).toBeGreaterThan(-1);
    // The actual .set() invocation uses only updatedAt — no isActive key
    // (The word "isActive" appears in explanatory comments but not in .set() calls)
    expect(methodBlock).not.toContain(".set({ isActive: true");
    expect(methodBlock).not.toContain(".set({ isActive: false");
  });

  it("does NOT update projectInfo for non-active projects (no second Drizzle update)", () => {
    // Previously there was a second .update(projectInfo).set({ isActive: false })
    // that targeted all non-matching rows. That was dead code (empty SET clause
    // at runtime) and has been removed.
    const drizzleUpdates = methodBlock.split(".update(projectInfo)").length - 1;
    expect(drizzleUpdates).toBe(1);
  });

  it("documents the migration that dropped is_active from project_info", () => {
    expect(methodBlock).toContain("migration 20260337");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 3 — markProjectsActive: dual-write to project_execution_state
// ────────────────────────────────────────────────────────

describe("markProjectsActive — dual-write to project_execution_state", () => {
  const methodStart = storageSource.indexOf(
    "async markProjectsActive(activeNames: string[])",
  );
  const methodBlock = storageSource.slice(methodStart, methodStart + 1500);

  it("contains deprecation comment referencing 2026-03-31 observation window", () => {
    expect(methodBlock).toContain("deprecated 2026-03-31");
  });

  it("documents project_execution_state as sole source of truth", () => {
    expect(methodBlock).toContain("project_execution_state is the sole source of truth");
  });

  it("uses raw SQL for project_execution_state updates (not Drizzle ORM)", () => {
    expect(methodBlock).toContain("this.dbInstance.execute(sql`");
    expect(methodBlock).toContain("UPDATE project_execution_state");
  });

  it("sets active rows: deleted_at=NULL, is_active=true, updated_at=NOW()", () => {
    expect(methodBlock).toContain(
      "SET deleted_at = NULL, is_active = true, updated_at = NOW()",
    );
  });

  it("uses ANY() PostgreSQL operator for active-set matching", () => {
    expect(methodBlock).toContain("project_name = ANY(${activeNames})");
  });

  it("sets inactive rows: deleted_at=NOW(), is_active=false, updated_at=NOW()", () => {
    expect(methodBlock).toContain(
      "SET deleted_at = NOW(), is_active = false, updated_at = NOW()",
    );
  });

  it("uses != ALL() PostgreSQL operator for inactive-set matching", () => {
    expect(methodBlock).toContain("project_name != ALL(${activeNames})");
  });

  it("only archives rows where deleted_at IS NULL (idempotent guard)", () => {
    // The inactive-set raw SQL includes AND deleted_at IS NULL
    expect(methodBlock).toContain("AND deleted_at IS NULL");
  });

  it("uses subquery to resolve project_id from project_info by name", () => {
    expect(methodBlock).toContain(
      "SELECT id FROM project_info WHERE project_name",
    );
  });
});

// ────────────────────────────────────────────────────────
// SECTION 4 — markProjectsActive: PostgreSQL-specific SQL
// ────────────────────────────────────────────────────────

describe("markProjectsActive — PostgreSQL-specific behavior", () => {
  const methodStart = storageSource.indexOf(
    "async markProjectsActive(activeNames: string[])",
  );
  const methodBlock = storageSource.slice(methodStart, methodStart + 1500);

  it("uses NOW() which is PostgreSQL/standard SQL (not SQLite compatible)", () => {
    expect(methodBlock).toContain("NOW()");
  });

  it("uses ANY() array comparison (PostgreSQL-specific, not portable to SQLite)", () => {
    expect(methodBlock).toContain("= ANY(");
  });

  it("uses != ALL() array comparison (PostgreSQL-specific, not portable to SQLite)", () => {
    expect(methodBlock).toContain("!= ALL(");
  });

  it("relies on 3 sequential database operations (no transaction wrapper)", () => {
    // 1x Drizzle update (projectInfo.updatedAt) + 2x raw SQL (project_execution_state)
    const dbCalls = methodBlock.split("this.dbInstance").length - 1;
    expect(dbCalls).toBe(3);
  });
});

// ────────────────────────────────────────────────────────
// SECTION 5 — getProjectCounts: method structure
// ────────────────────────────────────────────────────────

describe("getProjectCounts — method structure", () => {
  it("exists as a public method on DatabaseStorage", () => {
    expect(storageSource).toContain("async getProjectCounts()");
  });

  it("returns { active, historical, total } (not 'archived')", () => {
    expect(storageSource).toContain(
      "Promise<{ active: number; historical: number; total: number }>",
    );
  });

  it("is declared in the IStorage interface with matching return type", () => {
    // The interface line should be above the implementation
    const interfaceDecl =
      "getProjectCounts(): Promise<{ active: number; historical: number; total: number }>";
    expect(storageSource).toContain(interfaceDecl);
  });
});

// ────────────────────────────────────────────────────────
// SECTION 6 — getProjectCounts: query semantics
// ────────────────────────────────────────────────────────

describe("getProjectCounts — query semantics", () => {
  const methodStart = storageSource.indexOf("async getProjectCounts()");
  const methodBlock = storageSource.slice(methodStart, methodStart + 600);

  it("counts active via LEFT JOIN with projectExecutionState on projectId", () => {
    expect(methodBlock).toContain(
      ".leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))",
    );
  });

  it("defines 'active' as deletedAt IS NULL on project_execution_state", () => {
    expect(methodBlock).toContain(
      ".where(isNull(projectExecutionState.deletedAt))",
    );
  });

  it("counts total from projectInfo only (no join, no filter)", () => {
    // Second query: .from(projectInfo) with NO where clause
    expect(methodBlock).toContain(
      ".select({ count: count() })\n      .from(projectInfo);",
    );
  });

  it("computes 'historical' as (total - active), not via separate query", () => {
    expect(methodBlock).toContain("historical: total - active");
  });

  it("defaults active count to 0 if result is null/undefined", () => {
    expect(methodBlock).toContain("activeResult?.count || 0");
  });

  it("defaults total count to 0 if result is null/undefined", () => {
    expect(methodBlock).toContain("totalResult?.count || 0");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 7 — getProjectCounts: LEFT JOIN edge cases
// ────────────────────────────────────────────────────────

describe("getProjectCounts — LEFT JOIN behavior (active count)", () => {
  const methodStart = storageSource.indexOf("async getProjectCounts()");
  const methodBlock = storageSource.slice(methodStart, methodStart + 600);

  it("uses LEFT JOIN (projects without execution_state rows are included)", () => {
    // LEFT JOIN means: if a project_info row has no matching
    // project_execution_state row, deletedAt will be NULL
    // => that project counts as active
    expect(methodBlock).toContain(".leftJoin(");
    expect(methodBlock).not.toContain(".innerJoin(");
  });

  it("active count includes projects with NO execution_state row (orphans counted as active)", () => {
    // This is a behavioral invariant: LEFT JOIN + isNull(deletedAt)
    // means a project_info row with no execution_state row
    // will have deletedAt = NULL => counted as active
    // This is intentional — new projects have no execution_state row yet
    expect(methodBlock).toContain("isNull(projectExecutionState.deletedAt)");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 8 — coupling between markProjectsActive and getProjectCounts
// ────────────────────────────────────────────────────────

describe("markProjectsActive ↔ getProjectCounts — semantic coupling", () => {
  it("markProjectsActive writes to project_execution_state.deleted_at", () => {
    const methodStart = storageSource.indexOf(
      "async markProjectsActive(activeNames: string[])",
    );
    const methodBlock = storageSource.slice(methodStart, methodStart + 1500);
    expect(methodBlock).toContain("SET deleted_at = NULL");
    expect(methodBlock).toContain("SET deleted_at = NOW()");
  });

  it("getProjectCounts reads project_execution_state.deletedAt via isNull()", () => {
    const methodStart = storageSource.indexOf("async getProjectCounts()");
    const methodBlock = storageSource.slice(methodStart, methodStart + 600);
    expect(methodBlock).toContain(
      "isNull(projectExecutionState.deletedAt)",
    );
  });

  it("both methods agree on deleted_at as the active/inactive signal", () => {
    // markProjectsActive: active => deleted_at = NULL
    // getProjectCounts:   active => deletedAt IS NULL
    // These are semantically coupled — extraction must preserve both
    const markStart = storageSource.indexOf(
      "async markProjectsActive(activeNames: string[])",
    );
    const markBlock = storageSource.slice(markStart, markStart + 1500);
    const countStart = storageSource.indexOf("async getProjectCounts()");
    const countBlock = storageSource.slice(countStart, countStart + 600);

    // Write side sets deleted_at = NULL for active
    expect(markBlock).toContain("deleted_at = NULL");
    // Read side checks isNull(deletedAt)
    expect(countBlock).toContain("isNull(projectExecutionState.deletedAt)");
  });

  it("markProjectsActive writes isActive boolean only via raw SQL (deprecated dual-write)", () => {
    const methodStart = storageSource.indexOf(
      "async markProjectsActive(activeNames: string[])",
    );
    const methodBlock = storageSource.slice(methodStart, methodStart + 1500);
    // After remediation: isActive is only in the raw SQL path, not the Drizzle path
    expect(methodBlock).toContain("is_active = true");
    expect(methodBlock).toContain("is_active = false");
  });

  it("getProjectCounts does NOT read isActive — uses only deletedAt", () => {
    const countStart = storageSource.indexOf("async getProjectCounts()");
    const countBlock = storageSource.slice(countStart, countStart + 600);
    expect(countBlock).not.toContain("isActive");
    expect(countBlock).not.toContain("is_active");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 9 — schema validation: projectInfo table
// ────────────────────────────────────────────────────────

describe("schema — projectInfo table shape", () => {
  it("projectInfo is defined as pgTable('project_info')", () => {
    expect(schemaSource).toContain('pgTable("project_info"');
  });

  it("has projectName column (text, unique, notNull)", () => {
    expect(schemaSource).toContain(
      'projectName: text("project_name").notNull().unique()',
    );
  });

  it("has updatedAt column with defaultNow()", () => {
    expect(schemaSource).toContain(
      'updatedAt: timestamp("updated_at").notNull().defaultNow()',
    );
  });

  it("has deletedAt column (nullable timestamp)", () => {
    expect(schemaSource).toContain('deletedAt: timestamp("deleted_at")');
  });

  it("does NOT have isActive column (dropped in migration 20260337)", () => {
    // After 20260337_drop_moved_columns_project_info.sql, is_active
    // was removed from project_info. Only project_execution_state has it.
    const tableStart = schemaSource.indexOf('pgTable("project_info"');
    const tableEnd = schemaSource.indexOf("});", tableStart);
    const tableBlock = schemaSource.slice(tableStart, tableEnd);
    expect(tableBlock).not.toContain("isActive");
    expect(tableBlock).not.toContain("is_active");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 10 — schema validation: projectExecutionState table
// ────────────────────────────────────────────────────────

describe("schema — projectExecutionState table shape", () => {
  it("projectExecutionState is defined as pgTable('project_execution_state')", () => {
    expect(schemaSource).toContain('pgTable("project_execution_state"');
  });

  it("has projectId FK to projectInfo.id with ON DELETE CASCADE", () => {
    expect(schemaSource).toContain("onDelete: \"cascade\"");
  });

  it("has isActive boolean column (deprecated)", () => {
    const pesStart = schemaSource.indexOf('pgTable("project_execution_state"');
    const pesBlock = schemaSource.slice(pesStart, pesStart + 2000);
    expect(pesBlock).toContain('isActive: boolean("is_active")');
  });

  it("has deletedAt timestamp column", () => {
    const pesStart = schemaSource.indexOf('pgTable("project_execution_state"');
    const pesBlock = schemaSource.slice(pesStart, pesStart + 2000);
    expect(pesBlock).toContain('deletedAt: timestamp("deleted_at")');
  });

  it("has deprecation JSDoc on isActive referencing 2026-03-31", () => {
    expect(schemaSource).toContain("@deprecated 2026-03-31");
  });

  it("has archivedStatus column defaulting to 'ACTIVE'", () => {
    const pesStart = schemaSource.indexOf('pgTable("project_execution_state"');
    const pesBlock = schemaSource.slice(pesStart, pesStart + 2000);
    expect(pesBlock).toContain('archivedStatus: text("archived_status")');
    expect(pesBlock).toContain('.default("ACTIVE")');
  });
});

// ────────────────────────────────────────────────────────
// SECTION 11 — consumer verification
// ────────────────────────────────────────────────────────

describe("consumer map — markProjectsActive", () => {
  it("is called from imports-admin-extracted-routes.ts", () => {
    expect(consumerSource).toContain("storage.markProjectsActive(");
  });

  it("all callers guard with length > 0 or array validation", () => {
    // Every call site either checks .length > 0 or validates Array.isArray
    const callSites = consumerSource.split("storage.markProjectsActive(");
    // First element is the part before the first call, skip it
    for (let i = 1; i < callSites.length; i++) {
      const preceding = consumerSource.slice(
        Math.max(0, consumerSource.indexOf(callSites[i]) - 200),
        consumerSource.indexOf(callSites[i]),
      );
      const hasLengthGuard = preceding.includes(".length > 0");
      const hasArrayGuard = preceding.includes("Array.isArray");
      expect(
        hasLengthGuard || hasArrayGuard,
        `Call site ${i} should have length or array guard`,
      ).toBe(true);
    }
  });
});

describe("consumer map — getProjectCounts", () => {
  it("is called from imports-admin-extracted-routes.ts", () => {
    expect(consumerSource).toContain("storage.getProjectCounts()");
  });

  it("result is returned as projectCounts in JSON response", () => {
    expect(consumerSource).toContain("projectCounts");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 12 — markProjectsActive: schema drift remediation verification
// ────────────────────────────────────────────────────────

describe("markProjectsActive — schema drift remediation (isActive on projectInfo)", () => {
  it("projectInfo schema does NOT have isActive (dropped in 20260337)", () => {
    const tableStart = schemaSource.indexOf('pgTable("project_info"');
    const tableEnd = schemaSource.indexOf("});", tableStart);
    const tableBlock = schemaSource.slice(tableStart, tableEnd);
    expect(tableBlock).not.toContain("isActive");
  });

  it("Drizzle .set() call no longer includes isActive field", () => {
    // After remediation: the .update(projectInfo).set() call only sets updatedAt.
    // The dead isActive writes have been removed.
    // Note: The word "isActive" still appears in explanatory comments,
    // so we check the actual .set() invocations, not comment text.
    const methodStart = storageSource.indexOf(
      "async markProjectsActive(activeNames: string[])",
    );
    const methodBlock = storageSource.slice(methodStart, methodStart + 1500);
    expect(methodBlock).not.toContain(".set({ isActive: true");
    expect(methodBlock).not.toContain(".set({ isActive: false");
    expect(methodBlock).toContain(".set({ updatedAt: new Date() })");
  });

  it("raw SQL path correctly writes is_active on project_execution_state only", () => {
    const methodStart = storageSource.indexOf(
      "async markProjectsActive(activeNames: string[])",
    );
    const methodBlock = storageSource.slice(methodStart, methodStart + 1500);
    // is_active appears only in raw SQL targeting project_execution_state
    expect(methodBlock).toContain("UPDATE project_execution_state SET deleted_at = NULL, is_active = true");
    expect(methodBlock).toContain("UPDATE project_execution_state SET deleted_at = NOW(), is_active = false");
  });
});

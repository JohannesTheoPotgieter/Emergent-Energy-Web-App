/**
 * Baseline harness for getAllProjectInfo + fallback chain.
 *
 * PURPOSE: Lock down the behavioral invariants of:
 *   - getAllProjectInfo()            (storage.ts ~842-872)
 *   - shouldUseLegacyProjectInfoReadFallback()  (storage.ts ~874-920)
 *   - listLegacyCompatibleProjectInfo()         (storage.ts ~922-1035)
 *
 * These tests are source-structural: they read the implementation and
 * assert that critical contracts have not drifted.  They do NOT require
 * a running database or mocks.
 *
 * When the methods are later extracted to a repository, these tests
 * serve as the "before" snapshot.  The extraction PR must demonstrate
 * that all assertions still pass against the new location.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const STORAGE_PATH = path.join(process.cwd(), "server/storage.ts");
const source = fs.readFileSync(STORAGE_PATH, "utf8");

// ────────────────────────────────────────────────────────
// SECTION 1 — getAllProjectInfo merge behavior
// ────────────────────────────────────────────────────────

describe("getAllProjectInfo — canonical path merge behavior", () => {
  it("performs LEFT JOIN between projectInfo and projectExecutionState", () => {
    expect(source).toContain(
      ".leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))"
    );
  });

  it("orders by projectInfo.updatedAt DESC", () => {
    // The canonical query must order by updatedAt descending
    expect(source).toContain(".orderBy(desc(projectInfo.updatedAt))");
  });

  it("filters null/undefined values from execution state before merging", () => {
    // The null-filter loop must exist — this prevents exec state nulls
    // from overwriting real project_info values
    expect(source).toContain("if (value !== null && value !== undefined)");
    expect(source).toContain("nonNullExecState[key] = value");
  });

  it("preserves project_info.id over execution state id", () => {
    expect(source).toContain("id: r.project_info.id,");
  });

  it("preserves project_info.updatedAt over execution state updatedAt", () => {
    expect(source).toContain("updatedAt: r.project_info.updatedAt,");
  });

  it("spreads project_info first, then non-null exec state", () => {
    // The merge order is: base project_info → non-null exec fields → id/updatedAt override
    expect(source).toContain("...r.project_info,");
    expect(source).toContain("...nonNullExecState,");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 2 — getAllProjectInfo fallback trigger
// ────────────────────────────────────────────────────────

describe("getAllProjectInfo — fallback trigger", () => {
  it("catches errors and checks shouldUseLegacyProjectInfoReadFallback", () => {
    expect(source).toContain("this.shouldUseLegacyProjectInfoReadFallback(error)");
  });

  it("delegates to listLegacyCompatibleProjectInfo on fallback", () => {
    // When fallback is triggered in getAllProjectInfo, it calls without filters
    expect(source).toContain("return this.listLegacyCompatibleProjectInfo();");
  });

  it("re-throws non-fallback errors", () => {
    // Non-matching errors must propagate — the throw must exist after the if-block
    const getAllBlock = source.slice(
      source.indexOf("async getAllProjectInfo()"),
      source.indexOf("async getAllProjectInfo()") + 1200
    );
    expect(getAllBlock).toContain("throw error;");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 3 — shouldUseLegacyProjectInfoReadFallback
// ────────────────────────────────────────────────────────

describe("shouldUseLegacyProjectInfoReadFallback — error detection", () => {
  // Extract the column list from source to snapshot it
  const colListMatch = source.match(
    /const missingColumnNames\s*=\s*\[([\s\S]*?)\];/
  );
  const colBlock = colListMatch?.[1] ?? "";
  const extractedColumns = colBlock
    .split("\n")
    .map((line) => line.match(/"([^"]+)"/)?.[1])
    .filter(Boolean) as string[];

  it("contains exactly 24 missing column names", () => {
    expect(extractedColumns).toHaveLength(24);
  });

  it("snapshots the exact missing column name list", () => {
    expect(extractedColumns).toEqual([
      "phase_updated_at",
      "phase_updated_by_user_id",
      "phase_notes",
      "execution_phase",
      "client_id",
      "archived_status",
      "pm_user_id",
      "pd_user_id",
      "cp_signed",
      "cp_signed_date",
      "cp_signed_by_user_id",
      "cp_evidence_type",
      "cp_evidence_ref",
      "pm_task_pack_created",
      "eng_post_cp_task_pack_created",
      "site_id",
      "opportunity_id",
      "delivery_model",
      "project_code",
      "site_establishment_date",
      "site_establishment_actual",
      "financial_review_status",
      "financial_review_id",
      "waiting_on_department",
    ]);
  });

  it("handles SQLite missing-table error", () => {
    expect(source).toContain('message.includes("no such table")');
  });

  it("handles SQLite missing-column error with allowlist check", () => {
    expect(source).toContain('message.includes("no such column")');
    expect(source).toContain("missingColumnNames.some((col) => message.includes(col))");
  });

  it("handles PostgreSQL undefined_table (42P01)", () => {
    expect(source).toContain('code === "42P01"');
  });

  it("handles PostgreSQL undefined_column (42703) with allowlist check", () => {
    expect(source).toContain('code === "42703"');
  });

  it("returns false for unrecognized errors", () => {
    const fnBlock = source.slice(
      source.indexOf("shouldUseLegacyProjectInfoReadFallback(error: unknown): boolean"),
      source.indexOf("shouldUseLegacyProjectInfoReadFallback(error: unknown): boolean") + 1600
    );
    // Must have a terminal `return false` for safety
    expect(fnBlock).toContain("return false;");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 4 — listLegacyCompatibleProjectInfo 3-tier fallback
// ────────────────────────────────────────────────────────

describe("listLegacyCompatibleProjectInfo — 3-tier fallback structure", () => {
  // Isolate the function body
  const fnStart = source.indexOf(
    "private async listLegacyCompatibleProjectInfo"
  );
  const fnBody = source.slice(fnStart, fnStart + 3500);

  it("Tier 1: tries LEFT JOIN with projectExecutionState for phase", () => {
    expect(fnBody).toContain("phase: projectExecutionState.phase");
    expect(fnBody).toContain(
      ".leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))"
    );
  });

  it("Tier 2: falls back to raw SQL with information_schema column check", () => {
    expect(fnBody).toContain("information_schema.columns");
    expect(fnBody).toContain("column_name='phase'");
  });

  it("Tier 3: falls back to projectInfo-only select without phase", () => {
    // The last-resort query selects from projectInfo only
    expect(fnBody).toContain("phase: null");
  });

  it("all tiers select the same core fields from projectInfo", () => {
    // Each tier must read these identity/core fields
    const coreFields = [
      "projectInfo.id",
      "projectInfo.projectName",
      "projectInfo.sizeKwp",
      "projectInfo.pd",
      "projectInfo.pm",
      "projectInfo.contractValue",
      "projectInfo.updatedAt",
    ];
    for (const field of coreFields) {
      // Must appear at least twice: Tier 1 and Tier 3 both use Drizzle selects
      const count = (fnBody.match(new RegExp(field.replace(".", "\\."), "g")) || []).length;
      expect(count, `${field} must appear in at least 2 tiers`).toBeGreaterThanOrEqual(2);
    }
  });
});

// ────────────────────────────────────────────────────────
// SECTION 5 — listLegacyCompatibleProjectInfo hardcoded defaults
// ────────────────────────────────────────────────────────

describe("listLegacyCompatibleProjectInfo — hardcoded default snapshot", () => {
  // Extract the final mapping block that injects defaults
  const mappingStart = source.indexOf("return rows.map((row) => ({");
  const mappingEnd = source.indexOf("})) as ProjectInfo[];");
  const mappingBlock = source.slice(mappingStart, mappingEnd + 25);

  // --- Null defaults: these fields must be set to null ---
  const expectedNullFields = [
    "phaseUpdatedAt",
    "phaseUpdatedByUserId",
    "phaseNotes",
    "pdHandoverDate",
    "constructionStartDate",
    "commissioningDate",
    "omHandoverDate",
    "clientHandoverDate",
    "escalationLevel",
    "constructionStartActual",
    "pdHandoverActual",
    "commissioningActual",
    "clientHandoverActual",
    "ragStatus",
    "ragComment",
    "ragUpdatedAt",
    "ragUpdatedByUserId",
    "executionGateReason",
    "signedDate",
    "signedDocumentLink",
    "executionPhase",
    "excelTrackerLink",
    "clientId",
    "pmUserId",
    "pdUserId",
    "cpSignedDate",
    "cpSignedByUserId",
    "cpEvidenceType",
    "cpEvidenceRef",
  ];

  for (const field of expectedNullFields) {
    it(`injects ${field}: null`, () => {
      expect(mappingBlock).toContain(`${field}: null`);
    });
  }

  // --- Non-null defaults: specific hardcoded values ---
  it("injects isActive: true", () => {
    expect(mappingBlock).toContain("isActive: true");
  });

  it("injects executionEnabled: false", () => {
    expect(mappingBlock).toContain("executionEnabled: false");
  });

  it('injects executionGateStatus: "NOT_ELIGIBLE"', () => {
    expect(mappingBlock).toContain('executionGateStatus: "NOT_ELIGIBLE"');
  });

  it('injects signedStatus: "NONE"', () => {
    expect(mappingBlock).toContain('signedStatus: "NONE"');
  });

  it('injects archivedStatus: "ACTIVE"', () => {
    expect(mappingBlock).toContain('archivedStatus: "ACTIVE"');
  });

  it("injects cpSigned: false", () => {
    expect(mappingBlock).toContain("cpSigned: false");
  });

  it("injects pmTaskPackCreated: false", () => {
    expect(mappingBlock).toContain("pmTaskPackCreated: false");
  });

  it("injects engPostCpTaskPackCreated: false", () => {
    expect(mappingBlock).toContain("engPostCpTaskPackCreated: false");
  });

  it("sets canonicalProjectId to row.id", () => {
    expect(mappingBlock).toContain("canonicalProjectId: row.id");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 6 — Shared fallback helper usage (cross-method coupling)
// ────────────────────────────────────────────────────────

describe("fallback helper shared usage", () => {
  it("shouldUseLegacyProjectInfoReadFallback is private", () => {
    expect(source).toContain(
      "private shouldUseLegacyProjectInfoReadFallback(error: unknown): boolean"
    );
  });

  it("listLegacyCompatibleProjectInfo is private", () => {
    expect(source).toContain(
      "private async listLegacyCompatibleProjectInfo(filters?"
    );
  });

  // Count all call sites of the fallback helpers to track coupling
  const fallbackCheckCalls = (
    source.match(/this\.shouldUseLegacyProjectInfoReadFallback\(/g) || []
  ).length;
  const legacyCompatCalls = (
    source.match(/this\.listLegacyCompatibleProjectInfo\(/g) || []
  ).length;

  it("shouldUseLegacyProjectInfoReadFallback is called from exactly 4 methods", () => {
    // getAllProjectInfo, getProjectInfo, getProjectInfoById, getAllProjects
    expect(fallbackCheckCalls).toBe(4);
  });

  it("listLegacyCompatibleProjectInfo is called from exactly 4 methods", () => {
    // same 4 callers
    expect(legacyCompatCalls).toBe(4);
  });
});

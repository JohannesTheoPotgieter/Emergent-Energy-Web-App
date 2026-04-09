/**
 * Baseline harness for getAllProjectInfo + fallback chain.
 *
 * PURPOSE: Lock down the behavioral invariants of:
 *   - getAllProjectInfo()            (project-info-read-repository.ts)
 *   - shouldUseLegacyProjectInfoReadFallback()  (lib/project-info-fallback.ts)
 *   - listLegacyCompatibleProjectInfo()         (lib/project-info-fallback.ts)
 *
 * These tests are source-structural: they read the implementation and
 * assert that critical contracts have not drifted.  They do NOT require
 * a running database or mocks.
 *
 * After extraction, these tests verify the invariants hold in the new locations.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_PATH = path.join(process.cwd(), "server/repositories/project-info-read-repository.ts");
const FALLBACK_PATH = path.join(process.cwd(), "server/lib/project-info-fallback.ts");
const STORAGE_PATH = path.join(process.cwd(), "server/storage.ts");

const repoSource = fs.readFileSync(REPO_PATH, "utf8");
const fallbackSource = fs.readFileSync(FALLBACK_PATH, "utf8");
const storageSource = fs.readFileSync(STORAGE_PATH, "utf8");

// ────────────────────────────────────────────────────────
// SECTION 1 — getAllProjectInfo merge behavior
// ────────────────────────────────────────────────────────

describe("getAllProjectInfo — canonical path merge behavior", () => {
  it("performs LEFT JOIN between projectInfo and projectExecutionState", () => {
    expect(repoSource).toContain(
      ".leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))"
    );
  });

  it("orders by projectInfo.updatedAt DESC", () => {
    expect(repoSource).toContain(".orderBy(desc(projectInfo.updatedAt))");
  });

  it("filters null/undefined values from execution state before merging", () => {
    expect(repoSource).toContain("if (value !== null && value !== undefined)");
    expect(repoSource).toContain("nonNullExecState[key] = value");
  });

  it("preserves project_info.id over execution state id", () => {
    expect(repoSource).toContain("id: r.project_info.id,");
  });

  it("preserves project_info.updatedAt over execution state updatedAt", () => {
    expect(repoSource).toContain("updatedAt: r.project_info.updatedAt,");
  });

  it("spreads project_info first, then non-null exec state", () => {
    expect(repoSource).toContain("...r.project_info,");
    expect(repoSource).toContain("...nonNullExecState,");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 2 — getAllProjectInfo fallback trigger
// ────────────────────────────────────────────────────────

describe("getAllProjectInfo — fallback trigger", () => {
  it("catches errors and checks shouldUseLegacyProjectInfoReadFallback", () => {
    expect(repoSource).toContain("shouldUseLegacyProjectInfoReadFallback(error)");
  });

  it("delegates to listLegacyCompatibleProjectInfo on fallback", () => {
    expect(repoSource).toContain("return listLegacyCompatibleProjectInfo(this.dbInstance);");
  });

  it("re-throws non-fallback errors", () => {
    const getAllBlock = repoSource.slice(
      repoSource.indexOf("async getAll()"),
      repoSource.indexOf("async getAll()") + 1200
    );
    expect(getAllBlock).toContain("throw error;");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 3 — shouldUseLegacyProjectInfoReadFallback
// ────────────────────────────────────────────────────────

describe("shouldUseLegacyProjectInfoReadFallback — error detection", () => {
  // Extract the column list from fallback source to snapshot it
  const colListMatch = fallbackSource.match(
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
    expect(fallbackSource).toContain('message.includes("no such table")');
  });

  it("handles SQLite missing-column error with allowlist check", () => {
    expect(fallbackSource).toContain('message.includes("no such column")');
    expect(fallbackSource).toContain("missingColumnNames.some((col) => message.includes(col))");
  });

  it("handles PostgreSQL undefined_table (42P01)", () => {
    expect(fallbackSource).toContain('code === "42P01"');
  });

  it("handles PostgreSQL undefined_column (42703) with allowlist check", () => {
    expect(fallbackSource).toContain('code === "42703"');
  });

  it("returns false for unrecognized errors", () => {
    const fnBlock = fallbackSource.slice(
      fallbackSource.indexOf("shouldUseLegacyProjectInfoReadFallback(error: unknown): boolean"),
      fallbackSource.indexOf("shouldUseLegacyProjectInfoReadFallback(error: unknown): boolean") + 1600
    );
    // Must have a terminal `return false` for safety
    expect(fnBlock).toContain("return false;");
  });
});

// ────────────────────────────────────────────────────────
// SECTION 4 — listLegacyCompatibleProjectInfo 3-tier fallback
// ────────────────────────────────────────────────────────

describe("listLegacyCompatibleProjectInfo — 3-tier fallback structure", () => {
  const fnStart = fallbackSource.indexOf(
    "export async function listLegacyCompatibleProjectInfo"
  );
  const fnBody = fallbackSource.slice(fnStart, fnStart + 3500);

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
    expect(fnBody).toContain("phase: null");
  });

  it("all tiers select the same core fields from projectInfo", () => {
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
      const count = (fnBody.match(new RegExp(field.replace(".", "\\."), "g")) || []).length;
      expect(count, `${field} must appear in at least 2 tiers`).toBeGreaterThanOrEqual(2);
    }
  });
});

// ────────────────────────────────────────────────────────
// SECTION 5 — listLegacyCompatibleProjectInfo hardcoded defaults
// ────────────────────────────────────────────────────────

describe("listLegacyCompatibleProjectInfo — hardcoded default snapshot", () => {
  const mappingStart = fallbackSource.indexOf("return rows.map((row) => ({");
  const mappingEnd = fallbackSource.indexOf("})) as ProjectInfo[];");
  const mappingBlock = fallbackSource.slice(mappingStart, mappingEnd + 25);

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
// SECTION 6 — Shared fallback helper usage (cross-module coupling)
// ────────────────────────────────────────────────────────

describe("fallback helper shared usage", () => {
  it("shouldUseLegacyProjectInfoReadFallback is an exported function in fallback lib", () => {
    expect(fallbackSource).toContain(
      "export function shouldUseLegacyProjectInfoReadFallback(error: unknown): boolean"
    );
  });

  it("listLegacyCompatibleProjectInfo is an exported async function in fallback lib", () => {
    expect(fallbackSource).toContain(
      "export async function listLegacyCompatibleProjectInfo("
    );
  });

  // Count all call sites across storage.ts and the repository
  const storageFallbackCalls = (
    storageSource.match(/shouldUseLegacyProjectInfoReadFallback\(/g) || []
  ).length;
  const repoFallbackCalls = (
    repoSource.match(/shouldUseLegacyProjectInfoReadFallback\(/g) || []
  ).length;

  const storageLegacyCalls = (
    storageSource.match(/listLegacyCompatibleProjectInfo\(/g) || []
  ).length;
  const repoLegacyCalls = (
    repoSource.match(/listLegacyCompatibleProjectInfo\(/g) || []
  ).length;

  it("shouldUseLegacyProjectInfoReadFallback is called from exactly 4 locations total", () => {
    // 1 in storage.ts (getAllProjects)
    // 3 in repository (getAll, getByName, getById)
    expect(storageFallbackCalls).toBe(1);
    expect(repoFallbackCalls).toBe(3);
  });

  it("listLegacyCompatibleProjectInfo is called from exactly 4 locations total", () => {
    // 1 in storage.ts (getAllProjects)
    // 3 in repository (getAll, getByName, getById)
    expect(storageLegacyCalls).toBe(1);
    expect(repoLegacyCalls).toBe(3);
  });

  it("storage.ts delegates getAllProjectInfo to the repository", () => {
    expect(storageSource).toContain("this.projectInfoReadRepository.getAll()");
  });

  it("storage.ts delegates getProjectInfo to the repository", () => {
    expect(storageSource).toContain("this.projectInfoReadRepository.getByName(projectName)");
  });

  it("storage.ts delegates getProjectInfoById to the repository", () => {
    expect(storageSource).toContain("this.projectInfoReadRepository.getById(id)");
  });
});

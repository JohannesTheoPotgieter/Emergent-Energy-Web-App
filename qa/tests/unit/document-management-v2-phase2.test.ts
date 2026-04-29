/**
 * D6 Phase 2 — folder taxonomy seed + admin route shape.
 *
 * Pure unit tests — no DB. Validates:
 *   1. Every seeded folder has valid disciplines (LIFECYCLE_DEPARTMENTS) and
 *      stage_code (STAGE_CODES) values.
 *   2. Internal keys are unique and use the canonical character set.
 *   3. Parent keys reference rows that exist in the seed.
 *   4. Pattern A and Pattern B both have at least the documented top-level
 *      folders.
 *   5. The admin routes file exports `registerDocumentManagementAdminRoutes`
 *      and the routes are wired into the central index.
 *   6. The admin page is wired into the page registry with the
 *      `documents_admin` permission entity.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  LIFECYCLE_DEPARTMENTS,
  STAGE_CODES,
  FOLDER_LIFECYCLE_MODES,
  COMPANY_ROLES,
} from "@shared/schema";
import { PAGE_REGISTRY } from "@/config/page-registry";
import { ENTITY_REGISTRY } from "@shared/permissions/registry";

// ---- Read the seed file as plain TS source -------------------------------
//
// We deliberately don't import the seed module here because that would pull
// in the server-side `db` import and require the DB driver. Reading the file
// as text and re-validating the constant arrays gives us the same coverage
// without any of that overhead.

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const seedPath = path.join(repoRoot, "server", "seed-folder-taxonomy.ts");
const seedSrc = fs.readFileSync(seedPath, "utf8");

/** Brittle-but-narrow extractor — pulls every internalKey + parentKey + lifecycleMode + stageCode + disciplines literal from the seed. */
function extractRows(): Array<{
  internalKey: string;
  parentKey: string | null;
  lifecycleMode: string;
  stageCode: string | null;
  disciplines: string[];
}> {
  const rowRegex = /internalKey:\s*"([^"]+)",[\s\S]*?displayName:\s*"[^"]*",[\s\S]*?parentKey:\s*(?:null|"([^"]+)"),[\s\S]*?lifecycleMode:\s*"([^"]+)",[\s\S]*?stageCode:\s*(?:null|"([^"]+)"),[\s\S]*?disciplines:\s*\[([^\]]*)\]/g;
  const rows: ReturnType<typeof extractRows> = [];
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(seedSrc)) !== null) {
    const [, internalKey, parentKey, lifecycleMode, stageCode, disciplinesRaw] = match;
    const disciplines = disciplinesRaw
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    rows.push({
      internalKey,
      parentKey: parentKey ?? null,
      lifecycleMode,
      stageCode: stageCode ?? null,
      disciplines,
    });
  }
  return rows;
}

const rows = extractRows();

describe("D6 Phase 2 — folder taxonomy seed", () => {
  it("extracts a non-trivial number of rows", () => {
    // Pattern A (3 + 5 + 9 + 8) + Pattern B (14) = 39 rows seeded.
    expect(rows.length).toBeGreaterThanOrEqual(35);
  });

  it("uses only valid lifecycle modes", () => {
    for (const r of rows) {
      expect(FOLDER_LIFECYCLE_MODES).toContain(r.lifecycleMode);
    }
  });

  it("references only canonical STAGE_CODES (or null for cross-stage)", () => {
    for (const r of rows) {
      if (r.stageCode === null) continue;
      expect(STAGE_CODES).toContain(r.stageCode);
    }
  });

  it("uses only LIFECYCLE_DEPARTMENTS values for disciplines", () => {
    for (const r of rows) {
      for (const d of r.disciplines) {
        expect(LIFECYCLE_DEPARTMENTS).toContain(d);
      }
    }
  });

  it("has unique internalKeys", () => {
    const keys = rows.map((r) => r.internalKey);
    const dedup = new Set(keys);
    expect(dedup.size).toBe(keys.length);
  });

  it("uses the canonical internalKey character set", () => {
    const re = /^[a-z0-9_/]+$/;
    for (const r of rows) {
      expect(r.internalKey).toMatch(re);
    }
  });

  it("references only parentKeys that exist in the seed", () => {
    const keys = new Set(rows.map((r) => r.internalKey));
    for (const r of rows) {
      if (r.parentKey === null) continue;
      expect(keys).toContain(r.parentKey);
    }
  });

  it("includes the documented Pattern A top-level folders", () => {
    const keys = new Set(rows.map((r) => r.internalKey));
    expect(keys).toContain("pre_first_assessment");
    expect(keys).toContain("pre_cost_proposal");
    expect(keys).toContain("pm_pre_construction");
  });

  it("includes the documented Pattern B 01-14 folders", () => {
    const keys = new Set(rows.map((r) => r.internalKey));
    expect(keys).toContain("01_financial_close");
    expect(keys).toContain("07_construction");
    expect(keys).toContain("14_contractor_shared");
  });

  it("maps 07_Construction to ENGINEERING + CONSTRUCTION + QUALITY (per planning)", () => {
    const construction = rows.find((r) => r.internalKey === "07_construction");
    expect(construction).toBeDefined();
    expect(construction!.disciplines.sort()).toEqual(
      ["CONSTRUCTION", "ENGINEERING", "QUALITY"].sort(),
    );
  });
});

describe("D6 Phase 2 — admin routes wiring", () => {
  const routeFile = fs.readFileSync(
    path.join(repoRoot, "server", "routes", "document-management-admin.routes.ts"),
    "utf8",
  );
  const indexFile = fs.readFileSync(path.join(repoRoot, "server", "routes", "index.ts"), "utf8");

  it("exports registerDocumentManagementAdminRoutes", () => {
    expect(routeFile).toMatch(/export function registerDocumentManagementAdminRoutes/);
  });

  it("registers the admin handlers in routes/index.ts", () => {
    expect(indexFile).toMatch(/registerDocumentManagementAdminRoutes\(app\)/);
  });

  it("gates writes on documents_admin entity (create/edit/delete)", () => {
    expect(routeFile).toMatch(/requirePermission\(["']documents_admin["'],\s*["']create["']\)/);
    expect(routeFile).toMatch(/requirePermission\(["']documents_admin["'],\s*["']edit["']\)/);
    expect(routeFile).toMatch(/requirePermission\(["']documents_admin["'],\s*["']delete["']\)/);
  });

  it("gates public reads on documents:view (so any authed user can read taxonomy)", () => {
    expect(routeFile).toMatch(/requirePermission\(["']documents["'],\s*["']view["']\)/);
  });

  it("validates write payloads with the canonical Zod schemas", () => {
    expect(routeFile).toMatch(/insertFolderTaxonomySchema/);
    expect(routeFile).toMatch(/insertDocumentApprovalRequirementSchema/);
  });
});

describe("D6 Phase 2 — admin page registration", () => {
  it("registers /admin/document-management with documents_admin entity", () => {
    const entry = PAGE_REGISTRY.find((p) => p.path === "/admin/document-management");
    expect(entry).toBeDefined();
    expect(entry!.permissionEntity).toBe("documents_admin");
    expect(entry!.routeComponentKey).toBe("AdminDocumentManagementPage");
  });

  it("documents_admin entity is registered with the same shape as documents_provision", () => {
    const adminEntry = ENTITY_REGISTRY.find((r) => r.entity === "documents_admin");
    expect(adminEntry).toBeDefined();
    // COO/CEO are the default editors.
    expect(adminEntry!.edit_roles.sort()).toEqual(["CEO_ADMIN", "COO_ADMIN"].sort());
  });

  it("hides the legacy /admin/document-types from the sidebar", () => {
    const legacy = PAGE_REGISTRY.find((p) => p.path === "/admin/document-types");
    expect(legacy).toBeDefined();
    expect(legacy!.showInSidebar).toBe(false);
  });
});

describe("D6 Phase 2 — bootstrap wiring", () => {
  const bootstrapFile = fs.readFileSync(
    path.join(repoRoot, "server", "bootstrap", "run-startup-seeds.ts"),
    "utf8",
  );

  it("invokes seedFolderTaxonomy on startup", () => {
    expect(bootstrapFile).toMatch(/seedFolderTaxonomy/);
    expect(bootstrapFile).toMatch(/await import\(["']\.\.\/seed-folder-taxonomy["']\)/);
  });

  it("logs inserted/skipped counts so operators see seed activity", () => {
    expect(bootstrapFile).toMatch(/Folder taxonomy: inserted=/);
  });
});

describe("D6 Phase 2 — sanity check on COMPANY_ROLES coverage in seed", () => {
  // Defensive: make sure no role values leaked into disciplines (which is a
  // common copy-paste mistake — disciplines is LIFECYCLE_DEPARTMENTS, not
  // COMPANY_ROLES).
  it("disciplines never contain COMPANY_ROLES values", () => {
    const departmentSet = new Set<string>(LIFECYCLE_DEPARTMENTS);
    const roleSet = new Set<string>(COMPANY_ROLES);
    for (const r of rows) {
      for (const d of r.disciplines) {
        // Every value must be a department, AND not accidentally a role.
        expect(departmentSet.has(d)).toBe(true);
        if (roleSet.has(d) && !departmentSet.has(d)) {
          throw new Error(
            `Row ${r.internalKey} has discipline '${d}' which is a COMPANY_ROLE, not a LIFECYCLE_DEPARTMENT`,
          );
        }
      }
    }
  });
});

/**
 * D6 Phase 2 — admin route shape + approval-requirement editor + admin page
 * registration.
 *
 * Pure unit tests — no DB. Validates:
 *   1. The admin routes file exports `registerDocumentManagementAdminRoutes`,
 *      is wired into the central index, gates writes on `documents_admin` and
 *      public reads on `documents:view`, validates with the canonical Zod
 *      schema, and audit-logs every approval-requirement mutation.
 *   2. The approval-requirement editor confirms deactivation behind an
 *      AlertDialog.
 *   3. The admin page is wired into the page registry with the
 *      `documents_admin` permission entity.
 *
 * PHASE 5 DECOMMISSION: the legacy `folder_taxonomy` seed + admin CRUD and the
 * startup `seedFolderTaxonomy()` hook were removed with the folder-taxonomy
 * table. Browse-and-bind discipline folders are the sole project document
 * surface, so there is nothing to seed and no taxonomy admin endpoints to gate.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { PAGE_REGISTRY } from "@/config/page-registry";
import { ENTITY_REGISTRY } from "@shared/permissions/registry";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

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

  it("gates all writes on documents_admin:edit (create/edit/delete folded into edit)", () => {
    // Collapsed model: the three old mutating gates (create/edit/delete) are
    // all documents_admin:edit now. Assert the mutating gate is present and
    // that no legacy create/delete actions linger on this entity.
    expect(routeFile).toMatch(/requirePermission\(["']documents_admin["'],\s*["']edit["']\)/);
    expect(routeFile).not.toMatch(/requirePermission\(["']documents_admin["'],\s*["']create["']\)/);
    expect(routeFile).not.toMatch(/requirePermission\(["']documents_admin["'],\s*["']delete["']\)/);
  });

  it("gates public reads on documents:view (so any authed user can read requirements)", () => {
    expect(routeFile).toMatch(/requirePermission\(["']documents["'],\s*["']view["']\)/);
  });

  it("validates write payloads with the canonical Zod schema", () => {
    expect(routeFile).toMatch(/insertDocumentApprovalRequirementSchema/);
  });

  it("no longer references the retired folder-taxonomy admin surface", () => {
    expect(routeFile).not.toMatch(/insertFolderTaxonomySchema/);
    expect(routeFile).not.toMatch(/folder-taxonomy-repository/);
    expect(routeFile).not.toMatch(/entityType:\s*"folder_taxonomy"/);
  });

  it("audit-logs every approval-requirement mutation (create / update / deactivate)", () => {
    expect(routeFile).toMatch(/import\s*\{\s*logAuditFromReq\s*\}/);
    expect(routeFile).toMatch(
      /entityType:\s*"document_approval_requirement",[\s\S]*?action:\s*"create"/,
    );
    expect(routeFile).toMatch(
      /entityType:\s*"document_approval_requirement",[\s\S]*?action:\s*"update"/,
    );
    expect(routeFile).toMatch(
      /entityType:\s*"document_approval_requirement",[\s\S]*?action:\s*"deactivate"/,
    );
  });
});

describe("D6 Phase 2.1 — approval-requirement editor deactivate confirmation", () => {
  // The requirement editor lives in its own module (file-size split, EE-QA-015);
  // its deactivate confirm lives there.
  const requirementDialogFile = fs.readFileSync(
    path.join(repoRoot, "client", "src", "components", "documents", "RequirementDialog.tsx"),
    "utf8",
  );

  it("imports AlertDialog primitives from the shared component library", () => {
    expect(requirementDialogFile).toMatch(
      /import\s*\{[\s\S]*?AlertDialog[\s\S]*?\}\s*from\s*["']@\/components\/ui\/alert-dialog["']/,
    );
  });

  it("uses an AlertDialog confirm step before deactivating a requirement", () => {
    expect(requirementDialogFile).toMatch(/data-testid="btn-requirement-deactivate-confirm"/);
  });

  it("references audit-logging in the confirm copy so users know the action is tracked", () => {
    expect(requirementDialogFile).toMatch(/audit-logged/i);
  });
});

describe("D6 Phase 2 — admin page registration", () => {
  it("registers /admin/document-management with documents_admin entity", () => {
    const entry = PAGE_REGISTRY.find((p) => p.path === "/admin/document-management");
    expect(entry).toBeDefined();
    expect(entry!.permissionEntity).toBe("documents_admin");
    expect(entry!.routeComponentKey).toBe("AdminDocumentManagementPage");
  });

  it("documents_admin entity is registered with COO/CEO as default editors", () => {
    const adminEntry = ENTITY_REGISTRY.find((r) => r.entity === "documents_admin");
    expect(adminEntry).toBeDefined();
    expect(adminEntry!.edit_roles.sort()).toEqual(["CEO_ADMIN", "COO_ADMIN"].sort());
  });

  it("fully removes the legacy /admin/document-types page (controlled-documents retired)", () => {
    const legacy = PAGE_REGISTRY.find((p) => p.path === "/admin/document-types");
    expect(legacy).toBeUndefined();
  });
});

describe("D6 Phase 5 — folder-taxonomy seed is decommissioned", () => {
  it("the seed-folder-taxonomy module is deleted", () => {
    expect(fs.existsSync(path.join(repoRoot, "server", "seed-folder-taxonomy.ts"))).toBe(false);
  });

  it("startup seeds no longer invoke seedFolderTaxonomy", () => {
    const bootstrapFile = fs.readFileSync(
      path.join(repoRoot, "server", "bootstrap", "run-startup-seeds.ts"),
      "utf8",
    );
    expect(bootstrapFile).not.toMatch(/seedFolderTaxonomy\(/);
    expect(bootstrapFile).not.toMatch(/await import\(["']\.\.\/seed-folder-taxonomy["']\)/);
  });
});

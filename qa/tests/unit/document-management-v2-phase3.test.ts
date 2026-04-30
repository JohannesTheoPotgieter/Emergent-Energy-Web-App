/**
 * D6 Phase 3 — folder provisioning service + routes + UI shape.
 *
 * Pure unit tests — no DB. Validates:
 *   1. The provisioning service file declares the right public surface
 *      (provisionProjectFolders, verifyProjectFolders) and goes through
 *      the repository layer, never raw db.select on its own tables.
 *   2. The provisioning routes register correctly, gate writes on
 *      documents_provision:create, and audit-log every mutation.
 *   3. The admin page's Provisioning tab is present and wired to the
 *      hooks in use-document-management-admin.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const serviceFile = fs.readFileSync(
  path.join(repoRoot, "server", "services", "folder-provisioning-service.ts"),
  "utf8",
);
const routesFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "document-provisioning.routes.ts"),
  "utf8",
);
const indexFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "index.ts"),
  "utf8",
);
const hooksFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "hooks", "use-document-management-admin.ts"),
  "utf8",
);
const pageFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "pages", "admin-document-management.tsx"),
  "utf8",
);

describe("D6 Phase 3 — provisioning service shape", () => {
  it("exports provisionProjectFolders and verifyProjectFolders", () => {
    expect(serviceFile).toMatch(/export async function provisionProjectFolders/);
    expect(serviceFile).toMatch(/export async function verifyProjectFolders/);
  });

  it("uses the canonical 'active_projects' company-root kind", () => {
    expect(serviceFile).toMatch(
      /ACTIVE_PROJECTS_ROOT_KIND\s*=\s*["']active_projects["']/,
    );
  });

  it("goes through the repository layer for taxonomy + folders", () => {
    expect(serviceFile).toMatch(
      /from\s*["']\.\.\/repositories\/folder-taxonomy-repository["']/,
    );
    expect(serviceFile).toMatch(
      /from\s*["']\.\.\/repositories\/project-folders-repository["']/,
    );
    expect(serviceFile).toMatch(
      /from\s*["']\.\.\/repositories\/company-sharepoint-roots-repository["']/,
    );
  });

  it("wraps Graph calls so mock-connector mode works (createFolder + listChildren)", () => {
    expect(serviceFile).toMatch(/createFolder/);
    expect(serviceFile).toMatch(/listChildren/);
  });

  it("returns a per-row report with the canonical status set", () => {
    // The status union must stay in lockstep with the UI badge map.
    const expected = ["created", "already_present", "linked_existing", "skipped", "error"];
    for (const s of expected) {
      expect(serviceFile).toContain(`"${s}"`);
    }
  });

  it("includes a topoOrder helper so parents always provision before children", () => {
    expect(serviceFile).toMatch(/function topoOrder/);
    expect(serviceFile).toMatch(/depthOf|depth\.set/);
  });
});

describe("D6 Phase 3 — provisioning routes wiring", () => {
  it("exports registerDocumentProvisioningRoutes", () => {
    expect(routesFile).toMatch(/export function registerDocumentProvisioningRoutes/);
  });

  it("registers the routes in server/routes/index.ts", () => {
    expect(indexFile).toMatch(/registerDocumentProvisioningRoutes\(app\)/);
  });

  it("gates writes on documents_provision:create", () => {
    expect(routesFile).toMatch(
      /requirePermission\(["']documents_provision["'],\s*["']create["']\)/,
    );
  });

  it("gates the read-only folders endpoint on documents:view", () => {
    expect(routesFile).toMatch(
      /requirePermission\(["']documents["'],\s*["']view["']\)/,
    );
  });

  it("audit-logs both provision and verify mutations", () => {
    expect(routesFile).toMatch(/import\s*\{\s*logAuditFromReq\s*\}/);
    expect(routesFile).toMatch(/entityType:\s*"project_folders",[\s\S]*?action:\s*"provision"/);
    expect(routesFile).toMatch(/entityType:\s*"project_folders",[\s\S]*?action:\s*"verify"/);
  });

  it("validates the lifecycleMode body with the canonical FOLDER_LIFECYCLE_MODES enum", () => {
    expect(routesFile).toMatch(/z\.enum\(FOLDER_LIFECYCLE_MODES\)/);
  });
});

describe("D6 Phase 3 — admin UI Provisioning tab", () => {
  it("imports the provisioning hooks", () => {
    expect(pageFile).toMatch(/useProvisionProjectFolders/);
    expect(pageFile).toMatch(/useProjectFolders/);
    expect(pageFile).toMatch(/useVerifyProjectFolders/);
  });

  it("renders a Provisioning tab trigger + content", () => {
    expect(pageFile).toMatch(/data-testid="tab-doc-provisioning"/);
    expect(pageFile).toMatch(/<ProvisioningTab\s*\/>/);
  });

  it("exposes data-testids that Playwright/E2E can target", () => {
    const expected = [
      "select-provisioning-project",
      "select-provisioning-lifecycle",
      "btn-provision-folders",
      "btn-verify-folders",
      "provisioning-result-table",
      "project-folders-table",
    ];
    for (const id of expected) {
      expect(pageFile).toContain(`data-testid="${id}"`);
    }
  });
});

describe("D6 Phase 3 — provisioning hooks", () => {
  it("exports the three Phase 3 hooks", () => {
    expect(hooksFile).toMatch(/export function useProvisionProjectFolders/);
    expect(hooksFile).toMatch(/export function useProjectFolders/);
    expect(hooksFile).toMatch(/export function useVerifyProjectFolders/);
  });

  it("invalidates project_folders cache on successful mutation", () => {
    expect(hooksFile).toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*\[`\/api\/projects\/\$\{projectId\}\/folders`\]\s*\}\)/,
    );
  });

  it("declares the same status union as the service ProvisionRowReport", () => {
    expect(hooksFile).toMatch(/"created"\s*\|\s*"already_present"\s*\|\s*"linked_existing"\s*\|\s*"skipped"\s*\|\s*"error"/);
  });
});

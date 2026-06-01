/**
 * D6 — folder-keyed live file I/O (Stage 1 of the
 * `project_sharepoint_roots` → `project_folders` migration).
 *
 * Locks the contract of `server/routes/document-files.routes.ts`:
 *   1. Registers the folder-keyed browse/file endpoints under
 *      /api/projects/:projectId/folders/:folderId/*.
 *   2. Resolves the SharePoint drive context from `project_folders` (NOT the
 *      deprecated `project_sharepoint_roots`), reusing the surface-agnostic
 *      sharepoint-document-service.
 *   3. Preserves the per-folder ACL (resolveFolderAcl / canPerform), anchored
 *      on the folder's top-level taxonomy display name.
 *   4. Cross-project guard + provisioned guard + subtree containment.
 *   5. Is wired into server/routes/index.ts.
 *
 * Stage 1 is purely additive — the retired surface still exists. These
 * assertions are the guardrail that the cutover (Stage 2) and cleanup
 * (Stage 3) can lean on.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const routesFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "document-files.routes.ts"),
  "utf8",
);
const indexFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "index.ts"),
  "utf8",
);

const BASE = "/api/projects/:projectId/folders/:folderId";

describe("document-files.routes — endpoint registration", () => {
  it("registers all seven folder-keyed live-file endpoints", () => {
    expect(routesFile).toContain(`"${BASE}/children"`);
    expect(routesFile).toContain(`"${BASE}/item/:itemId"`); // GET + PATCH share this path
    expect(routesFile).toContain(`"${BASE}/item/:itemId/download"`);
    expect(routesFile).toContain(`"${BASE}/upload"`);
    expect(routesFile).toContain(`"${BASE}/upload/complete"`);
    expect(routesFile).toContain(`"${BASE}/subfolder"`);
  });

  it("uses the right verbs (GET browse/read, POST writes, PATCH rename)", () => {
    expect((routesFile.match(/app\.get\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((routesFile.match(/app\.post\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((routesFile.match(/app\.patch\(/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("is wired into the routes index", () => {
    expect(indexFile).toContain("registerDocumentFilesRoutes");
    expect(indexFile).toMatch(/import \{ registerDocumentFilesRoutes \} from '\.\/document-files\.routes'/);
  });
});

describe("document-files.routes — resolves the canonical surface only", () => {
  it("resolves drive context from project_folders", () => {
    expect(routesFile).toContain('from "../repositories/project-folders-repository"');
    expect(routesFile).toContain("listFoldersForProject");
  });

  it("does NOT touch the deprecated project_sharepoint_roots surface", () => {
    expect(routesFile).not.toContain("project-sharepoint-roots-repository");
    expect(routesFile).not.toContain("projectSharepointRoots");
  });

  it("reuses the surface-agnostic sharepoint-document-service", () => {
    expect(routesFile).toContain('from "../services/sharepoint-document-service"');
  });
});

describe("document-files.routes — preserves per-folder ACL", () => {
  it("gates every handler through resolveFolderAcl + canPerform", () => {
    expect(routesFile).toContain('from "../config/document-folder-rbac"');
    expect(routesFile).toMatch(/resolveFolderAcl\("project",\s*anchor\)/);
    expect(routesFile).toMatch(/canPerform\(action,/);
  });

  it("anchors the ACL on the folder's top-level taxonomy display name", () => {
    expect(routesFile).toContain("getTaxonomyByKey");
    // Walks parentKey up to the top-level folder for the first-segment match.
    expect(routesFile).toMatch(/while \(entry\?\.parentKey/);
    expect(routesFile).toMatch(/entry\?\.displayName/);
  });

  it("reads require 'read', writes require 'write'", () => {
    expect(routesFile).toContain('user.role, "read")');
    expect(routesFile).toContain('user.role, "write")');
  });
});

describe("document-files.routes — IDOR + containment guards", () => {
  it("rejects a folder that doesn't belong to the project (cross-project guard)", () => {
    expect(routesFile).toContain("Folder not found for this project");
  });

  it("409s when the folder isn't provisioned to SharePoint yet", () => {
    expect(routesFile).toContain("FOLDER_NOT_PROVISIONED");
  });

  it("keeps operations inside the folder's subtree (no whole-drive browse)", () => {
    expect(routesFile).toContain("assertWithinFolder");
    expect(routesFile).toContain("outside the selected folder");
  });

  it("every handler authenticates before resolving the folder", () => {
    // requireAuth on each route + getEffectiveUser null-guard.
    expect((routesFile.match(/requireAuth/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(routesFile).toContain("Authentication required");
  });
});

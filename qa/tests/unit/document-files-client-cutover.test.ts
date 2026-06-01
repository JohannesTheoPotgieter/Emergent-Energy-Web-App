/**
 * D6 — Stage 2 of the project_sharepoint_roots → project_folders migration:
 * the client cutover of live document file I/O.
 *
 * Locks that the /documents browser, its dialogs, and the project document
 * register now drive PROJECT-scope operations through the canonical
 * folder-keyed endpoints (/api/projects/:projectId/folders/:folderId/*) and
 * no longer touch the retired /api/documents/:scope/:rootId project surface
 * or the project[] list from /api/documents/roots. Company scope stays.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const useDocuments = read("client/src/components/documents/use-documents.ts");
const documentsPage = read("client/src/pages/documents.tsx");
const registerPanel = read(
  "client/src/components/project-documents/ProjectDocumentRegisterPanel.tsx",
);
const registerRoutes = read("server/routes/project-document-register.routes.ts");

describe("Stage 2 — BrowseTarget in use-documents", () => {
  it("defines a company|folder discriminated union", () => {
    expect(useDocuments).toMatch(/export type BrowseTarget/);
    expect(useDocuments).toContain('kind: "company"');
    expect(useDocuments).toContain('kind: "folder"');
  });

  it("builds folder-keyed project URLs and company URLs", () => {
    expect(useDocuments).toContain("/api/projects/${t.projectId}/folders/${t.folderId}");
    expect(useDocuments).toContain("/api/documents/company/${t.rootId}");
  });

  it("creates project subfolders via /subfolder, company via /folder", () => {
    expect(useDocuments).toContain('input.target.kind === "company" ? "folder" : "subfolder"');
  });
});

describe("Stage 2 — documents page cut over to folder-keyed targets", () => {
  it("passes a BrowseTarget to the dialogs", () => {
    expect(documentsPage).toContain("target={target}");
    expect(documentsPage).toContain("type BrowseTarget");
  });

  it("Active Clients upload uses a folder-keyed target", () => {
    expect(documentsPage).toContain(
      'target={{ kind: "folder", projectId, folderId: uploadFolderId }}',
    );
  });

  it("never calls the retired project-scope browser endpoint", () => {
    expect(documentsPage).not.toContain("/api/documents/project/");
  });
});

describe("Stage 2 — project document register folder-keyed", () => {
  it("browses via the folder-keyed children endpoint", () => {
    expect(registerPanel).toContain(
      "/api/projects/${projectId}/folders/${selectedFolderId}/children",
    );
  });

  it("links by folderId — not rootId, not the retired browser, not roots", () => {
    expect(registerPanel).toContain("folderId: selectedFolderId");
    expect(registerPanel).not.toContain("/api/documents/project/");
    expect(registerPanel).not.toContain("documents/roots");
  });
});

describe("Stage 3 — register link endpoint requires folderId (rootId path removed)", () => {
  it("resolves driveId from project_folders via a required folderId", () => {
    expect(registerRoutes).toContain("listFoldersForProject");
    expect(registerRoutes).toMatch(/folderId: z\.number\(\)\.int\(\)\.positive\(\)/);
  });

  it("dropped the legacy rootId / project_sharepoint_roots path", () => {
    expect(registerRoutes).not.toContain("getProjectRootById");
    expect(registerRoutes).not.toContain("project-sharepoint-roots-repository");
  });
});

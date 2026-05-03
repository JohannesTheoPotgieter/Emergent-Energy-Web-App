/**
 * D6 Phase 7 — global /documents rewrite + folder file panel.
 *
 * Validates:
 *   1. Upload flow now derives parent_folder_id from the SharePoint
 *      parent item id and threads it through the workflow + repo.
 *   2. Per-folder files endpoint is registered and gated on
 *      documents:view, scoped to the requesting project.
 *   3. <FolderFiles> renders the right testids and the
 *      RequestApprovalDialog wires into the Phase 5 hook.
 *   4. <DisciplinePanel> folder rows are expandable and embed
 *      <FolderFiles> when expanded.
 *   5. /documents page now leads with the new "Active Clients" tab and
 *      keeps the legacy SharePoint browser behind the second tab.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const repoFile = fs.readFileSync(
  path.join(repoRoot, "server", "repositories", "managed-documents-repository.ts"),
  "utf8",
);
const workflowFile = fs.readFileSync(
  path.join(repoRoot, "server", "services", "document-workflow-service.ts"),
  "utf8",
);
const docsRoutesFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "document-management.routes.ts"),
  "utf8",
);
const provisioningRoutesFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "document-provisioning.routes.ts"),
  "utf8",
);
const folderFilesComponent = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "FolderFiles.tsx"),
  "utf8",
);
const disciplinePanel = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "DisciplinePanel.tsx"),
  "utf8",
);
const documentsPage = fs.readFileSync(
  path.join(repoRoot, "client", "src", "pages", "documents.tsx"),
  "utf8",
);
const folderFilesHook = fs.readFileSync(
  path.join(repoRoot, "client", "src", "hooks", "use-folder-files.ts"),
  "utf8",
);

describe("D6 Phase 7 — upload threads parent_folder_id", () => {
  it("repository accepts parentFolderId and persists it on insert", () => {
    expect(repoFile).toMatch(/parentFolderId\?: number \| null/);
    expect(repoFile).toMatch(/parentFolderId:\s*input\.parentFolderId\s*\?\?\s*null/);
  });

  it("repository never clears an existing parentFolderId on update", () => {
    expect(repoFile).toMatch(
      /parentFolderId !== undefined && input\.parentFolderId !== null/,
    );
    // Existing link is preserved when the caller doesn't supply a new one.
    expect(repoFile).toMatch(/existing\.parentFolderId/);
  });

  it("repository exposes findProjectFolderByDriveItem + listManagedDocumentsByFolder", () => {
    expect(repoFile).toMatch(/export async function findProjectFolderByDriveItem/);
    expect(repoFile).toMatch(/export async function listManagedDocumentsByFolder/);
  });

  it("workflow looks up the parent folder when an upload lands under one", () => {
    expect(workflowFile).toMatch(/findProjectFolderByDriveItem/);
    expect(workflowFile).toMatch(/parentDriveItemId\?: string \| null/);
  });

  it("upload route + chunked-complete route both forward parentDriveItemId", () => {
    const occurrences = docsRoutesFile.match(/parentDriveItemId/g);
    expect(occurrences).toBeTruthy();
    expect((occurrences ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("D6 Phase 7 — per-folder files endpoint", () => {
  it("registers GET /api/projects/:projectId/folders/:folderId/files", () => {
    expect(provisioningRoutesFile).toMatch(
      /"\/api\/projects\/:projectId\/folders\/:folderId\/files"/,
    );
  });

  it("is gated on documents:view", () => {
    // Inside the new endpoint block.
    expect(provisioningRoutesFile).toMatch(
      /\/files"[\s\S]*?requirePermission\(["']documents["'],\s*["']view["']\)/,
    );
  });

  it("verifies the folder belongs to the requested project (cross-project guard)", () => {
    expect(provisioningRoutesFile).toMatch(/Folder not found for this project/);
  });

  it("joins approvals so the UI gets file + status in one round trip", () => {
    expect(provisioningRoutesFile).toMatch(/listApprovalsForDocument/);
    expect(provisioningRoutesFile).toMatch(/Promise\.all/);
  });
});

describe("D6 Phase 7 — FolderFiles component", () => {
  it("loads files via the new hook + state-aware badges", () => {
    expect(folderFilesComponent).toMatch(/useFolderFiles/);
    expect(folderFilesComponent).toMatch(/state === "approved"/);
    expect(folderFilesComponent).toMatch(/state === "in_review"/);
  });

  it("offers Request approval only for non-final states", () => {
    expect(folderFilesComponent).toMatch(
      /doc\.state !== "approved" && doc\.state !== "in_review"/,
    );
  });

  it("RequestApprovalDialog wires into useRequestManagedDocApproval", () => {
    expect(folderFilesComponent).toMatch(/useRequestManagedDocApproval/);
    expect(folderFilesComponent).toMatch(/managedDocumentId:\s*target\.document\.id/);
    expect(folderFilesComponent).toMatch(/approverUserIds:\s*selected/);
  });

  it("requires at least one approver", () => {
    expect(folderFilesComponent).toMatch(/Choose at least one approver/);
  });

  it("hook + component declare the same status union", () => {
    expect(folderFilesHook).toMatch(/"draft" \| "in_review" \| "approved"/);
  });
});

describe("D6 Phase 7 — DisciplinePanel folder expansion", () => {
  it("imports FolderFiles and tracks expanded folder state", () => {
    expect(disciplinePanel).toMatch(/import \{ FolderFiles \}/);
    expect(disciplinePanel).toMatch(/expandedFolderId/);
  });

  it("only allows expansion when the folder has been provisioned (has itemId)", () => {
    expect(disciplinePanel).toMatch(/expandable = Boolean\(folder\?\.id && folder\.itemId\)/);
  });

  it("renders FolderFiles inside the expanded row", () => {
    expect(disciplinePanel).toMatch(/<FolderFiles/);
    expect(disciplinePanel).toMatch(/discipline-files-row-/);
  });
});

describe("D6 Phase 7 — global /documents rewrite", () => {
  it("introduces a Tabs strip with Active Clients leading and SharePoint browser second", () => {
    expect(documentsPage).toMatch(/data-testid="tab-documents-active-clients"/);
    expect(documentsPage).toMatch(/data-testid="tab-documents-library"/);
    const acIdx = documentsPage.indexOf("tab-documents-active-clients");
    const libIdx = documentsPage.indexOf("tab-documents-library");
    expect(acIdx).toBeLessThan(libIdx); // primary surface comes first
  });

  it("ActiveClientsView lists projects and renders a folder tree per project", () => {
    expect(documentsPage).toMatch(/function ActiveClientsView/);
    expect(documentsPage).toMatch(/data-testid="select-active-clients-project"/);
    expect(documentsPage).toMatch(/data-testid="active-clients-folder-list"/);
  });

  it("each folder row toggles to show FolderFiles (uses Phase 5 + Phase 7 hooks)", () => {
    expect(documentsPage).toMatch(/btn-active-clients-folder-toggle-/);
    expect(documentsPage).toMatch(/<FolderFiles/);
  });

  it("renders a deep-link to the per-project documents page when one is selected", () => {
    expect(documentsPage).toMatch(/href={`\/projects\/\$\{projectId\}\/documents`}/);
  });

  it("hides the project-root pseudo-folder ('_project_root_') from the tree", () => {
    expect(documentsPage).toMatch(/!== "_project_root_"/);
  });
});

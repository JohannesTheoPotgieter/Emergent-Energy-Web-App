/**
 * Phase 3 — browse-and-bind read path. The service lists a bound discipline
 * folder's SharePoint contents and overlays tracked managed_documents. Drives
 * the real service with mocked SharePoint + repositories.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { repoMock, spMock, mdMock } = vi.hoisted(() => ({
  repoMock: { getDisciplineFolder: vi.fn() },
  spMock: { listChildren: vi.fn() },
  mdMock: { listManagedDocumentsByProject: vi.fn() },
}));
vi.mock("../../../server/repositories/project-discipline-folders-repository", () => repoMock);
vi.mock("../../../server/services/sharepoint-document-service", () => spMock);
vi.mock("../../../server/repositories/managed-documents-repository", () => mdMock);

import { listBoundFolderDocuments } from "../../../server/services/discipline-folder-documents-service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listBoundFolderDocuments", () => {
  it("returns bound:false and skips SharePoint when nothing is bound", async () => {
    repoMock.getDisciplineFolder.mockResolvedValue(null);
    const r = await listBoundFolderDocuments(1, "ENGINEERING");
    expect(r.bound).toBe(false);
    expect(r.items).toEqual([]);
    expect(spMock.listChildren).not.toHaveBeenCalled();
  });

  it("returns bound:false when the binding has no resolved SharePoint ref", async () => {
    repoMock.getDisciplineFolder.mockResolvedValue({
      projectId: 1, discipline: "ENGINEERING", driveId: null, itemId: null,
      deletedAt: null, sharepointPath: null, webUrl: null,
    });
    const r = await listBoundFolderDocuments(1, "ENGINEERING");
    expect(r.bound).toBe(false);
    expect(spMock.listChildren).not.toHaveBeenCalled();
  });

  it("treats a soft-deleted binding as not bound", async () => {
    repoMock.getDisciplineFolder.mockResolvedValue({
      projectId: 1, discipline: "ENGINEERING", driveId: "drv", itemId: "fldr",
      deletedAt: new Date(), sharepointPath: null, webUrl: null,
    });
    const r = await listBoundFolderDocuments(1, "ENGINEERING");
    expect(r.bound).toBe(false);
  });

  it("lists contents, overlays tracked docs, folders first then files", async () => {
    repoMock.getDisciplineFolder.mockResolvedValue({
      projectId: 1, discipline: "ENGINEERING", driveId: "drv", itemId: "fldr",
      deletedAt: null, sharepointPath: "/Acme/07_Construction", webUrl: "https://sp/x",
    });
    spMock.listChildren.mockResolvedValue([
      { id: "f1", name: "as-built.pdf", path: "/Acme/07/as-built.pdf", isFolder: false, webUrl: "https://sp/f1" },
      { id: "sub", name: "IFC", path: "/Acme/07/IFC", isFolder: true },
      { id: "f2", name: "notes.txt", path: "/Acme/07/notes.txt", isFolder: false },
    ]);
    mdMock.listManagedDocumentsByProject.mockResolvedValue([
      { id: 42, driveItemId: "f1", state: "approved" },
    ]);

    const r = await listBoundFolderDocuments(1, "ENGINEERING");

    expect(r.bound).toBe(true);
    expect(r.folder).toEqual({
      discipline: "ENGINEERING", sharepointPath: "/Acme/07_Construction", webUrl: "https://sp/x",
    });
    expect(spMock.listChildren).toHaveBeenCalledWith("drv", "fldr");
    // folders first
    expect(r.items[0]).toMatchObject({ name: "IFC", isFolder: true, managedDocumentId: null });
    // tracked file overlaid
    expect(r.items.find((i) => i.itemId === "f1")).toMatchObject({ managedDocumentId: 42, state: "approved" });
    // untracked file
    expect(r.items.find((i) => i.itemId === "f2")).toMatchObject({ managedDocumentId: null, state: null });
  });
});

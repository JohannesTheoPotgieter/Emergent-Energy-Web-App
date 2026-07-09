import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Batch 5: a `documents:view` GET (getBoundFolderItem) must perform NO writes —
 * a read-only user must never trigger a managed_documents insert or a
 * disciplineFolderId tag, and a write failure must never 500 the detail view.
 */

vi.mock("../../../server/services/sharepoint-document-service", () => ({
  getItem: vi.fn(async () => ({ id: "item-1", name: "spec.pdf", path: "/Eng/spec.pdf", isFolder: false })),
  listChildren: vi.fn(async () => []),
}));

vi.mock("../../../server/repositories/managed-documents-repository", () => ({
  listManagedDocumentsByProject: vi.fn(async () => []),
  setDisciplineFolderId: vi.fn(async () => undefined),
  getManagedDocumentByDriveItem: vi.fn(async () => null),
}));

vi.mock("../../../server/repositories/document-locks-repository", () => ({
  getLock: vi.fn(async () => null),
}));

import * as mdRepo from "../../../server/repositories/managed-documents-repository";
import { getBoundFolderItem } from "../../../server/services/discipline-folder-documents-service";

describe("discipline folder detail — read-only", () => {
  beforeEach(() => vi.clearAllMocks());

  it("performs no writes when viewing an untracked file", async () => {
    const resolved = {
      driveId: "drive-1",
      binding: { id: 7, projectId: 42 },
    } as unknown as Parameters<typeof getBoundFolderItem>[0];

    const detail = await getBoundFolderItem(resolved, "item-1");

    // It READ the existing tracking row…
    expect(mdRepo.getManagedDocumentByDriveItem).toHaveBeenCalledWith("drive-1", "item-1");
    // …and wrote NOTHING (no disciplineFolderId tag; the service no longer even
    // imports upsertManagedDocumentFromGraph on this path).
    expect(mdRepo.setDisciplineFolderId).not.toHaveBeenCalled();
    expect(detail.managedDocument).toBeNull();
  });
});

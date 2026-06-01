/**
 * Stage 3 — project-scope document ACL anchoring on the canonical
 * project_folders surface (server/lib/document-acl.ts), replacing the
 * deprecated project_sharepoint_roots path-stripping. Also pins that the
 * route consumers no longer touch the deleted repository.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { ProjectFolder } from "@shared/schema/documents";

// Mock the two repositories the lib composes (no DB needed). vi.hoisted keeps
// the spies addressable from the hoisted vi.mock factories.
const { listFoldersForProject, getTaxonomyByKey } = vi.hoisted(() => ({
  listFoldersForProject: vi.fn(),
  getTaxonomyByKey: vi.fn(),
}));

vi.mock("../../../server/repositories/project-folders-repository", () => ({
  listFoldersForProject,
}));
vi.mock("../../../server/repositories/folder-taxonomy-repository", () => ({
  getTaxonomyByKey,
}));

import { resolveProjectDocAnchor, folderAclAnchor } from "../../../server/lib/document-acl";

function folder(over: Partial<ProjectFolder> = {}): ProjectFolder {
  return {
    id: 1,
    projectId: 7,
    taxonomyKey: "engineering",
    sharepointPath: "Projects/ABC/Engineering",
    driveId: "drv",
    itemId: "itm",
    ...over,
  } as unknown as ProjectFolder;
}

beforeEach(() => {
  listFoldersForProject.mockReset();
  getTaxonomyByKey.mockReset();
});

describe("folderAclAnchor — top-level taxonomy display name", () => {
  it("walks up parentKey to the top-level display name", async () => {
    getTaxonomyByKey.mockImplementation(async (key: string) => {
      if (key === "engineering/drawings")
        return { internalKey: key, parentKey: "engineering", displayName: "Drawings" };
      if (key === "engineering")
        return { internalKey: key, parentKey: null, displayName: "Engineering" };
      return null;
    });
    expect(await folderAclAnchor(folder({ taxonomyKey: "engineering/drawings" }))).toBe("Engineering");
  });

  it("falls back to the first key segment when taxonomy rows are missing", async () => {
    getTaxonomyByKey.mockResolvedValue(null);
    expect(await folderAclAnchor(folder({ taxonomyKey: "contracts/nda" }))).toBe("contracts");
  });

  it("terminates on a parentKey cycle (does not hang)", async () => {
    getTaxonomyByKey.mockImplementation(async (key: string) => ({
      internalKey: key,
      parentKey: key,
      displayName: key,
    }));
    expect(typeof (await folderAclAnchor(folder({ taxonomyKey: "loop" })))).toBe("string");
  });
});

describe("resolveProjectDocAnchor — canonical project_folders anchoring", () => {
  it("uses parentFolderId (canonical linkage) when set", async () => {
    listFoldersForProject.mockResolvedValue([
      folder({ id: 11, taxonomyKey: "engineering", sharepointPath: "Projects/ABC/Engineering" }),
      folder({ id: 12, taxonomyKey: "contracts", sharepointPath: "Projects/ABC/Contracts" }),
    ]);
    getTaxonomyByKey.mockImplementation(async (key: string) => ({
      internalKey: key,
      parentKey: null,
      displayName: key === "contracts" ? "Contracts" : "Engineering",
    }));
    expect(await resolveProjectDocAnchor({ projectId: 7, parentFolderId: 12, path: "irrelevant" })).toBe("Contracts");
  });

  it("falls back to the longest sharepointPath prefix for untracked docs", async () => {
    listFoldersForProject.mockResolvedValue([
      folder({ id: 11, taxonomyKey: "engineering", sharepointPath: "Projects/ABC/Engineering" }),
    ]);
    getTaxonomyByKey.mockResolvedValue({ internalKey: "engineering", parentKey: null, displayName: "Engineering" });
    expect(
      await resolveProjectDocAnchor({
        projectId: 7,
        parentFolderId: null,
        path: "Projects/ABC/Engineering/manual-subfolder/spec.pdf",
      }),
    ).toBe("Engineering");
  });

  it("falls back to the document path's first segment when no folder matches", async () => {
    listFoldersForProject.mockResolvedValue([
      folder({ id: 11, taxonomyKey: "engineering", sharepointPath: "Projects/ABC/Engineering" }),
    ]);
    // Mirrors the retired mock-mode behaviour: a Contracts doc with no
    // provisioned project_folders row still anchors on "contracts" (restricted
    // ACL) rather than the everyone-can-read fallback.
    expect(
      await resolveProjectDocAnchor({ projectId: 7, parentFolderId: null, path: "Contracts/secret.pdf" }),
    ).toBe("contracts");
  });

  it("returns '' (→ READ_ONLY_FALLBACK) for an empty/unanchorable path", async () => {
    listFoldersForProject.mockResolvedValue([]);
    expect(await resolveProjectDocAnchor({ projectId: 7, parentFolderId: null, path: "" })).toBe("");
  });

  it("prefers parentFolderId over a conflicting path prefix", async () => {
    listFoldersForProject.mockResolvedValue([
      folder({ id: 11, taxonomyKey: "engineering", sharepointPath: "Projects/ABC/Engineering" }),
      folder({ id: 12, taxonomyKey: "photos", sharepointPath: "Projects/ABC/Photos" }),
    ]);
    getTaxonomyByKey.mockImplementation(async (key: string) => ({
      internalKey: key,
      parentKey: null,
      displayName: key === "photos" ? "Photos" : "Engineering",
    }));
    // Path sits under Engineering, but the linkage points at Photos → linkage wins.
    expect(
      await resolveProjectDocAnchor({ projectId: 7, parentFolderId: 12, path: "Projects/ABC/Engineering/spec.pdf" }),
    ).toBe("Photos");
  });
});

describe("Stage 3 — consumers no longer touch the deprecated repository", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("the project-sharepoint-roots-repository is deleted", () => {
    expect(fs.existsSync(path.join(process.cwd(), "server/repositories/project-sharepoint-roots-repository.ts"))).toBe(false);
  });

  it("document-management + document-comments anchor via the shared lib", () => {
    for (const f of [
      "server/routes/document-management.routes.ts",
      "server/routes/document-comments.routes.ts",
    ]) {
      const src = read(f);
      expect(src).toContain("resolveProjectDocAnchor");
      expect(src).not.toContain("project-sharepoint-roots-repository");
    }
  });

  it("the register route requires folderId only (no legacy rootId path)", () => {
    const src = read("server/routes/project-document-register.routes.ts");
    expect(src).not.toContain("project-sharepoint-roots-repository");
    expect(src).not.toContain("getProjectRootById");
  });
});

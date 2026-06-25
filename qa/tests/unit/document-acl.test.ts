/**
 * Phase 5 — project-scope document ACL anchoring on the browse-and-bind
 * discipline surface (server/lib/document-acl.ts).
 *
 * The legacy anchoring chain (project_sharepoint_roots → project_folders →
 * folder_taxonomy, resolved via `parentFolderId`) was removed with those
 * tables. `resolveProjectDocAnchor` now takes
 * `{ projectId, disciplineFolderId, path }` and resolves the document's bound
 * discipline folder → an ACL prefix via the internal DISCIPLINE_ACL_PREFIX
 * map, falling back to the document path's first segment. Unknown anchors
 * resolve to READ_ONLY_FALLBACK in `resolveFolderAcl` — fail safe.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { ProjectDisciplineFolder } from "@shared/schema/documents";

// The lib resolves the binding through the discipline-folders repository.
// Mock it (no DB needed). vi.hoisted keeps the spy addressable from the
// hoisted vi.mock factory.
const { getDisciplineFolderById } = vi.hoisted(() => ({
  getDisciplineFolderById: vi.fn(),
}));

vi.mock("../../../server/repositories/project-discipline-folders-repository", () => ({
  getDisciplineFolderById,
}));

import { resolveProjectDocAnchor } from "../../../server/lib/document-acl";

function binding(over: Partial<ProjectDisciplineFolder> = {}): ProjectDisciplineFolder {
  return {
    id: 1,
    projectId: 7,
    discipline: "ENGINEERING",
    driveId: "drv",
    itemId: "itm",
    sharepointPath: "Projects/ABC/Engineering",
    webUrl: null,
    boundByUserId: null,
    boundAt: null,
    lastVerifiedAt: null,
    verifyError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  } as unknown as ProjectDisciplineFolder;
}

beforeEach(() => {
  getDisciplineFolderById.mockReset();
});

describe("resolveProjectDocAnchor — discipline-folder anchoring", () => {
  it("maps a bound discipline to its ACL prefix (ENGINEERING → engineering)", async () => {
    getDisciplineFolderById.mockResolvedValue(binding({ id: 12, discipline: "ENGINEERING" }));
    expect(
      await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: 12, path: "irrelevant/spec.pdf" }),
    ).toBe("engineering");
  });

  it("maps CONSTRUCTION onto the engineering ACL prefix", async () => {
    getDisciplineFolderById.mockResolvedValue(binding({ id: 13, discipline: "CONSTRUCTION" }));
    expect(
      await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: 13, path: "anything" }),
    ).toBe("engineering");
  });

  it("maps FINANCE / PROCUREMENT / COMPLIANCE onto the contracts ACL prefix", async () => {
    for (const discipline of ["FINANCE", "PROCUREMENT", "COMPLIANCE"]) {
      getDisciplineFolderById.mockResolvedValue(binding({ id: 20, discipline }));
      expect(
        await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: 20, path: "x" }),
      ).toBe("contracts");
    }
  });

  it("maps HSE onto the photos ACL prefix", async () => {
    getDisciplineFolderById.mockResolvedValue(binding({ id: 21, discipline: "HSE" }));
    expect(
      await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: 21, path: "x" }),
    ).toBe("photos");
  });

  it("maps PD / KAM onto the 'client docs' ACL prefix", async () => {
    for (const discipline of ["PD", "KAM"]) {
      getDisciplineFolderById.mockResolvedValue(binding({ id: 22, discipline }));
      expect(
        await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: 22, path: "x" }),
      ).toBe("client docs");
    }
  });

  it("maps QUALITY / PM / OM / EXCO onto the 'internal docs' ACL prefix", async () => {
    for (const discipline of ["QUALITY", "PM", "OM", "EXCO"]) {
      getDisciplineFolderById.mockResolvedValue(binding({ id: 23, discipline }));
      expect(
        await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: 23, path: "x" }),
      ).toBe("internal docs");
    }
  });

  it("resolves by id even when the binding has been soft-unbound (deletedAt set)", async () => {
    getDisciplineFolderById.mockResolvedValue(
      binding({ id: 14, discipline: "ENGINEERING", deletedAt: new Date() }),
    );
    expect(
      await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: 14, path: "irrelevant" }),
    ).toBe("engineering");
    expect(getDisciplineFolderById).toHaveBeenCalledWith(14);
  });

  it("falls back to the document path's first segment when no folder is bound", async () => {
    // Mirrors the retired root-keyed behaviour: a Contracts doc with no bound
    // discipline still anchors on "contracts" (restricted ACL) rather than the
    // everyone-can-read fallback.
    expect(
      await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: null, path: "Contracts/secret.pdf" }),
    ).toBe("contracts");
    expect(getDisciplineFolderById).not.toHaveBeenCalled();
  });

  it("falls back to the path's first segment when the binding has no mapped discipline", async () => {
    // An unmapped discipline code falls through to the path-segment fallback.
    getDisciplineFolderById.mockResolvedValue(binding({ id: 15, discipline: "NOT_MAPPED" }));
    expect(
      await resolveProjectDocAnchor({
        projectId: 7,
        disciplineFolderId: 15,
        path: "Projects/ABC/Engineering/spec.pdf",
      }),
    ).toBe("projects");
  });

  it("falls back to the path's first segment when the binding id resolves to nothing", async () => {
    getDisciplineFolderById.mockResolvedValue(null);
    expect(
      await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: 99, path: "Engineering/file.pdf" }),
    ).toBe("engineering");
  });

  it("normalises the path (backslashes, leading slashes, casing) for the fallback", async () => {
    expect(
      await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: null, path: "\\Photos\\site\\img.jpg" }),
    ).toBe("photos");
  });

  it("returns '' (→ READ_ONLY_FALLBACK) for an empty/unanchorable path", async () => {
    expect(await resolveProjectDocAnchor({ projectId: 7, disciplineFolderId: null, path: "" })).toBe("");
  });
});

describe("Phase 5 — the legacy anchoring surface is gone", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const exists = (rel: string) => fs.existsSync(path.join(repoRoot, rel));

  it("the deprecated repositories are deleted", () => {
    expect(exists("server/repositories/project-sharepoint-roots-repository.ts")).toBe(false);
    expect(exists("server/repositories/project-folders-repository.ts")).toBe(false);
    expect(exists("server/repositories/folder-taxonomy-repository.ts")).toBe(false);
  });

  it("the ACL lib resolves via the discipline-folders repository (not the retired chain)", () => {
    const src = read("server/lib/document-acl.ts");
    expect(src).toContain("project-discipline-folders-repository");
    expect(src).toContain("DISCIPLINE_ACL_PREFIX");
    expect(src).toContain("disciplineFolderId");
    // No live dependency on the retired repositories.
    expect(src).not.toContain('"../repositories/project-folders-repository"');
    expect(src).not.toContain('"../repositories/folder-taxonomy-repository"');
  });

  it("document-management + document-comments anchor via the shared lib using disciplineFolderId", () => {
    for (const f of [
      "server/routes/document-management.routes.ts",
      "server/routes/document-comments.routes.ts",
    ]) {
      const src = read(f);
      expect(src).toContain("resolveProjectDocAnchor");
      expect(src).toContain("disciplineFolderId");
      expect(src).not.toContain("project-sharepoint-roots-repository");
      expect(src).not.toContain("parentFolderId");
    }
  });

  it("the register route requires folderId only (no legacy rootId path)", () => {
    const src = read("server/routes/project-document-register.routes.ts");
    expect(src).not.toContain("project-sharepoint-roots-repository");
    expect(src).not.toContain("getProjectRootById");
  });
});

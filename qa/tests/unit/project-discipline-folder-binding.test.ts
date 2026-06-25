/**
 * Phase 1 — browse-and-bind document setup. Locks the API validation contract
 * for binding a SharePoint folder to a (project, discipline). The full
 * bind→rebind→unbind round-trip + RBAC is covered by the API test suite.
 */

import { describe, it, expect } from "vitest";
import { disciplineFolderBindSchema } from "../../../server/routes/project-discipline-folders.routes";
import { LIFECYCLE_DEPARTMENTS } from "@shared/schema";
import { insertProjectDisciplineFolderSchema } from "@shared/schema/documents";

describe("discipline-folder bind — validation contract", () => {
  it("accepts a valid ENGINEERING binding with all fields", () => {
    const r = disciplineFolderBindSchema.safeParse({
      discipline: "ENGINEERING",
      driveId: "b!drive123",
      itemId: "01ITEMABC",
      sharepointPath: "/active_projects/Acme/07_Construction",
      webUrl: "https://contoso.sharepoint.com/sites/x/Shared%20Documents",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a binding with the optional SharePoint metadata omitted", () => {
    const r = disciplineFolderBindSchema.safeParse({
      discipline: "CONSTRUCTION",
      driveId: "d",
      itemId: "i",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown discipline", () => {
    const r = disciplineFolderBindSchema.safeParse({
      discipline: "NOT_A_DISCIPLINE",
      driveId: "d",
      itemId: "i",
    });
    expect(r.success).toBe(false);
  });

  it("requires a non-empty driveId and itemId", () => {
    expect(disciplineFolderBindSchema.safeParse({ discipline: "ENGINEERING", itemId: "i" }).success).toBe(false);
    expect(disciplineFolderBindSchema.safeParse({ discipline: "ENGINEERING", driveId: "d" }).success).toBe(false);
    expect(disciplineFolderBindSchema.safeParse({ discipline: "ENGINEERING", driveId: "", itemId: "i" }).success).toBe(false);
  });

  it("rejects over-length SharePoint identifiers", () => {
    const tooLong = "x".repeat(513);
    expect(disciplineFolderBindSchema.safeParse({ discipline: "ENGINEERING", driveId: tooLong, itemId: "i" }).success).toBe(false);
  });

  it("covers the disciplines this feature binds for", () => {
    expect(LIFECYCLE_DEPARTMENTS).toContain("ENGINEERING");
    expect(LIFECYCLE_DEPARTMENTS).toContain("CONSTRUCTION");
  });
});

describe("project_discipline_folders — insert schema", () => {
  it("accepts a minimal row (projectId + discipline)", () => {
    const r = insertProjectDisciplineFolderSchema.safeParse({ projectId: 1, discipline: "ENGINEERING" });
    expect(r.success).toBe(true);
  });

  it("requires projectId and discipline", () => {
    expect(insertProjectDisciplineFolderSchema.safeParse({ discipline: "ENGINEERING" }).success).toBe(false);
    expect(insertProjectDisciplineFolderSchema.safeParse({ projectId: 1 }).success).toBe(false);
  });
});

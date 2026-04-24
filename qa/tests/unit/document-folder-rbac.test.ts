import { describe, it, expect } from "vitest";
import {
  DOCUMENT_FOLDER_ACL,
  canPerform,
  resolveFolderAcl,
} from "../../../server/config/document-folder-rbac";

describe("document-folder-rbac", () => {
  it("resolves the project Engineering folder ACL by first segment", () => {
    const acl = resolveFolderAcl("project", "Engineering/Design/file.pdf");
    expect(acl.prefix).toBe("engineering");
    expect(acl.scope).toBe("project");
  });

  it("is case-insensitive on the first path segment", () => {
    const a = resolveFolderAcl("project", "ENGINEERING/x");
    const b = resolveFolderAcl("project", "engineering/x");
    expect(a.prefix).toBe(b.prefix);
  });

  it("falls back to read-only when the folder is unknown", () => {
    const acl = resolveFolderAcl("project", "RandomTopFolder/nested");
    expect(acl.write).toEqual(expect.arrayContaining(["COO_ADMIN", "CEO_ADMIN"]));
    // Read fallback allows every role
    expect(acl.read.length).toBeGreaterThan(2);
  });

  it("does not cross scope boundaries", () => {
    const companyHr = resolveFolderAcl("company", "HR/handbook.pdf");
    expect(companyHr.scope).toBe("company");
    expect(companyHr.prefix).toBe("hr");
    const projectHr = resolveFolderAcl("project", "HR/handbook.pdf");
    // Project scope has no HR folder → fallback
    expect(projectHr.prefix).toBe("");
  });

  it("super users can always perform any action", () => {
    const acl = resolveFolderAcl("company", "HR");
    expect(canPerform("write", "COO_ADMIN", acl)).toBe(true);
    expect(canPerform("delete", "CEO_ADMIN", acl)).toBe(true);
  });

  it("gates write based on the ACL entry", () => {
    const engineering = resolveFolderAcl("project", "Engineering");
    expect(canPerform("write", "ENGINEER", engineering)).toBe(true);
    expect(canPerform("write", "ACCOUNTANT", engineering)).toBe(false);
  });

  it("denies unknown roles explicitly", () => {
    const acl = resolveFolderAcl("project", "Engineering");
    expect(canPerform("read", "NOT_A_ROLE", acl)).toBe(false);
    expect(canPerform("read", null, acl)).toBe(false);
  });

  it("contracts folder is tight — engineers cannot read", () => {
    const contracts = resolveFolderAcl("project", "Contracts");
    expect(canPerform("read", "ENGINEER", contracts)).toBe(false);
    expect(canPerform("read", "CFO", contracts)).toBe(true);
  });

  it("ACL entries cover both project and company scopes", () => {
    const scopes = new Set(DOCUMENT_FOLDER_ACL.map((e) => e.scope));
    expect(scopes.has("project")).toBe(true);
    expect(scopes.has("company")).toBe(true);
  });
});

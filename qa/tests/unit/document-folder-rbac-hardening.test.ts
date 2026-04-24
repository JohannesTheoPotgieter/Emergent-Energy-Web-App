import { describe, it, expect } from "vitest";
import { canPerform, resolveFolderAcl } from "../../../server/config/document-folder-rbac";

/**
 * Regression tests for the document-management hardening pass.
 * Lock down the ACL matrix for high-sensitivity folders so accidental
 * liberalising of permissions in `document-folder-rbac.ts` fails loudly.
 */
describe("document-folder-rbac — hardening invariants", () => {
  it("Contracts folder denies non-finance roles on read", () => {
    const contracts = resolveFolderAcl("project", "Contracts");
    expect(canPerform("read", "ENGINEER", contracts)).toBe(false);
    expect(canPerform("read", "HSE_MANAGER", contracts)).toBe(false);
    expect(canPerform("read", "QUALITY_MANAGER", contracts)).toBe(false);
  });

  it("Contracts folder allows CFO / CCO / Program Manager to read", () => {
    const contracts = resolveFolderAcl("project", "Contracts");
    expect(canPerform("read", "CFO", contracts)).toBe(true);
    expect(canPerform("read", "CCO", contracts)).toBe(true);
    expect(canPerform("read", "PROGRAM_MANAGER", contracts)).toBe(true);
  });

  it("Company HR folder denies ENGINEER and PROJECT_DEVELOPER read", () => {
    const hr = resolveFolderAcl("company", "HR");
    expect(canPerform("read", "ENGINEER", hr)).toBe(false);
    expect(canPerform("read", "PROJECT_DEVELOPER", hr)).toBe(false);
  });

  it("HR folder write is locked down to super-users only", () => {
    const hr = resolveFolderAcl("company", "HR");
    expect(canPerform("write", "COO_ADMIN", hr)).toBe(true);
    expect(canPerform("write", "CEO_ADMIN", hr)).toBe(true);
    expect(canPerform("write", "ENGINEER", hr)).toBe(false);
    expect(canPerform("write", "PROGRAM_MANAGER", hr)).toBe(false);
  });

  it("Policies folder is read-many / write-none for non-super roles", () => {
    const policies = resolveFolderAcl("company", "Policies");
    expect(canPerform("read", "ENGINEER", policies)).toBe(true);
    expect(canPerform("write", "ENGINEER", policies)).toBe(false);
    expect(canPerform("write", "PROGRAM_MANAGER", policies)).toBe(false);
    expect(canPerform("delete", "ENGINEER", policies)).toBe(false);
  });

  it("Unknown folder falls back to read-only for every role", () => {
    const unknown = resolveFolderAcl("project", "PayrollSecrets");
    // Fallback ACL has the full role list on read (length > 2)
    expect(unknown.read.length).toBeGreaterThan(2);
    // But write is restricted to super-users
    expect(canPerform("write", "ENGINEER", unknown)).toBe(false);
    expect(canPerform("write", "PROGRAM_MANAGER", unknown)).toBe(false);
  });
});

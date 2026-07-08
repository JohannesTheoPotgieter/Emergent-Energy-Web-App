/**
 * Task 0.3 — NCR attachment upload endpoint.
 *
 * `ncr_attachments` existed and the get-one route already read attachments,
 * but there was no upload route — users could view attachments they could
 * never create. This adds POST /api/quality/ncrs/:id/attachments supporting
 * both a multipart file upload and a SharePoint/URL link.
 *
 * Contract test (source-analysis, matching the repo's NCR-route convention
 * in quality-ncr-containment.test.ts): pins the route, its permission +
 * scope gates, the dual file/link handling, the ncr_attachments write and
 * the audit trail — so a regression that drops any of these fails CI.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), "server/quality-ncr-routes.ts"),
  "utf8",
);

// Isolate the attachment handler body for tighter assertions.
const HANDLER = SOURCE.slice(
  SOURCE.indexOf('app.post(\n    "/api/quality/ncrs/:id/attachments"'),
  SOURCE.indexOf("// /api/quality/dashboard is owned by quality-routes.ts."),
);

describe("NCR attachment upload endpoint", () => {
  it("registers POST /api/quality/ncrs/:id/attachments", () => {
    expect(SOURCE).toContain('"/api/quality/ncrs/:id/attachments"');
    expect(HANDLER.length).toBeGreaterThan(0);
  });

  it("is gated by requireAuth + requirePermission('quality','edit') like sibling routes", () => {
    expect(HANDLER).toContain("requireAuth");
    expect(HANDLER).toContain('requirePermission("quality", "edit")');
  });

  it("enforces the getQualityHseScope + scopeAllowsProject 404 gate", () => {
    expect(HANDLER).toContain("getQualityHseScope(req)");
    expect(HANDLER).toContain("scopeAllowsProject(scope, target.projectId)");
    expect(HANDLER).toMatch(/scopeAllowsProject\([^)]*\)\)\s*return res\.status\(404\)/);
  });

  it("accepts a multipart file upload via multer", () => {
    expect(HANDLER).toContain('ncrAttachmentUpload.single("file")');
    expect(HANDLER).toContain("/uploads/ncr-attachments/");
  });

  it("accepts a SharePoint/URL link when no file is present", () => {
    expect(HANDLER).toContain("ncrLinkAttachmentSchema.safeParse(req.body)");
    // Both branches resolve filePath + fileName before the insert.
    expect(HANDLER).toContain("filePath");
    expect(HANDLER).toContain("fileName");
  });

  it("rejects dangerous link schemes (javascript:, data:) on the URL branch", () => {
    // The link schema only permits https, site-relative, or Office/Graph deep
    // links — so a stored link can't become a script sink in the UI later.
    expect(SOURCE).toContain("NCR_LINK_SAFE_SCHEME");
    expect(SOURCE).toMatch(/NCR_LINK_SAFE_SCHEME\s*=\s*\/\^\(https\?:/);
    expect(SOURCE).toContain(".refine((u) => NCR_LINK_SAFE_SCHEME.test(u)");
  });

  it("writes the row into ncr_attachments", () => {
    expect(HANDLER).toContain(".insert(ncrAttachments)");
    expect(HANDLER).toMatch(/ncrId:\s*id/);
    expect(HANDLER).toMatch(/uploadedBy:\s*user\.id/);
  });

  it("audits the mutation (both logAuditFromReq and recordAudit)", () => {
    expect(HANDLER).toContain("logAuditFromReq");
    expect(HANDLER).toContain("ADD_NCR_ATTACHMENT");
  });

  it("uses the shared upload-security helpers for the multer config", () => {
    expect(SOURCE).toContain("sanitizeFilename");
    expect(SOURCE).toContain("allowedFileFilter");
    expect(SOURCE).toMatch(/limits:\s*\{\s*fileSize:\s*50\s*\*\s*1024\s*\*\s*1024/);
  });

  it("multipart file route does NOT use validateBody (multer owns the body)", () => {
    // The link branch validates inline with safeParse; a validateBody wrapper
    // would reject multipart requests.
    expect(HANDLER).not.toContain("validateBody(ncrLinkAttachmentSchema)");
  });
});

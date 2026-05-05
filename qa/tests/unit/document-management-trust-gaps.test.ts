/**
 * Document management trust-gap fixes — static analysis tests.
 *
 * Covers the four P0 fixes landed in this session:
 *   1. Approver role filtering — FolderFiles.tsx uses useApproverCandidates,
 *      not useUserNames.
 *   2. Server-side role validation — requestApproval rejects approvers whose
 *      role is not in requirement.approverRoles.
 *   3. Active Clients upload — Upload button rendered per provisioned folder.
 *   4. Download failure toast — onDownload shows an error toast on !res.ok.
 *
 * Also asserts the three state-transition paths in the service:
 *   draft → in_review   (requestApproval)
 *   in_review → approved (recordApproval)
 *   in_review → draft    (recordRejection)
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const serviceFile = fs.readFileSync(
  path.join(repoRoot, "server", "services", "managed-document-approvals-service.ts"),
  "utf8",
);
const routesFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "managed-document-approvals.routes.ts"),
  "utf8",
);
const hooksFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "hooks", "use-managed-document-approvals.ts"),
  "utf8",
);
const folderFilesComponent = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "FolderFiles.tsx"),
  "utf8",
);
const documentsPage = fs.readFileSync(
  path.join(repoRoot, "client", "src", "pages", "documents.tsx"),
  "utf8",
);

// =========================================================================
// State transitions (verified in the service layer)
// =========================================================================

describe("approval state transitions", () => {
  it("requestApproval transitions document to state='in_review'", () => {
    expect(serviceFile).toMatch(/state:\s*["']in_review["']/);
  });

  it("recordApproval transitions document to state='approved'", () => {
    expect(serviceFile).toMatch(/state:\s*["']approved["']/);
  });

  it("recordRejection transitions document back to state='draft'", () => {
    expect(serviceFile).toMatch(/state:\s*["']draft["']/);
  });

  it("recordRejection cancels sibling rows with an audit note", () => {
    expect(serviceFile).toMatch(/Cancelled\s*—\s*sibling approval .* rejected/);
  });
});

// =========================================================================
// Fix 2 — Server-side approver role validation
// =========================================================================

describe("fix 2: server-side approver role validation", () => {
  it("requestApproval checks approver roles against requirement.approverRoles", () => {
    expect(serviceFile).toMatch(/do not hold a required role/i);
  });

  it("validates by looking up the users table for each approver ID", () => {
    expect(serviceFile).toMatch(/inArray\(users\.id,\s*dedup\)/);
  });

  it("routes file maps the role-validation error to a 400 bad-request", () => {
    expect(routesFile).toMatch(/do not hold a required role/i);
    expect(routesFile).toMatch(/return badRequest\(msg\)/);
  });
});

// =========================================================================
// Fix 1 — Approver candidate filtering in the UI
// =========================================================================

describe("fix 1: approver candidate endpoint and UI filtering", () => {
  it("service exports getApproverCandidatesForDocument", () => {
    expect(serviceFile).toMatch(/export async function getApproverCandidatesForDocument/);
  });

  it("service filters by role when requiredRoles is set", () => {
    expect(serviceFile).toMatch(/inArray\(users\.role,\s*requiredRoles\)/);
  });

  it("routes file registers GET /approver-candidates endpoint", () => {
    expect(routesFile).toMatch(/\/api\/managed-documents\/:id\/approver-candidates/);
  });

  it("routes file gates approver-candidates on documents:view", () => {
    // The endpoint uses requirePermission('documents', 'view')
    expect(routesFile).toMatch(/requirePermission\(["']documents["'],\s*["']view["']\)/);
  });

  it("hooks file exports useApproverCandidates", () => {
    expect(hooksFile).toMatch(/export function useApproverCandidates/);
  });

  it("FolderFiles uses useApproverCandidates, not useUserNames", () => {
    expect(folderFilesComponent).toMatch(/useApproverCandidates/);
    expect(folderFilesComponent).not.toMatch(/useUserNames/);
  });

  it("FolderFiles shows a loading state while candidates are fetched", () => {
    expect(folderFilesComponent).toMatch(/Loading eligible approvers/);
  });

  it("FolderFiles shows required roles hint in the approvers label", () => {
    expect(folderFilesComponent).toMatch(/requiredRoles/);
  });
});

// =========================================================================
// Fix 3 — Upload from Active Clients view
// =========================================================================

describe("fix 3: upload button in Active Clients view", () => {
  it("ActiveClientsView calls useDocumentRoots to resolve projectRootId", () => {
    expect(documentsPage).toMatch(/useDocumentRoots\(\)/);
    expect(documentsPage).toMatch(/projectRootId/);
  });

  it("renders an upload button per provisioned folder", () => {
    expect(documentsPage).toMatch(/btn-active-clients-upload-/);
  });

  it("mounts UploadDialog with the folder itemId as parentItemId", () => {
    expect(documentsPage).toMatch(/uploadFolderItemId/);
    expect(documentsPage).toMatch(/parentItemId=\{uploadFolderItemId\}/);
  });
});

// =========================================================================
// Fix 4 — Download failure toast
// =========================================================================

describe("fix 4: download failure toast", () => {
  it("documents page imports toast", () => {
    expect(documentsPage).toMatch(/import.*toast.*from.*use-toast/);
  });

  it("onDownload calls toast on !res.ok rather than silently returning", () => {
    // Must call toast before the return (not just 'return' bare).
    expect(documentsPage).toMatch(/title:\s*["']Download failed["']/);
    expect(documentsPage).toMatch(/variant:\s*["']destructive["']/);
  });

  it("the silent bare 'if (!res.ok) return' is gone", () => {
    // The old pattern was a single-line guard with no toast call.
    expect(documentsPage).not.toMatch(/if\s*\(!res\.ok\)\s*return;/);
  });
});

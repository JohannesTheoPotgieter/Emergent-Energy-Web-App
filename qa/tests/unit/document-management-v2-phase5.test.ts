/**
 * D6 Phase 5 — managed-document approvals service + routes + UI shape.
 *
 * Static analysis tests. Verifies:
 *   1. The service uses MANAGED_DOCUMENT_APPROVAL_TYPE consistently for
 *      approvalType + relatedEntityType (so the legacy 'controlled_document'
 *      discriminator never leaks back in).
 *   2. recordApproval honours requires_all_approvers correctly (route
 *      different paths for the all-required vs any-of-many cases).
 *   3. recordRejection cancels pending sibling approvals.
 *   4. Routes are registered, gated on the right permissions, and audit-log
 *      every mutation.
 *   5. The legacy `registerControlledDocumentRoutes` call site is retired.
 *   6. The approval queue UI mounts and exposes data-testids.
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
const indexFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "index.ts"),
  "utf8",
);
const queueComponent = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "ManagedDocumentApprovalQueue.tsx"),
  "utf8",
);
const projectDocsPage = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "ProjectDocumentsView.tsx"),
  "utf8",
);
const hooksFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "hooks", "use-managed-document-approvals.ts"),
  "utf8",
);

describe("D6 Phase 5 — service shape", () => {
  it("exports the four canonical functions", () => {
    expect(serviceFile).toMatch(/export async function requestApproval/);
    expect(serviceFile).toMatch(/export async function recordApproval/);
    expect(serviceFile).toMatch(/export async function recordRejection/);
    expect(serviceFile).toMatch(/export async function getApprovalQueueForUser/);
  });

  it("uses MANAGED_DOCUMENT_APPROVAL_TYPE for both approvalType and relatedEntityType", () => {
    expect(serviceFile).toMatch(
      /approvalType:\s*MANAGED_DOCUMENT_APPROVAL_TYPE/,
    );
    expect(serviceFile).toMatch(
      /relatedEntityType:\s*MANAGED_DOCUMENT_APPROVAL_TYPE/,
    );
  });

  it("never references the legacy 'controlled_document' discriminator", () => {
    expect(serviceFile).not.toMatch(/['"]controlled_document['"]/);
  });

  it("guards against duplicate pending approval rounds (idempotent submit)", () => {
    expect(serviceFile).toMatch(/pending approval round already exists/i);
  });

  it("requires at least one approver in requestApproval", () => {
    expect(serviceFile).toMatch(/At least one approver is required/i);
  });

  it("recordApproval branches on requires_all_approvers", () => {
    expect(serviceFile).toMatch(/requires_all_approvers|requiresAllApprovers/);
    expect(serviceFile).toMatch(/allApproved/);
    expect(serviceFile).toMatch(/sibling approval .* resolved first/);
  });

  it("recordRejection moves the document back to state='draft' and cancels pending siblings", () => {
    expect(serviceFile).toMatch(/state:\s*"draft"/);
    expect(serviceFile).toMatch(/Cancelled\s*—\s*sibling approval .* rejected/);
  });

  it("only the assigned approver can act on a row", () => {
    expect(serviceFile).toMatch(/Only the assigned approver/);
  });

  it("requires a non-empty rejection reason", () => {
    expect(serviceFile).toMatch(/Rejection reason is required/);
  });
});

describe("D6 Phase 5 — routes wiring", () => {
  it("exports registerManagedDocumentApprovalRoutes and registers it in routes/index.ts", () => {
    expect(routesFile).toMatch(/export function registerManagedDocumentApprovalRoutes/);
    expect(indexFile).toMatch(/registerManagedDocumentApprovalRoutes\(app\)/);
  });

  it("retires the legacy controlled-documents registration", () => {
    // The line must still exist (for the deprecation tracker) but as a
    // commented-out call site, not an active one.
    expect(indexFile).not.toMatch(/^\s*registerControlledDocumentRoutes\(app\);\s*$/m);
    expect(indexFile).toMatch(/retired in D6 Phase 5/);
  });

  it("gates request-approval on documents:edit (create folded into edit)", () => {
    // Collapsed model: the old documents:create gate is now documents:edit.
    expect(routesFile).toMatch(
      /requirePermission\(["']documents["'],\s*["']edit["']\)/,
    );
    // No legacy create action may linger on this entity.
    expect(routesFile).not.toMatch(
      /requirePermission\(["']documents["'],\s*["']create["']\)/,
    );
  });

  it("gates approve + reject on documents:edit (approve folded into edit)", () => {
    // Collapsed model: the old documents:approve gate is now documents:edit.
    // request-approval, approve, and reject are all mutating actions gated on
    // documents:edit — at least two edit gates exist (approve + reject).
    const editCount = routesFile.match(
      /requirePermission\(["']documents["'],\s*["']edit["']\)/g,
    );
    expect(editCount).toBeTruthy();
    expect((editCount ?? []).length).toBeGreaterThanOrEqual(2);
    expect(routesFile).not.toMatch(
      /requirePermission\(["']documents["'],\s*["']approve["']\)/,
    );
  });

  it("audit-logs request_approval, approve, and reject actions", () => {
    expect(routesFile).toMatch(/import\s*\{\s*logAuditFromReq\s*\}/);
    expect(routesFile).toMatch(/action:\s*"request_approval"/);
    expect(routesFile).toMatch(/action:\s*"approve"/);
    expect(routesFile).toMatch(/action:\s*"reject"/);
  });

  it("validates payloads with Zod (approverUserIds min 1, rejection reason min 1)", () => {
    expect(routesFile).toMatch(/z\.array\(z\.number\(\)\.int\(\)\.positive\(\)\)\.min\(1\)/);
    expect(routesFile).toMatch(/reason:\s*z\.string\(\)\.min\(1\)/);
  });
});

describe("D6 Phase 5 — UI wiring", () => {
  it("ManagedDocumentApprovalQueue mounts on /projects/:id/documents", () => {
    expect(projectDocsPage).toMatch(/<ManagedDocumentApprovalQueue/);
  });

  it("queue component imports its hooks from the canonical hooks file", () => {
    expect(queueComponent).toMatch(
      /from\s*["']@\/hooks\/use-managed-document-approvals["']/,
    );
  });

  it("queue exposes data-testids the smoke suite can target", () => {
    // Dynamic testids use template literals (e.g.
    // data-testid={`approval-queue-row-${row.approval.id}`}) while static
    // ones use plain strings. Allow either form so the assertion stays
    // robust against minor refactors.
    const staticIds = [
      "managed-document-approval-queue",
      "approval-queue-count",
      "approval-queue-table",
      "btn-approval-decision-submit",
      "textarea-approval-decision",
    ];
    const dynamicIdPrefixes = [
      "approval-queue-row-",
      "btn-approval-approve-",
      "btn-approval-reject-",
    ];
    for (const id of staticIds) {
      expect(queueComponent).toContain(`data-testid="${id}"`);
    }
    for (const prefix of dynamicIdPrefixes) {
      expect(queueComponent).toContain(prefix);
    }
  });
});

describe("D6 Phase 5 — hooks", () => {
  it("exports the four canonical hooks", () => {
    expect(hooksFile).toMatch(/export function useManagedDocumentApprovalQueue/);
    expect(hooksFile).toMatch(/export function useApprovalsForDocument/);
    expect(hooksFile).toMatch(/export function useApproveManagedDoc/);
    expect(hooksFile).toMatch(/export function useRejectManagedDoc/);
  });

  it("invalidates the queue cache on mutate so newly-resolved rows disappear", () => {
    expect(hooksFile).toMatch(/invalidateQueries\(\{\s*queryKey:\s*QUEUE_KEY\s*\}\)/);
  });
});

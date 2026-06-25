/**
 * Document management trust-gap fixes — static analysis tests.
 *
 * Covers the server/service-layer fixes that survive Phase 5:
 *   1. Approver role filtering — the approver-candidates endpoint + hook exist
 *      and the service filters candidates by the requirement's approver roles.
 *   2. Server-side role validation — requestApproval rejects approvers whose
 *      role is not in requirement.approverRoles.
 *
 * Also asserts the three state-transition paths in the service:
 *   draft → in_review   (requestApproval)
 *   in_review → approved (recordApproval)
 *   in_review → draft    (recordRejection)
 *
 * PHASE 5 DECOMMISSION: the FolderFiles.tsx component and the folder-keyed
 * Active-Clients upload/download surface in pages/documents.tsx were removed
 * with the manual-provisioning path; their UI-level assertions were dropped.
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
// Fix 1 — Approver candidate endpoint + role filtering
// =========================================================================

describe("fix 1: approver candidate endpoint and role filtering", () => {
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

  it("the approval requirement resolves on the discipline basis only (no taxonomy fallback)", () => {
    // Phase 5: loadRequirementForDocument resolves via disciplineFolderId →
    // binding → findMatchingRequirementByDiscipline; the legacy taxonomy
    // fallback (findMatchingRequirement) was removed.
    expect(serviceFile).toMatch(/findMatchingRequirementByDiscipline/);
    expect(serviceFile).toMatch(/getDisciplineFolderById/);
    expect(serviceFile).not.toMatch(/findMatchingRequirement\(/);
  });
});

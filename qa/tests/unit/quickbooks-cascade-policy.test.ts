/**
 * Task #30 — QuickBooks "Suggest matches" cascade + lock policy
 * governance tests.
 *
 * These tests pin down the security and safety contract of the new
 * admin-only suggest/preview/accept flow and the lock-policy applied to
 * the existing customer/vendor mapping mutate endpoints.
 *
 * They are static-source assertions (no DB, no HTTP) so they remain
 * deterministic and run with the rest of the unit suite.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

const QB_ROUTES = read("server/quickbooks-routes.ts");
const CASCADE_SVC = read("server/services/quickbooks-cascade-service.ts");

describe("Task #30 — admin-only guard on the four new cascade endpoints", () => {
  it.each([
    'app.post(\n    "/api/quickbooks/suggest-matches",\n    requireAuth,\n    requireAdmin',
    'app.post(\n    "/api/quickbooks/suggest-matches/preview-cascade",\n    requireAuth,\n    requireAdmin',
    'app.post(\n    "/api/quickbooks/suggest-matches/accept",\n    requireAuth,\n    requireAdmin',
    'app.post(\n    "/api/quickbooks/mappings/:scope/:id/unlock",\n    requireAuth,\n    requireAdmin',
  ])("endpoint signature %# is gated by requireAdmin", (snippet) => {
    expect(QB_ROUTES).toContain(snippet);
  });
});

describe("Task #30 — suggest-matches scope is restricted to customer + vendor", () => {
  it("does NOT expose expense_invoice / incoming_invoice scope (no dead-end paths)", () => {
    expect(QB_ROUTES).toContain('z.enum(["customer", "vendor"])');
    expect(QB_ROUTES).not.toContain(
      'z.enum(["customer", "vendor", "expense_invoice", "incoming_invoice"])',
    );
  });

  it("does not return 501 scope_not_implemented from any cascade endpoint", () => {
    expect(QB_ROUTES).not.toContain("scope_not_implemented");
  });
});

describe("Task #30 — lock policy is enforced on legacy mutate endpoints", () => {
  it("customer-mappings POST checks lockedAt and rejects non-admins with 403 mapping_locked", () => {
    expect(QB_ROUTES).toMatch(
      /app\.post\("\/api\/quickbooks\/customer-mappings"[\s\S]*?lockedExisting\?\.lockedAt && !isAdminRequest\(req\)[\s\S]*?"mapping_locked"/,
    );
  });

  it("customer-mappings DELETE checks lockedAt before soft-delete", () => {
    expect(QB_ROUTES).toMatch(
      /app\.delete\("\/api\/quickbooks\/customer-mappings\/:id"[\s\S]*?pre\?\.lockedAt && !isAdminRequest\(req\)[\s\S]*?"mapping_locked"/,
    );
  });

  it("vendor-mappings POST checks lockedAt and rejects non-admins", () => {
    expect(QB_ROUTES).toMatch(
      /app\.post\(\s*"\/api\/quickbooks\/vendor-mappings"[\s\S]*?existing\?\.lockedAt && !isAdminRequest\(req\)[\s\S]*?"mapping_locked"/,
    );
  });

  it("vendor-mappings DELETE checks lockedAt before soft-delete", () => {
    expect(QB_ROUTES).toMatch(
      /app\.delete\(\s*"\/api\/quickbooks\/vendor-mappings\/:id"[\s\S]*?pre\?\.lockedAt && !isAdminRequest\(req\)[\s\S]*?"mapping_locked"/,
    );
  });
});

describe("Task #30 — cascade service preserves COS / paid invariants", () => {
  it("MUST NOT mutate cos_realised — no .set/.values block writes to it", () => {
    // The cascade may READ cosRealised to decide whether to skip a row,
    // but it MUST NEVER assign it. Reject the assignment forms only:
    //   cosRealised: true | false | sql`...` | someExpression
    // appearing inside a .set({...}) or .values({...}) block. Type
    // annotations like `cosRealised: boolean | null` are allowed.
    const setOrValuesBlocks = CASCADE_SVC.match(/\.(?:set|values)\(\s*\{[\s\S]*?\}\s*\)/g) ?? [];
    for (const block of setOrValuesBlocks) {
      expect(block, `assignment to cosRealised found in: ${block}`).not.toMatch(/cosRealised\s*:/);
    }
  });

  it("MUST NOT mutate paid_date_confirmed — no .set/.values block writes to it", () => {
    const setOrValuesBlocks = CASCADE_SVC.match(/\.(?:set|values)\(\s*\{[\s\S]*?\}\s*\)/g) ?? [];
    for (const block of setOrValuesBlocks) {
      expect(block, `assignment to paidDateConfirmed found in: ${block}`).not.toMatch(/paidDateConfirmed\s*:/);
    }
  });

  it("preview surfaces COS-realised / paid-confirmed rows under willSkipReconciled", () => {
    expect(CASCADE_SVC).toContain('willSkipReconciled.push');
    expect(CASCADE_SVC).toMatch(/cos\?\.cosRealised\s*\|\|\s*cost\?\.paidDateConfirmed|cosRealised \? "COS already realised"/);
  });

  it("preview surfaces locked existing mappings under willSkipLocked", () => {
    expect(CASCADE_SVC).toContain('willSkipLocked.push');
    expect(CASCADE_SVC).toMatch(/lockedAt[\s\S]*?willSkipLocked/);
  });

  it("commit functions run inside a db.transaction", () => {
    expect(CASCADE_SVC).toContain("export async function commitCustomerCascade");
    expect(CASCADE_SVC).toContain("export async function commitVendorCascade");
    expect(CASCADE_SVC).toMatch(/await db\.transaction\(async \(tx: typeof db\)/);
  });
});

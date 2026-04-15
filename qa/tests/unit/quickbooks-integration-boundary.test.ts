/**
 * QuickBooks integration-boundary governance tests.
 *
 * These tests pin the second hardening pass that turns QuickBooks into a
 * controlled reconciliation boundary:
 *
 *   1. DB-level 1:1 enforcement on active quickbooks_invoice_links rows
 *      (partial unique indexes in the Drizzle schema + SQL migration).
 *   2. Service-level conflict-aware link writes (QuickBooksLinkConflictError).
 *   3. HTTP 409 mapping on POST /api/quickbooks/links and /revenue-links.
 *   4. Audit logging for link/unlink/map/unmap/disconnect + OAuth outcomes.
 *   5. Integration health wiring via recordIntegrationRun +
 *      getQuickBooksConnectionStatus health fields + QB_STALE_AFTER_MS.
 *   6. QuickBooksLinkConflictError shape (code, reason, conflicts).
 *
 * These are source-level checks (like finance-access-governance) so they
 * run without needing a live DB. For behaviour-level coverage the
 * QuickBooksLinkConflictError is also exercised directly.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QuickBooksLinkConflictError } from "../../../server/services/quickbooks-reconciliation-service";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const ROUTES = "server/quickbooks-routes.ts";
const SERVICE = "server/services/quickbooks-service.ts";
const RECON = "server/services/quickbooks-reconciliation-service.ts";
const SCHEMA = "shared/schema/integrations.ts";
const MIGRATION = "migrations/20260415_quickbooks_link_one_to_one.sql";
const ROLLBACK = "migrations/20260415_quickbooks_link_one_to_one_rollback.sql";
const ADMIN_PAGE = "client/src/pages/admin-quickbooks.tsx";

// ---------------------------------------------------------------------------
// 1. DB-level 1:1 enforcement
// ---------------------------------------------------------------------------

describe("QB hardening — 1:1 active link indexes", () => {
  it("declares the app-side partial unique index in Drizzle schema", () => {
    const schema = read(SCHEMA);
    expect(schema).toContain('uq_qb_links_app_entity_active');
    // The partial index must be keyed on (appEntityType, appEntityId, qbRealmId)
    // and filter WHERE deleted_at IS NULL.
    expect(schema).toMatch(/appEntityOneToOne[\s\S]*\.on\(table\.appEntityType, table\.appEntityId, table\.qbRealmId\)[\s\S]*\.where\(sql`\$\{table\.deletedAt\} IS NULL`\)/);
  });

  it("declares the QB-side partial unique index in Drizzle schema", () => {
    const schema = read(SCHEMA);
    expect(schema).toContain('uq_qb_links_qb_entity_active');
    expect(schema).toMatch(/qbEntityOneToOne[\s\S]*\.on\(table\.qbEntityType, table\.qbEntityId, table\.qbRealmId\)[\s\S]*\.where\(sql`\$\{table\.deletedAt\} IS NULL`\)/);
  });

  it("provides a forward SQL migration that de-duplicates then indexes", () => {
    const migration = read(MIGRATION);
    // Forward migration must de-duplicate both axes BEFORE creating indexes,
    // otherwise index creation fails on an existing duplicated dataset.
    expect(migration).toContain("PARTITION BY app_entity_type, app_entity_id, qb_realm_id");
    expect(migration).toContain("PARTITION BY qb_entity_type, qb_entity_id, qb_realm_id");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_links_app_entity_active");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_links_qb_entity_active");
    // It must only soft-delete (deleted_at = now()), never hard-delete.
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+quickbooks_invoice_links\b/i);
  });

  it("provides a matching rollback migration", () => {
    const rollback = read(ROLLBACK);
    expect(rollback).toContain("DROP INDEX IF EXISTS uq_qb_links_app_entity_active");
    expect(rollback).toContain("DROP INDEX IF EXISTS uq_qb_links_qb_entity_active");
  });
});

// ---------------------------------------------------------------------------
// 2. Service-level conflict error
// ---------------------------------------------------------------------------

describe("QuickBooksLinkConflictError", () => {
  it("carries a stable error code", () => {
    const err = new QuickBooksLinkConflictError({
      reason: "app_entity_already_linked",
      conflicts: [],
    });
    expect(err.code).toBe("quickbooks_link_conflict");
    expect(err.name).toBe("QuickBooksLinkConflictError");
  });

  it("carries the reason and conflicts array", () => {
    const fakeConflict = { id: 42 } as any;
    const err = new QuickBooksLinkConflictError({
      reason: "qb_entity_already_linked",
      conflicts: [fakeConflict],
    });
    expect(err.reason).toBe("qb_entity_already_linked");
    expect(err.conflicts).toHaveLength(1);
    expect(err.conflicts[0].id).toBe(42);
  });

  it("produces helpful default messages per reason", () => {
    const appErr = new QuickBooksLinkConflictError({
      reason: "app_entity_already_linked",
      conflicts: [],
    });
    expect(appErr.message).toMatch(/app line is already linked/i);

    const qbErr = new QuickBooksLinkConflictError({
      reason: "qb_entity_already_linked",
      conflicts: [],
    });
    expect(qbErr.message).toMatch(/QuickBooks document is already linked/i);

    const bothErr = new QuickBooksLinkConflictError({
      reason: "both",
      conflicts: [],
    });
    expect(bothErr.message).toMatch(/both/i);
  });
});

// ---------------------------------------------------------------------------
// 3. HTTP 409 mapping + audit logging
// ---------------------------------------------------------------------------

describe("QB hardening — HTTP 409 mapping and audit logging", () => {
  const routes = read(ROUTES);

  it("imports QuickBooksLinkConflictError and exposes a 409 handler", () => {
    expect(routes).toContain("QuickBooksLinkConflictError");
    expect(routes).toMatch(/function\s+handleLinkConflict/);
    expect(routes).toContain("res.status(409)");
    expect(routes).toContain('error: "conflict"');
    expect(routes).toContain("code: err.code");
  });

  it("audits every link write path (confirm, unlink, conflict)", () => {
    expect(routes).toContain("quickbooks.link.confirm");
    expect(routes).toContain("quickbooks.link.unlink");
    expect(routes).toContain("quickbooks.link.conflict");
  });

  it("audits every mapping write path (upsert, unmap)", () => {
    expect(routes).toContain("quickbooks.mapping.upsert");
    expect(routes).toContain("quickbooks.mapping.unmap");
  });

  it("audits OAuth connect / failure / disconnect outcomes", () => {
    expect(routes).toContain("quickbooks.oauth.connected");
    expect(routes).toContain("quickbooks.oauth.failed");
    expect(routes).toContain("quickbooks.disconnect");
  });

  it("returns 404 (not 500) when an unlink/unmap target does not exist", () => {
    // softDeleteLink / softDeleteCustomerMapping return the previous row or
    // null. The route must check for null and emit 404.
    const service = read(RECON);
    expect(service).toMatch(/export async function softDeleteLink[\s\S]*return row;\s*}/);
    expect(service).toMatch(/export async function softDeleteCustomerMapping[\s\S]*return row;\s*}/);
    expect(routes).toMatch(/const previous = await softDeleteLink[\s\S]*if \(!previous\)[\s\S]*res\.status\(404\)/);
    expect(routes).toMatch(/const previous = await softDeleteCustomerMapping[\s\S]*if \(!previous\)[\s\S]*res\.status\(404\)/);
  });
});

// ---------------------------------------------------------------------------
// 4. Integration health wiring
// ---------------------------------------------------------------------------

describe("QB hardening — integration health wiring", () => {
  const service = read(SERVICE);

  it("imports recordIntegrationRun and deriveIntegrationHealth", () => {
    expect(service).toContain("recordIntegrationRun");
    expect(service).toContain("deriveIntegrationHealth");
  });

  it("exposes a staleness window constant", () => {
    expect(service).toContain("QB_STALE_AFTER_MS");
  });

  it("records a run event on every outbound QB API call (success and failure)", () => {
    // qbGet wraps every path with recordQbRun for both the ok and error branches.
    expect(service).toMatch(/recordQbRun\([\s\S]*ok:\s*true/);
    expect(service).toMatch(/recordQbRun\([\s\S]*ok:\s*false/);
    expect(service).toMatch(/runType:\s*`qbGet:/);
  });

  it("records OAuth exchange and refresh outcomes as run events", () => {
    expect(service).toContain('runType: "oauth:exchange_code"');
    expect(service).toContain('runType: "oauth:refresh"');
    expect(service).toContain('runType: "oauth:disconnect"');
  });

  it("classifies failures into stable errorCodes for the dashboard", () => {
    expect(service).toContain("not_connected");
    expect(service).toContain("auth_expired");
    expect(service).toContain("rate_limited");
    expect(service).toContain("upstream_error");
  });

  it("status endpoint returns the hardened health shape", () => {
    expect(service).toContain("QuickBooksConnectionStatus");
    // Shape must include these fields — asserted against the interface.
    for (const field of [
      "health",
      "lastSuccessfulSyncAt",
      "lastFailedSyncAt",
      "lastFailureCode",
      "lastFailureReason",
      "isStale",
      "ageMs",
      "staleAfterMs",
    ]) {
      expect(service).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Client health surface
// ---------------------------------------------------------------------------

describe("QB hardening — admin page surfaces health + stale warning", () => {
  const adminPage = read(ADMIN_PAGE);

  it("consumes the new health fields from /api/quickbooks/status", () => {
    for (const field of [
      "lastSuccessfulSyncAt",
      "lastFailedSyncAt",
      "lastFailureCode",
      "lastFailureReason",
      "isStale",
      "health",
    ]) {
      expect(adminPage).toContain(field);
    }
  });

  it("renders an integration-health summary card with test ids", () => {
    expect(adminPage).toContain('data-testid="qb-health-summary"');
    expect(adminPage).toContain('data-testid="qb-last-success"');
    expect(adminPage).toContain('data-testid="qb-last-failure"');
  });

  it("documents the required Replit secrets (client id + secret + redirect uri + sandbox)", () => {
    expect(adminPage).toContain("QUICKBOOKS_CLIENT_ID");
    expect(adminPage).toContain("QUICKBOOKS_CLIENT_SECRET");
    expect(adminPage).toContain("QUICKBOOKS_REDIRECT_URI");
    expect(adminPage).toContain("QUICKBOOKS_SANDBOX");
  });
});

/**
 * PD function release safety tests.
 *
 * These are source-code contract tests — they read the actual source
 * files and assert that critical invariants (permission guards, audit
 * calls, data-safety patterns) are still present. They catch
 * accidental deletions of safety checks without requiring a running
 * database or server.
 *
 * Grouped by the PD flow they protect:
 *   1. Opportunity CRUD permission alignment
 *   2. Pipedrive sync safety
 *   3. PD data trust (client IDs, audit, required fields)
 *   4. Project creation from opportunity
 *   5. Permission guards on PD GET routes
 *   6. Schema deprecation markers
 *   7. Handover state machine
 *   8. PD request-type consistency
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
import { evaluatePermissionForRole } from "@shared/permission-resolver";

function read(file: string): string {
  return fs.readFileSync(path.resolve(file), "utf8");
}

// =====================================================================
// 1. OPPORTUNITY CRUD PERMISSION ALIGNMENT
// =====================================================================

describe("opportunity permission alignment", () => {
  const source = read("server/departments/opportunities-routes.ts");

  it("guards all 5 opportunity routes with the opportunities entity, not pd_tickets", () => {
    // GET list + GET detail
    const getGuards = source.match(/requirePermission\("opportunities",\s*"view"\)/g) || [];
    expect(getGuards.length).toBeGreaterThanOrEqual(2);

    // POST
    expect(source).toContain('requirePermission("opportunities", "create")');

    // PATCH
    expect(source).toContain('requirePermission("opportunities", "edit")');

    // DELETE
    expect(source).toContain('requirePermission("opportunities", "delete")');
  });

  it("does NOT use pd_tickets or pd_dashboard as guards on opportunity routes", () => {
    expect(source).not.toContain('requirePermission("pd_tickets"');
    expect(source).not.toContain('requirePermission("pd_dashboard"');
  });

  it("has opportunities registered in ENTITY_PERMISSION_DEFAULTS", () => {
    const entry = ENTITY_PERMISSION_DEFAULTS.find(
      (e: any) => e.entity === "opportunities",
    );
    expect(entry).toBeDefined();
    expect(entry!.view_roles).toContain("KEY_ACCOUNTS_MANAGER");
    expect(entry!.create_roles).toContain("PROJECT_DEVELOPER");
    expect(entry!.create_roles).toContain("CCO");
    expect(entry!.delete_roles).toContain("COO_ADMIN");
  });

  it("evaluates opportunities:create for KEY_ACCOUNTS_MANAGER via defaults", () => {
    const result = evaluatePermissionForRole({
      role: "KEY_ACCOUNTS_MANAGER",
      entity: "opportunities",
      action: "create",
    });
    expect(result.allowed).toBe(true);
    expect(result.source).toBe("default");
  });

  it("blocks ENGINEER from opportunities:view by default", () => {
    const result = evaluatePermissionForRole({
      role: "ENGINEER",
      entity: "opportunities",
      action: "view",
    });
    expect(result.allowed).toBe(false);
  });

  it("writes audit events for create, update, and soft-delete", () => {
    expect(source).toContain('entityType: "opportunity"');
    expect(source).toContain('"create"');
    expect(source).toContain('"update_crm_field_on_synced_row"');
    expect(source).toContain('"soft_delete"');
  });

  it("strips source and pipedriveDealId from PATCH payloads", () => {
    expect(source).toContain("source: _source, ...safeFields");
  });

  it("forces source=internal on manual POST create", () => {
    expect(source).toContain('source: "internal"');
  });
});

// =====================================================================
// 2. PIPEDRIVE SYNC SAFETY
// =====================================================================

describe("pipedrive sync safety", () => {
  const syncSource = read("server/services/pipedrive-sync-service.ts");
  const routeSource = read("server/departments/pipedrive-routes.ts");

  it("does NOT include notes in crmOwnedFields (prevents data loss)", () => {
    // The crmOwnedFields object must not contain a 'notes' key.
    // Notes are set only on create, not on every update.
    const crmBlock = syncSource.slice(
      syncSource.indexOf("const crmOwnedFields"),
      syncSource.indexOf("if (existing)"),
    );
    expect(crmBlock).not.toContain("notes:");
    expect(crmBlock).not.toContain("notes :");
  });

  it("stamps source=pipedrive in crmOwnedFields", () => {
    expect(syncSource).toContain('source: "pipedrive"');
  });

  it("seeds notes with Pipedrive title on CREATE only", () => {
    // The insert path (not the update path) should include notes.
    expect(syncSource).toContain("notes: `Pipedrive: ${dealTitle}`");
  });

  it("has a concurrency guard that returns 409 when sync is already running", () => {
    expect(routeSource).toContain("409");
    expect(routeSource).toContain("Sync already in progress");
  });

  it("has a stale-running sweep using make_interval", () => {
    expect(routeSource).toContain("make_interval");
    expect(routeSource).toContain("STUCK_RUNNING_THRESHOLD_MINUTES");
  });

  it("records integration health via safeRecordRun", () => {
    expect(syncSource).toContain("safeRecordRun");
    expect(syncSource).toContain('name: "pipedrive"');
  });

  it("handles per-deal errors without aborting the full sync", () => {
    expect(syncSource).toContain("result.errors.push(`Deal ${deal.id}:");
  });
});

// =====================================================================
// 3. PD DATA TRUST
// =====================================================================

describe("PD data trust", () => {
  const pdRoutes = read("server/pd-routes.ts");
  const clientGen = read("server/lib/client-id-generator.ts");
  const clientsExtracted = read("server/routes/clients-extracted-routes.ts");

  it("uses advisory lock in client ID generator", () => {
    expect(clientGen).toContain("pg_advisory_xact_lock");
    expect(clientGen).toContain("CLIENT_ID_ADVISORY_LOCK_KEY");
  });

  it("both client create paths use the shared generator", () => {
    expect(pdRoutes).toContain("insertClientWithGeneratedId");
    expect(clientsExtracted).toContain("insertClientWithGeneratedId");
  });

  it("does NOT have the old COUNT-based generateClientId in pd-routes", () => {
    expect(pdRoutes).not.toMatch(/async function generateClientId/);
  });

  it("audit-logs PD ticket creation with key linkage fields", () => {
    expect(pdRoutes).toContain('entityType: "pd_ticket"');
    expect(pdRoutes).toContain('action: "create"');
    expect(pdRoutes).toContain("requestType: ticket.requestType");
    expect(pdRoutes).toContain("projectId: ticket.projectId");
  });

  it("audit-logs PD ticket updates with changed fields", () => {
    expect(pdRoutes).toContain('action: "update"');
  });

  it("audit-logs client creation from PD route", () => {
    expect(pdRoutes).toContain('entityType: "client"');
  });

  it("validates projectId is required on PD ticket create", () => {
    expect(pdRoutes).toContain("Project linkage is required");
  });

  it("validates dueDate is required on PD ticket create", () => {
    expect(pdRoutes).toContain("Due date is required");
  });

  it("clients PATCH schema is strict and matches real columns", () => {
    expect(clientsExtracted).toContain("}).strict()");
    expect(clientsExtracted).toContain("primaryContactEmail");
    expect(clientsExtracted).toContain("primaryContactPhone");
    // Old broken fields must not appear in the schema
    expect(clientsExtracted).not.toContain("billingEmail:");
    expect(clientsExtracted).not.toContain("contactPerson:");
  });
});

// =====================================================================
// 4. PROJECT CREATION FROM OPPORTUNITY
// =====================================================================

describe("project creation from opportunity", () => {
  const templateRoutes = read("server/template-routes.ts");
  const projectCreateUI = read("client/src/pages/project-create.tsx");

  it("accepts opportunityId on POST /api/projects", () => {
    expect(templateRoutes).toContain("opportunityId");
    expect(templateRoutes).toContain("resolvedOpportunityId");
  });

  it("validates the opportunity exists before linking", () => {
    expect(templateRoutes).toContain("Linked opportunity not found");
  });

  it("carries clientId from the opportunity as fallback", () => {
    expect(templateRoutes).toContain("clientIdFromOpportunity");
  });

  it("logs create_from_opportunity audit event", () => {
    expect(templateRoutes).toContain('"create_from_opportunity"');
    expect(templateRoutes).toContain("logAuditFromReq");
  });

  it("warns on early-stage conversion (prospect/qualification)", () => {
    expect(templateRoutes).toContain("earlyStageAdvisory");
    expect(templateRoutes).toContain("_earlyStageAdvisory");
  });

  it("warns on duplicate conversion (same opportunityId already linked)", () => {
    expect(templateRoutes).toContain("duplicateConversionWarning");
    expect(templateRoutes).toContain("_duplicateConversionWarning");
  });

  it("surfaces CRM source on the response", () => {
    expect(templateRoutes).toContain("_opportunitySource");
  });

  it("client UI reads opportunityId from URL query params", () => {
    expect(projectCreateUI).toContain("opportunityIdParam");
    expect(projectCreateUI).toContain("opportunityId");
  });

  it("client UI shows conversion banner when opportunity is loaded", () => {
    expect(projectCreateUI).toContain("Creating project from opportunity");
  });

  it("client UI shows early-stage advisory banner", () => {
    expect(projectCreateUI).toContain("This opportunity is in the");
    expect(projectCreateUI).toContain("prospect");
  });
});

// =====================================================================
// 5. PERMISSION GUARDS ON PD GET ROUTES
// =====================================================================

describe("permission guards on PD GET routes", () => {
  const pdRoutes = read("server/pd-routes.ts");

  it("guards GET /api/pd/clients with pd_clients:view", () => {
    // Find the GET /api/pd/clients line and verify the guard
    const clientsGet = pdRoutes.match(
      /app\.get\("\/api\/pd\/clients".*requirePermission\('pd_clients',\s*'view'\)/,
    );
    expect(clientsGet).not.toBeNull();
  });

  it("guards GET /api/pd/tickets with pd_tickets:view", () => {
    const ticketsGet = pdRoutes.match(
      /app\.get\("\/api\/pd\/tickets".*requirePermission\('pd_tickets',\s*'view'\)/,
    );
    expect(ticketsGet).not.toBeNull();
  });

  it("guards GET /api/pd/dashboard with pd_dashboard:view", () => {
    const dashGet = pdRoutes.match(
      /app\.get\("\/api\/pd\/dashboard".*requirePermission\('pd_dashboard',\s*'view'\)/,
    );
    expect(dashGet).not.toBeNull();
  });

  it("guards GET /api/pd/pipeline with pd_dashboard:view", () => {
    const pipeGet = pdRoutes.match(
      /app\.get\("\/api\/pd\/pipeline".*requirePermission\('pd_dashboard',\s*'view'\)/,
    );
    expect(pipeGet).not.toBeNull();
  });

  it("guards GET /api/pd/reports with pd_dashboard:view", () => {
    const reportsGet = pdRoutes.match(
      /app\.get\("\/api\/pd\/reports".*requirePermission\('pd_dashboard',\s*'view'\)/,
    );
    expect(reportsGet).not.toBeNull();
  });

  it("does NOT have any pd_tickets double-gate with canCreatePdTicket or isPdRole", () => {
    // These were removed because they contradicted the central
    // permission table and blocked CCO.
    expect(pdRoutes).not.toContain("canCreatePdTicket(role)");
    expect(pdRoutes).not.toContain("isPdRole(role)");
  });
});

// =====================================================================
// 6. SCHEMA DEPRECATION MARKERS
// =====================================================================

describe("schema deprecation markers", () => {
  const schema = read("shared/schema/projects.ts");

  it("marks handoverReadiness as @deprecated", () => {
    const idx = schema.indexOf("handoverReadiness");
    const block = schema.slice(Math.max(0, idx - 400), idx);
    expect(block).toContain("@deprecated");
  });

  it("marks dealOwnerUserId as @deprecated", () => {
    const idx = schema.indexOf("dealOwnerUserId");
    const block = schema.slice(Math.max(0, idx - 400), idx);
    expect(block).toContain("@deprecated");
  });

  it("marks clickUpSynced as @deprecated", () => {
    const idx = schema.indexOf("clickUpSynced");
    const block = schema.slice(Math.max(0, idx - 400), idx);
    expect(block).toContain("@deprecated");
  });

  it("marks estimatedKwh on opportunities as @deprecated", () => {
    // Find the first occurrence (opportunities), not the second (pd_tickets)
    const idx = schema.indexOf("estimatedKwh");
    const block = schema.slice(Math.max(0, idx - 300), idx);
    expect(block).toContain("@deprecated");
  });

  it("documents tasksSpawnedAt idempotency guard", () => {
    const idx = schema.indexOf("tasksSpawnedAt");
    const block = schema.slice(Math.max(0, idx - 400), idx);
    expect(block).toContain("idempotency guard");
  });
});

// =====================================================================
// 7. HANDOVER STATE MACHINE CONTRACT
// =====================================================================

describe("handover state machine contract", () => {
  const source = read("server/handover-routes.ts");

  it("supports DRAFT → SUBMITTED → ACCEPTED/REJECTED transitions", () => {
    expect(source).toContain("SUBMITTED_FOR_PM_REVIEW");
    expect(source).toContain("ACCEPTED");
    expect(source).toContain("REJECTED");
    expect(source).toContain("DRAFT");
  });

  it("records handover history for submit, accept, and reject", () => {
    expect(source).toContain("PD_PM_HANDOVER_SUBMITTED");
    expect(source).toContain("PD_PM_HANDOVER_ACCEPTED");
    expect(source).toContain("PD_PM_HANDOVER_REJECTED");
  });

  it("advances project phase on handover acceptance", () => {
    expect(source).toContain("projectPhaseHistory");
    expect(source).toContain("PD to PM handover accepted");
  });
});

// =====================================================================
// 8. PD REQUEST-TYPE CONSISTENCY
// =====================================================================

describe("PD request-type consistency", () => {
  const requestTypes = read("client/src/lib/pd/request-types.ts");
  const ticketList = read("client/src/pages/pd-tickets.tsx");
  const ticketCreate = read("client/src/pages/pd-ticket-create.tsx");

  it("has a canonical request-types file with ACTIVE and FILTERABLE exports", () => {
    expect(requestTypes).toContain("PD_REQUEST_TYPES_ACTIVE");
    expect(requestTypes).toContain("PD_REQUEST_TYPES_FILTERABLE");
    expect(requestTypes).toContain("PD_REQUEST_TYPES_LEGACY");
  });

  it("ticket list imports the filterable list from the canonical file", () => {
    expect(ticketList).toContain("PD_REQUEST_TYPES_FILTERABLE");
    expect(ticketList).toContain("@/lib/pd/request-types");
  });

  it("ticket create imports the active list from the canonical file", () => {
    expect(ticketCreate).toContain("PD_REQUEST_TYPES_ACTIVE");
    expect(ticketCreate).toContain("@/lib/pd/request-types");
  });

  it("does NOT have hardcoded request type arrays in either page", () => {
    // Both pages should import from the canonical file, not define inline
    expect(ticketList).not.toMatch(
      /const REQUEST_TYPES\s*=\s*\["Cost Proposal"/,
    );
    expect(ticketCreate).not.toMatch(
      /const REQUEST_TYPES\s*=\s*\["Cost Proposal"/,
    );
  });
});

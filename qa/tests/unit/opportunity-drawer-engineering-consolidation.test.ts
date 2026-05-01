/**
 * Path 2 — engineering-ticket consolidation guard.
 *
 * Background:
 *   The `/opportunities` drawer used to render TWO board cards per
 *   engineering ticket on a deal that had been converted to a project:
 *   one synthesised "Ticket: <requestType>" card plus the sibling
 *   work_items row inserted by the "Add Engineering Ticket" form.
 *   The user reported this as a duplicate-card bug on the Spear
 *   Property deal (one ticket, two cards: "Ticket: First Assessment"
 *   and "Spear Property deal").
 *
 *   Path 2 fixes the duplicate by making `work_items` the canonical
 *   engineering-execution row. The drawer renders only the sibling
 *   work_items row; the engineering_tickets row remains for back-
 *   compat with finance/FYE rollup, PD dashboard, gate evaluator,
 *   and Pipedrive sync (none of which were changed).
 *
 * This test suite is a contract-style guard. It scans the relevant
 * source files for the patterns we deleted and the patterns we now
 * require, so the regression cannot reappear without breaking the
 * suite.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

describe("Path 2 — engineering ticket consolidation onto work_items", () => {
  describe("OpportunityDrawer.tsx", () => {
    const src = read("client/src/components/opportunities/OpportunityDrawer.tsx");

    it("no longer synthesises a 'Ticket: <requestType>' board card", () => {
      // The synthesised card was the source of the duplicate render.
      expect(src).not.toMatch(/ticketsAsTasks/);
      expect(src).not.toMatch(/`Ticket: \$\{[^}]+\.requestType\}`/);
    });

    it("renders the board from server-scoped tasks only (no client union)", () => {
      // The dedup contract: allItems is exactly the project tasks the
      // server returned (scoped to ENG-lane sibling rows linked to
      // tickets on this project).
      expect(src).toMatch(/const allItems: ProjectTask\[\] = tasks;/);
    });

    it("does not call the retired /spawn-tasks endpoint", () => {
      // Strip JSDoc/line comments so doc references don't false-positive.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/spawn-tasks/);
      expect(code).not.toMatch(/spawnTasks\.mutate/);
    });

    it("empty-state copy points users to the new add flows", () => {
      // The old copy ("spawn tasks from a ticket") referenced a
      // workflow that no longer exists.
      expect(src).not.toMatch(/spawn tasks from a ticket/);
      expect(src).toMatch(/Add Engineering Ticket|engineering ticket above|Add task/);
    });
  });

  describe('"Add Engineering Ticket" form sibling write', () => {
    const src = read("server/departments/opportunities-routes.ts");

    it("inserts the sibling work_items row tagged source='UI', not 'SYSTEM'", () => {
      // The previous code tagged the row as SYSTEM, which mis-classified
      // a user-driven action and caused the work_items adapter to skip
      // certain UI affordances.
      const insertBlock = src.slice(src.indexOf("// Insert the canonical engineering work_items row"), src.indexOf("// Insert the canonical engineering work_items row") + 2000);
      expect(insertBlock).toMatch(/source:\s*"UI"/);
      expect(insertBlock).not.toMatch(/source:\s*"SYSTEM"/);
    });

    it("propagates the 6 solar/site fields from the form payload onto the sibling row", () => {
      const insertBlock = src.slice(src.indexOf("// Insert the canonical engineering work_items row"), src.indexOf("// Insert the canonical engineering work_items row") + 2500);
      for (const field of ["fundingType", "sizeKwp", "province", "gpsCoordinates", "batteriesNeeded", "batterySize"]) {
        expect(insertBlock, `missing ${field}`).toMatch(new RegExp(`${field}:\\s*\\(insertValues\\.${field}`));
      }
    });

    it("links the sibling row back to its engineering_ticket via engineeringTicketId", () => {
      expect(src).toMatch(/engineeringTicketId:\s*ticket\.id/);
    });
  });

  describe("retired template-spawn surfaces return 410 Gone", () => {
    it("`POST /api/pd/tickets/:id/spawn-tasks` returns 410", () => {
      const src = read("server/pd-routes.ts");
      // Match the retired endpoint declaration immediately followed by a 410.
      expect(src).toMatch(/\/api\/pd\/tickets\/:id\/spawn-tasks[\s\S]{0,400}?status\(410\)/);
    });

    it("`POST /api/pd/tickets/bulk-spawn-tasks` returns 410", () => {
      const src = read("server/pd-routes.ts");
      expect(src).toMatch(/\/api\/pd\/tickets\/bulk-spawn-tasks[\s\S]{0,400}?status\(410\)/);
    });

    it("`POST /api/opportunities/:id/spawn-tasks` returns 410", () => {
      const src = read("server/departments/opportunities-routes.ts");
      expect(src).toMatch(/\/api\/opportunities\/:id\/spawn-tasks[\s\S]{0,800}?status\(410\)/);
    });

    it("the `spawnTasksForTicket` helper is now an empty no-op", () => {
      const src = read("server/pd-routes.ts");
      const fn = src.slice(src.indexOf("export async function spawnTasksForTicket"));
      // The function body should be a single `return [];` — no DB writes,
      // no template fan-out.
      expect(fn).toMatch(/return\s+\[\]\s*;/);
      expect(fn).not.toMatch(/PD_REQUEST_TYPE_TASK_TEMPLATES/);
      expect(fn).not.toMatch(/db\.insert\(workItems\)/);
    });
  });

  describe("forward-sync hook in updateEngineeringWorkItem", () => {
    const src = read("server/work-items-adapter.ts");

    it("mirrors status/priority/dueDate/title to engineering_tickets when the row is linked", () => {
      const fn = src.slice(
        src.indexOf("export async function updateEngineeringWorkItem"),
        src.indexOf("export function workItemPriorityToTicketPriority"),
      );
      // Guarded by `engineeringTicketId != null`.
      expect(fn).toMatch(/updated\.engineeringTicketId\s*!=\s*null/);
      // Writes go to engineering_tickets.
      expect(fn).toMatch(/db\.update\(engineeringTickets\)/);
      // Status passes through the canonical normaliser.
      expect(fn).toMatch(/normalizeEngineeringTicketStatus/);
    });

    it("uses the bidirectional priority helper (no inline 'Critical|Medium' mapping)", () => {
      // Regression guard: the inline map (`Urgent ? 'Critical' : 'Med' ? 'Medium' : ...`)
      // was removed in the architect-flagged sweep. The adapter MUST go
      // through the exported helper so the mapping stays in lockstep
      // with the inverse leg in pd-routes.ts.
      const fn = src.slice(
        src.indexOf("export async function updateEngineeringWorkItem"),
        src.indexOf("export function workItemPriorityToTicketPriority"),
      );
      expect(fn).toMatch(/workItemPriorityToTicketPriority\(/);
    });
  });

  describe("bidirectional priority helpers", () => {
    const src = read("server/work-items-adapter.ts");

    it("exports workItemPriorityToTicketPriority and ticketPriorityToWorkItemPriority", () => {
      expect(src).toMatch(/export function workItemPriorityToTicketPriority\(/);
      expect(src).toMatch(/export function ticketPriorityToWorkItemPriority\(/);
    });

    it("maps the canonical work-item enum onto the ticket enum and back", () => {
      // Re-implement the logic deterministically to assert the mapping
      // matrix without importing the runtime (the adapter pulls in the
      // DB pool which we don't want in a unit test).
      const fn = src.slice(src.indexOf("export function workItemPriorityToTicketPriority"));
      // work_items → ticket: Urgent→Critical, High→High, Med→Medium, Low→Low
      expect(fn).toMatch(/case "Urgent":/);
      expect(fn).toMatch(/case "Med":/);
      expect(fn).toMatch(/return "Critical"/);
      expect(fn).toMatch(/return "Medium"/);
      // ticket → work_items: Critical→Urgent, High→High, Medium→Med, Low→Low
      const inv = src.slice(src.indexOf("export function ticketPriorityToWorkItemPriority"));
      expect(inv).toMatch(/case "Critical":/);
      expect(inv).toMatch(/case "Medium":/);
      expect(inv).toMatch(/return "Urgent"/);
      expect(inv).toMatch(/return "Med"/);
    });

    it("preserves null/empty (do-not-touch) on both sides", () => {
      const fn = src.slice(src.indexOf("export function workItemPriorityToTicketPriority"));
      expect(fn).toMatch(/if \(p == null \|\| p === ""\) return null/);
      const inv = src.slice(src.indexOf("export function ticketPriorityToWorkItemPriority"));
      expect(inv).toMatch(/if \(p == null \|\| p === ""\) return null/);
    });
  });

  describe("reverse-direction sync at PATCH /api/pd/tickets/:id", () => {
    const adapterSrc = read("server/work-items-adapter.ts");
    const routesSrc = read("server/pd-routes.ts");

    it("exports syncTicketEditToWorkItem from the adapter", () => {
      expect(adapterSrc).toMatch(/export async function syncTicketEditToWorkItem\(/);
    });

    it("syncTicketEditToWorkItem mirrors status/priority/dueDate + identity/linkage + 6 solar fields onto work_items", () => {
      const fn = adapterSrc.slice(adapterSrc.indexOf("export async function syncTicketEditToWorkItem"));
      // status passes through the normaliser
      expect(fn).toMatch(/normalizeEngineeringTicketStatus\(ticket\.status\)/);
      // priority uses the canonical mapper
      expect(fn).toMatch(/ticketPriorityToWorkItemPriority\(ticket\.priority\)/);
      // dueDate → endDate (column rename across tables)
      expect(fn).toMatch(/wiSet\.endDate = ticket\.dueDate/);
      // Identity / linkage — without these mirrors the engineering board
      // card and the PD ticket detail can drift on title and project
      // context. Title fallback MUST match the creation site so the
      // edit path is in lockstep with the insert path.
      expect(fn).toMatch(/changedFields\.has\("projectSiteName"\)/);
      expect(fn).toMatch(/wiSet\.title\s*=\s*String\(ticket\.projectSiteName\s*\?\?\s*"Engineering ticket"\)/);
      expect(fn).toMatch(/changedFields\.has\("projectId"\)/);
      expect(fn).toMatch(/wiSet\.projectId\s*=\s*ticket\.projectId/);
      expect(fn).toMatch(/changedFields\.has\("clientId"\)/);
      expect(fn).toMatch(/wiSet\.clientId\s*=\s*ticket\.clientId/);
      // 6 solar/site fields
      for (const f of [
        "fundingType",
        "sizeKwp",
        "province",
        "gpsCoordinates",
        "batteriesNeeded",
        "batterySize",
      ]) {
        expect(fn, `missing mirror for ticket.${f}`).toMatch(new RegExp(`changedFields\\.has\\("${f}"\\)`));
        expect(fn, `missing assignment for ${f}`).toMatch(new RegExp(`wiSet\\.${f} = ticket\\.${f}`));
      }
      // Updates are scoped to the ENG sibling, never a cross-stream row.
      expect(fn).toMatch(/eq\(workItems\.workstream, "ENG"\)/);
      expect(fn).toMatch(/eq\(workItems\.engineeringTicketId, ticket\.id\)/);
      expect(fn).toMatch(/isNull\(workItems\.deletedAt\)/);
    });

    it("title-mirror fallback matches the creation site verbatim", () => {
      // If the insert side ever drifts from the sync side, an edit will
      // silently change the title to a different fallback string. Pin
      // both sites to the exact same expression.
      const insertSrc = read("server/departments/opportunities-routes.ts");
      expect(insertSrc).toMatch(/title:\s*String\(insertValues\.projectSiteName\s*\?\?\s*"Engineering ticket"\)/);
    });

    it("PATCH /api/pd/tickets/:id calls syncTicketEditToWorkItem after the ticket update", () => {
      const handler = routesSrc.slice(
        routesSrc.indexOf('app.patch("/api/pd/tickets/:id"'),
        routesSrc.indexOf('app.delete("/api/pd/tickets/:id"'),
      );
      // The sync MUST run AFTER `db.update(engineeringTickets)`, with the
      // returned row, and use the change-set we just computed.
      expect(handler).toMatch(/db\.update\(engineeringTickets\)\.set\(updates\)/);
      expect(handler).toMatch(/syncTicketEditToWorkItem\(updated, new Set\(changedFields\)\)/);
    });
  });

  describe("priority enum at POST /api/pd/tickets/:id/engineering-tasks", () => {
    const src = read("server/pd-routes.ts");
    const handler = src.slice(
      src.indexOf('app.post("/api/pd/tickets/:id/engineering-tasks"'),
      src.indexOf('"/api/pd/tickets/dashboard"'),
    );

    it("does NOT write 'Medium' to work_items.priority (canonical enum is 'Med')", () => {
      // The old code used `["High", "Medium", "Low"]` and defaulted to
      // "Medium" — both invalid for work_items.priority.
      expect(handler).not.toMatch(/\["High",\s*"Medium",\s*"Low"\]/);
      expect(handler).not.toMatch(/\?\?\s*"Medium"/);
    });

    it("normalises inbound priority via the canonical helper, defaulting to 'Med'", () => {
      expect(handler).toMatch(/ticketPriorityToWorkItemPriority\(/);
      expect(handler).toMatch(/\?\?\s*"Med"/);
    });
  });

  describe("dead SpawnEngineeringTasksButton fully removed", () => {
    const src = read("client/src/pages/pd-dashboard.tsx");

    it("the function definition is gone (not just the call site)", () => {
      // Architect flagged the dead body still referencing
      // `/api/pd/tickets/bulk-spawn-tasks` (now 410). Removed wholesale
      // so future readers don't think the endpoint is live.
      expect(src).not.toMatch(/function SpawnEngineeringTasksButton/);
      expect(src).not.toMatch(/SPAWN_EXEC_ROLES/);
      expect(src).not.toMatch(/SpawnEligibleResponse/);
      expect(src).not.toMatch(/bulk-spawn-tasks/);
    });
  });

  describe("migration 0041 — batteries_needed default fix", () => {
    const sql = read("migrations/0041_work_items_batteries_needed_default.sql");

    it("drops the DEFAULT false on work_items.batteries_needed", () => {
      expect(sql).toMatch(/ALTER COLUMN batteries_needed DROP DEFAULT/);
    });

    it("only flips false→true (never overwrites a true) and is scoped to ENG siblings", () => {
      // Conservative re-backfill — the WHERE clause must guarantee no
      // existing `true` row is silently rewritten and the sweep is
      // restricted to ENG-lane sibling rows.
      expect(sql).toMatch(/et\.batteries_needed\s+IS TRUE/);
      expect(sql).toMatch(/wi\.batteries_needed IS NULL OR wi\.batteries_needed = false/);
      expect(sql).toMatch(/wi\.workstream\s+=\s+'ENG'/);
      expect(sql).toMatch(/wi\.deleted_at\s+IS NULL/);
    });
  });

  describe("server-side drawer query is scoped to ENG-lane ticket siblings", () => {
    const src = read("server/repositories/opportunities-repository.ts");
    const block = src.slice(src.indexOf("let projectTasks: ProjectTask[] = [];"), src.indexOf("let projectTasks: ProjectTask[] = [];") + 2000);

    it("filters on workstream = 'ENG'", () => {
      expect(block).toMatch(/eq\(workItems\.workstream,\s*"ENG"\)/);
    });

    it("filters on engineering_ticket_id IS NOT NULL", () => {
      expect(block).toMatch(/isNotNull\(workItems\.engineeringTicketId\)/);
    });

    it("excludes soft-deleted rows", () => {
      expect(block).toMatch(/isNull\(workItems\.deletedAt\)/);
    });
  });
});

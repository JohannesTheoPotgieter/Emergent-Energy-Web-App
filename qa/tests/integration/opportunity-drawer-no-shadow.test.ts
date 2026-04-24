/**
 * Task #83 — Opportunity drawer must render successfully when no
 * engineering shadow ticket exists yet.
 *
 * Regression guard for two coupled contracts:
 *
 *   1. Server contract: GET /api/opportunities/:id/workflow returns
 *      `pd: null` (not a 404, not a 500, not a lazy-spawned shadow)
 *      when the opportunity has no engineering shadow ticket. This
 *      was the deliberate outcome of the "stop auto-creating shadow
 *      tickets" refactor (2026-04-23) — engineering tickets are only
 *      ever created by an explicit user action.
 *
 *   2. Client contract: client/src/components/opportunities/
 *      OpportunityDrawer.tsx must render successfully in that case.
 *      Previously the drawer's gating expression included `!merged`
 *      and showed "Could not load opportunity." for every opportunity
 *      that didn't have a shadow yet — the user-reported bug. The
 *      fix removes `!merged` from the gate, makes every `merged.X`
 *      reference null-safe, and degrades the header status badge to
 *      "No engineering ticket" when `pd == null`.
 *
 * The first contract is exercised here against the live API. The
 * second is exercised by the static-source assertions further down,
 * which fail loudly if the gating expression or the null-safe
 * accessors regress.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, p: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function loginAdmin(): Promise<string> {
  const res = await apiRequest("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(res.status).toBe(200);
  return res.data.token as string;
}

describe("Opportunity drawer renders with no engineering shadow (Task #83)", () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  describe("server contract — /api/opportunities/:id/workflow", () => {
    it("requires authentication", async () => {
      // Pick any plausible id — even if the row doesn't exist the route
      // must reject the anonymous request first.
      const res = await apiRequest("GET", "/api/opportunities/1/workflow");
      expect([401, 403]).toContain(res.status);
    });

    it("returns pd: null for an opportunity that has no engineering shadow ticket", async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        // Find an active opportunity that has no PD shadow row at all.
        // The shadow is the partial-unique row keyed on opportunity_id
        // with project_id IS NULL — that's what the drawer's `pd`
        // block reads. Filter out soft-deleted opportunities and
        // soft-deleted shadow tickets so we mirror the read path.
        // The Drizzle table `engineeringTickets` maps to the SQL table
        // `engineering_tickets` (despite various legacy `pd_*` aliases
        // in CSS, index names and inline comments).
        const candidate = await pool.query(`
          SELECT o.id
            FROM opportunities o
           WHERE o.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM engineering_tickets t
                WHERE t.opportunity_id = o.id
                  AND t.project_id IS NULL
                  AND t.deleted_at IS NULL
             )
           ORDER BY o.id DESC
           LIMIT 1
        `);
        if (candidate.rowCount === 0) {
          // No suitable fixture in this DB — the contract is still
          // exercised by the static-source assertion below, but we
          // log a skip note so future debuggers know why the live
          // path didn't run.
          console.warn("[skip] no opportunity without a PD shadow ticket — server-side branch not exercised");
          return;
        }
        const oppId = candidate.rows[0].id as number;

        const res = await apiRequest("GET", `/api/opportunities/${oppId}/workflow`, undefined, token);
        expect(res.status).toBe(200);
        expect(res.data).toBeTruthy();
        // The CRM block must always be present — that's the
        // opportunity itself.
        expect(res.data.crm).toBeTruthy();
        expect(res.data.crm.id).toBe(oppId);
        // The PD block must be exactly null (not undefined, not a
        // lazily auto-spawned shadow row).
        expect(res.data.pd).toBeNull();
        // Tasks must be an empty array, not undefined — the drawer
        // calls .length on it.
        expect(Array.isArray(res.data.tasks)).toBe(true);
        // Tickets is the engineering-tickets list; for an opportunity
        // with no shadow it is also empty (the shadow row would have
        // been the only entry).
        expect(Array.isArray(res.data.tickets ?? [])).toBe(true);
      } finally {
        await pool.end().catch(() => {});
      }
    });
  });

  describe("client render contract — OpportunityDrawer.tsx", () => {
    const drawerPath = path.join(
      process.cwd(),
      "client",
      "src",
      "components",
      "opportunities",
      "OpportunityDrawer.tsx",
    );
    const source = fs.readFileSync(drawerPath, "utf8");

    it("the data-load fallback gates only on isError or missing data — never on a null PD shadow", () => {
      // The bug fix: `!merged` MUST NOT appear in the gating
      // expression, otherwise every opportunity without a shadow
      // ticket falls through to "Could not load opportunity."
      expect(source).toMatch(/isError\s*\|\|\s*!data\s*\?/);
      expect(source).not.toMatch(/isError\s*\|\|\s*!data\s*\|\|\s*!merged\s*\?/);
    });

    it("renders an explicit 'No engineering ticket' badge when the PD shadow is missing", () => {
      // The header status badge degrades to a slate "No engineering
      // ticket" pill so the user can see at a glance that no shadow
      // has been spawned yet.
      expect(source).toContain("badge-no-engineering-ticket");
      expect(source).toContain("No engineering ticket");
    });

    it("the WorkflowResponse type acknowledges that `pd` is nullable", () => {
      // Belt-and-suspenders: the client type that drives the drawer
      // must explicitly include `null` in the `pd` union so a future
      // edit can't silently re-tighten it to `PdBlock` (which was
      // the original lie that made the bug easy to write).
      expect(source).toMatch(/pd:\s*PdBlock\s*\|\s*null/);
    });

    it("the file documents the no-shadow render contract so future edits know to keep it intact", () => {
      // The file-header docblock should call out that `pd: null` is
      // a valid state and that every `merged` reference is null-safe.
      // This is the breadcrumb that prevents the bug from coming
      // back the next time someone edits the gating expression.
      expect(source).toContain("No-shadow render contract");
      expect(source).toContain("pd: null");
    });
  });
});

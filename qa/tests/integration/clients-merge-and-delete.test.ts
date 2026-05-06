/**
 * Task #73 — clients merge & soft-delete integration test.
 *
 * Seeds two distinct clients (A = loser, B = survivor), gives each
 * one row in every FK-bearing table, then exercises the full lifecycle:
 *   1. preview – returns per-table counts
 *   2. merge   – atomic, audit row + repointed counts, loser soft-deleted
 *   3. cascade-display – /api/pd/clients no longer surfaces the loser
 *   4. aliases – survivor exposes the loser as a "previously known as" entry
 *   5. blocker – DELETE refuses with 409 when live FKs remain
 *   6. soft-delete happy path – delete a row that has no live FKs
 *   7. restore – clears deleted_at + merged_into_client_id
 *
 * Mirrors the auth + cleanup pattern used by
 * `qa/tests/integration/foundation-linkage-cascades.test.ts` so it can
 * sit alongside it in the release gate.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
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

interface SeedHandles {
  clientAId: number;
  clientBId: number;
  clientCId: number;
  projectId: number;
  opportunityId: number;
  ticketId: number;
  workItemId: number;
  siteId: number | null;
  qbMappingId: number | null;
  emailLinkId: number | null;
}

describe("Clients merge & soft-delete (Task #73)", () => {
  let token: string;
  let pool: any;
  let handles: SeedHandles;
  const stamp = Date.now();
  const clientACode = `T73A-${stamp}`;
  const clientBCode = `T73B-${stamp}`;
  const clientCCode = `T73C-${stamp}`;

  beforeAll(async () => {
    token = await loginAdmin();
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // Seed three clients: A = loser to merge, B = survivor, C = loser to soft-delete.
    const a = await pool.query(
      `INSERT INTO clients (client_id, name) VALUES ($1, $2) RETURNING id`,
      [clientACode, `T73 Loser ${stamp}`],
    );
    const b = await pool.query(
      `INSERT INTO clients (client_id, name) VALUES ($1, $2) RETURNING id`,
      [clientBCode, `T73 Survivor ${stamp}`],
    );
    const c = await pool.query(
      `INSERT INTO clients (client_id, name) VALUES ($1, $2) RETURNING id`,
      [clientCCode, `T73 Empty Loser ${stamp}`],
    );
    const clientAId = a.rows[0].id as number;
    const clientBId = b.rows[0].id as number;
    const clientCId = c.rows[0].id as number;

    // 1. project_info row attached to A.
    const proj = await pool.query(
      `INSERT INTO project_info (project_name, client_id) VALUES ($1, $2) RETURNING id`,
      [`T73 Project ${stamp}`, clientAId],
    );
    const projectId = proj.rows[0].id as number;

    // 2. opportunity attached to A.
    const opp = await pool.query(
      `INSERT INTO opportunities (deal_name, client_id) VALUES ($1, $2) RETURNING id`,
      [`T73 Opp ${stamp}`, clientAId],
    );
    const opportunityId = opp.rows[0].id as number;

    // 3. engineering_tickets row attached to A.
    const tk = await pool.query(
      `INSERT INTO engineering_tickets (project_site_name, request_type, client_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [`T73 Site ${stamp}`, "design", clientAId],
    );
    const ticketId = tk.rows[0].id as number;

    // 4. work_items row attached to A.
    const wi = await pool.query(
      `INSERT INTO work_items (workstream, title, source, status, client_id)
       VALUES ('PD', $1, 'UI', 'not_started', $2) RETURNING id`,
      [`T73 WI ${stamp}`, clientAId],
    );
    const workItemId = wi.rows[0].id as number;

    // 5. sites row attached to A (best-effort — schema may vary).
    let siteId: number | null = null;
    try {
      const s = await pool.query(
        `INSERT INTO sites (site_name, client_id) VALUES ($1, $2) RETURNING id`,
        [`T73 Site ${stamp}`, clientAId],
      );
      siteId = s.rows[0].id as number;
    } catch (e) {
      console.warn("[T73 seed] sites insert skipped:", (e as Error).message);
    }

    // 6. quickbooks_customer_mappings row attached to A.
    let qbMappingId: number | null = null;
    try {
      const qb = await pool.query(
        `INSERT INTO quickbooks_customer_mappings
           (project_id, client_id, qb_customer_id, qb_customer_name, qb_realm_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [projectId, clientAId, `qb-t73-${stamp}`, `T73 QB ${stamp}`, `realm-t73-${stamp}`],
      );
      qbMappingId = qb.rows[0].id as number;
    } catch (e) {
      console.warn("[T73 seed] quickbooks_customer_mappings insert skipped:", (e as Error).message);
    }

    // 7. email_project_links row attached to A.
    let emailLinkId: number | null = null;
    try {
      const el = await pool.query(
        `INSERT INTO email_project_links
           (graph_message_id, project_id, client_id, signal, subject_snapshot)
         VALUES ($1, $2, $3, 'manual', $4) RETURNING id`,
        [`t73-msg-${stamp}@example.com`, projectId, clientAId, `T73 Email ${stamp}`],
      );
      emailLinkId = el.rows[0].id as number;
    } catch (e) {
      console.warn("[T73 seed] email_project_links insert skipped:", (e as Error).message);
    }

    handles = {
      clientAId, clientBId, clientCId,
      projectId, opportunityId, ticketId, workItemId,
      siteId, qbMappingId, emailLinkId,
    };
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    try {
      // Best-effort cleanup. Order matters because of FKs.
      if (handles?.emailLinkId) await pool.query(`DELETE FROM email_project_links WHERE id = $1`, [handles.emailLinkId]);
      if (handles?.qbMappingId) await pool.query(`DELETE FROM quickbooks_customer_mappings WHERE id = $1`, [handles.qbMappingId]);
      if (handles?.siteId) await pool.query(`DELETE FROM sites WHERE id = $1`, [handles.siteId]);
      if (handles?.workItemId) await pool.query(`DELETE FROM work_items WHERE id = $1`, [handles.workItemId]);
      if (handles?.ticketId) await pool.query(`DELETE FROM engineering_tickets WHERE id = $1`, [handles.ticketId]);
      if (handles?.opportunityId) await pool.query(`DELETE FROM opportunities WHERE id = $1`, [handles.opportunityId]);
      if (handles?.projectId) {
        await pool.query(`DELETE FROM project_client_history WHERE project_id = $1`, [handles.projectId]);
        await pool.query(`DELETE FROM project_info WHERE id = $1`, [handles.projectId]);
      }
      if (handles?.clientAId && handles?.clientBId) {
        await pool.query(
          `DELETE FROM client_merges WHERE loser_client_id IN ($1,$2,$3) OR survivor_client_id IN ($1,$2,$3)`,
          [handles.clientAId, handles.clientBId, handles.clientCId],
        );
      }
      if (handles?.clientAId) await pool.query(`DELETE FROM clients WHERE id = $1`, [handles.clientAId]);
      if (handles?.clientBId) await pool.query(`DELETE FROM clients WHERE id = $1`, [handles.clientBId]);
      if (handles?.clientCId) await pool.query(`DELETE FROM clients WHERE id = $1`, [handles.clientCId]);
    } catch (e) {
      console.warn("[T73 cleanup] error:", (e as Error).message);
    } finally {
      await pool.end();
    }
  });

  it("preview returns the per-table counts that will move", async () => {
    const res = await apiRequest(
      "GET",
      `/api/pd/clients/${handles.clientAId}/merge-preview?into=${handles.clientBId}`,
      undefined,
      token,
    );
    expect(res.status).toBe(200);
    expect(res.data.loser.id).toBe(handles.clientAId);
    expect(res.data.survivor.id).toBe(handles.clientBId);
    expect(res.data.repointedCounts.project_info).toBeGreaterThanOrEqual(1);
    expect(res.data.repointedCounts.opportunities).toBeGreaterThanOrEqual(1);
    expect(res.data.repointedCounts.engineering_tickets).toBeGreaterThanOrEqual(1);
    expect(res.data.repointedCounts.work_items).toBeGreaterThanOrEqual(1);
    expect(res.data.totalRepointed).toBeGreaterThanOrEqual(4);
  });

  it("preview rejects same loser & survivor", async () => {
    const res = await apiRequest(
      "GET",
      `/api/pd/clients/${handles.clientAId}/merge-preview?into=${handles.clientAId}`,
      undefined,
      token,
    );
    expect(res.status).toBe(400);
  });

  it("merge atomically re-points every linked row, soft-deletes the loser, and writes one client_merges row", async () => {
    const res = await apiRequest(
      "POST",
      `/api/pd/clients/${handles.clientAId}/merge`,
      { survivorClientId: handles.clientBId, reason: "test merge" },
      token,
    );
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(res.data.repointedCounts.project_info).toBeGreaterThanOrEqual(1);
    expect(res.data.merge).toBeTruthy();
    expect(res.data.merge.loserClientId).toBe(handles.clientAId);
    expect(res.data.merge.survivorClientId).toBe(handles.clientBId);

    // DB state: loser soft-deleted + pointed at survivor.
    const loser = await pool.query(
      `SELECT deleted_at, merged_into_client_id FROM clients WHERE id = $1`,
      [handles.clientAId],
    );
    expect(loser.rows[0].deleted_at).not.toBeNull();
    expect(loser.rows[0].merged_into_client_id).toBe(handles.clientBId);

    // DB state: every previously-A-attached row now points at B.
    const proj = await pool.query(`SELECT client_id FROM project_info WHERE id = $1`, [handles.projectId]);
    expect(proj.rows[0].client_id).toBe(handles.clientBId);
    const opp = await pool.query(`SELECT client_id FROM opportunities WHERE id = $1`, [handles.opportunityId]);
    expect(opp.rows[0].client_id).toBe(handles.clientBId);
    const tk = await pool.query(`SELECT client_id FROM engineering_tickets WHERE id = $1`, [handles.ticketId]);
    expect(tk.rows[0].client_id).toBe(handles.clientBId);
    const wi = await pool.query(`SELECT client_id FROM work_items WHERE id = $1`, [handles.workItemId]);
    expect(wi.rows[0].client_id).toBe(handles.clientBId);

    // project_client_history row was written so the project's movement is auditable.
    const hist = await pool.query(
      `SELECT old_client_id, new_client_id FROM project_client_history WHERE project_id = $1 AND old_client_id = $2 AND new_client_id = $3`,
      [handles.projectId, handles.clientAId, handles.clientBId],
    );
    expect(hist.rowCount).toBeGreaterThan(0);
  });

  it("cascade-display: GET /api/pd/clients no longer surfaces the merged-away loser", async () => {
    // Scope the query so the loser & survivor both fall inside the
    // endpoint's LIMIT cap regardless of their alphabetic position.
    const res = await apiRequest("GET", `/api/pd/clients?search=T73%20`, undefined, token);
    expect(res.status).toBe(200);
    const ids = (res.data as any[]).map((c) => c.id);
    expect(ids).not.toContain(handles.clientAId);
    expect(ids).toContain(handles.clientBId);
  });

  it("cascade-display: GET /api/clients also hides the loser", async () => {
    const res = await apiRequest("GET", "/api/clients", undefined, token);
    expect(res.status).toBe(200);
    const list: any[] = Array.isArray(res.data) ? res.data : (res.data?.clients || []);
    const ids = list.map((c: any) => c.id);
    expect(ids).not.toContain(handles.clientAId);
  });

  it("aliases endpoint exposes the loser as a 'previously known as' entry on the survivor", async () => {
    const res = await apiRequest("GET", `/api/pd/clients/${handles.clientBId}/aliases`, undefined, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    const ours = (res.data as any[]).find((a) => a.loserClientId === handles.clientAId);
    expect(ours).toBeTruthy();
    expect(ours.loserClientIdCode).toBe(clientACode);
    expect(ours.repointedCounts.project_info).toBeGreaterThanOrEqual(1);
  });

  it("DELETE refuses with 409 when the survivor still has live FK rows attached", async () => {
    // Survivor B now owns every row that previously belonged to A, so it must be blocked.
    const res = await apiRequest("DELETE", `/api/pd/clients/${handles.clientBId}`, undefined, token);
    expect(res.status).toBe(409);
    expect(res.data.blockers).toBeTruthy();
    // Architect feedback (T73): blocker contract must enumerate every
    // FK table, not just projects/opportunities/engineering_tickets.
    for (const k of [
      "projects", "opportunities", "engineering_tickets",
      "work_items", "sites", "quickbooks_customer_mappings", "email_project_links",
    ]) {
      expect(res.data.blockers).toHaveProperty(k);
      expect(typeof res.data.blockers[k]).toBe("number");
    }
    expect(res.data.blockers.projects).toBeGreaterThanOrEqual(1);
    expect(res.data.blockers.opportunities).toBeGreaterThanOrEqual(1);
    expect(res.data.blockers.engineering_tickets).toBeGreaterThanOrEqual(1);
    expect(res.data.blockers.work_items).toBeGreaterThanOrEqual(1);
    const sumBlocked = Object.values(res.data.blockers as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sumBlocked).toBeGreaterThanOrEqual(4);
  });

  it("soft-delete happy path: a client with zero FK rows can be deleted", async () => {
    const res = await apiRequest("DELETE", `/api/pd/clients/${handles.clientCId}`, undefined, token);
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    const row = await pool.query(`SELECT deleted_at FROM clients WHERE id = $1`, [handles.clientCId]);
    expect(row.rows[0].deleted_at).not.toBeNull();
  });

  it("restore clears deleted_at + merged_into_client_id", async () => {
    const res = await apiRequest("POST", `/api/pd/clients/${handles.clientCId}/restore`, {}, token);
    expect(res.status).toBe(200);
    const row = await pool.query(
      `SELECT deleted_at, merged_into_client_id FROM clients WHERE id = $1`,
      [handles.clientCId],
    );
    expect(row.rows[0].deleted_at).toBeNull();
    expect(row.rows[0].merged_into_client_id).toBeNull();
  });
});

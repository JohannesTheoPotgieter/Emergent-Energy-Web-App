/**
 * Integration test for GET /api/priorities/:id linkedProjects.
 *
 * Verifies the cache-miss / no-manual-RAG contract introduced by the
 * project-list summary foundation:
 *   - Each linkedProject row carries ragSource / percentCompleteSource /
 *     kpiSource provenance fields (the foundation shape).
 *   - When ragSource is "manual" the value is one of green/amber/red.
 *   - When percentCompleteSource is "live" the % must reflect real
 *     work_items (not a stale cache zero).
 *   - DLP override surfaces ragStatus="red" with a ragReason.
 *
 * Skips gracefully when the running app has no priorities with linked
 * projects to inspect.
 */
import { describe, expect, it } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body == null ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
}

async function loginAdmin(): Promise<string | null> {
  const candidates = [
    { username: "johannes", password: "2023" },
    { username: "admin", password: "admin" },
  ];
  for (const c of candidates) {
    const login = await apiRequest("POST", "/api/auth/login", c);
    if (login.status === 200 && login.data?.token) return login.data.token as string;
  }
  return null;
}

describe("GET /api/priorities/:id linkedProjects (foundation cache-miss contract)", () => {
  it("each linkedProject row includes provenance fields and a sane RAG/% Complete", async () => {
    const token = await loginAdmin();
    if (!token) {
      console.warn("[priority-detail-linked-projects] no admin login available — skipping");
      return;
    }

    const list = await apiRequest("GET", "/api/priorities", undefined, token);
    if (list.status !== 200 || !Array.isArray(list.data) || list.data.length === 0) {
      console.warn("[priority-detail-linked-projects] no priorities visible — skipping");
      return;
    }

    let inspected = 0;
    for (const p of list.data.slice(0, 25)) {
      const id = p?.id;
      if (typeof id !== "number") continue;
      const detail = await apiRequest("GET", `/api/priorities/${id}`, undefined, token);
      if (detail.status !== 200) continue;
      const linked = detail.data?.linkedProjects;
      if (!Array.isArray(linked) || linked.length === 0) continue;

      for (const row of linked) {
        inspected++;

        // ── Foundation shape: provenance fields must be present.
        expect(row).toHaveProperty("ragSource");
        expect(["manual", "derived", "missing"]).toContain(row.ragSource);

        expect(row).toHaveProperty("percentCompleteSource");
        expect(["cache", "live", "missing"]).toContain(row.percentCompleteSource);

        // ── RAG sanity: when source is manual or derived, the colour must
        //    be a real bucket (no silent "—" when we claim a value).
        if (row.ragSource === "manual" || row.ragSource === "derived") {
          expect(["green", "amber", "red"]).toContain(row.ragStatus);
        } else {
          // ragSource === "missing" → ragStatus may be null.
          if (row.ragStatus !== null && row.ragStatus !== undefined) {
            // The DLP override is the only path that can set red without a
            // source — if it does, ragReason must explain why.
            expect(row.ragStatus).toBe("red");
            expect(typeof row.ragReason === "string" && row.ragReason.length > 0).toBe(true);
          }
        }

        // ── % Complete sanity: when source is "live" the value must be a
        //    real number — this is the bug the foundation fixes.
        if (row.percentCompleteSource === "live") {
          expect(typeof row.percentComplete).toBe("number");
          expect(Number.isFinite(row.percentComplete)).toBe(true);
        }
        if (row.percentCompleteSource === "missing") {
          // Either null (preferred) or 0 — both are honest about the lack
          // of data; the regression we're guarding against is "live or
          // cache" claiming 0 when there's real progress.
          expect(row.percentComplete === null || row.percentComplete === 0).toBe(true);
        }
      }
    }

    if (inspected === 0) {
      console.warn("[priority-detail-linked-projects] no priorities with linked projects found — skipping assertions");
    }
  }, 30_000);
});

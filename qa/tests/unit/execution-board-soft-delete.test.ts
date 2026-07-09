// A1/A2 — the board's procurement + snag reads MUST exclude soft-deleted rows,
// or the board's Overdue-deliveries KPI and Quality open-count disagree with the
// Deliveries / Quality pages. Behavioral SQL guard: the query the repository
// builds includes the `deleted_at IS NULL` predicate. A Drizzle pg instance over
// a fake client captures the compiled SQL (never touches a real DB).

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "../../../shared/schema";
import { ExecutionBoardRepository } from "../../../server/repositories/execution-board-repository";

function repoWithCapture() {
  const captured: string[] = [];
  const fakeClient = {
    query: (q: unknown) => {
      const anyQ = q as { text?: string; sql?: string };
      captured.push(typeof q === "string" ? q : (anyQ?.text ?? anyQ?.sql ?? JSON.stringify(q)));
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  };
  const db = drizzle(fakeClient as unknown as Pool, { schema });
  return { repo: new ExecutionBoardRepository(db), captured };
}

describe("ExecutionBoardRepository — soft-delete exclusion (A1/A2)", () => {
  it("getOpenProcurementForProjects filters deleted_at IS NULL", async () => {
    const { repo, captured } = repoWithCapture();
    await repo.getOpenProcurementForProjects([1, 2]);
    const sql = captured.join("\n").toLowerCase();
    expect(sql).toContain("procurement_items");
    expect(sql).toMatch(/"deleted_at"\s+is null/);
  });

  it("getSnagsForProjects filters deleted_at IS NULL", async () => {
    const { repo, captured } = repoWithCapture();
    await repo.getSnagsForProjects([1, 2]);
    const sql = captured.join("\n").toLowerCase();
    expect(sql).toContain("snags");
    expect(sql).toMatch(/"deleted_at"\s+is null/);
  });

  it("getProcurementDeliveriesForProjects (the fuller read) also guards deleted_at", async () => {
    const { repo, captured } = repoWithCapture();
    await repo.getProcurementDeliveriesForProjects([1]);
    const sql = captured.join("\n").toLowerCase();
    expect(sql).toMatch(/"deleted_at"\s+is null/);
  });
});

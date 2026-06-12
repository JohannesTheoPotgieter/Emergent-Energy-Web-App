/**
 * Pre-import snapshot + one-click revert — both tracker ledgers.
 *
 * Proves the state-restoring rollback (S21): capturing the pre-import active
 * set, then reverting a committed import, re-opens EXACTLY that set with no
 * duplicates and no orphaned soft-closed rows — under the same partial UNIQUE
 * index the migration ships. The revert here mirrors the production rollback
 * route (server/smart-import-routes.ts): soft-close this run's inserts FIRST,
 * then re-open the captured pre-import ids.
 */

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFinanceLineIds } from "../../../server/lib/import/pre-import-snapshot";

type Db = Database.Database;

const DDL = `
CREATE TABLE normalized_cost_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  row_hash TEXT,
  amount_ex_vat TEXT,
  import_run_id INTEGER,
  effective_to TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX cl_unique ON normalized_cost_lines (project_id, row_hash)
  WHERE effective_to IS NULL AND deleted_at IS NULL AND row_hash IS NOT NULL;
`;

let db: Db;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(DDL);
});
afterEach(() => db.close());

const insert = (projectId: number, hash: string, amount: string, runId: number): number => {
  const info = db
    .prepare(
      `INSERT INTO normalized_cost_lines (project_id,row_hash,amount_ex_vat,import_run_id,effective_to,deleted_at)
       VALUES (?,?,?,?,NULL,NULL)`,
    )
    .run(projectId, hash, amount, runId);
  return Number(info.lastInsertRowid);
};

const activeRows = (projectId: number) =>
  db
    .prepare(
      `SELECT id,row_hash,amount_ex_vat FROM normalized_cost_lines
       WHERE project_id=? AND effective_to IS NULL AND deleted_at IS NULL ORDER BY row_hash`,
    )
    .all(projectId) as Array<{ id: number; row_hash: string; amount_ex_vat: string }>;

const captureActiveIds = (projectId: number): number[] =>
  (db.prepare(`SELECT id FROM normalized_cost_lines WHERE project_id=? AND effective_to IS NULL`).all(projectId) as Array<{ id: number }>).map(
    (r) => r.id,
  );

/** Mirrors the production rollback: close this run's inserts, then re-open the snapshot ids. */
const revert = (runId: number, snapshotIds: number[]) => {
  db.transaction(() => {
    db.prepare(`UPDATE normalized_cost_lines SET effective_to=CURRENT_TIMESTAMP WHERE import_run_id=? AND effective_to IS NULL`).run(runId);
    if (snapshotIds.length > 0) {
      const placeholders = snapshotIds.map(() => "?").join(",");
      db.prepare(`UPDATE normalized_cost_lines SET effective_to=NULL, deleted_at=NULL WHERE id IN (${placeholders})`).run(...snapshotIds);
    }
  })();
};

describe("pre-import revert restores the prior active set across the ledger", () => {
  it("a committed import (change + add + remove) reverts to exactly the pre-import state", () => {
    // Pre-import (run 0): three active lines.
    const id1 = insert(1, "h1", "100", 0);
    const id2 = insert(1, "h2", "200", 0);
    const id3 = insert(1, "h3", "300", 0);
    const snapshotIds = captureActiveIds(1);
    expect(snapshotIds.sort()).toEqual([id1, id2, id3]);
    const preImport = activeRows(1);

    // Commit (run 1): h2 changed, h3 removed, h4 added — soft-close-before-insert.
    db.transaction(() => {
      db.prepare(`UPDATE normalized_cost_lines SET effective_to=CURRENT_TIMESTAMP WHERE id=?`).run(id2); // change: close old
      insert(1, "h2", "250", 1); // change: new version
      db.prepare(`UPDATE normalized_cost_lines SET effective_to=CURRENT_TIMESTAMP WHERE id=?`).run(id3); // remove
      insert(1, "h4", "400", 1); // add
    })();
    expect(activeRows(1).map((r) => r.row_hash)).toEqual(["h1", "h2", "h4"]);

    // Revert run 1.
    expect(() => revert(1, snapshotIds)).not.toThrow(); // unique index holds throughout

    const reverted = activeRows(1);
    expect(reverted).toEqual(preImport); // exact prior state, same ids + values
    expect(reverted.map((r) => r.row_hash)).toEqual(["h1", "h2", "h3"]);
    expect(reverted.find((r) => r.row_hash === "h2")!.amount_ex_vat).toBe("200"); // change undone
    // No duplicate active row for any hash.
    expect(new Set(reverted.map((r) => r.row_hash)).size).toBe(reverted.length);
    // The run's inserts are soft-closed, not orphaned-active.
    const runOneActive = db.prepare(`SELECT COUNT(*) AS n FROM normalized_cost_lines WHERE import_run_id=1 AND effective_to IS NULL`).get() as { n: number };
    expect(runOneActive.n).toBe(0);
  });

  it("reverting a baseline (first) import empties the project, no leftovers", () => {
    insert(1, "h1", "100", 1);
    insert(1, "h2", "200", 1);
    revert(1, /* no pre-import snapshot */ []);
    expect(activeRows(1)).toHaveLength(0);
  });

  it("revert is idempotent — running it twice changes nothing", () => {
    const id1 = insert(1, "h1", "100", 0);
    const snap = captureActiveIds(1);
    db.prepare(`UPDATE normalized_cost_lines SET effective_to=CURRENT_TIMESTAMP WHERE id=?`).run(id1);
    insert(1, "h1", "150", 1);
    revert(1, snap);
    const afterFirst = activeRows(1);
    expect(() => revert(1, snap)).not.toThrow();
    expect(activeRows(1)).toEqual(afterFirst);
  });
});

describe("readFinanceLineIds tolerates legacy + new snapshot shapes", () => {
  it("reads the new object shape", () => {
    expect(
      readFinanceLineIds({ workItems: [], financeLineIds: { costLines: [1, 2], revenueLines: [3], costLineActuals: [] } }),
    ).toEqual({ costLines: [1, 2], revenueLines: [3], costLineActuals: [] });
  });

  it("returns null for the legacy bare-array shape (work_items only)", () => {
    expect(readFinanceLineIds([{ id: 1 }])).toBeNull();
    expect(readFinanceLineIds(null)).toBeNull();
  });
});

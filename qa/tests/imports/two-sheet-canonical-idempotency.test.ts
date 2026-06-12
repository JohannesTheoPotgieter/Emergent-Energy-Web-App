/**
 * Two-sheet canonical source — RE-IMPORT IDEMPOTENCY + SELF-HEALING.
 *
 * These are the trust-critical tests for fix/two-sheet-canonical-source. They
 * prove the four guarantees from the brief against a REAL SQLite engine with
 * the ACTUAL shipped migration (migrations/0106_two_sheet_idempotency_unique.sql)
 * applied — so they exercise the physical partial-UNIQUE index, not a mock:
 *
 *   (a) import a tracker, import the SAME file again  → zero new rows, zero
 *       changes, zero duplicates.
 *   (b) import with 1 line changed / 1 added / 1 removed → exactly that delta,
 *       nothing else, no orphan left behind.
 *   (c) import that created a misalignment, then re-import the corrected
 *       tracker → state heals to match (no leftover / duplicate).
 *   (d) a mid-import failure rolls back fully (no partial state).
 *
 * Plus: a unique-key constraint proves duplicates are PHYSICALLY impossible,
 * and the migration's self-healing dedup collapses today's drift (pre-existing
 * duplicate active rows) down to one before locking the constraint.
 *
 * The reconcile helper below mirrors the production writer in
 * server/lib/import/commit-executor.ts exactly: look the active row up by
 * (key, row_hash); skip UNCHANGED; soft-close-old-then-insert-new on CHANGED;
 * insert NEW only when no active hash-match exists; end-of-pass sweep soft-
 * closes rows whose hash is no longer in the file. The writer-invariant suite
 * at the bottom pins those same behaviours in the real source.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test fixture DB: minimal tables carrying exactly the columns the partial
// unique index references, then the REAL migration applied on top.
// ---------------------------------------------------------------------------

const MINIMAL_DDL = `
CREATE TABLE normalized_cost_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  row_hash TEXT,
  amount_ex_vat TEXT,
  effective_to TEXT,
  deleted_at TEXT
);
CREATE TABLE normalized_revenue_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  row_hash TEXT,
  amount_ex_vat TEXT,
  effective_to TEXT,
  deleted_at TEXT
);
CREATE TABLE normalized_cost_line_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cost_line_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  row_hash TEXT,
  actual_total TEXT,
  effective_to TEXT,
  deleted_at TEXT
);
`;

const MIGRATION_PATH = path.join(
  process.cwd(),
  "migrations",
  "0106_two_sheet_idempotency_unique.sql",
);

/** Split the shipped migration into executable statements (drop comments). */
function migrationStatements(): string[] {
  const raw = fs.readFileSync(MIGRATION_PATH, "utf8");
  return raw
    .split("--> statement-breakpoint")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((stmt) => stmt.length > 0);
}

function applyMigration(db: Database.Database): void {
  for (const stmt of migrationStatements()) db.exec(stmt);
}

type Db = Database.Database;

function freshDb(withIndex = true): Db {
  const db = new Database(":memory:");
  db.exec(MINIMAL_DDL);
  if (withIndex) applyMigration(db);
  return db;
}

/** Active = the rows a finance read path would see (the unique-index set). */
function activeCostLines(db: Db, projectId: number) {
  return db
    .prepare(
      `SELECT id, row_hash, amount_ex_vat FROM normalized_cost_lines
       WHERE project_id = ? AND effective_to IS NULL AND deleted_at IS NULL
       ORDER BY row_hash`,
    )
    .all(projectId) as Array<{ id: number; row_hash: string; amount_ex_vat: string }>;
}

function totalCostRows(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM normalized_cost_lines`).get() as { n: number }).n;
}

type FileRow = { rowHash: string; amount: string };

/**
 * Mirrors writeExpenditureIncremental's reconcile contract:
 *   - lookupActiveByHash (effective_to IS NULL)
 *   - UNCHANGED → no write
 *   - CHANGED → soft-close old THEN insert new
 *   - NEW (no active hash-match) → insert
 *   - end-of-pass sweep → soft-close active rows whose hash left the file
 * Returns a small delta summary so tests can assert "exactly this changed".
 */
function reconcileCostLines(db: Db, projectId: number, fileRows: FileRow[]) {
  const delta = { inserted: 0, changed: 0, unchanged: 0, swept: 0 };
  const seen = new Set<string>();
  const lookup = db.prepare(
    `SELECT id, amount_ex_vat FROM normalized_cost_lines
     WHERE project_id = ? AND row_hash = ? AND effective_to IS NULL LIMIT 1`,
  );
  const softClose = db.prepare(
    `UPDATE normalized_cost_lines SET effective_to = CURRENT_TIMESTAMP WHERE id = ?`,
  );
  const insert = db.prepare(
    `INSERT INTO normalized_cost_lines (project_id, row_hash, amount_ex_vat, effective_to, deleted_at)
     VALUES (?, ?, ?, NULL, NULL)`,
  );

  const run = db.transaction((rows: FileRow[]) => {
    for (const fr of rows) {
      seen.add(fr.rowHash);
      const existing = lookup.get(projectId, fr.rowHash) as
        | { id: number; amount_ex_vat: string }
        | undefined;
      if (existing) {
        if (String(existing.amount_ex_vat) === String(fr.amount)) {
          delta.unchanged++;
          continue;
        }
        softClose.run(existing.id); // soft-close OLD first ...
        insert.run(projectId, fr.rowHash, fr.amount); // ... then insert NEW
        delta.changed++;
      } else {
        insert.run(projectId, fr.rowHash, fr.amount);
        delta.inserted++;
      }
    }
    // Sweep: rows whose hash is no longer in the file.
    const active = activeCostLines(db, projectId);
    for (const r of active) {
      if (!seen.has(r.row_hash)) {
        softClose.run(r.id);
        delta.swept++;
      }
    }
  });
  run(fileRows);
  return delta;
}

describe("two-sheet idempotency — physical unique constraint + reconcile", () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    db.close();
  });

  // ── duplicates are PHYSICALLY impossible ─────────────────────────────────
  it("the partial UNIQUE index rejects a second active row for the same (project_id, row_hash)", () => {
    db.prepare(
      `INSERT INTO normalized_cost_lines (project_id, row_hash, amount_ex_vat) VALUES (1,'h1','100')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO normalized_cost_lines (project_id, row_hash, amount_ex_vat) VALUES (1,'h1','100')`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/i);
  });

  it("a soft-deleted row does NOT block its re-imported successor (predicate excludes deleted_at)", () => {
    db.prepare(
      `INSERT INTO normalized_cost_lines (project_id, row_hash, amount_ex_vat, deleted_at) VALUES (1,'h1','100', CURRENT_TIMESTAMP)`,
    ).run();
    // Same key, but the previous one is soft-deleted → no collision.
    expect(() =>
      db
        .prepare(
          `INSERT INTO normalized_cost_lines (project_id, row_hash, amount_ex_vat) VALUES (1,'h1','100')`,
        )
        .run(),
    ).not.toThrow();
  });

  it("the same hash is allowed across different projects", () => {
    db.prepare(`INSERT INTO normalized_cost_lines (project_id,row_hash,amount_ex_vat) VALUES (1,'h1','100')`).run();
    expect(() =>
      db.prepare(`INSERT INTO normalized_cost_lines (project_id,row_hash,amount_ex_vat) VALUES (2,'h1','100')`).run(),
    ).not.toThrow();
  });

  // ── (a) importing the same file twice changes nothing ────────────────────
  it("(a) re-importing the SAME tracker is a no-op — zero new rows, zero changes, zero duplicates", () => {
    const file: FileRow[] = [
      { rowHash: "h1", amount: "100" },
      { rowHash: "h2", amount: "200" },
      { rowHash: "h3", amount: "300" },
    ];
    reconcileCostLines(db, 1, file);
    const afterFirst = activeCostLines(db, 1);
    const rowsAfterFirst = totalCostRows(db);

    const delta = reconcileCostLines(db, 1, file); // import the same file again

    expect(delta).toEqual({ inserted: 0, changed: 0, unchanged: 3, swept: 0 });
    expect(totalCostRows(db)).toBe(rowsAfterFirst); // no new physical rows
    expect(activeCostLines(db, 1)).toEqual(afterFirst); // identical active set, same ids
  });

  // ── (b) exactly the delta — change 1, add 1, remove 1 ────────────────────
  it("(b) 1 changed + 1 added + 1 removed applies exactly that delta, no orphan left behind", () => {
    reconcileCostLines(db, 1, [
      { rowHash: "h1", amount: "100" },
      { rowHash: "h2", amount: "200" },
      { rowHash: "h3", amount: "300" },
    ]);
    const h1IdBefore = activeCostLines(db, 1).find((r) => r.row_hash === "h1")!.id;

    const delta = reconcileCostLines(db, 1, [
      { rowHash: "h1", amount: "100" }, // unchanged
      { rowHash: "h2", amount: "250" }, // changed
      { rowHash: "h4", amount: "400" }, // added (h3 removed)
    ]);

    expect(delta).toEqual({ inserted: 1, changed: 1, unchanged: 1, swept: 1 });

    const active = activeCostLines(db, 1);
    expect(active.map((r) => r.row_hash)).toEqual(["h1", "h2", "h4"]); // h3 gone
    expect(active.find((r) => r.row_hash === "h1")!.id).toBe(h1IdBefore); // untouched
    expect(active.find((r) => r.row_hash === "h2")!.amount_ex_vat).toBe("250"); // new value
    // exactly one active row per hash — no duplicate, no orphan
    expect(new Set(active.map((r) => r.row_hash)).size).toBe(active.length);
  });

  // ── (c) self-healing — a prior misalignment is corrected by re-import ─────
  it("(c) re-importing the corrected tracker heals a prior orphan with no leftover or duplicate", () => {
    // First (bad) import left an orphan line "hX" that the tracker no longer has.
    reconcileCostLines(db, 1, [
      { rowHash: "h1", amount: "100" },
      { rowHash: "hX", amount: "999" }, // drift / orphan
    ]);
    expect(activeCostLines(db, 1).map((r) => r.row_hash)).toEqual(["h1", "hX"]);

    // The corrected tracker no longer contains hX; re-import converges to truth.
    reconcileCostLines(db, 1, [
      { rowHash: "h1", amount: "100" },
      { rowHash: "h2", amount: "200" },
    ]);

    const active = activeCostLines(db, 1);
    expect(active.map((r) => r.row_hash)).toEqual(["h1", "h2"]); // orphan healed
    expect(new Set(active.map((r) => r.row_hash)).size).toBe(active.length);
  });

  // ── (d) a mid-import failure rolls back fully ────────────────────────────
  it("(d) a mid-import failure rolls back fully — no partial / half-imported state", () => {
    reconcileCostLines(db, 1, [
      { rowHash: "h1", amount: "100" },
      { rowHash: "h2", amount: "200" },
    ]);
    const before = activeCostLines(db, 1);
    const rowsBefore = totalCostRows(db);

    const failingImport = db.transaction(() => {
      db.prepare(
        `INSERT INTO normalized_cost_lines (project_id,row_hash,amount_ex_vat) VALUES (1,'h3','300')`,
      ).run();
      db.prepare(`UPDATE normalized_cost_lines SET effective_to = CURRENT_TIMESTAMP WHERE row_hash='h1'`).run();
      throw new Error("boom — connection lost mid-commit");
    });

    expect(() => failingImport()).toThrow(/boom/);
    expect(activeCostLines(db, 1)).toEqual(before); // unchanged
    expect(totalCostRows(db)).toBe(rowsBefore); // no half-inserted h3
  });
});

describe("migration 0106 — self-healing dedup is dual-mode (runs clean on SQLite)", () => {
  it("collapses pre-existing duplicate active rows to one, keeping the newest, then locks the constraint", () => {
    const db = freshDb(false); // tables WITHOUT the index — simulate today's drift
    // Three active duplicates for the same key (the R52m/R89m double-count shape).
    db.exec(`
      INSERT INTO normalized_cost_lines (project_id,row_hash,amount_ex_vat) VALUES (1,'dup','100');
      INSERT INTO normalized_cost_lines (project_id,row_hash,amount_ex_vat) VALUES (1,'dup','100');
      INSERT INTO normalized_cost_lines (project_id,row_hash,amount_ex_vat) VALUES (1,'dup','100');
      INSERT INTO normalized_revenue_lines (project_id,row_hash,amount_ex_vat) VALUES (1,'r','5');
      INSERT INTO normalized_revenue_lines (project_id,row_hash,amount_ex_vat) VALUES (1,'r','5');
      INSERT INTO normalized_cost_line_actuals (cost_line_id,project_id,row_hash,actual_total) VALUES (9,1,'a','7');
      INSERT INTO normalized_cost_line_actuals (cost_line_id,project_id,row_hash,actual_total) VALUES (9,1,'a','7');
    `);

    applyMigration(db); // the REAL shipped migration heals + locks

    const activeDup = db
      .prepare(`SELECT id FROM normalized_cost_lines WHERE project_id=1 AND row_hash='dup' AND effective_to IS NULL`)
      .all() as Array<{ id: number }>;
    expect(activeDup).toHaveLength(1);
    expect(activeDup[0].id).toBe(3); // kept the newest (MAX id)

    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM normalized_revenue_lines WHERE row_hash='r' AND effective_to IS NULL`).get() as { n: number }).n,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM normalized_cost_line_actuals WHERE row_hash='a' AND effective_to IS NULL`).get() as { n: number }).n,
    ).toBe(1);

    // Constraint is now live — a re-introduced duplicate is rejected.
    expect(() =>
      db.prepare(`INSERT INTO normalized_cost_lines (project_id,row_hash,amount_ex_vat) VALUES (1,'dup','100')`).run(),
    ).toThrow(/UNIQUE constraint failed/i);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Writer-invariant source assertions — pin the production reconcile contract
// that the physical constraint above depends on.
// ---------------------------------------------------------------------------

describe("commit-executor upholds the reconcile invariants the unique index relies on", () => {
  const exec = fs.readFileSync(
    path.join(process.cwd(), "server/lib/import/commit-executor.ts"),
    "utf8",
  );

  it("revenue + expenditure writers look the active row up by (projectId, rowHash) before writing", () => {
    expect(exec).toContain("lookupActiveByHash(rowHash)");
    expect(exec).toMatch(/eq\(normalizedRevenueLines\.rowHash, rowHash\)/);
    expect(exec).toMatch(/eq\(normalizedCostLines\.rowHash, rowHash\)/);
  });

  it("a NEW classification with an existing active hash-match is rerouted (never double-inserts)", () => {
    expect(exec).toMatch(/if \(existingForMerge\) \{[\s\S]{0,160}Fall through to the CHANGED block/);
  });

  it("CHANGED rows soft-close the old version (set effectiveTo) before inserting the new one", () => {
    // The soft-close UPDATE precedes the INSERT for both temporal ledgers.
    expect(exec).toMatch(/\.set\(\{ effectiveTo: commitTimestamp \}\)[\s\S]{0,2200}\.insert\(normalizedRevenueLines\)/);
    expect(exec).toMatch(/\.set\(\{ effectiveTo: commitTimestamp \}\)[\s\S]{0,2200}\.insert\(normalizedCostLines\)/);
  });
});

// ---------------------------------------------------------------------------
// Schema + migration assertions — the unique guarantee is committed, not ad hoc.
// ---------------------------------------------------------------------------

describe("idempotency guarantee is committed in schema + migration", () => {
  const schema = fs.readFileSync(path.join(process.cwd(), "shared/schema/finance.ts"), "utf8");
  const migration = fs.readFileSync(MIGRATION_PATH, "utf8");

  it("all three line tables declare a partial UNIQUE index on (key, row_hash)", () => {
    expect(schema).toContain('uniqueIndex("normalized_cost_lines_row_hash_unique_idx")');
    expect(schema).toContain('uniqueIndex("normalized_revenue_lines_row_hash_unique_idx")');
    expect(schema).toContain('uniqueIndex("normalized_cost_line_actuals_row_hash_unique_idx")');
  });

  it("the unique predicate excludes soft-deleted rows (effective_to AND deleted_at IS NULL)", () => {
    const matches = schema.match(/effectiveTo} IS NULL AND \${table\.deletedAt} IS NULL/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("the migration heals duplicates before creating each unique index", () => {
    expect(migration).toMatch(/UPDATE normalized_cost_lines[\s\S]*?CREATE UNIQUE INDEX IF NOT EXISTS "normalized_cost_lines_row_hash_unique_idx"/);
    expect(migration).toMatch(/UPDATE normalized_revenue_lines[\s\S]*?CREATE UNIQUE INDEX IF NOT EXISTS "normalized_revenue_lines_row_hash_unique_idx"/);
    expect(migration).toMatch(/UPDATE normalized_cost_line_actuals[\s\S]*?CREATE UNIQUE INDEX IF NOT EXISTS "normalized_cost_line_actuals_row_hash_unique_idx"/);
  });

  it("the migration is SQLite-safe (no qualified predicate columns, no now())", () => {
    // Check executable SQL only — comments may legitimately mention now().
    const sql = migrationStatements().join("\n");
    expect(sql).not.toMatch(/"normalized_\w+"\."effective_to"/); // no table-qualified predicate cols
    expect(sql).not.toMatch(/\bnow\(\)/); // CURRENT_TIMESTAMP only
  });
});

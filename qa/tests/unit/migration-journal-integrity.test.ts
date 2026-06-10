/**
 * Migration-journal + ledger integrity guards (2026-06-10 repair).
 *
 * Root cause being pinned: drizzle-kit migrate applies a journal entry iff
 * its `when` exceeds the single MAX(created_at) watermark in
 * drizzle.__drizzle_migrations. Hand-edited, out-of-order and future-dated
 * `when` values (0079_dev_drift_repair was stamped ≈2026-06-18) silently
 * skipped real migrations while every ledger surface reported them applied:
 * 0071's change_requests columns went missing, and the same class caused
 * the 0090–0096 outage. A fresh migrate-from-zero skipped 28 entries.
 *
 * These tests pin the repair so the class cannot return:
 *   1. Journal `when` values are strictly increasing and never future-dated.
 *   2. The 0102 drift-repair migration re-asserts 0071's artifacts and is
 *      probed by drizzle-bootstrap (so drifted DBs converge on migrate).
 *   3. drizzle-bootstrap normalises stale ledger created_at stamps.
 *   4. db:check enforces journal `when` integrity on every PR.
 *   5. CI runs db:verify-schema plus the migrate-from-zero proof job.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const journal = JSON.parse(read("migrations/meta/_journal.json")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

describe("journal `when` integrity — the watermark poisoning class", () => {
  it("`when` is strictly increasing in idx order (no out-of-order entries)", () => {
    let previous = 0;
    for (const entry of journal.entries) {
      expect(
        entry.when,
        `${entry.tag} (when=${entry.when}) is not strictly after the previous entry (${previous}) — ` +
          "an out-of-order `when` makes drizzle-kit migrate silently skip it.",
      ).toBeGreaterThan(previous);
      previous = entry.when;
    }
  });

  it("no entry is future-dated (a future `when` pins the watermark above later migrations)", () => {
    const grace = 24 * 60 * 60 * 1000;
    const ceiling = Date.now() + grace;
    for (const entry of journal.entries) {
      expect(
        entry.when,
        `${entry.tag} is future-dated (when=${entry.when}) — the 0079 mistake that caused the 0090–0096 outage.`,
      ).toBeLessThan(ceiling);
    }
  });

  it("the historical future-dated 0079 stamp (1782000000000) is gone", () => {
    const entry = journal.entries.find((e) => e.tag === "0079_dev_drift_repair");
    expect(entry).toBeDefined();
    expect(entry!.when).not.toBe(1_782_000_000_000);
  });
});

describe("0102 drift repair — 0071's artifacts re-asserted idempotently", () => {
  const tag = "0102_handover_cr_approver_drift_repair";
  const sql = read(`migrations/${tag}.sql`);

  it("is journaled after 0101 with idx 102", () => {
    const entry = journal.entries.find((e) => e.tag === tag);
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(102);
  });

  it("re-asserts every 0071 artifact with guards (no unguarded DDL)", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "post_handover_reviews"/);
    for (const column of [
      "submitted_by_user_id",
      "submitted_at",
      "reviewer_user_id",
      "review_started_at",
      "approver_user_id",
      "approved_at",
      "rejection_reason",
      "rejected_at",
    ]) {
      expect(sql).toContain(
        `ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "${column}"`,
      );
    }
    expect(sql).toContain('ALTER TABLE "handover_packs" ADD COLUMN IF NOT EXISTS "matriarch_accepted_by_user_id"');
    expect(sql).toContain('ALTER TABLE "sseg_items" ADD COLUMN IF NOT EXISTS "metering_confirmed_at"');
    // Constraints are duplicate_object-guarded; nothing destructive.
    expect(sql).toMatch(/EXCEPTION WHEN duplicate_object THEN NULL/);
    expect(sql).not.toMatch(/\bDROP\b/i);
  });

  it("drizzle-bootstrap probes 0102 with a multi-artifact canary (drifted DBs replay it)", () => {
    const bootstrap = read("scripts/drizzle-bootstrap.ts");
    expect(bootstrap).toMatch(/"0102_handover_cr_approver_drift_repair":/);
    expect(bootstrap).toMatch(/columnExists\(c, "change_requests", "submitted_by_user_id"\)/);
    expect(bootstrap).toMatch(/tableExists\(c, "post_handover_reviews"\)/);
  });
});

describe("ledger watermark normalisation in drizzle-bootstrap", () => {
  const bootstrap = read("scripts/drizzle-bootstrap.ts");

  it("re-stamps recorded rows to the committed journal `when` by hash", () => {
    expect(bootstrap).toMatch(/Normalise bookkeeping timestamps/);
    expect(bootstrap).toMatch(/SET created_at = \$1 WHERE id = \$2/);
  });

  it("clamps unmatched rows down to the journal ceiling so orphans cannot pin the watermark", () => {
    expect(bootstrap).toMatch(/journalCeiling/);
  });
});

describe("guards are wired into the gates", () => {
  it("db:check (scripts/db-check-drift.ts) enforces journal `when` integrity", () => {
    const source = read("scripts/db-check-drift.ts");
    expect(source).toMatch(/strictly greater/);
    expect(source).toMatch(/future-dated/);
  });

  it("package.json exposes db:verify-schema", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:verify-schema"]).toMatch(/scripts\/db-verify-schema\.ts/);
  });

  it("db:migrate (the deploy command) self-verifies with additive repair", () => {
    // Deploy = `npm run build && npm run db:migrate`. Chaining the verifier
    // means the deploy step CANNOT exit 0 while declared columns are missing —
    // "migration applied" now implies "schema present".
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:migrate"]).toMatch(/drizzle-kit migrate && tsx scripts\/db-verify-schema\.ts --repair/);
  });

  for (const file of [".github/workflows/pr-checks.yml", ".github/workflows/ci.yml"]) {
    it(`${file} runs db:verify-schema and the migration-integrity (migrate-from-zero) job`, () => {
      const source = read(file);
      expect(source).toMatch(/npm\s+run\s+db:verify-schema/);
      expect(source).toMatch(/migration-integrity:/);
      expect(source).toMatch(/npm run db:migrate/);
    });
  }

  it("release gate includes the live schema verification when DATABASE_URL is set", () => {
    const source = read("qa/release-gate.ts");
    expect(source).toMatch(/db:verify-schema/);
  });

  it("the boot sequence runs the column-level verification gate", () => {
    const source = read("server/index.ts");
    expect(source).toMatch(/runSchemaVerificationBootGate/);
  });
});

describe("previously dead-on-fresh migrations are safe to (re-)execute", () => {
  // 0061 and 0065 entered the journal below the then-current watermark and
  // never executed anywhere. The journal repair makes them live on fresh
  // migrate-from-zero, so every statement must be guarded — 0061 plainly
  // re-creates role_lens_profiles, which 0054 also creates.
  for (const tag of ["0061_ncr_drizzle_canon", "0065_standup_summary_persist"]) {
    it(`${tag} carries no unguarded CREATE/ADD statements`, () => {
      const sql = read(`migrations/${tag}.sql`);
      const statements = sql.match(/^[ \t]*(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|CREATE TYPE|ALTER TABLE [^\n]*ADD (COLUMN|CONSTRAINT))[^\n]*/gm) ?? [];
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        const guarded =
          statement.includes("IF NOT EXISTS") ||
          // CREATE TYPE / ADD CONSTRAINT live inside duplicate_object DO blocks.
          /^\s{2,}/.test(statement);
        expect(guarded, `${tag}: unguarded statement: ${statement.trim()}`).toBe(true);
      }
    });
  }
});

/**
 * Migration-baseline regression guards (Phase 3b)
 *
 * Pins the outcome of the Phase 3b migration-tracking rebase:
 *
 *   1. The Drizzle journal (migrations/meta/_journal.json) is no longer
 *      the stale two-entry artefact that let 9 months of hand-written
 *      migrations drift away from Drizzle's snapshot. It now starts at
 *      the 0000_baseline_20260419 entry.
 *
 *   2. The 225 pre-baseline migrations are moved under
 *      migrations/archive/ (reference only, not invoked by any tooling).
 *
 *   3. The four new forward-looking npm scripts (db:generate, db:migrate,
 *      db:check, plus the existing db:push) are present in package.json.
 *
 *   4. The CI workflows invoke `npm run db:check` so any PR that edits
 *      shared/schema/*.ts without a corresponding migration fails the
 *      lint stage.
 *
 *   5. The schema-drift guard script (scripts/db-check-drift.ts) is
 *      present and wired.
 *
 * Source-text assertions are deliberate: every one of these pins the
 * outcome of a structural decision that would be invisible if reverted
 * at the runtime level.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(read(relPath));
}

describe("migration baseline — journal + filesystem", () => {
  it("journal starts at the 0000_baseline_20260419 entry", () => {
    const journal = readJson("migrations/meta/_journal.json") as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.version).toBe("7");
    expect(journal.dialect).toBe("postgresql");
    expect(journal.entries.length).toBeGreaterThanOrEqual(1);
    expect(journal.entries[0]?.idx).toBe(0);
    expect(
      journal.entries[0]?.tag,
      "Journal must open with the Phase 3b baseline. If you renamed it, update this test.",
    ).toBe("0000_baseline_20260419");
  });

  it("baseline migration file exists and carries the reference-only header", () => {
    const source = read("migrations/0000_baseline_20260419.sql");
    expect(source).toMatch(/BASELINE MIGRATION/);
    expect(
      source,
      "Baseline must explicitly state DO NOT re-apply on prod — it's a reference snapshot.",
    ).toMatch(/DO NOT re-apply this baseline to prod|Production DBs ALREADY contain/);
  });

  it("baseline snapshot file exists", () => {
    const p = path.join(process.cwd(), "migrations/meta/0000_snapshot.json");
    expect(fs.existsSync(p), "migrations/meta/0000_snapshot.json must exist").toBe(true);
  });

  it("225 historical migrations are archived under migrations/archive/", () => {
    const archive = path.join(process.cwd(), "migrations/archive");
    expect(fs.existsSync(archive)).toBe(true);
    const sqlFiles = fs
      .readdirSync(archive)
      .filter((f) => f.endsWith(".sql"));
    expect(
      sqlFiles.length,
      "Expected 225 archived pre-baseline migration files",
    ).toBeGreaterThanOrEqual(225);
  });

  it("archive has a README explaining historical boundary", () => {
    const readme = read("migrations/archive/README.md");
    expect(readme).toMatch(/reference only|historical|archive/i);
    expect(readme).toMatch(/db:generate|baseline/i);
  });
});

describe("package.json — forward-looking migration scripts", () => {
  const pkg = readJson("package.json");
  const scripts = (pkg.scripts as Record<string, string>) ?? {};

  it("db:generate invokes drizzle-kit generate", () => {
    expect(scripts["db:generate"]).toMatch(/drizzle-kit\s+generate/);
  });

  it("db:migrate invokes drizzle-kit migrate", () => {
    expect(scripts["db:migrate"]).toMatch(/drizzle-kit\s+migrate/);
  });

  it("db:check runs the drift guard script", () => {
    expect(scripts["db:check"]).toMatch(/scripts\/db-check-drift\.ts/);
  });

  it("db:push still uses drizzle-kit push (regression guard for §3a)", () => {
    expect(scripts["db:push"]).toMatch(/drizzle-kit\s+push/);
  });
});

describe("schema-drift guard script", () => {
  const source = read("scripts/db-check-drift.ts");

  it("invokes drizzle-kit generate in a sandbox", () => {
    expect(source).toMatch(/drizzle-kit\s+generate/);
    expect(source).toMatch(/--schema=shared\/schema\.ts/);
    expect(source).toMatch(/--dialect=postgresql/);
  });

  it("non-zero exit on detected drift", () => {
    expect(source).toMatch(/process\.exit\(1\)/);
  });

  it("points the user at `npm run db:generate` on failure", () => {
    expect(source).toMatch(/npm run db:generate/);
  });
});

describe("CI workflows run db:check", () => {
  const CI_FILES = [
    ".github/workflows/pr-checks.yml",
  ];
  for (const file of CI_FILES) {
    it(`${file} invokes npm run db:check`, () => {
      const source = read(file);
      expect(
        source,
        `${file} must invoke \`npm run db:check\` so the schema-drift guard runs on every PR.`,
      ).toMatch(/npm\s+run\s+db:check/);
    });
  }
});

/**
 * QB-recon migration integrity (0008 vs 0097)
 *
 * Two unrelated migrations share the `_qb_recon_tables` filename suffix and
 * are routinely mistaken for duplicates:
 *
 *   - 0008_qb_recon_tables — cost-side Tracker-Gap annotation tables
 *     (qb_recon_ignores + qb_class_project_overrides), shipped in PR #1017,
 *     baseline-era journal entry idx 8, applied on every environment.
 *   - 0097_qb_recon_tables — company-wide tracker-vs-QuickBooks reconciliation
 *     snapshot tables (qb_recon_line + qb_recon_summary), shipped in PR #1048,
 *     journal entry idx 97.
 *
 * They create four DISJOINT relations — they are not duplicates. This block
 * pins that fact so the recurring "0008 is a stray duplicate of 0097, delete
 * it" misdiagnosis cannot land: removing 0008 would drop two live tables from
 * every fresh DB and break scripts/drizzle-bootstrap.ts, which resolves every
 * journal tag to migrations/<tag>.sql by name.
 */
describe("QB-recon migration integrity (0008 vs 0097)", () => {
  const journal = readJson("migrations/meta/_journal.json") as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const tags = journal.entries.map((e) => e.tag);

  /** Active-migration tags (journal order) whose DDL creates `table`. */
  function creatorsOf(table: string): string[] {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`);
    return tags.filter((tag) => re.test(read(`migrations/${tag}.sql`)));
  }

  it("journal tags are unique and idx is contiguous (no stray renumbering)", () => {
    expect(new Set(tags).size, "duplicate journal tags").toBe(tags.length);
    journal.entries.forEach((e, i) => expect(e.idx).toBe(i));
  });

  it("every journal entry resolves to an on-disk migration .sql file", () => {
    // drizzle-kit migrate AND scripts/drizzle-bootstrap.ts both resolve each
    // journal tag to migrations/<tag>.sql; a missing file breaks the deploy.
    for (const tag of tags) {
      expect(
        fs.existsSync(path.join(process.cwd(), "migrations", `${tag}.sql`)),
        `migrations/${tag}.sql is referenced by the journal but missing`,
      ).toBe(true);
    }
  });

  it("0008 and 0097 are both present as distinct journal entries", () => {
    expect(tags).toContain("0008_qb_recon_tables");
    expect(tags).toContain("0097_qb_recon_tables");
  });

  it("0008 creates the cost-side annotation tables only", () => {
    const sql = read("migrations/0008_qb_recon_tables.sql");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "qb_recon_ignores"/);
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS "qb_class_project_overrides"/,
    );
    expect(sql).not.toMatch(/"qb_recon_line"|"qb_recon_summary"/);
  });

  it("0097 creates the reconciliation snapshot tables only", () => {
    const sql = read("migrations/0097_qb_recon_tables.sql");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "qb_recon_line"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "qb_recon_summary"/);
    expect(sql).not.toMatch(/"qb_recon_ignores"|"qb_class_project_overrides"/);
  });

  it("each QB-recon table is created by exactly one migration (no double-create)", () => {
    expect(creatorsOf("qb_recon_line")).toEqual(["0097_qb_recon_tables"]);
    expect(creatorsOf("qb_recon_summary")).toEqual(["0097_qb_recon_tables"]);
    expect(creatorsOf("qb_recon_ignores")).toEqual(["0008_qb_recon_tables"]);
    expect(creatorsOf("qb_class_project_overrides")).toEqual([
      "0008_qb_recon_tables",
    ]);
  });

  it("both QB-recon migrations are idempotent (CREATE TABLE IF NOT EXISTS)", () => {
    for (const tag of ["0008_qb_recon_tables", "0097_qb_recon_tables"]) {
      // Anchor to real statements at line-start; comment lines begin with `--`
      // (0097's header wraps the words "CREATE TABLE IF / NOT EXISTS").
      const creates =
        read(`migrations/${tag}.sql`).match(/^[ \t]*CREATE TABLE\b[^\n]*/gm) ?? [];
      expect(creates.length, `${tag} creates no tables?`).toBeGreaterThan(0);
      for (const stmt of creates) {
        expect(stmt, `${tag}: ${stmt}`).toMatch(/CREATE TABLE IF NOT EXISTS/);
      }
    }
  });

  it("drizzle bootstrap keeps the 0097 canary probing both snapshot tables", () => {
    // 0079_dev_drift_repair carries a future-dated journal `when`, which pins
    // drizzle-kit migrate's watermark above 0097; without this canary the
    // company-wide recon tables would be skipped on already-migrated DBs.
    const boot = read("scripts/drizzle-bootstrap.ts");
    expect(boot).toMatch(/"0097_qb_recon_tables":/);
    expect(boot).toMatch(/tableExists\(c, "qb_recon_line"\)/);
    expect(boot).toMatch(/tableExists\(c, "qb_recon_summary"\)/);
  });
});

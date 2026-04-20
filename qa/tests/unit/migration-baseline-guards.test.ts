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
    ".github/workflows/ci.yml",
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

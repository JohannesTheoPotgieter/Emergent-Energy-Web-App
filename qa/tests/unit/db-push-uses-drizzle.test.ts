/**
 * db:push regression guard (Phase 3a)
 *
 * Pins the outcome of the schema-discipline Phase 3a sweep:
 *
 *   Before: `npm run db:push` ran two stale, hand-maintained SQL scripts
 *   (script/pre-push-enums.sql + script/full-schema-alignment.sql) that
 *   had drifted from the Drizzle schema in shared/schema/*.ts. A fresh
 *   PostgreSQL setup produced a schema missing columns (e.g.
 *   normalized_revenue_lines.deleted_at, cos_status_override and family),
 *   entire tables (dashboard_snapshots, role_credentials), and stale enum
 *   values (smart_import_status in uppercase). Seed and backfill jobs
 *   cascade-failed on boot, dashboards returned 500, Smart Import's
 *   pending-runs list 500'd on every call.
 *
 *   After: `npm run db:push` calls `drizzle-kit push --force`, which
 *   reads shared/schema.ts directly and applies every missing schema
 *   element against the target DB. The `db:push:legacy` alias has since
 *   been REMOVED — the guard below fails CI if it is reintroduced. The two
 *   legacy SQL files remain only because `script/build.ts` copies them into
 *   dist; both still carry a deprecation header so nobody treats them as
 *   canonical.
 *
 * These assertions are source-text level: the failure mode is a silent
 * regression of the npm script back to the legacy path, or a new SQL
 * statement added to the deprecated files as if they were authoritative.
 * A guard catches that the moment it hits a PR.
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

describe("db:push uses drizzle-kit, not the legacy SQL files", () => {
  const pkg = readJson("package.json");
  const scripts = (pkg.scripts as Record<string, string>) ?? {};

  it("db:push invokes drizzle-kit push", () => {
    expect(
      scripts["db:push"],
      "npm run db:push must call drizzle-kit push (which reads shared/schema.ts) so fresh DBs match the Drizzle source of truth. The legacy psql-based path drifted out of sync and produced a broken schema.",
    ).toMatch(/drizzle-kit\s+push/);
  });

  it("db:push does not call the deprecated psql scripts", () => {
    const script = scripts["db:push"] ?? "";
    expect(script).not.toMatch(/pre-push-enums\.sql/);
    expect(script).not.toMatch(/full-schema-alignment\.sql/);
  });

  it("db:setup also invokes drizzle-kit push", () => {
    expect(
      scripts["db:setup"],
      "db:setup — the full dev bootstrap — must use drizzle-kit push for the same reason as db:push.",
    ).toMatch(/drizzle-kit\s+push/);
  });

  it("the db:push:legacy alias has been removed and must not return", () => {
    expect(
      scripts["db:push:legacy"],
      "db:push:legacy was removed. If it is reintroduced this guard fails CI on purpose — the canonical schema path is `drizzle-kit push` via db:push.",
    ).toBeUndefined();
  });
});

describe("legacy SQL scripts carry a DEPRECATED header", () => {
  const FILES = [
    "script/pre-push-enums.sql",
    "script/full-schema-alignment.sql",
  ];
  for (const file of FILES) {
    it(`${file} opens with a DEPRECATED banner`, () => {
      const head = read(file).slice(0, 1000);
      expect(
        head,
        `${file} must start with a DEPRECATED banner so nobody extends it thinking it's canonical. The canonical path is drizzle-kit push.`,
      ).toMatch(/DEPRECATED/);
      expect(head).toMatch(/drizzle-kit\s+push/);
    });
  }
});

describe("drizzle-kit is configured correctly", () => {
  const cfg = read("drizzle.config.ts");

  it("points at shared/schema as the source of truth", () => {
    expect(cfg).toMatch(/schema:\s*["']\.\/shared\/schema(\.ts)?["']/);
  });

  it("targets PostgreSQL", () => {
    expect(cfg).toMatch(/dialect:\s*["']postgresql["']/);
  });

  it("writes generated migrations to ./migrations", () => {
    expect(cfg).toMatch(/out:\s*["']\.\/migrations["']/);
  });
});

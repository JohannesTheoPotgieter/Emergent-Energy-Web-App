// Task #124 — behavioral toSQL + source-text guards for getFinanceCashflow.
// `cost_line_status` is a lowercase Postgres enum {planned, invoiced,
// approved, paid}. UPPERCASE literals in the IN-list raise an enum-input
// error at query time, so we pin BOTH the rendered SQL and the source.

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "../../../shared/schema";

// No-op pg client so importing the repository doesn't open a real connection.
// Typed as `pg.Pool` (one branch of Drizzle's `NodePgClient` union) — we
// implement the only method Drizzle needs to bind a session, and surface a
// loud error if any test accidentally hits the wire instead of `.toSQL()`.
type FakePgPool = Pick<Pool, "query">;

vi.mock("../../../server/db", () => {
  const fakeClient: FakePgPool = {
    query: (() => {
      throw new Error("test stub: query() must not be called — toSQL() only");
    }) as unknown as Pool["query"],
  };
  return {
    db: drizzle(fakeClient as unknown as Pool, { schema }),
    dbMode: "postgres" as const,
    dbConfig: {},
    initializeDatabase: () => {},
    getDbMode: () => "postgres" as const,
    getPostgresPool: () => null,
  };
});

import { buildFinanceCashflowQuery } from "../../../server/api/v2/repositories/project-v2-repository";

const REPO_PATH = path.join(
  process.cwd(),
  "server/api/v2/repositories/project-v2-repository.ts",
);

describe("v2 finance cashflow enum-case guard (Task #124)", () => {
  describe("behavioral — generated SQL", () => {
    it("renders the cost_line_status IN-list as lowercase enum literals", () => {
      const { sql: generatedSql } = buildFinanceCashflowQuery(281).toSQL();
      const lower = generatedSql.toLowerCase();

      // Must contain the lowercase IN list that matches the enum domain.
      expect(lower).toMatch(/in\s*\(\s*'approved'\s*,\s*'paid'\s*\)/);
    });

    it("does NOT emit UPPERCASE enum literals that Postgres would reject", () => {
      const { sql: generatedSql } = buildFinanceCashflowQuery(281).toSQL();

      // Postgres enum cost_line_status only accepts lowercase domain values.
      // Any uppercase literal here would raise
      // `invalid input value for enum cost_line_status` at execution time.
      expect(generatedSql).not.toMatch(/'APPROVED'/);
      expect(generatedSql).not.toMatch(/'PAID'/);
      expect(generatedSql).not.toMatch(/'PLANNED'/);
      expect(generatedSql).not.toMatch(/'INVOICED'/);
    });

    it("filters by project_id, effective_to IS NULL, and deleted_at IS NULL", () => {
      // Sanity check that the regression fix didn't drop the existing
      // tenancy / soft-delete / temporal predicates.
      const { sql: generatedSql, params } = buildFinanceCashflowQuery(281).toSQL();
      const lower = generatedSql.toLowerCase();

      expect(lower).toContain('"project_id"');
      expect(lower).toMatch(/"effective_to"\s+is\s+null/);
      expect(lower).toMatch(/"deleted_at"\s+is\s+null/);
      expect(lower).toMatch(/group by/);
      // projectId travels as a parameter, not an inlined literal.
      expect(params).toContain(281);
    });
  });

  describe("source-text — function-local guard", () => {
    const source = fs.readFileSync(REPO_PATH, "utf8");

    it("uses only lowercase enum literals when comparing cost_line_status", () => {
      const fnMatch = source.match(
        /export\s+function\s+buildFinanceCashflowQuery\s*\([^)]*\)\s*\{[\s\S]*?\n\}/,
      );
      expect(fnMatch, "buildFinanceCashflowQuery function should exist").toBeTruthy();
      const body = fnMatch![0];

      expect(body).toMatch(/in\s*\(\s*'approved'\s*,\s*'paid'\s*\)/);

      const upperHits = body.match(/'(APPROVED|PAID|PLANNED|INVOICED)'/g);
      expect(
        upperHits,
        `buildFinanceCashflowQuery must not contain UPPERCASE cost_line_status literals — found: ${upperHits?.join(", ")}`,
      ).toBeNull();
    });
  });
});

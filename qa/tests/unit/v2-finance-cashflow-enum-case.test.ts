// Behavioral regression guard — Task #124.
//
// `cost_line_status` is a Postgres enum whose domain is lowercase
// {planned, invoiced, approved, paid}. The `getFinanceCashflow` query in
// `server/api/v2/repositories/project-v2-repository.ts` previously compared
// the column to UPPERCASE literals ('APPROVED','PAID'), which caused Postgres
// to throw `invalid input value for enum cost_line_status: "APPROVED"` and
// turned every `/api/v2/projects/:id/finance` call into a 500 — surfacing in
// the UI as a "Server Error / Request failed" toast on the project Commercial
// tab.
//
// This file pins the bug at TWO layers:
//   1. **Behavioral** — call `buildFinanceCashflowQuery` and inspect the
//      Drizzle `.toSQL()` output to assert that the IN-list rendered into
//      the actual SQL string is lowercase. This catches *runtime* SQL drift,
//      not just source-text drift.
//   2. **Source-text** — keep a cheap, fast static check on the function body
//      itself, matching the convention of the sibling
//      `qa/tests/unit/finance-snapshot-guards.test.ts`.

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../shared/schema";

// Mock the db module so importing the repository doesn't try to open a real
// Postgres connection. Drizzle's `.toSQL()` only needs a query builder — it
// never touches the underlying pool — so a no-op pg client is enough to
// exercise the actual `buildFinanceCashflowQuery` builder against the real
// schema and dialect.
vi.mock("../../../server/db", () => {
  const fakeClient = {
    query: () => { throw new Error("test stub: query() must not be called — toSQL() only"); },
  };
  return {
    db: drizzle(fakeClient as any, { schema }),
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

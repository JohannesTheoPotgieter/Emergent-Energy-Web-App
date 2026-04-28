// Regression guard — Task #124.
//
// `cost_line_status` is a Postgres enum whose domain is lowercase
// {planned, invoiced, approved, paid}. The `getFinanceCashflow` query in
// `server/api/v2/repositories/project-v2-repository.ts` previously compared
// the column to UPPERCASE literals ('APPROVED','PAID'), which caused Postgres
// to throw `invalid input value for enum cost_line_status: "APPROVED"` and
// turned every `/api/v2/projects/:id/finance` call into a 500 — surfacing in
// the UI as a "Server Error / Request failed" toast plus a downstream
// React #310 when the Commercial tab tried to render undefined finance data.
//
// This test pins the literals to lowercase so the regression cannot recur.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_PATH = path.join(
  process.cwd(),
  "server/api/v2/repositories/project-v2-repository.ts",
);

describe("v2 finance cashflow enum-case guard (Task #124)", () => {
  const source = fs.readFileSync(REPO_PATH, "utf8");

  it("uses only lowercase enum literals when comparing cost_line_status", () => {
    // Locate the `getFinanceCashflow` function body.
    const fnMatch = source.match(
      /export\s+async\s+function\s+getFinanceCashflow\s*\([^)]*\)\s*\{[\s\S]*?\n\}/,
    );
    expect(fnMatch, "getFinanceCashflow function should exist").toBeTruthy();
    const body = fnMatch![0];

    // Must contain the lowercase IN list.
    expect(body).toMatch(/in\s*\(\s*'approved'\s*,\s*'paid'\s*\)/);

    // Must NOT contain UPPERCASE enum literals — Postgres will raise
    // `invalid input value for enum cost_line_status` for these.
    expect(body).not.toMatch(/'APPROVED'/);
    expect(body).not.toMatch(/'PAID'/);
    expect(body).not.toMatch(/'PLANNED'/);
    expect(body).not.toMatch(/'INVOICED'/);
  });

  it("does not reintroduce UPPERCASE literals in getFinanceCashflow itself", () => {
    // Tightly scoped to the function that backs `/api/v2/projects/:id/finance`.
    // Other repo functions (`getProjectFinanceSummary`) historically use the
    // same uppercase literals but in a non-GROUP-BY context where Postgres
    // accepts them — those are intentionally out of scope for Task #124.
    const fnMatch = source.match(
      /export\s+async\s+function\s+getFinanceCashflow\s*\([^)]*\)\s*\{[\s\S]*?\n\}/,
    );
    const body = fnMatch?.[0] ?? "";
    const upperHits = body.match(/'(APPROVED|PAID|PLANNED|INVOICED)'/g);
    expect(
      upperHits,
      `getFinanceCashflow must not contain UPPERCASE cost_line_status literals — found: ${upperHits?.join(", ")}`,
    ).toBeNull();
  });
});

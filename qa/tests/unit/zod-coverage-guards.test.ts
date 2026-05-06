/**
 * Zod coverage regression guards (Phase 2b-PR2)
 *
 * Pins that the 10 highest-blast-radius finance + admin write endpoints
 * run validateBody(...) middleware. Previously these handlers accepted
 * `req.body` with only ad-hoc `typeof === "object"` / `!value` checks,
 * which let malformed payloads through into cashflow overrides, COS
 * period locks, revenue-tracking edits, and user/role mutations.
 *
 * Also asserts that the `no-restricted-syntax` rule in eslint.config.js
 * has been tightened beyond the original two selectors (Phase 2b-PR1)
 * to also ban whole-object `{ error: err }` passthrough and
 * `JSON.stringify(err)` inside `.json(...)` calls.
 *
 * Source-text assertions honour the same `// eslint-disable-next-line
 * no-restricted-syntax` exemption model as the lint rule.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Zod coverage — finance write surface", () => {
  const source = read("server/departments/finance-routes.ts");

  it("imports validateBody", () => {
    expect(source).toMatch(/from\s*["']\.\.\/middleware\/validateBody["']/);
  });

  const routes: Array<{ path: string; schema: string }> = [
    { path: "/api/cashflow-2026/expense-date-override", schema: "expenseDateOverrideSchema" },
    { path: "/api/cashflow-2026/inflow-date-override", schema: "inflowDateOverrideSchema" },
    { path: "/api/cashflow-2026/opening-balance", schema: "openingBalanceSchema" },
    { path: "/api/cashflow-2026/opex-budget", schema: "opexBudgetSchema" },
    { path: "/api/cashflow-2026/opex-weekly", schema: "opexWeeklySchema" },
    { path: "/api/cos-periods/:yyyyMm/lock", schema: "cosPeriodLockSchema" },
    { path: "/api/cos-periods/:yyyyMm/unlock", schema: "cosPeriodLockSchema" },
    { path: "/api/cashflow/planning-overrides", schema: "planningOverridesSchema" },
    { path: "/api/revenue-tracking/overrides", schema: "revenueTrackingOverridesSchema" },
  ];
  for (const { path: routePath, schema } of routes) {
    it(`POST ${routePath} runs validateBody(${schema})`, () => {
      const escaped = routePath.replace(/[/.]/g, (c) => "\\" + c);
      const regex = new RegExp(`${escaped}["'][\\s\\S]{0,400}validateBody\\(${schema}\\)`);
      expect(
        source,
        `${routePath} must run validateBody(${schema}) before the async handler — missing Zod on a finance write is the class of bug Phase 2b-PR2 closed.`,
      ).toMatch(regex);
    });
  }
});

describe("Zod coverage — admin user/role write surface", () => {
  const source = read("server/role-management.ts");

  it("imports validateBody", () => {
    expect(source).toMatch(/from\s*["']\.\/middleware\/validateBody["']/);
  });

  it("POST /api/admin/users runs validateBody(createUserSchema)", () => {
    expect(source).toMatch(/\/api\/admin\/users["'][\s\S]{0,400}validateBody\(createUserSchema\)/);
  });

  it("PATCH /api/admin/users/:userId/role runs validateBody(updateUserRoleSchema)", () => {
    expect(source).toMatch(/\/api\/admin\/users\/:userId\/role["'][\s\S]{0,400}validateBody\(updateUserRoleSchema\)/);
  });
});

describe("ESLint no-restricted-syntax — tightened selectors (Phase 2b-PR2)", () => {
  const source = read("eslint.config.js");

  it("keeps the original err.message/err.stack selector", () => {
    expect(source).toMatch(/MemberExpression\[object\.name=\/\^\(err\|error\)\$\/\]\[property\.name=\/\^\(message\|stack\)\$\/\]/);
  });

  it("keeps the String(err) selector", () => {
    expect(source).toMatch(/CallExpression\[callee\.name='String'\]/);
  });

  it("bans whole-object err / error passthrough into .json()", () => {
    expect(
      source,
      "eslint.config.js must include a selector that flags Property[value.name=/^(err|error)$/] inside .json() calls — stops the `res.json({ error: err })` whole-object leak.",
    ).toMatch(/Property\[value\.type='Identifier'\]\[value\.name=\/\^\(err\|error\)\$\/\]/);
  });

  it("bans JSON.stringify(err) / JSON.stringify(error) inside .json()", () => {
    expect(
      source,
      "eslint.config.js must include a selector that flags JSON.stringify(err) inside .json() calls — stops the serialised-raw-error leak.",
    ).toMatch(/callee\.object\.name='JSON'\]\[callee\.property\.name='stringify'/);
  });
});

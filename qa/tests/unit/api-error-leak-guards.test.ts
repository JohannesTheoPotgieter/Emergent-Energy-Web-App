/**
 * API error-leak regression guards (Phase 2a)
 *
 * These assertions pin the outcome of the Phase 2a sweep:
 *
 *   1. The listed handler files no longer respond with `res.status(5xx)
 *      .json({ error: err.message ... })` — the pattern that was leaking raw
 *      Drizzle / PostgreSQL error text (schema names, SQL fragments, params)
 *      to unauthenticated clients. Each listed file was proven live during
 *      the full-app QA to leak on at least one path.
 *
 *   2. The global error handler (server/middleware/errorHandler.ts) is
 *      wired to recognise ApiError and attach a traceId, so any error that
 *      still throws lands on a sanitised response body instead of the old
 *      generic `{ error: 'Internal server error', details: err.message }`
 *      shape.
 *
 *   3. The Zod middleware is applied to the two highest-blast-radius
 *      smart-import write endpoints (`commit`, `money-impact`) so that
 *      ad-hoc `typeof x === 'object'` body guards can't silently accept
 *      malformed override flags into the finance-write path.
 *
 * Source-text assertions are deliberate: the bugs regressed at the
 * source-text layer (a copy-pasted `res.status(500).json({ error: err.message })`
 * block). A grep is fast, deterministic, and catches the next regression
 * at the layer it will actually reappear.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// Files swept in Phase 2a. Each was proven live during QA to either
// leak raw error text or crash in a way that surfaced the leak. Every
// handler in these files was rewritten to propagate the error to the
// global middleware (Express 5 auto-propagates async rejections).
const SWEPT_FILES = [
  "server/kpi-traceability-routes.ts",
  "server/audit-routes.ts",
  "server/smart-import-routes.ts",
  "server/routes/cos-control-routes.ts",
  "server/admin-control-routes.ts",
];

const LEAK_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: "raw err.message in JSON response",
    // `res.status(5xx).json({ error: err.message ... })` and close variants.
    regex: /res\.status\(5\d{2}\)\.json\(\s*\{[^}]*\berr\.message\b/,
  },
  {
    name: "raw err.stack in JSON response",
    regex: /res\.status\(5\d{2}\)\.json\(\s*\{[^}]*\berr\.stack\b/,
  },
  {
    name: "err instanceof Error ? err.message : String(err) in JSON response",
    // The specific copy-pasted leak pattern this branch was full of.
    regex: /res\.status\(5\d{2}\)\.json\(\s*\{[^}]*err instanceof Error\s*\?\s*err\.message\s*:\s*String\(err\)/,
  },
];

describe("api error-leak guards — swept handler files", () => {
  for (const file of SWEPT_FILES) {
    describe(file, () => {
      const source = read(file);
      for (const { name, regex } of LEAK_PATTERNS) {
        it(`does not leak: ${name}`, () => {
          expect(
            source,
            `${file} still contains the forbidden pattern ${regex} — a raw error (err.message / err.stack / String(err)) is being returned to the client, which leaks DB schema / SQL. Throw the error (or throw an ApiError) and let the global error handler sanitise.`,
          ).not.toMatch(regex);
        });
      }
    });
  }
});

describe("global error handler — ApiError + traceId", () => {
  const source = read("server/middleware/errorHandler.ts");

  it("recognises ApiError and delegates to sendError", () => {
    expect(
      source,
      "errorHandler.ts must check `err instanceof ApiError` and delegate to sendError(res, err, traceId)",
    ).toMatch(/instanceof\s+ApiError[\s\S]*sendError\(/);
  });

  it("generates a per-request traceId", () => {
    expect(
      source,
      "errorHandler.ts must call randomUUID (or equivalent) to produce a traceId the client can report to support",
    ).toMatch(/randomUUID\(|crypto\.randomUUID/);
  });

  it("does not inline err.message or err.stack into the response body", () => {
    // The previous handler exposed details/stack in development; the new one
    // routes all error messaging through sendError(), which sanitises.
    expect(source).not.toMatch(/details:\s*err\.message/);
    expect(source).not.toMatch(/stack:\s*err\.stack/);
  });
});

describe("api-error.sendError — traceId support", () => {
  const source = read("server/lib/api-error.ts");
  it("accepts an optional traceId and echoes it into the response body", () => {
    expect(source).toMatch(/sendError\(\s*res:\s*Response\s*,\s*error:\s*unknown\s*,\s*traceId\??:\s*string/);
    expect(source).toMatch(/body\.traceId\s*=\s*traceId|traceId\s*\}\s*:\s*\{\s*\}/);
  });
});

describe("Zod coverage — smart-import write surface", () => {
  const source = read("server/smart-import-routes.ts");

  it("imports zod and validateBody", () => {
    expect(source).toMatch(/from\s*["']zod["']/);
    expect(source).toMatch(/from\s*["']\.\/middleware\/validateBody["']/);
  });

  it("applies validateBody on POST /:runId/commit", () => {
    expect(
      source,
      "POST /:runId/commit must run validateBody(commitBodySchema) — it gates finance writes with override flags",
    ).toMatch(/\/api\/smart-import\/:runId\/commit["'][\s\S]{0,400}validateBody\(commitBodySchema\)/);
  });

  it("applies validateBody on POST /:runId/money-impact", () => {
    expect(
      source,
      "POST /:runId/money-impact must run validateBody(moneyImpactBodySchema) — it accepts a decisions map that drives downstream behaviour",
    ).toMatch(/\/api\/smart-import\/:runId\/money-impact["'][\s\S]{0,400}validateBody\(moneyImpactBodySchema\)/);
  });
});

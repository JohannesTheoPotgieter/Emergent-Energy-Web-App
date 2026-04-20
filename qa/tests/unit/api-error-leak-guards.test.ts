/**
 * API error-leak regression guards (Phase 2a + 2b-PR1)
 *
 * These assertions pin the outcome of the two-phase error-leak sweep:
 *
 *   1. Every TypeScript file under server/ does not respond with
 *      `res.status(5xx).json({ error: err.message ... })` or its common
 *      variants. This pattern leaked raw Drizzle / PostgreSQL error text
 *      (schema names, SQL fragments, params) to any client who triggered
 *      an error. Phase 2a swept the worst 5 files; Phase 2b-PR1 swept the
 *      remaining 43 files and added an ESLint rule (no-restricted-syntax
 *      in eslint.config.js) that fails the lint build on any new
 *      occurrence — the ESLint rule is the authoritative forward guard;
 *      this test is a fast secondary at the source-text layer.
 *
 *   2. The global error handler (server/middleware/errorHandler.ts) is
 *      wired to recognise ApiError and attach a traceId, so any error
 *      that still throws lands on a sanitised response body instead of
 *      the old generic `{ error: 'Internal server error', details:
 *      err.message }` shape.
 *
 *   3. The Zod middleware is applied to the two highest-blast-radius
 *      smart-import write endpoints (`commit`, `money-impact`) so
 *      ad-hoc `typeof x === 'object'` body guards can't silently accept
 *      malformed override flags into the finance-write path.
 *
 * Legitimate exemptions (e.g. a typed 409 business error whose message
 * is user-authored) must carry an inline
 * `// eslint-disable-next-line no-restricted-syntax` with a one-line
 * justification. The assertions below honour those disables.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// Walk every TypeScript file under server/ and return relative paths.
// Excludes node_modules, dist, build, *.d.ts, and test fixtures.
function walkServer(): string[] {
  const root = path.join(process.cwd(), "server");
  const out: string[] = [];
  const skipDir = new Set(["node_modules", "dist", "build"]);
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDir.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(path.relative(process.cwd(), path.join(dir, entry.name)));
      }
    }
  })(root);
  return out.sort();
}

// Strip lines that are explicitly exempted via a preceding
// `// eslint-disable-next-line no-restricted-syntax` so the test honours
// the lint config's exemption model.
function stripExemptedLines(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const prev = lines[i - 1] ?? "";
    const twoAbove = lines[i - 2] ?? "";
    if (
      /eslint-disable-next-line[^\n]*no-restricted-syntax/.test(prev) ||
      /eslint-disable-next-line[^\n]*no-restricted-syntax/.test(twoAbove)
    ) {
      out.push(""); // blank it out so patterns on this line don't match
    } else {
      out.push(lines[i]);
    }
  }
  return out.join("\n");
}

const LEAK_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: "raw err.message in 5xx JSON response",
    regex: /res\.status\(5\d{2}\)\.json\(\s*\{[^}]*\berr\.message\b/,
  },
  {
    name: "raw err.stack in 5xx JSON response",
    regex: /res\.status\(5\d{2}\)\.json\(\s*\{[^}]*\berr\.stack\b/,
  },
  {
    name: "err instanceof Error ? err.message : String(err) in 5xx JSON response",
    regex: /res\.status\(5\d{2}\)\.json\(\s*\{[^}]*err instanceof Error\s*\?\s*err\.message\s*:\s*String\(err\)/,
  },
  {
    name: "raw error.message in 5xx JSON response",
    regex: /res\.status\(5\d{2}\)\.json\(\s*\{[^}]*\berror\.message\b/,
  },
];

describe("api error-leak guards — entire server tree", () => {
  const files = walkServer();
  for (const file of files) {
    describe(file, () => {
      const source = stripExemptedLines(read(file));
      for (const { name, regex } of LEAK_PATTERNS) {
        it(`does not leak: ${name}`, () => {
          expect(
            source,
            `${file} contains the forbidden leak pattern. If this is an intentional typed-error path, annotate the line with \`// eslint-disable-next-line no-restricted-syntax -- reason\`. Otherwise: throw the error (or throw an ApiError) and let the global handler sanitise.`,
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

/**
 * Wave-5 audit (2026-05-26) — evidence-evaluation-service § 5 contract.
 *
 * The previous implementation built every SQL statement via
 * `sql.raw()` with `.replace(/'/g, "''")` single-quote escaping. That's
 * a § 5 violation: "Raw SQL: avoid unless unavoidable. When unavoidable,
 * use `sql` tagged template + parameters — never string interpolation."
 *
 * Wave 5 rewrote the service to use parameterised `sql\`\`` templates
 * for every value. This test pins the contract so a future regression
 * (e.g. someone re-adds a `sql.raw\`...\${param}\`` interpolation)
 * fails CI.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = fs.readFileSync(
  path.join(
    __dirname,
    "../../../server/services/evidence-evaluation-service.ts",
  ),
  "utf8",
);

const COMMISSIONING_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../../server/commissioning-routes.ts"),
  "utf8",
);

describe("evidence-evaluation-service — § 5 SQL safety", () => {
  it("does NOT use sql.raw() in actual code (header comments may reference it)", () => {
    // sql.raw() bypasses parameter binding. Pure `sql\`\`` is fine.
    // Strip every // single-line comment before the regex runs so a
    // documentation mention of the banned pattern doesn't trip CI.
    const codeOnly = SOURCE.replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/sql\.raw\s*\(/);
  });

  it("does NOT use the .replace(/'/g, \"''\") manual-escape pattern", () => {
    expect(SOURCE).not.toContain(`.replace(/'/g, "''")`);
  });

  it("does use the tagged-template `sql\\`...\\`` form for queries", () => {
    // At minimum the SELECT and INSERT in evaluateEvidence + the INSERT
    // in upsertEvidenceItem use the tagged template — and we expect at
    // least 3 such occurrences.
    const tagged = SOURCE.match(/sql`/g) || [];
    expect(tagged.length).toBeGreaterThanOrEqual(3);
  });

  it("EVIDENCE_OVERRIDE_ROLES is typed against the canonical CompanyRole union", () => {
    expect(SOURCE).toMatch(/satisfies\s+readonly\s+CompanyRole\[\]/);
  });
});

describe("commissioning-routes — § 5 SQL safety (Task 0.4)", () => {
  it("does NOT use sql.raw() in actual code (header comments may reference it)", () => {
    // Same rule as the evidence service: sql.raw() bypasses parameter
    // binding. Strip single-line comments so a doc mention doesn't trip CI.
    const codeOnly = COMMISSIONING_SOURCE.replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/sql\.raw\s*\(/);
  });

  it("does NOT use the .replace(/'/g, \"''\") manual-escape pattern", () => {
    expect(COMMISSIONING_SOURCE).not.toContain(`.replace(/'/g, "''")`);
  });

  it("uses the tagged-template `sql\\`...\\`` form for its queries", () => {
    // The two SELECTs, the override INSERT, and the progress aggregate all
    // use parameterised tagged templates — expect at least 4.
    const tagged = COMMISSIONING_SOURCE.match(/sql`/g) || [];
    expect(tagged.length).toBeGreaterThanOrEqual(4);
  });

  it("no longer builds a WHERE clause by string concatenation", () => {
    // The old list handler did `whereClause += \` AND ci.item_type = '...'\``.
    expect(COMMISSIONING_SOURCE).not.toMatch(/whereClause\s*\+=/);
  });
});

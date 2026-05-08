/**
 * Source-pin tests for migrations/0056_seed_playbook_templates.sql.
 *
 * Plan v3 § 2.2 / D.3: seed all 13 playbook companion templates into
 * phase_template. These tests verify the migration file's structure
 * (without executing it) so:
 *   1. All 13 names from docs/operating-model/playbook-v2.0.md are present.
 *   2. Each row uses the canonical phase code from shared/phases.ts.
 *   3. Each INSERT has a `WHERE NOT EXISTS` idempotency guard.
 *   4. Re-running the migration produces zero new rows.
 *
 * Catches accidental rename, drop, or unguarded INSERT on review.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PHASE_CODES } from "../../../shared/phases";

const MIGRATION_PATH = path.join(
  process.cwd(),
  "migrations",
  "0056_seed_playbook_templates.sql",
);
const SQL = fs.readFileSync(MIGRATION_PATH, "utf8");

const EXPECTED_TEMPLATES: ReadonlyArray<{ name: string; phase: string }> = [
  // 13 playbook companion templates (docs/operating-model/playbook-v2.0.md:1233-1253)
  { name: "First Assessment Checklist", phase: "S01_FIRST_ASSESSMENT" },
  { name: "Feasibility Assumptions Register", phase: "S02_DESIGN_COST_PROPOSAL" },
  { name: "Cost Proposal Approval Sheet", phase: "S02_DESIGN_COST_PROPOSAL" },
  { name: "Financial Close Gate", phase: "S03_SIGNATURE_FINANCIAL_CLOSE" },
  { name: "PD-to-PM Handover", phase: "S03_SIGNATURE_FINANCIAL_CLOSE" },
  { name: "Construction Readiness Gate", phase: "S04_PLANNING" },
  { name: "HSE File Checklist", phase: "S04_PLANNING" },
  { name: "Commissioning Readiness Gate", phase: "S06_CONSTRUCTION" },
  { name: "O&M Handover to Matriarch", phase: "S08_OM_HANDOVER" },
  { name: "Client Handover Checklist", phase: "S09_CLIENT_HANDOVER" },
  { name: "3-Month Post-HO Review", phase: "S10_POST_HANDOVER_REVIEW" },
  { name: "Compliance Handover", phase: "S9B_COMPLIANCE_HANDOVER" },
  { name: "Hold / Blocked Register", phase: "S_HOLD" },
  // 5 additional operational templates surfaced during PR #852 review
  { name: "Project Brief Template", phase: "S04_PLANNING" },
  { name: "Commissioning Document", phase: "S07_COMMISSIONING" },
  { name: "Pre-Commissioning Red Team Review", phase: "S06_CONSTRUCTION" },
  { name: "Post-Works-Complete Red Team Review", phase: "S07_COMMISSIONING" },
  { name: "Project Introduction", phase: "S04_PLANNING" },
];

describe("0056_seed_playbook_templates — structure", () => {
  it("contains exactly 18 INSERT statements", () => {
    const inserts = SQL.match(/INSERT INTO phase_template/g) ?? [];
    expect(inserts.length).toBe(18);
  });

  it("contains exactly 18 WHERE NOT EXISTS idempotency guards", () => {
    const guards = SQL.match(/WHERE NOT EXISTS\s*\(/g) ?? [];
    expect(guards.length).toBe(18);
  });

  it("each INSERT pairs with a guard (no unguarded INSERT slipped through)", () => {
    // Split on INSERT statements; every block except the first prologue
    // should contain a `WHERE NOT EXISTS`.
    const blocks = SQL.split(/INSERT INTO phase_template/).slice(1);
    expect(blocks.length).toBe(18);
    for (const block of blocks) {
      expect(block, `INSERT block missing WHERE NOT EXISTS:\n${block.slice(0, 200)}`)
        .toMatch(/WHERE NOT EXISTS/);
    }
  });
});

describe("0056_seed_playbook_templates — content", () => {
  it.each(EXPECTED_TEMPLATES)(
    "includes template '%s' mapped to %s",
    ({ name, phase }) => {
      // Each template appears in two forms:
      //   SELECT line: `SELECT 'PHASE', 'NAME', 1, TRUE, ...`
      //   WHERE guard: `WHERE phase = 'PHASE' AND name = 'NAME' AND version = 1`
      // Verify both forms appear, exactly once each.
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const selectRe = new RegExp(`SELECT '${phase}',\\s*'${escapedName}'`, "g");
      const guardRe = new RegExp(
        `phase = '${phase}'\\s+AND\\s+name = '${escapedName}'\\s+AND\\s+version = 1`,
        "g",
      );
      const selectMatches = SQL.match(selectRe) ?? [];
      const guardMatches = SQL.match(guardRe) ?? [];
      expect(selectMatches.length, `SELECT line for (${phase}, ${name})`).toBe(1);
      expect(guardMatches.length, `WHERE NOT EXISTS guard for (${phase}, ${name})`).toBe(1);
    },
  );
});

describe("0056_seed_playbook_templates — phase code validity", () => {
  it("every phase code in the migration is canonical (in shared/phases.ts PHASE_CODES)", () => {
    const phaseRefs = SQL.match(/phase = '([A-Z0-9_]+)'/g) ?? [];
    expect(phaseRefs.length).toBeGreaterThan(0);
    const used = new Set<string>();
    for (const ref of phaseRefs) {
      const m = /phase = '([A-Z0-9_]+)'/.exec(ref);
      if (m) used.add(m[1]);
    }
    for (const code of used) {
      expect(PHASE_CODES as readonly string[], `phase code '${code}' is not in shared/phases.ts PHASE_CODES`)
        .toContain(code);
    }
  });

  it("includes the terminal phase code S_HOLD (template 13)", () => {
    expect(SQL).toContain("'S_HOLD'");
  });
});

describe("0056_seed_playbook_templates — version + active flags", () => {
  it("every INSERT seeds version=1, is_active=TRUE", () => {
    const blocks = SQL.split(/INSERT INTO phase_template/).slice(1);
    for (const block of blocks) {
      // The SELECT-row appears before the WHERE NOT EXISTS guard.
      const select = block.split("WHERE NOT EXISTS")[0];
      expect(select).toMatch(/,\s*1,\s*TRUE,/);
    }
  });
});

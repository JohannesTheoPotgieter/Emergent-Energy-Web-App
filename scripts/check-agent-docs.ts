/**
 * CI gate: docs/AGENT_GUARDRAILS.md drift detection.
 *
 * Plan v3 § 2.8 / D.9. Runs three checks; exits 1 on any failure with
 * file:line guidance for the contributor.
 *
 *   1. `Last verified` date is within FRESHNESS_THRESHOLD_DAYS of today.
 *   2. CLAUDE.md role-count claim equals shared/schema/users.ts COMPANY_ROLES.
 *   3. § 3.1 snapshot-table list equals the live schema (set equality).
 *
 * Run: `npm run check:agent-docs`. Wired into pr-checks.yml after db:check.
 *
 * Pure helpers live in scripts/lib/check-agent-docs-lib.ts so unit tests
 * can exercise them without invoking the CLI side effects below.
 */

import fs from "node:fs";
import path from "node:path";
import { COMPANY_ROLES } from "@shared/schema/users";
import {
  FRESHNESS_THRESHOLD_DAYS,
  parseLastVerified,
  daysBetween,
  parseRoleCount,
  parseSnapshotList,
  diffSets,
  listSnapshotTablesFromSchema,
} from "./lib/check-agent-docs-lib";

const ROOT = process.cwd();
const GUARDRAILS_REL = "docs/AGENT_GUARDRAILS.md";
const CLAUDE_REL = "CLAUDE.md";
const SCHEMA_DIR = "shared/schema";

function loadFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function main(): void {
  const failures: string[] = [];
  const guardrails = loadFile(GUARDRAILS_REL);
  const claude = loadFile(CLAUDE_REL);

  // 1 — Last verified freshness
  const lv = parseLastVerified(guardrails);
  if (!lv) {
    failures.push(
      `${GUARDRAILS_REL}: could not find a "Last verified: YYYY-MM-DD" line. Add one near the top.`,
    );
  } else {
    const age = daysBetween(lv.date, todayIso());
    if (age > FRESHNESS_THRESHOLD_DAYS) {
      failures.push(
        `${GUARDRAILS_REL}:${lv.line} — Last verified ${lv.date} is ${age} days old (threshold ${FRESHNESS_THRESHOLD_DAYS}). ` +
          `Run the freshness check (docs/claude-code-mastery-guide.md § "Keeping CLAUDE.md fresh"), ` +
          `reconcile every section against reality, then bump this date.`,
      );
    } else {
      console.log(`✓ Last verified ${lv.date} (${age} days old, threshold ${FRESHNESS_THRESHOLD_DAYS}).`);
    }
  }

  // 2 — Role count match
  const rc = parseRoleCount(claude);
  const actualRoleCount = COMPANY_ROLES.length;
  if (!rc) {
    failures.push(
      `${CLAUDE_REL}: could not find a "<N> company roles" claim. ` +
        `Add a line that names the count alongside a date stamp.`,
    );
  } else if (rc.count !== actualRoleCount) {
    failures.push(
      `${CLAUDE_REL}:${rc.line} — claims ${rc.count} company roles, but shared/schema/users.ts COMPANY_ROLES has ${actualRoleCount}. ` +
        `Update the claim in CLAUDE.md to match.`,
    );
  } else {
    console.log(`✓ Role count ${rc.count} matches COMPANY_ROLES.length.`);
  }

  // 3 — Snapshot-table list drift
  const sl = parseSnapshotList(guardrails);
  const actualTables = listSnapshotTablesFromSchema(path.join(ROOT, SCHEMA_DIR));
  if (!sl) {
    failures.push(
      `${GUARDRAILS_REL}: could not find a "Snapshot tables today: ..." line in § 3.1. ` +
        `Add one listing every table whose pgTable body declares effective_to.`,
    );
  } else {
    const { missing, extra } = diffSets(sl.tables, actualTables);
    if (missing.length > 0 || extra.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`missing from doc: ${missing.join(", ")}`);
      if (extra.length > 0) parts.push(`extra in doc (no longer in schema): ${extra.join(", ")}`);
      failures.push(
        `${GUARDRAILS_REL}:${sl.line} — § 3.1 snapshot-table list drifts from ${SCHEMA_DIR}/*.ts. ${parts.join("; ")}.`,
      );
    } else {
      console.log(`✓ Snapshot-table list (${actualTables.length} tables) matches schema.`);
    }
  }

  if (failures.length > 0) {
    console.error("");
    console.error("✗ check:agent-docs FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log("");
  console.log("All checks passed.");
}

main();

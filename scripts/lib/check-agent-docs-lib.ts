/**
 * Pure helpers for scripts/check-agent-docs.ts.
 *
 * Plan v3 § 2.8 / D.9: CI gate that fails PRs where
 *   - docs/AGENT_GUARDRAILS.md `Last verified` is older than 90 days
 *   - CLAUDE.md role-count claim doesn't match COMPANY_ROLES.length
 *   - § 3.1 snapshot-table list drifts from shared/schema/*.ts
 *
 * These functions are extracted so the test file can exercise them
 * with hand-built fixtures (no FS, no main() side effects on import).
 */

import fs from "node:fs";
import path from "node:path";

export const FRESHNESS_THRESHOLD_DAYS = 90;

export interface ParsedLastVerified {
  date: string;
  line: number;
}

/** Find the first `Last verified: YYYY-MM-DD` line. Returns null if absent. */
export function parseLastVerified(text: string): ParsedLastVerified | null {
  const lines = text.split("\n");
  // Tolerates markdown decorations (**, _, >) before/after "Last verified".
  const re = /Last verified:?[\s*_]*([0-9]{4}-[0-9]{2}-[0-9]{2})/i;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) return { date: m[1], line: i + 1 };
  }
  return null;
}

/** Day-count from `from` to `to` (both ISO yyyy-mm-dd). Negative if `to < from`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}

export interface ParsedRoleCount {
  count: number;
  line: number;
}

/** Find the first `<N> company roles` claim. Returns null if absent. */
export function parseRoleCount(text: string): ParsedRoleCount | null {
  const lines = text.split("\n");
  const re = /\b([0-9]+)\s+company\s+roles\b/i;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) return { count: parseInt(m[1], 10), line: i + 1 };
  }
  return null;
}

export interface ParsedSnapshotList {
  tables: string[];
  line: number;
}

/** Find `Snapshot tables today: \`a\`, \`b\`, ...`. Strips backticks/whitespace. */
export function parseSnapshotList(text: string): ParsedSnapshotList | null {
  const lines = text.split("\n");
  const re = /^\s*Snapshot tables today:\s*(.+?)\.?\s*$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const names = m[1]
      .split(",")
      .map((t) => t.replace(/`/g, "").trim())
      .filter((t) => t.length > 0);
    return { tables: names, line: i + 1 };
  }
  return null;
}

export interface SetDiff {
  missing: string[];
  extra: string[];
}

/** Sorted lists of names in `actual` but not `doc`, and `doc` but not `actual`. */
export function diffSets(doc: string[], actual: string[]): SetDiff {
  const docSet = new Set(doc);
  const actualSet = new Set(actual);
  return {
    missing: [...actual].filter((t) => !docSet.has(t)).sort(),
    extra: [...doc].filter((t) => !actualSet.has(t)).sort(),
  };
}

/**
 * Find every Drizzle table whose body declares an `effective_to` column
 * by walking backward from each column occurrence to the nearest
 * `export const NAME = pgTable(`. This handles both single-arg and
 * `(table) => ({...})` second-arg forms which a non-greedy block regex
 * can't bracket reliably.
 *
 * Pure modulo FS reads. Tests can stub the directory.
 */
export function listSnapshotTablesFromSchema(schemaDir: string): string[] {
  const files = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("index"));
  const out = new Set<string>();
  const colRe = /effectiveTo:\s*timestamp\("effective_to"\)/g;
  const tableRe = /export const (\w+) = pgTable\(/g;
  for (const file of files) {
    const text = fs.readFileSync(path.join(schemaDir, file), "utf8");
    // Index every `export const X = pgTable(` so we can find the nearest
    // preceding declaration for each column hit in O(n + m).
    const tableStarts: { name: string; offset: number }[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = tableRe.exec(text)) !== null) {
      tableStarts.push({ name: tm[1], offset: tm.index });
    }
    if (tableStarts.length === 0) continue;
    let cm: RegExpExecArray | null;
    while ((cm = colRe.exec(text)) !== null) {
      // Find the largest tableStart.offset <= cm.index.
      let owner: string | null = null;
      for (let i = tableStarts.length - 1; i >= 0; i--) {
        if (tableStarts[i].offset < cm.index) {
          owner = tableStarts[i].name;
          break;
        }
      }
      if (owner) out.add(owner);
    }
  }
  return [...out].sort();
}

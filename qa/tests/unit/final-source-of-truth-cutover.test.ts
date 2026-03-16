import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ACTIVE_SCAN_DIRS = ["server"];
const ALLOWLIST = [
  "server/migration-finalize-routes.ts",
  "server/work-items-backfill.ts",
  "server/departments/admin-routes.ts",
  "server/admin-control-routes.ts",
  "server/admin-recovery-routes.ts",
  "server/kpi-traceability-routes.ts",
  "server/lifecycle-routes.ts",
  "docs/",
  "migrations/",
  "shared/schema.ts",
];

const LEGACY_TABLE_PATTERNS: Array<{ table: string; regex: RegExp }> = [
  { table: "projects", regex: /\b(?:from|join|update|into|delete\s+from)\s+projects\s/i },
  { table: "tasks", regex: /\b(?:from|join|update|into|delete\s+from)\s+tasks\s/i },
  { table: "expenses", regex: /\b(?:from|join|update|into|delete\s+from)\s+expenses\s/i },
  { table: "revenues", regex: /\b(?:from|join|update|into|delete\s+from)\s+revenues\s/i },
  { table: "program_expense", regex: /\b(?:from|join|update|into|delete\s+from)\s+program_expense\s/i },
  { table: "program_inflows", regex: /\b(?:from|join|update|into|delete\s+from)\s+program_inflows\s/i },
  { table: "project_plan", regex: /\b(?:from|join|update|into|delete\s+from)\s+project_plan\s/i },
  { table: "company_projects", regex: /\b(?:from|join|update|into|delete\s+from)\s+company_projects\s/i },
  { table: "project_notes", regex: /\b(?:from|join|update|into|delete\s+from)\s+project_notes\s/i },
  { table: "project_tasks", regex: /\b(?:from|join|update|into|delete\s+from)\s+project_tasks\s/i },
];

function walkFiles(dir: string, acc: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      walkFiles(fullPath, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|js|jsx|sql)$/.test(entry.name)) continue;
    acc.push(fullPath);
  }
  return acc;
}

function isAllowlisted(relativeFilePath: string): boolean {
  return ALLOWLIST.some((prefix) => relativeFilePath.startsWith(prefix));
}

describe("final source-of-truth cutover policy", () => {
  it("blocks active runtime legacy table SQL usage outside allowlist", () => {
    const violations: string[] = [];
    const files = ACTIVE_SCAN_DIRS.flatMap((d) => walkFiles(path.join(ROOT, d)));

    for (const file of files) {
      const relativeFilePath = path.relative(ROOT, file).replace(/\\/g, "/");
      if (isAllowlisted(relativeFilePath)) continue;
      const content = fs.readFileSync(file, "utf8");

      for (const pattern of LEGACY_TABLE_PATTERNS) {
        if (pattern.regex.test(content)) {
          violations.push(`${relativeFilePath} -> ${pattern.table}`);
        }
      }
    }

    expect(violations, `Legacy table usage detected in active runtime files:\n${violations.join("\n")}`).toEqual([]);
  });
});

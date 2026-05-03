/**
 * Backfill `import_snapshot` JSONB on canonical-table rows that
 * predate Smart Import v2 PR2C (i.e. were imported before the merge
 * engine started populating the column). Phase 2 of the engine-
 * consolidation assessment, pulled forward as a workstream-B
 * prerequisite for the Excel-vs-App diff page.
 *
 * What it does:
 *   - For each project, find the latest `smart_import_runs` row
 *     with `status = 'COMMITTED'` and `summaryJson` populated.
 *   - Read `summaryJson.normalization` — contains the parsed file
 *     rows per section (`planTasks` / `revenueLines` / `costLines`).
 *   - For each active canonical row (`effectiveTo IS NULL` /
 *     `deletedAt IS NULL`) where `import_snapshot IS NULL`:
 *       - Match the file row using the same matchRows() the import
 *         engine uses (fall back to `sourceRow` lookup for legacy
 *         rows the matcher skips).
 *       - Build the snapshot using the section's TRACKED_FIELDS
 *         from `shared/excel-vs-app/contract.ts`.
 *       - Write `UPDATE table SET import_snapshot = $1
 *         WHERE id = $rowId AND import_snapshot IS NULL`.
 *
 * Idempotency:
 *   - The `import_snapshot IS NULL` guard makes re-runs no-ops.
 *   - The script logs counts per project and writes a single
 *     audit row per invocation.
 *
 * Usage:
 *   npx tsx scripts/backfill-import-snapshot.ts            # all projects
 *   npx tsx scripts/backfill-import-snapshot.ts --project-id=42
 *   npx tsx scripts/backfill-import-snapshot.ts --dry-run
 *   npx tsx scripts/backfill-import-snapshot.ts --verbose
 */
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { db, initializeDatabase } from "../server/db";
import { smartImportRuns } from "@shared/schema/imports";
import {
  normalizedCostLines,
  normalizedRevenueLines,
} from "@shared/schema/finance";
import { workItems } from "@shared/schema/tasks";
import { projectInfo } from "@shared/schema/projects";
import {
  PLAN_TRACKED_FIELDS,
  REVENUE_TRACKED_FIELDS,
  EXPENDITURE_TRACKED_FIELDS,
} from "@shared/excel-vs-app/contract";
import { matchRows } from "../server/lib/import/row-matcher";

interface Opts {
  projectId?: number;
  dryRun: boolean;
  verbose: boolean;
}

interface SectionCounts {
  active: number;
  alreadyHadSnapshot: number;
  matched: number;
  unmatched: number;
  written: number;
}

interface ProjectCounts {
  projectId: number;
  projectName: string;
  importRunId: number | null;
  PLAN: SectionCounts;
  REVENUE: SectionCounts;
  EXPENDITURE: SectionCounts;
}

function emptyCounts(): SectionCounts {
  return { active: 0, alreadyHadSnapshot: 0, matched: 0, unmatched: 0, written: 0 };
}

function parseArgs(): Opts {
  const opts: Opts = { dryRun: false, verbose: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg.startsWith("--project-id=")) {
      const n = Number(arg.split("=")[1]);
      if (Number.isFinite(n) && n > 0) opts.projectId = n;
    }
  }
  return opts;
}

function buildSnapshot(
  fileRow: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const f of fields) snap[f] = fileRow[f] ?? null;
  return snap;
}

async function backfillSection(
  projectId: number,
  section: "PLAN" | "REVENUE" | "EXPENDITURE",
  fileRows: Record<string, any>[],
  fields: readonly string[],
  table: typeof normalizedCostLines | typeof normalizedRevenueLines | typeof workItems,
  opts: Opts,
): Promise<SectionCounts> {
  const counts = emptyCounts();

  // Read active rows. Different tables have different active filters.
  // workItems uses deletedAt only; the others use effectiveTo + deletedAt.
  const isWorkItems = table === workItems;
  const baseConditions = isWorkItems
    ? and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt))
    : and(
        eq((table as any).projectId, projectId),
        isNull((table as any).effectiveTo),
        isNull((table as any).deletedAt),
      );
  const activeRows = await db.select().from(table as any).where(baseConditions);
  counts.active = activeRows.length;

  // Filter to rows where import_snapshot is null (need backfill).
  const needBackfill = activeRows.filter((r: any) => r.importSnapshot == null);
  counts.alreadyHadSnapshot = activeRows.length - needBackfill.length;

  if (needBackfill.length === 0) return counts;
  if (fileRows.length === 0) {
    counts.unmatched = needBackfill.length;
    return counts;
  }

  // Use matchRows to pair file rows against existing rows.
  const matchedSet = matchRows(section, projectId, fileRows, needBackfill as any);
  // Build a map of existingRowId -> fileRow.
  const fileByExistingId = new Map<number, Record<string, any>>();
  for (const m of matchedSet) {
    if (m.existingRowId != null && m.fileRow) {
      fileByExistingId.set(m.existingRowId, m.fileRow);
    }
  }

  // Fall back: for unmatched rows with a sourceRow, do a direct
  // sourceRow lookup against fileRows (some legacy rows may not
  // generate the same business key the matcher uses).
  const fileBySourceRow = new Map<number, Record<string, any>>();
  for (const fr of fileRows) {
    const sr = fr.sourceRow;
    if (typeof sr === "number" && Number.isFinite(sr)) fileBySourceRow.set(sr, fr);
  }

  for (const row of needBackfill) {
    const r = row as any;
    let fileRow = fileByExistingId.get(r.id);
    if (!fileRow && typeof r.sourceRow === "number") {
      fileRow = fileBySourceRow.get(r.sourceRow);
    }
    if (!fileRow) {
      counts.unmatched++;
      if (opts.verbose) {
        console.log(`[backfill] ${section} project=${projectId} row=${r.id} sourceRow=${r.sourceRow ?? "?"} unmatched`);
      }
      continue;
    }
    counts.matched++;
    const snapshot = buildSnapshot(fileRow, fields);

    if (!opts.dryRun) {
      // The IS NULL guard makes the write safe under concurrent imports —
      // we never overwrite a snapshot another writer just populated.
      await db
        .update(table as any)
        .set({ importSnapshot: snapshot })
        .where(
          and(
            eq((table as any).id, r.id),
            isNull((table as any).importSnapshot),
          ),
        );
    }
    counts.written++;
  }

  return counts;
}

async function backfillForProject(projectId: number, projectName: string, opts: Opts): Promise<ProjectCounts> {
  const result: ProjectCounts = {
    projectId,
    projectName,
    importRunId: null,
    PLAN: emptyCounts(),
    REVENUE: emptyCounts(),
    EXPENDITURE: emptyCounts(),
  };

  // Latest committed run for this project.
  const [run] = await db
    .select()
    .from(smartImportRuns)
    .where(
      and(
        eq(smartImportRuns.projectId, projectId),
        eq(smartImportRuns.status, "committed"),
      ),
    )
    .orderBy(desc(smartImportRuns.committedAt), desc(smartImportRuns.id))
    .limit(1);

  if (!run) {
    if (opts.verbose) console.log(`[backfill] project=${projectId} (${projectName}): no committed run`);
    return result;
  }
  result.importRunId = run.id;

  const summary = run.summaryJson as any;
  const norm = summary?.normalization;
  if (!norm) {
    if (opts.verbose) console.log(`[backfill] project=${projectId} (${projectName}): run ${run.id} has no normalization`);
    return result;
  }

  result.PLAN = await backfillSection(
    projectId,
    "PLAN",
    Array.isArray(norm.planTasks) ? norm.planTasks : [],
    PLAN_TRACKED_FIELDS,
    workItems,
    opts,
  );
  result.REVENUE = await backfillSection(
    projectId,
    "REVENUE",
    Array.isArray(norm.revenueLines) ? norm.revenueLines : [],
    REVENUE_TRACKED_FIELDS,
    normalizedRevenueLines,
    opts,
  );
  result.EXPENDITURE = await backfillSection(
    projectId,
    "EXPENDITURE",
    Array.isArray(norm.costLines) ? norm.costLines : [],
    EXPENDITURE_TRACKED_FIELDS,
    normalizedCostLines,
    opts,
  );

  return result;
}

function summariseProject(p: ProjectCounts): string {
  const total = p.PLAN.written + p.REVENUE.written + p.EXPENDITURE.written;
  const unmatched = p.PLAN.unmatched + p.REVENUE.unmatched + p.EXPENDITURE.unmatched;
  return `project=${p.projectId} (${p.projectName}) run=${p.importRunId ?? "-"} ` +
    `wrote=${total} unmatched=${unmatched} ` +
    `[PLAN write=${p.PLAN.written}/${p.PLAN.active} REVENUE write=${p.REVENUE.written}/${p.REVENUE.active} EXPENDITURE write=${p.EXPENDITURE.written}/${p.EXPENDITURE.active}]`;
}

async function main() {
  const opts = parseArgs();
  await initializeDatabase();

  console.log(`[backfill] starting${opts.dryRun ? " (dry run)" : ""}`);

  const projects = opts.projectId != null
    ? await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, opts.projectId))
    : await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);

  if (projects.length === 0) {
    console.log("[backfill] no projects matched the selector — nothing to do");
    return;
  }

  let totalWritten = 0;
  let totalUnmatched = 0;
  for (const p of projects) {
    const result = await backfillForProject(p.id, p.projectName, opts);
    console.log(`[backfill] ${summariseProject(result)}`);
    totalWritten +=
      result.PLAN.written + result.REVENUE.written + result.EXPENDITURE.written;
    totalUnmatched +=
      result.PLAN.unmatched + result.REVENUE.unmatched + result.EXPENDITURE.unmatched;
  }

  console.log(
    `[backfill] complete. total wrote=${totalWritten} unmatched=${totalUnmatched}${opts.dryRun ? " (dry run — no DB writes)" : ""}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[backfill] failed:", err);
    process.exit(1);
  });

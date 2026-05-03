import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeDatabase, db } from "../server/db.js";
import { workItems } from "@shared/schema/tasks";
import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import { buildNewPlanExternalRef } from "../server/lib/import/row-matcher";

type Mode = "dry-run" | "apply";

const args = new Set(process.argv.slice(2));
const mode: Mode = args.has("--apply") ? "apply" : "dry-run";
const REPORT_PATH = resolve("tmp/backfill-external-ref-report.json");

interface RowChange {
  id: number;
  projectId: number | null;
  oldRef: string | null;
  newRef: string;
  reason: "legacy_shape" | "missing_coords" | "collision_suffix";
  collisionSuffix?: string;
  sourceSheet: string | null;
  sourceRow: number | null;
  outlineNumber: string | null;
  isMilestone: boolean;
}

interface RowSkip {
  id: number;
  reason: string;
}

(async () => {
  await initializeDatabase();
  console.log(`[backfill-external-ref] mode=${mode}`);

  const rows = await db
    .select({
      id: workItems.id,
      projectId: workItems.projectId,
      externalRef: workItems.externalRef,
      sourceSheet: workItems.sourceSheet,
      sourceRow: workItems.sourceRow,
      outlineNumber: workItems.outlineNumber,
      isMilestone: workItems.isMilestone,
      deletedAt: workItems.deletedAt,
    })
    .from(workItems)
    .where(
      and(
        isNull(workItems.deletedAt),
        or(
          like(workItems.externalRef, "PID-%::PLAN::BK::%"),
          like(workItems.externalRef, "PID-%::PLAN::%"),
        ),
      ),
    )
    .orderBy(workItems.id);

  console.log(`[backfill-external-ref] candidate rows: ${rows.length}`);

  const changes: RowChange[] = [];
  const skips: RowSkip[] = [];
  const newRefByPid = new Map<string, Set<string>>();

  const ensureBucket = (pid: number) => {
    const k = String(pid);
    let s = newRefByPid.get(k);
    if (!s) { s = new Set(); newRefByPid.set(k, s); }
    return s;
  };

  for (const r of rows) {
    if (r.projectId == null) {
      skips.push({ id: r.id, reason: "no_project_id" });
      continue;
    }
    if (!r.sourceSheet || r.sourceRow == null) {
      skips.push({ id: r.id, reason: "missing_source_coords" });
      continue;
    }

    const baseRef = buildNewPlanExternalRef(r.projectId, {
      sourceSheet: r.sourceSheet,
      sourceRow: r.sourceRow,
      outlineNumber: r.outlineNumber,
      taskNo: null,
      isMilestone: r.isMilestone ?? false,
    });

    const bucket = ensureBucket(r.projectId);
    let finalRef = baseRef;
    let suffix: string | undefined;
    if (bucket.has(baseRef)) {
      suffix = `#pk${r.id}`;
      finalRef = `${baseRef}${suffix}`;
    }
    bucket.add(finalRef);

    if (finalRef === r.externalRef) {
      continue;
    }

    changes.push({
      id: r.id,
      projectId: r.projectId,
      oldRef: r.externalRef,
      newRef: finalRef,
      reason: suffix ? "collision_suffix" : "legacy_shape",
      collisionSuffix: suffix,
      sourceSheet: r.sourceSheet,
      sourceRow: r.sourceRow,
      outlineNumber: r.outlineNumber,
      isMilestone: r.isMilestone ?? false,
    });
  }

  let applied = 0;
  let applyFailed = 0;
  const applyErrors: Array<{ id: number; error: string }> = [];

  if (mode === "apply" && changes.length > 0) {
    for (const c of changes) {
      try {
        await db
          .update(workItems)
          .set({ externalRef: c.newRef, updatedAt: sql`NOW()` as any })
          .where(eq(workItems.id, c.id));
        applied++;
      } catch (e: any) {
        applyFailed++;
        applyErrors.push({ id: c.id, error: e?.message ?? String(e) });
      }
    }
  }

  try { mkdirSync("tmp", { recursive: true }); } catch {}
  const report = {
    mode,
    timestamp: new Date().toISOString(),
    candidateCount: rows.length,
    changeCount: changes.length,
    skipCount: skips.length,
    applied,
    applyFailed,
    byReason: changes.reduce<Record<string, number>>((acc, c) => {
      acc[c.reason] = (acc[c.reason] ?? 0) + 1;
      return acc;
    }, {}),
    skips,
    applyErrors,
    changes: changes.slice(0, 500),
    changesTruncated: changes.length > 500,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`[backfill-external-ref] candidates=${rows.length} changes=${changes.length} skips=${skips.length}`);
  console.log(`[backfill-external-ref] byReason=${JSON.stringify(report.byReason)}`);
  if (mode === "apply") {
    console.log(`[backfill-external-ref] applied=${applied} failed=${applyFailed}`);
  } else {
    console.log(`[backfill-external-ref] DRY RUN — re-run with --apply to commit.`);
  }
  console.log(`[backfill-external-ref] report: ${REPORT_PATH}`);
  process.exit(0);
})().catch((err) => {
  console.error(`[backfill-external-ref] FATAL`, err);
  process.exit(1);
});

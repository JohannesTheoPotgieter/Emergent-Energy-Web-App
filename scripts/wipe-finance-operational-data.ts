/**
 * Wipe Finance + Operational (Project Plan) data per project, before a
 * fresh Smart Import v2 re-import.
 *
 * Hybrid soft/hard delete — soft-delete where the schema supports it
 * (`effectiveTo` on snapshot tables, `deletedAt` on per-row soft-delete
 * tables); hard-delete linkage/legacy/metadata tables that have neither
 * column.
 *
 * DELETED
 * -------
 * Finance snapshot tables (set effectiveTo = NOW() on rows where
 * effectiveTo IS NULL):
 *   - normalized_revenue_lines
 *   - normalized_cost_lines
 *   - normalized_cost_line_actuals
 *   - category_revenue_allocations
 *   - cashflow_points
 *   - finance_revenue_monthly
 *   - finance_cos_monthly
 *   - tracker_revenue_summary
 *   - tracker_project_metadata
 *
 * Operational soft-delete tables (set deletedAt = NOW() on rows where
 * deletedAt IS NULL):
 *   - work_items
 *   - working_plan_scenario
 *
 * Legacy plan tables (hard delete; FK CASCADE handles dependencies):
 *   - project_plan         (cascades → project_plan_dependency,
 *                                       working_plan_dependency_override)
 *   - schedule_change_notice
 *   - normalized_plan_tasks
 *
 * Finance / plan linkage tables (hard delete — recreated on import):
 *   - expense_task_links
 *   - milestone_task_links
 *   - plan_edit_notifications
 *
 * Global import-bookkeeping tables — ONLY wiped when running against
 * all projects (skipped with `--project-id=N`):
 *   - manual_edit_flags
 *   - conflict_resolution_log
 *
 * PRESERVED (NEVER TOUCHED)
 * -------------------------
 *   - project_info itself (re-import populates linked data, not the project)
 *   - Engineering: deliverables, drawings, transmittals, engineering stages
 *     and tasks, project_eng_*, drawing_revisions
 *   - Quality: qc_*, ncr_*, commissioning_items, sseg_items, evidence_*
 *   - Cashflow opening-balance manual edits: cashflow_weekly_manual,
 *     cashflow_balance_history, available_payment_overrides,
 *     available_payment_history
 *   - User-curated finance overlays: weekly_reviews, budget_baselines,
 *     cos_period_locks
 *   - User-entered finance workflow: invoice_captures, procurement_items,
 *     purchase_orders, po_review_assignments, payment_requests,
 *     payment_batches, payment_batch_items, proof_of_payment
 *   - Smart Import history & learned patterns: smart_import_runs,
 *     import_issues, issue_resolution_rules, invoice_pattern_rules,
 *     invoice_pattern_matches, invoice_description_patterns, change_sets,
 *     field_changes, writeback_mappings, writeback_audit_log
 *   - work_items child tables (task_comments, task_checklists,
 *     task_attachments, task_deliverables, task_activity_log,
 *     task_watchers, work_item_tags, etc.) — they have FK cascade to
 *     work_items but we soft-delete the parent, so they remain physically
 *     but become unreachable through the standard `deletedAt IS NULL` joins.
 *
 * Usage:
 *   npx tsx scripts/wipe-finance-operational-data.ts                       # DRY RUN (default), all projects
 *   npx tsx scripts/wipe-finance-operational-data.ts --apply               # LIVE, all projects
 *   npx tsx scripts/wipe-finance-operational-data.ts --project-id=42       # DRY RUN, one project
 *   npx tsx scripts/wipe-finance-operational-data.ts --project-id=42 --apply  # LIVE, one project
 *
 * Idempotent: re-running picks up zero rows (effectiveTo / deletedAt
 * already set) for soft-deleted tables, and zero rows for hard-deleted
 * project-scoped tables.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, initializeDatabase } from "../server/db";
import {
  projectInfo,
  // Finance — effectiveTo snapshot tables
  normalizedRevenueLines,
  normalizedCostLines,
  normalizedCostLineActuals,
  categoryRevenueAllocations,
  cashflowPoints,
  financeRevenueMonthly,
  financeCosMonthly,
  trackerRevenueSummary,
  trackerProjectMetadata,
  // Operational — deletedAt soft-delete tables
  workItems,
  workingPlanScenario,
  // Operational — hard-delete (no soft-delete column)
  projectPlan,
  scheduleChangeNotice,
  normalizedPlanTasks,
  // Finance/plan linkage — hard-delete
  expenseTaskLinks,
  milestoneTaskLinks,
  planEditNotifications,
  // Global import-bookkeeping — only when running all projects
  manualEditFlags,
  conflictResolutionLog,
} from "@shared/schema";

interface Opts {
  projectId?: number;
  apply: boolean;
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = { apply: false };
  for (const a of argv.slice(2)) {
    if (a === "--apply") opts.apply = true;
    else if (a === "--dry-run") opts.apply = false;
    else if (a.startsWith("--project-id=")) {
      const v = Number(a.slice("--project-id=".length));
      if (!Number.isFinite(v)) throw new Error(`Invalid --project-id: ${a}`);
      opts.projectId = v;
    } else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: npx tsx scripts/wipe-finance-operational-data.ts [--dry-run | --apply] [--project-id=N]",
      );
      console.log("Default mode: --dry-run (no writes). Pass --apply to mutate.");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

type CountKey =
  | "normalizedRevenueLines"
  | "normalizedCostLines"
  | "normalizedCostLineActuals"
  | "categoryRevenueAllocations"
  | "cashflowPoints"
  | "financeRevenueMonthly"
  | "financeCosMonthly"
  | "trackerRevenueSummary"
  | "trackerProjectMetadata"
  | "workItems"
  | "workingPlanScenario"
  | "projectPlan"
  | "scheduleChangeNotice"
  | "normalizedPlanTasks"
  | "expenseTaskLinks"
  | "milestoneTaskLinks"
  | "planEditNotifications";

type Counts = Record<CountKey, number>;

async function countWhere(query: any): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(query.table)
    .where(query.where);
  return count;
}

async function gatherCounts(projectId: number): Promise<Counts> {
  // Active-row counts for soft-delete tables (effectiveTo IS NULL / deletedAt IS NULL).
  // All-row counts for hard-delete tables (entire projectId scope).
  const eff = (tbl: any) =>
    countWhere({
      table: tbl,
      where: and(eq(tbl.projectId, projectId), isNull(tbl.effectiveTo)),
    });
  const del = (tbl: any) =>
    countWhere({
      table: tbl,
      where: and(eq(tbl.projectId, projectId), isNull(tbl.deletedAt)),
    });
  const all = (tbl: any) =>
    countWhere({ table: tbl, where: eq(tbl.projectId, projectId) });

  const [
    normalizedRevenueLinesCount,
    normalizedCostLinesCount,
    normalizedCostLineActualsCount,
    categoryRevenueAllocationsCount,
    cashflowPointsCount,
    financeRevenueMonthlyCount,
    financeCosMonthlyCount,
    trackerRevenueSummaryCount,
    trackerProjectMetadataCount,
    workItemsCount,
    workingPlanScenarioCount,
    projectPlanCount,
    scheduleChangeNoticeCount,
    normalizedPlanTasksCount,
    expenseTaskLinksCount,
    milestoneTaskLinksCount,
    planEditNotificationsCount,
  ] = await Promise.all([
    eff(normalizedRevenueLines),
    eff(normalizedCostLines),
    eff(normalizedCostLineActuals),
    eff(categoryRevenueAllocations),
    eff(cashflowPoints),
    eff(financeRevenueMonthly),
    eff(financeCosMonthly),
    eff(trackerRevenueSummary),
    eff(trackerProjectMetadata),
    del(workItems),
    del(workingPlanScenario),
    all(projectPlan),
    all(scheduleChangeNotice),
    all(normalizedPlanTasks),
    all(expenseTaskLinks),
    all(milestoneTaskLinks),
    all(planEditNotifications),
  ]);

  return {
    normalizedRevenueLines: normalizedRevenueLinesCount,
    normalizedCostLines: normalizedCostLinesCount,
    normalizedCostLineActuals: normalizedCostLineActualsCount,
    categoryRevenueAllocations: categoryRevenueAllocationsCount,
    cashflowPoints: cashflowPointsCount,
    financeRevenueMonthly: financeRevenueMonthlyCount,
    financeCosMonthly: financeCosMonthlyCount,
    trackerRevenueSummary: trackerRevenueSummaryCount,
    trackerProjectMetadata: trackerProjectMetadataCount,
    workItems: workItemsCount,
    workingPlanScenario: workingPlanScenarioCount,
    projectPlan: projectPlanCount,
    scheduleChangeNotice: scheduleChangeNoticeCount,
    normalizedPlanTasks: normalizedPlanTasksCount,
    expenseTaskLinks: expenseTaskLinksCount,
    milestoneTaskLinks: milestoneTaskLinksCount,
    planEditNotifications: planEditNotificationsCount,
  };
}

function printCounts(projectId: number, projectName: string, counts: Counts): number {
  const entries = Object.entries(counts) as [CountKey, number][];
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  console.log(`\n[project ${projectId}] ${projectName}  (total rows to delete: ${total})`);
  if (total === 0) {
    console.log("  (nothing to do)");
    return 0;
  }
  for (const [key, n] of entries) {
    if (n > 0) console.log(`  ${key.padEnd(32)} ${n}`);
  }
  return total;
}

async function mutateProject(projectId: number, counts: Counts, now: Date): Promise<void> {
  await db.transaction(async (tx: typeof db) => {
    // a) Hard-delete linkage tables first — both have an FK CASCADE on
    //    task_id → project_plan.id, so they must go before project_plan
    //    (otherwise the CASCADE would handle them anyway, but explicit
    //    is clearer and works under the projectId scope without
    //    relying on cascade order).
    if (counts.planEditNotifications > 0) {
      await tx
        .delete(planEditNotifications)
        .where(eq(planEditNotifications.projectId, projectId));
    }
    if (counts.expenseTaskLinks > 0) {
      await tx
        .delete(expenseTaskLinks)
        .where(eq(expenseTaskLinks.projectId, projectId));
    }
    if (counts.milestoneTaskLinks > 0) {
      await tx
        .delete(milestoneTaskLinks)
        .where(eq(milestoneTaskLinks.projectId, projectId));
    }

    // b) Hard-delete schedule notices & normalized plan tasks (no FKs into
    //    them from anything we care about).
    if (counts.scheduleChangeNotice > 0) {
      await tx
        .delete(scheduleChangeNotice)
        .where(eq(scheduleChangeNotice.projectId, projectId));
    }
    if (counts.normalizedPlanTasks > 0) {
      await tx
        .delete(normalizedPlanTasks)
        .where(eq(normalizedPlanTasks.projectId, projectId));
    }

    // c) Hard-delete project_plan. FK CASCADE sweeps project_plan_dependency
    //    and working_plan_dependency_override rows that reference these
    //    predecessor/successor task ids.
    if (counts.projectPlan > 0) {
      await tx.delete(projectPlan).where(eq(projectPlan.projectId, projectId));
    }

    // d) Soft-delete working_plan_scenario (parent of cascaded
    //    working_plan_dependency_override rows wiped in step c).
    if (counts.workingPlanScenario > 0) {
      await tx
        .update(workingPlanScenario)
        .set({ deletedAt: now, updatedAt: now } as any)
        .where(
          and(
            eq(workingPlanScenario.projectId, projectId),
            isNull(workingPlanScenario.deletedAt),
          ),
        );
    }

    // e) Soft-delete work_items (parent; child tables stay physically but
    //    become unreachable through the standard deletedAt IS NULL joins).
    if (counts.workItems > 0) {
      await tx
        .update(workItems)
        .set({ deletedAt: now, updatedAt: now } as any)
        .where(and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt)));
    }

    // f) Soft-delete finance snapshot tables — set effectiveTo = NOW().
    //    This is the canonical SCD-2 pattern; the re-import will insert
    //    fresh rows with effectiveTo IS NULL and the partial unique
    //    indexes on (project_id, row_hash) WHERE effectiveTo IS NULL
    //    will accept the new rows.
    const snapshotTargets: [any, number][] = [
      [normalizedRevenueLines, counts.normalizedRevenueLines],
      [normalizedCostLines, counts.normalizedCostLines],
      [normalizedCostLineActuals, counts.normalizedCostLineActuals],
      [categoryRevenueAllocations, counts.categoryRevenueAllocations],
      [cashflowPoints, counts.cashflowPoints],
      [financeRevenueMonthly, counts.financeRevenueMonthly],
      [financeCosMonthly, counts.financeCosMonthly],
      [trackerRevenueSummary, counts.trackerRevenueSummary],
      [trackerProjectMetadata, counts.trackerProjectMetadata],
    ];
    for (const [tbl, n] of snapshotTargets) {
      if (n > 0) {
        await tx
          .update(tbl)
          .set({ effectiveTo: now } as any)
          .where(and(eq(tbl.projectId, projectId), isNull(tbl.effectiveTo)));
      }
    }
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  await initializeDatabase();

  const scopeLabel = opts.projectId != null ? `project=${opts.projectId}` : "ALL projects";
  const modeLabel = opts.apply ? "(LIVE)" : "(DRY RUN — no writes)";
  console.log(`\n[wipe-finance-operational-data] Scope: ${scopeLabel}  ${modeLabel}`);
  console.log(
    "[wipe-finance-operational-data] Preserves: Engineering, Quality, cashflow opening-balance manual edits, weeklyReviews, budgetBaselines, cosPeriodLocks, POs/invoices/payments/procurement, Smart Import history.",
  );

  // Look up target projects.
  const projects =
    opts.projectId != null
      ? await db
          .select({ id: projectInfo.id, name: projectInfo.projectName })
          .from(projectInfo)
          .where(eq(projectInfo.id, opts.projectId))
      : await db
          .select({ id: projectInfo.id, name: projectInfo.projectName })
          .from(projectInfo)
          .where(isNull(projectInfo.deletedAt));

  if (projects.length === 0) {
    console.log("\n[wipe-finance-operational-data] No matching projects found.");
    return;
  }

  console.log(`\n[wipe-finance-operational-data] Processing ${projects.length} project(s).`);

  const failed: { id: number; name: string; err: unknown }[] = [];
  let projectsTouched = 0;
  let totalRows = 0;
  const now = new Date();

  for (const p of projects) {
    try {
      const counts = await gatherCounts(p.id);
      const total = printCounts(p.id, p.name, counts);
      totalRows += total;
      if (opts.apply && total > 0) {
        await mutateProject(p.id, counts, now);
        console.log(`  ✓ applied`);
        projectsTouched++;
      }
    } catch (err) {
      console.error(`  ✗ FAILED for project ${p.id} (${p.name}):`, err);
      failed.push({ id: p.id, name: p.name, err });
    }
  }

  // Global import-bookkeeping tables — only when wiping ALL projects.
  // These have no projectId column; per-project cleanup would require
  // entity-id join logic that isn't worth it for ad-hoc cleanup.
  if (opts.projectId == null) {
    console.log("\n[wipe-finance-operational-data] Global tables (no projectId column):");
    const [{ count: mefCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(manualEditFlags);
    const [{ count: crlCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conflictResolutionLog);
    console.log(`  manual_edit_flags        ${mefCount}`);
    console.log(`  conflict_resolution_log  ${crlCount}`);

    if (opts.apply) {
      if (mefCount > 0) await db.delete(manualEditFlags);
      if (crlCount > 0) await db.delete(conflictResolutionLog);
      if (mefCount + crlCount > 0) console.log(`  ✓ wiped`);
    }
  } else {
    console.log(
      "\n[wipe-finance-operational-data] Skipping manual_edit_flags / conflict_resolution_log (only wiped when running on ALL projects).",
    );
  }

  // Summary.
  console.log("\n[wipe-finance-operational-data] Summary:");
  console.log(`  projects scanned : ${projects.length}`);
  console.log(`  rows in scope    : ${totalRows}`);
  if (opts.apply) {
    console.log(`  projects mutated : ${projectsTouched}`);
  }
  if (failed.length > 0) {
    console.error(`  FAILED projects  : ${failed.length} (${failed.map((f) => f.id).join(", ")})`);
    process.exit(1);
  }
  console.log(
    opts.apply
      ? "\n[wipe-finance-operational-data] DONE (applied).\n"
      : "\n[wipe-finance-operational-data] DRY RUN COMPLETE. Re-run with --apply to mutate.\n",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[wipe-finance-operational-data] FAILED:", err);
    process.exit(1);
  });

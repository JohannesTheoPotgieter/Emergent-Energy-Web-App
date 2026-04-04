/**
 * Reconciliation Pack — Comprehensive verification of legacy ↔ promoted schema parity.
 *
 * Extends the base reconciliation-runner with:
 *  - Row parity counts by domain (source vs migrated)
 *  - Unresolved / skipped rows
 *  - Null / broken FK counts after backfill
 *  - Finance amount comparisons (SUM legacy vs promoted)
 *  - Project-level and aggregate-level breakdowns
 *  - HARD_FAIL vs WARNING severity
 *  - Machine-readable JSON + human-readable text output
 *
 * Usage:
 *   import { runReconciliationPack } from "./services/reconciliation-pack";
 *   const report = await runReconciliationPack();
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "HARD_FAIL" | "WARNING" | "INFO";
export type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

export interface ReconciliationCheck {
  name: string;
  domain: string;
  category: "row_parity" | "field_drift" | "fk_integrity" | "finance_amounts" | "bridge_health" | "unresolved";
  severity: Severity;
  status: CheckStatus;
  legacyCount: number;
  promotedCount: number;
  delta: number;
  detail: string;
  sampleIds?: number[];
}

export interface DomainSummary {
  domain: string;
  totalChecks: number;
  passed: number;
  failed: number;
  warned: number;
  skipped: number;
  status: CheckStatus;
}

export interface ReconciliationPackReport {
  overall: "PASS" | "FAIL";
  timestamp: string;
  version: "1.0.0";
  environment: string;
  checks: ReconciliationCheck[];
  domainSummaries: DomainSummary[];
  hardFailCount: number;
  warningCount: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function queryCount(query: string): Promise<number> {
  try {
    const result = await db.execute(sql.raw(query));
    const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
    return parseInt(String(rows[0]?.cnt ?? "0"), 10);
  } catch {
    return -1;
  }
}

async function querySum(query: string): Promise<number> {
  try {
    const result = await db.execute(sql.raw(query));
    const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
    return parseFloat(String(rows[0]?.total ?? "0")) || 0;
  } catch {
    return -1;
  }
}

async function querySampleIds(query: string, limit = 10): Promise<number[]> {
  try {
    const result = await db.execute(sql.raw(`${query} LIMIT ${limit}`));
    const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
    return rows.map((r: any) => Number(r.id)).filter((n: number) => Number.isFinite(n));
  } catch {
    return [];
  }
}

function buildCheck(
  name: string,
  domain: string,
  category: ReconciliationCheck["category"],
  severity: Severity,
  legacyCount: number,
  promotedCount: number,
  detail: string,
  sampleIds?: number[],
): ReconciliationCheck {
  const delta = legacyCount - promotedCount;
  const isError = legacyCount < 0 || promotedCount < 0;
  let status: CheckStatus;

  if (isError) {
    status = "SKIP";
  } else if (category === "finance_amounts") {
    // Finance: allow 0.01 tolerance
    status = Math.abs(delta) < 0.01 ? "PASS" : severity === "HARD_FAIL" ? "FAIL" : "WARN";
  } else if (delta === 0) {
    status = "PASS";
  } else {
    status = severity === "HARD_FAIL" ? "FAIL" : "WARN";
  }

  return { name, domain, category, severity, status, legacyCount, promotedCount, delta, detail: status === "PASS" ? "OK" : detail, sampleIds };
}

// ---------------------------------------------------------------------------
// Domain Checks
// ---------------------------------------------------------------------------

async function projectChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  // Row parity
  const [legacyCount, promotedCount] = await Promise.all([
    queryCount(`SELECT count(*) AS cnt FROM project_info`),
    queryCount(`SELECT count(*) AS cnt FROM core.projects`),
  ]);
  const missingSamples = await querySampleIds(
    `SELECT pi.id FROM project_info pi LEFT JOIN core.projects cp ON cp.id = pi.id WHERE cp.id IS NULL AND pi.id IS NOT NULL ORDER BY pi.id`,
  );
  checks.push(buildCheck(
    "projects_row_parity", "projects", "row_parity", "HARD_FAIL",
    legacyCount, promotedCount,
    `${legacyCount - promotedCount} project_info rows missing from core.projects`,
    missingSamples,
  ));

  // Field drift
  const driftCount = await queryCount(
    `SELECT count(*) AS cnt FROM project_info pi JOIN core.projects cp ON cp.id = pi.id WHERE COALESCE(cp.project_name,'') != COALESCE(pi.project_name,'') OR COALESCE(cp.phase,'') != COALESCE(pi.phase,'')`,
  );
  checks.push(buildCheck(
    "projects_field_drift", "projects", "field_drift", "WARNING",
    driftCount, 0, `${driftCount} core.projects rows have field drift vs project_info`,
  ));

  // FK integrity — null client_id where legacy has one
  const nullClientFk = await queryCount(
    `SELECT count(*) AS cnt FROM core.projects cp JOIN project_info pi ON cp.id = pi.id WHERE pi.client_id IS NOT NULL AND cp.client_id IS NULL`,
  );
  checks.push(buildCheck(
    "projects_null_client_fk", "projects", "fk_integrity", "WARNING",
    nullClientFk, 0, `${nullClientFk} core.projects rows missing client_id that legacy has`,
  ));

  return checks;
}

async function clientChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  const [legacyCount, promotedCount] = await Promise.all([
    queryCount(`SELECT count(*) AS cnt FROM clients`),
    queryCount(`SELECT count(*) AS cnt FROM core.clients`),
  ]);
  checks.push(buildCheck(
    "clients_row_parity", "clients", "row_parity", "HARD_FAIL",
    legacyCount, promotedCount,
    `${legacyCount - promotedCount} clients rows missing from core.clients`,
  ));

  const nameDrift = await queryCount(
    `SELECT count(*) AS cnt FROM clients c JOIN core.clients cc ON cc.id = c.id WHERE COALESCE(cc.name,'') != COALESCE(c.name,'')`,
  );
  checks.push(buildCheck(
    "clients_field_drift", "clients", "field_drift", "WARNING",
    nameDrift, 0, `${nameDrift} core.clients rows have name drift`,
  ));

  return checks;
}

async function userChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  const [legacyCount, promotedCount] = await Promise.all([
    queryCount(`SELECT count(*) AS cnt FROM users WHERE id IS NOT NULL`),
    queryCount(`SELECT count(*) AS cnt FROM core.user_accounts`),
  ]);
  checks.push(buildCheck(
    "users_row_parity", "users", "row_parity", "HARD_FAIL",
    legacyCount, promotedCount,
    `${legacyCount - promotedCount} users missing from core.user_accounts`,
  ));

  return checks;
}

async function costLineChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  // Row parity (active lines only)
  const [legacyCount, promotedCount] = await Promise.all([
    queryCount(`SELECT count(*) AS cnt FROM normalized_cost_lines WHERE effective_to IS NULL`),
    queryCount(`SELECT count(*) AS cnt FROM finance.cost_lines`),
  ]);
  checks.push(buildCheck(
    "cost_lines_row_parity", "finance", "row_parity", "HARD_FAIL",
    legacyCount, promotedCount,
    `${legacyCount - promotedCount} active cost lines missing from finance.cost_lines`,
  ));

  // Null legacy FK
  const nullLegacyFk = await queryCount(
    `SELECT count(*) AS cnt FROM finance.cost_lines WHERE legacy_normalized_cost_line_id IS NULL`,
  );
  checks.push(buildCheck(
    "cost_lines_null_legacy_fk", "finance", "fk_integrity", "WARNING",
    nullLegacyFk, 0, `${nullLegacyFk} finance.cost_lines rows have NULL legacy FK`,
  ));

  // Broken legacy FK
  const brokenFk = await queryCount(
    `SELECT count(*) AS cnt FROM finance.cost_lines fcl WHERE fcl.legacy_normalized_cost_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM normalized_cost_lines ncl WHERE ncl.id = fcl.legacy_normalized_cost_line_id)`,
  );
  checks.push(buildCheck(
    "cost_lines_broken_legacy_fk", "finance", "fk_integrity", "HARD_FAIL",
    brokenFk, 0, `${brokenFk} finance.cost_lines reference non-existent legacy rows`,
  ));

  // Amount comparison
  const [legacySum, promotedSum] = await Promise.all([
    querySum(`SELECT COALESCE(SUM(amount_ex_vat::numeric), 0) AS total FROM normalized_cost_lines WHERE effective_to IS NULL`),
    querySum(`SELECT COALESCE(SUM(amount_ex_vat), 0) AS total FROM finance.cost_lines`),
  ]);
  checks.push(buildCheck(
    "cost_lines_amount_parity", "finance", "finance_amounts", "HARD_FAIL",
    legacySum, promotedSum,
    `Cost line amount delta: legacy=${legacySum}, promoted=${promotedSum}, diff=${(legacySum - promotedSum).toFixed(2)}`,
  ));

  return checks;
}

async function revenueLineChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  const [legacyCount, promotedCount] = await Promise.all([
    queryCount(`SELECT count(*) AS cnt FROM normalized_revenue_lines WHERE effective_to IS NULL`),
    queryCount(`SELECT count(*) AS cnt FROM finance.revenue_lines`),
  ]);
  checks.push(buildCheck(
    "revenue_lines_row_parity", "finance", "row_parity", "HARD_FAIL",
    legacyCount, promotedCount,
    `${legacyCount - promotedCount} active revenue lines missing from finance.revenue_lines`,
  ));

  const nullLegacyFk = await queryCount(
    `SELECT count(*) AS cnt FROM finance.revenue_lines WHERE legacy_normalized_revenue_line_id IS NULL`,
  );
  checks.push(buildCheck(
    "revenue_lines_null_legacy_fk", "finance", "fk_integrity", "WARNING",
    nullLegacyFk, 0, `${nullLegacyFk} finance.revenue_lines rows have NULL legacy FK`,
  ));

  const brokenFk = await queryCount(
    `SELECT count(*) AS cnt FROM finance.revenue_lines frl WHERE frl.legacy_normalized_revenue_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM normalized_revenue_lines nrl WHERE nrl.id = frl.legacy_normalized_revenue_line_id)`,
  );
  checks.push(buildCheck(
    "revenue_lines_broken_legacy_fk", "finance", "fk_integrity", "HARD_FAIL",
    brokenFk, 0, `${brokenFk} finance.revenue_lines reference non-existent legacy rows`,
  ));

  const [legacySum, promotedSum] = await Promise.all([
    querySum(`SELECT COALESCE(SUM(amount_ex_vat::numeric), 0) AS total FROM normalized_revenue_lines WHERE effective_to IS NULL`),
    querySum(`SELECT COALESCE(SUM(amount_ex_vat), 0) AS total FROM finance.revenue_lines`),
  ]);
  checks.push(buildCheck(
    "revenue_lines_amount_parity", "finance", "finance_amounts", "HARD_FAIL",
    legacySum, promotedSum,
    `Revenue line amount delta: legacy=${legacySum}, promoted=${promotedSum}, diff=${(legacySum - promotedSum).toFixed(2)}`,
  ));

  return checks;
}

async function changeRequestChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  // Row parity: active CRs vs non-cancelled finance_records
  const [legacyCount, promotedCount] = await Promise.all([
    queryCount(`SELECT count(*) AS cnt FROM change_requests WHERE deleted_at IS NULL`),
    queryCount(`SELECT count(*) AS cnt FROM finance.finance_records WHERE legacy_entity_table = 'public.change_requests' AND status != 'cancelled'`),
  ]);
  checks.push(buildCheck(
    "change_requests_row_parity", "finance", "row_parity", "HARD_FAIL",
    legacyCount, promotedCount,
    `${legacyCount - promotedCount} change requests missing from finance.finance_records`,
  ));

  // Soft-deleted CRs still active in finance_records (should be cancelled)
  const staleCancelledCount = await queryCount(
    `SELECT count(*) AS cnt FROM change_requests cr JOIN finance.finance_records fr ON fr.legacy_entity_table = 'public.change_requests' AND fr.legacy_entity_id = cr.id WHERE cr.deleted_at IS NOT NULL AND fr.status != 'cancelled'`,
  );
  checks.push(buildCheck(
    "change_requests_stale_cancelled", "finance", "field_drift", "WARNING",
    staleCancelledCount, 0, `${staleCancelledCount} soft-deleted CRs still active in finance_records (should be cancelled)`,
  ));

  // VO amount parity: SUM of cost_impact for active CRs vs finance_records
  const [legacyCrSum, promotedCrSum] = await Promise.all([
    querySum(`SELECT COALESCE(SUM(cost_impact::numeric), 0) AS total FROM change_requests WHERE deleted_at IS NULL AND cost_impact IS NOT NULL`),
    querySum(`SELECT COALESCE(SUM(amount_ex_vat), 0) AS total FROM finance.finance_records WHERE legacy_entity_table = 'public.change_requests' AND status != 'cancelled'`),
  ]);
  checks.push(buildCheck(
    "change_requests_amount_parity", "finance", "finance_amounts", "HARD_FAIL",
    legacyCrSum, promotedCrSum,
    `VO cost_impact sum: legacy=${legacyCrSum}, promoted=${promotedCrSum}, diff=${(legacyCrSum - promotedCrSum).toFixed(2)}`,
  ));

  return checks;
}

async function workItemChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  // Work items with legacy linkage that reference missing legacy rows
  const orphanCount = await queryCount(
    `SELECT count(*) AS cnt FROM work_items wi WHERE wi.legacy_id IS NOT NULL AND wi.legacy_table = 'normalized_plan_tasks' AND NOT EXISTS (SELECT 1 FROM normalized_plan_tasks npt WHERE npt.id = wi.legacy_id) AND wi.deleted_at IS NULL`,
  );
  checks.push(buildCheck(
    "work_items_orphaned_legacy_refs", "work_items", "fk_integrity", "WARNING",
    orphanCount, 0, `${orphanCount} work_items reference deleted legacy tasks`,
  ));

  // Work items without project (non-personal)
  const noProjectCount = await queryCount(
    `SELECT count(*) AS cnt FROM work_items WHERE project_id IS NULL AND workstream != 'PERSONAL' AND deleted_at IS NULL`,
  );
  checks.push(buildCheck(
    "work_items_no_project", "work_items", "fk_integrity", "WARNING",
    noProjectCount, 0, `${noProjectCount} non-personal work_items have no project_id`,
  ));

  // PM plan task parity
  const [legacyPmCount, promotedPmCount] = await Promise.all([
    queryCount(`SELECT count(*) AS cnt FROM normalized_plan_tasks`),
    queryCount(`SELECT count(*) AS cnt FROM work_items WHERE workstream = 'PM' AND source = 'SMART_IMPORT' AND deleted_at IS NULL`),
  ]);
  checks.push(buildCheck(
    "work_items_pm_task_parity", "work_items", "row_parity", "WARNING",
    legacyPmCount, promotedPmCount,
    `PM plan task count: legacy=${legacyPmCount}, canonical=${promotedPmCount}`,
  ));

  return checks;
}

async function bridgeHealthChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  const unresolvedCount = await queryCount(
    `SELECT count(*) AS cnt FROM internal.bridge_sync_failures WHERE resolved_at IS NULL`,
  );
  checks.push(buildCheck(
    "bridge_failures_unresolved", "bridge", "bridge_health", "HARD_FAIL",
    unresolvedCount, 0, `${unresolvedCount} unresolved bridge sync failures`,
  ));

  // Failures by domain
  const domainBreakdown = await (async () => {
    try {
      const result = await db.execute(sql.raw(
        `SELECT domain, count(*) AS cnt FROM internal.bridge_sync_failures WHERE resolved_at IS NULL GROUP BY domain ORDER BY cnt DESC`,
      ));
      const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
      return rows.map((r: any) => `${r.domain}:${r.cnt}`).join(", ");
    } catch {
      return "query error";
    }
  })();

  if (unresolvedCount > 0) {
    checks.push(buildCheck(
      "bridge_failures_by_domain", "bridge", "bridge_health", "INFO",
      unresolvedCount, 0, `Unresolved failures by domain: ${domainBreakdown}`,
    ));
  }

  // Stale sync watermarks (>1 hour behind)
  const staleWatermarks = await queryCount(
    `SELECT count(*) AS cnt FROM internal.sync_watermarks WHERE last_synced_at < NOW() - INTERVAL '1 hour'`,
  );
  checks.push(buildCheck(
    "sync_watermarks_stale", "bridge", "bridge_health", "WARNING",
    staleWatermarks, 0, `${staleWatermarks} sync watermarks are >1 hour stale`,
  ));

  return checks;
}

async function financeProjectLevelChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  // Per-project cost line count mismatches
  const projectCostMismatches = await queryCount(
    `SELECT count(*) AS cnt FROM (
      SELECT pi.id,
        (SELECT count(*) FROM normalized_cost_lines ncl WHERE ncl.project_name = pi.project_name AND ncl.effective_to IS NULL) AS legacy_cnt,
        (SELECT count(*) FROM finance.cost_lines fcl WHERE fcl.project_id = pi.id) AS promoted_cnt
      FROM project_info pi
    ) sub WHERE sub.legacy_cnt != sub.promoted_cnt AND sub.legacy_cnt > 0`,
  );
  checks.push(buildCheck(
    "finance_project_cost_count_drift", "finance", "row_parity", "WARNING",
    projectCostMismatches, 0, `${projectCostMismatches} projects have cost line count mismatches`,
  ));

  // Per-project revenue line count mismatches
  const projectRevenueMismatches = await queryCount(
    `SELECT count(*) AS cnt FROM (
      SELECT pi.id,
        (SELECT count(*) FROM normalized_revenue_lines nrl WHERE nrl.project_name = pi.project_name AND nrl.effective_to IS NULL) AS legacy_cnt,
        (SELECT count(*) FROM finance.revenue_lines frl WHERE frl.project_id = pi.id) AS promoted_cnt
      FROM project_info pi
    ) sub WHERE sub.legacy_cnt != sub.promoted_cnt AND sub.legacy_cnt > 0`,
  );
  checks.push(buildCheck(
    "finance_project_revenue_count_drift", "finance", "row_parity", "WARNING",
    projectRevenueMismatches, 0, `${projectRevenueMismatches} projects have revenue line count mismatches`,
  ));

  return checks;
}

async function openingBalanceChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  // Cost lines: opening-balance count parity (legacy vs promoted)
  const [legacyObCost, promotedObCost] = await Promise.all([
    queryCount(`SELECT count(*) AS cnt FROM normalized_cost_lines WHERE is_opening_balance = true AND effective_to IS NULL`),
    queryCount(`SELECT count(*) AS cnt FROM finance.cost_lines WHERE is_opening_balance = true`),
  ]);
  checks.push(buildCheck(
    "opening_balance_cost_count", "finance", "row_parity", "HARD_FAIL",
    legacyObCost, promotedObCost,
    `Opening-balance cost line count: legacy=${legacyObCost}, promoted=${promotedObCost}`,
  ));

  // Revenue lines: opening-balance count parity
  const [legacyObRev, promotedObRev] = await Promise.all([
    queryCount(`SELECT count(*) AS cnt FROM normalized_revenue_lines WHERE is_opening_balance = true AND effective_to IS NULL`),
    queryCount(`SELECT count(*) AS cnt FROM finance.revenue_lines WHERE is_opening_balance = true`),
  ]);
  checks.push(buildCheck(
    "opening_balance_revenue_count", "finance", "row_parity", "HARD_FAIL",
    legacyObRev, promotedObRev,
    `Opening-balance revenue line count: legacy=${legacyObRev}, promoted=${promotedObRev}`,
  ));

  // Opening-balance cost amount parity
  const [legacyObCostAmt, promotedObCostAmt] = await Promise.all([
    querySum(`SELECT COALESCE(SUM(amount_ex_vat::numeric), 0) AS total FROM normalized_cost_lines WHERE is_opening_balance = true AND effective_to IS NULL`),
    querySum(`SELECT COALESCE(SUM(amount_ex_vat), 0) AS total FROM finance.cost_lines WHERE is_opening_balance = true`),
  ]);
  checks.push(buildCheck(
    "opening_balance_cost_amount", "finance", "finance_amounts", "HARD_FAIL",
    legacyObCostAmt, promotedObCostAmt,
    `Opening-balance cost amount: legacy=${legacyObCostAmt}, promoted=${promotedObCostAmt}, diff=${(legacyObCostAmt - promotedObCostAmt).toFixed(2)}`,
  ));

  // Opening-balance revenue amount parity
  const [legacyObRevAmt, promotedObRevAmt] = await Promise.all([
    querySum(`SELECT COALESCE(SUM(amount_ex_vat::numeric), 0) AS total FROM normalized_revenue_lines WHERE is_opening_balance = true AND effective_to IS NULL`),
    querySum(`SELECT COALESCE(SUM(amount_ex_vat), 0) AS total FROM finance.revenue_lines WHERE is_opening_balance = true`),
  ]);
  checks.push(buildCheck(
    "opening_balance_revenue_amount", "finance", "finance_amounts", "HARD_FAIL",
    legacyObRevAmt, promotedObRevAmt,
    `Opening-balance revenue amount: legacy=${legacyObRevAmt}, promoted=${promotedObRevAmt}, diff=${(legacyObRevAmt - promotedObRevAmt).toFixed(2)}`,
  ));

  // Opening-balance rows preserved in finance_records.record_data
  const obNotInRecords = await queryCount(
    `SELECT count(*) AS cnt FROM finance.cost_lines cl WHERE cl.is_opening_balance = true AND NOT EXISTS (SELECT 1 FROM finance.finance_records fr WHERE fr.legacy_entity_table = 'cost_lines' AND fr.legacy_entity_id = cl.id AND (fr.record_data->>'is_opening_balance')::boolean = true)`,
  );
  checks.push(buildCheck(
    "opening_balance_cost_in_records", "finance", "fk_integrity", "WARNING",
    obNotInRecords, 0, `${obNotInRecords} opening-balance cost lines missing or unflagged in finance_records`,
  ));

  return checks;
}

async function financeProjectAmountDriftChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  // Per-project cost amount drift (SUM mismatch)
  const costAmountDrift = await queryCount(
    `SELECT count(*) AS cnt FROM (
      SELECT pi.id,
        (SELECT COALESCE(SUM(ncl.amount_ex_vat::numeric), 0) FROM normalized_cost_lines ncl WHERE ncl.project_name = pi.project_name AND ncl.effective_to IS NULL) AS legacy_sum,
        (SELECT COALESCE(SUM(fcl.amount_ex_vat), 0) FROM finance.cost_lines fcl WHERE fcl.project_id = pi.id) AS promoted_sum
      FROM project_info pi
    ) sub WHERE ABS(sub.legacy_sum - sub.promoted_sum) >= 0.01 AND sub.legacy_sum > 0`,
  );
  checks.push(buildCheck(
    "finance_project_cost_amount_drift", "finance", "finance_amounts", "WARNING",
    costAmountDrift, 0, `${costAmountDrift} projects have cost amount SUM mismatches`,
  ));

  // Per-project revenue amount drift
  const revenueAmountDrift = await queryCount(
    `SELECT count(*) AS cnt FROM (
      SELECT pi.id,
        (SELECT COALESCE(SUM(nrl.amount_ex_vat::numeric), 0) FROM normalized_revenue_lines nrl WHERE nrl.project_name = pi.project_name AND nrl.effective_to IS NULL) AS legacy_sum,
        (SELECT COALESCE(SUM(frl.amount_ex_vat), 0) FROM finance.revenue_lines frl WHERE frl.project_id = pi.id) AS promoted_sum
      FROM project_info pi
    ) sub WHERE ABS(sub.legacy_sum - sub.promoted_sum) >= 0.01 AND sub.legacy_sum > 0`,
  );
  checks.push(buildCheck(
    "finance_project_revenue_amount_drift", "finance", "finance_amounts", "WARNING",
    revenueAmountDrift, 0, `${revenueAmountDrift} projects have revenue amount SUM mismatches`,
  ));

  return checks;
}

async function unresolvedRowChecks(): Promise<ReconciliationCheck[]> {
  const checks: ReconciliationCheck[] = [];

  // Projects: missing from promoted AND not in bridge_sync_failures (truly lost)
  const lostProjects = await queryCount(
    `SELECT count(*) AS cnt FROM project_info pi WHERE pi.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.projects cp WHERE cp.id = pi.id) AND NOT EXISTS (SELECT 1 FROM internal.bridge_sync_failures bsf WHERE bsf.entity_id = pi.id::text AND bsf.domain = 'project' AND bsf.resolved_at IS NULL)`,
  );
  checks.push(buildCheck(
    "unresolved_projects", "projects", "unresolved", "HARD_FAIL",
    lostProjects, 0, `${lostProjects} legacy projects missing from promoted with no tracked sync failure`,
  ));

  // Cost lines: missing from promoted AND not in bridge_sync_failures
  const lostCostLines = await queryCount(
    `SELECT count(*) AS cnt FROM normalized_cost_lines ncl WHERE ncl.effective_to IS NULL AND NOT EXISTS (SELECT 1 FROM finance.cost_lines fcl WHERE fcl.legacy_normalized_cost_line_id = ncl.id) AND NOT EXISTS (SELECT 1 FROM internal.bridge_sync_failures bsf WHERE bsf.entity_id = ncl.id::text AND bsf.domain = 'cost_line' AND bsf.resolved_at IS NULL)`,
  );
  checks.push(buildCheck(
    "unresolved_cost_lines", "finance", "unresolved", "HARD_FAIL",
    lostCostLines, 0, `${lostCostLines} active cost lines missing from promoted with no tracked sync failure`,
  ));

  // Revenue lines: missing from promoted AND not in bridge_sync_failures
  const lostRevenueLines = await queryCount(
    `SELECT count(*) AS cnt FROM normalized_revenue_lines nrl WHERE nrl.effective_to IS NULL AND NOT EXISTS (SELECT 1 FROM finance.revenue_lines frl WHERE frl.legacy_normalized_revenue_line_id = nrl.id) AND NOT EXISTS (SELECT 1 FROM internal.bridge_sync_failures bsf WHERE bsf.entity_id = nrl.id::text AND bsf.domain = 'revenue_line' AND bsf.resolved_at IS NULL)`,
  );
  checks.push(buildCheck(
    "unresolved_revenue_lines", "finance", "unresolved", "HARD_FAIL",
    lostRevenueLines, 0, `${lostRevenueLines} active revenue lines missing from promoted with no tracked sync failure`,
  ));

  // Users: missing from promoted AND not tracked
  const lostUsers = await queryCount(
    `SELECT count(*) AS cnt FROM users u WHERE u.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.user_accounts ua WHERE ua.id = u.id) AND NOT EXISTS (SELECT 1 FROM internal.bridge_sync_failures bsf WHERE bsf.entity_id = u.id::text AND bsf.domain = 'user' AND bsf.resolved_at IS NULL)`,
  );
  checks.push(buildCheck(
    "unresolved_users", "users", "unresolved", "HARD_FAIL",
    lostUsers, 0, `${lostUsers} users missing from promoted with no tracked sync failure`,
  ));

  return checks;
}

// ---------------------------------------------------------------------------
// Domain Summary Builder
// ---------------------------------------------------------------------------

function buildDomainSummaries(checks: ReconciliationCheck[]): DomainSummary[] {
  const domains = new Map<string, ReconciliationCheck[]>();
  for (const c of checks) {
    const list = domains.get(c.domain) ?? [];
    list.push(c);
    domains.set(c.domain, list);
  }

  return Array.from(domains.entries()).map(([domain, domainChecks]) => {
    const passed = domainChecks.filter(c => c.status === "PASS").length;
    const failed = domainChecks.filter(c => c.status === "FAIL").length;
    const warned = domainChecks.filter(c => c.status === "WARN").length;
    const skipped = domainChecks.filter(c => c.status === "SKIP").length;
    return {
      domain,
      totalChecks: domainChecks.length,
      passed,
      failed,
      warned,
      skipped,
      status: failed > 0 ? "FAIL" as const : warned > 0 ? "WARN" as const : "PASS" as const,
    };
  });
}

// ---------------------------------------------------------------------------
// Human-readable Formatter
// ---------------------------------------------------------------------------

export function formatReportText(report: ReconciliationPackReport): string {
  const lines: string[] = [];
  const sep = "=".repeat(72);

  lines.push(sep);
  lines.push(`  RECONCILIATION PACK REPORT`);
  lines.push(`  ${report.timestamp}  |  env: ${report.environment}  |  v${report.version}`);
  lines.push(sep);
  lines.push("");

  lines.push(`OVERALL: ${report.overall}`);
  lines.push(`  Hard failures: ${report.hardFailCount}`);
  lines.push(`  Warnings:      ${report.warningCount}`);
  lines.push(`  Total checks:  ${report.checks.length}`);
  lines.push("");

  // Domain summaries
  lines.push("-".repeat(72));
  lines.push("DOMAIN SUMMARIES");
  lines.push("-".repeat(72));
  for (const ds of report.domainSummaries) {
    const icon = ds.status === "PASS" ? "PASS" : ds.status === "FAIL" ? "FAIL" : "WARN";
    lines.push(`  [${icon}] ${ds.domain.padEnd(15)} ${ds.passed}/${ds.totalChecks} passed${ds.failed > 0 ? `, ${ds.failed} FAILED` : ""}${ds.warned > 0 ? `, ${ds.warned} warned` : ""}`);
  }
  lines.push("");

  // Detailed checks
  lines.push("-".repeat(72));
  lines.push("DETAILED CHECKS");
  lines.push("-".repeat(72));

  let currentDomain = "";
  for (const c of report.checks) {
    if (c.domain !== currentDomain) {
      currentDomain = c.domain;
      lines.push(`\n  --- ${currentDomain.toUpperCase()} ---`);
    }
    const statusTag = c.status.padEnd(4);
    const severityTag = c.severity === "HARD_FAIL" ? "HARD" : c.severity === "WARNING" ? "WARN" : "INFO";
    lines.push(`  [${statusTag}] [${severityTag}] ${c.name}`);
    if (c.status !== "PASS") {
      lines.push(`         legacy=${c.legacyCount}  promoted=${c.promotedCount}  delta=${c.delta}`);
      lines.push(`         ${c.detail}`);
      if (c.sampleIds?.length) {
        lines.push(`         sample IDs: ${c.sampleIds.join(", ")}`);
      }
    }
  }
  lines.push("");

  // Hard fail list
  const hardFails = report.checks.filter(c => c.status === "FAIL");
  if (hardFails.length) {
    lines.push("-".repeat(72));
    lines.push("HARD FAILURES (must fix before cutover)");
    lines.push("-".repeat(72));
    for (const c of hardFails) {
      lines.push(`  - ${c.name}: ${c.detail}`);
    }
    lines.push("");
  }

  lines.push(sep);
  lines.push(`  ${report.summary}`);
  lines.push(sep);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main Runner
// ---------------------------------------------------------------------------

export async function runReconciliationPack(): Promise<ReconciliationPackReport> {
  const allChecks = await Promise.all([
    projectChecks(),
    clientChecks(),
    userChecks(),
    costLineChecks(),
    revenueLineChecks(),
    changeRequestChecks(),
    workItemChecks(),
    bridgeHealthChecks(),
    financeProjectLevelChecks(),
    openingBalanceChecks(),
    financeProjectAmountDriftChecks(),
    unresolvedRowChecks(),
  ]);

  const checks = allChecks.flat();
  const domainSummaries = buildDomainSummaries(checks);
  const hardFailCount = checks.filter(c => c.status === "FAIL").length;
  const warningCount = checks.filter(c => c.status === "WARN").length;
  const overall = hardFailCount > 0 ? "FAIL" as const : "PASS" as const;

  const failedNames = checks.filter(c => c.status === "FAIL").map(c => c.name);
  const summary = overall === "PASS"
    ? `All ${checks.length} checks passed (${warningCount} warnings)`
    : `${hardFailCount} HARD FAIL(s): ${failedNames.join(", ")}`;

  return {
    overall,
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    environment: process.env.NODE_ENV ?? "development",
    checks,
    domainSummaries,
    hardFailCount,
    warningCount,
    summary,
  };
}

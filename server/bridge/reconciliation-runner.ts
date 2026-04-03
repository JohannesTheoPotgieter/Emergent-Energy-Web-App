/**
 * Reconciliation Runner — Verifies legacy ↔ promoted schema parity.
 *
 * Each check returns { name, pass, failCount, detail }.
 * Overall result: PASS only if ALL checks pass (failCount === 0).
 *
 * Usage:
 *   import { runReconciliation } from "./bridge/reconciliation-runner";
 *   const result = await runReconciliation();
 *   console.log(result.overall); // "PASS" | "FAIL"
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface ReconciliationCheck {
  name: string;
  pass: boolean;
  failCount: number;
  detail: string;
}

export interface ReconciliationResult {
  overall: "PASS" | "FAIL";
  timestamp: string;
  checks: ReconciliationCheck[];
  summary: string;
}

async function runCheck(name: string, query: string, detail: string): Promise<ReconciliationCheck> {
  try {
    const result = await db.execute(sql.raw(query));
    const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
    const failCount = parseInt(String(rows[0]?.fail_count ?? "0"), 10);
    return { name, pass: failCount === 0, failCount, detail: failCount > 0 ? `${detail}: ${failCount} rows` : "OK" };
  } catch (err) {
    return { name, pass: false, failCount: -1, detail: `Query error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function runReconciliation(): Promise<ReconciliationResult> {
  const checks = await Promise.all([
    runCheck(
      "projects_missing",
      `SELECT count(*) AS fail_count FROM project_info pi LEFT JOIN core.projects cp ON cp.id = pi.id WHERE cp.id IS NULL AND pi.id IS NOT NULL`,
      "Legacy project_info rows missing from core.projects",
    ),
    runCheck(
      "projects_stale",
      `SELECT count(*) AS fail_count FROM project_info pi JOIN core.projects cp ON cp.id = pi.id WHERE cp.last_synced_at < pi.updated_at - INTERVAL '5 minutes'`,
      "core.projects rows stale vs project_info",
    ),
    runCheck(
      "clients_missing",
      `SELECT count(*) AS fail_count FROM clients c LEFT JOIN core.clients cc ON cc.id = c.id WHERE cc.id IS NULL AND c.id IS NOT NULL`,
      "Legacy clients missing from core.clients",
    ),
    runCheck(
      "cost_lines_missing",
      `SELECT count(*) AS fail_count FROM normalized_cost_lines ncl LEFT JOIN finance.cost_lines fcl ON fcl.legacy_normalized_cost_line_id = ncl.id WHERE ncl.effective_to IS NULL AND fcl.id IS NULL`,
      "Active cost lines missing from finance.cost_lines",
    ),
    runCheck(
      "revenue_lines_missing",
      `SELECT count(*) AS fail_count FROM normalized_revenue_lines nrl LEFT JOIN finance.revenue_lines frl ON frl.legacy_normalized_revenue_line_id = nrl.id WHERE nrl.effective_to IS NULL AND frl.id IS NULL`,
      "Active revenue lines missing from finance.revenue_lines",
    ),
    runCheck(
      "change_requests_missing",
      `SELECT count(*) AS fail_count FROM change_requests cr LEFT JOIN finance.finance_records fr ON fr.legacy_entity_table = 'public.change_requests' AND fr.legacy_entity_id = cr.id WHERE cr.deleted_at IS NULL AND fr.id IS NULL`,
      "Change requests missing from finance.finance_records",
    ),
  ]);

  const overall = checks.every(c => c.pass) ? "PASS" : "FAIL";
  const failedChecks = checks.filter(c => !c.pass);
  const summary = overall === "PASS"
    ? `All ${checks.length} reconciliation checks passed`
    : `${failedChecks.length}/${checks.length} checks failed: ${failedChecks.map(c => c.name).join(", ")}`;

  return {
    overall,
    timestamp: new Date().toISOString(),
    checks,
    summary,
  };
}

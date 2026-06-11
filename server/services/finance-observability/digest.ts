/**
 * Monthly finance-health digest.
 *
 * A scheduled roll-up the owner gets even when nothing fired — proof the
 * monitoring itself is alive, plus the month's integrity-guard outcomes (R4).
 * Goes through the same dispatchAlert pipeline to the COO inbox.
 */

import { and, desc, gte } from "drizzle-orm";
import { db } from "../../db";
import { financeIntegrityRuns, type FinanceIntegrityRun } from "@shared/schema";
import { getFinanceHealth, type FinanceHealthReport } from "./health";
import { notifyFinanceOwner } from "./notify";

export interface FinanceDigest {
  generatedAt: string;
  health: FinanceHealthReport;
  integrityRunsThisPeriod: FinanceIntegrityRun[];
  title: string;
  body: string;
}

const LEVEL_ICON: Record<string, string> = {
  healthy: "🟢",
  warn: "🟡",
  critical: "🔴",
  unknown: "⚪",
};

export async function buildFinanceDigest(now: Date = new Date(), windowDays = 31): Promise<FinanceDigest> {
  const health = await getFinanceHealth(now);
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const integrityRuns = (await db
    .select()
    .from(financeIntegrityRuns)
    .where(and(gte(financeIntegrityRuns.startedAt, since)))
    .orderBy(desc(financeIntegrityRuns.startedAt))
    .limit(20)) as FinanceIntegrityRun[];

  const c = health.components;
  const driftRuns = integrityRuns.filter((r) => r.status === "drift").length;
  const staleJobs = health.jobs.filter((j) => j.state === "stale" || j.state === "failing");

  const title = `Finance health digest ${LEVEL_ICON[health.overall] ?? ""} (${health.overall})`;
  const body = [
    `Overall: ${health.overall.toUpperCase()}`,
    `Jobs ${LEVEL_ICON[c.jobs]} · Errors ${LEVEL_ICON[c.errors]} · Freshness ${LEVEL_ICON[c.freshness]} · Integrity ${LEVEL_ICON[c.integrity]} · Integrations ${LEVEL_ICON[c.integrations]}`,
    staleJobs.length > 0
      ? `Jobs needing attention: ${staleJobs.map((j) => `${j.job.displayName} (${j.state})`).join("; ")}`
      : "All finance jobs healthy.",
    `Integrity runs in the last ${windowDays}d: ${integrityRuns.length} (${driftRuns} with drift).`,
    health.freshness.anyBreached
      ? `Freshness breaches: ${health.freshness.signals.filter((s) => s.breached).map((s) => s.key).join(", ")}`
      : "No freshness/drift breaches.",
    `Finance 5xx in window: ${health.errors.countInWindow} (threshold ${health.errors.threshold}).`,
  ].join("\n");

  return { generatedAt: now.toISOString(), health, integrityRunsThisPeriod: integrityRuns, title, body };
}

/** Build + dispatch the monthly digest. */
export async function sendFinanceDigest(now: Date = new Date()): Promise<void> {
  const digest = await buildFinanceDigest(now);
  await notifyFinanceOwner({
    eventType: "finance_monthly_digest",
    title: digest.title,
    body: digest.body,
    // Month-stamped entity id so each month is a distinct throttle key.
    entityId: Number(`${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`),
    critical: digest.health.overall === "critical",
  });
}

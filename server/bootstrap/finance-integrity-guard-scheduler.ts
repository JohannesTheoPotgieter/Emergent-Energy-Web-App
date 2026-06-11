/**
 * Weekly finance integrity-guard scheduler + monthly digest.
 *
 * Runs the read-only integrity guard (verify:golden + verify:finance in-process
 * against prod) on a weekly cadence — the freeze's safety net (R4) — and sends
 * the monthly finance-health digest (R5). Also runs a heartbeat sweep at each
 * weekly tick as a backstop in case the 30-min watchdog itself stopped.
 *
 * Postgres-only (wired from start-runtime-services). Idempotent.
 */

import { desc } from "drizzle-orm";
import { db } from "../db";
import { financeIntegrityRuns } from "@shared/schema";
import { runFinanceIntegrityGuard } from "../services/finance-observability/integrity-guard";
import { sendFinanceDigest } from "../services/finance-observability/digest";
import { sweepFinanceJobHeartbeats } from "../services/finance-observability/job-heartbeats";
import { errMsg } from "../lib/api-error";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const JITTER_MS = 10 * 60 * 1000;

let weeklyInterval: ReturnType<typeof setInterval> | null = null;
let dailyInterval: ReturnType<typeof setInterval> | null = null;
let lastDigestMonth: string | null = null;

function resolveWeekMs(): number {
  const raw = process.env.FINANCE_INTEGRITY_INTERVAL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : WEEK_MS;
}

async function lastIntegrityRunAt(): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: financeIntegrityRuns.startedAt })
    .from(financeIntegrityRuns)
    .orderBy(desc(financeIntegrityRuns.startedAt))
    .limit(1);
  return row?.startedAt ?? null;
}

async function runGuardSafely(): Promise<void> {
  try {
    const r = await runFinanceIntegrityGuard({ runType: "scheduled" });
    const tag = r.alertDispatched ? " — DRIFT ALERT DISPATCHED" : "";
    console.log(`[finance-integrity-guard] run complete: ${r.status} (drift=${r.driftCount})${tag}`);
  } catch (err) {
    console.warn(`[finance-integrity-guard] run failed: ${errMsg(err)}`);
  }
  // Backstop: if the watchdog died, this keeps the dead-man's switch alive.
  try {
    await sweepFinanceJobHeartbeats();
  } catch (err) {
    console.warn(`[finance-integrity-guard] backstop heartbeat sweep failed: ${errMsg(err)}`);
  }
}

async function maybeSendDigest(now: Date = new Date()): Promise<void> {
  // First of the month (UTC), once per month.
  if (now.getUTCDate() !== 1) return;
  const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`;
  if (lastDigestMonth === monthKey) return;
  lastDigestMonth = monthKey;
  try {
    await sendFinanceDigest(now);
    console.log("[finance-integrity-guard] monthly digest dispatched.");
  } catch (err) {
    console.warn(`[finance-integrity-guard] digest dispatch failed: ${errMsg(err)}`);
  }
}

/** Register the weekly integrity guard + monthly digest. Idempotent. */
export function scheduleFinanceIntegrityGuard(): void {
  if (weeklyInterval) return;

  // Startup catch-up: run the guard if it has never run or is overdue (>1 week).
  void (async () => {
    try {
      const last = await lastIntegrityRunAt();
      const overdue = !last || Date.now() - last.getTime() > resolveWeekMs();
      if (overdue) {
        setTimeout(() => void runGuardSafely(), 2 * 60 * 1000).unref?.();
      }
    } catch (err) {
      console.warn(`[finance-integrity-guard] startup check failed: ${errMsg(err)}`);
    }
  })();

  const jitter = Math.floor((Math.random() - 0.5) * 2 * JITTER_MS);
  weeklyInterval = setInterval(() => void runGuardSafely(), resolveWeekMs() + jitter);
  if (typeof weeklyInterval.unref === "function") weeklyInterval.unref();

  dailyInterval = setInterval(() => void maybeSendDigest(), DAY_MS);
  if (typeof dailyInterval.unref === "function") dailyInterval.unref();

  console.log("[finance-integrity-guard] Weekly integrity guard + monthly digest registered.");
}

/** Testing hook. */
export function stopFinanceIntegrityGuardForTests(): void {
  if (weeklyInterval) {
    clearInterval(weeklyInterval);
    weeklyInterval = null;
  }
  if (dailyInterval) {
    clearInterval(dailyInterval);
    dailyInterval = null;
  }
  lastDigestMonth = null;
}

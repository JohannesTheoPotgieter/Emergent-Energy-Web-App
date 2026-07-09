/**
 * C2 — Dashboard refresh service.
 *
 * Central refresh loop + snapshot cache for org-wide dashboards. Each
 * registered dashboard has a compute function and a freshness window;
 * the scheduler calls `refreshAllDashboards` on a cadence, and read
 * endpoints serve the latest snapshot with a freshness indicator.
 *
 * The existing dashboard service functions remain the source of
 * truth — this module just wraps them with caching and a freshness
 * read surface. Read endpoints that need sub-second latency should
 * hit the snapshot; endpoints that need absolute real-time should
 * keep calling the underlying service directly.
 *
 * Freshness thresholds (confirmed defaults):
 *   - fresh : age <= freshWindowMs                (default 2h)
 *   - warn  : freshWindowMs < age <= staleWindowMs (default 4h)
 *   - stale : age > staleWindowMs
 *   - unknown: no successful refresh ever
 */

import { and, desc, eq, sql } from "drizzle-orm";
import {
  dashboardSnapshots,
  type DashboardFreshnessState,
  type DashboardSnapshot,
} from "@shared/schema";
import { db } from "../db";

// ===================== DEFAULTS =====================

/** Default "fresh" window for exec-visible dashboards. */
export const DASHBOARD_DEFAULT_FRESH_MS = 2 * 60 * 60 * 1000; // 2 hours
/** Default "stale" cutoff beyond which we show a red warning. */
export const DASHBOARD_DEFAULT_STALE_MS = 4 * 60 * 60 * 1000; // 4 hours
/** Scheduler cadence. 15 minutes lands inside the 2h fresh window with 8x headroom. */
export const DASHBOARD_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

// ===================== REGISTRY =====================

export interface DashboardDefinition<TPayload = unknown> {
  /** Machine key (e.g. 'company_overview'). Must be unique. */
  key: string;
  /** Human-readable label for the freshness panel. */
  label: string;
  /** Scope discriminator. For now every registered dashboard is global. */
  scopeKey?: string;
  /** Override the 2h fresh window. Use for dashboards with tighter SLAs. */
  freshWindowMs?: number;
  /** Override the 4h stale cutoff. */
  staleWindowMs?: number;
  /** Compute the latest payload. MUST be idempotent. */
  compute: () => Promise<TPayload>;
}

const REGISTRY = new Map<string, DashboardDefinition>();

/**
 * Register a dashboard at boot. Idempotent: calling again with the
 * same key replaces the compute function (useful for hot reload).
 */
export function registerDashboard(def: DashboardDefinition): void {
  REGISTRY.set(def.key, def);
}

export function listRegisteredDashboards(): DashboardDefinition[] {
  return Array.from(REGISTRY.values());
}

/** Test-only helper to clear the registry between cases. */
export function __clearDashboardRegistryForTests(): void {
  REGISTRY.clear();
}

// ===================== FRESHNESS =====================

/**
 * Pure function: derive the freshness state from a snapshot's age.
 * Exposed so unit tests can pin the thresholds.
 */
export function deriveDashboardFreshness(params: {
  lastSuccessAt: Date | null;
  now?: Date;
  freshWindowMs?: number;
  staleWindowMs?: number;
}): DashboardFreshnessState {
  const now = params.now ?? new Date();
  const freshMs = params.freshWindowMs ?? DASHBOARD_DEFAULT_FRESH_MS;
  const staleMs = params.staleWindowMs ?? DASHBOARD_DEFAULT_STALE_MS;
  if (!params.lastSuccessAt) return "unknown";
  const age = now.getTime() - params.lastSuccessAt.getTime();
  if (age <= freshMs) return "fresh";
  if (age <= staleMs) return "warn";
  return "stale";
}

// ===================== REFRESH =====================

/**
 * Run a single dashboard compute and upsert the resulting snapshot.
 * Never throws: failures are stored as status='failed' with the
 * previous payload preserved so the read path doesn't flicker to
 * an empty state on a transient error.
 */
export async function refreshDashboard(
  key: string,
): Promise<{ ok: boolean; snapshot: DashboardSnapshot | null; error?: string }> {
  const def = REGISTRY.get(key);
  if (!def) return { ok: false, snapshot: null, error: `unknown_dashboard:${key}` };

  return refreshDashboardInner(def);
}

async function refreshDashboardInner(
  def: DashboardDefinition,
): Promise<{ ok: boolean; snapshot: DashboardSnapshot | null; error?: string }> {
  const key = def.key;
  const scopeKey = def.scopeKey ?? "global";
  const startedAt = Date.now();
  try {
    const payload = await def.compute();
    const computeMs = Date.now() - startedAt;
    const now = new Date();

    const [existing] = await db
      .select()
      .from(dashboardSnapshots)
      .where(
        and(
          eq(dashboardSnapshots.dashboardKey, key),
          eq(dashboardSnapshots.scopeKey, scopeKey),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(dashboardSnapshots)
        .set({
          payloadJson: payload as any,
          status: "ok",
          errorDetail: null,
          computedAt: now,
          lastSuccessAt: now,
          computeMs,
          updatedAt: now,
        })
        .where(eq(dashboardSnapshots.id, (existing as DashboardSnapshot).id))
        .returning();
      return { ok: true, snapshot: updated as DashboardSnapshot };
    }

    const [inserted] = await db
      .insert(dashboardSnapshots)
      .values({
        dashboardKey: key,
        scopeKey,
        payloadJson: payload as any,
        status: "ok",
        computedAt: now,
        lastSuccessAt: now,
        computeMs,
      })
      .returning();
    return { ok: true, snapshot: inserted as DashboardSnapshot };
  } catch (err) {
    const computeMs = Date.now() - startedAt;
    const errorDetail = err instanceof Error ? err.message : String(err);
    const now = new Date();

    const [existing] = await db
      .select()
      .from(dashboardSnapshots)
      .where(
        and(
          eq(dashboardSnapshots.dashboardKey, key),
          eq(dashboardSnapshots.scopeKey, scopeKey),
        ),
      )
      .limit(1);

    if (existing) {
      // Preserve the previous payload so readers still get something.
      const [updated] = await db
        .update(dashboardSnapshots)
        .set({
          status: "failed",
          errorDetail,
          computedAt: now,
          computeMs,
          updatedAt: now,
        })
        .where(eq(dashboardSnapshots.id, (existing as DashboardSnapshot).id))
        .returning();
      return { ok: false, snapshot: updated as DashboardSnapshot, error: errorDetail };
    }

    const [inserted] = await db
      .insert(dashboardSnapshots)
      .values({
        dashboardKey: key,
        scopeKey,
        status: "failed",
        errorDetail,
        computedAt: now,
        computeMs,
      })
      .returning();
    return { ok: false, snapshot: inserted as DashboardSnapshot, error: errorDetail };
  }
}

/**
 * Refresh every registered dashboard sequentially. Sequential (not
 * parallel) because the compute functions hit the same DB pool and
 * we don't want a refresh cycle to starve user traffic.
 */
export async function refreshAllDashboards(): Promise<{
  refreshed: number;
  failed: number;
  durations: Array<{ key: string; ms: number; ok: boolean }>;
}> {
  const durations: Array<{ key: string; ms: number; ok: boolean }> = [];
  let refreshed = 0;
  let failed = 0;
  for (const def of REGISTRY.values()) {
    const startedAt = Date.now();
    const result = await refreshDashboard(def.key);
    const ms = Date.now() - startedAt;
    durations.push({ key: def.key, ms, ok: result.ok });
    if (result.ok) refreshed += 1;
    else failed += 1;
  }
  return { refreshed, failed, durations };
}

// ===================== READ =====================

export interface DashboardFreshnessTile {
  key: string;
  label: string;
  scopeKey: string;
  status: "ok" | "failed" | "missing";
  freshness: DashboardFreshnessState;
  computedAt: Date | null;
  lastSuccessAt: Date | null;
  ageMs: number | null;
  computeMs: number | null;
  errorDetail: string | null;
  freshWindowMs: number;
  staleWindowMs: number;
}

/**
 * Load the latest snapshot for a single dashboard.
 * Returns `null` if no row exists yet (pre-first-refresh).
 */
export async function getDashboardSnapshot(params: {
  key: string;
  scopeKey?: string;
}): Promise<DashboardSnapshot | null> {
  const scopeKey = params.scopeKey ?? "global";
  const [row] = await db
    .select()
    .from(dashboardSnapshots)
    .where(
      and(
        eq(dashboardSnapshots.dashboardKey, params.key),
        eq(dashboardSnapshots.scopeKey, scopeKey),
      ),
    )
    .orderBy(desc(dashboardSnapshots.computedAt))
    .limit(1);
  return (row as DashboardSnapshot | undefined) ?? null;
}

/**
 * Freshness panel: one tile per registered dashboard with its derived
 * freshness state. Powers the exec "what's up to date" indicator.
 */
export async function getDashboardFreshness(params: { now?: Date } = {}): Promise<{
  generatedAt: string;
  counts: Record<DashboardFreshnessState, number>;
  tiles: DashboardFreshnessTile[];
}> {
  const now = params.now ?? new Date();
  const tiles: DashboardFreshnessTile[] = [];
  const counts: Record<DashboardFreshnessState, number> = {
    fresh: 0,
    warn: 0,
    stale: 0,
    unknown: 0,
  };

  for (const def of REGISTRY.values()) {
    const scopeKey = def.scopeKey ?? "global";
    const snap = await getDashboardSnapshot({ key: def.key, scopeKey });
    const freshWindowMs = def.freshWindowMs ?? DASHBOARD_DEFAULT_FRESH_MS;
    const staleWindowMs = def.staleWindowMs ?? DASHBOARD_DEFAULT_STALE_MS;

    const lastSuccessAt = snap?.lastSuccessAt ?? null;
    const freshness = deriveDashboardFreshness({
      lastSuccessAt,
      now,
      freshWindowMs,
      staleWindowMs,
    });
    counts[freshness] += 1;

    tiles.push({
      key: def.key,
      label: def.label,
      scopeKey,
      status: !snap ? "missing" : (snap.status as "ok" | "failed"),
      freshness,
      computedAt: snap?.computedAt ?? null,
      lastSuccessAt,
      ageMs: lastSuccessAt ? now.getTime() - lastSuccessAt.getTime() : null,
      computeMs: snap?.computeMs ?? null,
      errorDetail: snap?.errorDetail ?? null,
      freshWindowMs,
      staleWindowMs,
    });
  }

  return { generatedAt: now.toISOString(), counts, tiles };
}

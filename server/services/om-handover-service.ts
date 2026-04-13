/**
 * B8 (audit closeout) — O&M handover service.
 *
 * Tracker + "close to handover" dashboard for the project->Matriarch
 * handover. The checklist mirrors stage8DataSchema so the O&M handover
 * module and the existing Stage 8 workspace surface the same fields.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  omHandovers,
  OM_HANDOVER_CHECKLIST,
  type OmHandover,
  type InsertOmHandover,
} from "@shared/schema";
import { db } from "../db";

/**
 * Roles allowed to mark an O&M handover as COMPLETE via the
 * mark-complete endpoint. Ceremonial sign-off gating.
 */
export const OM_HANDOVER_COMPLETE_ROLES = new Set([
  "COO_ADMIN",
  "CEO_ADMIN",
  "PROGRAM_MANAGER",
  "CONSTRUCTION_MANAGER",
]);

/** Default dashboard lead time: 30 days out per user direction. */
export const OM_HANDOVER_DASHBOARD_DEFAULT_DAYS = 30;

/**
 * Compute the readiness snapshot for an O&M handover row. Same
 * traffic-light thresholds as B1 / B6 / B7 for consistency:
 *   100    -> green (all 7 boxes ticked)
 *    80-99 -> amber
 *     0-79 -> red
 */
export function computeOmHandoverReadiness(row: OmHandover | null | undefined): {
  total: number;
  complete: number;
  readinessPct: number;
  trafficLight: "green" | "amber" | "red";
  items: Array<{ key: string; label: string; done: boolean }>;
  missingLabels: string[];
} {
  const total = OM_HANDOVER_CHECKLIST.length;
  if (!row) {
    return {
      total,
      complete: 0,
      readinessPct: 0,
      trafficLight: "red",
      items: OM_HANDOVER_CHECKLIST.map((c) => ({ key: String(c.key), label: c.label, done: false })),
      missingLabels: OM_HANDOVER_CHECKLIST.map((c) => c.label),
    };
  }

  const items = OM_HANDOVER_CHECKLIST.map((c) => {
    const done = !!(row as unknown as Record<string, unknown>)[String(c.key)];
    return { key: String(c.key), label: c.label, done };
  });

  const complete = items.filter((i) => i.done).length;
  const readinessPct = total === 0 ? 100 : Math.round((complete / total) * 100);
  const trafficLight: "green" | "amber" | "red" =
    readinessPct >= 100 ? "green" : readinessPct >= 80 ? "amber" : "red";
  const missingLabels = items.filter((i) => !i.done).map((i) => i.label);
  return { total, complete, readinessPct, trafficLight, items, missingLabels };
}

/** Load the (single) active O&M handover row for a project. */
export async function getOmHandoverByProjectId(projectId: number): Promise<OmHandover | null> {
  const rows = await db
    .select()
    .from(omHandovers)
    .where(
      and(
        eq(omHandovers.projectId, projectId),
        isNull(omHandovers.deletedAt),
      ),
    )
    .limit(1);
  return (rows[0] as OmHandover | undefined) ?? null;
}

/**
 * Create or update the single active O&M handover row for a project.
 * Anyone authenticated can call this — the permission gate lives on
 * the mark-complete endpoint.
 */
export async function upsertOmHandover(params: {
  projectId: number;
  fields: Partial<InsertOmHandover>;
}): Promise<OmHandover> {
  const existing = await getOmHandoverByProjectId(params.projectId);
  if (existing) {
    const [updated] = await db
      .update(omHandovers)
      .set({ ...params.fields, updatedAt: new Date() })
      .where(eq(omHandovers.id, existing.id))
      .returning();
    return updated as OmHandover;
  }
  const [inserted] = await db
    .insert(omHandovers)
    .values({
      projectId: params.projectId,
      ...params.fields,
    } as InsertOmHandover)
    .returning();
  return inserted as OmHandover;
}

/**
 * Mark an O&M handover complete. The caller's role must be in
 * OM_HANDOVER_COMPLETE_ROLES; authorisation is enforced by the
 * endpoint middleware, so this helper trusts the caller.
 *
 * Side effects:
 *   - status -> 'completed'
 *   - actualHandoverDate -> today (if not already set)
 *   - markedCompleteByUserId / markedCompleteByRole / markedCompleteAt
 *     populated for audit.
 */
export async function markOmHandoverComplete(params: {
  id: number;
  userId: number | null;
  userRole: string | null;
}): Promise<OmHandover | null> {
  const [existing] = await db
    .select()
    .from(omHandovers)
    .where(and(eq(omHandovers.id, params.id), isNull(omHandovers.deletedAt)))
    .limit(1);
  if (!existing) return null;

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const [updated] = await db
    .update(omHandovers)
    .set({
      status: "completed",
      actualHandoverDate: existing.actualHandoverDate ?? todayIso,
      markedCompleteByUserId: params.userId,
      markedCompleteByRole: params.userRole,
      markedCompleteAt: today,
      updatedAt: today,
    })
    .where(eq(omHandovers.id, params.id))
    .returning();
  return updated as OmHandover;
}

/**
 * "Close to handover" dashboard query.
 *
 * Returns three buckets:
 *   - upcoming: planned_handover_date in [today, today + daysAhead]
 *     and status != 'completed'
 *   - overdue:  planned_handover_date < today AND status != 'completed'
 *   - recent:   status = 'completed' AND actual_handover_date in
 *               [today - daysAhead, today]  (trailing window, same size)
 *
 * Each row includes the readiness snapshot so the UI can render the
 * traffic-light badge without a second round-trip.
 */
export async function getOmHandoverDashboard(params: {
  daysAhead?: number;
} = {}): Promise<{
  daysAhead: number;
  generatedAt: string;
  upcoming: Array<OmHandover & { readiness: ReturnType<typeof computeOmHandoverReadiness> }>;
  overdue: Array<OmHandover & { readiness: ReturnType<typeof computeOmHandoverReadiness> }>;
  recentlyCompleted: Array<OmHandover & { readiness: ReturnType<typeof computeOmHandoverReadiness> }>;
  counts: { upcoming: number; overdue: number; recentlyCompleted: number };
}> {
  const daysAhead = params.daysAhead ?? OM_HANDOVER_DASHBOARD_DEFAULT_DAYS;
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const endIso = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startIso = new Date(now.getTime() - daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Upcoming: planned date in [today, today + daysAhead], not completed.
  const upcomingRows = await db
    .select()
    .from(omHandovers)
    .where(
      and(
        isNull(omHandovers.deletedAt),
        sql`${omHandovers.plannedHandoverDate} IS NOT NULL`,
        sql`${omHandovers.plannedHandoverDate} >= ${todayIso}::date`,
        sql`${omHandovers.plannedHandoverDate} <= ${endIso}::date`,
        sql`${omHandovers.status} != 'completed'`,
      ),
    )
    .orderBy(asc(omHandovers.plannedHandoverDate));

  // Overdue: planned date past, not completed.
  const overdueRows = await db
    .select()
    .from(omHandovers)
    .where(
      and(
        isNull(omHandovers.deletedAt),
        sql`${omHandovers.plannedHandoverDate} IS NOT NULL`,
        sql`${omHandovers.plannedHandoverDate} < ${todayIso}::date`,
        sql`${omHandovers.status} != 'completed'`,
      ),
    )
    .orderBy(asc(omHandovers.plannedHandoverDate));

  // Recently completed: status=completed AND actual_handover_date in the trailing window.
  const recentRows = await db
    .select()
    .from(omHandovers)
    .where(
      and(
        isNull(omHandovers.deletedAt),
        eq(omHandovers.status, "completed"),
        sql`${omHandovers.actualHandoverDate} IS NOT NULL`,
        sql`${omHandovers.actualHandoverDate} >= ${startIso}::date`,
        sql`${omHandovers.actualHandoverDate} <= ${todayIso}::date`,
      ),
    )
    .orderBy(asc(omHandovers.actualHandoverDate));

  const enrich = (rows: unknown[]) =>
    (rows as OmHandover[]).map((r) => ({ ...r, readiness: computeOmHandoverReadiness(r) }));

  const upcoming = enrich(upcomingRows);
  const overdue = enrich(overdueRows);
  const recentlyCompleted = enrich(recentRows);

  return {
    daysAhead,
    generatedAt: now.toISOString(),
    upcoming,
    overdue,
    recentlyCompleted,
    counts: {
      upcoming: upcoming.length,
      overdue: overdue.length,
      recentlyCompleted: recentlyCompleted.length,
    },
  };
}

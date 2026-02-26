import { db } from "./db";
import { eq, and, sql, gt } from "drizzle-orm";
import { notifications, notificationThrottle, users } from "@shared/schema";

async function throttledNotify(
  recipientUserId: number,
  eventType: string,
  title: string,
  body: string | null,
  opts: { projectName?: string; linkedPlanItemId?: number } = {}
) {
  const entityId = opts.linkedPlanItemId || 0;
  const existing = await db.select().from(notificationThrottle)
    .where(and(
      eq(notificationThrottle.recipientUserId, recipientUserId),
      eq(notificationThrottle.eventType, eventType),
      eq(notificationThrottle.entityType, "milestone"),
      eq(notificationThrottle.entityId, entityId),
      gt(notificationThrottle.lastSentAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
    ));
  if (existing.length > 0) return;

  await db.insert(notifications).values({
    recipientUserId,
    eventType,
    title,
    body,
    projectName: opts.projectName || null,
    linkedPlanItemId: opts.linkedPlanItemId || null,
  });
  await db.insert(notificationThrottle).values({
    recipientUserId,
    eventType,
    entityType: "milestone",
    entityId,
  }).onConflictDoNothing();
}

export async function checkMilestoneNotifications() {
  try {
    const commissioningRows = await db.execute(sql`
      SELECT DISTINCT pi.project_name, pi.pm_user_id, pi.pm,
        COALESCE(
          (SELECT MAX(t.actual_end_date) FROM normalized_plan_tasks t 
           WHERE t.project_name = pi.project_name 
           AND LOWER(t.task_name) LIKE '%commissioning%'
           AND t.actual_end_date IS NOT NULL AND t.actual_end_date != ''),
          pi.commissioning_date
        ) as comm_date
      FROM project_info pi
      WHERE pi.archived_status = 'ACTIVE'
        AND pi.phase NOT IN ('DLP', 'Financial Close', 'Commercial Close Out', 'Gone')
    `);

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 86400000);
    const in14Days = new Date(now.getTime() + 14 * 86400000);

    for (const row of commissioningRows.rows as any[]) {
      if (!row.comm_date || !row.pm_user_id) continue;
      const commDate = new Date(row.comm_date);
      if (isNaN(commDate.getTime()) || commDate < now) continue;

      const projectDisplay = (row.project_name || "").replace(/_Tracker$/i, "").replace(/_/g, " ");
      const daysUntil = Math.ceil((commDate.getTime() - now.getTime()) / 86400000);

      if (commDate <= in7Days) {
        await throttledNotify(row.pm_user_id, "milestone.commissioning_soon", 
          `Commissioning in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`,
          `${projectDisplay} is scheduled for commissioning on ${commDate.toLocaleDateString()}.`,
          { projectName: row.project_name }
        );
      } else if (commDate <= in14Days) {
        await throttledNotify(row.pm_user_id, "milestone.approaching",
          `Commissioning approaching: ${projectDisplay}`,
          `Commissioning is ${daysUntil} days away (${commDate.toLocaleDateString()}).`,
          { projectName: row.project_name }
        );
      }
    }

    const behindScheduleRows = await db.execute(sql`
      SELECT pi.project_name, pi.pm_user_id,
        COALESCE(
          (SELECT SUM(t.pct_complete * t.duration_days) / NULLIF(SUM(t.duration_days), 0)
           FROM normalized_plan_tasks t WHERE t.project_name = pi.project_name
           AND t.duration_days > 0 AND t.pct_complete IS NOT NULL), 0
        ) * 100 as act_pct,
        COALESCE(
          (SELECT SUM(
            CASE WHEN t.actual_start_date IS NOT NULL AND t.actual_start_date != '' AND t.actual_end_date IS NOT NULL AND t.actual_end_date != ''
            THEN LEAST(1.0, GREATEST(0.0,
              (EXTRACT(EPOCH FROM CURRENT_DATE) - EXTRACT(EPOCH FROM NULLIF(t.actual_start_date,'')::date))
              / NULLIF(EXTRACT(EPOCH FROM NULLIF(t.actual_end_date,'')::date) - EXTRACT(EPOCH FROM NULLIF(t.actual_start_date,'')::date), 0)
            )) * t.duration_days ELSE 0 END
          ) / NULLIF(SUM(t.duration_days), 0)
           FROM normalized_plan_tasks t WHERE t.project_name = pi.project_name
           AND t.duration_days > 0), 0
        ) * 100 as exp_pct
      FROM project_info pi
      WHERE pi.archived_status = 'ACTIVE'
        AND pi.pm_user_id IS NOT NULL
        AND pi.phase NOT IN ('DLP', 'Financial Close', 'Commercial Close Out', 'Gone')
    `);

    for (const row of behindScheduleRows.rows as any[]) {
      if (!row.pm_user_id) continue;
      const actPct = parseFloat(row.act_pct) || 0;
      const expPct = parseFloat(row.exp_pct) || 0;
      const delta = actPct - expPct;

      if (delta < -10) {
        const projectDisplay = (row.project_name || "").replace(/_Tracker$/i, "").replace(/_/g, " ");
        await throttledNotify(row.pm_user_id, "project.behind_schedule",
          `${projectDisplay} is ${Math.abs(Math.round(delta))}% behind schedule`,
          `Actual progress: ${Math.round(actPct)}% vs Expected: ${Math.round(expPct)}%. Consider reviewing the project plan.`,
          { projectName: row.project_name }
        );
      }
    }

    const phaseChanges = await db.execute(sql`
      SELECT pi.project_name, pph.to_phase, pph.changed_at, pi.pm_user_id
      FROM project_phase_history pph
      JOIN project_info pi ON pph.project_id = pi.id
      WHERE pph.changed_at > NOW() - INTERVAL '1 day'
        AND pi.pm_user_id IS NOT NULL
    `);

    for (const row of phaseChanges.rows as any[]) {
      if (!row.pm_user_id) continue;
      const projectDisplay = (row.project_name || "").replace(/_Tracker$/i, "").replace(/_/g, " ");
      await throttledNotify(row.pm_user_id, "project.phase_changed",
        `${projectDisplay} moved to ${row.to_phase}`,
        `The project phase has been updated to "${row.to_phase}".`,
        { projectName: row.project_name }
      );
    }

    console.log("[Milestones] Notification check complete");
  } catch (err: any) {
    console.error("[Milestones] Notification check error:", err.message);
  }
}

let milestoneInterval: ReturnType<typeof setInterval> | null = null;

export function startMilestoneChecker() {
  if (milestoneInterval) return;
  setTimeout(() => checkMilestoneNotifications(), 15000);
  milestoneInterval = setInterval(() => checkMilestoneNotifications(), 6 * 60 * 60 * 1000);
  console.log("[Milestones] Notification checker started (6h interval)");
}

import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql, eq, and, desc, inArray } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  users,
  userBadges,
  userPoints,
  BADGE_DEFINITIONS,
} from "@shared/schema";

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required" });
}

const POINT_VALUES: Record<string, number> = {
  task_complete: 10,
  approval_given: 15,
  weekly_review: 20,
  import_complete: 25,
  data_fix: 5,
  project_update: 3,
  quality_approve: 15,
  eng_stage_complete: 30,
  eng_task_owned: 5,
  ops_task_assigned: 5,
  deliverable_uploaded: 8,
  participation: 10,
};

const PENALTY_VALUES: Record<string, number> = {
  overdue_task: -5,
  plan_behind: -3,
  quality_failure: -8,
  rejected_deliverable: -6,
  open_quality_warning: -4,
  overdue_eng_task: -6,
  unread_notifications: -2,
  overdue_qm_task: -7,
};

interface UserActivityCounts {
  userId: number;
  userName: string;
  tasksCompleted: number;
  approvalsGiven: number;
  weeklyReviews: number;
  importsCompleted: number;
  dataFixes: number;
  projectUpdates: number;
  qualityApprovals: number;
  engStagesCompleted: number;
  engTasksOwned: number;
  opsTasksAssigned: number;
  deliverablesUploaded: number;
  participation: number;
  overdueTasks: number;
  plansBehind: number;
  qualityFailures: number;
  rejectedDeliverables: number;
  openQualityWarnings: number;
  overdueEngTasks: number;
  unreadNotifications: number;
  overdueQmTasks: number;
}

async function computeUserActivities(): Promise<UserActivityCounts[]> {
  const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
  const results: UserActivityCounts[] = [];

  for (const u of allUsers) {
    const uid = u.id;
    const userName = u.name || "";

    const execCount = async (query: ReturnType<typeof sql>) => {
      try {
        const result = await db.execute(query);
        const rows = (result as any).rows || result;
        const row = Array.isArray(rows) ? rows[0] : null;
        return Number(row?.cnt || 0);
      } catch { return 0; }
    };

    const tasksCompleted = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM work_items wi LEFT JOIN users u ON wi.owner_user_id = u.id WHERE wi.workstream = 'PM' AND wi.deleted_at IS NULL AND wi.percent_complete >= 1 AND (wi.owner_user_id = ${uid} OR LOWER(TRIM(u.name)) = LOWER(TRIM(${userName})))`
    );
    const approvalsGiven = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM project_eng_approvals WHERE approver_user_id = ${uid} AND status = 'approved'`
    );
    const weeklyReviews = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM weekly_reviews WHERE reviewed_by = ${uid} AND status = 'completed'`
    );
    const importsCompleted = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM smart_import_runs WHERE committed_by = ${uid} AND status = 'COMMITTED'`
    );
    const projectUpdates = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM change_sets WHERE actor_user_id = ${uid}`
    );
    const qualityApprovals = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM qc_item_instance WHERE approved_by_user_id = ${uid} AND approved = true`
    );
    const engStagesCompleted = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM project_eng_stages WHERE created_by = ${uid} AND status = 'complete'`
    );
    const engTasksOwned = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM project_eng_tasks WHERE owner_user_id = ${uid}`
    );
    const opsTasksAssigned = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM operational_tasks WHERE owner_user_id = ${uid}`
    );
    const deliverablesUploaded = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM deliverable_files WHERE uploaded_by_user_id = ${uid}`
    );

    const overdueTasks = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM operational_tasks 
          WHERE owner_user_id = ${uid} 
          AND due_date IS NOT NULL AND due_date != '' 
          AND due_date < CURRENT_DATE::text 
          AND status NOT IN ('COMPLETE', 'QC APPROVED', 'DONE')`
    );

    const plansBehind = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM work_items wi
          JOIN project_info pi ON wi.project_id = pi.id
          WHERE wi.workstream = 'PM' AND wi.deleted_at IS NULL
          AND wi.percent_complete IS NOT NULL
          AND wi.percent_complete < 1
          AND wi.start_date IS NOT NULL AND wi.end_date IS NOT NULL
          AND wi.end_date::date < CURRENT_DATE
          AND wi.percent_complete < 0.85
          AND pi.pm_user_id = ${uid}`
    );

    const qualityFailures = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM qc_item_instance qi
          JOIN qc_checklist qc ON qi.checklist_id = qc.id
          JOIN project_info pi ON qc.project_name = pi.project_name
          WHERE pi.pm_user_id = ${uid}
          AND qi.qm_status = 'fail'`
    );

    const rejectedDeliverables = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM project_eng_deliverables 
          WHERE uploaded_by = ${uid} 
          AND approval_status = 'rejected'`
    );

    const openQualityWarnings = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM qc_warning 
          WHERE owner_user_id = ${uid} 
          AND status IN ('open', 'in_progress')`
    );

    const overdueEngTasks = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM project_eng_tasks 
          WHERE owner_user_id = ${uid} 
          AND due_date IS NOT NULL AND due_date != '' 
          AND NULLIF(due_date, '')::date < CURRENT_DATE 
          AND status NOT IN ('complete', 'skipped')`
    );

    const unreadNotifications = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM notifications 
          WHERE recipient_user_id = ${uid} 
          AND is_read = false 
          AND created_at < NOW() - INTERVAL '3 days'`
    );

    const overdueQmTasks = await execCount(
      sql`SELECT COUNT(*)::int as cnt FROM qc_item_instance qi
          JOIN qc_checklist qc ON qi.checklist_id = qc.id
          JOIN project_info pi ON qc.project_name = pi.project_name
          WHERE (pi.pm_user_id = ${uid} OR LOWER(TRIM(pi.pm)) = LOWER(TRIM(${userName})))
          AND qi.end_date IS NOT NULL AND qi.end_date != ''
          AND NULLIF(qi.end_date, '')::date < CURRENT_DATE
          AND qi.approved = false
          AND qi.is_applicable = true`
    );

    const hasAnyActivity = (tasksCompleted + approvalsGiven + weeklyReviews +
      importsCompleted + projectUpdates + qualityApprovals +
      engStagesCompleted + deliverablesUploaded) > 0;

    results.push({
      userId: uid,
      userName,
      tasksCompleted,
      approvalsGiven,
      weeklyReviews,
      importsCompleted,
      dataFixes: 0,
      projectUpdates,
      qualityApprovals,
      engStagesCompleted,
      engTasksOwned,
      opsTasksAssigned,
      deliverablesUploaded,
      participation: hasAnyActivity ? 1 : 0,
      overdueTasks,
      plansBehind,
      qualityFailures,
      rejectedDeliverables,
      openQualityWarnings,
      overdueEngTasks,
      unreadNotifications,
      overdueQmTasks,
    });
  }

  return results;
}

function computePoints(act: UserActivityCounts): { earned: number; penalties: number; total: number } {
  const earned =
    act.tasksCompleted * POINT_VALUES.task_complete +
    act.approvalsGiven * POINT_VALUES.approval_given +
    act.weeklyReviews * POINT_VALUES.weekly_review +
    act.importsCompleted * POINT_VALUES.import_complete +
    act.dataFixes * POINT_VALUES.data_fix +
    act.projectUpdates * POINT_VALUES.project_update +
    act.qualityApprovals * POINT_VALUES.quality_approve +
    act.engStagesCompleted * POINT_VALUES.eng_stage_complete +
    act.engTasksOwned * POINT_VALUES.eng_task_owned +
    act.opsTasksAssigned * POINT_VALUES.ops_task_assigned +
    act.deliverablesUploaded * POINT_VALUES.deliverable_uploaded +
    act.participation * POINT_VALUES.participation;

  const penalties =
    act.overdueTasks * PENALTY_VALUES.overdue_task +
    act.plansBehind * PENALTY_VALUES.plan_behind +
    act.qualityFailures * PENALTY_VALUES.quality_failure +
    act.rejectedDeliverables * PENALTY_VALUES.rejected_deliverable +
    act.openQualityWarnings * PENALTY_VALUES.open_quality_warning +
    act.overdueEngTasks * PENALTY_VALUES.overdue_eng_task +
    act.unreadNotifications * PENALTY_VALUES.unread_notifications +
    act.overdueQmTasks * PENALTY_VALUES.overdue_qm_task;

  return { earned, penalties, total: Math.max(0, earned + penalties) };
}

function computeEarnedBadges(act: UserActivityCounts): string[] {
  const badges: string[] = [];
  badges.push("first_login");

  if (act.tasksCompleted >= 100) badges.push("task_completer_100");
  else if (act.tasksCompleted >= 50) badges.push("task_completer_50");
  else if (act.tasksCompleted >= 10) badges.push("task_completer_10");

  if (act.approvalsGiven >= 25) badges.push("approver_25");
  else if (act.approvalsGiven >= 5) badges.push("approver_5");

  if (act.weeklyReviews >= 10) badges.push("reviewer_10");
  else if (act.weeklyReviews >= 3) badges.push("reviewer_3");

  if (act.dataFixes >= 20) badges.push("data_quality_20");
  else if (act.dataFixes >= 5) badges.push("data_quality_5");

  if (act.importsCompleted >= 10) badges.push("importer_10");
  else if (act.importsCompleted >= 3) badges.push("importer_3");

  if (act.projectUpdates >= 50) badges.push("collaborator_50");
  else if (act.projectUpdates >= 10) badges.push("collaborator_10");

  if (act.qualityApprovals >= 5) badges.push("quality_champion_5");

  if (act.engStagesCompleted >= 3) badges.push("eng_milestone_3");

  if (act.engTasksOwned >= 10) badges.push("eng_task_owner_10");
  else if (act.engTasksOwned >= 3) badges.push("eng_task_owner_3");

  if (act.opsTasksAssigned >= 10) badges.push("ops_contributor_10");
  else if (act.opsTasksAssigned >= 3) badges.push("ops_contributor_3");

  if (act.deliverablesUploaded >= 5) badges.push("deliverable_pro_5");

  if (act.overdueTasks >= 10) badges.push("penalty_overdue_chronic");
  else if (act.overdueTasks >= 5) badges.push("penalty_overdue_repeat");

  if (act.qualityFailures >= 5) badges.push("penalty_quality_concern");

  if (act.overdueEngTasks >= 5) badges.push("penalty_eng_task_overdue");
  else if (act.overdueEngTasks >= 3) badges.push("penalty_eng_task_slipping");

  if (act.unreadNotifications >= 20) badges.push("penalty_inbox_neglect");
  else if (act.unreadNotifications >= 10) badges.push("penalty_inbox_pileup");

  if (act.overdueQmTasks >= 5) badges.push("penalty_qm_overdue");
  else if (act.overdueQmTasks >= 3) badges.push("penalty_qm_slipping");

  if (act.overdueTasks === 0 && act.plansBehind === 0 && act.qualityFailures === 0 &&
      act.rejectedDeliverables === 0 && act.openQualityWarnings === 0 &&
      act.overdueEngTasks === 0 && act.overdueQmTasks === 0 &&
      act.tasksCompleted >= 5) {
    badges.push("clean_record");
  }

  return badges;
}

function getUserLevel(points: number): { level: number; title: string; nextThreshold: number; currentThreshold: number } {
  const levels = [
    { level: 1, title: "Rookie", threshold: 0 },
    { level: 2, title: "Contributor", threshold: 50 },
    { level: 3, title: "Specialist", threshold: 150 },
    { level: 4, title: "Expert", threshold: 400 },
    { level: 5, title: "Master", threshold: 800 },
    { level: 6, title: "Champion", threshold: 1500 },
    { level: 7, title: "Legend", threshold: 3000 },
    { level: 8, title: "Titan", threshold: 6000 },
  ];

  let current = levels[0];
  for (const l of levels) {
    if (points >= l.threshold) current = l;
  }
  const nextIdx = levels.findIndex(l => l.level === current.level) + 1;
  const next = nextIdx < levels.length ? levels[nextIdx] : levels[levels.length - 1];

  return {
    level: current.level,
    title: current.title,
    nextThreshold: next.threshold,
    currentThreshold: current.threshold,
  };
}

export function registerGamificationRoutes(app: Express) {
  app.get("/api/gamification/leaderboard", jwtAuth, requireAuth, async (_req: Request, res: Response) => {
    try {
      const activities = await computeUserActivities();
      const allUsers = await db.select({ id: users.id, name: users.name, role: users.role }).from(users);
      const userMap = Object.fromEntries(allUsers.map(u => [u.id, u]));

      const existingBadges = await db.select().from(userBadges);
      const badgesByUser: Record<number, string[]> = {};
      for (const b of existingBadges) {
        if (!badgesByUser[b.userId]) badgesByUser[b.userId] = [];
        badgesByUser[b.userId].push(b.badgeKey);
      }

      const leaderboard = activities
        .map(act => {
        const u = userMap[act.userId];
        if (!u) return null;
        const { earned, penalties, total } = computePoints(act);
        const earnedBadgeKeys = computeEarnedBadges(act);
        const level = getUserLevel(total);

        return {
          userId: act.userId,
          name: u.name,
          role: u.role,
          points: total,
          pointsEarned: earned,
          pointsPenalty: penalties,
          level,
          badges: earnedBadgeKeys.map(key => ({
            key,
            ...BADGE_DEFINITIONS[key],
          })),
          stats: {
            tasksCompleted: act.tasksCompleted,
            approvalsGiven: act.approvalsGiven,
            weeklyReviews: act.weeklyReviews,
            importsCompleted: act.importsCompleted,
            projectUpdates: act.projectUpdates,
            qualityApprovals: act.qualityApprovals,
            engStagesCompleted: act.engStagesCompleted,
            engTasksOwned: act.engTasksOwned,
            opsTasksAssigned: act.opsTasksAssigned,
            deliverablesUploaded: act.deliverablesUploaded,
          },
          penalties: {
            overdueTasks: act.overdueTasks,
            plansBehind: act.plansBehind,
            qualityFailures: act.qualityFailures,
            rejectedDeliverables: act.rejectedDeliverables,
            openQualityWarnings: act.openQualityWarnings,
            overdueEngTasks: act.overdueEngTasks,
            unreadNotifications: act.unreadNotifications,
            overdueQmTasks: act.overdueQmTasks,
          },
        };
      }).filter(Boolean);

      leaderboard.sort((a: any, b: any) => b.points - a.points);

      const newBadges: { userId: number; badgeKey: string }[] = [];
      for (const entry of leaderboard) {
        if (!entry) continue;
        const existing = badgesByUser[entry.userId] || [];
        for (const badge of entry.badges) {
          if (!existing.includes(badge.key)) {
            newBadges.push({ userId: entry.userId, badgeKey: badge.key });
          }
        }
      }

      if (newBadges.length > 0) {
        for (const b of newBadges) {
          await db.execute(
            sql`INSERT INTO user_badges (user_id, badge_key) VALUES (${b.userId}, ${b.badgeKey}) ON CONFLICT (user_id, badge_key) DO NOTHING`
          ).catch(() => {});
        }
      }

      res.json({
        leaderboard,
        pointValues: POINT_VALUES,
        penaltyValues: PENALTY_VALUES,
        badgeDefinitions: BADGE_DEFINITIONS,
      });
    } catch (err: any) {
      console.error("Error computing leaderboard:", err);
      res.status(500).json({ error: "Failed to compute leaderboard" });
    }
  });

  app.get("/api/gamification/user/:userId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      const [u] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, userId));
      if (!u) return res.status(404).json({ error: "User not found" });

      const activities = await computeUserActivities();
      const act = activities.find(a => a.userId === userId);
      if (!act) return res.status(404).json({ error: "No activity data" });

      const { earned, penalties, total } = computePoints(act);
      const earnedBadgeKeys = computeEarnedBadges(act);
      const level = getUserLevel(total);

      const allBadges = Object.entries(BADGE_DEFINITIONS).map(([key, def]) => ({
        key,
        ...def,
        earned: earnedBadgeKeys.includes(key),
      }));

      res.json({
        userId,
        name: u.name,
        role: u.role,
        points: total,
        pointsEarned: earned,
        pointsPenalty: penalties,
        level,
        badges: allBadges,
        stats: {
          tasksCompleted: act.tasksCompleted,
          approvalsGiven: act.approvalsGiven,
          weeklyReviews: act.weeklyReviews,
          importsCompleted: act.importsCompleted,
          projectUpdates: act.projectUpdates,
          qualityApprovals: act.qualityApprovals,
          engStagesCompleted: act.engStagesCompleted,
          engTasksOwned: act.engTasksOwned,
          opsTasksAssigned: act.opsTasksAssigned,
          deliverablesUploaded: act.deliverablesUploaded,
        },
        penalties: {
          overdueTasks: act.overdueTasks,
          plansBehind: act.plansBehind,
          qualityFailures: act.qualityFailures,
          rejectedDeliverables: act.rejectedDeliverables,
          openQualityWarnings: act.openQualityWarnings,
          overdueEngTasks: act.overdueEngTasks,
          unreadNotifications: act.unreadNotifications,
          overdueQmTasks: act.overdueQmTasks,
        },
      });
    } catch (err: any) {
      console.error("Error fetching user gamification:", err);
      res.status(500).json({ error: "Failed to fetch user data" });
    }
  });

  app.get("/api/gamification/user/:userId/details", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      const [u] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, userId));
      if (!u) return res.status(404).json({ error: "User not found" });
      const userName = u.name || "";

      const activities = await computeUserActivities();
      const act = activities.find(a => a.userId === userId);
      if (!act) return res.status(404).json({ error: "No activity data" });

      const { earned: earnedTotal, penalties: penaltyTotal, total: netTotal } = computePoints(act);

      const execItems = async (query: ReturnType<typeof sql>): Promise<any[]> => {
        try {
          const result = await db.execute(query);
          return (result as any).rows || [];
        } catch { return []; }
      };

      const formatItems = (rows: any[]) => rows.map(r => ({
        name: String(r.name || '').replace(/_Tracker$/i, '').replace(/_/g, ' '),
        project: String(r.project || '').replace(/_Tracker$/i, '').replace(/_/g, ' '),
        date: r.date ? String(r.date).substring(0, 10) : null,
      }));

      const buildCategory = (count: number, perPoint: number, items: any[]) => ({
        count,
        perPoint,
        total: count * perPoint,
        items: formatItems(items),
      });

      const [
        tasksCompletedItems, approvalsGivenItems, weeklyReviewItems,
        importsCompletedItems, projectUpdatesItems, qualityApprovalsItems,
        engStagesCompletedItems, deliverablesUploadedItems,
        engTasksOwnedItems, opsTasksAssignedItems,
        overdueTaskItems, plansBehindItems, qualityFailureItems,
        rejectedDeliverableItems, openQualityWarningItems,
        overdueEngTaskItems, overdueQmTaskItems, unreadNotifItems,
      ] = await Promise.all([
        execItems(sql`SELECT COALESCE(wi.title, '') as name, pi.project_name as project, COALESCE(wi.end_date, '') as date FROM work_items wi LEFT JOIN project_info pi ON wi.project_id = pi.id LEFT JOIN users u ON wi.owner_user_id = u.id WHERE wi.workstream = 'PM' AND wi.deleted_at IS NULL AND wi.percent_complete >= 1 AND (wi.owner_user_id = ${userId} OR LOWER(TRIM(u.name)) = LOWER(TRIM(${userName}))) ORDER BY wi.end_date DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(a.notes, s.stage_name, 'Approval') as name, pi.project_name as project, a.approved_at::text as date FROM project_eng_approvals a LEFT JOIN project_eng_stages s ON a.stage_id = s.id LEFT JOIN project_info pi ON s.project_id = pi.id WHERE a.approver_user_id = ${userId} AND a.status = 'approved' ORDER BY a.approved_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(pi.project_name, 'Review') as name, pi.project_name as project, wr.reviewed_at::text as date FROM weekly_reviews wr LEFT JOIN project_info pi ON wr.project_id = pi.id WHERE wr.reviewed_by = ${userId} AND wr.status = 'completed' ORDER BY wr.reviewed_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(file_name, 'Import') as name, project_name as project, committed_at::text as date FROM smart_import_runs WHERE committed_by = ${userId} AND status = 'COMMITTED' ORDER BY committed_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(entity_type, 'Update') || ': ' || COALESCE(field_name, '') as name, project_name as project, changed_at::text as date FROM change_sets WHERE actor_user_id = ${userId} ORDER BY changed_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(qi.item_name, 'QC Item') as name, qc.project_name as project, qi.updated_at::text as date FROM qc_item_instance qi JOIN qc_checklist qc ON qi.checklist_id = qc.id WHERE qi.approved_by_user_id = ${userId} AND qi.approved = true ORDER BY qi.updated_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(s.stage_name, 'Stage') as name, pi.project_name as project, s.completed_at::text as date FROM project_eng_stages s LEFT JOIN project_info pi ON s.project_id = pi.id WHERE s.created_by = ${userId} AND s.status = 'complete' ORDER BY s.completed_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(df.file_name, 'File') as name, pi.project_name as project, df.uploaded_at::text as date FROM deliverable_files df LEFT JOIN project_eng_deliverables d ON df.deliverable_id = d.id LEFT JOIN project_eng_stages s ON d.stage_id = s.id LEFT JOIN project_info pi ON s.project_id = pi.id WHERE df.uploaded_by_user_id = ${userId} ORDER BY df.uploaded_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(t.title, 'Task') as name, pi.project_name as project, '' as date FROM project_eng_tasks t LEFT JOIN project_eng_stages s ON t.stage_id = s.id LEFT JOIN project_info pi ON s.project_id = pi.id WHERE t.owner_user_id = ${userId} ORDER BY t.id DESC LIMIT 100`),
        execItems(sql`SELECT COALESCE(title, task_name, 'Task') as name, project_name as project, '' as date FROM operational_tasks WHERE owner_user_id = ${userId} ORDER BY id DESC LIMIT 100`),
        execItems(sql`SELECT COALESCE(title, task_name, 'Task') as name, project_name as project, due_date as date FROM operational_tasks WHERE owner_user_id = ${userId} AND due_date IS NOT NULL AND due_date != '' AND due_date < CURRENT_DATE::text AND status NOT IN ('COMPLETE', 'QC APPROVED', 'DONE') ORDER BY due_date ASC LIMIT 100`),
        execItems(sql`SELECT COALESCE(wi.title, '') as name, pi.project_name as project, ROUND(wi.percent_complete::numeric * 100) || '% vs expected' as date FROM work_items wi JOIN project_info pi ON wi.project_id = pi.id WHERE wi.workstream = 'PM' AND wi.deleted_at IS NULL AND wi.percent_complete IS NOT NULL AND wi.percent_complete < 1 AND wi.start_date IS NOT NULL AND wi.end_date IS NOT NULL AND wi.end_date::date < CURRENT_DATE AND wi.percent_complete < 0.85 AND pi.pm_user_id = ${userId} ORDER BY wi.percent_complete ASC LIMIT 100`),
        execItems(sql`SELECT COALESCE(qi.item_name, 'QC Item') as name, qc.project_name as project, qi.updated_at::text as date FROM qc_item_instance qi JOIN qc_checklist qc ON qi.checklist_id = qc.id JOIN project_info pi ON qc.project_name = pi.project_name WHERE pi.pm_user_id = ${userId} AND qi.qm_status = 'fail' ORDER BY qi.updated_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(title, 'Deliverable') as name, (SELECT pi.project_name FROM project_eng_stages s JOIN project_info pi ON s.project_id = pi.id WHERE s.id = stage_id LIMIT 1) as project, updated_at::text as date FROM project_eng_deliverables WHERE uploaded_by = ${userId} AND approval_status = 'rejected' ORDER BY updated_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(description, 'Warning') as name, project_name as project, created_at::text as date FROM qc_warning WHERE owner_user_id = ${userId} AND status IN ('open', 'in_progress') ORDER BY created_at DESC NULLS LAST LIMIT 100`),
        execItems(sql`SELECT COALESCE(t.title, 'Task') as name, pi.project_name as project, t.due_date as date FROM project_eng_tasks t LEFT JOIN project_eng_stages s ON t.stage_id = s.id LEFT JOIN project_info pi ON s.project_id = pi.id WHERE t.owner_user_id = ${userId} AND t.due_date IS NOT NULL AND t.due_date != '' AND NULLIF(t.due_date, '')::date < CURRENT_DATE AND t.status NOT IN ('complete', 'skipped') ORDER BY t.due_date ASC LIMIT 100`),
        execItems(sql`SELECT COALESCE(qi.item_name, 'QM Item') as name, qc.project_name as project, qi.end_date as date FROM qc_item_instance qi JOIN qc_checklist qc ON qi.checklist_id = qc.id JOIN project_info pi ON qc.project_name = pi.project_name WHERE (pi.pm_user_id = ${userId} OR LOWER(TRIM(pi.pm)) = LOWER(TRIM(${userName}))) AND qi.end_date IS NOT NULL AND qi.end_date != '' AND NULLIF(qi.end_date, '')::date < CURRENT_DATE AND qi.approved = false AND qi.is_applicable = true ORDER BY qi.end_date ASC LIMIT 100`),
        execItems(sql`SELECT COALESCE(title, 'Notification') as name, '' as project, created_at::text as date FROM notifications WHERE recipient_user_id = ${userId} AND is_read = false AND created_at < NOW() - INTERVAL '3 days' ORDER BY created_at ASC LIMIT 100`),
      ]);

      res.json({
        pointValues: POINT_VALUES,
        penaltyValues: PENALTY_VALUES,
        earnedTotal,
        penaltyTotal,
        netTotal,
        participation: act.participation,
        earned: {
          tasksCompleted: buildCategory(act.tasksCompleted, POINT_VALUES.task_complete, tasksCompletedItems),
          approvalsGiven: buildCategory(act.approvalsGiven, POINT_VALUES.approval_given, approvalsGivenItems),
          weeklyReviews: buildCategory(act.weeklyReviews, POINT_VALUES.weekly_review, weeklyReviewItems),
          importsCompleted: buildCategory(act.importsCompleted, POINT_VALUES.import_complete, importsCompletedItems),
          projectUpdates: buildCategory(act.projectUpdates, POINT_VALUES.project_update, projectUpdatesItems),
          qualityApprovals: buildCategory(act.qualityApprovals, POINT_VALUES.quality_approve, qualityApprovalsItems),
          engStagesCompleted: buildCategory(act.engStagesCompleted, POINT_VALUES.eng_stage_complete, engStagesCompletedItems),
          deliverablesUploaded: buildCategory(act.deliverablesUploaded, POINT_VALUES.deliverable_uploaded, deliverablesUploadedItems),
          engTasksOwned: buildCategory(act.engTasksOwned, POINT_VALUES.eng_task_owned, engTasksOwnedItems),
          opsTasksAssigned: buildCategory(act.opsTasksAssigned, POINT_VALUES.ops_task_assigned, opsTasksAssignedItems),
        },
        penalties: {
          overdueTasks: buildCategory(act.overdueTasks, PENALTY_VALUES.overdue_task, overdueTaskItems),
          plansBehind: buildCategory(act.plansBehind, PENALTY_VALUES.plan_behind, plansBehindItems),
          qualityFailures: buildCategory(act.qualityFailures, PENALTY_VALUES.quality_failure, qualityFailureItems),
          rejectedDeliverables: buildCategory(act.rejectedDeliverables, PENALTY_VALUES.rejected_deliverable, rejectedDeliverableItems),
          openQualityWarnings: buildCategory(act.openQualityWarnings, PENALTY_VALUES.open_quality_warning, openQualityWarningItems),
          overdueEngTasks: buildCategory(act.overdueEngTasks, PENALTY_VALUES.overdue_eng_task, overdueEngTaskItems),
          unreadNotifications: buildCategory(act.unreadNotifications, PENALTY_VALUES.unread_notifications, unreadNotifItems),
          overdueQmTasks: buildCategory(act.overdueQmTasks, PENALTY_VALUES.overdue_qm_task, overdueQmTaskItems),
        },
      });
    } catch (err: any) {
      console.error("Error fetching user gamification details:", err);
      res.status(500).json({ error: "Failed to fetch detail data" });
    }
  });
}


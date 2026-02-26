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
};

interface UserActivityCounts {
  userId: number;
  tasksCompleted: number;
  approvalsGiven: number;
  weeklyReviews: number;
  importsCompleted: number;
  dataFixes: number;
  projectUpdates: number;
  qualityApprovals: number;
  engStagesCompleted: number;
}

async function computeUserActivities(): Promise<UserActivityCounts[]> {
  const allUsers = await db.select({ id: users.id }).from(users);
  const results: UserActivityCounts[] = [];

  for (const u of allUsers) {
    const uid = u.id;

    const [taskRow] = await db.execute(
      sql`SELECT COUNT(*)::int as cnt FROM normalized_plan_tasks WHERE owner_user_id = ${uid} AND actual_pct_complete >= 1`
    ).catch(() => [{ cnt: 0 }]);

    const [approvalRow] = await db.execute(
      sql`SELECT COUNT(*)::int as cnt FROM project_eng_approvals WHERE approver_user_id = ${uid} AND status = 'approved'`
    ).catch(() => [{ cnt: 0 }]);

    const [reviewRow] = await db.execute(
      sql`SELECT COUNT(*)::int as cnt FROM weekly_reviews WHERE reviewed_by = ${uid} AND status = 'completed'`
    ).catch(() => [{ cnt: 0 }]);

    const [importRow] = await db.execute(
      sql`SELECT COUNT(*)::int as cnt FROM smart_import_runs WHERE committed_by = ${uid} AND status = 'COMMITTED'`
    ).catch(() => [{ cnt: 0 }]);

    const [changeRow] = await db.execute(
      sql`SELECT COUNT(*)::int as cnt FROM change_sets WHERE actor_user_id = ${uid}`
    ).catch(() => [{ cnt: 0 }]);

    const [qcRow] = await db.execute(
      sql`SELECT COUNT(*)::int as cnt FROM qc_item_instance WHERE approved_by_user_id = ${uid} AND approved = true`
    ).catch(() => [{ cnt: 0 }]);

    const [engRow] = await db.execute(
      sql`SELECT COUNT(*)::int as cnt FROM project_eng_stages WHERE created_by = ${uid} AND status = 'complete'`
    ).catch(() => [{ cnt: 0 }]);

    results.push({
      userId: uid,
      tasksCompleted: Number((taskRow as any)?.cnt || 0),
      approvalsGiven: Number((approvalRow as any)?.cnt || 0),
      weeklyReviews: Number((reviewRow as any)?.cnt || 0),
      importsCompleted: Number((importRow as any)?.cnt || 0),
      dataFixes: 0,
      projectUpdates: Number((changeRow as any)?.cnt || 0),
      qualityApprovals: Number((qcRow as any)?.cnt || 0),
      engStagesCompleted: Number((engRow as any)?.cnt || 0),
    });
  }

  return results;
}

function computePoints(act: UserActivityCounts): number {
  return (
    act.tasksCompleted * POINT_VALUES.task_complete +
    act.approvalsGiven * POINT_VALUES.approval_given +
    act.weeklyReviews * POINT_VALUES.weekly_review +
    act.importsCompleted * POINT_VALUES.import_complete +
    act.dataFixes * POINT_VALUES.data_fix +
    act.projectUpdates * POINT_VALUES.project_update +
    act.qualityApprovals * POINT_VALUES.quality_approve +
    act.engStagesCompleted * POINT_VALUES.eng_stage_complete
  );
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

      const leaderboard = activities.map(act => {
        const u = userMap[act.userId];
        if (!u) return null;
        const points = computePoints(act);
        const earnedBadgeKeys = computeEarnedBadges(act);
        const level = getUserLevel(points);

        return {
          userId: act.userId,
          name: u.name,
          role: u.role,
          points,
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

      const points = computePoints(act);
      const earnedBadgeKeys = computeEarnedBadges(act);
      const level = getUserLevel(points);

      const allBadges = Object.entries(BADGE_DEFINITIONS).map(([key, def]) => ({
        key,
        ...def,
        earned: earnedBadgeKeys.includes(key),
      }));

      res.json({
        userId,
        name: u.name,
        role: u.role,
        points,
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
        },
      });
    } catch (err: any) {
      console.error("Error fetching user gamification:", err);
      res.status(500).json({ error: "Failed to fetch user data" });
    }
  });
}

export async function ensureGamificationTables() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_badges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        badge_key TEXT NOT NULL,
        awarded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        meta JSONB,
        UNIQUE(user_id, badge_key)
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_points (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        points INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL,
        description TEXT,
        awarded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_badges_unique ON user_badges(user_id, badge_key)
    `).catch(() => {});
    console.log("[Gamification] Tables ensured");
  } catch (err: any) {
    console.error("[Gamification] Table creation error:", err.message);
  }
}

import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { projectInfo, projectExecutionState } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getCanonicalFinanceByProjectIds, getCanonicalTaskSummaryByProjectIds } from "./services/canonical-dashboard-kpi-service";

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const payload = verifyToken(authHeader.substring(7));
    if (payload) {
      (req as any).user = payload;
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  res.status(401).json({ error: "Authentication required" });
}

const PM_ALLOWED_ROLES = ["PROJECT_MANAGER_SITE", "PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN", "admin"];

function requirePmRole(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || !PM_ALLOWED_ROLES.includes(user.role)) {
    return res.status(403).json({ error: "Access denied" });
  }
  next();
}

function getUser(req: Request): { userId: number; name: string; role: string } {
  return (req as any).user;
}

const COO_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin"];

function resolveTargetPmUserId(req: Request): number {
  const user = getUser(req);
  const currentUserId = Number(user.userId || (user as any).id);
  if (COO_ROLES.includes(user.role) && req.query.pmUserId) {
    return parseInt(req.query.pmUserId as string, 10);
  }
  return currentUserId;
}

async function getPmProjectNames(userId: number): Promise<{ projects: any[]; pgArray: string }> {
  const projects = await db
    .select({
      id: projectInfo.id,
      projectName: projectInfo.projectName,
      phase: projectExecutionState.phase,
      ragStatus: projectExecutionState.ragStatus,
      contractValue: projectInfo.contractValue,
      sizeKwp: projectInfo.sizeKwp,
      pm: projectInfo.pm,
      pdHandoverDate: projectExecutionState.pdHandoverDate,
      constructionStartDate: projectExecutionState.constructionStartDate,
      commissioningDate: projectExecutionState.commissioningDate,
      omHandoverDate: projectExecutionState.omHandoverDate,
      clientHandoverDate: projectExecutionState.clientHandoverDate,
      pdHandoverActual: projectExecutionState.pdHandoverActual,
      constructionStartActual: projectExecutionState.constructionStartActual,
      commissioningActual: projectExecutionState.commissioningActual,
      clientHandoverActual: projectExecutionState.clientHandoverActual,
      escalationLevel: projectExecutionState.escalationLevel,
      isActive: projectExecutionState.isActive,
    })
    .from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
    .where(eq(projectInfo.pmUserId, userId))
    .orderBy(projectInfo.projectName);

  const projectNames = projects.map(p => p.projectName);
  const pgArray = `{${projectNames.map(n => `"${n.replace(/"/g, '\\"')}"`).join(",")}}`;
  return { projects, pgArray };
}

export function registerPmRoutes(app: Express) {
  app.use("/api/pm", jwtAuth);

  app.get("/api/pm/users", requireAuth, requirePmRole, async (req: Request, res: Response) => {
    try {
      const result = await db.execute(sql.raw(
        `SELECT u.id, u.username, u.name, COUNT(pi.id) AS project_count
         FROM users u
         LEFT JOIN project_info pi ON pi.pm_user_id = u.id
         WHERE u.role = 'PROJECT_MANAGER_SITE'
         GROUP BY u.id, u.username, u.name
         ORDER BY u.name`
      ));
      res.json({ users: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/pm/dashboard", requireAuth, requirePmRole, async (req: Request, res: Response) => {
    try {
      const targetUserId = resolveTargetPmUserId(req);
      const { projects } = await getPmProjectNames(targetUserId);
      const projectIds = projects.map(p => p.id);

      if (projectIds.length === 0) {
        return res.json({
          projects: [],
          summary: {
            totalProjects: 0, totalContractValue: 0, totalBudget: 0, totalActualSpend: 0,
            activeTasks: 0, overdueTasks: 0, completedTasks: 0,
            grossProfit: 0, avgSpendPercent: 0, cosRealisedTotal: 0, cosFlaggedTotal: 0,
          },
        });
      }

      // Classification: CANONICAL_READ
      // PM dashboard rollups are keyed by project_id and sourced from canonical structures only.
      const [financialsByProject, tasksByProject] = await Promise.all([
        getCanonicalFinanceByProjectIds(projectIds),
        getCanonicalTaskSummaryByProjectIds(projectIds),
      ]);

      const enrichedProjects = projects.map((p) => {
        const fin = financialsByProject.get(p.id) || {
          totalCost: 0, paidCost: 0, outstandingCost: 0,
        };
        const tasks = tasksByProject.get(p.id) || {
          total: 0, inProgress: 0, completed: 0, onHold: 0, needsApproval: 0, overdue: 0, active: 0,
        };
        const cosPlanned = 0;

        return {
          id: p.id,
          projectName: p.projectName,
          phase: p.phase,
          ragStatus: p.ragStatus,
          contractValue: parseFloat(p.contractValue || "0") || 0,
          sizeKwp: parseFloat(String(p.sizeKwp || "0")) || 0,
          escalationLevel: p.escalationLevel,
          isActive: p.isActive,
          dates: {
            pdHandover: p.pdHandoverDate,
            pdHandoverActual: p.pdHandoverActual,
            constructionStart: p.constructionStartDate,
            constructionStartActual: p.constructionStartActual,
            commissioning: p.commissioningDate,
            commissioningActual: p.commissioningActual,
            clientHandover: p.clientHandoverDate,
            clientHandoverActual: p.clientHandoverActual,
            omHandover: p.omHandoverDate,
          },
          financials: {
            totalBudget: fin.totalCost,
            totalActual: fin.paidCost,
            spendPercent: fin.totalCost > 0 ? Math.round((fin.paidCost / fin.totalCost) * 100) : 0,
            cosRealised: fin.paidCost,
            cosCommitted: fin.outstandingCost,
            cosPlanned,
          },
          tasks: {
            total: tasks.total,
            inProgress: tasks.inProgress,
            completed: tasks.completed,
            onHold: tasks.onHold,
            needsApproval: tasks.needsApproval,
            overdue: tasks.overdue,
            active: tasks.active,
          },
        };
      });

      const summary = {
        totalProjects: enrichedProjects.length,
        totalContractValue: enrichedProjects.reduce((s, p) => s + p.contractValue, 0),
        totalBudget: enrichedProjects.reduce((s, p) => s + p.financials.totalBudget, 0),
        totalActualSpend: enrichedProjects.reduce((s, p) => s + p.financials.totalActual, 0),
        activeTasks: enrichedProjects.reduce((s, p) => s + p.tasks.active, 0),
        overdueTasks: enrichedProjects.reduce((s, p) => s + p.tasks.overdue, 0),
        completedTasks: enrichedProjects.reduce((s, p) => s + p.tasks.completed, 0),
        grossProfit: (() => {
          const totalCV = enrichedProjects.reduce((s, p) => s + p.contractValue, 0);
          const totalActual = enrichedProjects.reduce((s, p) => s + p.financials.totalActual, 0);
          return totalCV > 0 ? Math.round(((totalCV - totalActual) / totalCV) * 100) : 0;
        })(),
        avgSpendPercent: (() => {
          const withBudget = enrichedProjects.filter(p => p.financials.totalBudget > 0);
          if (withBudget.length === 0) return 0;
          return Math.round(withBudget.reduce((s, p) => s + p.financials.spendPercent, 0) / withBudget.length);
        })(),
        cosRealisedTotal: enrichedProjects.reduce((s, p) => s + p.financials.cosRealised, 0),
        cosCommittedTotal: enrichedProjects.reduce((s, p) => s + p.financials.cosCommitted, 0),
      };

      res.json({ projects: enrichedProjects, summary });
    } catch (err: any) {
      console.error("[PM Dashboard] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Classification: CANONICAL
  // Uses work_items for priority feed.
  app.get("/api/pm/priority-items", requireAuth, requirePmRole, async (req: Request, res: Response) => {
    try {
      const targetUserId = resolveTargetPmUserId(req);
      const { projects, pgArray } = await getPmProjectNames(targetUserId);
      const projectNames = projects.map(p => p.projectName);

      if (projectNames.length === 0) {
        return res.json({ items: [] });
      }

      const overdueTasks = await db.execute(
        sql`
          SELECT wi.id, pi.project_name, wi.title, wi.status, wi.priority, wi.end_date AS due_date, wi.phase, wi.workstream
          FROM work_items wi
          JOIN project_info pi ON wi.project_id = pi.id
          WHERE pi.project_name = ANY(${pgArray}::text[])
            AND wi.deleted_at IS NULL
            AND wi.parent_id IS NULL
            AND wi.end_date IS NOT NULL
            AND wi.end_date::text < CURRENT_DATE::text
            AND wi.status NOT IN ('COMPLETE', 'QC APPROVED')
          ORDER BY wi.end_date ASC
          LIMIT 50
        `
      );

      const holdTasks = await db.execute(
        sql`
          SELECT wi.id, pi.project_name, wi.title, wi.status, wi.priority, wi.end_date AS due_date, wi.hold_reason, wi.phase
          FROM work_items wi
          JOIN project_info pi ON wi.project_id = pi.id
          WHERE pi.project_name = ANY(${pgArray}::text[])
            AND wi.deleted_at IS NULL
            AND wi.parent_id IS NULL
            AND wi.status = 'HOLD'
          ORDER BY wi.end_date ASC NULLS LAST
          LIMIT 20
        `
      );

      const approvalTasks = await db.execute(
        sql`
          SELECT wi.id, pi.project_name, wi.title, wi.status, wi.priority, wi.end_date AS due_date, wi.phase
          FROM work_items wi
          JOIN project_info pi ON wi.project_id = pi.id
          WHERE pi.project_name = ANY(${pgArray}::text[])
            AND wi.deleted_at IS NULL
            AND wi.parent_id IS NULL
            AND wi.status = 'NEEDS APPROVAL'
          ORDER BY wi.end_date ASC NULLS LAST
          LIMIT 20
        `
      );

      const items: any[] = [];

      for (const t of overdueTasks.rows as any[]) {
        items.push({
          type: "overdue_task",
          severity: "high",
          projectName: t.project_name,
          title: t.title,
          detail: `Due ${t.due_date} - ${t.status}`,
          taskId: t.id,
          dueDate: t.due_date,
          priority: t.priority,
          phase: t.phase,
          link: `/project/${encodeURIComponent(t.project_name)}?tab=engineering`,
        });
      }

      for (const t of holdTasks.rows as any[]) {
        items.push({
          type: "hold_task",
          severity: "medium",
          projectName: t.project_name,
          title: t.title,
          detail: t.hold_reason || "On hold — no reason provided",
          taskId: t.id,
          dueDate: t.due_date,
          priority: t.priority,
          phase: t.phase,
          link: `/project/${encodeURIComponent(t.project_name)}?tab=engineering`,
        });
      }

      for (const t of approvalTasks.rows as any[]) {
        items.push({
          type: "approval_needed",
          severity: "medium",
          projectName: t.project_name,
          title: t.title,
          detail: "Awaiting approval",
          taskId: t.id,
          dueDate: t.due_date,
          priority: t.priority,
          phase: t.phase,
          link: `/project/${encodeURIComponent(t.project_name)}?tab=engineering`,
        });
      }



      items.sort((a, b) => {
        const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const sa = sevOrder[a.severity] ?? 2;
        const sb = sevOrder[b.severity] ?? 2;
        if (sa !== sb) return sa - sb;
        const typeOrder: Record<string, number> = { overdue_task: 0, cos_flagged: 1, budget_overrun: 2, hold_task: 3, approval_needed: 4 };
        return (typeOrder[a.type] ?? 5) - (typeOrder[b.type] ?? 5);
      });

      res.json({ items });
    } catch (err: any) {
      console.error("[PM Priority] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Classification: CANONICAL
  // Uses work_items for schedule feed / calendar events.
  app.get("/api/pm/calendar-events", requireAuth, requirePmRole, async (req: Request, res: Response) => {
    try {
      const targetUserId = resolveTargetPmUserId(req);
      const { projects, pgArray } = await getPmProjectNames(targetUserId);
      const projectNames = projects.map(p => p.projectName);

      const events: any[] = [];

      for (const p of projects) {
        const milestones = [
          { label: "PD Handover", planned: p.pdHandoverDate, actual: p.pdHandoverActual },
          { label: "Construction Start", planned: p.constructionStartDate, actual: p.constructionStartActual },
          { label: "Commissioning", planned: p.commissioningDate, actual: p.commissioningActual },
          { label: "Client Handover", planned: p.clientHandoverDate, actual: p.clientHandoverActual },
          { label: "O&M Handover", planned: p.omHandoverDate, actual: null },
        ];
        for (const m of milestones) {
          const dateStr = m.actual || m.planned;
          if (dateStr) {
            events.push({
              type: "milestone",
              projectName: p.projectName,
              title: m.label,
              date: dateStr,
              isCompleted: !!m.actual,
              link: `/project/${encodeURIComponent(p.projectName)}`,
            });
          }
        }
      }

      if (projectNames.length > 0) {
        const taskDates = await db.execute(
          sql`
            SELECT wi.id, pi.project_name, wi.title, wi.status, wi.priority, wi.end_date AS due_date, wi.start_date
            FROM work_items wi
            JOIN project_info pi ON wi.project_id = pi.id
            WHERE pi.project_name = ANY(${pgArray}::text[])
              AND wi.deleted_at IS NULL
              AND wi.parent_id IS NULL
              AND wi.status NOT IN ('COMPLETE', 'QC APPROVED')
              AND (wi.end_date IS NOT NULL OR wi.start_date IS NOT NULL)
            ORDER BY COALESCE(wi.end_date, wi.start_date)
            LIMIT 200
          `
        );

        for (const t of taskDates.rows as any[]) {
          if (t.due_date) {
            events.push({
              type: "task_due",
              projectName: t.project_name,
              title: t.title,
              date: t.due_date,
              taskId: t.id,
              status: t.status,
              priority: t.priority,
              isOverdue: t.due_date < new Date().toISOString().split("T")[0],
              link: `/project/${encodeURIComponent(t.project_name)}?tab=engineering`,
            });
          }
        }
      }

      events.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

      res.json({ events });
    } catch (err: any) {
      console.error("[PM Calendar] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { projectInfo } from "@shared/schema";
import { eq } from "drizzle-orm";

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

const PM_ALLOWED_ROLES = ["PROJECT_MANAGER_SITE", "PROJECT_DEVELOPER", "COO_ADMIN", "CEO_ADMIN", "admin"];

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
  if (COO_ROLES.includes(user.role) && req.query.pmUserId) {
    return parseInt(req.query.pmUserId as string);
  }
  return user.userId;
}

async function getPmProjectNames(userId: number): Promise<{ projects: any[]; pgArray: string }> {
  const projects = await db
    .select({
      id: projectInfo.id,
      projectName: projectInfo.projectName,
      phase: projectInfo.phase,
      ragStatus: projectInfo.ragStatus,
      contractValue: projectInfo.contractValue,
      sizeKwp: projectInfo.sizeKwp,
      pm: projectInfo.pm,
      pdHandoverDate: projectInfo.pdHandoverDate,
      constructionStartDate: projectInfo.constructionStartDate,
      commissioningDate: projectInfo.commissioningDate,
      omHandoverDate: projectInfo.omHandoverDate,
      clientHandoverDate: projectInfo.clientHandoverDate,
      pdHandoverActual: projectInfo.pdHandoverActual,
      constructionStartActual: projectInfo.constructionStartActual,
      commissioningActual: projectInfo.commissioningActual,
      clientHandoverActual: projectInfo.clientHandoverActual,
      escalationLevel: projectInfo.escalationLevel,
      isActive: projectInfo.isActive,
    })
    .from(projectInfo)
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
      const { projects, pgArray } = await getPmProjectNames(targetUserId);
      const projectNames = projects.map(p => p.projectName);

      if (projectNames.length === 0) {
        return res.json({
          projects: [],
          summary: {
            totalProjects: 0, totalContractValue: 0, totalBudget: 0, totalActualSpend: 0,
            activeTasks: 0, overdueTasks: 0, completedTasks: 0,
            grossProfit: 0, avgSpendPercent: 0, cosRealisedTotal: 0, cosFlaggedTotal: 0,
          },
        });
      }

      const financialsResult = await db.execute(
        sql`
          SELECT
            project_name,
            COALESCE(SUM(CAST(amount_ex_vat AS NUMERIC)), 0) AS total_budget,
            COALESCE(SUM(CAST(amount_ex_vat AS NUMERIC)), 0) AS total_actual,
            COUNT(*) FILTER (WHERE invoice_number IS NOT NULL AND invoice_number != '' AND invoice_date IS NOT NULL AND TRIM(CAST(invoice_date AS TEXT)) != '') AS cos_realised,
            COUNT(*) FILTER (WHERE (po_number IS NOT NULL AND po_number != '' OR invoice_number IS NOT NULL AND invoice_number != '') AND (invoice_date IS NULL OR TRIM(CAST(invoice_date AS TEXT)) = '')) AS cos_committed,
            COUNT(*) AS total_lines
          FROM normalized_cost_lines
          WHERE project_name = ANY(${pgArray}::text[])
          GROUP BY project_name
        `
      );

      const financialsByProject: Record<string, any> = {};
      for (const row of financialsResult.rows as any[]) {
        financialsByProject[row.project_name] = {
          totalBudget: parseFloat(row.total_budget) || 0,
          totalActual: parseFloat(row.total_actual) || 0,
          cosRealised: parseInt(row.cos_realised) || 0,
          cosCommitted: parseInt(row.cos_committed) || 0,
          totalLines: parseInt(row.total_lines) || 0,
        };
      }

      const tasksResult = await db.execute(
        sql`
          SELECT
            project_name,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'IN PROGRESS') AS in_progress,
            COUNT(*) FILTER (WHERE status = 'COMPLETE') AS completed,
            COUNT(*) FILTER (WHERE status = 'HOLD') AS on_hold,
            COUNT(*) FILTER (WHERE status = 'NEEDS APPROVAL') AS needs_approval,
            COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE::text AND status NOT IN ('COMPLETE', 'QC APPROVED')) AS overdue,
            COUNT(*) FILTER (WHERE status NOT IN ('COMPLETE', 'QC APPROVED')) AS active
          FROM operational_tasks
          WHERE project_name = ANY(${pgArray}::text[])
            AND parent_task_id IS NULL
          GROUP BY project_name
        `
      );

      const tasksByProject: Record<string, any> = {};
      for (const row of tasksResult.rows as any[]) {
        tasksByProject[row.project_name] = {
          total: parseInt(row.total) || 0,
          inProgress: parseInt(row.in_progress) || 0,
          completed: parseInt(row.completed) || 0,
          onHold: parseInt(row.on_hold) || 0,
          needsApproval: parseInt(row.needs_approval) || 0,
          overdue: parseInt(row.overdue) || 0,
          active: parseInt(row.active) || 0,
        };
      }

      const enrichedProjects = projects.map((p) => {
        const fin = financialsByProject[p.projectName] || {
          totalBudget: 0, totalActual: 0, cosRealised: 0, cosCommitted: 0, totalLines: 0,
        };
        const tasks = tasksByProject[p.projectName] || {
          total: 0, inProgress: 0, completed: 0, onHold: 0, needsApproval: 0, overdue: 0, active: 0,
        };
        const cosPlanned = Math.max(0, fin.totalLines - fin.cosRealised - fin.cosCommitted);

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
            totalBudget: fin.totalBudget,
            totalActual: fin.totalActual,
            spendPercent: fin.totalBudget > 0 ? Math.round((fin.totalActual / fin.totalBudget) * 100) : 0,
            cosRealised: fin.cosRealised,
            cosCommitted: fin.cosCommitted,
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
          SELECT id, project_name, title, status, priority, due_date, phase, primary_workstream
          FROM operational_tasks
          WHERE project_name = ANY(${pgArray}::text[])
            AND parent_task_id IS NULL
            AND due_date IS NOT NULL
            AND due_date < CURRENT_DATE::text
            AND status NOT IN ('COMPLETE', 'QC APPROVED')
          ORDER BY due_date ASC
          LIMIT 50
        `
      );

      const holdTasks = await db.execute(
        sql`
          SELECT id, project_name, title, status, priority, due_date, hold_reason, phase
          FROM operational_tasks
          WHERE project_name = ANY(${pgArray}::text[])
            AND parent_task_id IS NULL
            AND status = 'HOLD'
          ORDER BY due_date ASC NULLS LAST
          LIMIT 20
        `
      );

      const approvalTasks = await db.execute(
        sql`
          SELECT id, project_name, title, status, priority, due_date, phase
          FROM operational_tasks
          WHERE project_name = ANY(${pgArray}::text[])
            AND parent_task_id IS NULL
            AND status = 'NEEDS APPROVAL'
          ORDER BY due_date ASC NULLS LAST
          LIMIT 20
        `
      );

      const flaggedCos = { rows: [] as any[] };

      const budgetOverruns = { rows: [] as any[] };

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

      for (const c of flaggedCos.rows as any[]) {
        items.push({
          type: "cos_flagged",
          severity: "high",
          projectName: c.project_name,
          title: `${c.expense_category}: ${c.expense_line_item || "Unknown item"}`,
          detail: `COS Flagged — black date but no invoice (R${(parseFloat(c.amount) || 0).toLocaleString()})`,
          expenseId: c.id,
          link: `/project/${encodeURIComponent(c.project_name)}?tab=money`,
        });
      }

      for (const b of budgetOverruns.rows as any[]) {
        const budget = parseFloat(b.total_budget) || 0;
        const actual = parseFloat(b.total_actual) || 0;
        const overrun = Math.round(((actual - budget) / budget) * 100);
        items.push({
          type: "budget_overrun",
          severity: overrun > 20 ? "high" : "medium",
          projectName: b.project_name,
          title: `Cost overrun: ${overrun}%`,
          detail: `Actual R${actual.toLocaleString()} vs Costed R${budget.toLocaleString()}`,
          link: `/project/${encodeURIComponent(b.project_name)}?tab=money`,
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
            SELECT id, project_name, title, status, priority, due_date, start_date
            FROM operational_tasks
            WHERE project_name = ANY(${pgArray}::text[])
              AND parent_task_id IS NULL
              AND status NOT IN ('COMPLETE', 'QC APPROVED')
              AND (due_date IS NOT NULL OR start_date IS NOT NULL)
            ORDER BY COALESCE(due_date, start_date)
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

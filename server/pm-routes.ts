import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { projectInfo, programExpense, operationalTasks } from "@shared/schema";
import { eq, inArray, and, isNull, ne, lt, or } from "drizzle-orm";

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

const PM_ALLOWED_ROLES = ["PROJECT_MANAGER_SITE", "COO_ADMIN", "CEO_ADMIN", "admin"];

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

export function registerPmRoutes(app: Express) {
  app.use("/api/pm", jwtAuth);

  app.get("/api/pm/dashboard", requireAuth, requirePmRole, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const userId = user.userId;

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

      if (projectNames.length === 0) {
        return res.json({
          projects: [],
          summary: {
            totalProjects: 0,
            totalContractValue: 0,
            totalBudget: 0,
            totalActualSpend: 0,
            activeTasks: 0,
            overdueTasks: 0,
            completedTasks: 0,
          },
        });
      }

      const pgArray = `{${projectNames.map(n => `"${n.replace(/"/g, '\\"')}"`).join(",")}}`;
      const financialsResult = await db.execute(
        sql`
          SELECT
            project_name,
            COALESCE(SUM(CAST(budget_total AS NUMERIC)), 0) AS total_budget,
            COALESCE(SUM(CAST(expense_actual_total AS NUMERIC)), 0) AS total_actual,
            COUNT(*) FILTER (WHERE expense_invoice_number IS NOT NULL AND expense_invoice_number != '' AND (invoice_date_confirmed = true OR invoice_date_font_color = 'black')) AS cos_realised,
            COUNT(*) FILTER (WHERE expense_invoice_number IS NOT NULL AND expense_invoice_number != '' AND expense_invoiced_date IS NOT NULL AND invoice_date_font_color = 'red') AS cos_deferred,
            COUNT(*) FILTER (WHERE (invoice_date_confirmed = true OR invoice_date_font_color = 'black') AND (expense_invoice_number IS NULL OR expense_invoice_number = '')) AS cos_flagged,
            COUNT(*) FILTER (WHERE row_type = 'item') AS total_lines
          FROM program_expense
          WHERE project_name = ANY(${pgArray}::text[])
            AND row_type = 'item'
          GROUP BY project_name
        `
      );

      const financialsByProject: Record<string, any> = {};
      for (const row of financialsResult.rows as any[]) {
        financialsByProject[row.project_name] = {
          totalBudget: parseFloat(row.total_budget) || 0,
          totalActual: parseFloat(row.total_actual) || 0,
          cosRealised: parseInt(row.cos_realised) || 0,
          cosDeferred: parseInt(row.cos_deferred) || 0,
          cosFlagged: parseInt(row.cos_flagged) || 0,
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
          totalBudget: 0, totalActual: 0, cosRealised: 0, cosDeferred: 0, cosFlagged: 0, totalLines: 0,
        };
        const tasks = tasksByProject[p.projectName] || {
          total: 0, inProgress: 0, completed: 0, onHold: 0, needsApproval: 0, overdue: 0, active: 0,
        };
        const cosPlanned = Math.max(0, fin.totalLines - fin.cosRealised - fin.cosDeferred - fin.cosFlagged);

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
            cosDeferred: fin.cosDeferred,
            cosFlagged: fin.cosFlagged,
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
      };

      res.json({ projects: enrichedProjects, summary });
    } catch (err: any) {
      console.error("[PM Dashboard] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

/* eslint-disable no-restricted-syntax -- legacy direct db.* calls; tracked tech debt for migration to repository layer (CLAUDE.md). Do not extend. */
import type { Express, Request, Response, NextFunction } from "express";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../departments/shared-middleware";
import { evaluatePermissionForRequest, logPermissionFailure } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { getProjectDevelopmentWorkspaceRollup } from "../services/project-development-workspace-service";
import { db } from "../db";
import { engineeringTickets, projectInfo, opportunities, workItems } from "@shared/schema";
import { tryResolveCanonicalCode } from "@shared/phases";

// Cross-company Interaction is the PD-side rollup: it only covers projects
// that are still BEFORE the PM-PD handover (i.e. before S04_PLANNING).
// Once a project enters Planning, it is owned by PM and falls off this view.
const PRE_HANDOVER_PHASES = new Set<string>([
  "S01_FIRST_ASSESSMENT",
  "S02_DESIGN_COST_PROPOSAL",
  "S03_SIGNATURE_FINANCIAL_CLOSE",
]);

function isPreHandoverPhase(rawPhase: string | null | undefined): boolean {
  const code = tryResolveCanonicalCode(rawPhase);
  if (!code) return false;
  return PRE_HANDOVER_PHASES.has(code);
}

function parseDateParam(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function registerProjectDevelopmentWorkspaceRollupRoutes(app: Express) {
  // Permission policy: this endpoint historically required `projects:view`,
  // but it now also powers the Cross-company Interaction section of /pd.
  // /pd is gated on `pd_dashboard:view`, so we widen this endpoint to allow
  // either capability. This closes the permission-drift gap where a PD user
  // could open /pd but get a 403 panel for one of its required sections.
  const requirePdOrProjects = async (req: Request, res: Response, next: NextFunction) => {
    const a = await evaluatePermissionForRequest(req, "pd_dashboard", "view");
    if (a.allowed) return next();
    const b = await evaluatePermissionForRequest(req, "projects", "view");
    if (b.allowed) return next();
    // Preserve denied-access audit semantics from the original
    // requirePermission middleware. Log against `projects:view` since that
    // was the historical gate; record the pd_dashboard reason in the body
    // so audit trails surface both attempts.
    logPermissionFailure(req, "projects", "view", b.reason);
    return res.status(403).json({ error: "forbidden", reason: a.reason || b.reason });
  };

  app.get(
    "/api/project-development/workspace/rollup",
    requireAuth,
    requirePdOrProjects,
    async (req: Request, res: Response) => {
      try {
        const asOf = parseDateParam(req.query.asOf) ?? new Date().toISOString().slice(0, 10);
        const statusFilter = typeof req.query.statusFilter === "string" ? req.query.statusFilter : null;
        const phaseFilter = typeof req.query.phaseFilter === "string" ? req.query.phaseFilter : null;
        const ownerFilter = typeof req.query.ownerFilter === "string" ? req.query.ownerFilter : null;
        const departmentFilter = typeof req.query.departmentFilter === "string" ? req.query.departmentFilter : null;

        const ownerUserId = ownerFilter ? Number(ownerFilter) : null;
        // departmentFilter is a no-op (no canonical department column exists).
        const rollupAll = await getProjectDevelopmentWorkspaceRollup();
        const rollup = rollupAll.filter((r) => {
          // Hard scope: Cross-company Interaction is the PD-side rollup. Only
          // projects still BEFORE the PM-PD handover (S01-S03) belong here.
          // Anything in S04_PLANNING or later is owned by PM and excluded.
          if (!isPreHandoverPhase(r.phase)) return false;
          if (phaseFilter && r.phase !== phaseFilter) return false;
          if (statusFilter === "open" && r.pdTickets.open === 0 && r.workItems.open === 0) return false;
          if (statusFilter === "overdue" && r.pdTickets.overdue === 0 && r.workItems.overdue === 0) return false;
          return true;
        });

        const [oppTotalRow, linkedProjectsRow, linkedWorkItemsRow] = await Promise.all([
          db
            .select({ n: sql<number>`COUNT(*)` })
            .from(opportunities)
            .where(isNull(opportunities.deletedAt)),
          db
            .select({ n: sql<number>`COUNT(*)` })
            .from(projectInfo)
            .where(and(isNull(projectInfo.deletedAt), isNotNull(projectInfo.opportunityId))),
          db
            .select({ n: sql<number>`COUNT(*)` })
            .from(workItems)
            .innerJoin(engineeringTickets, and(eq(engineeringTickets.id, workItems.engineeringTicketId), isNull(engineeringTickets.deletedAt)))
            .leftJoin(projectInfo, eq(projectInfo.id, engineeringTickets.projectId))
            .where(and(
              isNull(workItems.deletedAt),
              sql`(${engineeringTickets.projectId} IS NULL OR ${projectInfo.deletedAt} IS NULL)`,
            )),
        ]);

        const weekFromNow = new Date();
        weekFromNow.setDate(weekFromNow.getDate() + 7);
        const weekIso = weekFromNow.toISOString().slice(0, 10);

        const [
          projectsWithoutTicketsRows,
          ticketsWithoutValidLinkageRows,
          workItemsWithInvalidLinkageRows,
          ticketsDueThisWeekRows,
          tasksDueThisWeekRows,
        ] = await Promise.all([
          db
            .select({ id: projectInfo.id, projectName: projectInfo.projectName })
            .from(projectInfo)
            .leftJoin(engineeringTickets, and(eq(engineeringTickets.projectId, projectInfo.id), isNull(engineeringTickets.deletedAt)))
            .where(and(isNull(projectInfo.deletedAt), isNull(engineeringTickets.id)))
            .limit(500),
          db
            .select({
              id: engineeringTickets.id,
              projectSiteName: engineeringTickets.projectSiteName,
              projectId: engineeringTickets.projectId,
              opportunityId: engineeringTickets.opportunityId,
              projectDeletedAt: projectInfo.deletedAt,
              opportunityDeletedAt: opportunities.deletedAt,
            })
            .from(engineeringTickets)
            .leftJoin(projectInfo, eq(projectInfo.id, engineeringTickets.projectId))
            .leftJoin(opportunities, eq(opportunities.id, engineeringTickets.opportunityId))
            .where(
              and(
                isNull(engineeringTickets.deletedAt),
                sql`(
                  (${engineeringTickets.projectId} IS NULL AND ${engineeringTickets.opportunityId} IS NULL)
                  OR (${engineeringTickets.projectId} IS NOT NULL AND (${projectInfo.id} IS NULL OR ${projectInfo.deletedAt} IS NOT NULL))
                  OR (${engineeringTickets.opportunityId} IS NOT NULL AND (${opportunities.id} IS NULL OR ${opportunities.deletedAt} IS NOT NULL))
                )`,
              ),
            )
            .limit(500),
          db
            .select({
              id: workItems.id,
              title: workItems.title,
              projectId: workItems.projectId,
            })
            .from(workItems)
            .leftJoin(engineeringTickets, eq(engineeringTickets.id, workItems.engineeringTicketId))
            .where(
              and(
                isNull(workItems.deletedAt),
                sql`${workItems.engineeringTicketId} IS NOT NULL`,
                sql`${engineeringTickets.id} IS NULL OR ${engineeringTickets.deletedAt} IS NOT NULL`,
              ),
            )
            .limit(500),
          db
            .select({
              id: engineeringTickets.id,
              projectSiteName: engineeringTickets.projectSiteName,
              dueDate: engineeringTickets.dueDate,
              projectId: engineeringTickets.projectId,
              projectDeveloperUserId: engineeringTickets.projectDeveloperUserId,
            })
            .from(engineeringTickets)
            .leftJoin(projectInfo, eq(projectInfo.id, engineeringTickets.projectId))
            .where(
              and(
                isNull(engineeringTickets.deletedAt),
                sql`(${engineeringTickets.projectId} IS NULL OR ${projectInfo.deletedAt} IS NULL)`,
                sql`${engineeringTickets.dueDate} IS NOT NULL AND ${engineeringTickets.dueDate} >= ${asOf} AND ${engineeringTickets.dueDate} <= ${weekIso}`,
                ownerUserId ? eq(engineeringTickets.projectDeveloperUserId, ownerUserId) : sql`TRUE`,
              ),
            )
            .limit(500),
          db
            .select({
              id: workItems.id,
              title: workItems.title,
              endDate: workItems.endDate,
              projectId: workItems.projectId,
              pdTicketId: workItems.engineeringTicketId,
              ownerUserId: workItems.ownerUserId,
            })
            .from(workItems)
            .leftJoin(engineeringTickets, eq(engineeringTickets.id, workItems.engineeringTicketId))
            .leftJoin(projectInfo, eq(projectInfo.id, workItems.projectId))
            .where(
              and(
                isNull(workItems.deletedAt),
                sql`${workItems.endDate} IS NOT NULL AND ${workItems.endDate} >= ${asOf} AND ${workItems.endDate} <= ${weekIso}`,
                sql`(${workItems.engineeringTicketId} IS NULL OR ${engineeringTickets.deletedAt} IS NULL)`,
                sql`(${workItems.projectId} IS NULL OR ${projectInfo.deletedAt} IS NULL)`,
                ownerUserId ? eq(workItems.ownerUserId, ownerUserId) : sql`TRUE`,
              ),
            )
            .limit(500),
        ]);

        const spineGapCount = rollup.filter((r) => r.spineGap).length;
        const cascadeAnomalyCount = workItemsWithInvalidLinkageRows.length;

        logAuditFromReq(req, {
          entityType: "workspace_rollup",
          entityId: "org",
          action: "view",
          changesJson: {
            projectCount: rollup.length,
            spineGapCount,
            cascadeAnomalyCount,
            filters: { asOf, statusFilter, phaseFilter, ownerFilter, departmentFilter },
          },
        });

        const openPdTickets = rollup.reduce((acc, r) => acc + Number(r.pdTickets.open), 0);
        const overduePdTickets = rollup.reduce((acc, r) => acc + Number(r.pdTickets.overdue), 0);
        // Vocabulary phase 1 (task #56): mirror each `engineeringTickets`-keyed
        // row block as `engineeringTickets` so new clients can read the
        // friendlier name. Old clients continue to read `engineeringTickets`. Both
        // keys stay in the payload until the planned phase 2 cleanup.
        const rowsWithKindAlias = rollup.map((r) => ({
          ...r,
          engineeringTickets: r.pdTickets,
        }));

        res.json({
          generatedAt: new Date().toISOString(),
          asOf,
          filters: { statusFilter, phaseFilter, ownerFilter, departmentFilter },
          totals: {
            // Postgres returns COUNT(*)/bigint as a string; coerce so the
            // payload contract is numeric on both Postgres and SQLite.
            opportunities: Number(oppTotalRow[0]?.n ?? 0),
            linkedProjects: Number(linkedProjectsRow[0]?.n ?? 0),
            linkedWorkItems: Number(linkedWorkItemsRow[0]?.n ?? 0),
            projects: rollup.length,
            spineGap: Number(spineGapCount),
            cascadeAnomalies: Number(cascadeAnomalyCount),
            openPdTickets,
            overduePdTickets,
            // Phase-1 vocabulary aliases — see comment above. Same numbers,
            // friendlier key. Old keys remain.
            openEngineeringTickets: openPdTickets,
            overdueEngineeringTickets: overduePdTickets,
            openWorkItems: rollup.reduce((acc, r) => acc + Number(r.workItems.open), 0),
            blockedWorkItems: rollup.reduce((acc, r) => acc + Number(r.workItems.blocked), 0),
            overdueWorkItems: rollup.reduce((acc, r) => acc + Number(r.workItems.overdue), 0),
            openRaid: rollup.reduce((acc, r) => acc + Number(r.raid.open), 0),
            ticketsDueThisWeek: ticketsDueThisWeekRows.length,
            tasksDueThisWeek: tasksDueThisWeekRows.length,
            projectsWithoutTickets: projectsWithoutTicketsRows.length,
            ticketsWithoutValidLinkage: ticketsWithoutValidLinkageRows.length,
            workItemsWithInvalidLinkage: workItemsWithInvalidLinkageRows.length,
          },
          rows: rowsWithKindAlias,
          lists: {
            projectsWithoutTickets: projectsWithoutTicketsRows,
            ticketsWithoutValidLinkage: ticketsWithoutValidLinkageRows,
            workItemsWithInvalidLinkage: workItemsWithInvalidLinkageRows,
            ticketsDueThisWeek: ticketsDueThisWeekRows,
            tasksDueThisWeek: tasksDueThisWeekRows,
          },
        });
      } catch (err: any) {
        console.error("[workspace-rollup] failed:", err);
        res.status(500).json({ error: "Failed to compute workspace rollup" });
      }
    },
  );
}

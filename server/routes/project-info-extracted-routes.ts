/**
 * Project Info / Master Data Routes — Extracted from server/routes.ts (Phase 4c)
 *
 * 12 handlers:
 *   GET    /api/projects/:projectName/health-summary
 *   POST   /api/projects-summary/:projectName/edit
 *   PATCH  /api/projects-summary/:projectName/latest-update
 *   PATCH  /api/projects-summary/:projectInfoId/escalation
 *   GET    /api/projects/:id
 *   GET    /api/project-info
 *   GET    /api/project-detail-master
 *   GET    /api/admin/work-item-summary-diagnostics
 *   PATCH  /api/project-info/:id
 *   GET    /api/readiness/cutover-post-validation
 *   GET    /api/imports/sync-state
 *   GET    /api/readiness/core-master-data
 */

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import {
  qcItemInstance, qcChecklist, workItems,
  projectClientHistory, projectExecutionState,
} from "@shared/schema";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { ApiError, sendError, badRequest, serverError, logApiError } from "../lib/api-error";
import { getFeatureFlag, getFeatureFlags } from "../lib/feature-flags";
import { isWorkItemsEnabled, getAllWorkItemsForPlanTab } from "../work-items-adapter";
import { computeScheduleRag, computeCostRag, computeQualityRag, computeOverallRag } from "@shared/kpi-definitions";
import { classifyCosStatusFull } from "../lib/calculations/financeUtils";
import { actorFromReq, createProjectEvent } from "../services/project-event-service";
import { paramStr } from "../lib/req-params";
import { classifyProjectInfoPayload } from "../services/source-of-truth-policy";
import { listImportSyncState } from "../services/imports-governance-service";
import {
  compareCoreProjectsReadiness,
  getCoreMasterDataReadinessReport,
  listProjectInfoFromPromotedCoreCompat,
  listProjectDetailFromPromotedCoreCompat,
  buildWorkItemSummaryDiagnostics,
  compareProjectDetailMasterReadiness,
  compareImportsGovernanceReadiness,
  getDomainRolloutReadinessReport,
  getCutoverPostValidationReport,
} from "../services/promoted-read-compat";

// ── Helpers (moved from routes.ts) ──

function isCosRealisedCheck(exp: any): boolean {
  return classifyCosStatusFull(exp) === 'COS Realised';
}

const parityLogCooldownByKey = new Map<string, number>();
function shouldEmitParityLogSample(key: string, sampleRate = 0.2, minIntervalMs = 5 * 60 * 1000): boolean {
  const now = Date.now();
  const last = parityLogCooldownByKey.get(key) ?? 0;
  if (now - last < minIntervalMs) return false;
  if (Math.random() > sampleRate) return false;
  parityLogCooldownByKey.set(key, now);
  return true;
}

// ── Main registration function ──

export function registerProjectInfoExtractedRoutes(app: Express): void {

  // ==================== HEALTH SUMMARY ====================

  app.get("/api/projects/:projectName/health-summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = paramStr(req.params.projectName);
      const decodedName = decodeURIComponent(projectName);

      // Fetch all data in parallel
      const [expenses, inflows, planTasks, qualitySummaryRes, projectInfoRow, engStagesRes, engTasksRes] = await Promise.all([
        storage.getProgramExpensesByProject(decodedName),
        storage.getProgramInflowsByProject(decodedName),
        (async () => {
          const useCanonical = await isWorkItemsEnabled();
          if (useCanonical) {
            return getAllWorkItemsForPlanTab(decodedName);
          }
          return storage.getProjectPlansByProject(decodedName);
        })(),
        (async () => {
          try {
            const rows = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, decodedName));
            if (rows.length === 0) return { hasChecklist: false, phases: [] };
            const checklist = rows[0];
            const items = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));
            const phaseMap = new Map<string, { applicableItems: number; approvedItems: number }>();
            for (const item of items) {
              const phase = item.phaseName || "Unknown";
              if (!phaseMap.has(phase)) phaseMap.set(phase, { applicableItems: 0, approvedItems: 0 });
              const p = phaseMap.get(phase)!;
              p.applicableItems++;
              if (item.status === "PASS" || item.status === "N/A") p.approvedItems++;
            }
            return { hasChecklist: true, phases: Array.from(phaseMap.values()) };
          } catch { return { hasChecklist: false, phases: [] }; }
        })(),
        storage.getProjectInfo(decodedName),
        (async () => {
          try {
            const pid = (await storage.getProjectInfo(decodedName))?.id;
            if (!pid) return { stages: [] };
            const stagesRes = await db.query.projectEngStages?.findMany({ where: (s: any, { eq: eq2 }: any) => eq2(s.projectId, pid) });
            return { stages: stagesRes || [] };
          } catch { return { stages: [] }; }
        })(),
        (async () => {
          try {
            const pid = (await storage.getProjectInfo(decodedName))?.id;
            if (!pid) return { tasks: [] };
            // Read from work_items (ENG workstream)
            const tasks = await db.select().from(workItems).where(and(eq(workItems.projectId, pid), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));
            return { tasks };
          } catch { return { tasks: [] }; }
        })(),
      ]);

      // Contract value and budget
      const totalRevenueActual = inflows.reduce((s: number, r: any) => s + (Number(r.milestoneAmount) || 0), 0);
      const contractValue = (projectInfoRow as any)?.contractValue || totalRevenueActual || 0;
      const totalBudgetFromExpenses = expenses.reduce((s: number, e: any) => s + (Number(e.budgetTotal) || 0), 0);
      const budgetTotal = (projectInfoRow as any)?.budgetTotal || totalBudgetFromExpenses || 0;

      // Schedule RAG
      const today = new Date().toISOString().split("T")[0];
      const overduePlanTasks = (planTasks as any[]).filter((t: any) => {
        const endDate = t.actualEndDate || t.dueDate || t.actualEnd || t.endDate;
        const pct = t.percentComplete != null ? Number(t.percentComplete) : (Number(t.actualPctComplete) || 0);
        const pctNorm = pct > 1 ? pct : pct * 100;
        return endDate && endDate.substring(0, 10) < today && pctNorm < 100;
      });
      const completedPlanTasks = (planTasks as any[]).filter((t: any) => {
        const pct = t.percentComplete != null ? Number(t.percentComplete) : (Number(t.actualPctComplete) || 0);
        const pctNorm = pct > 1 ? pct : pct * 100;
        return pctNorm >= 100;
      });
      const planCompletionPct = planTasks.length > 0 ? (completedPlanTasks.length / planTasks.length) * 100 : 0;
      // Include overdue engineering tasks in schedule health
      const overdueEngTasks = (engTasksRes.tasks || []).filter((t: any) => {
        const due = t.endDate || t.dueDate;
        return due && String(due).substring(0, 10) < today && String(t.status).toUpperCase() !== "COMPLETE";
      });
      const scheduleRag = computeScheduleRag(overduePlanTasks.length + overdueEngTasks.length);

      // Cost RAG
      const totalExpenses = expenses.reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
      const costRatio = budgetTotal > 0 ? totalExpenses / budgetTotal : 0;
      const costRag = computeCostRag(costRatio);

      // Quality RAG — combines QC checklist gates with engineering stage gates
      const qualityPhases = qualitySummaryRes.phases || [];
      const qcGatesTotal = qualityPhases.length;
      const qcGatesPassed = qualityPhases.filter((p: any) => p.applicableItems > 0 && p.approvedItems >= p.applicableItems).length;
      const qualityTotalItems = qualityPhases.reduce((s: number, p: any) => s + (p.applicableItems || 0), 0);
      const qualityApprovedItems = qualityPhases.reduce((s: number, p: any) => s + (p.approvedItems || 0), 0);

      // Engineering stages as quality gates
      const engStagesForQuality = engStagesRes.stages || [];
      const engGatesTotal = engStagesForQuality.length;
      const engGatesPassed = engStagesForQuality.filter((s: any) => String(s.status).toLowerCase() === "complete").length;

      // Combined quality gates
      const qualityGatesTotal = qcGatesTotal + engGatesTotal;
      const qualityGatesPassed = qcGatesPassed + engGatesPassed;
      const hasQualityData = qualitySummaryRes.hasChecklist || engGatesTotal > 0;
      const combinedTotalItems = qualityTotalItems + engGatesTotal;
      const combinedApprovedItems = qualityApprovedItems + engGatesPassed;
      const qualityProgressPct = combinedTotalItems > 0 ? (combinedApprovedItems / combinedTotalItems) * 100 : 0;
      const qualityRag = computeQualityRag(hasQualityData, qualityGatesPassed, qualityGatesTotal, combinedApprovedItems);

      // Revenue realised %
      const totalPaidInflows = inflows
        .filter((m: any) => m.inBank === 1 || m.inBank === true)
        .reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
      const revenueRealisedPct = contractValue > 0 ? (totalPaidInflows / contractValue) * 100 : 0;

      // COS realised %
      const isCosRealised = (e: any) => isCosRealisedCheck(e);
      const totalRealisedCos = expenses.reduce((s: number, e: any) => isCosRealised(e) ? s + (Number(e.expenseActualTotal) || 0) : s, 0);
      const cosDenominator = totalExpenses > 0 ? totalExpenses : budgetTotal;
      const cosRealisedPct = cosDenominator > 0 ? (totalRealisedCos / cosDenominator) * 100 : 0;

      // Overall RAG
      const overallRag = computeOverallRag(scheduleRag, costRag, qualityRag);

      // Engineering progress
      const engStages = engStagesRes.stages || [];
      const engStageTotalTasks = engStages.reduce((s: number, st: any) => s + (st.tasks?.length || 0), 0);
      const engStageCompletedTasks = engStages.reduce((s: number, st: any) => s + (st.tasks?.filter((t: any) => String(t.status).toUpperCase() === "COMPLETE").length || 0), 0);
      const engBoardTasks = engTasksRes.tasks || [];
      const engBoardTotal = engBoardTasks.length;
      const engBoardCompleted = engBoardTasks.filter((t: any) => String(t.status).toUpperCase() === "COMPLETE").length;
      const engTotalTasks = engStageTotalTasks + engBoardTotal;
      const engCompletedTasks = engStageCompletedTasks + engBoardCompleted;
      const engProgressPct = engTotalTasks > 0 ? (engCompletedTasks / engTotalTasks) * 100 : 0;

      res.json({
        schedule: { rag: scheduleRag, overdueTasks: overduePlanTasks.length, overdueEngTasks: overdueEngTasks.length, completionPct: Math.round(planCompletionPct * 10) / 10 },
        cost: { rag: costRag, ratio: Math.round(costRatio * 1000) / 1000, totalExpenses, budgetTotal },
        quality: { rag: qualityRag, gatesTotal: qualityGatesTotal, gatesPassed: qualityGatesPassed, qcGatesTotal, qcGatesPassed, engGatesTotal, engGatesPassed, totalItems: combinedTotalItems, approvedItems: combinedApprovedItems, progressPct: Math.round(qualityProgressPct * 10) / 10 },
        revenue: { contractValue, realisedPct: Math.round(revenueRealisedPct * 10) / 10, totalPaidInflows },
        cos: { realisedPct: Math.round(cosRealisedPct * 10) / 10, totalRealised: totalRealisedCos },
        engineering: { progressPct: Math.round(engProgressPct * 10) / 10, totalTasks: engTotalTasks, completedTasks: engCompletedTasks },
        overall: { rag: overallRag },
        alerts: {
          overduePlanTasks: overduePlanTasks.length,
          overdueEngineeringTasks: overdueEngTasks.length,
          pendingQualityApprovals: Math.max(qualityTotalItems - qualityApprovedItems, 0),
        },
      });
    } catch (error: any) {
      logApiError("GET /api/projects/:projectName/health-summary", error);
      res.status(500).json({ error: "Failed to compute project health summary" });
    }
  });

  // ==================== PROJECT SUMMARY EDITS ====================

  app.post("/api/projects-summary/:projectName/edit", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName as string);
      const editSchema = z.object({
        costProposalSigned: z.string().nullable().optional(),
        fundingSigned: z.string().nullable().optional(),
        epcContractSigned: z.string().nullable().optional(),
        costProposalType: z.enum(["link", "na"]).nullable().optional(),
        costProposalLink: z.string().nullable().optional(),
        costProposalNaReason: z.string().nullable().optional(),
        fundingType: z.enum(["link", "na"]).nullable().optional(),
        fundingLink: z.string().nullable().optional(),
        fundingNaReason: z.string().nullable().optional(),
        epcContractType: z.enum(["link", "na"]).nullable().optional(),
        epcContractLink: z.string().nullable().optional(),
        epcContractNaReason: z.string().nullable().optional(),
        currentVoTotal: z.union([z.string(), z.number()]).nullable().optional(),
        comments: z.string().nullable().optional(),
      });
      const parsed = editSchema.parse(req.body);
      const data: Record<string, any> = { projectName };
      for (const [key, value] of Object.entries(parsed)) {
        if (key === 'currentVoTotal') {
          data[key] = value != null ? String(value) : null;
        } else {
          data[key] = value ?? null;
        }
      }
      const result = await storage.upsertProjectEditableFields(data as any);

      logAuditFromReq(req, { entityType: "project_info", action: "update", entityId: projectName, projectName, changesJson: { description: "Project summary fields edited", ...parsed } });
      const project = await storage.getProjectInfo(projectName);
      if (project) {
        const changedFields = Object.keys(parsed)
          .filter((key) => parsed[key as keyof typeof parsed] !== undefined)
          .sort();
        const updatedAtKey = result?.updatedAt ? new Date(result.updatedAt).getTime() : Date.now();
        await createProjectEvent({
          projectId: project.id,
          eventType: "project.summary_updated",
          sourceEntityType: "project_editable_fields",
          sourceEntityId: String(project.id),
          summary: "Project summary fields updated",
          details: { changedFields },
          idempotencyKey: `project-summary:${project.id}:${updatedAtKey}:${changedFields.join(",")}`,
          ...actorFromReq(req),
        });
      }
      res.json(result);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return sendError(res, badRequest(error.issues?.map((issue: any) => issue.message).join("; ") || "Validation failed"));
      }
      logApiError("POST /api/projects-summary/:projectName/edit", error);
      return sendError(res, serverError("Failed to save project fields"));
    }
  });

  app.patch("/api/projects-summary/:projectName/latest-update", requireAuth, requirePermission('projects', 'edit'), async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName as string);
      const schema = z.object({
        latestUpdate: z.string().nullable(),
      });
      const { latestUpdate } = schema.parse(req.body);
      const roleName = (req as any).user?.name || (req as any).user?.role || "Unknown";
      const data: Record<string, any> = {
        projectName,
        latestUpdate: latestUpdate || null,
        latestUpdateAt: latestUpdate ? new Date() : null,
        latestUpdateBy: latestUpdate ? roleName : null,
      };
      const result = await storage.upsertProjectEditableFields(data as any);

      logAuditFromReq(req, { entityType: "project_info", action: "update_comment", entityId: projectName, projectName, changesJson: { description: "Latest update comment changed", latestUpdate } });
      const project = await storage.getProjectInfo(projectName);
      if (project) {
        const updateAt = result?.latestUpdateAt ? new Date(result.latestUpdateAt).getTime() : 0;
        await createProjectEvent({
          projectId: project.id,
          eventType: "project.latest_update_changed",
          sourceEntityType: "project_editable_fields",
          sourceEntityId: String(project.id),
          summary: latestUpdate ? "Latest project update changed" : "Latest project update cleared",
          details: { latestUpdate: latestUpdate || null },
          idempotencyKey: `latest-update:${project.id}:${updateAt}:${latestUpdate || "clear"}`,
          ...actorFromReq(req),
        });
      }
      res.json(result);
    } catch (error) {
      logApiError("PATCH /api/projects-summary/:projectName/latest-update", error);
      return sendError(res, serverError("Failed to save latest update"));
    }
  });

  app.patch("/api/projects-summary/:projectInfoId/escalation", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.projectInfoId as string);
      const schema = z.object({
        escalationLevel: z.enum(["None", "Low", "Medium", "High", "Highest"]).nullable(),
      });
      const { escalationLevel } = schema.parse(req.body);
      const result = await storage.updateProjectInfoById(id, { escalationLevel });

      if (result) {
      }

      logAuditFromReq(req, { entityType: "project_info", action: "escalation_update", entityId: String(id), changesJson: { description: "Escalation level updated", escalationLevel } });
      if (result) {
        const escalationKey = result.updatedAt ? new Date(result.updatedAt).getTime() : Date.now();
        await createProjectEvent({
          projectId: result.id,
          eventType: "project.escalation_changed",
          sourceEntityType: "project_info",
          sourceEntityId: String(result.id),
          summary: `Escalation changed to ${escalationLevel || "None"}`,
          details: { escalationLevel: escalationLevel || null },
          idempotencyKey: `escalation:${result.id}:${escalationKey}:${escalationLevel || "none"}`,
          ...actorFromReq(req),
        });
      }
      res.json(result);
    } catch (error) {
      logApiError("PATCH /api/projects-summary/:projectInfoId/escalation", error);
      return sendError(res, serverError("Failed to update escalation level"));
    }
  });

  // ==================== SINGLE PROJECT BY ID ====================

  app.get("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid project ID", message: "Project ID must be a number" });
      }
      const project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found", message: "Project not found" });
      }
      // Strip internal fields before responding
      const { sourceFile, ...shaped } = project as any;
      res.json(shaped);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project", message: "Failed to fetch project" });
    }
  });

  // ==================== PROJECT INFO / DETAIL MASTER / DIAGNOSTICS / READINESS ====================

  app.get("/api/project-info", requireAuth, async (req, res) => {
    try {
      const usePromotedRead = await getFeatureFlag("promoted_core_projects_read");
      const compareMode = req.query.compare === "1" || req.query.compare === "true";

      const info = usePromotedRead
        ? await listProjectInfoFromPromotedCoreCompat()
        : await storage.getAllProjectInfo();

      if (compareMode || usePromotedRead) {
        const comparison = await compareCoreProjectsReadiness();
        const diagFlag = await getFeatureFlag("migration_bridge_project_read_v1");
        if (diagFlag && comparison.status !== "ready" && shouldEmitParityLogSample("project_reads")) {
          console.warn("[promoted-read][projects] sampled mismatch summary", {
            status: comparison.status,
            mismatchCategories: comparison.mismatchCategories,
            legacyCount: comparison.legacyCount,
            promotedCount: comparison.promotedCount,
            missingInPromotedCount: comparison.missingInPromotedCount,
            extraInPromotedCount: comparison.extraInPromotedCount,
            fieldMismatchCount: comparison.fieldMismatchCount,
          });
        }
        res.setHeader("X-Promoted-Projects-Read", usePromotedRead ? "enabled" : "disabled");
        res.setHeader("X-Promoted-Projects-Comparison-Status", comparison.status);
      }

      res.json(info);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project info", message: "Failed to fetch project info" });
    }
  });

  app.get("/api/project-detail-master", requireAuth, async (req, res) => {
    try {
      const usePromotedRead = await getFeatureFlag("promoted_core_project_detail_read");
      const compareMode = req.query.compare === "1" || req.query.compare === "true";

      const detailRows = usePromotedRead
        ? await listProjectDetailFromPromotedCoreCompat()
        : (await storage.getAllProjectInfo()).map((row: any) => ({
            id: row.id,
            projectName: row.projectName,
            phase: row.phase ?? null,
            ragStatus: row.ragStatus ?? null,
            ragComment: row.ragComment ?? null,
            clientId: row.clientId ?? null,
            clientName: null,
            portfolioMembership: [],
            teamMembers: [],
          }));

      if (compareMode || usePromotedRead) {
        const comparison = await compareProjectDetailMasterReadiness();
        const diagFlag = await getFeatureFlag("migration_bridge_project_read_v1");
        if (diagFlag && comparison.status !== "ready" && shouldEmitParityLogSample("project_detail_reads")) {
          console.warn("[promoted-read][project-detail-master] sampled mismatch summary", {
            status: comparison.status,
            mismatchCategories: comparison.mismatchCategories,
            legacyCount: comparison.legacyCount,
            promotedCount: comparison.promotedCount,
            missingInPromotedCount: comparison.missingInPromotedCount,
            extraInPromotedCount: comparison.extraInPromotedCount,
            fieldMismatchCount: comparison.fieldMismatchCount,
          });
        }
        res.setHeader("X-Promoted-Project-Detail-Read", usePromotedRead ? "enabled" : "disabled");
        res.setHeader("X-Promoted-Project-Detail-Comparison-Status", comparison.status);
      }

      res.json(detailRows);
    } catch (error) {
      console.error("Project detail master fetch error:", error);
      res.status(500).json({ error: "Failed to fetch project detail master" });
    }
  });

  app.get("/api/admin/work-item-summary-diagnostics", requireAuth, requireAdmin, async (req, res) => {
    try {
      const flags = await getFeatureFlags(["promoted_core_work_item_summary_read"]);
      const compareMode = req.query.compare === "1" || req.query.compare === "true";

      if (!flags.promoted_core_work_item_summary_read && !compareMode) {
        return res.status(403).json({
          error: "feature_flag_disabled",
          message: "Work-item summary diagnostics are disabled. Enable promoted_core_work_item_summary_read or use compare mode.",
        });
      }

      const diagnostics = await buildWorkItemSummaryDiagnostics();
      res.setHeader("X-Promoted-Work-Item-Summary-Read", flags.promoted_core_work_item_summary_read ? "enabled" : "disabled");
      res.json(diagnostics);
    } catch (error) {
      console.error("Work-item summary diagnostics error:", error);
      res.status(500).json({ error: "Failed to generate work-item summary diagnostics" });
    }
  });

  app.patch("/api/project-info/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(paramStr(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });

      const editSchema = z.object({
        projectName: z.string().min(1).optional(),
        phase: z.string().nullable().optional(),
        executionPhase: z.string().nullable().optional(),
        pd: z.string().nullable().optional(),
        pm: z.string().nullable().optional(),
        sizeKwp: z.string().nullable().optional(),
        contractValue: z.string().nullable().optional(),
        constructionStartDate: z.string().nullable().optional(),
        commissioningDate: z.string().nullable().optional(),
        omHandoverDate: z.string().nullable().optional(),
        clientHandoverDate: z.string().nullable().optional(),
        pdHandoverDate: z.string().nullable().optional(),
        clientId: z.number().nullable().optional(),
        clientLinkReason: z.string().trim().nullable().optional(),
      });

      const parsed = editSchema.parse(req.body);
      const { clientLinkReason, ...projectInfoPatch } = parsed;
      const existing = await storage.getProjectInfoById(id);
      if (!existing) return res.status(404).json({ error: "Project not found" });

      const sourceOfTruth = classifyProjectInfoPayload(projectInfoPatch as Record<string, unknown>);
      const updated = await storage.updateProjectInfoById(id, projectInfoPatch as any);
      if (!updated) return res.status(404).json({ error: "Project not found" });

      if (
        Object.prototype.hasOwnProperty.call(projectInfoPatch, "clientId")
        && existing.clientId !== updated.clientId
        && req.user?.id
      ) {
        try {
          await db.insert(projectClientHistory).values({
            projectId: updated.id,
            oldClientId: existing.clientId ?? null,
            newClientId: updated.clientId ?? null,
            movedByUserId: req.user.id,
            reason: clientLinkReason || "Project client linkage updated",
          });
        } catch (historyError) {
          console.error("[project-info] failed to record client linkage history", historyError);
        }
      }

      const [projectDualWriteEnabled, importsGovernancePreview] = await Promise.all([
        getFeatureFlag("promoted_core_project_master_dual_write"),
        getFeatureFlag("imports_source_update_governance_preview"),
      ]);

      let projectMirror: { attempted: boolean; success: boolean; error: string | null } = { attempted: false, success: false, error: null };
      if (projectDualWriteEnabled) {
        projectMirror.attempted = true;
        try {
          // Fetch execution state for phase/rag/gate fields (they live in projectExecutionState, not projectInfo)
          const execStateRows = await db.select().from(projectExecutionState)
            .where(eq(projectExecutionState.projectId, updated.id)).limit(1);
          const execState = execStateRows[0] ?? null;
          await db.execute(sql`
            INSERT INTO core.projects (
              id, legacy_project_info_id, project_name, client_id, phase, rag_status, execution_gate_status, execution_gate_reason, updated_at, source_table
            ) VALUES (
              ${updated.id}, ${updated.id}, ${updated.projectName}, ${updated.clientId ?? null}, ${execState?.phase ?? null}, ${execState?.ragStatus ?? null}, ${execState?.executionGateStatus ?? null}, ${execState?.executionGateReason ?? null}, NOW(), 'public.project_info'
            )
            ON CONFLICT (id) DO UPDATE
            SET
              project_name = EXCLUDED.project_name,
              client_id = EXCLUDED.client_id,
              phase = EXCLUDED.phase,
              rag_status = EXCLUDED.rag_status,
              execution_gate_status = EXCLUDED.execution_gate_status,
              execution_gate_reason = EXCLUDED.execution_gate_reason,
              updated_at = NOW()
          `);
          projectMirror.success = true;
        } catch (mirrorError: any) {
          projectMirror.error = mirrorError?.message || "unknown_error";
          console.error("[dual-write][project-master] promoted mirror write failed", { projectId: updated.id, error: mirrorError });
        }
      }

      let importsGovernancePreviewRecord: { attempted: boolean; requestId: number | null; error: string | null } = { attempted: false, requestId: null, error: null };
      if (importsGovernancePreview && sourceOfTruth.requiresSourceUpdateGovernance) {
        importsGovernancePreviewRecord.attempted = true;
        try {
          const governanceInsert = await db.execute(sql`
            INSERT INTO imports.source_update_requests (
              project_id,
              source_system,
              source_artifact_ref,
              requested_by_user_id,
              status,
              notes
            ) VALUES (
              ${updated.id},
              'project_info_update',
              ${`project_info:${updated.id}`},
              ${req.user?.id ?? null},
              'pending',
              ${'Preview hook only: non-blocking source update request created during project master update.'}
            )
            RETURNING id
          `);
          const requestId = Number((governanceInsert as any)?.rows?.[0]?.id ?? (governanceInsert as any)?.[0]?.id ?? 0);
          if (requestId) {
            importsGovernancePreviewRecord.requestId = requestId;
            await db.execute(sql`
              INSERT INTO imports.source_update_acknowledgements (
                source_update_request_id,
                acknowledged_by_user_id,
                acknowledged_role,
                acknowledgement_status,
                comments
              ) VALUES (
                ${requestId},
                ${req.user?.id ?? null},
                ${req.user?.role || 'SYSTEM_PREVIEW'},
                'preview_logged',
                'Preview acknowledgement captured automatically; enforcement disabled.'
              )
              ON CONFLICT DO NOTHING
            `);
          }
        } catch (previewError: any) {
          importsGovernancePreviewRecord.error = previewError?.message || 'unknown_error';
          console.error('[imports-governance][preview] failed to record preview request', previewError);
        }
      }

      logAuditFromReq(req, {
        entityType: "project_info",
        action: "update",
        entityId: String(id),
        projectName: updated.projectName,
        changesJson: {
          description: "Project info updated",
          ...parsed,
          projectMirror,
          importsGovernancePreview: importsGovernancePreviewRecord,
          sourceOfTruth,
        },
      });
      if (projectMirror.attempted) {
        res.setHeader("X-Promoted-Project-Master-Dual-Write", projectMirror.success ? "mirrored" : "mirror_failed");
      }
      res.json({ ...updated, _promotedMirror: projectMirror, _importsGovernancePreview: importsGovernancePreviewRecord });
    } catch (error) {
      console.error("Project info update error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update project info" });
    }
  });

  // ==================== CLIENTS ROUTES ====================


  app.get("/api/readiness/cutover-post-validation", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const [domainRolloutReadiness, cutoverPostValidation] = await Promise.all([
        getDomainRolloutReadinessReport(),
        getCutoverPostValidationReport(),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        domainRolloutReadiness,
        cutoverPostValidation,
      });
    } catch (error) {
      console.error("Cutover post-validation report error:", error);
      res.status(500).json({ error: "Failed to generate cutover post-validation report" });
    }
  });

  app.get("/api/imports/sync-state", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectIdParam = req.query.projectId;
      const projectId = typeof projectIdParam === "string" && projectIdParam.trim().length > 0 ? Number(projectIdParam) : undefined;
      if (projectIdParam !== undefined && (!Number.isFinite(projectId) || (projectId as number) <= 0)) {
        return res.status(400).json({ error: "Invalid projectId query parameter" });
      }

      const rows = await listImportSyncState(projectId);
      res.json({
        generatedAt: new Date().toISOString(),
        rows,
      });
    } catch (error) {
      console.error("Imports sync-state fetch error:", error);
      res.status(500).json({ error: "Failed to fetch imports sync-state" });
    }
  });

  app.get("/api/readiness/core-master-data", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const report = await getCoreMasterDataReadinessReport();
      const [workDiagnostics, importsGovernance, domainRolloutReadiness] = await Promise.all([
        buildWorkItemSummaryDiagnostics(50),
        compareImportsGovernanceReadiness(),
        getDomainRolloutReadinessReport(),
      ]);
      const rolloutFlags = await getFeatureFlags([
        "promoted_core_clients_read",
        "promoted_core_projects_read",
        "promoted_core_portfolios_read",
        "promoted_core_portfolio_assignments_read",
        "promoted_core_project_detail_read",
        "promoted_core_work_item_summary_read",
        "promoted_core_clients_dual_write",
        "promoted_core_project_master_dual_write",
        "imports_source_update_governance_preview",
        "promoted_project_management_read",
        "promoted_project_development_read",
        "promoted_documentation_read",
        "promoted_finance_read",
        "imports_governance_enforcement_preview",
        "promoted_engineering_read",
        "promoted_quality_read",
      ]);
      res.json({
        ...report,
        rolloutFlags,
        writeReadiness: {
          firstCandidates: [
            { domain: "clients", flag: "promoted_core_clients_dual_write", readiness: rolloutFlags.promoted_core_clients_dual_write ? "preview_enabled" : "preview_disabled" },
            { domain: "project_master", flag: "promoted_core_project_master_dual_write", readiness: rolloutFlags.promoted_core_project_master_dual_write ? "preview_enabled" : "preview_disabled" },
          ],
          importsGovernance,
        },
        workItemSummaryDiagnostics: {
          totals: workDiagnostics.totals,
          mismatchCategories: workDiagnostics.mismatchCategories,
          sampleProjectIds: workDiagnostics.sampleProjectIds,
        },
        domainRolloutReadiness,
      });
    } catch (error) {
      console.error("Core master data readiness report error:", error);
      res.status(500).json({ error: "Failed to generate core master data readiness report" });
    }
  });
}

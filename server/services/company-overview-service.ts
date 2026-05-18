/**
 * Company Overview Service
 *
 * Backend aggregation layer for the executive Company Overview dashboard.
 * Queries canonical app data and returns pre-computed datasets for each panel.
 */

import { db } from "../db";
import { eq, and, isNull, ne } from "drizzle-orm";
import {
  projectInfo,
  projectExecutionState,
  opportunities,
  normalizedRevenueLines,
  normalizedCostLines,
  workItems,
  hseIncidents,
  correctiveActions,
  mytoolCompanyPriorities,
  users,
  clientUpdates,
  projectStageRequirements,
  projectStageInstances,
  qcItemInstance,
  qcWarning,
  snags,
  handoverPacks,
  projectEngStages,
  projectEngTasks,
  projectEngDeliverables,
  pendingApprovals,
} from "@shared/schema";
import { PHASES, resolveCanonicalPhase } from "@shared/phases";
import {
  calculateDepartmentScore,
  calculateCompanyScore,
  type DepartmentScore,
} from "@shared/config/kpi-registry";
import { computeQcProgress } from "@shared/quality-governance";
import { evaluateRevenueArStatus, isRevenueSettled } from "../lib/finance/revenue-ar-status";
import { computeMarginPct } from "../lib/finance/margin";
import { effectiveRagBucket } from "@shared/utils/effective-rag";
import { getCosRealisedAmountForNclRow } from "../lib/calculations/financeUtils";
import { getAssignedEvidenceByCostLineIds } from "../lib/finance/qb-allocation-read";

// ── Helpers ──────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getFytdRange(): { fyStart: string; fyEnd: string; today: string } {
  const now = new Date();
  const fyStartYear = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    fyStart: `${fyStartYear}-09-01`,
    fyEnd: `${fyStartYear + 1}-08-31`,
    today: now.toISOString().slice(0, 10),
  };
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
  );
}

const HARD_HIDDEN_KPI_KEYS = new Set<string>([
  // Proxy-target KPIs
  "pd_signed_pipeline_vs_target",
  "fin_revenue_vs_target",
  "fin_cash_collected_vs_target",
  "fin_cos_vs_target",
  "fin_gross_margin_vs_target",
  // Null-model KPIs
  "hse_site_audit_pass_rate",
  "hse_toolbox_compliance",
  "hse_safety_file_completeness",
]);

// ── Main Service ─────────────────────────────────────────────────────

export async function getCompanyOverviewData() {
  const { fyStart, fyEnd, today } = getFytdRange();
  const refreshedAt = new Date().toISOString();

  // ── Parallel data fetches ──────────────────────────────────────────
  const results = await Promise.all([
    db.select().from(projectInfo).where(isNull(projectInfo.deletedAt)),
    db.select().from(projectExecutionState).where(isNull(projectExecutionState.deletedAt)),
    db.select().from(opportunities).where(isNull(opportunities.deletedAt)),
    db.select().from(normalizedRevenueLines).where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))),
    db.select().from(normalizedCostLines).where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))),
    db.select().from(workItems).where(isNull(workItems.deletedAt)),
    db.select().from(hseIncidents),
    db.select().from(correctiveActions),
    db.select().from(mytoolCompanyPriorities).where(
      and(
        ne(mytoolCompanyPriorities.status, "closed"),
      )
    ),
    db.select().from(projectStageRequirements),
    db.select().from(projectStageInstances),
    db.select().from(qcItemInstance),
    db.select().from(qcWarning),
    db.select().from(snags),
    db.select().from(handoverPacks),
    db.select().from(projectEngStages),
    db.select().from(projectEngTasks),
    db.select().from(projectEngDeliverables),
    db.select().from(clientUpdates),
    db.select().from(users),
    db.select().from(pendingApprovals).where(eq(pendingApprovals.status, "pending")),
  ]);
  const allProjects: any[] = results[0];
  const allExecState: any[] = results[1];
  const allOpportunities: any[] = results[2];
  const revenueRows: any[] = results[3];
  const costRows: any[] = results[4];
  const allWorkItems: any[] = results[5];
  const incidents: any[] = results[6];
  const correctiveActionRows: any[] = results[7];
  const priorities: any[] = results[8];
  const stageRequirements: any[] = results[9];
  const stageInstances: any[] = results[10];
  const qcItems: any[] = results[11];
  const qcWarnings: any[] = results[12];
  const snagRows: any[] = results[13];
  const handoverPackRows: any[] = results[14];
  const engStages: any[] = results[15];
  const engTasks: any[] = results[16];
  const engDeliverables: any[] = results[17];
  const clientUpdateRows: any[] = results[18];
  const allUsers: any[] = results[19];
  const pendingApprovalRows: any[] = results[20];

  // ── Build lookup maps ──────────────────────────────────────────────
  const execByProjectId = new Map(allExecState.map((e) => [e.projectId, e]));
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));

  // Active projects = have execution state and not archived
  const activeProjects = allProjects.filter((p) => {
    const exec = execByProjectId.get(p.id);
    return exec && exec.archivedStatus === "ACTIVE";
  });

  const activeProjectIds = new Set(activeProjects.map((p) => p.id));
  const assignedByCostLineId = await getAssignedEvidenceByCostLineIds(costRows.map((r: any) => r.id));

  // ── Finance FYTD aggregation ───────────────────────────────────────
  // Four distinct concepts (never blended):
  //   1. Cash received — money received from clients (driven by payment date / in-bank)
  //   2. Cash paid — money paid to suppliers (driven by payment date / out-of-bank)
  //   3. COS realised — invoice captured under actuals (canonical invoice-only rule)
  //   4. Revenue realised — COS-ratio allocation from COS-realised lines only
  const isInFy = (d: string | null | undefined) =>
    !!(d && /^\d{4}-\d{2}-\d{2}/.test(d) && d >= fyStart && d <= fyEnd);

  let totalRevenueFytd = 0;
  let cashReceivedFytd = 0;
  let totalCostFytd = 0;
  let cashPaidFytd = 0;
  let realisedCostFytd = 0;

  // Revenue / cash received aggregation
  // Two distinct FY-window questions per § 3.4:
  //   • Revenue recognition window: any available date (paid → in-bank →
  //     expected → invoice fallback). Measures invoiced/captured revenue.
  //   • Cash window: paidDate / inBankDate ONLY. No fallback to invoice/
  //     expected dates — those are not cash events.
  for (const row of revenueRows) {
    if (!activeProjectIds.has(row.projectId)) continue;
    const amount = toNum(row.amountExVat);

    const recognitionDate =
      (row as any).paidDate ||
      (row as any).inBankDate ||
      (row as any).expectedPaymentDate ||
      (row as any).invoiceDate;
    if (isInFy(recognitionDate)) {
      totalRevenueFytd += amount;
    }

    const cashDate = (row as any).paidDate || (row as any).inBankDate;
    if (
      isInFy(cashDate) &&
      isRevenueSettled({
        status: (row as any).status,
        paidDate: (row as any).paidDate,
        inBankDate: (row as any).inBankDate,
        paidDateConfirmed: (row as any).paidDateConfirmed,
        paidDateFontColor: (row as any).paidDateFontColor,
      })
    ) {
      cashReceivedFytd += amount;
    }
  }

  // Cost / cash paid / COS realised aggregation
  // Also build per-project totals for COS-ratio revenue allocation
  const projectTotalCos = new Map<number, number>();
  const projectTotalRev = new Map<number, number>();
  const projectRealisedCos = new Map<number, number>();

  for (const row of costRows) {
    if (!activeProjectIds.has(row.projectId)) continue;
    const amount = toNum(row.amountExVat);

    // Project-level COS totals (all time) for ratio denominator
    projectTotalCos.set(row.projectId, (projectTotalCos.get(row.projectId) || 0) + amount);

    // Cost recognition FY-window: paid → invoice → approved fallback
    const recognitionDate =
      (row as any).paidDate || (row as any).invoiceDate || (row as any).approvedDate;
    if (isInFy(recognitionDate)) {
      totalCostFytd += amount;
      const realised = getCosRealisedAmountForNclRow(
        row as any,
        assignedByCostLineId.get(row.id) ?? null,
      );
      if (realised > 0) {
        realisedCostFytd += realised;
        projectRealisedCos.set(row.projectId, (projectRealisedCos.get(row.projectId) || 0) + realised);
      }
    }

    // Cash paid FY-window: paidDate ONLY per § 3.4. No fallback.
    const paidDate = (row as any).paidDate;
    if (paidDate && isInFy(paidDate)) {
      cashPaidFytd += amount;
    }
  }

  // Build project-level revenue totals for COS-ratio allocation
  for (const row of revenueRows) {
    if (!activeProjectIds.has(row.projectId)) continue;
    const amount = toNum(row.amountExVat);
    projectTotalRev.set(row.projectId, (projectTotalRev.get(row.projectId) || 0) + amount);
  }

  // Revenue realised = COS-ratio allocation from COS-realised cost lines
  let realisedRevenueFytd = 0;
  for (const [projId, realisedCos] of projectRealisedCos) {
    const totalCos = projectTotalCos.get(projId) || 0;
    const totalRev = projectTotalRev.get(projId) || 0;
    if (totalCos > 0) {
      realisedRevenueFytd += (realisedCos / totalCos) * totalRev;
    }
  }

  // Realised GP uses realised revenue and realised COS (not cash concepts)
  const realisedGrossMarginPct = computeMarginPct(realisedRevenueFytd, realisedCostFytd, { precision: 1, zeroRevenueValue: 0 }) ?? 0;
  // Total-line GP (all revenue lines vs all cost lines in FY)
  const grossMarginPct = computeMarginPct(totalRevenueFytd, totalCostFytd, { precision: 1, zeroRevenueValue: 0 }) ?? 0;

  // ── Portfolio delivery stats ───────────────────────────────────────
  let onTrack = 0, atRisk = 0, offTrack = 0;
  for (const p of activeProjects) {
    const exec = execByProjectId.get(p.id);
    if (!exec) continue;
    // Apply the canonical effective-RAG rule so projects in DLP are counted
    // as off-track even if their stored rag_status is still green/amber.
    const rag = effectiveRagBucket({
      ragStatus: exec.ragStatus,
      inDlp: (p as any).inDlp ?? false,
    });
    if (rag === "green") onTrack++;
    else if (rag === "amber") atRisk++;
    else offTrack++;
  }

  // ── Phase distribution (canonical phases) ─────────────────────────
  const phaseDistribution: Array<{ code: string; label: string; count: number }> = [];
  const phaseCounts = new Map<string, number>();
  let unmatchedPhaseCount = 0;
  for (const p of activeProjects) {
    const exec = execByProjectId.get(p.id);
    const rawPhase = exec?.currentStageCode || exec?.phase || null;
    const resolved = resolveCanonicalPhase(rawPhase);
    if (resolved) {
      phaseCounts.set(resolved.code, (phaseCounts.get(resolved.code) || 0) + 1);
    } else {
      unmatchedPhaseCount++;
    }
  }
  for (const phase of PHASES) {
    const count = phaseCounts.get(phase.code) || 0;
    if (count > 0) {
      phaseDistribution.push({ code: phase.code, label: phase.label, count });
    }
  }
  if (unmatchedPhaseCount > 0) {
    phaseDistribution.push({ code: "unknown", label: "Unassigned", count: unmatchedPhaseCount });
  }

  // ── Schedule health (avg actual % vs expected %) ────────────────
  const activeWorkItems = allWorkItems.filter((wi) => {
    if (!activeProjectIds.has(wi.projectId!)) return false;
    const status = String(wi.status || "").toLowerCase();
    return !["complete", "completed", "done", "cancelled"].includes(status);
  });
  let totalActualPct = 0, totalExpectedPct = 0, scheduleItemCount = 0;
  for (const wi of activeWorkItems) {
    const actual = Number(wi.percentComplete);
    const expected = Number(wi.expectedPctComplete);
    if (Number.isFinite(actual) && Number.isFinite(expected) && expected > 0) {
      totalActualPct += actual;
      totalExpectedPct += expected;
      scheduleItemCount++;
    }
  }
  const avgActualPct = scheduleItemCount > 0 ? Math.round((totalActualPct / scheduleItemCount) * 10) / 10 : null;
  const avgExpectedPct = scheduleItemCount > 0 ? Math.round((totalExpectedPct / scheduleItemCount) * 10) / 10 : null;
  const scheduleDelta = avgActualPct != null && avgExpectedPct != null ? Math.round((avgActualPct - avgExpectedPct) * 10) / 10 : null;

  // Blocked gates
  const blockedGates = stageRequirements.filter(
    (r) => r.blocksGate && r.status !== "complete" && r.status !== "approved"
  );

  // Upcoming milestones (next 14 days)
  const in14Days = new Date();
  in14Days.setDate(in14Days.getDate() + 14);
  const in14DaysStr = in14Days.toISOString().slice(0, 10);

  const upcomingMilestones = allWorkItems.filter((wi) => {
    if (!activeProjectIds.has(wi.projectId!)) return false;
    if (!wi.isMilestone) return false;
    const due = (wi as any).endDate || (wi as any).dueDate;
    return due && due >= today && due <= in14DaysStr;
  });

  // Practical completion due this month
  const monthEnd = new Date();
  monthEnd.setMonth(monthEnd.getMonth() + 1, 0);
  const monthEndStr = monthEnd.toISOString().slice(0, 10);
  const monthStartStr = `${today.slice(0, 7)}-01`;

  const practicalCompletionDue = activeProjects.filter((p) => {
    const exec = execByProjectId.get(p.id);
    const target = exec?.practicalCompletionTarget;
    return target && target >= monthStartStr && target <= monthEndStr;
  });

  // Handovers due this month
  const handoversDue = activeProjects.filter((p) => {
    const exec = execByProjectId.get(p.id);
    const target = exec?.clientHandoverDate;
    return target && target >= monthStartStr && target <= monthEndStr;
  });

  // ── Overdue work items ─────────────────────────────────────────────
  const overdueItems = allWorkItems.filter((wi) => {
    if (!activeProjectIds.has(wi.projectId!)) return false;
    const due = (wi as any).endDate || (wi as any).dueDate;
    if (!due || due >= today) return false;
    const status = String(wi.status || "").toLowerCase();
    return !["complete", "completed", "done", "cancelled"].includes(status);
  });

  // Missing updates (projects with no client update in last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  const projectsWithRecentUpdate = new Set<number>();
  for (const cu of clientUpdateRows) {
    if ((cu as any).createdAt && new Date((cu as any).createdAt).toISOString().slice(0, 10) >= sevenDaysAgoStr) {
      projectsWithRecentUpdate.add(cu.projectId);
    }
  }

  const missingUpdateProjects = activeProjects.filter(
    (p) => !projectsWithRecentUpdate.has(p.id)
  );

  // ── Department KPI values ──────────────────────────────────────────

  // --- Project Development ---
  const signedDeals = allOpportunities.filter((o) => o.signedDate && isInFy(o.signedDate));
  const signedPipelineValue = signedDeals.reduce((sum, o) => sum + toNum(o.estimatedValue), 0);
  const wonDeals = allOpportunities.filter((o) => o.status === "won");
  const qualifiedDeals = allOpportunities.filter(
    (o) => o.stage && !["prospect"].includes(o.stage)
  );
  const conversionRate = qualifiedDeals.length > 0
    ? (wonDeals.length / qualifiedDeals.length) * 100
    : 0;

  const activePreSigDeals = allOpportunities.filter(
    (o) => o.status === "active" && !o.signedDate
  );
  const avgDealAgeing = activePreSigDeals.length > 0
    ? activePreSigDeals.reduce((sum, o) => {
        const created = o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : today;
        return sum + daysBetween(created, today);
      }, 0) / activePreSigDeals.length
    : 0;

  const blockedDeals = allOpportunities.filter(
    (o) => o.status === "active" && o.commercialRisks && o.commercialRisks.trim().length > 0
  );

  const readyHandovers = allOpportunities.filter(
    (o) => o.handoverReadiness === "ready" || o.handoverReadiness === "submitted" || o.handoverReadiness === "accepted"
  );
  const totalHandoverEligible = allOpportunities.filter(
    (o) => o.status === "won" || o.handoverReadiness !== "not_ready"
  );
  const handoverCompleteness = totalHandoverEligible.length > 0
    ? (readyHandovers.length / totalHandoverEligible.length) * 100
    : 0;

  const pdKpis = new Map<string, { actual: number | null; target?: number | null; trend?: "up" | "down" | "flat" }>([
    ["pd_signed_pipeline_vs_target", { actual: signedPipelineValue, target: signedPipelineValue * 1.2 }], // placeholder target
    ["pd_deal_conversion_rate", { actual: conversionRate }],
    ["pd_active_deal_ageing", { actual: Math.round(avgDealAgeing) }],
    ["pd_blocked_deal_count", { actual: blockedDeals.length }],
    ["pd_handover_completeness", { actual: handoverCompleteness }],
  ]);

  // --- Project Delivery ---
  const projectsOnTrackPct = activeProjects.length > 0
    ? (onTrack / activeProjects.length) * 100
    : 0;

  // Inflow milestone adherence
  const inflowMilestones = allWorkItems.filter((wi) => {
    if (!activeProjectIds.has(wi.projectId!)) return false;
    return wi.isMilestone && ((wi as any).phase || "").toLowerCase().includes("inflow");
  });
  const inflowOnTime = inflowMilestones.filter((wi) => {
    const due = (wi as any).baselineEnd || (wi as any).endDate;
    const actual = (wi as any).actualEnd;
    if (!due) return true;
    if (!actual) return new Date(due) >= new Date(today);
    return actual <= due;
  });
  const inflowAdherence = inflowMilestones.length > 0
    ? (inflowOnTime.length / inflowMilestones.length) * 100
    : 100;

  // Practical completion on time
  const pcProjects = activeProjects.filter((p) => {
    const exec = execByProjectId.get(p.id);
    return exec?.practicalCompletionActual;
  });
  const pcOnTime = pcProjects.filter((p) => {
    const exec = execByProjectId.get(p.id)!;
    return exec.practicalCompletionActual! <= (exec.practicalCompletionTarget || "9999-12-31");
  });
  const pcOnTimePct = pcProjects.length > 0
    ? (pcOnTime.length / pcProjects.length) * 100
    : 100;

  // Weekly client update compliance
  const clientUpdateCompliance = activeProjects.length > 0
    ? (projectsWithRecentUpdate.size / activeProjects.length) * 100
    : 100;

  const delKpis = new Map<string, { actual: number | null; target?: number | null }>([
    ["del_projects_on_track", { actual: projectsOnTrackPct }],
    ["del_inflow_milestone_adherence", { actual: inflowAdherence }],
    ["del_blocked_gates", { actual: blockedGates.length }],
    ["del_practical_completion_on_time", { actual: pcOnTimePct }],
    ["del_weekly_client_update_compliance", { actual: clientUpdateCompliance }],
  ]);

  // --- Engineering ---
  const overdueEngTasks = engTasks.filter((t) => {
    if (!t.dueDate || t.status === "complete" || t.status === "cancelled") return false;
    return t.dueDate < today;
  });

  // Design turnaround (avg days from created to completed for eng stages)
  const completedWithDates = engStages.filter(
    (s) => s.status === "complete" && s.startedAt && s.completedAt
  );
  const avgTurnaround = completedWithDates.length > 0
    ? completedWithDates.reduce((sum, s) => {
        return sum + daysBetween(
          new Date(s.startedAt!).toISOString().slice(0, 10),
          new Date(s.completedAt!).toISOString().slice(0, 10)
        );
      }, 0) / completedWithDates.length
    : 0;

  // First-pass approval rate
  const approvedDeliverables = engDeliverables.filter(
    (d) => d.approvalStatus === "approved"
  );
  const rejectedDeliverables = engDeliverables.filter(
    (d) => d.approvalStatus === "rejected"
  );
  const totalReviewed = approvedDeliverables.length + rejectedDeliverables.length;
  const firstPassRate = totalReviewed > 0
    ? (approvedDeliverables.length / totalReviewed) * 100
    : 100;

  // Deliverable completeness
  const totalEngDeliverables = engDeliverables.length;
  const completeEngDeliverables = engDeliverables.filter(
    (d) => d.approvalStatus === "approved"
  ).length;
  const deliverableCompleteness = totalEngDeliverables > 0
    ? (completeEngDeliverables / totalEngDeliverables) * 100
    : 0;

  // Rework rate (rejected / total reviewed)
  const reworkRate = totalReviewed > 0
    ? (rejectedDeliverables.length / totalReviewed) * 100
    : 0;

  const engKpis = new Map<string, { actual: number | null; target?: number | null }>([
    ["eng_design_turnaround", { actual: Math.round(avgTurnaround) }],
    ["eng_first_pass_approval", { actual: firstPassRate }],
    ["eng_overdue_tasks", { actual: overdueEngTasks.length }],
    ["eng_rework_rate", { actual: reworkRate }],
    ["eng_deliverable_completeness", { actual: deliverableCompleteness }],
  ]);

  // --- HSE ---
  const seriousIncidents = incidents.filter((i) => {
    const sev = (i.severity || "").toLowerCase();
    const type = (i.incidentType || "").toLowerCase();
    return sev === "critical" || sev === "high" || type === "lost_time" || type === "fatality";
  });

  const overdueCorrectiveActions = correctiveActionRows.filter((ca) => {
    if (ca.status === "closed" || ca.status === "verified") return false;
    return ca.completionDate && ca.completionDate < today;
  });

  // HSE data availability check
  const hseDataAvailable = incidents.length > 0 || correctiveActionRows.length > 0;

  const hseKpis = new Map<string, { actual: number | null; target?: number | null }>([
    ["hse_serious_incident_count", { actual: seriousIncidents.length }],
    ["hse_overdue_corrective_actions", { actual: overdueCorrectiveActions.length }],
    ["hse_site_audit_pass_rate", { actual: hseDataAvailable ? null : null }], // No audit model yet
    ["hse_toolbox_compliance", { actual: null }], // No toolbox model yet
    ["hse_safety_file_completeness", { actual: null }], // No safety file model yet
  ]);

  // --- Quality ---
  const qcProgressResult = computeQcProgress(qcItems as any[]);
  const qualityPassRate = qcProgressResult.progressPercent;

  // Snag closeout ageing
  const openSnags = snagRows.filter(
    (s) => s.status !== "closed" && s.status !== "verified"
  );
  const avgSnagAge = openSnags.length > 0
    ? openSnags.reduce((sum, s) => {
        const created = s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : today;
        return sum + daysBetween(created, today);
      }, 0) / openSnags.length
    : 0;

  // HO pack pass rate
  const reviewedHoPacks = handoverPackRows.filter(
    (h) => h.checklistStatus === "approved" || h.checklistStatus === "rejected"
  );
  const approvedHoPacks = handoverPackRows.filter(
    (h) => h.checklistStatus === "approved"
  );
  const hoPackPassRate = reviewedHoPacks.length > 0
    ? (approvedHoPacks.length / reviewedHoPacks.length) * 100
    : 100;

  // Phase evidence completeness
  const evidenceComplete = stageRequirements.filter(
    (r) => r.status === "complete" || r.status === "approved"
  );
  const phaseEvidenceCompleteness = stageRequirements.length > 0
    ? (evidenceComplete.length / stageRequirements.length) * 100
    : 0;

  // Repeat defect rate — heuristic: % of (projectId, warningType) pairs
  // that have a resolved warning AND another open or resolved warning of
  // the same shape later. The auto-resolve flow in `recalculateWarnings`
  // closes a warning when its underlying condition clears, so a second
  // occurrence is a true re-firing of the defect.
  const totalProjectTypeKeys = new Set<string>();
  const repeatProjectTypeKeys = new Set<string>();
  const firstSeenByKey = new Map<string, number>();
  const sortedWarnings = [...qcWarnings].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return at - bt;
  });
  for (const w of sortedWarnings) {
    if (w.projectId == null || !w.warningType) continue;
    const key = `${w.projectId}:${w.warningType}`;
    totalProjectTypeKeys.add(key);
    const ts = w.createdAt ? new Date(w.createdAt).getTime() : 0;
    const prev = firstSeenByKey.get(key);
    if (prev != null && ts > prev) {
      repeatProjectTypeKeys.add(key);
    } else {
      firstSeenByKey.set(key, ts);
    }
  }
  const repeatDefectRate = totalProjectTypeKeys.size > 0
    ? (repeatProjectTypeKeys.size / totalProjectTypeKeys.size) * 100
    : 0;

  const qualKpis = new Map<string, { actual: number | null; target?: number | null }>([
    ["qual_red_team_pass_rate", { actual: qualityPassRate }],
    ["qual_snag_closeout_ageing", { actual: Math.round(avgSnagAge) }],
    ["qual_ho_pack_pass_rate", { actual: hoPackPassRate }],
    ["qual_phase_evidence_completeness", { actual: phaseEvidenceCompleteness }],
    ["qual_repeat_defect_rate", { actual: repeatDefectRate }],
  ]);

  // --- Finance ---
  // Total all-time planned (used as the "annual" denominator for legacy
  // tile fields). Kept for backwards compatibility with other parts of
  // the response payload — not used for KPI vs-target calculations.
  const totalPlannedRevenue = revenueRows
    .filter((r) => activeProjectIds.has(r.projectId))
    .reduce((sum, r) => sum + toNum(r.amountExVat), 0);

  const totalPlannedCost = costRows
    .filter((r) => activeProjectIds.has(r.projectId))
    .reduce((sum, r) => sum + toNum(r.amountExVat), 0);

  // FYTD-anchored targets per T1.x audit Surprise 3.
  // Previous behaviour: targets were the all-time totalPlanned values
  // multiplied by a magic constant (0.75 for revenue/COS, 0.7 for cash).
  // Same denominator regardless of whether it was September (FY start)
  // or August (FY end), so "vs target" was too easy late and too hard
  // early.
  //
  // New behaviour: target = sum of plan-dated lines whose plan date
  // falls in [fyStart, today]. Anchored to captured forecasts, not a
  // multiplier on annual.
  //
  // Date columns:
  //   • Revenue / Cash collected: expectedPaymentDate (the captured
  //     plan-date for cash receipt).
  //   • COS: invoiceDate when set (recognition has occurred), else
  //     forecastPaymentDate as a forward-looking proxy.
  const isInFytdToToday = (d: string | null | undefined): boolean =>
    !!(d && /^\d{4}-\d{2}-\d{2}/.test(d) && d >= fyStart && d <= today);

  const revenuePlannedFytd = revenueRows
    .filter((r) =>
      activeProjectIds.has(r.projectId) &&
      isInFytdToToday((r as any).expectedPaymentDate),
    )
    .reduce((sum, r) => sum + toNum(r.amountExVat), 0);

  const costPlannedFytd = costRows
    .filter((r) => {
      if (!activeProjectIds.has(r.projectId)) return false;
      const planDate =
        (r as any).invoiceDate || (r as any).forecastPaymentDate;
      return isInFytdToToday(planDate);
    })
    .reduce((sum, r) => sum + toNum(r.amountExVat), 0);

  // Overdue debtors (revenue expected but not received, past date)
  const overdueDebtors = revenueRows.filter((r) => {
    if (!activeProjectIds.has(r.projectId)) return false;
    return evaluateRevenueArStatus({
      status: (r as any).status,
      paidDate: (r as any).paidDate,
      inBankDate: (r as any).inBankDate,
      paidDateConfirmed: (r as any).paidDateConfirmed,
      paidDateFontColor: (r as any).paidDateFontColor,
      dueDate: (r as any).expectedPaymentDate,
      invoiceNumber: (r as any).invoiceNumber,
      amount: (r as any).amountExVat,
      today,
    }).isOverdue;
  });
  const overdueDebtorValue = overdueDebtors.reduce(
    (sum, r) => sum + toNum(r.amountExVat), 0
  );

  const targetMarginPct = 20; // Target margin placeholder

  const costRowsMissingLineage = costRows.filter((r) =>
    activeProjectIds.has(r.projectId) &&
    !r.effectiveTo &&
    (!r.sourceSheet || r.sourceRow == null)
  ).length;
  const revenueRowsMissingLineage = revenueRows.filter((r) =>
    activeProjectIds.has(r.projectId) &&
    !r.effectiveTo &&
    (!r.sourceSheet || r.sourceRow == null)
  ).length;
  const invoiceWithoutPoCount = costRows.filter((r) =>
    activeProjectIds.has(r.projectId) &&
    !r.effectiveTo &&
    !!(r.invoiceNumber && String(r.invoiceNumber).trim()) &&
    !(r.poNumber && String(r.poNumber).trim())
  ).length;
  // Suspicious NULLs: a finance line has an invoice but no amount (silently
  // coalesced to 0). Reported on the API response so the client can render a
  // "(N missing)" sublabel on impacted KPI cards.
  const nullAmountWithInvoice = (r: any): boolean => {
    const rawAmt = r?.amountExVat;
    const hasAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(parseFloat(String(rawAmt)));
    const hasInvoice = !!(r?.invoiceNumber && String(r.invoiceNumber).trim());
    return !hasAmt && hasInvoice;
  };
  const companyOverviewNullCount =
    costRows.filter((r) => activeProjectIds.has(r.projectId) && !r.effectiveTo && nullAmountWithInvoice(r)).length +
    revenueRows.filter((r) => activeProjectIds.has(r.projectId) && !r.effectiveTo && nullAmountWithInvoice(r)).length;

  const finKpis = new Map<string, { actual: number | null; target?: number | null }>([
    ["fin_revenue_vs_target", { actual: realisedRevenueFytd, target: revenuePlannedFytd }], // Revenue realised (COS-ratio) vs FYTD-anchored plan
    ["fin_cash_collected_vs_target", { actual: cashReceivedFytd, target: revenuePlannedFytd }], // Cash received vs FYTD-anchored plan
    ["fin_cos_vs_target", { actual: realisedCostFytd, target: costPlannedFytd }], // COS realised (invoice-based) vs FYTD-anchored plan
    ["fin_gross_margin_vs_target", { actual: realisedGrossMarginPct, target: targetMarginPct }], // Realised GP%
    ["fin_overdue_debtors", { actual: overdueDebtorValue }],
  ]);

  // ── Calculate department scores ────────────────────────────────────
  const departmentScores: DepartmentScore[] = [
    calculateDepartmentScore("Project Development", pdKpis),
    calculateDepartmentScore("Project Delivery", delKpis),
    calculateDepartmentScore("Engineering", engKpis),
    calculateDepartmentScore("HSE", hseKpis),
    calculateDepartmentScore("Quality", qualKpis),
    calculateDepartmentScore("Finance", finKpis),
  ];

  const companyScore = calculateCompanyScore(departmentScores);
  const visibleDepartmentScores = departmentScores.map((ds) => ({
    ...ds,
    kpis: ds.kpis.filter((k) => !HARD_HIDDEN_KPI_KEYS.has(k.kpiKey)),
  }));

  // ── Executive exceptions ───────────────────────────────────────────
  type Exception = {
    title: string;
    severity: "critical" | "high" | "medium";
    department: string;
    project: string | null;
    owner: string | null;
    age: number;
    dueDate: string | null;
    status: string;
  };

  const exceptions: Exception[] = [];

  // Blocked gates
  for (const bg of blockedGates.slice(0, 20)) {
    const inst = stageInstances.find((si) => si.id === bg.stageInstanceId);
    const proj = inst ? projectMap.get(inst.projectId) : null;
    exceptions.push({
      title: `Blocked gate: ${bg.itemCode || "Unknown"}`,
      severity: "critical",
      department: bg.department || "Unknown",
      project: proj?.projectName || null,
      owner: null,
      age: bg.updatedAt ? daysBetween(new Date(bg.updatedAt).toISOString().slice(0, 10), today) : 0,
      dueDate: null,
      status: String(bg.status),
    });
  }

  // Overdue items (top 10)
  for (const wi of overdueItems.slice(0, 10)) {
    const proj = projectMap.get(wi.projectId!);
    const ownerUser = wi.ownerUserId ? userMap.get(wi.ownerUserId) : null;
    const due = (wi as any).endDate || (wi as any).dueDate;
    exceptions.push({
      title: `Overdue: ${wi.title || "Task"}`,
      severity: daysBetween(due, today) > 14 ? "critical" : "high",
      department: wi.workstream || "Unknown",
      project: proj?.projectName || null,
      owner: ownerUser?.name || null,
      age: daysBetween(due, today),
      dueDate: due,
      status: String(wi.status),
    });
  }

  // Missing updates
  for (const p of missingUpdateProjects.slice(0, 5)) {
    exceptions.push({
      title: `Missing weekly update`,
      severity: "medium",
      department: "Project Delivery",
      project: p.projectName,
      owner: p.pm || null,
      age: 7,
      dueDate: null,
      status: "missing",
    });
  }

  // Sort exceptions: severity -> age desc
  const severityOrder = { critical: 0, high: 1, medium: 2 };
  exceptions.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.age - a.age;
  });

  // ── Company Priorities ─────────────────────────────────────────────
  const priorityData = priorities
    .sort((a, b) => {
      // Overdue first
      const aOverdue = a.targetStartDate && a.targetStartDate < today ? -1 : 0;
      const bOverdue = b.targetStartDate && b.targetStartDate < today ? -1 : 0;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      return (a.priorityRank ?? 999) - (b.priorityRank ?? 999);
    })
    .slice(0, 7)
    .map((p) => {
      const owner = p.ownerUserId ? userMap.get(p.ownerUserId) : null;
      return {
        id: p.id,
        title: p.title,
        department: p.department,
        owner: owner?.name || null,
        dueDate: p.targetStartDate,
        status: p.status,
        severity: p.severity,
        health: p.manualHealth,
        progress: p.manualProgress,
      };
    });

  // ── Recent Signals (last 7 days) ──────────────────────────────────
  type Signal = {
    type: string;
    title: string;
    project: string | null;
    date: string;
    department: string | null;
  };

  const signals: Signal[] = [];

  // Newly blocked gates (recent)
  for (const bg of blockedGates.slice(0, 5)) {
    const updatedDate = bg.updatedAt ? new Date(bg.updatedAt).toISOString().slice(0, 10) : null;
    if (updatedDate && updatedDate >= sevenDaysAgoStr) {
      const inst = stageInstances.find((si) => si.id === bg.stageInstanceId);
      const proj = inst ? projectMap.get(inst.projectId) : null;
      signals.push({
        type: "blocked_gate",
        title: `Gate blocked: ${bg.itemCode || "Unknown"}`,
        project: proj?.projectName || null,
        date: updatedDate,
        department: bg.department || null,
      });
    }
  }

  // Overdue actions (new this week)
  for (const ca of correctiveActionRows.filter(
    (ca) => ca.status !== "closed" && ca.status !== "verified" && ca.completionDate && ca.completionDate < today && ca.completionDate >= sevenDaysAgoStr
  ).slice(0, 5)) {
    signals.push({
      type: "overdue_action",
      title: `Overdue corrective action: ${ca.title || "CA"}`,
      project: null,
      date: ca.completionDate!,
      department: "HSE",
    });
  }

  // Missing updates
  for (const p of missingUpdateProjects.slice(0, 3)) {
    signals.push({
      type: "missing_update",
      title: `No client update in 7+ days`,
      project: p.projectName,
      date: today,
      department: "Project Delivery",
    });
  }

  signals.sort((a, b) => b.date.localeCompare(a.date));

  // ── Build response ─────────────────────────────────────────────────
  const confidenceIssues = invoiceWithoutPoCount + costRowsMissingLineage + revenueRowsMissingLineage + companyOverviewNullCount;
  const dataConfidence = confidenceIssues === 0 ? "high" : confidenceIssues <= 5 ? "medium" : "low";
  const trustedTopStrip = {
    activeProjects: activeProjects.length,
    blockedGates: blockedGates.length,
    overdueItems: overdueItems.length,
    missingUpdates: missingUpdateProjects.length,
  };
  const drilldownReconciliation = [
    { metricKey: "activeProjects", label: "Active Projects", drilldownPath: "/gates", summaryValue: trustedTopStrip.activeProjects, drilldownValue: activeProjects.length, match: trustedTopStrip.activeProjects === activeProjects.length },
    { metricKey: "blockedGates", label: "Blocked Gates", drilldownPath: "/gates/blocked", summaryValue: trustedTopStrip.blockedGates, drilldownValue: blockedGates.length, match: trustedTopStrip.blockedGates === blockedGates.length },
    { metricKey: "overdueItems", label: "Overdue Items", drilldownPath: "/gates/exceptions", summaryValue: trustedTopStrip.overdueItems, drilldownValue: overdueItems.length, match: trustedTopStrip.overdueItems === overdueItems.length },
    { metricKey: "missingUpdates", label: "Missing Weekly Updates", drilldownPath: "/gates/client-updates", summaryValue: trustedTopStrip.missingUpdates, drilldownValue: missingUpdateProjects.length, match: trustedTopStrip.missingUpdates === missingUpdateProjects.length },
  ];

  return {
    meta: {
      fyStart,
      fyEnd,
      today,
      refreshedAt,
      lastUpdated: refreshedAt,
      period: "FYTD",
      dataConfidence,
      hiddenKpiKeys: Array.from(HARD_HIDDEN_KPI_KEYS),
      financeTrust: {
        sourceLayer: {
          canonical: ["normalized_revenue_lines", "normalized_cost_lines"],
          derived: ["finance_cos_monthly", "finance_revenue_monthly"],
          cache: ["database_storage_expense_cache_30s_compat"],
        },
        label: costRowsMissingLineage + revenueRowsMissingLineage > 0 ? "partial_lineage" : "lineage_verified",
        uncertainty: costRowsMissingLineage + revenueRowsMissingLineage > 0
          ? "Some active finance rows are missing source_sheet/source_row lineage metadata."
          : null,
      },
      metricRegister: [
        { label: "Active Projects", formula: "COUNT(project_info where execution state ACTIVE)", source: "project_info + project_execution_state", owner: "PMO", timeBasis: "as-of now", thresholds: "none", drilldownTarget: "/gates", trustStatus: "trusted", visible: true },
        { label: "Blocked Gates", formula: "COUNT(project_stage_requirements where blocksGate=true and status not complete/approved)", source: "project_stage_requirements", owner: "Project Delivery", timeBasis: "as-of now", thresholds: ">0 needs action", drilldownTarget: "/gates/blocked", trustStatus: "trusted", visible: true },
        { label: "Overdue Items", formula: "COUNT(work_items due < today and not completed)", source: "work_items", owner: "Project Delivery", timeBasis: "daily", thresholds: ">0 needs action", drilldownTarget: "/gates/exceptions", trustStatus: "trusted", visible: true },
        { label: "Missing Weekly Updates", formula: "COUNT(active projects with no client update in last 7 days)", source: "client_updates + project_info", owner: "Project Delivery", timeBasis: "rolling 7 days", thresholds: ">0 needs action", drilldownTarget: "/gates/client-updates", trustStatus: "trusted", visible: true },
      ],
    },
    trustedTopStrip: {
      ...trustedTopStrip,
      pendingApprovals: pendingApprovalRows.length,
    },
    drilldownReconciliation,
    companyScore,
    departmentScores: visibleDepartmentScores,
    executiveSummary: {
      companyHealthScore: companyScore.score,
      companyHealthRag: companyScore.rag,
      revenueVsTarget: {
        actual: realisedRevenueFytd,
        cashReceived: cashReceivedFytd,
        target: totalPlannedRevenue,
        pct: totalPlannedRevenue > 0 ? Math.round((realisedRevenueFytd / totalPlannedRevenue) * 100) : 0,
        grossMarginPct: Math.round(grossMarginPct * 10) / 10,
      },
      portfolioHealth: {
        total: activeProjects.length,
        onTrack,
        atRisk,
        offTrack,
        pct: activeProjects.length > 0 ? Math.round((onTrack / activeProjects.length) * 100) : 0,
      },
      attentionNeeded: {
        blockedGates: blockedGates.length,
        overdueItems: overdueItems.length,
        missingUpdates: missingUpdateProjects.length,
        redDepartmentKpis: departmentScores.filter((d) => d.rag === "red").length,
        total: blockedGates.length + overdueItems.length + missingUpdateProjects.length,
      },
    },
    portfolioSnapshot: {
      activeProjects: activeProjects.length,
      onTrack,
      atRisk,
      offTrack,
      blockedGates: blockedGates.length,
      upcomingMilestones: upcomingMilestones.length,
      practicalCompletionDue: practicalCompletionDue.length,
      handoversDue: handoversDue.length,
      phaseDistribution,
      scheduleHealth: {
        avgActualPct,
        avgExpectedPct,
        scheduleDelta,
        trackedItems: scheduleItemCount,
      },
    },
    financeSnapshot: {
      // Cash concepts
      cashReceivedFytd,
      cashPaidFytd,
      // Realised concepts (invoice-based)
      realisedRevenueFytd,
      realisedCostFytd,
      realisedGrossMarginPct: Math.round(realisedGrossMarginPct * 10) / 10,
      // Total-line metrics
      totalRevenueFytd,
      totalCostFytd,
      // Backward-compat aliases — these are CASH concepts, not realised
      revenueFytd: cashReceivedFytd,
      revenueTarget: totalPlannedRevenue,
      cosFytd: cashPaidFytd,
      cosTarget: totalPlannedCost,
      grossMarginPct: Math.round(grossMarginPct * 10) / 10,
      collectionRate: totalRevenueFytd > 0 ? Math.round((cashReceivedFytd / totalRevenueFytd) * 100) : 0,
      overdueDebtors: overdueDebtorValue,
      overdueDebtorCount: overdueDebtors.length,
      trust: {
        invoiceWithoutPoCount,
        costRowsMissingLineage,
        revenueRowsMissingLineage,
        sourceLayerVisibility: "explicit",
        nullCount: companyOverviewNullCount,
      },
      nullCount: companyOverviewNullCount,
    },
    exceptions: exceptions.slice(0, 15),
    priorities: priorityData,
    signals: signals.slice(0, 10),
    nullCount: companyOverviewNullCount,
  };
}

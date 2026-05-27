// ============================================================
// GATE AUTO-EVALUATOR SERVICE — Task #84
// ============================================================
//
// Single source of truth for "is this gate item already populated by
// existing app data?". Pure read-only evaluators per
// (canonical_phase_code, requirement_key) pair returning:
//
//   { status, sourceLabel, evidenceUrl?, evidenceRef?, computedAt, confidence }
//
// Behavioural guarantees:
//   - Auto-detection only fills item statuses; the gate itself is never
//     auto-passed (a human still records the decision).
//   - Manual `status` on `project_stage_requirements` always wins. We
//     write to `auto_*` columns only.
//   - Hold/Done are not auto-evaluated.
//   - Aliases from task #81 are honoured — evaluators key off canonical
//     phase codes only (never display labels).
//   - Confidence: `high` (deterministic record present, e.g. signedDate
//     populated) | `medium` (heuristic, e.g. activity logged but unsigned).
//     No `low` to avoid noise.
//
// Usage:
//   const results = await evaluateGateAuto(projectId, "S03_SIGNATURE_FINANCIAL_CLOSE");
//   await persistGateAutoEvaluation(projectId, "S03_SIGNATURE_FINANCIAL_CLOSE", results);
// ============================================================

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  projectStageInstances,
  projectStageRequirements,
  projectInfo,
  projectExecutionState,
  projectRevenueSummary,
  opportunities,
  sites,
  clients,
  workItems,
  deliverables,
  drawingRegister,
  engTransmittals,
  normalizedRevenueLines,
  normalizedCostLines,
  handoverPacks,
  omHandovers,
  safetyFileItems,
  hseIncidents,
  qcChecklist,
  qcItemInstance,
  emailProjectLinks,
  teamsProjectLinks,
} from "@shared/schema";
import { commissioningSnapshots } from "@shared/schema/commissioning-source";
import { PHASE_BY_CODE, isTerminalPhase } from "@shared/phases";
import type { StageCode, RequirementStatus } from "@shared/schema/stage-lifecycle";

// ===================== TYPES =====================

export type AutoConfidence = "high" | "medium";

/** Result of evaluating a single requirement. `status` follows
 *  the existing RequirementStatus enum. */
export interface AutoEvaluatorResult {
  /** RequirementStatus the evaluator detected. `complete` means we have a
   *  positive signal; `in_progress` means we found something partial; `null`
   *  means the evaluator did not find anything (do not write — leave manual
   *  status authoritative). */
  status: RequirementStatus | null;
  confidence: AutoConfidence;
  sourceLabel: string | null;
  evidenceUrl?: string | null;
  evidenceRef?: string | null;
  computedAt: Date;
}

/** Pre-fetched aggregates for a single project. Evaluators read from this
 *  context rather than each issuing their own DB calls — this keeps a full
 *  gate-page evaluation flat (one batch per source table per project). */
export interface ProjectEvaluatorContext {
  projectId: number;
  project: typeof projectInfo.$inferSelect | null;
  execState: typeof projectExecutionState.$inferSelect | null;
  revenueSummary: typeof projectRevenueSummary.$inferSelect | null;
  opportunity: typeof opportunities.$inferSelect | null;
  sites: Array<typeof sites.$inferSelect>;
  client: typeof clients.$inferSelect | null;
  workItems: Array<typeof workItems.$inferSelect>;
  deliverables: Array<typeof deliverables.$inferSelect>;
  drawings: Array<typeof drawingRegister.$inferSelect>;
  transmittals: Array<typeof engTransmittals.$inferSelect>;
  revenueLines: Array<typeof normalizedRevenueLines.$inferSelect>;
  costLines: Array<typeof normalizedCostLines.$inferSelect>;
  handoverPacks: Array<typeof handoverPacks.$inferSelect>;
  omHandovers: Array<typeof omHandovers.$inferSelect>;
  safetyFileItems: Array<typeof safetyFileItems.$inferSelect>;
  hseIncidents: Array<typeof hseIncidents.$inferSelect>;
  qcChecklists: Array<typeof qcChecklist.$inferSelect>;
  qcItemInstances: Array<typeof qcItemInstance.$inferSelect>;
  commissioningSnapshots: Array<typeof commissioningSnapshots.$inferSelect>;
  emailLinks: Array<typeof emailProjectLinks.$inferSelect>;
  teamsLinks: Array<typeof teamsProjectLinks.$inferSelect>;
}

export type EvaluatorFn = (ctx: ProjectEvaluatorContext) => AutoEvaluatorResult;

/** A single (canonical phase code → item code → evaluator) binding. */
export interface EvaluatorBinding {
  /** Canonical stage code. Must come from shared/phases.ts. */
  phaseCode: StageCode;
  /** Matches `project_stage_requirements.itemCode`. */
  itemCode: string;
  /** Evaluator function. Must be pure (no side effects, no writes). */
  evaluate: EvaluatorFn;
}

/** Final shape returned by evaluateGateAuto. */
export interface AutoRequirementEvaluation extends AutoEvaluatorResult {
  phaseCode: StageCode;
  itemCode: string;
  /** True if this binding is registered in the registry (vs falling back to no
   *  detection). */
  hasEvaluator: boolean;
}

// ===================== HELPERS =====================

const NOT_DETECTED = (computedAt = new Date()): AutoEvaluatorResult => ({
  status: null,
  confidence: "medium",
  sourceLabel: null,
  evidenceUrl: null,
  evidenceRef: null,
  computedAt,
});

function detected(
  status: RequirementStatus,
  sourceLabel: string,
  opts: {
    confidence?: AutoConfidence;
    evidenceUrl?: string | null;
    evidenceRef?: string | null;
  } = {},
): AutoEvaluatorResult {
  return {
    status,
    confidence: opts.confidence ?? "high",
    sourceLabel,
    evidenceUrl: opts.evidenceUrl ?? null,
    evidenceRef: opts.evidenceRef ?? null,
    computedAt: new Date(),
  };
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

function asNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ===================== CONTEXT LOADER =====================
// Batched loader — one query per source table for a single project.

export async function loadEvaluatorContext(projectId: number): Promise<ProjectEvaluatorContext> {
  // The relations below are the union of every signal any evaluator needs.
  // We always load them (even if a phase only uses a few) so a full gate
  // page evaluation has a consistent context.
  const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId)).limit(1);
  const [execState] = await db
    .select()
    .from(projectExecutionState)
    .where(eq(projectExecutionState.projectId, projectId))
    .limit(1);
  const [revenueSummary] = await db
    .select()
    .from(projectRevenueSummary)
    .where(and(
      eq(projectRevenueSummary.projectId, projectId),
      isNull(projectRevenueSummary.effectiveTo),
    ))
    .orderBy(desc(projectRevenueSummary.capturedAt))
    .limit(1);

  const opportunity = project?.opportunityId
    ? (await db.select().from(opportunities).where(eq(opportunities.id, project.opportunityId)).limit(1))[0] ?? null
    : null;

  const client = project?.clientId
    ? (await db.select().from(clients).where(eq(clients.id, project.clientId)).limit(1))[0] ?? null
    : null;

  const sitesRows = project?.clientId
    ? await db.select().from(sites).where(eq(sites.clientId, project.clientId))
    : [];

  const [
    workItemsRows,
    deliverablesRows,
    drawingsRows,
    transmittalsRows,
    revenueLinesRows,
    costLinesRows,
    handoverPacksRows,
    omHandoversRows,
    safetyFileItemsRows,
    hseIncidentsRows,
    qcChecklistsRows,
    commissioningSnapshotsRows,
    emailLinksRows,
    teamsLinksRows,
  ] = await Promise.all([
    db.select().from(workItems).where(eq(workItems.projectId, projectId)),
    db.select().from(deliverables).where(eq(deliverables.projectId, projectId)),
    db.select().from(drawingRegister).where(eq(drawingRegister.projectId, projectId)),
    db.select().from(engTransmittals).where(eq(engTransmittals.projectId, projectId)),
    db.select().from(normalizedRevenueLines).where(and(
      eq(normalizedRevenueLines.projectId, projectId),
      isNull(normalizedRevenueLines.effectiveTo),
      isNull(normalizedRevenueLines.deletedAt),
    )),
    db.select().from(normalizedCostLines).where(and(
      eq(normalizedCostLines.projectId, projectId),
      isNull(normalizedCostLines.effectiveTo),
      isNull(normalizedCostLines.deletedAt),
    )),
    db.select().from(handoverPacks).where(eq(handoverPacks.projectId, projectId)),
    db.select().from(omHandovers).where(eq(omHandovers.projectId, projectId)),
    db.select().from(safetyFileItems).where(eq(safetyFileItems.projectId, projectId)),
    db.select().from(hseIncidents).where(eq(hseIncidents.projectId, projectId)),
    db.select().from(qcChecklist).where(eq(qcChecklist.projectId, projectId)),
    db.select().from(commissioningSnapshots).where(eq(commissioningSnapshots.projectId, projectId)),
    db.select().from(emailProjectLinks).where(eq(emailProjectLinks.projectId, projectId)),
    db.select().from(teamsProjectLinks).where(eq(teamsProjectLinks.projectId, projectId)),
  ]);

  const checklistIds = qcChecklistsRows.map((c: { id: number }) => c.id);
  const qcItemInstancesRows = checklistIds.length
    ? await db.select().from(qcItemInstance).where(inArray(qcItemInstance.checklistId, checklistIds))
    : [];

  return {
    projectId,
    project: project ?? null,
    execState: execState ?? null,
    revenueSummary: revenueSummary ?? null,
    opportunity,
    client,
    sites: sitesRows,
    workItems: workItemsRows,
    deliverables: deliverablesRows,
    drawings: drawingsRows,
    transmittals: transmittalsRows,
    revenueLines: revenueLinesRows,
    costLines: costLinesRows,
    handoverPacks: handoverPacksRows,
    omHandovers: omHandoversRows,
    safetyFileItems: safetyFileItemsRows,
    hseIncidents: hseIncidentsRows,
    qcChecklists: qcChecklistsRows,
    qcItemInstances: qcItemInstancesRows,
    commissioningSnapshots: commissioningSnapshotsRows,
    emailLinks: emailLinksRows,
    teamsLinks: teamsLinksRows,
  };
}

// ===================== EVALUATOR REGISTRY =====================
// Bindings are intentionally inline + verbose — readability beats cleverness
// here because each is a contract with a department's data.

export const EVALUATOR_BINDINGS: EvaluatorBinding[] = [
  // ────────────────────────────────────────────────────────────
  // S01 — First Assessment (PD-led)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S01_FIRST_ASSESSMENT",
    itemCode: "site_viability",
    evaluate: (ctx) => {
      const site = ctx.sites.find((s) => !!s.address && !!s.gpsLat && !!s.gpsLng && !!s.roofType);
      if (!site) return NOT_DETECTED();
      return detected("complete", `Site ${site.id} addressed (${site.roofType}, ${site.address?.slice(0, 40)})`, {
        evidenceRef: `site:${site.id}`,
        evidenceUrl: `/sites/${site.id}`,
      });
    },
  },
  {
    phaseCode: "S01_FIRST_ASSESSMENT",
    itemCode: "client_fit",
    evaluate: (ctx) => {
      if (!ctx.client) return NOT_DETECTED();
      return detected("complete", `Client linked: ${ctx.client.name ?? ctx.client.clientId}`, {
        evidenceRef: `client:${ctx.client.id}`,
        evidenceUrl: `/clients/${ctx.client.id}`,
      });
    },
  },
  {
    phaseCode: "S01_FIRST_ASSESSMENT",
    itemCode: "rough_feasibility",
    evaluate: (ctx) => {
      const o = ctx.opportunity;
      if (!o) return NOT_DETECTED();
      const kwp = asNumber(o.estimatedKwp);
      const value = asNumber(o.estimatedValue);
      if (kwp <= 0 || value <= 0) return NOT_DETECTED();
      return detected("complete", `Opportunity ${o.id}: ${kwp} kWp / R${value.toLocaleString()}`, {
        evidenceRef: `opportunity:${o.id}`,
        evidenceUrl: `/opportunities/${o.id}`,
      });
    },
  },
  {
    phaseCode: "S01_FIRST_ASSESSMENT",
    itemCode: "initial_technical_review",
    evaluate: (ctx) => {
      const eng = ctx.workItems.find(
        (w) => w.workstream === "ENG" && w.status !== "not_started",
      );
      if (!eng) return NOT_DETECTED();
      return detected(
        eng.status === "complete" ? "complete" : "in_progress",
        `Engineering review work item #${eng.id} (${eng.status})`,
        {
          evidenceRef: `work_item:${eng.id}`,
          evidenceUrl: `/work-items/${eng.id}`,
          confidence: eng.status === "complete" ? "high" : "medium",
        },
      );
    },
  },
  {
    phaseCode: "S01_FIRST_ASSESSMENT",
    itemCode: "preliminary_commercial_assessment",
    evaluate: (ctx) => {
      const o = ctx.opportunity;
      if (!o) return NOT_DETECTED();
      const weighted = asNumber(o.weightedValue);
      const probability = asNumber(o.probability);
      if (weighted <= 0 || probability <= 0) return NOT_DETECTED();
      return detected("complete", `Weighted R${weighted.toLocaleString()} @ ${probability}% probability`, {
        evidenceRef: `opportunity:${o.id}`,
        evidenceUrl: `/opportunities/${o.id}`,
      });
    },
  },

  // ────────────────────────────────────────────────────────────
  // S02 — Cost Proposal & Design (Engineering-led)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S02_DESIGN_COST_PROPOSAL",
    itemCode: "system_design_complete",
    evaluate: (ctx) => {
      const designs = ctx.deliverables.filter((d) =>
        /design|sld|layout|drawing|schematic/i.test(d.deliverableType ?? ""),
      );
      if (designs.length === 0) return NOT_DETECTED();
      const approved = designs.filter((d) => ["complete", "qc_approved", "approved"].includes(d.status ?? ""));
      if (approved.length === designs.length) {
        return detected("complete", `${designs.length} design deliverables qc_approved/complete`, {
          evidenceRef: `deliverables:${designs.map((d) => d.id).join(",")}`,
          evidenceUrl: `/projects/${ctx.projectId}/engineering/deliverables`,
        });
      }
      if (approved.length > 0) {
        return detected("in_progress", `${approved.length}/${designs.length} design deliverables approved`, {
          evidenceUrl: `/projects/${ctx.projectId}/engineering/deliverables`,
          confidence: "medium",
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S02_DESIGN_COST_PROPOSAL",
    itemCode: "technical_review_signed",
    evaluate: (ctx) => {
      if (ctx.drawings.length === 0) return NOT_DETECTED();
      const approved = ctx.drawings.filter((d) =>
        ["approved", "for_construction", "as_built", "for_handover"].includes(d.status ?? ""),
      );
      if (approved.length === ctx.drawings.length) {
        return detected("complete", `All ${ctx.drawings.length} drawings approved`, {
          evidenceRef: `drawing_register:project:${ctx.projectId}`,
          evidenceUrl: `/projects/${ctx.projectId}/engineering/drawings`,
        });
      }
      if (approved.length > 0) {
        return detected("in_progress", `${approved.length}/${ctx.drawings.length} drawings approved`, {
          evidenceUrl: `/projects/${ctx.projectId}/engineering/drawings`,
          confidence: "medium",
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S02_DESIGN_COST_PROPOSAL",
    itemCode: "cost_proposal_prepared",
    evaluate: (ctx) => {
      const cp = ctx.workItems.find(
        (w) => /cost.proposal|proposal/i.test(w.title ?? "") && w.status !== "not_started",
      );
      if (!cp) return NOT_DETECTED();
      return detected(
        cp.status === "complete" ? "complete" : "in_progress",
        `Cost proposal work item #${cp.id} (${cp.status})`,
        {
          evidenceRef: `work_item:${cp.id}`,
          evidenceUrl: `/work-items/${cp.id}`,
          confidence: cp.status === "complete" ? "high" : "medium",
        },
      );
    },
  },
  {
    phaseCode: "S02_DESIGN_COST_PROPOSAL",
    itemCode: "client_alignment_confirmed",
    evaluate: (ctx) => {
      const o = ctx.opportunity;
      if (!o || !o.stage) return NOT_DETECTED();
      const stageLc = o.stage.toLowerCase();
      const inProposalOrLater = ["proposal", "negotiation", "won", "signed", "active"].some((s) =>
        stageLc.includes(s),
      );
      if (!inProposalOrLater) return NOT_DETECTED();
      const recentEnough = (() => {
        if (!o.lastActivityDate) return false;
        const d = new Date(o.lastActivityDate);
        const days = (Date.now() - d.getTime()) / 86400_000;
        return days <= 60;
      })();
      return detected(
        "complete",
        `Opportunity stage "${o.stage}"${o.lastActivityDate ? `, last activity ${fmtDate(o.lastActivityDate)}` : ""}`,
        {
          evidenceRef: `opportunity:${o.id}`,
          evidenceUrl: `/opportunities/${o.id}`,
          confidence: recentEnough ? "high" : "medium",
        },
      );
    },
  },
  {
    phaseCode: "S02_DESIGN_COST_PROPOSAL",
    itemCode: "commercial_model_validated",
    evaluate: (ctx) => {
      const cv = asNumber(ctx.project?.contractValue);
      const planned = asNumber(ctx.revenueSummary?.plannedRevenue);
      if (cv <= 0 || planned <= 0) return NOT_DETECTED();
      return detected("complete", `Contract R${cv.toLocaleString()}, planned revenue R${planned.toLocaleString()}`, {
        evidenceRef: `project:${ctx.projectId}`,
        evidenceUrl: `/projects/${ctx.projectId}/finance`,
      });
    },
  },
  {
    phaseCode: "S02_DESIGN_COST_PROPOSAL",
    itemCode: "bom_priced",
    evaluate: (ctx) => {
      // Wave-6 audit (2026-05-26): the previous `(l as any).status === "planned" || l.status === "planned"`
      // was a defensive double-check that did nothing — `l.status` is on the
      // canonical normalizedCostLines.$inferSelect type. Cast removed.
      const planned = ctx.costLines.filter((l) => l.status === "planned");
      if (planned.length === 0) return NOT_DETECTED();
      return detected("complete", `${planned.length} planned cost lines on BOM`, {
        evidenceRef: `cost_lines:project:${ctx.projectId}`,
        evidenceUrl: `/projects/${ctx.projectId}/finance/cost-lines`,
      });
    },
  },

  // ────────────────────────────────────────────────────────────
  // S03 — Financial Close (PD/Finance-led)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S03_SIGNATURE_FINANCIAL_CLOSE",
    itemCode: "cost_proposal_signed",
    evaluate: (ctx) => {
      if (ctx.execState?.cpSigned) {
        const date = ctx.execState.cpSignedDate ? fmtDate(ctx.execState.cpSignedDate) : "yes";
        return detected("complete", `Cost proposal signed (${date})`, {
          evidenceRef: `project_execution_state:${ctx.projectId}`,
          evidenceUrl: `/projects/${ctx.projectId}/contract`,
        });
      }
      if (ctx.opportunity?.signedDate) {
        return detected("complete", `Opportunity signed ${fmtDate(ctx.opportunity.signedDate)}`, {
          evidenceRef: `opportunity:${ctx.opportunity.id}`,
          evidenceUrl: `/opportunities/${ctx.opportunity.id}`,
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S03_SIGNATURE_FINANCIAL_CLOSE",
    itemCode: "epc_contract_signed",
    evaluate: (ctx) => {
      if (ctx.execState?.signedStatus === "SIGNED" && ctx.execState?.executionGateStatus === "APPROVED") {
        return detected("complete", `EPC contract SIGNED, execution gate APPROVED`, {
          evidenceRef: `project_execution_state:${ctx.projectId}`,
          evidenceUrl: `/projects/${ctx.projectId}/contract`,
        });
      }
      if (ctx.execState?.signedStatus === "PENDING") {
        return detected("in_progress", `EPC contract pending signature`, {
          evidenceRef: `project_execution_state:${ctx.projectId}`,
          confidence: "medium",
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S03_SIGNATURE_FINANCIAL_CLOSE",
    itemCode: "funding_confirmed",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) => w.workstream === "FINANCE" && /fund|financ/i.test(w.title ?? "") && w.status === "complete",
      );
      if (!w) return NOT_DETECTED();
      return detected("complete", `Finance work item #${w.id} complete`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },
  {
    phaseCode: "S03_SIGNATURE_FINANCIAL_CLOSE",
    itemCode: "deposit_received",
    evaluate: (ctx) => {
      const dep = ctx.revenueLines.find((r) =>
        ["invoiced", "paid", "in_bank", "realised"].includes(r.status ?? ""),
      );
      if (!dep) return NOT_DETECTED();
      return detected("complete", `Revenue line #${dep.id} ${dep.status}`, {
        evidenceRef: `revenue_line:${dep.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/finance/revenue`,
      });
    },
  },
  {
    phaseCode: "S03_SIGNATURE_FINANCIAL_CLOSE",
    itemCode: "om_contract_signed",
    evaluate: (ctx) => {
      const dm = (ctx.project?.deliveryModel ?? "").toLowerCase();
      if (!/o.?m|operations|maintenance/.test(dm)) return NOT_DETECTED();
      const conf: AutoConfidence = ctx.execState?.signedStatus === "SIGNED" ? "high" : "medium";
      return detected("complete", `Delivery model includes O&M (${ctx.project?.deliveryModel})`, {
        evidenceRef: `project:${ctx.projectId}`,
        evidenceUrl: `/projects/${ctx.projectId}/contract`,
        confidence: conf,
      });
    },
  },
  {
    phaseCode: "S03_SIGNATURE_FINANCIAL_CLOSE",
    itemCode: "sseg_application_submitted",
    evaluate: (ctx) => {
      const item = ctx.safetyFileItems.find((s) => s.itemCode === "sseg_application");
      if (!item) return NOT_DETECTED();
      if (["submitted", "approved"].includes(item.complianceStatus ?? "")) {
        return detected("complete", `SSEG application ${item.complianceStatus}`, {
          evidenceRef: `safety_file_item:${item.id}`,
          evidenceUrl: item.sharepointRef ?? `/projects/${ctx.projectId}/safety-file`,
        });
      }
      return NOT_DETECTED();
    },
  },

  // ────────────────────────────────────────────────────────────
  // S04 — Planning (PD → PM Handover)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S04_PLANNING",
    itemCode: "handover_pack_complete",
    evaluate: (ctx) => {
      const pack = ctx.handoverPacks.find(
        (p) => p.packType === "pd_to_pm" && (p.documentCompletenessPct ?? 0) >= 100,
      );
      if (!pack) return NOT_DETECTED();
      return detected("complete", `PD→PM handover pack #${pack.id} 100% complete`, {
        evidenceRef: `handover_pack:${pack.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/handover/${pack.id}`,
      });
    },
  },
  {
    phaseCode: "S04_PLANNING",
    itemCode: "project_charter_signed",
    evaluate: (ctx) => {
      const pack = ctx.handoverPacks.find(
        (p) => p.packType === "pd_to_pm" && ["submitted", "accepted"].includes(p.status ?? ""),
      );
      if (!pack) return NOT_DETECTED();
      return detected("complete", `PD→PM handover pack #${pack.id} ${pack.status}`, {
        evidenceRef: `handover_pack:${pack.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/handover/${pack.id}`,
      });
    },
  },
  {
    phaseCode: "S04_PLANNING",
    itemCode: "pm_acceptance_handover",
    evaluate: (ctx) => {
      const pack = ctx.handoverPacks.find(
        (p) => p.packType === "pd_to_pm" && !!p.matriarchAcceptanceDate,
      );
      if (!pack) return NOT_DETECTED();
      return detected("complete", `PM accepted handover ${fmtDate(pack.matriarchAcceptanceDate)}`, {
        evidenceRef: `handover_pack:${pack.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/handover/${pack.id}`,
      });
    },
  },
  {
    phaseCode: "S04_PLANNING",
    itemCode: "design_documents_handed_over",
    evaluate: (ctx) => {
      const ifcDrawings = ctx.drawings.filter((d) => ["for_construction", "ifc"].includes(d.status ?? ""));
      const t = ctx.transmittals.find((t) => t.purpose === "for_construction");
      if (ifcDrawings.length === 0 || !t) return NOT_DETECTED();
      return detected("complete", `${ifcDrawings.length} IFC drawings + transmittal #${t.id} for_construction`, {
        evidenceRef: `transmittal:${t.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/engineering/transmittals/${t.id}`,
      });
    },
  },
  {
    phaseCode: "S04_PLANNING",
    itemCode: "financial_baseline_confirmed",
    evaluate: (ctx) => {
      const planned = asNumber(ctx.revenueSummary?.plannedRevenue);
      // Wave-6 audit (2026-05-26): plannedExpenditure exists on
      // projectRevenueSummary.$inferSelect (verified in shared/schema/projects.ts);
      // the prior `as any` cast was unnecessary.
      const plannedExp = asNumber(ctx.revenueSummary?.plannedExpenditure);
      if (planned <= 0 || plannedExp <= 0) return NOT_DETECTED();
      return detected(
        "complete",
        `Planned revenue R${planned.toLocaleString()}, expenditure R${plannedExp.toLocaleString()}`,
        {
          evidenceRef: `revenue_summary:${ctx.projectId}`,
          evidenceUrl: `/projects/${ctx.projectId}/finance`,
        },
      );
    },
  },
  {
    phaseCode: "S04_PLANNING",
    itemCode: "alignment_meeting_held",
    evaluate: (ctx) => {
      const teams = ctx.teamsLinks.find((t) => /align|kickoff|kick.off|handover/i.test(t.bodyPreview ?? ""));
      if (teams) {
        return detected("complete", `Teams message linked: "${teams.bodyPreview?.slice(0, 40)}…"`, {
          evidenceRef: `teams_link:${teams.id}`,
          evidenceUrl: `/projects/${ctx.projectId}/inbox`,
          confidence: "medium",
        });
      }
      const email = ctx.emailLinks.find((e) => /align|kickoff|kick.off|handover/i.test(e.subjectSnapshot ?? ""));
      if (email) {
        return detected("complete", `Email linked: "${email.subjectSnapshot?.slice(0, 40)}…"`, {
          evidenceRef: `email_link:${email.id}`,
          evidenceUrl: `/projects/${ctx.projectId}/inbox`,
          confidence: "medium",
        });
      }
      return NOT_DETECTED();
    },
  },

  // ────────────────────────────────────────────────────────────
  // S06 — Construction (PM-led)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S06_CONSTRUCTION",
    itemCode: "site_establishment",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) =>
          (w.workstream === "PM" || w.workstream === "PD") &&
          /site.establish|establishment/i.test(w.title ?? "") &&
          w.status === "complete",
      );
      if (!w) return NOT_DETECTED();
      return detected("complete", `Site establishment work item #${w.id} complete`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },
  {
    phaseCode: "S06_CONSTRUCTION",
    itemCode: "all_inflows_received",
    evaluate: (ctx) => {
      const matLines = ctx.costLines.filter((l) => /material|equipment/i.test(l.costCategory ?? ""));
      if (matLines.length === 0) return NOT_DETECTED();
      const fa = matLines.filter((l) => ["invoiced", "approved", "paid"].includes(l.status ?? ""));
      if (fa.length === matLines.length) {
        return detected("complete", `${fa.length} material/equipment cost lines fully assigned`, {
          evidenceRef: `cost_lines:project:${ctx.projectId}`,
          evidenceUrl: `/projects/${ctx.projectId}/finance/cost-lines`,
        });
      }
      if (fa.length > 0) {
        return detected("in_progress", `${fa.length}/${matLines.length} cost lines fully assigned`, {
          evidenceUrl: `/projects/${ctx.projectId}/finance/cost-lines`,
          confidence: "medium",
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S06_CONSTRUCTION",
    itemCode: "installation_complete",
    evaluate: (ctx) => {
      const constructionStart = ctx.execState?.constructionStartActual;
      const constructionWi = ctx.workItems.filter((w) => /construction|install/i.test(w.title ?? "") || w.workstream === "PM");
      if (!constructionStart) return NOT_DETECTED();
      const incomplete = constructionWi.filter((w) => w.status !== "complete");
      if (incomplete.length === 0 && constructionWi.length > 0) {
        return detected("complete", `Construction started ${fmtDate(constructionStart)}, ${constructionWi.length} items complete`, {
          evidenceRef: `project_execution_state:${ctx.projectId}`,
        });
      }
      return detected("in_progress", `Construction started ${fmtDate(constructionStart)}, ${incomplete.length} items open`, {
        confidence: "medium",
      });
    },
  },
  {
    phaseCode: "S06_CONSTRUCTION",
    itemCode: "hse_plan_approved",
    evaluate: (ctx) => {
      const item = ctx.safetyFileItems.find((s) => s.itemCode === "health_safety_plan");
      if (!item || item.complianceStatus !== "approved") return NOT_DETECTED();
      return detected("complete", `Health & Safety Plan approved`, {
        evidenceRef: `safety_file_item:${item.id}`,
        evidenceUrl: item.sharepointRef ?? `/projects/${ctx.projectId}/safety-file`,
      });
    },
  },
  {
    phaseCode: "S06_CONSTRUCTION",
    itemCode: "safety_inspections_passed",
    evaluate: (ctx) => {
      const openSerious = ctx.hseIncidents.filter(
        (i) => ["medium", "high", "critical"].includes(i.severity ?? "") && i.status !== "closed",
      );
      if (openSerious.length > 0) {
        return detected("in_progress", `${openSerious.length} open serious incidents`, {
          evidenceUrl: `/projects/${ctx.projectId}/hse`,
          confidence: "high",
          // intentionally NOT 'complete' — caller treats null/in_progress as not gating-pass
        });
      }
      return detected("complete", `No open serious HSE incidents`, {
        evidenceRef: `hse_incidents:project:${ctx.projectId}`,
        evidenceUrl: `/projects/${ctx.projectId}/hse`,
      });
    },
  },
  {
    phaseCode: "S06_CONSTRUCTION",
    itemCode: "qc_checklists_complete",
    evaluate: (ctx) => {
      if (ctx.qcItemInstances.length === 0) return NOT_DETECTED();
      const approved = ctx.qcItemInstances.filter((i) => i.qmStatus === "approved");
      if (approved.length === ctx.qcItemInstances.length) {
        return detected("complete", `All ${approved.length} QC items approved`, {
          evidenceRef: `qc_items:project:${ctx.projectId}`,
          evidenceUrl: `/projects/${ctx.projectId}/quality`,
        });
      }
      if (approved.length > 0) {
        return detected("in_progress", `${approved.length}/${ctx.qcItemInstances.length} QC items approved`, {
          evidenceUrl: `/projects/${ctx.projectId}/quality`,
          confidence: "medium",
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S06_CONSTRUCTION",
    itemCode: "schedule_adherence",
    evaluate: (ctx) => {
      const constructionWi = ctx.workItems.filter(
        (w) => (w.workstream === "PM" || /construction|install/i.test(w.title ?? "")) && w.percentComplete != null,
      );
      if (constructionWi.length === 0) return NOT_DETECTED();
      const avg = constructionWi.reduce((s, w) => s + (w.percentComplete ?? 0), 0) / constructionWi.length;
      if (avg >= 100) {
        return detected("complete", `Construction work items at ${avg.toFixed(0)}% avg complete`, {
          evidenceUrl: `/projects/${ctx.projectId}/work-items`,
        });
      }
      if (avg >= 80) {
        return detected("in_progress", `Construction at ${avg.toFixed(0)}% avg complete`, {
          evidenceUrl: `/projects/${ctx.projectId}/work-items`,
          confidence: "medium",
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S06_CONSTRUCTION",
    itemCode: "all_pos_closed",
    evaluate: (ctx) => {
      if (ctx.costLines.length === 0) return NOT_DETECTED();
      const closed = ctx.costLines.filter(
        (l) => ["invoiced", "approved", "paid"].includes(l.status ?? ""),
      );
      if (closed.length === ctx.costLines.length) {
        return detected("complete", `All ${closed.length} cost lines invoiced/approved/paid`, {
          evidenceRef: `cost_lines:project:${ctx.projectId}`,
          evidenceUrl: `/projects/${ctx.projectId}/finance/cost-lines`,
        });
      }
      return NOT_DETECTED();
    },
  },

  // ────────────────────────────────────────────────────────────
  // S07 — Commissioning (Engineering-led)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S07_COMMISSIONING",
    itemCode: "commissioning_schedule_approved",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) => /commission.*schedule|schedule.*commission/i.test(w.title ?? "") && w.status === "complete",
      );
      if (!w) return NOT_DETECTED();
      return detected("complete", `Commissioning schedule work item #${w.id} complete`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },
  {
    phaseCode: "S07_COMMISSIONING",
    itemCode: "commissioning_tests_passed",
    evaluate: (ctx) => {
      const snap = ctx.commissioningSnapshots[0];
      if (!snap) return NOT_DETECTED();
      const sections = (snap.parsedSections as any[]) ?? [];
      const testSections = sections.filter((s: any) => /test|measurement|electrical/i.test(s.sectionType ?? ""));
      if (testSections.length === 0) return NOT_DETECTED();
      const completeForGate = testSections.filter((s: any) => s.isCompleteForGate);
      if (completeForGate.length === testSections.length) {
        return detected("complete", `${testSections.length} commissioning test sections complete`, {
          evidenceRef: `commissioning_snapshot:${snap.id}`,
          evidenceUrl: `/projects/${ctx.projectId}/commissioning`,
        });
      }
      return detected("in_progress", `${completeForGate.length}/${testSections.length} test sections complete`, {
        evidenceUrl: `/projects/${ctx.projectId}/commissioning`,
        confidence: "medium",
      });
    },
  },
  {
    phaseCode: "S07_COMMISSIONING",
    itemCode: "snag_list_resolved",
    evaluate: (ctx) => {
      if (ctx.qcItemInstances.length === 0) return NOT_DETECTED();
      const open = ctx.qcItemInstances.filter(
        (i) => !["approved", "not_applicable"].includes(i.qmStatus ?? ""),
      );
      if (open.length === 0) {
        return detected("complete", `All ${ctx.qcItemInstances.length} QC items resolved`, {
          evidenceUrl: `/projects/${ctx.projectId}/quality`,
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S07_COMMISSIONING",
    itemCode: "performance_ratio_verified",
    evaluate: (ctx) => {
      const snap = ctx.commissioningSnapshots[0];
      if (!snap) return NOT_DETECTED();
      const sections = (snap.parsedSections as any[]) ?? [];
      const perf = sections.find((s: any) => /performance|pr/i.test(s.sectionType ?? "") && s.displayStatus === "complete");
      if (!perf) return NOT_DETECTED();
      return detected("complete", `Performance section complete in commissioning snapshot`, {
        evidenceRef: `commissioning_snapshot:${snap.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/commissioning`,
      });
    },
  },
  {
    phaseCode: "S07_COMMISSIONING",
    itemCode: "sseg_approval_received",
    evaluate: (ctx) => {
      const item = ctx.safetyFileItems.find((s) => s.itemCode === "sseg_approval");
      if (!item || item.complianceStatus !== "approved") return NOT_DETECTED();
      return detected("complete", `SSEG approval received`, {
        evidenceRef: `safety_file_item:${item.id}`,
        evidenceUrl: item.sharepointRef ?? `/projects/${ctx.projectId}/safety-file`,
      });
    },
  },
  {
    phaseCode: "S07_COMMISSIONING",
    itemCode: "metering_active",
    evaluate: (ctx) => {
      const item = ctx.safetyFileItems.find((s) => s.itemCode === "metering");
      if (!item || item.complianceStatus !== "approved") return NOT_DETECTED();
      return detected("complete", `Metering active/approved`, {
        evidenceRef: `safety_file_item:${item.id}`,
        evidenceUrl: item.sharepointRef ?? `/projects/${ctx.projectId}/safety-file`,
      });
    },
  },
  {
    phaseCode: "S07_COMMISSIONING",
    itemCode: "practical_completion_certificate",
    evaluate: (ctx) => {
      const pack = ctx.handoverPacks.find(
        (p) => p.packType === "practical_completion" && p.status === "accepted",
      );
      if (!pack) return NOT_DETECTED();
      return detected("complete", `Practical completion pack #${pack.id} accepted`, {
        evidenceRef: `handover_pack:${pack.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/handover/${pack.id}`,
      });
    },
  },
  {
    phaseCode: "S07_COMMISSIONING",
    itemCode: "ncrs_closed",
    evaluate: (ctx) => {
      if (ctx.qcItemInstances.length === 0) return NOT_DETECTED();
      const open = ctx.qcItemInstances.filter(
        (i) => !["approved", "not_applicable"].includes(i.qmStatus ?? ""),
      );
      if (open.length === 0) {
        return detected("complete", `All NCRs closed/accepted`, {
          evidenceUrl: `/projects/${ctx.projectId}/quality`,
        });
      }
      return NOT_DETECTED();
    },
  },

  // ────────────────────────────────────────────────────────────
  // S08 — O&M Handover (PM-led)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S08_OM_HANDOVER",
    itemCode: "om_handover_pack_complete",
    evaluate: (ctx) => {
      const om = ctx.omHandovers[0];
      if (om) {
        const allUploaded =
          om.asBuiltsUploaded && om.warrantiesUploaded && om.omManualUploaded && om.serialNumbersUploaded;
        if (om.status === "accepted" || (allUploaded && om.targetsConfirmed && om.monitoringAccessConfirmed)) {
          return detected("complete", `O&M handover ${om.status}`, {
            evidenceRef: `om_handover:${om.id}`,
            evidenceUrl: `/projects/${ctx.projectId}/om-handover`,
          });
        }
      }
      const pack = ctx.handoverPacks.find(
        (p) => p.packType === "om_handover" && (p.documentCompletenessPct ?? 0) >= 100,
      );
      if (pack) {
        return detected("complete", `O&M handover pack #${pack.id} 100% complete`, {
          evidenceRef: `handover_pack:${pack.id}`,
          evidenceUrl: `/projects/${ctx.projectId}/handover/${pack.id}`,
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S08_OM_HANDOVER",
    itemCode: "om_acceptance_decision",
    evaluate: (ctx) => {
      const om = ctx.omHandovers.find((o) => !!o.acceptedAt);
      if (!om) return NOT_DETECTED();
      return detected("complete", `O&M accepted ${fmtDate(om.acceptedAt)}`, {
        evidenceRef: `om_handover:${om.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/om-handover`,
      });
    },
  },
  {
    phaseCode: "S08_OM_HANDOVER",
    itemCode: "monitoring_configured",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) => /monitor/i.test(w.title ?? "") && w.status === "complete",
      );
      if (!w) return NOT_DETECTED();
      return detected("complete", `Monitoring work item #${w.id} complete`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },
  {
    phaseCode: "S08_OM_HANDOVER",
    itemCode: "sla_confirmed",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) => /sla|service.level/i.test(w.title ?? "") && w.status === "complete",
      );
      if (!w) return NOT_DETECTED();
      return detected("complete", `SLA work item #${w.id} complete`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },
  {
    phaseCode: "S08_OM_HANDOVER",
    itemCode: "as_built_documentation",
    evaluate: (ctx) => {
      const asBuilt = ctx.drawings.filter((d) => d.status === "as_built");
      const t = ctx.transmittals.find((t) => t.purpose === "for_handover");
      if (asBuilt.length === 0 || !t) return NOT_DETECTED();
      return detected("complete", `${asBuilt.length} as-built drawings + transmittal #${t.id} for_handover`, {
        evidenceRef: `transmittal:${t.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/engineering/transmittals/${t.id}`,
      });
    },
  },
  {
    phaseCode: "S08_OM_HANDOVER",
    itemCode: "defects_liability_period",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) => /defect|dlp|liability/i.test(w.title ?? "") && w.status === "complete",
      );
      if (w) {
        return detected("complete", `DLP confirmation work item #${w.id} complete`, {
          evidenceRef: `work_item:${w.id}`,
          evidenceUrl: `/work-items/${w.id}`,
        });
      }
      if (ctx.project?.inDlp) {
        return detected("complete", `Project marked in_dlp`, {
          evidenceRef: `project:${ctx.projectId}`,
          confidence: "medium",
        });
      }
      return NOT_DETECTED();
    },
  },

  // ────────────────────────────────────────────────────────────
  // S09 — Client Handover (PM-led)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S09_CLIENT_HANDOVER",
    itemCode: "client_handover_pack_complete",
    evaluate: (ctx) => {
      const pack = ctx.handoverPacks.find(
        (p) => p.packType === "client_handover" && (p.documentCompletenessPct ?? 0) >= 100,
      );
      if (!pack) return NOT_DETECTED();
      return detected("complete", `Client handover pack #${pack.id} 100% complete`, {
        evidenceRef: `handover_pack:${pack.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/handover/${pack.id}`,
      });
    },
  },
  {
    phaseCode: "S09_CLIENT_HANDOVER",
    itemCode: "client_acceptance_received",
    evaluate: (ctx) => {
      const pack = ctx.handoverPacks.find(
        (p) => p.packType === "client_handover" && !!p.clientAcceptanceDate,
      );
      if (!pack) return NOT_DETECTED();
      return detected("complete", `Client accepted ${fmtDate(pack.clientAcceptanceDate)}`, {
        evidenceRef: `handover_pack:${pack.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/handover/${pack.id}`,
      });
    },
  },
  {
    phaseCode: "S09_CLIENT_HANDOVER",
    itemCode: "final_billing_complete",
    evaluate: (ctx) => {
      const planned = asNumber(ctx.revenueSummary?.plannedRevenue);
      if (planned <= 0) return NOT_DETECTED();
      const billed = ctx.revenueLines
        .filter((r) => ["invoiced", "paid", "in_bank", "realised"].includes(r.status ?? ""))
        .reduce((s, r) => s + asNumber(r.amountExVat ?? 0), 0);
      const tolerance = planned * 0.98;
      if (billed >= tolerance) {
        return detected(
          "complete",
          `Billed R${billed.toLocaleString()} ≥ planned R${planned.toLocaleString()}`,
          {
            evidenceRef: `revenue_summary:${ctx.projectId}`,
            evidenceUrl: `/projects/${ctx.projectId}/finance/revenue`,
          },
        );
      }
      return detected("in_progress", `Billed R${billed.toLocaleString()} of R${planned.toLocaleString()}`, {
        evidenceUrl: `/projects/${ctx.projectId}/finance/revenue`,
        confidence: "medium",
      });
    },
  },
  {
    phaseCode: "S09_CLIENT_HANDOVER",
    itemCode: "kam_handover",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) => /kam|key.account|relationship.transfer/i.test(w.title ?? "") && w.status === "complete",
      );
      if (!w) return NOT_DETECTED();
      return detected("complete", `KAM handover work item #${w.id} complete`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },
  {
    phaseCode: "S09_CLIENT_HANDOVER",
    itemCode: "warranties_documented",
    evaluate: (ctx) => {
      const w = ctx.deliverables.find((d) => /warrant/i.test(d.deliverableType ?? "") && d.status === "complete");
      if (!w) return NOT_DETECTED();
      return detected("complete", `Warranty deliverable #${w.id} complete`, {
        evidenceRef: `deliverable:${w.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/engineering/deliverables`,
      });
    },
  },
  {
    phaseCode: "S09_CLIENT_HANDOVER",
    itemCode: "three_month_review_scheduled",
    evaluate: (ctx) => {
      // Wave-6 audit (2026-05-26): workItems.startDate is on the
      // canonical typeof workItems.$inferSelect type — no need to
      // cast through any.
      const w = ctx.workItems.find((wi) => {
        if (!/3.month|three.month|post.handover|review/i.test(wi.title ?? "")) return false;
        const start = wi.startDate;
        if (!start) return false;
        const days = (new Date(start).getTime() - Date.now()) / 86400_000;
        return days >= 30 && days <= 180;
      });
      if (!w) return NOT_DETECTED();
      return detected("complete", `Review scheduled for ${fmtDate(w.startDate)}`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },

  // ────────────────────────────────────────────────────────────
  // S10 — 3 Months Post HO Review (PM-led)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S10_POST_HANDOVER_REVIEW",
    itemCode: "client_satisfaction_survey",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) => /client.satisfaction|csat|survey/i.test(w.title ?? "") && w.status === "complete",
      );
      if (!w) return NOT_DETECTED();
      return detected("complete", `Survey work item #${w.id} complete`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },
  {
    phaseCode: "S10_POST_HANDOVER_REVIEW",
    itemCode: "performance_vs_design",
    evaluate: (ctx) => {
      const snap = ctx.commissioningSnapshots[0];
      const sections = (snap?.parsedSections as any[]) ?? [];
      const sec = sections.find((s: any) => /performance.vs.design|performance.review/i.test(s.sectionType ?? ""));
      if (sec && sec.displayStatus === "complete") {
        return detected("complete", `Commissioning performance-vs-design section complete`, {
          evidenceRef: `commissioning_snapshot:${snap.id}`,
          evidenceUrl: `/projects/${ctx.projectId}/commissioning`,
        });
      }
      const d = ctx.deliverables.find(
        (d) => /performance.vs.design|performance.review/i.test(d.deliverableType ?? "") && d.status === "complete",
      );
      if (d) {
        return detected("complete", `Performance review deliverable #${d.id} complete`, {
          evidenceRef: `deliverable:${d.id}`,
          evidenceUrl: `/projects/${ctx.projectId}/engineering/deliverables`,
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S10_POST_HANDOVER_REVIEW",
    itemCode: "om_performance_report",
    evaluate: (ctx) => {
      const pack = ctx.handoverPacks.find(
        (p) => p.packType === "om_performance_report" && p.status === "accepted",
      );
      if (!pack) return NOT_DETECTED();
      return detected("complete", `O&M performance report #${pack.id} accepted`, {
        evidenceRef: `handover_pack:${pack.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/handover/${pack.id}`,
      });
    },
  },
  {
    phaseCode: "S10_POST_HANDOVER_REVIEW",
    itemCode: "final_margin_reconciliation",
    evaluate: (ctx) => {
      const actual = asNumber(ctx.revenueSummary?.actualRevenue);
      if (actual <= 0) return NOT_DETECTED();
      if (ctx.costLines.length === 0) return NOT_DETECTED();
      const closed = ctx.costLines.filter(
        (l) => ["invoiced", "approved", "paid"].includes(l.status ?? ""),
      );
      if (closed.length === ctx.costLines.length) {
        return detected("complete", `Actual revenue R${actual.toLocaleString()}, all COS lines closed`, {
          evidenceRef: `revenue_summary:${ctx.projectId}`,
          evidenceUrl: `/projects/${ctx.projectId}/finance`,
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S10_POST_HANDOVER_REVIEW",
    itemCode: "lessons_learned",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) => /lessons.learn|post.mortem|retrospective/i.test(w.title ?? "") && w.status === "complete",
      );
      if (!w) return NOT_DETECTED();
      return detected("complete", `Lessons learned work item #${w.id} complete`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },
  {
    phaseCode: "S10_POST_HANDOVER_REVIEW",
    itemCode: "warranty_claims_reviewed",
    evaluate: (ctx) => {
      const w = ctx.workItems.find(
        (w) => w.workstream === "QUALITY" && /warrant/i.test(w.title ?? "") && w.status === "complete",
      );
      if (!w) return NOT_DETECTED();
      return detected("complete", `Warranty review work item #${w.id} complete`, {
        evidenceRef: `work_item:${w.id}`,
        evidenceUrl: `/work-items/${w.id}`,
      });
    },
  },

  // ────────────────────────────────────────────────────────────
  // S9B — Compliance Handover (Compliance-led)
  // ────────────────────────────────────────────────────────────
  {
    phaseCode: "S9B_COMPLIANCE_HANDOVER",
    itemCode: "all_compliance_items_approved",
    evaluate: (ctx) => {
      if (ctx.safetyFileItems.length === 0) return NOT_DETECTED();
      const required = ctx.safetyFileItems.filter((s) => s.required !== false);
      const approved = required.filter(
        (s) => s.complianceStatus === "approved" || s.complianceStatus === "not_applicable",
      );
      if (approved.length === required.length) {
        return detected("complete", `All ${required.length} required compliance items approved`, {
          evidenceRef: `safety_file:project:${ctx.projectId}`,
          evidenceUrl: `/projects/${ctx.projectId}/safety-file`,
        });
      }
      if (approved.length > 0) {
        return detected("in_progress", `${approved.length}/${required.length} compliance items approved`, {
          evidenceUrl: `/projects/${ctx.projectId}/safety-file`,
          confidence: "medium",
        });
      }
      return NOT_DETECTED();
    },
  },
  {
    phaseCode: "S9B_COMPLIANCE_HANDOVER",
    itemCode: "compliance_handover_pack",
    evaluate: (ctx) => {
      const pack = ctx.handoverPacks.find(
        (p) => p.packType === "sseg_closeout" && p.status === "accepted",
      );
      if (!pack) return NOT_DETECTED();
      return detected("complete", `Compliance closeout pack #${pack.id} accepted`, {
        evidenceRef: `handover_pack:${pack.id}`,
        evidenceUrl: `/projects/${ctx.projectId}/handover/${pack.id}`,
      });
    },
  },
  {
    phaseCode: "S9B_COMPLIANCE_HANDOVER",
    itemCode: "regulatory_submissions_logged",
    evaluate: (ctx) => {
      const withEvidence = ctx.safetyFileItems.filter((s) => !!s.sharepointRef);
      if (withEvidence.length === 0) return NOT_DETECTED();
      return detected("complete", `${withEvidence.length} compliance items have evidence links`, {
        evidenceRef: `safety_file:project:${ctx.projectId}`,
        evidenceUrl: `/projects/${ctx.projectId}/safety-file`,
      });
    },
  },
];

// ===================== REGISTRY API =====================

const BINDING_MAP: Map<string, EvaluatorBinding> = (() => {
  const m = new Map<string, EvaluatorBinding>();
  for (const b of EVALUATOR_BINDINGS) {
    m.set(`${b.phaseCode}::${b.itemCode}`, b);
  }
  return m;
})();

export function getEvaluator(phaseCode: string, itemCode: string): EvaluatorBinding | undefined {
  return BINDING_MAP.get(`${phaseCode}::${itemCode}`);
}

export function listEvaluatorsForPhase(phaseCode: string): EvaluatorBinding[] {
  return EVALUATOR_BINDINGS.filter((b) => b.phaseCode === phaseCode);
}

/**
 * Evaluate every registered binding for the given phase against a single
 * project context. Read-only, side-effect-free.
 *
 * Hold/Done are not auto-evaluated and return an empty array.
 */
export function evaluateGateAutoFromContext(
  phaseCode: string,
  ctx: ProjectEvaluatorContext,
): AutoRequirementEvaluation[] {
  if (isTerminalPhase(phaseCode)) return [];
  const bindings = listEvaluatorsForPhase(phaseCode);
  return bindings.map((b) => {
    const result = b.evaluate(ctx);
    return {
      ...result,
      phaseCode: b.phaseCode,
      itemCode: b.itemCode,
      hasEvaluator: true,
    };
  });
}

/**
 * Top-level entry: load context and evaluate all bindings for the phase.
 * Returns one result per registered binding for the phase. Items without
 * an evaluator are not included.
 */
export async function evaluateGateAuto(
  projectId: number,
  phaseCode: string,
): Promise<AutoRequirementEvaluation[]> {
  if (isTerminalPhase(phaseCode)) return [];
  const ctx = await loadEvaluatorContext(projectId);
  return evaluateGateAutoFromContext(phaseCode, ctx);
}

/**
 * Bulk version for board/dashboard use. Loads contexts in parallel and
 * evaluates each project for the requested phase (or all sequential phases
 * if `phaseCode` is omitted).
 */
export async function evaluateGateAutoBulk(
  projectIds: number[],
  phaseCode?: string,
): Promise<Record<number, AutoRequirementEvaluation[]>> {
  const out: Record<number, AutoRequirementEvaluation[]> = {};
  // Bound parallelism to avoid hammering the DB on large boards.
  const BATCH = 8;
  for (let i = 0; i < projectIds.length; i += BATCH) {
    const slice = projectIds.slice(i, i + BATCH);
    const ctxs = await Promise.all(slice.map((id) => loadEvaluatorContext(id)));
    for (let j = 0; j < slice.length; j++) {
      const id = slice[j]!;
      const ctx = ctxs[j]!;
      if (phaseCode) {
        out[id] = evaluateGateAutoFromContext(phaseCode, ctx);
      } else {
        // All sequential phases — flat array, callers can group by phaseCode.
        const seq: AutoRequirementEvaluation[] = [];
        for (const p of Object.values(PHASE_BY_CODE)) {
          if (!p.isSequential) continue;
          seq.push(...evaluateGateAutoFromContext(p.code, ctx));
        }
        out[id] = seq;
      }
    }
  }
  return out;
}

/**
 * Persist the auto-evaluator output onto `project_stage_requirements.auto_*`
 * columns. Manual `status` is never touched.
 *
 * Idempotent: running twice with the same data writes the same auto_* values
 * (auto_computed_at refreshes).
 *
 * Items the evaluator returns with `status === null` (not detected) get their
 * auto_* fields cleared back to NULL — this is how an un-invoiced revenue line
 * or reverted handover pack drops the auto-detection on the next sweep.
 */
export async function persistGateAutoEvaluation(
  projectId: number,
  phaseCode: string,
  results: AutoRequirementEvaluation[],
): Promise<{ updated: number; cleared: number }> {
  // Find the stage instance and load its requirements.
  const [instance] = await db
    .select()
    .from(projectStageInstances)
    .where(
      and(
        eq(projectStageInstances.projectId, projectId),
        eq(projectStageInstances.stageCode, phaseCode),
      ),
    )
    .limit(1);
  if (!instance) return { updated: 0, cleared: 0 };

  const reqs = await db
    .select()
    .from(projectStageRequirements)
    .where(eq(projectStageRequirements.stageInstanceId, instance.id));
  if (reqs.length === 0) return { updated: 0, cleared: 0 };

  const byCode = new Map(results.map((r) => [r.itemCode, r] as const));
  let updated = 0;
  let cleared = 0;
  for (const req of reqs) {
    const r = byCode.get(req.itemCode);
    if (r && r.status) {
      await db
        .update(projectStageRequirements)
        .set({
          autoStatus: r.status,
          autoSourceLabel: r.sourceLabel,
          autoSourceRef: r.evidenceRef ?? null,
          autoEvidenceUrl: r.evidenceUrl ?? null,
          autoConfidence: r.confidence,
          autoComputedAt: r.computedAt,
          updatedAt: new Date(),
        })
        .where(eq(projectStageRequirements.id, req.id));
      updated += 1;
    } else if (req.autoStatus !== null) {
      // Source dropped — clear the previously auto-detected fields.
      await db
        .update(projectStageRequirements)
        .set({
          autoStatus: null,
          autoSourceLabel: null,
          autoSourceRef: null,
          autoEvidenceUrl: null,
          autoConfidence: null,
          autoComputedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectStageRequirements.id, req.id));
      cleared += 1;
    }
  }
  return { updated, cleared };
}

/**
 * One-shot helper: evaluate + persist. Used by the on-demand endpoint and the
 * periodic refresh sweep.
 */
export async function evaluateAndPersistGateAuto(
  projectId: number,
  phaseCode: string,
): Promise<{ results: AutoRequirementEvaluation[]; persistResult: { updated: number; cleared: number } }> {
  const results = await evaluateGateAuto(projectId, phaseCode);
  const persistResult = await persistGateAutoEvaluation(projectId, phaseCode, results);
  return { results, persistResult };
}

/**
 * Effective status for a requirement — manual wins, otherwise auto.
 * Used by the readiness % math and the snapshot capture so auto-detected
 * items count as completed exactly like manually completed items.
 */
export function effectiveRequirementStatus(req: {
  status: string;
  autoStatus?: string | null;
}): { status: string; isAuto: boolean } {
  // Manual `not_started` with an auto status falls back to auto.
  if (req.status === "not_started" && req.autoStatus) {
    return { status: req.autoStatus, isAuto: true };
  }
  return { status: req.status, isAuto: false };
}

/**
 * Summary helper for the "X of Y items auto-populated" chip on each stage card.
 */
export function summarizeAutoCoverage(
  reqs: Array<{ status: string; autoStatus?: string | null }>,
): { autoPopulated: number; total: number; manual: number } {
  let autoPopulated = 0;
  let manual = 0;
  for (const r of reqs) {
    const eff = effectiveRequirementStatus(r);
    if (eff.isAuto && (eff.status === "complete" || eff.status === "in_progress")) {
      autoPopulated += 1;
    } else if (r.status === "complete" || r.status === "not_applicable" || r.status === "waived") {
      manual += 1;
    }
  }
  return { autoPopulated, total: reqs.length, manual };
}

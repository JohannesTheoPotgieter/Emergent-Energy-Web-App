// GC-005: Configurable RAG thresholds — single source of truth for all screens
export interface RagThresholds {
  schedule: { amberMax: number }; // overdue task count: 0 = green, <= amberMax = amber, > amberMax = red
  cost: { greenMax: number; amberMax: number }; // cost ratio: < greenMax = green, <= amberMax = amber, > amberMax = red
  quality: { requireAllGatesPassed: boolean }; // if true, all gates must pass for green
}

export const DEFAULT_RAG_THRESHOLDS: RagThresholds = {
  schedule: { amberMax: 3 },
  cost: { greenMax: 0.9, amberMax: 1.0 },
  quality: { requireAllGatesPassed: true },
};

export function computeScheduleRag(overdueCount: number, thresholds: RagThresholds = DEFAULT_RAG_THRESHOLDS): "green" | "amber" | "red" {
  if (overdueCount === 0) return "green";
  return overdueCount <= thresholds.schedule.amberMax ? "amber" : "red";
}

export function computeCostRag(costRatio: number, thresholds: RagThresholds = DEFAULT_RAG_THRESHOLDS): "green" | "amber" | "red" {
  if (costRatio < thresholds.cost.greenMax) return "green";
  return costRatio <= thresholds.cost.amberMax ? "amber" : "red";
}

export function computeQualityRag(
  hasChecklist: boolean, gatesPassed: number, gatesTotal: number, approvedItems: number,
  thresholds: RagThresholds = DEFAULT_RAG_THRESHOLDS,
): "green" | "amber" | "red" {
  if (!hasChecklist) return "red";
  if (thresholds.quality.requireAllGatesPassed && gatesPassed === gatesTotal && gatesTotal > 0) return "green";
  if (approvedItems > 0) return "amber";
  return "red";
}

export function computeOverallRag(schedule: "green" | "amber" | "red", cost: "green" | "amber" | "red", quality: "green" | "amber" | "red"): "green" | "amber" | "red" {
  if (schedule === "red" || cost === "red" || quality === "red") return "red";
  if (schedule === "amber" || cost === "amber" || quality === "amber") return "amber";
  return "green";
}

// ── Priority Health Constants ────────────────────────────────────────
// Single source of truth for health status values used across the
// priority_derived_metrics VIEW, strategic routes, and UI components.

export type PriorityHealth = "healthy" | "at_risk" | "critical";

export const PRIORITY_HEALTH_VALUES: readonly PriorityHealth[] = ["healthy", "at_risk", "critical"] as const;

/**
 * Display labels for priority health, using verbs so the UI never shows
 * the same word ("Critical") for both severity and health. Severity =
 * strategic weight chosen at creation (Critical / High / Normal).
 * Health = live state computed from project RAG + due date + blockers
 * (On track / Slipping / Off track). Underlying enum values stay
 * unchanged — this map is for rendering only.
 */
export const PRIORITY_HEALTH_LABELS: Record<PriorityHealth, string> = {
  healthy: "On track",
  at_risk: "Slipping",
  critical: "Off track",
};

export function priorityHealthLabel(h: string | null | undefined): string {
  if (!h) return "On track";
  return PRIORITY_HEALTH_LABELS[h as PriorityHealth] ?? h;
}

/**
 * Maps a project RAG status (case-insensitive) to a priority health value.
 * "red" → "critical", "amber"/"orange" → "at_risk", else → "healthy".
 */
export function ragStatusToHealth(ragStatus: string | null | undefined): PriorityHealth {
  if (!ragStatus) return "healthy";
  const lower = ragStatus.toLowerCase();
  if (lower === "red") return "critical";
  if (lower === "amber" || lower === "orange") return "at_risk";
  return "healthy";
}

/**
 * Derives worst-of health from an array of project RAG statuses.
 * Returns null if no statuses provided (no projects linked).
 */
export function deriveHealthFromRagStatuses(ragStatuses: string[]): PriorityHealth | null {
  if (ragStatuses.length === 0) return null;
  const mapped = ragStatuses.map(ragStatusToHealth);
  if (mapped.includes("critical")) return "critical";
  if (mapped.includes("at_risk")) return "at_risk";
  return "healthy";
}

const HEALTH_RANK: Record<PriorityHealth, number> = {
  healthy: 0,
  at_risk: 1,
  critical: 2,
};

function worstHealth(...candidates: (PriorityHealth | null | undefined)[]): PriorityHealth {
  let worst: PriorityHealth = "healthy";
  for (const c of candidates) {
    if (!c) continue;
    if (HEALTH_RANK[c] > HEALTH_RANK[worst]) worst = c;
  }
  return worst;
}

export interface EffectivePriorityHealthInput {
  /** Manual override set by owner (optional). */
  manualHealth: PriorityHealth | null | undefined;
  /** Health derived from linked projects' RAG (null if no projects). */
  derivedHealth: PriorityHealth | null | undefined;
  /** Priority severity — "critical" amplifies overdue signals. */
  severity: string | null | undefined;
  /** Due date as ISO date string ("YYYY-MM-DD") or null. */
  dueDate: string | null | undefined;
  /** Status — "closed" / "complete" short-circuit to healthy. */
  status: string | null | undefined;
  /** Count of open blocker work-items on linked projects. */
  blockerCount: number;
  /** Count of blocked engineering stages on linked projects (Tier 4 · PR 3). */
  engBlockerCount?: number;
  /** Count of open quality defects / failed QC items on linked projects. */
  qualityDefectCount?: number;
  /** Count of open HSE incidents (any high+ severity) on linked projects. */
  hseIncidentCount?: number;
  /** Count of open HSE incidents with severity='critical'. Drives immediate critical health. */
  hseCriticalCount?: number;
  /** PD signal: stalled opportunities (>60d stuck OR past expected close). */
  staleOpportunityCount?: number;
  /** PD signal: open pre-engineering tickets tied to linked opportunities. */
  openPdTicketCount?: number;
  /** Optional "now" override, for deterministic tests. Defaults to new Date(). */
  now?: Date;
}

export interface EffectivePriorityHealthResult {
  health: PriorityHealth;
  /** Human-readable reasons, ordered by contribution. */
  reasons: string[];
}

/**
 * Computes the effective health of a priority by taking the worst-of
 * across every available signal:
 *   - manual override by the owner
 *   - linked-projects' RAG (from priority_derived_metrics.derived_health)
 *   - overdue-days amplified by severity
 *   - open blocker count
 *
 * If status is "complete" or "closed" the priority is always healthy
 * regardless of other inputs — finished work shouldn't keep signalling.
 */
export function computeEffectivePriorityHealth(
  input: EffectivePriorityHealthInput,
): EffectivePriorityHealthResult {
  const reasons: string[] = [];
  const status = (input.status || "").toLowerCase();
  if (status === "complete" || status === "closed") {
    return { health: "healthy", reasons: [] };
  }

  // Overdue signal — date-only comparison so timezone doesn't flip the day.
  let overdueSignal: PriorityHealth | null = null;
  if (input.dueDate) {
    const today = (input.now ?? new Date()).toISOString().slice(0, 10);
    if (input.dueDate < today) {
      const dueMs = Date.parse(input.dueDate + "T00:00:00Z");
      const todayMs = Date.parse(today + "T00:00:00Z");
      const overdueDays = Math.floor((todayMs - dueMs) / 86_400_000);
      const severityCritical = (input.severity || "").toLowerCase() === "critical";
      if (overdueDays >= 30 || (severityCritical && overdueDays >= 14)) {
        overdueSignal = "critical";
        reasons.push(`${overdueDays}d overdue${severityCritical ? " (critical severity)" : ""}`);
      } else if (overdueDays >= 1) {
        overdueSignal = "at_risk";
        reasons.push(`${overdueDays}d overdue`);
      }
    }
  }

  // Blocker signal
  let blockerSignal: PriorityHealth | null = null;
  if (input.blockerCount >= 3) {
    blockerSignal = "critical";
    reasons.push(`${input.blockerCount} blockers`);
  } else if (input.blockerCount >= 1) {
    blockerSignal = "at_risk";
    reasons.push(`${input.blockerCount} blocker${input.blockerCount > 1 ? "s" : ""}`);
  }

  // Engineering signal — any blocked eng stage is at_risk; 3+ is critical.
  let engSignal: PriorityHealth | null = null;
  const engBlockers = input.engBlockerCount ?? 0;
  if (engBlockers >= 3) {
    engSignal = "critical";
    reasons.push(`${engBlockers} engineering gates blocked`);
  } else if (engBlockers >= 1) {
    engSignal = "at_risk";
    reasons.push(`${engBlockers} engineering gate${engBlockers === 1 ? "" : "s"} blocked`);
  }

  // Quality signal — 5+ open QC defects is at_risk; 15+ is critical.
  let qualitySignal: PriorityHealth | null = null;
  const qcDefects = input.qualityDefectCount ?? 0;
  if (qcDefects >= 15) {
    qualitySignal = "critical";
    reasons.push(`${qcDefects} open QC defects`);
  } else if (qcDefects >= 5) {
    qualitySignal = "at_risk";
    reasons.push(`${qcDefects} open QC defects`);
  }

  // HSE signal — any high-severity open incident is at_risk; any critical is critical.
  let hseSignal: PriorityHealth | null = null;
  const hseCritical = input.hseCriticalCount ?? 0;
  const hseOpen = input.hseIncidentCount ?? 0;
  if (hseCritical >= 1) {
    hseSignal = "critical";
    reasons.push(`${hseCritical} critical HSE incident${hseCritical === 1 ? "" : "s"}`);
  } else if (hseOpen >= 1) {
    hseSignal = "at_risk";
    reasons.push(`${hseOpen} open HSE incident${hseOpen === 1 ? "" : "s"}`);
  }

  // PD signal — stalled opportunities are at_risk; 3+ is critical. Open
  // PD tickets are at_risk contributors (don't flip to critical by themselves
  // since they're common steady-state work).
  let pdSignal: PriorityHealth | null = null;
  const staleOpps = input.staleOpportunityCount ?? 0;
  const openPdTickets = input.openPdTicketCount ?? 0;
  if (staleOpps >= 3) {
    pdSignal = "critical";
    reasons.push(`${staleOpps} stalled opportunities`);
  } else if (staleOpps >= 1) {
    pdSignal = "at_risk";
    reasons.push(`${staleOpps} stalled opportunit${staleOpps === 1 ? "y" : "ies"}`);
  } else if (openPdTickets >= 5) {
    pdSignal = "at_risk";
    reasons.push(`${openPdTickets} open PD tickets`);
  }

  if (input.derivedHealth && input.derivedHealth !== "healthy") {
    reasons.push(`project RAG ${input.derivedHealth === "critical" ? "red" : "amber"}`);
  }
  if (input.manualHealth && input.manualHealth !== "healthy") {
    reasons.push(`manually flagged ${input.manualHealth === "critical" ? "critical" : "at risk"}`);
  }

  const health = worstHealth(
    input.manualHealth,
    input.derivedHealth,
    overdueSignal,
    blockerSignal,
    engSignal,
    qualitySignal,
    hseSignal,
    pdSignal,
  );
  return { health, reasons };
}

export type KpiSourceLayer = "foundation" | "business_logic" | "derived_kpi" | "view_model";

export interface KpiDefinition {
  id: string;
  name: string;
  sourceLayer: KpiSourceLayer;
  sourceTable: string;
  sourceFields: string;
  businessRule: string;
  formula: string;
  aggregationPath: string;
  apiEndpoint: string;
  consumingComponent: string;
}

export const KPI_DEFINITIONS: Record<string, KpiDefinition> = {
  revenue_planned: {
    id: "revenue_planned",
    name: "Total Planned Revenue",
    sourceLayer: "foundation",
    sourceTable: "normalized_revenue_lines",
    sourceFields: "amount_ex_vat, invoice_number, paid_date, effective_to",
    businessRule: "Dashboard and tracker revenue values read canonical current-snapshot inflow rows (effective_to IS NULL) and apply realised/unrealised state from invoice/payment confirmation rules.",
    formula: "SUM(normalized_revenue_lines.amount_ex_vat) WHERE effective_to IS NULL (state-specific totals derived by finance tracker rules)",
    aggregationPath: "normalized_revenue_lines -> FinanceInflowsRepository/getAllRevenueLinesForCashflow -> finance dashboards/trackers",
    apiEndpoint: "/api/program-dashboard,/api/revenue-tracker",
    consumingComponent: "Dashboard Page, Revenue Tracker Page, Revenue Tracker Tab",
  },
  eng_progress_pct: {
    id: "eng_progress_pct",
    name: "Engineering Progress %",
    sourceLayer: "business_logic",
    sourceTable: "project_eng_stages",
    sourceFields: "status",
    businessRule: "Only canonical complete engineering statuses contribute to completion percentage.",
    formula: "(complete / total) * 100",
    aggregationPath: "project_eng_stages -> summarizeEngineeringStatuses -> dashboard/portfolio",
    apiEndpoint: "/api/portfolio-dashboard",
    consumingComponent: "Portfolios",
  },
  quality_pass_rate: {
    id: "quality_pass_rate",
    name: "Quality Pass Rate %",
    sourceLayer: "business_logic",
    sourceTable: "qc_item_instance",
    sourceFields: "status",
    businessRule: "Only canonical approved statuses are counted as passed.",
    formula: "(approved / total) * 100",
    aggregationPath: "qc_item_instance -> summarizeQualityStatuses -> dashboard/portfolio",
    apiEndpoint: "/api/quality/checklists,/api/portfolio-dashboard",
    consumingComponent: "QmDashboard, Dashboard SummaryCard, Portfolios",
  },
  project_avg_progress: {
    id: "project_avg_progress",
    name: "Average Project Progress %",
    sourceLayer: "business_logic",
    sourceTable: "work_items",
    sourceFields: "actual_pct_complete, expected_pct_complete, duration_days",
    businessRule: "Project plan progress reads PM SMART_IMPORT work_items (deleted_at IS NULL). Portfolio-level health uses duration-aware completion plus expected-vs-actual deltas for behind/risk signals.",
    formula: "Task-level: actual_pct_complete from work_items; portfolio rollup: computeProjectCompletion + summarizeSchedule",
    aggregationPath: "work_items -> storage.getProjectPlansByProject/getAllPMWorkItemsAsProjectPlan -> computeProjectCompletion/summarizeSchedule -> project + portfolio views",
    apiEndpoint: "/api/project-plan/:projectName,/api/portfolio-dashboard",
    consumingComponent: "Projects Page, Portfolios",
  },
  // ─── Finance tracker KPIs (added for traceability) ───
  cos_tracker_realised: {
    id: "cos_tracker_realised",
    name: "COS Realised (Tracker)",
    sourceLayer: "business_logic",
    sourceTable: "normalized_cost_lines",
    sourceFields: "amount_ex_vat, invoice_number, invoice_date, invoice_date_confirmed, invoice_date_font_color, effective_to",
    businessRule: "COS is realised only when invoice evidence is present and the invoice date is confirmed (or closed-month auto-promote applies). Current-snapshot cost rows only.",
    formula: "SUM(normalized_cost_lines.amount_ex_vat) WHERE effective_to IS NULL AND isEffectivelyRealised(line, monthKey, currentMonthKey)",
    aggregationPath: "normalized_cost_lines -> /api/cos-tracker state classification -> COS Tracker + downstream GP/Revenue allocation",
    apiEndpoint: "/api/cos-tracker,/api/gp-tracker",
    consumingComponent: "COS Tracker Page, GP Tracker Page, Dashboard COS Card",
  },
  gp_tracker_actual: {
    id: "gp_tracker_actual",
    name: "GP Actual (Tracker)",
    sourceLayer: "derived_kpi",
    sourceTable: "normalized_cost_lines, normalized_revenue_lines",
    sourceFields: "expense_actual_total/revenue_recognition_amount, amount_ex_vat/milestone_amount, effective_to",
    businessRule: "GP tracker uses canonical current cost + inflow snapshots. Revenue allocation follows persisted revenue-recognition logic; GP = allocated revenue − COS.",
    formula: "GP = revenueRecognitionAmount (or proportional allocation where applicable) − expenseActualTotal",
    aggregationPath: "canonical cost read service + FinanceInflowsRepository -> /api/gp-tracker aggregation -> GP Tracker UI",
    apiEndpoint: "/api/gp-tracker,/api/gp-tracker/month-detail",
    consumingComponent: "GP Tracker Page, GP Tracker Tab",
  },
  revenue_tracker_allocated: {
    id: "revenue_tracker_allocated",
    name: "Revenue Allocated (Tracker)",
    sourceLayer: "derived_kpi",
    sourceTable: "normalized_cost_lines, normalized_revenue_lines",
    sourceFields: "revenue_recognition_amount, expense_actual_total, no_revenue_linked, effective_to",
    businessRule: "Revenue tracker reads canonical snapshot rows and uses stored revenue-recognition amounts; items flagged noRevenueLinked contribute zero allocation.",
    formula: "Allocated revenue = revenueRecognitionAmount (fallback proportional method: (lineCOS / totalProjectCOS) × totalProjectRevenue)",
    aggregationPath: "canonical cost read service + FinanceInflowsRepository -> /api/revenue-tracker -> Revenue Tracker UI",
    apiEndpoint: "/api/revenue-tracker,/api/revenue-tracker/month-detail",
    consumingComponent: "Revenue Tracker Page, Revenue Tracker Tab",
  },
  dashboard_plan_gp_margin: {
    id: "dashboard_plan_gp_margin",
    name: "Dashboard Plan GP Margin %",
    sourceLayer: "view_model",
    sourceTable: "normalized_revenue_lines, normalized_cost_lines",
    sourceFields: "amount_ex_vat",
    businessRule: "Dashboard GP% is PLAN-BASED: (plannedRevenue − plannedExpenditure) / plannedRevenue. This differs from GP Tracker which uses COS-ratio-allocated actuals.",
    formula: "(plannedRevenueFy − plannedExpenditureFy) / plannedRevenueFy",
    aggregationPath: "normalized_revenue_lines + normalized_cost_lines -> program-dashboard -> Dashboard project table",
    apiEndpoint: "/api/program-dashboard",
    consumingComponent: "Dashboard Page (Plan GP % column)",
  },
};

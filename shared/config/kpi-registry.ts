/**
 * Central KPI Registry — single source of truth for department KPI definitions,
 * weights, thresholds, and scoring logic used by the Company Overview page.
 */

export type Department =
  | "Project Development"
  | "Project Delivery"
  | "Engineering"
  | "HSE"
  | "Quality"
  | "Finance";

export type RagStatus = "green" | "amber" | "red";

export type NormalizationMethod =
  | "percentage_vs_target"     // actual / target * 100
  | "inverse_count"            // fewer = better (0 = 100, threshold = 0)
  | "percentage_direct"        // value is already 0-100
  | "inverse_days"             // fewer days = better
  | "threshold_bands";         // custom bands

export interface KpiDefinition {
  kpiKey: string;
  kpiName: string;
  department: Department;
  weight: number;
  normalization: NormalizationMethod;
  /** For inverse_count / inverse_days: value at which score = 0 */
  inverseCeiling?: number;
  /** For threshold_bands: [greenMin, amberMin] — below amberMin = red */
  bands?: [number, number];
  /** Unit for display */
  unit: "%" | "R" | "days" | "count" | "ratio";
  /** Higher is better (true) or lower is better (false) */
  higherIsBetter: boolean;
  /** Whether this KPI has provisional/incomplete data */
  provisional?: boolean;
}

// ── Department Weights for Company Score ─────────────────────────────
export const DEPARTMENT_WEIGHTS: Record<Department, number> = {
  "Project Development": 15,
  "Project Delivery": 20,
  "Engineering": 15,
  "HSE": 10,
  "Quality": 15,
  "Finance": 25,
};

// ── RAG Score Bands ─────────────────────────────────────────────────
export const RAG_BANDS = {
  green: { min: 85, max: 100 },
  amber: { min: 70, max: 84 },
  red: { min: 0, max: 69 },
} as const;

export function scoreToRag(score: number): RagStatus {
  if (score >= RAG_BANDS.green.min) return "green";
  if (score >= RAG_BANDS.amber.min) return "amber";
  return "red";
}

// ── KPI Definitions ─────────────────────────────────────────────────

export const KPI_REGISTRY: KpiDefinition[] = [
  // ─── Project Development ───────────────────────────────────────────
  {
    kpiKey: "pd_signed_pipeline_vs_target",
    kpiName: "Signed Pipeline Value vs FYTD Target",
    department: "Project Development",
    weight: 25,
    normalization: "percentage_vs_target",
    unit: "R",
    higherIsBetter: true,
  },
  {
    kpiKey: "pd_deal_conversion_rate",
    kpiName: "Deal Conversion Rate",
    department: "Project Development",
    weight: 20,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },
  {
    kpiKey: "pd_active_deal_ageing",
    kpiName: "Active Deal Ageing",
    department: "Project Development",
    weight: 20,
    normalization: "inverse_days",
    inverseCeiling: 180,
    unit: "days",
    higherIsBetter: false,
  },
  {
    kpiKey: "pd_blocked_deal_count",
    kpiName: "Blocked Deal Count",
    department: "Project Development",
    weight: 15,
    normalization: "inverse_count",
    inverseCeiling: 10,
    unit: "count",
    higherIsBetter: false,
  },
  {
    kpiKey: "pd_handover_completeness",
    kpiName: "Handover Completeness to Projects",
    department: "Project Development",
    weight: 20,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },

  // ─── Project Delivery ──────────────────────────────────────────────
  {
    kpiKey: "del_projects_on_track",
    kpiName: "Projects on Track %",
    department: "Project Delivery",
    weight: 25,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },
  {
    kpiKey: "del_inflow_milestone_adherence",
    kpiName: "Inflow Milestone Adherence",
    department: "Project Delivery",
    weight: 20,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },
  {
    kpiKey: "del_blocked_gates",
    kpiName: "Blocked Gates Count / Rate",
    department: "Project Delivery",
    weight: 20,
    normalization: "inverse_count",
    inverseCeiling: 15,
    unit: "count",
    higherIsBetter: false,
  },
  {
    kpiKey: "del_practical_completion_on_time",
    kpiName: "Practical Completion on Time %",
    department: "Project Delivery",
    weight: 20,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },
  {
    kpiKey: "del_weekly_client_update_compliance",
    kpiName: "Weekly Client Update Compliance",
    department: "Project Delivery",
    weight: 15,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },

  // ─── Engineering ───────────────────────────────────────────────────
  {
    kpiKey: "eng_design_turnaround",
    kpiName: "Design Turnaround Time",
    department: "Engineering",
    weight: 20,
    normalization: "inverse_days",
    inverseCeiling: 30,
    unit: "days",
    higherIsBetter: false,
  },
  {
    kpiKey: "eng_first_pass_approval",
    kpiName: "First-Pass Approval Rate",
    department: "Engineering",
    weight: 25,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },
  {
    kpiKey: "eng_overdue_tasks",
    kpiName: "Overdue Engineering Tasks",
    department: "Engineering",
    weight: 20,
    normalization: "inverse_count",
    inverseCeiling: 20,
    unit: "count",
    higherIsBetter: false,
  },
  {
    kpiKey: "eng_rework_rate",
    kpiName: "Rework Rate",
    department: "Engineering",
    weight: 15,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: false,
  },
  {
    kpiKey: "eng_deliverable_completeness",
    kpiName: "Deliverable Completeness",
    department: "Engineering",
    weight: 20,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },

  // ─── HSE ───────────────────────────────────────────────────────────
  {
    kpiKey: "hse_serious_incident_count",
    kpiName: "Serious Incident Count",
    department: "HSE",
    weight: 25,
    normalization: "inverse_count",
    inverseCeiling: 5,
    unit: "count",
    higherIsBetter: false,
    provisional: true,
  },
  {
    kpiKey: "hse_overdue_corrective_actions",
    kpiName: "Overdue Corrective Actions",
    department: "HSE",
    weight: 25,
    normalization: "inverse_count",
    inverseCeiling: 10,
    unit: "count",
    higherIsBetter: false,
    provisional: true,
  },
  {
    kpiKey: "hse_site_audit_pass_rate",
    kpiName: "Site Audit Pass Rate",
    department: "HSE",
    weight: 20,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
    provisional: true,
  },
  {
    kpiKey: "hse_toolbox_compliance",
    kpiName: "Toolbox / Compliance Completion",
    department: "HSE",
    weight: 15,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
    provisional: true,
  },
  {
    kpiKey: "hse_safety_file_completeness",
    kpiName: "Safety File Completeness",
    department: "HSE",
    weight: 15,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
    provisional: true,
  },

  // ─── Quality ───────────────────────────────────────────────────────
  {
    kpiKey: "qual_red_team_pass_rate",
    kpiName: "Red Team First-Pass Pass Rate",
    department: "Quality",
    weight: 25,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },
  {
    kpiKey: "qual_snag_closeout_ageing",
    kpiName: "Snag Closeout Ageing",
    department: "Quality",
    weight: 20,
    normalization: "inverse_days",
    inverseCeiling: 60,
    unit: "days",
    higherIsBetter: false,
  },
  {
    kpiKey: "qual_ho_pack_pass_rate",
    kpiName: "HO Pack First-Pass Pass Rate",
    department: "Quality",
    weight: 20,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },
  {
    kpiKey: "qual_phase_evidence_completeness",
    kpiName: "Phase Evidence Completeness",
    department: "Quality",
    weight: 15,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: true,
  },
  {
    kpiKey: "qual_repeat_defect_rate",
    kpiName: "Repeat Defect Rate",
    department: "Quality",
    weight: 20,
    normalization: "percentage_direct",
    unit: "%",
    higherIsBetter: false,
  },

  // ─── Finance ───────────────────────────────────────────────────────
  {
    kpiKey: "fin_revenue_vs_target",
    kpiName: "Revenue Actual vs FYTD Target",
    department: "Finance",
    weight: 25,
    normalization: "percentage_vs_target",
    unit: "R",
    higherIsBetter: true,
  },
  {
    kpiKey: "fin_cash_collected_vs_target",
    kpiName: "Cash Collected vs FYTD Target",
    department: "Finance",
    weight: 20,
    normalization: "percentage_vs_target",
    unit: "R",
    higherIsBetter: true,
  },
  {
    kpiKey: "fin_cos_vs_target",
    kpiName: "COS Realised vs FYTD Target",
    department: "Finance",
    weight: 20,
    normalization: "percentage_vs_target",
    unit: "R",
    higherIsBetter: false,
  },
  {
    kpiKey: "fin_gross_margin_vs_target",
    kpiName: "Gross Margin % vs Target",
    department: "Finance",
    weight: 20,
    normalization: "percentage_vs_target",
    unit: "%",
    higherIsBetter: true,
  },
  {
    kpiKey: "fin_overdue_debtors",
    kpiName: "Overdue Debtors",
    department: "Finance",
    weight: 15,
    normalization: "inverse_count",
    inverseCeiling: 10000000, // R10M ceiling
    unit: "R",
    higherIsBetter: false,
  },
];

// ── Lookup helpers ──────────────────────────────────────────────────

export function getKpisByDepartment(dept: Department): KpiDefinition[] {
  return KPI_REGISTRY.filter((k) => k.department === dept);
}

export function getKpiByKey(key: string): KpiDefinition | undefined {
  return KPI_REGISTRY.find((k) => k.kpiKey === key);
}

export const ALL_DEPARTMENTS: Department[] = [
  "Project Development",
  "Project Delivery",
  "Engineering",
  "HSE",
  "Quality",
  "Finance",
];

// ── KPI Normalization ───────────────────────────────────────────────

/**
 * Normalize a raw KPI value to a 0-100 score using the definition's method.
 * Returns null if value is unavailable.
 */
export function normalizeKpiValue(
  def: KpiDefinition,
  actual: number | null | undefined,
  target?: number | null,
): number | null {
  if (actual == null) return null;

  switch (def.normalization) {
    case "percentage_direct": {
      // Value is already 0-100 (or 0-1 for rates)
      const pct = actual > 1 && actual <= 100 ? actual : actual * 100;
      // If lower is better (e.g., rework rate), invert
      const score = def.higherIsBetter ? pct : 100 - pct;
      return Math.max(0, Math.min(100, score));
    }
    case "percentage_vs_target": {
      if (!target || target === 0) return null;
      const ratio = actual / target;
      // For costs (lower is better), being under target is good
      if (!def.higherIsBetter) {
        // Under target = good. Ratio < 1 = score > 100 (capped). Ratio > 1 = progressively worse.
        const score = ratio <= 1 ? 100 : Math.max(0, 100 - (ratio - 1) * 200);
        return Math.max(0, Math.min(100, score));
      }
      // Revenue/margin: ratio near 1 = 100, below 1 = proportionally lower
      return Math.max(0, Math.min(100, ratio * 100));
    }
    case "inverse_count": {
      const ceiling = def.inverseCeiling ?? 10;
      if (actual <= 0) return 100;
      if (actual >= ceiling) return 0;
      return Math.round(((ceiling - actual) / ceiling) * 100);
    }
    case "inverse_days": {
      const ceiling = def.inverseCeiling ?? 30;
      if (actual <= 0) return 100;
      if (actual >= ceiling) return 0;
      return Math.round(((ceiling - actual) / ceiling) * 100);
    }
    case "threshold_bands": {
      if (!def.bands) return null;
      const [greenMin, amberMin] = def.bands;
      if (actual >= greenMin) return 100;
      if (actual >= amberMin) return 75;
      return 40;
    }
    default:
      return null;
  }
}

// ── Department Score Calculation ─────────────────────────────────────

export interface KpiScore {
  kpiKey: string;
  kpiName: string;
  actual: number | null;
  target: number | null;
  score: number | null;
  weight: number;
  trend?: "up" | "down" | "flat";
  provisional?: boolean;
}

export interface DepartmentScore {
  department: Department;
  score: number | null;
  rag: RagStatus;
  kpis: KpiScore[];
  dataAvailable: boolean;
  provisional: boolean;
}

export function calculateDepartmentScore(
  department: Department,
  kpiValues: Map<string, { actual: number | null; target?: number | null; trend?: "up" | "down" | "flat" }>,
): DepartmentScore {
  const defs = getKpisByDepartment(department);
  const kpis: KpiScore[] = [];
  let weightedSum = 0;
  let weightTotal = 0;
  let hasAnyData = false;

  for (const def of defs) {
    const val = kpiValues.get(def.kpiKey);
    const actual = val?.actual ?? null;
    const target = val?.target ?? null;
    const score = normalizeKpiValue(def, actual, target);

    kpis.push({
      kpiKey: def.kpiKey,
      kpiName: def.kpiName,
      actual,
      target,
      score,
      weight: def.weight,
      trend: val?.trend,
      provisional: def.provisional,
    });

    if (score != null) {
      weightedSum += score * def.weight;
      weightTotal += def.weight;
      hasAnyData = true;
    }
  }

  const departmentScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;
  const provisional = defs.some((d) => d.provisional);

  return {
    department,
    score: departmentScore,
    rag: departmentScore != null ? scoreToRag(departmentScore) : "red",
    kpis,
    dataAvailable: hasAnyData,
    provisional,
  };
}

// ── Company Score Calculation ────────────────────────────────────────

export function calculateCompanyScore(
  departmentScores: DepartmentScore[],
): { score: number | null; rag: RagStatus } {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const ds of departmentScores) {
    if (ds.score == null) continue;
    // Exclude HSE if provisional and incomplete data
    if (ds.department === "HSE" && ds.provisional && !ds.dataAvailable) continue;

    const weight = DEPARTMENT_WEIGHTS[ds.department];
    weightedSum += ds.score * weight;
    weightTotal += weight;
  }

  if (weightTotal === 0) return { score: null, rag: "red" };

  const score = Math.round(weightedSum / weightTotal);
  return { score, rag: scoreToRag(score) };
}

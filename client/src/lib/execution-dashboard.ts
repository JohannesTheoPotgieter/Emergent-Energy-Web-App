export interface BaseExecutionProject {
  id: number | null;
  projectName: string;
  sizeKwp: string | null;
  pd: string | null;
  pm: string | null;
  contractValue: string | null;
  phase: string | null;
  isActive: boolean;
  escalationLevel: string | null;
  ragStatus: string | null;
  executionEnabled: boolean;
  executionGateStatus: string;
  signedStatus: string;
  executionPhase: string | null;
  archivedStatus: string;
  hasTracker: boolean;
  planTotal: number;
  planAvgPct: number;
  projectPctComplete: number | null;
  expectedPctComplete: number | null;
  totalRevenue: number;
  invoicedRevenue: number;
  receivedRevenue: number;
  totalCost: number;
  invoicedCost: number;
  paidCost: number;
  gpPct: number | null;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  clientHandoverDate: string | null;
  executionEligibilityReasons?: string[];
}

export interface DerivedExecutionProject extends BaseExecutionProject {
  cleanName: string;
  contractValueNum: number;
  actualPct: number | null;
  expectedPct: number | null;
  scheduleVariancePct: number | null;
  revenueNotYetInvoiced: number;
  revenueInvoicedUnpaid: number;
  revenueRemainingToCollect: number;
  costNotYetInvoiced: number;
  costInvoicedUnpaid: number;
  costRemainingToPay: number;
  isBehindSchedule: boolean;
  isRed: boolean;
  isAmber: boolean;
  isGreen: boolean;
  hasEscalation: boolean;
  isMarginRisk: boolean;
  isCashRisk: boolean;
  isCommissioningDueSoon: boolean;
  isHandoverDueSoon: boolean;
  isConstructionDateMissing: boolean;
  isExecutionDateRisk: boolean;
  exceptions: string[];
}

export interface ExecutionFilters {
  search: string;
  executionPhase: string;
  pm: string;
  rag: string;
  gateStatus: string;
  exceptionOnly: boolean;
  behindScheduleOnly: boolean;
  marginRiskOnly: boolean;
  cashRiskOnly: boolean;
  commissioningDueOnly: boolean;
  handoverDueOnly: boolean;
}

const cleanNum = (value: number | null | undefined): number => Number.isFinite(value) ? Number(value) : 0;

export function cleanProjectName(name: string): string {
  return (name || "").replace(/_Tracker$/i, "").replace(/_/g, " ").trim();
}

export function formatCurrencyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `R${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R${(value / 1_000).toFixed(0)}K`;
  return `R${value.toFixed(0)}`;
}

export function formatCurrencyFull(value: number): string {
  return `R${value.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

export function isDateWithinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  end.setDate(end.getDate() + days);
  return date >= now && date <= end;
}

function normalizePhase(value: string | null): string {
  if (!value) return "Awaiting Phase";
  const phase = value.toLowerCase();
  if (phase.includes("planning")) return "Planning";
  if (phase.includes("procure")) return "Procurement Ready";
  if (phase.includes("construction ready")) return "Construction Ready";
  if (phase.includes("in construction") || phase.includes("construction")) return "In Construction";
  if (phase.includes("commission")) return "Commissioning";
  if (phase.includes("snag") || phase.includes("qa")) return "QA / Snag";
  if (phase.includes("handover")) return "Handover";
  return "Other";
}

export function deriveExecutionProjectMetrics(project: BaseExecutionProject): DerivedExecutionProject {
  const totalRevenue = cleanNum(project.totalRevenue);
  const invoicedRevenue = cleanNum(project.invoicedRevenue);
  const receivedRevenue = cleanNum(project.receivedRevenue);
  const totalCost = cleanNum(project.totalCost);
  const invoicedCost = cleanNum(project.invoicedCost);
  const paidCost = cleanNum(project.paidCost);
  const contractValueNum = Number.parseFloat(project.contractValue || "0") || 0;

  const actualPct = project.projectPctComplete !== null ? Math.round(project.projectPctComplete * 100) : null;
  const expectedPct = project.expectedPctComplete !== null ? Math.round(project.expectedPctComplete * 100) : null;
  const scheduleVariancePct = actualPct !== null && expectedPct !== null ? actualPct - expectedPct : null;
  const isBehindSchedule =
    project.projectPctComplete !== null &&
    project.expectedPctComplete !== null &&
    project.projectPctComplete < project.expectedPctComplete - 0.05;

  // Canonical finance formulas to avoid "revenue outstanding" ambiguity.
  const revenueNotYetInvoiced = Math.max(totalRevenue - invoicedRevenue, 0);
  const revenueInvoicedUnpaid = Math.max(invoicedRevenue - receivedRevenue, 0);
  const revenueRemainingToCollect = Math.max(totalRevenue - receivedRevenue, 0);

  const costNotYetInvoiced = Math.max(totalCost - invoicedCost, 0);
  const costInvoicedUnpaid = Math.max(invoicedCost - paidCost, 0);
  const costRemainingToPay = Math.max(totalCost - paidCost, 0);

  const escalation = (project.escalationLevel || "").trim().toLowerCase();
  const hasEscalation = escalation !== "" && escalation !== "none";
  const isMarginRisk = project.gpPct !== null && project.gpPct < 20;
  const isCashRisk = revenueInvoicedUnpaid > 0;
  const isCommissioningDueSoon = isDateWithinDays(project.commissioningDate, 14);
  const isHandoverDueSoon = isDateWithinDays(project.clientHandoverDate, 30);
  const isConstructionDateMissing = project.executionEnabled && !project.constructionStartDate;
  const isExecutionDateRisk = isBehindSchedule && (isCommissioningDueSoon || isHandoverDueSoon);

  const exceptions: string[] = [];
  if (isBehindSchedule) exceptions.push("Behind schedule");
  if (isMarginRisk) exceptions.push("Margin risk");
  if (isCashRisk) exceptions.push("Cash collection risk");
  if (isCommissioningDueSoon) exceptions.push("Commissioning due soon");
  if (isHandoverDueSoon) exceptions.push("Handover due soon");
  if (isConstructionDateMissing) exceptions.push("Missing construction start");
  if (isExecutionDateRisk) exceptions.push("Date pressure with schedule slippage");
  if (hasEscalation) exceptions.push("Escalation present");

  const rag = project.ragStatus || "";
  return {
    ...project,
    cleanName: cleanProjectName(project.projectName),
    contractValueNum,
    actualPct,
    expectedPct,
    scheduleVariancePct,
    revenueNotYetInvoiced,
    revenueInvoicedUnpaid,
    revenueRemainingToCollect,
    costNotYetInvoiced,
    costInvoicedUnpaid,
    costRemainingToPay,
    isBehindSchedule,
    isRed: rag === "Red",
    isAmber: rag === "Amber",
    isGreen: rag === "Green",
    hasEscalation,
    isMarginRisk,
    isCashRisk,
    isCommissioningDueSoon,
    isHandoverDueSoon,
    isConstructionDateMissing,
    isExecutionDateRisk,
    exceptions,
  };
}

export function filterExecutionProjects(projects: DerivedExecutionProject[], filters: ExecutionFilters): DerivedExecutionProject[] {
  const search = filters.search.trim().toLowerCase();
  return projects.filter((project) => {
    if (search) {
      const haystack = `${project.cleanName} ${project.pm || ""} ${project.pd || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filters.executionPhase !== "all") {
      const phase = normalizePhase(project.executionPhase);
      if (filters.executionPhase === "Awaiting Phase") {
        if (project.executionPhase) return false;
      } else if (phase !== filters.executionPhase) {
        return false;
      }
    }
    if (filters.pm !== "all" && (project.pm || "Unassigned") !== filters.pm) return false;
    if (filters.rag !== "all" && (project.ragStatus || "Unknown") !== filters.rag) return false;
    if (filters.gateStatus !== "all" && (project.executionGateStatus || "NOT_ELIGIBLE") !== filters.gateStatus) return false;
    if (filters.exceptionOnly && project.exceptions.length === 0) return false;
    if (filters.behindScheduleOnly && !project.isBehindSchedule) return false;
    if (filters.marginRiskOnly && !project.isMarginRisk) return false;
    if (filters.cashRiskOnly && !project.isCashRisk) return false;
    if (filters.commissioningDueOnly && !project.isCommissioningDueSoon) return false;
    if (filters.handoverDueOnly && !project.isHandoverDueSoon) return false;
    return true;
  });
}

export function groupProjectsByExecutionPhase(projects: DerivedExecutionProject[]): Record<string, DerivedExecutionProject[]> {
  const ordered = ["Awaiting Phase", "Planning", "Procurement Ready", "Construction Ready", "In Construction", "Commissioning", "QA / Snag", "Handover", "Other"];
  const grouped: Record<string, DerivedExecutionProject[]> = Object.fromEntries(ordered.map((phase) => [phase, []]));
  projects.forEach((project) => {
    grouped[normalizePhase(project.executionPhase)]?.push(project);
  });
  return grouped;
}

export function groupProjectsByPm(projects: DerivedExecutionProject[]): Record<string, DerivedExecutionProject[]> {
  return projects.reduce<Record<string, DerivedExecutionProject[]>>((acc, project) => {
    const key = project.pm || "Unassigned";
    if (!acc[key]) acc[key] = [];
    acc[key].push(project);
    return acc;
  }, {});
}

export function aggregateExecutionStats(projects: DerivedExecutionProject[]) {
  const withActual = projects.filter((p) => p.actualPct !== null);
  const weightedCompletion = withActual.length
    ? Math.round(withActual.reduce((sum, p) => sum + (p.actualPct || 0), 0) / withActual.length)
    : 0;

  const totals = projects.reduce((acc, project) => {
    acc.contractValue += project.contractValueNum;
    acc.totalRevenue += project.totalRevenue;
    acc.totalCost += project.totalCost;
    acc.revenueRemaining += project.revenueRemainingToCollect;
    acc.invoicedUnpaid += project.revenueInvoicedUnpaid;
    acc.costRemaining += project.costRemainingToPay;
    acc.costInvoicedUnpaid += project.costInvoicedUnpaid;
    if (project.isRed) acc.redProjects += 1;
    if (project.hasEscalation) acc.escalations += 1;
    if (project.executionGateStatus === "ENABLED") acc.enabled += 1;
    if (project.executionGateStatus === "ELIGIBLE") acc.eligible += 1;
    if (project.executionGateStatus === "NOT_ELIGIBLE") acc.notEligible += 1;
    if (project.isBehindSchedule) acc.behind += 1;
    if (project.isMarginRisk) acc.marginRisk += 1;
    if (project.isCashRisk) acc.cashRisk += 1;
    if (project.isCommissioningDueSoon || project.isHandoverDueSoon) acc.keyDatesDue += 1;
    return acc;
  }, {
    contractValue: 0,
    totalRevenue: 0,
    totalCost: 0,
    revenueRemaining: 0,
    invoicedUnpaid: 0,
    costRemaining: 0,
    costInvoicedUnpaid: 0,
    redProjects: 0,
    escalations: 0,
    enabled: 0,
    eligible: 0,
    notEligible: 0,
    behind: 0,
    marginRisk: 0,
    cashRisk: 0,
    keyDatesDue: 0,
  });

  const overallGpPct = totals.totalRevenue > 0
    ? ((totals.totalRevenue - totals.totalCost) / totals.totalRevenue) * 100
    : null;

  return {
    totalProjects: projects.length,
    weightedCompletion,
    overallGpPct,
    ...totals,
  };
}

export function getProjectExceptionFlags(project: DerivedExecutionProject): string[] {
  return project.exceptions;
}

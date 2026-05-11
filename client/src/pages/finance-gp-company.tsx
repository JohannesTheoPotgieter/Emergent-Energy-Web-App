/**
 * Finance — Company-wide GP Tracking
 *
 * Sibling tab to Cashflow / COS / Revenue under Finance > company.
 * Uses the same FinanceShell + SectionHeader + KPI strip + monthly
 * grid pattern as the COS and Revenue pages so the visual language
 * is consistent.
 *
 * Numbers come from the canonical line-level API (§ 3.3) via
 * /api/finance/lines?projectIds=… — Σ projects (Σ lines), no
 * cross-project pooling. Drill-down to per-project is on /finance/gp.
 */
import React, { useMemo } from "react";
import { Link } from "wouter";
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  AlertTriangle,
  BarChart3,
  TrendingUp,
  Wallet,
  ListChecks,
  PieChart,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { fetchQueryFn } from "@/lib/queryClient";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { SectionHeader, KPIStrip } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

interface MonthlyRow {
  monthKey: string;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
  plannedCos?: number;
  plannedRevenue?: number;
  plannedGp?: number;
  plannedGpPct?: number | null;
  realisedCos?: number;
  realisedRevenue?: number;
  realisedGp?: number;
  realisedGpPct?: number | null;
}

interface PortfolioProjectTotals {
  projectId: number;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
  plannedCos?: number;
  plannedRevenue?: number;
  plannedGp?: number;
  plannedGpPct?: number | null;
  realisedCos?: number;
  realisedRevenue?: number;
  realisedGp?: number;
  realisedGpPct?: number | null;
}

interface BudgetByMonth {
  cos: Record<string, number>;
  revenue: Record<string, number>;
}

interface PortfolioResponse {
  projectIds: number[];
  byProject: PortfolioProjectTotals[];
  monthly: MonthlyRow[];
  unrecognised: MonthlyRow;
  total: MonthlyRow;
  budgetByMonth?: BudgetByMonth;
}

interface CategoryHealthEntry {
  projectId: number;
  projectName: string;
  status: "healthy" | "partial" | "missing" | "no_lines";
  allocations: number;
  allocationsWithRevenue: number;
  parentLines: number;
  linesWithoutAllocation: number;
  actualsRows: number;
}

interface CategoryHealthResponse {
  summary: { total: number; healthy: number; partial: number; missing: number; noLines: number };
  projects: CategoryHealthEntry[];
}

const ZAR = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatRand(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return ZAR.format(val);
}

function formatPct(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtMonthLabel(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;
  const [y, m] = monthKey.split("-");
  return `${SHORT_MONTHS[Number(m) - 1]} '${y.slice(2)}`;
}

const FY_START = "2025-09";

function buildFyMonths(): Array<{ key: string; label: string }> {
  const months: Array<{ key: string; label: string }> = [];
  const [yStr, mStr] = FY_START.split("-");
  const startY = Number(yStr);
  const startM = Number(mStr);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(startY, startM - 1 + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    months.push({ key, label: fmtMonthLabel(key) });
  }
  return months;
}

interface FyKpiCardProps {
  label: string;
  source: "App" | "QB" | "Budget" | "Derived";
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  accent: string;
  fyValue: number;
  lastValue: number;
  prevValue: number;
  format?: (v: number) => string;
  description?: string;
  testId: string;
}

function FyKpiCard({
  label,
  source,
  icon: Icon,
  iconBg,
  accent,
  fyValue,
  lastValue,
  prevValue,
  format = formatRand,
  description,
  testId,
}: FyKpiCardProps) {
  const delta = lastValue - prevValue;
  const deltaPct = prevValue !== 0 ? (delta / Math.abs(prevValue)) * 100 : 0;
  const deltaPositive = delta >= 0;
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${iconBg}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground leading-tight">
              {label}
            </p>
            {description && (
              <p className="text-[10px] text-muted-foreground/80 leading-tight">{description}</p>
            )}
          </div>
          <Badge
            variant="outline"
            className="ml-auto text-[9px] font-medium px-1.5 py-0 border-border bg-card text-muted-foreground"
            data-testid={`badge-source-${testId}`}
          >
            {source}
          </Badge>
        </div>
        <p
          className={`text-2xl sm:text-3xl font-bold font-mono tracking-tight ${accent}`}
          data-testid={`text-fy-${testId}-value`}
        >
          {format(fyValue)}
        </p>
        <div className="flex items-center gap-2 mt-2 text-[11px]">
          <span className="text-muted-foreground">Last mo.</span>
          <span className="font-mono font-semibold">{format(lastValue)}</span>
          {prevValue !== 0 && (
            <span
              className={`inline-flex items-center gap-0.5 font-medium ${
                deltaPositive ? "text-emerald-700" : "text-destructive"
              }`}
            >
              {deltaPositive ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {Math.abs(deltaPct).toFixed(1)}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface MetricRow {
  key: string;
  label: string;
  emphasis?: boolean;
  group?: "budget" | "planned" | "realised";
  format: (v: number) => string;
  getValue: (m: MonthlyRow, budget: BudgetByMonth | undefined) => number;
}

const budgetRev = (m: MonthlyRow, budget: BudgetByMonth | undefined): number =>
  budget?.revenue[m.monthKey] ?? 0;
const budgetCos = (m: MonthlyRow, budget: BudgetByMonth | undefined): number =>
  budget?.cos[m.monthKey] ?? 0;
const budgetGp = (m: MonthlyRow, budget: BudgetByMonth | undefined): number =>
  budgetRev(m, budget) - budgetCos(m, budget);
const budgetMargin = (m: MonthlyRow, budget: BudgetByMonth | undefined): number => {
  const r = budgetRev(m, budget);
  return r !== 0 ? budgetGp(m, budget) / r : 0;
};

/**
 * Metric grid mirrors the Revenue / COS pages — three groups (Budget,
 * Planned, Realised) with Revenue / COS / GP / Margin % rows in each.
 *
 *   Budget   — STATIC_COS_BUDGET_FY26 + manual entries (same source the
 *              COS / Revenue tabs use, so numbers reconcile)
 *   Planned  — Σ line.actualTotal + Σ (Q/X)*J across every line — the
 *              full app baseline matching what the COS tab calls
 *              "Planned" (realised + committed + planned-no-invoice)
 *   Realised — Σ same, but only lines where bucket = "realised"
 *              (invoice + invoice-date BLACK / past-month auto-promote,
 *              matching the COS tab's Realised number)
 */
const METRIC_ROWS: MetricRow[] = [
  // Budget block (from STATIC_COS_BUDGET_FY26 + manual entries)
  { key: "budgetRevenue", group: "budget", label: "Budget Revenue", format: formatRand, getValue: budgetRev },
  { key: "budgetCos", group: "budget", label: "Budget COS", format: formatRand, getValue: budgetCos },
  { key: "budgetGp", group: "budget", label: "Budget GP", emphasis: true, format: formatRand, getValue: budgetGp },
  { key: "budgetMargin", group: "budget", label: "Budget Margin %", format: (v) => formatPct(v), getValue: budgetMargin },
  // Planned block (was "Actual" — renamed to match COS / Revenue terminology)
  { key: "revenue", group: "planned", label: "Planned Revenue", format: formatRand, getValue: (m) => m.revenue },
  { key: "cos", group: "planned", label: "Planned COS", format: formatRand, getValue: (m) => m.cos },
  { key: "gp", group: "planned", label: "Planned GP", emphasis: true, format: formatRand, getValue: (m) => m.gp },
  { key: "gpPct", group: "planned", label: "Planned Margin %", format: (v) => formatPct(v), getValue: (m) => m.gpPct ?? 0 },
  // Realised block — bucket = "realised" only
  { key: "realisedRevenue", group: "realised", label: "Realised Revenue", format: formatRand, getValue: (m) => m.realisedRevenue ?? 0 },
  { key: "realisedCos", group: "realised", label: "Realised COS", format: formatRand, getValue: (m) => m.realisedCos ?? 0 },
  { key: "realisedGp", group: "realised", label: "Realised GP", emphasis: true, format: formatRand, getValue: (m) => m.realisedGp ?? 0 },
  { key: "realisedGpPct", group: "realised", label: "Realised Margin %", format: (v) => formatPct(v), getValue: (m) => m.realisedGpPct ?? 0 },
  // Trailing line count
  { key: "count", label: "Lines", format: (v) => v.toLocaleString("en-ZA"), getValue: (m) => m.count },
];

export default function FinanceGpCompanyPage() {
  const { data: health, isLoading: healthLoading, isError: healthError, refetch: refetchHealth, error } =
    useQuery<CategoryHealthResponse>({
      queryKey: ["/api/finance/category-allocation-health"],
      queryFn: fetchQueryFn("/api/finance/category-allocation-health"),
      staleTime: 5 * 60_000,
    });

  const projectsWithLines = useMemo(() => {
    if (!health) return [] as CategoryHealthEntry[];
    return health.projects.filter((p) => p.actualsRows > 0 || p.parentLines > 0);
  }, [health]);

  const projectIds = useMemo(() => projectsWithLines.map((p) => p.projectId), [projectsWithLines]);
  const queryString = projectIds.length > 0 ? `?projectIds=${projectIds.join(",")}` : "";
  const {
    data,
    isLoading: linesLoading,
    isError: linesError,
    refetch: refetchLines,
  } = useQuery<PortfolioResponse>({
    queryKey: [`/api/finance/lines${queryString}`],
    queryFn: fetchQueryFn(`/api/finance/lines${queryString}`),
    enabled: projectIds.length > 0,
    staleTime: 60_000,
  });

  const projectNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of projectsWithLines) map.set(p.projectId, p.projectName);
    return map;
  }, [projectsWithLines]);

  const healthById = useMemo(() => {
    const map = new Map<number, CategoryHealthEntry>();
    for (const p of projectsWithLines) map.set(p.projectId, p);
    return map;
  }, [projectsWithLines]);

  // Build a 12-month FY frame from Sep '25 through Aug '26 so columns line up
  // with the COS / Revenue pages even if some months have no data yet.
  const fyMonths = useMemo(() => buildFyMonths(), []);
  const monthlyByKey = useMemo(() => {
    const map = new Map<string, MonthlyRow>();
    if (data) for (const m of data.monthly) map.set(m.monthKey, m);
    return map;
  }, [data]);
  const fyMonthRows: MonthlyRow[] = useMemo(
    () =>
      fyMonths.map(
        (m) =>
          monthlyByKey.get(m.key) ?? {
            monthKey: m.key,
            cos: 0,
            revenue: 0,
            gp: 0,
            gpPct: null,
            count: 0,
            plannedCos: 0,
            plannedRevenue: 0,
            plannedGp: 0,
            plannedGpPct: null,
            realisedCos: 0,
            realisedRevenue: 0,
            realisedGp: 0,
            realisedGpPct: null,
          },
      ),
    [fyMonths, monthlyByKey],
  );

  const lastMonth = fyMonthRows[fyMonthRows.length - 1] ?? null;
  const prevMonth = fyMonthRows[fyMonthRows.length - 2] ?? null;

  // Add a synthetic `total` key to the per-month budget so the FY-total
  // column on Budget rows can look up via the same getter as monthly
  // cells. Margin % FY total = (Σ revenue − Σ cos) / Σ revenue, which
  // falls out of the formula when revenue["total"] and cos["total"] are
  // the sums.
  const budgetWithFy: BudgetByMonth | undefined = useMemo(() => {
    if (!data?.budgetByMonth) return undefined;
    const cos = { ...data.budgetByMonth.cos };
    const revenue = { ...data.budgetByMonth.revenue };
    cos.total = Object.values(data.budgetByMonth.cos).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
    revenue.total = Object.values(data.budgetByMonth.revenue).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
    return { cos, revenue };
  }, [data?.budgetByMonth]);

  const fyBudgetGp = (budgetWithFy?.revenue.total ?? 0) - (budgetWithFy?.cos.total ?? 0);
  const fyBudgetMargin =
    budgetWithFy && budgetWithFy.revenue.total !== 0
      ? fyBudgetGp / budgetWithFy.revenue.total
      : null;
  const lastBudgetMonth = lastMonth?.monthKey;
  const prevBudgetMonth = prevMonth?.monthKey;
  const budgetGpAtMonth = (mk: string | undefined): number =>
    mk && budgetWithFy
      ? (budgetWithFy.revenue[mk] ?? 0) - (budgetWithFy.cos[mk] ?? 0)
      : 0;

  const rankedProjects = useMemo(() => {
    if (!data) return [] as Array<PortfolioProjectTotals & { projectName: string; status: CategoryHealthEntry["status"] | "unknown" }>;
    return data.byProject
      .map((p) => ({
        ...p,
        projectName: projectNameById.get(p.projectId) ?? `Project #${p.projectId}`,
        status: (healthById.get(p.projectId)?.status ?? "unknown") as
          | CategoryHealthEntry["status"]
          | "unknown",
      }))
      .sort((a, b) => b.gp - a.gp);
  }, [data, projectNameById, healthById]);

  if (healthLoading || (projectIds.length > 0 && linesLoading)) {
    return (
      <FinanceShell>
        <PageSkeleton lines={5} />
      </FinanceShell>
    );
  }

  if (healthError || linesError) {
    return (
      <FinanceShell>
        <PageError
          title="Unable to load Company GP"
          message={error instanceof Error ? error.message : "Failed to fetch data"}
          onRetry={() => {
            refetchHealth();
            refetchLines();
          }}
        />
      </FinanceShell>
    );
  }

  const total = data?.total ?? { monthKey: "total", cos: 0, revenue: 0, gp: 0, gpPct: null, count: 0 };
  const fyYear = new Date().getFullYear();

  return (
    <FinanceShell>
      <div className="space-y-3">
        <SectionHeader
          icon={<BarChart3 className="h-5 w-5" />}
          title="Gross Profit FY26"
          eyebrow={`Sep ${fyYear - 1} – Aug ${fyYear}`}
          description="Per-line POC across every project (§ 3.3). Drill into a project on the GP — by project page."
          badges={[
            {
              label: `${projectIds.length} project(s)`,
              variant: "outline",
            },
          ]}
          actions={
            <Link
              href="/finance/gp"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
              data-testid="link-gp-by-project"
            >
              Drill by project <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />

        {health && health.summary.missing + health.summary.partial > 0 && (
          <Card className="border-amber-300 bg-amber-50/40">
            <CardContent className="p-3 sm:p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium">Allocation health</div>
                <div className="text-muted-foreground">
                  {health.summary.missing} project(s) missing column J · {health.summary.partial} partial ·{" "}
                  {health.summary.healthy} healthy. Projects with missing J contribute{" "}
                  <code>perLineRevenue = 0</code> rather than wrong numbers, per § 3.3 — the company total below is conservative until those workbooks ship.
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <KPIStrip className="grid-cols-2 lg:grid-cols-4">
          <FyKpiCard
            testId="budget-gp"
            label="FY Budget GP"
            source="Budget"
            icon={Wallet}
            iconBg="bg-emerald-50 text-emerald-700 border border-emerald-200"
            accent="text-emerald-700"
            fyValue={fyBudgetGp}
            lastValue={budgetGpAtMonth(lastBudgetMonth)}
            prevValue={budgetGpAtMonth(prevBudgetMonth)}
            description={`Margin ${formatPct(fyBudgetMargin)} · static + manual entries`}
          />
          <FyKpiCard
            testId="planned-gp"
            label="FY Planned GP"
            source="App"
            icon={ListChecks}
            iconBg="bg-emerald-50 text-emerald-700 border border-emerald-200"
            accent="text-emerald-700"
            fyValue={total.gp}
            lastValue={lastMonth?.gp ?? 0}
            prevValue={prevMonth?.gp ?? 0}
            description={`Margin ${formatPct(total.gpPct)} · full app baseline`}
          />
          <FyKpiCard
            testId="realised-gp"
            label="FY Realised GP"
            source="App"
            icon={TrendingUp}
            iconBg="bg-foreground/8 text-foreground"
            accent="text-foreground"
            fyValue={total.realisedGp ?? 0}
            lastValue={lastMonth?.realisedGp ?? 0}
            prevValue={prevMonth?.realisedGp ?? 0}
            description={`Margin ${formatPct(total.realisedGpPct)} · invoice + BLACK confirmed`}
          />
          <FyKpiCard
            testId="planned-margin"
            label="FY Planned Margin"
            source="Derived"
            icon={PieChart}
            iconBg="bg-slate-100 text-slate-700"
            accent="text-slate-800"
            fyValue={total.gpPct ?? 0}
            lastValue={lastMonth?.gpPct ?? 0}
            prevValue={prevMonth?.gpPct ?? 0}
            format={(v) => formatPct(v)}
            description="Planned GP / Planned Revenue"
          />
        </KPIStrip>

        <Card className="shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm" data-testid="table-gp-grid">
              <thead>
                <tr className="border-b bg-muted/80">
                  <th className="sticky left-0 z-10 bg-muted/95 backdrop-blur-sm px-3 sm:px-5 py-2 sm:py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] min-w-[140px] sm:min-w-[200px] border-r border-border">
                    Metric
                  </th>
                  {fyMonths.map((m) => (
                    <th
                      key={m.key}
                      className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] whitespace-nowrap min-w-[85px] sm:min-w-[110px]"
                    >
                      {m.label}
                    </th>
                  ))}
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] whitespace-nowrap min-w-[100px] sm:min-w-[120px] bg-muted/95 sticky right-0 border-l border-border">
                    FY Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((row, idx) => {
                  // Sniff FY total: budget rows look up `total` in the
                  // budget map (synthesized below); line-derived rows
                  // read from the `total` MonthlyRow via the getter.
                  const totalRow: MonthlyRow = { ...total, monthKey: "total" };
                  const fyTotalValue =
                    row.key === "count" ? total.count : row.getValue(totalRow, budgetWithFy);
                  const prevGroup = idx > 0 ? METRIC_ROWS[idx - 1].group : undefined;
                  const isNewGroup = row.group && row.group !== prevGroup;
                  return (
                    <tr
                      key={row.key}
                      className={`border-b last:border-0 ${row.emphasis ? "bg-emerald-50/40 font-semibold" : ""} ${isNewGroup ? "border-t-2 border-t-border/70" : ""}`}
                      data-testid={`row-${row.key}`}
                    >
                      <td className="sticky left-0 z-10 bg-card px-3 sm:px-5 py-2 sm:py-3 text-left text-foreground border-r border-border">
                        {row.label}
                      </td>
                      {fyMonthRows.map((m) => {
                        const v = row.getValue(m, budgetWithFy);
                        return (
                          <td
                            key={m.monthKey}
                            className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono whitespace-nowrap"
                            data-testid={`cell-${row.key}-${m.monthKey}`}
                          >
                            {v === 0 && !row.key.endsWith("GpPct") && !row.key.endsWith("Margin") && row.key !== "gpPct" ? "" : row.format(v)}
                          </td>
                        );
                      })}
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono whitespace-nowrap bg-muted/30 sticky right-0 border-l border-border">
                        {row.format(fyTotalValue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="shadow-sm overflow-hidden">
          <div className="px-3 sm:px-5 py-2.5 sm:py-3 border-b bg-muted/30">
            <h2 className="text-sm font-semibold tracking-tight">Projects ranked by GP</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="border-b bg-muted/80">
                  <th className="px-3 sm:px-5 py-2 sm:py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px]">
                    Project
                  </th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px]">
                    Planned GP
                  </th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px]">
                    Realised GP
                  </th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px]">
                    Margin
                  </th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px]">
                    Lines
                  </th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {rankedProjects.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 sm:px-5 py-6 text-center text-muted-foreground">
                      No projects with lines yet.
                    </td>
                  </tr>
                )}
                {rankedProjects.map((p) => (
                  <tr key={p.projectId} className="border-b last:border-0 hover:bg-muted/40" data-testid={`row-project-${p.projectId}`}>
                    <td className="px-3 sm:px-5 py-2 sm:py-3">
                      <span className="font-medium">{p.projectName}</span>
                      {p.status === "missing" && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">
                          missing J
                        </Badge>
                      )}
                      {p.status === "partial" && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          partial
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono">{formatRand(p.gp)}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono">{formatRand(p.realisedGp ?? 0)}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono">{formatPct(p.gpPct)}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono text-muted-foreground">{p.count}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-right">
                      <Link
                        href="/finance/gp"
                        className="inline-flex items-center text-emerald-600 hover:text-emerald-700"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </FinanceShell>
  );
}

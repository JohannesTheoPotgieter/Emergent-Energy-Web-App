import React, { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { useQuery } from "@tanstack/react-query";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SectionHeader } from "@/components/layout/page-shell";
import { FinancialYearScopeControl } from "@/components/finance/FinancialYearScopeControl";
import { useFinancialYearScope } from "@/hooks/use-financial-year-scope";
import { fetchQueryFn } from "@/lib/queryClient";
import { formatZar, formatZarCompact } from "@/lib/currency";
import { PageHero } from "@/components/finance/PageHero";
import { KpiTile } from "@/components/finance/KpiTile";
import { Money } from "@/components/ui/money";
import { DirectionDelta } from "@/components/finance/DirectionDelta";
import { DrillReconciliationFooter } from "@/components/finance/DrillReconciliationFooter";
import { StaleIndicator } from "@/components/finance/StaleIndicator";
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Line,
  LineChart,
} from "recharts";
import {
  TrendingUp,
  ChevronDown,
  ChevronRight,
  X,
  Search,
  Loader2,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ListChecks,
  LineChart as LineChartIcon,
  Filter,
  Wallet,
  BarChart3,
  PieChart,
} from "lucide-react";

// ── COS tracker types ────────────────────────────────────────────────────────

interface ProjBreak {
  projectName: string;
  value: number;
}

interface CosMonthData {
  monthKey: string;
  monthLabel: string;
  cosPlanned: number;
  realisedCOS: number;
  committedCOS: number;
  plannedCOS: number;
  budget: number;
  cosPlannedProjects: ProjBreak[];
  realisedProjects: ProjBreak[];
  committedProjects: ProjBreak[];
  plannedProjects: ProjBreak[];
  ytdRealised: number;
  ytdCosPlanned: number;
  ytdBudget: number;
  ytdVariance: number;
  ytdVariancePct: number;
}

// ── Revenue tracker types ────────────────────────────────────────────────────

interface RevMonthData {
  monthKey: string;
  monthLabel: string;
  totalRevenue: number;
  realisedRevenue: number;
  unrealisedRevenue: number;
  budget: number;
  revProjects: ProjBreak[];
  realisedProjects: ProjBreak[];
  unrealisedProjects: ProjBreak[];
  budgetProjects: ProjBreak[];
  ytdRealised: number;
  ytdRevenue: number;
  ytdBudget: number;
}

interface RevTrackerResponse {
  months: RevMonthData[];
  totalMilestoneRevenue: number;
  totalCOS: number;
}

// ── Derived GP month data ────────────────────────────────────────────────────

interface GpMonthData {
  monthKey: string;
  monthLabel: string;
  // Budget (manual — same source as COS/REV "Budget (Manual)" rows)
  budgetRevenue: number;
  budgetCOS: number;
  budgetGP: number;
  budgetMarginPct: number;
  // Planned (full baseline = Realised + Committed + Planned-no-invoice)
  plannedRevenue: number;
  plannedCOS: number;
  plannedGP: number;
  plannedMarginPct: number;
  // Realised (invoice + BLACK confirmed date)
  realisedRevenue: number;
  realisedCOS: number;
  realisedGP: number;
  realisedMarginPct: number;
  // Per-project GP breakdowns (for expandable rows)
  gpPlannedProjects: ProjBreak[];
  gpRealisedProjects: ProjBreak[];
  // YTD running totals
  ytdBudgetRevenue: number;
  ytdBudgetCOS: number;
  ytdBudgetGP: number;
  ytdPlannedRevenue: number;
  ytdPlannedCOS: number;
  ytdPlannedGP: number;
  ytdRealisedRevenue: number;
  ytdRealisedCOS: number;
  ytdRealisedGP: number;
}

// ── Row definitions ──────────────────────────────────────────────────────────

interface RowDef {
  key: string;
  label: string;
  dataKey: keyof GpMonthData;
  colorClass: string;
  group: "monthly" | "ytd";
  emphasis?: boolean;
  expandable?: boolean;
  projectsKey?: "gpPlannedProjects" | "gpRealisedProjects";
  isMarginPct?: boolean;
  newGroup?: boolean;
}

const ROW_DEFS: RowDef[] = [
  // ── Budget ──────────────────────────────────────────────────────────────
  { key: "budgetRevenue", label: "Budget Revenue", dataKey: "budgetRevenue", colorClass: "text-emerald-700/60", group: "monthly" },
  { key: "budgetCOS", label: "Budget COS", dataKey: "budgetCOS", colorClass: "text-emerald-700/60", group: "monthly" },
  { key: "budgetGP", label: "Budget GP", dataKey: "budgetGP", colorClass: "text-emerald-700 font-semibold", group: "monthly", emphasis: true },
  { key: "budgetMarginPct", label: "Budget Margin %", dataKey: "budgetMarginPct", colorClass: "text-muted-foreground", group: "monthly", isMarginPct: true },
  // ── Planned ─────────────────────────────────────────────────────────────
  { key: "plannedRevenue", label: "Planned Revenue", dataKey: "plannedRevenue", colorClass: "text-emerald-700 font-semibold", group: "monthly", newGroup: true },
  { key: "plannedCOS", label: "Planned COS", dataKey: "plannedCOS", colorClass: "text-foreground font-semibold", group: "monthly" },
  { key: "plannedGP", label: "Planned GP", dataKey: "plannedGP", colorClass: "text-foreground font-bold", group: "monthly", emphasis: true, expandable: true, projectsKey: "gpPlannedProjects" },
  { key: "plannedMarginPct", label: "Planned Margin %", dataKey: "plannedMarginPct", colorClass: "text-muted-foreground", group: "monthly", isMarginPct: true },
  // ── Realised ─────────────────────────────────────────────────────────────
  { key: "realisedRevenue", label: "Realised Revenue", dataKey: "realisedRevenue", colorClass: "text-foreground font-semibold", group: "monthly", newGroup: true },
  { key: "realisedCOS", label: "Realised COS", dataKey: "realisedCOS", colorClass: "text-foreground", group: "monthly" },
  { key: "realisedGP", label: "Realised GP", dataKey: "realisedGP", colorClass: "text-foreground font-bold", group: "monthly", emphasis: true, expandable: true, projectsKey: "gpRealisedProjects" },
  { key: "realisedMarginPct", label: "Realised Margin %", dataKey: "realisedMarginPct", colorClass: "text-muted-foreground", group: "monthly", isMarginPct: true },
  // ── YTD ──────────────────────────────────────────────────────────────────
  { key: "ytdBudgetGP", label: "YTD Budget GP", dataKey: "ytdBudgetGP", colorClass: "text-emerald-700", group: "ytd" },
  { key: "ytdPlannedGP", label: "YTD Planned GP", dataKey: "ytdPlannedGP", colorClass: "text-foreground font-semibold", group: "ytd" },
  { key: "ytdRealisedGP", label: "YTD Realised GP", dataKey: "ytdRealisedGP", colorClass: "text-foreground font-bold", group: "ytd" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

// Canonical precise ZAR for all cells, panels and tooltips. Absent /
// non-numeric → "—" (never "R 0"). Chart axes use formatZarCompact directly.
function formatRand(val: number | null | undefined): string {
  return formatZar(val);
}

function marginPct(gp: number, rev: number): number {
  return rev !== 0 ? (gp / rev) * 100 : 0;
}

function mergeProjectGP(revProjects: ProjBreak[], cosProjects: ProjBreak[]): ProjBreak[] {
  const cosMap = new Map(cosProjects.map((p) => [p.projectName, p.value]));
  const revMap = new Map(revProjects.map((p) => [p.projectName, p.value]));
  const allNames = new Set([...revMap.keys(), ...cosMap.keys()]);
  return Array.from(allNames)
    .map((name) => ({
      projectName: name,
      value: (revMap.get(name) ?? 0) - (cosMap.get(name) ?? 0),
    }))
    .sort((a, b) => b.value - a.value);
}

function gpCellColor(val: number): string {
  if (val < 0) return "text-destructive";
  if (val > 0) return "text-emerald-700";
  return "text-muted-foreground";
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FinanceGpCompanyPage() {
  const [, navigate] = useLocation();
  const fyScope = useFinancialYearScope();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"recon" | "trend">("recon");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const {
    data: rawCosMonths = [],
    isLoading: cosLoading,
    isError: cosError,
    refetch: refetchCos,
    dataUpdatedAt,
    isFetching,
  } = useQuery<CosMonthData[]>({
    queryKey: ["/api/cos-tracker", fyScope.apiQueryString],
    queryFn: fetchQueryFn(`/api/cos-tracker?${fyScope.apiQueryString}`),
    staleTime: 30_000,
  });

  const {
    data: revData,
    isLoading: revLoading,
    isError: revError,
    refetch: refetchRev,
  } = useQuery<RevTrackerResponse>({
    queryKey: ["/api/revenue-tracker", fyScope.apiQueryString],
    queryFn: fetchQueryFn(`/api/revenue-tracker?${fyScope.apiQueryString}`),
    staleTime: 30_000,
  });

  const { data: projectsSummary = [] } = useQuery<Array<{ project_name: string; has_tracker_import?: boolean }>>({
    queryKey: ["/api/projects-summary"],
  });

  const rawRevMonths = revData?.months ?? [];

  const trackerProjectNames = useMemo(() => {
    const set = new Set<string>();
    projectsSummary.forEach((p) => {
      if (p.project_name && p.has_tracker_import) set.add(p.project_name);
    });
    return Array.from(set).sort();
  }, [projectsSummary]);

  const filteredRailNames = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return trackerProjectNames;
    return trackerProjectNames.filter((n) => n.toLowerCase().includes(q));
  }, [trackerProjectNames, projectSearch]);

  const isProjectFiltered = selectedProjects.length > 0;

  // Build aligned GP months from COS + REV tracker data
  const allMonths = useMemo<GpMonthData[]>(() => {
    const cosMap = new Map<string, CosMonthData>(rawCosMonths.map((m) => [m.monthKey, m]));
    const revMap = new Map<string, RevMonthData>(rawRevMonths.map((m) => [m.monthKey, m]));
    // Use COS months as the ordering frame (same as the COS page)
    const keys = rawCosMonths.map((m) => m.monthKey);

    let ytdBudgetRev = 0, ytdBudgetCOS = 0;
    let ytdPlannedRev = 0, ytdPlannedCOS = 0;
    let ytdRealisedRev = 0, ytdRealisedCOS = 0;

    return keys.map((key) => {
      const cos = cosMap.get(key);
      const rev = revMap.get(key);

      const budgetRevenue = rev?.budget ?? 0;
      const budgetCOS = cos?.budget ?? 0;
      const budgetGP = budgetRevenue - budgetCOS;

      const plannedRevenue = rev?.totalRevenue ?? 0;
      const plannedCOS = cos?.cosPlanned ?? 0;
      const plannedGP = plannedRevenue - plannedCOS;

      const realisedRevenue = rev?.realisedRevenue ?? 0;
      const realisedCOS = cos?.realisedCOS ?? 0;
      const realisedGP = realisedRevenue - realisedCOS;

      const gpPlannedProjects = mergeProjectGP(rev?.revProjects ?? [], cos?.cosPlannedProjects ?? []);
      const gpRealisedProjects = mergeProjectGP(rev?.realisedProjects ?? [], cos?.realisedProjects ?? []);

      ytdBudgetRev += budgetRevenue;
      ytdBudgetCOS += budgetCOS;
      ytdPlannedRev += plannedRevenue;
      ytdPlannedCOS += plannedCOS;
      ytdRealisedRev += realisedRevenue;
      ytdRealisedCOS += realisedCOS;

      return {
        monthKey: key,
        monthLabel: cos?.monthLabel ?? rev?.monthLabel ?? key,
        budgetRevenue,
        budgetCOS,
        budgetGP,
        budgetMarginPct: marginPct(budgetGP, budgetRevenue),
        plannedRevenue,
        plannedCOS,
        plannedGP,
        plannedMarginPct: marginPct(plannedGP, plannedRevenue),
        realisedRevenue,
        realisedCOS,
        realisedGP,
        realisedMarginPct: marginPct(realisedGP, realisedRevenue),
        gpPlannedProjects,
        gpRealisedProjects,
        ytdBudgetRevenue: ytdBudgetRev,
        ytdBudgetCOS: ytdBudgetCOS,
        ytdBudgetGP: ytdBudgetRev - ytdBudgetCOS,
        ytdPlannedRevenue: ytdPlannedRev,
        ytdPlannedCOS: ytdPlannedCOS,
        ytdPlannedGP: ytdPlannedRev - ytdPlannedCOS,
        ytdRealisedRevenue: ytdRealisedRev,
        ytdRealisedCOS: ytdRealisedCOS,
        ytdRealisedGP: ytdRealisedRev - ytdRealisedCOS,
      };
    });
  }, [rawCosMonths, rawRevMonths]);

  // Apply project filter — budget falls to 0 (company-level only, same as COS/REV)
  const months = useMemo<GpMonthData[]>(() => {
    if (!isProjectFiltered) return allMonths;
    const sel = new Set(selectedProjects);
    const cosMap = new Map<string, CosMonthData>(rawCosMonths.map((m) => [m.monthKey, m]));
    const revMap = new Map<string, RevMonthData>(rawRevMonths.map((m) => [m.monthKey, m]));

    let ytdPlannedRev = 0, ytdPlannedCOS = 0;
    let ytdRealisedRev = 0, ytdRealisedCOS = 0;

    return allMonths.map((am) => {
      const cos = cosMap.get(am.monthKey);
      const rev = revMap.get(am.monthKey);

      const filterSum = (arr: ProjBreak[]) =>
        arr.filter((p) => sel.has(p.projectName)).reduce((s, p) => s + p.value, 0);
      const filterArr = (arr: ProjBreak[]) => arr.filter((p) => sel.has(p.projectName));

      const filteredRevProj = filterArr(rev?.revProjects ?? []);
      const filteredCosProj = filterArr(cos?.cosPlannedProjects ?? []);
      const plannedRevenue = filterSum(rev?.revProjects ?? []);
      const plannedCOS = filterSum(cos?.cosPlannedProjects ?? []);
      const plannedGP = plannedRevenue - plannedCOS;

      const filteredRealisedRevProj = filterArr(rev?.realisedProjects ?? []);
      const filteredRealisedCosProj = filterArr(cos?.realisedProjects ?? []);
      const realisedRevenue = filterSum(rev?.realisedProjects ?? []);
      const realisedCOS = filterSum(cos?.realisedProjects ?? []);
      const realisedGP = realisedRevenue - realisedCOS;

      ytdPlannedRev += plannedRevenue;
      ytdPlannedCOS += plannedCOS;
      ytdRealisedRev += realisedRevenue;
      ytdRealisedCOS += realisedCOS;

      return {
        ...am,
        budgetRevenue: 0,
        budgetCOS: 0,
        budgetGP: 0,
        budgetMarginPct: 0,
        plannedRevenue,
        plannedCOS,
        plannedGP,
        plannedMarginPct: marginPct(plannedGP, plannedRevenue),
        realisedRevenue,
        realisedCOS,
        realisedGP,
        realisedMarginPct: marginPct(realisedGP, realisedRevenue),
        gpPlannedProjects: mergeProjectGP(filteredRevProj, filteredCosProj),
        gpRealisedProjects: mergeProjectGP(filteredRealisedRevProj, filteredRealisedCosProj),
        ytdBudgetRevenue: 0,
        ytdBudgetCOS: 0,
        ytdBudgetGP: 0,
        ytdPlannedRevenue: ytdPlannedRev,
        ytdPlannedCOS: ytdPlannedCOS,
        ytdPlannedGP: ytdPlannedRev - ytdPlannedCOS,
        ytdRealisedRevenue: ytdRealisedRev,
        ytdRealisedCOS: ytdRealisedCOS,
        ytdRealisedGP: ytdRealisedRev - ytdRealisedCOS,
      };
    });
  }, [allMonths, isProjectFiltered, selectedProjects, rawCosMonths, rawRevMonths]);

  const lastMonth = months[months.length - 1] ?? null;
  const prevMonth = months[months.length - 2] ?? null;

  const fyTotals = useMemo(() => {
    const budgetRevenue = months.reduce((s, m) => s + m.budgetRevenue, 0);
    const budgetCOS = months.reduce((s, m) => s + m.budgetCOS, 0);
    const budgetGP = budgetRevenue - budgetCOS;
    const plannedRevenue = months.reduce((s, m) => s + m.plannedRevenue, 0);
    const plannedCOS = months.reduce((s, m) => s + m.plannedCOS, 0);
    const plannedGP = plannedRevenue - plannedCOS;
    const realisedRevenue = months.reduce((s, m) => s + m.realisedRevenue, 0);
    const realisedCOS = months.reduce((s, m) => s + m.realisedCOS, 0);
    const realisedGP = realisedRevenue - realisedCOS;
    return {
      budgetGP,
      budgetMarginPct: marginPct(budgetGP, budgetRevenue),
      plannedGP,
      plannedMarginPct: marginPct(plannedGP, plannedRevenue),
      realisedGP,
      realisedMarginPct: marginPct(realisedGP, realisedRevenue),
    };
  }, [months]);

  const projectNamesByRow = useMemo(() => {
    const trackerSet = new Set(trackerProjectNames);
    const selectedSet = new Set(selectedProjects);
    const collect = (key: "gpPlannedProjects" | "gpRealisedProjects") => {
      const names = new Set<string>();
      for (const m of months) {
        for (const p of m[key] || []) {
          if (!trackerSet.has(p.projectName)) continue;
          if (selectedSet.size > 0 && !selectedSet.has(p.projectName)) continue;
          names.add(p.projectName);
        }
      }
      return Array.from(names).sort();
    };
    return {
      gpPlannedProjects: collect("gpPlannedProjects"),
      gpRealisedProjects: collect("gpRealisedProjects"),
    };
  }, [months, trackerProjectNames, selectedProjects]);

  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const formatCell = (row: RowDef, val: number) => {
    if (row.isMarginPct) return `${val.toFixed(1)}%`;
    return formatRand(val);
  };

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        month: m.monthLabel,
        "Budget GP": isProjectFiltered ? null : m.budgetGP,
        "Planned GP": m.plannedGP,
        "Realised GP": m.realisedGP,
        "Planned Margin %": m.plannedRevenue !== 0
          ? Math.round((m.plannedGP / m.plannedRevenue) * 1000) / 10
          : null,
      })),
    [months, isProjectFiltered],
  );

  if (cosLoading || revLoading) return <PageSkeleton lines={5} />;
  if (cosError || revError) {
    return (
      <div className="p-4 md:p-6">
        <PageError
          title="Unable to load GP Tracker"
          message="Failed to fetch COS or Revenue data"
          onRetry={() => { refetchCos(); refetchRev(); }}
        />
      </div>
    );
  }

  // ── KPI cards ─────────────────────────────────────────────────────────────

  type FyCardKey = "budgetGP" | "plannedGP" | "realisedGP" | "plannedMargin";

  const FY_CARD_META: Record<FyCardKey, {
    label: string;
    source: "Budget" | "App" | "Derived";
    icon: React.ComponentType<{ className?: string }>;
    iconBg: string;
    accent: string;
    fyValue: number;
    lastValue: number;
    prevValue: number;
    format?: (v: number) => string;
    description?: string;
  }> = {
    budgetGP: {
      label: "FY Budget GP",
      source: "Budget",
      icon: Wallet,
      iconBg: "bg-emerald-50 text-emerald-700 border border-emerald-200",
      accent: "text-emerald-700",
      fyValue: fyTotals.budgetGP,
      lastValue: (lastMonth?.budgetGP ?? 0),
      prevValue: (prevMonth?.budgetGP ?? 0),
      description: `Margin ${fyTotals.budgetMarginPct.toFixed(1)}% · (G/J) × J − G`,
    },
    plannedGP: {
      label: "FY Planned GP",
      source: "App",
      icon: ListChecks,
      iconBg: "bg-emerald-50 text-emerald-700 border border-emerald-200",
      accent: "text-emerald-700",
      fyValue: fyTotals.plannedGP,
      lastValue: (lastMonth?.plannedGP ?? 0),
      prevValue: (prevMonth?.plannedGP ?? 0),
      description: `Margin ${fyTotals.plannedMarginPct.toFixed(1)}% · workbook plan`,
    },
    realisedGP: {
      label: "FY Realised GP",
      source: "App",
      icon: TrendingUp,
      iconBg: "bg-foreground/8 text-foreground",
      accent: "text-foreground",
      fyValue: fyTotals.realisedGP,
      lastValue: (lastMonth?.realisedGP ?? 0),
      prevValue: (prevMonth?.realisedGP ?? 0),
      description: `Margin ${fyTotals.realisedMarginPct.toFixed(1)}% · paid-confirmed only`,
    },
    plannedMargin: {
      label: "FY Planned Margin",
      source: "Derived",
      icon: PieChart,
      iconBg: "bg-slate-100 text-slate-700",
      accent: "text-slate-800",
      fyValue: fyTotals.plannedMarginPct,
      lastValue: (lastMonth?.plannedMarginPct ?? 0),
      prevValue: (prevMonth?.plannedMarginPct ?? 0),
      format: (v) => `${v.toFixed(1)}%`,
      description: "Planned GP / Planned Revenue",
    },
  };

  // Visual redesign — migrated to canonical <KpiTile> so the FY KPI tiles
  // on GP / COS / Revenue / FYE share one shape. Same icon + source-badge +
  // last-month delta semantics as before; rendered through the shared
  // component instead of a bespoke Card layout.
  const renderFyKpiCard = (key: FyCardKey) => {
    const meta = FY_CARD_META[key];
    const fmt = meta.format ?? formatRand;
    const deltaAbs = meta.lastValue - meta.prevValue;
    const deltaPct = meta.prevValue !== 0 ? (deltaAbs / Math.abs(meta.prevValue)) * 100 : 0;
    return (
      <KpiTile
        key={key}
        data-testid={`text-fy-${key}-value`}
        label={meta.label}
        value={fmt(meta.fyValue)}
        delta={
          meta.prevValue !== 0
            ? {
                label: "Last mo.",
                priorValue: fmt(meta.lastValue),
                pct: deltaPct,
                positiveIs: "good",
              }
            : undefined
        }
      />
    );
  };

  // ── Recon grid ────────────────────────────────────────────────────────────

  const renderGrid = () => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs sm:text-sm" data-testid="table-gp-grid">
        <thead>
          <tr className="border-b bg-muted/80">
            <th className="sticky left-0 z-10 bg-muted/95 backdrop-blur-sm px-3 sm:px-5 py-2 sm:py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] min-w-[140px] sm:min-w-[200px] border-r border-border">
              Metric
            </th>
            {months.map((m) => (
              <th key={m.monthKey} className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] whitespace-nowrap min-w-[85px] sm:min-w-[110px]">
                {m.monthLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROW_DEFS.map((row, rowIdx) => {
            const isYtd = row.group === "ytd";
            const isExpanded = expandedRows.has(row.key);
            const isFirstYtd = isYtd && rowIdx > 0 && ROW_DEFS[rowIdx - 1].group !== "ytd";

            return (
              <React.Fragment key={row.key}>
                {(isFirstYtd || (!isYtd && row.newGroup)) && (
                  <tr>
                    <td colSpan={months.length + 1} className="bg-muted/60 h-px" />
                  </tr>
                )}
                <tr
                  className={`border-b border-border transition-colors ${isYtd ? "bg-muted/40" : row.emphasis ? "bg-emerald-50/20" : "bg-card"} hover:bg-muted/40`}
                  data-testid={`row-${row.key}`}
                >
                  <td className={`sticky left-0 z-10 px-3 sm:px-5 py-2 sm:py-2.5 font-medium text-xs sm:text-sm border-r border-border ${isYtd ? "bg-muted/95" : row.emphasis ? "bg-emerald-50/30" : "bg-card/95"} backdrop-blur-sm`}>
                    {row.expandable ? (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 hover:text-emerald-700 transition-colors group"
                        onClick={() => toggleRow(row.key)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${row.label} by project`}
                        data-testid={`toggle-${row.key}`}
                      >
                        <span className="text-muted-foreground group-hover:text-emerald-600 transition-colors">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </span>
                        <span>{row.label}</span>
                      </button>
                    ) : (
                      <span className={isYtd ? "pl-5.5 text-muted-foreground" : ""}>{row.label}</span>
                    )}
                  </td>
                  {months.map((m) => {
                    const val = m[row.dataKey] as number;
                    // GP rows get sign-aware color; margin % rows get neutral color
                    const colorClass = row.isMarginPct
                      ? (val < 0 ? "text-destructive" : val > 0 ? "text-emerald-700" : "text-muted-foreground")
                      : row.emphasis
                      ? gpCellColor(val)
                      : row.colorClass;
                    return (
                      <td
                        key={m.monthKey}
                        className={`px-2 sm:px-4 py-1.5 sm:py-2.5 text-right font-mono text-xs sm:text-sm ${colorClass}`}
                        data-testid={`cell-${row.key}-${m.monthKey}`}
                      >
                        {formatCell(row, val)}
                      </td>
                    );
                  })}
                </tr>

                {row.expandable && isExpanded && row.projectsKey && (projectNamesByRow[row.projectsKey] || []).map((pName) => (
                  <tr
                    key={`${row.key}-${pName}`}
                    className="border-b border-border/40 bg-emerald-50/20 hover:bg-emerald-50/40 transition-colors"
                    data-testid={`row-detail-${row.key}-${pName}`}
                  >
                    <td className="sticky left-0 z-10 bg-emerald-50/30 backdrop-blur-sm pl-7 sm:pl-11 pr-2 sm:pr-4 py-1 sm:py-1.5 text-[10px] sm:text-xs text-muted-foreground truncate max-w-[140px] sm:max-w-[200px] border-r border-border" title={pName}>
                      <button
                        type="button"
                        className="cursor-pointer text-emerald-700 hover:text-emerald-900 hover:underline decoration-dashed underline-offset-2 transition-colors text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/project/${encodeURIComponent(pName)}?tab=revenue-tracking`);
                        }}
                        aria-label={`View ${pName} GP details`}
                      >
                        {pName}
                      </button>
                    </td>
                    {months.map((m) => {
                      const projArr = m[row.projectsKey!] as ProjBreak[];
                      const proj = projArr?.find((p) => p.projectName === pName);
                      const val = proj?.value ?? 0;
                      return (
                        <td
                          key={m.monthKey}
                          className={`px-2 sm:px-4 py-1 sm:py-1.5 text-right font-mono text-[10px] sm:text-xs ${gpCellColor(val)}/70`}
                          data-testid={`cell-detail-${row.key}-${pName}-${m.monthKey}`}
                        >
                          {val !== 0 ? formatRand(val) : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {/* Visual redesign — reconciliation footer ties the per-month GP grid back
          to the hero YTD realised GP (TF-19). */}
      <DrillReconciliationFooter
        sourceLabel="Hero · YTD GP realised"
        sourceValue={ytdRealisedGP}
        drilldownLabel={`Sum across ${months.length} months · realised GP`}
        drilldownValue={months.reduce((s, m) => s + (m.realisedGP ?? 0), 0)}
      />
    </div>
  );

  // ── Trend chart ───────────────────────────────────────────────────────────

  const renderTrend = () => (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="bg-muted/30 border-b border-border px-3 sm:px-5 py-2.5 sm:py-3">
        <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
          <LineChartIcon className="h-4 w-4 text-muted-foreground" />
          GP trend — Budget · Planned · Realised (bars) + Planned Margin % (line)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-6">
        <div className="h-[320px] sm:h-[440px]" data-testid="chart-gp">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
              <YAxis
                yAxisId="left"
                tickFormatter={(v: number) => formatZarCompact(v)}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 11, fill: "#16a34a" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: number, name: string) =>
                  name === "Planned Margin %"
                    ? [value == null ? "—" : `${value.toFixed(1)}%`, name]
                    : [formatRand(value), name]
                }
                contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", fontSize: "12px" }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
              <Bar yAxisId="left" name="Budget GP" dataKey="Budget GP" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" name="Planned GP" dataKey="Planned GP" fill="#a7f3d0" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" name="Realised GP" dataKey="Realised GP" fill="#0f172a" radius={[4, 4, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Planned Margin %"
                stroke="#dc2626"
                strokeWidth={2}
                dot={{ r: 3, fill: "#dc2626" }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );

  // ── YTD status badges ─────────────────────────────────────────────────────

  const ytdRealisedGP = lastMonth?.ytdRealisedGP ?? 0;
  const ytdPlannedGP = lastMonth?.ytdPlannedGP ?? 0;
  const ytdBudgetGP = lastMonth?.ytdBudgetGP ?? 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <FinanceShell>
      <div className="space-y-3">
        <SectionHeader
          icon={<BarChart3 className="h-5 w-5" />}
          title={`Gross Profit ${fyScope.label}`}
          eyebrow={
            fyScope.allData ? "All data in system" : `${fyScope.startDate} - ${fyScope.endDate}`
          }
          description="GP = Revenue − COS using exact same pipeline numbers as the COS and Revenue pages."
          actions={<FinancialYearScopeControl scope={fyScope} />}
        />

        {/* Visual redesign — PageHero. YTD Realised GP is the single answer.
            Margin %, planned, and budget context move into the trust column. */}
        <PageHero
          eyebrow="Finance · Gross Profit"
          label={`YTD GP realised${fyScope.label ? ` · ${fyScope.label}` : ''}`}
          value={<Money value={ytdRealisedGP} />}
          tone={ytdRealisedGP >= ytdPlannedGP ? 'positive' : 'critical'}
          supporting={
            ytdPlannedGP !== 0 ? (
              <>
                vs. plan <Money value={ytdPlannedGP} /> ·{' '}
                <DirectionDelta value={ytdRealisedGP - ytdPlannedGP} positiveIs="good" asMoney />
              </>
            ) : (
              <>No plan GP baseline yet.</>
            )
          }
          trust={[
            { label: 'Budget GP YTD', value: <Money value={ytdBudgetGP} /> },
          ]}
          data-testid="gp-page-hero"
        />

        {/* Visual redesign — simplification pass. PageHero already shows
            Budget GP YTD in its trust column; the legacy 4-badge strip
            (Realised / Planned / Budget / Refreshed) was redundant. */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground -mt-1">
          <StaleIndicator updatedAt={dataUpdatedAt} staleAfterMs={5 * 60_000} />
        </div>

        <div className="lg:flex lg:gap-5 lg:items-start -mt-1">
          {/* Project filter rail */}
          <aside
            className="hidden lg:flex lg:flex-col lg:w-56 lg:shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] rounded-xl border border-border bg-card shadow-sm p-3"
            data-testid="rail-filter-gp"
            aria-label="Filter projects"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Projects</h3>
              {selectedProjects.length > 0 && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedProjects([])}
                  data-testid="rail-clear-all-gp"
                >
                  Clear ({selectedProjects.length})
                </button>
              )}
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search projects…"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
                data-testid="rail-search-gp"
              />
            </div>
            <div className="overflow-y-auto -mx-1 px-1">
              <label className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                <input
                  type="checkbox"
                  className="accent-emerald-600 h-3.5 w-3.5"
                  checked={selectedProjects.length === 0}
                  onChange={() => setSelectedProjects([])}
                  data-testid="rail-all-projects-gp"
                />
                <span className={`truncate ${selectedProjects.length === 0 ? "font-medium" : "text-muted-foreground"}`}>
                  All projects
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">{trackerProjectNames.length}</span>
              </label>
              {filteredRailNames.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-2 py-3">No tracker-loaded projects match.</p>
              ) : (
                filteredRailNames.map((name) => {
                  const checked = selectedProjects.includes(name);
                  return (
                    <label key={name} className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                      <input
                        type="checkbox"
                        className="accent-emerald-600 h-3.5 w-3.5"
                        checked={checked}
                        onChange={() =>
                          setSelectedProjects((prev) =>
                            prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
                          )
                        }
                        data-testid={`rail-project-gp-${name}`}
                      />
                      <span className={`truncate ${checked ? "font-medium text-foreground" : "text-muted-foreground"}`} title={name}>
                        {name}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </aside>

          <div className="flex-1 min-w-0 space-y-3">
            {/* 4-card FY KPI strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3" data-testid="kpi-strip-gp">
              {renderFyKpiCard("budgetGP")}
              {renderFyKpiCard("plannedGP")}
              {renderFyKpiCard("realisedGP")}
              {renderFyKpiCard("plannedMargin")}
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "recon" | "trend")}>
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <TabsList className="bg-muted/60">
                  <TabsTrigger value="recon" className="data-[state=active]:bg-card gap-1.5" data-testid="tab-recon">
                    <ListChecks className="h-3.5 w-3.5" />
                    Recon Grid
                  </TabsTrigger>
                  <TabsTrigger value="trend" className="data-[state=active]:bg-card gap-1.5" data-testid="tab-trend">
                    <LineChartIcon className="h-3.5 w-3.5" />
                    Trend
                  </TabsTrigger>
                </TabsList>

                {/* Mobile project picker */}
                <div className="lg:hidden">
                  <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5 rounded-lg border-border" data-testid="button-project-picker-gp">
                        <Filter className="h-3.5 w-3.5" />
                        Projects
                        {selectedProjects.length > 0 && (
                          <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                            {selectedProjects.length}
                          </Badge>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-2" align="end">
                      <div className="relative mb-2">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="Search projects…"
                          value={projectSearch}
                          onChange={(e) => setProjectSearch(e.target.value)}
                          className="h-8 pl-7 text-xs"
                        />
                      </div>
                      <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                        <label className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                          <input
                            type="checkbox"
                            className="accent-emerald-600 h-3.5 w-3.5"
                            checked={selectedProjects.length === 0}
                            onChange={() => setSelectedProjects([])}
                          />
                          <span className={`truncate ${selectedProjects.length === 0 ? "font-medium" : "text-muted-foreground"}`}>All projects</span>
                        </label>
                        {filteredRailNames.map((name) => {
                          const checked = selectedProjects.includes(name);
                          return (
                            <label key={name} className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                              <input
                                type="checkbox"
                                className="accent-emerald-600 h-3.5 w-3.5"
                                checked={checked}
                                onChange={() =>
                                  setSelectedProjects((prev) =>
                                    prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
                                  )
                                }
                              />
                              <span className={`truncate ${checked ? "font-medium" : "text-muted-foreground"}`}>{name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {selectedProjects.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3 lg:hidden">
                  {selectedProjects.map((p) => (
                    <Badge
                      key={p}
                      variant="secondary"
                      className="text-xs gap-1 cursor-pointer hover:bg-destructive/10"
                      onClick={() => setSelectedProjects((prev) => prev.filter((x) => x !== p))}
                    >
                      {p}
                      <X className="h-3 w-3" />
                    </Badge>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground px-2"
                    onClick={() => setSelectedProjects([])}
                  >
                    Clear all
                  </Button>
                </div>
              )}

              <TabsContent value="recon" className="mt-0">
                <Card className="shadow-sm overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b border-border px-3 sm:px-5 py-2.5 sm:py-3">
                    <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-muted-foreground" />
                      Budget → Planned → Realised reconciliation
                      {isProjectFiltered && (
                        <Badge variant="outline" className="ml-2 text-[10px] font-medium border-emerald-200 bg-emerald-50 text-emerald-700">
                          Filtered: {selectedProjects.length} project{selectedProjects.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">{renderGrid()}</CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="trend" className="mt-0">{renderTrend()}</TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </FinanceShell>
  );
}

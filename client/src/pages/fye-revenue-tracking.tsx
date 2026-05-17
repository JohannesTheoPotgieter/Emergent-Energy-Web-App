import React, { useState, useMemo } from "react";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { SectionHeader } from "@/components/layout/page-shell";
import { FinancialYearScopeControl } from "@/components/finance/FinancialYearScopeControl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useFinancialYearScope, type FinancialYearScope } from "@/hooks/use-financial-year-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fetchQueryFn, apiRequest } from "@/lib/queryClient";
import { formatZar, formatZarCompact, formatCount } from "@/lib/currency";
import { usePermission } from "@/hooks/use-permissions";
import {
  TrendingUp,
  CheckCircle2,
  Briefcase,
  Plus,
  Trash2,
  Pencil,
  X,
  ChevronDown,
  ChevronUp,
  CalendarRange,
  BarChart3,
  ListChecks,
  Users,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────

interface MonthBucket {
  budget: number;
  adjustedBudget: number;
  actualForecast: number;
  actual: number | null;
  capturedData: number;
  pipeline: number;
}

interface DashboardMonth {
  monthKey: string;
  label: string;
  revenue: MonthBucket;
  cos: MonthBucket;
  gp: MonthBucket;
}

interface DashboardResponse {
  fye: number | null;
  months: DashboardMonth[];
  monthKeys: string[];
}

interface ProjectRow {
  projectId: number;
  projectName: string;
  businessDeveloper: string | null;
  province: string | null;
  sizeKwp: number;
  projectType: string | null;
  fundingType: string | null;
  startDate: string | null;
  pcDate: string | null;
  status: string | null;
  budgetRevenue: number;
  budgetCos: number;
  budgetGp: number;
  budgetGpPct: number | null;
  actualRevenue: number;
  actualExpense: number;
  actualGp: number;
  actualGpPct: number | null;
  signedStatus: string;
  hasTracker: boolean;
}

interface DetailResponse {
  fye: number | null;
  cutoffMonth: string | null;
  projects: ProjectRow[];
  totals: {
    budgetRevenue: number;
    budgetCos: number;
    budgetGp: number;
    actualRevenue: number;
    actualExpense: number;
    actualGp: number;
    budgetGpPct: number | null;
    actualGpPct: number | null;
  };
}

interface PipelineRow {
  id: number;
  fyeYear: number;
  projectName: string | null;
  projectDeveloper: string | null;
  location: string | null;
  sizeKwp: string | null;
  dealProbabilityPct: number;
  forecastSignatureDate: string | null;
  solarRevenue: string | null;
  bessRevenue: string | null;
  forecastGpPct: string | null;
  notes: string | null;
  status: string;
}

interface LostDealRow {
  id: number;
  fyeYear: number;
  dealName: string | null;
  dealValue: string | null;
  businessDeveloper: string | null;
  lostReason: string | null;
  lostDate: string | null;
  notes: string | null;
}

interface KpiResponse {
  broughtIn: number;
  signed: number;
  total: number;
}

interface YearsResponse {
  years: number[];
  currentFye: number;
}

// ── Delete Confirmation Dialog ────────────────────────────────────────────

function DeleteConfirmDialog({
  open,
  label,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  label: string;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove entry?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete <strong>{label}</strong>. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
            data-testid="btn-confirm-delete"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────

// Canonical precise ZAR for all cells, panels and tooltips. Absent /
// non-numeric → "—" (never "R 0"). Chart axes use formatZarCompact directly.
export function fmtR(val: number | null | undefined): string {
  return formatZar(val);
}

export function fmtPct(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

export function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  return val.substring(0, 10);
}

export function gpColor(val: number | null | undefined): string {
  if (val == null) return "text-muted-foreground";
  if (val >= 0.2) return "text-emerald-700 font-semibold";
  if (val >= 0) return "text-emerald-600";
  return "text-destructive font-semibold";
}

// ── KPI Cards ─────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, accent, testId }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; accent: string; testId?: string }) {
  return (
    <Card className="border-border shadow-sm" data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${accent}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        </div>
        <p className="text-2xl font-bold tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>{formatCount(value)}</p>
      </CardContent>
    </Card>
  );
}

// ── Dashboard Grid ─────────────────────────────────────────────────────────

// Five-series layout mirrors the FYE Revenue Tracking workbook's
// "Dashboard 2026" sheet 1:1 — Budget · Adjusted Budget · Actual + Forecast ·
// Actual · Captured Data — for Revenue, COS and Gross Profit.
const DASH_ROW_DEFS = [
  { key: "rev-budget",     section: "revenue", field: "budget" as keyof MonthBucket,         label: "Budget Revenue",          class: "text-emerald-700/60" },
  { key: "rev-adjusted",   section: "revenue", field: "adjustedBudget" as keyof MonthBucket, label: "Adjusted Budget Revenue", class: "text-emerald-700/80" },
  { key: "rev-actual-fc",  section: "revenue", field: "actualForecast" as keyof MonthBucket, label: "Actual + Forecast Rev",   class: "text-emerald-700 font-semibold" },
  { key: "rev-actual",     section: "revenue", field: "actual" as keyof MonthBucket,         label: "Actual Revenue",          class: "text-emerald-700" },
  { key: "rev-captured",   section: "revenue", field: "capturedData" as keyof MonthBucket,   label: "Captured Data Rev",       class: "text-emerald-600/80" },
  { key: "sep-1",          section: null,       field: null,                                  label: "",                        class: "" },
  { key: "cos-budget",     section: "cos",     field: "budget" as keyof MonthBucket,         label: "Budget COS",              class: "text-amber-700/60" },
  { key: "cos-adjusted",   section: "cos",     field: "adjustedBudget" as keyof MonthBucket, label: "Adjusted Budget COS",     class: "text-amber-700/80" },
  { key: "cos-actual-fc",  section: "cos",     field: "actualForecast" as keyof MonthBucket, label: "Actual + Forecast COS",   class: "text-amber-700 font-semibold" },
  { key: "cos-actual",     section: "cos",     field: "actual" as keyof MonthBucket,         label: "Actual COS",              class: "text-amber-700" },
  { key: "cos-captured",   section: "cos",     field: "capturedData" as keyof MonthBucket,   label: "Captured Data COS",       class: "text-amber-600/80" },
  { key: "sep-2",          section: null,       field: null,                                  label: "",                        class: "" },
  { key: "gp-budget",      section: "gp",      field: "budget" as keyof MonthBucket,         label: "Budget GP",               class: "text-foreground/60" },
  { key: "gp-adjusted",    section: "gp",      field: "adjustedBudget" as keyof MonthBucket, label: "Adjusted Budget GP",      class: "text-foreground/80" },
  { key: "gp-actual-fc",   section: "gp",      field: "actualForecast" as keyof MonthBucket, label: "Actual + Forecast GP",    class: "text-foreground font-bold" },
  { key: "gp-actual",      section: "gp",      field: "actual" as keyof MonthBucket,         label: "Actual GP",               class: "text-foreground font-semibold" },
  { key: "gp-captured",    section: "gp",      field: "capturedData" as keyof MonthBucket,   label: "Captured Data GP",        class: "text-foreground/80" },
] as const;

// ── Cumulative tracking charts ─────────────────────────────────────────────

// Compact for chart axes only. Tooltips use precise fmtR.
function fmt(value: number) {
  return formatZarCompact(value);
}

interface ChartPoint {
  label: string;
  budget: number;
  actualForecast: number;
  actual: number | null;
  pipeline: number;
}

function buildCumulative(months: DashboardMonth[], section: "revenue" | "gp"): ChartPoint[] {
  let budgetAcc = 0, afAcc = 0, actualAcc = 0, pipelineAcc = 0;
  return months.map((m) => {
    const b = m[section];
    budgetAcc += b.budget;
    afAcc += b.actualForecast;
    actualAcc += b.actual ?? 0;
    pipelineAcc += b.pipeline;
    return {
      label: m.label,
      budget: budgetAcc,
      actualForecast: afAcc,
      actual: b.actual !== null ? actualAcc : null,
      pipeline: pipelineAcc,
    };
  });
}

function TrackingChart({
  title,
  data,
}: {
  title: string;
  data: ChartPoint[];
}) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-slate-700 mb-2 pl-1">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 10 }} width={56} />
          <Tooltip formatter={(v: number) => fmtR(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="budget" name="Budget" stroke="#94a3b8" strokeDasharray="5 3" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="actualForecast" name="Actual + Forecast" stroke="#16a34a" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="actual" name="Actual" stroke="#2563eb" dot={false} strokeWidth={2} connectNulls={false} />
          <Line type="monotone" dataKey="pipeline" name="Pipeline" stroke="#d97706" strokeDasharray="3 2" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FyeTrackingCharts({ months }: { months: DashboardMonth[] }) {
  const revenueData = useMemo(() => buildCumulative(months, "revenue"), [months]);
  const gpData = useMemo(() => buildCumulative(months, "gp"), [months]);
  return (
    <div className="px-4 pt-4 pb-2 border-b border-border flex gap-6 flex-wrap">
      <TrackingChart title="Revenue Tracking (Cumulative)" data={revenueData} />
      <TrackingChart title="GP Tracking (Cumulative)" data={gpData} />
    </div>
  );
}

/**
 * Source-of-truth banner — shows the timestamp + file of the last successful
 * Smart Import commit so the user knows EXACTLY which workbook these
 * numbers reflect. Reads from /api/smart-import/runs (the canonical
 * smart_import_runs audit table — no caching, no derived state).
 */
interface ImportRunMeta {
  id: number;
  project_id: number | null;
  project_name: string | null;
  status: string | null;
  file_name: string | null;
  uploaded_at: string | null;
  committed_at: string | null;
  uploaded_by: string | null;
  committed_by: string | null;
}

function SourceOfTruthBanner() {
  const { data: runs = [] } = useQuery<ImportRunMeta[]>({
    queryKey: ["/api/smart-import/runs"],
    queryFn: async () => {
      const res = await fetch("/api/smart-import/runs", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const lastCommitted = runs.find((r) => (r.status || "").toLowerCase() === "committed");

  if (!lastCommitted || !lastCommitted.committed_at) {
    return (
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-xs flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-medium text-amber-800 dark:text-amber-200">No imports recorded yet.</div>
          <div className="text-amber-700/80 dark:text-amber-300/80">
            Numbers shown reflect the current database state but cannot be tied to a specific tracker workbook. Run a manual import from{" "}
            <a href="/admin/integrations" className="underline font-medium">Integration Statuses</a> to establish a source-of-truth audit trail.
          </div>
        </div>
      </div>
    );
  }

  const when = new Date(lastCommitted.committed_at);
  const isoTitle = lastCommitted.committed_at;
  const ageMs = Date.now() - when.getTime();
  const ageDays = Math.floor(ageMs / 86_400_000);
  const isStale = ageDays > 7;

  return (
    <div className={`mb-3 rounded-lg border px-4 py-3 text-xs flex items-start gap-2 ${
      isStale
        ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
        : "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20"
    }`} data-testid="banner-fye-source-of-truth">
      <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${isStale ? "text-amber-600" : "text-emerald-600"}`} />
      <div className="flex-1 space-y-0.5">
        <div className={`font-medium ${isStale ? "text-amber-800 dark:text-amber-200" : "text-emerald-800 dark:text-emerald-200"}`}>
          Source of truth:{" "}
          <span className="font-mono">{lastCommitted.file_name ?? "(unknown file)"}</span>
        </div>
        <div className={`${isStale ? "text-amber-700/80 dark:text-amber-300/80" : "text-emerald-700/80 dark:text-emerald-300/80"}`}>
          Last imported <span title={isoTitle} className="font-medium">
            {ageDays === 0 ? "today" : ageDays === 1 ? "1 day ago" : `${ageDays} days ago`}
          </span>{" "}
          ({when.toLocaleString()})
          {lastCommitted.committed_by && <> by <span className="font-medium">{lastCommitted.committed_by}</span></>}
          {lastCommitted.project_name && <> · project <span className="font-medium">{lastCommitted.project_name}</span></>}
          {isStale && " · consider re-importing to refresh"}.
        </div>
        <div className="pt-1 flex gap-3 text-[11px]">
          <a href="/admin/integrations" className="underline font-medium hover:no-underline">Run manual import</a>
          <a href="/program/excel-vs-app" className="underline font-medium hover:no-underline">Excel vs App diff</a>
          <a href="/admin/smart-import" className="underline font-medium hover:no-underline">Import history</a>
        </div>
      </div>
    </div>
  );
}

function DashboardGrid({ months }: { months: DashboardMonth[] }) {
  const now = new Date();
  const curMk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs sm:text-sm" data-testid="table-fye-dashboard">
        <thead>
          <tr className="border-b border-border bg-muted/80">
            <th className="sticky left-0 z-10 bg-muted/95 backdrop-blur-sm px-3 sm:px-5 py-2 sm:py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] min-w-[160px] sm:min-w-[220px] border-r border-border">
              Metric
            </th>
            {months.map((m) => (
              <th key={m.monthKey} className={`px-2 sm:px-3 py-2 sm:py-3 text-right font-semibold uppercase tracking-wider text-[10px] sm:text-[11px] whitespace-nowrap min-w-[90px] sm:min-w-[110px] ${m.monthKey >= curMk ? "text-amber-600" : "text-muted-foreground"}`}>
                {m.label}
                {m.monthKey >= curMk && <span className="block text-[9px] font-normal text-amber-500/80">{m.monthKey === curMk ? "current" : "forecast"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DASH_ROW_DEFS.map((row) => {
            if (!row.section) {
              return (
                <tr key={row.key}>
                  <td colSpan={months.length + 1} className="h-px bg-border/60" />
                </tr>
              );
            }
            return (
              <tr key={row.key} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`row-${row.key}`}>
                <td className="sticky left-0 z-10 bg-card/95 backdrop-blur-sm px-3 sm:px-5 py-2 sm:py-2.5 font-medium text-xs sm:text-sm border-r border-border">
                  <span className={row.class}>{row.label}</span>
                </td>
                {months.map((m) => {
                  const bucket = m[row.section as "revenue" | "cos" | "gp"] as MonthBucket;
                  const val = bucket[row.field!] as number | null;
                  const isForecast = m.monthKey >= curMk;
                  return (
                    <td
                      key={m.monthKey}
                      className={`px-2 sm:px-3 py-2 sm:py-2.5 text-right font-mono ${row.class} ${isForecast ? "opacity-60 italic" : ""}`}
                      data-testid={`cell-${row.key}-${m.monthKey}`}
                    >
                      {val != null ? fmtR(val) : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Inline Edit Cell ────────────────────────────────────────────────────────

function InlineEditCell({
  value,
  onSave,
  canEdit,
  placeholder = "—",
  testId,
}: {
  value: string | null;
  onSave: (v: string) => void;
  canEdit: boolean;
  placeholder?: string;
  testId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  const commit = () => {
    onSave(draft);
    setEditing(false);
  };

  if (!canEdit) return <span className="text-muted-foreground">{value || placeholder}</span>;

  if (editing) {
    return (
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        className="h-6 text-xs w-full min-w-[80px] py-0 px-1"
        autoFocus
        aria-label={testId ?? "Inline edit field"}
        data-testid={testId ? `${testId}-input` : undefined}
      />
    );
  }
  return (
    <button
      type="button"
      className="text-left hover:text-emerald-700 hover:underline underline-offset-2 decoration-dashed transition-colors w-full"
      onClick={() => { setDraft(value || ""); setEditing(true); }}
      data-testid={testId ? `${testId}-trigger` : undefined}
      aria-label={testId ? `Edit ${testId}` : "Edit value"}
    >
      {value || <span className="text-muted-foreground/60 italic text-[10px]">{placeholder}</span>}
    </button>
  );
}

// ── Projects Tab ────────────────────────────────────────────────────────────

type SortKey = "projectName" | "budgetRevenue" | "actualRevenue" | "actualGp" | "budgetGpPct" | "actualGpPct";

function ProjectsTab({
  fyScope,
  canEdit,
}: {
  fyScope: FinancialYearScope;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [cutoff, setCutoff] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("projectName");
  const [sortAsc, setSortAsc] = useState(true);

  const queryKey = ["/api/fye-revenue-tracking/detail", fyScope.apiQueryString, cutoff || null];
  const { data, isLoading, isError, error } = useQuery<DetailResponse>({
    queryKey,
    queryFn: fetchQueryFn(
      `/api/fye-revenue-tracking/detail?${fyScope.apiQueryString}${cutoff ? `&cutoffMonth=${cutoff}` : ""}`,
    ),
  });

  const editMutation = useApiMutation({
    mutationFn: (body: { projectName: string; field: string; value: string | null }) =>
      apiRequest("PUT", "/api/fye-revenue-tracking/detail/inline-edit", body),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    errorToast: "Failed to save field",
  });

  const projects = useMemo(() => {
    if (!data?.projects) return [];
    return [...data.projects].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av), bn = Number(bv);
      return sortAsc ? an - bn : bn - an;
    });
  }, [data?.projects, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortAsc ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />) : null;

  if (isLoading) return <PageSkeleton lines={6} />;
  if (isError) return <PageError title="Failed to load project detail" message={error instanceof Error ? error.message : "Unknown error"} />;

  const totals = data?.totals;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="cutoff-month" className="text-xs font-medium text-muted-foreground">Data up to:</label>
          <Input
            id="cutoff-month"
            type="month"
            value={cutoff}
            onChange={(e) => setCutoff(e.target.value)}
            className="h-8 w-36 text-xs"
            placeholder="All data"
            data-testid="input-cutoff-month"
          />
          {cutoff && (
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setCutoff("")} data-testid="btn-cutoff-clear">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <Badge variant="outline" className="text-[11px]">{projects.length} projects</Badge>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs" data-testid="table-fye-projects">
          <thead className="bg-muted/80 border-b border-border">
            <tr>
              {[
                { label: "Project", key: "projectName" as SortKey, sticky: true },
                { label: "BD", key: null },
                { label: "Province", key: null },
                { label: "kWp", key: null },
                { label: "Type", key: null },
                { label: "Funding", key: null },
                { label: "Start", key: null },
                { label: "PC Date", key: null },
                { label: "Status", key: null },
                { label: "Budget Rev", key: "budgetRevenue" as SortKey },
                { label: "Budget COS", key: null },
                { label: "Budget GP", key: null },
                { label: "Budget GP%", key: "budgetGpPct" as SortKey },
                { label: "Actual Rev", key: "actualRevenue" as SortKey },
                { label: "Actual Exp", key: null },
                { label: "Actual GP", key: "actualGp" as SortKey },
                { label: "Actual GP%", key: "actualGpPct" as SortKey },
              ].map(({ label, key, sticky }) => (
                <th
                  key={label}
                  className={`px-2 py-2 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${sticky ? "sticky left-0 z-10 bg-muted/95 text-left min-w-[140px] border-r border-border" : "text-right text-muted-foreground"} ${key ? "cursor-pointer select-none hover:text-foreground" : "text-muted-foreground"}`}
                  onClick={key ? () => toggleSort(key) : undefined}
                  data-testid={key ? `th-sort-${key}` : undefined}
                  aria-sort={key ? (sortKey === key ? (sortAsc ? "ascending" : "descending") : "none") : undefined}
                >
                  {label}{key && <SortIcon k={key} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {projects.map((p) => (
              <tr key={p.projectId} className="hover:bg-muted/30 transition-colors" data-testid={`row-project-${p.projectId}`}>
                <td className="sticky left-0 z-10 bg-card/95 backdrop-blur-sm px-2 py-2 font-medium text-emerald-700 max-w-[150px] truncate border-r border-border" title={p.projectName}>
                  {p.projectName}
                  {p.hasTracker && <span className="ml-1 text-[9px] text-emerald-500">●</span>}
                </td>
                <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">{p.businessDeveloper || "—"}</td>
                <td className="px-2 py-2 text-right min-w-[90px]">
                  <InlineEditCell
                    value={p.province}
                    onSave={(v) => editMutation.mutate({ projectName: p.projectName, field: "province", value: v || null })}
                    canEdit={canEdit}
                    placeholder="Province"
                    testId={`cell-province-${p.projectId}`}
                  />
                </td>
                <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">{p.sizeKwp > 0 ? p.sizeKwp.toLocaleString() : "—"}</td>
                <td className="px-2 py-2 text-right min-w-[90px]">
                  <InlineEditCell
                    value={p.projectType}
                    onSave={(v) => editMutation.mutate({ projectName: p.projectName, field: "projectType", value: v || null })}
                    canEdit={canEdit}
                    placeholder="Type"
                    testId={`cell-type-${p.projectId}`}
                  />
                </td>
                <td className="px-2 py-2 text-right min-w-[90px]">
                  <InlineEditCell
                    value={p.fundingType}
                    onSave={(v) => editMutation.mutate({ projectName: p.projectName, field: "fundingType", value: v || null })}
                    canEdit={canEdit}
                    placeholder="Funding"
                    testId={`cell-funding-${p.projectId}`}
                  />
                </td>
                <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">{fmtDate(p.startDate)}</td>
                <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">{fmtDate(p.pcDate)}</td>
                <td className="px-2 py-2 text-right">
                  {p.status ? (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 whitespace-nowrap">{p.status}</Badge>
                  ) : "—"}
                </td>
                <td className="px-2 py-2 text-right font-mono text-emerald-700/80">{fmtR(p.budgetRevenue)}</td>
                <td className="px-2 py-2 text-right font-mono text-amber-700/80">{fmtR(p.budgetCos)}</td>
                <td className="px-2 py-2 text-right font-mono">{fmtR(p.budgetGp)}</td>
                <td className={`px-2 py-2 text-right font-mono ${gpColor(p.budgetGpPct)}`}>{fmtPct(p.budgetGpPct)}</td>
                <td className="px-2 py-2 text-right font-mono text-emerald-700 font-semibold">{fmtR(p.actualRevenue)}</td>
                <td className="px-2 py-2 text-right font-mono text-amber-700">{fmtR(p.actualExpense)}</td>
                <td className="px-2 py-2 text-right font-mono font-semibold">{fmtR(p.actualGp)}</td>
                <td className={`px-2 py-2 text-right font-mono font-bold ${gpColor(p.actualGpPct)}`}>{fmtPct(p.actualGpPct)}</td>
              </tr>
            ))}
            {totals && (
              <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                <td className="sticky left-0 z-10 bg-muted/95 backdrop-blur-sm px-2 py-2.5 text-xs font-bold border-r border-border">TOTAL</td>
                <td colSpan={8} />
                <td className="px-2 py-2.5 text-right font-mono font-bold text-emerald-700">{fmtR(totals.budgetRevenue)}</td>
                <td className="px-2 py-2.5 text-right font-mono font-bold text-amber-700">{fmtR(totals.budgetCos)}</td>
                <td className="px-2 py-2.5 text-right font-mono font-bold">{fmtR(totals.budgetGp)}</td>
                <td className={`px-2 py-2.5 text-right font-mono font-bold ${gpColor(totals.budgetGpPct)}`}>{fmtPct(totals.budgetGpPct)}</td>
                <td className="px-2 py-2.5 text-right font-mono font-bold text-emerald-700">{fmtR(totals.actualRevenue)}</td>
                <td className="px-2 py-2.5 text-right font-mono font-bold text-amber-700">{fmtR(totals.actualExpense)}</td>
                <td className="px-2 py-2.5 text-right font-mono font-bold">{fmtR(totals.actualGp)}</td>
                <td className={`px-2 py-2.5 text-right font-mono font-bold ${gpColor(totals.actualGpPct)}`}>{fmtPct(totals.actualGpPct)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Pipeline Tab ────────────────────────────────────────────────────────────

const EMPTY_PIPELINE = {
  projectName: "",
  projectDeveloper: "",
  location: "",
  sizeKwp: "",
  dealProbabilityPct: 95,
  forecastSignatureDate: "",
  solarRevenue: "",
  bessRevenue: "",
  forecastGpPct: "",
  notes: "",
};

function PipelineTab({
  fye,
  fyScope,
  canEdit,
}: {
  fye: number | null;
  fyScope: FinancialYearScope;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_PIPELINE });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<PipelineRow>>({});
  const [pendingDelete, setPendingDelete] = useState<{ id: number; label: string } | null>(null);

  const queryKey = ["/api/fye-revenue-tracking/pipeline", fyScope.apiQueryString];
  const { data: rows = [], isLoading } = useQuery<PipelineRow[]>({
    queryKey,
    queryFn: fetchQueryFn(`/api/fye-revenue-tracking/pipeline?${fyScope.apiQueryString}`),
  });

  const createMut = useApiMutation({
    mutationFn: (body: typeof form) => apiRequest("POST", "/api/fye-revenue-tracking/pipeline", { ...body, fyeYear: fye ?? undefined, sizeKwp: body.sizeKwp || null, dealProbabilityPct: Number(body.dealProbabilityPct), solarRevenue: body.solarRevenue || "0", bessRevenue: body.bessRevenue || "0", forecastGpPct: body.forecastGpPct || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); setAdding(false); setForm({ ...EMPTY_PIPELINE }); },
    successToast: "Deal added",
    errorToast: "Failed to add deal",
  });

  const updateMut = useApiMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PipelineRow> }) => apiRequest("PUT", `/api/fye-revenue-tracking/pipeline/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); setEditId(null); },
    successToast: "Deal updated",
    errorToast: "Failed to update deal",
  });

  const deleteMut = useApiMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/fye-revenue-tracking/pipeline/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    successToast: "Deal removed",
    errorToast: "Failed to remove deal",
  });

  const totalRev = rows.reduce((s, r) => s + (parseFloat(r.solarRevenue || "0") + parseFloat(r.bessRevenue || "0")), 0);

  if (isLoading) return <PageSkeleton lines={4} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px]">{rows.length} deals</Badge>
          {totalRev > 0 && <Badge variant="secondary" className="text-[11px] text-emerald-700 bg-emerald-50">Total: {fmtR(totalRev)}</Badge>}
        </div>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1.5 h-8" data-testid="btn-add-pipeline">
            <Plus className="h-3.5 w-3.5" /> Add Deal
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs" data-testid="table-fye-pipeline">
          <thead className="bg-muted/80 border-b border-border">
            <tr>
              {["Project", "BD", "Location", "kWp", "Prob %", "Sign Date", "Solar Rev", "BESS Rev", "GP%", "Notes", ""].map((h) => (
                <th key={h} className={`px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${h === "Project" ? "text-left min-w-[130px]" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {adding && (
              <tr className="bg-emerald-50/30">
                <td className="px-1 py-1"><Input value={form.projectName} onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))} placeholder="Project name" className="h-7 text-xs" autoFocus data-testid="input-pipeline-name" /></td>
                <td className="px-1 py-1"><Input value={form.projectDeveloper} onChange={(e) => setForm((f) => ({ ...f, projectDeveloper: e.target.value }))} placeholder="BD" className="h-7 text-xs w-24" /></td>
                <td className="px-1 py-1"><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Location" className="h-7 text-xs w-24" /></td>
                <td className="px-1 py-1"><Input type="number" value={form.sizeKwp} onChange={(e) => setForm((f) => ({ ...f, sizeKwp: e.target.value }))} placeholder="kWp" className="h-7 text-xs w-20 text-right" /></td>
                <td className="px-1 py-1"><Input type="number" min={0} max={100} value={form.dealProbabilityPct} onChange={(e) => setForm((f) => ({ ...f, dealProbabilityPct: Number(e.target.value) }))} className="h-7 text-xs w-16 text-right" /></td>
                <td className="px-1 py-1"><Input type="date" value={form.forecastSignatureDate} onChange={(e) => setForm((f) => ({ ...f, forecastSignatureDate: e.target.value }))} className="h-7 text-xs w-32" /></td>
                <td className="px-1 py-1"><Input type="number" value={form.solarRevenue} onChange={(e) => setForm((f) => ({ ...f, solarRevenue: e.target.value }))} placeholder="0" className="h-7 text-xs w-28 text-right" /></td>
                <td className="px-1 py-1"><Input type="number" value={form.bessRevenue} onChange={(e) => setForm((f) => ({ ...f, bessRevenue: e.target.value }))} placeholder="0" className="h-7 text-xs w-28 text-right" /></td>
                <td className="px-1 py-1"><Input type="number" value={form.forecastGpPct} onChange={(e) => setForm((f) => ({ ...f, forecastGpPct: e.target.value }))} placeholder="0.00–1.00" className="h-7 text-xs w-20 text-right" /></td>
                <td className="px-1 py-1"><Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" className="h-7 text-xs w-32" /></td>
                <td className="px-1 py-1 whitespace-nowrap">
                  <Button size="sm" className="h-6 px-2 text-[10px] mr-1" onClick={() => createMut.mutate(form)} disabled={!form.projectName || createMut.isPending} data-testid="btn-pipeline-add-save">Save</Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setAdding(false)} data-testid="btn-pipeline-add-cancel">Cancel</Button>
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isEditing = editId === r.id;
              const totalDealRev = parseFloat(r.solarRevenue || "0") + parseFloat(r.bessRevenue || "0");
              return (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-2 py-2 font-medium text-emerald-700 max-w-[150px] truncate" title={r.projectName || ""}>{
                    isEditing
                      ? <Input value={editForm.projectName ?? r.projectName ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, projectName: e.target.value }))} className="h-6 text-xs" />
                      : r.projectName || "—"
                  }</td>
                  <td className="px-2 py-2 text-right text-muted-foreground">{isEditing ? <Input value={editForm.projectDeveloper ?? r.projectDeveloper ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, projectDeveloper: e.target.value }))} className="h-6 text-xs w-20" /> : r.projectDeveloper || "—"}</td>
                  <td className="px-2 py-2 text-right text-muted-foreground">{isEditing ? <Input value={editForm.location ?? r.location ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} className="h-6 text-xs w-20" /> : r.location || "—"}</td>
                  <td className="px-2 py-2 text-right">{isEditing ? <Input type="number" value={String(editForm.sizeKwp ?? r.sizeKwp ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, sizeKwp: e.target.value }))} className="h-6 text-xs w-16 text-right" /> : r.sizeKwp || "—"}</td>
                  <td className="px-2 py-2 text-right">{isEditing ? <Input type="number" min={0} max={100} value={editForm.dealProbabilityPct ?? r.dealProbabilityPct} onChange={(e) => setEditForm((f) => ({ ...f, dealProbabilityPct: Number(e.target.value) }))} className="h-6 text-xs w-14 text-right" /> : <Badge variant={r.dealProbabilityPct >= 95 ? "default" : "outline"} className="text-[9px] px-1 py-0">{r.dealProbabilityPct}%</Badge>}</td>
                  <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">{isEditing ? <Input type="date" value={String(editForm.forecastSignatureDate ?? r.forecastSignatureDate ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, forecastSignatureDate: e.target.value }))} className="h-6 text-xs w-32" /> : fmtDate(r.forecastSignatureDate)}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-700">{isEditing ? <Input type="number" value={String(editForm.solarRevenue ?? r.solarRevenue ?? "0")} onChange={(e) => setEditForm((f) => ({ ...f, solarRevenue: e.target.value }))} className="h-6 text-xs w-24 text-right" /> : fmtR(parseFloat(r.solarRevenue || "0"))}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-700/70">{isEditing ? <Input type="number" value={String(editForm.bessRevenue ?? r.bessRevenue ?? "0")} onChange={(e) => setEditForm((f) => ({ ...f, bessRevenue: e.target.value }))} className="h-6 text-xs w-24 text-right" /> : fmtR(parseFloat(r.bessRevenue || "0"))}</td>
                  <td className={`px-2 py-2 text-right font-mono ${r.forecastGpPct ? gpColor(parseFloat(r.forecastGpPct)) : "text-muted-foreground"}`}>{isEditing ? <Input type="number" step="0.01" value={String(editForm.forecastGpPct ?? r.forecastGpPct ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, forecastGpPct: e.target.value }))} className="h-6 text-xs w-16 text-right" /> : r.forecastGpPct ? fmtPct(parseFloat(r.forecastGpPct)) : "—"}</td>
                  <td className="px-2 py-2 text-right text-muted-foreground max-w-[120px] truncate" title={r.notes || ""}>{isEditing ? <Input value={String(editForm.notes ?? r.notes ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} className="h-6 text-xs w-28" /> : r.notes || "—"}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {canEdit && (
                      isEditing ? (
                        <span className="flex gap-1 justify-end">
                          <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => updateMut.mutate({ id: r.id, data: editForm })} disabled={updateMut.isPending} data-testid={`btn-pipeline-edit-save-${r.id}`}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setEditId(null)} data-testid={`btn-pipeline-edit-cancel-${r.id}`}>Cancel</Button>
                        </span>
                      ) : (
                        <span className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { setEditId(r.id); setEditForm({}); }} data-testid={`btn-edit-pipeline-${r.id}`}><Pencil className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-destructive hover:text-destructive" onClick={() => setPendingDelete({ id: r.id, label: r.projectName || "this deal" })} data-testid={`btn-delete-pipeline-${r.id}`}><Trash2 className="h-3 w-3" /></Button>
                        </span>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !adding && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-muted-foreground">No pipeline deals for {fyScope.label}. {canEdit && "Click \"Add Deal\" to add one."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        label={pendingDelete?.label ?? ""}
        onOpenChange={(v) => { if (!v) setPendingDelete(null); }}
        onConfirm={() => { if (pendingDelete) deleteMut.mutate(pendingDelete.id); setPendingDelete(null); }}
      />
    </div>
  );
}

// ── Lost Deals Tab ──────────────────────────────────────────────────────────

const EMPTY_LOST = { dealName: "", dealValue: "", businessDeveloper: "", lostReason: "", lostDate: "", notes: "" };

function LostDealsTab({
  fye,
  fyScope,
  canEdit,
}: {
  fye: number | null;
  fyScope: FinancialYearScope;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_LOST });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<LostDealRow>>({});
  const [pendingDelete, setPendingDelete] = useState<{ id: number; label: string } | null>(null);

  const queryKey = ["/api/fye-revenue-tracking/lost-deals", fyScope.apiQueryString];
  const { data: rows = [], isLoading } = useQuery<LostDealRow[]>({
    queryKey,
    queryFn: fetchQueryFn(`/api/fye-revenue-tracking/lost-deals?${fyScope.apiQueryString}`),
  });

  const createMut = useApiMutation({
    mutationFn: (body: typeof form) => apiRequest("POST", "/api/fye-revenue-tracking/lost-deals", { ...body, fyeYear: fye ?? undefined, dealValue: body.dealValue || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); setAdding(false); setForm({ ...EMPTY_LOST }); },
    successToast: "Lost deal recorded",
    errorToast: "Failed to save lost deal",
  });

  const updateMut = useApiMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<LostDealRow> }) => apiRequest("PUT", `/api/fye-revenue-tracking/lost-deals/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); setEditId(null); },
    successToast: "Lost deal updated",
    errorToast: "Failed to update lost deal",
  });

  const deleteMut = useApiMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/fye-revenue-tracking/lost-deals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    successToast: "Lost deal removed",
    errorToast: "Failed to remove lost deal",
  });

  const totalLost = rows.reduce((s, r) => s + parseFloat(r.dealValue || "0"), 0);

  if (isLoading) return <PageSkeleton lines={3} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px]">{rows.length} lost deals</Badge>
          {totalLost > 0 && <Badge variant="secondary" className="text-[11px] text-destructive bg-destructive/10">Value lost: {fmtR(totalLost)}</Badge>}
        </div>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1.5 h-8" data-testid="btn-add-lost-deal">
            <Plus className="h-3.5 w-3.5" /> Add Lost Deal
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs" data-testid="table-fye-lost-deals">
          <thead className="bg-muted/80 border-b border-border">
            <tr>
              {["Deal Name", "Deal Value", "BD", "Reason", "Date Lost", "Notes", ""].map((h) => (
                <th key={h} className={`px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${h === "Deal Name" ? "text-left min-w-[130px]" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {adding && (
              <tr className="bg-destructive/5">
                <td className="px-1 py-1"><Input value={form.dealName} onChange={(e) => setForm((f) => ({ ...f, dealName: e.target.value }))} placeholder="Deal name" className="h-7 text-xs" autoFocus data-testid="input-lost-deal-name" /></td>
                <td className="px-1 py-1"><Input type="number" value={form.dealValue} onChange={(e) => setForm((f) => ({ ...f, dealValue: e.target.value }))} placeholder="0" className="h-7 text-xs w-28 text-right" /></td>
                <td className="px-1 py-1"><Input value={form.businessDeveloper} onChange={(e) => setForm((f) => ({ ...f, businessDeveloper: e.target.value }))} placeholder="BD" className="h-7 text-xs w-24" /></td>
                <td className="px-1 py-1"><Input value={form.lostReason} onChange={(e) => setForm((f) => ({ ...f, lostReason: e.target.value }))} placeholder="Reason" className="h-7 text-xs w-32" /></td>
                <td className="px-1 py-1"><Input type="date" value={form.lostDate} onChange={(e) => setForm((f) => ({ ...f, lostDate: e.target.value }))} className="h-7 text-xs w-32" /></td>
                <td className="px-1 py-1"><Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" className="h-7 text-xs w-32" /></td>
                <td className="px-1 py-1 whitespace-nowrap">
                  <Button size="sm" className="h-6 px-2 text-[10px] mr-1" onClick={() => createMut.mutate(form)} disabled={!form.dealName || createMut.isPending} data-testid="btn-lost-deal-add-save">Save</Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setAdding(false)} data-testid="btn-lost-deal-add-cancel">Cancel</Button>
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isEditing = editId === r.id;
              return (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-2 py-2 font-medium text-destructive/80 max-w-[160px] truncate" title={r.dealName || ""}>{isEditing ? <Input value={String(editForm.dealName ?? r.dealName ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, dealName: e.target.value }))} className="h-6 text-xs" /> : r.dealName || "—"}</td>
                  <td className="px-2 py-2 text-right font-mono">{isEditing ? <Input type="number" value={String(editForm.dealValue ?? r.dealValue ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, dealValue: e.target.value }))} className="h-6 text-xs w-24 text-right" /> : fmtR(parseFloat(r.dealValue || "0"))}</td>
                  <td className="px-2 py-2 text-right text-muted-foreground">{isEditing ? <Input value={String(editForm.businessDeveloper ?? r.businessDeveloper ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, businessDeveloper: e.target.value }))} className="h-6 text-xs w-20" /> : r.businessDeveloper || "—"}</td>
                  <td className="px-2 py-2 text-right text-muted-foreground max-w-[140px] truncate" title={r.lostReason || ""}>{isEditing ? <Input value={String(editForm.lostReason ?? r.lostReason ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, lostReason: e.target.value }))} className="h-6 text-xs w-28" /> : r.lostReason || "—"}</td>
                  <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">{isEditing ? <Input type="date" value={String(editForm.lostDate ?? r.lostDate ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, lostDate: e.target.value }))} className="h-6 text-xs w-32" /> : fmtDate(r.lostDate)}</td>
                  <td className="px-2 py-2 text-right text-muted-foreground max-w-[140px] truncate" title={r.notes || ""}>{isEditing ? <Input value={String(editForm.notes ?? r.notes ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} className="h-6 text-xs w-28" /> : r.notes || "—"}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {canEdit && (
                      isEditing ? (
                        <span className="flex gap-1 justify-end">
                          <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => updateMut.mutate({ id: r.id, data: editForm })} disabled={updateMut.isPending} data-testid={`btn-lost-deal-edit-save-${r.id}`}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setEditId(null)} data-testid={`btn-lost-deal-edit-cancel-${r.id}`}>Cancel</Button>
                        </span>
                      ) : (
                        <span className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { setEditId(r.id); setEditForm({}); }} data-testid={`btn-edit-lost-deal-${r.id}`}><Pencil className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-destructive hover:text-destructive" onClick={() => setPendingDelete({ id: r.id, label: r.dealName || "this deal" })} data-testid={`btn-delete-lost-deal-${r.id}`}><Trash2 className="h-3 w-3" /></Button>
                        </span>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !adding && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No lost deals recorded for {fyScope.label}. {canEdit && "Click \"Add Lost Deal\" to add one."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        label={pendingDelete?.label ?? ""}
        onOpenChange={(v) => { if (!v) setPendingDelete(null); }}
        onConfirm={() => { if (pendingDelete) deleteMut.mutate(pendingDelete.id); setPendingDelete(null); }}
      />
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function FyeRevenueTrackingPage() {
  const { allowed: canView } = usePermission("fye_revenue_tracking", "view");
  const { allowed: canEdit } = usePermission("fye_revenue_tracking", "edit");
  const fyScope = useFinancialYearScope();

  const [activeTab, setActiveTab] = useState<"dashboard" | "projects" | "pipeline" | "lost-deals">("dashboard");

  const { data: yearsData, isLoading: yearsLoading } = useQuery<YearsResponse>({
    queryKey: ["/api/fye-revenue-tracking/years"],
    queryFn: fetchQueryFn("/api/fye-revenue-tracking/years"),
  });

  const activeFye = fyScope.fy ?? yearsData?.currentFye ?? new Date().getFullYear();

  const { data: kpis, isLoading: kpisLoading } = useQuery<KpiResponse>({
    queryKey: ["/api/fye-revenue-tracking/kpis", fyScope.apiQueryString],
    queryFn: fetchQueryFn(`/api/fye-revenue-tracking/kpis?${fyScope.apiQueryString}`),
    enabled: fyScope.allData || !!activeFye,
  });

  const { data: dashData, isLoading: dashLoading, isError: dashError, error: dashErr } = useQuery<DashboardResponse>({
    queryKey: ["/api/fye-revenue-tracking/dashboard", fyScope.apiQueryString],
    queryFn: fetchQueryFn(`/api/fye-revenue-tracking/dashboard?${fyScope.apiQueryString}`),
    enabled: fyScope.allData || !!activeFye,
    staleTime: 30_000,
  });

  const fyeLabel = fyScope.allData
    ? "All data"
    : `FY${activeFye} (Sep ${activeFye - 1} – Aug ${activeFye})`;

  // FY totals from dashboard for summary cards
  const fyTotals = useMemo(() => {
    if (!dashData?.months) return null;
    return dashData.months.reduce(
      (acc, m) => {
        acc.budgetRev += m.revenue.budget;
        acc.actualRev += m.revenue.actualForecast;
        acc.budgetCos += m.cos.budget;
        acc.actualCos += m.cos.actualForecast;
        acc.budgetGp += m.gp.budget;
        acc.actualGp += m.gp.actualForecast;
        return acc;
      },
      { budgetRev: 0, actualRev: 0, budgetCos: 0, actualCos: 0, budgetGp: 0, actualGp: 0 }
    );
  }, [dashData]);

  if (!canView) {
    return (
      <FinanceShell>
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">You don't have access to the FYE Revenue Tracking report.</p>
        </div>
      </FinanceShell>
    );
  }

  if (yearsLoading) return <PageSkeleton lines={4} />;

  return (
    <FinanceShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader
            icon={<TrendingUp className="h-5 w-5" />}
            title="FYE Revenue Tracking"
            eyebrow={fyeLabel}
            actions={<FinancialYearScopeControl scope={fyScope} />}
          />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3" data-testid="kpi-strip-fye">
          {kpisLoading ? (
            <div className="col-span-3 flex items-center gap-2 py-3 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading KPIs…</div>
          ) : (
            <>
              <KpiCard label="Brought In" value={kpis?.broughtIn ?? 0} icon={Briefcase} accent="bg-emerald-100 text-emerald-700" testId="kpi-brought-in" />
              <KpiCard label="Signed" value={kpis?.signed ?? 0} icon={CheckCircle2} accent="bg-foreground/10 text-foreground" testId="kpi-signed" />
              <KpiCard label="Total" value={kpis?.total ?? 0} icon={Users} accent="bg-emerald-50 text-emerald-600 border border-emerald-200" testId="kpi-total" />
            </>
          )}
          {fyTotals && (
            <>
              <Card className="border-border shadow-sm">
                <CardContent className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-1">FY Budget Rev</p>
                  <p className="text-sm font-bold font-mono text-emerald-700">{fmtR(fyTotals.budgetRev)}</p>
                </CardContent>
              </Card>
              <Card className="border-border shadow-sm">
                <CardContent className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground mb-1">FY Actual Rev</p>
                  <p className="text-sm font-bold font-mono">{fmtR(fyTotals.actualRev)}</p>
                </CardContent>
              </Card>
              <Card className="border-border shadow-sm">
                <CardContent className="p-4">
                  <p className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${fyTotals.actualGp >= 0 ? "text-emerald-700" : "text-destructive"}`}>FY Actual GP</p>
                  <p className={`text-sm font-bold font-mono ${fyTotals.actualGp >= 0 ? "text-emerald-700" : "text-destructive"}`}>{fmtR(fyTotals.actualGp)}</p>
                  {fyTotals.actualRev > 0 && (
                    <p className={`text-[10px] ${gpColor(fyTotals.actualGp / fyTotals.actualRev)}`}>{fmtPct(fyTotals.actualGp / fyTotals.actualRev)}</p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="bg-muted/60">
            <TabsTrigger value="dashboard" className="data-[state=active]:bg-card gap-1.5" data-testid="tab-fye-dashboard">
              <BarChart3 className="h-3.5 w-3.5" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="projects" className="data-[state=active]:bg-card gap-1.5" data-testid="tab-fye-projects">
              <ListChecks className="h-3.5 w-3.5" />
              Projects
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="data-[state=active]:bg-card gap-1.5" data-testid="tab-fye-pipeline">
              <TrendingUp className="h-3.5 w-3.5" />
              Pipeline
            </TabsTrigger>
            <TabsTrigger value="lost-deals" className="data-[state=active]:bg-card gap-1.5" data-testid="tab-fye-lost-deals">
              <X className="h-3.5 w-3.5" />
              Lost Deals
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-3">
            <SourceOfTruthBanner />
            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border px-4 py-3">
                <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  Monthly Revenue · COS · GP — Budget · Adjusted Budget · Actual + Forecast · Actual · Captured Data
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    <CalendarRange className="h-3 w-3 mr-1" />{fyeLabel}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {dashLoading ? (
                  <div className="flex items-center gap-2 px-6 py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading dashboard…</div>
                ) : dashError ? (
                  <PageError title="Dashboard error" message={dashErr instanceof Error ? dashErr.message : "Failed to load"} />
                ) : dashData ? (
                  <>
                    <FyeTrackingCharts months={dashData.months} />
                    <DashboardGrid months={dashData.months} />
                  </>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="projects" className="mt-3">
            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border px-4 py-3">
                <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-muted-foreground" />
                  Project-Level Budget vs Actual
                  {canEdit && <Badge variant="outline" className="ml-auto text-[10px] text-emerald-700 border-emerald-200 bg-emerald-50">Province · Type · Funding editable</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <ProjectsTab fyScope={fyScope} canEdit={canEdit} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pipeline" className="mt-3">
            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border px-4 py-3">
                <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Forecast Pipeline (95%+ probability deals)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <PipelineTab fye={fyScope.fy} fyScope={fyScope} canEdit={canEdit} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lost-deals" className="mt-3">
            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border px-4 py-3">
                <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
                  <X className="h-4 w-4 text-muted-foreground" />
                  Lost Deals
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <LostDealsTab fye={fyScope.fy} fyScope={fyScope} canEdit={canEdit} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </FinanceShell>
  );
}

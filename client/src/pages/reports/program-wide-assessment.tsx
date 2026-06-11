/**
 * Program-wide Assessment — Reports section.
 *
 * Management / COO view of portfolio-wide tracker-vs-app trust.
 * Aggregates from:
 *   GET /api/reconciliation/program-assessment
 *     (which calls drift summary + finance exception queue + sync health)
 *
 * Layout:
 *   Summary cards  →  Filter bar  →  Exception table  →  Detail drawer
 *
 * RBAC: `excel_vs_app:view` (same as the existing drift pages).
 */
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { QUERY_KEYS } from "@/lib/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  Info,
  Activity,
  BarChart3,
  FileWarning,
  GitCompare,
  Wifi,
  WifiOff,
  Search,
  Download,
} from "lucide-react";
import { ReconciliationDrawer } from "@/components/reconciliation/ReconciliationDrawer";
import type { ReconciliationException } from "@/components/reconciliation/ReconciliationDrawer";

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface AssessmentHealth {
  programHealth: "healthy" | "degraded" | "critical";
  dataConfidence: number;
  syncHealth: "healthy" | "degraded" | "unknown";
}

interface AssessmentCards {
  highRiskExceptions: number;
  mediumRiskExceptions: number;
  financeExceptions: number;
  invoiceWithoutPo: number;
  unmatchedCostInvoices: number;
  unmatchedRevenuePayments: number;
  driftTotal: number;
  unverifiedDrift: number;
  staleTrackerData: number;
  missingInApp: number;
  missingInExcel: number;
}

interface AssessmentResponse {
  generatedAt: string;
  health: AssessmentHealth;
  cards: AssessmentCards;
  exceptions: ReconciliationException[];
}

type RiskFilter = "all" | "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pure — accepts optional `now` so tests can inject a fixed timestamp. */
export function relativeTime(isoString: string, now = Date.now()): string {
  const ms = now - new Date(isoString).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.floor(hr / 24)} days ago`;
}

function HealthDot({ health }: { health: AssessmentHealth["programHealth"] }) {
  if (health === "healthy") return <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" aria-hidden="true" />;
  if (health === "degraded") return <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" aria-hidden="true" />;
  return <span className="h-2 w-2 rounded-full bg-red-500 inline-block" aria-hidden="true" />;
}

function RiskBadge({ risk }: { risk: "high" | "medium" | "low" }) {
  if (risk === "high")
    return <Badge variant="destructive" className="text-xs gap-1"><ShieldAlert className="h-3 w-3" aria-hidden="true" />High</Badge>;
  if (risk === "medium")
    return <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 text-xs gap-1"><AlertTriangle className="h-3 w-3" aria-hidden="true" />Medium</Badge>;
  return <Badge variant="outline" className="text-muted-foreground text-xs gap-1"><Info className="h-3 w-3" aria-hidden="true" />Low</Badge>;
}

function SyncBadge({ syncHealth }: { syncHealth: AssessmentHealth["syncHealth"] }) {
  if (syncHealth === "healthy")
    return <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50 text-xs gap-1"><Wifi className="h-3 w-3" aria-hidden="true" />Synced</Badge>;
  if (syncHealth === "degraded")
    return <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 text-xs gap-1"><WifiOff className="h-3 w-3" aria-hidden="true" />Degraded</Badge>;
  return <Badge variant="outline" className="text-muted-foreground text-xs">Unknown</Badge>;
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-16 mb-1" />
        <Skeleton className="h-3 w-24" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Summary card component
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  severity?: "critical" | "warning" | "ok" | "neutral";
  tooltip?: string;
  href?: string;
  testId?: string;
}

function SummaryCard({ title, value, subtitle, icon: Icon, severity = "neutral", tooltip, href, testId }: SummaryCardProps) {
  const colorMap = {
    critical: "text-red-600",
    warning: "text-amber-600",
    ok: "text-emerald-600",
    neutral: "text-foreground",
  };
  const bgMap = {
    critical: "border-red-100 bg-red-50/40",
    warning: "border-amber-100 bg-amber-50/40",
    ok: "border-emerald-100 bg-emerald-50/40",
    neutral: "",
  };

  const inner = (
    <Card className={`transition-colors hover:shadow-sm ${bgMap[severity]}`} data-testid={testId}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium leading-tight">{title}</p>
            <p className={`text-2xl font-bold tabular-nums ${colorMap[severity]}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${colorMap[severity]}`} aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );

  const wrapped = tooltip ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : inner;

  if (href) {
    return <Link href={href}>{wrapped}</Link>;
  }
  return wrapped;
}

// ---------------------------------------------------------------------------
// Exception table
// ---------------------------------------------------------------------------

interface ExceptionTableProps {
  exceptions: ReconciliationException[];
  onRowClick: (exc: ReconciliationException) => void;
}

function ExceptionTable({ exceptions, onRowClick }: ExceptionTableProps) {
  if (exceptions.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-2"
        data-testid="empty-state"
      >
        <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden="true" />
        <p className="text-sm font-medium">No exceptions match the current filter</p>
        <p className="text-xs">Adjust the risk or search filter above.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="exception-table">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th scope="col" className="text-left py-2 px-3 font-medium">Project</th>
            <th scope="col" className="text-left py-2 px-3 font-medium">Tracker</th>
            <th scope="col" className="text-left py-2 px-3 font-medium">Issue</th>
            <th scope="col" className="text-left py-2 px-3 font-medium">Excel value</th>
            <th scope="col" className="text-left py-2 px-3 font-medium">App value</th>
            <th scope="col" className="text-left py-2 px-3 font-medium">Risk</th>
            <th scope="col" className="text-left py-2 px-3 font-medium">Owner</th>
            <th scope="col" className="text-left py-2 px-3 font-medium">Updated</th>
            <th scope="col" className="py-2 px-3" />
          </tr>
        </thead>
        <tbody>
          {exceptions.map((exc) => (
            <tr
              key={exc.id}
              className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
              onClick={() => onRowClick(exc)}
              data-testid={`exception-row-${exc.id}`}
            >
              <td className="py-2 px-3 font-medium text-xs max-w-[140px] truncate" title={exc.projectName}>
                {exc.projectName}
              </td>
              <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                {exc.tracker}
              </td>
              <td className="py-2 px-3 text-xs max-w-[200px]">
                <span className="line-clamp-2">{exc.displayIssue}</span>
              </td>
              <td className="py-2 px-3 text-xs font-mono text-muted-foreground max-w-[100px] truncate" title={exc.excelValue ?? ""}>
                {exc.excelValue ?? <span className="text-muted-foreground/50 italic">—</span>}
              </td>
              <td className="py-2 px-3 text-xs font-mono max-w-[100px] truncate" title={exc.appValue ?? ""}>
                {exc.appValue ?? <span className="text-muted-foreground/50 italic">—</span>}
              </td>
              <td className="py-2 px-3 whitespace-nowrap">
                <RiskBadge risk={exc.risk} />
              </td>
              <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap max-w-[120px] truncate" title={exc.suggestedOwner}>
                {exc.suggestedOwner}
              </td>
              <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                {exc.lastUpdated
                  ? <time dateTime={exc.lastUpdated}>{relativeTime(exc.lastUpdated)}</time>
                  : "—"}
              </td>
              <td className="py-2 px-3">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={(e) => { e.stopPropagation(); onRowClick(exc); }}
                  aria-label={`View details for ${exc.projectName}`}
                  data-testid={`btn-view-details-${exc.id}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProgramWideAssessmentPage() {
  const queryClient = useQueryClient();
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [trackerFilter, setTrackerFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [drawerException, setDrawerException] = useState<ReconciliationException | null>(null);

  const { data, isLoading, isError, dataUpdatedAt, isFetching } = useQuery<AssessmentResponse>({
    queryKey: QUERY_KEYS.reconciliationProgramAssessment,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reconciliation/program-assessment");
      if (!res.ok) throw new Error(await res.text() || "Failed to load program assessment");
      return res.json();
    },
    staleTime: 60_000,
  });

  const trackerOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.exceptions.map((e) => e.tracker));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.exceptions.filter((exc) => {
      if (riskFilter !== "all" && exc.risk !== riskFilter) return false;
      if (trackerFilter !== "all" && exc.tracker !== trackerFilter) return false;
      const q = search.trim().toLowerCase();
      if (q && !exc.projectName.toLowerCase().includes(q) && !exc.displayIssue.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, riskFilter, trackerFilter, search]);

  function handleExport() {
    if (!filtered.length) return;
    const headers = ["Project", "Tracker", "Issue", "Excel value", "App value", "Risk", "Owner", "Updated"];
    const rows = filtered.map((e) => [
      e.projectName,
      e.tracker,
      e.displayIssue,
      e.excelValue ?? "",
      e.appValue ?? "",
      e.risk,
      e.suggestedOwner,
      e.lastUpdated ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `program-assessment-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 p-6 max-w-screen-2xl mx-auto" data-testid="program-wide-assessment">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Program-wide Assessment
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Portfolio tracker-vs-app trust · Finance exceptions · Sync health
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Updated{" "}
              <time dateTime={data.generatedAt}>{relativeTime(data.generatedAt)}</time>
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reconciliationProgramAssessment })}
            disabled={isFetching}
            aria-label="Refresh program assessment"
            data-testid="btn-refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleExport}
            disabled={!filtered.length}
            aria-label="Export exceptions as CSV"
            data-testid="btn-export"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export
          </Button>
        </div>
      </div>

      {isError && (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2"
          role="alert"
          data-testid="error-state"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          Failed to load program assessment. Check server logs and retry.
        </div>
      )}

      {/* Summary cards */}
      <div
        className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        data-testid="summary-cards"
      >
        {isLoading ? (
          <div className="contents" data-testid="loading-state">
            {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : data ? (
          <>
            <SummaryCard
              title="Program health"
              value={data.health.programHealth === "healthy" ? "Healthy" : data.health.programHealth === "degraded" ? "Degraded" : "Critical"}
              icon={Activity}
              severity={data.health.programHealth === "healthy" ? "ok" : data.health.programHealth === "degraded" ? "warning" : "critical"}
              subtitle={`${data.health.dataConfidence}% data confidence`}
              tooltip="Overall portfolio health based on exception count and sync status."
              testId="card-program-health"
            />
            <SummaryCard
              title="Sync health"
              value={data.health.syncHealth === "healthy" ? "Healthy" : "Degraded"}
              icon={data.health.syncHealth === "healthy" ? Wifi : WifiOff}
              severity={data.health.syncHealth === "healthy" ? "ok" : "warning"}
              tooltip="QuickBooks and integration connector sync status."
              testId="card-sync-health"
            />
            <SummaryCard
              title="High-risk exceptions"
              value={data.cards.highRiskExceptions}
              icon={ShieldAlert}
              severity={data.cards.highRiskExceptions > 0 ? "critical" : "ok"}
              subtitle="Require owner + note to close"
              tooltip="Invoice-without-PO, status mismatch, amount divergence, unmatched invoices."
              href="/reports/program-wide-assessment"
              testId="card-high-risk-exceptions"
            />
            <SummaryCard
              title="Finance exceptions"
              value={data.cards.financeExceptions}
              icon={FileWarning}
              severity={data.cards.financeExceptions > 0 ? "warning" : "ok"}
              subtitle={`${data.cards.invoiceWithoutPo} invoice without PO`}
              tooltip="All active finance exception types from the exception queue."
              testId="card-finance-exceptions"
            />
            <SummaryCard
              title="Tracker/app drift"
              value={data.cards.unverifiedDrift}
              icon={GitCompare}
              severity={data.cards.unverifiedDrift > 0 ? "warning" : "ok"}
              subtitle={`${data.cards.driftTotal} total drift fields`}
              tooltip="Unverified field differences between last imported tracker workbook and app."
              href="/program/excel-vs-app"
              testId="card-tracker-drift"
            />
            <SummaryCard
              title="Stale tracker data"
              value={data.cards.staleTrackerData}
              icon={AlertTriangle}
              severity={data.cards.staleTrackerData > 0 ? "warning" : "neutral"}
              subtitle="Trackers >30 days old"
              tooltip="Projects whose tracker workbook has not been imported in 30+ days."
              testId="card-stale-tracker"
            />
            <SummaryCard
              title="Missing in app"
              value={data.cards.missingInApp}
              icon={BarChart3}
              severity={data.cards.missingInApp > 0 ? "warning" : "neutral"}
              subtitle="In tracker, not in app"
              testId="card-missing-in-app"
            />
            <SummaryCard
              title="Missing in Excel"
              value={data.cards.missingInExcel}
              icon={BarChart3}
              severity={data.cards.missingInExcel > 0 ? "warning" : "neutral"}
              subtitle="In app, not in tracker"
              testId="card-missing-in-excel"
            />
            <SummaryCard
              title="Unmatched QB invoices"
              value={data.cards.unmatchedCostInvoices + data.cards.unmatchedRevenuePayments}
              icon={ShieldAlert}
              severity={(data.cards.unmatchedCostInvoices + data.cards.unmatchedRevenuePayments) > 0 ? "critical" : "ok"}
              subtitle="Cost + revenue"
              tooltip="Invoices in the app with no confirmed QuickBooks link."
              href="/finance/qb-reconciliation"
              testId="card-unmatched-qb"
            />
          </>
        ) : null}
      </div>

      <Separator />

      {/* Trust strip */}
      {data && (
        <div
          className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground bg-muted/30 rounded-md px-4 py-2"
          data-testid="trust-strip"
          role="status"
          aria-label="Data trust summary"
        >
          <div className="flex items-center gap-1.5">
            <HealthDot health={data.health.programHealth} />
            <span className="capitalize">{data.health.programHealth}</span>
          </div>
          <div className="flex items-center gap-1">
            <SyncBadge syncHealth={data.health.syncHealth} />
          </div>
          <span>Data confidence: <strong>{data.health.dataConfidence}%</strong></span>
          <span>Source: canonical cost + revenue lines + import drift</span>
          <span>
            As of:{" "}
            <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString()}</time>
          </span>
          <Link href="/reports/program-wide-assessment" className="text-emerald-600 hover:underline ml-auto">
            Truth registry
          </Link>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter exceptions">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <Input
            placeholder="Search project or issue…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
            aria-label="Search exceptions by project or issue"
            data-testid="search-exceptions"
          />
        </div>
        <Select value={riskFilter} onValueChange={(v) => setRiskFilter(v as RiskFilter)}>
          <SelectTrigger
            className="h-8 w-[130px] text-xs"
            aria-label="Filter by risk level"
            data-testid="risk-filter"
          >
            <SelectValue placeholder="Risk" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risks</SelectItem>
            <SelectItem value="high">High only</SelectItem>
            <SelectItem value="medium">Medium only</SelectItem>
            <SelectItem value="low">Low only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={trackerFilter} onValueChange={setTrackerFilter}>
          <SelectTrigger
            className="h-8 w-[130px] text-xs"
            aria-label="Filter by tracker"
            data-testid="tracker-filter"
          >
            <SelectValue placeholder="Tracker" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All trackers</SelectItem>
            {trackerOptions.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(riskFilter !== "all" || trackerFilter !== "all" || search) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => { setRiskFilter("all"); setTrackerFilter("all"); setSearch(""); }}
            aria-label="Clear all filters"
            data-testid="btn-clear-filters"
          >
            Clear filters
          </Button>
        )}
        <span
          className="text-xs text-muted-foreground ml-auto"
          role="status"
          aria-live="polite"
          data-testid="exception-count"
        >
          {isLoading ? "…" : `${filtered.length} of ${data?.exceptions.length ?? 0} exceptions`}
        </span>
      </div>

      {/* Exception table */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">Exception table</CardTitle>
          <Badge variant="outline" className="text-xs" data-testid="exception-risk-summary">
            {filtered.filter((e) => e.risk === "high").length} high · {filtered.filter((e) => e.risk === "medium").length} medium · {filtered.filter((e) => e.risk === "low").length} low
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4" data-testid="table-loading-state">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (
            <ExceptionTable exceptions={filtered} onRowClick={setDrawerException} />
          )}
        </CardContent>
      </Card>

      {/* High-risk bulk-close guardrail notice */}
      {data && data.cards.highRiskExceptions > 0 && (
        <div
          className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-50 border border-amber-100 rounded-md px-4 py-2"
          role="note"
          data-testid="high-risk-guardrail"
        >
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            <strong className="text-amber-700">{data.cards.highRiskExceptions} high-risk item{data.cards.highRiskExceptions !== 1 ? "s" : ""}</strong> cannot be bulk closed.
            Each requires an assigned owner, a note, and an audit event before it can be resolved.
            Open the project reconciliation page to resolve individual items.
          </span>
        </div>
      )}

      {/* Detail drawer */}
      <ReconciliationDrawer
        open={!!drawerException}
        onClose={() => setDrawerException(null)}
        exception={drawerException}
      />
    </div>
  );
}

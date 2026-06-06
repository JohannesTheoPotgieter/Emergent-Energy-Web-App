/**
 * Reconciliation Board (P2.2) — per-project app-vs-tracker health.
 *
 * One card per active project with a colour-blind-safe status chip
 * (green = ties · amber = drift · red = structural — always paired with an icon
 * and a word) and the headline delta. Clicking an amber/red project fetches the
 * detail and opens the existing ReconciliationDrawer drilled to the offending
 * line.
 *
 * Read-only: it renders persisted financial_reconciliation status + the live
 * §3.3 line detail. It alters no calculation.
 *
 * Brand: Solar Beam surface (#FAF4EF), Slate Grey text (#3D4A3D), Light Slate
 * muted (#A1AFA0), Energetic Green (#1A993A) for positive/ties.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
  RefreshCw,
  ChevronRight,
} from "lucide-react";

import { fetchQueryFn, apiRequest } from "@/lib/queryClient";
import { formatZar } from "@/lib/currency";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import {
  ReconciliationDrawer,
  type ReconciliationException,
} from "@/components/reconciliation/ReconciliationDrawer";

type ReconDisplayStatus = "green" | "amber" | "red" | "unknown";

interface PortfolioProject {
  projectId: number;
  projectName: string;
  status: ReconDisplayStatus;
  appVsTrackerDelta: number;
  absDelta: number;
  periodCount: number;
  amberPeriods: number;
  redPeriods: number;
  computedAt: string | null;
}
interface PortfolioResponse {
  generatedAt: string;
  projects: PortfolioProject[];
  summary: { total: number; red: number; amber: number; green: number; unknown: number };
}

interface DetailLine {
  lineId: number;
  categoryName: string | null;
  description: string | null;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  revenueDerived: number;
  revenueStored: number | null;
  reconDelta: number | null;
  sourceCell: string | null;
  derivationWarning: string | null;
  offending: boolean;
}
interface DetailResponse {
  projectId: number;
  projectName: string | null;
  status: "green" | "amber" | "red";
  appTotal: number;
  trackerTotal: number;
  appVsTrackerDelta: number;
  accumulatedAbsDelta: number;
  reason: string;
  lines: DetailLine[];
}

// ── Status presentation — colour-blind safe (icon + word always paired) ──
const STATUS_META: Record<
  ReconDisplayStatus,
  { label: string; icon: typeof CheckCircle2; chip: string; accent: string; meaning: string }
> = {
  green: {
    label: "Ties",
    icon: CheckCircle2,
    chip: "border-[#1A993A]/30 bg-[#1A993A]/10 text-[#1A993A]",
    accent: "#1A993A",
    meaning: "App ties to the tracker within R1.",
  },
  amber: {
    label: "Drift",
    icon: AlertTriangle,
    chip: "border-amber-300 bg-amber-50 text-amber-800",
    accent: "#B45309",
    meaning: "Pasted tracker value drifts from the §3.3 formula.",
  },
  red: {
    label: "Structural",
    icon: AlertOctagon,
    chip: "border-red-300 bg-red-50 text-red-700",
    accent: "#B91C1C",
    meaning: "A line cannot be reconciled (missing/invalid allocation).",
  },
  unknown: {
    label: "No data",
    icon: HelpCircle,
    chip: "border-[#A1AFA0]/40 bg-[#A1AFA0]/10 text-[#3D4A3D]",
    accent: "#A1AFA0",
    meaning: "No reconciliation has been computed for this project yet.",
  },
};

function StatusChip({ status }: { status: ReconDisplayStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-xs font-medium ${m.chip}`}
      data-testid={`recon-status-${status}`}
      title={m.meaning}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {m.label}
    </Badge>
  );
}

/** Build a drawer exception from the worst offending line of a project detail. */
function exceptionFromDetail(detail: DetailResponseWithMeta): ReconciliationException | null {
  const offending = detail.lines.find((l) => l.offending) ?? detail.lines[0];
  if (!offending) return null;
  const structural = detail.status === "red";
  const lineLabel =
    offending.description || offending.categoryName || `line ${offending.lineId}`;
  return {
    id: `recon-${detail.projectId}-${offending.lineId}`,
    projectId: detail.projectId,
    projectName: detail.projectName ?? `Project ${detail.projectId}`,
    tracker: "Revenue",
    issueType: offending.derivationWarning ?? "amount_mismatch",
    displayIssue: structural
      ? `Structural: ${lineLabel} cannot derive revenue (${offending.derivationWarning ?? "missing allocation"})`
      : `Drift: ${lineLabel} pasted value differs from the §3.3 formula`,
    excelValue: offending.revenueStored != null ? formatZar(offending.revenueStored) : null,
    appValue: formatZar(offending.revenueDerived),
    variance: offending.reconDelta != null ? formatZar(offending.reconDelta) : null,
    risk: structural ? "high" : "medium",
    suggestedOwner: "Programme Finance Manager",
    status: "open",
    lastUpdated: detail.generatedAt ?? null,
    drilldownUrl: `/projects/${detail.projectId}/excel-vs-app`,
    businessImpact: structural
      ? "Revenue cannot be recognised for this line until its category allocation is fixed in the tracker."
      : "The pasted tracker value disagrees with the canonical §3.3 figure the app now reports — reconcile the paste.",
    allowBulkClose: false,
    requireOwnerNote: true,
    sourceProof: {
      app: {
        table: "normalized_cost_line_actuals",
        field: "revenue_derived",
        recordId: offending.lineId,
        value: formatZar(offending.revenueDerived),
      },
      excel: {
        sheet: offending.sourceCell ?? "Expenditure Breakdown · col U",
        value: offending.revenueStored != null ? formatZar(offending.revenueStored) : null,
      },
      qb: null,
    },
    ruleUsed: detail.reason,
    selectedTruthSource: "canonical §3.3 formula (revenue_derived)",
  };
}

interface DetailResponseWithMeta extends DetailResponse {
  generatedAt?: string;
}

export default function FinanceReconciliationBoardPage() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [drawerException, setDrawerException] = useState<ReconciliationException | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const portfolio = useQuery<PortfolioResponse>({
    queryKey: ["/api/finance/reconciliation"],
    queryFn: fetchQueryFn("/api/finance/reconciliation"),
  });

  const detail = useQuery<DetailResponseWithMeta>({
    queryKey: ["/api/finance/reconciliation/detail", selectedProjectId],
    queryFn: fetchQueryFn(`/api/finance/reconciliation/${selectedProjectId}`),
    enabled: selectedProjectId != null,
  });

  // When the detail for the selected project loads, open the drawer on the
  // offending line.
  useEffect(() => {
    if (selectedProjectId == null || !detail.data) return;
    if (detail.data.projectId !== selectedProjectId) return;
    const exc = exceptionFromDetail(detail.data);
    if (exc) setDrawerException(exc);
  }, [detail.data, selectedProjectId]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await apiRequest("POST", "/api/finance/reconciliation/refresh", {});
      await queryClient.invalidateQueries({ queryKey: ["/api/finance/reconciliation"] });
    } finally {
      setRefreshing(false);
    }
  }

  const projects = portfolio.data?.projects ?? [];
  const summary = portfolio.data?.summary;

  const summaryChips = useMemo(
    () =>
      (["red", "amber", "green", "unknown"] as ReconDisplayStatus[]).map((s) => ({
        status: s,
        count: summary ? summary[s] : 0,
      })),
    [summary],
  );

  return (
    <div className="min-h-full bg-[#FAF4EF] text-[#3D4A3D]" data-testid="reconciliation-board">
      <div className="mx-auto max-w-[1400px] px-6 py-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#3D4A3D]">
              Reconciliation Board
            </h1>
            <p className="text-sm text-[#A1AFA0]">
              Per-project app-vs-tracker health. The app reports the canonical §3.3
              formula; each project is checked against its pasted tracker value.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2"
            data-testid="btn-recon-refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2" data-testid="recon-summary">
          {summaryChips.map(({ status, count }) => {
            const m = STATUS_META[status];
            const Icon = m.icon;
            return (
              <div
                key={status}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${m.chip}`}
                data-testid={`recon-summary-${status}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="font-semibold">{count}</span>
                <span>{m.label}</span>
              </div>
            );
          })}
        </div>

        {/* Board */}
        {portfolio.isLoading ? (
          <LoadingState variant="skeleton-card" cards={6} />
        ) : portfolio.isError ? (
          <div
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
            data-testid="recon-error"
          >
            Could not load the reconciliation board.
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-md border border-[#A1AFA0]/40 bg-white px-4 py-8 text-center text-sm text-[#A1AFA0]">
            No active projects.
          </div>
        ) : (
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="recon-board-grid"
          >
            {projects.map((p) => {
              const interactive = p.status === "amber" || p.status === "red";
              const m = STATUS_META[p.status];
              return (
                <Card
                  key={p.projectId}
                  className={`border bg-white transition-shadow ${
                    interactive ? "cursor-pointer hover:shadow-md" : ""
                  }`}
                  style={{ borderLeft: `3px solid ${m.accent}` }}
                  data-testid={`recon-card-${p.projectId}`}
                  onClick={interactive ? () => setSelectedProjectId(p.projectId) : undefined}
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  onKeyDown={
                    interactive
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedProjectId(p.projectId);
                          }
                        }
                      : undefined
                  }
                  aria-label={interactive ? `Open reconciliation detail for ${p.projectName}` : undefined}
                >
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-2">
                    <h2
                      className="text-sm font-semibold leading-tight text-[#3D4A3D] line-clamp-2"
                      data-testid={`recon-card-name-${p.projectId}`}
                    >
                      {p.projectName}
                    </h2>
                    <StatusChip status={p.status} />
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-[#A1AFA0]">
                          App vs tracker
                        </p>
                        <p
                          className="font-mono text-base font-semibold"
                          style={{ color: m.accent }}
                          data-testid={`recon-card-delta-${p.projectId}`}
                        >
                          {p.absDelta === 0 ? formatZar(0) : formatZar(p.appVsTrackerDelta)}
                        </p>
                      </div>
                      <div className="text-right text-xs text-[#A1AFA0]">
                        <p>
                          {p.periodCount} period{p.periodCount === 1 ? "" : "s"}
                        </p>
                        {(p.redPeriods > 0 || p.amberPeriods > 0) && (
                          <p>
                            {p.redPeriods > 0 && <span className="text-red-600">{p.redPeriods} red</span>}
                            {p.redPeriods > 0 && p.amberPeriods > 0 && " · "}
                            {p.amberPeriods > 0 && <span className="text-amber-700">{p.amberPeriods} amber</span>}
                          </p>
                        )}
                      </div>
                    </div>
                    {interactive && (
                      <div className="mt-2 flex items-center gap-1 text-xs font-medium" style={{ color: m.accent }}>
                        View offending line
                        <ChevronRight className="h-3 w-3" aria-hidden="true" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <ReconciliationDrawer
        open={drawerException !== null}
        onClose={() => {
          setDrawerException(null);
          setSelectedProjectId(null);
        }}
        exception={drawerException}
      />
    </div>
  );
}

/**
 * Project Finance Detail (D4) — make every number on a project defensible.
 *
 * Reuses the reconciliation service (the EXTENDED /api/finance/reconciliation/:id
 * detail), the ReconciliationDrawer, the DrillReconciliationFooter, and the
 * Phase 3 line-review actions (move-period / set-invoice-date / undo / remove).
 * It changes NO figure: every value is read from a canonical endpoint and the
 * GP shown is Revenue − COS line-for-line (§ 3.3).
 *
 *   • Header: app-vs-tracker + tracker-vs-QuickBooks status + headline deltas.
 *   • FY aggregate cards reconciled to the lines via DrillReconciliationFooter.
 *   • The tracker reproduced per line: COS (actualTotal), revenue_derived,
 *     revenue_stored, recon_delta, realised/committed, colour state (read vs
 *     defaulted), the Phase 3 integrity flags, and source_cell + source_file_hash.
 *   • Every line drills to its source proof (drawer) and carries the inline,
 *     audited, lock-aware line actions where the user has permission.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";

import { fetchQueryFn } from "@/lib/queryClient";
import { useFinanceQuery } from "@/lib/finance-trust";
import { formatZar } from "@/lib/currency";
import {
  FinancePageHeader,
  KpiRow,
  KpiTile,
  MoneyValue,
  StatusBadge,
  DrillTable,
  FinanceLoading,
  FinanceError,
  type DrillColumn,
} from "@/components/finance/template";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ReconStatusChip,
  type ReconDisplayStatus,
} from "@/components/finance/recon-status";
import { TrustBadge } from "@/components/finance/TrustBadge";
import { DrillReconciliationFooter } from "@/components/finance/DrillReconciliationFooter";
import {
  ReconciliationDrawer,
  type ReconciliationException,
} from "@/components/reconciliation/ReconciliationDrawer";
import {
  LineActionDialog,
  FlagBadges,
  type ActionKind,
  type LineReviewFlags,
  type LineReviewRow,
} from "@/components/cos/cos-line-review-panel";
import { usePermission } from "@/hooks/use-permissions";
import { VoImpactPanel } from "@/components/finance/VoImpactPanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProgramPlanContent } from "@/pages/program-plan";
import { ExpenditureBreakdownContent } from "@/pages/expenditure-breakdown";
import { RevenueTrackingContent } from "@/pages/revenue-tracking";
import { CashflowTab } from "@/components/tabs/CashflowTab";
import { ProjectCosTrackerView } from "@/components/finance/ProjectCosTrackerView";
import {
  ArrowLeft,
  CheckCircle2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  GitCompare,
  Info,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react";

// ── Response shapes — mirror the extended reconciliation detail + line-review ──

type FinanceBucket = "planned" | "committed" | "realised";

interface ReconDetailLine {
  lineId: number;
  costLineId: number;
  categoryName: string | null;
  description: string | null;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  actualTotal: number;
  revenueDerived: number;
  revenueStored: number | null;
  reconDelta: number | null;
  perLineGp: number;
  bucket: FinanceBucket;
  invoiceDateConfirmed: boolean | null;
  invoiceDateFontColor: string | null;
  recognitionMonth: string | null;
  recognitionDateOverride: string | null;
  poNumber: string | null;
  sourceCell: string | null;
  sourceFileHash: string | null;
  derivationWarning: string | null;
  offending: boolean;
}

interface ReconIgnoreView {
  side: "cost" | "revenue";
  qbEntityId: string;
  qbDocNumber: string | null;
  counterpartyName: string | null;
  amountExVat: number | null;
  reason: string;
  ignoredByName: string | null;
  ignoredAt: string | null;
}

interface DetailResponse {
  generatedAt?: string;
  projectId: number;
  projectName: string | null;
  status: ReconDisplayStatus;
  appTotal: number;
  trackerTotal: number;
  appVsTrackerDelta: number;
  accumulatedAbsDelta: number;
  reason: string;
  lines: ReconDetailLine[];
  reconIgnores: ReconIgnoreView[];
}

interface LineReviewResponse {
  lines: Array<{ lineId: number; flags: LineReviewFlags }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALLOCATION_MISSING_WARNINGS = new Set([
  "category_revenue_allocation_missing",
  "missing_category_allocation_linkage",
]);

/** Flags fallback when the line-review endpoint is unavailable (no cos:view) —
 *  the structural allocation flag still derives from the § 3.3 warning. */
function fallbackFlags(warning: string | null): LineReviewFlags {
  const allocationMissing = warning != null && ALLOCATION_MISSING_WARNINGS.has(warning);
  return {
    allocationMissing,
    anomaly: false,
    anomalyFactor: null,
    flagged: allocationMissing,
  };
}

function toLineReviewRow(
  line: ReconDetailLine,
  projectId: number,
  projectName: string | null,
  flags: LineReviewFlags,
): LineReviewRow {
  return {
    lineId: line.lineId,
    costLineId: line.costLineId,
    projectId,
    projectName,
    categoryName: line.categoryName,
    descriptionOfWork: line.description,
    actualTotal: line.actualTotal,
    perLineRevenue: line.revenueDerived,
    perLineGp: line.perLineGp,
    poNumber: line.poNumber,
    bucket: line.bucket,
    recognitionMonth: line.recognitionMonth,
    invoiceRaisedDate: line.invoiceRaisedDate,
    recognitionDateOverride: line.recognitionDateOverride,
    flags,
  };
}

function lineToException(detail: DetailResponse, line: ReconDetailLine): ReconciliationException {
  const structural = !!line.derivationWarning;
  const sheet = line.sourceCell
    ? `${line.sourceCell}${line.sourceFileHash ? ` · file ${line.sourceFileHash.slice(0, 10)}` : ""}`
    : "Expenditure Breakdown · col U";
  return {
    id: `recon-line-${line.lineId}`,
    projectId: detail.projectId,
    projectName: detail.projectName ?? `Project ${detail.projectId}`,
    tracker: "Revenue",
    issueType: line.derivationWarning ?? "amount_mismatch",
    displayIssue: line.description || line.categoryName || `Line ${line.lineId}`,
    excelValue: line.revenueStored != null ? formatZar(line.revenueStored) : null,
    appValue: formatZar(line.revenueDerived),
    variance: line.reconDelta != null ? formatZar(line.reconDelta) : null,
    risk: structural ? "high" : line.offending ? "medium" : "low",
    suggestedOwner: "Programme Finance Manager",
    status: "open",
    lastUpdated: detail.generatedAt ?? null,
    drilldownUrl: `/projects/${detail.projectId}/excel-vs-app`,
    businessImpact: structural
      ? "Revenue cannot be recognised for this line until its category allocation is fixed in the tracker."
      : "The canonical §3.3 figure the app reports for this line, traced to its source cell.",
    allowBulkClose: false,
    requireOwnerNote: true,
    sourceProof: {
      app: {
        table: "normalized_cost_line_actuals",
        field: "revenue_derived",
        recordId: line.lineId,
        value: formatZar(line.revenueDerived),
      },
      excel: {
        sheet,
        value: line.revenueStored != null ? formatZar(line.revenueStored) : null,
      },
      qb: null,
    },
    ruleUsed: detail.reason,
    selectedTruthSource: "canonical §3.3 formula (revenue_derived)",
    reconIgnores: detail.reconIgnores,
  };
}

const BUCKET_BADGE: Record<FinanceBucket, string> = {
  realised: "border-status-ties/30 bg-status-ties/10 text-status-ties",
  committed: "border-amber-300 bg-amber-50 text-amber-800",
  planned: "border-border bg-muted/40 text-muted-foreground",
};

function ColourStateBadge({ confirmed }: { confirmed: boolean | null }) {
  // BLACK / confirmed = read from the workbook; RED / unconfirmed = defaulted
  // (forecast / not yet realised) per § 3.7.
  if (confirmed) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-status-ties/30 bg-status-ties/10 text-status-ties">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Read
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] border-status-drift/40 bg-status-drift/10 text-status-drift" title="Date colour not confirmed (RED) — forecast / defaulted">
      <Clock className="h-3 w-3" aria-hidden="true" /> Defaulted
    </Badge>
  );
}

// ── Main content ────────────────────────────────────────────────────────────────

export function FinanceProjectDetailContent({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const canEdit = usePermission("cos", "edit");
  const canDelete = usePermission("cos", "delete");
  const [drawerException, setDrawerException] = useState<ReconciliationException | null>(null);
  const [dialog, setDialog] = useState<{ action: ActionKind; row: LineReviewRow } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const enabled = Number.isFinite(projectId) && projectId > 0;

  const detailQuery = useQuery<DetailResponse>({
    queryKey: ["/api/finance/reconciliation/detail", projectId],
    queryFn: fetchQueryFn(`/api/finance/reconciliation/${projectId}`),
    enabled,
  });

  // Advisory Phase 3 flags (allocation-missing / anomaly). Merged
  // by lineId; if the caller lacks cos:view this 403s and we fall back to the
  // structural flag derived from the § 3.3 warning.
  const flagsQuery = useQuery<LineReviewResponse>({
    queryKey: ["/api/cos-line-review", "project", projectId],
    queryFn: fetchQueryFn(`/api/cos-line-review?projectIds=${projectId}&flaggedOnly=false`),
    enabled,
    retry: 1,
  });

  const flagsByLineId = useMemo(() => {
    const m = new Map<number, LineReviewFlags>();
    for (const r of flagsQuery.data?.lines ?? []) m.set(r.lineId, r.flags);
    return m;
  }, [flagsQuery.data]);

  // Source-row order, read from the SAME endpoint the Expenditure Breakdown tab
  // uses (ordered by tracker sourceRow). React Query dedupes on the shared key,
  // so the line-by-line view below can present lines in the exact same order as
  // that tab instead of the drift-ranked order the recon detail returns.
  const expenditureQuery = useFinanceQuery<{ costLines: Array<{ id: number; sourceRow: number | null }> }>({
    queryKey: [`/api/tracker-replica/${projectId}/expenditure-breakdown`],
    url: `/api/tracker-replica/${projectId}/expenditure-breakdown`,
    enabled,
  });

  const sourceRowByCostLineId = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of expenditureQuery.data?.costLines ?? []) {
      if (c.sourceRow != null) m.set(c.id, c.sourceRow);
    }
    return m;
  }, [expenditureQuery.data]);

  const detail = detailQuery.data;
  const lines = useMemo(() => detail?.lines ?? [], [detail]);

  const totals = useMemo(() => {
    let cos = 0;
    let revDerived = 0;
    let gp = 0;
    for (const l of lines) {
      cos += l.actualTotal;
      revDerived += l.revenueDerived;
      gp += l.perLineGp;
    }
    return { cos, revDerived, gp };
  }, [lines]);

  // Group by category, ordered to mirror the Expenditure Breakdown tab: lines
  // within a category follow tracker sourceRow, and categories follow the row at
  // which they first appear. Lines whose sourceRow can't be resolved fall to the
  // end deterministically (by costLineId then lineId).
  const groups = useMemo(() => {
    const orderOf = (l: ReconDetailLine) =>
      sourceRowByCostLineId.get(l.costLineId) ?? Number.MAX_SAFE_INTEGER;
    const byCategory = new Map<string, ReconDetailLine[]>();
    for (const l of lines) {
      const key = l.categoryName ?? "Uncategorised";
      const arr = byCategory.get(key) ?? [];
      arr.push(l);
      byCategory.set(key, arr);
    }
    return Array.from(byCategory.entries())
      .map(([name, unsorted]) => {
        const rows = [...unsorted].sort(
          (a, b) => orderOf(a) - orderOf(b) || a.costLineId - b.costLineId || a.lineId - b.lineId,
        );
        const cos = rows.reduce((s, r) => s + r.actualTotal, 0);
        const revDerived = rows.reduce((s, r) => s + r.revenueDerived, 0);
        const absDelta = rows.reduce((s, r) => s + Math.abs(r.reconDelta ?? 0), 0);
        const hasOffending = rows.some((r) => r.offending);
        const order = rows.length ? orderOf(rows[0]) : Number.MAX_SAFE_INTEGER;
        return { name, rows, cos, revDerived, absDelta, hasOffending, order };
      })
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }, [lines, sourceRowByCostLineId]);

  const onActionSuccess = () => {
    qc.invalidateQueries({ queryKey: ["/api/finance/reconciliation/detail", projectId] });
    qc.invalidateQueries({ queryKey: ["/api/cos-line-review"] });
    qc.invalidateQueries({ queryKey: ["/api/cos-tracker"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/reconciliation"] });
  };

  const toggleGroup = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (!enabled) {
    return <p className="py-6 text-sm text-status-adverse">Invalid project id.</p>;
  }
  if (detailQuery.isLoading) {
    return <div data-testid="finance-project-loading"><FinanceLoading label="Loading project finance…" /></div>;
  }
  if (detailQuery.isError || !detail) {
    return (
      <div data-testid="finance-project-error">
        <FinanceError
          title="Could not load this project's finance detail."
          onRetry={() => detailQuery.refetch()}
        />
      </div>
    );
  }

  const actionsAllowed = canEdit.allowed || canDelete.allowed;
  const onOpenDrawer = (line: ReconDetailLine) => setDrawerException(lineToException(detail, line));
  const onAction = (action: ActionKind, row: LineReviewRow) => setDialog({ action, row });

  // Per-line columns shared by every category DrillTable. Preserves the exact
  // fields, classes, per-row testids and gated actions of the original table.
  const lineColumns: DrillColumn<ReconDetailLine>[] = [
    {
      key: "line",
      header: "Line",
      widthClass: "max-w-[260px]",
      cell: (line) => (
        <span data-testid={`finance-project-line-${line.lineId}`}>
          <span className="block truncate text-foreground" title={line.description ?? undefined}>
            {line.description ?? "—"}
          </span>
          <span className="block text-[10px] text-muted-foreground">
            {line.recognitionMonth ?? "—"}
            {line.invoiceNumber ? ` · ${line.invoiceNumber}` : ""}
          </span>
        </span>
      ),
    },
    { key: "cos", header: "COS", numeric: true, cell: (line) => <MoneyValue align="right" muteNegative={false} value={line.actualTotal} /> },
    { key: "revDerived", header: "Rev derived", numeric: true, cell: (line) => <MoneyValue align="right" muteNegative={false} value={line.revenueDerived} /> },
    {
      key: "revStored",
      header: "Rev stored",
      numeric: true,
      className: "text-muted-foreground",
      cell: (line) => (line.revenueStored != null ? <MoneyValue align="right" muteNegative={false} value={line.revenueStored} /> : "—"),
    },
    {
      key: "reconDelta",
      header: "Δ recon",
      numeric: true,
      cell: (line) => {
        const tone =
          line.reconDelta == null
            ? "text-muted-foreground"
            : Math.abs(line.reconDelta) <= 1
              ? "text-muted-foreground"
              : "text-status-drift";
        return (
          <span className={tone} data-testid={`line-recon-delta-${line.lineId}`}>
            {line.reconDelta != null ? <MoneyValue align="right" muteNegative={false} value={line.reconDelta} /> : "—"}
          </span>
        );
      },
    },
    {
      key: "state",
      header: "State",
      cell: (line) => (
        <Badge variant="outline" className={`text-[10px] capitalize ${BUCKET_BADGE[line.bucket]}`}>
          {line.bucket}
        </Badge>
      ),
    },
    { key: "colour", header: "Colour", cell: (line) => <ColourStateBadge confirmed={line.invoiceDateConfirmed} /> },
    {
      key: "flags",
      header: "Flags",
      cell: (line) => {
        const flags = flagsByLineId.get(line.lineId) ?? fallbackFlags(line.derivationWarning);
        return <FlagBadges row={toLineReviewRow(line, projectId, detail.projectName, flags)} />;
      },
    },
    {
      key: "source",
      header: "Source",
      cell: (line) => (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-brand-green"
          onClick={() => onOpenDrawer(line)}
          data-testid={`line-source-proof-${line.lineId}`}
          title={line.sourceFileHash ? `file ${line.sourceFileHash}` : "Open source proof"}
        >
          <Info className="h-3 w-3" aria-hidden="true" />
          {line.sourceCell ?? "proof"}
        </button>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      widthClass: "w-8",
      cell: (line) => {
        if (!actionsAllowed) return <span className="text-muted-foreground">—</span>;
        const flags = flagsByLineId.get(line.lineId) ?? fallbackFlags(line.derivationWarning);
        const row = toLineReviewRow(line, projectId, detail.projectName, flags);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Line actions" data-testid={`line-actions-${line.lineId}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {canEdit.allowed && (
                <>
                  <DropdownMenuItem onClick={() => onAction("move", row)} data-testid={`line-action-move-${line.lineId}`}>
                    <CalendarDays className="mr-2 h-3.5 w-3.5" /> Move to month…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAction("invoiceDate", row)} data-testid={`line-action-invoice-${line.lineId}`}>
                    <CalendarClock className="mr-2 h-3.5 w-3.5" /> Set invoice date…
                  </DropdownMenuItem>
                  {line.recognitionDateOverride && (
                    <DropdownMenuItem onClick={() => onAction("clear", row)} data-testid={`line-action-clear-${line.lineId}`}>
                      <RotateCcw className="mr-2 h-3.5 w-3.5" /> Undo move
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {canEdit.allowed && canDelete.allowed && <DropdownMenuSeparator />}
              {canDelete.allowed && (
                <DropdownMenuItem
                  onClick={() => onAction("remove", row)}
                  className="text-destructive focus:text-destructive"
                  data-testid={`line-action-remove-${line.lineId}`}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Remove line
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-5" data-testid="finance-project-detail">
      {/* Header status */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2" title="App vs the project's pasted tracker">
              <span className="text-[10px] font-medium uppercase text-muted-foreground">App vs tracker</span>
              <ReconStatusChip status={detail.status} />
              <span className="font-mono text-sm tabular-nums text-foreground" data-testid="header-app-vs-tracker-delta">
                {formatZar(detail.appVsTrackerDelta)}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground max-w-md">{detail.reason}</p>
        </CardContent>
      </Card>

      {/* FY aggregate KPIs — reconciled to the lines below */}
      <KpiRow data-testid="finance-project-aggregates">
        <KpiTile
          label="App revenue (recognised)"
          value={<MoneyValue value={detail.appTotal} align="left" muteNegative={false} />}
          sourceBadge={<TrustBadge status={detail.status === "green" ? "ties" : "drift"} />}
        />
        <KpiTile
          label="Tracker (pasted)"
          value={<MoneyValue value={detail.trackerTotal} align="left" muteNegative={false} />}
          supporting={`Δ ${formatZar(detail.appVsTrackerDelta)}`}
          sourceBadge={<TrustBadge status={Math.abs(detail.appVsTrackerDelta) <= 1 ? "ties" : "drift"} />}
        />
        <KpiTile label="COS" value={<MoneyValue value={totals.cos} align="left" muteNegative={false} />} />
        <KpiTile
          label="GP"
          value={<MoneyValue value={totals.gp} align="left" muteNegative={false} />}
          tone={totals.gp >= 0 ? "positive" : "critical"}
        />
      </KpiRow>

      {/* Per-line tracker reproduction — one heading + DrillTable per category */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b bg-muted/30 px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitCompare className="h-4 w-4 text-brand-green" />
            Tracker, line by line
            <Badge variant="outline" className="text-[10px]">{lines.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No cost lines for this project.</p>
          ) : (
            groups.map((g) => {
              const isCollapsed = collapsed.has(g.name);
              return (
                <div key={g.name} data-testid={`finance-project-group-${g.name}`}>
                  {/* Category heading — name + count + needs-review + group totals */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.name)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 rounded-t-lg border border-b-0 border-border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {g.name}
                      <Badge variant="outline" className="ml-1 text-[10px]">{g.rows.length}</Badge>
                      {g.hasOffending && <StatusBadge tone="critical" label="Needs review" />}
                    </span>
                    <span className="inline-flex items-center gap-3 text-xs text-muted-foreground">
                      <span>COS <MoneyValue value={g.cos} align="left" muteNegative={false} /></span>
                      <span>Rev <MoneyValue value={g.revDerived} align="left" muteNegative={false} /></span>
                    </span>
                  </button>
                  {!isCollapsed && (
                    <DrillTable
                      columns={lineColumns}
                      rows={g.rows}
                      rowKey={(line) => line.lineId}
                      stickyHeader={false}
                      className="rounded-t-none"
                      data-testid={`finance-project-line-table-${g.name}`}
                    />
                  )}
                </div>
              );
            })
          )}
          {/* Drill reconciliation: the FY app-revenue total ties to the lines. */}
          <DrillReconciliationFooter
            sourceLabel="App revenue (recognised)"
            sourceValue={detail.appTotal}
            drilldownLabel={`Sum across ${lines.length} line${lines.length === 1 ? "" : "s"}`}
            drilldownValue={totals.revDerived}
          />
        </CardContent>
      </Card>

      <ReconciliationDrawer
        open={drawerException !== null}
        onClose={() => setDrawerException(null)}
        exception={drawerException}
      />

      {dialog && (
        <LineActionDialog
          key={`${dialog.action}-${dialog.row.costLineId}`}
          action={dialog.action}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSuccess={onActionSuccess}
        />
      )}
    </div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function FinanceProjectDetailPage() {
  const [, params] = useRoute("/projects/:projectId/finance");
  const projectId = Number(params?.projectId);
  const enabled = Number.isFinite(projectId) && projectId > 0;

  // Project name for the tabs that key on it (Cashflow + the COS tracker view).
  // Same queryKey as FinanceProjectDetailContent, so React Query dedupes the read.
  const detailQuery = useQuery<DetailResponse>({
    queryKey: ["/api/finance/reconciliation/detail", projectId],
    queryFn: fetchQueryFn(`/api/finance/reconciliation/${projectId}`),
    enabled,
  });
  const projectName = detailQuery.data?.projectName ?? `Project ${projectId}`;

  return (
    <div className="container mx-auto max-w-7xl space-y-5 py-6">
      <div>
        <Link
          href="/cos"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Cost of Sales
        </Link>
        <FinancePageHeader
          title={`Project Finance — ${projectName}`}
          question="The project tracker, tab-for-tab — every number traced to its line and source cell."
        />
      </div>

      {/* Owner-approved tabs: Milestone Tracker · Expenditure Breakdown (the Excel
          cols B–X replica) · Cashflow · Cost of sales · Revenue. Each tab embeds
          the existing canonical view for this project — no new finance figure. */}
      <Tabs defaultValue="cost-of-sales" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="milestones" data-testid="tab-project-milestones">Milestone Tracker</TabsTrigger>
          <TabsTrigger value="expenditure" data-testid="tab-project-expenditure">Expenditure Breakdown</TabsTrigger>
          <TabsTrigger value="cashflow" data-testid="tab-project-cashflow">Cashflow</TabsTrigger>
          <TabsTrigger value="cost-of-sales" data-testid="tab-project-cos">Cost of sales</TabsTrigger>
          <TabsTrigger value="revenue" data-testid="tab-project-revenue">Revenue</TabsTrigger>
        </TabsList>

        <TabsContent value="milestones" className="mt-0">
          <ProgramPlanContent projectId={projectId} />
        </TabsContent>

        <TabsContent value="expenditure" className="mt-0">
          <ExpenditureBreakdownContent projectId={projectId} />
        </TabsContent>

        <TabsContent value="cashflow" className="mt-0">
          <CashflowTab projectName={projectName} title={`Cashflow — ${projectName}`} />
        </TabsContent>

        <TabsContent value="cost-of-sales" className="mt-0 space-y-5">
          {/* Project-scoped COS tracker (monthly realised/committed/planned) … */}
          <ProjectCosTrackerView projectId={projectId} projectName={projectName} />
          {/* … with the per-line app-vs-tracker reconciliation folded in beneath it. */}
          <FinanceProjectDetailContent projectId={projectId} />
        </TabsContent>

        <TabsContent value="revenue" className="mt-0">
          <RevenueTrackingContent projectId={projectId} />
        </TabsContent>
      </Tabs>

      <VoImpactPanel projectId={projectId} />
    </div>
  );
}

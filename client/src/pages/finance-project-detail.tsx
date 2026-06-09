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
import { formatZar } from "@/lib/currency";
import { Money } from "@/components/ui/money";
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
    poMismatch: false,
    poDelta: null,
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

// ── Aggregate card ──────────────────────────────────────────────────────────────

function AggregateCard({
  label,
  value,
  tone,
  trust,
  sub,
}: {
  label: string;
  value: number;
  tone?: "default" | "positive" | "critical";
  trust?: "ties" | "drift";
  sub?: string;
}) {
  const toneClass = tone === "positive" ? "text-status-ties" : tone === "critical" ? "text-status-adverse" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {trust && <TrustBadge status={trust} />}
      </div>
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneClass}`}>
        <Money value={value} />
      </p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
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

  // Advisory Phase 3 flags (allocation-missing / PO mismatch / anomaly). Merged
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

  // Group by category, attention-first (offending/flagged groups float up).
  const groups = useMemo(() => {
    const byCategory = new Map<string, ReconDetailLine[]>();
    for (const l of lines) {
      const key = l.categoryName ?? "Uncategorised";
      const arr = byCategory.get(key) ?? [];
      arr.push(l);
      byCategory.set(key, arr);
    }
    return Array.from(byCategory.entries())
      .map(([name, rows]) => {
        const cos = rows.reduce((s, r) => s + r.actualTotal, 0);
        const revDerived = rows.reduce((s, r) => s + r.revenueDerived, 0);
        const absDelta = rows.reduce((s, r) => s + Math.abs(r.reconDelta ?? 0), 0);
        const hasOffending = rows.some((r) => r.offending);
        return { name, rows, cos, revDerived, absDelta, hasOffending };
      })
      .sort((a, b) => {
        if (a.hasOffending !== b.hasOffending) return a.hasOffending ? -1 : 1;
        if (b.absDelta !== a.absDelta) return b.absDelta - a.absDelta;
        return a.name.localeCompare(b.name);
      });
  }, [lines]);

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
    return <p className="py-10 text-center text-sm text-muted-foreground" data-testid="finance-project-loading">Loading project finance…</p>;
  }
  if (detailQuery.isError || !detail) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert" data-testid="finance-project-error">
        Could not load this project's finance detail.
      </div>
    );
  }

  const actionsAllowed = canEdit.allowed || canDelete.allowed;

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

      {/* FY aggregate cards — reconciled to the lines below */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="finance-project-aggregates">
        <AggregateCard
          label="App revenue (recognised)"
          value={detail.appTotal}
          trust={detail.status === "green" ? "ties" : "drift"}
        />
        <AggregateCard
          label="Tracker (pasted)"
          value={detail.trackerTotal}
          trust={Math.abs(detail.appVsTrackerDelta) <= 1 ? "ties" : "drift"}
          sub={`Δ ${formatZar(detail.appVsTrackerDelta)}`}
        />
        <AggregateCard label="COS" value={totals.cos} />
        <AggregateCard label="GP" value={totals.gp} tone={totals.gp >= 0 ? "positive" : "critical"} />
      </div>

      {/* Per-line tracker reproduction */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b bg-muted/30 px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitCompare className="h-4 w-4 text-brand-green" />
            Tracker, line by line
            <Badge variant="outline" className="text-[10px]">{lines.length}</Badge>
          </CardTitle>
          <Link
            href="/finance/reconciliation"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-green hover:underline"
          >
            Reconciliation board <ChevronRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No cost lines for this project.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="finance-project-line-table">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Line</th>
                    <th className="px-3 py-2 text-right font-semibold">COS</th>
                    <th className="px-3 py-2 text-right font-semibold">Rev derived</th>
                    <th className="px-3 py-2 text-right font-semibold">Rev stored</th>
                    <th className="px-3 py-2 text-right font-semibold">Δ recon</th>
                    <th className="px-3 py-2 text-left font-semibold">State</th>
                    <th className="px-3 py-2 text-left font-semibold">Colour</th>
                    <th className="px-3 py-2 text-left font-semibold">Flags</th>
                    <th className="px-3 py-2 text-left font-semibold">Source</th>
                    <th className="px-3 py-2 text-right font-semibold w-8"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const isCollapsed = collapsed.has(g.name);
                    return (
                      <CategoryGroup
                        key={g.name}
                        group={g}
                        collapsed={isCollapsed}
                        onToggle={() => toggleGroup(g.name)}
                        projectId={projectId}
                        projectName={detail.projectName}
                        flagsByLineId={flagsByLineId}
                        actionsAllowed={actionsAllowed}
                        canEdit={canEdit.allowed}
                        canDelete={canDelete.allowed}
                        onOpenDrawer={(line) => setDrawerException(lineToException(detail, line))}
                        onAction={(action, row) => setDialog({ action, row })}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
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

// ── Category group + line rows ────────────────────────────────────────────────

interface GroupShape {
  name: string;
  rows: ReconDetailLine[];
  cos: number;
  revDerived: number;
  absDelta: number;
  hasOffending: boolean;
}

function CategoryGroup({
  group,
  collapsed,
  onToggle,
  projectId,
  projectName,
  flagsByLineId,
  actionsAllowed,
  canEdit,
  canDelete,
  onOpenDrawer,
  onAction,
}: {
  group: GroupShape;
  collapsed: boolean;
  onToggle: () => void;
  projectId: number;
  projectName: string | null;
  flagsByLineId: Map<number, LineReviewFlags>;
  actionsAllowed: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onOpenDrawer: (line: ReconDetailLine) => void;
  onAction: (action: ActionKind, row: LineReviewRow) => void;
}) {
  return (
    <>
      <tr
        className="border-t border-border bg-muted/20 hover:bg-muted/40 cursor-pointer"
        onClick={onToggle}
        data-testid={`finance-project-group-${group.name}`}
      >
        <td className="px-3 py-2 font-medium text-foreground">
          <span className="inline-flex items-center gap-1.5">
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {group.name}
            <Badge variant="outline" className="ml-1 text-[10px]">{group.rows.length}</Badge>
            {group.hasOffending && (
              <Badge variant="outline" className="text-[10px] border-status-adverse/40 bg-status-adverse/10 text-status-adverse">
                Needs review
              </Badge>
            )}
          </span>
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground"><Money value={group.cos} /></td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground"><Money value={group.revDerived} /></td>
        <td colSpan={7} />
      </tr>
      {!collapsed &&
        group.rows.map((line) => {
          const flags = flagsByLineId.get(line.lineId) ?? fallbackFlags(line.derivationWarning);
          const row = toLineReviewRow(line, projectId, projectName, flags);
          const deltaTone =
            line.reconDelta == null
              ? "text-muted-foreground"
              : Math.abs(line.reconDelta) <= 1
                ? "text-muted-foreground"
                : "text-status-drift";
          return (
            <tr
              key={line.lineId}
              className="border-t border-border/60 hover:bg-muted/20"
              data-testid={`finance-project-line-${line.lineId}`}
            >
              <td className="px-3 py-2 max-w-[260px]">
                <p className="truncate text-foreground" title={line.description ?? undefined}>
                  {line.description ?? "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {line.recognitionMonth ?? "—"}
                  {line.invoiceNumber ? ` · ${line.invoiceNumber}` : ""}
                </p>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums"><Money value={line.actualTotal} /></td>
              <td className="px-3 py-2 text-right font-mono tabular-nums"><Money value={line.revenueDerived} /></td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {line.revenueStored != null ? <Money value={line.revenueStored} /> : "—"}
              </td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${deltaTone}`} data-testid={`line-recon-delta-${line.lineId}`}>
                {line.reconDelta != null ? <Money value={line.reconDelta} /> : "—"}
              </td>
              <td className="px-3 py-2">
                <Badge variant="outline" className={`text-[10px] capitalize ${BUCKET_BADGE[line.bucket]}`}>
                  {line.bucket}
                </Badge>
              </td>
              <td className="px-3 py-2">
                <ColourStateBadge confirmed={line.invoiceDateConfirmed} />
              </td>
              <td className="px-3 py-2"><FlagBadges row={row} /></td>
              <td className="px-3 py-2">
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
              </td>
              <td className="px-3 py-2 text-right">
                {actionsAllowed ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Line actions" data-testid={`line-actions-${line.lineId}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {canEdit && (
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
                      {canEdit && canDelete && <DropdownMenuSeparator />}
                      {canDelete && (
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
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          );
        })}
    </>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function FinanceProjectDetailPage() {
  const [, params] = useRoute("/projects/:projectId/finance");
  const projectId = Number(params?.projectId);
  return (
    <div className="container mx-auto max-w-7xl space-y-5 py-6">
      <div>
        <Link
          href="/finance/reconciliation"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Reconciliation board
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Project Finance</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every number, traced to its line and source cell — app vs tracker.
        </p>
      </div>
      <FinanceProjectDetailContent projectId={projectId} />
    </div>
  );
}

/**
 * QB Matching Workbench — bulk invoice-matching review surface.
 *
 * Replaces the single-invoice FindQbMatchesPanel with a dense table that
 * lets finance process many app cost/revenue lines in one session:
 *
 *  - Load all unlinked lines via existing search endpoints
 *  - "Find Matches for Selected / All Visible" fires POST /find per row
 *  - Rows are classified into Safe / Review / Exception lanes
 *  - "Bulk Approve Safe" previews then commits only the safe lane via
 *    the new POST /bulk-approve endpoint (server re-validates each row)
 *  - "Reject Selected" fires POST /bulk-reject for rows with suggestions
 *  - Click any row to open the proof drawer (side-by-side evidence)
 *  - "Export Exceptions" downloads a CSV of exception-lane rows
 *
 * Safety contract (enforced server-side, mirrored in UI):
 *  - No auto-approval; every link requires an explicit user action
 *  - Bulk approve skips rows with warnings, no PO, or existing links
 *  - Manual override (financials:override) remains single-row only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  Layers,
  Link2,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { isApiError } from "@/lib/api-error";
import { formatRand } from "@/lib/safeMoney";
import { checkQbAllocationSum } from "@shared/config/qb-allocations";
import { QbAutoSuggestInbox } from "./QbAutoSuggestInbox";
import { QbCascadeProposalsPanel } from "./QbCascadeProposalsPanel";

import {
  type FindResponse,
  type RowLane,
  type RowStatus,
  type Scope,
  type ScoredCandidate,
  type WorkbenchRow,
  buildBulkApproveItems,
  buildExceptionsCSV,
  classifyLane,
  confidenceBadge,
  counterpartyNameMatch,
  laneBadge,
  WARNING_LABEL,
} from "./qb-matching-workbench-logic";

// ─── Local interfaces (internal to this module) ───────────────────────────────

interface AppCostLineRow {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number | null;
  counterpartyName: string | null;
  description: string | null;
}

interface AppRevenueLineRow {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number | null;
  description: string | null;
  milestoneName: string | null;
}

// ─── Display helper (component-local) ────────────────────────────────────────

function statusIndicator(status: RowStatus, lane: RowLane | null): string {
  switch (status) {
    case "idle":
      return "text-slate-400";
    case "searching":
      return "text-amber-500";
    case "found":
      return lane === "safe" ? "text-emerald-600" : lane === "review" ? "text-amber-600" : "text-rose-600";
    case "approved":
      return "text-emerald-700";
    case "rejected":
      return "text-slate-500";
    case "error":
      return "text-rose-700";
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface QbMatchingWorkbenchProps {
  defaultScope?: Scope;
}

export function QbMatchingWorkbench({ defaultScope = "cost" }: QbMatchingWorkbenchProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<Scope>(defaultScope);
  const [search, setSearch] = useState("");
  const [laneFilter, setLaneFilter] = useState<RowLane | "all">("all");
  /** Most recently-approved link in this session — drives the cascade
   *  proposals panel below the workbench rows. Cleared by the user. */
  const [lastApprovedLinkId, setLastApprovedLinkId] = useState<number | null>(null);

  // Per-row state — ref kept only for async function stale-closure avoidance
  const [rows, setRows] = useState<WorkbenchRow[]>([]);
  const rowsRef = useRef<WorkbenchRow[]>([]);

  const updateRow = useCallback((id: number, patch: Partial<WorkbenchRow>) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      rowsRef.current = next;
      return next;
    });
  }, []);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [drawerRowId, setDrawerRowId] = useState<number | null>(null);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // ── Load app lines from search endpoints ──────────────────────────────────

  const costQuery = useQuery<{ costLines: AppCostLineRow[] }>({
    queryKey: ["/api/quickbooks/cost-lines/search", "workbench", search],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/cost-lines/search?q=${encodeURIComponent(search)}&limit=100`,
      );
      return res.json();
    },
    enabled: scope === "cost",
  });

  const revenueQuery = useQuery<{ revenueLines: AppRevenueLineRow[] }>({
    queryKey: ["/api/quickbooks/revenue-lines/search", "workbench", search],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/revenue-lines/search?q=${encodeURIComponent(search)}&limit=100`,
      );
      return res.json();
    },
    enabled: scope === "revenue",
  });

  // Normalize query results into a stable shape
  const sourceLines = useMemo(() => {
    if (scope === "cost") {
      return (costQuery.data?.costLines ?? []).map((c) => ({
        id: c.id,
        projectId: c.projectId,
        projectName: c.projectName,
        invoiceNumber: c.invoiceNumber,
        invoiceDate: c.invoiceDate,
        amountExVat: c.amountExVat,
        counterpartyName: c.counterpartyName,
        description: c.description,
      }));
    }
    return (revenueQuery.data?.revenueLines ?? []).map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      amountExVat: r.amountExVat,
      // Revenue rows have no per-line counterparty column — the customer
      // is the project's customer, so fall back to projectName for the
      // side-by-side evidence vs QB customer name. Showing milestoneName
      // here was a bug: it compared "Practical Completion" against the
      // QB DisplayName and always failed.
      counterpartyName: r.projectName,
      // For revenue, the milestone is the user-facing description of
      // what's being billed (e.g. "Practical Completion"); fall back to
      // the raw description column for legacy rows.
      description: r.milestoneName ?? r.description,
    }));
  }, [scope, costQuery.data, revenueQuery.data]);

  // Reconcile source lines into workbench rows without losing find results.
  // useEffect avoids the render-phase setState anti-pattern.
  useEffect(() => {
    setRows((prev) => {
      const existing = new Map(prev.map((r) => [r.id, r]));
      const next = sourceLines.map((line) => {
        const ex = existing.get(line.id);
        if (ex) return { ...ex, appLine: line };
        return {
          id: line.id,
          appLine: line,
          findResult: null,
          status: "idle" as RowStatus,
          lane: null,
          errorMessage: null,
        };
      });
      rowsRef.current = next;
      return next;
    });
  }, [sourceLines]);

  // ── Filtered view — reads only from `rows` state ──────────────────────────

  const visibleRows = useMemo(() => {
    if (laneFilter === "all") return rows;
    return rows.filter((r) => r.lane === laneFilter);
  }, [rows, laneFilter]);

  // ── Find mutation ─────────────────────────────────────────────────────────

  const findMut = useMutation({
    mutationFn: async (appLineId: number) => {
      const body =
        scope === "cost"
          ? { scope: "cost", costLineId: appLineId }
          : { scope: "revenue", revenueLineId: appLineId };
      const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/find", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw Object.assign(new Error((err as { message?: string }).message ?? "Find failed"), {
          status: res.status,
        });
      }
      return (await res.json()) as FindResponse;
    },
  });

  async function findForRow(id: number) {
    updateRow(id, { status: "searching", errorMessage: null });
    try {
      const result = await findMut.mutateAsync(id);
      const lane = classifyLane(result);
      updateRow(id, { findResult: result, status: "found", lane });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      updateRow(id, { status: "error", errorMessage: msg });
    }
  }

  async function findForSelected() {
    const targets = [...selectedIds].filter((id) => {
      const r = rowsRef.current.find((row) => row.id === id);
      return r && (r.status === "idle" || r.status === "error");
    });
    for (const id of targets) {
      await findForRow(id);
    }
  }

  async function findForAllVisible() {
    const targets = visibleRows.filter((r) => r.status === "idle" || r.status === "error");
    for (const r of targets) {
      await findForRow(r.id);
    }
  }

  // ── Single-approve (from drawer) ──────────────────────────────────────────

  const singleApproveMut = useMutation({
    mutationFn: async (vars: {
      suggestionId: number;
      candidateIndex: number;
      notes?: string;
      // Task #142 — when present, the approve route routes via
      // confirmLinksWithAllocations and validates the per-link Rand sum
      // against the QB doc total within tolerance.
      lineAllocations?: Array<{
        appEntityType: "cost_line" | "revenue_line";
        appEntityId: number;
        allocatedAmountExVat: number;
      }>;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/quickbooks/invoice-matches/${vars.suggestionId}/approve`,
        {
          candidateIndex: vars.candidateIndex,
          notes: vars.notes,
          ...(vars.lineAllocations ? { lineAllocations: vars.lineAllocations } : {}),
        },
      );
      return res.json() as Promise<{ linkId: number; proposals?: unknown[] }>;
    },
    onSuccess: (data, vars) => {
      const proposalCount = Array.isArray(data.proposals) ? data.proposals.length : 0;
      toast({
        title: "Match approved",
        description:
          proposalCount > 0
            ? `Link #${data.linkId} created — ${proposalCount} proposed update${proposalCount === 1 ? "" : "s"} below.`
            : `Link #${data.linkId} created — QB and app already agree.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      const row = rowsRef.current.find((r) => r.findResult?.suggestionId === vars.suggestionId);
      if (row) updateRow(row.id, { status: "approved" });
      setDrawerRowId(null);
      setLastApprovedLinkId(data.linkId);
    },
    onError: (err: Error) => {
      const isConflict = isApiError(err) && err.status === 409;
      toast({
        title: isConflict ? "Already linked" : "Approve failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Task #142 — multi-QB approve: a single suggestion's app line is
  // allocated across N QB docs in one transactional pre-validated call.
  // The drawer falls back to this when the operator selects > 1
  // candidate or adds sibling app lines to any of them.
  const multiApproveMut = useMutation({
    mutationFn: async (vars: {
      suggestionId: number;
      notes?: string;
      allocations: Array<{
        candidateIndex: number;
        lineAllocations: Array<{
          appEntityType: "cost_line" | "revenue_line";
          appEntityId: number;
          allocatedAmountExVat: number;
        }>;
      }>;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/quickbooks/invoice-matches/${vars.suggestionId}/approve-multi`,
        { notes: vars.notes, allocations: vars.allocations },
      );
      return res.json() as Promise<{
        linkId: number;
        results: Array<{ qbEntityId: string; linkId: number }>;
      }>;
    },
    onSuccess: (data, vars) => {
      toast({
        title: "Match approved",
        description: `Linked to ${data.results.length} QB doc${data.results.length === 1 ? "" : "s"}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      const row = rowsRef.current.find((r) => r.findResult?.suggestionId === vars.suggestionId);
      if (row) updateRow(row.id, { status: "approved" });
      setDrawerRowId(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Multi-QB approve failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ── Bulk-approve ──────────────────────────────────────────────────────────

  const safeRows = useMemo(
    () => rows.filter((r) => r.lane === "safe" && r.findResult),
    [rows],
  );

  const bulkApprovePreview = useMemo(() => {
    const items = buildBulkApproveItems(safeRows);
    const totalZar = safeRows.reduce(
      (sum, r) => sum + (r.findResult?.candidates[0]?.qbAmountExVat ?? r.appLine.amountExVat ?? 0),
      0,
    );
    const projects = [...new Set(safeRows.map((r) => r.appLine.projectName ?? `#${r.appLine.projectId}`))];
    const vendors = [...new Set(safeRows.map((r) => r.appLine.counterpartyName ?? "—"))];
    const warningsExcluded = rows.filter(
      (r) => r.findResult && (r.lane === "review" || r.lane === "exception"),
    ).length;
    const idleRows = rows.filter((r) => r.status === "idle").length;
    return { items, totalZar, projects, vendors, warningsExcluded, idleRows };
  }, [safeRows, rows]);

  const bulkApproveMut = useMutation({
    mutationFn: async (
      items: Array<{ suggestionId: number; candidateIndex: number }>,
    ) => {
      const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/bulk-approve", {
        items,
      });
      return res.json() as Promise<{
        approved: number;
        skipped: number;
        failed: number;
        results: Array<{ suggestionId: number; outcome: string; linkId?: number; reason?: string }>;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      for (const r of data.results) {
        const row = rowsRef.current.find((row) => row.findResult?.suggestionId === r.suggestionId);
        if (!row) continue;
        if (r.outcome === "approved") updateRow(row.id, { status: "approved" });
      }
      toast({
        title: `Bulk approve complete`,
        description: `${data.approved} approved · ${data.skipped} skipped · ${data.failed} failed`,
        variant: data.failed > 0 ? "destructive" : "default",
      });
      setBulkApproveOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Bulk approve failed", description: err.message, variant: "destructive" });
      setBulkApproveOpen(false);
    },
  });

  // ── Bulk-reject ───────────────────────────────────────────────────────────

  const bulkRejectMut = useMutation({
    mutationFn: async (items: Array<{ suggestionId: number; reason: string }>) => {
      const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/bulk-reject", {
        items,
      });
      return res.json() as Promise<{
        rejected: number;
        skipped: number;
        failed: number;
        results: Array<{ suggestionId: number; outcome: string; reason?: string }>;
      }>;
    },
    onSuccess: (data) => {
      for (const r of data.results) {
        const row = rowsRef.current.find((row) => row.findResult?.suggestionId === r.suggestionId);
        if (row && r.outcome === "rejected") updateRow(row.id, { status: "rejected" });
      }
      toast({
        title: `Bulk reject complete`,
        description: `${data.rejected} rejected · ${data.skipped} skipped · ${data.failed} failed`,
      });
      setRejectDialogOpen(false);
      setRejectReason("");
      setSelectedIds(new Set());
    },
    onError: (err: Error) => {
      toast({ title: "Bulk reject failed", description: err.message, variant: "destructive" });
    },
  });

  function handleBulkReject() {
    if (!rejectReason.trim()) {
      toast({ title: "Reason required", description: "Enter a rejection reason.", variant: "destructive" });
      return;
    }
    const items: Array<{ suggestionId: number; reason: string }> = [];
    for (const id of selectedIds) {
      const r = rowsRef.current.find((row) => row.id === id);
      if (r?.findResult && r.status === "found") {
        items.push({ suggestionId: r.findResult.suggestionId, reason: rejectReason.trim() });
      }
    }
    if (items.length === 0) {
      toast({
        title: "Nothing to reject",
        description: "Select rows that have had matches found first.",
        variant: "destructive",
      });
      return;
    }
    bulkRejectMut.mutate(items);
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selectedIds.has(r.id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleRows.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleRows.forEach((r) => next.add(r.id));
        return next;
      });
    }
  }

  // ── Lane counts — reads only from `rows` state ────────────────────────────

  const laneCounts = useMemo(() => {
    return {
      safe: rows.filter((r) => r.lane === "safe").length,
      review: rows.filter((r) => r.lane === "review").length,
      exception: rows.filter((r) => r.lane === "exception").length,
      idle: rows.filter((r) => r.status === "idle").length,
    };
  }, [rows]);

  const isLoading = costQuery.isLoading || revenueQuery.isLoading;

  // ── Drawer row — reads only from `rows` state ─────────────────────────────

  const drawerRow = useMemo(
    () => (drawerRowId !== null ? rows.find((r) => r.id === drawerRowId) ?? null : null),
    [drawerRowId, rows],
  );

  // ── CSV export (pure build from logic + DOM trigger here) ─────────────────

  function triggerExceptionsDownload() {
    const csv = buildExceptionsCSV(rows, scope);
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qb-exceptions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3" data-testid="qb-matching-workbench">
      {/* ── Header / Scope toggle ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="text-sm font-semibold">QB Matching Workbench</span>
        <Badge variant="outline" className="text-[10px] uppercase">
          Fuzzy linking · bulk review
        </Badge>

        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant={scope === "cost" ? "default" : "outline"}
            className="h-7 text-[10px]"
            onClick={() => {
              setScope("cost");
              setRows([]);
              rowsRef.current = [];
              setSelectedIds(new Set());
            }}
            data-testid="btn-scope-cost"
          >
            Cost (bills)
          </Button>
          <Button
            size="sm"
            variant={scope === "revenue" ? "default" : "outline"}
            className="h-7 text-[10px]"
            onClick={() => {
              setScope("revenue");
              setRows([]);
              rowsRef.current = [];
              setSelectedIds(new Set());
            }}
            data-testid="btn-scope-revenue"
          >
            Revenue (invoices)
          </Button>
        </div>
      </div>

      <QbAutoSuggestInbox
        onReview={async (suggestionId) => {
          // Open a temporary drawer-friendly path: load the suggestion,
          // jump scope if needed, find the matching workbench row, and
          // open its drawer.
          try {
            const res = await apiRequest(
              "GET",
              `/api/quickbooks/invoice-matches/suggestions/${suggestionId}`,
            );
            const data = (await res.json()) as { scope: "cost" | "revenue"; app: { id: number } };
            if (data.scope !== scope) setScope(data.scope);
            const row = rowsRef.current.find((r) => r.appLine.id === data.app.id);
            if (row) {
              setDrawerRowId(row.id);
            } else {
              toast({
                title: "Reviewing suggestion",
                description:
                  "Open the Workbench scope that matches this suggestion — the row may not be in the current view.",
              });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load suggestion";
            toast({ title: "Review failed", description: message, variant: "destructive" });
          }
        }}
      />

      {lastApprovedLinkId !== null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Link #{lastApprovedLinkId} — review proposed cascades before
              they touch app data.
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLastApprovedLinkId(null)}
              data-testid="button-dismiss-proposals-workbench"
            >
              <X className="h-3 w-3 mr-1" />
              Hide
            </Button>
          </div>
          <QbCascadeProposalsPanel linkId={lastApprovedLinkId} />
        </div>
      )}

      {/* ── Search + filters ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search project / supplier / invoice # …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs pl-7"
            data-testid="input-workbench-search"
          />
        </div>
        <Select value={laneFilter} onValueChange={(v) => setLaneFilter(v as RowLane | "all")}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-lane-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All lanes ({rows.length})</SelectItem>
            <SelectItem value="safe">Safe ({laneCounts.safe})</SelectItem>
            <SelectItem value="review">Review ({laneCounts.review})</SelectItem>
            <SelectItem value="exception">Exception ({laneCounts.exception})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Bulk action toolbar ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 p-2 bg-muted/30 rounded border border-muted">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px]"
          disabled={selectedIds.size === 0 || findMut.isPending}
          onClick={findForSelected}
          data-testid="btn-find-selected"
        >
          <Sparkles className="h-3 w-3 mr-1" />
          Find Matches for Selected ({selectedIds.size})
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px]"
          disabled={visibleRows.length === 0 || findMut.isPending}
          onClick={findForAllVisible}
          data-testid="btn-find-all-visible"
        >
          <Layers className="h-3 w-3 mr-1" />
          Find All Visible ({visibleRows.filter((r) => r.status === "idle" || r.status === "error").length})
        </Button>

        <div className="h-4 w-px bg-border" />

        <Button
          size="sm"
          className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white"
          disabled={safeRows.length === 0 || bulkApproveMut.isPending}
          onClick={() => setBulkApproveOpen(true)}
          data-testid="btn-bulk-approve-safe"
        >
          <Link2 className="h-3 w-3 mr-1" />
          Bulk Approve Safe ({safeRows.length})
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px] text-rose-700 border-rose-300 hover:bg-rose-50"
          disabled={selectedIds.size === 0 || bulkRejectMut.isPending}
          onClick={() => setRejectDialogOpen(true)}
          data-testid="btn-reject-selected"
        >
          <ThumbsDown className="h-3 w-3 mr-1" />
          Reject Selected
        </Button>

        <div className="h-4 w-px bg-border" />

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[10px]"
          disabled={laneCounts.exception === 0}
          onClick={triggerExceptionsDownload}
          data-testid="btn-export-exceptions"
        >
          <Download className="h-3 w-3 mr-1" />
          Export Exceptions ({laneCounts.exception})
        </Button>
      </div>

      {/* ── Lane summary chips ────────────────────────────────────────────── */}
      {laneCounts.safe + laneCounts.review + laneCounts.exception > 0 && (
        <div className="flex gap-2 text-[10px]" data-testid="lane-summary">
          <span className="px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-800 border-emerald-300" data-testid="lane-count-safe">
            ✓ Safe: {laneCounts.safe}
          </span>
          <span className="px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-300" data-testid="lane-count-review">
            ~ Review: {laneCounts.review}
          </span>
          <span className="px-2 py-0.5 rounded-full border bg-rose-100 text-rose-800 border-rose-300" data-testid="lane-count-exception">
            ✕ Exception: {laneCounts.exception}
          </span>
          {laneCounts.idle > 0 && (
            <span className="px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500" data-testid="lane-count-idle">
              — Not searched: {laneCounts.idle}
            </span>
          )}
        </div>
      )}

      {/* ── Dense table ───────────────────────────────────────────────────── */}
      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-[10px] text-muted-foreground uppercase sticky top-0">
            <tr>
              <th className="px-2 py-1.5 w-8">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all visible"
                  data-testid="checkbox-select-all"
                />
              </th>
              <th className="px-2 py-1.5 text-left">Lane</th>
              <th className="px-2 py-1.5 text-left">App Ref</th>
              <th className="px-2 py-1.5 text-left">{scope === "cost" ? "Supplier" : "Milestone"}</th>
              <th className="px-2 py-1.5 text-right">App Amount</th>
              <th className="px-2 py-1.5 text-left">Best QB Match</th>
              <th className="px-2 py-1.5 text-left">QB Counterparty</th>
              <th className="px-2 py-1.5 text-right">QB Amount</th>
              <th className="px-2 py-1.5 text-center">Score</th>
              <th className="px-2 py-1.5 text-left">Warnings</th>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr data-testid="table-loading">
                <td colSpan={12} className="px-3 py-4 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && visibleRows.length === 0 && (
              <tr data-testid="table-empty">
                <td colSpan={12} className="px-3 py-4 text-center text-muted-foreground">
                  {search ? "No results — try a different search." : "Type to search for app lines."}
                </td>
              </tr>
            )}
            {visibleRows.map((row) => {
              const best = row.findResult?.candidates[0] ?? null;
              const lb = laneBadge(row.lane);
              const isSelected = selectedIds.has(row.id);
              const appWarnList: string[] = [];
              if (row.findResult?.warnings.no_po) appWarnList.push("no_po");
              if (row.findResult?.warnings.already_linked) appWarnList.push("already_linked");
              const allWarnings = [...appWarnList, ...(best?.warnings ?? [])];

              return (
                <tr
                  key={row.id}
                  className={`border-t hover:bg-muted/30 cursor-pointer ${isSelected ? "bg-emerald-50/30" : ""}`}
                  onClick={() => setDrawerRowId(row.id)}
                  data-testid={`workbench-row-${row.id}`}
                >
                  <td
                    className="px-2 py-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          checked ? next.add(row.id) : next.delete(row.id);
                          return next;
                        });
                      }}
                      aria-label={`Select row ${row.id}`}
                      data-testid={`checkbox-row-${row.id}`}
                    />
                  </td>

                  {/* Lane */}
                  <td
                    className="px-2 py-1.5"
                    data-testid={`row-lane-${row.id}`}
                    data-lane={row.lane ?? "none"}
                  >
                    {row.lane ? (
                      <Badge className={`text-[10px] ${lb.cls}`}>{lb.label}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-[10px]">—</span>
                    )}
                  </td>

                  {/* App Ref */}
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{row.appLine.invoiceNumber ?? `#${row.id}`}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {row.appLine.projectName ?? `Project ${row.appLine.projectId}`}
                    </div>
                  </td>

                  {/* App counterparty */}
                  <td className="px-2 py-1.5 max-w-[10rem] truncate">
                    {row.appLine.counterpartyName ?? "—"}
                  </td>

                  {/* App amount */}
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {formatRand(row.appLine.amountExVat)}
                  </td>

                  {/* Best QB match */}
                  <td className="px-2 py-1.5">
                    {best ? (
                      <span className="font-medium inline-flex items-center gap-1">
                        {best.qbDocNumber ?? best.qbEntityId}
                        {/* Task #142 — bulk(N) badge surfaces when this QB
                            doc already has N>=1 sibling allocations to
                            other app lines, so the operator knows the
                            doc is being split. */}
                        {(() => {
                          const sib = best.qbAllocation;
                          const siblingsForOthers = sib
                            ? sib.siblings.filter(
                                (s) =>
                                  !(
                                    s.appEntityType ===
                                      (scope === "cost" ? "cost_line" : "revenue_line") &&
                                    s.appEntityId === row.appLine.id
                                  ),
                              ).length
                            : 0;
                          return siblingsForOthers > 0 ? (
                            <Badge
                              className="text-[9px] bg-sky-100 text-sky-800 border-sky-200"
                              data-testid={`row-bulk-badge-${row.id}`}
                            >
                              bulk({siblingsForOthers + 1})
                            </Badge>
                          ) : null;
                        })()}
                      </span>
                    ) : row.status === "searching" ? (
                      <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* QB counterparty */}
                  <td className="px-2 py-1.5 max-w-[10rem] truncate">
                    {best?.qbCounterpartyName ?? "—"}
                  </td>

                  {/* QB amount */}
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {best ? formatRand(best.qbAmountExVat) : "—"}
                  </td>

                  {/* Score */}
                  <td
                    className="px-2 py-1.5 text-center"
                    data-testid={`row-score-${row.id}`}
                  >
                    {best ? (
                      <Badge className={`text-[10px] ${confidenceBadge(best.confidence).cls}`}>
                        {confidenceBadge(best.confidence).label}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Warnings */}
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {allWarnings.slice(0, 2).map((w) => (
                        <span
                          key={w}
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-amber-100 text-amber-800 border border-amber-200"
                          title={WARNING_LABEL[w] ?? w}
                          data-testid={`row-warning-${row.id}-${w}`}
                        >
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {w.replace(/_/g, " ")}
                        </span>
                      ))}
                      {allWarnings.length > 2 && (
                        <span className="text-[10px] text-muted-foreground">+{allWarnings.length - 2}</span>
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td
                    className={`px-2 py-1.5 text-[10px] ${statusIndicator(row.status, row.lane)}`}
                    data-testid={`row-status-${row.id}`}
                    data-status={row.status}
                  >
                    {row.status === "searching" ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                      </span>
                    ) : row.status === "approved" ? (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Linked
                      </span>
                    ) : row.status === "rejected" ? (
                      "Rejected"
                    ) : row.status === "error" ? (
                      <span title={row.errorMessage ?? ""}>Error</span>
                    ) : row.status === "found" ? (
                      row.findResult?.candidates.length === 0 ? "No candidates" : "Found"
                    ) : (
                      "—"
                    )}
                  </td>

                  {/* Action */}
                  <td className="px-2 py-1.5">
                    {row.status === "idle" || row.status === "error" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          void findForRow(row.id);
                        }}
                        data-testid={`btn-find-row-${row.id}`}
                      >
                        <Sparkles className="h-3 w-3" />
                      </Button>
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Proof Drawer ─────────────────────────────────────────────────────── */}
      <Sheet open={drawerRowId !== null} onOpenChange={(open) => !open && setDrawerRowId(null)}>
        <SheetContent side="right" className="w-full max-w-xl overflow-y-auto">
          {drawerRow && (
            <ProofDrawerContent
              row={drawerRow}
              scope={scope}
              onApprove={(candidateIndex, lineAllocations) => {
                if (!drawerRow.findResult) return;
                singleApproveMut.mutate({
                  suggestionId: drawerRow.findResult.suggestionId,
                  candidateIndex,
                  lineAllocations,
                });
              }}
              onApproveMulti={(allocations) => {
                if (!drawerRow.findResult) return;
                multiApproveMut.mutate({
                  suggestionId: drawerRow.findResult.suggestionId,
                  allocations,
                });
              }}
              approvePending={singleApproveMut.isPending || multiApproveMut.isPending}
              onRejectDone={() => setDrawerRowId(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* ── Bulk Approve Preview Modal ────────────────────────────────────── */}
      <Dialog open={bulkApproveOpen} onOpenChange={setBulkApproveOpen}>
        <DialogContent data-testid="modal-bulk-approve-preview">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-emerald-600" />
              Confirm Bulk Approval
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              Only <strong>Safe</strong> rows will be approved — rows with warnings, no PO, existing
              links, or score below 90% are excluded. Each link is individually re-validated
              server-side before creation.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border p-2">
                <div className="text-muted-foreground uppercase text-[10px] mb-1">Matches to approve</div>
                <div className="text-xl font-bold text-emerald-700" data-testid="modal-approve-count">
                  {bulkApprovePreview.items.length}
                </div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground uppercase text-[10px] mb-1">Total ZAR value</div>
                <div className="text-base font-semibold" data-testid="modal-approve-total">
                  {formatRand(bulkApprovePreview.totalZar)}
                </div>
              </div>
            </div>
            <div className="rounded border p-2 text-xs space-y-1">
              <div data-testid="modal-approve-projects">
                <span className="text-muted-foreground">Projects affected: </span>
                {bulkApprovePreview.projects.slice(0, 5).join(", ")}
                {bulkApprovePreview.projects.length > 5 && ` +${bulkApprovePreview.projects.length - 5} more`}
              </div>
              <div data-testid="modal-approve-vendors">
                <span className="text-muted-foreground">
                  {scope === "cost" ? "Vendors" : "Customers"} affected:{" "}
                </span>
                {bulkApprovePreview.vendors.slice(0, 5).join(", ")}
                {bulkApprovePreview.vendors.length > 5 && ` +${bulkApprovePreview.vendors.length - 5} more`}
              </div>
              <div>
                <span className="text-muted-foreground">Rows with warnings (excluded): </span>
                {bulkApprovePreview.warningsExcluded}
              </div>
              {bulkApprovePreview.idleRows > 0 && (
                <div>
                  <span className="text-muted-foreground">Rows not yet searched (skipped): </span>
                  {bulkApprovePreview.idleRows}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkApproveOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={bulkApprovePreview.items.length === 0 || bulkApproveMut.isPending}
              onClick={() => bulkApproveMut.mutate(bulkApprovePreview.items)}
              data-testid="btn-confirm-bulk-approve"
            >
              {bulkApproveMut.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-2" />
              ) : (
                <Link2 className="h-3 w-3 mr-2" />
              )}
              Approve {bulkApprovePreview.items.length} Matches
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Reject Dialog ────────────────────────────────────────────── */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent data-testid="modal-bulk-reject">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ThumbsDown className="h-4 w-4 text-rose-600" />
              Reject Selected Matches
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Rejects all suggestions for selected rows that have been searched. Rows without a
              suggestion (not yet searched) are ignored.
            </p>
            <div>
              <Label className="text-xs">Reason (required)</Label>
              <Input
                className="mt-1 text-xs h-8"
                placeholder="e.g. all candidates relate to a different project"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                data-testid="input-bulk-reject-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || bulkRejectMut.isPending}
              onClick={handleBulkReject}
              data-testid="btn-confirm-bulk-reject"
            >
              {bulkRejectMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
              Record Rejections
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Proof Drawer Content ─────────────────────────────────────────────────────

export type ApproveLineAllocation = {
  appEntityType: "cost_line" | "revenue_line";
  appEntityId: number;
  allocatedAmountExVat: number;
};

export interface ProofDrawerProps {
  row: WorkbenchRow;
  scope: Scope;
  onApprove: (
    candidateIndex: number,
    lineAllocations?: Array<ApproveLineAllocation>,
  ) => void;
  /**
   * Task #142 — multi-QB approve callback. Used when the operator
   * selects > 1 candidate (one app line allocated across N QB docs)
   * OR when they add sibling app lines via the in-drawer search.
   */
  onApproveMulti: (
    allocations: Array<{
      candidateIndex: number;
      lineAllocations: Array<ApproveLineAllocation>;
    }>,
  ) => void;
  approvePending: boolean;
  onRejectDone: () => void;
}

type AddedAppLine = {
  appEntityType: "cost_line" | "revenue_line";
  appEntityId: number;
  label: string;
  allocStr: string;
};

export function ProofDrawerContent({ row, scope, onApprove, onApproveMulti, approvePending }: ProofDrawerProps) {
  const { toast } = useToast();
  // Task #142 — multi-QB selection. The first selected candidate is the
  // "primary" one rendered in the proof table / score reasons / warnings.
  const [selectedSet, setSelectedSet] = useState<Set<number>>(() => new Set([0]));
  const [primaryIdx, setPrimaryIdx] = useState(0);
  const selectedCandidateIdx = primaryIdx;
  const setSelectedCandidateIdx = (i: number) => {
    setPrimaryIdx(i);
    setSelectedSet((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  };
  const toggleCandidate = (i: number) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        if (next.size === 1) return next; // can't deselect the only one
        next.delete(i);
        if (i === primaryIdx) {
          const remaining = [...next].sort((a, b) => a - b);
          setPrimaryIdx(remaining[0]!);
        }
      } else {
        next.add(i);
      }
      return next;
    });
  };
  // Per-QB editor state keyed by qbEntityId.
  const [allocStrByQb, setAllocStrByQb] = useState<Record<string, string>>({});
  const [addedLinesByQb, setAddedLinesByQb] = useState<Record<string, AddedAppLine[]>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [manualQbId, setManualQbId] = useState("");
  const manualMut = useMutation({
    mutationFn: async (vars: {
      qbEntityId: string;
      appEntityId: number;
      // Task #142 — optional per-link override allocation. When omitted
      // the server treats the link as a 100% allocation of the QB doc.
      allocatedAmountExVat?: number;
    }) => {
      const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/manual-link", {
        scope,
        appEntityId: vars.appEntityId,
        qbEntityId: vars.qbEntityId,
        notes: "manual_override via QB Matching Workbench",
        ...(vars.allocatedAmountExVat !== undefined
          ? { allocatedAmountExVat: vars.allocatedAmountExVat }
          : {}),
      });
      return res.json();
    },
    onSuccess: (data: { linkId: number }) => {
      toast({ title: "Manual link created", description: `Link #${data.linkId}.` });
      setManualQbId("");
    },
    onError: (err: Error) => {
      const isPerm = isApiError(err) && err.status === 403;
      toast({
        title: isPerm ? "Not allowed" : "Manual link failed",
        description: isPerm ? "Requires financials:override permission." : err.message,
        variant: "destructive",
      });
    },
  });

  const rejectMut = useMutation({
    mutationFn: async (vars: { suggestionId: number; reason: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/quickbooks/invoice-matches/${vars.suggestionId}/reject`,
        { reason: vars.reason },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Suggestion rejected" });
      setRejectReason("");
    },
    onError: (err: Error) => {
      toast({ title: "Reject failed", description: err.message, variant: "destructive" });
    },
  });

  const result = row.findResult;
  const appLine = row.appLine;

  const chosenCandidate = result?.candidates[selectedCandidateIdx] ?? null;
  const appEntityType: "cost_line" | "revenue_line" =
    scope === "cost" ? "cost_line" : "revenue_line";

  // Task #142 — Per-candidate allocation derivation. Called once per
  // selected candidate inside the render loop. Pure function (no hooks)
  // so it's safe to call in a loop. State (`allocStrByQb`,
  // `addedLinesByQb`) is keyed by qbEntityId and persists across
  // re-renders.
  function computeCandidateAlloc(c: ScoredCandidate) {
    const sib = c.qbAllocation;
    const otherSiblings = (sib?.siblings ?? []).filter(
      (s) => !(s.appEntityType === appEntityType && s.appEntityId === appLine.id),
    );
    const otherSiblingSum = otherSiblings.reduce(
      (a, s) => a + (Number(s.allocatedAmountExVat) || 0),
      0,
    );
    const qbTotal = c.qbAmountExVat ?? null;
    const added = addedLinesByQb[c.qbEntityId] ?? [];
    const addedSum = added.reduce((a, l) => a + (Number(l.allocStr) || 0), 0);
    const defaultThisAlloc = qbTotal !== null
      ? Math.max(0, Math.min(
          Number((qbTotal - otherSiblingSum - addedSum).toFixed(2)),
          Number(appLine.amountExVat ?? qbTotal),
        ))
      : Number(appLine.amountExVat ?? 0);
    const allocStr = allocStrByQb[c.qbEntityId] ?? defaultThisAlloc.toFixed(2);
    const allocNum = Number(allocStr);
    const allAllocations = [
      ...otherSiblings.map((s) => ({ allocatedAmountExVat: s.allocatedAmountExVat })),
      ...added.map((l) => ({ allocatedAmountExVat: Number(l.allocStr) || 0 })),
      { allocatedAmountExVat: Number.isFinite(allocNum) ? allocNum : 0 },
    ];
    const allocSumCheck = checkQbAllocationSum(qbTotal, allAllocations);
    return {
      otherSiblings,
      qbTotal,
      added,
      defaultThisAlloc,
      allocStr,
      allocNum,
      allocSumCheck,
    };
  }

  // Primary candidate's allocation (used by the Manual Link override
  // section's "did the operator edit the allocation?" check).
  const primaryAlloc = chosenCandidate
    ? computeCandidateAlloc(chosenCandidate)
    : null;
  const thisAllocNum = primaryAlloc?.allocNum ?? NaN;
  const defaultThisAlloc = primaryAlloc?.defaultThisAlloc ?? 0;

  const appWarnings: string[] = [];
  if (result?.warnings.no_po) appWarnings.push("no_po");
  if (result?.warnings.already_linked) appWarnings.push("already_linked");

  const invoiceMatch =
    !!chosenCandidate?.qbDocNumber &&
    !!appLine.invoiceNumber &&
    chosenCandidate.qbDocNumber.replace(/\D/g, "") === appLine.invoiceNumber.replace(/\D/g, "");

  const amountDiff =
    chosenCandidate?.qbAmountExVat !== null &&
    chosenCandidate?.qbAmountExVat !== undefined &&
    appLine.amountExVat !== null
      ? Math.abs((chosenCandidate.qbAmountExVat ?? 0) - (appLine.amountExVat ?? 0))
      : null;
  const amountMatch = amountDiff !== null ? amountDiff <= 0.01 : undefined;

  const cpMatch = counterpartyNameMatch(appLine.counterpartyName, chosenCandidate?.qbCounterpartyName);

  return (
    <div className="space-y-4 text-sm mt-2" data-testid="proof-drawer">
      <SheetHeader>
        <SheetTitle className="text-sm flex items-center gap-2">
          {appLine.invoiceNumber ?? `App Line #${appLine.id}`}
          {row.lane && (
            <Badge className={`text-[10px] ${laneBadge(row.lane).cls}`}>
              {laneBadge(row.lane).label}
            </Badge>
          )}
        </SheetTitle>
        <p className="text-xs text-muted-foreground">
          {appLine.projectName ?? `Project ${appLine.projectId}`} ·{" "}
          {appLine.counterpartyName ?? "—"}
        </p>
      </SheetHeader>

      {/* App-side warnings */}
      {appWarnings.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <ul className="list-disc list-inside space-y-0.5">
            {appWarnings.map((w) => (
              <li key={w}>{WARNING_LABEL[w] ?? w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* No result yet */}
      {!result && row.status === "searching" && (
        <div className="text-muted-foreground text-xs py-4 text-center" data-testid="drawer-state-searching">
          <span className="flex justify-center items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Searching QuickBooks…
          </span>
        </div>
      )}
      {!result && row.status !== "searching" && (
        <div className="text-muted-foreground text-xs py-4 text-center" data-testid="drawer-state-idle">
          No matches found yet. Use the Find button to search.
        </div>
      )}

      {result && result.candidates.length === 0 && (
        <div
          className="rounded border bg-slate-50 p-3 text-xs text-slate-600"
          data-testid="drawer-state-no-candidates"
        >
          No QB candidates found. Try the manual link below if you know the QB ID.
        </div>
      )}

      {result && result.candidates.length > 0 && (
        <>
          {/* Task #142 — Multi-QB candidate selector. Each candidate is
              a checkbox; the operator can link this app line to multiple
              QB docs in one approve action. The "primary" one (radio
              indicator) drives the proof table / score reasons / warnings
              display above. */}
          {result.candidates.length > 0 && (
            <div className="space-y-1" data-testid="drawer-candidates">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">
                QB Candidates ({selectedSet.size}/{result.candidates.length} selected)
              </div>
              <div className="flex gap-1 flex-wrap">
                {result.candidates.map((c, i) => {
                  const checked = selectedSet.has(i);
                  const isPrimary = i === primaryIdx;
                  return (
                    <label
                      key={c.qbEntityId}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] border cursor-pointer ${
                        checked
                          ? isPrimary
                            ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                            : "bg-sky-50 border-sky-200 text-sky-800"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                      data-testid={`drawer-candidate-${i}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleCandidate(i)}
                        className="h-3 w-3"
                        data-testid={`drawer-candidate-checkbox-${i}`}
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedCandidateIdx(i)}
                        className="flex items-center gap-1"
                        data-testid={`drawer-candidate-primary-${i}`}
                      >
                        <span className="font-medium">#{i + 1}</span>
                        <span>· {c.qbDocNumber ?? c.qbEntityId} · {c.confidence}%</span>
                        {isPrimary && checked && (
                          <span className="text-[9px] uppercase font-semibold text-emerald-700">
                            primary
                          </span>
                        )}
                      </button>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Side-by-side proof table */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase mb-1 font-medium">
              Side-by-side Evidence
            </div>
            <table className="w-full" data-testid="proof-table">
              <thead className="text-[10px] text-muted-foreground uppercase">
                <tr>
                  <th className="text-left py-1 w-28">Field</th>
                  <th className="text-left py-1">App Value</th>
                  <th className="text-left py-1">QB Value</th>
                  <th className="text-center py-1 w-8">✓</th>
                </tr>
              </thead>
              <tbody>
                <ProofFieldRow
                  field="invoice-num"
                  label="Invoice #"
                  appVal={appLine.invoiceNumber}
                  qbVal={chosenCandidate?.qbDocNumber ?? null}
                  match={invoiceMatch}
                />
                <ProofFieldRow
                  field="date"
                  label="Date"
                  appVal={appLine.invoiceDate}
                  qbVal={chosenCandidate?.qbTxnDate ?? null}
                />
                <ProofFieldRow
                  field="amount"
                  label="Amount ex-VAT"
                  appVal={formatRand(appLine.amountExVat)}
                  qbVal={formatRand(chosenCandidate?.qbAmountExVat ?? null)}
                  match={amountMatch}
                />
                <ProofFieldRow
                  field="counterparty"
                  label="Counterparty"
                  appVal={appLine.counterpartyName}
                  qbVal={chosenCandidate?.qbCounterpartyName ?? null}
                  match={cpMatch}
                />
                <ProofFieldRow
                  field="description"
                  label="Description"
                  appVal={appLine.description ?? result.app.description ?? null}
                  qbVal={chosenCandidate?.qbDescription ?? null}
                />
                {scope === "cost" && result.app.poNumber && (
                  <ProofFieldRow
                    field="po-number"
                    label="PO Number"
                    appVal={result.app.poNumber}
                    qbVal={null}
                  />
                )}
              </tbody>
            </table>
          </div>

          {/* Score reasons */}
          {chosenCandidate && (
            <div>
              <div className="text-[10px] text-muted-foreground uppercase mb-1 font-medium">
                Score Reasons
              </div>
              <div className="flex items-center gap-2 mb-1">
                <Badge className={`text-[10px] ${confidenceBadge(chosenCandidate.confidence).cls}`}>
                  {chosenCandidate.confidence}% confidence
                </Badge>
                <Badge className={`text-[10px] ${laneBadge(row.lane).cls}`}>
                  {laneBadge(row.lane).label} lane
                </Badge>
              </div>
              <ul className="space-y-0.5" data-testid="drawer-score-reasons">
                {chosenCandidate.reasons.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-1 text-xs"
                    data-testid={`drawer-reason-${i}`}
                  >
                    <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warning details */}
          {chosenCandidate && chosenCandidate.warnings.length > 0 && (
            <div data-testid="drawer-warnings">
              <div className="text-[10px] text-muted-foreground uppercase mb-1 font-medium">
                Warning Details
              </div>
              <ul className="space-y-1">
                {chosenCandidate.warnings.map((w) => (
                  <li
                    key={w}
                    className="flex items-start gap-1 text-xs text-amber-800"
                    data-testid={`drawer-warning-${w}`}
                  >
                    <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      <strong>{w}:</strong> {WARNING_LABEL[w] ?? w}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Task #142 — One QB Allocation panel per selected candidate.
              Each panel shows existing siblings + this-app-line editor +
              any operator-added sibling app lines + live tolerance gate. */}
          {[...selectedSet].sort((a, b) => a - b).map((idx) => {
            const c = result.candidates[idx];
            if (!c) return null;
            const ca = computeCandidateAlloc(c);
            return (
              <QbAllocationPanel
                key={c.qbEntityId}
                candidate={c}
                candidateIndex={idx}
                appEntityType={appEntityType}
                appLine={appLine}
                projectId={result.app.projectId}
                scope={scope}
                otherSiblings={ca.otherSiblings}
                qbTotal={ca.qbTotal}
                allocStr={ca.allocStr}
                onAllocStrChange={(v) =>
                  setAllocStrByQb((prev) => ({ ...prev, [c.qbEntityId]: v }))
                }
                addedLines={ca.added}
                onAddedLinesChange={(updater) =>
                  setAddedLinesByQb((prev) => ({
                    ...prev,
                    [c.qbEntityId]: updater(prev[c.qbEntityId] ?? []),
                  }))
                }
                allocSumCheck={ca.allocSumCheck}
                isPrimary={idx === primaryIdx}
              />
            );
          })}

          {/* Payment status */}
          {chosenCandidate?.qbPaymentStatus && (
            <div className="rounded border p-2 text-xs" data-testid="drawer-payment-status">
              <div className="text-[10px] text-muted-foreground uppercase mb-1">QB Payment Status</div>
              <div className="flex items-center gap-2">
                <Badge
                  className={`text-[10px] ${
                    chosenCandidate.qbPaymentStatus === "paid"
                      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                      : chosenCandidate.qbPaymentStatus === "partial"
                        ? "bg-amber-100 text-amber-700 border-amber-200"
                        : "bg-rose-100 text-rose-700 border-rose-200"
                  }`}
                >
                  {chosenCandidate.qbPaymentStatus}
                </Badge>
                {chosenCandidate.qbBalance !== null && (
                  <span className="text-muted-foreground">
                    Balance: {formatRand(chosenCandidate.qbBalance)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Approve / Reject actions */}
          {row.status === "found" && (
            <div className="space-y-3 pt-2 border-t" data-testid="drawer-actions">
              {/* Approve */}
              <div>
                {(() => {
                  // Task #142 — Build allocation blocks for every selected
                  // QB candidate. Approve gates on every block being
                  // balanced (or every block having an unknown QB total).
                  const selectedIdxes = [...selectedSet].sort((a, b) => a - b);
                  const blocks = selectedIdxes
                    .map((idx) => {
                      const c = result.candidates[idx];
                      if (!c) return null;
                      const ca = computeCandidateAlloc(c);
                      const lineAllocations: ApproveLineAllocation[] = [
                        ...ca.otherSiblings.map((s) => ({
                          appEntityType: s.appEntityType,
                          appEntityId: s.appEntityId,
                          allocatedAmountExVat: s.allocatedAmountExVat,
                        })),
                        ...ca.added.map((l) => ({
                          appEntityType: l.appEntityType,
                          appEntityId: l.appEntityId,
                          allocatedAmountExVat: Number(l.allocStr) || 0,
                        })),
                        {
                          appEntityType,
                          appEntityId: appLine.id,
                          allocatedAmountExVat: ca.allocNum,
                        },
                      ];
                      return {
                        candidateIndex: idx,
                        lineAllocations,
                        balanced: ca.allocSumCheck.ok,
                        hasInvalidAlloc:
                          !Number.isFinite(ca.allocNum) || ca.allocNum <= 0,
                        hasInvalidAddedAlloc: ca.added.some(
                          (l) => !Number.isFinite(Number(l.allocStr)) || Number(l.allocStr) <= 0,
                        ),
                      };
                    })
                    .filter((b): b is NonNullable<typeof b> => b !== null);
                  const allBalanced = blocks.length > 0 && blocks.every((b) => b.balanced);
                  const anyInvalidAlloc = blocks.some(
                    (b) => b.hasInvalidAlloc || b.hasInvalidAddedAlloc,
                  );
                  const isMulti =
                    blocks.length > 1 ||
                    blocks.some((b) => b.lineAllocations.length > 1);
                  return (
                    <Button
                      size="sm"
                      className="h-7 text-xs w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={
                        approvePending ||
                        blocks.length === 0 ||
                        result.warnings.already_linked ||
                        !allBalanced ||
                        anyInvalidAlloc
                      }
                      onClick={() => {
                        if (isMulti) {
                          onApproveMulti(
                            blocks.map((b) => ({
                              candidateIndex: b.candidateIndex,
                              lineAllocations: b.lineAllocations,
                            })),
                          );
                        } else {
                          // Single QB doc with single (own) line — preserve
                          // legacy single-approve path. If the operator
                          // edited the allocation, forward it; else send
                          // without allocations to use the legacy 100% path.
                          const only = blocks[0]!;
                          const editedAway =
                            only.lineAllocations.length > 1 ||
                            Math.abs(
                              only.lineAllocations[0]!.allocatedAmountExVat -
                                Number(appLine.amountExVat ?? 0),
                            ) > 0.01;
                          onApprove(
                            only.candidateIndex,
                            editedAway ? only.lineAllocations : undefined,
                          );
                        }
                      }}
                      data-testid="drawer-btn-approve"
                    >
                      {approvePending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-2" />
                      ) : (
                        <Link2 className="h-3 w-3 mr-2" />
                      )}
                      {isMulti
                        ? `Approve & Link to ${blocks.length} QB Doc${blocks.length === 1 ? "" : "s"}`
                        : `Approve Match #${selectedCandidateIdx + 1}`}
                    </Button>
                  );
                })()}
                {result.warnings.already_linked && (
                  <p className="text-[10px] text-rose-700 mt-1">
                    Cannot approve: this app line is already linked.
                  </p>
                )}
                {chosenCandidate?.qbAlreadyLinkedElsewhere && !result.warnings.already_linked && (
                  <p className="text-[10px] text-amber-700 mt-1">
                    This QB doc already pays other app lines — your allocation will join the
                    existing sibling group below.
                  </p>
                )}
              </div>

              {/* Reject */}
              <div className="space-y-1">
                <Label className="text-[10px]">Reject reason</Label>
                <Input
                  className="h-7 text-xs"
                  placeholder="e.g. wrong project"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  data-testid="drawer-input-reject-reason"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs w-full"
                  disabled={!rejectReason.trim() || rejectMut.isPending}
                  onClick={() => {
                    if (result)
                      rejectMut.mutate({ suggestionId: result.suggestionId, reason: rejectReason.trim() });
                  }}
                  data-testid="drawer-btn-reject"
                >
                  {rejectMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                  Record Rejection
                </Button>
              </div>
            </div>
          )}

          {/* Approved / Rejected status */}
          {row.status === "approved" && (
            <div
              className="flex items-center gap-2 text-xs text-emerald-700"
              data-testid="drawer-state-approved"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>This match has been approved and linked.</span>
            </div>
          )}
          {row.status === "rejected" && (
            <div className="text-xs text-slate-500" data-testid="drawer-state-rejected">
              This suggestion has been rejected.
            </div>
          )}
        </>
      )}

      {/* Manual link (override) — always available */}
      <div className="rounded border border-sky-200 bg-sky-50/40 p-3 space-y-2 mt-2">
        <div className="flex items-center gap-1 text-xs font-medium text-sky-800">
          <Link2 className="h-3.5 w-3.5" /> Manual link (override — financials:override only)
        </div>
        <Label className="text-[10px] text-sky-900">
          QB {scope === "cost" ? "Bill" : "Invoice"} ID
        </Label>
        <Input
          placeholder="e.g. 12345"
          className="h-7 text-xs font-mono"
          value={manualQbId}
          onChange={(e) => setManualQbId(e.target.value)}
          data-testid="drawer-input-manual-qb-id"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] w-full"
          disabled={manualMut.isPending || !/^[A-Za-z0-9_-]+$/.test(manualQbId.trim())}
          onClick={() =>
            manualMut.mutate({
              qbEntityId: manualQbId.trim(),
              appEntityId: row.appLine.id,
              // Forward the operator's per-link Rand if they edited it
              // away from the candidate's default (which is also the app
              // amount when no QB total is known).
              ...(Number.isFinite(thisAllocNum) &&
              Math.abs(thisAllocNum - defaultThisAlloc) > 0.001
                ? { allocatedAmountExVat: thisAllocNum }
                : {}),
            })
          }
          data-testid="drawer-btn-manual-link"
        >
          {manualMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
          Manual link
        </Button>
      </div>
    </div>
  );
}

// ─── QB Allocation Panel (Task #142) ──────────────────────────────────────────
// One panel per selected QB candidate. Shows existing siblings, an editable
// "this app line" allocation, an "add another app line" search/typeahead,
// and a live tolerance gate.

interface AppLineSearchHit {
  appEntityType: "cost_line" | "revenue_line";
  appEntityId: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number | null;
  counterpartyName: string | null;
  projectId: number | null;
  projectName: string | null;
}

function QbAllocationPanel(props: {
  candidate: ScoredCandidate;
  candidateIndex: number;
  appEntityType: "cost_line" | "revenue_line";
  appLine: { id: number; amountExVat: number | null; invoiceNumber: string | null };
  projectId: number | null;
  scope: Scope;
  otherSiblings: NonNullable<ScoredCandidate["qbAllocation"]>["siblings"];
  qbTotal: number | null;
  allocStr: string;
  onAllocStrChange: (v: string) => void;
  addedLines: AddedAppLine[];
  onAddedLinesChange: (updater: (prev: AddedAppLine[]) => AddedAppLine[]) => void;
  allocSumCheck: ReturnType<typeof checkQbAllocationSum>;
  isPrimary: boolean;
}) {
  const {
    candidate: c,
    candidateIndex,
    appEntityType,
    appLine,
    projectId,
    scope,
    otherSiblings,
    qbTotal,
    allocStr,
    onAllocStrChange,
    addedLines,
    onAddedLinesChange,
    allocSumCheck,
    isPrimary,
  } = props;

  // Typeahead search state for "+ Add another app line".
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const searchQuery = useQuery({
    queryKey: [
      "/api/quickbooks/invoice-matches/app-lines/search",
      scope,
      debouncedSearch,
      projectId,
    ],
    enabled: debouncedSearch.length >= 2,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("scope", scope === "cost" ? "cost" : "revenue");
      params.set("q", debouncedSearch);
      if (projectId !== null) params.set("projectId", String(projectId));
      params.set("limit", "10");
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/invoice-matches/app-lines/search?${params.toString()}`,
      );
      return (await res.json()) as { items: AppLineSearchHit[] };
    },
    staleTime: 30_000,
  });

  const candidateAppLineIds = new Set<string>([
    `${appEntityType}:${appLine.id}`,
    ...otherSiblings.map((s) => `${s.appEntityType}:${s.appEntityId}`),
    ...addedLines.map((l) => `${l.appEntityType}:${l.appEntityId}`),
  ]);

  const addLine = (hit: AppLineSearchHit) => {
    const key = `${hit.appEntityType}:${hit.appEntityId}`;
    if (candidateAppLineIds.has(key)) return;
    const remaining = qbTotal !== null
      ? Math.max(0, Number((qbTotal -
          otherSiblings.reduce((a, s) => a + (Number(s.allocatedAmountExVat) || 0), 0) -
          addedLines.reduce((a, l) => a + (Number(l.allocStr) || 0), 0) -
          (Number(allocStr) || 0)
        ).toFixed(2)))
      : Number(hit.amountExVat ?? 0);
    const proposed = Math.min(remaining, Number(hit.amountExVat ?? remaining)) || 0.01;
    onAddedLinesChange((prev) => [
      ...prev,
      {
        appEntityType: hit.appEntityType,
        appEntityId: hit.appEntityId,
        label: `${hit.appEntityType === "cost_line" ? "Cost" : "Revenue"} #${hit.appEntityId}${
          hit.invoiceNumber ? ` · ${hit.invoiceNumber}` : ""
        }${hit.counterpartyName ? ` · ${hit.counterpartyName}` : ""}`,
        allocStr: proposed.toFixed(2),
      },
    ]);
    setSearch("");
    setDebouncedSearch("");
  };

  const removeAddedLine = (idx: number) => {
    onAddedLinesChange((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateAddedAlloc = (idx: number, v: string) => {
    onAddedLinesChange((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, allocStr: v } : l)),
    );
  };

  return (
    <div
      className={`rounded border p-3 space-y-2 ${
        isPrimary ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-slate-50/60"
      }`}
      data-testid={`drawer-qb-allocation-${candidateIndex}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-muted-foreground uppercase font-medium">
          QB Allocation · #{candidateIndex + 1} {c.qbDocNumber ?? c.qbEntityId}
          {isPrimary && (
            <span className="ml-1 text-[9px] uppercase font-semibold text-emerald-700">
              primary
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          QB total: <span className="font-mono">{formatRand(qbTotal)}</span>
        </div>
      </div>

      {/* Existing sibling rows */}
      {otherSiblings.length > 0 && (
        <div
          className="space-y-1 text-[11px]"
          data-testid={`drawer-allocation-siblings-${candidateIndex}`}
        >
          {otherSiblings.map((s) => (
            <div
              key={s.linkId}
              className="flex items-center justify-between rounded bg-white px-2 py-1 border border-slate-200"
              data-testid={`drawer-allocation-sibling-${s.linkId}`}
            >
              <span className="text-slate-600">
                {s.appEntityType === "cost_line" ? "Cost line" : "Revenue line"} #
                {s.appEntityId}
              </span>
              <span className="font-mono tabular-nums">
                {formatRand(s.allocatedAmountExVat)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Operator-added sibling rows (this approve action only) */}
      {addedLines.length > 0 && (
        <div
          className="space-y-1 text-[11px]"
          data-testid={`drawer-allocation-added-${candidateIndex}`}
        >
          {addedLines.map((l, i) => (
            <div
              key={`${l.appEntityType}:${l.appEntityId}`}
              className="flex items-center gap-2 rounded bg-sky-50/60 px-2 py-1 border border-sky-200"
              data-testid={`drawer-allocation-added-row-${candidateIndex}-${i}`}
            >
              <span className="text-slate-700 flex-1 truncate">{l.label}</span>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                className="h-6 text-[11px] font-mono w-24 text-right"
                value={l.allocStr}
                onChange={(e) => updateAddedAlloc(i, e.target.value)}
                data-testid={`drawer-allocation-added-input-${candidateIndex}-${i}`}
              />
              <button
                type="button"
                onClick={() => removeAddedLine(i)}
                className="text-rose-600 hover:text-rose-700"
                data-testid={`drawer-allocation-added-remove-${candidateIndex}-${i}`}
                aria-label="Remove added line"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* This app line's editable allocation */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200">
        <Label className="text-[11px] text-slate-700">
          This line allocation (R) — {appEntityType === "cost_line" ? "Cost" : "Revenue"} #
          {appLine.id}
        </Label>
        <Input
          type="number"
          step="0.01"
          min="0.01"
          className="h-7 text-xs font-mono w-32 text-right"
          value={allocStr}
          onChange={(e) => onAllocStrChange(e.target.value)}
          data-testid={`drawer-input-this-allocation-${candidateIndex}`}
        />
      </div>

      {/* + Add another app line — search combobox */}
      <div className="space-y-1 pt-1 border-t border-slate-200">
        <Label className="text-[10px] text-slate-600">
          + Add another app line to this QB doc
        </Label>
        <div className="relative">
          <Input
            placeholder="Search by invoice #, counterparty, or project (min 2 chars)…"
            className="h-7 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid={`drawer-app-line-search-${candidateIndex}`}
          />
          {debouncedSearch.length >= 2 && (
            <div
              className="absolute z-10 mt-1 w-full rounded border border-slate-200 bg-white shadow-md max-h-60 overflow-y-auto"
              data-testid={`drawer-app-line-search-results-${candidateIndex}`}
            >
              {searchQuery.isLoading && (
                <div className="px-2 py-2 text-[11px] text-muted-foreground">
                  Searching…
                </div>
              )}
              {!searchQuery.isLoading &&
                (searchQuery.data?.items.length ?? 0) === 0 && (
                  <div className="px-2 py-2 text-[11px] text-muted-foreground">
                    No matches.
                  </div>
                )}
              {(searchQuery.data?.items ?? []).map((hit) => {
                const key = `${hit.appEntityType}:${hit.appEntityId}`;
                const already = candidateAppLineIds.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => !already && addLine(hit)}
                    disabled={already}
                    className={`w-full text-left px-2 py-1.5 text-[11px] border-b border-slate-100 last:border-b-0 ${
                      already
                        ? "bg-slate-50 text-slate-400 cursor-not-allowed"
                        : "hover:bg-emerald-50 text-slate-700"
                    }`}
                    data-testid={`drawer-app-line-search-hit-${candidateIndex}-${hit.appEntityId}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {hit.invoiceNumber ?? `#${hit.appEntityId}`}
                        {hit.counterpartyName && ` · ${hit.counterpartyName}`}
                        {hit.projectName && ` · ${hit.projectName}`}
                      </span>
                      <span className="font-mono shrink-0">
                        {formatRand(hit.amountExVat)}
                      </span>
                    </div>
                    {already && (
                      <div className="text-[9px] text-slate-400">
                        already in this allocation
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Live tolerance summary */}
      <div
        className={`text-[10px] flex items-center justify-between rounded px-2 py-1 ${
          !allocSumCheck.ok
            ? "bg-rose-50 text-rose-800 border border-rose-200"
            : allocSumCheck.partial || allocSumCheck.toleranceApplied
              ? "bg-amber-50 text-amber-800 border border-amber-200"
              : "bg-emerald-50 text-emerald-800 border border-emerald-200"
        }`}
        data-testid={`drawer-allocation-summary-${candidateIndex}`}
      >
        <span>
          Sum {formatRand(allocSumCheck.sum)}
          {allocSumCheck.delta !== null && (
            <> · Δ {formatRand(allocSumCheck.delta)}</>
          )}
        </span>
        <span>
          {!allocSumCheck.ok
            ? `over by more than ±${formatRand(allocSumCheck.tolerance)} tol.`
            : allocSumCheck.partial
              ? `partial — ${formatRand(allocSumCheck.remaining)} remaining`
              : allocSumCheck.toleranceApplied
                ? `within ±${formatRand(allocSumCheck.tolerance)} tol.`
                : "balanced"}
        </span>
      </div>
    </div>
  );
}

function ProofFieldRow({
  field,
  label,
  appVal,
  qbVal,
  match,
}: {
  field: string;
  label: string;
  appVal: string | null;
  qbVal: string | null;
  match?: boolean;
}) {
  return (
    <tr className="border-t text-xs" data-testid={`proof-field-${field}`}>
      <td className="py-1.5 pr-3 text-muted-foreground font-medium w-28">{label}</td>
      <td className="py-1.5 pr-3 font-mono" data-testid={`proof-app-value-${field}`}>
        {appVal ?? "—"}
      </td>
      <td className="py-1.5 pr-3 font-mono" data-testid={`proof-qb-value-${field}`}>
        {qbVal ?? "—"}
      </td>
      <td className="py-1.5 text-center" data-testid={`proof-match-${field}`}>
        {match === undefined ? null : match ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 inline" />
        ) : (
          <X className="h-3.5 w-3.5 text-rose-500 inline" />
        )}
      </td>
    </tr>
  );
}

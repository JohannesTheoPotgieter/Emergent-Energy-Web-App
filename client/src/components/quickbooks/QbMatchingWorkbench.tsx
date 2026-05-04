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
      }));
    }
    return (revenueQuery.data?.revenueLines ?? []).map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      amountExVat: r.amountExVat,
      counterpartyName: r.milestoneName,
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
    mutationFn: async (vars: { suggestionId: number; candidateIndex: number; notes?: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/quickbooks/invoice-matches/${vars.suggestionId}/approve`,
        { candidateIndex: vars.candidateIndex, notes: vars.notes },
      );
      return res.json() as Promise<{ linkId: number }>;
    },
    onSuccess: (data, vars) => {
      toast({ title: "Match approved", description: `Link #${data.linkId} created.` });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      const row = rowsRef.current.find((r) => r.findResult?.suggestionId === vars.suggestionId);
      if (row) updateRow(row.id, { status: "approved" });
      setDrawerRowId(null);
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
                      <span className="font-medium">{best.qbDocNumber ?? best.qbEntityId}</span>
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
              onApprove={(candidateIndex) => {
                if (!drawerRow.findResult) return;
                singleApproveMut.mutate({
                  suggestionId: drawerRow.findResult.suggestionId,
                  candidateIndex,
                });
              }}
              approvePending={singleApproveMut.isPending}
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

export interface ProofDrawerProps {
  row: WorkbenchRow;
  scope: Scope;
  onApprove: (candidateIndex: number) => void;
  approvePending: boolean;
  onRejectDone: () => void;
}

export function ProofDrawerContent({ row, scope, onApprove, approvePending }: ProofDrawerProps) {
  const { toast } = useToast();
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0);
  const [rejectReason, setRejectReason] = useState("");
  const [manualQbId, setManualQbId] = useState("");
  const manualMut = useMutation({
    mutationFn: async (vars: { qbEntityId: string; appEntityId: number }) => {
      const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/manual-link", {
        scope,
        appEntityId: vars.appEntityId,
        qbEntityId: vars.qbEntityId,
        notes: "manual_override via QB Matching Workbench",
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
          {/* Candidate selector */}
          {result.candidates.length > 1 && (
            <div className="flex gap-1 flex-wrap" data-testid="drawer-candidates">
              {result.candidates.map((c, i) => (
                <button
                  key={c.qbEntityId}
                  onClick={() => setSelectedCandidateIdx(i)}
                  className={`px-2 py-0.5 rounded text-[10px] border ${
                    i === selectedCandidateIdx
                      ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                  data-testid={`drawer-candidate-${i}`}
                >
                  #{i + 1} · {c.qbDocNumber ?? c.qbEntityId} · {c.confidence}%
                </button>
              ))}
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
                <Button
                  size="sm"
                  className="h-7 text-xs w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={
                    approvePending ||
                    !chosenCandidate ||
                    (chosenCandidate?.qbAlreadyLinkedElsewhere ?? false) ||
                    result.warnings.already_linked
                  }
                  onClick={() => onApprove(selectedCandidateIdx)}
                  data-testid="drawer-btn-approve"
                >
                  {approvePending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-2" />
                  ) : (
                    <Link2 className="h-3 w-3 mr-2" />
                  )}
                  Approve Match #{selectedCandidateIdx + 1}
                </Button>
                {(chosenCandidate?.qbAlreadyLinkedElsewhere || result.warnings.already_linked) && (
                  <p className="text-[10px] text-rose-700 mt-1">
                    Cannot approve: link conflict detected.
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
            manualMut.mutate({ qbEntityId: manualQbId.trim(), appEntityId: row.appLine.id })
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

// ─── Proof Field Row ──────────────────────────────────────────────────────────

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

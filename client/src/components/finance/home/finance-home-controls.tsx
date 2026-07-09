/**
 * Finance Home — interactive control chrome (presentation + light mutation).
 *
 * These pieces read figures the page already derived from the canonical ledger
 * and never compute a finance number themselves:
 *   - ImportFreshnessChip  (item 4) — import health/trust chip → control tower.
 *   - DashboardControls    (items 5,6) — as-at basis · grain · prior-FY compare.
 *   - BoardExportMenu      (item 7) — CSV / XLSX board export.
 *   - BoardTargetDialog    (item 8) — allowlisted admins set the FY board target.
 *   - ExceptionWatchList   (item 3) — rule-flagged projects, each → project detail.
 */
import * as React from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Target,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoneyValue } from "@/components/finance/template";
import { formatZarCompact } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type {
  AsAtMode,
  BoardTarget,
  ChartGrain,
  ExceptionReason,
  ExceptionWatchList as ExceptionWatchListModel,
} from "@/lib/finance/home-data";

// ── Item 4 — import freshness / health chip ──────────────────────────────────

export interface ImportFreshnessChipProps {
  /** Relative "3 hr ago" text (with absolute in the title), or null when never. */
  relative: string | null;
  title?: string;
  trackers: number;
  parked: number;
  flagged: number;
}

export function ImportFreshnessChip({ relative, title, trackers, parked, flagged }: ImportFreshnessChipProps) {
  const hasAttention = parked > 0 || flagged > 0;
  return (
    <Link
      href="/admin/import-control-tower"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        hasAttention
          ? "border-status-drift/40 bg-amber-50 text-status-drift hover:bg-amber-100"
          : "border-slate-200 bg-white text-slate-600 hover:border-emerald-600",
      )}
      title={title ?? undefined}
      data-testid="finance-home-import-chip"
    >
      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
      <span className="tabular-nums">
        {relative ? `Last import ${relative}` : "No imports yet"}
      </span>
      <span className="text-slate-300">·</span>
      <span className="tabular-nums">{trackers} trackers</span>
      <span className="text-slate-300">·</span>
      <span className="tabular-nums">{parked} parked</span>
      <span className="text-slate-300">·</span>
      <span className="tabular-nums">{flagged} flagged</span>
    </Link>
  );
}

// ── Items 5 & 6 — as-at basis · grain · prior-FY compare ──────────────────────

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-md border border-border bg-background p-0.5"
      data-testid={testId}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "rounded px-2 py-1 text-[11px] font-medium transition-colors",
            value === o.value ? "bg-emerald-600 text-white" : "text-slate-600 hover:text-slate-900",
          )}
          data-testid={testId ? `${testId}-${o.value}` : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface DashboardControlsProps {
  asAt: AsAtMode;
  onAsAt: (v: AsAtMode) => void;
  grain: ChartGrain;
  onGrain: (v: ChartGrain) => void;
  compare: boolean;
  onCompare: (v: boolean) => void;
  /** Prior FY label for the compare toggle, e.g. "FY25". */
  priorLabel: string;
}

export function DashboardControls({
  asAt,
  onAsAt,
  grain,
  onGrain,
  compare,
  onCompare,
  priorLabel,
}: DashboardControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="finance-home-dashboard-controls">
      <span className="text-[11px] font-medium text-slate-500">Realised as at</span>
      <Segmented<AsAtMode>
        ariaLabel="Realised as at"
        value={asAt}
        onChange={onAsAt}
        testId="finance-home-asat"
        options={[
          { value: "closed", label: "Last closed month" },
          { value: "open", label: "Incl. open month" },
        ]}
      />
      <span className="ml-1 text-[11px] font-medium text-slate-500">Grain</span>
      <Segmented<ChartGrain>
        ariaLabel="Chart grain"
        value={grain}
        onChange={onGrain}
        testId="finance-home-grain"
        options={[
          { value: "month", label: "Month" },
          { value: "quarter", label: "Quarter" },
        ]}
      />
      <button
        type="button"
        onClick={() => onCompare(!compare)}
        aria-pressed={compare}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
          compare
            ? "border-emerald-600 bg-emerald-50 text-emerald-700"
            : "border-border bg-background text-slate-600 hover:text-slate-900",
        )}
        data-testid="finance-home-compare-toggle"
      >
        Compare {priorLabel}
      </button>
    </div>
  );
}

// ── Item 7 — board-ready export menu ─────────────────────────────────────────

export function BoardExportMenu({
  onExport,
  disabled,
}: {
  onExport: (format: "csv" | "xlsx") => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={disabled}
          data-testid="finance-home-export"
        >
          <Download className="h-3.5 w-3.5" />
          Export
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onExport("xlsx")} data-testid="finance-home-export-xlsx">
          <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("csv")} data-testid="finance-home-export-csv">
          <Download className="mr-2 h-3.5 w-3.5" />
          CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Item 8 — board-target admin dialog (allowlisted) ─────────────────────────

export function BoardTargetDialog({
  fy,
  fyLabel,
  current,
  onSaved,
}: {
  fy: number;
  fyLabel: string;
  current: BoardTarget | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [revenue, setRevenue] = React.useState("");
  const [margin, setMargin] = React.useState("");
  const [reason, setReason] = React.useState("");

  // Seed the form from the current target whenever the dialog opens.
  React.useEffect(() => {
    if (open) {
      setRevenue(current?.revenueTarget != null ? String(current.revenueTarget) : "");
      setMargin(current?.targetMarginPct != null ? String(current.targetMarginPct) : "");
      setReason("");
    }
  }, [open, current]);

  const mutation = useMutation({
    mutationFn: async () => {
      const parseNum = (s: string): number | null => {
        const t = s.trim();
        if (t === "") return null;
        const n = Number(t);
        if (!Number.isFinite(n)) throw new Error("Enter a valid number");
        return n;
      };
      const body = {
        revenueTarget: parseNum(revenue),
        targetMarginPct: parseNum(margin),
        reason: reason.trim() || undefined,
      };
      await apiRequest("PUT", `/api/admin/board-targets/${fy}`, body);
    },
    onSuccess: () => {
      toast({ title: `${fyLabel} board target saved` });
      setOpen(false);
      onSaved();
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not save target",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" data-testid="finance-home-board-target-open">
          <Target className="h-3.5 w-3.5" />
          Board target
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Board FY target — {fyLabel}</DialogTitle>
          <DialogDescription>
            The board-approved FY revenue target (ex-VAT) and target GP margin. When set, the Revenue KPI
            compares against this target and drops the “Provisional” badge. Changes are audited.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="board-revenue-target" className="text-xs">
              FY revenue target (R, ex-VAT)
            </Label>
            <Input
              id="board-revenue-target"
              inputMode="decimal"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              placeholder="e.g. 250000000"
              data-testid="finance-home-board-target-revenue"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="board-target-margin" className="text-xs">
              Target GP margin (%)
            </Label>
            <Input
              id="board-target-margin"
              inputMode="decimal"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              placeholder="e.g. 15"
              data-testid="finance-home-board-target-margin"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="board-target-reason" className="text-xs">
              Reason (optional, for the audit trail)
            </Label>
            <Input
              id="board-target-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. FY26 board pack, approved 8 Jul"
              data-testid="finance-home-board-target-reason"
            />
          </div>
          <p className="text-[11px] text-slate-400">
            Leave a field blank to clear it. Blank on both reverts the Revenue KPI to the FY budget
            (“Provisional”).
          </p>
          <DialogFooter>
            <Button
              type="submit"
              size="sm"
              disabled={mutation.isPending}
              data-testid="finance-home-board-target-save"
            >
              {mutation.isPending ? "Saving…" : "Save target"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Item 3 — exception watch-list ─────────────────────────────────────────────

const REASON_META: Record<ExceptionReason, { label: string; className: string }> = {
  negative_gp: { label: "Negative GP", className: "border-red-200 bg-red-50 text-red-700" },
  low_margin: { label: "Low margin", className: "border-amber-200 bg-amber-50 text-status-drift" },
  tracker_drift: { label: "Tracker drift", className: "border-amber-200 bg-amber-50 text-status-drift" },
};

export function ExceptionWatchList({
  list,
  onViewAll,
}: {
  list: ExceptionWatchListModel;
  onViewAll?: () => void;
}) {
  if (list.rows.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-slate-400" data-testid="finance-home-exceptions-empty">
        <AlertTriangle className="h-4 w-4 text-emerald-500" />
        No projects flagged — negative GP, sub-5% margin and tracker drift all clear.
      </div>
    );
  }
  return (
    <div data-testid="finance-home-exceptions">
      <ul className="divide-y divide-slate-100">
        {list.rows.map((r) => (
          <li key={r.projectId} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Link
                href={`/projects/${r.projectId}/finance`}
                className="truncate font-medium text-slate-700 hover:underline"
                data-testid={`finance-home-exception-row-${r.projectId}`}
              >
                {r.projectName}
              </Link>
              <div className="flex flex-wrap items-center gap-1">
                {r.reasons.map((reason) => (
                  <Badge
                    key={reason}
                    variant="outline"
                    className={cn("text-[9px]", REASON_META[reason].className)}
                    title={
                      reason === "tracker_drift"
                        ? `App vs tracker drift ${formatZarCompact(r.drift)}`
                        : undefined
                    }
                  >
                    {REASON_META[reason].label}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-right">
              <MoneyValue value={r.gp} className="w-24 text-sm font-medium" />
              <span
                className={cn(
                  "w-14 tabular-nums text-sm font-medium",
                  (r.gpPct ?? 0) < 0 ? "text-status-adverse" : "text-slate-600",
                )}
              >
                {r.gpPct != null ? `${r.gpPct.toFixed(1)}%` : "—"}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {list.totalFlagged > list.rows.length && (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-2 text-[11px] font-medium text-emerald-700 hover:underline"
          data-testid="finance-home-exceptions-view-all"
        >
          View all {list.totalFlagged} flagged projects
        </button>
      )}
    </div>
  );
}

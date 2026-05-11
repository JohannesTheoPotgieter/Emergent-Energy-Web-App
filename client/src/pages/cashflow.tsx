import { useState, useMemo, useCallback, useEffect, useRef, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { extractTrustHeaders, type FinanceTrustMeta } from "@/lib/finance-trust";
import { DataTrustBadge } from "@/components/ui/data-trust-badge";
import { FinanceTrustStrip, isStaleImport } from "@/components/finance/FinanceTrustStrip";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, invalidateDashboardQueries } from "@/lib/queryClient";
import {
  Loader2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  X,
  Check,
  ChevronsUpDown,
  Wallet,
  Pencil,
  Search,
  AlertCircle,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { usePermission } from "@/hooks/use-permissions";
import { DateOverridePopover } from "@/components/cashflow/DateOverridePopover";
import { EditCellPopover } from "@/components/cashflow/EditCellPopover";
import { OverrideChipMenu } from "@/components/cashflow/OverrideChipMenu";

interface OutflowByStatus {
  outOfBank: number;
  outstanding: number;
  risk: number;
  planned: number;
}

interface CashflowWeek {
  weekStart: string;
  weekEnd: string;
  openingBalance: number;
  computedOpening: number;
  hasManualOverride: boolean;
  manualOverrideAt: string | null;
  balanceDelta: number;
  projectInflows: number;
  opexOutflows: number;
  computedOpex: number;
  hasOpexOverride: boolean;
  opexOverrideAt: string | null;
  projectOutflows: number;
  outflowByStatus?: OutflowByStatus;
  closingBalance: number;
  availablePayment: number;
  computedAvailablePayment: number;
  hasAvailPayOverride: boolean;
  availPayReason: string | null;
  availPayOverrideAt: string | null;
  availPayOverrideBy: string | null;
}

interface BalanceHistoryEntry {
  id: number;
  weekStartDate: string;
  previousValue: string | null;
  newValue: string;
  computedValue: string | null;
  delta: string | null;
  changedAt: string;
  changedBy: string | null;
}

interface CashflowTrustSummary {
  lastImportDate: string | null;
  missingTermsCount: number;
  shiftedLineCount: number;
}

interface DetailInflow {
  inflowId: number;
  projectName: string;
  milestoneName: string;
  milestoneInvoiceNumber: string;
  paymentReceivedDate: string;
  originalDate: string | null;
  hasAdminOverride: boolean;
  adminDateOverride: string | null;
  adminDateOverrideReason: string | null;
  adminDateOverrideAt: string | null;
  milestoneAmount: number;
  invoiceRaisedDate: string;
  daysToReceipt: number;
  lastImportedAt?: string | null;
  qbStatus?: "confirmed" | "unlinked";
  qbDocNumber?: string | null;
  qbAmount?: number | null;
  qbPaymentStatus?: "paid" | "partial" | "unpaid" | null;
  qbDivergence?: boolean;
}

interface DetailOutflow {
  expenseId: number;
  projectName: string;
  expenseCategory: string;
  expenseLineItem: string;
  expenseInvoiceNumber: string;
  expensePaymentDate: string;
  originalDate: string | null;
  hasAdminOverride: boolean;
  adminDateOverride: string | null;
  adminDateOverrideReason: string | null;
  adminDateOverrideAt: string | null;
  expenseActualTotal: number;
  paymentStatus: string;
  lastImportedAt?: string | null;
  paymentTermsMissing?: boolean;
  forecastDateShiftDays?: number | null;
  qbStatus?: "confirmed" | "unlinked";
  qbDocNumber?: string | null;
  qbAmount?: number | null;
  qbPaymentStatus?: "paid" | "partial" | "unpaid" | null;
  qbDivergence?: boolean;
}

interface WeekDetail {
  inflows: DetailInflow[];
  outflows: DetailOutflow[];
}

interface OpexEntry {
  monthKey: string;
  amount: number;
}

function formatRand(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${abs.toFixed(0)}`;
}

function formatWeek(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "dd MMM");
  } catch {
    return dateStr;
  }
}

function safeFormatIso(iso: string): string {
  try {
    return format(parseISO(iso), "dd MMM yyyy, HH:mm");
  } catch {
    return iso;
  }
}

/**
 * Determine the fiscal year (Sep-Aug cycle) from the current date.
 * FY runs Sep of (fyYear-1) through Aug of fyYear.
 * e.g. in Mar 2026 -> FY2026 (Sep 2025 - Aug 2026)
 */
function getCurrentFiscalYear(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 0=Jan, 8=Sep
  const year = now.getFullYear();
  // If Sep or later, we're in the next FY
  return month >= 8 ? year + 1 : year;
}

function generateFYMonths(fyYear: number): { key: string; label: string }[] {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months: { key: string; label: string }[] = [];
  // FY starts in Sep of (fyYear - 1) and ends in Aug of fyYear
  for (let i = 0; i < 12; i++) {
    // Sep=8, Oct=9, Nov=10, Dec=11, Jan=0, Feb=1, ..., Aug=7
    const monthIndex = (8 + i) % 12;
    const year = monthIndex >= 8 ? fyYear - 1 : fyYear;
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const label = `${monthNames[monthIndex]} ${year}`;
    months.push({ key, label });
  }
  return months;
}

const CURRENT_FY = getCurrentFiscalYear();
const FY_MONTHS = generateFYMonths(CURRENT_FY);
const CASHFLOW_API_BASE = `/api/cashflow-${CURRENT_FY}`;

function isCurrentWeek(weekStart: string, weekEnd: string): boolean {
  const now = new Date();
  const start = parseISO(weekStart);
  const end = parseISO(weekEnd);
  return now >= start && now < end;
}

function KpiCard({
  title,
  value,
  icon,
  color,
  testId,
  nullCount,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: "green" | "red" | "blue" | "purple" | "slate";
  testId: string;
  nullCount?: number | null;
}) {
  const colorMap = {
    green: {
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      text: "text-emerald-700",
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
    },
    red: {
      bg: "bg-red-50",
      border: "border-red-200",
      text: "text-red-700",
      iconBg: "bg-red-100",
      iconColor: "text-red-600",
    },
    blue: {
      bg: "bg-blue-50",
      border: "border-blue-200",
      text: "text-blue-700",
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
    },
    purple: {
      bg: "bg-violet-50",
      border: "border-violet-200",
      text: "text-violet-700",
      iconBg: "bg-violet-100",
      iconColor: "text-violet-600",
    },
    slate: {
      bg: "bg-slate-50",
      border: "border-slate-200",
      text: "text-slate-700",
      iconBg: "bg-slate-100",
      iconColor: "text-slate-600",
    },
  };

  const c = colorMap[color];

  return (
    <div
      className={`rounded-xl border ${c.border} ${c.bg} p-4 flex items-center gap-3 transition-all hover:shadow-md`}
      data-testid={testId}
    >
      <div className={`rounded-lg ${c.iconBg} p-2.5 ${c.iconColor}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
          {title}
        </p>
        <p className={`text-lg font-bold font-mono ${c.text} truncate`} data-testid={`${testId}-value`}>
          {value}
        </p>
        {nullCount != null && nullCount > 0 ? (
          <p className="text-[11px] font-medium text-amber-600 truncate" data-testid={`${testId}-null-count`}>
            ({nullCount} missing)
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({ weekStart, project, colSpan = 8 }: { weekStart: string; project: string; colSpan?: number }) {
  const [detailSearch, setDetailSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const overrideExpenseDate = useMutation({
    mutationFn: async (data: { expenseId: number; dateOverride: string | null; reason?: string }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${CASHFLOW_API_BASE}/expense-date-override`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      toast({ title: "Expense date override saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save override", description: err.message, variant: "destructive" });
    },
  });

  const overrideInflowDate = useMutation({
    mutationFn: async (data: { inflowId: number; dateOverride: string | null; reason?: string }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${CASHFLOW_API_BASE}/inflow-date-override`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      toast({ title: "Inflow date override saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save override", description: err.message, variant: "destructive" });
    },
  });
  const params = new URLSearchParams({ week: weekStart });
  if (project !== "all") params.set("project", project);

  const { data, isLoading } = useQuery<WeekDetail>({
    queryKey: [`${CASHFLOW_API_BASE}/detail`, weekStart, project],
    queryFn: async () => {
      const res = await fetch(`${CASHFLOW_API_BASE}/detail?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch detail");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={colSpan} className="p-0">
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-6 bg-gradient-to-b from-slate-50 to-white">
            <Loader2 className="h-4 w-4 animate-spin" data-testid="spinner-detail" />
            <span className="text-sm">Loading week detail...</span>
          </div>
        </td>
      </tr>
    );
  }

  if (!data) return null;

  const q = detailSearch.toLowerCase();
  const filteredInflows = q
    ? data.inflows.filter(
        (inf) =>
          inf.projectName.toLowerCase().includes(q) ||
          (inf.milestoneName || "").toLowerCase().includes(q) ||
          (inf.milestoneInvoiceNumber || "").toLowerCase().includes(q)
      )
    : data.inflows;
  const filteredOutflows = q
    ? data.outflows.filter(
        (out) =>
          out.projectName.toLowerCase().includes(q) ||
          (out.expenseCategory || "").toLowerCase().includes(q) ||
          (out.expenseLineItem || "").toLowerCase().includes(q) ||
          (out.expenseInvoiceNumber || "").toLowerCase().includes(q)
      )
    : data.outflows;

  const inflowTotal = filteredInflows.reduce((s, i) => s + (i.milestoneAmount || 0), 0);
  const outflowTotal = filteredOutflows.reduce((s, o) => s + (o.expenseActualTotal || 0), 0);

  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <div className="bg-gradient-to-b from-slate-50/80 to-white border-y border-border/60 px-3 sm:px-6 py-3 sm:py-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
            <Input
              placeholder="Search inflows & outflows..."
              value={detailSearch}
              onChange={(e) => setDetailSearch(e.target.value)}
              className="max-w-xs h-8 text-xs rounded-lg border-border focus:border-blue-400 focus:ring-blue-400"
              data-testid={`input-detail-search-${weekStart}`}
            />
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">
                <ArrowUpRight className="h-3 w-3" />
                {filteredInflows.length} inflows · {formatRand(inflowTotal)}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 text-red-700 font-medium border border-red-200">
                <ArrowDownRight className="h-3 w-3" />
                {filteredOutflows.length} outflows · {formatRand(outflowTotal)}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-lg border border-emerald-200/60 bg-card overflow-hidden">
              <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200/60">
                <h4 className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Inflows
                </h4>
              </div>
              {filteredInflows.length === 0 ? (
                <EmptyState
                  icon={TrendingUp}
                  title="No inflows this week"
                  description="No payments are forecast or received in this window. Use the project planner to add an inflow milestone, or wait for the next sync from QuickBooks."
                  className="m-3"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse" data-testid={`table-inflows-${weekStart}`}>
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Project</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Milestone</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice #</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Days</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">QB</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Signals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInflows.map((inf, i) => (
                        <tr key={i} className="border-b border-border hover:bg-muted/50 transition-colors" data-testid={`row-inflow-${weekStart}-${i}`}>
                          <td className="px-3 py-2 font-medium text-foreground">{inf.projectName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{inf.milestoneName}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground text-[11px]">{inf.milestoneInvoiceNumber || "—"}</td>
                          <td className="px-3 py-2">
                            <DateOverridePopover
                              currentDate={inf.paymentReceivedDate}
                              originalDate={inf.originalDate}
                              hasOverride={inf.hasAdminOverride}
                              overrideReason={inf.adminDateOverrideReason}
                              overrideAt={inf.adminDateOverrideAt}
                              onSave={(dateOverride, reason) =>
                                overrideInflowDate.mutate({ inflowId: inf.inflowId, dateOverride, reason })
                              }
                              testId={`date-override-inflow-${weekStart}-${i}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-emerald-700">{formatRand(inf.milestoneAmount)}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{inf.daysToReceipt ?? "—"}</td>
                          <td className="px-3 py-2" data-testid={`qb-cell-inflow-${weekStart}-${i}`}>
                            {inf.qbStatus === "confirmed" ? (
                              inf.qbPaymentStatus === "paid" ? (
                                <span
                                  className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200"
                                  title={inf.qbDocNumber ? `QB Invoice #${inf.qbDocNumber} · Settled on QuickBooks` : "Settled on QuickBooks"}
                                  data-testid={`qb-status-settled-inflow-${weekStart}-${i}`}
                                >
                                  Settled{inf.qbDocNumber ? ` · ${inf.qbDocNumber}` : ""}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200"
                                    title={inf.qbDocNumber ? `QB Invoice #${inf.qbDocNumber} · Matched, awaiting payment` : "Matched, awaiting payment"}
                                    data-testid={`qb-status-matched-inflow-${weekStart}-${i}`}
                                  >
                                    Matched{inf.qbDocNumber ? ` · ${inf.qbDocNumber}` : ""}
                                  </span>
                                  {inf.qbPaymentStatus === "partial" && (
                                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">Partial</span>
                                  )}
                                  {inf.qbPaymentStatus === "unpaid" && (
                                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200">Unpaid</span>
                                  )}
                                </span>
                              )
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-300"
                                title="No QuickBooks invoice linked to this milestone — open the QuickBooks reconciliation tab to link it."
                                data-testid={`qb-status-unmatched-inflow-${weekStart}-${i}`}
                              >
                                Unmatched
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2" data-testid={`signals-cell-inflow-${weekStart}-${i}`}>
                            <span className="inline-flex flex-wrap gap-1">
                              {inf.lastImportedAt && isStaleImport(inf.lastImportedAt) && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-300" title={`Last imported: ${inf.lastImportedAt}`} data-testid={`signal-stale-inflow-${weekStart}-${i}`}>Stale</span>
                              )}
                              {inf.hasAdminOverride && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-violet-50 text-violet-800 border-violet-300" title={inf.adminDateOverrideReason ? `Override: ${inf.adminDateOverrideReason}` : "Date override applied"} data-testid={`signal-override-inflow-${weekStart}-${i}`}>Override</span>
                              )}
                              {inf.qbDivergence && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-rose-50 text-rose-800 border-rose-300" title="App amount differs from QuickBooks by more than R100" data-testid={`signal-qb-divergence-inflow-${weekStart}-${i}`}>≠ QB</span>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-red-200/60 bg-card overflow-hidden">
              <div className="px-4 py-2.5 bg-red-50 border-b border-red-200/60">
                <h4 className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  Outflows
                </h4>
              </div>
              {filteredOutflows.length === 0 ? (
                <EmptyState
                  icon={TrendingDown}
                  title="No outflows this week"
                  description="No expenses are forecast or paid in this window. Use the project planner to add an expense line, or wait for the next sync from QuickBooks."
                  className="m-3"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse" data-testid={`table-outflows-${weekStart}`}>
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Project</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Category</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Line Item</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground" title="Supplier-issued document number — becomes a QuickBooks Bill in our books.">Supplier invoice #</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">QB</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Signals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOutflows.map((out, i) => {
                        const statusColors: Record<string, string> = {
                          "Out of Bank": "bg-emerald-50 text-emerald-700 border-emerald-300",
                          "Outstanding": "bg-amber-50 text-amber-700 border-amber-300",
                          "Risk": "bg-red-50 text-red-700 border-red-300",
                          "Planned": "bg-muted text-muted-foreground border-border",
                        };
                        return (
                        <tr key={i} className="border-b border-border hover:bg-muted/50 transition-colors" data-testid={`row-outflow-${weekStart}-${i}`}>
                          <td className="px-3 py-2 font-medium text-foreground">{out.projectName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{out.expenseCategory}</td>
                          <td className="px-3 py-2 text-muted-foreground">{out.expenseLineItem}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground text-[11px]">{out.expenseInvoiceNumber || "—"}</td>
                          <td className="px-3 py-2">
                            <DateOverridePopover
                              currentDate={out.expensePaymentDate}
                              originalDate={out.originalDate}
                              hasOverride={out.hasAdminOverride}
                              overrideReason={out.adminDateOverrideReason}
                              overrideAt={out.adminDateOverrideAt}
                              onSave={(dateOverride, reason) =>
                                overrideExpenseDate.mutate({ expenseId: out.expenseId, dateOverride, reason })
                              }
                              testId={`date-override-outflow-${weekStart}-${i}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${statusColors[out.paymentStatus] || "bg-muted"}`}>
                              {out.paymentStatus}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-red-700">{formatRand(out.expenseActualTotal)}</td>
                          <td className="px-3 py-2" data-testid={`qb-cell-outflow-${weekStart}-${i}`}>
                            {out.qbStatus === "confirmed" ? (
                              out.qbPaymentStatus === "paid" ? (
                                <span
                                  className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200"
                                  title={out.qbDocNumber ? `QB Bill #${out.qbDocNumber} · Settled on QuickBooks` : "Settled on QuickBooks"}
                                  data-testid={`qb-status-settled-outflow-${weekStart}-${i}`}
                                >
                                  Settled{out.qbDocNumber ? ` · ${out.qbDocNumber}` : ""}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200"
                                    title={out.qbDocNumber ? `QB Bill #${out.qbDocNumber} · Matched, awaiting payment` : "Matched, awaiting payment"}
                                    data-testid={`qb-status-matched-outflow-${weekStart}-${i}`}
                                  >
                                    Matched{out.qbDocNumber ? ` · ${out.qbDocNumber}` : ""}
                                  </span>
                                  {out.qbPaymentStatus === "partial" && (
                                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">Partial</span>
                                  )}
                                  {out.qbPaymentStatus === "unpaid" && (
                                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200">Unpaid</span>
                                  )}
                                </span>
                              )
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-300"
                                title="No QuickBooks bill linked to this expense — open the QuickBooks reconciliation tab to link it."
                                data-testid={`qb-status-unmatched-outflow-${weekStart}-${i}`}
                              >
                                Unmatched
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2" data-testid={`signals-cell-outflow-${weekStart}-${i}`}>
                            <span className="inline-flex flex-wrap gap-1">
                              {out.lastImportedAt && isStaleImport(out.lastImportedAt) && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-300" title={`Last imported: ${out.lastImportedAt}`} data-testid={`signal-stale-outflow-${weekStart}-${i}`}>Stale</span>
                              )}
                              {out.paymentTermsMissing && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-orange-50 text-orange-800 border-orange-300" title="Forecast date set but no payment terms (counterparty) linked" data-testid={`signal-terms-missing-outflow-${weekStart}-${i}`}>No terms</span>
                              )}
                              {out.forecastDateShiftDays != null && Math.abs(out.forecastDateShiftDays) > 14 && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-300" title={`Forecast date shifted ${out.forecastDateShiftDays > 0 ? "+" : ""}${out.forecastDateShiftDays} days since last import`} data-testid={`signal-date-shift-outflow-${weekStart}-${i}`}>Shifted {out.forecastDateShiftDays > 0 ? "+" : ""}{Math.round(out.forecastDateShiftDays / 7)}w</span>
                              )}
                              {out.hasAdminOverride && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-violet-50 text-violet-800 border-violet-300" title={out.adminDateOverrideReason ? `Override: ${out.adminDateOverrideReason}` : "Date override applied"} data-testid={`signal-override-outflow-${weekStart}-${i}`}>Override</span>
                              )}
                              {out.qbDivergence && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-rose-50 text-rose-800 border-rose-300" title="App amount differs from QuickBooks by more than R100" data-testid={`signal-qb-divergence-outflow-${weekStart}-${i}`}>≠ QB</span>
                              )}
                            </span>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function OpexBudgetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  const { data: opexData = [], isLoading } = useQuery<OpexEntry[]>({
    queryKey: [`${CASHFLOW_API_BASE}/opex-budget`],
    queryFn: async () => {
      const res = await fetch(`${CASHFLOW_API_BASE}/opex-budget`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch OPEX budget");
      return res.json();
    },
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async (entries: { monthKey: string; amount: number }[]) => {
      for (const entry of entries) {
        await apiRequest("POST", `${CASHFLOW_API_BASE}/opex-budget`, entry);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`${CASHFLOW_API_BASE}/opex-budget`] });
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      invalidateDashboardQueries(queryClient);
      setEditedValues({});
      toast({ title: "OPEX Costed Saved", description: "Costed values updated successfully." });
    },
    onError: () => {
      toast({ title: "Save Failed", description: "Failed to save OPEX costed amounts.", variant: "destructive" });
    },
  });

  const opexMap = useMemo(() => {
    const m: Record<string, number> = {};
    opexData.forEach((e) => (m[e.monthKey] = e.amount));
    return m;
  }, [opexData]);

  const handleSave = () => {
    const entries = Object.entries(editedValues)
      .filter(([key]) => {
        const original = opexMap[key] ?? 0;
        const newVal = parseFloat(editedValues[key]) || 0;
        return newVal !== original;
      })
      .map(([monthKey, val]) => ({ monthKey, amount: parseFloat(val) || 0 }));

    if (entries.length === 0) {
      toast({ title: "No Changes", description: "No OPEX costed values changed." });
      return;
    }
    saveMutation.mutate(entries);
  };

  const totalBudget = FY_MONTHS.reduce((sum, m) => {
    const val = editedValues[m.key] !== undefined
      ? parseFloat(editedValues[m.key]) || 0
      : opexMap[m.key] ?? 0;
    return sum + val;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-opex-budget">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">OPEX Monthly Costed — FY{CURRENT_FY}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Set monthly operating expense costed amounts for Sep {CURRENT_FY - 1} – Aug {CURRENT_FY}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" data-testid="spinner-opex" />
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {FY_MONTHS.map((m) => {
              const currentVal = editedValues[m.key] ?? (opexMap[m.key]?.toString() || "0");
              return (
                <div key={m.key} className="flex items-center gap-3 group hover:bg-muted rounded-lg px-2 py-1.5 transition-colors">
                  <span className="text-sm font-medium text-muted-foreground w-24 flex-shrink-0">{m.label}</span>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">R</span>
                    <Input
                      type="number"
                      value={currentVal}
                      onChange={(e) =>
                        setEditedValues((prev) => ({ ...prev, [m.key]: e.target.value }))
                      }
                      className="text-right font-mono pl-7 h-9 border-border focus:border-blue-400 focus:ring-blue-400"
                      data-testid={`input-opex-${m.key}`}
                    />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-3 border-t border-border pt-3 mt-2 px-2">
              <span className="text-sm font-bold text-foreground w-24 flex-shrink-0">Total</span>
              <span className="flex-1 text-right font-mono font-bold text-foreground pr-3" data-testid="text-opex-total">
                {formatRand(totalBudget)}
              </span>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} data-testid="button-opex-cancel" className="border-border">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-opex-save"
            className="bg-blue-600 hover:bg-blue-700"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                Saving...
              </>
            ) : (
              "Save Costed"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeyboardShortcuts({
  railSearchRef,
  setProjectPickerOpen,
  cashflowData,
  toast,
}: {
  railSearchRef: React.RefObject<HTMLInputElement | null>;
  setProjectPickerOpen: (open: boolean) => void;
  cashflowData: CashflowWeek[];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tgt?.isContentEditable;

      if (e.key === "/" && !isTyping && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const railEl = railSearchRef.current;
        if (railEl && railEl.offsetParent !== null) {
          railEl.focus();
          railEl.select();
        } else {
          setProjectPickerOpen(true);
        }
        return;
      }

      if ((e.key === "?" || (e.shiftKey && e.key === "/")) && !isTyping) {
        e.preventDefault();
        toast({
          title: "Keyboard shortcuts",
          description: "/ focus filter · E edit current-week available payment · Esc close",
        });
        return;
      }

      if ((e.key === "e" || e.key === "E") && !isTyping && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const current = cashflowData.find((w) => isCurrentWeek(w.weekStart, w.weekEnd));
        if (!current) return;
        const btn = document.getElementById("kb-edit-current-availpay") as HTMLButtonElement | null;
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railSearchRef, setProjectPickerOpen, cashflowData, toast]);
  return null;
}

export default function CashflowPage() {
  const { allowed: canEditCashflow } = usePermission("cashflow", "edit");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [opexOpen, setOpexOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(true);
  const [historyWeek, setHistoryWeek] = useState<string | null>(null);
  const [availPayHistoryWeek, setAvailPayHistoryWeek] = useState<string | null>(null);
  const [railSearch, setRailSearch] = useState("");
  const railSearchRef = useRef<HTMLInputElement>(null);

  const projectParam = selectedProjects.length > 0 ? selectedProjects.join(",") : undefined;

  const {
    data: cashflowEnvelope,
    isLoading,
    isError,
    error,
    refetch,
    isFetching: isCashflowFetching,
    dataUpdatedAt: cashflowUpdatedAt,
  } = useQuery<{ rows: CashflowWeek[]; trust: FinanceTrustMeta | null; summary: CashflowTrustSummary | null }>({
    queryKey: [CASHFLOW_API_BASE, projectParam],
    queryFn: async () => {
      const url = projectParam
        ? `${CASHFLOW_API_BASE}?project=${encodeURIComponent(projectParam)}`
        : CASHFLOW_API_BASE;
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to fetch cashflow data");
      const trust = extractTrustHeaders(res);
      const body = (await res.json()) as { weeks: CashflowWeek[]; summary: CashflowTrustSummary | null };
      return { rows: body.weeks ?? [], trust, summary: body.summary ?? null };
    },
  });
  const cashflowData: CashflowWeek[] = cashflowEnvelope?.rows ?? [];
  const cashflowTrust: FinanceTrustMeta | null = cashflowEnvelope?.trust ?? null;
  const cashflowSummary: CashflowTrustSummary | null = cashflowEnvelope?.summary ?? null;

  const { data: balanceHistory = [] } = useQuery<BalanceHistoryEntry[]>({
    queryKey: [`${CASHFLOW_API_BASE}/balance-history`, historyWeek],
    queryFn: async () => {
      const url = historyWeek
        ? `${CASHFLOW_API_BASE}/balance-history?week=${historyWeek}`
        : `${CASHFLOW_API_BASE}/balance-history`;
      const bToken = localStorage.getItem("auth_token");
      const bHeaders: Record<string, string> = {};
      if (bToken) bHeaders["Authorization"] = `Bearer ${bToken}`;
      const res = await fetch(url, { credentials: "include", headers: bHeaders });
      if (!res.ok) throw new Error("Failed to fetch balance history");
      return res.json();
    },
    enabled: !!historyWeek,
  });

  const { data: projectsSummary = [] } = useQuery<Array<{
    project_name: string;
    has_tracker_import?: boolean;
  }>>({
    queryKey: ["/api/projects-summary"],
    queryFn: async () => {
      const pToken = localStorage.getItem("auth_token");
      const pHeaders: Record<string, string> = {};
      if (pToken) pHeaders["Authorization"] = `Bearer ${pToken}`;
      const res = await fetch("/api/projects-summary", { credentials: "include", headers: pHeaders });
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  const projectNames = useMemo(() => {
    const names = new Set<string>();
    projectsSummary.forEach((p) => {
      if (!p.project_name) return;
      // Only include projects that have a tracker workbook imported. The backend
      // computes has_tracker_import from upload_metadata + committed
      // smart_import_runs, which is the authoritative signal.
      if (p.has_tracker_import) names.add(p.project_name);
    });
    return Array.from(names).sort();
  }, [projectsSummary]);

  const balanceMutation = useMutation({
    mutationFn: async (body: { weekStartDate: string; openingBalance: number; computedValue: number; clearForward: boolean }) => {
      await apiRequest("POST", `${CASHFLOW_API_BASE}/opening-balance`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      queryClient.invalidateQueries({ queryKey: [`${CASHFLOW_API_BASE}/balance-history`] });
      invalidateDashboardQueries(queryClient);
      toast({ title: "Opening Balance Saved", description: "All forward weeks recalculated" });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message || "Failed to save opening balance", variant: "destructive" });
    },
  });

  const clearOverrideMutation = useMutation({
    mutationFn: async (weekStartDate: string) => {
      await apiRequest("DELETE", `${CASHFLOW_API_BASE}/opening-balance`, { weekStartDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      queryClient.invalidateQueries({ queryKey: [`${CASHFLOW_API_BASE}/balance-history`] });
      invalidateDashboardQueries(queryClient);
      toast({ title: "Override Cleared", description: "Balance now uses cascaded value" });
    },
    onError: (err: Error) => {
      toast({ title: "Clear Failed", description: err.message || "Failed to clear override", variant: "destructive" });
    },
  });

  const opexMutation = useMutation({
    mutationFn: async (body: { weekStartDate: string; opexAmount: number }) => {
      await apiRequest("POST", `${CASHFLOW_API_BASE}/opex-weekly`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      invalidateDashboardQueries(queryClient);
      toast({ title: "OPEX Saved", description: "Weekly OPEX updated and values recalculated" });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message || "Failed to save OPEX", variant: "destructive" });
    },
  });

  const clearOpexMutation = useMutation({
    mutationFn: async (weekStartDate: string) => {
      await apiRequest("DELETE", `${CASHFLOW_API_BASE}/opex-weekly`, { weekStartDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      invalidateDashboardQueries(queryClient);
      toast({ title: "OPEX Override Cleared", description: "Using monthly costed split value" });
    },
    onError: (err: Error) => {
      toast({ title: "Clear Failed", description: err.message || "Failed to clear OPEX override", variant: "destructive" });
    },
  });

  const { data: availPayHistory = [] } = useQuery<{ id: number; weekStartDate: string; previousValue: string | null; newValue: string; computedValue: string | null; reason: string | null; changedAt: string; changedBy: string | null }[]>({
    queryKey: [`${CASHFLOW_API_BASE}/available-payment-history`, availPayHistoryWeek],
    queryFn: async () => {
      const hToken = localStorage.getItem("auth_token");
      const hHeaders: Record<string, string> = {};
      if (hToken) hHeaders["Authorization"] = `Bearer ${hToken}`;
      const res = await fetch(`${CASHFLOW_API_BASE}/available-payment-history?week=${availPayHistoryWeek}`, { credentials: "include", headers: hHeaders });
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    enabled: !!availPayHistoryWeek,
  });

  const availPayMutation = useMutation({
    mutationFn: async (body: { weekStartDate: string; overrideValue: number; reason: string; computedValue: number }) => {
      await apiRequest("POST", `${CASHFLOW_API_BASE}/available-payment`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      queryClient.invalidateQueries({ queryKey: [`${CASHFLOW_API_BASE}/available-payment-history`] });
      invalidateDashboardQueries(queryClient);
      toast({ title: "Available Payment Updated", description: "Override saved with reason" });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message || "Failed to save available payment", variant: "destructive" });
    },
  });

  const clearAvailPayMutation = useMutation({
    mutationFn: async (weekStartDate: string) => {
      await apiRequest("DELETE", `${CASHFLOW_API_BASE}/available-payment`, { weekStartDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      queryClient.invalidateQueries({ queryKey: [`${CASHFLOW_API_BASE}/available-payment-history`] });
      invalidateDashboardQueries(queryClient);
      toast({ title: "Override Cleared", description: "Using computed available payment" });
    },
    onError: (err: Error) => {
      toast({ title: "Clear Failed", description: err.message || "Failed to clear payment override", variant: "destructive" });
    },
  });

  const handleRowClick = useCallback(
    (weekStart: string) => {
      if (!showDetail) return;
      setExpandedWeek((prev) => (prev === weekStart ? null : weekStart));
    },
    [showDetail]
  );

  const isProjectFiltered = selectedProjects.length > 0;
  const overrideWeeks = cashflowData.filter((week) => week.hasManualOverride || week.hasOpexOverride || week.hasAvailPayOverride).length;
  const varianceWeeks = cashflowData.filter((week) => Math.abs(week.balanceDelta || 0) > 0).length;
  const scopeLabel = isProjectFiltered
    ? selectedProjects.length === 1
      ? selectedProjects[0]
      : `${selectedProjects.length} projects`
    : "Portfolio scope";

  const chartData = useMemo(() => {
    return cashflowData.map((w) => ({
      week: formatWeek(w.weekStart),
      "Opening Balance": w.openingBalance,
      "Project Inflows": w.projectInflows,
      "Total Outflows": isProjectFiltered ? (w.projectOutflows || 0) : (w.opexOutflows || 0) + (w.projectOutflows || 0),
      "Closing Balance": w.closingBalance,
    }));
  }, [cashflowData, isProjectFiltered]);

  const kpis = useMemo(() => {
    const totalInflows = cashflowData.reduce((s, w) => s + (w.projectInflows || 0), 0);
    const totalOutflows = cashflowData.reduce(
      (s, w) => s + (isProjectFiltered ? 0 : (w.opexOutflows || 0)) + (w.projectOutflows || 0),
      0
    );
    const now = new Date();
    const currentWeek = cashflowData.find(w => {
      const start = parseISO(w.weekStart);
      const end = parseISO(w.weekEnd);
      return now >= start && now < end;
    });
    const currentWeekOpeningBalance = currentWeek?.openingBalance ?? (cashflowData.length > 0 ? cashflowData[0].openingBalance : 0);
    const lastWeek = cashflowData.length > 0 ? cashflowData[cashflowData.length - 1] : null;
    const forecastedEndOfFYPosition = lastWeek?.closingBalance ?? 0;
    return { totalInflows, totalOutflows, currentWeekOpeningBalance, forecastedEndOfFYPosition };
  }, [cashflowData]);

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <FinanceShell><div className="p-4 md:p-6"><PageError title="Unable to load cashflow" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></div></FinanceShell>;

  return (
    <FinanceShell><div className="p-4 md:p-6" data-testid="page-cashflow">
      <KeyboardShortcuts
        railSearchRef={railSearchRef}
        setProjectPickerOpen={setProjectPickerOpen}
        cashflowData={cashflowData}
        toast={toast}
      />
      <SectionHeader
        icon={<Wallet className="h-5 w-5" />}
        title={`Cashflow FY${CURRENT_FY}`}
        eyebrow={`Sep ${CURRENT_FY - 1} – Aug ${CURRENT_FY}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={showDetail ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setShowDetail((v) => !v);
                if (showDetail) setExpandedWeek(null);
              }}
              className={`gap-1.5 rounded-lg transition-all ${
                showDetail
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
              data-testid="button-toggle-detail"
            >
              {showDetail ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showDetail ? "Hide Detail" : "Show Detail"}
            </Button>
            {canEditCashflow && !isProjectFiltered && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpexOpen(true)}
                className="gap-1.5 rounded-lg border-border text-muted-foreground hover:bg-muted"
                data-testid="button-opex-budget"
              >
                <DollarSign className="h-3.5 w-3.5" />
                OPEX Costed
              </Button>
            )}
          </div>
        }

      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground -mt-1">
        <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card">
          <Wallet className="h-3 w-3" />
          {scopeLabel}
        </Badge>
        <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card">
          <Eye className="h-3 w-3" />
          {overrideWeeks} override {overrideWeeks === 1 ? "week" : "weeks"}
        </Badge>
        <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card">
          <ArrowDownRight className="h-3 w-3" />
          {varianceWeeks} variance {varianceWeeks === 1 ? "week" : "weeks"}
        </Badge>
        <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card">
          <Loader2 className={`h-3 w-3 ${isCashflowFetching ? "animate-spin text-emerald-600" : ""}`} />
          {cashflowUpdatedAt
            ? `Refreshed ${new Date(cashflowUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Live"}
        </Badge>
        {!canEditCashflow && (
          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[11px] font-medium border-amber-200 bg-amber-50 text-amber-800">
            Read-only
          </Badge>
        )}
      </div>
      <FinanceTrustStrip
        source={cashflowTrust?.canonicalTable ?? "canonical"}
        lastImportDate={cashflowSummary?.lastImportDate ?? "Unknown"}
        quickBooksLinkStatus="unknown"
        metrics={[
          {
            label: "Unresolved drift",
            value: cashflowSummary != null ? cashflowSummary.shiftedLineCount : "Unknown / not yet measured",
            tone: (cashflowSummary?.shiftedLineCount ?? 0) > 0 ? "warning" : "default",
          },
          {
            label: "Missing PO",
            value: cashflowSummary != null ? cashflowSummary.missingTermsCount : "Unknown / not yet measured",
            tone: (cashflowSummary?.missingTermsCount ?? 0) > 0 ? "warning" : "default",
          },
        ]}
      />
      <div className="lg:flex lg:gap-5 lg:items-start -mt-1">
        <aside
          className="hidden lg:flex lg:flex-col lg:w-56 lg:shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] rounded-xl border border-border bg-card shadow-sm p-3"
          data-testid="rail-filter"
          aria-label="Filter projects"
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Projects</h3>
            {selectedProjects.length > 0 && (
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedProjects([])}
                data-testid="rail-clear-all"
              >
                Clear ({selectedProjects.length})
              </button>
            )}
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              ref={railSearchRef}
              value={railSearch}
              onChange={(e) => setRailSearch(e.target.value)}
              placeholder="Search projects…"
              className="h-8 text-xs pl-7"
              data-testid="rail-search"
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-0.5 -mr-1 pr-1 min-h-0">
            <label className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={selectedProjects.length === 0}
                onChange={() => setSelectedProjects([])}
                className="h-3.5 w-3.5 accent-emerald-600"
                data-testid="rail-option-all"
              />
              <span className="font-medium">All projects</span>
            </label>
            {projectNames
              .filter((n) => n.toLowerCase().includes(railSearch.toLowerCase()))
              .map((name) => (
                <label
                  key={name}
                  className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedProjects.includes(name)}
                    onChange={() =>
                      setSelectedProjects((prev) =>
                        prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
                      )
                    }
                    className="h-3.5 w-3.5 accent-emerald-600"
                    data-testid={`rail-option-${name}`}
                  />
                  <span className="truncate">{name}</span>
                </label>
              ))}
          </div>
          <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground leading-relaxed">
            <kbd className="px-1 py-0.5 rounded bg-muted font-mono">/</kbd> focus filter ·{" "}
            <kbd className="px-1 py-0.5 rounded bg-muted font-mono">E</kbd> edit current week ·{" "}
            <kbd className="px-1 py-0.5 rounded bg-muted font-mono">?</kbd> help
          </div>
        </aside>
        <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
              <div className="lg:hidden">
              <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={projectPickerOpen}
                    className="min-w-[200px] max-w-[400px] justify-between text-sm font-normal rounded-lg border-border hover:border-slate-400"
                    data-testid="select-project-filter"
                  >
                    <span className="truncate">
                      {selectedProjects.length === 0
                        ? "All Projects"
                        : selectedProjects.length === 1
                        ? selectedProjects[0]
                        : `${selectedProjects.length} projects selected`}
                    </span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(320px,90vw)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search projects..." />
                    <CommandList>
                      <CommandEmpty>No projects found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__all__"
                          onSelect={() => {
                            setSelectedProjects([]);
                            setProjectPickerOpen(false);
                          }}
                          data-testid="option-all-projects"
                        >
                          <Check className={`mr-2 h-4 w-4 ${selectedProjects.length === 0 ? "opacity-100" : "opacity-0"}`} />
                          All Projects
                        </CommandItem>
                        {projectNames.map((name) => (
                          <CommandItem
                            key={name}
                            value={name}
                            onSelect={() => {
                              setSelectedProjects((prev) =>
                                prev.includes(name)
                                  ? prev.filter((p) => p !== name)
                                  : [...prev, name]
                              );
                            }}
                            data-testid={`option-project-${name}`}
                          >
                            <Check className={`mr-2 h-4 w-4 ${selectedProjects.includes(name) ? "opacity-100" : "opacity-0"}`} />
                            {name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              </div>
              {selectedProjects.length > 0 && (
                <div className="lg:hidden flex flex-wrap items-center gap-1">
                  {selectedProjects.map((p) => (
                    <Badge
                      key={p}
                      variant="secondary"
                      className="text-xs gap-1 cursor-pointer hover:bg-destructive/10"
                      onClick={() => setSelectedProjects((prev) => prev.filter((x) => x !== p))}
                      data-testid={`badge-selected-${p}`}
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
                    data-testid="button-clear-all-projects"
                  >
                    Clear all
                  </Button>
                </div>
              )}
            </div>

      <div className="space-y-4 sm:space-y-5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" data-testid="spinner-main" />
            <span className="text-sm font-medium">Loading cashflow data...</span>
          </div>
        ) : cashflowData.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title="No cashflow data available"
            description="Upload tracker files to populate the cashflow timeline"
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="kpi-summary-row">
              <KpiCard
                title="Total Inflows YTD"
                value={formatRand(kpis.totalInflows)}
                icon={<TrendingUp className="h-5 w-5" />}
                color="green"
                testId="kpi-total-inflows"
                nullCount={cashflowTrust?.nullCount ?? null}
              />
              <KpiCard
                title="Total Outflows YTD"
                value={formatRand(kpis.totalOutflows)}
                icon={<TrendingDown className="h-5 w-5" />}
                color="red"
                testId="kpi-total-outflows"
                nullCount={cashflowTrust?.nullCount ?? null}
              />
              <KpiCard
                title="Current Week Opening Balance"
                value={formatRand(kpis.currentWeekOpeningBalance)}
                icon={<DollarSign className="h-5 w-5" />}
                color={kpis.currentWeekOpeningBalance >= 0 ? "slate" : "red"}
                testId="kpi-current-balance"
              />
              <KpiCard
                title="Forecasted End of Financial Year Position"
                value={formatRand(kpis.forecastedEndOfFYPosition)}
                icon={
                  kpis.forecastedEndOfFYPosition >= 0 ? (
                    <ArrowUpRight className="h-5 w-5" />
                  ) : (
                    <ArrowDownRight className="h-5 w-5" />
                  )
                }
                color={kpis.forecastedEndOfFYPosition >= 0 ? "green" : "red"}
                testId="kpi-net-position"
              />
            </div>

            <Card className="border border-border shadow-sm rounded-xl overflow-hidden" data-testid="card-trend-chart">
              <button
                type="button"
                onClick={() => setChartOpen((v) => !v)}
                className="w-full flex items-center justify-between pb-2 pt-4 px-5 hover:bg-muted/40 transition-colors"
                aria-expanded={chartOpen}
                aria-controls="cashflow-trend-chart-body"
                data-testid="button-toggle-chart"
              >
                <span className="text-sm font-semibold text-foreground">Cashflow Trend</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${chartOpen ? "" : "-rotate-90"}`} />
              </button>
              {chartOpen && (
              <CardContent id="cashflow-trend-chart-body" className="px-2 pb-3">
                <div className="h-[220px] sm:h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis
                        dataKey="week"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        height={28}
                        interval="preserveStartEnd"
                        minTickGap={24}
                        tick={{ fill: "#64748b" }}
                      />
                      <YAxis
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "#64748b" }}
                        tickFormatter={(val) => {
                          const abs = Math.abs(val);
                          if (abs >= 1_000_000) return `R${(val / 1_000_000).toFixed(1)}M`;
                          if (abs >= 1_000) return `R${(val / 1_000).toFixed(0)}K`;
                          return `R${val}`;
                        }}
                        width={65}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [formatRand(value), name]}
                        contentStyle={{
                          borderRadius: "10px",
                          border: "1px solid #e2e8f0",
                          boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                          fontSize: "12px",
                          padding: "8px 12px",
                        }}
                        labelStyle={{ fontWeight: 600, marginBottom: 4, color: "#334155" }}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: "8px", fontSize: "11px" }}
                        iconType="circle"
                        iconSize={8}
                      />
                      <Line
                        type="monotone"
                        dataKey="Opening Balance"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Project Inflows"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Total Outflows"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Closing Balance"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
              )}
            </Card>

            <Card className="border border-border shadow-sm rounded-xl overflow-hidden" data-testid="card-weekly-grid">
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[70vh]">
                  <table className="w-full border-collapse text-xs sm:text-sm" data-testid="table-cashflow">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-muted/80 border-b-2 border-border">
                        <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-semibold text-muted-foreground text-[10px] sm:text-xs uppercase tracking-wider sticky left-0 bg-muted/80 z-30 min-w-[80px] sm:min-w-[100px] border-r border-border">
                          Week
                        </th>
                        <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-semibold text-muted-foreground text-[10px] sm:text-xs uppercase tracking-wider min-w-[100px] sm:min-w-[130px] bg-muted/80">
                          Opening Bal
                        </th>
                        <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-semibold text-muted-foreground text-[10px] sm:text-xs uppercase tracking-wider min-w-[100px] sm:min-w-[130px] bg-muted/80">
                          Proj Inflows
                        </th>
                        <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-semibold text-muted-foreground text-[10px] sm:text-xs uppercase tracking-wider min-w-[140px] sm:min-w-[180px] bg-muted/80">
                          Outflows
                        </th>
                        <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-semibold text-muted-foreground text-[10px] sm:text-xs uppercase tracking-wider min-w-[100px] sm:min-w-[130px] bg-muted/80">
                          Closing Bal
                        </th>
                        <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-semibold text-muted-foreground text-[10px] sm:text-xs uppercase tracking-wider min-w-[110px] sm:min-w-[150px] bg-muted/80">
                          Avail Payment
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashflowData.map((week, idx) => {
                        const totalOutflows = (isProjectFiltered ? 0 : (week.opexOutflows || 0)) + (week.projectOutflows || 0);
                        const current = isCurrentWeek(week.weekStart, week.weekEnd);
                        const isExpanded = expandedWeek === week.weekStart;
                        const isEven = idx % 2 === 0;

                        return (
                          <Fragment key={week.weekStart}>
                            <tr
                              className={`border-b border-border transition-colors ${
                                current
                                  ? "border-l-[3px] border-l-emerald-500"
                                  : isEven
                                  ? "bg-card"
                                  : "bg-muted/30"
                              } ${showDetail ? "cursor-pointer hover:bg-emerald-50/40" : "hover:bg-muted/60"}`}
                              onClick={() => handleRowClick(week.weekStart)}
                              data-testid={`row-week-${week.weekStart}`}
                            >
                              <td
                                className={`px-2 sm:px-4 py-2 sm:py-3 font-medium text-foreground sticky left-0 z-10 border-r border-border ${
                                  current ? "bg-card" : isEven ? "bg-card" : "bg-muted/30"
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  {showDetail && (
                                    isExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                                    )
                                  )}
                                  <span className="text-[13px]">{formatWeek(week.weekStart)}</span>
                                  {current && (
                                    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                                      NOW
                                    </span>
                                  )}
                                  {(week.hasManualOverride || week.hasOpexOverride || week.hasAvailPayOverride) && (
                                    <TooltipProvider>
                                      <UiTooltip>
                                        <TooltipTrigger asChild>
                                          <span
                                            className="inline-flex items-center"
                                            onClick={(e) => e.stopPropagation()}
                                            data-testid={`week-override-icon-${week.weekStart}`}
                                          >
                                            <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                                          <div className="space-y-2">
                                            <div className="font-semibold">Week overrides in effect</div>
                                            {week.hasManualOverride && (
                                              <div className="space-y-0.5">
                                                <div className="font-medium">Opening balance</div>
                                                <div>
                                                  Computed {formatRand(week.computedOpening)} → Override {formatRand(week.openingBalance)}
                                                </div>
                                                {week.manualOverrideAt && (
                                                  <div className="text-muted-foreground">
                                                    Updated {safeFormatIso(week.manualOverrideAt)}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                            {week.hasOpexOverride && (
                                              <div className="space-y-0.5">
                                                <div className="font-medium">OPEX</div>
                                                <div>
                                                  Computed {formatRand(week.computedOpex)} → Override {formatRand(week.opexOutflows)}
                                                </div>
                                                {week.opexOverrideAt && (
                                                  <div className="text-muted-foreground">
                                                    Updated {safeFormatIso(week.opexOverrideAt)}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                            {week.hasAvailPayOverride && (
                                              <div className="space-y-0.5">
                                                <div className="font-medium">Available payment</div>
                                                <div>
                                                  Computed {formatRand(week.computedAvailablePayment)} → Override {formatRand(week.availablePayment)}
                                                </div>
                                                {week.availPayReason && (
                                                  <div>Reason: {week.availPayReason}</div>
                                                )}
                                                {week.availPayOverrideBy && (
                                                  <div className="text-muted-foreground">By {week.availPayOverrideBy}</div>
                                                )}
                                                {week.availPayOverrideAt && (
                                                  <div className="text-muted-foreground">
                                                    Updated {safeFormatIso(week.availPayOverrideAt)}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </TooltipContent>
                                      </UiTooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono text-[11px] sm:text-[13px] text-foreground">
                                <div className="flex items-center justify-end gap-1.5">
                                  <EditCellPopover
                                    trigger={
                                      <button
                                        type="button"
                                        className={`inline-flex items-center gap-1 ${canEditCashflow ? "cursor-pointer hover:underline decoration-dashed underline-offset-2 hover:text-emerald-700 transition-colors" : "cursor-default"}`}
                                        disabled={!canEditCashflow}
                                        onClick={(e) => e.stopPropagation()}
                                        data-testid={`text-opening-balance-${week.weekStart}`}
                                      >
                                        <span>{formatRand(week.openingBalance)}</span>
                                        {canEditCashflow && (
                                          <Pencil className="h-2.5 w-2.5 text-muted-foreground/60" />
                                        )}
                                      </button>
                                    }
                                    weekLabel={formatWeek(week.weekStart)}
                                    fieldLabel="Opening Balance"
                                    currentValue={week.openingBalance || 0}
                                    computedValue={week.computedOpening || 0}
                                    hasOverride={week.hasManualOverride}
                                    requireReason={false}
                                    onSave={({ value }) =>
                                      balanceMutation.mutate({
                                        weekStartDate: week.weekStart,
                                        openingBalance: value,
                                        computedValue: week.computedOpening,
                                        clearForward: true,
                                      })
                                    }
                                    onResetToComputed={() => clearOverrideMutation.mutate(week.weekStart)}
                                    isSaving={balanceMutation.isPending}
                                    isResetting={clearOverrideMutation.isPending}
                                    testIdPrefix={`edit-opening-${week.weekStart}`}
                                    helperText="Saving cascades forward and recalculates closing balances."
                                  />
                                  {week.hasManualOverride && (
                                    <OverrideChipMenu
                                      canEdit={!!canEditCashflow}
                                      onViewHistory={() => setHistoryWeek(week.weekStart)}
                                      onClear={() => clearOverrideMutation.mutate(week.weekStart)}
                                      testId={`override-opening-${week.weekStart}`}
                                      chip={
                                        <span
                                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                            week.balanceDelta >= 0
                                              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                              : "bg-red-50 text-red-700 hover:bg-red-100"
                                          }`}
                                          title={`Manual override: ${week.balanceDelta >= 0 ? "+" : ""}${formatRand(week.balanceDelta)} vs computed (${formatRand(week.computedOpening)})`}
                                          data-testid={`badge-delta-${week.weekStart}`}
                                        >
                                          {week.balanceDelta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                          {formatRand(Math.abs(week.balanceDelta))}
                                        </span>
                                      }
                                    />
                                  )}
                                </div>
                              </td>
                              <td
                                className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono text-[11px] sm:text-[13px] text-emerald-600"
                                data-testid={`text-inflows-${week.weekStart}`}
                              >
                                {formatRand(week.projectInflows)}
                              </td>
                              <td
                                className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono text-[11px] sm:text-[13px]"
                                data-testid={`text-outflows-${week.weekStart}`}
                              >
                                <div className="flex flex-col items-end gap-0.5">
                                  <div
                                    className="font-semibold text-red-700 text-[12px] sm:text-[14px]"
                                    data-testid={`text-total-outflows-${week.weekStart}`}
                                  >
                                    {formatRand(totalOutflows)}
                                  </div>
                                  {!isProjectFiltered && (
                                    <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                                      <span className="text-muted-foreground">OPEX</span>
                                      <EditCellPopover
                                        trigger={
                                          <button
                                            type="button"
                                            className={`inline-flex items-center gap-0.5 ${canEditCashflow ? "cursor-pointer hover:underline decoration-dashed underline-offset-2 hover:text-red-700 transition-colors" : "cursor-default"} text-red-500`}
                                            disabled={!canEditCashflow}
                                            onClick={(e) => e.stopPropagation()}
                                            data-testid={`text-opex-value-${week.weekStart}`}
                                          >
                                            <span>{formatRand(week.opexOutflows)}</span>
                                            {canEditCashflow && (
                                              <Pencil className="h-2.5 w-2.5 text-muted-foreground/60" />
                                            )}
                                          </button>
                                        }
                                        weekLabel={formatWeek(week.weekStart)}
                                        fieldLabel="OPEX (weekly)"
                                        currentValue={week.opexOutflows || 0}
                                        computedValue={week.computedOpex || 0}
                                        hasOverride={week.hasOpexOverride}
                                        requireReason={false}
                                        onSave={({ value }) =>
                                          opexMutation.mutate({ weekStartDate: week.weekStart, opexAmount: value })
                                        }
                                        onResetToComputed={() => clearOpexMutation.mutate(week.weekStart)}
                                        isSaving={opexMutation.isPending}
                                        isResetting={clearOpexMutation.isPending}
                                        testIdPrefix={`edit-opex-${week.weekStart}`}
                                        helperText="Reset reverts to the monthly costed split."
                                      />
                                      {week.hasOpexOverride && canEditCashflow && (
                                        <button
                                          type="button"
                                          className="p-0.5 rounded hover:bg-red-100 text-red-600 transition-colors"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            clearOpexMutation.mutate(week.weekStart);
                                          }}
                                          title={`Clear OPEX override (computed ${formatRand(week.computedOpex)})`}
                                          data-testid={`button-clear-opex-${week.weekStart}`}
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      )}
                                      <span className="text-muted-foreground/50 px-0.5">·</span>
                                      <span className="text-muted-foreground">Proj</span>
                                      <span
                                        className="text-red-500"
                                        data-testid={`text-proj-outflows-${week.weekStart}`}
                                      >
                                        {formatRand(week.projectOutflows)}
                                      </span>
                                    </div>
                                  )}
                                  {week.outflowByStatus && week.projectOutflows > 0 && (
                                    <div className="flex flex-wrap justify-end gap-1 mt-0.5">
                                      {week.outflowByStatus.outOfBank > 0 && <span className="text-[8px] px-1 py-0 rounded bg-emerald-50 text-emerald-700 border border-emerald-300" title="Out of Bank (Paid)">Paid {formatRand(week.outflowByStatus.outOfBank)}</span>}
                                      {week.outflowByStatus.outstanding > 0 && <span className="text-[8px] px-1 py-0 rounded bg-amber-50 text-amber-700 border border-amber-300" title="Outstanding — supplier invoice captured, payment not yet released.">Outstanding {formatRand(week.outflowByStatus.outstanding)}</span>}
                                      {week.outflowByStatus.risk > 0 && <span className="text-[8px] px-1 py-0 rounded bg-red-50 text-red-700 border border-red-300" title="No supplier invoice on file yet — this is an unbilled commitment that has not flowed through QuickBooks. It is a cashflow blind-spot, not a credit-risk score.">Risk {formatRand(week.outflowByStatus.risk)}</span>}
                                      {week.outflowByStatus.planned > 0 && <span className="text-[8px] px-1 py-0 rounded bg-muted text-muted-foreground border border-border" title="Planned">Planned {formatRand(week.outflowByStatus.planned)}</span>}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td
                                className={`px-2 sm:px-4 py-2 sm:py-3 text-right font-mono text-[11px] sm:text-[13px] font-bold ${
                                  (week.closingBalance || 0) >= 0 ? "text-emerald-700" : "text-red-700"
                                }`}
                                data-testid={`text-closing-balance-${week.weekStart}`}
                              >
                                {formatRand(week.closingBalance)}
                              </td>
                              <td
                                className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono text-[11px] sm:text-[13px]"
                                data-testid={`text-available-${week.weekStart}`}
                              >
                                <div className="flex items-center justify-end gap-1.5">
                                  <EditCellPopover
                                    trigger={
                                      <button
                                        type="button"
                                        className={`inline-flex items-center gap-1 font-semibold ${
                                          (week.availablePayment || 0) >= 0 ? "text-emerald-700" : "text-red-700"
                                        } ${canEditCashflow ? "cursor-pointer hover:underline decoration-dashed underline-offset-2 transition-colors" : "cursor-default"}`}
                                        disabled={!canEditCashflow}
                                        onClick={(e) => e.stopPropagation()}
                                        id={current ? "kb-edit-current-availpay" : undefined}
                                        data-testid={`text-available-value-${week.weekStart}`}
                                      >
                                        <span>{formatRand(week.availablePayment)}</span>
                                        {canEditCashflow && (
                                          <Pencil className="h-2.5 w-2.5 text-muted-foreground/60" />
                                        )}
                                      </button>
                                    }
                                    weekLabel={formatWeek(week.weekStart)}
                                    fieldLabel="Available Payment"
                                    currentValue={week.availablePayment || 0}
                                    computedValue={week.computedAvailablePayment || 0}
                                    hasOverride={week.hasAvailPayOverride}
                                    requireReason={true}
                                    defaultReason={week.availPayReason || ""}
                                    onSave={({ value, reason }) =>
                                      availPayMutation.mutate({
                                        weekStartDate: week.weekStart,
                                        overrideValue: value,
                                        reason,
                                        computedValue: week.computedAvailablePayment || 0,
                                      })
                                    }
                                    onResetToComputed={() => clearAvailPayMutation.mutate(week.weekStart)}
                                    isSaving={availPayMutation.isPending}
                                    isResetting={clearAvailPayMutation.isPending}
                                    testIdPrefix={`edit-avail-${week.weekStart}`}
                                    helperText="Computed = Opening + Inflows − All Outflows. A reason is required."
                                  />
                                  {week.hasAvailPayOverride && (
                                    <OverrideChipMenu
                                      canEdit={!!canEditCashflow}
                                      onViewHistory={() => setAvailPayHistoryWeek(week.weekStart)}
                                      onClear={() => clearAvailPayMutation.mutate(week.weekStart)}
                                      testId={`override-avail-${week.weekStart}`}
                                      chip={
                                        <span
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                          title={`Manual override. Computed: ${formatRand(week.computedAvailablePayment)}${week.availPayReason ? `. Reason: ${week.availPayReason}` : ""}`}
                                          data-testid={`badge-avail-override-${week.weekStart}`}
                                        >
                                          <ArrowRight className="h-3 w-3" />
                                        </span>
                                      }
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                            {showDetail && isExpanded && (
                              <DetailRow
                                weekStart={week.weekStart}
                                project={selectedProjects.length > 0 ? selectedProjects.join(",") : "all"}
                                colSpan={6}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
        </div>
      </div>

      <OpexBudgetModal open={opexOpen} onClose={() => setOpexOpen(false)} />

      {/* Avail-pay edit dialog removed in Phase 2 — replaced by EditCellPopover */}

      <Dialog open={!!availPayHistoryWeek} onOpenChange={(v) => !v && setAvailPayHistoryWeek(null)}>
        <DialogContent className="max-w-lg" data-testid="dialog-avail-payment-history">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Available Payment History — {availPayHistoryWeek ? formatWeek(availPayHistoryWeek) : ""}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              All manual overrides for this week, most recent first
            </DialogDescription>
          </DialogHeader>
          {availPayHistory.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No history yet for this week
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto space-y-2">
              {availPayHistory.map((entry) => {
                const prev = entry.previousValue ? parseFloat(entry.previousValue) : null;
                const newVal = parseFloat(entry.newValue);
                const computed = entry.computedValue ? parseFloat(entry.computedValue) : null;
                return (
                  <div
                    key={entry.id}
                    className="border border-border rounded-lg px-4 py-3 bg-muted/50"
                    data-testid={`avail-history-entry-${entry.id}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">
                        {(() => {
                          try {
                            return format(new Date(entry.changedAt), "dd MMM yyyy HH:mm");
                          } catch {
                            return entry.changedAt;
                          }
                        })()}
                      </span>
                      {entry.changedBy && (
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                          {entry.changedBy}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-sm">
                      <span className="text-slate-500">{prev != null ? formatRand(prev) : "—"}</span>
                      <ArrowRight className="h-3 w-3 text-slate-600 flex-shrink-0" />
                      <span className="font-semibold text-foreground">{formatRand(newVal)}</span>
                    </div>
                    {entry.reason && (
                      <div className="mt-1.5 text-[11px] text-muted-foreground bg-blue-50/50 rounded px-2 py-1">
                        <span className="font-medium">Reason:</span> {entry.reason}
                      </div>
                    )}
                    {computed != null && (
                      <div className="mt-1 text-[11px] text-slate-500">
                        Computed: {formatRand(computed)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvailPayHistoryWeek(null)} data-testid="button-avail-history-close">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyWeek} onOpenChange={(v) => !v && setHistoryWeek(null)}>
        <DialogContent className="max-w-lg" data-testid="dialog-balance-history">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Balance Change History — {historyWeek ? formatWeek(historyWeek) : ""}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              All manual balance overrides for this week, most recent first
            </DialogDescription>
          </DialogHeader>
          {balanceHistory.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No history yet for this week
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto space-y-2">
              {balanceHistory.map((entry) => {
                const delta = entry.delta ? parseFloat(entry.delta) : null;
                const prev = entry.previousValue ? parseFloat(entry.previousValue) : null;
                const newVal = parseFloat(entry.newValue);
                const computed = entry.computedValue ? parseFloat(entry.computedValue) : null;
                return (
                  <div
                    key={entry.id}
                    className="border border-border rounded-lg px-4 py-3 bg-muted/50"
                    data-testid={`history-entry-${entry.id}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">
                        {(() => {
                          try {
                            return format(new Date(entry.changedAt), "dd MMM yyyy HH:mm");
                          } catch {
                            return entry.changedAt;
                          }
                        })()}
                      </span>
                      {entry.changedBy && (
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                          {entry.changedBy}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-sm">
                      <span className="text-slate-500">{prev != null ? formatRand(prev) : "—"}</span>
                      <ArrowRight className="h-3 w-3 text-slate-600 flex-shrink-0" />
                      <span className="font-semibold text-foreground">{formatRand(newVal)}</span>
                      {delta != null && delta !== 0 && (
                        <span
                          className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                            delta >= 0
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {delta >= 0 ? "+" : ""}{formatRand(delta)}
                        </span>
                      )}
                    </div>
                    {computed != null && (
                      <div className="mt-1 text-[11px] text-slate-500">
                        Computed: {formatRand(computed)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryWeek(null)} data-testid="button-history-close">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div></FinanceShell>
  );
}

import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { FinanceTrustStrip } from "@/components/finance/FinanceTrustStrip";
import {
  Loader2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { DateOverridePopover } from "@/components/cashflow/DateOverridePopover";

interface CashflowWeek {
  weekStart: string;
  weekEnd: string;
  openingBalance: number;
  computedOpening: number;
  hasManualOverride: boolean;
  balanceDelta: number;
  projectInflows: number;
  opexOutflows: number;
  computedOpex: number;
  hasOpexOverride: boolean;
  projectOutflows: number;
  pastDueUnpaid: number;
  closingBalance: number;
  availablePayment: number;
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
  qbStatus?: "Received" | "Partially received" | "Not received" | "Unknown";
  qbStatusDate?: string | null;
  qbTransactionId?: string | null;
  qbLastSyncAt?: string | null;
  qbMatchConfidence?: "high" | "medium" | "low";
  qbMatchType?: string;
  qbUncertain?: boolean;
  qbUncertainReason?: "stale_sync" | "low_confidence" | null;
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
  paymentStatus?: string;
  qbStatus?: "Paid" | "Partially paid" | "Not paid" | "Unknown";
  qbStatusDate?: string | null;
  qbTransactionId?: string | null;
  qbLastSyncAt?: string | null;
  qbMatchConfidence?: "high" | "medium" | "low";
  qbMatchType?: string;
  qbUncertain?: boolean;
  qbUncertainReason?: "stale_sync" | "low_confidence" | null;
}

interface WeekDetail {
  inflows: DetailInflow[];
  outflows: DetailOutflow[];
  qbMeta?: {
    available: boolean;
    degraded: boolean;
    reason: "qb_unavailable" | "sync_stale" | "incomplete_data" | "low_confidence" | "ok";
    message: string | null;
    lastSyncAt: string | null;
    uncertainCount: number;
    totalRows: number;
  };
}

interface CashflowTabProps {
  projectName?: string;
  projectNames?: string[];
  title?: string;
  canOverrideFinance?: boolean;
}

function formatRand(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "\u2014";
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

function isCurrentWeek(weekStart: string, weekEnd: string): boolean {
  const now = new Date();
  const start = parseISO(weekStart);
  const end = parseISO(weekEnd);
  return now >= start && now < end;
}


function formatDateLabel(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return format(d, "dd MMM yyyy");
}

function qbBadgeClass(status?: string, uncertain?: boolean): string {
  if (!status || status === "Unknown") return "bg-slate-100 text-slate-700 border-slate-200";
  if (uncertain) return "bg-amber-100 text-amber-800 border-amber-300";
  if (status === "Received" || status === "Paid") return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (status === "Partially received" || status === "Partially paid") return "bg-blue-100 text-blue-800 border-blue-300";
  return "bg-rose-100 text-rose-800 border-rose-300";
}

function formatMatchType(matchType?: string): string {
  switch (matchType) {
    case "linked_txn_id":
      return "Linked QB transaction";
    case "invoice_counterparty_amount":
      return "Invoice + counterparty + amount";
    case "invoice_amount":
      return "Invoice + amount";
    case "unmatched":
      return "No QB match";
    default:
      return "Unknown match";
  }
}

function WeekDetailPanel({
  weekStart,
  filterParam,
  canOverride,
}: {
  weekStart: string;
  filterParam?: string;
  canOverride: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = new URLSearchParams({ week: weekStart });
  if (filterParam) params.set("project", filterParam);

  const { data, isLoading } = useQuery<WeekDetail>({
    queryKey: ["/api/cashflow-2026/detail", weekStart, filterParam],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/cashflow-2026/detail?${params.toString()}`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch detail");
      return res.json();
    },
  });

  const overrideExpenseDate = useMutation({
    mutationFn: async (d: { expenseId: number; dateOverride: string | null; reason?: string }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/cashflow-2026/expense-date-override", {
        method: "POST", credentials: "include", headers, body: JSON.stringify(d),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      toast({ title: "Expense date override saved" });
    },
    onError: () => toast({ title: "Failed to save override", variant: "destructive" }),
  });

  const overrideInflowDate = useMutation({
    mutationFn: async (d: { inflowId: number; dateOverride: string | null; reason?: string }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/cashflow-2026/inflow-date-override", {
        method: "POST", credentials: "include", headers, body: JSON.stringify(d),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      toast({ title: "Inflow date override saved" });
    },
    onError: () => toast({ title: "Failed to save override", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading detail...</span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-muted/30 border-t border-border px-4 py-3 space-y-3">
      {data.qbMeta?.degraded && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">{data.qbMeta.message || "QuickBooks status is degraded for this view."}</p>
          <p className="text-[11px] text-amber-800 mt-0.5">
            Weekly cashflow totals remain app-calculated; this only affects QB reconciliation visibility.
          </p>
        </div>
      )}
      {data.inflows.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-emerald-700 mb-1 flex items-center gap-1">
            <ArrowUpRight className="h-3 w-3" /> Inflows ({data.inflows.length})
          </h5>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">Milestone</th>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">Invoice #</th>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">QB Status</th>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">Date</th>
                  <th className="text-right px-2 py-1 font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.inflows.map((inf, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/40">
                    <td className="px-2 py-1 text-muted-foreground">{inf.milestoneName || "\u2014"}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{inf.milestoneInvoiceNumber || "\u2014"}</td>
                    <td className="px-2 py-1">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${qbBadgeClass(inf.qbStatus, inf.qbUncertain)}`}
                        title={
                          `Match: ${formatMatchType(inf.qbMatchType)} | Confidence: ${inf.qbMatchConfidence || "low"}${
                            inf.qbLastSyncAt ? ` | Last synced ${formatDateLabel(inf.qbLastSyncAt)}` : ""
                          }${inf.qbTransactionId ? ` | QB Txn ID: ${inf.qbTransactionId}` : ""}`
                        }
                      >
                        {inf.qbStatus || "Unknown"}
                        {inf.qbUncertain ? " (Uncertain)" : ""}
                      </Badge>
                      {inf.qbStatusDate && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">as of {formatDateLabel(inf.qbStatusDate)}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground">{formatMatchType(inf.qbMatchType)} · {(inf.qbMatchConfidence || "low").toUpperCase()}</p>
                      {inf.qbTransactionId && <p className="text-[10px] text-muted-foreground">QB Txn: {inf.qbTransactionId}</p>}
                      {inf.qbUncertain && (
                        <p className="text-[10px] text-amber-700">
                          {inf.qbUncertainReason === "stale_sync" ? "Sync stale — status may be outdated." : "Low confidence match."}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <DateOverridePopover
                        currentDate={inf.paymentReceivedDate}
                        originalDate={inf.originalDate}
                        hasOverride={inf.hasAdminOverride}
                        overrideReason={inf.adminDateOverrideReason}
                        overrideAt={inf.adminDateOverrideAt}
                        onSave={(dateOverride, reason) =>
                          overrideInflowDate.mutate({ inflowId: inf.inflowId, dateOverride, reason })
                        }
                        disabled={!canOverride}
                        testId={`proj-date-inflow-${weekStart}-${i}`}
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-emerald-700">{formatRand(inf.milestoneAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.outflows.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
            <ArrowDownRight className="h-3 w-3" /> Outflows ({data.outflows.length})
          </h5>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">Category</th>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">Line Item</th>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">Invoice #</th>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">QB Status</th>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">Date</th>
                  <th className="text-right px-2 py-1 font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.outflows.map((out, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/40">
                    <td className="px-2 py-1 text-muted-foreground">{out.expenseCategory || "\u2014"}</td>
                    <td className="px-2 py-1 text-muted-foreground">{out.expenseLineItem || "\u2014"}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{out.expenseInvoiceNumber || "\u2014"}</td>
                    <td className="px-2 py-1">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${qbBadgeClass(out.qbStatus, out.qbUncertain)}`}
                        title={
                          `Match: ${formatMatchType(out.qbMatchType)} | Confidence: ${out.qbMatchConfidence || "low"}${
                            out.qbLastSyncAt ? ` | Last synced ${formatDateLabel(out.qbLastSyncAt)}` : ""
                          }${out.qbTransactionId ? ` | QB Txn ID: ${out.qbTransactionId}` : ""}`
                        }
                      >
                        {out.qbStatus || "Unknown"}
                        {out.qbUncertain ? " (Uncertain)" : ""}
                      </Badge>
                      {out.qbStatusDate && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">as of {formatDateLabel(out.qbStatusDate)}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground">{formatMatchType(out.qbMatchType)} · {(out.qbMatchConfidence || "low").toUpperCase()}</p>
                      {out.qbTransactionId && <p className="text-[10px] text-muted-foreground">QB Txn: {out.qbTransactionId}</p>}
                      {out.qbUncertain && (
                        <p className="text-[10px] text-amber-700">
                          {out.qbUncertainReason === "stale_sync" ? "Sync stale — status may be outdated." : "Low confidence match."}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <DateOverridePopover
                        currentDate={out.expensePaymentDate}
                        originalDate={out.originalDate}
                        hasOverride={out.hasAdminOverride}
                        overrideReason={out.adminDateOverrideReason}
                        overrideAt={out.adminDateOverrideAt}
                        onSave={(dateOverride, reason) =>
                          overrideExpenseDate.mutate({ expenseId: out.expenseId, dateOverride, reason })
                        }
                        disabled={!canOverride}
                        testId={`proj-date-outflow-${weekStart}-${i}`}
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-red-700">{formatRand(out.expenseActualTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.inflows.length === 0 && data.outflows.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">No line items this week</p>
      )}
    </div>
  );
}

export function CashflowTab({ projectName, projectNames, title, canOverrideFinance = false }: CashflowTabProps) {
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  const filterParam = useMemo(() => {
    if (projectNames && projectNames.length > 0) return projectNames.join(",");
    if (projectName) return projectName;
    return undefined;
  }, [projectName, projectNames]);

  const { data: cashflowData = [], isLoading } = useQuery<CashflowWeek[]>({
    queryKey: ["/api/cashflow-2026", filterParam],
    queryFn: async () => {
      const url = filterParam
        ? `/api/cashflow-2026?project=${encodeURIComponent(filterParam)}`
        : "/api/cashflow-2026";
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to fetch cashflow data");
      return res.json();
    },
  });

  const chartData = useMemo(() => {
    return cashflowData.map((w) => ({
      week: formatWeek(w.weekStart),
      "Opening Balance": w.openingBalance,
      "Inflows": w.projectInflows,
      "Outflows": w.projectOutflows,
      "Closing Balance": w.closingBalance,
    }));
  }, [cashflowData]);

  const kpis = useMemo(() => {
    const totalInflows = cashflowData.reduce((s, w) => s + (w.projectInflows || 0), 0);
    const totalOutflows = cashflowData.reduce((s, w) => s + (w.projectOutflows || 0), 0);
    const now = new Date();
    const currentWeek = cashflowData.find((w) => {
      const start = parseISO(w.weekStart);
      const end = parseISO(w.weekEnd);
      return now >= start && now < end;
    });
    const currentWeekOpeningBalance =
      currentWeek?.openingBalance ?? (cashflowData.length > 0 ? cashflowData[0].openingBalance : 0);
    const lastWeek = cashflowData.length > 0 ? cashflowData[cashflowData.length - 1] : null;
    const forecastedEndOfFYPosition = lastWeek?.closingBalance ?? 0;
    return { totalInflows, totalOutflows, currentWeekOpeningBalance, forecastedEndOfFYPosition };
  }, [cashflowData]);

  const toggleWeek = (weekStart: string) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekStart)) next.delete(weekStart);
      else next.add(weekStart);
      return next;
    });
  };

  const displayTitle = title || (projectName ? `Cashflow \u2014 ${projectName}` : "Cashflow FY26");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (cashflowData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{displayTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">
            No cashflow data available
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="cashflow-tab-fy26">
      <FinanceTrustStrip
        source="Cashflow app model"
        lastImportDate={new Date().toISOString()}
        quickBooksLinkStatus="partial"
        readOnly={!canOverrideFinance}
        metrics={[
          { label: "Unresolved drift", value: 0, href: "/excel-vs-app", tone: "warning", testId: "trust-drift-badge" },
          { label: "Manual overrides", value: 0, href: "/manual-overrides" },
          { label: "Missing PO", value: 0, href: "/project-financial-management", testId: "trust-missing-po-badge" },
        ]}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiMini
          label="Total Inflows"
          value={formatRand(kpis.totalInflows)}
          icon={<TrendingUp className="h-4 w-4" />}
          color="green"
        />
        <KpiMini
          label="Total Outflows"
          value={formatRand(kpis.totalOutflows)}
          icon={<TrendingDown className="h-4 w-4" />}
          color="red"
        />
        <KpiMini
          label="Current Week Balance"
          value={formatRand(kpis.currentWeekOpeningBalance)}
          icon={<DollarSign className="h-4 w-4" />}
          color={kpis.currentWeekOpeningBalance >= 0 ? "blue" : "red"}
        />
        <KpiMini
          label="FY End Forecast"
          value={formatRand(kpis.forecastedEndOfFYPosition)}
          icon={kpis.forecastedEndOfFYPosition >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
          color={kpis.forecastedEndOfFYPosition >= 0 ? "green" : "red"}
        />
      </div>

      <Card className="border border-border shadow-sm rounded-xl overflow-hidden">
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-semibold text-foreground">{displayTitle}</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3">
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="week"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  angle={-45}
                  textAnchor="end"
                  height={55}
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
                <Legend wrapperStyle={{ paddingTop: "8px", fontSize: "11px" }} iconType="circle" iconSize={8} />
                <Line type="monotone" dataKey="Opening Balance" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                <Line type="monotone" dataKey="Inflows" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                <Line type="monotone" dataKey="Outflows" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                <Line type="monotone" dataKey="Closing Balance" stroke="#8b5cf6" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border shadow-sm rounded-xl overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[50vh]">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted/80 border-b-2 border-border">
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider sticky left-0 bg-muted/80 z-30 min-w-[90px]">
                    Week
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[110px] bg-muted/80">
                    Opening Bal
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[110px] bg-muted/80">
                    Inflows
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[110px] bg-muted/80">
                    Outflows
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[110px] bg-muted/80">
                    Closing Bal
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[120px] bg-muted/80">
                    Net Flow
                  </th>
                </tr>
              </thead>
              <tbody>
                {cashflowData.map((week, idx) => {
                  const current = isCurrentWeek(week.weekStart, week.weekEnd);
                  const isEven = idx % 2 === 0;
                  const netFlow = (week.projectInflows || 0) - (week.projectOutflows || 0);
                  const isExpanded = expandedWeeks.has(week.weekStart);
                  const hasActivity = (week.projectInflows || 0) > 0 || (week.projectOutflows || 0) > 0;

                  return (
                    <Fragment key={week.weekStart}>
                      <tr
                        className={`border-b border-border transition-colors cursor-pointer ${
                          current
                            ? "bg-blue-50/70 border-l-[3px] border-l-blue-500"
                            : isEven
                            ? "bg-card"
                            : "bg-muted/30"
                        } hover:bg-muted/60`}
                        onClick={() => hasActivity && toggleWeek(week.weekStart)}
                      >
                        <td
                          className={`px-4 py-2.5 font-medium text-foreground sticky left-0 z-10 ${
                            current ? "bg-blue-50/70" : isEven ? "bg-card" : "bg-muted/30"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            {hasActivity && (
                              isExpanded
                                ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            )}
                            <span className="text-[13px]">{formatWeek(week.weekStart)}</span>
                            {current && (
                              <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
                                NOW
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[13px] text-blue-600">
                          {formatRand(week.openingBalance)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[13px] text-emerald-600">
                          {formatRand(week.projectInflows)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[13px]">
                          <span className="text-red-500">{formatRand(week.projectOutflows)}</span>
                          {(week.pastDueUnpaid || 0) > 0 && (
                            <div className="text-[10px] font-semibold text-red-700 bg-red-100 rounded px-1 py-0.5 mt-0.5 inline-block" title="Past-due outflows not yet confirmed out of bank">
                              {formatRand(week.pastDueUnpaid)} overdue
                            </div>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono text-[13px] font-bold ${(week.closingBalance || 0) >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                          {formatRand(week.closingBalance)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono text-[13px] font-semibold ${netFlow >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {formatRand(netFlow)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <WeekDetailPanel
                              weekStart={week.weekStart}
                              filterParam={filterParam}
                              canOverride={canOverrideFinance}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiMini({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: "green" | "red" | "blue";
}) {
  const colorMap = {
    green: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", iconBg: "bg-emerald-100", iconColor: "text-emerald-600" },
    red: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", iconBg: "bg-red-100", iconColor: "text-red-600" },
    blue: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", iconBg: "bg-blue-100", iconColor: "text-blue-600" },
  };
  const c = colorMap[color];
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-3 flex items-center gap-2.5`}>
      <div className={`rounded-lg ${c.iconBg} p-2 ${c.iconColor}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</p>
        <p className={`text-base font-bold font-mono ${c.text} truncate`}>{value}</p>
      </div>
    </div>
  );
}

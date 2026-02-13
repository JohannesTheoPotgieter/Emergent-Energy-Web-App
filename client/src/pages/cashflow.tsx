import { useState, useMemo, useCallback, Fragment } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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
} from "lucide-react";
import { format, parseISO } from "date-fns";

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
  closingBalance: number;
  availablePayment: number;
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

interface DetailInflow {
  projectName: string;
  milestoneName: string;
  milestoneInvoiceNumber: string;
  paymentReceivedDate: string;
  milestoneAmount: number;
  invoiceRaisedDate: string;
  daysToReceipt: number;
}

interface DetailOutflow {
  projectName: string;
  expenseCategory: string;
  expenseLineItem: string;
  expenseInvoiceNumber: string;
  expensePaymentDate: string;
  expenseActualTotal: number;
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

const FY26_MONTHS = [
  { key: "2025-09", label: "Sep 2025" },
  { key: "2025-10", label: "Oct 2025" },
  { key: "2025-11", label: "Nov 2025" },
  { key: "2025-12", label: "Dec 2025" },
  { key: "2026-01", label: "Jan 2026" },
  { key: "2026-02", label: "Feb 2026" },
  { key: "2026-03", label: "Mar 2026" },
  { key: "2026-04", label: "Apr 2026" },
  { key: "2026-05", label: "May 2026" },
  { key: "2026-06", label: "Jun 2026" },
  { key: "2026-07", label: "Jul 2026" },
  { key: "2026-08", label: "Aug 2026" },
];

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
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: "green" | "red" | "blue" | "purple";
  testId: string;
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
      </div>
    </div>
  );
}

function DetailRow({ weekStart, project }: { weekStart: string; project: string }) {
  const [detailSearch, setDetailSearch] = useState("");
  const params = new URLSearchParams({ week: weekStart });
  if (project !== "all") params.set("project", project);

  const { data, isLoading } = useQuery<WeekDetail>({
    queryKey: ["/api/cashflow-2026/detail", weekStart, project],
    queryFn: async () => {
      const res = await fetch(`/api/cashflow-2026/detail?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch detail");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={8} className="p-0">
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
      <td colSpan={8} className="p-0">
        <div className="bg-gradient-to-b from-slate-50/80 to-white border-y border-slate-200/60 px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <Input
              placeholder="Search inflows & outflows..."
              value={detailSearch}
              onChange={(e) => setDetailSearch(e.target.value)}
              className="max-w-xs h-8 text-xs rounded-lg border-slate-300 focus:border-blue-400 focus:ring-blue-400"
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
            <div className="rounded-lg border border-emerald-200/60 bg-white overflow-hidden">
              <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200/60">
                <h4 className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Inflows
                </h4>
              </div>
              {filteredInflows.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4 text-center">No inflows this week</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse" data-testid={`table-inflows-${weekStart}`}>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/50">
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Project</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Milestone</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Invoice #</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Date</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-600">Amount</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-600">Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInflows.map((inf, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors" data-testid={`row-inflow-${weekStart}-${i}`}>
                          <td className="px-3 py-2 font-medium text-slate-700">{inf.projectName}</td>
                          <td className="px-3 py-2 text-slate-600">{inf.milestoneName}</td>
                          <td className="px-3 py-2 font-mono text-slate-500 text-[11px]">{inf.milestoneInvoiceNumber || "—"}</td>
                          <td className="px-3 py-2 text-slate-600">{inf.paymentReceivedDate ? format(parseISO(inf.paymentReceivedDate), "dd MMM") : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-emerald-700">{formatRand(inf.milestoneAmount)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-500">{inf.daysToReceipt ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-red-200/60 bg-white overflow-hidden">
              <div className="px-4 py-2.5 bg-red-50 border-b border-red-200/60">
                <h4 className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  Outflows
                </h4>
              </div>
              {filteredOutflows.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4 text-center">No outflows this week</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse" data-testid={`table-outflows-${weekStart}`}>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/50">
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Project</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Category</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Line Item</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Invoice #</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Date</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOutflows.map((out, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors" data-testid={`row-outflow-${weekStart}-${i}`}>
                          <td className="px-3 py-2 font-medium text-slate-700">{out.projectName}</td>
                          <td className="px-3 py-2 text-slate-600">{out.expenseCategory}</td>
                          <td className="px-3 py-2 text-slate-600">{out.expenseLineItem}</td>
                          <td className="px-3 py-2 font-mono text-slate-500 text-[11px]">{out.expenseInvoiceNumber || "—"}</td>
                          <td className="px-3 py-2 text-slate-600">{out.expensePaymentDate ? format(parseISO(out.expensePaymentDate), "dd MMM") : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-red-700">{formatRand(out.expenseActualTotal)}</td>
                        </tr>
                      ))}
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
    queryKey: ["/api/cashflow-2026/opex-budget"],
    queryFn: async () => {
      const res = await fetch("/api/cashflow-2026/opex-budget", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch OPEX budget");
      return res.json();
    },
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async (entries: { monthKey: string; amount: number }[]) => {
      for (const entry of entries) {
        await apiRequest("POST", "/api/cashflow-2026/opex-budget", entry);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026/opex-budget"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      setEditedValues({});
      toast({ title: "OPEX Budget Saved", description: "Budget values updated successfully." });
    },
    onError: () => {
      toast({ title: "Save Failed", description: "Failed to save OPEX budget.", variant: "destructive" });
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
      toast({ title: "No Changes", description: "No OPEX budget values changed." });
      return;
    }
    saveMutation.mutate(entries);
  };

  const totalBudget = FY26_MONTHS.reduce((sum, m) => {
    const val = editedValues[m.key] !== undefined
      ? parseFloat(editedValues[m.key]) || 0
      : opexMap[m.key] ?? 0;
    return sum + val;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-opex-budget">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">OPEX Monthly Budget — FY26</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Set monthly operating expense budgets for Sep 2025 – Aug 2026
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" data-testid="spinner-opex" />
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {FY26_MONTHS.map((m) => {
              const currentVal = editedValues[m.key] ?? (opexMap[m.key]?.toString() || "0");
              return (
                <div key={m.key} className="flex items-center gap-3 group hover:bg-slate-50 rounded-lg px-2 py-1.5 transition-colors">
                  <span className="text-sm font-medium text-slate-600 w-24 flex-shrink-0">{m.label}</span>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">R</span>
                    <Input
                      type="number"
                      value={currentVal}
                      onChange={(e) =>
                        setEditedValues((prev) => ({ ...prev, [m.key]: e.target.value }))
                      }
                      className="text-right font-mono pl-7 h-9 border-slate-200 focus:border-blue-400 focus:ring-blue-400"
                      data-testid={`input-opex-${m.key}`}
                    />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-3 border-t border-slate-200 pt-3 mt-2 px-2">
              <span className="text-sm font-bold text-slate-700 w-24 flex-shrink-0">Total</span>
              <span className="flex-1 text-right font-mono font-bold text-slate-900 pr-3" data-testid="text-opex-total">
                {formatRand(totalBudget)}
              </span>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} data-testid="button-opex-cancel" className="border-slate-300">
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
              "Save Budget"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CashflowPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState("all");
  const [showDetail, setShowDetail] = useState(false);
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [opexOpen, setOpexOpen] = useState(false);
  const [editingBalance, setEditingBalance] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingOpex, setEditingOpex] = useState<string | null>(null);
  const [editingOpexValue, setEditingOpexValue] = useState("");
  const [historyWeek, setHistoryWeek] = useState<string | null>(null);

  const projectParam = selectedProject !== "all" ? selectedProject : undefined;

  const { data: cashflowData = [], isLoading } = useQuery<CashflowWeek[]>({
    queryKey: ["/api/cashflow-2026", projectParam],
    queryFn: async () => {
      const url = projectParam
        ? `/api/cashflow-2026?project=${encodeURIComponent(projectParam)}`
        : "/api/cashflow-2026";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch cashflow data");
      return res.json();
    },
  });

  const { data: balanceHistory = [] } = useQuery<BalanceHistoryEntry[]>({
    queryKey: ["/api/cashflow-2026/balance-history", historyWeek],
    queryFn: async () => {
      const url = historyWeek
        ? `/api/cashflow-2026/balance-history?week=${historyWeek}`
        : "/api/cashflow-2026/balance-history";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch balance history");
      return res.json();
    },
    enabled: !!historyWeek,
  });

  const { data: projectsSummary = [] } = useQuery<{ projectName: string }[]>({
    queryKey: ["/api/projects-summary"],
    queryFn: async () => {
      const res = await fetch("/api/projects-summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  const projectNames = useMemo(() => {
    const names = new Set<string>();
    projectsSummary.forEach((p: any) => {
      if (p.project_name) names.add(p.project_name);
    });
    return Array.from(names).sort();
  }, [projectsSummary]);

  const balanceMutation = useMutation({
    mutationFn: async (body: { weekStartDate: string; openingBalance: number; computedValue: number; clearForward: boolean }) => {
      await apiRequest("POST", "/api/cashflow-2026/opening-balance", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026/balance-history"] });
      setEditingBalance(null);
      toast({ title: "Opening Balance Saved", description: "All forward weeks recalculated" });
    },
    onError: () => {
      toast({ title: "Save Failed", variant: "destructive" });
    },
  });

  const clearOverrideMutation = useMutation({
    mutationFn: async (weekStartDate: string) => {
      await apiRequest("DELETE", "/api/cashflow-2026/opening-balance", { weekStartDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026/balance-history"] });
      toast({ title: "Override Cleared", description: "Balance now uses cascaded value" });
    },
    onError: () => {
      toast({ title: "Clear Failed", variant: "destructive" });
    },
  });

  const opexMutation = useMutation({
    mutationFn: async (body: { weekStartDate: string; opexAmount: number }) => {
      await apiRequest("POST", "/api/cashflow-2026/opex-weekly", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      setEditingOpex(null);
      toast({ title: "OPEX Saved", description: "Weekly OPEX updated and values recalculated" });
    },
    onError: () => {
      toast({ title: "Save Failed", variant: "destructive" });
    },
  });

  const clearOpexMutation = useMutation({
    mutationFn: async (weekStartDate: string) => {
      await apiRequest("DELETE", "/api/cashflow-2026/opex-weekly", { weekStartDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      toast({ title: "OPEX Override Cleared", description: "Using monthly budget split value" });
    },
    onError: () => {
      toast({ title: "Clear Failed", variant: "destructive" });
    },
  });

  const handleOpexSave = useCallback(
    (weekStart: string) => {
      const val = parseFloat(editingOpexValue);
      if (!Number.isFinite(val)) return;
      opexMutation.mutate({ weekStartDate: weekStart, opexAmount: val });
    },
    [editingOpexValue, opexMutation]
  );

  const handleBalanceSave = useCallback(
    (weekStart: string, computedValue: number) => {
      const val = parseFloat(editingValue);
      if (!Number.isFinite(val)) return;
      balanceMutation.mutate({ weekStartDate: weekStart, openingBalance: val, computedValue, clearForward: true });
    },
    [editingValue, balanceMutation]
  );

  const handleRowClick = useCallback(
    (weekStart: string) => {
      if (!showDetail) return;
      setExpandedWeek((prev) => (prev === weekStart ? null : weekStart));
    },
    [showDetail]
  );

  const chartData = useMemo(() => {
    return cashflowData.map((w) => ({
      week: formatWeek(w.weekStart),
      "Opening Balance": w.openingBalance,
      "Project Inflows": w.projectInflows,
      "Total Outflows": (w.opexOutflows || 0) + (w.projectOutflows || 0),
      "Closing Balance": w.closingBalance,
    }));
  }, [cashflowData]);

  const kpis = useMemo(() => {
    const totalInflows = cashflowData.reduce((s, w) => s + (w.projectInflows || 0), 0);
    const totalOutflows = cashflowData.reduce(
      (s, w) => s + (w.opexOutflows || 0) + (w.projectOutflows || 0),
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

  return (
    <div className="min-h-screen bg-slate-50/40" data-testid="page-cashflow">
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="px-6 py-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight" data-testid="text-page-title">
                Cashflow FY26
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Weekly cashflow timeline — Sep 2025 to Aug 2026
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="appearance-none border border-slate-300 rounded-lg px-3 py-2 pr-8 text-sm bg-white text-slate-700 cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors"
                  data-testid="select-project-filter"
                >
                  <option value="all">All Projects</option>
                  {projectNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              </div>
              <Button
                variant={showDetail ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setShowDetail((v) => !v);
                  if (showDetail) setExpandedWeek(null);
                }}
                className={`gap-1.5 rounded-lg transition-all ${
                  showDetail
                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
                data-testid="button-toggle-detail"
              >
                {showDetail ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showDetail ? "Hide Detail" : "Show Detail"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpexOpen(true)}
                className="gap-1.5 rounded-lg border-slate-300 text-slate-600 hover:bg-slate-50"
                data-testid="button-opex-budget"
              >
                <DollarSign className="h-3.5 w-3.5" />
                OPEX Budget
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" data-testid="spinner-main" />
            <span className="text-sm font-medium">Loading cashflow data...</span>
          </div>
        ) : cashflowData.length === 0 ? (
          <Card className="border-dashed border-2 border-slate-300">
            <CardContent className="py-16">
              <div className="text-center">
                <div className="rounded-full bg-slate-100 w-14 h-14 flex items-center justify-center mx-auto mb-4">
                  <DollarSign className="h-7 w-7 text-slate-400" />
                </div>
                <p className="text-lg font-semibold text-slate-700" data-testid="text-empty-state">No cashflow data available</p>
                <p className="text-sm text-slate-500 mt-1.5 max-w-sm mx-auto">
                  Upload tracker files to populate the cashflow timeline
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="kpi-summary-row">
              <KpiCard
                title="Total Inflows YTD"
                value={formatRand(kpis.totalInflows)}
                icon={<TrendingUp className="h-5 w-5" />}
                color="green"
                testId="kpi-total-inflows"
              />
              <KpiCard
                title="Total Outflows YTD"
                value={formatRand(kpis.totalOutflows)}
                icon={<TrendingDown className="h-5 w-5" />}
                color="red"
                testId="kpi-total-outflows"
              />
              <KpiCard
                title="Current Week Opening Balance"
                value={formatRand(kpis.currentWeekOpeningBalance)}
                icon={<DollarSign className="h-5 w-5" />}
                color={kpis.currentWeekOpeningBalance >= 0 ? "blue" : "red"}
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

            <Card className="border border-slate-200 shadow-sm rounded-xl overflow-hidden" data-testid="card-trend-chart">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold text-slate-700">Cashflow Trend</CardTitle>
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
            </Card>

            <Card className="border border-slate-200 shadow-sm rounded-xl overflow-hidden" data-testid="card-weekly-grid">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm" data-testid="table-cashflow">
                    <thead>
                      <tr className="bg-slate-100/80 border-b-2 border-slate-200">
                        <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider sticky left-0 bg-slate-100/80 z-10 min-w-[100px]">
                          Week
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider min-w-[130px]">
                          Opening Bal
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider min-w-[130px]">
                          Proj Inflows
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider min-w-[140px]">
                          Avail Payment
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider min-w-[120px]">
                          OPEX
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider min-w-[130px]">
                          Proj Outflows
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider min-w-[130px]">
                          Total Out
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider min-w-[130px]">
                          Closing Bal
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashflowData.map((week, idx) => {
                        const totalOutflows = (week.opexOutflows || 0) + (week.projectOutflows || 0);
                        const current = isCurrentWeek(week.weekStart, week.weekEnd);
                        const isExpanded = expandedWeek === week.weekStart;
                        const isEven = idx % 2 === 0;

                        return (
                          <Fragment key={week.weekStart}>
                            <tr
                              className={`border-b border-slate-100 transition-colors ${
                                current
                                  ? "bg-blue-50/70 border-l-[3px] border-l-blue-500"
                                  : isEven
                                  ? "bg-white"
                                  : "bg-slate-50/30"
                              } ${showDetail ? "cursor-pointer hover:bg-blue-50/40" : "hover:bg-slate-50/60"}`}
                              onClick={() => handleRowClick(week.weekStart)}
                              data-testid={`row-week-${week.weekStart}`}
                            >
                              <td
                                className={`px-4 py-3 font-medium text-slate-700 sticky left-0 z-10 ${
                                  current ? "bg-blue-50/70" : isEven ? "bg-white" : "bg-slate-50/30"
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  {showDetail && (
                                    isExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                                    )
                                  )}
                                  <span className="text-[13px]">{formatWeek(week.weekStart)}</span>
                                  {current && (
                                    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
                                      NOW
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-[13px] text-blue-600">
                                <div className="flex items-center justify-end gap-1.5">
                                  {editingBalance === week.weekStart ? (
                                    <input
                                      type="number"
                                      className="w-28 text-right p-1.5 border border-blue-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                                      value={editingValue}
                                      onChange={(e) => setEditingValue(e.target.value)}
                                      onBlur={() => handleBalanceSave(week.weekStart, week.computedOpening)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleBalanceSave(week.weekStart, week.computedOpening);
                                        if (e.key === "Escape") setEditingBalance(null);
                                      }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                      data-testid={`input-opening-balance-${week.weekStart}`}
                                    />
                                  ) : (
                                    <>
                                      <span
                                        className="cursor-pointer hover:underline hover:text-blue-700 decoration-dashed underline-offset-2 transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingBalance(week.weekStart);
                                          setEditingValue(week.openingBalance?.toString() || "0");
                                        }}
                                        data-testid={`text-opening-balance-${week.weekStart}`}
                                      >
                                        {formatRand(week.openingBalance)}
                                      </span>
                                      {week.hasManualOverride && (
                                        <>
                                          <span
                                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                              week.balanceDelta >= 0
                                                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                                : "bg-red-50 text-red-700 hover:bg-red-100"
                                            }`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setHistoryWeek(week.weekStart);
                                            }}
                                            title={`Manual override: ${week.balanceDelta >= 0 ? "+" : ""}${formatRand(week.balanceDelta)} vs computed (${formatRand(week.computedOpening)}). Click for history.`}
                                            data-testid={`badge-delta-${week.weekStart}`}
                                          >
                                            {week.balanceDelta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                            {formatRand(Math.abs(week.balanceDelta))}
                                          </span>
                                          <button
                                            className="p-0.5 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              clearOverrideMutation.mutate(week.weekStart);
                                            }}
                                            title="Clear manual override — use cascaded value"
                                            data-testid={`button-clear-override-${week.weekStart}`}
                                          >
                                            <X className="h-3 w-3" />
                                          </button>
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                              <td
                                className="px-4 py-3 text-right font-mono text-[13px] text-emerald-600"
                                data-testid={`text-inflows-${week.weekStart}`}
                              >
                                {formatRand(week.projectInflows)}
                              </td>
                              <td
                                className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-slate-800"
                                data-testid={`text-available-${week.weekStart}`}
                              >
                                {formatRand(week.availablePayment)}
                              </td>
                              <td
                                className="px-4 py-3 text-right font-mono text-[13px] text-red-500"
                                data-testid={`text-opex-${week.weekStart}`}
                              >
                                <div className="flex items-center justify-end gap-1.5">
                                  {editingOpex === week.weekStart ? (
                                    <input
                                      type="number"
                                      className="w-28 text-right p-1.5 border border-orange-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
                                      value={editingOpexValue}
                                      onChange={(e) => setEditingOpexValue(e.target.value)}
                                      onBlur={() => handleOpexSave(week.weekStart)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleOpexSave(week.weekStart);
                                        if (e.key === "Escape") setEditingOpex(null);
                                      }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                      data-testid={`input-opex-weekly-${week.weekStart}`}
                                    />
                                  ) : (
                                    <>
                                      <span
                                        className="cursor-pointer hover:underline hover:text-red-700 decoration-dashed underline-offset-2 transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingOpex(week.weekStart);
                                          setEditingOpexValue(week.opexOutflows?.toString() || "0");
                                        }}
                                        data-testid={`text-opex-value-${week.weekStart}`}
                                      >
                                        {formatRand(week.opexOutflows)}
                                      </span>
                                      {week.hasOpexOverride && (
                                        <>
                                          <span
                                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-50 text-orange-700"
                                            title={`Manual override. Budget split: ${formatRand(week.computedOpex)}`}
                                          >
                                            <ArrowRight className="h-3 w-3" />
                                          </span>
                                          <button
                                            className="p-0.5 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              clearOpexMutation.mutate(week.weekStart);
                                            }}
                                            title="Clear OPEX override — use monthly budget split"
                                            data-testid={`button-clear-opex-${week.weekStart}`}
                                          >
                                            <X className="h-3 w-3" />
                                          </button>
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                              <td
                                className="px-4 py-3 text-right font-mono text-[13px] text-red-500"
                                data-testid={`text-proj-outflows-${week.weekStart}`}
                              >
                                {formatRand(week.projectOutflows)}
                              </td>
                              <td
                                className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-red-700"
                                data-testid={`text-total-outflows-${week.weekStart}`}
                              >
                                {formatRand(totalOutflows)}
                              </td>
                              <td
                                className={`px-4 py-3 text-right font-mono text-[13px] font-bold ${
                                  (week.closingBalance || 0) >= 0 ? "text-emerald-700" : "text-red-700"
                                }`}
                                data-testid={`text-closing-balance-${week.weekStart}`}
                              >
                                {formatRand(week.closingBalance)}
                              </td>
                            </tr>
                            {showDetail && isExpanded && (
                              <DetailRow
                                weekStart={week.weekStart}
                                project={selectedProject}
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

      <OpexBudgetModal open={opexOpen} onClose={() => setOpexOpen(false)} />

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
                    className="border border-slate-100 rounded-lg px-4 py-3 bg-slate-50/50"
                    data-testid={`history-entry-${entry.id}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-slate-500">
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
                      <span className="text-slate-400">{prev != null ? formatRand(prev) : "—"}</span>
                      <ArrowRight className="h-3 w-3 text-slate-300 flex-shrink-0" />
                      <span className="font-semibold text-slate-800">{formatRand(newVal)}</span>
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
                      <div className="mt-1 text-[11px] text-slate-400">
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
    </div>
  );
}

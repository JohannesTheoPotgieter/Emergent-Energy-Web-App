import { useState, useMemo, useCallback, Fragment } from "react";
import { useAuth } from "@/hooks/use-auth";
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
  computedAvailablePayment: number;
  hasAvailPayOverride: boolean;
  availPayReason: string | null;
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

function DetailRow({ weekStart, project, colSpan = 8 }: { weekStart: string; project: string; colSpan?: number }) {
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
        <div className="bg-gradient-to-b from-slate-50/80 to-white border-y border-border/60 px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
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
                <p className="text-xs text-muted-foreground p-4 text-center">No inflows this week</p>
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
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInflows.map((inf, i) => (
                        <tr key={i} className="border-b border-border hover:bg-muted/50 transition-colors" data-testid={`row-inflow-${weekStart}-${i}`}>
                          <td className="px-3 py-2 font-medium text-foreground">{inf.projectName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{inf.milestoneName}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground text-[11px]">{inf.milestoneInvoiceNumber || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{inf.paymentReceivedDate ? format(parseISO(inf.paymentReceivedDate), "dd MMM") : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-emerald-700">{formatRand(inf.milestoneAmount)}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{inf.daysToReceipt ?? "—"}</td>
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
                <p className="text-xs text-muted-foreground p-4 text-center">No outflows this week</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse" data-testid={`table-outflows-${weekStart}`}>
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Project</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Category</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Line Item</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice #</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOutflows.map((out, i) => (
                        <tr key={i} className="border-b border-border hover:bg-muted/50 transition-colors" data-testid={`row-outflow-${weekStart}-${i}`}>
                          <td className="px-3 py-2 font-medium text-foreground">{out.projectName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{out.expenseCategory}</td>
                          <td className="px-3 py-2 text-muted-foreground">{out.expenseLineItem}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground text-[11px]">{out.expenseInvoiceNumber || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{out.expensePaymentDate ? format(parseISO(out.expensePaymentDate), "dd MMM") : "—"}</td>
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
          <DialogTitle className="text-lg font-semibold">OPEX Monthly Costed — FY26</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Set monthly operating expense costed amounts for Sep 2025 – Aug 2026
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

export default function CashflowPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [opexOpen, setOpexOpen] = useState(false);
  const [editingBalance, setEditingBalance] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingOpex, setEditingOpex] = useState<string | null>(null);
  const [editingOpexValue, setEditingOpexValue] = useState("");
  const [historyWeek, setHistoryWeek] = useState<string | null>(null);
  const [availPayEdit, setAvailPayEdit] = useState<{ weekStart: string; computedValue: number } | null>(null);
  const [availPayValue, setAvailPayValue] = useState("");
  const [availPayReason, setAvailPayReason] = useState("");
  const [availPayHistoryWeek, setAvailPayHistoryWeek] = useState<string | null>(null);

  const projectParam = selectedProjects.length > 0 ? selectedProjects.join(",") : undefined;

  const { data: cashflowData = [], isLoading } = useQuery<CashflowWeek[]>({
    queryKey: ["/api/cashflow-2026", projectParam],
    queryFn: async () => {
      const url = projectParam
        ? `/api/cashflow-2026?project=${encodeURIComponent(projectParam)}`
        : "/api/cashflow-2026";
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, { credentials: "include", headers });
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
      const bToken = localStorage.getItem("auth_token");
      const bHeaders: Record<string, string> = {};
      if (bToken) bHeaders["Authorization"] = `Bearer ${bToken}`;
      const res = await fetch(url, { credentials: "include", headers: bHeaders });
      if (!res.ok) throw new Error("Failed to fetch balance history");
      return res.json();
    },
    enabled: !!historyWeek,
  });

  const { data: projectsSummary = [] } = useQuery<{ projectName: string }[]>({
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
      invalidateDashboardQueries(queryClient);
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
      invalidateDashboardQueries(queryClient);
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
      invalidateDashboardQueries(queryClient);
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
      invalidateDashboardQueries(queryClient);
      toast({ title: "OPEX Override Cleared", description: "Using monthly costed split value" });
    },
    onError: () => {
      toast({ title: "Clear Failed", variant: "destructive" });
    },
  });

  const { data: availPayHistory = [] } = useQuery<{ id: number; weekStartDate: string; previousValue: string | null; newValue: string; computedValue: string | null; reason: string | null; changedAt: string; changedBy: string | null }[]>({
    queryKey: ["/api/cashflow-2026/available-payment-history", availPayHistoryWeek],
    queryFn: async () => {
      const hToken = localStorage.getItem("auth_token");
      const hHeaders: Record<string, string> = {};
      if (hToken) hHeaders["Authorization"] = `Bearer ${hToken}`;
      const res = await fetch(`/api/cashflow-2026/available-payment-history?week=${availPayHistoryWeek}`, { credentials: "include", headers: hHeaders });
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    enabled: !!availPayHistoryWeek,
  });

  const availPayMutation = useMutation({
    mutationFn: async (body: { weekStartDate: string; overrideValue: number; reason: string; computedValue: number }) => {
      await apiRequest("POST", "/api/cashflow-2026/available-payment", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026/available-payment-history"] });
      invalidateDashboardQueries(queryClient);
      setAvailPayEdit(null);
      setAvailPayValue("");
      setAvailPayReason("");
      toast({ title: "Available Payment Updated", description: "Override saved with reason" });
    },
    onError: () => {
      toast({ title: "Save Failed", variant: "destructive" });
    },
  });

  const clearAvailPayMutation = useMutation({
    mutationFn: async (weekStartDate: string) => {
      await apiRequest("DELETE", "/api/cashflow-2026/available-payment", { weekStartDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026/available-payment-history"] });
      invalidateDashboardQueries(queryClient);
      toast({ title: "Override Cleared", description: "Using computed available payment" });
    },
    onError: () => {
      toast({ title: "Clear Failed", variant: "destructive" });
    },
  });

  const handleAvailPaySave = useCallback(() => {
    if (!availPayEdit) return;
    const val = parseFloat(availPayValue);
    if (!Number.isFinite(val)) return;
    if (!availPayReason.trim()) {
      toast({ title: "Reason Required", description: "Please provide a reason for the override", variant: "destructive" });
      return;
    }
    availPayMutation.mutate({ weekStartDate: availPayEdit.weekStart, overrideValue: val, reason: availPayReason.trim(), computedValue: availPayEdit.computedValue });
  }, [availPayEdit, availPayValue, availPayReason, availPayMutation, toast]);

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

  const isProjectFiltered = selectedProjects.length > 0;

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

  return (
    <div className="min-h-screen bg-background" data-testid="page-cashflow">
      <div className="bg-card border-b border-border shadow-sm">
        <div className="px-6 py-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight" data-testid="text-page-title">
                Cashflow FY26
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Weekly cashflow timeline — Sep 2025 to Aug 2026
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
                <PopoverContent className="w-[320px] p-0" align="start">
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
              {selectedProjects.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
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
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
                data-testid="button-toggle-detail"
              >
                {showDetail ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showDetail ? "Hide Detail" : "Show Detail"}
              </Button>
              {isAdmin && !isProjectFiltered && (
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
          <Card className="border-dashed border-2 border-border">
            <CardContent className="py-16">
              <div className="text-center">
                <div className="rounded-full bg-muted w-14 h-14 flex items-center justify-center mx-auto mb-4">
                  <DollarSign className="h-7 w-7 text-slate-500" />
                </div>
                <p className="text-lg font-semibold text-foreground" data-testid="text-empty-state">No cashflow data available</p>
                <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
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

            <Card className="border border-border shadow-sm rounded-xl overflow-hidden" data-testid="card-trend-chart">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold text-foreground">Cashflow Trend</CardTitle>
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

            <Card className="border border-border shadow-sm rounded-xl overflow-hidden" data-testid="card-weekly-grid">
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[70vh]">
                  <table className="w-full border-collapse text-sm" data-testid="table-cashflow">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-muted/80 border-b-2 border-border">
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider sticky left-0 bg-muted/80 z-30 min-w-[100px]">
                          Week
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[130px] bg-muted/80">
                          Opening Bal
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[130px] bg-muted/80">
                          Proj Inflows
                        </th>
                        {!isProjectFiltered && (
                          <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[120px] bg-muted/80">
                            OPEX
                          </th>
                        )}
                        <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[130px] bg-muted/80">
                          Proj Outflows
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[130px] bg-muted/80">
                          Total Out
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[130px] bg-muted/80">
                          Closing Bal
                        </th>
                        <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[150px] bg-muted/80">
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
                                  ? "bg-blue-50/70 border-l-[3px] border-l-blue-500"
                                  : isEven
                                  ? "bg-card"
                                  : "bg-muted/30"
                              } ${showDetail ? "cursor-pointer hover:bg-blue-50/40" : "hover:bg-muted/60"}`}
                              onClick={() => handleRowClick(week.weekStart)}
                              data-testid={`row-week-${week.weekStart}`}
                            >
                              <td
                                className={`px-4 py-3 font-medium text-foreground sticky left-0 z-10 ${
                                  current ? "bg-blue-50/70" : isEven ? "bg-card" : "bg-muted/30"
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  {showDetail && (
                                    isExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
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
                                  {isAdmin && editingBalance === week.weekStart ? (
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
                                        className={isAdmin ? "cursor-pointer hover:underline hover:text-blue-700 decoration-dashed underline-offset-2 transition-colors" : ""}
                                        onClick={(e) => {
                                          if (!isAdmin) return;
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
                                          {isAdmin && (
                                            <button
                                              className="p-0.5 rounded hover:bg-red-100 text-red-600 hover:text-red-600 transition-colors"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                clearOverrideMutation.mutate(week.weekStart);
                                              }}
                                              title="Clear manual override — use cascaded value"
                                              data-testid={`button-clear-override-${week.weekStart}`}
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          )}
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
                              {!isProjectFiltered && (
                              <td
                                className="px-4 py-3 text-right font-mono text-[13px] text-red-500"
                                data-testid={`text-opex-${week.weekStart}`}
                              >
                                <div className="flex items-center justify-end gap-1.5">
                                  {isAdmin && editingOpex === week.weekStart ? (
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
                                        className={isAdmin ? "cursor-pointer hover:underline hover:text-red-700 decoration-dashed underline-offset-2 transition-colors" : ""}
                                        onClick={(e) => {
                                          if (!isAdmin) return;
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
                                            title={`Manual override. Costed split: ${formatRand(week.computedOpex)}`}
                                          >
                                            <ArrowRight className="h-3 w-3" />
                                          </span>
                                          {isAdmin && (
                                            <button
                                              className="p-0.5 rounded hover:bg-red-100 text-red-600 hover:text-red-600 transition-colors"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                clearOpexMutation.mutate(week.weekStart);
                                              }}
                                              title="Clear OPEX override — use monthly costed split"
                                              data-testid={`button-clear-opex-${week.weekStart}`}
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                              )}
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
                              <td
                                className="px-4 py-3 text-right font-mono text-[13px]"
                                data-testid={`text-available-${week.weekStart}`}
                              >
                                <div className="flex items-center justify-end gap-1.5">
                                  <span
                                    className={`font-semibold ${
                                      (week.availablePayment || 0) >= 0 ? "text-blue-700" : "text-red-700"
                                    } ${isAdmin ? "cursor-pointer hover:underline decoration-dashed underline-offset-2 transition-colors" : ""}`}
                                    onClick={(e) => {
                                      if (!isAdmin) return;
                                      e.stopPropagation();
                                      setAvailPayEdit({ weekStart: week.weekStart, computedValue: week.computedAvailablePayment || 0 });
                                      setAvailPayValue(week.availablePayment?.toString() || "0");
                                      setAvailPayReason("");
                                    }}
                                    data-testid={`text-available-value-${week.weekStart}`}
                                  >
                                    {formatRand(week.availablePayment)}
                                  </span>
                                  {week.hasAvailPayOverride && (
                                    <>
                                      <span
                                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 cursor-pointer"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAvailPayHistoryWeek(week.weekStart);
                                        }}
                                        title={`Manual override. Computed: ${formatRand(week.computedAvailablePayment)}${week.availPayReason ? `. Reason: ${week.availPayReason}` : ""}`}
                                        data-testid={`badge-avail-override-${week.weekStart}`}
                                      >
                                        <ArrowRight className="h-3 w-3" />
                                      </span>
                                      {isAdmin && (
                                        <button
                                          className="p-0.5 rounded hover:bg-red-100 text-red-600 hover:text-red-600 transition-colors"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            clearAvailPayMutation.mutate(week.weekStart);
                                          }}
                                          title="Clear override — use computed value"
                                          data-testid={`button-clear-avail-${week.weekStart}`}
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {showDetail && isExpanded && (
                              <DetailRow
                                weekStart={week.weekStart}
                                project={selectedProjects.length > 0 ? selectedProjects.join(",") : "all"}
                                colSpan={isProjectFiltered ? 7 : 8}
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

      <Dialog open={!!availPayEdit} onOpenChange={(v) => { if (!v) { setAvailPayEdit(null); setAvailPayValue(""); setAvailPayReason(""); } }}>
        <DialogContent className="max-w-md" data-testid="dialog-avail-payment-edit">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Edit Available Payment — {availPayEdit ? formatWeek(availPayEdit.weekStart) : ""}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Computed value: {formatRand(availPayEdit?.computedValue || 0)} (Opening + Inflows - All Outflows)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground">Override Value (R)</label>
              <Input
                type="number"
                value={availPayValue}
                onChange={(e) => setAvailPayValue(e.target.value)}
                className="mt-1 font-mono"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleAvailPaySave(); }}
                data-testid="input-avail-payment-value"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Reason for Override *</label>
              <Input
                value={availPayReason}
                onChange={(e) => setAvailPayReason(e.target.value)}
                placeholder="e.g. Adjusting for expected delayed payment"
                className="mt-1"
                onKeyDown={(e) => { if (e.key === "Enter") handleAvailPaySave(); }}
                data-testid="input-avail-payment-reason"
              />
              <p className="text-[11px] text-muted-foreground mt-1">A reason is required for all manual overrides</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAvailPayEdit(null); setAvailPayValue(""); setAvailPayReason(""); }} data-testid="button-avail-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleAvailPaySave}
              disabled={availPayMutation.isPending || !availPayReason.trim()}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-avail-save"
            >
              {availPayMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Save Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}

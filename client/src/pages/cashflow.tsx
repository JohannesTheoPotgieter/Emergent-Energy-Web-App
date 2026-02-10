import { useState, useMemo, useCallback } from "react";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Eye, EyeOff, ChevronDown, ChevronRight, DollarSign } from "lucide-react";
import { format, parseISO } from "date-fns";

interface CashflowWeek {
  weekStart: string;
  weekEnd: string;
  openingBalance: number;
  projectInflows: number;
  opexOutflows: number;
  projectOutflows: number;
  closingBalance: number;
  availablePayment: number;
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

function DetailRow({ weekStart, project }: { weekStart: string; project: string }) {
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
        <td colSpan={8} className="p-4">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" data-testid="spinner-detail" />
            Loading detail...
          </div>
        </td>
      </tr>
    );
  }

  if (!data) return null;

  return (
    <tr>
      <td colSpan={8} className="p-0">
        <div className="bg-slate-50 border-y border-slate-200 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-semibold text-green-700 mb-2">Inflows</h4>
              {data.inflows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No inflows this week</p>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-300">
                      <th className="text-left p-1">Project</th>
                      <th className="text-left p-1">Milestone</th>
                      <th className="text-left p-1">Invoice #</th>
                      <th className="text-left p-1">Date</th>
                      <th className="text-right p-1">Amount</th>
                      <th className="text-right p-1">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inflows.map((inf, i) => (
                      <tr key={i} className="border-b border-slate-200">
                        <td className="p-1">{inf.projectName}</td>
                        <td className="p-1">{inf.milestoneName}</td>
                        <td className="p-1">{inf.milestoneInvoiceNumber}</td>
                        <td className="p-1">{inf.paymentReceivedDate ? format(parseISO(inf.paymentReceivedDate), "dd MMM") : "—"}</td>
                        <td className="p-1 text-right font-mono text-green-700">{formatRand(inf.milestoneAmount)}</td>
                        <td className="p-1 text-right">{inf.daysToReceipt ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-red-700 mb-2">Outflows</h4>
              {data.outflows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No outflows this week</p>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-300">
                      <th className="text-left p-1">Project</th>
                      <th className="text-left p-1">Category</th>
                      <th className="text-left p-1">Line Item</th>
                      <th className="text-left p-1">Invoice #</th>
                      <th className="text-left p-1">Date</th>
                      <th className="text-right p-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.outflows.map((out, i) => (
                      <tr key={i} className="border-b border-slate-200">
                        <td className="p-1">{out.projectName}</td>
                        <td className="p-1">{out.expenseCategory}</td>
                        <td className="p-1">{out.expenseLineItem}</td>
                        <td className="p-1">{out.expenseInvoiceNumber}</td>
                        <td className="p-1">{out.expensePaymentDate ? format(parseISO(out.expensePaymentDate), "dd MMM") : "—"}</td>
                        <td className="p-1 text-right font-mono text-red-700">{formatRand(out.expenseActualTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-opex-budget">
        <DialogHeader>
          <DialogTitle>OPEX Monthly Budget (FY26)</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {FY26_MONTHS.map((m) => {
              const currentVal = editedValues[m.key] ?? (opexMap[m.key]?.toString() || "0");
              return (
                <div key={m.key} className="flex items-center gap-3">
                  <span className="text-sm w-24 flex-shrink-0">{m.label}</span>
                  <Input
                    type="number"
                    value={currentVal}
                    onChange={(e) =>
                      setEditedValues((prev) => ({ ...prev, [m.key]: e.target.value }))
                    }
                    className="text-right font-mono"
                    data-testid={`input-opex-${m.key}`}
                  />
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-opex-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-opex-save"
          >
            {saveMutation.isPending ? "Saving..." : "Save Budget"}
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
    mutationFn: async (body: { weekStartDate: string; openingBalance: number }) => {
      await apiRequest("POST", "/api/cashflow-2026/opening-balance", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow-2026"] });
      setEditingBalance(null);
      toast({ title: "Opening Balance Saved" });
    },
    onError: () => {
      toast({ title: "Save Failed", variant: "destructive" });
    },
  });

  const handleBalanceSave = useCallback(
    (weekStart: string) => {
      const val = parseFloat(editingValue);
      if (!Number.isFinite(val)) return;
      balanceMutation.mutate({ weekStartDate: weekStart, openingBalance: val });
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

  return (
    <div className="space-y-0">
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">
              Cashflow 2026 (FY26)
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              Weekly cashflow timeline — Sep 2025 to Aug 2026
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="border rounded-md px-3 py-2 text-sm bg-white"
              data-testid="select-project-filter"
            >
              <option value="all">All Projects</option>
              {projectNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <Button
              variant={showDetail ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setShowDetail((v) => !v);
                if (showDetail) setExpandedWeek(null);
              }}
              data-testid="button-toggle-detail"
            >
              {showDetail ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
              {showDetail ? "Hide Detail" : "Show Detail"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpexOpen(true)}
              data-testid="button-opex-budget"
            >
              <DollarSign className="h-4 w-4 mr-1" />
              OPEX Budget
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading cashflow data...
          </div>
        ) : cashflowData.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <p className="text-lg font-medium">No cashflow data available</p>
                <p className="text-sm mt-2">Upload tracker files to see cashflow data here</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-none shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm" data-testid="table-cashflow">
                    <thead>
                      <tr className="bg-slate-100 border-b-2 border-slate-300">
                        <th className="text-left p-3 font-semibold sticky left-0 bg-slate-100 z-10 min-w-[90px]">
                          Week
                        </th>
                        <th className="text-right p-3 font-semibold min-w-[130px]">Opening Balance</th>
                        <th className="text-right p-3 font-semibold min-w-[130px]">Project Inflows</th>
                        <th className="text-right p-3 font-semibold min-w-[140px]">Available Payment</th>
                        <th className="text-right p-3 font-semibold min-w-[130px]">OPEX Outflows</th>
                        <th className="text-right p-3 font-semibold min-w-[130px]">Project Outflows</th>
                        <th className="text-right p-3 font-semibold min-w-[130px]">Total Outflows</th>
                        <th className="text-right p-3 font-semibold min-w-[130px]">Closing Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashflowData.map((week, idx) => {
                        const totalOutflows = (week.opexOutflows || 0) + (week.projectOutflows || 0);
                        const current = isCurrentWeek(week.weekStart, week.weekEnd);
                        const isExpanded = expandedWeek === week.weekStart;
                        const isEven = idx % 2 === 0;

                        return (
                          <>
                            <tr
                              key={week.weekStart}
                              className={`border-b border-slate-200 transition-colors ${
                                current
                                  ? "bg-blue-50 border-l-4 border-l-blue-500"
                                  : isEven
                                  ? "bg-white"
                                  : "bg-slate-50/50"
                              } ${showDetail ? "cursor-pointer hover:bg-slate-100" : ""}`}
                              onClick={() => handleRowClick(week.weekStart)}
                              data-testid={`row-week-${week.weekStart}`}
                            >
                              <td className={`p-3 font-medium sticky left-0 z-10 ${current ? "bg-blue-50" : isEven ? "bg-white" : "bg-slate-50/50"}`}>
                                <div className="flex items-center gap-1">
                                  {showDetail && (
                                    isExpanded ? (
                                      <ChevronDown className="h-3 w-3 flex-shrink-0" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3 flex-shrink-0" />
                                    )
                                  )}
                                  {formatWeek(week.weekStart)}
                                </div>
                              </td>
                              <td className="p-3 text-right font-mono text-blue-600">
                                {editingBalance === week.weekStart ? (
                                  <input
                                    type="number"
                                    className="w-28 text-right p-1 border rounded text-sm font-mono"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onBlur={() => handleBalanceSave(week.weekStart)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleBalanceSave(week.weekStart);
                                      if (e.key === "Escape") setEditingBalance(null);
                                    }}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    data-testid={`input-opening-balance-${week.weekStart}`}
                                  />
                                ) : (
                                  <span
                                    className="cursor-pointer hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingBalance(week.weekStart);
                                      setEditingValue(week.openingBalance?.toString() || "0");
                                    }}
                                    data-testid={`text-opening-balance-${week.weekStart}`}
                                  >
                                    {formatRand(week.openingBalance)}
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-right font-mono text-green-600" data-testid={`text-inflows-${week.weekStart}`}>
                                {formatRand(week.projectInflows)}
                              </td>
                              <td className="p-3 text-right font-mono font-bold" data-testid={`text-available-${week.weekStart}`}>
                                {formatRand(week.availablePayment)}
                              </td>
                              <td className="p-3 text-right font-mono text-red-600" data-testid={`text-opex-${week.weekStart}`}>
                                {formatRand(week.opexOutflows)}
                              </td>
                              <td className="p-3 text-right font-mono text-red-600" data-testid={`text-proj-outflows-${week.weekStart}`}>
                                {formatRand(week.projectOutflows)}
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-red-700" data-testid={`text-total-outflows-${week.weekStart}`}>
                                {formatRand(totalOutflows)}
                              </td>
                              <td
                                className={`p-3 text-right font-mono font-bold ${
                                  (week.closingBalance || 0) >= 0 ? "text-green-700" : "text-red-700"
                                }`}
                                data-testid={`text-closing-balance-${week.weekStart}`}
                              >
                                {formatRand(week.closingBalance)}
                              </td>
                            </tr>
                            {showDetail && isExpanded && (
                              <DetailRow
                                key={`detail-${week.weekStart}`}
                                weekStart={week.weekStart}
                                project={selectedProject}
                              />
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Cashflow Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 60, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="week"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => {
                          const abs = Math.abs(val);
                          if (abs >= 1_000_000) return `R${(val / 1_000_000).toFixed(1)}M`;
                          if (abs >= 1_000) return `R${(val / 1_000).toFixed(0)}K`;
                          return `R${val}`;
                        }}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [formatRand(value), name]}
                        contentStyle={{
                          borderRadius: "8px",
                          border: "none",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                        }}
                      />
                      <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="line" />
                      <Line
                        type="monotone"
                        dataKey="Opening Balance"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="Project Inflows"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="Total Outflows"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="Closing Balance"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <OpexBudgetModal open={opexOpen} onClose={() => setOpexOpen(false)} />
    </div>
  );
}

import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Line,
} from "recharts";
import {
  DollarSign,
  TrendingDown,
  Target,
  Activity,
  ChevronDown,
  ChevronRight,
  X,
  Search,
  Info,
} from "lucide-react";

interface ProjectBreakdown {
  projectName: string;
  value: number;
}

interface MonthData {
  monthKey: string;
  monthLabel: string;
  planned: number;
  realised: number;
  outstanding: number;
  budget: number;
  variance: number;
  variancePct: number;
  ytdPlanned: number;
  ytdRealised: number;
  ytdOutstanding: number;
  ytdBudget: number;
  ytdVariance: number;
  ytdVariancePct: number;
  plannedProjects: ProjectBreakdown[];
  realisedProjects: ProjectBreakdown[];
  outstandingProjects: ProjectBreakdown[];
}

interface MonthDetailItem {
  id: number;
  projectName: string;
  category: string | null;
  lineItem: string | null;
  invoiceNumber: string | null;
  poNumber: string | null;
  invoicedDate: string | null;
  paymentDate: string | null;
  amount: number;
  state: string;
  supplierName: string | null;
  trackerLocator: string;
}

interface MonthDetail {
  monthKey: string;
  state: string;
  lineCount: number;
  totalAmount: number;
  items: MonthDetailItem[];
}

function formatRand(val: number | null | undefined): string {
  if (val == null) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

type EditableField = "realised" | "outstanding" | "budget";

interface EditingCell {
  field: EditableField;
  monthKey: string;
  value: string;
}

const stateBadgeColors: Record<string, string> = {
  Planned: "bg-blue-100 text-blue-700",
  Realised: "bg-green-100 text-green-700",
};

const ROW_DEFS: {
  key: string;
  label: string;
  dataKey: keyof MonthData;
  editable: boolean;
  colorClass: string;
  group: "monthly" | "ytd";
  colorCoded?: boolean;
  expandable?: boolean;
  projectsKey?: "plannedProjects" | "realisedProjects" | "outstandingProjects";
}[] = [
  { key: "planned", label: "Planned", dataKey: "planned", editable: false, colorClass: "text-blue-600", group: "monthly", expandable: true, projectsKey: "plannedProjects" as const },
  { key: "realised", label: "Realised", dataKey: "realised", editable: false, colorClass: "text-green-600", group: "monthly", expandable: true, projectsKey: "realisedProjects" as const },
  { key: "outstanding", label: "Outstanding", dataKey: "outstanding", editable: false, colorClass: "text-amber-600", group: "monthly", expandable: true, projectsKey: "outstandingProjects" as const },
  { key: "budget", label: "Budget", dataKey: "budget", editable: true, colorClass: "text-purple-600", group: "monthly" },
  { key: "variance", label: "Variance", dataKey: "variance", editable: false, colorClass: "", group: "monthly", colorCoded: true },
  { key: "variancePct", label: "Variance %", dataKey: "variancePct", editable: false, colorClass: "", group: "monthly", colorCoded: true },
  { key: "ytdPlanned", label: "YTD Planned", dataKey: "ytdPlanned", editable: false, colorClass: "text-blue-600", group: "ytd" },
  { key: "ytdRealised", label: "YTD Realised", dataKey: "ytdRealised", editable: false, colorClass: "text-green-600", group: "ytd" },
  { key: "ytdOutstanding", label: "YTD Outstanding", dataKey: "ytdOutstanding", editable: false, colorClass: "text-amber-600", group: "ytd" },
  { key: "ytdBudget", label: "YTD Budget", dataKey: "ytdBudget", editable: false, colorClass: "text-purple-600", group: "ytd" },
  { key: "ytdVariance", label: "YTD Variance", dataKey: "ytdVariance", editable: false, colorClass: "", group: "ytd", colorCoded: true },
  { key: "ytdVariancePct", label: "YTD Variance %", dataKey: "ytdVariancePct", editable: false, colorClass: "", group: "ytd", colorCoded: true },
];

function MonthDetailDrawer({ monthKey, monthLabel, onClose }: { monthKey: string; monthLabel: string; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<MonthDetail>({
    queryKey: [`/api/cos-tracker/month-detail?monthKey=${monthKey}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    let items = data.items;
    if (stateFilter !== "all") {
      items = items.filter(i => i.state === stateFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        i.projectName.toLowerCase().includes(q) ||
        (i.invoiceNumber || "").toLowerCase().includes(q) ||
        (i.poNumber || "").toLowerCase().includes(q) ||
        (i.lineItem || "").toLowerCase().includes(q) ||
        i.trackerLocator.toLowerCase().includes(q)
      );
    }
    return items;
  }, [data, search, stateFilter]);

  const filteredTotal = useMemo(() => filtered.reduce((s, i) => s + i.amount, 0), [filtered]);

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="drawer-month-detail">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="ml-auto relative w-full max-w-3xl bg-background border-l shadow-2xl flex flex-col h-full">
        <div className="p-4 border-b flex items-center justify-between bg-muted/50">
          <div>
            <h3 className="font-bold text-lg">{monthLabel} Line Items</h3>
            <p className="text-sm text-muted-foreground">
              {data?.lineCount ?? 0} lines totalling {formatRand(data?.totalAmount ?? 0)}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded" data-testid="button-close-drawer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-3 border-b flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoice #, PO #, project, tracker locator..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
              data-testid="input-search-detail"
            />
          </div>
          {["all", "Planned", "Realised"].map((s) => (
            <Button
              key={s}
              variant={stateFilter === s ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setStateFilter(s)}
            >
              {s === "all" ? "All" : s}
            </Button>
          ))}
        </div>

        <div className="p-3 border-b bg-muted/30 flex items-center justify-between text-sm">
          <span className="font-medium">Showing {filtered.length} items</span>
          <span className="font-mono font-bold">{formatRand(filteredTotal)}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading line items...</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="border-b">
                  <th className="text-left p-2 font-semibold">Project</th>
                  <th className="text-left p-2 font-semibold">Category</th>
                  <th className="text-left p-2 font-semibold">Line Item</th>
                  <th className="text-left p-2 font-semibold">Invoice #</th>
                  <th className="text-left p-2 font-semibold">PO #</th>
                  <th className="text-left p-2 font-semibold">State</th>
                  <th className="text-left p-2 font-semibold">Inv Date</th>
                  <th className="text-left p-2 font-semibold">Pay Date</th>
                  <th className="text-right p-2 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((item, i) => (
                  <tr key={item.id} className="border-b hover:bg-muted/30" data-testid={`row-detail-${i}`}>
                    <td className="p-2 max-w-[120px] truncate" title={item.projectName}>{item.projectName}</td>
                    <td className="p-2 text-muted-foreground">{item.category || "--"}</td>
                    <td className="p-2 max-w-[120px] truncate" title={item.lineItem || ""}>{item.lineItem || "--"}</td>
                    <td className="p-2 font-mono">{item.invoiceNumber || "--"}</td>
                    <td className="p-2 font-mono">{item.poNumber || "--"}</td>
                    <td className="p-2">
                      <Badge className={`${stateBadgeColors[item.state] || ""} text-[10px]`} variant="outline">{item.state}</Badge>
                    </td>
                    <td className="p-2 text-muted-foreground">{item.invoicedDate || "--"}</td>
                    <td className="p-2 text-muted-foreground">{item.paymentDate || "--"}</td>
                    <td className="p-2 text-right font-mono font-medium">{formatRand(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CosTracker() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [reconciliationMode, setReconciliationMode] = useState(false);
  const [drawerMonth, setDrawerMonth] = useState<{ monthKey: string; monthLabel: string } | null>(null);

  const { data: months = [], isLoading } = useQuery<MonthData[]>({
    queryKey: ["/api/cos-tracker"],
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async (body: { trackerType: string; monthKey: string; realised?: string; outstanding?: string; budget?: string }) => {
      await apiRequest("POST", "/api/tracker-monthly", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cos-tracker"] });
    },
  });

  const lastMonth = useMemo(() => {
    if (!months.length) return null;
    return months[months.length - 1];
  }, [months]);

  const projectNamesByRow = useMemo(() => {
    const result: Record<string, string[]> = {};
    const keys = ["plannedProjects", "realisedProjects", "outstandingProjects"] as const;
    for (const k of keys) {
      const names = new Set<string>();
      for (const m of months) {
        for (const p of m[k] || []) {
          names.add(p.projectName);
        }
      }
      result[k] = Array.from(names).sort();
    }
    return result;
  }, [months]);

  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const startEdit = useCallback((field: EditableField, monthKey: string, currentValue: number) => {
    setEditing({ field, monthKey, value: String(currentValue) });
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const payload: Record<string, string> = {
      trackerType: "COS",
      monthKey: editing.monthKey,
    };
    payload[editing.field] = editing.value;
    mutation.mutate(payload as any);
    setEditing(null);
  }, [editing, mutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitEdit();
      if (e.key === "Escape") setEditing(null);
    },
    [commitEdit],
  );

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        month: m.monthLabel,
        Planned: m.planned,
        Realised: m.realised,
        Budget: m.budget,
        "YTD Variance": m.ytdVariance,
      })),
    [months],
  );

  const getCellColor = (val: number) => (val > 0 ? "text-red-600" : "text-green-600");

  const formatCell = (row: (typeof ROW_DEFS)[number], val: number) => {
    if (row.key === "variancePct" || row.key === "ytdVariancePct") {
      return `${(val * 100).toFixed(1)}%`;
    }
    return formatRand(val);
  };

  const reconciliation = useMemo(() => {
    if (!months.length) return null;
    let totalPlanned = 0, totalRealised = 0, totalOutstanding = 0;
    for (const m of months) {
      totalPlanned += m.planned;
      totalRealised += m.realised;
      totalOutstanding += m.outstanding;
    }
    return { totalPlanned, totalRealised, totalOutstanding, monthCount: months.length };
  }, [months]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground" data-testid="loading-indicator">
        Loading COS data...
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">
              Cost of Sales Tracker FY26
            </h2>
            <p className="text-muted-foreground mt-1" data-testid="text-page-subtitle">
              Monthly COS tracking with planned vs budget analysis. Click any month cell to see contributing line items.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Reconciliation</span>
            <Switch
              checked={reconciliationMode}
              onCheckedChange={setReconciliationMode}
              data-testid="toggle-reconciliation"
            />
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {reconciliationMode && reconciliation && (
          <Card className="border-blue-200 bg-blue-50/50" data-testid="card-reconciliation">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Info className="h-4 w-4 text-blue-600" />
                <span className="font-semibold text-sm text-blue-800">Reconciliation Mode</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Months Counted</p>
                  <p className="font-mono font-bold">{reconciliation.monthCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total Planned (YTD)</p>
                  <p className="font-mono font-bold text-blue-700">{formatRand(reconciliation.totalPlanned)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total Realised (YTD)</p>
                  <p className="font-mono font-bold text-green-700">{formatRand(reconciliation.totalRealised)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total Outstanding (YTD)</p>
                  <p className="font-mono font-bold text-amber-700">{formatRand(reconciliation.totalOutstanding)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                COS Recognition: Planned = Invoice Number + Invoice Date in month | Realised = Planned items that have been paid.
                Click any month value to drill down to exact contributing line items.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-ytd-planned">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-100 p-2">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">YTD COS (Planned)</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-ytd-planned-value">
                    {formatRand(lastMonth?.ytdPlanned ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-ytd-realised">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-100 p-2">
                  <TrendingDown className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">YTD COS (Realised)</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-ytd-realised-value">
                    {formatRand(lastMonth?.ytdRealised ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-ytd-budget">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-100 p-2">
                  <Target className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">YTD Budget</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-ytd-budget-value">
                    {formatRand(lastMonth?.ytdBudget ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-ytd-variance">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${(lastMonth?.ytdVariance ?? 0) <= 0 ? "bg-green-100" : "bg-red-100"}`}>
                  <Activity className={`h-5 w-5 ${(lastMonth?.ytdVariance ?? 0) <= 0 ? "text-green-600" : "text-red-600"}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">YTD Variance</p>
                  <p
                    className={`text-2xl font-bold font-mono ${(lastMonth?.ytdVariance ?? 0) <= 0 ? "text-green-600" : "text-red-600"}`}
                    data-testid="text-ytd-variance-value"
                  >
                    {formatRand(lastMonth?.ytdVariance ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Monthly COS Grid</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-cos-grid">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left font-semibold min-w-[200px]">
                      Metric
                    </th>
                    {months.map((m) => (
                      <th key={m.monthKey} className="px-4 py-3 text-right font-semibold whitespace-nowrap min-w-[110px]">
                        {m.monthLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROW_DEFS.map((row) => {
                    const isYtd = row.group === "ytd";
                    const isExpanded = expandedRows.has(row.key);
                    const isClickable = ["planned", "realised", "outstanding"].includes(row.key);
                    return (
                      <React.Fragment key={row.key}>
                        <tr
                          className={`border-b ${isYtd ? "bg-slate-50" : "bg-white"} hover:bg-muted/30`}
                          data-testid={`row-${row.key}`}
                        >
                          <td className={`sticky left-0 z-10 px-4 py-2 font-medium ${isYtd ? "bg-slate-50" : "bg-white"}`}>
                            {row.expandable ? (
                              <button
                                type="button"
                                className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                                onClick={() => toggleRow(row.key)}
                                data-testid={`toggle-${row.key}`}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                                {row.label}
                              </button>
                            ) : (
                              row.label
                            )}
                          </td>
                          {months.map((m) => {
                            const val = m[row.dataKey] as number;
                            const isEditingCell =
                              editing?.field === row.key && editing?.monthKey === m.monthKey;

                            if (row.editable) {
                              return (
                                <td key={m.monthKey} className="px-2 py-1 text-right">
                                  {isEditingCell ? (
                                    <Input
                                      type="number"
                                      className="h-8 w-full text-right font-mono text-sm"
                                      value={editing.value}
                                      onChange={(e) =>
                                        setEditing({ ...editing, value: e.target.value })
                                      }
                                      onBlur={commitEdit}
                                      onKeyDown={handleKeyDown}
                                      autoFocus
                                      data-testid={`input-${row.key}-${m.monthKey}`}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      className={`w-full text-right font-mono cursor-pointer hover:bg-muted rounded px-2 py-1 ${row.colorClass}`}
                                      onClick={() =>
                                        startEdit(row.key as EditableField, m.monthKey, val)
                                      }
                                      data-testid={`cell-${row.key}-${m.monthKey}`}
                                    >
                                      {formatRand(val)}
                                    </button>
                                  )}
                                </td>
                              );
                            }

                            const colorClass = row.colorCoded
                              ? getCellColor(val)
                              : row.colorClass;

                            return (
                              <td
                                key={m.monthKey}
                                className={`px-4 py-2 text-right font-mono ${colorClass} ${isClickable ? "cursor-pointer hover:bg-blue-50 hover:underline" : ""}`}
                                onClick={isClickable ? () => setDrawerMonth({ monthKey: m.monthKey, monthLabel: m.monthLabel }) : undefined}
                                data-testid={`cell-${row.key}-${m.monthKey}`}
                              >
                                {formatCell(row, val)}
                              </td>
                            );
                          })}
                        </tr>
                        {row.expandable && isExpanded && row.projectsKey && (projectNamesByRow[row.projectsKey] || []).map((pName) => (
                          <tr
                            key={`${row.key}-${pName}`}
                            className="border-b bg-blue-50/30 hover:bg-blue-50/60"
                            data-testid={`row-detail-${row.key}-${pName}`}
                          >
                            <td className="sticky left-0 z-10 bg-blue-50/30 pl-10 pr-4 py-1.5 text-xs text-muted-foreground truncate max-w-[200px]" title={pName}>
                              {pName}
                            </td>
                            {months.map((m) => {
                              const projArr = row.projectsKey ? m[row.projectsKey] : [];
                              const proj = projArr?.find((p: ProjectBreakdown) => p.projectName === pName);
                              const val = proj?.value ?? 0;
                              return (
                                <td
                                  key={m.monthKey}
                                  className="px-4 py-1.5 text-right font-mono text-xs text-blue-600/80"
                                  data-testid={`cell-detail-${row.key}-${pName}-${m.monthKey}`}
                                >
                                  {val !== 0 ? formatRand(val) : ""}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>COS Overview Chart</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[400px]" data-testid="chart-cos">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis
                    tickFormatter={(v: number) => formatRand(v)}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(value: number) => formatRand(value)}
                  />
                  <Legend />
                  <Bar dataKey="Planned" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Realised" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Budget" fill="#a855f7" radius={[4, 4, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="YTD Variance"
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {drawerMonth && (
        <MonthDetailDrawer
          monthKey={drawerMonth.monthKey}
          monthLabel={drawerMonth.monthLabel}
          onClose={() => setDrawerMonth(null)}
        />
      )}
    </div>
  );
}

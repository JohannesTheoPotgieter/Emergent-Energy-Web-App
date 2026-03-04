import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Line, ComposedChart,
} from "recharts";
import {
  DollarSign, FileText, Search, ArrowUpDown, Calendar, Edit2,
  ChevronDown, ChevronRight, ArrowRight, X, TrendingUp,
} from "lucide-react";
import ScenarioSelector from "@/components/ScenarioSelector";

function formatRand(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

function formatRandExact(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R 0.00";
  return `R ${val.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface TrackerMonth {
  month: string;
  planned: number;
  realised: number;
  outstanding: number;
  budget: number;
}

interface TrackerData {
  months: TrackerMonth[];
  totals: { planned: number; realised: number; outstanding: number; budget: number };
  lineCount: number;
}

function getFinancialYear(monthStr: string): string {
  const [year, month] = monthStr.split('-').map(Number);
  if (month >= 3) return `FY${year}/${year + 1}`;
  return `FY${year - 1}/${year}`;
}

function getMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-').map(Number);
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[month]} ${year}`;
}

function TrackerView({ data }: { data: TrackerData | undefined }) {
  const [viewMode, setViewMode] = useState<'monthly' | 'fy'>('fy');
  const [selectedFY, setSelectedFY] = useState<string>('');

  const fyData = useMemo(() => {
    if (!data?.months) return [];
    const fyMap = new Map<string, { planned: number; realised: number; outstanding: number; budget: number }>();
    for (const m of data.months) {
      const fy = getFinancialYear(m.month);
      if (!fyMap.has(fy)) fyMap.set(fy, { planned: 0, realised: 0, outstanding: 0, budget: 0 });
      const bucket = fyMap.get(fy)!;
      bucket.planned += m.planned;
      bucket.realised += m.realised;
      bucket.outstanding += m.outstanding;
      bucket.budget += m.budget;
    }
    return Array.from(fyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fy, vals]) => ({ label: fy, ...vals }));
  }, [data]);

  const availableFYs = useMemo(() => {
    return ['All', ...fyData.map(f => f.label)];
  }, [fyData]);

  useEffect(() => {
    if (selectedFY === '' && fyData.length > 0) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const currentFY = month >= 3 ? `FY${year}/${year + 1}` : `FY${year - 1}/${year}`;
      const match = fyData.find(f => f.label === currentFY);
      setSelectedFY(match ? currentFY : fyData[fyData.length - 1].label);
    }
  }, [fyData, selectedFY]);

  const filteredMonths = useMemo(() => {
    if (!data?.months || selectedFY === 'All') return data?.months || [];
    return data.months.filter(m => getFinancialYear(m.month) === selectedFY);
  }, [data, selectedFY]);

  const displayTotals = useMemo(() => {
    if (selectedFY === 'All') return data?.totals || { planned: 0, realised: 0, outstanding: 0, budget: 0 };
    const fyEntry = fyData.find(f => f.label === selectedFY);
    if (fyEntry) return { planned: fyEntry.planned, realised: fyEntry.realised, outstanding: fyEntry.outstanding, budget: fyEntry.budget };
    return { planned: 0, realised: 0, outstanding: 0, budget: 0 };
  }, [data, fyData, selectedFY]);

  const chartData = useMemo(() => {
    if (viewMode === 'fy') return fyData;
    return filteredMonths.map(m => ({
      label: getMonthLabel(m.month),
      ...m,
    }));
  }, [filteredMonths, fyData, viewMode]);

  if (!data) return <div className="text-sm text-muted-foreground p-4">Loading...</div>;

  const displayData = viewMode === 'fy' ? fyData : filteredMonths.map(m => ({ label: getMonthLabel(m.month), ...m }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-muted-foreground">Financial Year:</span>
        <select
          value={selectedFY}
          onChange={(e) => setSelectedFY(e.target.value)}
          className="text-sm border rounded px-2 py-1 bg-card"
          data-testid="select-fy-filter"
        >
          {availableFYs.map(fy => (
            <option key={fy} value={fy}>{fy}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Planned COS {selectedFY !== 'All' ? `(${selectedFY})` : ''}</p>
            <p className="text-lg font-bold text-foreground" data-testid="text-total-planned">{formatRand(displayTotals.planned)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Realised COS {selectedFY !== 'All' ? `(${selectedFY})` : ''}</p>
            <p className="text-lg font-bold text-green-600" data-testid="text-total-realised">{formatRand(displayTotals.realised)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Outstanding COS {selectedFY !== 'All' ? `(${selectedFY})` : ''}</p>
            <p className="text-lg font-bold text-amber-600" data-testid="text-total-outstanding">{formatRand(displayTotals.outstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Costed COS {selectedFY !== 'All' ? `(${selectedFY})` : ''}</p>
            <p className="text-lg font-bold text-blue-600" data-testid="text-total-budget">{formatRand(displayTotals.budget)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">COS Tracker</CardTitle>
            <div className="flex gap-1">
              <Button size="sm" variant={viewMode === 'fy' ? 'default' : 'ghost'} onClick={() => setViewMode('fy')} data-testid="button-view-fy">
                By FY
              </Button>
              <Button size="sm" variant={viewMode === 'monthly' ? 'default' : 'ghost'} onClick={() => setViewMode('monthly')} data-testid="button-view-monthly">
                Monthly
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={viewMode === 'monthly' ? -45 : 0} textAnchor={viewMode === 'monthly' ? 'end' : 'middle'} height={viewMode === 'monthly' ? 60 : 30} />
              <YAxis tickFormatter={(v: number) => formatRand(v)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => formatRandExact(v)} />
              <Legend />
              <Bar dataKey="realised" fill="#22c55e" name="Realised COS" />
              <Bar dataKey="outstanding" fill="#f59e0b" name="Outstanding COS" />
              <Line type="monotone" dataKey="budget" stroke="#3b82f6" strokeWidth={2} name="Costed COS" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">COS Tracker Table</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-semibold sticky left-0 bg-muted/50">COS Tracker</th>
                  {displayData.map(d => (
                    <th key={d.label} className="p-2 text-right font-medium whitespace-nowrap text-xs">{d.label}</th>
                  ))}
                  <th className="p-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-muted/30">
                  <td className="p-2 font-medium text-foreground sticky left-0 bg-card">Planned COS</td>
                  {displayData.map(d => (
                    <td key={d.label} className="p-2 text-right font-mono text-xs">{formatRandExact(d.planned)}</td>
                  ))}
                  <td className="p-2 text-right font-mono text-xs font-bold">{formatRandExact(displayTotals.planned)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/30 bg-green-50/50">
                  <td className="p-2 font-medium text-green-700 sticky left-0 bg-green-50/50">Realised COS</td>
                  {displayData.map(d => (
                    <td key={d.label} className="p-2 text-right font-mono text-xs text-green-700">{formatRandExact(d.realised)}</td>
                  ))}
                  <td className="p-2 text-right font-mono text-xs font-bold text-green-700">{formatRandExact(displayTotals.realised)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/30 bg-amber-50/50">
                  <td className="p-2 font-medium text-amber-700 sticky left-0 bg-amber-50/50">Outstanding COS</td>
                  {displayData.map(d => (
                    <td key={d.label} className="p-2 text-right font-mono text-xs text-amber-700">{formatRandExact(d.outstanding)}</td>
                  ))}
                  <td className="p-2 text-right font-mono text-xs font-bold text-amber-700">{formatRandExact(displayTotals.outstanding)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/30 bg-blue-50/50">
                  <td className="p-2 font-medium text-blue-700 sticky left-0 bg-blue-50/50">Costed COS</td>
                  {displayData.map(d => (
                    <td key={d.label} className="p-2 text-right font-mono text-xs text-blue-700">{formatRandExact(d.budget)}</td>
                  ))}
                  <td className="p-2 text-right font-mono text-xs font-bold text-blue-700">{formatRandExact(displayTotals.budget)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const stateBadgeColors: Record<string, string> = {
  Planned: "bg-muted text-foreground border-border",
  Committed: "bg-amber-100 text-amber-700 border-amber-200",
  Invoiced: "bg-blue-100 text-blue-700 border-blue-200",
  Paid: "bg-green-100 text-green-700 border-green-200",
};

interface InvoiceLine {
  id: number;
  invoiceNumber: string | null;
  supplierName: string | null;
  projects: string[];
  projectName?: string;
  invoicedDate: string | null;
  paymentDate: string | null;
  forecastPaymentDate: string | null;
  amount: number;
  state: string;
  monthBucket: string;
  poNumber: string | null;
  category: string | null;
  lineItem: string | null;
  confidence: string;
  lineCount: number;
  originalInvoicedDate: string | null;
  originalPaymentDate: string | null;
  hash?: string;
}

interface ShiftItem {
  entityId: string;
  description: string;
  fromMonth: string;
  toMonth: string;
  amount: number;
}

function DateEditDialog({ open, onClose, line, scenarioId, fieldName, onSave }: {
  open: boolean;
  onClose: () => void;
  line: InvoiceLine | null;
  scenarioId: number | null;
  fieldName: 'invoice_date' | 'payment_date';
  onSave: () => void;
}) {
  const [newDate, setNewDate] = useState("");
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!line || !scenarioId) return;
      await apiRequest("POST", `/api/scenarios/${scenarioId}/overrides`, {
        entityType: "expense_line",
        entityId: String(line.id),
        fieldName,
        originalDate: fieldName === 'invoice_date' ? line.originalInvoicedDate : line.originalPaymentDate,
        overrideDate: newDate,
        reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      onSave();
      onClose();
      setNewDate("");
      setReason("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {fieldName === 'invoice_date' ? 'Invoice' : 'Payment'} Date</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Line</label>
            <p className="text-sm text-muted-foreground">{line?.invoiceNumber || line?.lineItem || `#${line?.id}`}</p>
          </div>
          <div>
            <label className="text-sm font-medium">Current</label>
            <p className="text-sm text-muted-foreground">
              {fieldName === 'invoice_date' ? (line?.invoicedDate || 'None') : (line?.paymentDate || line?.forecastPaymentDate || 'None')}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium">New Date</label>
            <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} data-testid="input-override-date" />
          </div>
          <div>
            <label className="text-sm font-medium">Reason</label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you moving this date?" data-testid="input-override-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!newDate || !reason || !scenarioId || saveMutation.isPending} data-testid="button-save-override">
            Save Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuickShiftButtons({ line, scenarioId, fieldName, onDone }: {
  line: InvoiceLine;
  scenarioId: number;
  fieldName: 'payment_date';
  onDone: () => void;
}) {
  const queryClient = useQueryClient();

  const shiftMutation = useMutation({
    mutationFn: async (days: number) => {
      const baseDate = line.paymentDate || line.forecastPaymentDate || line.invoicedDate;
      if (!baseDate) return;
      const d = new Date(baseDate);
      d.setDate(d.getDate() + days);
      const newDate = d.toISOString().split('T')[0];

      await apiRequest("POST", `/api/scenarios/${scenarioId}/overrides`, {
        entityType: "expense_line",
        entityId: String(line.id),
        fieldName,
        originalDate: line.originalPaymentDate,
        overrideDate: newDate,
        reason: `Shifted +${days} days`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      onDone();
    },
  });

  return (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => shiftMutation.mutate(7)} disabled={shiftMutation.isPending}>+7d</Button>
      <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => shiftMutation.mutate(14)} disabled={shiftMutation.isPending}>+14d</Button>
      <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => shiftMutation.mutate(30)} disabled={shiftMutation.isPending}>+30d</Button>
    </div>
  );
}

function InvoicesView({ scenarioId, search, project, state }: {
  scenarioId: number | null;
  search: string;
  project: string;
  state: string;
}) {
  const params = new URLSearchParams();
  if (scenarioId) params.set('scenarioId', String(scenarioId));
  if (search) params.set('search', search);
  if (project) params.set('project', project);
  if (state && state !== 'all') params.set('state', state);

  const { data, isLoading } = useQuery<{ invoices: InvoiceLine[]; total: number }>({
    queryKey: [`/api/cos-control/scenario-invoices?${params.toString()}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const [editLine, setEditLine] = useState<InvoiceLine | null>(null);
  const [editField, setEditField] = useState<'invoice_date' | 'payment_date'>('payment_date');
  const [sortField, setSortField] = useState("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    if (!data?.invoices) return [];
    return [...data.invoices].sort((a: any, b: any) => {
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [data, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Loading invoices...</div>;

  return (
    <>
      <div className="text-sm text-muted-foreground mb-2">{data?.total ?? 0} invoices</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background z-10 border-b">
            <tr>
              <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort('projects')}>Project <ArrowUpDown className="inline h-3 w-3" /></th>
              <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort('invoiceNumber')}>Invoice # <ArrowUpDown className="inline h-3 w-3" /></th>
              <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort('supplierName')}>Supplier <ArrowUpDown className="inline h-3 w-3" /></th>
              <th className="p-2 text-right cursor-pointer" onClick={() => toggleSort('amount')}>Amount <ArrowUpDown className="inline h-3 w-3" /></th>
              <th className="p-2 text-left">State</th>
              <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort('invoicedDate')}>Invoice Date <ArrowUpDown className="inline h-3 w-3" /></th>
              <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort('paymentDate')}>Payment Date <ArrowUpDown className="inline h-3 w-3" /></th>
              <th className="p-2 text-left">Month</th>
              {scenarioId && <th className="p-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map(inv => (
              <tr key={inv.id} className="border-b hover:bg-muted/50" data-testid={`invoice-row-${inv.id}`}>
                <td className="p-2 text-xs truncate max-w-[140px]">{inv.projects?.[0] || inv.projectName || '-'}</td>
                <td className="p-2 text-xs truncate max-w-[120px]">{inv.invoiceNumber || '-'}</td>
                <td className="p-2 text-xs truncate max-w-[120px]">{inv.supplierName || '-'}</td>
                <td className="p-2 text-right font-mono text-xs">{formatRand(inv.amount)}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${stateBadgeColors[inv.state] || ''}`}>{inv.state}</span>
                </td>
                <td className="p-2 text-xs">{inv.invoicedDate || '-'}</td>
                <td className="p-2 text-xs">{inv.paymentDate || inv.forecastPaymentDate || '-'}</td>
                <td className="p-2 text-xs">{inv.monthBucket || '-'}</td>
                {scenarioId && (
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => { setEditLine(inv); setEditField('payment_date'); }}>
                        <Calendar className="h-3 w-3" />
                      </Button>
                      <QuickShiftButtons line={inv} scenarioId={scenarioId} fieldName="payment_date" onDone={() => {}} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DateEditDialog
        open={!!editLine}
        onClose={() => setEditLine(null)}
        line={editLine}
        scenarioId={scenarioId}
        fieldName={editField}
        onSave={() => {}}
      />
    </>
  );
}

function ImpactPanel({ scenarioId }: { scenarioId: number }) {
  const { data } = useQuery<{ shifts: ShiftItem[]; totalShifts: number }>({
    queryKey: [`/api/cos-control/scenario-impact?scenarioId=${scenarioId}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  if (!data || data.shifts.length === 0) return (
    <Card>
      <CardContent className="p-4 text-center text-muted-foreground text-sm">
        No COS shifts in this scenario yet. Edit dates to see impact.
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          COS Shifts ({data.totalShifts} total)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.shifts.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs border rounded p-2">
            <span className="truncate max-w-[120px] font-medium">{s.description}</span>
            <span className="text-muted-foreground">{s.fromMonth}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-amber-600">{s.toMonth}</span>
            <span className="ml-auto font-mono">{formatRand(s.amount)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function CosControlPage() {
  const [scenarioId, setScenarioId] = useState<number | null>(null);
  const [view, setView] = useState<'tracker' | 'invoices'>('tracker');
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");

  const { data: trackerData } = useQuery<TrackerData>({
    queryKey: ["/api/cos-control/tracker"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: projectsData } = useQuery<{ projects: any[] }>({
    queryKey: ["/api/planning-board/projects"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const projectNames = useMemo(() => {
    return (projectsData?.projects || []).map((p: any) => p.projectName).sort();
  }, [projectsData]);

  return (
    <div className="space-y-4" data-testid="cos-control-page">
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">COS Tracker</h2>
          <p className="text-sm text-muted-foreground">{trackerData?.lineCount || 0} cost lines across all projects</p>
        </div>
        <ScenarioSelector selectedScenarioId={scenarioId} onScenarioChange={setScenarioId} />
      </div>

      <div className="flex items-center gap-2 border-b pb-2">
        <div className="flex gap-1">
          {(['tracker', 'invoices'] as const).map(v => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? "default" : "ghost"}
              onClick={() => setView(v)}
              data-testid={`button-view-${v}`}
            >
              {v === 'tracker' ? 'COS Tracker' : 'Invoice Details'}
            </Button>
          ))}
        </div>
        <div className="flex-1" />
        {view === 'invoices' && (
          <>
            <div className="relative">
              <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search invoice/PO/project..."
                className="pl-8 h-8 w-56"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-cos-search"
              />
            </div>
            <select
              className="h-8 rounded-md border px-2 text-sm bg-background"
              value={stateFilter}
              onChange={e => setStateFilter(e.target.value)}
              data-testid="select-state-filter"
            >
              <option value="all">All States</option>
              <option value="Planned">Planned</option>
              <option value="Committed">Committed</option>
              <option value="Invoiced">Invoiced</option>
              <option value="Paid">Paid</option>
            </select>
            <select
              className="h-8 rounded-md border px-2 text-sm bg-background max-w-[200px]"
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
              data-testid="select-project-filter"
            >
              <option value="all">All Projects</option>
              {projectNames.map((p: string) => <option key={p} value={p}>{p}</option>)}
            </select>
          </>
        )}
      </div>

      <div className={scenarioId ? "grid grid-cols-1 lg:grid-cols-4 gap-4" : ""}>
        <div className={scenarioId ? "lg:col-span-3" : ""}>
          {view === 'tracker' && <TrackerView data={trackerData} />}

          {view === 'invoices' && (
            <Card>
              <CardContent className="p-4">
                <InvoicesView scenarioId={scenarioId} search={search} project={projectFilter === 'all' ? '' : projectFilter} state={stateFilter === 'all' ? '' : stateFilter} />
              </CardContent>
            </Card>
          )}
        </div>

        {scenarioId && (
          <div className="space-y-4">
            <ImpactPanel scenarioId={scenarioId} />
          </div>
        )}
      </div>
    </div>
  );
}

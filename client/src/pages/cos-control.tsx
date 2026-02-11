import React, { useState, useMemo } from "react";
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

const stateBadgeColors: Record<string, string> = {
  Planned: "bg-slate-100 text-slate-700 border-slate-200",
  Committed: "bg-amber-100 text-amber-700 border-amber-200",
  Invoiced: "bg-blue-100 text-blue-700 border-blue-200",
  Paid: "bg-green-100 text-green-700 border-green-200",
};

const stateChartColors: Record<string, string> = {
  paid: "#22c55e",
  invoiced: "#3b82f6",
  committed: "#f59e0b",
  planned: "#94a3b8",
};

interface MonthlyBucket {
  month: string;
  planned: number;
  committed: number;
  invoiced: number;
  paid: number;
  total: number;
  baselineTotal: number;
  delta: number;
}

interface InvoiceLine {
  id: number;
  invoiceNumber: string | null;
  supplierName: string | null;
  projects: string[];
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
}

interface ShiftItem {
  entityId: string;
  description: string;
  fromMonth: string;
  toMonth: string;
  amount: number;
}

function MonthlyChart({ data, scenarioId }: { data: MonthlyBucket[]; scenarioId: number | null }) {
  const chartData = useMemo(() => {
    return data.map(d => ({
      ...d,
      label: d.month.replace(/^\d{4}-/, ''),
    }));
  }, [data]);

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={(v: number) => formatRand(v)} tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v: number) => formatRand(v)} />
        <Legend />
        <Bar dataKey="paid" stackId="cos" fill={stateChartColors.paid} name="Paid" />
        <Bar dataKey="invoiced" stackId="cos" fill={stateChartColors.invoiced} name="Invoiced" />
        <Bar dataKey="committed" stackId="cos" fill={stateChartColors.committed} name="Committed" />
        <Bar dataKey="planned" stackId="cos" fill={stateChartColors.planned} name="Planned" />
        {scenarioId && (
          <Line type="monotone" dataKey="baselineTotal" stroke="#9ca3af" strokeDasharray="5 5" name="Baseline Total" dot={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
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
      <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => shiftMutation.mutate(7)} disabled={shiftMutation.isPending}>
        +7d
      </Button>
      <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => shiftMutation.mutate(14)} disabled={shiftMutation.isPending}>
        +14d
      </Button>
      <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => shiftMutation.mutate(30)} disabled={shiftMutation.isPending}>
        +30d
      </Button>
    </div>
  );
}

function MonthDetailDrawer({ month, scenarioId, onClose }: { month: string; scenarioId: number | null; onClose: () => void }) {
  const params = new URLSearchParams();
  if (scenarioId) params.set('scenarioId', String(scenarioId));
  params.set('state', '');
  params.set('search', '');

  const { data } = useQuery<{ lines: InvoiceLine[]; total: number }>({
    queryKey: [`/api/cos-control/scenario-lines?scenarioId=${scenarioId || ''}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const monthLines = useMemo(() => {
    return (data?.lines || []).filter(l => l.monthBucket === month);
  }, [data, month]);

  const total = monthLines.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-background border-l shadow-lg z-50 flex flex-col" data-testid="month-detail-drawer">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="font-bold">{month}</h3>
          <p className="text-xs text-muted-foreground">{monthLines.length} items | {formatRand(total)}</p>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-muted rounded" data-testid="button-close-drawer">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {monthLines.map(l => (
          <div key={l.id} className="border rounded p-2 text-xs space-y-1 hover:bg-muted/50">
            <div className="flex justify-between items-start">
              <div className="font-medium truncate max-w-[240px]">{l.invoiceNumber || l.lineItem || `Line #${l.id}`}</div>
              <span className="font-mono font-medium">{formatRand(l.amount)}</span>
            </div>
            <div className="flex gap-2 text-muted-foreground">
              <span>{l.projects?.[0] || l.projectName}</span>
              <span className={`px-1.5 py-0 rounded text-[10px] border ${stateBadgeColors[l.state] || ''}`}>{l.state}</span>
            </div>
          </div>
        ))}
      </div>
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
      return sortDir === "desc" ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
    });
  }, [data?.invoices, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  if (isLoading) return <div className="p-4 text-center text-muted-foreground">Loading...</div>;

  return (
    <>
      <div className="overflow-x-auto">
        <div className="text-sm text-muted-foreground mb-2">{data?.total ?? 0} entries</div>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background z-10 border-b">
            <tr>
              <th className="p-2 text-left">Invoice / Line</th>
              <th className="p-2 text-left">Supplier</th>
              <th className="p-2 text-left">Project</th>
              <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort("invoicedDate")}>
                <div className="flex items-center gap-1">Invoice Date <ArrowUpDown className="h-3 w-3" /></div>
              </th>
              <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort("paymentDate")}>
                <div className="flex items-center gap-1">Payment Date <ArrowUpDown className="h-3 w-3" /></div>
              </th>
              <th className="p-2 text-right cursor-pointer" onClick={() => toggleSort("amount")}>
                <div className="flex items-center justify-end gap-1">Amount <ArrowUpDown className="h-3 w-3" /></div>
              </th>
              <th className="p-2 text-left">State</th>
              <th className="p-2 text-left">Month</th>
              {scenarioId && <th className="p-2 text-center">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map(inv => (
              <tr key={inv.id} className="border-b hover:bg-muted/50" data-testid={`invoice-row-${inv.id}`}>
                <td className="p-2 text-xs font-medium truncate max-w-[160px]">{inv.invoiceNumber || inv.lineItem || `#${inv.id}`}</td>
                <td className="p-2 text-xs truncate max-w-[100px]">{inv.supplierName || '-'}</td>
                <td className="p-2 text-xs truncate max-w-[120px]">{inv.projects?.join(', ') || '-'}</td>
                <td className="p-2 text-xs">
                  <div className="flex items-center gap-1">
                    {inv.invoicedDate || '-'}
                    {inv.originalInvoicedDate && inv.invoicedDate !== inv.originalInvoicedDate && (
                      <span className="text-amber-500 text-[10px]">(was {inv.originalInvoicedDate})</span>
                    )}
                  </div>
                </td>
                <td className="p-2 text-xs">
                  <div className="flex items-center gap-1">
                    {inv.paymentDate || inv.forecastPaymentDate || '-'}
                    {inv.originalPaymentDate && inv.paymentDate !== inv.originalPaymentDate && (
                      <span className="text-amber-500 text-[10px]">(was {inv.originalPaymentDate})</span>
                    )}
                  </div>
                </td>
                <td className="p-2 text-right font-mono text-xs font-medium">{formatRand(inv.amount)}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${stateBadgeColors[inv.state] || ''}`}>
                    {inv.state}
                  </span>
                </td>
                <td className="p-2 text-xs">{inv.monthBucket || '-'}</td>
                {scenarioId && (
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => { setEditLine(inv); setEditField('invoice_date'); }} data-testid={`button-edit-invoice-date-${inv.id}`}>
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => { setEditLine(inv); setEditField('payment_date'); }} data-testid={`button-edit-payment-date-${inv.id}`}>
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

function LinesView({ scenarioId, search, project, state }: {
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

  const { data, isLoading } = useQuery<{ lines: any[]; total: number }>({
    queryKey: [`/api/cos-control/scenario-lines?${params.toString()}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const [editLine, setEditLine] = useState<any>(null);
  const [editField, setEditField] = useState<'invoice_date' | 'payment_date'>('payment_date');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  if (isLoading) return <div className="p-4 text-center text-muted-foreground">Loading...</div>;

  return (
    <>
      <div className="overflow-x-auto">
        <div className="text-sm text-muted-foreground mb-2">{data?.total ?? 0} line items</div>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background z-10 border-b">
            <tr>
              <th className="p-2 w-6"></th>
              <th className="p-2 text-left">Project</th>
              <th className="p-2 text-left">Category</th>
              <th className="p-2 text-left">Line Item</th>
              <th className="p-2 text-left">State</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2 text-left">Invoice #</th>
              <th className="p-2 text-left">Payment Date</th>
              <th className="p-2 text-left">Month</th>
              {scenarioId && <th className="p-2 text-center">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(data?.lines ?? []).slice(0, 200).map((line: any) => (
              <React.Fragment key={line.id}>
                <tr
                  className="border-b hover:bg-muted/50 cursor-pointer"
                  data-testid={`cos-line-${line.id}`}
                  onClick={() => {
                    const next = new Set(expandedRows);
                    next.has(line.id) ? next.delete(line.id) : next.add(line.id);
                    setExpandedRows(next);
                  }}
                >
                  <td className="p-2">{expandedRows.has(line.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</td>
                  <td className="p-2 font-medium text-xs truncate max-w-[140px]">{line.projectName}</td>
                  <td className="p-2 text-xs truncate max-w-[100px]">{line.category || '-'}</td>
                  <td className="p-2 text-xs truncate max-w-[160px]">{line.lineItem || '-'}</td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${stateBadgeColors[line.state] || ''}`}>{line.state}</span>
                  </td>
                  <td className="p-2 text-right font-mono text-xs">{formatRand(line.amount)}</td>
                  <td className="p-2 text-xs truncate max-w-[100px]">{line.invoiceNumber || '-'}</td>
                  <td className="p-2 text-xs">
                    {line.paymentDate || line.forecastPaymentDate || '-'}
                    {line.originalPaymentDate && line.paymentDate !== line.originalPaymentDate && (
                      <span className="text-amber-500 text-[10px] ml-1">(moved)</span>
                    )}
                  </td>
                  <td className="p-2 text-xs">{line.monthBucket || '-'}</td>
                  {scenarioId && (
                    <td className="p-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => { setEditLine(line); setEditField('payment_date'); }}>
                          <Calendar className="h-3 w-3" />
                        </Button>
                        <QuickShiftButtons line={line} scenarioId={scenarioId} fieldName="payment_date" onDone={() => {}} />
                      </div>
                    </td>
                  )}
                </tr>
                {expandedRows.has(line.id) && (
                  <tr className="bg-muted/30">
                    <td colSpan={scenarioId ? 10 : 9} className="p-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div><span className="text-muted-foreground">Supplier:</span> {line.supplierName || 'Unknown'}</div>
                        <div><span className="text-muted-foreground">PO #:</span> {line.poNumber || '-'}</div>
                        <div><span className="text-muted-foreground">Invoice Date:</span> {line.invoicedDate || '-'}</div>
                        <div><span className="text-muted-foreground">Forecast Date:</span> {line.forecastPaymentDate || '-'}</div>
                        <div><span className="text-muted-foreground">Confidence:</span> {line.confidence}</div>
                        <div><span className="text-muted-foreground">Hash:</span> <code className="text-[10px]">{line.hash}</code></div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
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
  const [view, setView] = useState<'month' | 'invoices' | 'lines'>('month');
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const { data: monthlyData } = useQuery<{ monthly: MonthlyBucket[]; summary: any; lineCount: number }>({
    queryKey: [`/api/cos-control/scenario-monthly?scenarioId=${scenarioId || ''}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: projectsData } = useQuery<{ projects: any[] }>({
    queryKey: ["/api/planning-board/projects"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const projectNames = useMemo(() => {
    return (projectsData?.projects || []).map((p: any) => p.projectName).sort();
  }, [projectsData]);

  const summary = monthlyData?.summary;

  return (
    <div className="space-y-4" data-testid="cos-control-page">
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">COS Control</h2>
          <p className="text-sm text-muted-foreground">What-if COS shifting tool — move dates, see impact</p>
        </div>
        <ScenarioSelector selectedScenarioId={scenarioId} onScenarioChange={setScenarioId} />
      </div>

      {!scenarioId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          You are viewing baseline data. Create a scenario to start editing dates and see COS shift across months.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Planned</p>
            <p className="text-lg font-bold text-slate-600">{formatRand(summary?.totalPlanned)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Committed</p>
            <p className="text-lg font-bold text-amber-600">{formatRand(summary?.totalCommitted)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Invoiced</p>
            <p className="text-lg font-bold text-blue-600">{formatRand(summary?.totalInvoiced)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Paid</p>
            <p className="text-lg font-bold text-green-600">{formatRand(summary?.totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-lg font-bold text-red-600">{formatRand(summary?.totalOutstanding)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 border-b pb-2">
        <div className="flex gap-1">
          {(['month', 'invoices', 'lines'] as const).map(v => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? "default" : "ghost"}
              onClick={() => setView(v)}
              data-testid={`button-view-${v}`}
            >
              {v === 'month' ? 'By Month' : v === 'invoices' ? 'Invoices' : 'Line Items'}
            </Button>
          ))}
        </div>
        <div className="flex-1" />
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
      </div>

      <div className={scenarioId ? "grid grid-cols-1 lg:grid-cols-4 gap-4" : ""}>
        <div className={scenarioId ? "lg:col-span-3" : ""}>
          {view === 'month' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Monthly COS Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <MonthlyChart data={monthlyData?.monthly || []} scenarioId={scenarioId} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Monthly Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr>
                          <th className="p-2 text-left">Month</th>
                          <th className="p-2 text-right">Paid</th>
                          <th className="p-2 text-right">Invoiced</th>
                          <th className="p-2 text-right">Committed</th>
                          <th className="p-2 text-right">Planned</th>
                          <th className="p-2 text-right">Total</th>
                          {scenarioId && <th className="p-2 text-right">Delta</th>}
                          <th className="p-2 text-center">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(monthlyData?.monthly || []).map(m => (
                          <tr key={m.month} className="border-b hover:bg-muted/50" data-testid={`month-row-${m.month}`}>
                            <td className="p-2 font-medium">{m.month}</td>
                            <td className="p-2 text-right font-mono text-xs text-green-600">{formatRand(m.paid)}</td>
                            <td className="p-2 text-right font-mono text-xs text-blue-600">{formatRand(m.invoiced)}</td>
                            <td className="p-2 text-right font-mono text-xs text-amber-600">{formatRand(m.committed)}</td>
                            <td className="p-2 text-right font-mono text-xs text-slate-600">{formatRand(m.planned)}</td>
                            <td className="p-2 text-right font-mono text-xs font-medium">{formatRand(m.total)}</td>
                            {scenarioId && (
                              <td className={`p-2 text-right font-mono text-xs font-medium ${m.delta > 0 ? 'text-red-600' : m.delta < 0 ? 'text-green-600' : ''}`}>
                                {m.delta !== 0 ? (m.delta > 0 ? '+' : '') + formatRand(m.delta) : '-'}
                              </td>
                            )}
                            <td className="p-2 text-center">
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setSelectedMonth(m.month)} data-testid={`button-month-detail-${m.month}`}>
                                <ChevronRight className="h-3 w-3" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {view === 'invoices' && (
            <Card>
              <CardContent className="p-4">
                <InvoicesView scenarioId={scenarioId} search={search} project={projectFilter === 'all' ? '' : projectFilter} state={stateFilter === 'all' ? '' : stateFilter} />
              </CardContent>
            </Card>
          )}

          {view === 'lines' && (
            <Card>
              <CardContent className="p-4">
                <LinesView scenarioId={scenarioId} search={search} project={projectFilter === 'all' ? '' : projectFilter} state={stateFilter === 'all' ? '' : stateFilter} />
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

      {selectedMonth && (
        <MonthDetailDrawer month={selectedMonth} scenarioId={scenarioId} onClose={() => setSelectedMonth(null)} />
      )}
    </div>
  );
}

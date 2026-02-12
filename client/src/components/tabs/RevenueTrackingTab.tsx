import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Loader2, Clock, AlertTriangle, Save, XCircle,
  Edit2, FileText, DollarSign, TrendingUp, BanknoteIcon, Check,
  ChevronDown, ChevronRight, Info, Bell, X
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RevenueTrackingTabProps {
  projectName: string;
}

interface RevenueOverride {
  rowNumber: number;
  fieldName: string;
  overrideValue: string | null;
}

interface Milestone {
  id: number;
  rowNumber: number;
  milestoneNo: string;
  milestoneName: string;
  milestonePercent: string;
  milestoneAmount: string;
  date: string | null;
  isRed: boolean;
  milestoneInvoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  inBank: boolean;
  status: "planned" | "invoiced" | "overdue" | "inBank";
  flags: string[];
  hasOverride: boolean;
  milestoneNotes: string | null;
}

interface TaskAlert {
  milestoneNo: string;
  milestoneName: string;
  milestoneAmount: string;
  taskTitle: string;
  taskId: number;
  message: string;
}

interface RevenueTabData {
  milestones: Milestone[];
  summary: {
    totalContract: number;
    invoiced: number;
    inBank: number;
    pending: number;
    overdue: number;
    milestoneCount: number;
    issueCount: number;
  };
  highlevel: {
    costed: { revenue: number; expenditure: number; profit: number; margin: number; isManualOverride: boolean };
    actual: { revenue: number; expenditure: number; profit: number; margin: number };
    voPmLimit: number | null;
    currentVoTotal: number | null;
  };
}

export function RevenueTrackingTab({ projectName }: RevenueTrackingTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerFilter, setDrawerFilter] = useState<string | null>(null);
  const [editingCosted, setEditingCosted] = useState(false);
  const [costedValues, setCostedValues] = useState({ revenue: "", expenditure: "" });
  const [expandedSections, setExpandedSections] = useState({
    highlevel: true,
    contract: true,
    legend: false,
    alerts: true,
  });

  const { data, isLoading, error } = useQuery<RevenueTabData>({
    queryKey: ["revenue-tab", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/revenue-tab/${encodeURIComponent(projectName)}`);
      if (!res.ok) throw new Error("Failed to fetch revenue data");
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: taskAlerts = [] } = useQuery<TaskAlert[]>({
    queryKey: ["revenue-task-alerts", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/revenue-tab/${encodeURIComponent(projectName)}/task-alerts`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const saveMutation = useMutation({
    mutationFn: async (overridesToSave: RevenueOverride[]) => {
      const res = await fetch(`/api/revenue-tracking/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: overridesToSave.map(o => ({ ...o, projectName })) }),
      });
      if (!res.ok) throw new Error("Failed to save changes");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      toast({ title: "Changes saved", description: "Revenue tracking updates saved successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save changes", variant: "destructive" });
    },
  });

  const saveCostedMutation = useMutation({
    mutationFn: async (values: { revenue: string; expenditure: string }) => {
      const res = await fetch(`/api/revenue-tab/${encodeURIComponent(projectName)}/costed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revenue: parseFloat(values.revenue) || null,
          expenditure: parseFloat(values.expenditure) || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save costed values");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      setEditingCosted(false);
      toast({ title: "Costed values saved", description: "High-level costed values updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save costed values", variant: "destructive" });
    },
  });

  const formatCurrency = (amount: number | string | null | undefined) => {
    const num = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
    if (isNaN(num)) return "-";
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
  };

  const formatDate = (dateStr: any) => {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return "-"; }
  };

  const formatDateForInput = (dateStr: any) => {
    if (!dateStr) return "";
    try { return new Date(dateStr).toISOString().split("T")[0]; } catch { return ""; }
  };

  const formatPercent = (val: number | string | null | undefined) => {
    const num = typeof val === "string" ? parseFloat(val) : (val ?? 0);
    if (isNaN(num)) return "-";
    return `${(num * 100).toFixed(1)}%`;
  };

  const startEditing = (row: Milestone) => {
    setEditingRow(row.rowNumber);
    setEditValues({
      invoiceNumber: row.milestoneInvoiceNumber || "",
      invoiceRaisedDate: formatDateForInput(row.invoiceRaisedDate),
      date: formatDateForInput(row.date),
      inBank: row.inBank,
    });
  };

  const cancelEditing = () => { setEditingRow(null); setEditValues({}); };

  const saveRowEdits = (rowNumber: number) => {
    const overrides: RevenueOverride[] = [];
    if (editValues.invoiceNumber !== undefined)
      overrides.push({ rowNumber, fieldName: "milestoneInvoiceNumber", overrideValue: editValues.invoiceNumber || null });
    if (editValues.invoiceRaisedDate !== undefined)
      overrides.push({ rowNumber, fieldName: "invoiceRaisedDate", overrideValue: editValues.invoiceRaisedDate || null });
    if (editValues.date !== undefined) {
      overrides.push({ rowNumber, fieldName: "plannedPaymentDate", overrideValue: editValues.date || null });
    }
    if (editValues.inBank !== undefined)
      overrides.push({ rowNumber, fieldName: "inBank", overrideValue: editValues.inBank ? "1" : "0" });
    saveMutation.mutate(overrides);
    setEditingRow(null);
    setEditValues({});
  };

  const openDrawer = (filter: string) => {
    setDrawerFilter(filter);
    setDrawerOpen(true);
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const drawerMilestones = useMemo(() => {
    if (!data || !drawerFilter) return [];
    const ms = data.milestones;
    switch (drawerFilter) {
      case "totalContract": return ms;
      case "invoiced": return ms.filter(m => m.status === "invoiced");
      case "inBank": return ms.filter(m => m.status === "inBank");
      case "pending": return ms.filter(m => m.status === "planned" || m.status === "overdue");
      case "issues": return ms.filter(m => m.status === "overdue" || m.status === "invoiced");
      default: return ms;
    }
  }, [data, drawerFilter]);

  if (isLoading) {
    return (
      <Card><CardContent className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </CardContent></Card>
    );
  }

  if (error || !data) {
    return (
      <Card><CardContent className="py-12">
        <p className="text-center text-destructive">Failed to load revenue tracking data</p>
      </CardContent></Card>
    );
  }

  const { milestones, summary, highlevel } = data;

  const StatusBadge = ({ status, flags }: { status: string; flags: string[] }) => {
    if (status === "inBank") return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-xs" data-testid="badge-inbank">
        <BanknoteIcon className="h-3 w-3 mr-1" /> In Bank
      </Badge>
    );
    if (status === "invoiced") return (
      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-xs" title={flags.join("; ")} data-testid="badge-invoiced">
        <FileText className="h-3 w-3 mr-1" /> Invoiced
      </Badge>
    );
    if (status === "overdue") return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100 text-xs" title={flags.join("; ")} data-testid="badge-overdue">
        <AlertTriangle className="h-3 w-3 mr-1" /> Overdue
      </Badge>
    );
    return (
      <Badge variant="outline" className="text-xs" data-testid="badge-planned">
        <Clock className="h-3 w-3 mr-1" /> Planned
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Task completion alerts */}
      {taskAlerts.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("alerts")}>
            <div className="flex items-center gap-2">
              {expandedSections.alerts ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Bell className="h-4 w-4 text-amber-600" />
              <CardTitle className="text-sm text-amber-800">Invoice Notifications ({taskAlerts.length})</CardTitle>
            </div>
          </CardHeader>
          {expandedSections.alerts && (
            <CardContent className="pt-0">
              <div className="space-y-2">
                {taskAlerts.map((alert, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-amber-100/50 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-amber-900 font-medium">{alert.message}</p>
                      <p className="text-amber-700 text-xs">Value: {formatCurrency(alert.milestoneAmount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* A) HIGH LEVEL PROJECT REVENUE TRACKING */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleSection("highlevel")}>
              {expandedSections.highlevel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle className="text-base">HIGH LEVEL PROJECT REVENUE TRACKING</CardTitle>
            </div>
            {expandedSections.highlevel && !editingCosted && (
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => {
                setEditingCosted(true);
                setCostedValues({
                  revenue: highlevel.costed.revenue.toString(),
                  expenditure: highlevel.costed.expenditure.toString(),
                });
              }} data-testid="button-edit-costed">
                <Edit2 className="h-3 w-3 mr-1" /> Edit Costed
              </Button>
            )}
          </div>
        </CardHeader>
        {expandedSections.highlevel && (
          <CardContent>
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[200px] font-semibold">Metric</TableHead>
                    <TableHead className="text-right w-[160px] font-semibold">COSTED</TableHead>
                    <TableHead className="text-right w-[160px] font-semibold">ACTUAL</TableHead>
                    <TableHead className="text-right w-[160px] font-semibold">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Planned Revenue</TableCell>
                    <TableCell className="text-right font-mono">
                      {editingCosted ? (
                        <Input type="number" value={costedValues.revenue} onChange={e => setCostedValues(v => ({ ...v, revenue: e.target.value }))}
                          className="h-7 text-right text-xs w-[140px] ml-auto" data-testid="input-costed-revenue" />
                      ) : (
                        <span>{formatCurrency(highlevel.costed.revenue)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(highlevel.actual.revenue)}</TableCell>
                    <TableCell className={`text-right font-mono ${highlevel.actual.revenue - highlevel.costed.revenue < 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(highlevel.actual.revenue - highlevel.costed.revenue)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Planned Expenditure</TableCell>
                    <TableCell className="text-right font-mono">
                      {editingCosted ? (
                        <Input type="number" value={costedValues.expenditure} onChange={e => setCostedValues(v => ({ ...v, expenditure: e.target.value }))}
                          className="h-7 text-right text-xs w-[140px] ml-auto" data-testid="input-costed-expenditure" />
                      ) : (
                        <span>{formatCurrency(highlevel.costed.expenditure)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(highlevel.actual.expenditure)}</TableCell>
                    <TableCell className={`text-right font-mono ${highlevel.actual.expenditure - highlevel.costed.expenditure > 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(highlevel.actual.expenditure - highlevel.costed.expenditure)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell className="font-semibold">Planned Profit</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(highlevel.costed.profit)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(highlevel.actual.profit)}</TableCell>
                    <TableCell className={`text-right font-mono ${highlevel.actual.profit - highlevel.costed.profit < 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(highlevel.actual.profit - highlevel.costed.profit)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-semibold">Planned Margin</TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(highlevel.costed.margin)}</TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(highlevel.actual.margin)}</TableCell>
                    <TableCell className={`text-right font-mono ${(highlevel.actual.margin - highlevel.costed.margin) < 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatPercent(highlevel.actual.margin - highlevel.costed.margin)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {editingCosted && (
              <div className="flex justify-end gap-2 mt-3">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setEditingCosted(false)}>
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
                <Button size="sm" className="text-xs h-7" onClick={() => saveCostedMutation.mutate(costedValues)}
                  disabled={saveCostedMutation.isPending} data-testid="button-save-costed">
                  <Save className="h-3 w-3 mr-1" /> Save Costed
                </Button>
              </div>
            )}
            {highlevel.costed.isManualOverride && !editingCosted && (
              <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                <Edit2 className="h-3 w-3" /> Costed values have been manually set
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { key: "totalContract", label: "Total Contract", value: summary.totalContract, sub: `${summary.milestoneCount} milestones`, icon: DollarSign, colors: "from-emerald-50 border-emerald-200 text-emerald-600 text-emerald-700" },
          { key: "invoiced", label: "Invoiced", value: summary.invoiced, sub: `${summary.totalContract > 0 ? ((summary.invoiced / summary.totalContract) * 100).toFixed(0) : 0}% of total`, icon: FileText, colors: "from-blue-50 border-blue-200 text-blue-600 text-blue-700" },
          { key: "inBank", label: "In Bank", value: summary.inBank, sub: `${summary.totalContract > 0 ? ((summary.inBank / summary.totalContract) * 100).toFixed(0) : 0}% confirmed`, icon: BanknoteIcon, colors: "from-green-50 border-green-200 text-green-600 text-green-700" },
          { key: "pending", label: "Pending", value: summary.pending, sub: `${summary.totalContract > 0 ? ((summary.pending / summary.totalContract) * 100).toFixed(0) : 0}% remaining`, icon: Clock, colors: "from-amber-50 border-amber-200 text-amber-600 text-amber-700" },
          { key: "issues", label: "Issues", value: summary.issueCount, sub: "flags", icon: AlertTriangle, colors: "from-red-50 border-red-200 text-red-600 text-red-700", isCount: true },
        ].map(card => {
          const colorParts = card.colors.split(" ");
          return (
            <Card
              key={card.key}
              className={`cursor-pointer hover:shadow-md transition-shadow bg-gradient-to-br ${colorParts[0]} to-white ${colorParts[1]}`}
              onClick={() => openDrawer(card.key)}
              data-testid={`card-${card.key}`}
            >
              <CardContent className="pt-3 pb-2">
                <div className={`flex items-center gap-1.5 ${colorParts[2]} mb-1`}>
                  <card.icon className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">{card.label}</span>
                </div>
                <p className={`text-lg font-bold ${colorParts[3]}`}>
                  {card.isCount ? card.value : formatCurrency(card.value)}
                </p>
                <p className="text-[10px] text-muted-foreground">{card.sub}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* B) CONTRACT - Payment Milestones Table */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("contract")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {expandedSections.contract ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle className="text-base">CONTRACT (Payment Milestones)</CardTitle>
            </div>
            <CardDescription className="text-xs">Click Edit to modify invoice details and dates</CardDescription>
          </div>
        </CardHeader>
        {expandedSections.contract && (
          <CardContent>
            {milestones.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No revenue tracking data available</p>
            ) : (
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[40px] text-xs">No.</TableHead>
                      <TableHead className="min-w-[160px] text-xs">PAYMENT MILESTONE</TableHead>
                      <TableHead className="text-right w-[55px] text-xs">%</TableHead>
                      <TableHead className="text-right w-[110px] text-xs">VALUE</TableHead>
                      <TableHead className="w-[100px] text-xs">DATE</TableHead>
                      <TableHead className="w-[100px] text-xs">INVOICE NO.</TableHead>
                      <TableHead className="w-[100px] text-xs">INVOICE DATE</TableHead>
                      <TableHead className="w-[55px] text-center text-xs">IN BANK</TableHead>
                      <TableHead className="w-[80px] text-xs">STATUS</TableHead>
                      <TableHead className="w-[50px] text-xs">EDIT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {milestones.map((m) => {
                      const isEditing = editingRow === m.rowNumber;
                      return (
                        <TableRow
                          key={m.id || m.rowNumber}
                          className={`${isEditing ? "bg-blue-50/50" : ""} ${m.status === "overdue" ? "bg-red-50/30" : ""}`}
                          data-testid={`row-milestone-${m.rowNumber}`}
                        >
                          <TableCell className="font-mono text-xs">{m.milestoneNo}</TableCell>
                          <TableCell className="text-xs font-medium">
                            <div className="flex items-center gap-1">
                              <span className="truncate max-w-[160px]" title={m.milestoneName}>{m.milestoneName}</span>
                              {m.hasOverride && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-300 text-orange-600">edited</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {m.milestonePercent ? `${(parseFloat(m.milestonePercent) * 100).toFixed(0)}%` : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-medium">{formatCurrency(m.milestoneAmount)}</TableCell>

                          {/* Single DATE column - red = planned/unconfirmed, black = in bank */}
                          <TableCell className="text-xs">
                            {isEditing ? (
                              <Input type="date" value={editValues.date} onChange={(e) => setEditValues({ ...editValues, date: e.target.value })}
                                className="h-7 text-xs w-[110px]" data-testid={`input-date-${m.rowNumber}`} />
                            ) : (
                              <span className={m.isRed ? "text-red-500 font-medium" : "text-foreground"}>
                                {formatDate(m.date)}
                              </span>
                            )}
                          </TableCell>

                          {/* Invoice Number */}
                          <TableCell className="text-xs">
                            {isEditing ? (
                              <Input value={editValues.invoiceNumber} onChange={(e) => setEditValues({ ...editValues, invoiceNumber: e.target.value })}
                                className="h-7 text-xs" placeholder="INV-XXX" data-testid={`input-invoice-${m.rowNumber}`} />
                            ) : (
                              <span className="font-mono">{m.milestoneInvoiceNumber || "-"}</span>
                            )}
                          </TableCell>

                          {/* Invoice Raised Date */}
                          <TableCell className="text-xs">
                            {isEditing ? (
                              <Input type="date" value={editValues.invoiceRaisedDate} onChange={(e) => setEditValues({ ...editValues, invoiceRaisedDate: e.target.value })}
                                className="h-7 text-xs w-[110px]" data-testid={`input-invoiced-${m.rowNumber}`} />
                            ) : (
                              <span>{formatDate(m.invoiceRaisedDate)}</span>
                            )}
                          </TableCell>

                          {/* In Bank */}
                          <TableCell className="text-center">
                            {isEditing ? (
                              <Checkbox checked={editValues.inBank} onCheckedChange={(checked) => setEditValues({ ...editValues, inBank: !!checked })}
                                data-testid={`checkbox-inbank-${m.rowNumber}`} />
                            ) : (
                              <div className="flex justify-center">
                                {m.inBank ? <Check className="h-4 w-4 text-green-600" /> : <span className="text-muted-foreground text-xs">-</span>}
                              </div>
                            )}
                          </TableCell>

                          {/* Status */}
                          <TableCell>
                            <StatusBadge status={m.status} flags={m.flags} />
                          </TableCell>

                          {/* Actions */}
                          <TableCell>
                            {isEditing ? (
                              <div className="flex gap-0.5">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => saveRowEdits(m.rowNumber)}
                                  disabled={saveMutation.isPending} data-testid={`button-save-${m.rowNumber}`}>
                                  <Save className="h-3.5 w-3.5 text-green-600" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={cancelEditing}
                                  data-testid={`button-cancel-${m.rowNumber}`}>
                                  <XCircle className="h-3.5 w-3.5 text-gray-500" />
                                </Button>
                              </div>
                            ) : (
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEditing(m)}
                                data-testid={`button-edit-${m.rowNumber}`}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Totals row */}
                    <TableRow className="bg-muted/50 font-semibold border-t-2">
                      <TableCell></TableCell>
                      <TableCell className="text-xs font-bold">TOTAL</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {milestones.reduce((s, m) => s + (parseFloat(m.milestonePercent) || 0), 0) > 0
                          ? `${(milestones.reduce((s, m) => s + (parseFloat(m.milestonePercent) || 0), 0) * 100).toFixed(0)}%`
                          : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold">{formatCurrency(summary.totalContract)}</TableCell>
                      <TableCell colSpan={6}></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* E) KEY / LEGEND */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("legend")}>
          <div className="flex items-center gap-2">
            {expandedSections.legend ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <CardTitle className="text-base flex items-center gap-2"><Info className="h-4 w-4" /> Key / Legend</CardTitle>
          </div>
        </CardHeader>
        {expandedSections.legend && (
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div className="flex items-start gap-3 p-3 rounded-md bg-muted/30">
                <Badge variant="outline" className="text-xs mt-0.5 shrink-0"><Clock className="h-3 w-3 mr-1" /> Planned</Badge>
                <div>
                  <p className="font-medium text-xs">Planned</p>
                  <p className="text-[10px] text-muted-foreground"><span className="text-red-500 font-bold">Red date</span> in the future, no invoice. Not yet achieved.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-md bg-red-50">
                <Badge className="bg-red-100 text-red-800 text-xs mt-0.5 shrink-0"><AlertTriangle className="h-3 w-3 mr-1" /> Overdue</Badge>
                <div>
                  <p className="font-medium text-xs">Overdue</p>
                  <p className="text-[10px] text-muted-foreground"><span className="text-red-500 font-bold">Red date</span> in the past, no invoice. Needs attention.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-md bg-blue-50">
                <Badge className="bg-blue-100 text-blue-800 text-xs mt-0.5 shrink-0"><FileText className="h-3 w-3 mr-1" /> Invoiced</Badge>
                <div>
                  <p className="font-medium text-xs">Invoiced</p>
                  <p className="text-[10px] text-muted-foreground"><span className="text-red-500 font-bold">Red date</span> with invoice. Payment outstanding.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-md bg-green-50">
                <Badge className="bg-green-100 text-green-800 text-xs mt-0.5 shrink-0"><BanknoteIcon className="h-3 w-3 mr-1" /> In Bank</Badge>
                <div>
                  <p className="font-medium text-xs">In Bank</p>
                  <p className="text-[10px] text-muted-foreground"><span className="font-bold">Black date</span> with invoice. Settled and confirmed.</p>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Drilldown Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-[500px] sm:w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-lg">
              {drawerFilter === "totalContract" && "All Milestones"}
              {drawerFilter === "invoiced" && "Invoiced Milestones (Payment Outstanding)"}
              {drawerFilter === "inBank" && "In Bank Milestones (Settled)"}
              {drawerFilter === "pending" && "Pending Milestones (Planned + Overdue)"}
              {drawerFilter === "issues" && "Issues (Overdue + Invoiced Outstanding)"}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {drawerMilestones.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4">No milestones match this filter.</p>
            ) : (
              drawerMilestones.map(m => (
                <Card key={m.id} className={`${m.status === "overdue" ? "border-red-300 bg-red-50/30" : ""}`} data-testid={`drawer-milestone-${m.id}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm">{m.milestoneNo}. {m.milestoneName}</p>
                        <p className="font-mono text-lg font-bold">{formatCurrency(m.milestoneAmount)}</p>
                      </div>
                      <StatusBadge status={m.status} flags={m.flags} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div>Date: <span className={m.isRed ? "text-red-500 font-medium" : "text-foreground"}>{formatDate(m.date)}</span></div>
                      <div>Invoice #: <span className="text-foreground font-mono">{m.milestoneInvoiceNumber || "-"}</span></div>
                      <div>Invoice Date: <span className="text-foreground">{formatDate(m.invoiceRaisedDate)}</span></div>
                      <div>In Bank: <span className="text-foreground">{m.inBank ? "Yes" : "No"}</span></div>
                    </div>
                    {m.flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.flags.map((f, i) => (
                          <Badge key={i} variant="outline" className="text-[10px] text-red-600 border-red-300">{f}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
            <div className="pt-3 border-t text-sm font-medium">
              Total: <span className="font-mono">{formatCurrency(drawerMilestones.reduce((s, m) => s + (parseFloat(m.milestoneAmount) || 0), 0))}</span>
              <span className="text-muted-foreground ml-2">({drawerMilestones.length} milestones)</span>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

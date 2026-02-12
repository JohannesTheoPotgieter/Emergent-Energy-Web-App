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
  Loader2, CheckCircle, Clock, AlertCircle, AlertTriangle, Save, XCircle,
  Edit2, FileText, DollarSign, TrendingUp, BanknoteIcon, Check, X,
  ChevronDown, ChevronRight, Info
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
  plannedPaymentDate: string | null;
  milestoneInvoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  paymentReceivedDate: string | null;
  inBank: boolean;
  status: "planned" | "invoiced" | "received" | "issue" | "inBank";
  flags: string[];
  hasOverride: boolean;
  documentsReceived: string | null;
  milestoneNotes: string | null;
}

interface RevenueTabData {
  milestones: Milestone[];
  summary: {
    totalContract: number;
    invoiced: number;
    received: number;
    inBank: number;
    pending: number;
    milestoneCount: number;
    issueCount: number;
  };
  highlevel: {
    costed: { revenue: number; expenditure: number; profit: number; margin: number };
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
  const [expandedSections, setExpandedSections] = useState({
    highlevel: true,
    contract: true,
    legend: false,
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
      paymentReceivedDate: formatDateForInput(row.paymentReceivedDate),
      plannedPaymentDate: formatDateForInput(row.plannedPaymentDate),
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
    if (editValues.paymentReceivedDate !== undefined)
      overrides.push({ rowNumber, fieldName: "paymentReceivedDate", overrideValue: editValues.paymentReceivedDate || null });
    if (editValues.plannedPaymentDate !== undefined)
      overrides.push({ rowNumber, fieldName: "plannedPaymentDate", overrideValue: editValues.plannedPaymentDate || null });
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
      case "received": return ms.filter(m => m.status === "received");
      case "inBank": return ms.filter(m => m.status === "inBank");
      case "pending": return ms.filter(m => m.status === "planned");
      case "issue": return ms.filter(m => m.status === "issue");
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
    if (status === "received") return (
      <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100 text-xs" data-testid="badge-received">
        <CheckCircle className="h-3 w-3 mr-1" /> Received
      </Badge>
    );
    if (status === "invoiced") return (
      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-xs" data-testid="badge-invoiced">
        <FileText className="h-3 w-3 mr-1" /> Invoiced
      </Badge>
    );
    if (status === "issue") return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100 text-xs" title={flags.join("; ")} data-testid="badge-issue">
        <AlertTriangle className="h-3 w-3 mr-1" /> Issue
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
      {/* A) HIGH LEVEL PROJECT REVENUE TRACKING */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("highlevel")}>
          <div className="flex items-center gap-2">
            {expandedSections.highlevel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <CardTitle className="text-base">HIGH LEVEL PROJECT REVENUE TRACKING</CardTitle>
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
                    <TableCell className="text-right font-mono">{formatCurrency(highlevel.costed.revenue)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(highlevel.actual.revenue)}</TableCell>
                    <TableCell className={`text-right font-mono ${highlevel.actual.revenue - highlevel.costed.revenue < 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(highlevel.actual.revenue - highlevel.costed.revenue)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Planned Expenditure</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(highlevel.costed.expenditure)}</TableCell>
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
            {(highlevel.voPmLimit !== null || highlevel.currentVoTotal !== null) && (
              <div className="flex gap-6 mt-3 text-sm">
                <div><span className="text-muted-foreground">VO PM LIMIT:</span> <span className="font-mono font-medium">{highlevel.voPmLimit !== null ? formatCurrency(highlevel.voPmLimit) : "—"}</span></div>
                <div><span className="text-muted-foreground">CURRENT VO Total:</span> <span className="font-mono font-medium">{highlevel.currentVoTotal !== null ? formatCurrency(highlevel.currentVoTotal) : "—"}</span></div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { key: "totalContract", label: "Total Contract", value: summary.totalContract, sub: `${summary.milestoneCount} milestones`, icon: DollarSign, color: "emerald" },
          { key: "invoiced", label: "Invoiced", value: summary.invoiced, sub: `${((summary.invoiced / summary.totalContract) * 100 || 0).toFixed(0)}% of total`, icon: FileText, color: "blue" },
          { key: "received", label: "Received", value: summary.received, sub: `${((summary.received / summary.totalContract) * 100 || 0).toFixed(0)}% of total`, icon: TrendingUp, color: "purple" },
          { key: "inBank", label: "In Bank", value: summary.inBank, sub: `${((summary.inBank / summary.totalContract) * 100 || 0).toFixed(0)}% confirmed`, icon: BanknoteIcon, color: "green" },
          { key: "pending", label: "Pending", value: summary.pending, sub: `${((summary.pending / summary.totalContract) * 100 || 0).toFixed(0)}% remaining`, icon: Clock, color: "amber" },
          { key: "issue", label: "Issues", value: summary.issueCount, sub: "flags", icon: AlertTriangle, color: "red", isCount: true },
        ].map(card => (
          <Card
            key={card.key}
            className={`cursor-pointer hover:shadow-md transition-shadow bg-gradient-to-br from-${card.color}-50 to-white border-${card.color}-200`}
            onClick={() => openDrawer(card.key)}
            data-testid={`card-${card.key}`}
          >
            <CardContent className="pt-3 pb-2">
              <div className={`flex items-center gap-1.5 text-${card.color}-600 mb-1`}>
                <card.icon className="h-3.5 w-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-wide">{card.label}</span>
              </div>
              <p className={`text-lg font-bold text-${card.color}-700`}>
                {card.isCount ? card.value : formatCurrency(card.value)}
              </p>
              <p className="text-[10px] text-muted-foreground">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* B) CONTRACT - Payment Milestones Table with C) Planned Payment Date and D) Invoice Details */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("contract")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {expandedSections.contract ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle className="text-base">CONTRACT (Payment Milestones)</CardTitle>
            </div>
            <CardDescription className="text-xs">Click Edit to modify invoice details and payment dates</CardDescription>
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
                      <TableHead className="w-[95px] text-xs">PLANNED DATE</TableHead>
                      <TableHead className="w-[95px] text-xs">INVOICE NO.</TableHead>
                      <TableHead className="w-[95px] text-xs">INVOICE RAISED</TableHead>
                      <TableHead className="w-[95px] text-xs">PAYMENT RECEIVED</TableHead>
                      <TableHead className="w-[55px] text-center text-xs">IN BANK</TableHead>
                      <TableHead className="w-[75px] text-xs">STATUS</TableHead>
                      <TableHead className="w-[50px] text-xs">EDIT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {milestones.map((m) => {
                      const isEditing = editingRow === m.rowNumber;
                      return (
                        <TableRow
                          key={m.id || m.rowNumber}
                          className={`${isEditing ? "bg-blue-50/50" : ""} ${m.status === "issue" ? "bg-red-50/30" : ""}`}
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

                          {/* Planned Payment Date */}
                          <TableCell className="text-xs">
                            {isEditing ? (
                              <Input type="date" value={editValues.plannedPaymentDate} onChange={(e) => setEditValues({ ...editValues, plannedPaymentDate: e.target.value })}
                                className="h-7 text-xs w-[110px]" data-testid={`input-planned-${m.rowNumber}`} />
                            ) : (
                              <span className={!m.milestoneInvoiceNumber && m.plannedPaymentDate ? "text-red-500" : ""}>{formatDate(m.plannedPaymentDate)}</span>
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

                          {/* Payment Received Date */}
                          <TableCell className="text-xs">
                            {isEditing ? (
                              <Input type="date" value={editValues.paymentReceivedDate} onChange={(e) => setEditValues({ ...editValues, paymentReceivedDate: e.target.value })}
                                className="h-7 text-xs w-[110px]" data-testid={`input-received-${m.rowNumber}`} />
                            ) : (
                              <span className={m.paymentReceivedDate && !m.milestoneInvoiceNumber ? "text-red-600 font-medium" : m.paymentReceivedDate && !m.inBank ? "text-red-500" : ""}>
                                {formatDate(m.paymentReceivedDate)}
                              </span>
                            )}
                          </TableCell>

                          {/* In Bank */}
                          <TableCell className="text-center">
                            {isEditing ? (
                              <Checkbox checked={editValues.inBank} onCheckedChange={(checked) => setEditValues({ ...editValues, inBank: !!checked })}
                                data-testid={`checkbox-inbank-${m.rowNumber}`} />
                            ) : (
                              <div className="flex justify-center">
                                {m.inBank ? <Check className="h-4 w-4 text-green-600" /> : m.paymentReceivedDate ? <X className="h-4 w-4 text-red-500" /> : <span className="text-muted-foreground text-xs">-</span>}
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
                      <TableCell colSpan={7}></TableCell>
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
                  <p className="font-medium text-xs">Planned Only</p>
                  <p className="text-[10px] text-muted-foreground">No invoice or payment received yet.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-md bg-blue-50">
                <Badge className="bg-blue-100 text-blue-800 text-xs mt-0.5 shrink-0"><FileText className="h-3 w-3 mr-1" /> Invoiced</Badge>
                <div>
                  <p className="font-medium text-xs">Invoiced</p>
                  <p className="text-[10px] text-muted-foreground">Invoice raised but payment not received.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-md bg-red-50">
                <Badge className="bg-red-100 text-red-800 text-xs mt-0.5 shrink-0"><AlertTriangle className="h-3 w-3 mr-1" /> Issue</Badge>
                <div>
                  <p className="font-medium text-xs">Data Issue</p>
                  <p className="text-[10px] text-muted-foreground">Receipt date exists but invoice number missing.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-md bg-green-50">
                <Badge className="bg-green-100 text-green-800 text-xs mt-0.5 shrink-0"><BanknoteIcon className="h-3 w-3 mr-1" /> In Bank</Badge>
                <div>
                  <p className="font-medium text-xs">Settled / In Bank</p>
                  <p className="text-[10px] text-muted-foreground">Invoice + payment received + confirmed in bank.</p>
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
              {drawerFilter === "invoiced" && "Invoiced Milestones"}
              {drawerFilter === "received" && "Received Milestones"}
              {drawerFilter === "inBank" && "In Bank Milestones"}
              {drawerFilter === "pending" && "Pending Milestones"}
              {drawerFilter === "issue" && "Issue Milestones"}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {drawerMilestones.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4">No milestones match this filter.</p>
            ) : (
              drawerMilestones.map(m => (
                <Card key={m.id} className={`${m.status === "issue" ? "border-red-300 bg-red-50/30" : ""}`} data-testid={`drawer-milestone-${m.id}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm">{m.milestoneNo}. {m.milestoneName}</p>
                        <p className="font-mono text-lg font-bold">{formatCurrency(m.milestoneAmount)}</p>
                      </div>
                      <StatusBadge status={m.status} flags={m.flags} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div>Planned: <span className="text-foreground">{formatDate(m.plannedPaymentDate)}</span></div>
                      <div>Invoice #: <span className="text-foreground font-mono">{m.milestoneInvoiceNumber || "-"}</span></div>
                      <div>Invoiced: <span className="text-foreground">{formatDate(m.invoiceRaisedDate)}</span></div>
                      <div>Received: <span className={`${m.paymentReceivedDate && !m.milestoneInvoiceNumber ? "text-red-600 font-medium" : "text-foreground"}`}>{formatDate(m.paymentReceivedDate)}</span></div>
                      <div>In Bank: <span className="text-foreground">{m.inBank ? "Yes" : "No"}</span></div>
                      <div>% of Contract: <span className="text-foreground">{m.milestonePercent ? `${(parseFloat(m.milestonePercent) * 100).toFixed(1)}%` : "-"}</span></div>
                    </div>
                    {m.flags.length > 0 && (
                      <div className="mt-2 flex gap-1">
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

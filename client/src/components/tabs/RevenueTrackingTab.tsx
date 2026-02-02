import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle, Clock, AlertCircle, Save, XCircle, Edit2, FileText, DollarSign, TrendingUp, BanknoteIcon, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RevenueTrackingTabProps {
  projectName: string;
}

interface RevenueOverride {
  rowNumber: number;
  fieldName: string;
  overrideValue: string | null;
}

export function RevenueTrackingTab({ projectName }: RevenueTrackingTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [pendingOverrides, setPendingOverrides] = useState<RevenueOverride[]>([]);
  const [notes, setNotes] = useState({ financialReview: "", timelineReview: "" });
  const [notesEditing, setNotesEditing] = useState(false);

  const { data: revenues = [], isLoading, error } = useQuery({
    queryKey: ["program-inflows", projectName, "withOverrides"],
    queryFn: async () => {
      const res = await fetch(`/api/program-inflows?projectName=${encodeURIComponent(projectName)}&applyOverrides=true`);
      if (!res.ok) throw new Error("Failed to fetch revenue data");
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: overrides = [] } = useQuery({
    queryKey: ["revenue-tracking-overrides", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/revenue-tracking/overrides?projectName=${encodeURIComponent(projectName)}`);
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
      queryClient.invalidateQueries({ queryKey: ["program-inflows", projectName] });
      queryClient.invalidateQueries({ queryKey: ["revenue-tracking-overrides", projectName] });
      setPendingOverrides([]);
      toast({ title: "Changes saved", description: "Revenue tracking updates saved successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save changes", variant: "destructive" });
    },
  });

  const revenueList = useMemo(() => {
    if (!Array.isArray(revenues)) return [];
    return revenues.filter((r: any) =>
      r.milestoneNo && !r.milestoneName?.includes("[") && r.milestoneName !== "KEY: "
    );
  }, [revenues]);

  const summary = useMemo(() => {
    const totalValue = revenueList.reduce((sum: number, r: any) => sum + (parseFloat(r.milestoneAmount) || 0), 0);
    const invoiced = revenueList.filter((r: any) => r.invoiceRaisedDate).reduce((sum: number, r: any) => sum + (parseFloat(r.milestoneAmount) || 0), 0);
    const received = revenueList.filter((r: any) => r.paymentReceivedDate).reduce((sum: number, r: any) => sum + (parseFloat(r.milestoneAmount) || 0), 0);
    const inBankTotal = revenueList.filter((r: any) => r.inBank === 1 || r.inBank === '1' || r.inBank === true).reduce((sum: number, r: any) => sum + (parseFloat(r.milestoneAmount) || 0), 0);
    const pending = totalValue - invoiced;
    return { totalValue, invoiced, received, inBank: inBankTotal, pending, milestoneCount: revenueList.length };
  }, [revenueList]);

  const formatCurrency = (amount: any) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return "-";
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
  };

  const formatDate = (dateStr: any) => {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return "-";
    }
  };

  const formatDateForInput = (dateStr: any) => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      return d.toISOString().split('T')[0];
    } catch {
      return "";
    }
  };

  // Robustly check if inBank is truthy (handles string "1", number 1, boolean true)
  const isInBank = (value: any): boolean => {
    return value === 1 || value === '1' || value === true || value === 'true';
  };

  const getPaymentStatus = (rec: any) => {
    if (isInBank(rec.inBank)) return "inBank";
    if (rec.paymentReceivedDate) return "received";
    if (rec.invoiceRaisedDate) return "invoiced";
    if (rec.plannedPaymentDate) return "planned";
    return "pending";
  };

  const startEditing = (row: any) => {
    setEditingRow(row.rowNumber);
    setEditValues({
      invoiceNumber: row.milestoneInvoiceNumber || "",
      invoiceRaisedDate: formatDateForInput(row.invoiceRaisedDate),
      paymentReceivedDate: formatDateForInput(row.paymentReceivedDate),
      inBank: isInBank(row.inBank),
      documentsReceived: row.documentsReceived || "",
      notes: row.milestoneNotes || "",
    });
  };

  const cancelEditing = () => {
    setEditingRow(null);
    setEditValues({});
  };

  const saveRowEdits = (rowNumber: number) => {
    const newOverrides: RevenueOverride[] = [];

    if (editValues.invoiceNumber !== undefined) {
      newOverrides.push({ rowNumber, fieldName: "milestoneInvoiceNumber", overrideValue: editValues.invoiceNumber || null });
    }
    if (editValues.invoiceRaisedDate !== undefined) {
      newOverrides.push({ rowNumber, fieldName: "invoiceRaisedDate", overrideValue: editValues.invoiceRaisedDate || null });
    }
    if (editValues.paymentReceivedDate !== undefined) {
      newOverrides.push({ rowNumber, fieldName: "paymentReceivedDate", overrideValue: editValues.paymentReceivedDate || null });
    }
    if (editValues.inBank !== undefined) {
      newOverrides.push({ rowNumber, fieldName: "inBank", overrideValue: editValues.inBank ? "1" : "0" });
    }
    if (editValues.documentsReceived !== undefined) {
      newOverrides.push({ rowNumber, fieldName: "documentsReceived", overrideValue: editValues.documentsReceived || null });
    }
    if (editValues.notes !== undefined) {
      newOverrides.push({ rowNumber, fieldName: "milestoneNotes", overrideValue: editValues.notes || null });
    }

    saveMutation.mutate(newOverrides);
    setEditingRow(null);
    setEditValues({});
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <p className="text-center text-destructive">Failed to load revenue tracking data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-gradient-to-br from-emerald-50 to-white border-emerald-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-emerald-600 mb-1">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Total Contract</span>
            </div>
            <p className="text-xl font-bold text-emerald-700">{formatCurrency(summary.totalValue)}</p>
            <p className="text-xs text-muted-foreground">{summary.milestoneCount} milestones</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-blue-600 mb-1">
              <FileText className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Invoiced</span>
            </div>
            <p className="text-xl font-bold text-blue-700">{formatCurrency(summary.invoiced)}</p>
            <p className="text-xs text-muted-foreground">{((summary.invoiced / summary.totalValue) * 100 || 0).toFixed(0)}% of total</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-white border-purple-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-purple-600 mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Received</span>
            </div>
            <p className="text-xl font-bold text-purple-700">{formatCurrency(summary.received)}</p>
            <p className="text-xs text-muted-foreground">{((summary.received / summary.totalValue) * 100 || 0).toFixed(0)}% of total</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-white border-green-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-green-600 mb-1">
              <BanknoteIcon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">In Bank</span>
            </div>
            <p className="text-xl font-bold text-green-700">{formatCurrency(summary.inBank)}</p>
            <p className="text-xs text-muted-foreground">{((summary.inBank / summary.totalValue) * 100 || 0).toFixed(0)}% of total</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-white border-amber-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-amber-600 mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Pending</span>
            </div>
            <p className="text-xl font-bold text-amber-700">{formatCurrency(summary.pending)}</p>
            <p className="text-xs text-muted-foreground">{((summary.pending / summary.totalValue) * 100 || 0).toFixed(0)}% remaining</p>
          </CardContent>
        </Card>
      </div>

      {/* Milestones Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Payment Milestones</CardTitle>
          <CardDescription>
            Click Edit to modify invoice details, payment dates, and bank status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {revenueList.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No revenue tracking data available for this project
            </p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[50px]">No.</TableHead>
                    <TableHead className="min-w-[180px]">Milestone</TableHead>
                    <TableHead className="text-right w-[60px]">%</TableHead>
                    <TableHead className="text-right w-[110px]">Amount</TableHead>
                    <TableHead className="w-[100px]">Planned</TableHead>
                    <TableHead className="w-[100px]">Invoice #</TableHead>
                    <TableHead className="w-[100px]">Invoiced</TableHead>
                    <TableHead className="w-[100px]">Received</TableHead>
                    <TableHead className="w-[80px] text-center">In Bank?</TableHead>
                    <TableHead className="w-[80px]">Status</TableHead>
                    <TableHead className="w-[70px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenueList.map((rev: any) => {
                    const status = getPaymentStatus(rev);
                    const isEditing = editingRow === rev.rowNumber;

                    return (
                      <TableRow 
                        key={rev.id || rev.rowNumber} 
                        className={isEditing ? "bg-blue-50/50" : undefined}
                        data-testid={`row-milestone-${rev.rowNumber}`}
                      >
                        <TableCell className="font-mono text-sm">{rev.milestoneNo || "-"}</TableCell>
                        <TableCell className="font-medium" title={rev.milestoneName}>
                          <div className="truncate max-w-[180px]">{rev.milestoneName || "-"}</div>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {rev.milestonePercent ? `${(parseFloat(rev.milestonePercent) * 100).toFixed(0)}%` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(rev.milestoneAmount)}
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(rev.plannedPaymentDate)}</TableCell>

                        {/* Invoice Number */}
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={editValues.invoiceNumber}
                              onChange={(e) => setEditValues({ ...editValues, invoiceNumber: e.target.value })}
                              className="h-8 text-sm"
                              placeholder="INV-XXX"
                              data-testid={`input-invoice-${rev.rowNumber}`}
                            />
                          ) : (
                            <span className="font-mono text-sm">{rev.milestoneInvoiceNumber || "-"}</span>
                          )}
                        </TableCell>

                        {/* Invoice Raised Date */}
                        <TableCell>
                          {isEditing ? (
                            <Input
                              type="date"
                              value={editValues.invoiceRaisedDate}
                              onChange={(e) => setEditValues({ ...editValues, invoiceRaisedDate: e.target.value })}
                              className="h-8 text-sm w-[120px]"
                              data-testid={`input-invoiced-${rev.rowNumber}`}
                            />
                          ) : (
                            <span className="text-sm">{formatDate(rev.invoiceRaisedDate)}</span>
                          )}
                        </TableCell>

                        {/* Payment Received Date */}
                        <TableCell>
                          {isEditing ? (
                            <Input
                              type="date"
                              value={editValues.paymentReceivedDate}
                              onChange={(e) => setEditValues({ ...editValues, paymentReceivedDate: e.target.value })}
                              className="h-8 text-sm w-[120px]"
                              data-testid={`input-received-${rev.rowNumber}`}
                            />
                          ) : (
                            <span className={`text-sm ${rev.paymentReceivedDate && !isInBank(rev.inBank) ? 'text-red-600 font-medium' : ''}`}>
                              {formatDate(rev.paymentReceivedDate)}
                            </span>
                          )}
                        </TableCell>

                        {/* In Bank Checkbox */}
                        <TableCell className="text-center">
                          {isEditing ? (
                            <Checkbox
                              checked={editValues.inBank}
                              onCheckedChange={(checked) => setEditValues({ ...editValues, inBank: !!checked })}
                              data-testid={`checkbox-inbank-${rev.rowNumber}`}
                            />
                          ) : (
                            <div className="flex justify-center">
                              {isInBank(rev.inBank) ? (
                                <Check className="h-5 w-5 text-green-600" />
                              ) : rev.paymentReceivedDate ? (
                                <X className="h-5 w-5 text-red-500" />
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </div>
                          )}
                        </TableCell>

                        {/* Status Badge */}
                        <TableCell>
                          {status === "inBank" ? (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-xs">
                              <BanknoteIcon className="h-3 w-3 mr-1" /> In Bank
                            </Badge>
                          ) : status === "received" ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                              <AlertCircle className="h-3 w-3 mr-1" /> Pending
                            </Badge>
                          ) : status === "invoiced" ? (
                            <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs">
                              <Clock className="h-3 w-3 mr-1" /> Invoiced
                            </Badge>
                          ) : status === "planned" ? (
                            <Badge variant="outline" className="text-xs">
                              <Clock className="h-3 w-3 mr-1" /> Planned
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              <AlertCircle className="h-3 w-3 mr-1" /> Pending
                            </Badge>
                          )}
                        </TableCell>

                        {/* Actions */}
                        <TableCell>
                          {isEditing ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => saveRowEdits(rev.rowNumber)}
                                disabled={saveMutation.isPending}
                                data-testid={`button-save-${rev.rowNumber}`}
                              >
                                <Save className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={cancelEditing}
                                data-testid={`button-cancel-${rev.rowNumber}`}
                              >
                                <XCircle className="h-4 w-4 text-gray-500" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => startEditing(rev)}
                              data-testid={`button-edit-${rev.rowNumber}`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Revenue Notes</CardTitle>
              <CardDescription>Financial review notes and timeline observations</CardDescription>
            </div>
            {!notesEditing && (
              <Button variant="outline" size="sm" onClick={() => setNotesEditing(true)}>
                <Edit2 className="h-4 w-4 mr-1" /> Edit Notes
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Financial Review</label>
              {notesEditing ? (
                <Textarea
                  value={notes.financialReview}
                  onChange={(e) => setNotes({ ...notes, financialReview: e.target.value })}
                  placeholder="Add financial review notes..."
                  className="min-h-[100px]"
                  data-testid="textarea-financial-review"
                />
              ) : (
                <div className="p-3 bg-muted/30 rounded-md min-h-[100px] text-sm">
                  {notes.financialReview || <span className="text-muted-foreground italic">No financial review notes</span>}
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Timeline Review</label>
              {notesEditing ? (
                <Textarea
                  value={notes.timelineReview}
                  onChange={(e) => setNotes({ ...notes, timelineReview: e.target.value })}
                  placeholder="Add timeline review notes..."
                  className="min-h-[100px]"
                  data-testid="textarea-timeline-review"
                />
              ) : (
                <div className="p-3 bg-muted/30 rounded-md min-h-[100px] text-sm">
                  {notes.timelineReview || <span className="text-muted-foreground italic">No timeline review notes</span>}
                </div>
              )}
            </div>
          </div>
          {notesEditing && (
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setNotesEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => {
                setNotesEditing(false);
                toast({ title: "Notes saved", description: "Revenue notes updated successfully" });
              }}>
                <Save className="h-4 w-4 mr-1" /> Save Notes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

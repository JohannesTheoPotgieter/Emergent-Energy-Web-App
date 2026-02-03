import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { Save, RotateCcw, Loader2, ChevronDown, ChevronRight, Filter } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ProgramExpense {
  id: number;
  projectName: string;
  rowNumber: number;
  rowType: string;
  expenseCategory: string | null;
  expenseLineItem: string | null;
  budgetQty: string | null;
  budgetRateUnit: string | null;
  budgetTotal: string | null;
  forecastPaymentDate: string | null;
  budgetCosTotal: string | null;
  expenseQty: string | null;
  expenseRateUnit: string | null;
  expenseActualTotal: string | null;
  expensePoNumber: string | null;
  expenseInvoiceNumber: string | null;
  expenseInvoicedDate: string | null;
  expensePaymentDate: string | null;
  actualCosTotal: string | null;
  lineStatus: string | null;
}

interface ExpenditureEditableTabProps {
  projectName: string;
}

const formatCurrency = (value: string | number | null): string => {
  if (value === null || value === undefined) return "-";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "-";
  return `R ${num.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (value: string | null): string => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return value;
  }
};

const getStatusBadge = (status: string | null) => {
  if (!status) return null;
  const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    Planned: "secondary",
    Committed: "outline",
    Invoiced: "default",
    Paid: "default",
  };
  const colors: Record<string, string> = {
    Planned: "bg-gray-100 text-gray-700",
    Committed: "bg-blue-100 text-blue-700",
    Invoiced: "bg-amber-100 text-amber-700",
    Paid: "bg-green-100 text-green-700",
  };
  return (
    <Badge className={`text-xs ${colors[status] || ""}`} variant={variants[status] || "secondary"}>
      {status}
    </Badge>
  );
};

export function ExpenditureEditableTab({ projectName }: ExpenditureEditableTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Map<number, Record<string, string>>>(new Map());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const queryKey = [`/api/program-expenses/${projectName}?applyOverrides=true`];

  const { data: expenses = [], isLoading, error } = useQuery<ProgramExpense[]>({
    queryKey,
  });

  const saveMutation = useMutation({
    mutationFn: async (overrides: { projectName: string; rowNumber: number; fieldName: string; overrideValue: string }[]) => {
      const response = await fetch("/api/expenditure-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (!response.ok) throw new Error("Failed to save overrides");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEdits(new Map());
      toast({
        title: "Changes Saved",
        description: "Expenditure edits have been saved successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: getErrorMessage(error, "Failed to save edits"),
        variant: "destructive",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/expenditure-overrides/${projectName}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to reset overrides");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEdits(new Map());
      toast({
        title: "Overrides Reset",
        description: "All edits have been cleared and tracker data restored.",
      });
    },
    onError: (error) => {
      toast({
        title: "Reset Failed",
        description: getErrorMessage(error, "Failed to reset overrides"),
        variant: "destructive",
      });
    },
  });

  const kpis = useMemo(() => {
    const items = expenses.filter(e => e.rowType === "item");
    const totalBudget = items.reduce((sum, e) => sum + (parseFloat(e.budgetTotal || "0")), 0);
    const totalActual = items.reduce((sum, e) => sum + (parseFloat(e.expenseActualTotal || "0")), 0);
    const totalInvoiced = items.filter(e => e.expenseInvoiceNumber && e.expenseInvoicedDate).reduce((sum, e) => sum + (parseFloat(e.actualCosTotal || e.expenseActualTotal || "0")), 0);
    const totalPaid = items.filter(e => e.expensePaymentDate).reduce((sum, e) => sum + (parseFloat(e.expenseActualTotal || "0")), 0);
    const variance = totalBudget - totalActual;
    
    const countByStatus = {
      Planned: items.filter(e => e.lineStatus === "Planned").length,
      Committed: items.filter(e => e.lineStatus === "Committed").length,
      Invoiced: items.filter(e => e.lineStatus === "Invoiced").length,
      Paid: items.filter(e => e.lineStatus === "Paid").length,
    };

    return { totalBudget, totalActual, totalInvoiced, totalPaid, variance, countByStatus, totalItems: items.length };
  }, [expenses]);

  const displayData = useMemo(() => {
    let filtered = expenses.map((row) => {
      const rowEdits = edits.get(row.id);
      if (!rowEdits) return row;
      return { ...row, ...rowEdits };
    });

    if (statusFilter !== "all") {
      filtered = filtered.filter(e => e.lineStatus === statusFilter || e.rowType === "category");
    }

    return filtered;
  }, [expenses, edits, statusFilter]);

  const handleCellEdit = (rowId: number, field: string, value: string) => {
    const newEdits = new Map(edits);
    const rowEdits = newEdits.get(rowId) || {};
    rowEdits[field] = value;
    newEdits.set(rowId, rowEdits);
    setEdits(newEdits);
  };

  const handleSave = async () => {
    const overrides = Array.from(edits.entries()).flatMap(([rowId, rowEdits]) => {
      const originalRow = expenses.find((r) => r.id === rowId);
      if (!originalRow) return [];
      
      return Object.entries(rowEdits).map(([field, value]) => ({
        projectName,
        rowNumber: originalRow.rowNumber || rowId,
        fieldName: field,
        overrideValue: String(value),
      }));
    });
    await saveMutation.mutateAsync(overrides);
  };

  const handleReset = async () => {
    await resetMutation.mutateAsync();
  };

  const toggleCategory = (category: string) => {
    const newCollapsed = new Set(collapsedCategories);
    if (newCollapsed.has(category)) {
      newCollapsed.delete(category);
    } else {
      newCollapsed.add(category);
    }
    setCollapsedCategories(newCollapsed);
  };

  const hasEdits = edits.size > 0;

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
          <p className="text-center text-destructive">Failed to load expenditure data</p>
        </CardContent>
      </Card>
    );
  }

  let currentCategory = "";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Budget Total</div>
            <div className="text-xl font-bold text-blue-600">{formatCurrency(kpis.totalBudget)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Actual Total</div>
            <div className="text-xl font-bold">{formatCurrency(kpis.totalActual)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Variance</div>
            <div className={`text-xl font-bold ${kpis.variance >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(kpis.variance)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">COS Realised</div>
            <div className="text-xl font-bold text-amber-600">{formatCurrency(kpis.totalInvoiced)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Paid</div>
            <div className="text-xl font-bold text-green-600">{formatCurrency(kpis.totalPaid)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Line Items</div>
            <div className="text-xl font-bold">{kpis.totalItems}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>Expenditure Breakdown</CardTitle>
              <CardDescription>
                Budget vs Actual expenditure with PO/Invoice tracking
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All ({kpis.totalItems})</SelectItem>
                    <SelectItem value="Planned">Planned ({kpis.countByStatus.Planned})</SelectItem>
                    <SelectItem value="Committed">Committed ({kpis.countByStatus.Committed})</SelectItem>
                    <SelectItem value="Invoiced">Invoiced ({kpis.countByStatus.Invoiced})</SelectItem>
                    <SelectItem value="Paid">Paid ({kpis.countByStatus.Paid})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleSave}
                disabled={!hasEdits || saveMutation.isPending}
                variant="default"
                size="sm"
              >
                <Save className="h-4 w-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                onClick={handleReset}
                disabled={resetMutation.isPending}
                variant="outline"
                size="sm"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {displayData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No expenditure data available for this project
            </p>
          ) : (
            <div className="rounded-md border overflow-auto max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="sticky left-0 bg-muted/50 z-10 min-w-[200px]">Description</TableHead>
                    <TableHead className="text-right min-w-[100px]">Budget Qty</TableHead>
                    <TableHead className="text-right min-w-[100px]">Budget Rate</TableHead>
                    <TableHead className="text-right min-w-[120px]">Budget Total</TableHead>
                    <TableHead className="min-w-[100px]">Fcst Pay Date</TableHead>
                    <TableHead className="text-right min-w-[100px]">Actual Total</TableHead>
                    <TableHead className="min-w-[100px]">PO Number</TableHead>
                    <TableHead className="min-w-[100px]">Invoice No</TableHead>
                    <TableHead className="min-w-[100px]">Invoice Date</TableHead>
                    <TableHead className="min-w-[100px]">Payment Date</TableHead>
                    <TableHead className="text-right min-w-[100px]">COS Total</TableHead>
                    <TableHead className="min-w-[80px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayData.map((exp) => {
                    if (exp.rowType === "category") {
                      currentCategory = exp.expenseCategory || "";
                      const isCollapsed = collapsedCategories.has(currentCategory);
                      return (
                        <TableRow
                          key={exp.id}
                          className="bg-emerald-50 hover:bg-emerald-100 cursor-pointer"
                          onClick={() => toggleCategory(currentCategory)}
                        >
                          <TableCell colSpan={12} className="font-semibold text-emerald-800">
                            <div className="flex items-center gap-2">
                              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              {exp.expenseCategory}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }

                    if (exp.rowType === "subtotal") {
                      return (
                        <TableRow key={exp.id} className="bg-gray-100 font-medium">
                          <TableCell className="sticky left-0 bg-gray-100">{exp.expenseLineItem || "Sub Total"}</TableCell>
                          <TableCell></TableCell>
                          <TableCell></TableCell>
                          <TableCell className="text-right">{formatCurrency(exp.budgetTotal)}</TableCell>
                          <TableCell></TableCell>
                          <TableCell className="text-right">{formatCurrency(exp.expenseActualTotal)}</TableCell>
                          <TableCell></TableCell>
                          <TableCell></TableCell>
                          <TableCell></TableCell>
                          <TableCell></TableCell>
                          <TableCell className="text-right">{formatCurrency(exp.actualCosTotal)}</TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      );
                    }

                    if (collapsedCategories.has(exp.expenseCategory || "")) {
                      return null;
                    }

                    const rowId = exp.id;
                    const EditableCell = ({ field, value, type = "text", align = "left" }: { field: string; value: string | null; type?: string; align?: string }) => {
                      const cellKey = `${rowId}-${field}`;
                      const isEditing = editingCell === cellKey;
                      const displayValue = type === "currency" ? formatCurrency(value) : (type === "date" ? formatDate(value) : (value || "-"));

                      return isEditing ? (
                        <Input
                          type={type === "currency" ? "number" : "text"}
                          defaultValue={value || ""}
                          onChange={(e) => handleCellEdit(rowId, field, e.target.value)}
                          onBlur={() => setEditingCell(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") setEditingCell(null);
                          }}
                          autoFocus
                          className="h-7 text-sm"
                        />
                      ) : (
                        <span
                          onClick={() => setEditingCell(cellKey)}
                          className={`cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded block ${align === "right" ? "text-right font-mono" : ""}`}
                        >
                          {displayValue}
                        </span>
                      );
                    };

                    return (
                      <TableRow key={rowId} className="hover:bg-muted/30">
                        <TableCell className="sticky left-0 bg-background z-10">
                          <div className="max-w-[200px] truncate" title={exp.expenseLineItem || ""}>
                            {exp.expenseLineItem || "-"}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{exp.budgetQty || "-"}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(exp.budgetRateUnit)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(exp.budgetTotal)}</TableCell>
                        <TableCell className="text-sm">{formatDate(exp.forecastPaymentDate)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(exp.expenseActualTotal)}</TableCell>
                        <TableCell>
                          <EditableCell field="expensePoNumber" value={exp.expensePoNumber} />
                        </TableCell>
                        <TableCell>
                          <EditableCell field="expenseInvoiceNumber" value={exp.expenseInvoiceNumber} />
                        </TableCell>
                        <TableCell>
                          <EditableCell field="expenseInvoicedDate" value={exp.expenseInvoicedDate} type="date" />
                        </TableCell>
                        <TableCell>
                          <EditableCell field="expensePaymentDate" value={exp.expensePaymentDate} type="date" />
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(exp.actualCosTotal)}</TableCell>
                        <TableCell>{getStatusBadge(exp.lineStatus)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {hasEdits && (
            <div className="mt-4 text-sm text-muted-foreground">
              {edits.size} {edits.size === 1 ? "row" : "rows"} modified. Click "Save Changes" to persist edits.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

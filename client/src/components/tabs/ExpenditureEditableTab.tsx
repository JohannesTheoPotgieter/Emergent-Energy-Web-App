import React, { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { 
  Save, RotateCcw, Loader2, ChevronDown, ChevronRight, Filter, 
  Columns, ChevronsUpDown, ChevronsDownUp 
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  invoiceDateConfirmed: boolean | null;
  invoiceDateFontColor: string | null;
  expensePaymentDate: string | null;
  paymentDateConfirmed: boolean | null;
  paymentDateFontColor: string | null;
  actualCosTotal: string | null;
  lineStatus: string | null;
}

interface CategoryGroup {
  category: string;
  items: ProgramExpense[];
  budgetTotal: number;
  actualTotal: number;
  variance: number;
}

interface ExpenditureEditableTabProps {
  projectName: string;
}

type ColumnKey = 
  | "description" | "budgetQty" | "budgetRate" | "budgetTotal" 
  | "forecastDate" | "actualTotal" | "poNumber" | "invoiceNo" 
  | "invoiceDate" | "paymentDate" | "cosTotal" | "status" | "variance";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  align: "left" | "center" | "right";
  minWidth: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "description", label: "Description", defaultVisible: true, align: "left", minWidth: "200px" },
  { key: "budgetQty", label: "Budget Qty", defaultVisible: false, align: "right", minWidth: "90px" },
  { key: "budgetRate", label: "Budget Rate", defaultVisible: false, align: "right", minWidth: "100px" },
  { key: "budgetTotal", label: "Budget Total", defaultVisible: true, align: "right", minWidth: "120px" },
  { key: "forecastDate", label: "Fcst Pay Date", defaultVisible: false, align: "center", minWidth: "100px" },
  { key: "actualTotal", label: "Actual Total", defaultVisible: true, align: "right", minWidth: "120px" },
  { key: "poNumber", label: "PO Number", defaultVisible: true, align: "left", minWidth: "120px" },
  { key: "invoiceNo", label: "Invoice No", defaultVisible: true, align: "left", minWidth: "120px" },
  { key: "invoiceDate", label: "Invoice Date", defaultVisible: true, align: "center", minWidth: "100px" },
  { key: "paymentDate", label: "Payment Date", defaultVisible: true, align: "center", minWidth: "100px" },
  { key: "cosTotal", label: "COS Total", defaultVisible: false, align: "right", minWidth: "110px" },
  { key: "status", label: "Status", defaultVisible: true, align: "center", minWidth: "80px" },
  { key: "variance", label: "Variance", defaultVisible: true, align: "right", minWidth: "110px" },
];

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
  if (!status) return <span className="text-muted-foreground text-xs">-</span>;
  const colors: Record<string, string> = {
    Planned: "bg-slate-100 text-slate-600 border-slate-200",
    Committed: "bg-blue-50 text-blue-600 border-blue-200",
    Invoiced: "bg-amber-50 text-amber-600 border-amber-200",
    Paid: "bg-emerald-50 text-emerald-600 border-emerald-200",
  };
  return (
    <Badge className={`text-[10px] font-medium px-1.5 py-0 border ${colors[status] || "bg-gray-100"}`} variant="outline">
      {status}
    </Badge>
  );
};

export function ExpenditureEditableTab({ projectName }: ExpenditureEditableTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tableContainerRef = useRef<HTMLDivElement>(null);
  
  const [edits, setEdits] = useState<Map<number, Record<string, string>>>(new Map());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [showSubtotals, setShowSubtotals] = useState<boolean>(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    return new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key));
  });

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
      toast({ title: "Changes Saved", description: "Expenditure edits have been saved successfully." });
    },
    onError: (error) => {
      toast({ title: "Save Failed", description: getErrorMessage(error, "Failed to save edits"), variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/expenditure-overrides/${projectName}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to reset overrides");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEdits(new Map());
      toast({ title: "Overrides Reset", description: "All edits have been cleared and tracker data restored." });
    },
    onError: (error) => {
      toast({ title: "Reset Failed", description: getErrorMessage(error, "Failed to reset overrides"), variant: "destructive" });
    },
  });

  const kpis = useMemo(() => {
    const items = expenses.filter(e => e.rowType === "item");
    const totalBudget = items.reduce((sum, e) => sum + (parseFloat(e.budgetTotal || "0")), 0);
    const totalActual = items.reduce((sum, e) => sum + (parseFloat(e.expenseActualTotal || "0")), 0);
    const totalInvoiced = items.filter(e => e.expenseInvoiceNumber && e.expenseInvoicedDate)
      .reduce((sum, e) => sum + (parseFloat(e.actualCosTotal || e.expenseActualTotal || "0")), 0);
    const totalPaid = items.filter(e => e.expensePaymentDate)
      .reduce((sum, e) => sum + (parseFloat(e.expenseActualTotal || "0")), 0);
    const variance = totalBudget - totalActual;
    
    const countByStatus = {
      Planned: items.filter(e => e.lineStatus === "Planned").length,
      Committed: items.filter(e => e.lineStatus === "Committed").length,
      Invoiced: items.filter(e => e.lineStatus === "Invoiced").length,
      Paid: items.filter(e => e.lineStatus === "Paid").length,
    };

    return { totalBudget, totalActual, totalInvoiced, totalPaid, variance, countByStatus, totalItems: items.length };
  }, [expenses]);

  const normalizedData = useMemo(() => {
    let data = expenses.map((row) => {
      const rowEdits = edits.get(row.id);
      return rowEdits ? { ...row, ...rowEdits } : row;
    });

    // Filter out blank rows (all meaningful fields empty)
    data = data.filter(row => {
      if (row.rowType === "category") return true;
      if (row.rowType === "subtotal") return showSubtotals;
      
      // Check if row has any meaningful content
      const hasDescription = row.expenseLineItem && row.expenseLineItem.trim();
      const hasBudget = row.budgetTotal && parseFloat(row.budgetTotal) !== 0;
      const hasActual = row.expenseActualTotal && parseFloat(row.expenseActualTotal) !== 0;
      const hasPO = row.expensePoNumber && row.expensePoNumber.trim();
      const hasInvoice = row.expenseInvoiceNumber && row.expenseInvoiceNumber.trim();
      
      return hasDescription || hasBudget || hasActual || hasPO || hasInvoice;
    });

    // Apply status filter
    if (statusFilter !== "all") {
      data = data.filter(e => e.lineStatus === statusFilter || e.rowType === "category");
    }

    // Collapse consecutive duplicate category headers and remove orphan categories
    const cleanedData: ProgramExpense[] = [];
    let lastCategory = "";
    let categoryHasItems = false;
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      if (row.rowType === "category") {
        const cat = row.expenseCategory || "";
        if (cat === lastCategory) continue; // Skip duplicate
        
        // Check if this category has any items
        const hasItems = data.slice(i + 1).some(r => {
          if (r.rowType === "category") return false;
          return r.rowType === "item" && r.expenseCategory === cat;
        });
        
        if (hasItems || i === 0) {
          if (lastCategory && !categoryHasItems && cleanedData.length > 0) {
            // Remove previous orphan category
            const lastIdx = cleanedData.length - 1;
            if (cleanedData[lastIdx].rowType === "category") {
              cleanedData.pop();
            }
          }
          cleanedData.push(row);
          lastCategory = cat;
          categoryHasItems = hasItems;
        }
      } else {
        cleanedData.push(row);
        categoryHasItems = true;
      }
    }

    return cleanedData;
  }, [expenses, edits, statusFilter, showSubtotals]);

  const categoryGroups = useMemo(() => {
    const groups: CategoryGroup[] = [];
    let currentGroup: CategoryGroup | null = null;

    for (const row of normalizedData) {
      if (row.rowType === "category") {
        if (currentGroup) groups.push(currentGroup);
        currentGroup = {
          category: row.expenseCategory || "Panels",
          items: [],
          budgetTotal: 0,
          actualTotal: 0,
          variance: 0,
        };
      } else if (row.rowType === "item" && currentGroup) {
        currentGroup.items.push(row);
        const budget = parseFloat(row.budgetTotal || "0");
        const actual = parseFloat(row.expenseActualTotal || "0");
        currentGroup.budgetTotal += budget;
        currentGroup.actualTotal += actual;
        currentGroup.variance += budget - actual;
      } else if (row.rowType === "item" && !currentGroup) {
        currentGroup = {
          category: "Panels",
          items: [row],
          budgetTotal: parseFloat(row.budgetTotal || "0"),
          actualTotal: parseFloat(row.expenseActualTotal || "0"),
          variance: parseFloat(row.budgetTotal || "0") - parseFloat(row.expenseActualTotal || "0"),
        };
      }
    }
    
    if (currentGroup) groups.push(currentGroup);
    return groups;
  }, [normalizedData]);

  const handleCellEdit = useCallback((rowId: number, field: string, value: string) => {
    setEdits(prev => {
      const newEdits = new Map(prev);
      const rowEdits = newEdits.get(rowId) || {};
      rowEdits[field] = value;
      newEdits.set(rowId, rowEdits);
      return newEdits;
    });
  }, []);

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

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsedCategories(new Set()), []);
  const collapseAll = useCallback(() => {
    setCollapsedCategories(new Set(categoryGroups.map(g => g.category)));
  }, [categoryGroups]);

  const toggleColumn = useCallback((col: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }, []);

  const hasEdits = edits.size > 0;
  const activeColumns = COLUMNS.filter(c => visibleColumns.has(c.key));

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

  const EditableCell = ({ rowId, field, value, type = "text", colorClass = "" }: { rowId: number; field: string; value: string | null; type?: string; colorClass?: string }) => {
    const cellKey = `${rowId}-${field}`;
    const isEditing = editingCell === cellKey;
    const displayValue = type === "currency" ? formatCurrency(value) : (type === "date" ? formatDate(value) : (value || "-"));

    return isEditing ? (
      <Input
        type={type === "currency" ? "number" : "text"}
        defaultValue={value || ""}
        onChange={(e) => handleCellEdit(rowId, field, e.target.value)}
        onBlur={() => setEditingCell(null)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingCell(null); }}
        autoFocus
        className="h-6 text-xs w-full"
      />
    ) : (
      <span
        onClick={() => setEditingCell(cellKey)}
        className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded block text-xs truncate ${colorClass}`}
      >
        {displayValue}
      </span>
    );
  };

  const renderCellValue = (exp: ProgramExpense, col: ColumnDef) => {
    const rowId = exp.id;
    const variance = (parseFloat(exp.budgetTotal || "0") - parseFloat(exp.expenseActualTotal || "0"));
    
    switch (col.key) {
      case "description":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="truncate block max-w-[200px] text-xs">{exp.expenseLineItem || "-"}</span>
              </TooltipTrigger>
              {exp.expenseLineItem && exp.expenseLineItem.length > 30 && (
                <TooltipContent side="right" className="max-w-[300px]">
                  <p className="text-xs">{exp.expenseLineItem}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        );
      case "budgetQty":
        return <span className="text-xs font-mono">{exp.budgetQty || "-"}</span>;
      case "budgetRate":
        return <span className="text-xs font-mono">{formatCurrency(exp.budgetRateUnit)}</span>;
      case "budgetTotal":
        return <span className="text-xs font-mono">{formatCurrency(exp.budgetTotal)}</span>;
      case "forecastDate":
        return <span className="text-xs">{formatDate(exp.forecastPaymentDate)}</span>;
      case "actualTotal":
        return <span className="text-xs font-mono">{formatCurrency(exp.expenseActualTotal)}</span>;
      case "poNumber":
        return <EditableCell rowId={rowId} field="expensePoNumber" value={exp.expensePoNumber} />;
      case "invoiceNo":
        return <EditableCell rowId={rowId} field="expenseInvoiceNumber" value={exp.expenseInvoiceNumber} />;
      case "invoiceDate":
        return <EditableCell rowId={rowId} field="expenseInvoicedDate" value={exp.expenseInvoicedDate} type="date" colorClass={exp.invoiceDateFontColor === "red" ? "text-red-500" : ""} />;
      case "paymentDate":
        return <EditableCell rowId={rowId} field="expensePaymentDate" value={exp.expensePaymentDate} type="date" colorClass={exp.paymentDateFontColor === "red" ? "text-red-500" : ""} />;
      case "cosTotal":
        return <span className="text-xs font-mono">{formatCurrency(exp.actualCosTotal)}</span>;
      case "status":
        return getStatusBadge(exp.lineStatus);
      case "variance":
        return (
          <span className={`text-xs font-mono ${variance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {formatCurrency(variance)}
          </span>
        );
      default:
        return "-";
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Budget Total</div>
            <div className="text-lg font-bold text-blue-600">{formatCurrency(kpis.totalBudget)}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Actual Total</div>
            <div className="text-lg font-bold">{formatCurrency(kpis.totalActual)}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Variance</div>
            <div className={`text-lg font-bold ${kpis.variance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {formatCurrency(kpis.variance)}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">COS Realised</div>
            <div className="text-lg font-bold text-amber-600">{formatCurrency(kpis.totalInvoiced)}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Paid</div>
            <div className="text-lg font-bold text-emerald-600">{formatCurrency(kpis.totalPaid)}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Line Items</div>
            <div className="text-lg font-bold">{kpis.totalItems}</div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-lg">Expenditure Breakdown</CardTitle>
              <CardDescription className="text-xs">Budget vs Actual with PO/Invoice tracking</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Expand/Collapse All */}
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={expandAll} className="h-8 px-2" title="Expand All">
                  <ChevronsDownUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={collapseAll} className="h-8 px-2" title="Collapse All">
                  <ChevronsUpDown className="h-4 w-4" />
                </Button>
              </div>

              {/* Column Visibility */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    <Columns className="h-4 w-4 mr-1" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {COLUMNS.map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.key}
                      checked={visibleColumns.has(col.key)}
                      onCheckedChange={() => toggleColumn(col.key)}
                    >
                      {col.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Status Filter */}
              <div className="flex items-center gap-1">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[130px] h-8 text-xs">
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

              {/* Save/Reset */}
              <Button onClick={handleSave} disabled={!hasEdits || saveMutation.isPending} size="sm" className="h-8">
                <Save className="h-4 w-4 mr-1" />
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button onClick={handleReset} disabled={resetMutation.isPending} variant="outline" size="sm" className="h-8">
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {categoryGroups.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No expenditure data available</p>
          ) : (
            <div 
              ref={tableContainerRef}
              className="relative overflow-auto border-t"
              style={{ maxHeight: "calc(100vh - 380px)", minHeight: "400px" }}
            >
              <table className="w-full border-collapse text-sm">
                {/* Sticky Header */}
                <thead className="sticky top-0 z-20 bg-slate-50 border-b shadow-sm">
                  <tr>
                    {activeColumns.map((col, idx) => (
                      <th
                        key={col.key}
                        className={`px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap border-b
                          ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                          ${idx === 0 ? "sticky left-0 z-30 bg-slate-50" : ""}`}
                        style={{ minWidth: col.minWidth }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {categoryGroups.map((group) => {
                    const isCollapsed = collapsedCategories.has(group.category);
                    
                    return (
                      <React.Fragment key={group.category}>
                        {/* Category Header Row */}
                        <tr
                          className="bg-emerald-50 hover:bg-emerald-100 cursor-pointer border-b border-emerald-100"
                          onClick={() => toggleCategory(group.category)}
                        >
                          <td 
                            className="sticky left-0 z-10 bg-emerald-50 px-3 py-2"
                            colSpan={1}
                          >
                            <div className="flex items-center gap-2">
                              {isCollapsed ? (
                                <ChevronRight className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-emerald-600" />
                              )}
                              <span className="font-semibold text-emerald-800 text-sm">{group.category}</span>
                              <Badge variant="outline" className="text-[10px] ml-2 bg-white">
                                {group.items.length} items
                              </Badge>
                            </div>
                          </td>
                          {activeColumns.slice(1).map((col) => (
                            <td key={col.key} className={`px-3 py-2 text-xs font-medium text-emerald-700 
                              ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}>
                              {col.key === "budgetTotal" && formatCurrency(group.budgetTotal)}
                              {col.key === "actualTotal" && formatCurrency(group.actualTotal)}
                              {col.key === "variance" && (
                                <span className={group.variance >= 0 ? "text-emerald-600" : "text-red-600"}>
                                  {formatCurrency(group.variance)}
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>

                        {/* Item Rows */}
                        {!isCollapsed && group.items.map((exp, rowIdx) => (
                          <tr
                            key={exp.id}
                            className={`border-b border-slate-100 hover:bg-blue-50/50 transition-colors
                              ${rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}
                          >
                            {activeColumns.map((col, colIdx) => (
                              <td
                                key={col.key}
                                className={`px-3 py-1.5
                                  ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                                  ${colIdx === 0 ? "sticky left-0 z-10 bg-inherit" : ""}`}
                                style={{ minWidth: col.minWidth }}
                              >
                                {renderCellValue(exp, col)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          
          {hasEdits && (
            <div className="px-4 py-2 text-xs text-muted-foreground border-t bg-amber-50">
              {edits.size} {edits.size === 1 ? "row" : "rows"} modified. Click "Save" to persist edits.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

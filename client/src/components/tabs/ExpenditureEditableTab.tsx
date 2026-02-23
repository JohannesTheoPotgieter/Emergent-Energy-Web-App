import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateDashboardQueries } from "@/lib/queryClient";
import { PermissionGate } from "@/components/PermissionGate";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import {
  Save, RotateCcw, Loader2, ChevronDown, ChevronRight, Filter,
  Columns, ChevronsUpDown, ChevronsDownUp, Plus, Link, Unlink,
  X, Search, ListPlus, ClipboardList, CalendarIcon, Palette
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, parse, isValid } from "date-fns";

interface EnrichedExpense {
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
  linkedTask: { id: number; title: string; status: string; dueDate: string | null; isBaseline: boolean } | null;
  cosStatus: string;
  paymentStatus: string;
  effectivePaymentDate: string | null;
  plannedMonth: string | null;
  hasDateOverride: boolean;
  dateOverrideReason: string | null;
}

interface CategoryGroup {
  category: string;
  items: EnrichedExpense[];
  budgetTotal: number;
  actualTotal: number;
  variance: number;
}

interface ExpenditureEditableTabProps {
  projectName: string;
  highlightId?: number | null;
}

type ColumnKey =
  | "description" | "actualTotal" | "poNumber" | "invoiceNo"
  | "invoiceDate" | "paymentDate" | "linkedTask" | "cosStatus"
  | "paymentStatus" | "plannedMonth" | "budgetTotal" | "variance";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  align: "left" | "center" | "right";
  minWidth: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "description", label: "Description", defaultVisible: true, align: "left", minWidth: "200px" },
  { key: "actualTotal", label: "Actual Total", defaultVisible: true, align: "right", minWidth: "120px" },
  { key: "poNumber", label: "PO Number", defaultVisible: true, align: "left", minWidth: "110px" },
  { key: "invoiceNo", label: "Invoice No", defaultVisible: true, align: "left", minWidth: "110px" },
  { key: "invoiceDate", label: "Invoice Date", defaultVisible: true, align: "center", minWidth: "100px" },
  { key: "paymentDate", label: "Finance Pay Date", defaultVisible: true, align: "center", minWidth: "110px" },
  { key: "linkedTask", label: "Linked Task", defaultVisible: true, align: "left", minWidth: "150px" },
  { key: "cosStatus", label: "COS Status", defaultVisible: true, align: "center", minWidth: "110px" },
  { key: "paymentStatus", label: "Payment Status", defaultVisible: true, align: "center", minWidth: "110px" },
  { key: "plannedMonth", label: "Planned Month", defaultVisible: true, align: "center", minWidth: "100px" },
  { key: "budgetTotal", label: "Budget Total", defaultVisible: false, align: "right", minWidth: "120px" },
  { key: "variance", label: "Variance", defaultVisible: false, align: "right", minWidth: "110px" },
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

const formatMonth = (value: string | null): string => {
  if (!value) return "-";
  try {
    const [yr, mo] = value.split("-");
    const d = new Date(parseInt(yr), parseInt(mo) - 1, 1);
    return d.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
  } catch {
    return value;
  }
};

const getCosStatusBadge = (status: string) => {
  const colors: Record<string, string> = {
    "COS Realised": "bg-emerald-50 text-emerald-700 border-emerald-300",
    "Not Yet Realised": "bg-amber-50 text-amber-700 border-amber-300",
    "Planned": "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <Badge className={`text-[9px] font-medium px-1.5 py-0 border whitespace-nowrap ${colors[status] || "bg-gray-100"}`} variant="outline">
      {status}
    </Badge>
  );
};

const getPaymentStatusBadge = (status: string) => {
  const colors: Record<string, string> = {
    "Paid": "bg-emerald-50 text-emerald-700 border-emerald-300",
    "Payment Planned": "bg-blue-50 text-blue-600 border-blue-200",
    "Invoiced": "bg-amber-50 text-amber-600 border-amber-200",
    "Committed": "bg-purple-50 text-purple-600 border-purple-200",
    "Planned": "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <Badge className={`text-[9px] font-medium px-1.5 py-0 border whitespace-nowrap ${colors[status] || "bg-gray-100"}`} variant="outline">
      {status}
    </Badge>
  );
};

export function ExpenditureEditableTab({ projectName, highlightId }: ExpenditureEditableTabProps) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const [edits, setEdits] = useState<Map<number, Record<string, string>>>(new Map());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    return new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key));
  });
  const [linkingExpenseId, setLinkingExpenseId] = useState<number | null>(null);
  const [taskSearchTerm, setTaskSearchTerm] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerFilter, setDrawerFilter] = useState<Record<string, string>>({});
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [insertTaskOpen, setInsertTaskOpen] = useState(false);
  const [newLineData, setNewLineData] = useState({ category: "", description: "", amount: "", poNumber: "", invoiceNo: "", invoiceDate: "", paymentDate: "" });
  const [newCategoryName, setNewCategoryName] = useState("");
  const [insertTaskCategory, setInsertTaskCategory] = useState("");
  const [insertTaskSearch, setInsertTaskSearch] = useState("");
  const [highlightedRowId, setHighlightedRowId] = useState<number | null>(highlightId ?? null);

  const breakdownKey = ["expenditure-breakdown", projectName];

  const authHeaders = useCallback((): Record<string, string> => {
    const token = localStorage.getItem("auth_token");
    const h: Record<string, string> = {};
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, []);

  const authFetch = useCallback(async (url: string, opts: RequestInit = {}): Promise<Response> => {
    const headers = { ...authHeaders(), ...(opts.headers as Record<string, string> || {}) };
    return fetch(url, { ...opts, headers, credentials: "include" });
  }, [authHeaders]);

  const { data: breakdownData, isLoading, error } = useQuery<{ items: EnrichedExpense[]; categories: string[] }>({
    queryKey: breakdownKey,
    queryFn: async () => {
      const res = await authFetch(`/api/expenditure-breakdown/${encodeURIComponent(projectName)}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: projectTasks = [] } = useQuery<any[]>({
    queryKey: ["all-tasks-for-linking", projectName],
    queryFn: async () => {
      const [opRes, planRes] = await Promise.all([
        authFetch(`/api/operational-tasks/${encodeURIComponent(projectName)}`),
        authFetch(`/api/project-plan/${encodeURIComponent(projectName)}`),
      ]);
      const opTasks = opRes.ok ? await opRes.json() : [];
      const planTasks = planRes.ok ? await planRes.json() : [];
      const combinedOp = (opTasks || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        dueDate: t.dueDate,
        isBaseline: false,
      }));
      const combinedPlan = (planTasks || []).map((t: any) => {
        const pct = t.actualPctComplete != null ? Math.round(t.actualPctComplete * 100) : 0;
        let status = "Not Started";
        if (pct >= 100) status = "Done";
        else if (pct > 0) status = "In Progress";
        return {
          id: -t.id,
          title: t.highLevelProgramme || `Task ${t.taskNo || t.rowNumber}`,
          status,
          dueDate: t.actualEnd || null,
          isBaseline: true,
        };
      });
      return [...combinedOp, ...combinedPlan];
    },
    enabled: !!projectName,
  });

  const saveMutation = useMutation({
    mutationFn: async (overrides: { projectName: string; rowNumber: number; fieldName: string; overrideValue: string }[]) => {
      const response = await authFetch("/api/expenditure/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (!response.ok) throw new Error("Failed to save overrides");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        if (typeof key === 'string') {
          return key.startsWith('/api/cos-tracker') ||
                 key.startsWith('/api/cos-control') ||
                 key.startsWith('/api/cashflow-forecast') ||
                 key.startsWith('/api/cashflow-2026') ||
                 key.startsWith('/api/cashflow') ||
                 key.startsWith('/api/dashboard') ||
                 key.startsWith('/api/data-quality') ||
                 key.startsWith('/api/program-dashboard') ||
                 key === 'dashboard' ||
                 key === 'cashflow';
        }
        return false;
      }});
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      setEdits(new Map());
      toast({ title: "Changes Saved", description: "Expenditure edits saved and applied to all calculations." });
    },
    onError: (error) => {
      toast({ title: "Save Failed", description: getErrorMessage(error, "Failed to save edits"), variant: "destructive" });
    },
  });

  const linkTaskMutation = useMutation({
    mutationFn: async ({ expenseId, taskId }: { expenseId: number; taskId: number }) => {
      const res = await authFetch(`/api/expense-task-links/${encodeURIComponent(projectName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseId, taskId }),
      });
      if (!res.ok) throw new Error("Failed to link task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      setLinkingExpenseId(null);
      setTaskSearchTerm("");
      toast({ title: "Task linked", description: "Expense linked to task successfully" });
    },
  });

  const unlinkTaskMutation = useMutation({
    mutationFn: async (expenseId: number) => {
      const res = await authFetch(`/api/expense-task-links/${encodeURIComponent(projectName)}/${expenseId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to unlink task");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      toast({ title: "Task unlinked" });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await authFetch("/api/expenses/add-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, ...data }),
      });
      if (!res.ok) throw new Error("Failed to add line");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      invalidateDashboardQueries(queryClient);
      setAddLineOpen(false);
      setNewLineData({ category: "", description: "", amount: "", poNumber: "", invoiceNo: "", invoiceDate: "", paymentDate: "" });
      toast({ title: "Line item added" });
    },
  });

  const addCategoryMutation = useMutation({
    mutationFn: async (categoryName: string) => {
      const res = await authFetch("/api/expenses/add-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, categoryName }),
      });
      if (!res.ok) throw new Error("Failed to add category");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      setAddCategoryOpen(false);
      setNewCategoryName("");
      toast({ title: "Category added" });
    },
  });

  const insertTaskMutation = useMutation({
    mutationFn: async ({ taskId, expenseCategory }: { taskId: number; expenseCategory: string }) => {
      const res = await authFetch("/api/expenses/insert-task-as-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, taskId, expenseCategory }),
      });
      if (!res.ok) throw new Error("Failed to insert task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      invalidateDashboardQueries(queryClient);
      setInsertTaskOpen(false);
      setInsertTaskSearch("");
      setInsertTaskCategory("");
      toast({ title: "Task inserted as line item" });
    },
  });

  const items = breakdownData?.items || [];
  const categories = breakdownData?.categories || [];

  const kpis = useMemo(() => {
    const totalBudget = items.reduce((sum, e) => sum + (parseFloat(e.budgetTotal || "0")), 0);
    const totalActual = items.reduce((sum, e) => sum + (parseFloat(e.expenseActualTotal || "0")), 0);
    const cosRealised = items.filter(e => e.cosStatus === "COS Realised").reduce((s, e) => s + (parseFloat(e.expenseActualTotal || "0")), 0);
    const totalPaid = items.filter(e => e.paymentStatus === "Paid").reduce((s, e) => s + (parseFloat(e.expenseActualTotal || "0")), 0);
    const variance = totalBudget - totalActual;
    const countByCos = {
      "COS Realised": items.filter(e => e.cosStatus === "COS Realised").length,
      "Not Yet Realised": items.filter(e => e.cosStatus === "Not Yet Realised").length,
      "Planned": items.filter(e => e.cosStatus === "Planned").length,
    };
    const countByPayment = {
      "Paid": items.filter(e => e.paymentStatus === "Paid").length,
      "Payment Planned": items.filter(e => e.paymentStatus === "Payment Planned").length,
      "Invoiced": items.filter(e => e.paymentStatus === "Invoiced").length,
      "Committed": items.filter(e => e.paymentStatus === "Committed").length,
      "Planned": items.filter(e => e.paymentStatus === "Planned").length,
    };
    return { totalBudget, totalActual, cosRealised, totalPaid, variance, countByCos, countByPayment, totalItems: items.length };
  }, [items]);

  const filteredItems = useMemo(() => {
    let data = items.map((row) => {
      const rowEdits = edits.get(row.id);
      return rowEdits ? { ...row, ...rowEdits } : row;
    });
    data = data.filter(e => {
      const val = parseFloat(e.expenseActualTotal || "0");
      return !isNaN(val) && val !== 0;
    });
    if (statusFilter !== "all") {
      data = data.filter(e => e.cosStatus === statusFilter || e.paymentStatus === statusFilter);
    }
    return data;
  }, [items, edits, statusFilter]);

  const categoryGroups = useMemo(() => {
    const groupMap = new Map<string, CategoryGroup>();
    const groupOrder: string[] = [];
    for (const row of filteredItems) {
      const cat = row.expenseCategory || "Uncategorized";
      if (!groupMap.has(cat)) {
        groupMap.set(cat, { category: cat, items: [], budgetTotal: 0, actualTotal: 0, variance: 0 });
        groupOrder.push(cat);
      }
      const group = groupMap.get(cat)!;
      group.items.push(row);
      const budget = parseFloat(row.budgetTotal || "0");
      const actual = parseFloat(row.expenseActualTotal || "0");
      group.budgetTotal += budget;
      group.actualTotal += actual;
      group.variance += budget - actual;
    }
    const groups = groupOrder.map(name => groupMap.get(name)!).filter(g => g.items.length > 0);
    groups.sort((a, b) => {
      const numA = parseFloat(a.category) || Infinity;
      const numB = parseFloat(b.category) || Infinity;
      if (numA !== numB) return numA - numB;
      return a.category.localeCompare(b.category);
    });
    return groups;
  }, [filteredItems]);

  useEffect(() => {
    if (!highlightId || !categoryGroups.length) return;
    setHighlightedRowId(highlightId);
    for (const group of categoryGroups) {
      if (group.items.some(item => item.id === highlightId)) {
        setCollapsedCategories(prev => {
          const next = new Set(prev);
          next.delete(group.category);
          return next;
        });
        break;
      }
    }
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-row-id="${highlightId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 300);
    const clearTimer = setTimeout(() => setHighlightedRowId(null), 5000);
    return () => { clearTimeout(timer); clearTimeout(clearTimer); };
  }, [highlightId, categoryGroups]);

  const drawerItems = useMemo(() => {
    let data = [...items];
    if (drawerFilter.category) data = data.filter(e => e.expenseCategory === drawerFilter.category);
    if (drawerFilter.cosStatus) data = data.filter(e => e.cosStatus === drawerFilter.cosStatus);
    if (drawerFilter.paymentStatus) data = data.filter(e => e.paymentStatus === drawerFilter.paymentStatus);
    if (drawerFilter.invoiceNo) data = data.filter(e => e.expenseInvoiceNumber?.toLowerCase().includes(drawerFilter.invoiceNo.toLowerCase()));
    if (drawerFilter.poNumber) data = data.filter(e => e.expensePoNumber?.toLowerCase().includes(drawerFilter.poNumber.toLowerCase()));
    if (drawerFilter.plannedMonth) data = data.filter(e => e.plannedMonth === drawerFilter.plannedMonth);
    if (drawerFilter.taskLinked === "yes") data = data.filter(e => e.linkedTask);
    if (drawerFilter.taskLinked === "no") data = data.filter(e => !e.linkedTask);
    return data;
  }, [items, drawerFilter]);

  const filteredTasks = useMemo(() => {
    if (!taskSearchTerm.trim()) return projectTasks;
    const term = taskSearchTerm.toLowerCase();
    return projectTasks.filter((t: any) =>
      t.title?.toLowerCase().includes(term) ||
      t.taskNumber?.toLowerCase().includes(term) ||
      t.status?.toLowerCase().includes(term)
    );
  }, [projectTasks, taskSearchTerm]);

  const insertFilteredTasks = useMemo(() => {
    if (!insertTaskSearch.trim()) return projectTasks;
    const term = insertTaskSearch.toLowerCase();
    return projectTasks.filter((t: any) => t.title?.toLowerCase().includes(term));
  }, [projectTasks, insertTaskSearch]);

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
    const allItems = breakdownData?.items || [];
    const overrides = Array.from(edits.entries()).flatMap(([rowId, rowEdits]) => {
      const originalRow = allItems.find((r) => r.id === rowId);
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
    const isEditing = isAdmin && editingCell === cellKey;
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
        onClick={() => { if (isAdmin) setEditingCell(cellKey); }}
        className={`${isAdmin ? "cursor-pointer hover:bg-blue-50" : ""} px-1 py-0.5 rounded block text-xs truncate ${colorClass}`}
      >
        {displayValue}
      </span>
    );
  };

  const DatePickerCell = ({ rowId, field, value, fontColor, fontColorField }: {
    rowId: number; field: string; value: string | null; fontColor: string | null; fontColorField: string;
  }) => {
    const editedColor = edits.get(rowId)?.[fontColorField];
    const currentColor = editedColor !== undefined ? editedColor : (fontColor || "black");
    const isRed = currentColor === "red";

    const parseDate = (val: string | null): Date | undefined => {
      if (!val) return undefined;
      try {
        const d = new Date(val);
        return isValid(d) ? d : undefined;
      } catch { return undefined; }
    };

    const editedVal = edits.get(rowId)?.[field];
    const selectedDate = editedVal === "__null__" ? undefined : parseDate(editedVal ?? value);

    const handleDateSelect = (date: Date | undefined) => {
      if (date) {
        const iso = format(date, "yyyy-MM-dd");
        handleCellEdit(rowId, field, iso);
      }
    };

    const handleClearDate = () => {
      handleCellEdit(rowId, field, "__null__");
    };

    const toggleColor = (e: React.MouseEvent) => {
      e.stopPropagation();
      const newColor = isRed ? "black" : "red";
      handleCellEdit(rowId, fontColorField, newColor);
    };

    if (!isAdmin) {
      return (
        <span className={`text-xs px-1 py-0.5 block truncate ${isRed ? "text-red-500" : ""}`}>
          {formatDate(value)}
        </span>
      );
    }

    return (
      <div className="flex items-center gap-0.5">
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={`flex items-center gap-1 px-1 py-0.5 rounded text-xs hover:bg-blue-50 cursor-pointer truncate ${isRed ? "text-red-500 font-medium" : ""}`}
              data-testid={`button-datepicker-${rowId}-${field}`}
            >
              <CalendarIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span>{selectedDate ? formatDate(format(selectedDate, "yyyy-MM-dd")) : "-"}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start" side="bottom">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              initialFocus
            />
            <div className="flex items-center justify-between border-t px-3 py-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={handleClearDate}
                data-testid={`button-clear-date-${rowId}-${field}`}>
                Clear
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <button
          onClick={toggleColor}
          className={`shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${isRed ? "bg-red-500 border-red-600" : "bg-gray-800 border-gray-900"}`}
          title={isRed ? "Switch to black" : "Switch to red"}
          data-testid={`button-color-toggle-${rowId}-${field}`}
        >
          <span className="sr-only">{isRed ? "Red" : "Black"}</span>
        </button>
      </div>
    );
  };

  const renderLinkedTask = (exp: EnrichedExpense) => {
    if (exp.linkedTask) {
      return (
        <div className="flex items-center gap-1 group">
          <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${
            exp.linkedTask.isBaseline ? "bg-purple-50 text-purple-700 border-purple-300" :
            exp.linkedTask.status === "Done" || exp.linkedTask.status === "Complete" ? "bg-green-50 text-green-700 border-green-300" :
            exp.linkedTask.status === "In Progress" ? "bg-blue-50 text-blue-700 border-blue-300" :
            "bg-gray-50 text-gray-600 border-gray-300"
          }`}>
            {exp.linkedTask.isBaseline ? "Base" : (exp.linkedTask.status === "Done" || exp.linkedTask.status === "Complete" ? "Done" : exp.linkedTask.status === "In Progress" ? "WIP" : "ToDo")}
          </Badge>
          <span className="truncate max-w-[90px] text-xs" title={exp.linkedTask.title}>{exp.linkedTask.title}</span>
          {isAdmin && (
            <Button variant="ghost" size="sm" className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 shrink-0"
              onClick={() => unlinkTaskMutation.mutate(exp.id)} title="Unlink task" data-testid={`button-unlink-exp-${exp.id}`}>
              <Unlink className="h-3 w-3 text-gray-400 hover:text-red-500" />
            </Button>
          )}
        </div>
      );
    }
    if (linkingExpenseId === exp.id) {
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Input placeholder="Search tasks..." value={taskSearchTerm} onChange={(e) => setTaskSearchTerm(e.target.value)}
              className="h-6 text-[11px] w-[140px]" autoFocus data-testid={`input-task-search-exp-${exp.id}`} />
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => { setLinkingExpenseId(null); setTaskSearchTerm(""); }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="max-h-[200px] overflow-y-auto border rounded-md bg-white shadow-sm">
            {filteredTasks.length === 0 ? (
              <p className="text-[10px] text-muted-foreground p-2">No tasks found</p>
            ) : (
              filteredTasks.map((t: any) => (
                <button key={t.id} className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-blue-50 border-b last:border-b-0 flex items-center gap-1"
                  onClick={() => linkTaskMutation.mutate({ expenseId: exp.id, taskId: t.id })} data-testid={`option-exp-task-${t.id}`}>
                  <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${
                    t.isBaseline ? "bg-purple-50 text-purple-700 border-purple-300" :
                    t.status === "Done" || t.status === "Complete" || t.status === "complete" ? "bg-green-50 text-green-700 border-green-300" :
                    t.status === "In Progress" || t.status === "in_progress" ? "bg-blue-50 text-blue-700 border-blue-300" :
                    "bg-gray-50 text-gray-600 border-gray-300"
                  }`}>
                    {t.isBaseline ? "Base" : (t.status === "Done" || t.status === "Complete" || t.status === "complete" ? "Done" : t.status === "In Progress" || t.status === "in_progress" ? "WIP" : "ToDo")}
                  </Badge>
                  <span className="truncate">{t.title}</span>
                </button>
              ))
            )}
          </div>
        </div>
      );
    }
    if (!isAdmin) return <span className="text-xs text-muted-foreground">-</span>;
    return (
      <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-0.5"
        onClick={() => { setLinkingExpenseId(exp.id); setTaskSearchTerm(""); }} data-testid={`button-link-exp-${exp.id}`}>
        <Link className="h-3 w-3" /> Link
      </Button>
    );
  };

  const renderCellValue = (exp: EnrichedExpense, col: ColumnDef) => {
    const variance = parseFloat(exp.budgetTotal || "0") - parseFloat(exp.expenseActualTotal || "0");
    switch (col.key) {
      case "description":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="max-w-[200px]">
                  <EditableCell rowId={exp.id} field="expenseLineItem" value={exp.expenseLineItem} />
                </div>
              </TooltipTrigger>
              {exp.expenseLineItem && exp.expenseLineItem.length > 30 && (
                <TooltipContent side="right" className="max-w-[300px]"><p className="text-xs">{exp.expenseLineItem}</p></TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        );
      case "budgetTotal":
        return <span className="text-xs font-mono">{formatCurrency(exp.budgetTotal)}</span>;
      case "actualTotal":
        return <span className="text-xs font-mono">{formatCurrency(exp.expenseActualTotal)}</span>;
      case "poNumber":
        return <EditableCell rowId={exp.id} field="expensePoNumber" value={exp.expensePoNumber} />;
      case "invoiceNo":
        return <EditableCell rowId={exp.id} field="expenseInvoiceNumber" value={exp.expenseInvoiceNumber} />;
      case "invoiceDate":
        return <DatePickerCell rowId={exp.id} field="expenseInvoicedDate" value={exp.expenseInvoicedDate}
          fontColor={exp.invoiceDateFontColor} fontColorField="invoiceDateFontColor" />;
      case "paymentDate":
        return (
          <div className="flex items-center gap-0.5">
            <DatePickerCell rowId={exp.id} field="expensePaymentDate" value={exp.expensePaymentDate || exp.effectivePaymentDate}
              fontColor={exp.paymentDateFontColor} fontColorField="paymentDateFontColor" />
            {exp.hasDateOverride && <span className="text-amber-500 text-[10px]" title={exp.dateOverrideReason || "Override"}>*</span>}
          </div>
        );
      case "linkedTask":
        return renderLinkedTask(exp);
      case "cosStatus":
        return getCosStatusBadge(exp.cosStatus);
      case "paymentStatus":
        return getPaymentStatusBadge(exp.paymentStatus);
      case "plannedMonth":
        return <span className="text-xs">{formatMonth(exp.plannedMonth)}</span>;
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

  const allMonths = [...new Set(items.map(i => i.plannedMonth).filter(Boolean))].sort() as string[];

  const pctUsed = kpis.totalBudget > 0 ? Math.round((kpis.totalActual / kpis.totalBudget) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* KPI Summary Strip */}
      <div className="rounded-lg border bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
        <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-gray-100 dark:divide-gray-800">
          <div className="p-3 sm:p-4">
            <div className="text-[10px] uppercase tracking-wider font-medium text-gray-400">Budget</div>
            <div className="text-base sm:text-lg font-bold text-blue-600 font-mono" data-testid="text-kpi-budget">{formatCurrency(kpis.totalBudget)}</div>
          </div>
          <div className="p-3 sm:p-4">
            <div className="text-[10px] uppercase tracking-wider font-medium text-gray-400">Actual</div>
            <div className="text-base sm:text-lg font-bold font-mono" data-testid="text-kpi-actual">{formatCurrency(kpis.totalActual)}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{pctUsed}% of budget</div>
          </div>
          <div className="p-3 sm:p-4">
            <div className="text-[10px] uppercase tracking-wider font-medium text-gray-400">Variance</div>
            <div className={`text-base sm:text-lg font-bold font-mono ${kpis.variance >= 0 ? "text-emerald-600" : "text-red-600"}`} data-testid="text-kpi-variance">
              {formatCurrency(kpis.variance)}
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <div className="text-[10px] uppercase tracking-wider font-medium text-gray-400">COS Realised</div>
            <div className="text-base sm:text-lg font-bold text-emerald-600 font-mono" data-testid="text-kpi-cos">{formatCurrency(kpis.cosRealised)}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{kpis.countByCos["COS Realised"]} lines</div>
          </div>
          <div className="p-3 sm:p-4">
            <div className="text-[10px] uppercase tracking-wider font-medium text-gray-400">Paid</div>
            <div className="text-base sm:text-lg font-bold text-emerald-600 font-mono" data-testid="text-kpi-paid">{formatCurrency(kpis.totalPaid)}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{kpis.countByPayment.Paid} lines</div>
          </div>
          <div className="p-3 sm:p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors" onClick={() => setDrawerOpen(true)}>
            <div className="text-[10px] uppercase tracking-wider font-medium text-gray-400">Lines</div>
            <div className="text-base sm:text-lg font-bold" data-testid="text-kpi-items">{kpis.totalItems}</div>
            <div className="text-[10px] text-blue-600 mt-0.5">Drilldown</div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <div className="flex items-center gap-1 border rounded-md p-0.5 bg-white dark:bg-gray-950">
          <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 px-1.5" title="Expand All">
            <ChevronsDownUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 px-1.5" title="Collapse All">
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              <Columns className="h-3.5 w-3.5 mr-1" /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {COLUMNS.map((col) => (
              <DropdownMenuCheckboxItem key={col.key} checked={visibleColumns.has(col.key)} onCheckedChange={() => toggleColumn(col.key)}>
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-7 text-xs"><SelectValue placeholder="Filter by status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({kpis.totalItems})</SelectItem>
            <SelectItem value="COS Realised">COS Realised ({kpis.countByCos["COS Realised"]})</SelectItem>
            <SelectItem value="Not Yet Realised">Not Yet Realised ({kpis.countByCos["Not Yet Realised"]})</SelectItem>
            <SelectItem value="Paid">Paid ({kpis.countByPayment.Paid})</SelectItem>
            <SelectItem value="Payment Planned">Payment Planned ({kpis.countByPayment["Payment Planned"]})</SelectItem>
            <SelectItem value="Committed">Committed ({kpis.countByPayment.Committed})</SelectItem>
            <SelectItem value="Planned">Planned ({kpis.countByCos.Planned})</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50" data-testid="button-add-menu">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem checked={false} onCheckedChange={() => setAddLineOpen(true)}>
                  <ListPlus className="h-4 w-4 mr-2" /> Add Line Item
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={false} onCheckedChange={() => setAddCategoryOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Add Category
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={false} onCheckedChange={() => setInsertTaskOpen(true)}>
                  <ClipboardList className="h-4 w-4 mr-2" /> Insert Task as Line Item
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <PermissionGate entity="financials" action="edit">
            <Button onClick={handleSave} disabled={!hasEdits || saveMutation.isPending} size="sm"
              className={`h-7 text-xs ${hasEdits ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm" : ""}`}
              variant={hasEdits ? "default" : "outline"}
              data-testid="button-save-edits">
              <Save className="h-3.5 w-3.5 mr-1" /> {saveMutation.isPending ? "Saving..." : hasEdits ? `Save (${edits.size})` : "Save"}
            </Button>
          </PermissionGate>

          <Button onClick={() => setDrawerOpen(true)} variant="outline" size="sm" className="h-7 text-xs" data-testid="button-drilldown">
            <Search className="h-3.5 w-3.5 mr-1" /> Drilldown
          </Button>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-lg border bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
        {categoryGroups.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">No expenditure data available for this project</p>
        ) : (
          <div ref={tableContainerRef} className="relative overflow-auto" style={{ maxHeight: "calc(100vh - 340px)", minHeight: "400px" }}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20">
                <tr className="bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700">
                  {activeColumns.map((col, idx) => (
                    <th key={col.key}
                      className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap
                        ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                        ${idx === 0 ? "sticky left-0 z-30 bg-gray-50 dark:bg-gray-900" : ""}`}
                      style={{ minWidth: col.minWidth }}>
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
                      <tr className="bg-slate-100/80 dark:bg-slate-800/50 hover:bg-slate-200/60 dark:hover:bg-slate-700/50 cursor-pointer border-b border-slate-200 dark:border-slate-700"
                        onClick={() => toggleCategory(group.category)}>
                        <td className="sticky left-0 z-10 bg-slate-100/80 dark:bg-slate-800/50 px-3 py-2.5" colSpan={1}>
                          <div className="flex items-center gap-2">
                            {isCollapsed ? <ChevronRight className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
                            <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm">{group.category}</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">{group.items.length}</Badge>
                          </div>
                        </td>
                        {activeColumns.slice(1).map((col) => (
                          <td key={col.key} className={`px-3 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300
                            ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}>
                            {col.key === "budgetTotal" && <span className="font-mono">{formatCurrency(group.budgetTotal)}</span>}
                            {col.key === "actualTotal" && <span className="font-mono">{formatCurrency(group.actualTotal)}</span>}
                            {col.key === "variance" && (
                              <span className={`font-mono ${group.variance >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(group.variance)}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                      {!isCollapsed && group.items.map((exp, rowIdx) => (
                        <tr key={exp.id}
                          data-row-id={exp.id}
                          className={`border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors
                            ${highlightedRowId === exp.id ? "bg-amber-50 ring-2 ring-amber-400 ring-inset" : rowIdx % 2 === 0 ? "bg-white dark:bg-gray-950" : "bg-gray-50/50 dark:bg-gray-900/30"}`}>
                          {activeColumns.map((col, colIdx) => (
                            <td key={col.key}
                              className={`px-3 py-1.5
                                ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                                ${colIdx === 0 ? "sticky left-0 z-10 bg-inherit" : ""}`}
                              style={{ minWidth: col.minWidth }}>
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
          <div className="px-4 py-2 text-xs text-amber-700 border-t bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 flex items-center gap-2">
            <Save className="h-3.5 w-3.5" />
            {edits.size} {edits.size === 1 ? "row" : "rows"} modified — click Save to persist changes
          </div>
        )}
      </div>

      {/* Drilldown Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-[500px] sm:w-[600px] overflow-auto">
          <SheetHeader>
            <SheetTitle>Expenditure Drilldown</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={drawerFilter.category || "all"} onValueChange={v => setDrawerFilter(f => ({ ...f, category: v === "all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">COS Status</Label>
                <Select value={drawerFilter.cosStatus || "all"} onValueChange={v => setDrawerFilter(f => ({ ...f, cosStatus: v === "all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="COS Realised">COS Realised</SelectItem>
                    <SelectItem value="Not Yet Realised">Not Yet Realised</SelectItem>
                    <SelectItem value="Planned">Planned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Payment Status</Label>
                <Select value={drawerFilter.paymentStatus || "all"} onValueChange={v => setDrawerFilter(f => ({ ...f, paymentStatus: v === "all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Paid">Paid</SelectItem>
                    <SelectItem value="Payment Planned">Payment Planned</SelectItem>
                    <SelectItem value="Invoiced">Invoiced</SelectItem>
                    <SelectItem value="Committed">Committed</SelectItem>
                    <SelectItem value="Planned">Planned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Planned Month</Label>
                <Select value={drawerFilter.plannedMonth || "all"} onValueChange={v => setDrawerFilter(f => ({ ...f, plannedMonth: v === "all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Months</SelectItem>
                    {allMonths.map(m => <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Invoice No</Label>
                <Input className="h-8 text-xs" placeholder="Search..." value={drawerFilter.invoiceNo || ""}
                  onChange={e => setDrawerFilter(f => ({ ...f, invoiceNo: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">PO Number</Label>
                <Input className="h-8 text-xs" placeholder="Search..." value={drawerFilter.poNumber || ""}
                  onChange={e => setDrawerFilter(f => ({ ...f, poNumber: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Task Linked</Label>
                <Select value={drawerFilter.taskLinked || "all"} onValueChange={v => setDrawerFilter(f => ({ ...f, taskLinked: v === "all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Linked</SelectItem>
                    <SelectItem value="no">Not Linked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDrawerFilter({})}>Clear Filters</Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {drawerItems.length} item{drawerItems.length !== 1 ? "s" : ""} | Total: {formatCurrency(drawerItems.reduce((s, i) => s + (parseFloat(i.expenseActualTotal || "0")), 0))}
            </div>

            <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-auto">
              {drawerItems.map(item => (
                <Card key={item.id} className="shadow-sm">
                  <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium truncate max-w-[250px]">{item.expenseLineItem || "-"}</span>
                      <span className="text-xs font-mono font-bold">{formatCurrency(item.expenseActualTotal)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[8px] bg-slate-50">{item.expenseCategory}</Badge>
                      {getCosStatusBadge(item.cosStatus)}
                      {getPaymentStatusBadge(item.paymentStatus)}
                      {item.plannedMonth && <Badge variant="outline" className="text-[8px]">{formatMonth(item.plannedMonth)}</Badge>}
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                      <span>PO: {item.expensePoNumber || "-"}</span>
                      <span>Invoice: {item.expenseInvoiceNumber || "-"}</span>
                      <span>Inv Date: {formatDate(item.expenseInvoicedDate)}</span>
                      <span>Pay Date: {formatDate(item.effectivePaymentDate)}</span>
                      {item.linkedTask && <span className="col-span-2">Task: {item.linkedTask.title} ({item.linkedTask.status})</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Add Line Item Dialog */}
      <Dialog open={addLineOpen} onOpenChange={setAddLineOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Line Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={newLineData.category} onValueChange={v => setNewLineData(d => ({ ...d, category: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input className="h-8 text-xs" value={newLineData.description} onChange={e => setNewLineData(d => ({ ...d, description: e.target.value }))}
                data-testid="input-new-line-desc" />
            </div>
            <div>
              <Label className="text-xs">Actual Total (R)</Label>
              <Input type="number" className="h-8 text-xs" value={newLineData.amount} onChange={e => setNewLineData(d => ({ ...d, amount: e.target.value }))}
                data-testid="input-new-line-amount" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">PO Number</Label>
                <Input className="h-8 text-xs" value={newLineData.poNumber} onChange={e => setNewLineData(d => ({ ...d, poNumber: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Invoice Number</Label>
                <Input className="h-8 text-xs" value={newLineData.invoiceNo} onChange={e => setNewLineData(d => ({ ...d, invoiceNo: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Invoice Date</Label>
                <Input type="date" className="h-8 text-xs" value={newLineData.invoiceDate} onChange={e => setNewLineData(d => ({ ...d, invoiceDate: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Finance Payment Date</Label>
                <Input type="date" className="h-8 text-xs" value={newLineData.paymentDate} onChange={e => setNewLineData(d => ({ ...d, paymentDate: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddLineOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!newLineData.category || addLineMutation.isPending} data-testid="button-submit-add-line"
              onClick={() => addLineMutation.mutate({
                expenseCategory: newLineData.category, expenseLineItem: newLineData.description,
                expenseActualTotal: newLineData.amount || null, expensePoNumber: newLineData.poNumber || null,
                expenseInvoiceNumber: newLineData.invoiceNo || null, expenseInvoicedDate: newLineData.invoiceDate || null,
                expensePaymentDate: newLineData.paymentDate || null,
              })}>
              {addLineMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Line Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={addCategoryOpen} onOpenChange={setAddCategoryOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Category</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">Category Name</Label>
            <Input className="h-8 text-xs" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
              placeholder="e.g. 15. Contingency" data-testid="input-new-category" />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddCategoryOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!newCategoryName.trim() || addCategoryMutation.isPending} data-testid="button-submit-add-cat"
              onClick={() => addCategoryMutation.mutate(newCategoryName)}>
              {addCategoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Insert Task as Line Item Dialog */}
      <Dialog open={insertTaskOpen} onOpenChange={setInsertTaskOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Insert Task as Line Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={insertTaskCategory} onValueChange={setInsertTaskCategory}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Search Tasks</Label>
              <Input className="h-8 text-xs" placeholder="Search by name..." value={insertTaskSearch}
                onChange={e => setInsertTaskSearch(e.target.value)} data-testid="input-insert-task-search" />
            </div>
            <div className="max-h-[250px] overflow-auto border rounded-md">
              {insertFilteredTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">No tasks found</p>
              ) : (
                insertFilteredTasks.map((t: any) => (
                  <button key={t.id}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b last:border-b-0 flex items-center justify-between gap-2"
                    disabled={!insertTaskCategory || insertTaskMutation.isPending}
                    onClick={() => insertTaskMutation.mutate({ taskId: t.id, expenseCategory: insertTaskCategory })}
                    data-testid={`option-insert-task-${t.id}`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${
                        t.isBaseline ? "bg-purple-50 text-purple-700 border-purple-300" :
                        t.status === "Done" || t.status === "Complete" ? "bg-green-50 text-green-700 border-green-300" :
                        t.status === "In Progress" ? "bg-blue-50 text-blue-700 border-blue-300" :
                        "bg-gray-50 text-gray-600 border-gray-300"
                      }`}>
                        {t.isBaseline ? "Base" : (t.status === "Done" || t.status === "Complete" ? "Done" : t.status === "In Progress" ? "WIP" : "ToDo")}
                      </Badge>
                      <span className="truncate">{t.title}</span>
                    </div>
                    {t.dueDate && <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(t.dueDate)}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setInsertTaskOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

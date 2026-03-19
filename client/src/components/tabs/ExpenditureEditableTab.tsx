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
  X, Search, ListPlus, ClipboardList, CalendarIcon, Palette,
  TrendingUp, TrendingDown, DollarSign, BarChart3, Percent,
  CircleDot, Wallet, CheckCircle2
} from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface FinanceFieldAudit {
  fieldName: string;
  sourceValue: string | number | null;
  managedValue: string | number | null;
  overrideValue: string | number | null;
  previousValue: string | number | null;
  changedAt: string | null;
  changedByUserId: number | null;
  changedByName: string | null;
  overrideCategory: string | null;
  overrideComment: string | null;
}

interface FinanceRecentChange {
  id: number;
  action: string;
  entityId: string | null;
  summary: string | null;
  actorRole: string | null;
  actorUserId: number | null;
  actorName: string | null;
  overrideCategory: string | null;
  overrideComment: string | null;
  createdAt: string;
  changedFields: Array<{ fieldName: string; oldValue: string | null; newValue: string | null }>;
}

interface FinanceGovernanceGroup {
  pendingCount: number;
  affectingCashCount?: number;
  pending: Array<Record<string, any>>;
}

interface MicrosoftFinanceSummary {
  linkedCount: number;
  actionRequiredCount: number;
  unreadCount: number;
  linkedTaskCount: number;
  recent: Array<Record<string, any>>;
}

interface FinanceRiskSignal {
  key: string;
  severity: "warning" | "info" | "critical";
  label: string;
  detail: string;
  amount?: number;
  count?: number;
}

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
  revenueAmount: string | null;
  actualCosTotal: string | null;
  lineStatus: string | null;
  linkedTask: { id: number; title: string; status: string; dueDate: string | null; isBaseline: boolean } | null;
  cosStatus: string;
  computedCosStatus?: string;
  paymentStatus: string;
  effectivePaymentDate: string | null;
  plannedMonth: string | null;
  hasDateOverride: boolean;
  dateOverrideReason: string | null;
  cosOverride: { reason: string; overriddenBy: string | null; originalStatus: string; overrideStatus: string } | null;
  noRevenueLinked: boolean;
  trust?: {
    sourceSheet: string;
    sourceRow: number;
    hasVariance: boolean;
    editedFields: string[];
    lastChangedAt: string | null;
    lastChangedByName: string | null;
    fieldAudits: Record<string, FinanceFieldAudit>;
  };
}

interface ExpenditureOverride {
  id: number;
  projectName: string;
  rowNumber: number;
  fieldName: string;
  overrideValue: string;
}

interface CategoryGroup {
  category: string;
  items: EnrichedExpense[];
  budgetTotal: number;
  actualTotal: number;
  revenueTotal: number;
  variance: number;
}

interface ExpenditureEditableTabProps {
  projectName: string;
  highlightId?: number | null;
}

type ColumnKey =
  | "description" | "actualTotal" | "poNumber" | "invoiceNo"
  | "invoiceDate" | "paymentDate" | "linkedTask" | "cosStatus"
  | "paymentStatus" | "plannedMonth" | "budgetTotal" | "variance" | "revenueAmount" | "supplier" | "noRevLinked";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  align: "left" | "center" | "right";
  minWidth: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "description", label: "Description", defaultVisible: true, align: "left", minWidth: "200px" },
  { key: "budgetTotal", label: "Costed Total", defaultVisible: true, align: "right", minWidth: "120px" },
  { key: "actualTotal", label: "Actual Total", defaultVisible: true, align: "right", minWidth: "120px" },
  { key: "poNumber", label: "PO Number", defaultVisible: true, align: "left", minWidth: "110px" },
  { key: "invoiceNo", label: "Invoice No", defaultVisible: true, align: "left", minWidth: "110px" },
  { key: "invoiceDate", label: "Invoice Date", defaultVisible: true, align: "center", minWidth: "100px" },
  { key: "paymentDate", label: "Finance Pay Date", defaultVisible: true, align: "center", minWidth: "110px" },
  { key: "linkedTask", label: "Linked Task", defaultVisible: true, align: "left", minWidth: "150px" },
  { key: "cosStatus", label: "COS Status", defaultVisible: true, align: "center", minWidth: "110px" },
  { key: "paymentStatus", label: "Payment Status", defaultVisible: true, align: "center", minWidth: "110px" },
  { key: "plannedMonth", label: "Planned Month", defaultVisible: true, align: "center", minWidth: "100px" },
  { key: "supplier", label: "Supplier", defaultVisible: false, align: "left", minWidth: "130px" },
  { key: "noRevLinked", label: "No Rev", defaultVisible: true, align: "center", minWidth: "70px" },
  { key: "revenueAmount", label: "Rev Recognition", defaultVisible: false, align: "right", minWidth: "130px" },
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

const getRowStatusBadge = (exp: EnrichedExpense) => {
  if (exp.paymentStatus === "Out of Bank") {
    return <Badge data-testid={`badge-status-${exp.id}`} className="text-[9px] font-medium px-1.5 py-0 border whitespace-nowrap bg-emerald-50 text-emerald-700 border-emerald-300" variant="outline">Paid</Badge>;
  }
  if (exp.cosStatus === "COS Realised" || (exp.expenseInvoiceNumber && exp.expenseInvoicedDate)) {
    return <Badge data-testid={`badge-status-${exp.id}`} className="text-[9px] font-medium px-1.5 py-0 border whitespace-nowrap bg-amber-50 text-amber-700 border-amber-300" variant="outline">Invoiced</Badge>;
  }
  if (exp.expensePoNumber && exp.expensePoNumber.trim()) {
    return <Badge data-testid={`badge-status-${exp.id}`} className="text-[9px] font-medium px-1.5 py-0 border whitespace-nowrap bg-blue-50 text-blue-600 border-blue-200" variant="outline">Committed</Badge>;
  }
  return <Badge data-testid={`badge-status-${exp.id}`} className="text-[9px] font-medium px-1.5 py-0 border whitespace-nowrap bg-muted text-muted-foreground border-border" variant="outline">Planned</Badge>;
};

const getCosStatusBadge = (status: string) => {
  const colors: Record<string, string> = {
    "COS Realised": "bg-emerald-50 text-emerald-700 border-emerald-300",
    "Committed": "bg-amber-50 text-amber-700 border-amber-300",
    "Planned": "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge className={`text-[9px] font-medium px-1.5 py-0 border whitespace-nowrap ${colors[status] || "bg-muted"}`} variant="outline">
      {status}
    </Badge>
  );
};

const getPaymentStatusBadge = (status: string) => {
  const colors: Record<string, string> = {
    "Out of Bank": "bg-emerald-50 text-emerald-700 border-emerald-300",
    "Payment Planned": "bg-blue-50 text-blue-600 border-blue-200",
    "Planned": "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge className={`text-[9px] font-medium px-1.5 py-0 border whitespace-nowrap ${colors[status] || "bg-muted"}`} variant="outline">
      {status}
    </Badge>
  );
};

const OverrideDot = ({ originalValue, audit }: { originalValue: string; audit?: FinanceFieldAudit }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center ml-1 shrink-0 cursor-help">
          <CircleDot className="h-3 w-3 text-blue-500" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs bg-blue-50 border-blue-200 text-blue-800">
        <div className="space-y-1 max-w-[260px]">
          <p className="font-semibold">{audit?.fieldName || "Managed field"} override</p>
          <p>Imported/source: {audit?.sourceValue !== undefined ? String(audit.sourceValue ?? "(empty)") : (originalValue || "(empty)")}</p>
          <p>Current managed: {audit?.managedValue !== undefined ? String(audit.managedValue ?? "(empty)") : "(empty)"}</p>
          {audit?.changedByName && <p>Changed by: {audit.changedByName}</p>}
          {audit?.changedAt && <p>Changed at: {new Date(audit.changedAt).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
          {audit?.overrideCategory && <p>Category: {audit.overrideCategory}</p>}
          {audit?.overrideComment && <p>Reason: {audit.overrideComment}</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export function ExpenditureEditableTab({ projectName, highlightId }: ExpenditureEditableTabProps) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const [edits, setEdits] = useState<Map<number, Record<string, string>>>(new Map());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [subProjectFilter, setSubProjectFilter] = useState<string>("all");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    return new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key));
  });
  const [linkingExpenseId, setLinkingExpenseId] = useState<number | null>(null);
  const [taskSearchTerm, setTaskSearchTerm] = useState("");
  const [taskLinkPrompt, setTaskLinkPrompt] = useState<{ expenseId: number; taskId: number; taskTitle: string; taskDueDate: string | null; currentPaymentDate: string | null } | null>(null);
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
  const [cosOverrideTarget, setCosOverrideTarget] = useState<EnrichedExpense | null>(null);
  const [cosOverrideStatus, setCosOverrideStatus] = useState("COS Realised");
  const [cosOverrideReason, setCosOverrideReason] = useState("");
  const [supplierSearchTerm, setSupplierSearchTerm] = useState("");
  const [overrideCategory, setOverrideCategory] = useState("DATA_CORRECTION");
  const [overrideComment, setOverrideComment] = useState("");

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

  const { data: breakdownData, isLoading, error } = useQuery<{
    items: EnrichedExpense[];
    categories: string[];
    reconciliation?: {
      source: {
        sourceSheet: string;
        itemCount: number;
        importedBudget: number;
        importedActual: number;
      };
      managed: {
        overriddenRowCount: number;
        overriddenFieldCount: number;
        cosOverrideCount: number;
        latestChangeAt: string | null;
        latestChangeByName: string | null;
      };
      variances: {
        budgetVsActual: number;
        realisedCos: number;
        outOfBankTotal: number;
        committedUnpaidTotal: number;
        noRevenueLinkedCount: number;
        overBudgetCount: number;
      };
      approvals: FinanceGovernanceGroup;
      editRequests: FinanceGovernanceGroup;
      microsoft: MicrosoftFinanceSummary;
      recentChanges: FinanceRecentChange[];
      costedExpenditure?: number;
    };
    riskSignals?: FinanceRiskSignal[];
  }>({
    queryKey: breakdownKey,
    queryFn: async () => {
      const res = await authFetch(`/api/expenditure-breakdown/${encodeURIComponent(projectName)}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: overridesData = [] } = useQuery<ExpenditureOverride[]>({
    queryKey: ["expenditure-overrides", projectName],
    queryFn: async () => {
      const res = await authFetch(`/api/expenditure/overrides?projectName=${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const overrideMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of overridesData) {
      map.set(`${o.rowNumber}::${o.fieldName}`, o.overrideValue);
    }
    return map;
  }, [overridesData]);

  const hasOverride = useCallback((rowNumber: number, fieldName: string): boolean => {
    return overrideMap.has(`${rowNumber}::${fieldName}`);
  }, [overrideMap]);

  const getOriginalValue = useCallback((rowNumber: number, fieldName: string): string | undefined => {
    return overrideMap.get(`${rowNumber}::${fieldName}`);
  }, [overrideMap]);

  const fieldAuditMap = useMemo(() => {
    const map = new Map<string, FinanceFieldAudit>();
    for (const item of breakdownData?.items || []) {
      for (const audit of Object.values(item.trust?.fieldAudits || {})) {
        map.set(`${item.rowNumber}::${audit.fieldName}`, audit);
      }
    }
    return map;
  }, [breakdownData?.items]);

  const getFieldAudit = useCallback((rowNumber: number, fieldName: string): FinanceFieldAudit | undefined => {
    return fieldAuditMap.get(`${rowNumber}::${fieldName}`);
  }, [fieldAuditMap]);

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
    mutationFn: async (payload: { overrides: { projectName: string; rowNumber: number; fieldName: string; overrideValue: string }[]; category: string; comment: string }) => {
      const response = await authFetch("/api/expenditure/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: payload.overrides, overrideCategory: payload.category, overrideComment: payload.comment }),
      });
      if (!response.ok) throw new Error("Failed to save overrides");
      return response.json();
    },
    onSuccess: (data) => {
      if (data?.status === "pending_approval") {
        toast({ title: "Submitted for Approval", description: "Your expenditure edit has been sent to management for approval." });
        queryClient.invalidateQueries({ queryKey: ["financial-edit-requests"] });
        queryClient.invalidateQueries({ queryKey: ["financial-warnings"] });
        setEdits(new Map());
        return;
      }
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      queryClient.invalidateQueries({ queryKey: ["expenditure-overrides", projectName] });
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
                 key.startsWith('/api/revenue-tracker') ||
                 key.startsWith('/api/revenue-tab/') ||
                 key.startsWith('/api/revenue-tracking/') ||
                 key === 'revenue-tracker-project' ||
                 key === 'revenue-tab' ||
                 key === 'finance-revenue' ||
                 key === 'dashboard' ||
                 key === 'cashflow';
        }
        return false;
      }});
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      invalidateDashboardQueries(queryClient);
      setEdits(new Map());
      setOverrideCategory("DATA_CORRECTION");
      setOverrideComment("");
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

  const cosOverrideMutation = useMutation({
    mutationFn: async ({ expenseId, projectName: pn, rowNumber, originalStatus, overrideStatus, reason }: {
      expenseId: number; projectName: string; rowNumber: number; originalStatus: string; overrideStatus: string; reason: string;
    }) => {
      const res = await authFetch("/api/cos-status-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseId, projectName: pn, rowNumber, originalStatus, overrideStatus, reason }),
      });
      if (!res.ok) throw new Error("Failed to save override");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      invalidateDashboardQueries(queryClient);
      setCosOverrideTarget(null);
      setCosOverrideReason("");
      toast({ title: "COS status override saved" });
    },
  });

  const removeCosOverrideMutation = useMutation({
    mutationFn: async (expenseId: number) => {
      const res = await authFetch(`/api/cos-status-override/${expenseId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove override");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      invalidateDashboardQueries(queryClient);
      toast({ title: "COS override removed" });
    },
  });

  const noRevLinkedMutation = useMutation({
    mutationFn: async ({ id, noRevenueLinked }: { id: number; noRevenueLinked: boolean }) => {
      const canonicalId = id >= 900000 ? id - 900000 : id;
      const res = await authFetch(`/api/cost-lines/${canonicalId}/no-revenue-linked`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noRevenueLinked }),
      });
      if (!res.ok) throw new Error("Failed to update no-revenue-linked");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: breakdownKey });
      invalidateDashboardQueries(queryClient);
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && (key.startsWith('/api/revenue-tracker') || key.startsWith('/api/cos-tracker'));
      }});
      toast({ title: "Revenue link updated" });
    },
  });

  const items = breakdownData?.items || [];
  const categories = breakdownData?.categories || [];
  const reconciliation = breakdownData?.reconciliation;
  const riskSignals = breakdownData?.riskSignals || [];

  const supplierNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of items) {
      const inv = item.expenseInvoiceNumber || "";
      if (inv.includes(":")) names.add(inv.split(":")[0].trim());
      else if (inv.includes("-")) names.add(inv.split("-")[0].trim());
    }
    return Array.from(names).filter(n => n.length > 1).sort();
  }, [items]);

  const kpis = useMemo(() => {
    // Apply local edits so KPIs update immediately on user changes
    const editedItems = items.map((row) => {
      const rowEdits = edits.get(row.id);
      return rowEdits ? { ...row, ...rowEdits } : row;
    });
    const itemBudgetSum = editedItems.reduce((sum, e) => sum + (parseFloat(e.budgetTotal || "0")), 0);
    const managedCosted = reconciliation?.costedExpenditure;
    const totalBudget = (managedCosted && managedCosted > 0) ? managedCosted : itemBudgetSum;
    const totalActual = editedItems.reduce((sum, e) => sum + (parseFloat(e.expenseActualTotal || "0")), 0);
    const cosRealised = editedItems.filter(e => e.cosStatus === "COS Realised").reduce((s, e) => s + (parseFloat(e.expenseActualTotal || "0")), 0);
    const totalOutOfBank = editedItems.filter(e => e.paymentStatus === "Out of Bank").reduce((s, e) => s + (parseFloat(e.expenseActualTotal || "0")), 0);
    const variance = totalBudget - totalActual;
    const countByCos = {
      "COS Realised": editedItems.filter(e => e.cosStatus === "COS Realised").length,
      "Committed": editedItems.filter(e => e.cosStatus === "Committed").length,
      "Planned": editedItems.filter(e => e.cosStatus === "Planned").length,
    };
    const countByPayment = {
      "Out of Bank": editedItems.filter(e => e.paymentStatus === "Out of Bank").length,
      "Payment Planned": editedItems.filter(e => e.paymentStatus === "Payment Planned").length,
      "Planned": editedItems.filter(e => e.paymentStatus === "Planned").length,
    };
    return { totalBudget, totalActual, cosRealised, totalOutOfBank, variance, countByCos, countByPayment, totalItems: editedItems.length };
  }, [items, edits, reconciliation]);

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
    if (subProjectFilter !== "all") {
      data = data.filter((e: any) => e.subProjectName === subProjectFilter);
    }
    return data;
  }, [items, edits, statusFilter, subProjectFilter]);

  const categoryGroups = useMemo(() => {
    const groupMap = new Map<string, CategoryGroup>();
    const groupOrder: string[] = [];
    for (const row of filteredItems) {
      const cat = row.expenseCategory || "Uncategorized";
      if (!groupMap.has(cat)) {
        groupMap.set(cat, { category: cat, items: [], budgetTotal: 0, actualTotal: 0, revenueTotal: 0, variance: 0 });
        groupOrder.push(cat);
      }
      const group = groupMap.get(cat)!;
      group.items.push(row);
      const budget = parseFloat(row.budgetTotal || "0");
      const actual = parseFloat(row.expenseActualTotal || "0");
      const revAmt = parseFloat(row.revenueAmount || "0");
      group.budgetTotal += budget;
      group.actualTotal += actual;
      group.revenueTotal += revAmt;
      group.variance += budget - actual;
    }
    const groups = groupOrder.map(name => groupMap.get(name)!).filter(g => g.items.length > 0);
    groups.sort((a, b) => {
      const minRowA = Math.min(...a.items.map(i => i.rowNumber || Infinity));
      const minRowB = Math.min(...b.items.map(i => i.rowNumber || Infinity));
      return minRowA - minRowB;
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
    await saveMutation.mutateAsync({ overrides, category: overrideCategory, comment: overrideComment || "Inline edit from Expenditure tab" });
  };

  const handleDiscard = useCallback(() => {
    setEdits(new Map());
    setEditingCell(null);
    toast({ title: "Changes Discarded", description: "All pending edits have been discarded." });
  }, [toast]);

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

  const EditableCell = ({ rowId, field, value, type = "text", colorClass = "", rowNumber }: {
    rowId: number; field: string; value: string | null; type?: string; colorClass?: string; rowNumber?: number;
  }) => {
    const cellKey = `${rowId}-${field}`;
    const isEditing = isAdmin && editingCell === cellKey;
    const displayValue = type === "currency" ? formatCurrency(value) : (type === "date" ? formatDate(value) : (value || "-"));
    const audit = rowNumber !== undefined ? getFieldAudit(rowNumber, field) : undefined;
    const showOverride = rowNumber !== undefined && (hasOverride(rowNumber, field) || !!audit);
    return isEditing ? (
      <Input
        type={type === "currency" ? "number" : "text"}
        defaultValue={value || ""}
        onChange={(e) => handleCellEdit(rowId, field, e.target.value)}
        onBlur={() => setEditingCell(null)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingCell(null); }}
        autoFocus
        className="h-6 text-xs w-full"
        data-testid={`input-edit-${rowId}-${field}`}
      />
    ) : (
      <span
        onClick={() => { if (isAdmin) setEditingCell(cellKey); }}
        className={`${isAdmin ? "cursor-pointer hover:bg-blue-50" : ""} px-1 py-0.5 rounded inline-flex items-center text-xs truncate ${colorClass}`}
        data-testid={`cell-${rowId}-${field}`}
      >
        {displayValue}
        {showOverride && <OverrideDot originalValue={getOriginalValue(rowNumber, field) || ""} audit={audit} />}
      </span>
    );
  };

  const SupplierCell = ({ rowId, value, rowNumber }: { rowId: number; value: string | null; rowNumber: number }) => {
    const cellKey = `${rowId}-supplier`;
    const isEditing = isAdmin && editingCell === cellKey;
    const audit = getFieldAudit(rowNumber, "supplierName");
    const showOverride = hasOverride(rowNumber, "supplierName") || !!audit;

    if (isEditing) {
      const filtered = supplierSearchTerm
        ? supplierNames.filter(s => s.toLowerCase().includes(supplierSearchTerm.toLowerCase()))
        : supplierNames;
      return (
        <div className="relative">
          <Input
            defaultValue={value || ""}
            onChange={(e) => {
              setSupplierSearchTerm(e.target.value);
              handleCellEdit(rowId, "supplierName", e.target.value);
            }}
            onBlur={() => setTimeout(() => setEditingCell(null), 200)}
            onKeyDown={(e) => { if (e.key === "Escape") setEditingCell(null); }}
            autoFocus
            className="h-6 text-xs w-full"
            data-testid={`input-supplier-${rowId}`}
          />
          {filtered.length > 0 && (
            <div className="absolute top-full left-0 z-50 w-full max-h-32 overflow-auto bg-card  border rounded-md shadow-lg mt-0.5">
              {filtered.slice(0, 8).map(s => (
                <button key={s} className="w-full text-left px-2 py-1 text-xs hover:bg-blue-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleCellEdit(rowId, "supplierName", s);
                    setEditingCell(null);
                  }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <span
        onClick={() => { if (isAdmin) { setEditingCell(cellKey); setSupplierSearchTerm(""); } }}
        className={`${isAdmin ? "cursor-pointer hover:bg-blue-50" : ""} px-1 py-0.5 rounded inline-flex items-center text-xs truncate`}
      >
        {value || "-"}
        {showOverride && <OverrideDot originalValue={getOriginalValue(rowNumber, "supplierName") || ""} audit={audit} />}
      </span>
    );
  };

  const DatePickerCell = ({ rowId, field, value, fontColor, fontColorField, rowNumber }: {
    rowId: number; field: string; value: string | null; fontColor: string | null; fontColorField: string; rowNumber: number;
  }) => {
    const editedColor = edits.get(rowId)?.[fontColorField];
    const currentColor = editedColor !== undefined ? editedColor : (fontColor || "black");
    const isRed = currentColor === "red";
    const audit = getFieldAudit(rowNumber, field);
    const showOverride = hasOverride(rowNumber, field) || !!audit;

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

    const toggleColor = async (e: React.MouseEvent) => {
      e.stopPropagation();
      const newColor = isRed ? "black" : "red";
      handleCellEdit(rowId, fontColorField, newColor);
      const allItems = breakdownData?.items || [];
      const originalRow = allItems.find((r) => r.id === rowId);
      if (originalRow) {
        try {
          await authFetch("/api/expenditure/font-color-toggle", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectName,
              rowNumber: originalRow.rowNumber || rowId,
              field: fontColorField,
              color: newColor,
            }),
          });
          queryClient.invalidateQueries({ queryKey: breakdownKey });
          queryClient.invalidateQueries({ predicate: (query) => {
            const key = query.queryKey[0];
            return typeof key === 'string' && (key.startsWith('/api/cos-tracker') || key.startsWith('/api/cashflow'));
          }});
        } catch (err) {
          console.error("Font color toggle failed:", err);
        }
      }
    };

    if (!isAdmin) {
      return (
        <span className={`text-xs px-1 py-0.5 inline-flex items-center truncate ${isRed ? "text-red-500 italic" : ""}`}>
          {formatDate(value)}
          {showOverride && <OverrideDot originalValue={getOriginalValue(rowNumber, field) || ""} audit={audit} />}
        </span>
      );
    }

    return (
      <div className="flex items-center gap-0.5">
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={`flex items-center gap-1 px-1 py-0.5 rounded text-xs hover:bg-blue-50 cursor-pointer truncate ${isRed ? "text-red-500 italic font-medium" : ""}`}
              data-testid={`button-datepicker-${rowId}-${field}`}
            >
              <CalendarIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span>{selectedDate ? formatDate(format(selectedDate, "yyyy-MM-dd")) : "-"}</span>
              {showOverride && <OverrideDot originalValue={getOriginalValue(rowNumber, field) || ""} audit={audit} />}
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
          title={isRed ? "Forecast (click to confirm)" : "Confirmed (click to mark forecast)"}
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
            "bg-muted text-muted-foreground border-border"
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
          <div className="max-h-[200px] overflow-y-auto border rounded-md bg-card shadow-sm">
            {filteredTasks.length === 0 ? (
              <p className="text-[10px] text-muted-foreground p-2">No tasks found</p>
            ) : (
              filteredTasks.map((t: any) => (
                <button key={t.id} className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-blue-50 border-b last:border-b-0 flex items-center gap-1"
                  onClick={() => {
                    const taskDueDate = t.dueDate || t.endDate || null;
                    if (taskDueDate) {
                      setTaskLinkPrompt({ expenseId: exp.id, taskId: t.id, taskTitle: t.title, taskDueDate, currentPaymentDate: exp.expensePaymentDate || exp.forecastPaymentDate || null });
                    } else {
                      linkTaskMutation.mutate({ expenseId: exp.id, taskId: t.id });
                    }
                  }} data-testid={`option-exp-task-${t.id}`}>
                  <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${
                    t.isBaseline ? "bg-purple-50 text-purple-700 border-purple-300" :
                    t.status === "Done" || t.status === "Complete" || t.status === "complete" ? "bg-green-50 text-green-700 border-green-300" :
                    t.status === "In Progress" || t.status === "in_progress" ? "bg-blue-50 text-blue-700 border-blue-300" :
                    "bg-muted text-muted-foreground border-border"
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

  const extractSupplier = (invoiceNum: string | null): string => {
    if (!invoiceNum) return "-";
    if (invoiceNum.includes(":")) return invoiceNum.split(":")[0].trim();
    if (invoiceNum.includes("-")) return invoiceNum.split("-")[0].trim();
    return invoiceNum.substring(0, Math.min(20, invoiceNum.length));
  };

  const renderCellValue = (exp: EnrichedExpense, col: ColumnDef) => {
    const variance = parseFloat(exp.budgetTotal || "0") - parseFloat(exp.expenseActualTotal || "0");
    switch (col.key) {
      case "description":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="max-w-[200px] space-y-0.5">
                  <EditableCell rowId={exp.id} field="expenseLineItem" value={exp.expenseLineItem} rowNumber={exp.rowNumber} />
                  {exp.trust && (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>{exp.trust.sourceSheet} row {exp.trust.sourceRow}</span>
                      {exp.trust.editedFields.length > 0 && <span>{exp.trust.editedFields.length} managed field change(s)</span>}
                      {exp.trust.lastChangedAt && (
                        <span>
                          {exp.trust.lastChangedByName || "Managed edit"} • {new Date(exp.trust.lastChangedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              {exp.expenseLineItem && exp.expenseLineItem.length > 30 && (
                <TooltipContent side="right" className="max-w-[300px]"><p className="text-xs">{exp.expenseLineItem}</p></TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        );
      case "budgetTotal":
        return (
          <span className="text-xs font-mono inline-flex items-center">
            {formatCurrency(exp.budgetTotal)}
            {(hasOverride(exp.rowNumber, "budgetTotal") || !!getFieldAudit(exp.rowNumber, "budgetTotal")) && (
              <OverrideDot
                originalValue={getOriginalValue(exp.rowNumber, "budgetTotal") || ""}
                audit={getFieldAudit(exp.rowNumber, "budgetTotal")}
              />
            )}
          </span>
        );
      case "revenueAmount":
        return <span className="text-xs font-mono">{formatCurrency(exp.revenueAmount)}</span>;
      case "actualTotal":
        return (
          <EditableCell rowId={exp.id} field="expenseActualTotal" value={exp.expenseActualTotal} type="currency" rowNumber={exp.rowNumber} />
        );
      case "poNumber":
        return <EditableCell rowId={exp.id} field="expensePoNumber" value={exp.expensePoNumber} rowNumber={exp.rowNumber} />;
      case "invoiceNo":
        return <EditableCell rowId={exp.id} field="expenseInvoiceNumber" value={exp.expenseInvoiceNumber} rowNumber={exp.rowNumber} />;
      case "invoiceDate":
        return <DatePickerCell rowId={exp.id} field="expenseInvoicedDate" value={exp.expenseInvoicedDate}
          fontColor={exp.invoiceDateFontColor} fontColorField="invoiceDateFontColor" rowNumber={exp.rowNumber} />;
      case "paymentDate":
        return (
          <div className="flex items-center gap-0.5">
            <DatePickerCell rowId={exp.id} field="expensePaymentDate" value={exp.expensePaymentDate || exp.effectivePaymentDate}
              fontColor={exp.paymentDateFontColor} fontColorField="paymentDateFontColor" rowNumber={exp.rowNumber} />
            {exp.hasDateOverride && <span className="text-amber-500 text-[10px]" title={exp.dateOverrideReason || "Override"}>*</span>}
          </div>
        );
      case "linkedTask":
        return renderLinkedTask(exp);
      case "cosStatus": {
        const computedStatus = exp.computedCosStatus || exp.cosStatus;
        const isClickable = !!exp.cosOverride;
        const badge = getCosStatusBadge(exp.cosStatus);
        if (!isClickable && !exp.cosOverride) return badge;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-testid={`cos-override-btn-${exp.id}`}
                  className="cursor-pointer inline-flex items-center gap-0.5"
                  onClick={() => {
                    setCosOverrideTarget(exp);
                    setCosOverrideStatus(exp.cosOverride?.overrideStatus || "COS Realised");
                    setCosOverrideReason(exp.cosOverride?.reason || "");
                  }}
                >
                  {badge}
                  {exp.cosOverride && <span className="text-amber-500 text-[10px] font-bold">*</span>}
                </button>
              </TooltipTrigger>
              {exp.cosOverride ? (
                <TooltipContent side="top" className="max-w-xs">
                  <div className="text-xs space-y-1">
                    <p className="font-semibold">Override: {exp.cosOverride.originalStatus} → {exp.cosOverride.overrideStatus}</p>
                    <p>{exp.cosOverride.reason}</p>
                    {exp.cosOverride.overriddenBy && <p className="text-muted-foreground">By: {exp.cosOverride.overriddenBy}</p>}
                  </div>
                </TooltipContent>
              ) : (
                <TooltipContent side="top">
                  <span className="text-xs">Click to override status</span>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        );
      }
      case "paymentStatus":
        return getPaymentStatusBadge(exp.paymentStatus);
      case "plannedMonth":
        return <span className="text-xs">{formatMonth(exp.plannedMonth)}</span>;
      case "noRevLinked":
        return (
          <button
            data-testid={`no-rev-toggle-${exp.id}`}
            className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-bold transition-colors ${
              exp.noRevenueLinked
                ? "bg-amber-100 border-amber-400 text-amber-700"
                : "bg-white border-gray-300 text-gray-400 hover:border-gray-400"
            }`}
            title={exp.noRevenueLinked ? "No revenue linked (click to link)" : "Revenue linked (click to unlink)"}
            onClick={() => noRevLinkedMutation.mutate({ id: exp.id, noRevenueLinked: !exp.noRevenueLinked })}
          >
            {exp.noRevenueLinked ? "X" : ""}
          </button>
        );
      case "supplier":
        return <SupplierCell rowId={exp.id} value={extractSupplier(exp.expenseInvoiceNumber)} rowNumber={exp.rowNumber} />;
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

  const allMonths = Array.from(new Set(items.map(i => i.plannedMonth).filter(Boolean))).sort() as string[];

  return (
    <div className="space-y-3">
      {reconciliation && (
        <Card className="border-slate-200 bg-slate-50/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wallet className="h-4 w-4 text-slate-600" />
              Expenditure Trust Snapshot
            </CardTitle>
            <CardDescription className="text-xs">
              Imported cost truth, managed changes, approvals, and linked Microsoft actions stay visible together for reconciliation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-md border bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Imported budget</p>
                <p className="text-sm font-semibold">{formatCurrency(reconciliation.source.importedBudget)}</p>
                <p className="text-[10px] text-muted-foreground">{reconciliation.source.itemCount} imported line items</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Managed overrides</p>
                <p className="text-sm font-semibold">{reconciliation.managed.overriddenFieldCount}</p>
                <p className="text-[10px] text-muted-foreground">{reconciliation.managed.overriddenRowCount} rows edited</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Committed exposure</p>
                <p className="text-sm font-semibold">{formatCurrency(reconciliation.variances.committedUnpaidTotal)}</p>
                <p className="text-[10px] text-muted-foreground">{formatCurrency(reconciliation.variances.outOfBankTotal)} out of bank</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cash approvals</p>
                <p className="text-sm font-semibold">{reconciliation.approvals.affectingCashCount || 0}</p>
                <p className="text-[10px] text-muted-foreground">{reconciliation.editRequests.pendingCount} pending finance edits</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Microsoft-linked actions</p>
                <p className="text-sm font-semibold">{reconciliation.microsoft.actionRequiredCount}</p>
                <p className="text-[10px] text-muted-foreground">{reconciliation.microsoft.linkedCount} linked item(s)</p>
              </div>
            </div>

            {riskSignals.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {riskSignals.slice(0, 5).map((signal) => (
                  <div
                    key={signal.key}
                    className={`rounded-full border px-3 py-1.5 text-[11px] ${
                      signal.severity === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : signal.severity === "critical"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-slate-200 bg-white text-slate-700"
                    }`}
                    title={signal.detail}
                  >
                    <span className="font-semibold">{signal.label}</span>
                    {typeof signal.amount === "number" ? ` • ${formatCurrency(signal.amount)}` : ""}
                    {typeof signal.count === "number" ? ` • ${signal.count}` : ""}
                  </div>
                ))}
              </div>
            )}

            {reconciliation.recentChanges.length > 0 && (
              <div className="rounded-md border bg-white p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recent managed changes</p>
                {reconciliation.recentChanges.slice(0, 3).map((change) => (
                  <div key={change.id} className="flex items-start justify-between gap-3 text-xs">
                    <div>
                      <p className="font-medium text-slate-800">{change.summary || change.action}</p>
                      <p className="text-muted-foreground">
                        {(change.actorName || change.actorRole || "System")} • {new Date(change.createdAt).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {change.overrideComment && <p className="text-muted-foreground">{change.overrideComment}</p>}
                    </div>
                    {change.changedFields.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {change.changedFields.length} field{change.changedFields.length === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" data-testid="kpi-summary-strip">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 sm:p-4 hover:shadow-md transition-shadow">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-slate-100 p-2 shrink-0">
              <DollarSign className="h-4 w-4 text-slate-600" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-medium text-slate-500">Total Budget</span>
              <div className="text-base sm:text-lg font-bold font-mono text-slate-900 mt-0.5" data-testid="text-kpi-budget">{formatCurrency(kpis.totalBudget)}</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 sm:p-4 hover:shadow-md transition-shadow">
          <div className="flex items-start gap-3">
            <div className={`rounded-xl p-2 shrink-0 ${kpis.totalActual > kpis.totalBudget && kpis.totalBudget > 0 ? "bg-red-50" : "bg-blue-50"}`}>
              <BarChart3 className={`h-4 w-4 ${kpis.totalActual > kpis.totalBudget && kpis.totalBudget > 0 ? "text-red-600" : "text-blue-600"}`} />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-medium text-slate-500">Total Actual</span>
              <div className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${kpis.totalActual > kpis.totalBudget && kpis.totalBudget > 0 ? "text-red-600" : "text-blue-700"}`} data-testid="text-kpi-actual">
                {formatCurrency(kpis.totalActual)}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">{kpis.totalItems} lines</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-3 sm:p-4 hover:shadow-md transition-shadow">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 shrink-0">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-medium text-slate-500">COS Realised</span>
              <div className="text-base sm:text-lg font-bold text-emerald-600 font-mono mt-0.5" data-testid="text-kpi-cos">{formatCurrency(kpis.cosRealised)}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{kpis.countByCos["COS Realised"]} lines</div>
            </div>
          </div>
        </div>
        <div className={`bg-white rounded-xl shadow-sm border p-3 sm:p-4 hover:shadow-md transition-shadow ${kpis.variance >= 0 ? "border-emerald-200" : "border-red-200"}`}>
          <div className="flex items-start gap-3">
            <div className={`rounded-xl p-2 shrink-0 ${kpis.variance >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
              {kpis.variance >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-medium text-slate-500">Variance</span>
              <div className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${kpis.variance >= 0 ? "text-emerald-600" : "text-red-600"}`} data-testid="text-kpi-variance">
                {formatCurrency(kpis.variance)}
              </div>
              <div className={`text-[10px] mt-0.5 font-medium ${kpis.totalBudget === 0 ? "text-slate-400" : kpis.variance >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {kpis.totalBudget === 0 ? "No budget set" : kpis.variance >= 0 ? "Under budget" : "Over budget"}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 sm:p-4 hover:shadow-md transition-shadow">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-slate-100 p-2 shrink-0">
              <BarChart3 className="h-4 w-4 text-slate-600" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-medium text-slate-500">Spend %</span>
              <div className="text-base sm:text-lg font-bold font-mono mt-0.5 text-slate-700" data-testid="text-kpi-spend-pct">
                {kpis.totalBudget === 0 ? "N/A" : `${((kpis.totalActual / kpis.totalBudget) * 100).toFixed(1)}%`}
              </div>
              <div className="text-[10px] text-blue-600 mt-0.5 cursor-pointer hover:text-blue-700 font-medium transition-colors" onClick={() => setDrawerOpen(true)}>
                Drilldown →
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <div className="flex items-center gap-1 border rounded-md p-0.5 bg-card ">
          <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 px-1.5" title="Expand All" data-testid="button-expand-all">
            <ChevronsDownUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 px-1.5" title="Collapse All" data-testid="button-collapse-all">
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs" data-testid="button-columns-menu">
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

        <SearchableSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="Filter by status"
          triggerClassName="w-[160px] h-7 text-xs"
          data-testid="select-status-filter"
          options={[
            { value: "all", label: `All (${kpis.totalItems})` },
            { value: "COS Realised", label: `COS Realised (${kpis.countByCos["COS Realised"]})` },
            { value: "Committed", label: `Committed (${kpis.countByCos["Committed"]})` },
            { value: "Out of Bank", label: `Out of Bank (${kpis.countByPayment["Out of Bank"]})` },
            { value: "Payment Planned", label: `Payment Planned (${kpis.countByPayment["Payment Planned"]})` },
            { value: "Planned", label: `Planned (${kpis.countByCos.Planned})` },
          ]}
        />

        {/* Sub-project filter (only visible for multi-project/Ad Hoc trackers) */}
        {(() => {
          const subProjects = [...new Set(items.map((e: any) => e.subProjectName).filter(Boolean))];
          if (subProjects.length === 0) return null;
          return (
            <SearchableSelect
              value={subProjectFilter}
              onValueChange={setSubProjectFilter}
              placeholder="Sub-project"
              triggerClassName="w-[160px] h-7 text-xs"
              data-testid="select-sub-project-filter"
              options={[
                { value: "all", label: "All Sub-Projects" },
                ...subProjects.map(sp => ({ value: sp, label: sp })),
              ]}
            />
          );
        })()}

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

          <Button onClick={() => setDrawerOpen(true)} variant="outline" size="sm" className="h-7 text-xs" data-testid="button-drilldown">
            <Search className="h-3.5 w-3.5 mr-1" /> Drilldown
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card  shadow-sm overflow-hidden">
        {categoryGroups.length === 0 ? (
          <p className="text-center text-muted-foreground py-12" data-testid="text-empty-state">No expenditure data available for this project</p>
        ) : (
          <div ref={tableContainerRef} className="relative overflow-auto" style={{ maxHeight: "calc(100vh - 380px)", minHeight: "400px" }}>
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-muted">
                <TableRow className="bg-muted border-b-2 border-border hover:bg-muted">
                  <TableHead className="px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap w-[40px] text-center sticky left-0 z-30 bg-muted ">
                    #
                  </TableHead>
                  {activeColumns.map((col) => (
                    <TableHead key={col.key}
                      className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap
                        ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}`}
                      style={{ minWidth: col.minWidth }}>
                      {col.label}
                    </TableHead>
                  ))}
                  <TableHead className="px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap w-[80px] text-center">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryGroups.map((group) => {
                  const isCollapsed = collapsedCategories.has(group.category);
                  return (
                    <React.Fragment key={group.category}>
                      <TableRow className="bg-muted hover:bg-muted cursor-pointer border-b border-border"
                        onClick={() => toggleCategory(group.category)} data-testid={`row-category-${group.category}`}>
                        <TableCell className="sticky left-0 z-10 bg-muted px-2 py-2.5" colSpan={1}>
                          <div className="flex items-center gap-1">
                            {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </div>
                        </TableCell>
                        <TableCell colSpan={1} className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground text-sm">{group.category}</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">{group.items.length}</Badge>
                          </div>
                        </TableCell>
                        {activeColumns.slice(1).map((col) => (
                          <TableCell key={col.key} className={`px-3 py-2.5 text-xs font-bold text-muted-foreground 
                            ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}>
                            {col.key === "budgetTotal" && <span className="font-mono">{formatCurrency(group.budgetTotal)}</span>}
                            {col.key === "revenueAmount" && <span className="font-mono">{formatCurrency(group.revenueTotal)}</span>}
                            {col.key === "actualTotal" && <span className="font-mono">{formatCurrency(group.actualTotal)}</span>}
                            {col.key === "variance" && (
                              <span className={`font-mono ${group.variance >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(group.variance)}</span>
                            )}
                          </TableCell>
                        ))}
                        <TableCell />
                      </TableRow>
                      {!isCollapsed && group.items.map((exp, rowIdx) => (
                        <TableRow key={exp.id}
                          data-row-id={exp.id}
                          data-testid={`row-expense-${exp.id}`}
                          className={`border-b border-border hover:bg-blue-50/30 transition-colors
                            ${highlightedRowId === exp.id ? "bg-amber-50 ring-2 ring-amber-400 ring-inset" : rowIdx % 2 === 0 ? "bg-card " : "bg-muted/20 /30"}`}>
                          <TableCell className="px-2 py-1.5 text-center text-[10px] text-muted-foreground font-mono sticky left-0 z-10 bg-inherit">
                            {exp.rowNumber}
                          </TableCell>
                          {activeColumns.map((col) => (
                            <TableCell key={col.key}
                              className={`px-3 py-1.5
                                ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}`}
                              style={{ minWidth: col.minWidth }}>
                              {renderCellValue(exp, col)}
                            </TableCell>
                          ))}
                          <TableCell className="px-2 py-1.5 text-center">
                            {getRowStatusBadge(exp)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {hasEdits && (
        <div className="sticky bottom-0 z-30 mx-0 px-4 py-3 bg-card  border-t-2 border-blue-200 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] rounded-b-lg" data-testid="save-cancel-bar">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-amber-700 shrink-0">
              <Save className="h-4 w-4" />
              <span className="font-medium">{edits.size} {edits.size === 1 ? "row" : "rows"} modified</span>
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <SearchableSelect
                value={overrideCategory}
                onValueChange={setOverrideCategory}
                placeholder="Override category"
                triggerClassName="w-[180px] h-8 text-xs"
                data-testid="select-override-category"
                options={[
                  { value: "DATA_CORRECTION", label: "Data Correction" },
                  { value: "BUSINESS_DECISION", label: "Business Decision" },
                  { value: "TIMING_ADJUSTMENT", label: "Timing Adjustment" },
                ]}
              />
              <Input
                placeholder="Comment (min 3 chars)..."
                value={overrideComment}
                onChange={(e) => setOverrideComment(e.target.value)}
                className="h-8 text-xs flex-1 min-w-[150px] max-w-[300px]"
                data-testid="input-override-comment"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleDiscard} className="h-8 text-xs" data-testid="button-discard-edits">
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Discard
              </Button>
              <PermissionGate entity="financials" action="edit">
                <Button onClick={handleSave} disabled={saveMutation.isPending || overrideComment.length < 3} size="sm"
                  className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                  data-testid="button-save-edits">
                  <Save className="h-3.5 w-3.5 mr-1" /> {saveMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </PermissionGate>
            </div>
          </div>
        </div>
      )}

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-full sm:w-[500px] md:w-[600px] max-w-full overflow-auto">
          <SheetHeader>
            <SheetTitle>Expenditure Drilldown</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Category</Label>
                <SearchableSelect
                  value={drawerFilter.category || "all"}
                  onValueChange={v => setDrawerFilter(f => ({ ...f, category: v === "all" ? "" : v }))}
                  triggerClassName="h-8 text-xs"
                  options={[
                    { value: "all", label: "All Categories" },
                    ...categories.map(c => ({ value: c, label: c })),
                  ]}
                />
              </div>
              <div>
                <Label className="text-xs">COS Status</Label>
                <SearchableSelect
                  value={drawerFilter.cosStatus || "all"}
                  onValueChange={v => setDrawerFilter(f => ({ ...f, cosStatus: v === "all" ? "" : v }))}
                  triggerClassName="h-8 text-xs"
                  options={[
                    { value: "all", label: "All" },
                    { value: "COS Realised", label: "COS Realised" },
                    { value: "Committed", label: "Committed" },
                    { value: "Planned", label: "Planned" },
                  ]}
                />
              </div>
              <div>
                <Label className="text-xs">Payment Status</Label>
                <SearchableSelect
                  value={drawerFilter.paymentStatus || "all"}
                  onValueChange={v => setDrawerFilter(f => ({ ...f, paymentStatus: v === "all" ? "" : v }))}
                  triggerClassName="h-8 text-xs"
                  options={[
                    { value: "all", label: "All" },
                    { value: "Out of Bank", label: "Out of Bank" },
                    { value: "Payment Planned", label: "Payment Planned" },
                    { value: "Planned", label: "Planned" },
                  ]}
                />
              </div>
              <div>
                <Label className="text-xs">Planned Month</Label>
                <SearchableSelect
                  value={drawerFilter.plannedMonth || "all"}
                  onValueChange={v => setDrawerFilter(f => ({ ...f, plannedMonth: v === "all" ? "" : v }))}
                  triggerClassName="h-8 text-xs"
                  options={[
                    { value: "all", label: "All Months" },
                    ...allMonths.map(m => ({ value: m, label: formatMonth(m) })),
                  ]}
                />
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
                <SearchableSelect
                  value={drawerFilter.taskLinked || "all"}
                  onValueChange={v => setDrawerFilter(f => ({ ...f, taskLinked: v === "all" ? "" : v }))}
                  triggerClassName="h-8 text-xs"
                  options={[
                    { value: "all", label: "All" },
                    { value: "yes", label: "Linked" },
                    { value: "no", label: "Not Linked" },
                  ]}
                />
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
                      <Badge variant="outline" className="text-[8px] bg-muted">{item.expenseCategory}</Badge>
                      <span className="inline-flex items-center gap-0.5">
                        {getCosStatusBadge(item.cosStatus)}
                        {item.cosOverride && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="text-amber-500 text-[10px] font-bold">*</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <div className="text-xs space-y-1">
                                  <p className="font-semibold">Override: {item.cosOverride.originalStatus} → {item.cosOverride.overrideStatus}</p>
                                  <p>{item.cosOverride.reason}</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                      {getPaymentStatusBadge(item.paymentStatus)}
                      {getRowStatusBadge(item)}
                      {item.plannedMonth && <Badge variant="outline" className="text-[8px]">{formatMonth(item.plannedMonth)}</Badge>}
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                      <span>PO: {item.expensePoNumber || "-"}</span>
                      <span>Invoice: {item.expenseInvoiceNumber || "-"}</span>
                      <span>Inv Date: {formatDate(item.expenseInvoicedDate)}</span>
                      <span>Pay Date: {formatDate(item.effectivePaymentDate)}</span>
                      <span>Budget: {formatCurrency(item.budgetTotal)}</span>
                      <span>Variance: {formatCurrency(parseFloat(item.budgetTotal || "0") - parseFloat(item.expenseActualTotal || "0"))}</span>
                      {item.linkedTask && <span className="col-span-2">Task: {item.linkedTask.title} ({item.linkedTask.status})</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={addLineOpen} onOpenChange={setAddLineOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Line Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Category</Label>
              <SearchableSelect
                value={newLineData.category}
                onValueChange={v => setNewLineData(d => ({ ...d, category: v }))}
                placeholder="Select category"
                triggerClassName="h-8 text-xs"
                options={categories.map(c => ({ value: c, label: c }))}
              />
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

      <Dialog open={insertTaskOpen} onOpenChange={setInsertTaskOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Insert Task as Line Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Category</Label>
              <SearchableSelect
                value={insertTaskCategory}
                onValueChange={setInsertTaskCategory}
                placeholder="Select category"
                triggerClassName="h-8 text-xs"
                options={categories.map(c => ({ value: c, label: c }))}
              />
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
                        "bg-muted text-muted-foreground border-border"
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

      <Dialog open={!!cosOverrideTarget} onOpenChange={(open) => { if (!open) setCosOverrideTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="cos-override-dialog-title">Override COS Status</DialogTitle>
          </DialogHeader>
          {cosOverrideTarget && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{cosOverrideTarget.expenseLineItem}</span>
                <br />
                Computed status: <Badge className="text-[9px] ml-1" variant="outline">{cosOverrideTarget.computedCosStatus || cosOverrideTarget.cosStatus}</Badge>
              </div>
              <div className="space-y-2">
                <Label>New Status</Label>
                <SearchableSelect
                  value={cosOverrideStatus}
                  onValueChange={setCosOverrideStatus}
                  data-testid="cos-override-status-select"
                  options={[
                    { value: "COS Realised", label: "COS Realised" },
                    { value: "Committed", label: "Committed" },
                    { value: "Planned", label: "Planned" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label>Reason for Override</Label>
                <Input
                  data-testid="cos-override-reason-input"
                  placeholder="e.g. PO confirmed verbally, awaiting paperwork"
                  value={cosOverrideReason}
                  onChange={(e) => setCosOverrideReason(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {cosOverrideTarget?.cosOverride && (
              <Button
                data-testid="cos-override-remove-btn"
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50 mr-auto"
                disabled={removeCosOverrideMutation.isPending}
                onClick={() => {
                  if (cosOverrideTarget) removeCosOverrideMutation.mutate(cosOverrideTarget.id);
                  setCosOverrideTarget(null);
                }}
              >
                Remove Override
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setCosOverrideTarget(null)}>Cancel</Button>
            <Button
              data-testid="cos-override-save-btn"
              size="sm"
              disabled={!cosOverrideReason.trim() || cosOverrideMutation.isPending}
              onClick={() => {
                if (!cosOverrideTarget) return;
                cosOverrideMutation.mutate({
                  expenseId: cosOverrideTarget.id,
                  projectName: cosOverrideTarget.projectName,
                  rowNumber: cosOverrideTarget.rowNumber,
                  originalStatus: cosOverrideTarget.computedCosStatus || cosOverrideTarget.cosStatus,
                  overrideStatus: cosOverrideStatus,
                  reason: cosOverrideReason,
                });
              }}
            >
              {cosOverrideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task Link Payment Date Prompt */}
      <Dialog open={!!taskLinkPrompt} onOpenChange={(open) => { if (!open) setTaskLinkPrompt(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link Task — Payment Date</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>You are linking to: <strong>{taskLinkPrompt?.taskTitle}</strong></p>
            {taskLinkPrompt?.taskDueDate && (
              <p>Task due date: <strong>{taskLinkPrompt.taskDueDate}</strong></p>
            )}
            {taskLinkPrompt?.currentPaymentDate && (
              <p>Current payment date: <strong>{taskLinkPrompt.currentPaymentDate}</strong></p>
            )}
            <p className="text-muted-foreground">Would you like to update the payment date to match the task due date, or keep the existing date?</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setTaskLinkPrompt(null)}>Cancel</Button>
            <Button variant="outline" size="sm" onClick={() => {
              if (!taskLinkPrompt) return;
              linkTaskMutation.mutate({ expenseId: taskLinkPrompt.expenseId, taskId: taskLinkPrompt.taskId });
              setTaskLinkPrompt(null);
            }}>
              Keep Existing Date
            </Button>
            <Button size="sm" onClick={() => {
              if (!taskLinkPrompt) return;
              linkTaskMutation.mutate({ expenseId: taskLinkPrompt.expenseId, taskId: taskLinkPrompt.taskId });
              // Update payment date via date-override endpoint
              if (taskLinkPrompt.taskDueDate) {
                authFetch(`/api/expense-task-links/${encodeURIComponent(projectName)}/${taskLinkPrompt.expenseId}/date-override`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ dateOverride: taskLinkPrompt.taskDueDate, reason: "Overwritten from linked task due date" }),
                }).then(() => {
                  queryClient.invalidateQueries({ queryKey: breakdownKey });
                });
              }
              setTaskLinkPrompt(null);
            }}>
              Use Task Due Date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

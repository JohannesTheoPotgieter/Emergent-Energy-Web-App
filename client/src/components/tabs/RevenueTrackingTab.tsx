import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateDashboardQueries } from "@/lib/queryClient";
import { PermissionGate } from "@/components/PermissionGate";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Loader2, Clock, AlertTriangle, Save, XCircle,
  Edit2, FileText, DollarSign, TrendingUp, BanknoteIcon, Check,
  ChevronDown, ChevronRight, Info, Bell, X, Link, Unlink
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RevenueTrackingTabProps {
  projectName: string;
  highlightId?: number | null;
}

interface RevenueOverride {
  rowNumber: number;
  fieldName: string;
  overrideValue: string | null;
}

interface DependentTask {
  id: number;
  title: string;
  status: string;
}

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
  changedFields: Array<{
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
  }>;
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
  dependentTask: DependentTask | null;
  dateOverride: string | null;
  dateOverrideReason: string | null;
  trust?: {
    sourceSheet: string;
    sourceRow: number;
    hasVariance: boolean;
    editedFields: string[];
    lastChangedAt: string | null;
    lastChangedByName: string | null;
    taskLink: { taskId: number; changedAt: string | null; changedByName: string | null } | null;
    dateOverrideChange: { dateOverride: string; reason: string | null; changedAt: string | null; changedByName: string | null } | null;
    fieldAudits: Record<string, FinanceFieldAudit>;
  };
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
    costed: {
      revenue: number;
      expenditure: number;
      profit: number;
      margin: number;
      isManualOverride: boolean;
      trust?: {
        sourceRevenue: number;
        managedRevenue: number;
        revenueVariance: number;
        sourceExpenditure: number;
        managedExpenditure: number;
        expenditureVariance: number;
        changedAt: string | null;
        changedByName: string | null;
        overrideCategory: string | null;
        overrideComment: string | null;
      };
    };
    planned: { revenue: number; expenditure: number; profit: number; margin: number };
    actual: { revenue: number; expenditure: number; profit: number; margin: number };
    voPmLimit: number | null;
    currentVoTotal: number | null;
  };
  reconciliation?: {
    source: {
      sourceSheet: string;
      milestoneCount: number;
      importedContractValue: number;
      projectContractValue: number;
    };
    managed: {
      overriddenMilestoneCount: number;
      overriddenFieldCount: number;
      manualCostedOverride: boolean;
      latestChangeAt: string | null;
      latestChangeByName: string | null;
    };
    variances: {
      projectContractVsImported: number;
      costedRevenueVsImported: number;
      costedExpenditureVsImportedBudget: number;
      actualMarginVsCostedMargin: number;
      liveMarginVsCostedMargin: number;
      overdueExposure: number;
      unbankedExposure: number;
      unlinkedMilestones: number;
    };
    approvals: FinanceGovernanceGroup;
    editRequests: FinanceGovernanceGroup;
    microsoft: MicrosoftFinanceSummary;
    recentChanges: FinanceRecentChange[];
  };
  riskSignals?: FinanceRiskSignal[];
}

export function RevenueTrackingTab({ projectName, highlightId }: RevenueTrackingTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerFilter, setDrawerFilter] = useState<string | null>(null);
  const [editingCosted, setEditingCosted] = useState(false);
  const [costedValues, setCostedValues] = useState({ revenue: "", expenditure: "" });
  const [costedChangeReason, setCostedChangeReason] = useState("");
  const [linkingRow, setLinkingRow] = useState<number | null>(null);
  const [taskSearchTerm, setTaskSearchTerm] = useState("");
  const [dateOverrideRow, setDateOverrideRow] = useState<number | null>(null);
  const [dateOverrideValues, setDateOverrideValues] = useState({ date: "", reason: "" });
  const [highlightedRowId, setHighlightedRowId] = useState<number | null>(highlightId ?? null);
  const [subProjectFilter, setSubProjectFilter] = useState<string>("all");
  const [expandedSections, setExpandedSections] = useState({
    highlevel: true,
    contract: true,
    legend: false,
    alerts: true,
  });

  const { data, isLoading, error } = useQuery<RevenueTabData>({
    queryKey: ["revenue-tab", projectName],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/revenue-tab/${encodeURIComponent(projectName)}`, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to fetch revenue data");
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: taskAlerts = [] } = useQuery<TaskAlert[]>({
    queryKey: ["revenue-task-alerts", projectName],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/revenue-tab/${encodeURIComponent(projectName)}/task-alerts`, { credentials: "include", headers });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const describeRevenueOverride = (overridesToSave: RevenueOverride[]) => {
    const rowNumbers = Array.from(new Set(overridesToSave.map((override) => override.rowNumber))).sort((left, right) => left - right);
    const fields = Array.from(new Set(overridesToSave.map((override) => override.fieldName)));
    const category = fields.every((field) => field === "plannedPaymentDate" || field === "paymentReceivedDate")
      ? "TIMING_ADJUSTMENT"
      : "DATA_CORRECTION";
    const comment = `Updated ${fields.join(", ")} for revenue milestone row${rowNumbers.length > 1 ? "s" : ""} ${rowNumbers.join(", ")} from the project revenue workspace.`;
    return { category, comment };
  };

  const saveMutation = useMutation({
    mutationFn: async (overridesToSave: RevenueOverride[]) => {
      const token = localStorage.getItem('auth_token');
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      const governance = describeRevenueOverride(overridesToSave);
      const res = await fetch(`/api/revenue-tracking/overrides`, {
        credentials: "include",
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          overrides: overridesToSave.map(o => ({ ...o, projectName })),
          overrideCategory: governance.category,
          overrideComment: governance.comment,
        }),
      });
      if (!res.ok) throw new Error("Failed to save changes");
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.status === "pending_approval") {
        toast({ title: "Submitted for Approval", description: "Your revenue edit has been sent to management for approval." });
        queryClient.invalidateQueries({ queryKey: ["financial-edit-requests"] });
        queryClient.invalidateQueries({ queryKey: ["financial-warnings"] });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      invalidateDashboardQueries(queryClient);
      toast({ title: "Changes saved", description: "Revenue tracking updates saved successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save changes", variant: "destructive" });
    },
  });

  const toggleInBankMutation = useMutation({
    mutationFn: async ({ rowNumber, inBank }: { rowNumber: number; inBank: boolean }) => {
      const overrides: { projectName: string; rowNumber: number; fieldName: string; overrideValue: string | null }[] = [
        { projectName, rowNumber, fieldName: "inBank", overrideValue: inBank ? "1" : "0" },
      ];
      if (inBank) {
        overrides.push({ projectName, rowNumber, fieldName: "paymentReceivedDate", overrideValue: new Date().toISOString().split("T")[0] });
      } else {
        overrides.push({ projectName, rowNumber, fieldName: "paymentReceivedDate", overrideValue: null });
      }
      const token = localStorage.getItem('auth_token');
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      const governance = {
        overrideCategory: "DATA_CORRECTION",
        overrideComment: inBank
          ? `Marked revenue milestone row ${rowNumber} as received in bank from the revenue workspace.`
          : `Reopened revenue milestone row ${rowNumber} as not yet received in bank from the revenue workspace.`,
      };
      const res = await fetch(`/api/revenue-tracking/overrides`, {
        credentials: "include",
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ overrides, ...governance }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: (data, variables) => {
      if (data?.status === "pending_approval") {
        toast({
          title: "Submitted for Approval",
          description: "Your payment status change has been sent to management for approval.",
        });
        queryClient.invalidateQueries({ queryKey: ["financial-edit-requests"] });
        queryClient.invalidateQueries({ queryKey: ["financial-warnings"] });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      invalidateDashboardQueries(queryClient);
      toast({ title: variables.inBank ? "Marked as In Bank" : "Marked as outstanding", description: variables.inBank ? "Payment confirmed in bank — received date set" : "Payment marked as not yet received — received date cleared" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update payment status", variant: "destructive" });
    },
  });

  const { data: projectTasks = [] } = useQuery<any[]>({
    queryKey: ["operational-tasks", projectName],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/operational-tasks/${encodeURIComponent(projectName)}`, { credentials: "include", headers });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const linkTaskMutation = useMutation({
    mutationFn: async ({ milestoneRowNumber, taskId }: { milestoneRowNumber: number; taskId: number }) => {
      const token = localStorage.getItem('auth_token');
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/revenue-tab/${encodeURIComponent(projectName)}/link-task`, {
        credentials: "include",
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ milestoneRowNumber, taskId }),
      });
      if (!res.ok) throw new Error("Failed to link task");
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.status === "pending_approval") {
        toast({
          title: "Submitted for Approval",
          description: "Your costed value change has been sent to management for approval.",
        });
        queryClient.invalidateQueries({ queryKey: ["financial-edit-requests"] });
        queryClient.invalidateQueries({ queryKey: ["financial-warnings"] });
        setEditingCosted(false);
        setCostedChangeReason("");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      setLinkingRow(null);
      setTaskSearchTerm("");
      toast({ title: "Task linked", description: "Milestone linked to task successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to link task", variant: "destructive" });
    },
  });

  const unlinkTaskMutation = useMutation({
    mutationFn: async (milestoneRowNumber: number) => {
      const token = localStorage.getItem('auth_token');
      const hdrs: Record<string, string> = {};
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/revenue-tab/${encodeURIComponent(projectName)}/link-task/${milestoneRowNumber}`, {
        credentials: "include",
        method: "DELETE",
        headers: hdrs,
      });
      if (!res.ok) throw new Error("Failed to unlink task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      toast({ title: "Task unlinked", description: "Milestone unlinked from task" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to unlink task", variant: "destructive" });
    },
  });

  const dateOverrideMutation = useMutation({
    mutationFn: async ({ milestoneRowNumber, dateOverride, reason }: { milestoneRowNumber: number; dateOverride: string; reason: string }) => {
      const token = localStorage.getItem('auth_token');
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/revenue-tab/${encodeURIComponent(projectName)}/date-override`, {
        credentials: "include",
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ milestoneRowNumber, dateOverride, reason }),
      });
      if (!res.ok) throw new Error("Failed to save date override");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      invalidateDashboardQueries(queryClient);
      setDateOverrideRow(null);
      setDateOverrideValues({ date: "", reason: "" });
      toast({ title: "Date updated", description: "Date override saved with reason" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save date override", variant: "destructive" });
    },
  });

  const filteredTasks = useMemo(() => {
    if (!taskSearchTerm.trim()) return projectTasks;
    const term = taskSearchTerm.toLowerCase();
    return projectTasks.filter((t: any) =>
      t.title?.toLowerCase().includes(term) ||
      t.taskNumber?.toLowerCase().includes(term) ||
      t.description?.toLowerCase().includes(term) ||
      t.status?.toLowerCase().includes(term)
    );
  }, [projectTasks, taskSearchTerm]);

  const saveCostedMutation = useMutation({
    mutationFn: async (values: { revenue: string; expenditure: string }) => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/revenue-tab/${encodeURIComponent(projectName)}/costed`, {
        credentials: "include",
        method: "POST",
        headers,
        body: JSON.stringify({
          revenue: parseFloat(values.revenue) || null,
          expenditure: parseFloat(values.expenditure) || null,
          changeCategory: "RECONCILIATION",
          changeReason: costedChangeReason.trim() || "Costed revenue and expenditure adjusted from the revenue tracking workspace.",
        }),
      });
      if (!res.ok) throw new Error("Failed to save costed values");
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.status === "pending_approval") {
        toast({
          title: "Submitted for Approval",
          description: "Your costed value change has been sent to management for approval.",
        });
        queryClient.invalidateQueries({ queryKey: ["financial-edit-requests"] });
        queryClient.invalidateQueries({ queryKey: ["financial-warnings"] });
        setEditingCosted(false);
        setCostedChangeReason("");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      invalidateDashboardQueries(queryClient);
      setEditingCosted(false);
      setCostedChangeReason("");
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

  const formatDateTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return "Unknown";
    try {
      return new Date(dateStr).toLocaleString("en-ZA", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
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

  const buildMilestoneTrustTitle = (milestone: Milestone) => {
    if (!milestone.trust) return "Imported revenue line";
    const editedFields = milestone.trust.editedFields.length > 0 ? milestone.trust.editedFields.join(", ") : "None";
    const dated = milestone.trust.lastChangedAt ? `Last changed: ${formatDateTime(milestone.trust.lastChangedAt)}` : "Last changed: Imported only";
    const author = milestone.trust.lastChangedByName ? `By: ${milestone.trust.lastChangedByName}` : "By: Import";
    const reasons = Object.values(milestone.trust.fieldAudits || {})
      .map((audit) => audit.overrideComment)
      .filter(Boolean)
      .slice(0, 2)
      .join(" | ");
    return [
      `Source: ${milestone.trust.sourceSheet} row ${milestone.trust.sourceRow}`,
      `Edited fields: ${editedFields}`,
      author,
      dated,
      reasons ? `Reason: ${reasons}` : null,
    ].filter(Boolean).join("\n");
  };

  const startEditing = (row: Milestone) => {
    setEditingRow(row.rowNumber);
    setEditValues({
      invoiceNumber: row.milestoneInvoiceNumber || "",
      invoiceRaisedDate: formatDateForInput(row.invoiceRaisedDate),
      date: formatDateForInput(row.date),
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

  useEffect(() => {
    if (!highlightId) return;
    setHighlightedRowId(highlightId);
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-revenue-row-id="${highlightId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 300);
    const clearTimer = setTimeout(() => setHighlightedRowId(null), 5000);
    return () => { clearTimeout(timer); clearTimeout(clearTimer); };
  }, [highlightId]);

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

  const { milestones: rawMilestones, highlevel } = data;
  const reconciliation = data.reconciliation;
  const riskSignals = data.riskSignals || [];

  // Sub-project names (for multi-project/Ad Hoc trackers)
  const subProjectNames = useMemo(() => {
    return [...new Set(rawMilestones.map((m: any) => m.subProjectName).filter(Boolean))];
  }, [rawMilestones]);

  const milestones = useMemo(() => {
    if (subProjectFilter === "all") return rawMilestones;
    return rawMilestones.filter((m: any) => m.subProjectName === subProjectFilter);
  }, [rawMilestones, subProjectFilter]);

  const parseAmt = (m: Milestone) => parseFloat(String((m as any).milestoneAmount ?? (m as any).amount ?? 0)) || 0;

  const summary = useMemo(() => {
    const totalContract = milestones.reduce((s, m) => s + parseAmt(m), 0);
    const invoiced = milestones.filter(m => m.status === "invoiced" || m.status === "inBank" || m.status === "received").reduce((s, m) => s + parseAmt(m), 0);
    const inBank = milestones.filter(m => m.status === "inBank").reduce((s, m) => s + parseAmt(m), 0);
    const pending = milestones.filter(m => m.status === "planned" || m.status === "overdue").reduce((s, m) => s + parseAmt(m), 0);
    const overdue = milestones.filter(m => m.status === "overdue").reduce((s, m) => s + parseAmt(m), 0);
    const milestoneCount = milestones.length;
    const issueCount = milestones.filter(m => m.status === "overdue" || m.status === "invoiced").length;
    return { totalContract, invoiced, inBank, pending, overdue, milestoneCount, issueCount };
  }, [milestones]);

  const liveActual = useMemo(() => {
    const revenue = summary.inBank;
    const expenditure = highlevel.actual.expenditure;
    const profit = revenue - expenditure;
    const margin = revenue > 0 ? profit / revenue : 0;
    return { revenue, expenditure, profit, margin };
  }, [summary.inBank, highlevel.actual.expenditure]);

  const StatusBadge = ({ status, flags, milestone }: { status: string; flags: string[]; milestone: Milestone }) => {
    const hasInvoice = !!milestone.milestoneInvoiceNumber;
    const isPending = toggleInBankMutation.isPending;

    const handleStatusClick = () => {
      if (isPending) return;

      if (status === "inBank") {
        toggleInBankMutation.mutate({ rowNumber: milestone.rowNumber, inBank: false });
      } else if (status === "invoiced" || (status === "overdue" && hasInvoice)) {
        toggleInBankMutation.mutate({ rowNumber: milestone.rowNumber, inBank: true });
      } else if (status === "planned" || (status === "overdue" && !hasInvoice)) {
        toast({ title: "Invoice required", description: "Add an invoice number before marking as In Bank", variant: "destructive" });
      }
    };

    const canAdvance = (status === "invoiced") || (status === "overdue" && hasInvoice) || status === "inBank";
    const cursorClass = canAdvance ? "cursor-pointer" : status === "planned" || status === "overdue" ? "cursor-not-allowed opacity-80" : "";

    if (status === "inBank") return (
      <Badge
        className={`bg-green-100 text-green-800 hover:bg-green-200 text-xs transition-colors ${cursorClass}`}
        onClick={handleStatusClick}
        title="Click to undo — mark as outstanding"
        data-testid="badge-inbank"
      >
        <BanknoteIcon className="h-3 w-3 mr-1" /> In Bank
      </Badge>
    );
    if (status === "invoiced") return (
      <Badge
        className={`bg-blue-100 text-blue-800 hover:bg-blue-200 text-xs transition-colors ${cursorClass}`}
        onClick={handleStatusClick}
        title="Click to mark as In Bank"
        data-testid="badge-invoiced"
      >
        <FileText className="h-3 w-3 mr-1" /> Invoiced
      </Badge>
    );
    if (status === "overdue") return (
      <Badge
        className={`bg-red-100 text-red-800 hover:bg-red-200 text-xs transition-colors ${cursorClass}`}
        onClick={handleStatusClick}
        title={hasInvoice ? "Click to mark as In Bank" : "Add invoice number first"}
        data-testid="badge-overdue"
      >
        <AlertTriangle className="h-3 w-3 mr-1" /> Overdue
      </Badge>
    );
    return (
      <Badge
        variant="outline"
        className={`text-xs bg-gray-50 hover:bg-gray-100 transition-colors ${cursorClass}`}
        onClick={handleStatusClick}
        title="Add invoice number to advance status"
        data-testid="badge-planned"
      >
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

      {reconciliation && (
        <Card className="border-slate-200 bg-slate-50/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Info className="h-4 w-4 text-slate-600" />
              Finance Trust Snapshot
            </CardTitle>
            <CardDescription className="text-xs">
              Imported revenue truth stays visible while managed changes, approvals, and linked Microsoft actions remain auditable.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-md border bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Imported contract</p>
                <p className="text-sm font-semibold">{formatCurrency(reconciliation.source.importedContractValue)}</p>
                <p className="text-[10px] text-muted-foreground">{reconciliation.source.milestoneCount} imported milestone rows</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Managed overrides</p>
                <p className="text-sm font-semibold">{reconciliation.managed.overriddenFieldCount}</p>
                <p className="text-[10px] text-muted-foreground">{reconciliation.managed.overriddenMilestoneCount} milestone rows edited</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cash exposure</p>
                <p className="text-sm font-semibold">{formatCurrency(reconciliation.variances.unbankedExposure)}</p>
                <p className="text-[10px] text-muted-foreground">{formatCurrency(reconciliation.variances.overdueExposure)} overdue</p>
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
                        {(change.actorName || change.actorRole || "System")} • {formatDateTime(change.createdAt)}
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
                setCostedChangeReason(highlevel.costed.trust?.overrideComment || "");
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
                    <TableHead className="w-[160px] font-semibold">Metric</TableHead>
                    <TableHead className="text-right w-[140px] font-semibold">COSTED</TableHead>
                    <TableHead className="text-right w-[140px] font-semibold">
                      <div className="flex items-center justify-end gap-1">
                        ACTUAL
                        <span className="text-[9px] font-normal text-muted-foreground" title="Live amounts tracked against costed">(live)</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-right w-[140px] font-semibold">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Revenue</TableCell>
                    <TableCell className="text-right font-mono">
                      {editingCosted ? (
                        <Input type="number" value={costedValues.revenue} onChange={e => setCostedValues(v => ({ ...v, revenue: e.target.value }))}
                          className="h-7 text-right text-xs w-[120px] ml-auto" data-testid="input-costed-revenue" />
                      ) : (
                        <span>{formatCurrency(highlevel.costed.revenue)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(liveActual.revenue)}</TableCell>
                    <TableCell className={`text-right font-mono ${liveActual.revenue - highlevel.costed.revenue < 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(liveActual.revenue - highlevel.costed.revenue)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Expenditure</TableCell>
                    <TableCell className="text-right font-mono">
                      {editingCosted ? (
                        <Input type="number" value={costedValues.expenditure} onChange={e => setCostedValues(v => ({ ...v, expenditure: e.target.value }))}
                          className="h-7 text-right text-xs w-[120px] ml-auto" data-testid="input-costed-expenditure" />
                      ) : (
                        <span>{formatCurrency(highlevel.costed.expenditure)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(liveActual.expenditure)}</TableCell>
                    <TableCell className={`text-right font-mono ${liveActual.expenditure - highlevel.costed.expenditure > 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(liveActual.expenditure - highlevel.costed.expenditure)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell className="font-semibold">Profit</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(highlevel.costed.profit)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(liveActual.profit)}</TableCell>
                    <TableCell className={`text-right font-mono ${liveActual.profit - highlevel.costed.profit < 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(liveActual.profit - highlevel.costed.profit)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-semibold">Margin</TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(highlevel.costed.margin)}</TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(liveActual.margin)}</TableCell>
                    <TableCell className={`text-right font-mono ${(liveActual.margin - highlevel.costed.margin) < 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatPercent(liveActual.margin - highlevel.costed.margin)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {highlevel.costed.trust && (
              <div className="mt-3 rounded-md border bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                <span className="font-semibold">Source vs managed:</span>{" "}
                imported revenue {formatCurrency(highlevel.costed.trust.sourceRevenue)} / managed revenue {formatCurrency(highlevel.costed.trust.managedRevenue)}{" "}
                ({formatCurrency(highlevel.costed.trust.revenueVariance)} variance) • imported expenditure {formatCurrency(highlevel.costed.trust.sourceExpenditure)} / managed expenditure {formatCurrency(highlevel.costed.trust.managedExpenditure)}{" "}
                ({formatCurrency(highlevel.costed.trust.expenditureVariance)} variance)
                {highlevel.costed.trust.changedAt && (
                  <span>
                    {" "}• last costed change {formatDateTime(highlevel.costed.trust.changedAt)}
                    {highlevel.costed.trust.changedByName ? ` by ${highlevel.costed.trust.changedByName}` : ""}
                  </span>
                )}
                {highlevel.costed.trust.overrideComment && <span> • {highlevel.costed.trust.overrideComment}</span>}
              </div>
            )}
            {editingCosted && (
              <div className="mt-3 space-y-2">
                <Input
                  value={costedChangeReason}
                  onChange={(e) => setCostedChangeReason(e.target.value)}
                  placeholder="Reason for changing costed values (recommended)"
                  className="text-xs"
                  data-testid="input-costed-reason"
                />
                <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { setEditingCosted(false); setCostedChangeReason(""); }}>
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
                <Button size="sm" className="text-xs h-7" onClick={() => saveCostedMutation.mutate(costedValues)}
                  disabled={saveCostedMutation.isPending} data-testid="button-save-costed">
                  <Save className="h-3 w-3 mr-1" /> Save Costed
                </Button>
                </div>
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

      {/* Sub-project filter (only for multi-project/Ad Hoc trackers) */}
      {subProjectNames.length > 0 && (
        <div className="flex items-center gap-2" data-testid="revenue-sub-project-filter">
          <span className="text-xs text-muted-foreground">Sub-Project:</span>
          <select
            className="h-7 text-xs border rounded px-2 bg-background"
            value={subProjectFilter}
            onChange={e => setSubProjectFilter(e.target.value)}
            data-testid="select-revenue-sub-project"
          >
            <option value="all">All Sub-Projects</option>
            {subProjectNames.map(sp => <option key={sp} value={sp}>{sp}</option>)}
          </select>
        </div>
      )}

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
                      <TableHead className="min-w-[140px] text-xs">DEPENDENT TASK</TableHead>
                      <TableHead className="w-[130px] text-xs">STATUS</TableHead>
                      <TableHead className="w-[50px] text-xs">EDIT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {milestones.map((m) => {
                      const isEditing = editingRow === m.rowNumber;
                      return (
                        <TableRow
                          key={m.id || m.rowNumber}
                          data-revenue-row-id={m.id}
                          className={`transition-all duration-500 ${highlightedRowId === m.id ? "bg-amber-100 ring-2 ring-amber-400 ring-inset" : isEditing ? "bg-blue-50/50" : m.status === "overdue" ? "bg-red-50/30" : ""}`}
                          data-testid={`row-milestone-${m.rowNumber}`}
                        >
                          <TableCell className="font-mono text-xs">{m.milestoneNo}</TableCell>
                          <TableCell className="text-xs font-medium">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1">
                              <span className="truncate max-w-[160px]" title={m.milestoneName}>{m.milestoneName}</span>
                              {m.hasOverride && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 border-orange-300 text-orange-600"
                                  title={buildMilestoneTrustTitle(m)}
                                >
                                  edited
                                </Badge>
                              )}
                              {m.trust?.hasVariance && (
                                <span className="text-[10px] text-slate-500" title={buildMilestoneTrustTitle(m)}>
                                  <Info className="h-3 w-3" />
                                </span>
                              )}
                              </div>
                              {m.trust && (
                                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                                  <span>{m.trust.sourceSheet} row {m.trust.sourceRow}</span>
                                  {m.trust.editedFields.length > 0 && <span>{m.trust.editedFields.length} managed field change(s)</span>}
                                  {m.trust.lastChangedAt && (
                                    <span>
                                      {m.trust.lastChangedByName || "Managed edit"} • {formatDateTime(m.trust.lastChangedAt)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {m.milestonePercent ? `${(parseFloat(m.milestonePercent) * 100).toFixed(0)}%` : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-medium">{formatCurrency(m.milestoneAmount)}</TableCell>

                          {/* Single DATE column - red = planned/unconfirmed, black = in bank */}
                          <TableCell className="text-xs">
                            {dateOverrideRow === m.rowNumber ? (
                              <div className="space-y-1">
                                <Input type="date" value={dateOverrideValues.date}
                                  onChange={(e) => setDateOverrideValues(v => ({ ...v, date: e.target.value }))}
                                  className="h-6 text-[11px] w-[120px]" autoFocus data-testid={`input-date-override-${m.rowNumber}`} />
                                <Input placeholder="Reason for change..."
                                  value={dateOverrideValues.reason}
                                  onChange={(e) => setDateOverrideValues(v => ({ ...v, reason: e.target.value }))}
                                  className="h-6 text-[11px] w-[160px]" data-testid={`input-date-reason-${m.rowNumber}`} />
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]"
                                    onClick={() => {
                                      if (dateOverrideValues.date && dateOverrideValues.reason) {
                                        dateOverrideMutation.mutate({ milestoneRowNumber: m.rowNumber, dateOverride: dateOverrideValues.date, reason: dateOverrideValues.reason });
                                      } else {
                                        toast({ title: "Required", description: "Both date and reason are required", variant: "destructive" });
                                      }
                                    }}
                                    data-testid={`button-save-date-override-${m.rowNumber}`}>
                                    <Save className="h-3 w-3 mr-0.5" /> Save
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]"
                                    onClick={() => { setDateOverrideRow(null); setDateOverrideValues({ date: "", reason: "" }); }}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 group" title={buildMilestoneTrustTitle(m)}>
                                <span className={m.isRed ? "text-red-500 font-medium" : "text-foreground"}>
                                  {formatDate(m.date)}
                                </span>
                                {m.dateOverrideReason && (
                                  <span className="text-[9px] text-orange-500" title={`Override reason: ${m.dateOverrideReason}`}>*</span>
                                )}
                                <Button
                                  variant="ghost" size="sm"
                                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  onClick={() => { setDateOverrideRow(m.rowNumber); setDateOverrideValues({ date: formatDateForInput(m.date), reason: m.dateOverrideReason || "" }); }}
                                  title="Override date with reason"
                                  data-testid={`button-date-override-${m.rowNumber}`}
                                >
                                  <Edit2 className="h-3 w-3 text-gray-400" />
                                </Button>
                              </div>
                            )}
                          </TableCell>

                          {/* Invoice Number */}
                          <TableCell className="text-xs">
                            {isEditing ? (
                              <Input value={editValues.invoiceNumber} onChange={(e) => setEditValues({ ...editValues, invoiceNumber: e.target.value })}
                                className="h-7 text-xs" placeholder="INV-XXX" data-testid={`input-invoice-${m.rowNumber}`} />
                            ) : (
                              <span className="font-mono" title={m.trust?.fieldAudits?.milestoneInvoiceNumber?.overrideComment || buildMilestoneTrustTitle(m)}>
                                {m.milestoneInvoiceNumber || "-"}
                              </span>
                            )}
                          </TableCell>

                          {/* Invoice Raised Date */}
                          <TableCell className="text-xs">
                            {isEditing ? (
                              <Input type="date" value={editValues.invoiceRaisedDate} onChange={(e) => setEditValues({ ...editValues, invoiceRaisedDate: e.target.value })}
                                className="h-7 text-xs w-[110px]" data-testid={`input-invoiced-${m.rowNumber}`} />
                            ) : (
                              <span title={m.trust?.fieldAudits?.invoiceRaisedDate?.overrideComment || buildMilestoneTrustTitle(m)}>
                                {formatDate(m.invoiceRaisedDate)}
                              </span>
                            )}
                          </TableCell>

                          {/* Dependent Task */}
                          <TableCell className="text-xs">
                            {m.dependentTask ? (
                              <div className="flex items-center gap-1.5 group">
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] px-1.5 py-0 shrink-0 ${
                                    m.dependentTask.status === "complete" || m.dependentTask.status === "Complete"
                                      ? "bg-green-50 text-green-700 border-green-300"
                                      : m.dependentTask.status === "in_progress" || m.dependentTask.status === "In Progress"
                                      ? "bg-blue-50 text-blue-700 border-blue-300"
                                      : "bg-muted text-muted-foreground border-border"
                                  }`}
                                  data-testid={`badge-task-status-${m.rowNumber}`}
                                >
                                  {(m.dependentTask.status === "complete" || m.dependentTask.status === "Complete") ? "Done" : (m.dependentTask.status === "in_progress" || m.dependentTask.status === "In Progress") ? "In Progress" : "To Do"}
                                </Badge>
                                <span className="truncate max-w-[100px]" title={m.dependentTask.title} data-testid={`text-task-title-${m.rowNumber}`}>
                                  {m.dependentTask.title}
                                </span>
                                <Button
                                  variant="ghost" size="sm"
                                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  onClick={() => unlinkTaskMutation.mutate(m.rowNumber)}
                                  title="Unlink task"
                                  data-testid={`button-unlink-${m.rowNumber}`}
                                >
                                  <Unlink className="h-3 w-3 text-gray-400 hover:text-red-500" />
                                </Button>
                              </div>
                            ) : linkingRow === m.rowNumber ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1">
                                  <Input
                                    placeholder="Search tasks..."
                                    value={taskSearchTerm}
                                    onChange={(e) => setTaskSearchTerm(e.target.value)}
                                    className="h-6 text-[11px] w-[180px]"
                                    autoFocus
                                    data-testid={`input-task-search-${m.rowNumber}`}
                                  />
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                                    onClick={() => { setLinkingRow(null); setTaskSearchTerm(""); }}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                                <div className="text-[9px] text-muted-foreground px-1">
                                  {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''} found
                                </div>
                                <div className="max-h-[240px] overflow-y-auto border rounded-md bg-card shadow-sm">
                                  {filteredTasks.length === 0 ? (
                                    <p className="text-[10px] text-muted-foreground p-2">No tasks found</p>
                                  ) : (
                                    filteredTasks.map((t: any) => (
                                      <button
                                        key={t.id}
                                        className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-blue-50 border-b last:border-b-0 flex items-center gap-1.5"
                                        onClick={() => linkTaskMutation.mutate({ milestoneRowNumber: m.rowNumber, taskId: t.id })}
                                        data-testid={`option-task-${t.id}`}
                                      >
                                        <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${
                                          t.isBaseline ? "bg-purple-50 text-purple-700 border-purple-300" :
                                          t.status === "Complete" || t.status === "complete" || t.status === "Done" ? "bg-green-50 text-green-700 border-green-300" :
                                          t.status === "In Progress" || t.status === "in_progress" ? "bg-blue-50 text-blue-700 border-blue-300" :
                                          "bg-muted text-muted-foreground border-border"
                                        }`}>
                                          {t.isBaseline ? "Baseline" : (t.status === "Complete" || t.status === "complete" || t.status === "Done" ? "Done" : t.status === "In Progress" || t.status === "in_progress" ? "WIP" : "ToDo")}
                                        </Badge>
                                        {!t.isBaseline && (
                                          <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${
                                            t.status === "Complete" || t.status === "complete" || t.status === "Done" ? "bg-green-50 text-green-700 border-green-300" :
                                            t.status === "In Progress" || t.status === "in_progress" ? "bg-blue-50 text-blue-700 border-blue-300" :
                                            "bg-muted text-muted-foreground border-border"
                                          }`}>
                                            {t.status === "Complete" || t.status === "complete" || t.status === "Done" ? "Done" : t.status === "In Progress" || t.status === "in_progress" ? "WIP" : "ToDo"}
                                          </Badge>
                                        )}
                                        <span className="truncate">{t.title}</span>
                                        {t.dueDate && <span className="text-[8px] text-muted-foreground shrink-0 ml-auto">{t.dueDate}</span>}
                                      </button>
                                    ))
                                  )}
                                </div>
                              </div>
                            ) : (
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 px-2 text-[10px] text-amber-600 hover:text-amber-700 hover:bg-amber-50 gap-1"
                                onClick={() => { setLinkingRow(m.rowNumber); setTaskSearchTerm(""); }}
                                data-testid={`button-link-task-${m.rowNumber}`}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                Link Task
                              </Button>
                            )}
                          </TableCell>

                          {/* Status — clickable badge to toggle */}
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <StatusBadge status={m.status} flags={m.flags} milestone={m} />
                            </div>
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
                                  <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
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
        <SheetContent className="w-full sm:w-[500px] md:w-[600px] max-w-full overflow-y-auto">
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
                      <StatusBadge status={m.status} flags={m.flags} milestone={m} />
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

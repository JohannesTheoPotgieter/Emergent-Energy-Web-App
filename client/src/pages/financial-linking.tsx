import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Link2, Unlink, TrendingUp, DollarSign, Lightbulb,
  CheckCircle, AlertTriangle, AlertCircle, Info, Loader2, Zap,
  ChevronDown, ChevronUp,
} from "lucide-react";

const fmt = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const formatZAR = (v: number | string | null | undefined) => {
  if (v == null || v === "") return "—";
  return fmt.format(Number(v));
};

const engFetch = (url: string, opts?: RequestInit) =>
  fetch(url, { credentials: "include", ...opts });

interface PlanTask {
  id: number;
  projectName: string;
  rowNumber: number;
  taskNo: string;
  highLevelProgramme: string;
  actualStart: string | null;
  actualEnd: string | null;
  actualPctComplete: number | null;
  expectedPctComplete: number | null;
  durationDays: number | null;
}

interface RevenueMilestone {
  milestoneNo: string;
  milestoneName: string;
  milestonePercent: number | null;
  milestoneAmount: number | string | null;
  plannedPaymentDate: string | null;
  paymentReceivedDate: string | null;
  status: string;
  rowNumber: number;
}

interface ExpenseLine {
  id: number;
  projectName: string;
  rowNumber: number;
  rowType: string;
  expenseCategory: string | null;
  expenseLineItem: string | null;
  expenseActualTotal: string | null;
  budgetTotal: string | null;
  expensePoNumber: string | null;
  expenseInvoiceNumber: string | null;
  expensePaymentDate: string | null;
  forecastPaymentDate: string | null;
}

interface TaskLink {
  milestoneRowNumber: number;
  taskId: number;
  dateOverride?: string;
  dateOverrideReason?: string;
}

interface ExpenseTaskLink {
  id: number;
  expenseId: number;
  taskId: number;
}

interface SuggestedRule {
  id: string;
  ruleType: string;
  ruleConfig: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  reason: string;
}

interface SyncStatus {
  plan: { totalTasks: number };
  expenditure: { total: number; linked: number; linkPercent: number };
  revenue: { total: number; linked: number; linkPercent: number };
  overallSyncPercent: number;
  syncStatus: "good" | "partial" | "low";
}

function SyncBar({ label, linked, total, percent }: { label: string; linked: number; total: number; percent: number }) {
  const color = percent >= 80 ? "bg-emerald-500" : percent >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{linked}/{total} linked ({percent}%)</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />;
  if (severity === "warning") return <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />;
  return <Info className="h-4 w-4 text-blue-600 shrink-0" />;
}

function findBestMatchTask(tasks: PlanTask[], dateStr: string | null | undefined): number | undefined {
  if (!dateStr || !tasks.length) return undefined;
  const targetDate = new Date(dateStr).getTime();
  if (isNaN(targetDate)) return undefined;
  let bestId: number | undefined;
  let bestDist = Infinity;
  for (const t of tasks) {
    const d = t.actualEnd || t.actualStart;
    if (!d) continue;
    const dist = Math.abs(new Date(d).getTime() - targetDate);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = t.id;
    }
  }
  return bestId;
}

export default function FinancialLinkingPage() {
  const [, params] = useRoute("/project/:projectName/financial-linking");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const projectName = params?.projectName ? decodeURIComponent(params.projectName) : "";

  const [revenueExpanded, setRevenueExpanded] = useState(true);
  const [expenseExpanded, setExpenseExpanded] = useState(true);
  const [insightsExpanded, setInsightsExpanded] = useState(true);

  const { data: planTasks = [], isLoading: loadingPlan } = useQuery<PlanTask[]>({
    queryKey: ["project-plan", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/project-plan/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: revenueData, isLoading: loadingRevenue } = useQuery<{ milestones: RevenueMilestone[]; taskLinks: TaskLink[] }>({
    queryKey: ["revenue-tab", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/revenue-tab/${encodeURIComponent(projectName)}`);
      if (!res.ok) return { milestones: [], taskLinks: [] };
      const data = await res.json();
      return { milestones: data.milestones || [], taskLinks: data.taskLinks || [] };
    },
    enabled: !!projectName,
  });

  const milestones = revenueData?.milestones || [];
  const revTaskLinks = revenueData?.taskLinks || [];

  const { data: expenses = [], isLoading: loadingExpenses } = useQuery<ExpenseLine[]>({
    queryKey: ["program-expenses", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/program-expenses/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: expenseLinks = [] } = useQuery<ExpenseTaskLink[]>({
    queryKey: ["expense-task-links", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/expense-task-links/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ["financial-sync", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/financial-integration/sync-status/${encodeURIComponent(projectName)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: suggestedRules = [], isLoading: loadingSuggestions } = useQuery<SuggestedRule[]>({
    queryKey: ["suggested-rules", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/financial-integration/suggested-rules/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.suggestions || [];
    },
    enabled: !!projectName,
  });

  const linkRevenueMutation = useMutation({
    mutationFn: async ({ milestoneRowNumber, taskId }: { milestoneRowNumber: number; taskId: number }) => {
      const res = await engFetch(`/api/revenue-tab/${encodeURIComponent(projectName)}/link-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestoneRowNumber, taskId }),
      });
      if (!res.ok) throw new Error("Failed to link revenue milestone");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Revenue milestone linked" });
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      queryClient.invalidateQueries({ queryKey: ["financial-sync", projectName] });
    },
  });

  const unlinkRevenueMutation = useMutation({
    mutationFn: async (milestoneRowNumber: number) => {
      const res = await engFetch(`/api/revenue-tab/${encodeURIComponent(projectName)}/link-task/${milestoneRowNumber}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to unlink revenue milestone");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Revenue milestone unlinked" });
      queryClient.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
      queryClient.invalidateQueries({ queryKey: ["financial-sync", projectName] });
    },
  });

  const linkExpenseMutation = useMutation({
    mutationFn: async ({ expenseId, taskId }: { expenseId: number; taskId: number }) => {
      const res = await engFetch(`/api/expense-task-links/${encodeURIComponent(projectName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseId, taskId }),
      });
      if (!res.ok) throw new Error("Failed to link expense");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Expense linked to task" });
      queryClient.invalidateQueries({ queryKey: ["expense-task-links", projectName] });
      queryClient.invalidateQueries({ queryKey: ["financial-sync", projectName] });
    },
  });

  const unlinkExpenseMutation = useMutation({
    mutationFn: async (expenseId: number) => {
      const res = await engFetch(`/api/expense-task-links/${encodeURIComponent(projectName)}/${expenseId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to unlink expense");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Expense unlinked" });
      queryClient.invalidateQueries({ queryKey: ["expense-task-links", projectName] });
      queryClient.invalidateQueries({ queryKey: ["financial-sync", projectName] });
    },
  });

  const applyRuleMutation = useMutation({
    mutationFn: async ({ ruleType, ruleConfig }: { ruleType: string; ruleConfig: string }) => {
      const res = await engFetch("/api/financial-integration/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, ruleType, ruleConfig }),
      });
      if (!res.ok) throw new Error("Failed to apply rule");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule applied successfully" });
      queryClient.invalidateQueries({ queryKey: ["suggested-rules", projectName] });
      queryClient.invalidateQueries({ queryKey: ["financial-rules", projectName] });
    },
  });

  const revLinkMap = useMemo(() => {
    const m = new Map<number, number>();
    revTaskLinks.forEach((l) => m.set(l.milestoneRowNumber, l.taskId));
    return m;
  }, [revTaskLinks]);

  const expLinkMap = useMemo(() => {
    const m = new Map<number, number>();
    expenseLinks.forEach((l) => m.set(l.expenseId, l.taskId));
    return m;
  }, [expenseLinks]);

  const taskMap = useMemo(() => {
    const m = new Map<number, PlanTask>();
    planTasks.forEach((t) => m.set(t.id, t));
    return m;
  }, [planTasks]);

  const itemExpenses = useMemo(() => expenses.filter((e) => e.rowType === "item"), [expenses]);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: "default" | "destructive" | "outline" | "secondary"; label: string }> = {
      inBank: { variant: "default", label: "In Bank" },
      invoiced: { variant: "secondary", label: "Invoiced" },
      upcoming: { variant: "outline", label: "Upcoming" },
      overdue: { variant: "destructive", label: "Overdue" },
      notInvoiced: { variant: "outline", label: "Not Invoiced" },
    };
    const s = map[status] || { variant: "outline" as const, label: status };
    return <Badge variant={s.variant} className="text-[10px]" data-testid={`badge-status-${status}`}>{s.label}</Badge>;
  };

  const isLoading = loadingPlan || loadingRevenue || loadingExpenses;

  if (!projectName) {
    return <div className="p-8 text-center text-muted-foreground">No project specified</div>;
  }

  const syncColor = syncStatus?.syncStatus === "good" ? "text-emerald-600" : syncStatus?.syncStatus === "partial" ? "text-amber-600" : "text-red-600";
  const syncBg = syncStatus?.syncStatus === "good" ? "bg-emerald-50" : syncStatus?.syncStatus === "partial" ? "bg-amber-50" : "bg-red-50";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/project/${encodeURIComponent(projectName)}`)}
            data-testid="button-back-to-project"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div>
            <h1 className="text-xl font-bold" data-testid="text-page-title">Financial Linking</h1>
            <p className="text-sm text-muted-foreground" data-testid="text-project-name">{projectName}</p>
          </div>
        </div>

        {syncStatus && (
          <Card className={`${syncBg} border-0`} data-testid="card-sync-status">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-indigo-600" />
                  <span className="font-semibold text-sm">Overall Linking Progress</span>
                </div>
                <span className={`text-lg font-bold ${syncColor}`} data-testid="text-overall-sync">
                  {syncStatus.overallSyncPercent}%
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SyncBar label="Expenditure → Plan" linked={syncStatus.expenditure.linked} total={syncStatus.expenditure.total} percent={syncStatus.expenditure.linkPercent} />
                <SyncBar label="Revenue → Plan" linked={syncStatus.revenue.linked} total={syncStatus.revenue.total} percent={syncStatus.revenue.linkPercent} />
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (
          <>
            <Card data-testid="card-revenue-linking">
              <CardContent className="p-0">
                <button
                  className="flex items-center justify-between w-full p-4 text-left cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setRevenueExpanded(!revenueExpanded)}
                  data-testid="button-toggle-revenue"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <TrendingUp className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-sm">Revenue → Plan Linking</h2>
                      <p className="text-xs text-muted-foreground">{milestones.length} milestones · {revTaskLinks.length} linked</p>
                    </div>
                  </div>
                  {revenueExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {revenueExpanded && (
                  <div className="px-4 pb-4 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Milestone</TableHead>
                          <TableHead className="text-xs">Amount</TableHead>
                          <TableHead className="text-xs">Planned Date</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs min-w-[220px]">Linked Task</TableHead>
                          <TableHead className="text-xs w-[80px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {milestones.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                              No revenue milestones found
                            </TableCell>
                          </TableRow>
                        )}
                        {milestones.map((m) => {
                          const linkedTaskId = revLinkMap.get(m.rowNumber);
                          const linkedTask = linkedTaskId ? taskMap.get(linkedTaskId) : undefined;
                          const suggestedTaskId = !linkedTaskId ? findBestMatchTask(planTasks, m.plannedPaymentDate) : undefined;

                          return (
                            <TableRow key={m.rowNumber} data-testid={`row-revenue-${m.rowNumber}`}>
                              <TableCell className="text-xs font-medium">
                                <div>
                                  <span data-testid={`text-milestone-name-${m.rowNumber}`}>{m.milestoneName || `Milestone ${m.milestoneNo}`}</span>
                                  {m.milestonePercent != null && (
                                    <span className="text-muted-foreground ml-1">({(Number(m.milestonePercent) * 100).toFixed(0)}%)</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs" data-testid={`text-milestone-amount-${m.rowNumber}`}>
                                {formatZAR(m.milestoneAmount)}
                              </TableCell>
                              <TableCell className="text-xs" data-testid={`text-milestone-date-${m.rowNumber}`}>
                                {m.plannedPaymentDate || "—"}
                              </TableCell>
                              <TableCell>{statusBadge(m.status)}</TableCell>
                              <TableCell>
                                {linkedTask ? (
                                  <div className="flex items-center gap-1.5">
                                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                    <span className="text-xs truncate max-w-[160px]" data-testid={`text-linked-task-rev-${m.rowNumber}`}>
                                      {linkedTask.taskNo ? `${linkedTask.taskNo}: ` : ""}{linkedTask.highLevelProgramme}
                                    </span>
                                  </div>
                                ) : (
                                  <Select
                                    value=""
                                    onValueChange={(val) => {
                                      linkRevenueMutation.mutate({ milestoneRowNumber: m.rowNumber, taskId: Number(val) });
                                    }}
                                    data-testid={`select-link-revenue-${m.rowNumber}`}
                                  >
                                    <SelectTrigger className="h-7 text-[10px]" data-testid={`select-trigger-link-revenue-${m.rowNumber}`}>
                                      <SelectValue placeholder="Select task..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {planTasks.map((t) => (
                                        <SelectItem key={t.id} value={String(t.id)} className="text-xs">
                                          {t.taskNo ? `${t.taskNo}: ` : ""}{t.highLevelProgramme}
                                          {suggestedTaskId === t.id && " ⭐"}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </TableCell>
                              <TableCell>
                                {linkedTask && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-red-600 hover:text-red-600"
                                    onClick={() => unlinkRevenueMutation.mutate(m.rowNumber)}
                                    disabled={unlinkRevenueMutation.isPending}
                                    data-testid={`button-unlink-revenue-${m.rowNumber}`}
                                  >
                                    <Unlink className="h-3.5 w-3.5" />
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

            <Card data-testid="card-expense-linking">
              <CardContent className="p-0">
                <button
                  className="flex items-center justify-between w-full p-4 text-left cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpenseExpanded(!expenseExpanded)}
                  data-testid="button-toggle-expenses"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                      <DollarSign className="h-4 w-4 text-violet-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-sm">Expenditure → Plan Linking</h2>
                      <p className="text-xs text-muted-foreground">{itemExpenses.length} line items · {expenseLinks.length} linked</p>
                    </div>
                  </div>
                  {expenseExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {expenseExpanded && (
                  <div className="px-4 pb-4 space-y-2">
                    <BulkLinkSection
                      expenses={expenses}
                      itemExpenses={itemExpenses}
                      planTasks={planTasks}
                      expLinkMap={expLinkMap}
                      onBulkLink={async (expenseIds, taskId) => {
                        const results = await Promise.allSettled(
                          expenseIds.map((eid) =>
                            engFetch(`/api/expense-task-links/${encodeURIComponent(projectName)}`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ expenseId: eid, taskId }),
                            }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); })
                          )
                        );
                        const ok = results.filter(r => r.status === "fulfilled").length;
                        const fail = results.filter(r => r.status === "rejected").length;
                        toast({ title: `Bulk link: ${ok} linked${fail ? `, ${fail} failed` : ""}` });
                        queryClient.invalidateQueries({ queryKey: ["expense-task-links", projectName] });
                        queryClient.invalidateQueries({ queryKey: ["financial-sync", projectName] });
                      }}
                    />
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Category</TableHead>
                            <TableHead className="text-xs">Line Item</TableHead>
                            <TableHead className="text-xs">Budget</TableHead>
                            <TableHead className="text-xs">Actual</TableHead>
                            <TableHead className="text-xs">Date</TableHead>
                            <TableHead className="text-xs min-w-[220px]">Linked Task</TableHead>
                            <TableHead className="text-xs w-[80px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itemExpenses.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                                No expense line items found
                              </TableCell>
                            </TableRow>
                          )}
                          {itemExpenses.map((e) => {
                            const linkedTaskId = expLinkMap.get(e.id);
                            const linkedTask = linkedTaskId ? taskMap.get(linkedTaskId) : undefined;
                            const suggestedTaskId = !linkedTaskId ? findBestMatchTask(planTasks, e.forecastPaymentDate || e.expensePaymentDate) : undefined;

                            return (
                              <TableRow key={e.id} data-testid={`row-expense-${e.id}`}>
                                <TableCell className="text-xs text-muted-foreground" data-testid={`text-expense-category-${e.id}`}>
                                  {e.expenseCategory || "—"}
                                </TableCell>
                                <TableCell className="text-xs font-medium" data-testid={`text-expense-item-${e.id}`}>
                                  {e.expenseLineItem || "—"}
                                </TableCell>
                                <TableCell className="text-xs" data-testid={`text-expense-budget-${e.id}`}>
                                  {formatZAR(e.budgetTotal)}
                                </TableCell>
                                <TableCell className="text-xs" data-testid={`text-expense-actual-${e.id}`}>
                                  {formatZAR(e.expenseActualTotal)}
                                </TableCell>
                                <TableCell className="text-xs" data-testid={`text-expense-date-${e.id}`}>
                                  {e.expensePaymentDate || e.forecastPaymentDate || "—"}
                                </TableCell>
                                <TableCell>
                                  {linkedTask ? (
                                    <div className="flex items-center gap-1.5">
                                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                      <span className="text-xs truncate max-w-[160px]" data-testid={`text-linked-task-exp-${e.id}`}>
                                        {linkedTask.taskNo ? `${linkedTask.taskNo}: ` : ""}{linkedTask.highLevelProgramme}
                                      </span>
                                    </div>
                                  ) : (
                                    <Select
                                      value=""
                                      onValueChange={(val) => {
                                        linkExpenseMutation.mutate({ expenseId: e.id, taskId: Number(val) });
                                      }}
                                    >
                                      <SelectTrigger className="h-7 text-[10px]" data-testid={`select-trigger-link-expense-${e.id}`}>
                                        <SelectValue placeholder="Select task..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {planTasks.map((t) => (
                                          <SelectItem key={t.id} value={String(t.id)} className="text-xs">
                                            {t.taskNo ? `${t.taskNo}: ` : ""}{t.highLevelProgramme}
                                            {suggestedTaskId === t.id && " ⭐"}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {linkedTask && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 text-red-600 hover:text-red-600"
                                      onClick={() => unlinkExpenseMutation.mutate(e.id)}
                                      disabled={unlinkExpenseMutation.isPending}
                                      data-testid={`button-unlink-expense-${e.id}`}
                                    >
                                      <Unlink className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-insights">
              <CardContent className="p-0">
                <button
                  className="flex items-center justify-between w-full p-4 text-left cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setInsightsExpanded(!insightsExpanded)}
                  data-testid="button-toggle-insights"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                      <Lightbulb className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-sm">Insights & Suggested Rules</h2>
                      <p className="text-xs text-muted-foreground">
                        {loadingSuggestions ? "Analyzing..." : `${suggestedRules.length} suggestions`}
                      </p>
                    </div>
                  </div>
                  {insightsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {insightsExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    {loadingSuggestions && (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
                        <span className="text-sm text-muted-foreground">Analyzing project data...</span>
                      </div>
                    )}
                    {!loadingSuggestions && suggestedRules.length === 0 && (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        No suggestions at this time. Your project configuration looks good!
                      </div>
                    )}
                    {suggestedRules.map((rule) => (
                      <div
                        key={rule.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border ${
                          rule.severity === "critical" ? "bg-red-50 border-red-200" :
                          rule.severity === "warning" ? "bg-amber-50 border-amber-200" :
                          "bg-blue-50 border-blue-200"
                        }`}
                        data-testid={`suggestion-${rule.id}`}
                      >
                        <SeverityIcon severity={rule.severity} />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium" data-testid={`text-suggestion-title-${rule.id}`}>{rule.title}</span>
                            <Badge
                              variant={rule.severity === "critical" ? "destructive" : "outline"}
                              className="text-[9px]"
                            >
                              {rule.severity}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground" data-testid={`text-suggestion-desc-${rule.id}`}>{rule.description}</p>
                          <p className="text-[11px] italic text-muted-foreground" data-testid={`text-suggestion-reason-${rule.id}`}>{rule.reason}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 h-8 text-xs"
                          onClick={() => applyRuleMutation.mutate({ ruleType: rule.ruleType, ruleConfig: rule.ruleConfig })}
                          disabled={applyRuleMutation.isPending}
                          data-testid={`button-apply-rule-${rule.id}`}
                        >
                          {applyRuleMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Zap className="h-3 w-3 mr-1" />
                          )}
                          Apply
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function BulkLinkSection({
  expenses,
  itemExpenses,
  planTasks,
  expLinkMap,
  onBulkLink,
}: {
  expenses: ExpenseLine[];
  itemExpenses: ExpenseLine[];
  planTasks: PlanTask[];
  expLinkMap: Map<number, number>;
  onBulkLink: (expenseIds: number[], taskId: number) => void | Promise<void>;
}) {
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedTask, setSelectedTask] = useState("");

  const categories = useMemo(() => {
    const cats = new Set<string>();
    expenses.filter((e) => e.rowType === "category" && e.expenseCategory).forEach((e) => cats.add(e.expenseCategory!));
    return Array.from(cats);
  }, [expenses]);

  const unlinkedInCategory = useMemo(() => {
    if (!selectedCategory) return [];
    return itemExpenses.filter(
      (e) => e.expenseCategory === selectedCategory && !expLinkMap.has(e.id)
    );
  }, [selectedCategory, itemExpenses, expLinkMap]);

  if (categories.length === 0) return null;

  return (
    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg" data-testid="bulk-link-section">
      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Bulk link by category:</span>
      <Select value={selectedCategory} onValueChange={setSelectedCategory}>
        <SelectTrigger className="h-7 text-[10px] max-w-[200px]" data-testid="select-bulk-category">
          <SelectValue placeholder="Select category..." />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedTask} onValueChange={setSelectedTask}>
        <SelectTrigger className="h-7 text-[10px] max-w-[200px]" data-testid="select-bulk-task">
          <SelectValue placeholder="Select task..." />
        </SelectTrigger>
        <SelectContent>
          {planTasks.map((t) => (
            <SelectItem key={t.id} value={String(t.id)} className="text-xs">
              {t.taskNo ? `${t.taskNo}: ` : ""}{t.highLevelProgramme}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs shrink-0"
        disabled={!selectedCategory || !selectedTask || unlinkedInCategory.length === 0}
        onClick={() => {
          onBulkLink(unlinkedInCategory.map((e) => e.id), Number(selectedTask));
          setSelectedCategory("");
          setSelectedTask("");
        }}
        data-testid="button-bulk-link"
      >
        <Link2 className="h-3 w-3 mr-1" />
        Link {unlinkedInCategory.length} items
      </Button>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Loader2, AlertCircle, FileSpreadsheet, ArrowUpDown, ChevronDown, ChevronRight,
  Upload, Calendar, CheckCircle2, Clock,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

function formatCurrency(val: string | number | null | undefined): string {
  if (val == null || val === "") return "—";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return String(val);
  return `R${num.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseMoney(val: string | number | null | undefined): number {
  if (val == null || val === "") return 0;
  const num = typeof val === "string" ? parseFloat(val) : val;
  return isNaN(num) ? 0 : num;
}

interface ImportRun {
  id: number;
  projectName: string;
  status: string;
  uploadedAt: string;
  committedAt: string | null;
  sourceFileName: string;
  summaryJson: any;
}

type SortDir = "asc" | "desc";

function SortableHeader({ label, active, dir, onClick, testId }: {
  label: string; active: boolean; dir: SortDir; onClick: () => void; testId: string;
}) {
  return (
    <th
      className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground whitespace-nowrap"
      onClick={onClick}
      data-testid={testId}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? "text-blue-500" : "text-slate-600"}`} />
      </span>
    </th>
  );
}

function revenueStatusBadge(status: string | null | undefined) {
  const s = (status || "PLANNED").toUpperCase();
  const map: Record<string, string> = {
    PLANNED: "bg-muted text-muted-foreground border-border",
    INVOICED: "bg-blue-50 text-blue-700 border-blue-200",
    PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
    IN_BANK: "bg-purple-50 text-purple-700 border-purple-200",
    REALISED: "bg-teal-50 text-teal-700 border-teal-200",
  };
  return (
    <Badge className={`text-[10px] px-1.5 py-0 ${map[s] || map.PLANNED}`} data-testid={`badge-rev-status-${s}`}>
      {s.replace("_", " ")}
    </Badge>
  );
}

function costStatusBadge(status: string | null | undefined) {
  const s = (status || "PLANNED").toUpperCase();
  const map: Record<string, string> = {
    PLANNED: "bg-muted text-muted-foreground border-border",
    INVOICED: "bg-blue-50 text-blue-700 border-blue-200",
    APPROVED: "bg-amber-50 text-amber-700 border-amber-200",
    PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return (
    <Badge className={`text-[10px] px-1.5 py-0 ${map[s] || map.PLANNED}`} data-testid={`badge-cost-status-${s}`}>
      {s}
    </Badge>
  );
}

function planStatusBadge(status: string | null | undefined) {
  if (!status) return <span className="text-[10px] text-slate-500">—</span>;
  const s = status.toLowerCase();
  let cls = "bg-muted text-muted-foreground border-border";
  if (s.includes("complete") || s.includes("done")) cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
  else if (s.includes("progress") || s.includes("active")) cls = "bg-blue-50 text-blue-700 border-blue-200";
  else if (s.includes("delay") || s.includes("late") || s.includes("overdue")) cls = "bg-red-50 text-red-700 border-red-200";
  else if (s.includes("pending") || s.includes("not started")) cls = "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <Badge className={`text-[10px] px-1.5 py-0 ${cls}`} data-testid={`badge-plan-status`}>
      {status}
    </Badge>
  );
}

function useSortable<T>(data: T[], defaultKey: keyof T) {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggle = useCallback((key: keyof T) => {
    if (key === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }, [sortKey]);

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggle };
}

export default function ProjectNormalizedView() {
  const [, params] = useRoute("/project-normalized/:projectName");
  const projectName = params?.projectName ? decodeURIComponent(params.projectName) : "";
  const [, navigate] = useLocation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [loadingRun, setLoadingRun] = useState(false);
  const [activeTab, setActiveTab] = useState("plan");

  const loadHistory = useCallback(async () => {
    if (!projectName) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/smart-import/history/${encodeURIComponent(projectName)}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load import history (${res.status})`);
      const data: ImportRun[] = await res.json();
      setRuns(data);
      const committed = data.filter(r => r.status === "COMMITTED");
      if (committed.length > 0) {
        setSelectedRunId(String(committed[0].id));
      }
    } catch (err: any) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const [planTasks, setPlanTasks] = useState<any[]>([]);
  const [revenueLines, setRevenueLines] = useState<any[]>([]);
  const [costLines, setCostLines] = useState<any[]>([]);

  const loadNormalizedData = useCallback(async () => {
    if (!projectName) return;
    try {
      setLoadingRun(true);
      const encodedName = encodeURIComponent(projectName);
      const [planRes, revRes, expRes] = await Promise.all([
        fetch(`/api/smart-import/normalized/${encodedName}/plan`, { headers: getAuthHeaders() }),
        fetch(`/api/smart-import/normalized/${encodedName}/revenue`, { headers: getAuthHeaders() }),
        fetch(`/api/smart-import/normalized/${encodedName}/expenditure`, { headers: getAuthHeaders() }),
      ]);

      if (planRes.ok) setPlanTasks(await planRes.json());
      if (revRes.ok) setRevenueLines(await revRes.json());
      if (expRes.ok) setCostLines(await expRes.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingRun(false);
    }
  }, [projectName]);

  useEffect(() => {
    if (selectedRunId) loadNormalizedData();
  }, [selectedRunId, loadNormalizedData]);

  const committedRuns = runs.filter(r => r.status === "COMMITTED");
  const selectedRun = runs.find(r => String(r.id) === selectedRunId);

  const planCompletion = useMemo(() => {
    if (planTasks.length === 0) return 0;
    const sum = planTasks.reduce((acc: number, t: any) => acc + (t.pctComplete || 0), 0);
    return Math.round(sum / planTasks.length);
  }, [planTasks]);

  const revSummary = useMemo(() => {
    let total = 0, invoiced = 0, paid = 0, outstanding = 0, turnaroundSum = 0, turnaroundCount = 0;
    revenueLines.forEach((r: any) => {
      const amt = parseMoney(r.amountExVat);
      total += amt;
      const s = (r.status || "PLANNED").toUpperCase();
      if (s === "INVOICED") invoiced += amt;
      if (s === "PAID" || s === "IN_BANK" || s === "REALISED") paid += amt;
      if (s === "PLANNED" || s === "INVOICED") outstanding += amt;
      if (r.turnaroundDays != null) { turnaroundSum += r.turnaroundDays; turnaroundCount++; }
    });
    return { total, invoiced, paid, outstanding, avgTurnaround: turnaroundCount ? Math.round(turnaroundSum / turnaroundCount) : null };
  }, [revenueLines]);

  const costSummary = useMemo(() => {
    let total = 0, invoiced = 0, paid = 0, outstanding = 0, turnaroundSum = 0, turnaroundCount = 0;
    costLines.forEach((c: any) => {
      const amt = parseMoney(c.amountExVat);
      total += amt;
      const s = (c.status || "PLANNED").toUpperCase();
      if (s === "INVOICED" || s === "APPROVED") invoiced += amt;
      if (s === "PAID") paid += amt;
      if (s !== "PAID") outstanding += amt;
      if (c.turnaroundDays != null) { turnaroundSum += c.turnaroundDays; turnaroundCount++; }
    });
    return { total, invoiced, paid, outstanding, avgTurnaround: turnaroundCount ? Math.round(turnaroundSum / turnaroundCount) : null };
  }, [costLines]);

  const costByCategory = useMemo(() => {
    const map = new Map<string, any[]>();
    costLines.forEach((c: any) => {
      const cat = c.costCategory || "Uncategorized";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(c);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [costLines]);

  const planSort = useSortable(planTasks, "sourceRow" as any);
  const revSort = useSortable(revenueLines, "sourceRow" as any);

  const cleanName = projectName.replace(/_Tracker$/i, "").replace(/_/g, " ");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="normalized-view-loading">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="normalized-view-error">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-red-600">{error}</p>
        <Button variant="outline" size="sm" onClick={loadHistory} data-testid="btn-retry">
          Retry
        </Button>
      </div>
    );
  }

  if (committedRuns.length === 0) {
    return (
      <div className="space-y-4" data-testid="normalized-view-empty">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-project-name">{cleanName}</h1>
          <p className="text-sm text-muted-foreground">Normalized Import View</p>
        </div>
        <Card className="bg-card rounded-xl shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <FileSpreadsheet className="w-12 h-12 text-slate-600" />
            <p className="text-sm text-muted-foreground text-center max-w-md" data-testid="text-empty-message">
              No normalized data available yet. Import an Excel tracker to see unified project views.
            </p>
            <Button
              onClick={() => navigate("/smart-import")}
              data-testid="btn-start-import"
            >
              <Upload className="w-4 h-4 mr-2" />
              Start Import
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="normalized-view-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-project-name">{cleanName}</h1>
          <div className="flex items-center gap-2 mt-1">
            {selectedRun && (
              <>
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0" data-testid="badge-status">
                  <CheckCircle2 className="w-3 h-3 mr-0.5" />
                  Committed
                </Badge>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1" data-testid="text-import-date">
                  <Calendar className="w-3 h-3" />
                  {formatDate(selectedRun.committedAt || selectedRun.uploadedAt)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {committedRuns.length > 1 && (
            <SearchableSelect
              value={selectedRunId}
              onValueChange={setSelectedRunId}
              placeholder="Select import run"
              triggerClassName="w-[220px] text-xs"
              data-testid="select-trigger-history"
              options={committedRuns.map((r) => ({
                value: String(r.id),
                label: `${r.sourceFileName} — ${formatDate(r.committedAt || r.uploadedAt)}`,
              }))}
            />
          )}
          <Button variant="outline" size="sm" onClick={() => navigate("/smart-import")} data-testid="btn-import-new">
            <Upload className="w-4 h-4 mr-1" />
            Import New Tracker
          </Button>
        </div>
      </div>

      {loadingRun ? (
        <div className="flex items-center justify-center py-12" data-testid="normalized-run-loading">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="normalized-tabs">
          <TabsList className="grid w-full grid-cols-3 max-w-md" data-testid="tabs-list">
            <TabsTrigger value="plan" data-testid="tab-plan">
              Plan ({planTasks.length})
            </TabsTrigger>
            <TabsTrigger value="revenue" data-testid="tab-revenue">
              Revenue ({revenueLines.length})
            </TabsTrigger>
            <TabsTrigger value="expenditure" data-testid="tab-expenditure">
              Expenditure ({costLines.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="plan" className="space-y-3 mt-3" data-testid="tab-content-plan">
            <div className="flex items-center gap-4">
              <Card className="bg-card rounded-xl shadow-sm flex-1">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Completion</span>
                    <span className="text-sm font-bold" data-testid="text-plan-completion">{planCompletion}%</span>
                  </div>
                  <Progress value={planCompletion} className="h-2" data-testid="progress-plan" />
                </CardContent>
              </Card>
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-4">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Tasks</div>
                  <div className="text-xl font-bold mt-1" data-testid="text-plan-count">{planTasks.length}</div>
                </CardContent>
              </Card>
            </div>

            {planTasks.length === 0 ? (
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="py-12 text-center text-sm text-muted-foreground" data-testid="text-plan-empty">
                  No plan data available
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-card rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" data-testid="table-plan">
                    <thead>
                      <tr className="bg-muted border-b border-border">
                        <SortableHeader label="Task Name" active={planSort.sortKey === "taskName"} dir={planSort.sortDir} onClick={() => planSort.toggle("taskName" as any)} testId="sort-plan-taskName" />
                        <SortableHeader label="Phase" active={planSort.sortKey === "phase"} dir={planSort.sortDir} onClick={() => planSort.toggle("phase" as any)} testId="sort-plan-phase" />
                        <SortableHeader label="Start Date" active={planSort.sortKey === "startDate"} dir={planSort.sortDir} onClick={() => planSort.toggle("startDate" as any)} testId="sort-plan-startDate" />
                        <SortableHeader label="End Date" active={planSort.sortKey === "endDate"} dir={planSort.sortDir} onClick={() => planSort.toggle("endDate" as any)} testId="sort-plan-endDate" />
                        <SortableHeader label="Duration" active={planSort.sortKey === "durationDays"} dir={planSort.sortDir} onClick={() => planSort.toggle("durationDays" as any)} testId="sort-plan-duration" />
                        <SortableHeader label="Owner" active={planSort.sortKey === "owner"} dir={planSort.sortDir} onClick={() => planSort.toggle("owner" as any)} testId="sort-plan-owner" />
                        <SortableHeader label="Status" active={planSort.sortKey === "status"} dir={planSort.sortDir} onClick={() => planSort.toggle("status" as any)} testId="sort-plan-status" />
                        <SortableHeader label="% Complete" active={planSort.sortKey === "pctComplete"} dir={planSort.sortDir} onClick={() => planSort.toggle("pctComplete" as any)} testId="sort-plan-pctComplete" />
                      </tr>
                    </thead>
                    <tbody>
                      {planSort.sorted.map((t: any, idx: number) => (
                        <tr key={idx} className={`border-b border-border hover:bg-muted/50 ${idx % 2 ? "bg-slate-25" : ""}`} data-testid={`row-plan-${idx}`}>
                          <td className="px-3 py-2 text-xs font-medium max-w-[200px] truncate" data-testid={`text-plan-task-${idx}`}>{t.taskName || "—"}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{t.phase || "—"}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{formatDate(t.startDate)}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{formatDate(t.endDate)}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{t.durationDays != null ? `${t.durationDays}d` : "—"}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground truncate max-w-[100px]">{t.owner || "—"}</td>
                          <td className="px-3 py-2">{planStatusBadge(t.status)}</td>
                          <td className="px-3 py-2">
                            {t.pctComplete != null ? (
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden min-w-[30px] max-w-[50px]">
                                  <div
                                    className={`h-full rounded-full ${t.pctComplete >= 90 ? "bg-emerald-500" : t.pctComplete >= 50 ? "bg-blue-500" : "bg-amber-500"}`}
                                    style={{ width: `${Math.min(100, t.pctComplete)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground w-[28px] text-right">{Math.round(t.pctComplete)}%</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="revenue" className="space-y-3 mt-3" data-testid="tab-content-revenue">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Revenue</div>
                  <div className="text-lg font-bold mt-1" data-testid="text-rev-total">{formatCurrency(revSummary.total)}</div>
                </CardContent>
              </Card>
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Invoiced</div>
                  <div className="text-lg font-bold mt-1 text-blue-600" data-testid="text-rev-invoiced">{formatCurrency(revSummary.invoiced)}</div>
                </CardContent>
              </Card>
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Paid</div>
                  <div className="text-lg font-bold mt-1 text-emerald-600" data-testid="text-rev-paid">{formatCurrency(revSummary.paid)}</div>
                </CardContent>
              </Card>
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Outstanding</div>
                  <div className="text-lg font-bold mt-1 text-amber-600" data-testid="text-rev-outstanding">{formatCurrency(revSummary.outstanding)}</div>
                </CardContent>
              </Card>
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Avg Turnaround
                  </div>
                  <div className="text-lg font-bold mt-1" data-testid="text-rev-turnaround">
                    {revSummary.avgTurnaround != null ? `${revSummary.avgTurnaround}d` : "—"}
                  </div>
                </CardContent>
              </Card>
            </div>

            {revenueLines.length === 0 ? (
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="py-12 text-center text-sm text-muted-foreground" data-testid="text-rev-empty">
                  No revenue data available
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-card rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" data-testid="table-revenue">
                    <thead>
                      <tr className="bg-muted border-b border-border">
                        <SortableHeader label="Milestone" active={revSort.sortKey === "milestoneName"} dir={revSort.sortDir} onClick={() => revSort.toggle("milestoneName" as any)} testId="sort-rev-milestone" />
                        <SortableHeader label="Amount (ex VAT)" active={revSort.sortKey === "amountExVat"} dir={revSort.sortDir} onClick={() => revSort.toggle("amountExVat" as any)} testId="sort-rev-amount" />
                        <SortableHeader label="Invoice #" active={revSort.sortKey === "invoiceNumber"} dir={revSort.sortDir} onClick={() => revSort.toggle("invoiceNumber" as any)} testId="sort-rev-invoice" />
                        <SortableHeader label="Invoice Date" active={revSort.sortKey === "invoiceDate"} dir={revSort.sortDir} onClick={() => revSort.toggle("invoiceDate" as any)} testId="sort-rev-invDate" />
                        <SortableHeader label="Expected Date" active={revSort.sortKey === "expectedPaymentDate"} dir={revSort.sortDir} onClick={() => revSort.toggle("expectedPaymentDate" as any)} testId="sort-rev-expected" />
                        <SortableHeader label="Paid Date" active={revSort.sortKey === "paidDate"} dir={revSort.sortDir} onClick={() => revSort.toggle("paidDate" as any)} testId="sort-rev-paidDate" />
                        <SortableHeader label="In Bank" active={revSort.sortKey === "inBankDate"} dir={revSort.sortDir} onClick={() => revSort.toggle("inBankDate" as any)} testId="sort-rev-inBank" />
                        <SortableHeader label="Status" active={revSort.sortKey === "status"} dir={revSort.sortDir} onClick={() => revSort.toggle("status" as any)} testId="sort-rev-status" />
                        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Turnaround</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revSort.sorted.map((r: any, idx: number) => (
                        <tr key={idx} className={`border-b border-border hover:bg-muted/50 ${idx % 2 ? "bg-slate-25" : ""}`} data-testid={`row-rev-${idx}`}>
                          <td className="px-3 py-2 text-xs font-medium max-w-[180px] truncate" data-testid={`text-rev-milestone-${idx}`}>{r.milestoneName || r.description || "—"}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground text-right font-mono">{formatCurrency(r.amountExVat)}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{r.invoiceNumber || "—"}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{formatDate(r.invoiceDate)}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{formatDate(r.expectedPaymentDate)}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{formatDate(r.paidDate)}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{formatDate(r.inBankDate)}</td>
                          <td className="px-3 py-2">{revenueStatusBadge(r.status)}</td>
                          <td className="px-3 py-2 text-[10px] text-muted-foreground">{r.turnaroundDays != null ? `${r.turnaroundDays}d` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="expenditure" className="space-y-3 mt-3" data-testid="tab-content-expenditure">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Costs</div>
                  <div className="text-lg font-bold mt-1" data-testid="text-cost-total">{formatCurrency(costSummary.total)}</div>
                </CardContent>
              </Card>
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Invoiced</div>
                  <div className="text-lg font-bold mt-1 text-blue-600" data-testid="text-cost-invoiced">{formatCurrency(costSummary.invoiced)}</div>
                </CardContent>
              </Card>
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Paid</div>
                  <div className="text-lg font-bold mt-1 text-emerald-600" data-testid="text-cost-paid">{formatCurrency(costSummary.paid)}</div>
                </CardContent>
              </Card>
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Outstanding</div>
                  <div className="text-lg font-bold mt-1 text-amber-600" data-testid="text-cost-outstanding">{formatCurrency(costSummary.outstanding)}</div>
                </CardContent>
              </Card>
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Avg Turnaround
                  </div>
                  <div className="text-lg font-bold mt-1" data-testid="text-cost-turnaround">
                    {costSummary.avgTurnaround != null ? `${costSummary.avgTurnaround}d` : "—"}
                  </div>
                </CardContent>
              </Card>
            </div>

            {costLines.length === 0 ? (
              <Card className="bg-card rounded-xl shadow-sm">
                <CardContent className="py-12 text-center text-sm text-muted-foreground" data-testid="text-cost-empty">
                  No expenditure data available
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {costByCategory.map(([category, items]) => (
                  <CostCategoryGroup key={category} category={category} items={items} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function CostCategoryGroup({ category, items }: { category: string; items: any[] }) {
  const [open, setOpen] = useState(true);
  const catTotal = items.reduce((sum: number, c: any) => sum + parseMoney(c.amountExVat), 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-card rounded-xl shadow-sm overflow-hidden">
        <CollapsibleTrigger className="w-full" data-testid={`trigger-category-${category}`}>
          <div className="flex items-center justify-between px-4 py-3 bg-muted border-b border-border hover:bg-muted transition-colors">
            <div className="flex items-center gap-2">
              {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <span className="text-xs font-semibold text-foreground" data-testid={`text-category-name-${category}`}>{category}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0" data-testid={`badge-category-count-${category}`}>
                {items.length} item{items.length !== 1 ? "s" : ""}
              </Badge>
            </div>
            <span className="text-xs font-bold text-foreground font-mono" data-testid={`text-category-total-${category}`}>
              {formatCurrency(catTotal)}
            </span>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid={`table-cost-${category}`}>
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Counterparty</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Amount</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">PO #</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Invoice #</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Invoice Date</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Paid Date</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Turnaround</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c: any, idx: number) => (
                  <tr key={idx} className={`border-b border-border hover:bg-muted/50 ${idx % 2 ? "bg-slate-25" : ""}`} data-testid={`row-cost-${category}-${idx}`}>
                    <td className="px-3 py-2 text-xs font-medium truncate max-w-[140px]">{c.counterpartyName || "—"}</td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground truncate max-w-[160px]">{c.description || "—"}</td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground text-right font-mono">{formatCurrency(c.amountExVat)}</td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{c.poNumber || "—"}</td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{c.invoiceNumber || "—"}</td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{formatDate(c.invoiceDate)}</td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{formatDate(c.paidDate)}</td>
                    <td className="px-3 py-2">{costStatusBadge(c.status)}</td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{c.turnaroundDays != null ? `${c.turnaroundDays}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

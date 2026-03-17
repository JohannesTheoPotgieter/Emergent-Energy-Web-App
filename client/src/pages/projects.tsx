import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Search,
  AlertCircle,
  Check,
  Link2,
  Ban,
  Clock,
  CheckCircle2,
  ExternalLink,
  X,
  FileText,
  Shield,
  Upload,
  Loader2,
  Paperclip,
  Zap,
  TrendingDown,
  TrendingUp,
  Activity,
  BarChart3,
  Calendar,
  Pencil,
  Flag,
  ChevronDown,
  Eye,
  EyeOff,
  Save,
  Trash2,
  LayoutGrid,
  Table2,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { apiRequest, invalidateDashboardQueries } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import type { PlatformProjectSummaryContract } from "@shared/platform-contracts";
import { PROJECT_PHASES, PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageShell, SectionHeader, WorkspaceNotice } from "@/components/layout/page-shell";
import { isSuperAdmin } from "@/lib/access-control";

interface ProjectSummary {
  project_info_id: number | null;
  project_name: string;
  client_id: number | null;
  client_name: string | null;
  size_kwp: number | null;
  pd: string | null;
  pm: string | null;
  cost_proposal_signed: string | null;
  cost_proposal_type: string | null;
  cost_proposal_link: string | null;
  cost_proposal_na_reason: string | null;
  funding_signed: string | null;
  funding_type: string | null;
  funding_link: string | null;
  funding_na_reason: string | null;
  epc_contract_signed: string | null;
  epc_contract_type: string | null;
  epc_contract_link: string | null;
  epc_contract_na_reason: string | null;
  financial_close_achieved: boolean;
  phase: string | null;
  pd_handover_date: string | null;
  construction_start_date: string | null;
  duration: number | null;
  kw_per_week: number | null;
  commissioning_date: string | null;
  om_handover_date: string | null;
  client_handover_date: string | null;
  date_sources: {
    pd_handover: 'plan' | 'info' | 'none';
    construction_start: 'plan' | 'info' | 'none';
    commissioning: 'plan' | 'info' | 'none';
    om_handover: 'plan' | 'info' | 'none';
    client_handover: 'plan' | 'info' | 'none';
  };
  project_pct_complete: number | null;
  expected_pct_complete: number | null;
  delta_vs_expected: number | null;
  total_contract_revenue: number | null;
  actual_revenue: number | null;
  total_expenses: number | null;
  actual_expenses: number | null;
  gp_percent: number | null;
  revenue_outstanding: number | null;
  expenses_due: number | null;
  current_vo_total: number | null;
  comments: string | null;
  latest_update: string | null;
  latest_update_at: string | null;
  latest_update_by: string | null;
  escalation_level: string | null;
  rag_status?: string | null;
  task_status_counts: Record<string, number>;
  phase_updated_at: string | null;
  has_tracker_import: boolean;
  last_import_at?: string | null;
  is_active: boolean;
  pd_pm_handover_status?: string;
  pd_pm_handover_rejection_reason?: string | null;
  shared_summary?: PlatformProjectSummaryContract | null;
  next_open_inflow_milestone?: { name: string; plannedDate: string | null; overdue: boolean; openCount: number } | null;
}

type SortDir = "asc" | "desc";
type SortKey = string;

function cleanName(name: string): string {
  return name.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
}

function formatDate(val: string | null): string {
  if (!val) return "—";
  try {
    const d = new Date(val + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    const day = d.getDate().toString().padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mon = months[d.getMonth()];
    const yr = d.getFullYear().toString().slice(-2);
    return `${day} ${mon} ${yr}`;
  } catch {
    return "—";
  }
}

function formatPct(val: number | null): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

function safeNum(val: number | null): number {
  return val !== null && val !== undefined && Number.isFinite(val) ? val : 0;
}

function phaseConfig(phase: string | null): { bg: string; text: string; border: string; dot: string } {
  const map: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    P0_FIRST_ASSESSMENT: { bg: "bg-muted", text: "text-foreground", border: "border-border", dot: "bg-slate-500" },
    P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500" },
    P2_PD_PM_HANDOVER: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-500" },
    P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
    P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
    P5_COMMISSIONING_TESTING: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
    P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", dot: "bg-teal-500" },
    P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
    "First Assessment": { bg: "bg-muted", text: "text-foreground", border: "border-border", dot: "bg-slate-500" },
    "Cost Proposal": { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500" },
    "DLP": { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-500" },
    "Financial Close": { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500" },
    "Planning": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
    "Construction": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
    "QA": { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
    "Handover": { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", dot: "bg-teal-500" },
    "Commercial Close Out": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
    "Compliance Handover": { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200", dot: "bg-cyan-500" },
    "Hold": { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", dot: "bg-rose-500" },
    "Gone": { bg: "bg-red-50", text: "text-red-800", border: "border-red-300", dot: "bg-red-800" },
  };
  return (phase && map[phase]) || { bg: "bg-muted", text: "text-muted-foreground", border: "border-border", dot: "bg-slate-400" };
}

function getPhaseLabel(phase: string | null): string {
  if (!phase) return "—";
  return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
}

function progressColor(pct: number): string {
  if (pct >= 90) return "bg-emerald-500";
  if (pct >= 60) return "bg-blue-500";
  if (pct >= 30) return "bg-amber-500";
  return "bg-slate-400";
}

interface TaskEdits {
  [rowNumber: number]: { [field: string]: string | number | null };
}

function TaskCompletionPopover({ projectName, currentPct }: { projectName: string; currentPct: number }) {
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState<TaskEdits>({});
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["/api/project-plan", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/project-plan/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data || []).filter((t: any) => {
        const tn = (t.taskNo || '').toString().toLowerCase().trim();
        return tn !== 'no.' && tn !== 'no' && tn !== '#' && t.highLevelProgramme;
      });
    },
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async (allEdits: TaskEdits) => {
      const overrides: any[] = [];
      for (const [rowStr, fields] of Object.entries(allEdits)) {
        const rowNumber = parseInt(rowStr);
        for (const [fieldName, value] of Object.entries(fields)) {
          let overrideValue: string;
          if (fieldName === "actualPctComplete" || fieldName === "expectedPctComplete") {
            overrideValue = String(Number(value) / 100);
          } else {
            overrideValue = value === null ? "" : String(value);
          }
          overrides.push({ projectName, rowNumber, fieldName, overrideValue });
        }
      }
      await apiRequest("POST", "/api/project-plan/overrides", {
        overrides,
        overrideCategory: "DATA_CORRECTION",
        overrideComment: "Edited via project list task editor",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/project-plan", projectName] });
      invalidateDashboardQueries(queryClient);
      setEdits({});
      setEditingRow(null);
      setOpen(false);
    },
  });

  const getField = (task: any, field: string) => {
    const rowEdits = edits[task.rowNumber];
    if (rowEdits && field in rowEdits) return rowEdits[field];
    return task[field];
  };

  const setField = (rowNumber: number, field: string, value: any) => {
    setEdits(prev => ({
      ...prev,
      [rowNumber]: { ...(prev[rowNumber] || {}), [field]: value },
    }));
  };

  const getActPct = (task: any) => {
    const rowEdits = edits[task.rowNumber];
    if (rowEdits && "actualPctComplete" in rowEdits) return Math.round(Number(rowEdits.actualPctComplete));
    return task.actualPctComplete != null ? Math.round(Number(task.actualPctComplete) * 100) : 0;
  };

  const setActPct = (rowNumber: number, pctVal: number) => {
    setField(rowNumber, "actualPctComplete", Math.max(0, Math.min(100, pctVal)));
  };

  const weightedPct = useMemo(() => {
    if (!tasks || tasks.length === 0) return currentPct;
    let totalW = 0, wSum = 0;
    for (const t of tasks as any[]) {
      const durVal = getField(t, "durationDays");
      const dur = durVal && Number(durVal) > 0 ? Number(durVal) : 1;
      const pct = getActPct(t) / 100;
      wSum += pct * dur;
      totalW += dur;
    }
    return totalW > 0 ? (wSum / totalW) * 100 : 0;
  }, [tasks, edits, currentPct]);

  const hasEdits = Object.keys(edits).length > 0;

  const filtered = useMemo(() => {
    if (!tasks) return [];
    if (!searchQ) return tasks as any[];
    const q = searchQ.toLowerCase();
    return (tasks as any[]).filter((t: any) =>
      (t.highLevelProgramme || '').toLowerCase().includes(q) ||
      (t.taskNo || '').toString().toLowerCase().includes(q)
    );
  }, [tasks, searchQ]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEdits({}); setEditingRow(null); setSearchQ(""); } }}>
      <PopoverTrigger asChild>
        <button data-interactive="true" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 min-w-[60px] w-full cursor-pointer hover:opacity-80 transition-opacity" data-testid={`btn-act-pct-${projectName}`}>
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressColor(currentPct)}`}
              style={{ width: `${Math.min(currentPct, 100)}%` }}
            />
          </div>
          <span className="font-mono text-[10px] w-8 text-right font-medium text-foreground">{currentPct.toFixed(0)}%</span>
        </button>
      </PopoverTrigger>
      <PopoverContent onClick={(e) => e.stopPropagation()} className="w-[90vw] sm:w-[520px] max-w-[520px] p-0 max-h-[500px] overflow-hidden" align="start" side="bottom" data-testid={`popover-tasks-${projectName}`}>
        <div className="p-3 border-b bg-muted">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-foreground">Edit Tasks</p>
              <p className="text-[11px] text-muted-foreground">{projectName.replace(/_Tracker$/i, "").replace(/_/g, " ")} — {(tasks as any[])?.length || 0} tasks</p>
            </div>
            {hasEdits && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono font-semibold text-blue-600">Act%: {weightedPct.toFixed(0)}%</span>
                <Button size="sm" className="h-7 text-xs px-2" onClick={() => saveMutation.mutate(edits)} disabled={saveMutation.isPending} data-testid="btn-save-task-edits">
                  {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                  Save All
                </Button>
              </div>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="w-full h-7 text-xs pl-7 pr-2 border rounded bg-card"
              data-testid="input-search-tasks"
            />
          </div>
        </div>
        <div className="overflow-y-auto max-h-[400px]">
          {isLoading ? (
            <div className="p-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-slate-500" /></div>
          ) : filtered.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-muted z-10">
                <tr className="text-muted-foreground font-medium border-b">
                  <th className="text-left px-2 py-1.5 w-8">#</th>
                  <th className="text-left px-2 py-1.5">Task</th>
                  <th className="text-left px-2 py-1.5 w-20">Start</th>
                  <th className="text-left px-2 py-1.5 w-20">End</th>
                  <th className="text-center px-2 py-1.5 w-12">Days</th>
                  <th className="text-center px-2 py-1.5 w-14">Act%</th>
                  <th className="w-7"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task: any) => {
                  const isEditing = editingRow === task.rowNumber;
                  const actPct = getActPct(task);
                  return (
                    <tr
                      key={task.rowNumber}
                      className={`border-b border-slate-50 hover:bg-blue-50/30 transition-colors ${isEditing ? 'bg-blue-50/50' : ''}`}
                      data-testid={`task-row-${task.rowNumber}`}
                    >
                      <td className="px-2 py-1.5 text-slate-500 font-mono">{task.taskNo || "-"}</td>
                      <td className="px-2 py-1.5">
                        {isEditing ? (
                          <input
                            type="text"
                            value={getField(task, "highLevelProgramme") || ""}
                            onChange={(e) => setField(task.rowNumber, "highLevelProgramme", e.target.value)}
                            className="w-full h-6 text-[11px] border rounded px-1"
                            data-testid={`input-task-name-${task.rowNumber}`}
                          />
                        ) : (
                          <span className="truncate block max-w-[160px] font-medium text-foreground" title={task.highLevelProgramme}>
                            {getField(task, "highLevelProgramme") || "-"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {isEditing ? (
                          <input
                            type="date"
                            value={getField(task, "actualStart") || ""}
                            onChange={(e) => setField(task.rowNumber, "actualStart", e.target.value)}
                            className="w-full h-6 text-[10px] border rounded px-0.5"
                            data-testid={`input-task-start-${task.rowNumber}`}
                          />
                        ) : (
                          <span className="text-muted-foreground font-mono text-[10px]">{(getField(task, "actualStart") || "-").toString().substring(0, 10)}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {isEditing ? (
                          <input
                            type="date"
                            value={getField(task, "actualEnd") || ""}
                            onChange={(e) => setField(task.rowNumber, "actualEnd", e.target.value)}
                            className="w-full h-6 text-[10px] border rounded px-0.5"
                            data-testid={`input-task-end-${task.rowNumber}`}
                          />
                        ) : (
                          <span className="text-muted-foreground font-mono text-[10px]">{(getField(task, "actualEnd") || "-").toString().substring(0, 10)}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            value={getField(task, "durationDays") ?? ""}
                            onChange={(e) => setField(task.rowNumber, "durationDays", e.target.value ? parseInt(e.target.value) : null)}
                            className="w-12 h-6 text-[10px] font-mono text-center border rounded"
                            data-testid={`input-task-dur-${task.rowNumber}`}
                          />
                        ) : (
                          <span className="text-muted-foreground font-mono">{getField(task, "durationDays") ?? "-"}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex items-center gap-1">
                          <div className="w-8 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${progressColor(actPct)}`} style={{ width: `${actPct}%` }} />
                          </div>
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={actPct}
                              onChange={(e) => setActPct(task.rowNumber, parseInt(e.target.value) || 0)}
                              className="w-9 h-6 text-[10px] font-mono text-center border rounded"
                              data-testid={`input-task-pct-${task.rowNumber}`}
                            />
                          ) : (
                            <span className="font-mono text-muted-foreground w-7 text-right">{actPct}%</span>
                          )}
                        </div>
                      </td>
                      <td className="px-1 py-1.5">
                        <button
                          onClick={() => setEditingRow(isEditing ? null : task.rowNumber)}
                          className={`p-0.5 rounded transition-colors ${isEditing ? 'text-blue-600 bg-blue-100' : 'text-slate-500 hover:text-muted-foreground hover:bg-muted'}`}
                          title={isEditing ? "Done editing" : "Edit task"}
                          data-testid={`btn-edit-task-${task.rowNumber}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-6 text-center text-sm text-slate-500">No tasks found</div>
          )}
        </div>
        {hasEdits && (
          <div className="p-2 border-t bg-muted text-[10px] text-muted-foreground text-center">
            {Object.keys(edits).length} task(s) modified — edits are saved as overrides and preserved across imports
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function deltaColor(val: number): { text: string; bg: string } {
  if (val >= 0) return { text: "text-emerald-700", bg: "bg-emerald-50" };
  if (val > -5) return { text: "text-amber-700", bg: "bg-amber-50" };
  return { text: "text-rose-700", bg: "bg-rose-50" };
}

type FinCloseMode = "link" | "na" | null;

function FinancialCloseCell({
  projectName,
  fieldPrefix,
  type,
  link,
  naReason,
  isAdmin,
}: {
  projectName: string;
  fieldPrefix: "costProposal" | "funding" | "epcContract";
  type: string | null;
  link: string | null;
  naReason: string | null;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<FinCloseMode>((type as FinCloseMode) || null);
  const [linkVal, setLinkVal] = useState(link || "");
  const [reason, setReason] = useState(naReason || "");
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, string | null>) => {
      await apiRequest("POST", `/api/projects-summary/${encodeURIComponent(projectName)}/edit`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      invalidateDashboardQueries(qc);
      setSaved(true);
      setOpen(false);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const resp = await fetch("/api/financial-close/upload", {
        method: "POST",
        body: formData,
        headers,
        credentials: "include",
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || "Upload failed");
      }
      const result: { url: string; filename: string } = await resp.json();
      const fileUrl = result.url;
      setLinkVal(fileUrl);
      setUploadedFileName(result.filename);
      setMode("link");
      const payload: Record<string, string | null> = {};
      payload[`${fieldPrefix}Type`] = "link";
      payload[`${fieldPrefix}Link`] = fileUrl;
      payload[`${fieldPrefix}NaReason`] = null;
      mutation.mutate(payload);
    } catch (err: any) {
      console.error("File upload error:", err?.message || err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = () => {
    const payload: Record<string, string | null> = {};
    payload[`${fieldPrefix}Type`] = mode;
    payload[`${fieldPrefix}Link`] = mode === "link" ? linkVal : null;
    payload[`${fieldPrefix}NaReason`] = mode === "na" ? reason : null;
    mutation.mutate(payload);
  };

  const handleClear = () => {
    const payload: Record<string, string | null> = {};
    payload[`${fieldPrefix}Type`] = null;
    payload[`${fieldPrefix}Link`] = null;
    payload[`${fieldPrefix}NaReason`] = null;
    mutation.mutate(payload);
  };

  const openDialog = () => {
    setMode((type as FinCloseMode) || null);
    setLinkVal(link || "");
    setReason(naReason || "");
    setUploadedFileName(null);
    setOpen(true);
  };

  const label = fieldPrefix === "costProposal" ? "Cost Proposal" : fieldPrefix === "funding" ? "Funding" : "EPC Contract";
  const isUploadedFile = linkVal.startsWith("/api/financial-close/files/");
  const displayFileName = uploadedFileName || (isUploadedFile ? decodeURIComponent(linkVal.split("_").slice(1).join("_").replace(/_/g, " ")) : null);

  const isFile = link?.startsWith("/api/financial-close/files/");

  let badge: React.ReactNode;

  if (type === "link") {
    badge = (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} data-testid={`fclose-${fieldPrefix}-${projectName}`}>
        <a
          href={link || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[10px] font-medium transition-colors max-w-[100px] truncate"
          title={link || ""}
          data-testid={`link-fclose-${fieldPrefix}-${projectName}`}
        >
          {isFile ? <Paperclip className="w-3 h-3 shrink-0" /> : <Link2 className="w-3 h-3 shrink-0" />}
          <span className="truncate">{isFile ? "File" : "Link"}</span>
        </a>
        {isAdmin && (
          <button onClick={openDialog} className="p-0.5 hover:bg-muted rounded transition-colors" title="Replace or edit document" data-testid={`btn-edit-${fieldPrefix}-${projectName}`}>
            <Pencil className="w-3 h-3 text-slate-500" />
          </button>
        )}
        {saved && <Check className="w-3 h-3 text-green-500" />}
      </div>
    );
  } else if (type === "na") {
    badge = (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} data-testid={`fclose-${fieldPrefix}-${projectName}`}>
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border text-[10px] font-medium cursor-help"
          title={`N/A: ${naReason || "No reason provided"}`}
        >
          <Ban className="w-3 h-3" />
          N/A
        </span>
        {isAdmin && (
          <button onClick={openDialog} className="p-0.5 hover:bg-muted rounded transition-colors" title="Change document status" data-testid={`btn-edit-${fieldPrefix}-${projectName}`}>
            <Pencil className="w-3 h-3 text-slate-500" />
          </button>
        )}
        {saved && <Check className="w-3 h-3 text-green-500" />}
      </div>
    );
  } else {
    badge = (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} data-testid={`fclose-${fieldPrefix}-${projectName}`}>
        {isAdmin ? (
          <button
            onClick={openDialog}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 text-[10px] font-medium transition-colors"
            data-testid={`btn-set-${fieldPrefix}-${projectName}`}
          >
            <Clock className="w-3 h-3" />
            Pending
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-medium">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        )}
        {saved && <Check className="w-3 h-3 text-green-500" />}
      </div>
    );
  }

  return (
    <>
      {badge}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid={`dialog-fclose-${fieldPrefix}`}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-5 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-lg">{label} Signed</h3>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-muted rounded-full transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-muted-foreground">
                Project: <strong>{cleanName(projectName)}</strong>
              </p>

              {type === "link" && isFile && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
                  <Paperclip className="w-4 h-4 shrink-0" />
                  <span className="truncate">Current: {decodeURIComponent((link || "").split("_").slice(1).join("_").replace(/_/g, " "))}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setMode("link")}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    mode === "link" ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-border hover:border-border bg-card"
                  }`}
                  data-testid="btn-mode-link"
                >
                  <Upload className={`w-6 h-6 ${mode === "link" ? "text-emerald-600" : "text-slate-500"}`} />
                  <span className={`text-sm font-semibold ${mode === "link" ? "text-emerald-700" : "text-muted-foreground"}`}>{type === "link" ? "Replace File" : "Attach File"}</span>
                  <span className="text-[10px] text-slate-500">Upload or link</span>
                </button>
                <button
                  onClick={() => setMode("na")}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    mode === "na" ? "border-slate-500 bg-muted shadow-sm" : "border-border hover:border-border bg-card"
                  }`}
                  data-testid="btn-mode-na"
                >
                  <Ban className={`w-6 h-6 ${mode === "na" ? "text-muted-foreground" : "text-slate-500"}`} />
                  <span className={`text-sm font-semibold ${mode === "na" ? "text-foreground" : "text-muted-foreground"}`}>Not Applicable</span>
                  <span className="text-[10px] text-slate-500">With reason</span>
                </button>
              </div>

              {mode === "link" && (
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                    data-testid="input-file-upload"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 hover:border-emerald-400 transition-all text-sm font-medium text-emerald-700 disabled:opacity-50"
                    data-testid="btn-choose-file"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        {type === "link" ? "Choose Replacement File" : "Choose File from Computer"}
                      </>
                    )}
                  </button>

                  {isUploadedFile && displayFileName && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
                      <Paperclip className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-sm text-emerald-700 truncate">{displayFileName}</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 ml-auto" />
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span>OR paste a URL</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>

                  <Input
                    placeholder="https://company.sharepoint.com/sites/..."
                    value={isUploadedFile ? "" : linkVal}
                    onChange={(e) => {
                      setLinkVal(e.target.value);
                      setUploadedFileName(null);
                    }}
                    className="text-sm"
                    data-testid="input-sharepoint-link"
                  />
                </div>
              )}

              {mode === "na" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Reason for N/A</label>
                  <Input
                    placeholder="e.g. Self-funded, no external funding required"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="text-sm"
                    data-testid="input-na-reason"
                  />
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t bg-muted/50 flex items-center justify-between">
              {type && (
                <Button variant="ghost" size="sm" onClick={handleClear} className="text-red-600 hover:text-red-700 hover:bg-red-50" data-testid="btn-clear">
                  Clear
                </Button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)} data-testid="btn-cancel">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!mode || (mode === "link" && !linkVal.trim()) || (mode === "na" && !reason.trim()) || mutation.isPending}
                  data-testid="btn-save-fclose"
                >
                  {mutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const EXECUTION_PHASES = [
  "First Assessment",
  "Cost Proposal",
  "DLP",
  "Financial Close",
  "Planning",
  "Construction",
  "QA",
  "Handover",
  "Commercial Close Out",
  "Compliance Handover",
  "Hold",
  "Gone",
];

interface SavedView {
  name: string;
  visibleColumns: string[];
}

const STORAGE_KEY = "project-summary-views";
const ACTIVE_VIEW_KEY = "project-summary-active-view";

const COLUMN_WIDTHS: Record<string, string> = {
  project_name: "130px",
  client_name: "120px",
  size_kwp: "42px",
  pd: "78px",
  pm: "78px",
  cost_proposal_signed: "62px",
  funding_signed: "62px",
  epc_contract_signed: "62px",
  financial_close: "52px",
  phase: "90px",
  escalation_level: "58px",
  pd_handover_date: "68px",
  construction_start_date: "64px",
  commissioning_date: "64px",
  om_handover_date: "52px",
  client_handover_date: "56px",
  duration: "36px",
  kw_per_week: "44px",
  project_pct_complete: "72px",
  expected_pct_complete: "42px",
  delta_vs_expected: "56px",
  latest_update: "120px",
  comments: "130px",
  financial_summary: "84px",
  next_key_date: "80px",
  actions: "32px",
};

const COLUMN_GROUPS_META: { label: string; keys: string[]; color: string; stickyFirst?: boolean }[] = [
  { label: "Project Info", keys: ["project_name", "client_name", "size_kwp", "pd", "pm"], color: "bg-muted text-muted-foreground", stickyFirst: true },
  { label: "Execution", keys: ["pd_pm_handover_status", "execution_attention"], color: "bg-blue-50 text-blue-700" },
  { label: "Financial Close", keys: ["cost_proposal_signed", "funding_signed", "epc_contract_signed", "financial_close"], color: "bg-emerald-50 text-emerald-700" },
  { label: "Phase & Schedule", keys: ["phase", "escalation_level", "pd_handover_date", "construction_start_date", "commissioning_date", "om_handover_date", "client_handover_date", "duration", "kw_per_week"], color: "bg-blue-50 text-blue-700" },
  { label: "Progress", keys: ["project_pct_complete", "expected_pct_complete", "delta_vs_expected"], color: "bg-violet-50 text-violet-700" },
  { label: "Financials", keys: ["actual_revenue", "actual_expenses", "gp_percent", "revenue_outstanding", "expenses_due", "financial_summary"], color: "bg-green-50 text-green-700" },
  { label: "Updates", keys: ["latest_update", "comments", "next_key_date"], color: "bg-amber-50 text-amber-700" },
];

const ALL_COLUMN_KEYS_STATIC = COLUMN_GROUPS_META.flatMap(g => g.keys);
const DEFAULT_DIRECTORY_COLUMNS = [
  "project_name",
  "client_name",
  "phase",
  "pm",
  "pd",
  "pd_pm_handover_status",
  "execution_attention",
  "latest_update",
  "financial_close",
  "financial_summary",
  "project_pct_complete",
  "next_key_date",
];

function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistViews(views: SavedView[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

function loadActiveView(): string | null {
  return localStorage.getItem(ACTIVE_VIEW_KEY);
}

function persistActiveView(name: string | null) {
  if (name) localStorage.setItem(ACTIVE_VIEW_KEY, name);
  else localStorage.removeItem(ACTIVE_VIEW_KEY);
}

function LatestUpdateCell({ project }: { project: ProjectSummary }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.latest_update || "");
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(project.latest_update || "");
  }, [project.latest_update]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed === (project.latest_update || "")) { setEditing(false); return; }
    try {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      await fetch(`/api/projects-summary/${encodeURIComponent(project.project_name)}/latest-update`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ latestUpdate: trimmed || null }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
    } catch (e) {
      console.error("Failed to save latest update:", e);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="h-6 text-[10px] px-1.5 py-0"
          data-testid={`input-latest-update-${project.project_name}`}
        />
        <Button size="sm" variant="ghost" onClick={save} className="h-5 w-5 p-0 shrink-0">
          <Check className="h-3 w-3 text-emerald-600" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setValue(project.latest_update || ""); setEditing(false); }} className="h-5 w-5 p-0 shrink-0">
          <X className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  return (
    <span
      className="block truncate text-[10px] text-muted-foreground cursor-pointer hover:text-foreground group"
      title={project.latest_update ? `${project.latest_update} (click to edit)` : "Click to add update"}
      onClick={() => setEditing(true)}
      data-testid={`text-latest-update-${project.project_name}`}
    >
      {project.latest_update || "—"}
      <Pencil className="inline-block ml-1 h-2.5 w-2.5 opacity-0 group-hover:opacity-60" />
    </span>
  );
}

function getNextKeyDate(project: ProjectSummary): string | null {
  return project.client_handover_date || project.om_handover_date || project.commissioning_date || project.construction_start_date || project.pd_handover_date || null;
}

function formatDateTime(val: string | null | undefined): string {
  if (!val) return "No timestamp";
  try {
    return new Date(val).toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return val;
  }
}

function getSharedKpiValue(summary: PlatformProjectSummaryContract | null | undefined, id: string): number {
  return summary?.kpis.find((kpi) => kpi.id === id)?.value || 0;
}

function getTaskStatusCount(counts: Record<string, number> | null | undefined, statuses: string[]): number {
  if (!counts) return 0;
  const lookup = new Set(statuses.map((status) => status.toUpperCase()));
  return Object.entries(counts).reduce((total, [status, count]) => {
    return lookup.has(status.toUpperCase()) ? total + (count || 0) : total;
  }, 0);
}

type ExecutionAttention = {
  blocked: number;
  overdue: number;
  pendingApprovals: number;
  pendingDeliverables: number;
  nextStep: string;
  nextStepOverdue: boolean;
  trackerLine: string;
  updateLine: string;
};

function getExecutionAttention(project: ProjectSummary): ExecutionAttention {
  const blocked = getTaskStatusCount(project.task_status_counts, ["Blocked"]);
  const overdue = getSharedKpiValue(project.shared_summary, "tasks_overdue");
  const pendingApprovals = project.shared_summary?.workflow.approvals.pending || 0;
  const pendingDeliverables = (project.shared_summary?.workflow.deliverables.pending || 0) + (project.shared_summary?.workflow.deliverables.inReview || 0);
  const nextKeyDate = getNextKeyDate(project);

  const inflowInfo = project.next_open_inflow_milestone;
  let nextStep = "All milestones paid";
  let nextStepOverdue = false;
  if (inflowInfo) {
    nextStep = inflowInfo.name;
    nextStepOverdue = inflowInfo.overdue;
  }
  if (project.pd_pm_handover_status && project.pd_pm_handover_status !== "ACCEPTED") {
    nextStep = project.pd_pm_handover_status === "SUBMITTED_FOR_PM_REVIEW" ? "Close PD to PM handover review" : "Complete PD";
    nextStepOverdue = false;
  }

  return {
    blocked,
    overdue,
    pendingApprovals,
    pendingDeliverables,
    nextStep,
    nextStepOverdue,
    trackerLine: project.last_import_at ? `Tracker ${formatDateTime(project.last_import_at)}` : (project.has_tracker_import ? "Tracker linked" : "No tracker import"),
    updateLine: project.latest_update_at ? `Latest Update ${formatDateTime(project.latest_update_at)}` : "Latest Update pending",
  };
}

function ExecutionAttentionCell({ project, compact = false }: { project: ProjectSummary; compact?: boolean }) {
  const attention = getExecutionAttention(project);
  const hasSignals = attention.blocked + attention.overdue + attention.pendingApprovals + attention.pendingDeliverables > 0;

  return (
    <div className={`space-y-1 ${compact ? "" : "min-w-[220px]"}`}>
      <div className="flex flex-wrap gap-1">
        {attention.blocked > 0 ? <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{attention.blocked} blocked</Badge> : null}
        {attention.overdue > 0 ? <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{attention.overdue} overdue</Badge> : null}
        {attention.pendingApprovals > 0 ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{attention.pendingApprovals} approvals</Badge> : null}
        {attention.pendingDeliverables > 0 ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">{attention.pendingDeliverables} deliverables</Badge> : null}
        {!hasSignals ? <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">Stable</Badge> : null}
      </div>
      <p className={`text-[10px] ${attention.nextStepOverdue ? "text-red-600 font-semibold" : "text-foreground"}`}>
        <span className="font-semibold">Next:</span> {attention.nextStep}
        {attention.nextStepOverdue && <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1 rounded">OVERDUE</span>}
      </p>
      <p className="text-[9px] text-muted-foreground">
        {attention.trackerLine}
        {!compact ? ` | ${attention.updateLine}` : ""}
      </p>
      {compact ? <p className="text-[9px] text-muted-foreground">{attention.updateLine}</p> : null}
    </div>
  );
}

function EditProjectInfoModal({
  project,
  open,
  onOpenChange,
  onSaved,
}: {
  project: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (projectName: string) => void;
}) {
  const qc = useQueryClient();
  const rawName = project.project_name.replace(/_Tracker.*$/i, "");

  const [formData, setFormData] = useState({
    projectName: rawName,
    phase: project.phase || "",
    pd: project.pd || "",
    pm: project.pm || "",
    sizeKwp: project.size_kwp != null ? String(project.size_kwp) : "",
    constructionStartDate: project.construction_start_date || "",
    commissioningDate: project.commissioning_date || "",
    omHandoverDate: project.om_handover_date || "",
    clientHandoverDate: project.client_handover_date || "",
  });


  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await apiRequest("PATCH", `/api/project-info/${project.project_info_id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      invalidateDashboardQueries(qc);
      onOpenChange(false);
      onSaved?.(project.project_name);
    },
  });

  const handleSave = () => {
    const phaseVal = formData.phase && formData.phase !== "__blank" ? formData.phase : null;
    const body: Record<string, unknown> = {
      projectName: formData.projectName.replace(/ /g, "_") + "_Tracker",
      executionPhase: phaseVal,
      pd: formData.pd || null,
      pm: formData.pm || null,
      sizeKwp: formData.sizeKwp ? Number(formData.sizeKwp) : null,
      constructionStartDate: formData.constructionStartDate || null,
      commissioningDate: formData.commissioningDate || null,
      omHandoverDate: formData.omHandoverDate || null,
      clientHandoverDate: formData.clientHandoverDate || null,
    };
    mutation.mutate(body);
  };

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-edit-project-info">
        <DialogHeader>
          <DialogTitle>Edit Project Info</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
          <div className="col-span-1 sm:col-span-2">
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Project Name</Label>
            <Input
              value={formData.projectName.replace(/_/g, " ")}
              onChange={(e) => updateField("projectName", e.target.value)}
              data-testid="input-edit-project-name"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Execution Phase</Label>
            <SearchableSelect
              value={formData.phase}
              onValueChange={(v) => updateField("phase", v)}
              placeholder="Select execution phase"
              data-testid="select-edit-phase"
              options={[
                { value: "__blank", label: "(blank)" },
                ...EXECUTION_PHASES.map((p) => ({ value: p, label: p })),
              ]}
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Size kWp</Label>
            <Input
              type="number"
              value={formData.sizeKwp}
              onChange={(e) => updateField("sizeKwp", e.target.value)}
              data-testid="input-edit-size-kwp"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">PD</Label>
            <Input
              value={formData.pd}
              onChange={(e) => updateField("pd", e.target.value)}
              data-testid="input-edit-pd"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">PM</Label>
            <SearchableSelect
              value={formData.pm || "__unassigned"}
              onValueChange={(val) => updateField("pm", val === "__unassigned" ? "" : val)}
              placeholder="Select PM..."
              data-testid="select-edit-pm"
              options={[
                { value: "__unassigned", label: "Unassigned" },
                ...pmUsers.map((u) => ({ value: u.name, label: u.name })),
              ]}
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Construction Start Date</Label>
            <Input
              type="date"
              value={formData.constructionStartDate}
              onChange={(e) => updateField("constructionStartDate", e.target.value)}
              data-testid="input-edit-construction-start"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Commissioning Date</Label>
            <Input
              type="date"
              value={formData.commissioningDate}
              onChange={(e) => updateField("commissioningDate", e.target.value)}
              data-testid="input-edit-commissioning"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">O&M Handover Date</Label>
            <Input
              type="date"
              value={formData.omHandoverDate}
              onChange={(e) => updateField("omHandoverDate", e.target.value)}
              data-testid="input-edit-om-handover"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Client Handover Date</Label>
            <Input
              type="date"
              value={formData.clientHandoverDate}
              onChange={(e) => updateField("clientHandoverDate", e.target.value)}
              data-testid="input-edit-client-handover"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="btn-cancel-edit">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={mutation.isPending} data-testid="btn-save-edit">
            {mutation.isPending ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MobileProjectCard({ project, setLocation }: { project: ProjectSummary; setLocation: (path: string) => void }) {
  const pct = project.project_pct_complete != null ? project.project_pct_complete * 100 : 0;
  const cfg = phaseConfig(project.phase);
  const delta = project.delta_vs_expected != null ? project.delta_vs_expected * 100 : null;

  return (
    <Card className="border-border shadow-sm overflow-hidden" data-testid={`mobile-card-${project.project_name}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <button
            className="text-left font-semibold text-blue-700 hover:text-blue-900 hover:underline text-sm leading-tight min-w-0 truncate"
            onClick={() => setLocation(`/project/${encodeURIComponent(project.project_name)}?tab=task-grid`)}
            data-testid={`mobile-link-project-${project.project_name}`}
          >
            {cleanName(project.project_name)}
          </button>
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap shrink-0 ${cfg.bg} ${cfg.text} ${cfg.border}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {getPhaseLabel(project.phase)}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {project.client_name && <span className="truncate max-w-[140px]">Client: <span className="text-foreground font-medium">{project.client_name}</span></span>}
          {project.pm && <span>PM: <span className="text-foreground font-medium">{project.pm}</span></span>}
          {project.size_kwp != null && <span>{project.size_kwp.toFixed(0)} kWp</span>}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressColor(pct)}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="font-mono text-xs font-medium text-foreground w-10 text-right">{pct.toFixed(0)}%</span>
          {delta !== null && (
            <span className={`font-mono text-[10px] font-semibold px-1 py-0.5 rounded ${delta >= 0 ? "text-emerald-700 bg-emerald-50" : delta > -5 ? "text-amber-700 bg-amber-50" : "text-rose-700 bg-rose-50"}`}>
              {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
            </span>
          )}
        </div>

        {project.financial_close_achieved !== undefined && (
          <div className="flex items-center gap-2 text-[10px]">
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md font-bold ${
              project.financial_close_achieved
                ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-600 border border-red-200"
            }`}>
              {project.financial_close_achieved ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              Fin Close: {project.financial_close_achieved ? "Done" : "Open"}
            </span>
            {project.escalation_level && project.escalation_level !== "None" && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md font-bold bg-amber-50 text-amber-700 border border-amber-200">
                <Flag className="w-3 h-3" />
                {project.escalation_level}
              </span>
            )}
          </div>
        )}

        <div className="rounded-lg border bg-muted/20 p-2">
          <ExecutionAttentionCell project={project} compact />
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProjectsSummary() {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const [mobileViewMode, setMobileViewMode] = useState<"cards" | "table">("cards");
  const [searchTerm, setSearchTerm] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("project") || "";
  });
  const [pmFilter, setPmFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("phase");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const { isAdmin, user } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const canSuperAdmin = isSuperAdmin(user?.role, companyRole);
  const [editProject, setEditProject] = useState<ProjectSummary | null>(null);
  const [viewTab, setViewTab] = useState<"active" | "archived">("active");
  const [writebackPromptProject, setWritebackPromptProject] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const queryClient = useQueryClient();

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [activeViewName, setActiveViewName] = useState<string | null>(() => loadActiveView());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    const viewName = loadActiveView();
    if (viewName) {
      const views = loadSavedViews();
      const found = views.find(v => v.name === viewName);
      if (found) return new Set(found.visibleColumns);
    }
    return new Set(DEFAULT_DIRECTORY_COLUMNS);
  });
  const [newViewName, setNewViewName] = useState("");

  const escalationMutation = useMutation({
    mutationFn: async ({ projectInfoId, escalationLevel }: { projectInfoId: number; escalationLevel: string | null }) => {
      const res = await apiRequest("PATCH", `/api/projects-summary/${projectInfoId}/escalation`, { escalationLevel });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      invalidateDashboardQueries(queryClient);
    },
  });

  const { data: pmUsers = [] } = useQuery<{ id: number; name: string; username: string; role: string }[]>({
    queryKey: ["/api/pm-assignable-users"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/pm-assignable-users", { credentials: "include", headers });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });


  const pmAssignMutation = useMutation({
    mutationFn: async ({ projectInfoId, pm, pmUserId }: { projectInfoId: number; pm: string; pmUserId: number | null }) => {
      const res = await apiRequest("PATCH", `/api/project-info/${projectInfoId}/assign-pm`, { pm, pmUserId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      invalidateDashboardQueries(queryClient);
    },
  });

  const { data: projects = [], isLoading, isError, error, refetch } = useQuery<ProjectSummary[]>({
    queryKey: ["/api/projects-summary"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/projects-summary", { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to fetch project list");
      return res.json();
    },
    refetchOnMount: "always",
    staleTime: 0,
  });

  const activeProjects = useMemo(() => projects.filter(p => p.is_active && p.has_tracker_import), [projects]);
  const archivedProjects = useMemo(() => projects.filter(p => !p.is_active && p.has_tracker_import), [projects]);
  const currentProjects = viewTab === "active" ? activeProjects : archivedProjects;

  const uniquePMs = useMemo(() => {
    return pmUsers.map(u => u.name).sort();
  }, [pmUsers]);

  const PHASE_ORDER = [
    "DLP", "Financial Close", "Planning", "Construction", "QA",
    "Handover", "Commercial Close Out", "Compliance Handover", "Hold", "Gone"
  ];
  const uniquePhases = useMemo(() => {
    const phases = new Set<string>();
    currentProjects.forEach((p) => { if (p.phase) phases.add(p.phase); });
    return Array.from(phases).sort((a, b) => {
      const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const ai = PHASE_ORDER.findIndex(p => normalize(p) === normalize(a));
      const bi = PHASE_ORDER.findIndex(p => normalize(p) === normalize(b));
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [currentProjects]);

  const filtered = useMemo(() => {
    let result = [...currentProjects];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((p) => p.project_name.toLowerCase().includes(term));
    }
    if (pmFilter !== "all") {
      result = result.filter((p) => p.pm === pmFilter);
    }
    if (phaseFilter !== "all") {
      result = result.filter((p) => p.phase === phaseFilter);
    }
    return result;
  }, [currentProjects, searchTerm, pmFilter, phaseFilter]);

  const currentUserName = (() => { try { const u = localStorage.getItem("user"); if (u) { const p = JSON.parse(u); return p.name || ""; } } catch {} return ""; })();

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const phaseNorm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    arr.sort((a, b) => {
      const aOwned = a.pm === currentUserName ? 1 : 0;
      const bOwned = b.pm === currentUserName ? 1 : 0;
      if (aOwned !== bOwned) return bOwned - aOwned;

      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (sortKey === "phase") {
        const ai = PHASE_ORDER.findIndex(p => phaseNorm(p) === phaseNorm(String(aVal)));
        const bi = PHASE_ORDER.findIndex(p => phaseNorm(p) === phaseNorm(String(bVal)));
        const aIdx = ai !== -1 ? ai : PHASE_ORDER.length;
        const bIdx = bi !== -1 ? bi : PHASE_ORDER.length;
        const diff = aIdx - bIdx;
        if (diff !== 0) return sortDir === "asc" ? diff : -diff;
        return String(aVal).localeCompare(String(bVal));
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const diff = Number(aVal) - Number(bVal);
      return sortDir === "asc" ? diff : -diff;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const getColWidth = (key: string): number => {
    if (colWidths[key]) return colWidths[key];
    const w = COLUMN_WIDTHS[key] || "60px";
    return parseInt(w, 10) || 60;
  };

  const onResizeStart = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = getColWidth(key);
    resizingRef.current = { key, startX, startWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(30, resizingRef.current.startWidth + diff);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.key]: newW }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    return () => {
      resizingRef.current = null;
    };
  }, []);

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-20" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-blue-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-blue-600" />;
  };

  const stats = useMemo(() => {
    const total = sorted.length;
    const totalKwp = sorted.reduce((s, p) => s + safeNum(p.size_kwp), 0);
    const withCompletion = sorted.filter(p => p.project_pct_complete != null);
    const avgCompletion = withCompletion.length > 0
      ? withCompletion.reduce((s, p) => s + safeNum(p.project_pct_complete), 0) / withCompletion.length * 100
      : 0;
    const behindSchedule = sorted.filter(p => p.delta_vs_expected != null && p.delta_vs_expected < -0.05).length;
    const finCloseCount = sorted.filter(p => p.financial_close_achieved).length;
    return { total, totalKwp, avgCompletion, behindSchedule, finCloseCount };
  }, [sorted]);

  const isDefaultView = visibleColumns.size === DEFAULT_DIRECTORY_COLUMNS.length && DEFAULT_DIRECTORY_COLUMNS.every((k) => visibleColumns.has(k));
  const effectiveVisible = new Set(Array.from(visibleColumns).concat(isAdmin ? ["actions"] : []));

  const toggleColumn = useCallback((key: string) => {
    if (key === "project_name") return;
    setVisibleColumns(prev => {
      const base = prev.size === 0 ? new Set(ALL_COLUMN_KEYS_STATIC.concat(isAdmin ? ["actions"] : [])) : new Set(Array.from(prev));
      if (base.has(key)) base.delete(key);
      else base.add(key);
      base.add("project_name");
      setActiveViewName(null);
      persistActiveView(null);
      return base;
    });
  }, [isAdmin]);

  const selectAllColumns = useCallback(() => {
    setVisibleColumns(new Set<string>(ALL_COLUMN_KEYS_STATIC));
    setActiveViewName(null);
    persistActiveView(null);
  }, []);

  const deselectAllColumns = useCallback(() => {
    setVisibleColumns(new Set(["project_name"]));
    setActiveViewName(null);
    persistActiveView(null);
  }, []);

  const saveCurrentView = useCallback(() => {
    if (!newViewName.trim()) return;
    const cols = effectiveVisible.size === 0 ? ALL_COLUMN_KEYS_STATIC : Array.from(effectiveVisible).filter(k => k !== "actions");
    const view: SavedView = { name: newViewName.trim(), visibleColumns: cols };
    const updated = [...savedViews.filter(v => v.name !== view.name), view];
    setSavedViews(updated);
    persistViews(updated);
    setActiveViewName(view.name);
    persistActiveView(view.name);
    setNewViewName("");
  }, [newViewName, effectiveVisible, savedViews]);

  const applyView = useCallback((name: string) => {
    if (name === "__default__") {
      setVisibleColumns(new Set(DEFAULT_DIRECTORY_COLUMNS));
      setActiveViewName(null);
      persistActiveView(null);
      return;
    }
    const found = savedViews.find(v => v.name === name);
    if (found) {
      setVisibleColumns(new Set(found.visibleColumns));
      setActiveViewName(name);
      persistActiveView(name);
    }
  }, [savedViews]);

  const deleteView = useCallback((name: string) => {
    const updated = savedViews.filter(v => v.name !== name);
    setSavedViews(updated);
    persistViews(updated);
    if (activeViewName === name) {
      setActiveViewName(null);
      persistActiveView(null);
      setVisibleColumns(new Set(DEFAULT_DIRECTORY_COLUMNS));
    }
  }, [savedViews, activeViewName]);

  const handleExport = () => {
    window.location.href = "/api/export/projects-summary";
  };

  if (isError) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="page-projects-summary">
        <SectionHeader
          icon={<BarChart3 className="h-5 w-5" />}
          eyebrow="Project Management"
          title="Project List"
          description="Execution project management list"
        />
        <Card className="border border-red-200 bg-red-50/40">
          <CardContent className="py-10 px-6 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-3 text-red-600" />
            <h3 className="text-base font-semibold text-foreground mb-1">Unable to load projects</h3>
            <p className="text-sm text-muted-foreground mb-4">{error instanceof Error ? error.message : "Please try again."}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-projects">
              Retry
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="page-projects-summary">
        <SectionHeader
          icon={<BarChart3 className="h-5 w-5" />}
          eyebrow="Project Management"
          title="Project List"
          description="Loading execution data..."
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}
        </div>
        <div className="h-96 bg-muted animate-pulse rounded-xl" />
      </PageShell>
    );
  }

  if (projects.length === 0) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="page-projects-summary">
        <SectionHeader
          icon={<BarChart3 className="h-5 w-5" />}
          eyebrow="Project Management"
          title="Project List"
          description="Execution project management list"
        />
        <Card className="border-2 border-dashed border-border">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-slate-500" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No projects available</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Upload tracker files to populate the execution project list with trusted tracker-linked dates, latest updates, and operational signals.
            </p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  function truncateName(name: string | null, max: number): string {
    if (!name) return "—";
    if (name.length <= max) return name;
    return name.slice(0, max) + "…";
  }

  const columns: {
    key: string;
    header: string;
    sticky?: boolean;
    align?: string;
    minW?: string;
    render: (p: ProjectSummary) => React.ReactNode;
  }[] = [
    {
      key: "project_name",
      header: "Project",
      sticky: true,
      render: (p) => (
        <div className="space-y-0.5">
          <button
            data-testid={`link-project-${p.project_name}`}
            className="text-left font-semibold text-blue-700 hover:text-blue-900 hover:underline truncate max-w-[180px] block text-[10px]"
            onClick={() => setLocation(`/project/${encodeURIComponent(p.project_name)}?tab=task-grid`)}
            title={cleanName(p.project_name)}
          >
            {cleanName(p.project_name)}
          </button>
          <button
            type="button"
            className="inline-flex items-center text-[9px] text-blue-700 hover:text-blue-900 hover:underline gap-0.5"
            onClick={() => setLocation(`/project/${encodeURIComponent(p.project_name)}?tab=task-grid`)}
            data-testid={`button-open-details-${p.project_name}`}
          >
            <ExternalLink className="w-2.5 h-2.5" />
            Open details
          </button>
        </div>
      ),
    },
    {
      key: "client_name",
      header: "Client/Site",
      render: (p) => (
        <span className="text-muted-foreground truncate max-w-[130px] block" title={p.client_name || ""}>
          {truncateName(p.client_name, 22)}
        </span>
      ),
    },
    {
      key: "size_kwp",
      header: "kWp",
      align: "right",
      render: (p) => <span className="font-mono text-foreground">{p.size_kwp != null ? p.size_kwp.toFixed(0) : "—"}</span>,
    },
    { key: "pd", header: "PD", render: (p) => <span className="text-muted-foreground truncate max-w-[80px] block" title={p.pd || ""}>{truncateName(p.pd, 12)}</span> },
    {
      key: "pm",
      header: "PM",
      render: (p) => isAdmin && p.project_info_id ? (
        <div onClick={(e) => e.stopPropagation()}><SearchableSelect
          value={p.pm || "__unassigned"}
          placeholder={!p.pm ? "No PM" : undefined}
          onValueChange={(val) => {
            if (!p.project_info_id) return;
            if (val === "__unassigned") {
              if (!canSuperAdmin) return;
              pmAssignMutation.mutate({ projectInfoId: p.project_info_id, pm: "", pmUserId: null });
              return;
            }
            const matchedUser = pmUsers.find(u => u.name === val);
            pmAssignMutation.mutate({
              projectInfoId: p.project_info_id,
              pm: val,
              pmUserId: matchedUser?.id ?? null,
            });
          }}
          triggerClassName={`h-7 w-[120px] text-xs border-0 bg-transparent hover:bg-muted px-1 shadow-none focus:ring-0 ${!p.pm ? "text-red-500 font-medium" : ""}`}
          data-testid={`select-pm-${p.project_name}`}
          options={[
            { value: "__unassigned", label: canSuperAdmin ? "Unassign PM" : "Unassigned", disabled: !canSuperAdmin },
            ...pmUsers.map((u) => ({ value: u.name, label: u.name })),
          ]}
        /></div>
      ) : (
        <span className="text-muted-foreground truncate max-w-[80px] block" title={p.pm || ""}>{truncateName(p.pm, 12)}</span>
      ),
    },
    {
      key: "cost_proposal_signed",
      header: "Cost Prop.",
      render: (p) => (
        <FinancialCloseCell
          projectName={p.project_name}
          fieldPrefix="costProposal"
          type={p.cost_proposal_type}
          link={p.cost_proposal_link}
          naReason={p.cost_proposal_na_reason}
          isAdmin={isAdmin}
        />
      ),
    },
    {
      key: "funding_signed",
      header: "Funding",
      render: (p) => (
        <FinancialCloseCell
          projectName={p.project_name}
          fieldPrefix="funding"
          type={p.funding_type}
          link={p.funding_link}
          naReason={p.funding_na_reason}
          isAdmin={isAdmin}
        />
      ),
    },
    {
      key: "epc_contract_signed",
      header: "EPC",
      render: (p) => (
        <FinancialCloseCell
          projectName={p.project_name}
          fieldPrefix="epcContract"
          type={p.epc_contract_type}
          link={p.epc_contract_link}
          naReason={p.epc_contract_na_reason}
          isAdmin={isAdmin}
        />
      ),
    },
    {
      key: "financial_close",
      header: "Status",
      render: (p) => {
        const achieved = p.financial_close_achieved;
        return (
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
              achieved
                ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-600 border border-red-200"
            }`}
            data-testid={`badge-fclose-${p.project_name}`}
          >
            {achieved ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {achieved ? "Done" : "Open"}
          </span>
        );
      },
    },
    {
      key: "pd_pm_handover_status",
      header: "PD→PM Handover",
      render: (p) => {
        const st = p.pd_pm_handover_status || "DRAFT";
        const tone = st === "ACCEPTED" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : st === "REJECTED" ? "bg-red-100 text-red-700 border-red-200" : st === "SUBMITTED_FOR_PM_REVIEW" ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-slate-100 text-slate-700 border-slate-200";
        return (
          <div className="space-y-1">
            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{st === "SUBMITTED_FOR_PM_REVIEW" ? "Submitted" : st.charAt(0) + st.slice(1).toLowerCase()}</span>
            {st === "REJECTED" && p.pd_pm_handover_rejection_reason ? <p className="text-[10px] text-red-600 max-w-[150px] truncate" title={p.pd_pm_handover_rejection_reason}>Reason: {p.pd_pm_handover_rejection_reason}</p> : null}
          </div>
        );
      },
    },
    {
      key: "execution_attention",
      header: "Execution Attention",
      render: (p) => <ExecutionAttentionCell project={p} />,
    },
    {
      key: "phase",
      header: "Phase",
      render: (p) => {
        const cfg = phaseConfig(p.phase);
        return (
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}
            title={getPhaseLabel(p.phase)}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {getPhaseLabel(p.phase)}
          </span>
        );
      },
    },
    {
      key: "escalation_level",
      header: "Escalation",
      render: (p) => {
        const level = p.escalation_level || "None";
        const cfg: Record<string, { bg: string; text: string; border: string; dot: string }> = {
          None: { bg: "bg-muted", text: "text-slate-500", border: "border-border", dot: "bg-slate-300" },
          Low: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200", dot: "bg-blue-400" },
          Medium: { bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200", dot: "bg-amber-400" },
          High: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200", dot: "bg-orange-500" },
          Highest: { bg: "bg-red-50", text: "text-red-700", border: "border-red-300", dot: "bg-red-500" },
        };
        const style = cfg[level] || cfg.None;
        if (!isAdmin) {
          return (
            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${style.bg} ${style.text} ${style.border}`}>
              {level === "Highest" && <Flag className="w-3 h-3" />}
              {level}
            </span>
          );
        }
        return (
          <select
            onClick={(e) => e.stopPropagation()}
            data-testid={`select-escalation-${p.project_name}`}
            className={`text-[10px] font-semibold rounded-md border px-1 py-0.5 cursor-pointer outline-none ${style.bg} ${style.text} ${style.border}`}
            value={level}
            onChange={(e) => {
              if (!p.project_info_id) return;
              const val = e.target.value === "None" ? null : e.target.value;
              escalationMutation.mutate({ projectInfoId: p.project_info_id, escalationLevel: val });
            }}
            disabled={!p.project_info_id}
          >
            <option value="None">None</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Highest">Highest</option>
          </select>
        );
      },
    },
    { key: "pd_handover_date", header: "PD H/O", render: (p) => (
      <span className="flex items-center gap-1 text-muted-foreground" title={p.date_sources?.pd_handover === 'plan' ? 'From project plan' : p.date_sources?.pd_handover === 'info' ? 'From info table' : ''}>
        {formatDate(p.pd_handover_date)}
        {p.date_sources?.pd_handover === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    { key: "construction_start_date", header: "C.Start", render: (p) => (
      <span className="flex items-center gap-1 text-muted-foreground" title={p.date_sources?.construction_start === 'plan' ? 'From project plan' : p.date_sources?.construction_start === 'info' ? 'From info table' : ''}>
        {formatDate(p.construction_start_date)}
        {p.date_sources?.construction_start === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    { key: "commissioning_date", header: "Comm.", render: (p) => (
      <span className="flex items-center gap-1 text-muted-foreground" title={p.date_sources?.commissioning === 'plan' ? 'From project plan' : p.date_sources?.commissioning === 'info' ? 'From info table' : ''}>
        {formatDate(p.commissioning_date)}
        {p.date_sources?.commissioning === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    { key: "om_handover_date", header: "O&M", render: (p) => (
      <span className="flex items-center gap-1 text-muted-foreground" title={p.date_sources?.om_handover === 'plan' ? 'From project plan' : p.date_sources?.om_handover === 'info' ? 'From info table' : ''}>
        {formatDate(p.om_handover_date)}
        {p.date_sources?.om_handover === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    { key: "client_handover_date", header: "Client", render: (p) => (
      <span className="flex items-center gap-1 text-muted-foreground" title={p.date_sources?.client_handover === 'plan' ? 'From project plan' : p.date_sources?.client_handover === 'info' ? 'From info table' : ''}>
        {formatDate(p.client_handover_date)}
        {p.date_sources?.client_handover === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    {
      key: "duration",
      header: "Days",
      align: "right",
      render: (p) => <span className="font-mono text-muted-foreground">{p.duration != null ? p.duration : "—"}</span>,
    },
    {
      key: "kw_per_week",
      header: "kW/Wk",
      align: "right",
      render: (p) => <span className="font-mono text-muted-foreground">{p.kw_per_week != null ? p.kw_per_week.toFixed(1) : "—"}</span>,
    },
    {
      key: "project_pct_complete",
      header: "Act%",
      render: (p) => {
        const pct = p.project_pct_complete != null ? p.project_pct_complete * 100 : 0;
        return (
          <TaskCompletionPopover projectName={p.project_name} currentPct={pct} />
        );
      },
    },
    {
      key: "expected_pct_complete",
      header: "Exp%",
      align: "right",
      render: (p) => <span className="font-mono text-muted-foreground">{formatPct(p.expected_pct_complete)}</span>,
    },
    {
      key: "delta_vs_expected",
      header: "Delta",
      align: "right",
      render: (p) => {
        if (p.delta_vs_expected == null) return <span className="text-slate-500">—</span>;
        const val = p.delta_vs_expected * 100;
        const { text, bg } = deltaColor(val);
        const sign = val >= 0 ? "+" : "";
        const Icon = val >= 0 ? TrendingUp : TrendingDown;
        return (
          <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${text} ${bg}`}>
            <Icon className="w-3 h-3" />
            {sign}{val.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: "actual_revenue",
      header: "Revenue (In Bank)",
      align: "right",
      render: (p) => {
        const received = p.actual_revenue;
        const total = p.total_contract_revenue;
        if ((received == null || received === 0) && (total == null || total === 0)) return <span className="text-slate-500 text-[10px]">—</span>;
        const fmt = (v: number) => "R" + v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        if (received == null || received === 0) return <span className="font-mono text-[10px]"><span className="text-slate-500">R0</span><span className="text-slate-600"> / {fmt(total || 0)}</span></span>;
        return <span className="font-mono text-emerald-600 text-[10px]" data-testid="text-actual-revenue">{fmt(received)}<span className="text-slate-600"> / {fmt(total || 0)}</span></span>;
      },
    },
    {
      key: "actual_expenses",
      header: "Expenses (Paid)",
      align: "right",
      render: (p) => {
        const paid = p.actual_expenses;
        const total = p.total_expenses;
        if ((paid == null || paid === 0) && (total == null || total === 0)) return <span className="text-slate-500 text-[10px]">—</span>;
        const fmt = (v: number) => "R" + v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        if (paid == null || paid === 0) return <span className="font-mono text-[10px]"><span className="text-slate-500">R0</span><span className="text-slate-600"> / {fmt(total || 0)}</span></span>;
        return <span className="font-mono text-foreground text-[10px]" data-testid="text-actual-expenses">{fmt(paid)}<span className="text-slate-600"> / {fmt(total || 0)}</span></span>;
      },
    },
    {
      key: "gp_percent",
      header: "GP%",
      align: "right",
      render: (p) => {
        if (p.gp_percent == null) return <span className="text-slate-500 text-[10px]">—</span>;
        const val = p.gp_percent * 100;
        const color = val >= 20 ? "text-emerald-600" : val >= 0 ? "text-amber-600" : "text-red-600";
        return <span className={`font-mono text-[10px] font-semibold ${color}`}>{val.toFixed(1)}%</span>;
      },
    },
    {
      key: "revenue_outstanding",
      header: "Rev. O/S",
      align: "right",
      render: (p) => {
        const val = p.revenue_outstanding;
        if (val == null || val === 0) return <span className="text-slate-500 text-[10px]">—</span>;
        return <span className="font-mono text-amber-600 text-[10px]">R{val.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
      },
    },
    {
      key: "expenses_due",
      header: "Exp. Due",
      align: "right",
      render: (p) => {
        const val = p.expenses_due;
        if (val == null || val === 0) return <span className="text-slate-500 text-[10px]">—</span>;
        return <span className="font-mono text-red-600 text-[10px]">R{val.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
      },
    },
    {
      key: "latest_update",
      header: "Latest Update",
      render: (p: ProjectSummary) => (
        <LatestUpdateCell project={p} />
      ),
    },
    {
      key: "comments",
      header: "Comments",
      render: (p: ProjectSummary) => (
        <span className="block truncate text-[10px] text-muted-foreground max-w-[180px]" title={p.comments || "No comment"}>{p.comments || "—"}</span>
      ),
    },
    {
      key: "financial_summary",
      header: "Financial",
      render: (p) => {
        const revenue = p.actual_revenue ?? 0;
        const expenses = p.actual_expenses ?? 0;
        const net = revenue - expenses;
        return (
          <span className={`font-mono text-[10px] ${net >= 0 ? "text-emerald-700" : "text-red-600"}`}>
            R{(net / 1_000_000).toFixed(1)}m
          </span>
        );
      },
    },
    {
      key: "next_key_date",
      header: "Next Key Date",
      render: (p) => <span className="text-[10px] text-muted-foreground">{formatDate(getNextKeyDate(p))}</span>,
    },
    ...(isAdmin
      ? [
          {
            key: "actions",
            header: "Actions",
            render: (p: ProjectSummary) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button onClick={(e) => e.stopPropagation()} className="p-1 hover:bg-muted rounded transition-colors" data-testid={`btn-edit-project-${p.project_name}`}>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setLocation(`/project/${encodeURIComponent(p.project_name)}?tab=task-grid`); }}>
                    Open project detail
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!p.project_info_id} onClick={(e) => { e.stopPropagation(); setEditProject(p); }}>
                    Edit project info
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]
      : []),
  ];

  const filteredColumns = columns.filter(c => effectiveVisible.has(c.key));

  const allGroupsMeta = [
    ...COLUMN_GROUPS_META,
    ...(isAdmin ? [{ label: "", keys: ["actions"], color: "bg-card" }] : []),
  ];

  const dynamicColumnGroups = allGroupsMeta
    .map(g => ({
      ...g,
      colSpan: g.keys.filter(k => effectiveVisible.has(k)).length,
    }))
    .filter(g => g.colSpan > 0);

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-projects-summary">
      <SectionHeader
        icon={<BarChart3 className="h-5 w-5" />}
        eyebrow="Project Management"
        title="Project List"
        description={`${sorted.length} of ${currentProjects.length} ${viewTab === "active" ? "active" : "archived"} projects${(pmFilter !== "all" || phaseFilter !== "all" || searchTerm) ? " (filtered)" : ""}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            data-testid="button-export"
            className="h-8 sm:h-9 gap-1 sm:gap-1.5 text-muted-foreground border-border hover:bg-muted shrink-0"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        }
      />

      <WorkspaceNotice
        title="Project List is the execution directory inside Project Management"
        description="Use this list with Execution Overview and the Work Plan / Board to move from portfolio scanning into action, latest updates, and tracker-fed delivery signals."
        icon={<BarChart3 className="h-4 w-4" />}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/pm-dashboard">Execution Overview</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/execution-board">Open Work Plan / Board</Link>
            </Button>
          </>
        }
      >
        <Badge variant="secondary">Latest Update stays canonical</Badge>
        <Badge variant="secondary">Tracker-fed dates stay authoritative</Badge>
        <Badge variant="secondary">Execution-first scanning</Badge>
      </WorkspaceNotice>

      <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        Tracker-fed schedule and finance fields remain authoritative here. Latest Update stays app-managed, text only, and visible for execution scanning.
      </div>

      <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 w-fit">
        <button
          onClick={() => setViewTab("active")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewTab === "active" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-active-projects"
        >
          Active Projects ({activeProjects.length})
        </button>
        <button
          onClick={() => setViewTab("archived")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewTab === "archived" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-archived-projects"
        >
          Archived ({archivedProjects.length})
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Card className="border-border shadow-sm overflow-hidden card-hover animate-float-in stagger-1">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Projects</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground animate-number-pop" data-testid="stat-total-projects">{stats.total}</div>
            <div className="text-xs text-muted-foreground mt-1">{stats.totalKwp.toLocaleString()} kWp total capacity</div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm overflow-hidden card-hover animate-float-in stagger-2">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg. Completion</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Activity className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground animate-number-pop" data-testid="stat-avg-completion">{stats.avgCompletion.toFixed(0)}%</div>
            <div className="w-full h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
              <div className={`h-full rounded-full animate-progress-fill ${progressColor(stats.avgCompletion)}`} style={{ width: `${Math.min(stats.avgCompletion, 100)}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm overflow-hidden card-hover animate-float-in stagger-3">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Behind Schedule</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stats.behindSchedule > 0 ? "bg-rose-50" : "bg-emerald-50"}`}>
                <TrendingDown className={`w-4 h-4 ${stats.behindSchedule > 0 ? "text-rose-600" : "text-emerald-600"}`} />
              </div>
            </div>
            <div className={`text-2xl font-bold animate-number-pop ${stats.behindSchedule > 0 ? "text-rose-600" : "text-emerald-600"}`} data-testid="stat-behind-schedule">
              {stats.behindSchedule}
            </div>
            <div className="text-xs text-muted-foreground mt-1">of {stats.total} projects ({stats.total > 0 ? ((stats.behindSchedule / stats.total) * 100).toFixed(0) : 0}%)</div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm overflow-hidden card-hover animate-float-in stagger-4">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Financial Close</span>
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                <Zap className="w-4 h-4 text-violet-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground animate-number-pop" data-testid="stat-fin-close">{stats.finCloseCount}</div>
            <div className="text-xs text-muted-foreground mt-1">of {stats.total} achieved ({stats.total > 0 ? ((stats.finCloseCount / stats.total) * 100).toFixed(0) : 0}%)</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative flex-1 min-w-[140px] sm:flex-none">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            data-testid="input-search"
            placeholder="Search projects..."
            className="pl-9 h-9 w-full sm:w-56 text-sm border-border bg-card"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <SearchableSelect
          value={pmFilter}
          onValueChange={setPmFilter}
          placeholder="All PMs"
          triggerClassName="h-9 w-[calc(50%-0.25rem)] sm:w-40 text-sm border-border"
          data-testid="select-pm-filter"
          options={[
            { value: "all", label: "All PMs" },
            ...uniquePMs.map((pm) => ({ value: pm, label: pm })),
          ]}
        />

        <SearchableSelect
          value={phaseFilter}
          onValueChange={setPhaseFilter}
          placeholder="All Phases"
          triggerClassName="h-9 w-[calc(50%-0.25rem)] sm:w-40 text-sm border-border"
          data-testid="select-phase-filter"
          options={[
            { value: "all", label: "All Phases" },
            ...uniquePhases.map((ph) => ({ value: ph, label: getPhaseLabel(ph) })),
          ]}
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-sm border-border" data-interactive="true" onClick={(e) => e.stopPropagation()} data-testid="btn-column-toggle">
              {isDefaultView ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              <span className="hidden sm:inline">Columns</span>
              {!isDefaultView && (
                <Badge className="ml-1 h-5 px-1.5 text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-100">
                  {effectiveVisible.size - (effectiveVisible.has("actions") ? 1 : 0)}/{ALL_COLUMN_KEYS_STATIC.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start" data-testid="popover-columns">
            <div className="p-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground">Column Visibility</span>
                <button
                  onClick={isDefaultView ? deselectAllColumns : selectAllColumns}
                  className="text-[10px] font-medium text-blue-600 hover:text-blue-800"
                  data-testid="btn-toggle-all-columns"
                >
                  {isDefaultView ? "Deselect All" : "Select All"}
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto p-2 space-y-3">
              {COLUMN_GROUPS_META.map(group => (
                <div key={group.label}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-1 mb-1">{group.label}</div>
                  {group.keys.map(key => {
                    const col = columns.find(c => c.key === key);
                    if (!col) return null;
                    const isProjectName = key === "project_name";
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer ${isProjectName ? "opacity-60" : ""}`}
                        data-testid={`toggle-col-${key}`}
                      >
                        <Checkbox
                          checked={effectiveVisible.has(key)}
                          onCheckedChange={() => toggleColumn(key)}
                          disabled={isProjectName}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs text-foreground">{col.header}</span>
                        {isProjectName && <span className="text-[9px] text-slate-500 ml-auto">Required</span>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="border-t border-border p-3 space-y-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Save as View</div>
              <div className="flex items-center gap-1.5">
                <Input
                  placeholder="View name..."
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  className="h-7 text-xs flex-1"
                  data-testid="input-view-name"
                  onKeyDown={(e) => { if (e.key === "Enter") saveCurrentView(); }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2"
                  onClick={saveCurrentView}
                  disabled={!newViewName.trim()}
                  data-testid="btn-save-view"
                >
                  <Save className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {savedViews.length > 0 && (
          <SearchableSelect
            value={activeViewName || "__default__"}
            onValueChange={applyView}
            placeholder="Default (All)"
            triggerClassName="h-9 w-[calc(50%-0.25rem)] sm:w-40 text-sm border-border"
            data-testid="select-view"
            options={[
              { value: "__default__", label: "Default (All)" },
              ...savedViews.map((v) => ({ value: v.name, label: v.name })),
            ]}
          />
        )}

        {activeViewName && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteView(activeViewName)}
            className="h-9 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
            title="Delete current view"
            data-testid="btn-delete-view"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}

        {(searchTerm || pmFilter !== "all" || phaseFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearchTerm(""); setPmFilter("all"); setPhaseFilter("all"); }}
            className="h-9 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="w-3 h-3 mr-1" />
            Clear filters
          </Button>
        )}

        {isMobile && (
          <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 ml-auto">
            <button
              onClick={() => setMobileViewMode("cards")}
              className={`p-1.5 rounded-md transition-colors ${mobileViewMode === "cards" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
              data-testid="btn-mobile-card-view"
              title="Card view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setMobileViewMode("table")}
              className={`p-1.5 rounded-md transition-colors ${mobileViewMode === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
              data-testid="btn-mobile-table-view"
              title="Table view"
            >
              <Table2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {isMobile && mobileViewMode === "cards" ? (
        <div className="space-y-2" data-testid="mobile-cards-container">
          {sorted.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No projects match your filters</div>
          ) : (
            sorted.map((project) => (
              <MobileProjectCard key={project.project_name} project={project} setLocation={setLocation} />
            ))
          )}
        </div>
      ) : (

      <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
        <div className="overflow-auto max-h-[calc(100vh-280px)] sm:max-h-[calc(100vh-340px)]">
          <table className="w-full text-[10px] border-collapse table-fixed" style={{ minWidth: "100%" }}>
            <colgroup>
              {filteredColumns.map(col => (
                <col key={col.key} style={{ width: `${getColWidth(col.key)}px` }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                {dynamicColumnGroups.map((g, i) => (
                  <th
                    key={i}
                    colSpan={g.colSpan}
                    className={`px-1 py-1 text-[9px] font-bold uppercase tracking-wider border-b border-border ${g.color} ${
                      g.stickyFirst ? "sticky left-0 z-30" : ""
                    } ${i > 0 ? "border-l border-border" : ""}`}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              <tr className="bg-card border-b-2 border-border">
                {filteredColumns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-1 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap cursor-pointer hover:bg-muted select-none transition-colors text-[9px] relative ${
                      col.sticky ? "sticky left-0 z-30 bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]" : ""
                    } ${col.align === "right" ? "text-right" : ""}`}
                    onClick={() => handleSort(col.key)}
                    data-testid={`sort-${col.key}`}
                  >
                    <div className={`inline-flex items-center gap-0.5 ${col.align === "right" ? "justify-end" : ""}`}>
                      {col.header}
                      <SortIcon col={col.key} />
                    </div>
                    <div
                      className="absolute right-0 top-0 bottom-0 w-[4px] cursor-col-resize hover:bg-blue-400/50 z-40"
                      onMouseDown={(e) => onResizeStart(e, col.key)}
                      data-testid={`resize-${col.key}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((project, idx) => (
                <tr
                  key={project.project_name}
                  className={`border-b border-border hover:bg-blue-50/40 transition-colors ${
                    idx % 2 === 0 ? "bg-card" : "bg-muted/30"
                  }`}
                  data-testid={`row-project-${idx}`}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('button, a, input, select, textarea, [role="button"], [data-interactive="true"]')) return;
                    setLocation(`/project/${encodeURIComponent(project.project_name)}?tab=task-grid`);
                  }}
                >
                  {filteredColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-1 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis ${
                        col.sticky ? "sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]" : ""
                      } ${col.sticky ? (idx % 2 === 0 ? "bg-card" : "bg-muted/80") : ""} ${
                        col.align === "right" ? "text-right" : ""
                      }`}
                    >
                      {col.render(project)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-10">
              <tr className="border-t-2 border-border bg-muted font-semibold">
                {filteredColumns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-1 py-1.5 whitespace-nowrap ${
                      col.sticky ? "sticky left-0 z-10 bg-muted shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]" : ""
                    } ${col.align === "right" ? "text-right" : ""}`}
                  >
                    {col.key === "project_name" ? (
                      <span className="font-bold text-foreground text-[10px]">Portfolio ({sorted.length})</span>
                    ) : col.key === "size_kwp" ? (
                      <span className="font-mono font-bold text-foreground">{stats.totalKwp.toFixed(0)}</span>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      )}

      {editProject && (
        <EditProjectInfoModal
          project={editProject}
          open={!!editProject}
          onOpenChange={(open) => { if (!open) setEditProject(null); }}
          onSaved={(name) => setWritebackPromptProject(name)}
        />
      )}

      
    </PageShell>
  );
}

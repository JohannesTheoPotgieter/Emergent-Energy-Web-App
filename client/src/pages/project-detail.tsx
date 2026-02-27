import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, DollarSign, CreditCard, TrendingUp, BarChart3, Activity,
  ArrowLeft, User, CheckCircle, AlertCircle, Columns, CalendarDays,
  ListTodo, ShieldCheck, Clock, History, ArrowRight, Loader2,
  Wrench, PlusCircle, Circle, Calendar, PauseCircle, AlertTriangle,
  ChevronDown, ChevronUp, Eye, Play, Zap, Target, Users, Trash2, Plus,
} from "lucide-react";
import { ProjectPlanTab } from "@/components/tabs/ProjectPlanTab";
import { RevenueTrackingTab } from "@/components/tabs/RevenueTrackingTab";
import { ExpenditureEditableTab } from "@/components/tabs/ExpenditureEditableTab";
import { MonthlyRealisationTab } from "@/components/tabs/MonthlyRealisationTab";
import { CashflowTab } from "@/components/tabs/CashflowTab";
import { ProjectSubcontractorsTab } from "@/components/tabs/ProjectSubcontractorsTab";
import TaskDetailDrawer from "@/components/TaskDetailDrawer";
import BoardView from "@/components/BoardView";
import CalendarView from "@/components/CalendarView";
import TaskGridView from "@/components/TaskGridView";
import KeyDatesPanel from "@/components/KeyDatesPanel";
import { QualityTab } from "@/components/tabs/QualityTab";
import { ProjectHistoryTab } from "@/components/tabs/ProjectHistoryTab";
import EngineeringStagesTab from "@/components/tabs/EngineeringStagesTab";
import { WeeklyReviewWizard } from "@/components/WeeklyReviewWizard";
import { GuidancePrompt, getPhaseGuidance } from "@/components/MicroGuidance";
import { useProgramData } from "@/hooks/use-program-data";
import { useAuth } from "@/hooks/use-auth";
import { PROJECT_PHASES, LIFECYCLE_PHASES, PROJECT_PHASE_LABELS, TASK_STATUSES, type ProjectPhase, checkPermission } from "@shared/schema";
import { usePermission } from "@/hooks/use-permissions";

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  P0_FIRST_ASSESSMENT: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300" },
  P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-100", text: "text-violet-700", border: "border-violet-300" },
  P2_PD_PM_HANDOVER: { bg: "bg-indigo-100", text: "text-indigo-700", border: "border-indigo-300" },
  P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-300" },
  P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-300" },
  P5_COMMISSIONING_TESTING: { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-300" },
  P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-100", text: "text-teal-700", border: "border-teal-300" },
  P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
};

function getPhaseLabel(phase: string | null): string {
  if (!phase) return "Unknown";
  return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
}


function PhaseBadge({ phase }: { phase: string | null }) {
  const colors = phase ? PHASE_COLORS[phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT : PHASE_COLORS.P0_FIRST_ASSESSMENT;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${colors.bg} ${colors.text} ${colors.border}`}
      data-testid="badge-project-phase"
      title={getPhaseLabel(phase)}
    >
      {getPhaseLabel(phase)}
    </span>
  );
}

function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

function PhaseChangeModal({ projectId, currentPhase, open, onClose }: {
  projectId: number; currentPhase: string | null; open: boolean; onClose: () => void;
}) {
  const [toPhase, setToPhase] = useState<string>("");
  const [reason, setReason] = useState("");
  const [overrideSequence, setOverrideSequence] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/projects/${projectId}/phase`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({ toPhase, reason, overrideSequence }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "Failed to update phase");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Phase updated successfully" });
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      qc.invalidateQueries({ queryKey: ["phase-history", projectId] });
      setToPhase("");
      setReason("");
      setOverrideSequence(false);
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const currentIdx = PROJECT_PHASES.indexOf(currentPhase as any);
  const toIdx = PROJECT_PHASES.indexOf(toPhase as any);
  const needsOverride = currentIdx >= 0 && toIdx >= 0 && Math.abs(toIdx - currentIdx) > 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-phase-change">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Change Project Phase
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Current Phase</Label>
            <p className="text-sm font-medium mt-1">{getPhaseLabel(currentPhase)}</p>
          </div>
          <div>
            <Label htmlFor="toPhase">New Phase</Label>
            <Select value={toPhase} onValueChange={setToPhase}>
              <SelectTrigger data-testid="select-to-phase">
                <SelectValue placeholder="Select phase..." />
              </SelectTrigger>
              <SelectContent>
                {LIFECYCLE_PHASES.map(p => (
                  <SelectItem key={p} value={p} disabled={p === currentPhase}>
                    {PROJECT_PHASE_LABELS[p] || p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="reason">Reason (required)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain why this phase change is happening..."
              className="mt-1"
              data-testid="input-phase-reason"
            />
          </div>
          {needsOverride && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <Switch
                checked={overrideSequence}
                onCheckedChange={setOverrideSequence}
                data-testid="switch-override-sequence"
              />
              <div className="text-sm">
                <p className="font-medium text-amber-800">Override sequential order</p>
                <p className="text-xs text-amber-600 mt-0.5">Phases normally move one step at a time. Enable this to skip phases.</p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-phase">Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!toPhase || !reason.trim() || (needsOverride && !overrideSequence) || mutation.isPending}
            data-testid="button-save-phase"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Update Phase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PhaseHistoryTimeline({ projectId }: { projectId: number }) {
  const { data } = useQuery({
    queryKey: ["phase-history", projectId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectId}/phase-history`);
      if (!res.ok) return { history: [] };
      return res.json();
    },
    enabled: !!projectId,
  });

  const history = data?.history || [];
  if (history.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="phase-history-timeline">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <History className="h-3.5 w-3.5" />
        Phase History
      </h4>
      <div className="space-y-1">
        {history.slice(0, 10).map((entry: any) => (
          <div key={entry.id} className="flex items-start gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/30">
            <div className="mt-0.5 h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">{getPhaseLabel(entry.fromPhase)}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{getPhaseLabel(entry.toPhase)}</span>
              </div>
              <p className="text-muted-foreground mt-0.5">{entry.reason}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {entry.changedByName} &middot; {new Date(entry.changedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  "TO DO": "text-gray-400", "IN PROGRESS": "text-blue-500", "HOLD": "text-red-500",
  "NEEDS APPROVAL": "text-amber-500", "COMPLETE": "text-green-500",
  "QC APPROVED": "text-emerald-500", "PROVIDE FEEDBACK": "text-purple-500",
  "OPERATIONAL APPROVAL": "text-indigo-500", "PROJECTS ASSISTANCE": "text-cyan-500",
};
const STATUS_BADGE: Record<string, string> = {
  "TO DO": "bg-gray-100 text-gray-700", "IN PROGRESS": "bg-blue-100 text-blue-700",
  "HOLD": "bg-red-100 text-red-700", "NEEDS APPROVAL": "bg-amber-100 text-amber-700",
  "COMPLETE": "bg-green-100 text-green-700", "QC APPROVED": "bg-emerald-100 text-emerald-700",
  "PROVIDE FEEDBACK": "bg-purple-100 text-purple-700",
};

function EngTasksTab({ projectInfoId, isAdmin, projectName }: { projectInfoId: number | null; isAdmin: boolean; projectName: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const { allowed: canEdit } = usePermission('pd_eng_tasks', 'edit');
  const { allowed: canDelete } = usePermission('pd_eng_tasks', 'delete');

  const { data: engData, isLoading } = useQuery<{ projectName: string; phase: string; tasks: any[] }>({
    queryKey: ["project-eng-tasks", projectInfoId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectInfoId}/eng-tasks`);
      if (!res.ok) return { projectName: "", phase: "", tasks: [] };
      return res.json();
    },
    enabled: !!projectInfoId,
  });

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await engFetch("/api/eng/tasks", {
        method: "POST",
        body: JSON.stringify({ title, projectName, status: "TO DO", taskTypeTag: "PROJECT" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create task");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task created" });
      qc.invalidateQueries({ queryKey: ["project-eng-tasks", projectInfoId] });
      setNewTitle("");
      setShowAddForm(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await engFetch(`/api/eng/tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete task");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task deleted" });
      qc.invalidateQueries({ queryKey: ["project-eng-tasks", projectInfoId] });
      setDeleteConfirmId(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await engFetch(`/api/projects/${projectInfoId}/generate-eng-tasks`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to generate tasks");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `${data.tasksCreated} engineering tasks created` });
      qc.invalidateQueries({ queryKey: ["project-eng-tasks", projectInfoId] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (!projectInfoId) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Project info not available</div>;
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const tasks = engData?.tasks || [];
  const openTasks = tasks.filter((t: any) => t.status !== "COMPLETE");
  const completedTasks = tasks.filter((t: any) => t.status === "COMPLETE");
  const overdue = tasks.filter((t: any) => t.dueDate && t.dueDate < new Date().toISOString().split("T")[0] && t.status !== "COMPLETE");

  const phaseGroups = new Map<string, any[]>();
  for (const t of tasks) {
    const ph = t.phase || "Unassigned";
    if (!phaseGroups.has(ph)) phaseGroups.set(ph, []);
    phaseGroups.get(ph)!.push(t);
  }

  return (
    <div className="space-y-4" data-testid="eng-tasks-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Engineering Tasks</h3>
        <div className="flex gap-2">
          {tasks.length === 0 && isAdmin && (
            <Button size="sm" variant="outline" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="h-7 text-xs gap-1" data-testid="button-generate-eng-tasks">
              {generateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlusCircle className="h-3 w-3" />}
              Generate from Template
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setShowAddForm(!showAddForm)} className="h-7 text-xs gap-1" data-testid="button-add-eng-task">
              <Plus className="h-3 w-3" /> Add Task
            </Button>
          )}
        </div>
      </div>

      {showAddForm && (
        <Card className="p-3">
          <div className="flex gap-2">
            <Input
              placeholder="Task title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && newTitle.trim()) createMutation.mutate(newTitle.trim()); }}
              data-testid="input-new-eng-task"
            />
            <Button size="sm" className="h-8" onClick={() => { if (newTitle.trim()) createMutation.mutate(newTitle.trim()); }} disabled={!newTitle.trim() || createMutation.isPending} data-testid="button-save-eng-task">
              {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => { setShowAddForm(false); setNewTitle(""); }} data-testid="button-cancel-eng-task">Cancel</Button>
          </div>
        </Card>
      )}

      {tasks.length === 0 && !showAddForm ? (
        <div className="text-center py-12 space-y-2">
          <Wrench className="h-12 w-12 mx-auto text-muted-foreground/30" />
          <p className="text-lg font-medium text-muted-foreground">No engineering tasks yet</p>
          <p className="text-sm text-muted-foreground/70">Add tasks manually or generate from templates.</p>
        </div>
      ) : tasks.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
              <p className="text-xl font-bold mt-1">{tasks.length}</p>
            </Card>
            <Card className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Open</p>
              <p className="text-xl font-bold mt-1 text-blue-600">{openTasks.length}</p>
            </Card>
            <Card className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Completed</p>
              <p className="text-xl font-bold mt-1 text-emerald-600">{completedTasks.length}</p>
            </Card>
            <Card className={`p-3 ${overdue.length > 0 ? "border-red-200" : ""}`}>
              <p className={`text-[10px] uppercase tracking-wider ${overdue.length > 0 ? "text-red-600" : "text-muted-foreground"}`}>Overdue</p>
              <p className={`text-xl font-bold mt-1 ${overdue.length > 0 ? "text-red-600" : ""}`}>{overdue.length}</p>
            </Card>
          </div>

          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(completedTasks.length / tasks.length) * 100}%` }} />
          </div>

          {Array.from(phaseGroups.entries()).map(([phase, phaseTasks]) => (
            <div key={phase} className="space-y-1">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 py-2">
                <span className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase]?.bg || "bg-slate-200"}`} />
                {getPhaseLabel(phase)}
                <span className="font-normal">({phaseTasks.length})</span>
              </h4>
              <Card>
                <div className="divide-y">
                  {phaseTasks.map((task: any) => {
                    const isTaskOverdue = task.dueDate && task.dueDate < new Date().toISOString().split("T")[0] && task.status !== "COMPLETE";
                    return (
                      <div key={task.id} className={`flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted/20 transition-colors text-sm ${isTaskOverdue ? "bg-red-50/30" : ""}`} data-testid={`eng-task-row-${task.id}`}>
                        <div className="flex-1 flex items-center gap-2.5 min-w-0 cursor-pointer" onClick={() => setLocation(`/engineering?task=${task.id}`)}>
                          <Circle className={`h-2.5 w-2.5 fill-current shrink-0 ${STATUS_DOT[task.status] || "text-gray-400"}`} />
                          <span className="flex-1 min-w-0 truncate">{task.title}</span>
                          {task.primaryWorkstream && <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">{task.primaryWorkstream}</Badge>}
                          <Badge className={`text-[9px] px-1.5 py-0 shrink-0 ${STATUS_BADGE[task.status] || "bg-gray-100"}`}>{task.status}</Badge>
                          {task.dueDate && (
                            <span className={`text-[10px] flex items-center gap-0.5 shrink-0 ${isTaskOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                              <Calendar className="h-3 w-3" />
                              {new Date(task.dueDate).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                            </span>
                          )}
                          {task.assignees && task.assignees[0] && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0 max-w-[80px] truncate">
                              <User className="h-3 w-3" />{task.assignees[0]}
                            </span>
                          )}
                        </div>
                        {canDelete && deleteConfirmId !== task.id && (
                          <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(task.id); }} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors shrink-0" data-testid={`btn-delete-eng-task-${task.id}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {deleteConfirmId === task.id && (
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2" onClick={() => deleteMutation.mutate(task.id)} disabled={deleteMutation.isPending} data-testid={`btn-confirm-delete-eng-task-${task.id}`}>
                              {deleteMutation.isPending ? "..." : "Delete"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setDeleteConfirmId(null)} data-testid={`btn-cancel-delete-eng-task-${task.id}`}>No</Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const OLD_TAB_TO_SECTION: Record<string, { section: string; subTab: string }> = {
  "task-grid": { section: "project-management", subTab: "task-grid" },
  "board": { section: "project-management", subTab: "board" },
  "calendar": { section: "project-management", subTab: "calendar" },
  "eng-tasks": { section: "engineering", subTab: "eng-tasks" },
  "eng-stages": { section: "engineering", subTab: "eng-stages" },
  "project-plan": { section: "project-management", subTab: "gantt" },
  "gantt": { section: "project-management", subTab: "gantt" },
  "key-dates": { section: "project-management", subTab: "key-dates" },
  "revenue-tracking": { section: "project-management", subTab: "revenue-tracking" },
  "expenditure": { section: "project-management", subTab: "expenditure" },
  "monthly-realisation": { section: "project-management", subTab: "monthly-realisation" },
  "cashflow": { section: "project-management", subTab: "cashflow" },
  "subcontractors": { section: "project-management", subTab: "subcontractors" },
  "quality": { section: "quality", subTab: "quality" },
  "history": { section: "project-management", subTab: "history" },
  "overview": { section: "overview", subTab: "" },
  "engineering": { section: "engineering", subTab: "eng-tasks" },
  "money": { section: "project-management", subTab: "revenue-tracking" },
  "plan": { section: "project-management", subTab: "gantt" },
};

const SECTION_DEFAULT_SUBTAB: Record<string, string> = {
  "project-management": "task-grid",
  engineering: "eng-tasks",
  quality: "quality",
};

function RagDot({ color }: { color: "green" | "amber" | "red" }) {
  const cls = color === "green" ? "bg-emerald-500" : color === "amber" ? "bg-amber-500" : "bg-red-500";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />;
}

export default function ProjectDetailPage() {
  const [, params] = useRoute("/project/:projectName");
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const projectName = params?.projectName ? decodeURIComponent(params.projectName) : "";
  const { projectsSummary } = useProgramData();
  const { user } = useAuth();
  const userRole = user?.role || localStorage.getItem("company_role") || "";

  const { data: rolePermsData, isLoading: rolePermsLoading } = useQuery({
    queryKey: ["role-perms", userRole],
    queryFn: async () => {
      if (!userRole) return null;
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/roles/${encodeURIComponent(userRole)}`, { headers, credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!userRole,
    staleTime: 60_000,
  });

  const rolePermsReady = !userRole || !rolePermsLoading;

  const canViewPerm = (entity: string): boolean => {
    if (!rolePermsReady) return false;
    const dbPerms = rolePermsData?.entityPermissions as Record<string, Record<string, boolean>> | null;
    if (dbPerms && dbPerms[entity]) {
      if (dbPerms[entity]["view"] === true) return true;
      if (dbPerms[entity]["view"] === false) return false;
    }
    return checkPermission(userRole, entity as any, "view");
  };

  const canViewFinance = canViewPerm("financials");
  const canViewEngineering = canViewPerm("engineering");
  const canViewQuality = canViewPerm("quality");

  const canViewTab = {
    overview: canViewPerm("pd_overview"),
    plan: canViewPerm("pd_plan"),
    finance: canViewPerm("pd_finance") && canViewFinance,
    engineering: canViewPerm("pd_engineering") && canViewEngineering,
    quality: canViewPerm("pd_quality") && canViewQuality,
    history: canViewPerm("pd_history"),
  };

  const canViewSubTab = {
    revenue: canViewPerm("pd_revenue"),
    expenditure: canViewPerm("pd_expenditure"),
    cosTracker: canViewPerm("pd_cos_tracker"),
    cashflow: canViewPerm("pd_cashflow"),
    subcontractors: canViewPerm("pd_subcontractors"),
    engTasks: canViewPerm("pd_eng_tasks"),
    engStages: canViewPerm("pd_eng_stages"),
    gantt: canViewPerm("pd_gantt"),
    keyDates: canViewPerm("pd_key_dates"),
  };
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const alertsRef = useRef<HTMLDivElement>(null);

  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const urlTab = searchParams.get("tab");
  const highlightId = searchParams.get("highlightId") ? Number(searchParams.get("highlightId")) : null;
  const highlightType = searchParams.get("highlightType");

  const resolvedFromUrl = useMemo(() => {
    if (!urlTab) return null;
    const mapped = OLD_TAB_TO_SECTION[urlTab];
    if (mapped) return mapped;
    return null;
  }, [urlTab]);

  const [activeSection, setActiveSection] = useState<string>(resolvedFromUrl?.section || "overview");
  const [activeSubTab, setActiveSubTab] = useState<string>(resolvedFromUrl?.subTab || "");

  useEffect(() => {
    if (urlTab) {
      const mapped = OLD_TAB_TO_SECTION[urlTab];
      if (mapped) {
        setActiveSection(mapped.section);
        if (mapped.subTab) setActiveSubTab(mapped.subTab);
      }
    }
  }, [urlTab]);

  const navigateToSection = (section: string, subTab?: string) => {
    if (section === "engineering" && !canViewTab.engineering) { setActiveSection("overview"); return; }
    if (section === "quality" && !canViewTab.quality) { setActiveSection("overview"); return; }
    setActiveSection(section);
    setActiveSubTab(subTab || SECTION_DEFAULT_SUBTAB[section] || "");
  };

  const queryClient = useQueryClient();
  const projectInfo = projectsSummary?.find((p: any) => p.project_name === projectName);
  const projectInfoId = projectInfo?.project_info_id;

  const { data: pmAssignableUsers } = useQuery<{ id: number; name: string; username: string; role: string }[]>({
    queryKey: ["/api/pm-assignable-users"],
    queryFn: async () => {
      const res = await engFetch("/api/pm-assignable-users");
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: pdAssignableUsers } = useQuery<{ id: number; name: string; username: string; role: string }[]>({
    queryKey: ["/api/pd-assignable-users"],
    queryFn: async () => {
      const res = await engFetch("/api/pd-assignable-users");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const handleTaskClick = (taskId: number) => {
    setSelectedTaskId(taskId);
    setDrawerOpen(true);
  };

  const { data: engStagesData } = useQuery({
    queryKey: ["project-eng-stages-overview", projectInfoId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectInfoId}/eng-stages`);
      if (!res.ok) return { stages: [] };
      return res.json();
    },
    enabled: !!projectInfoId,
  });

  const { data: projectPlanData = [] } = useQuery({
    queryKey: ["project-plan", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/project-plan/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: revenueData = [] } = useQuery({
    queryKey: ["program-inflows", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/program-inflows?projectName=${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: expenseData = [] } = useQuery({
    queryKey: ["program-expenses", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/program-expenses/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: cashflowData = [] } = useQuery({
    queryKey: ["cashflow", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/cashflow?project=${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: engDataForAlerts } = useQuery<{ tasks: any[] }>({
    queryKey: ["project-eng-tasks", projectInfo?.project_info_id],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectInfo?.project_info_id}/eng-tasks`);
      if (!res.ok) return { tasks: [] };
      return res.json();
    },
    enabled: !!projectInfo?.project_info_id,
  });

  const { data: qualityData } = useQuery({
    queryKey: ["quality-summary", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/quality/project/${encodeURIComponent(projectName)}/summary`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectName,
  });

  if (!projectName) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground">Project Not Found</h2>
        <p className="text-muted-foreground">No project specified.</p>
      </div>
    );
  }

  const displayName = projectName.replace("_Tracker", "");
  const phase = projectInfo?.phase || null;
  const executionPhase = projectInfo?.execution_phase || null;
  const pd = projectInfo?.pd || "—";
  const pm = projectInfo?.pm || "—";
  const sizeKwp = projectInfo?.size_kwp ? `${projectInfo.size_kwp.toFixed(0)} kWp` : "—";
  const completion = projectInfo?.project_pct_complete != null
    ? `${(projectInfo.project_pct_complete * 100).toFixed(0)}%`
    : "—";
  const completionNum = projectInfo?.project_pct_complete != null ? projectInfo.project_pct_complete * 100 : 0;
  const isAdmin = ['admin', 'COO_ADMIN', 'CEO_ADMIN'].includes(user?.role || '');
  const totalRevenueFromInflows = (revenueData as any[]).reduce((s: number, r: any) => s + (Number(r.milestoneAmount) || 0), 0);
  const contractValue = projectInfo?.contract_value || totalRevenueFromInflows || 0;
  const totalBudgetFromExpenses = (expenseData as any[]).reduce((s: number, e: any) => s + (Number(e.budgetTotal) || 0), 0);
  const budgetTotal = projectInfo?.budget_total || totalBudgetFromExpenses || 0;

  const planTasks = projectPlanData as any[];
  const today = new Date().toISOString().split("T")[0];
  const overduePlanTasks = planTasks.filter((t: any) => {
    const endDate = t.endDate || t.actualEnd;
    const pct = Number(t.actualPctComplete);
    const isComplete = t.status === "Complete" || t.status === "Done" || (pct >= 1);
    return endDate && endDate < today && !isComplete;
  });
  const completedPlanTasks = planTasks.filter((t: any) => {
    const pct = Number(t.actualPctComplete);
    return t.status === "Complete" || t.status === "Done" || (pct >= 1);
  });
  const planCompletionPct = planTasks.length > 0 ? (completedPlanTasks.length / planTasks.length) * 100 : 0;
  const scheduleRag: "green" | "amber" | "red" = overduePlanTasks.length === 0 ? "green" : overduePlanTasks.length <= 3 ? "amber" : "red";

  const totalExpenses = (expenseData as any[]).reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
  const costRatio = budgetTotal > 0 ? totalExpenses / budgetTotal : 0;
  const costRag: "green" | "amber" | "red" = costRatio < 0.9 ? "green" : costRatio <= 1 ? "amber" : "red";

  const qualitySummary = qualityData as any;
  const qualityPhases = qualitySummary?.phases || [];
  const qualityGatesTotal = qualityPhases.length;
  const qualityGatesPassed = qualityPhases.filter((p: any) => p.applicableItems > 0 && p.approvedItems >= p.applicableItems).length;
  const qualityTotalItems = qualityPhases.reduce((s: number, p: any) => s + (p.applicableItems || 0), 0);
  const qualityApprovedItems = qualityPhases.reduce((s: number, p: any) => s + (p.approvedItems || 0), 0);
  const qualityProgressPct = qualityTotalItems > 0 ? (qualityApprovedItems / qualityTotalItems) * 100 : 0;
  const qualityRag: "green" | "amber" | "red" = qualitySummary?.hasChecklist
    ? (qualityGatesPassed === qualityGatesTotal && qualityGatesTotal > 0 ? "green" : qualityApprovedItems > 0 ? "amber" : "red")
    : "red";

  const nextMilestone = useMemo(() => {
    const now = new Date();
    const futureRevMilestones = (revenueData as any[])
      .filter((r: any) => {
        const dateStr = r.plannedPaymentDate || r.paymentReceivedDate;
        if (!dateStr) return false;
        if (r.paymentReceivedDate) return false;
        return new Date(dateStr) >= now;
      })
      .sort((a: any, b: any) => new Date(a.plannedPaymentDate).getTime() - new Date(b.plannedPaymentDate).getTime());
    if (futureRevMilestones.length > 0) {
      const m = futureRevMilestones[0];
      return { name: m.milestoneName || "Revenue Milestone", date: m.plannedPaymentDate };
    }
    return null;
  }, [revenueData]);

  const totalPaidInflows = (revenueData as any[]).reduce((s: number, r: any) => {
    if (r.paymentReceivedDate) return s + (Number(r.milestoneAmount) || 0);
    return s;
  }, 0);
  const revenueRealisedPct = contractValue > 0 ? (totalPaidInflows / contractValue) * 100 : 0;

  const cosRealisedTotal = (expenseData as any[]).reduce((s: number, e: any) => {
    const hasInvoice = !!(e.expenseInvoiceNumber && String(e.expenseInvoiceNumber).trim());
    const hasInvDate = !!(e.expenseInvoicedDate && String(e.expenseInvoicedDate).trim());
    const hasPO = !!(e.expensePoNumber && String(e.expensePoNumber).trim());
    if (!hasPO || !hasInvoice || !hasInvDate) return s;
    const dateConfirmed = e.invoiceDateConfirmed === true || e.invoiceDateFontColor === 'black';
    if (!dateConfirmed) return s;
    return s + (Number(e.expenseActualTotal) || 0);
  }, 0);
  const cosRealisedPct = budgetTotal > 0 ? (cosRealisedTotal / budgetTotal) * 100 : 0;
  const marginDelta = revenueRealisedPct - cosRealisedPct;

  const hasRedRag = scheduleRag === "red" || costRag === "red" || qualityRag === "red";

  const engStages = engStagesData?.stages || [];
  const engStageTotalTasks = engStages.reduce((s: number, st: any) => s + (st.tasks?.length || 0), 0);
  const engStageCompletedTasks = engStages.reduce((s: number, st: any) => s + (st.tasks?.filter((t: any) => t.status === "complete").length || 0), 0);
  const engCompletedStages = engStages.filter((s: any) => s.status === "complete").length;
  const engActiveStage = engStages.find((s: any) => s.status === "in_progress") || engStages.find((s: any) => s.status === "not_started");

  const engBoardTasks = engDataForAlerts?.tasks || [];
  const engBoardTotal = engBoardTasks.length;
  const engBoardCompleted = engBoardTasks.filter((t: any) => t.status === "COMPLETE").length;

  const engTotalTasks = engStageTotalTasks + engBoardTotal;
  const engCompletedTasks = engStageCompletedTasks + engBoardCompleted;
  const engStagePct = engTotalTasks > 0 ? (engCompletedTasks / engTotalTasks) * 100 : 0;

  const alerts = useMemo(() => {
    const result: { severity: "warning" | "info"; message: string; key: string }[] = [];
    const now = new Date();
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    (revenueData as any[]).forEach((r: any) => {
      const planned = r.plannedPaymentDate ? new Date(r.plannedPaymentDate) : null;
      if (planned && planned >= now && planned <= in14Days && !r.invoiceRaisedDate) {
        result.push({ severity: "warning", message: `Revenue milestone "${r.milestoneName || "Unnamed"}" due within 14 days — no invoice raised`, key: `rev-${r.id || r.milestoneName}` });
      }
    });
    const totalRev = (revenueData as any[]).reduce((s: number, r: any) => s + (Number(r.milestoneAmount) || 0), 0);
    if (totalExpenses > totalRev && totalRev > 0) {
      result.push({ severity: "warning", message: `COS (R${totalExpenses.toLocaleString()}) exceeds linked revenue (R${totalRev.toLocaleString()})`, key: "cos-exceeds-rev" });
    }
    const engTaskAlerts = engDataForAlerts?.tasks || [];
    const overdueEng = engTaskAlerts.filter((t: any) => t.dueDate && t.dueDate < today && t.status !== "COMPLETE");
    if (overdueEng.length > 0) {
      result.push({ severity: "warning", message: `${overdueEng.length} overdue engineering task${overdueEng.length > 1 ? "s" : ""}`, key: "eng-overdue" });
    }
    if (planTasks.length === 0) {
      result.push({ severity: "info", message: "No project plan data uploaded yet", key: "no-plan" });
    }
    return result;
  }, [revenueData, expenseData, engDataForAlerts, planTasks, totalExpenses, today]);

  const primaryCta = useMemo(() => {
    if (phase?.includes("FIRST_ASSESSMENT") || phase?.includes("COST_PROPOSAL")) {
      return { label: "Advance Gate", icon: <Zap className="h-4 w-4" />, action: () => setPhaseModalOpen(true) };
    }
    if (executionPhase && phase?.includes("CONSTRUCTION")) {
      return { label: "Start Weekly Review", icon: <Play className="h-4 w-4" />, action: () => navigateToSection("project-management", "history") };
    }
    if (hasRedRag) {
      return { label: "Resolve Issue", icon: <AlertTriangle className="h-4 w-4" />, action: () => { setAlertsExpanded(true); alertsRef.current?.scrollIntoView({ behavior: "smooth" }); } };
    }
    return { label: "View Tasks", icon: <Eye className="h-4 w-4" />, action: () => navigateToSection("project-management", "task-grid") };
  }, [phase, executionPhase, hasRedRag]);

  const ragColor = (rag: "green" | "amber" | "red") => rag === "green" ? "text-emerald-600" : rag === "amber" ? "text-amber-600" : "text-red-600";

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => setLocation("/projects")} className="gap-2" data-testid="button-back">
        <ArrowLeft className="h-4 w-4" />
        Back to Projects
      </Button>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <h2 className="text-xl sm:text-3xl font-heading font-bold text-foreground" data-testid="text-project-name">{displayName}</h2>
            <PhaseBadge phase={phase} />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
            {isAdmin ? (
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> PD:
                <Select
                  value={pd === "—" ? "__unassigned" : pd}
                  onValueChange={(val) => {
                    const newPd = val === "__unassigned" ? "" : val;
                    if (projectInfoId) {
                      engFetch(`/api/lifecycle-board/projects/${projectInfoId}`, {
                        method: "PATCH",
                        body: JSON.stringify({ pd: newPd }),
                      }).then(() => queryClient.invalidateQueries({ queryKey: ["projects-summary"] }));
                    }
                  }}
                >
                  <SelectTrigger className="h-6 text-xs w-auto min-w-[100px] border-dashed" data-testid="select-detail-pd">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned" data-testid="select-detail-pd-unassigned">Unassigned</SelectItem>
                    {(pdAssignableUsers || []).map((u: any) => (
                      <SelectItem key={u.id} value={u.name} data-testid={`select-detail-pd-${u.id}`}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            ) : (
              <span className="flex items-center gap-1"><User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> PD: {pd}</span>
            )}
            {isAdmin ? (
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> PM:
                <Select
                  value={pm === "—" ? "__unassigned" : pm}
                  onValueChange={(val) => {
                    const newPm = val === "__unassigned" ? "" : val;
                    const matched = (pmAssignableUsers || []).find((u: any) => u.name === newPm);
                    if (projectInfoId) {
                      engFetch(`/api/lifecycle-board/projects/${projectInfoId}`, {
                        method: "PATCH",
                        body: JSON.stringify({ pm: newPm, pmUserId: matched?.id ?? null }),
                      }).then(() => queryClient.invalidateQueries({ queryKey: ["projects-summary"] }));
                    }
                  }}
                >
                  <SelectTrigger className="h-6 text-xs w-auto min-w-[100px] border-dashed" data-testid="select-detail-pm">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned" data-testid="select-detail-pm-unassigned">Unassigned</SelectItem>
                    {(pmAssignableUsers || []).map((u: any) => (
                      <SelectItem key={u.id} value={u.name} data-testid={`select-detail-pm-${u.id}`}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            ) : (
              <span className="flex items-center gap-1"><User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> PM: {pm}</span>
            )}
            <span className="flex items-center gap-1"><Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {sizeKwp}</span>
            <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {completion} complete</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={primaryCta.action} className="gap-1.5" data-testid="button-primary-cta">
            {primaryCta.icon}
            {primaryCta.label}
          </Button>
        </div>
      </div>

      <Card className="sticky top-0 z-10 shadow-sm" data-testid="awareness-bar">
        <CardContent className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 items-center">
            <div className="flex flex-col gap-1" data-testid="awareness-execution-phase">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Execution</span>
              <span className="text-xs font-medium truncate">{executionPhase || "—"}</span>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-rag">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">RAG</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1" title={`Schedule: ${scheduleRag}`}>
                  <RagDot color={scheduleRag} />
                  <span className="text-[10px]">S</span>
                </div>
                <div className="flex items-center gap-1" title={`Cost: ${costRag}`}>
                  <RagDot color={costRag} />
                  <span className="text-[10px]">C</span>
                </div>
                <div className="flex items-center gap-1" title={`Quality: ${qualityRag}`}>
                  <RagDot color={qualityRag} />
                  <span className="text-[10px]">Q</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-milestone">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Next Milestone</span>
              <span className="text-xs font-medium truncate">
                {nextMilestone ? `${nextMilestone.name} (${new Date(nextMilestone.date).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })})` : "—"}
              </span>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-revenue">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Rev Realised</span>
              <span className="text-sm font-bold">{revenueRealisedPct.toFixed(1)}%</span>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-cos">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">COS Realised</span>
              <span className="text-sm font-bold">{cosRealisedPct.toFixed(1)}%</span>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-margin">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Margin Delta</span>
              <span className={`text-sm font-bold ${marginDelta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {marginDelta >= 0 ? "+" : ""}{marginDelta.toFixed(1)}%
              </span>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-contract">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Contract</span>
              <span className="text-sm font-bold">R{(contractValue / 1000000).toFixed(1)}M</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {(() => {
        const phaseGuide = getPhaseGuidance(phase);
        return phaseGuide ? (
          <GuidancePrompt
            type={phaseGuide.type}
            title={phaseGuide.title}
            message={phaseGuide.message}
            learnMoreText={phaseGuide.learnMoreText}
          />
        ) : null;
      })()}

      {alerts.length > 0 && (
        <div ref={alertsRef} data-testid="alert-panel">
          <button
            onClick={() => setAlertsExpanded(!alertsExpanded)}
            className="flex items-center gap-2 w-full text-left mb-2"
            data-testid="button-toggle-alerts"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-semibold">Business Alerts</span>
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0" data-testid="badge-alert-count">
              {alerts.length}
            </Badge>
            {alertsExpanded ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
          </button>
          {alertsExpanded && (
            <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar" data-testid="alert-cards">
              {alerts.map(alert => (
                <Card key={alert.key} className="flex-shrink-0 w-72 border-l-4 border-l-amber-400" data-testid={`alert-card-${alert.key}`}>
                  <CardContent className="p-3 flex items-start gap-2">
                    {alert.severity === "warning" ? (
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    )}
                    <span className="text-xs leading-tight">{alert.message}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSection === "overview" && (
        <div className="space-y-6" data-testid="overview-section">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {canViewTab.overview && (
            <Card
              className="group cursor-pointer hover:shadow-lg hover:border-blue-300 transition-all duration-200 relative overflow-hidden"
              onClick={() => navigateToSection("project-management")}
              data-testid="pillar-project-management"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <ListTodo className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">Project Management</h3>
                      <p className="text-[10px] text-muted-foreground">Plan, Finance, Tasks & History</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-500 transition-colors" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Plan Progress</span>
                    <span className="font-semibold">{planCompletionPct.toFixed(0)}%</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${planCompletionPct}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold">{planTasks.length}</p>
                    <p className="text-[10px] text-muted-foreground">Total Tasks</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-emerald-600">{completedPlanTasks.length}</p>
                    <p className="text-[10px] text-muted-foreground">Completed</p>
                  </div>
                  <div>
                    <p className={`text-lg font-bold ${overduePlanTasks.length > 0 ? "text-red-600" : ""}`}>{overduePlanTasks.length}</p>
                    <p className="text-[10px] text-muted-foreground">Overdue</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 border-t">
                  <RagDot color={scheduleRag} />
                  <span className={`text-xs font-medium ${ragColor(scheduleRag)}`}>
                    Schedule {scheduleRag === "green" ? "On Track" : scheduleRag === "amber" ? "At Risk" : "Behind"}
                  </span>
                  {nextMilestone && (
                    <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[120px]">
                      Next: {nextMilestone.taskName || nextMilestone.task_name || "Milestone"}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
            )}

            {canViewTab.engineering && (
            <Card
              className="group cursor-pointer hover:shadow-lg hover:border-orange-300 transition-all duration-200 relative overflow-hidden"
              onClick={() => navigateToSection("engineering")}
              data-testid="pillar-engineering"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-orange-500" />
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                      <Wrench className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">Engineering</h3>
                      <p className="text-[10px] text-muted-foreground">Tasks & Stage Checklists</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-orange-500 transition-colors" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Stage Progress</span>
                    <span className="font-semibold">{engStagePct.toFixed(0)}%</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${engStagePct}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold">{engStages.length}</p>
                    <p className="text-[10px] text-muted-foreground">Stages</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-emerald-600">{engCompletedStages}</p>
                    <p className="text-[10px] text-muted-foreground">Complete</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{engCompletedTasks}/{engTotalTasks}</p>
                    <p className="text-[10px] text-muted-foreground">Tasks Done</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 border-t">
                  <Target className="h-3.5 w-3.5 text-orange-500" />
                  <span className="text-xs font-medium text-muted-foreground truncate">
                    {engActiveStage ? `Active: ${engActiveStage.stageName || engActiveStage.templateName || "Stage"}` : engStages.length === 0 && engBoardTotal > 0 ? `${engBoardTotal} board task${engBoardTotal !== 1 ? "s" : ""} linked` : engStages.length === 0 ? "No stages yet" : "All stages complete"}
                  </span>
                </div>
              </CardContent>
            </Card>
            )}

            {canViewTab.quality && (
            <Card
              className="group cursor-pointer hover:shadow-lg hover:border-emerald-300 transition-all duration-200 relative overflow-hidden"
              onClick={() => navigateToSection("quality")}
              data-testid="pillar-quality"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">Quality</h3>
                      <p className="text-[10px] text-muted-foreground">Checklists & Gate Approvals</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-500 transition-colors" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Gate Progress</span>
                    <span className="font-semibold">{qualityGatesTotal > 0 ? `${qualityGatesPassed}/${qualityGatesTotal}` : "—"}</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${qualityGatesTotal > 0 ? (qualityGatesPassed / qualityGatesTotal) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold">{qualityGatesTotal}</p>
                    <p className="text-[10px] text-muted-foreground">Total Gates</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-emerald-600">{qualityGatesPassed}</p>
                    <p className="text-[10px] text-muted-foreground">Passed</p>
                  </div>
                  <div>
                    <p className={`text-lg font-bold ${qualityGatesTotal - qualityGatesPassed > 0 ? "text-amber-600" : ""}`}>
                      {qualityGatesTotal - qualityGatesPassed}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Pending</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 border-t">
                  <RagDot color={qualityRag} />
                  <span className={`text-xs font-medium ${ragColor(qualityRag)}`}>
                    Quality {qualityRag === "green" ? "On Track" : qualityRag === "amber" ? "Needs Review" : "Action Required"}
                  </span>
                </div>
              </CardContent>
            </Card>
            )}
          </div>

          {projectInfoId && <PhaseHistoryTimeline projectId={projectInfoId} />}
        </div>
      )}

      {activeSection === "project-management" && (
        <div className="space-y-4" data-testid="pm-section">
          <Button variant="ghost" size="sm" onClick={() => navigateToSection("overview")} className="gap-2 -ml-2" data-testid="button-back-overview">
            <ArrowLeft className="h-4 w-4" />
            Back to Overview
          </Button>

          <div className="flex gap-1.5 flex-wrap border-b pb-2" data-testid="pm-sub-tabs">
            {canViewTab.overview && (
            <>
              <Button size="sm" variant={activeSubTab === "task-grid" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("task-grid")} data-testid="subtab-task-grid">
                <ListTodo className="h-3 w-3 mr-1" /> Tasks
              </Button>
              <Button size="sm" variant={activeSubTab === "board" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("board")} data-testid="subtab-board">
                <Columns className="h-3 w-3 mr-1" /> Board
              </Button>
              <Button size="sm" variant={activeSubTab === "calendar" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("calendar")} data-testid="subtab-calendar">
                <CalendarDays className="h-3 w-3 mr-1" /> Calendar
              </Button>
            </>
            )}
            <div className="w-px h-5 bg-border self-center mx-1" />
            {canViewTab.plan && canViewSubTab.gantt && (
            <Button size="sm" variant={activeSubTab === "gantt" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("gantt")} data-testid="subtab-gantt">
              <FileText className="h-3 w-3 mr-1" /> Gantt
            </Button>
            )}
            {canViewTab.plan && canViewSubTab.keyDates && (
            <Button size="sm" variant={activeSubTab === "key-dates" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("key-dates")} data-testid="subtab-key-dates">
              <Calendar className="h-3 w-3 mr-1" /> Key Dates
            </Button>
            )}
            <div className="w-px h-5 bg-border self-center mx-1" />
            {canViewTab.finance && canViewSubTab.revenue && (
            <Button size="sm" variant={activeSubTab === "revenue-tracking" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("revenue-tracking")} data-testid="subtab-revenue">
              <DollarSign className="h-3 w-3 mr-1" /> Revenue
            </Button>
            )}
            {canViewTab.finance && canViewSubTab.expenditure && (
            <Button size="sm" variant={activeSubTab === "expenditure" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("expenditure")} data-testid="subtab-expenditure">
              <CreditCard className="h-3 w-3 mr-1" /> Expenditure
            </Button>
            )}
            {canViewTab.finance && canViewSubTab.cosTracker && (
            <Button size="sm" variant={activeSubTab === "monthly-realisation" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("monthly-realisation")} data-testid="subtab-monthly-realisation">
              <TrendingUp className="h-3 w-3 mr-1" /> COS
            </Button>
            )}
            {canViewTab.finance && canViewSubTab.cashflow && (
            <Button size="sm" variant={activeSubTab === "cashflow" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("cashflow")} data-testid="subtab-cashflow">
              <Activity className="h-3 w-3 mr-1" /> Cashflow
            </Button>
            )}
            {canViewTab.finance && canViewSubTab.subcontractors && (
            <Button size="sm" variant={activeSubTab === "subcontractors" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("subcontractors")} data-testid="subtab-subcontractors">
              <Users className="h-3 w-3 mr-1" /> Subcontractors
            </Button>
            )}
            <div className="w-px h-5 bg-border self-center mx-1" />
            {canViewTab.history && (
            <Button size="sm" variant={activeSubTab === "history" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setActiveSubTab("history")} data-testid="subtab-history">
              <History className="h-3 w-3 mr-1" /> History
            </Button>
            )}
          </div>

          {activeSubTab === "task-grid" && canViewTab.overview && <TaskGridView projectName={projectName} onTaskClick={handleTaskClick} />}
          {activeSubTab === "board" && canViewTab.overview && <BoardView projectName={projectName} onTaskClick={handleTaskClick} />}
          {activeSubTab === "calendar" && canViewTab.overview && <CalendarView projectName={projectName} onTaskClick={handleTaskClick} />}
          {activeSubTab === "gantt" && canViewTab.plan && canViewSubTab.gantt && <ProjectPlanTab projectName={projectName} />}
          {activeSubTab === "key-dates" && canViewTab.plan && canViewSubTab.keyDates && <KeyDatesPanel projectName={projectName} />}
          {activeSubTab === "revenue-tracking" && canViewTab.finance && canViewSubTab.revenue && <RevenueTrackingTab projectName={projectName} highlightId={highlightType === 'revenue' ? highlightId : null} />}
          {activeSubTab === "expenditure" && canViewTab.finance && canViewSubTab.expenditure && <ExpenditureEditableTab projectName={projectName} highlightId={highlightType === 'expense' ? highlightId : null} />}
          {activeSubTab === "monthly-realisation" && canViewTab.finance && canViewSubTab.cosTracker && <MonthlyRealisationTab projectName={projectName} />}
          {activeSubTab === "cashflow" && canViewTab.finance && canViewSubTab.cashflow && <CashflowTab projectName={projectName} />}
          {activeSubTab === "subcontractors" && canViewTab.finance && canViewSubTab.subcontractors && <ProjectSubcontractorsTab projectName={projectName} />}
          {activeSubTab === "history" && canViewTab.history && (
            <>
              <WeeklyReviewWizard
                projectName={projectName}
                snapshotMetrics={{
                  phase: phase || undefined,
                  completion: projectInfo?.project_pct_complete ?? undefined,
                  totalRevenue: totalPaidInflows,
                  totalExpenses,
                  margin: totalPaidInflows > 0 ? (totalPaidInflows - totalExpenses) / totalPaidInflows : 0,
                  overdueCount: (engDataForAlerts as any[])?.filter?.((t: any) => t.dueDate && t.dueDate < new Date().toISOString().split("T")[0] && t.status !== "COMPLETE")?.length || 0,
                }}
              />
              <ProjectHistoryTab projectName={projectName} />
            </>
          )}
        </div>
      )}

      {activeSection === "engineering" && canViewTab.engineering && (
        <div className="space-y-4" data-testid="eng-section">
          <Button variant="ghost" size="sm" onClick={() => navigateToSection("overview")} className="gap-2 -ml-2" data-testid="button-back-overview">
            <ArrowLeft className="h-4 w-4" />
            Back to Overview
          </Button>

          {canViewSubTab.engTasks && <EngTasksTab projectInfoId={projectInfoId ?? null} isAdmin={isAdmin} projectName={projectName} />}
        </div>
      )}

      {activeSection === "quality" && canViewTab.quality && (
        <div className="space-y-4" data-testid="quality-section">
          <Button variant="ghost" size="sm" onClick={() => navigateToSection("overview")} className="gap-2 -ml-2" data-testid="button-back-overview">
            <ArrowLeft className="h-4 w-4" />
            Back to Overview
          </Button>
          <QualityTab projectName={projectName} />
        </div>
      )}

      <TaskDetailDrawer
        taskId={selectedTaskId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTaskId(null); }}
        projectName={projectName}
      />

      {projectInfoId && (
        <PhaseChangeModal
          projectId={projectInfoId}
          currentPhase={phase}
          open={phaseModalOpen}
          onClose={() => setPhaseModalOpen(false)}
        />
      )}
    </div>
  );
}

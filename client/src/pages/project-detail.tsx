import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, CreditCard, TrendingUp, BarChart3, Activity,
  ArrowLeft, User, CheckCircle, AlertCircle, Columns, CalendarDays,
  ListTodo, ShieldCheck, Clock, History, ArrowRight, Loader2,
  Wrench, PlusCircle, Circle, Calendar, PauseCircle, AlertTriangle,
  ChevronDown, ChevronUp, Eye, Play, Zap, Target, Users, Trash2, Plus,
  MessageSquare, FolderOpen, Bell, FileCheck,
} from "lucide-react";
import { EnergyLoader } from "@/components/ui/energy-loader";
import { RevenueTrackingTab } from "@/components/tabs/RevenueTrackingTab";
import { ExpenditureEditableTab } from "@/components/tabs/ExpenditureEditableTab";
import { MonthlyRealisationTab } from "@/components/tabs/MonthlyRealisationTab";
import { RevenueTrackerTab } from "@/components/tabs/RevenueTrackerTab";
import { GpTrackerTab } from "@/components/tabs/GpTrackerTab";
import { CashflowTab } from "@/components/tabs/CashflowTab";
import { ProjectSubcontractorsTab } from "@/components/tabs/ProjectSubcontractorsTab";
import TaskDetailDrawer from "@/components/TaskDetailDrawer";
import BoardView from "@/components/BoardView";
import CalendarView from "@/components/CalendarView";
import UnifiedPlanTab from "@/components/tabs/UnifiedPlanTab";
import { QualityTab } from "@/components/tabs/QualityTab";
import { ProjectHistoryTab } from "@/components/tabs/ProjectHistoryTab";
import { WeeklyReviewWizard } from "@/components/WeeklyReviewWizard";
import { GuidancePrompt, getPhaseGuidance } from "@/components/MicroGuidance";
import { ProjectChatTab } from "@/components/tabs/ProjectChatTab";
import { LocalFolderTab } from "@/components/tabs/LocalFolderTab";
import { ProjectApprovalsTab } from "@/components/tabs/ProjectApprovalsTab";
import { ProjectNotificationsTab } from "@/components/tabs/ProjectNotificationsTab";
import HandoverGatePanel from "@/components/HandoverGatePanel";
import { ProjectRaidTab } from "@/components/tabs/ProjectRaidTab";
import { ProjectChangeControlTab } from "@/components/tabs/ProjectChangeControlTab";
import { ProjectProcurementTab } from "@/components/tabs/ProjectProcurementTab";
import { ProjectCommissioningTab } from "@/components/tabs/ProjectCommissioningTab";
import { ModuleContext } from "@/components/ModuleContext";
import { useProgramData } from "@/hooks/use-program-data";
import { useAuth } from "@/hooks/use-auth";
import DataSourceDebug from "@/components/DataSourceDebug";
import { ProjectCommandHeader } from "@/components/ProjectCommandHeader";
import { PageShell } from "@/components/layout/page-shell";
import { PROJECT_PHASES, LIFECYCLE_PHASES, PROJECT_PHASE_LABELS, TASK_STATUSES, type ProjectPhase, checkPermission } from "@shared/schema";
import { usePermission } from "@/hooks/use-permissions";

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  P0_FIRST_ASSESSMENT: { bg: "bg-muted", text: "text-foreground", border: "border-border" },
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
            <SearchableSelect
              value={toPhase}
              onValueChange={setToPhase}
              placeholder="Select phase..."
              data-testid="select-to-phase"
              options={LIFECYCLE_PHASES.map(p => ({
                value: p,
                label: PROJECT_PHASE_LABELS[p] || p,
                disabled: p === currentPhase,
              }))}
            />
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
  "TO DO": "bg-muted text-foreground", "IN PROGRESS": "bg-blue-100 text-blue-700",
  "HOLD": "bg-red-100 text-red-700", "NEEDS APPROVAL": "bg-amber-100 text-amber-700",
  "COMPLETE": "bg-green-100 text-green-700", "QC APPROVED": "bg-emerald-100 text-emerald-700",
  "PROVIDE FEEDBACK": "bg-purple-100 text-purple-700",
};

const ALL_STATUSES = ["TO DO", "IN PROGRESS", "HOLD", "NEEDS APPROVAL", "COMPLETE", "QC APPROVED", "PROVIDE FEEDBACK", "OPERATIONAL APPROVAL", "PROJECTS ASSISTANCE"];
const ALL_PRIORITIES = ["Low", "Med", "High", "Critical"];

function EngTasksTab({ projectInfoId, isAdmin, projectName }: { projectInfoId: number | null; isAdmin: boolean; projectName: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
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

  const { data: allUsers } = useQuery<any[]>({
    queryKey: ["users-list"],
    queryFn: async () => {
      const res = await fetch("/api/users", { headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` } });
      if (!res.ok) return [];
      return res.json();
    },
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

  const updateMutation = useMutation({
    mutationFn: async ({ taskId, updates }: { taskId: number; updates: Record<string, any> }) => {
      const res = await engFetch(`/api/eng/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update task");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task updated" });
      qc.invalidateQueries({ queryKey: ["project-eng-tasks", projectInfoId] });
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
    return <div className="flex justify-center py-12"><EnergyLoader size="md" label="Loading project..." /></div>;
  }

  const tasks = engData?.tasks || [];
  const openTasks = tasks.filter((t: any) => t.status !== "COMPLETE" && t.status !== "Complete");
  const completedTasks = tasks.filter((t: any) => t.status === "COMPLETE" || t.status === "Complete");
  const overdue = tasks.filter((t: any) => {
    const due = t.dueDate || t.endDate;
    return due && due < new Date().toISOString().split("T")[0] && t.status !== "COMPLETE" && t.status !== "Complete";
  });

  const phaseGroups = new Map<string, any[]>();
  for (const t of tasks) {
    const ph = t.phase || t.workstream || "Unassigned";
    if (!phaseGroups.has(ph)) phaseGroups.set(ph, []);
    phaseGroups.get(ph)!.push(t);
  }

  const getTaskId = (task: any) => task.id;

  return (
    <div className="space-y-4" data-testid="eng-tasks-tab">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">Engineering Tasks</h3>
        <div className="flex gap-2">
          {tasks.length === 0 && isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowGenerateConfirm(true)} disabled={generateMutation.isPending} className="h-7 text-xs gap-1" data-testid="button-generate-eng-tasks">
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

      <Dialog open={showGenerateConfirm} onOpenChange={setShowGenerateConfirm}>
        <DialogContent className="max-w-sm" data-testid="dialog-generate-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlusCircle className="h-5 w-5" />
              Generate Engineering Tasks
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will create engineering tasks from the project template. Are you sure you want to proceed?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateConfirm(false)} data-testid="button-cancel-generate">Cancel</Button>
            <Button
              onClick={() => { setShowGenerateConfirm(false); generateMutation.mutate(); }}
              disabled={generateMutation.isPending}
              data-testid="button-confirm-generate"
            >
              {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Generate Tasks
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    const taskDue = task.dueDate || task.endDate;
                    const displayStatus = task.status || "TO DO";
                    const isTaskOverdue = taskDue && taskDue < new Date().toISOString().split("T")[0] && displayStatus !== "COMPLETE" && displayStatus !== "Complete";
                    const isExpanded = expandedTaskId === task.id;
                    const tid = getTaskId(task);

                    return (
                      <div key={task.id} data-testid={`eng-task-row-${task.id}`}>
                        <div className={`flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 py-2.5 hover:bg-muted/20 transition-colors text-sm cursor-pointer ${isTaskOverdue ? "bg-red-50/30" : ""}`}
                          onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                        >
                          <Circle className={`h-2.5 w-2.5 fill-current shrink-0 ${STATUS_DOT[displayStatus] || "text-gray-400"}`} />
                          <span className="flex-1 min-w-0 truncate text-xs sm:text-sm">{task.title}</span>
                          <Badge className={`text-[9px] px-1.5 py-0 shrink-0 hidden sm:inline-flex ${STATUS_BADGE[displayStatus] || "bg-muted"}`}>{displayStatus}</Badge>
                          {taskDue && (
                            <span className={`text-[10px] flex items-center gap-0.5 shrink-0 ${isTaskOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                              <Calendar className="h-3 w-3" />
                              <span className="hidden sm:inline">{new Date(taskDue).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}</span>
                            </span>
                          )}
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        </div>

                        {isExpanded && canEdit && (
                          <div className="px-3 sm:px-4 pb-3 pt-1 bg-muted/10 border-t border-dashed space-y-3" onClick={(e) => e.stopPropagation()}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <Label className="text-[10px] uppercase text-muted-foreground">Title</Label>
                                <Input
                                  defaultValue={task.title}
                                  className="h-8 text-sm mt-1"
                                  onBlur={(e) => {
                                    const v = e.target.value.trim();
                                    if (v && v !== task.title) updateMutation.mutate({ taskId: tid, updates: { title: v } });
                                  }}
                                  data-testid={`input-title-${task.id}`}
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] uppercase text-muted-foreground">Status</Label>
                                <SearchableSelect
                                  value={displayStatus}
                                  onValueChange={(v) => updateMutation.mutate({ taskId: tid, updates: { status: v } })}
                                  triggerClassName="h-8 text-sm mt-1"
                                  data-testid={`select-status-${task.id}`}
                                  options={ALL_STATUSES.map(s => ({ value: s, label: s }))}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <div>
                                <Label className="text-[10px] uppercase text-muted-foreground">Priority</Label>
                                <SearchableSelect
                                  value={task.priority || "Med"}
                                  onValueChange={(v) => updateMutation.mutate({ taskId: tid, updates: { priority: v } })}
                                  triggerClassName="h-8 text-sm mt-1"
                                  data-testid={`select-priority-${task.id}`}
                                  options={ALL_PRIORITIES.map(p => ({ value: p, label: p }))}
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] uppercase text-muted-foreground">% Complete</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  defaultValue={Math.round(task.percentComplete ?? 0)}
                                  className="h-8 text-sm mt-1"
                                  onBlur={(e) => {
                                    const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                                    if (val !== Math.round(task.percentComplete ?? 0)) updateMutation.mutate({ taskId: tid, updates: { percentComplete: val } });
                                  }}
                                  data-testid={`input-pct-${task.id}`}
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] uppercase text-muted-foreground">Start Date</Label>
                                <Input
                                  type="date"
                                  defaultValue={task.startDate || ""}
                                  className="h-8 text-sm mt-1"
                                  onBlur={(e) => {
                                    if (e.target.value !== (task.startDate || "")) updateMutation.mutate({ taskId: tid, updates: { startDate: e.target.value || null } });
                                  }}
                                  data-testid={`input-start-${task.id}`}
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] uppercase text-muted-foreground">Due Date</Label>
                                <Input
                                  type="date"
                                  defaultValue={taskDue || ""}
                                  className="h-8 text-sm mt-1"
                                  onBlur={(e) => {
                                    if (e.target.value !== (taskDue || "")) updateMutation.mutate({ taskId: tid, updates: { dueDate: e.target.value || null } });
                                  }}
                                  data-testid={`input-due-${task.id}`}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <Label className="text-[10px] uppercase text-muted-foreground">Assignee</Label>
                                <SearchableSelect
                                  value={task.ownerUserId ? String(task.ownerUserId) : "__unassigned"}
                                  onValueChange={(v) => {
                                    if (v === "__unassigned") {
                                      updateMutation.mutate({ taskId: tid, updates: { ownerUserId: null } });
                                    } else {
                                      const uid = parseInt(v);
                                      if (!isNaN(uid)) updateMutation.mutate({ taskId: tid, updates: { ownerUserId: uid } });
                                    }
                                  }}
                                  triggerClassName="h-8 text-sm mt-1"
                                  placeholder="Unassigned"
                                  data-testid={`select-assignee-${task.id}`}
                                  options={[
                                    { value: "__unassigned", label: "Unassigned" },
                                    ...(allUsers || []).map((u: any) => ({ value: String(u.id), label: u.name })),
                                  ]}
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] uppercase text-muted-foreground">Description</Label>
                                <Textarea
                                  defaultValue={task.description || ""}
                                  className="text-sm mt-1 min-h-[60px]"
                                  placeholder="Add a description..."
                                  onBlur={(e) => {
                                    if (e.target.value !== (task.description || "")) updateMutation.mutate({ taskId: tid, updates: { description: e.target.value } });
                                  }}
                                  data-testid={`input-desc-${task.id}`}
                                />
                              </div>
                            </div>
                            <div className="flex items-center justify-between pt-1">
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setLocation(`/engineering?task=${tid}`)} data-testid={`btn-full-view-${task.id}`}>
                                  <Eye className="h-3 w-3" /> Full View
                                </Button>
                                {task.workstream && <Badge variant="outline" className="text-[9px]">{task.workstream}</Badge>}
                                {task.source && <Badge variant="secondary" className="text-[9px]">{task.source}</Badge>}
                              </div>
                              <div className="flex gap-1">
                                {canDelete && (
                                  deleteConfirmId === task.id ? (
                                    <div className="flex items-center gap-1">
                                      <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2" onClick={() => deleteMutation.mutate(tid)} disabled={deleteMutation.isPending} data-testid={`btn-confirm-delete-eng-task-${task.id}`}>
                                        {deleteMutation.isPending ? "..." : "Delete"}
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setDeleteConfirmId(null)} data-testid={`btn-cancel-delete-eng-task-${task.id}`}>No</Button>
                                    </div>
                                  ) : (
                                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-700 gap-1" onClick={() => setDeleteConfirmId(task.id)} data-testid={`btn-delete-eng-task-${task.id}`}>
                                      <Trash2 className="h-3 w-3" /> Delete
                                    </Button>
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {isExpanded && !canEdit && (
                          <div className="px-3 sm:px-4 pb-3 pt-1 bg-muted/10 border-t border-dashed space-y-2" onClick={(e) => e.stopPropagation()}>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                              <div><span className="text-muted-foreground">Status:</span> <Badge className={`text-[9px] ${STATUS_BADGE[displayStatus] || "bg-muted"}`}>{displayStatus}</Badge></div>
                              <div><span className="text-muted-foreground">Priority:</span> {task.priority || "Med"}</div>
                              <div><span className="text-muted-foreground">Start:</span> {task.startDate || "—"}</div>
                              <div><span className="text-muted-foreground">Due:</span> {taskDue || "—"}</div>
                            </div>
                            {task.description && <p className="text-xs text-muted-foreground">{task.description}</p>}
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setLocation(`/engineering?task=${tid}`)} data-testid={`btn-full-view-${task.id}`}>
                              <Eye className="h-3 w-3" /> Full View
                            </Button>
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
  "task-grid": { section: "delivery", subTab: "task-grid" },
  "board": { section: "delivery", subTab: "board" },
  "calendar": { section: "delivery", subTab: "calendar" },
  "eng-tasks": { section: "engineering", subTab: "eng-tasks" },
  "eng-stages": { section: "engineering", subTab: "eng-stages" },
  "project-plan": { section: "delivery", subTab: "task-grid" },
  "gantt": { section: "delivery", subTab: "task-grid" },
  "key-dates": { section: "delivery", subTab: "task-grid" },
  "revenue-tracking": { section: "commercial", subTab: "revenue-tracking" },
  "expenditure": { section: "commercial", subTab: "expenditure" },
  "monthly-realisation": { section: "commercial", subTab: "monthly-realisation" },
  "revenue-tracker": { section: "commercial", subTab: "revenue-tracker" },
  "gp-tracker": { section: "commercial", subTab: "gp-tracker" },
  "cashflow": { section: "commercial", subTab: "cashflow" },
  "subcontractors": { section: "commercial", subTab: "subcontractors" },
  "raid": { section: "delivery", subTab: "raid" },
  "change-control": { section: "commercial", subTab: "change-control" },
  "procurement": { section: "commercial", subTab: "procurement" },
  "commissioning": { section: "delivery", subTab: "commissioning" },
  "quality": { section: "quality", subTab: "quality" },
  "history": { section: "collaboration", subTab: "history" },
  "overview": { section: "overview", subTab: "" },
  "engineering": { section: "engineering", subTab: "eng-tasks" },
  "money": { section: "commercial", subTab: "revenue-tracking" },
  "revenue": { section: "commercial", subTab: "revenue-tracking" },
  "plan": { section: "delivery", subTab: "task-grid" },
  "chat": { section: "collaboration", subTab: "chat" },
  "sharepoint": { section: "collaboration", subTab: "sharepoint" },
  "local-files": { section: "collaboration", subTab: "local-files" },
  "approvals": { section: "collaboration", subTab: "approvals" },
  "notifications": { section: "collaboration", subTab: "notifications" },
  "collaboration": { section: "collaboration", subTab: "chat" },
};

const SECTION_DEFAULT_SUBTAB: Record<string, string> = {
  delivery: "task-grid",
  commercial: "procurement",
  engineering: "eng-tasks",
  quality: "quality",
  collaboration: "chat",
};

function RagDot({ color }: { color: "green" | "amber" | "red" }) {
  const cls = color === "green" ? "bg-emerald-500" : color === "amber" ? "bg-amber-500" : "bg-red-500";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />;
}

function SectionBrief({ title, subtitle, points }: { title: string; subtitle: string; points: string[] }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-3 md:p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{subtitle}</p>
        <h3 className="text-sm md:text-base font-semibold mt-1">{title}</h3>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          {points.map((point) => (
            <div key={point} className="rounded-md border bg-muted/20 px-2.5 py-2 text-xs md:text-sm">
              {point}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProjectDetailPage() {
  const [, params] = useRoute("/project/:projectName");
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const projectName = params?.projectName ? decodeURIComponent(params.projectName) : "";
  const { projectsSummary } = useProgramData();
  const { user } = useAuth();

  useEffect(() => {
    if (projectName) {
      try { localStorage.setItem("last_visited_project", JSON.stringify({ name: projectName, timestamp: Date.now() })); } catch {}
    }
  }, [projectName]);
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
    expenditure: canViewPerm("pd_expenditure"),
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
    collaboration: canViewPerm("pd_collaboration"),
  };
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedTaskRole, setSelectedTaskRole] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);

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
    if (section === "commercial" && !canViewTab.finance) { setActiveSection("overview"); return; }
    if (section === "collaboration" && !canViewSubTab.collaboration) { setActiveSection("overview"); return; }
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

  const handleTaskClick = (taskId: number, role?: string | null) => {
    setSelectedTaskId(taskId);
    setSelectedTaskRole(role || null);
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

  const { data: pdTicketsData = [] } = useQuery<any[]>({
    queryKey: ["pd-tickets-project", projectInfoId],
    queryFn: async () => {
      const res = await engFetch(`/api/pd/tickets`);
      if (!res.ok) return [];
      const all = await res.json();
      return all
        .filter((t: any) => t.ticket?.projectId === projectInfoId)
        .map((t: any) => ({
          id: t.ticket?.id,
          status: t.ticket?.status,
          requestType: t.ticket?.requestType,
          dueDate: t.ticket?.dueDate,
          projectSiteName: t.ticket?.projectSiteName,
          priority: t.ticket?.priority,
          taskCount: { total: t.taskTotal || 0, completed: t.taskCompleted || 0 },
        }));
    },
    enabled: !!projectInfoId,
  });

  const { data: projectPlanData = [] } = useQuery({
    queryKey: ["project-plan", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/planning-tasks/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      const raw = await res.json();
      return Array.isArray(raw) ? raw : (raw.tasks || []);
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
  const executionPhase = projectInfo?.execution_phase || phase || null;
  const pd = projectInfo?.pd || "—";
  const pm = projectInfo?.pm || "—";
  const sizeKwp = projectInfo?.size_kwp ? `${projectInfo.size_kwp.toFixed(0)} kWp` : "—";
  const completion = projectInfo?.project_pct_complete != null
    ? `${(projectInfo.project_pct_complete * 100).toFixed(0)}%`
    : "—";
  const completionNum = projectInfo?.project_pct_complete != null ? projectInfo.project_pct_complete * 100 : 0;
  const isAdmin = ['admin', 'COO_ADMIN', 'CEO_ADMIN'].includes(user?.role || '');
  const canSetRag = ['admin', 'COO_ADMIN', 'CEO_ADMIN', 'CCO'].includes(user?.role || '');
  const ragStatus = projectInfo?.rag_status || null;
  const totalRevenueActual = (revenueData as any[]).reduce((s: number, r: any) => s + (Number(r.milestoneAmount) || 0), 0);
  const contractValue = projectInfo?.contract_value || totalRevenueActual || 0;
  const totalBudgetFromExpenses = (expenseData as any[]).reduce((s: number, e: any) => s + (Number(e.budgetTotal) || 0), 0);
  const budgetTotal = projectInfo?.budget_total || totalBudgetFromExpenses || 0;

  const planTasks = projectPlanData as any[];
  const today = new Date().toISOString().split("T")[0];
  const overduePlanTasks = planTasks.filter((t: any) => {
    const endDate = t.actualEndDate || t.dueDate || t.actualEnd || t.endDate;
    const pct = t.percentComplete != null ? Number(t.percentComplete) : (Number(t.actualPctComplete) || 0);
    const pctNorm = pct > 1 ? pct : pct * 100;
    return endDate && endDate.substring(0, 10) < today && pctNorm < 100;
  });
  const completedPlanTasks = planTasks.filter((t: any) => {
    const pct = t.percentComplete != null ? Number(t.percentComplete) : (Number(t.actualPctComplete) || 0);
    const pctNorm = pct > 1 ? pct : pct * 100;
    return pctNorm >= 100;
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

  const isInflowInBank = (r: any): boolean => {
    const manualInBank = r.inBank === 1 || r.inBank === '1' || r.inBank === true;
    const hasInvoice = !!(r.milestoneInvoiceNumber && String(r.milestoneInvoiceNumber).trim());
    const hasPaymentReceived = !!(r.paymentReceivedDate && String(r.paymentReceivedDate).trim() && r.paymentReceivedDate !== '-');
    return manualInBank || (hasPaymentReceived && hasInvoice);
  };

  const isExpensePaid = (e: any): boolean => {
    const hasPaymentDate = !!(e.expensePaymentDate && String(e.expensePaymentDate).trim());
    const hasInvoiceNumber = !!(e.expenseInvoiceNumber && String(e.expenseInvoiceNumber).trim());
    if (!hasInvoiceNumber || !hasPaymentDate) return false;
    const paymentDateConfirmed = e.paymentDateFontColor === 'red' ? false : (e.paymentDateFontColor === 'black' ? true : e.paymentDateConfirmed === true);
    return paymentDateConfirmed;
  };

  const isCosRealised = (e: any): boolean => {
    const hasInvoice = !!(e.expenseInvoiceNumber && String(e.expenseInvoiceNumber).trim());
    const hasInvDate = !!(e.expenseInvoicedDate && String(e.expenseInvoicedDate).trim());
    return hasInvoice && hasInvDate;
  };

  const nextMilestone = useMemo(() => {
    const unpaid = (revenueData as any[])
      .filter((r: any) => !isInflowInBank(r) && r.plannedPaymentDate)
      .sort((a: any, b: any) => new Date(a.plannedPaymentDate).getTime() - new Date(b.plannedPaymentDate).getTime());
    if (unpaid.length > 0) {
      const m = unpaid[0];
      return { name: m.milestoneName || "Revenue Milestone", date: m.plannedPaymentDate, allPaid: false };
    }
    const hasAny = (revenueData as any[]).length > 0;
    if (hasAny) {
      return { name: "All Paid", date: null, allPaid: true };
    }
    return null;
  }, [revenueData]);

  const totalPaidInflows = (revenueData as any[]).reduce((s: number, r: any) => {
    if (isInflowInBank(r)) return s + (Number(r.milestoneAmount) || 0);
    return s;
  }, 0);
  const revenueRealisedPct = contractValue > 0 ? (totalPaidInflows / contractValue) * 100 : 0;

  const totalRealisedCos = (expenseData as any[]).reduce((s: number, e: any) => {
    if (isCosRealised(e)) return s + (Number(e.expenseActualTotal) || 0);
    return s;
  }, 0);
  const cosDenominator = totalExpenses > 0 ? totalExpenses : budgetTotal;
  const cosRealisedPct = cosDenominator > 0 ? (totalRealisedCos / cosDenominator) * 100 : 0;
  const marginDelta = revenueRealisedPct - cosRealisedPct;

  const hasRedRag = scheduleRag === "red" || costRag === "red" || qualityRag === "red";
  const overallRag: "green" | "amber" | "red" = hasRedRag ? "red" : (scheduleRag === "amber" || costRag === "amber" || qualityRag === "amber") ? "amber" : "green";
  const commercialPendingCount = Math.max((revenueData as any[]).filter((r: any) => !isInflowInBank(r)).length, 0);
  const unpaidExpenseCount = Math.max((expenseData as any[]).filter((e: any) => !isExpensePaid(e)).length, 0);
  const dependencyCount = pdTicketsData.length;
  const overdueEngineeringCount = (engDataForAlerts?.tasks || []).filter((t: any) => t.dueDate && t.dueDate < today && t.status !== "COMPLETE").length;
  const collaborationSignals = {
    hasHistory: !!projectInfoId,
    hasApprovals: !!projectInfoId,
    hasComms: !!projectName,
  };

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



  const ragColor = (rag: "green" | "amber" | "red") => rag === "green" ? "text-emerald-600" : rag === "amber" ? "text-amber-600" : "text-red-600";

  return (
    <PageShell className="p-4 md:p-6">
      <ProjectCommandHeader
        projectName={projectName}
        displayName={displayName}
        phase={phase}
        pd={pd}
        pm={pm}
        sizeKwp={sizeKwp}
        completion={completion}
        completionNum={completionNum}
        contractValue={contractValue}
        revenueRealisedPct={revenueRealisedPct}
        cosRealisedPct={cosRealisedPct}
        marginDelta={marginDelta}
        scheduleRag={scheduleRag}
        costRag={costRag}
        qualityRag={qualityRag}
        ragStatus={ragStatus}
        nextMilestone={nextMilestone}
        projectInfoId={projectInfoId ?? null}
        isAdmin={isAdmin}
        canSetRag={canSetRag}
        pdAssignableUsers={pdAssignableUsers || []}
        pmAssignableUsers={pmAssignableUsers || []}
        onPhaseChangeClick={() => setPhaseModalOpen(true)}
      />

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

      <div className="flex items-center gap-1 bg-white border rounded-lg p-1 overflow-x-auto scrollbar-hide" data-testid="project-major-tabs">
        {[
          { key: "overview", label: "Overview", icon: Eye, visible: true },
          { key: "delivery", label: "Delivery", icon: CalendarDays, visible: canViewTab.overview },
          { key: "commercial", label: "Commercial", icon: DollarSign, visible: canViewTab.finance },
          { key: "engineering", label: "Engineering", icon: Wrench, visible: canViewTab.engineering },
          { key: "quality", label: "Quality", icon: ShieldCheck, visible: canViewTab.quality },
          { key: "collaboration", label: "Collaboration & Records", icon: Users, visible: canViewSubTab.collaboration },
        ].filter(t => t.visible).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSection === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => navigateToSection(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-all ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
              data-testid={`major-tab-${tab.key}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeSection === "overview" && (
        <div className="space-y-4" data-testid="overview-section">
          <Card className="shadow-sm" data-testid="overview-truth-center">
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Project truth center</p>
                  <h2 className="text-lg font-semibold">{displayName}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <PhaseBadge phase={phase} />
                    <span className="inline-flex items-center gap-1"><RagDot color={overallRag} />Overall: {overallRag.toUpperCase()}</span>
                    <span>Execution: {getPhaseLabel(executionPhase)}</span>
                    <span>•</span>
                    <span>Size: {sizeKwp}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center min-w-[260px]">
                  <div className="rounded-md border p-2">
                    <p className="text-[10px] text-muted-foreground">Schedule</p>
                    <p className={`text-sm font-semibold ${ragColor(scheduleRag)}`}>{scheduleRag.toUpperCase()}</p>
                  </div>
                  <div className="rounded-md border p-2">
                    <p className="text-[10px] text-muted-foreground">Cost</p>
                    <p className={`text-sm font-semibold ${ragColor(costRag)}`}>{costRag.toUpperCase()}</p>
                  </div>
                  <div className="rounded-md border p-2">
                    <p className="text-[10px] text-muted-foreground">Quality</p>
                    <p className={`text-sm font-semibold ${ragColor(qualityRag)}`}>{qualityRag.toUpperCase()}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="rounded-lg border p-3 space-y-2" data-testid="overview-key-facts">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key facts & owners</p>
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">PD:</span> {pd}</p>
                    <p><span className="text-muted-foreground">PM:</span> {pm}</p>
                    <p><span className="text-muted-foreground">Completion:</span> {completion}</p>
                    <p><span className="text-muted-foreground">Contract value:</span> R{contractValue.toLocaleString()}</p>
                    <p><span className="text-muted-foreground">Budget total:</span> R{budgetTotal.toLocaleString()}</p>
                  </div>
                </div>

                <div className="rounded-lg border p-3 space-y-2" data-testid="overview-urgent-blockers">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Urgent blockers</p>
                  {(() => {
                    const overdueEng = engBoardTasks.filter((t: any) => t.dueDate && t.dueDate < today && t.status !== "COMPLETE").length;
                    const blockers = [
                      { label: "Overdue plan tasks", count: overduePlanTasks.length, onClick: () => navigateToSection("delivery", "task-grid") },
                      { label: "Overdue engineering tasks", count: overdueEng, onClick: () => navigateToSection("engineering", "eng-tasks") },
                      { label: "Unapproved quality items", count: Math.max(qualityTotalItems - qualityApprovedItems, 0), onClick: () => navigateToSection("quality", "quality") },
                    ].filter((b) => b.count > 0);
                    if (blockers.length === 0) return <p className="text-sm text-emerald-600">No urgent blockers detected.</p>;
                    return blockers.map((b) => (
                      <button key={b.label} onClick={b.onClick} className="w-full text-left rounded-md border border-red-100 bg-red-50 px-2 py-1.5 text-xs hover:bg-red-100">
                        <span className="font-semibold text-red-700">{b.count}</span> {b.label}
                      </button>
                    ));
                  })()}
                </div>

                <div className="rounded-lg border p-3 space-y-2" data-testid="overview-next-actions">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest critical actions</p>
                  <div className="space-y-1 text-xs">
                    <button onClick={() => navigateToSection("delivery", "raid")} className="w-full rounded-md border px-2 py-1.5 text-left hover:bg-muted/60">Update RAID log and close top risks.</button>
                    <button onClick={() => navigateToSection("commercial", "procurement")} className="w-full rounded-md border px-2 py-1.5 text-left hover:bg-muted/60">Confirm procurement and invoice commitments.</button>
                    <button onClick={() => navigateToSection("collaboration", "approvals")} className="w-full rounded-md border px-2 py-1.5 text-left hover:bg-muted/60">Capture latest approvals and deliverable evidence.</button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2" data-testid="overview-linked-statuses">
                <Button variant="outline" size="sm" onClick={() => navigateToSection("delivery", "task-grid")} className="justify-start">Delivery</Button>
                <Button variant="outline" size="sm" onClick={() => navigateToSection("commercial", "procurement")} className="justify-start">Commercial</Button>
                {canViewTab.engineering && <Button variant="outline" size="sm" onClick={() => navigateToSection("engineering", "eng-tasks")} className="justify-start">Engineering</Button>}
                {canViewTab.quality && <Button variant="outline" size="sm" onClick={() => navigateToSection("quality", "quality")} className="justify-start">Quality</Button>}
                <Button variant="outline" size="sm" onClick={() => navigateToSection("collaboration", "chat")} className="justify-start">Collaboration & Records</Button>
              </div>
            </CardContent>
          </Card>

          {projectInfoId && <PhaseHistoryTimeline projectId={projectInfoId} />}
          {projectInfoId && <HandoverGatePanel projectId={projectInfoId} />}
          {!projectInfo && (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                Project summary data is still syncing. Core tabs are available and will populate as data arrives.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeSection === "delivery" && (
        <div className="space-y-4" data-testid="delivery-section">
          <SectionBrief
            title="Delivery control room"
            subtitle="Near-term movement"
            points={[
              `${planTasks.length} plan tasks (${Math.round(planCompletionPct)}% complete)`,
              `${overduePlanTasks.length} overdue tasks + ${overdueEngineeringCount} overdue engineering tasks`,
              `${dependencyCount} linked PD ticket dependencies`,
            ]}
          />
          <div className="flex items-center gap-3 flex-wrap border-b pb-2 overflow-x-auto scrollbar-hide" data-testid="delivery-sub-tabs">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">Operational movement</span>
            <Button size="sm" variant={activeSubTab === "task-grid" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("task-grid")} data-testid="subtab-task-grid">
              <ListTodo className="h-3 w-3 mr-1" /> Milestones & Plan
            </Button>
            <Button size="sm" variant={activeSubTab === "board" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("board")} data-testid="subtab-board">
              <Columns className="h-3 w-3 mr-1" /> Board
            </Button>
            <Button size="sm" variant={activeSubTab === "calendar" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("calendar")} data-testid="subtab-calendar">
              <CalendarDays className="h-3 w-3 mr-1" /> Calendar
            </Button>
            <Button size="sm" variant={activeSubTab === "raid" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("raid")} data-testid="subtab-raid">
              <AlertTriangle className="h-3 w-3 mr-1" /> Blockers / RAID
            </Button>
            <Button size="sm" variant={activeSubTab === "commissioning" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("commissioning")} data-testid="subtab-commissioning">
              <CheckCircle className="h-3 w-3 mr-1" /> Commissioning
            </Button>
          </div>

          {activeSubTab === "task-grid" && canViewTab.overview && <><ModuleContext module="task-grid" projectId={projectInfoId!} /><UnifiedPlanTab projectName={projectName} onTaskClick={handleTaskClick} /></>}
          {activeSubTab === "board" && canViewTab.overview && <BoardView projectName={projectName} onTaskClick={handleTaskClick} />}
          {activeSubTab === "calendar" && canViewTab.overview && <CalendarView projectName={projectName} onTaskClick={handleTaskClick} />}
          {activeSubTab === "raid" && projectInfoId && <><ModuleContext module="raid" projectId={projectInfoId} /><ProjectRaidTab projectId={projectInfoId} projectName={projectName} /></>}
          {activeSubTab === "commissioning" && projectInfoId && <><ModuleContext module="commissioning" projectId={projectInfoId} /><ProjectCommissioningTab projectId={projectInfoId} projectName={projectName} /></>}
        </div>
      )}

      {activeSection === "commercial" && canViewTab.finance && (
        <div className="space-y-4" data-testid="commercial-section">
          <SectionBrief
            title="Commercial controls"
            subtitle="Cash, commitments, and approvals"
            points={[
              `Contract value R${contractValue.toLocaleString()} | Budget R${budgetTotal.toLocaleString()}`,
              `${commercialPendingCount} inflows pending, ${unpaidExpenseCount} expense payments pending`,
              `Revenue realised ${revenueRealisedPct.toFixed(0)}% | COS realised ${cosRealisedPct.toFixed(0)}%`,
            ]}
          />
          <div className="flex items-center gap-3 flex-wrap border-b pb-2 overflow-x-auto scrollbar-hide" data-testid="commercial-sub-tabs">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">Commercial controls</span>
            <Button size="sm" variant={activeSubTab === "procurement" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("procurement")} data-testid="subtab-procurement">
              <CreditCard className="h-3 w-3 mr-1" /> Procurement
            </Button>
            {canViewSubTab.revenue && <Button size="sm" variant={activeSubTab === "revenue-tracking" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("revenue-tracking")} data-testid="subtab-revenue"><DollarSign className="h-3 w-3 mr-1" /> Invoices / Inflows</Button>}
            {canViewSubTab.expenditure && <Button size="sm" variant={activeSubTab === "expenditure" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("expenditure")} data-testid="subtab-expenditure"><CreditCard className="h-3 w-3 mr-1" /> Commitments / COS</Button>}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tracking</span>
            {canViewSubTab.cosTracker && <Button size="sm" variant={activeSubTab === "monthly-realisation" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("monthly-realisation")} data-testid="subtab-monthly-realisation"><TrendingUp className="h-3 w-3 mr-1" /> COS Tracker</Button>}
            {canViewSubTab.cosTracker && <Button size="sm" variant={activeSubTab === "revenue-tracker" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("revenue-tracker")} data-testid="subtab-revenue-tracker"><TrendingUp className="h-3 w-3 mr-1" /> Revenue Tracker</Button>}
            {canViewSubTab.cosTracker && <Button size="sm" variant={activeSubTab === "gp-tracker" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("gp-tracker")} data-testid="subtab-gp-tracker"><BarChart3 className="h-3 w-3 mr-1" /> GP</Button>}
            {canViewSubTab.cashflow && <Button size="sm" variant={activeSubTab === "cashflow" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("cashflow")} data-testid="subtab-cashflow"><Activity className="h-3 w-3 mr-1" /> Cashflow</Button>}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Controls</span>
            <Button size="sm" variant={activeSubTab === "change-control" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("change-control")} data-testid="subtab-change-control"><FileCheck className="h-3 w-3 mr-1" /> VO / Changes</Button>
            {canViewTab.finance && canViewSubTab.subcontractors && <Button size="sm" variant={activeSubTab === "subcontractors" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("subcontractors")} data-testid="subtab-subcontractors"><Users className="h-3 w-3 mr-1" /> Subcontractors</Button>}
          </div>

          {activeSubTab === "revenue-tracking" && canViewTab.finance && canViewSubTab.revenue && <><ModuleContext module="revenue-tracking" projectId={projectInfoId!} /><RevenueTrackingTab projectName={projectName} highlightId={highlightType === 'revenue' ? highlightId : null} /></>}
          {activeSubTab === "expenditure" && canViewTab.finance && canViewSubTab.expenditure && <><ModuleContext module="expenditure" projectId={projectInfoId!} /><ExpenditureEditableTab projectName={projectName} highlightId={highlightType === 'expense' ? highlightId : null} /></>}
          {activeSubTab === "monthly-realisation" && canViewTab.finance && canViewSubTab.cosTracker && <MonthlyRealisationTab projectName={projectName} />}
          {activeSubTab === "revenue-tracker" && canViewTab.finance && canViewSubTab.cosTracker && <RevenueTrackerTab projectName={projectName} />}
          {activeSubTab === "gp-tracker" && canViewTab.finance && canViewSubTab.cosTracker && <GpTrackerTab projectName={projectName} />}
          {activeSubTab === "cashflow" && canViewTab.finance && canViewSubTab.cashflow && <><ModuleContext module="cashflow" projectId={projectInfoId!} /><CashflowTab projectName={projectName} /></>}
          {activeSubTab === "subcontractors" && canViewTab.finance && canViewSubTab.subcontractors && <ProjectSubcontractorsTab projectName={projectName} />}
          {activeSubTab === "change-control" && projectInfoId && <><ModuleContext module="change-control" projectId={projectInfoId} /><ProjectChangeControlTab projectId={projectInfoId} projectName={projectName} /></>}
          {activeSubTab === "procurement" && projectInfoId && <><ModuleContext module="procurement" projectId={projectInfoId} /><ProjectProcurementTab projectId={projectInfoId} projectName={projectName} /></>}
        </div>
      )}

      {activeSection === "engineering" && canViewTab.engineering && (
        <div className="space-y-4" data-testid="eng-section">
          <SectionBrief
            title="Engineering execution"
            subtitle="Design and task flow"
            points={[
              `${engTotalTasks} tracked engineering tasks`,
              `${Math.round(engStagePct)}% complete across stages + board`,
              `${overdueEngineeringCount} overdue engineering tasks requiring action`,
            ]}
          />
          <Button variant="ghost" size="sm" onClick={() => navigateToSection("overview")} className="gap-2 -ml-2" data-testid="button-back-overview">
            <ArrowLeft className="h-4 w-4" />
            Back to Overview
          </Button>

          {canViewSubTab.engTasks && <EngTasksTab projectInfoId={projectInfoId ?? null} isAdmin={isAdmin} projectName={projectName} />}
        </div>
      )}

      {activeSection === "quality" && canViewTab.quality && (
        <div className="space-y-4" data-testid="quality-section">
          <SectionBrief
            title="Quality readiness"
            subtitle="Gates and evidence"
            points={[
              `${qualityGatesPassed}/${qualityGatesTotal} quality gates passed`,
              `${Math.round(qualityProgressPct)}% checklist item completion`,
              `${Math.max(qualityTotalItems - qualityApprovedItems, 0)} quality items pending approval`,
            ]}
          />
          <Button variant="ghost" size="sm" onClick={() => navigateToSection("overview")} className="gap-2 -ml-2" data-testid="button-back-overview">
            <ArrowLeft className="h-4 w-4" />
            Back to Overview
          </Button>
          <QualityTab projectName={projectName} />
        </div>
      )}

      {activeSection === "collaboration" && canViewSubTab.collaboration && (
        <div className="space-y-4" data-testid="collaboration-section">
          <SectionBrief
            title="Collaboration & records"
            subtitle="Project communications and audit trail"
            points={[
              collaborationSignals.hasComms ? "Linked communication threads available" : "No linked communications detected yet",
              collaborationSignals.hasApprovals ? "Approvals and notification records enabled" : "Approvals unavailable until project sync completes",
              collaborationSignals.hasHistory ? "History and weekly review records available" : "History will appear once project id resolves",
            ]}
          />
          <Button variant="ghost" size="sm" onClick={() => navigateToSection("overview")} className="gap-2 -ml-2" data-testid="button-back-overview">
            <ArrowLeft className="h-4 w-4" />
            Back to Overview
          </Button>

          <div className="flex gap-1.5 flex-nowrap border-b pb-2 overflow-x-auto scrollbar-hide" data-testid="collab-sub-tabs">
            <Button size="sm" variant={activeSubTab === "chat" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("chat")} data-testid="subtab-chat">
              <MessageSquare className="h-3 w-3 mr-1" /> Linked Comms
            </Button>
            <Button size="sm" variant={activeSubTab === "approvals" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("approvals")} data-testid="subtab-approvals">
              <FileCheck className="h-3 w-3 mr-1" /> Approvals
            </Button>
            <Button size="sm" variant={activeSubTab === "notifications" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("notifications")} data-testid="subtab-notifications">
              <Bell className="h-3 w-3 mr-1" /> Notifications
            </Button>
            <Button size="sm" variant={activeSubTab === "local-files" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("local-files")} data-testid="subtab-local-files">
              <FolderOpen className="h-3 w-3 mr-1" /> Docs & Folders
            </Button>
            {canViewTab.history && <Button size="sm" variant={activeSubTab === "history" ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => setActiveSubTab("history")} data-testid="subtab-history"><History className="h-3 w-3 mr-1" /> History & Audit</Button>}
          </div>

          {activeSubTab === "chat" && <ProjectChatTab projectName={projectName} projectInfoId={projectInfoId ?? null} />}
          {activeSubTab === "approvals" && <ProjectApprovalsTab projectName={projectName} projectInfoId={projectInfoId ?? null} />}
          {activeSubTab === "notifications" && <ProjectNotificationsTab projectName={projectName} />}
          {activeSubTab === "local-files" && <LocalFolderTab projectName={projectName} />}
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

      <TaskDetailDrawer
        taskId={selectedTaskId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTaskId(null); setSelectedTaskRole(null); }}
        projectName={projectName}
        trackingRole={selectedTaskRole === "VIEWER" ? "viewer" : selectedTaskRole === "OWNER" ? "assignee" : selectedTaskRole === "REVIEWER" ? "assignee" : null}
      />

      {projectInfoId && (
        <PhaseChangeModal
          projectId={projectInfoId}
          currentPhase={phase}
          open={phaseModalOpen}
          onClose={() => setPhaseModalOpen(false)}
        />
      )}

      <DataSourceDebug
        pageName="Project Detail"
        dataSources={[
          { endpoint: "/api/projects-summary", tables: ["project_info", "normalized_cost_lines", "normalized_revenue_lines", "normalized_plan_tasks"], description: "Project summary data" },
          { endpoint: `/api/projects/${projectInfoId}/eng-tasks`, tables: ["engineering_tasks"], description: "Engineering tasks for this project" },
          { endpoint: `/api/projects/${projectInfoId}/phase-history`, tables: ["phase_history"], description: "Phase transition history" },
          { endpoint: "/api/normalized-plan-tasks", tables: ["normalized_plan_tasks"], description: "Gantt / project plan tasks" },
          { endpoint: "/api/normalized-cost-lines", tables: ["normalized_cost_lines"], description: "Expenditure line items" },
          { endpoint: "/api/normalized-revenue-lines", tables: ["normalized_revenue_lines"], description: "Revenue tracking line items" },
        ]}
      />
    </PageShell>
  );
}

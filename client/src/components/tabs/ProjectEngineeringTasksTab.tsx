import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EnergyLoader } from "@/components/ui/energy-loader";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import { invalidateAllTaskCaches } from "@/lib/task-cache";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Circle,
  Eye,
  Loader2,
  Plus,
  PlusCircle,
  Search,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

// PR-G polish — phase TEXT already tells the user which phase; the
// badge does not need 8 distinct hues. Collapse to a single neutral chip.
const PHASE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  P0_FIRST_ASSESSMENT: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  P1_COST_PROPOSAL_DESIGN: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  P2_PD_PM_HANDOVER: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  P4_CONSTRUCTION_INSTALLATION: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  P5_COMMISSIONING_TESTING: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  P7_CLOSEOUT_POSTMORTEM: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
};

function getPhaseLabel(phase: string | null): string {
  if (!phase) return "Unknown";
  return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
}
function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const companyRole = localStorage.getItem("company_role");
  if (companyRole) headers["x-company-role"] = companyRole;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}
// PR-G polish — collapse 9 status hues to the 4-level palette. The
// status LABEL already says "IN PROGRESS" / "HOLD" / "COMPLETE" etc.
const STATUS_DOT: Record<string, string> = {
  "TO DO": "text-slate-400", "IN PROGRESS": "text-amber-500", "HOLD": "text-red-500",
  "NEEDS APPROVAL": "text-amber-500", "COMPLETE": "text-emerald-500",
  "QC APPROVED": "text-emerald-500", "PROVIDE FEEDBACK": "text-amber-500",
  "OPERATIONAL APPROVAL": "text-amber-500", "PROJECTS ASSISTANCE": "text-amber-500",
};
const STATUS_BADGE: Record<string, string> = {
  "TO DO": "bg-muted text-foreground", "IN PROGRESS": "bg-amber-100 text-amber-700",
  "HOLD": "bg-red-100 text-red-700", "NEEDS APPROVAL": "bg-amber-100 text-amber-700",
  "COMPLETE": "bg-emerald-100 text-emerald-700", "QC APPROVED": "bg-emerald-100 text-emerald-700",
  "PROVIDE FEEDBACK": "bg-amber-100 text-amber-700",
};

const ALL_STATUSES = ["TO DO", "IN PROGRESS", "HOLD", "NEEDS APPROVAL", "COMPLETE", "QC APPROVED", "PROVIDE FEEDBACK", "OPERATIONAL APPROVAL", "PROJECTS ASSISTANCE"];
const ALL_PRIORITIES = ["Low", "Med", "High", "Critical"];

export function ProjectEngineeringTasksTab({
  projectInfoId,
  isAdmin,
  projectName,
  initialStatusFilter,
}: {
  projectInfoId: number | null;
  isAdmin: boolean;
  projectName: string;
  initialStatusFilter?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState("Med");
  const [newDueDate, setNewDueDate] = useState("");
  const [newAssigneeUserId, setNewAssigneeUserId] = useState<string>("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { allowed: canEdit } = usePermission('pd_eng_tasks', 'edit');
  const { allowed: canDelete } = usePermission('pd_eng_tasks', 'delete');

  useEffect(() => {
    if (!initialStatusFilter) return;
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

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
    mutationFn: async (taskData: { title: string; description?: string; priority?: string; dueDate?: string; ownerUserId?: number | null }) => {
      const res = await engFetch("/api/eng/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: taskData.title,
          description: taskData.description || null,
          priority: taskData.priority || "Med",
          dueDate: taskData.dueDate || null,
          ownerUserId: taskData.ownerUserId || null,
          projectId: projectInfoId,
          status: "TO DO",
          taskTypeTag: "PROJECT",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create task");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task created" });
      invalidateAllTaskCaches(qc);
      setNewTitle("");
      setNewDescription("");
      setNewPriority("Med");
      setNewDueDate("");
      setNewAssigneeUserId("");
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
      invalidateAllTaskCaches(qc);
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
      invalidateAllTaskCaches(qc);
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
      invalidateAllTaskCaches(qc);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const allTasks = engData?.tasks || [];
  const openTasks = allTasks.filter((t: any) => t.status !== "COMPLETE" && t.status !== "Complete");
  const completedTasks = allTasks.filter((t: any) => t.status === "COMPLETE" || t.status === "Complete");
  const overdue = allTasks.filter((t: any) => {
    const due = t.dueDate || t.endDate;
    return due && due < new Date().toISOString().split("T")[0] && t.status !== "COMPLETE" && t.status !== "Complete";
  });

  // Keep this as a plain derived value so early-return paths never affect hook order.
  let tasks = allTasks;
  if (statusFilter === "open") {
    tasks = tasks.filter((t: any) => t.status !== "COMPLETE" && t.status !== "Complete");
  } else if (statusFilter === "completed") {
    tasks = tasks.filter((t: any) => t.status === "COMPLETE" || t.status === "Complete");
  } else if (statusFilter === "overdue") {
    const today = new Date().toISOString().split("T")[0];
    tasks = tasks.filter((t: any) => {
      const due = t.dueDate || t.endDate;
      return due && due < today && t.status !== "COMPLETE" && t.status !== "Complete";
    });
  }
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    tasks = tasks.filter((t: any) =>
      (t.title || "").toLowerCase().includes(q) ||
      (t.description || "").toLowerCase().includes(q)
    );
  }

  if (!projectInfoId) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Project info not available</div>;
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><EnergyLoader size="md" label="Loading project..." /></div>;
  }

  const phaseGroups = new Map<string, any[]>();
  for (const t of tasks) {
    const ph = t.phase || t.workstream || "Unassigned";
    if (!phaseGroups.has(ph)) phaseGroups.set(ph, []);
    phaseGroups.get(ph)!.push(t);
  }

  const getTaskId = (task: any) => task.id;

  const handleCreateTask = () => {
    if (!newTitle.trim()) return;
    createMutation.mutate({
      title: newTitle.trim(),
      description: newDescription.trim() || undefined,
      priority: newPriority,
      dueDate: newDueDate || undefined,
      ownerUserId: newAssigneeUserId ? parseInt(newAssigneeUserId) : null,
    });
  };

  return (
    <div className="space-y-4" data-testid="eng-tasks-tab">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">Engineering Tasks</h3>
        <div className="flex gap-2">
          {allTasks.length === 0 && isAdmin && (
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
        <Card className="p-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase text-muted-foreground">Title</Label>
            <Input
              placeholder="Task title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && newTitle.trim()) handleCreateTask(); }}
              data-testid="input-new-eng-task"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase text-muted-foreground">Description</Label>
            <Textarea
              placeholder="Task description..."
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="text-sm min-h-[60px]"
              data-testid="input-new-eng-task-desc"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase text-muted-foreground">Priority</Label>
              <SearchableSelect
                value={newPriority}
                onValueChange={setNewPriority}
                triggerClassName="h-8 text-sm"
                options={ALL_PRIORITIES.map(p => ({ value: p, label: p }))}
                data-testid="select-new-eng-task-priority"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase text-muted-foreground">Due Date</Label>
              <Input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="h-8 text-sm"
                data-testid="input-new-eng-task-due"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[10px] uppercase text-muted-foreground">Assignee</Label>
              <SearchableSelect
                value={newAssigneeUserId}
                onValueChange={setNewAssigneeUserId}
                triggerClassName="h-8 text-sm"
                placeholder="Unassigned"
                options={[
                  { value: "", label: "Unassigned" },
                  ...(allUsers || []).map((u: any) => ({ value: String(u.id), label: u.name })),
                ]}
                data-testid="select-new-eng-task-assignee"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="h-8" onClick={handleCreateTask} disabled={!newTitle.trim() || createMutation.isPending} data-testid="button-save-eng-task">
              {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Create Task
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => { setShowAddForm(false); setNewTitle(""); setNewDescription(""); setNewPriority("Med"); setNewDueDate(""); setNewAssigneeUserId(""); }} data-testid="button-cancel-eng-task">Cancel</Button>
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

      {allTasks.length === 0 && !showAddForm ? (
        <div className="text-center py-12 space-y-2">
          <Wrench className="h-12 w-12 mx-auto text-muted-foreground/30" />
          <p className="text-lg font-medium text-muted-foreground">No engineering tasks yet</p>
          <p className="text-sm text-muted-foreground/70">Add tasks manually or generate from templates.</p>
        </div>
      ) : allTasks.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className={`p-3 cursor-pointer transition-all ${statusFilter === "all" ? "ring-2 ring-primary" : "hover:bg-muted/30"}`} onClick={() => setStatusFilter("all")}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
              <p className="text-xl font-bold mt-1">{allTasks.length}</p>
            </Card>
            <Card className={`p-3 cursor-pointer transition-all ${statusFilter === "open" ? "ring-2 ring-primary" : "hover:bg-muted/30"}`} onClick={() => setStatusFilter("open")}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Open</p>
              <p className="text-xl font-bold mt-1 text-amber-600">{openTasks.length}</p>
            </Card>
            <Card className={`p-3 cursor-pointer transition-all ${statusFilter === "completed" ? "ring-2 ring-emerald-500" : "hover:bg-muted/30"}`} onClick={() => setStatusFilter("completed")}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Completed</p>
              <p className="text-xl font-bold mt-1 text-emerald-600">{completedTasks.length}</p>
            </Card>
            <Card className={`p-3 cursor-pointer transition-all ${statusFilter === "overdue" ? "ring-2 ring-red-500" : ""} ${overdue.length > 0 ? "border-red-200 hover:bg-red-50/30" : "hover:bg-muted/30"}`} onClick={() => setStatusFilter("overdue")}>
              <p className={`text-[10px] uppercase tracking-wider ${overdue.length > 0 ? "text-red-600" : "text-muted-foreground"}`}>Overdue</p>
              <p className={`text-xl font-bold mt-1 ${overdue.length > 0 ? "text-red-600" : ""}`}>{overdue.length}</p>
            </Card>
          </div>

          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(completedTasks.length / allTasks.length) * 100}%` }} />
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 text-sm pl-8"
                data-testid="eng-tasks-search"
              />
            </div>
            {(statusFilter !== "all" || searchQuery) && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setStatusFilter("all"); setSearchQuery(""); }} data-testid="eng-tasks-clear-filter">
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
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
                                  <>
                                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-700 gap-1" onClick={() => setDeleteConfirmId(task.id)} data-testid={`btn-delete-eng-task-${task.id}`}>
                                      <Trash2 className="h-3 w-3" /> Delete
                                    </Button>
                                    <ConfirmDialog
                                      open={deleteConfirmId === task.id}
                                      onOpenChange={(o) => setDeleteConfirmId(o ? task.id : null)}
                                      title="Delete this task?"
                                      description="This permanently removes the engineering task. This action cannot be undone."
                                      confirmLabel={deleteMutation.isPending ? "Deleting..." : "Delete"}
                                      variant="destructive"
                                      onConfirm={() => deleteMutation.mutate(tid)}
                                    />
                                  </>
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
                              <div><span className="text-muted-foreground">Start:</span> {task.startDate || "â€”"}</div>
                              <div><span className="text-muted-foreground">Due:</span> {taskDue || "â€”"}</div>
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

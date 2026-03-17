import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Link } from "wouter";
import {
  Save,
  Loader2,
  Trash2,
  CheckCircle2,
  Play,
  Ban,
  Clock,
  Circle,
  AlertCircle,
  Zap,
  Target,
  FileText,
  ExternalLink,
  Calendar,
  User,
  FolderOpen,
  Building2,
  ChevronRight,
  X,
} from "lucide-react";
import type { TaskItem, TaskStatus, TaskPriority } from "./TaskCard";
import { PriorityBadge, StatusIcon } from "./TaskCard";

const DEPARTMENTS = [
  "Engineering", "Finance", "Operations", "Sales",
  "Procurement", "Legal", "HR", "Executive",
  "Project Delivery", "O&M",
];

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "waiting", label: "Waiting" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "critical", label: "P1 — Critical" },
  { value: "high", label: "P2 — High" },
  { value: "normal", label: "P3 — Normal" },
  { value: "low", label: "P4 — Low" },
];

interface TaskDetailDrawerProps {
  task: TaskItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvalidate?: () => void;
}

export default function TaskDetailDrawer({ task, open, onOpenChange, onInvalidate }: TaskDetailDrawerProps) {
  const { toast } = useToast();

  const [form, setForm] = useState({
    title: "",
    status: "inbox" as TaskStatus,
    priority: "normal" as TaskPriority,
    nextStep: "",
    definitionOfDone: "",
    completionNote: "",
    notes: "",
    bucket: "personal" as string,
    projectName: "",
    department: "",
    blockedReason: "",
    plannedForDate: "",
    dueAt: "",
    startDate: "",
    pinnedToday: false,
    pinnedWeek: false,
    taskType: "task" as "task" | "milestone",
    milestoneId: "",
    isRecurring: false,
    recurrenceFrequency: "weekly",
    recurrenceInterval: 1,
    recurrenceDaysOfWeek: "",
    recurrenceEndDate: "",
  });

  const [dodRequired, setDodRequired] = useState(false);

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title || "",
        status: task.status,
        priority: task.priority,
        nextStep: task.nextStep || "",
        definitionOfDone: task.definitionOfDone || "",
        completionNote: task.completionNote || "",
        notes: task.notes || "",
        bucket: (task as any).bucket || "personal",
        projectName: task.projectName || "",
        department: task.department || "",
        blockedReason: task.blockedReason || "",
        plannedForDate: task.plannedForDate || "",
        dueAt: task.dueAt ? task.dueAt.slice(0, 10) : "",
        startDate: (task as any).startDate || "",
        pinnedToday: task.pinnedToday || false,
        pinnedWeek: task.pinnedWeek || false,
        taskType: ((task as any).taskType || "task") as "task" | "milestone",
        milestoneId: (task as any).milestoneId ? String((task as any).milestoneId) : "",
        isRecurring: (task as any).isRecurring || false,
        recurrenceFrequency: (task as any).recurrenceFrequency || "weekly",
        recurrenceInterval: Number((task as any).recurrenceInterval || 1),
        recurrenceDaysOfWeek: (task as any).recurrenceDaysOfWeek || "",
        recurrenceEndDate: (task as any).recurrenceEndDate || "",
      });
      setDodRequired(false);
    }
  }, [task]);

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({ project_name: p.project_name })),
    enabled: open,
  });

  const { data: milestones = [] } = useQuery<any[]>({
    queryKey: ["/api/mytool/tasks", "milestones"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/mytool/tasks");
      return (await res.json()).filter((t: any) => (t.taskType || "task") === "milestone");
    },
    enabled: open,
  });

  const { data: dodTemplates = [] } = useQuery<Array<{ id: number; name: string; content: string; department: string | null }>>({
    queryKey: ["/api/mytool/dod-templates"],
    enabled: open,
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ predicate: (q) => {
      const key = String(q.queryKey[0] || "");
      return key.includes("/api/mytool/");
    }});
    onInvalidate?.();
  }, [onInvalidate]);

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (!task) return;
      const res = await apiRequest("PATCH", `/api/mytool/tasks/${task.id}`, data);
      return res;
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Task updated" });
    },
    onError: (error: any) => {
      const msg = error?.message || "";
      if (msg.includes("Definition of Done")) {
        setDodRequired(true);
        toast({ title: "Can't close yet", description: "Add a Definition of Done to close this task 100%.", variant: "destructive" });
      } else {
        toast({ title: "Save failed", description: msg || "Please try again.", variant: "destructive" });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!task) return;
      await apiRequest("DELETE", `/api/mytool/tasks/${task.id}`);
    },
    onSuccess: () => {
      invalidateAll();
      onOpenChange(false);
      toast({ title: "Task deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!task) return;
    const updates: Record<string, unknown> = {};

    if (form.title !== task.title) updates.title = form.title;
    if (form.status !== task.status) updates.status = form.status;
    if (form.priority !== task.priority) updates.priority = form.priority;
    if (form.nextStep !== (task.nextStep || "")) updates.nextStep = form.nextStep || null;
    if (form.definitionOfDone !== (task.definitionOfDone || "")) updates.definitionOfDone = form.definitionOfDone || null;
    if (form.completionNote !== (task.completionNote || "")) updates.completionNote = form.completionNote || null;
    if (form.notes !== (task.notes || "")) updates.notes = form.notes || null;
    if (form.bucket !== ((task as any).bucket || "personal")) updates.bucket = form.bucket;
    if (form.bucket !== "project") updates.projectName = null;
    else if (form.projectName !== (task.projectName || "")) updates.projectName = form.projectName || null;
    if (form.department !== (task.department || "")) updates.department = form.department || null;
    if (form.blockedReason !== (task.blockedReason || "")) updates.blockedReason = form.blockedReason || null;
    if (form.plannedForDate !== (task.plannedForDate || "")) updates.plannedForDate = form.plannedForDate || null;
    if (form.pinnedToday !== task.pinnedToday) updates.pinnedToday = form.pinnedToday;
    if (form.pinnedWeek !== task.pinnedWeek) updates.pinnedWeek = form.pinnedWeek;
    if (form.taskType !== ((task as any).taskType || "task")) updates.taskType = form.taskType;
    if (form.isRecurring !== ((task as any).isRecurring || false)) updates.isRecurring = form.isRecurring;
    if (form.recurrenceFrequency !== ((task as any).recurrenceFrequency || "weekly")) updates.recurrenceFrequency = form.recurrenceFrequency;
    if (form.recurrenceInterval !== Number((task as any).recurrenceInterval || 1)) updates.recurrenceInterval = form.recurrenceInterval;
    if (form.recurrenceDaysOfWeek !== ((task as any).recurrenceDaysOfWeek || "")) updates.recurrenceDaysOfWeek = form.recurrenceDaysOfWeek || null;
    if (form.recurrenceEndDate !== ((task as any).recurrenceEndDate || "")) updates.recurrenceEndDate = form.recurrenceEndDate || null;

    if (form.dueAt !== (task.dueAt ? task.dueAt.slice(0, 10) : "")) {
      updates.dueAt = form.dueAt ? new Date(form.dueAt).toISOString() : null;
    }

    if (Object.keys(updates).length === 0) {
      toast({ title: "No changes to save" });
      return;
    }

    updateMutation.mutate(updates);
  };

  const handleStatusChange = (newStatus: TaskStatus) => {
    if (newStatus === "done" && !form.definitionOfDone.trim()) {
      setDodRequired(true);
      toast({ title: "Can't close yet", description: "Add a Definition of Done first.", variant: "destructive" });
      return;
    }
    setForm((f) => ({ ...f, status: newStatus }));
    if (task) {
      const updates: Record<string, unknown> = { status: newStatus };
      if (newStatus === "done") {
        updates.definitionOfDone = form.definitionOfDone;
        updates.completionNote = form.completionNote || null;
      }
      updateMutation.mutate(updates);
    }
  };

  const handleApplyDodTemplate = (content: string) => {
    setForm((f) => ({ ...f, definitionOfDone: content }));
    setDodRequired(false);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, form]);

  if (!task) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0" side="right" data-testid="task-detail-drawer">
        <div className="p-6 space-y-5">
          <SheetHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base font-semibold text-foreground sr-only">Task Details</SheetTitle>
              <div className="flex items-center gap-1">
                {STATUS_OPTIONS.filter(s => ["planned", "in_progress", "done"].includes(s.value)).map((s) => (
                  <Button
                    key={s.value}
                    variant={form.status === s.value ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleStatusChange(s.value)}
                    data-testid={`button-status-${s.value}`}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="text-lg font-medium border-0 px-0 shadow-none focus-visible:ring-0 h-auto"
              placeholder="Task title..."
              data-testid="input-task-title"
            />
          </SheetHeader>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Priority</Label>
              <SearchableSelect
                value={form.priority}
                onValueChange={(v) => setForm((f) => ({ ...f, priority: v as TaskPriority }))}
                triggerClassName="h-8 text-sm"
                data-testid="select-priority"
                options={PRIORITY_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
              <SearchableSelect
                value={form.status}
                onValueChange={(v) => handleStatusChange(v as TaskStatus)}
                triggerClassName="h-8 text-sm"
                data-testid="select-status"
                options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />Due Date
              </Label>
              <Input
                type="date"
                value={form.dueAt}
                onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))}
                className="h-8 text-sm"
                data-testid="input-due-date"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />Planned For
              </Label>
              <Input
                type="date"
                value={form.plannedForDate}
                onChange={(e) => setForm((f) => ({ ...f, plannedForDate: e.target.value }))}
                className="h-8 text-sm"
                data-testid="input-planned-date"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                <FolderOpen className="h-3 w-3 inline mr-1" />Bucket
              </Label>
              <SearchableSelect
                value={form.bucket}
                onValueChange={(v) => setForm((f) => ({ ...f, bucket: v, projectName: v !== "project" ? "" : f.projectName }))}
                placeholder="Select bucket"
                triggerClassName="h-8 text-sm"
                data-testid="select-bucket"
                options={[
                  { value: "project", label: "Project" },
                  { value: "company_ops", label: "Company Ops" },
                  { value: "personal", label: "Personal" },
                ]}
              />
            </div>
            {form.bucket === "project" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  <FolderOpen className="h-3 w-3 inline mr-1" />Project
                </Label>
                <SearchableSelect
                  value={form.projectName || "__none__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, projectName: v === "__none__" ? "" : v }))}
                  placeholder="None"
                  triggerClassName="h-8 text-sm"
                  data-testid="select-project"
                  options={[
                    { value: "__none__", label: "None" },
                    ...allProjects.map((p) => ({
                      value: p.project_name,
                      label: p.project_name.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
                    })),
                  ]}
                />
              </div>
            )}
            {form.bucket !== "project" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  <Building2 className="h-3 w-3 inline mr-1" />Department
                </Label>
                <SearchableSelect
                  value={form.department || "__none__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, department: v === "__none__" ? "" : v }))}
                  placeholder="None"
                  triggerClassName="h-8 text-sm"
                  data-testid="select-department"
                  options={[
                    { value: "__none__", label: "None" },
                    ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
                  ]}
                />
              </div>
            )}
          </div>


          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Type</Label>
              <SearchableSelect
                value={form.taskType}
                onValueChange={(v) => setForm((f) => ({ ...f, taskType: v as "task" | "milestone" }))}
                triggerClassName="h-8 text-sm"
                options={[{ value: "task", label: "Task" }, { value: "milestone", label: "Milestone" }]}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Milestone Link</Label>
              <SearchableSelect
                value={form.milestoneId || "__none__"}
                onValueChange={(v) => setForm((f) => ({ ...f, milestoneId: v === "__none__" ? "" : v }))}
                triggerClassName="h-8 text-sm"
                options={[{ value: "__none__", label: "None" }, ...milestones.filter((m: any) => m.id !== task.id).map((m: any) => ({ value: String(m.id), label: m.title }))]}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Dependency Blockers</Label>
            <p className="text-xs text-muted-foreground" data-testid="text-dependency-blockers">
              {(task as any).blockedByCount ? `${(task as any).blockedByCount} predecessor(s) incomplete` : "No active blockers"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={form.isRecurring} onChange={(e) => setForm((f) => ({ ...f, isRecurring: e.target.checked }))} className="rounded border-border" />
              Recurring
            </label>
            {form.isRecurring && (
              <SearchableSelect
                value={form.recurrenceFrequency}
                onValueChange={(v) => setForm((f) => ({ ...f, recurrenceFrequency: v }))}
                triggerClassName="h-8 text-sm"
                options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]}
              />
            )}
          </div>

          {form.isRecurring && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Interval</Label>
                <Input type="number" min={1} value={String(form.recurrenceInterval)} onChange={(e) => setForm((f) => ({ ...f, recurrenceInterval: Number(e.target.value || 1) }))} className="h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-1 block">Weekly Days (0-6)</Label>
                <Input value={form.recurrenceDaysOfWeek} onChange={(e) => setForm((f) => ({ ...f, recurrenceDaysOfWeek: e.target.value }))} placeholder="1,3,5" className="h-8 text-sm" />
              </div>
            </div>
          )}

          <Separator />

          <div>
            <Label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Zap className="h-3 w-3" /> Next Step
              <span className="text-[10px] text-muted-foreground/60 ml-1">(required before In Progress)</span>
            </Label>
            <Input
              value={form.nextStep}
              onChange={(e) => setForm((f) => ({ ...f, nextStep: e.target.value }))}
              placeholder="What's the single next action?"
              className="text-sm h-8"
              data-testid="input-next-step"
            />
          </div>

          <div className={dodRequired ? "ring-2 ring-red-400 rounded-lg p-2 -m-2" : ""}>
            <Label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Target className="h-3 w-3" /> Definition of Done
              <span className="text-[10px] text-muted-foreground/60 ml-1">(required to close)</span>
            </Label>
            <Textarea
              value={form.definitionOfDone}
              onChange={(e) => { setForm((f) => ({ ...f, definitionOfDone: e.target.value })); setDodRequired(false); }}
              placeholder="What does 'done done' look like?"
              className="text-sm min-h-[60px]"
              data-testid="textarea-dod"
            />
            {dodRequired && (
              <p className="text-xs text-red-500 mt-1" data-testid="text-dod-required">
                Add a Definition of Done to close this task 100%.
              </p>
            )}
            {dodTemplates.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {dodTemplates.map((t) => (
                  <Button
                    key={t.id}
                    variant="outline" size="sm"
                    className="h-6 text-[10px]"
                    onClick={() => handleApplyDodTemplate(t.content)}
                    data-testid={`button-dod-template-${t.id}`}
                  >
                    {t.name}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {form.status === "done" && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Completion Note</Label>
              <Textarea
                value={form.completionNote}
                onChange={(e) => setForm((f) => ({ ...f, completionNote: e.target.value }))}
                placeholder="How was this resolved?"
                className="text-sm min-h-[40px]"
                data-testid="textarea-completion-note"
              />
            </div>
          )}

          {(form.status === "blocked" || form.status === "waiting") && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                <AlertCircle className="h-3 w-3 inline mr-1" />Blocked Reason
              </Label>
              <Input
                value={form.blockedReason}
                onChange={(e) => setForm((f) => ({ ...f, blockedReason: e.target.value }))}
                placeholder="What's blocking this?"
                className="text-sm h-8"
                data-testid="input-blocked-reason"
              />
            </div>
          )}

          <Separator />

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">
              <FileText className="h-3 w-3 inline mr-1" />Notes
            </Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Additional context, links..."
              className="text-sm min-h-[80px]"
              data-testid="textarea-notes"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form.pinnedToday}
                onChange={(e) => setForm((f) => ({ ...f, pinnedToday: e.target.checked }))}
                className="rounded border-border"
                data-testid="checkbox-pinned-today"
              />
              Pin to Today
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form.pinnedWeek}
                onChange={(e) => setForm((f) => ({ ...f, pinnedWeek: e.target.checked }))}
                className="rounded border-border"
                data-testid="checkbox-pinned-week"
              />
              Pin to Week
            </label>
          </div>

          <Separator />

          <div className="flex items-center justify-between pt-2">
            <Button
              variant="destructive" size="sm"
              className="h-8 text-xs"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-task"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                className="h-8 text-xs"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={handleSave}
                disabled={updateMutation.isPending || !form.title.trim()}
                data-testid="button-save-task"
              >
                {updateMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                Save (⌘⏎)
              </Button>
            </div>
          </div>

          {task.createdAt && (
            <p className="text-[10px] text-muted-foreground text-right">
              Created {new Date(task.createdAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

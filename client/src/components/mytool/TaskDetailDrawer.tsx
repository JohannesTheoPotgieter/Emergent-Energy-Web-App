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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    projectName: "",
    department: "",
    blockedReason: "",
    plannedForDate: "",
    dueAt: "",
    startDate: "",
    pinnedToday: false,
    pinnedWeek: false,
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
        projectName: task.projectName || "",
        department: task.department || "",
        blockedReason: task.blockedReason || "",
        plannedForDate: task.plannedForDate || "",
        dueAt: task.dueAt ? task.dueAt.slice(0, 10) : "",
        startDate: (task as any).startDate || "",
        pinnedToday: task.pinnedToday || false,
        pinnedWeek: task.pinnedWeek || false,
      });
      setDodRequired(false);
    }
  }, [task]);

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({ project_name: p.project_name })),
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
    if (form.projectName !== (task.projectName || "")) updates.projectName = form.projectName || null;
    if (form.department !== (task.department || "")) updates.department = form.department || null;
    if (form.blockedReason !== (task.blockedReason || "")) updates.blockedReason = form.blockedReason || null;
    if (form.plannedForDate !== (task.plannedForDate || "")) updates.plannedForDate = form.plannedForDate || null;
    if (form.pinnedToday !== task.pinnedToday) updates.pinnedToday = form.pinnedToday;
    if (form.pinnedWeek !== task.pinnedWeek) updates.pinnedWeek = form.pinnedWeek;

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
              <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v as TaskPriority }))}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
              <Select value={form.status} onValueChange={(v) => handleStatusChange(v as TaskStatus)}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <FolderOpen className="h-3 w-3 inline mr-1" />Project
              </Label>
              <Select value={form.projectName || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, projectName: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-project">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {allProjects.map((p) => (
                    <SelectItem key={p.project_name} value={p.project_name}>
                      {p.project_name.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                <Building2 className="h-3 w-3 inline mr-1" />Department
              </Label>
              <Select value={form.department || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, department: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-department">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

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

import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { format, addDays, parse } from "date-fns";
import MyToolLayout from "@/components/mytool/MyToolLayout";
import TaskCard, { TaskItem, TaskStatus, PriorityBadge, PriorityDot } from "@/components/mytool/TaskCard";
import TaskDetailDrawer from "@/components/mytool/TaskDetailDrawer";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Play,
  CheckCircle2,
  Ban,
  Clock,
  Target,
  Inbox,
  Loader2,
  AlertCircle,
  X,
  Flag,
  Mail,
  Zap,
  Search,
  ExternalLink,
  Trash2,
  Calendar,
} from "lucide-react";

type Horizon = "today" | "week" | "month" | "quarter";
type PriorityStatus = "active" | "monitoring" | "closed";

interface OutlookEmail {
  id: string;
  subject: string;
  sender: string | null;
  senderEmail: string | null;
  receivedAt: string;
  snippet: string | null;
  webLink: string | null;
  isRead: boolean;
  hasAttachments: boolean;
}

interface CompanyPriority {
  id: number;
  title: string;
  severity: "critical" | "important" | "normal";
  horizon: Horizon;
  department: string | null;
  linkedProjectName: string | null;
  status: PriorityStatus;
}

interface TimeBlock {
  id: number;
  startTime: string;
  endTime: string;
  label: string;
  taskId: number | null;
}

const DEPARTMENTS = [
  "Engineering", "Finance", "Operations", "Sales",
  "Procurement", "Legal", "HR", "Executive",
  "Project Delivery", "O&M",
] as const;

const today = format(new Date(), "yyyy-MM-dd");

function parseQuickAdd(text: string): { title: string; priority?: string; project?: string; department?: string; dueAt?: string; plannedForDate?: string } {
  let title = text;
  let priority: string | undefined;
  let project: string | undefined;
  let department: string | undefined;
  let dueAt: string | undefined;
  let plannedForDate = today;

  const p1Match = title.match(/\bp1\b/i);
  const p2Match = title.match(/\bp2\b/i);
  const p3Match = title.match(/\bp3\b/i);
  if (p1Match) { priority = "critical"; title = title.replace(p1Match[0], "").trim(); }
  else if (p2Match) { priority = "high"; title = title.replace(p2Match[0], "").trim(); }
  else if (p3Match) { priority = "normal"; title = title.replace(p3Match[0], "").trim(); }

  const hashMatch = title.match(/#(\w+)/);
  if (hashMatch) {
    const dept = DEPARTMENTS.find(d => d.toLowerCase().startsWith(hashMatch[1].toLowerCase()));
    if (dept) { department = dept; title = title.replace(hashMatch[0], "").trim(); }
  }

  const tomorrowMatch = title.match(/\btomorrow\b/i);
  if (tomorrowMatch) {
    plannedForDate = format(addDays(new Date(), 1), "yyyy-MM-dd");
    title = title.replace(tomorrowMatch[0], "").trim();
  }

  const dueFriMatch = title.match(/\bdue\s+(mon|tue|wed|thu|fri|sat|sun)\w*/i);
  if (dueFriMatch) {
    title = title.replace(dueFriMatch[0], "").trim();
  }

  title = title.replace(/\s+/g, " ").trim();
  return { title, priority, project, department, dueAt, plannedForDate };
}

export default function MyToolTodayPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [quickAddText, setQuickAddText] = useState("");
  const [drawerTask, setDrawerTask] = useState<TaskItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [doneCollapsed, setDoneCollapsed] = useState(true);
  const [emailInboxOpen, setEmailInboxOpen] = useState(true);
  const [emailInboxSearch, setEmailInboxSearch] = useState("");
  const [debouncedInboxSearch, setDebouncedInboxSearch] = useState("");
  const [planDropOver, setPlanDropOver] = useState(false);
  const [blockDropOver, setBlockDropOver] = useState(false);
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockLabel, setBlockLabel] = useState("");
  const [prioritiesOpen, setPrioritiesOpen] = useState(true);
  const [horizon, setHorizon] = useState<Horizon>("week");
  const [addPriorityOpen, setAddPriorityOpen] = useState(false);
  const [newPriority, setNewPriority] = useState({ title: "", department: "", severity: "normal" as string, linkedProjectName: "" });
  const [dodPromptTask, setDodPromptTask] = useState<TaskItem | null>(null);
  const [dodPromptText, setDodPromptText] = useState("");

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<TaskItem[]>({
    queryKey: [`/api/mytool/tasks?date=${today}`],
    select: (data: any[]) => data.map((t: any) => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority,
      plannedForDate: t.plannedForDate || t.planned_for_date || null,
      dueAt: t.dueAt || t.due_at || null,
      sortOrder: t.sortOrder || t.sort_order || 0,
      projectName: t.projectName || t.project_name || null,
      department: t.department || null,
      tag: t.tag || null,
      blockedReason: t.blockedReason || t.blocked_reason || null,
      nextStep: t.nextStep || t.next_step || null,
      definitionOfDone: t.definitionOfDone || t.definition_of_done || null,
      completionNote: t.completionNote || t.completion_note || null,
      pinnedToday: t.pinnedToday || t.pinned_today || false,
      pinnedWeek: t.pinnedWeek || t.pinned_week || false,
      isRecurring: t.isRecurring || t.is_recurring || false,
      recurrenceFrequency: t.recurrenceFrequency || t.recurrence_frequency || null,
      notes: t.notes || null,
      createdAt: t.createdAt || t.created_at || null,
    })),
  });

  const { data: timeblocks = [] } = useQuery<TimeBlock[]>({
    queryKey: [`/api/mytool/timeblocks?date=${today}`],
  });

  const { data: priorities = [] } = useQuery<CompanyPriority[]>({
    queryKey: [`/api/mytool/company-priorities?horizon=${horizon}`],
  });

  const { data: escalatedItems = [] } = useQuery<Array<{
    id: string; type: string; title: string; projectName: string;
    escalationLevel: string; status: string | null; priority: string | null;
  }>>({
    queryKey: ["/api/mytool/escalated-priorities"],
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInboxSearch(emailInboxSearch), 400);
    return () => clearTimeout(timer);
  }, [emailInboxSearch]);

  const { data: inboxEmails = [], isLoading: inboxEmailsLoading } = useQuery<OutlookEmail[]>({
    queryKey: ["/api/outlook/messages", "inbox-panel", debouncedInboxSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ top: "15" });
      if (debouncedInboxSearch.trim()) params.set("search", debouncedInboxSearch.trim());
      const res = await fetch(`/api/outlook/messages?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.value || [];
    },
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/tasks?date=${today}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/timeblocks?date=${today}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/company-priorities?horizon=${horizon}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
  }, [horizon]);

  const errHandler = {
    onError: (error: Error) => {
      toast({ title: "Couldn't save", description: error.message || "Please try again.", variant: "destructive" });
    },
  };

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => apiRequest("POST", "/api/mytool/tasks", body),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => apiRequest("PATCH", `/api/mytool/tasks/${id}`, body),
    onSuccess: () => invalidateAll(),
    onError: (error: any) => {
      const msg = error?.message || "";
      if (msg.includes("Definition of Done")) {
        toast({ title: "Can't close yet", description: "Add a Definition of Done first.", variant: "destructive" });
      } else {
        toast({ title: "Couldn't save", description: msg, variant: "destructive" });
      }
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/mytool/tasks/${id}`),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const createBlockMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => apiRequest("POST", "/api/mytool/timeblocks", body),
    onSuccess: () => { invalidateAll(); setAddBlockOpen(false); setBlockStart(""); setBlockEnd(""); setBlockLabel(""); },
    ...errHandler,
  });

  const deleteBlockMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/mytool/timeblocks/${id}`),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const createPriorityMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => apiRequest("POST", "/api/mytool/company-priorities", body),
    onSuccess: () => { invalidateAll(); setAddPriorityOpen(false); setNewPriority({ title: "", department: "", severity: "normal", linkedProjectName: "" }); },
    ...errHandler,
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & Record<string, unknown>) => apiRequest("PATCH", `/api/mytool/company-priorities/${id}`, body),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const deletePriorityMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/mytool/company-priorities/${id}`),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({ project_name: p.project_name })),
  });

  const handleQuickAdd = useCallback((text?: string) => {
    const raw = text || quickAddText.trim();
    if (!raw) return;
    const parsed = parseQuickAdd(raw);
    createTaskMutation.mutate({
      title: parsed.title,
      status: "planned",
      plannedForDate: parsed.plannedForDate || today,
      priority: parsed.priority || "normal",
      department: parsed.department || null,
    });
    setQuickAddText("");
  }, [quickAddText]);

  const handleStatusChange = (taskId: number, newStatus: TaskStatus) => {
    updateTaskMutation.mutate({ id: taskId, status: newStatus });
  };

  const handleQuickDone = (task: TaskItem) => {
    if (!task.definitionOfDone?.trim()) {
      setDodPromptTask(task);
      setDodPromptText("");
      return;
    }
    updateTaskMutation.mutate({ id: task.id, status: "done" });
  };

  const handleDodPromptSave = () => {
    if (!dodPromptTask || !dodPromptText.trim()) return;
    updateTaskMutation.mutate({
      id: dodPromptTask.id,
      status: "done",
      definitionOfDone: dodPromptText.trim(),
    });
    setDodPromptTask(null);
    setDodPromptText("");
  };

  const handleDropEmail = async (email: OutlookEmail) => {
    try {
      await apiRequest("POST", "/api/mytool/tasks", {
        title: email.subject || "(No subject)",
        status: "planned",
        plannedForDate: today,
        priority: "normal",
        notes: `Email from: ${email.sender || email.senderEmail || "unknown"}\n\n${email.snippet || ""}`,
      });
      await apiRequest("POST", "/api/outlook/email-to-task", {
        outlookMessageId: email.id,
        subject: email.subject,
        sender: email.sender || email.senderEmail || "",
        receivedAt: email.receivedAt,
        snippet: email.snippet?.slice(0, 200) || "",
        webLink: email.webLink || "",
        targetType: "new",
      });
      invalidateAll();
      toast({ title: "Task created from email" });
    } catch {
      toast({ title: "Failed to create task from email", variant: "destructive" });
    }
  };

  const handleDropEmailToBlock = async (email: OutlookEmail) => {
    await handleDropEmail(email);
    setAddBlockOpen(true);
    setBlockLabel(email.subject || "(No subject)");
  };

  const pinnedTasks = tasks.filter(t => t.pinnedToday && t.status !== "done" && t.status !== "cancelled");
  const inProgressTasks = tasks.filter(t => t.status === "in_progress" && !t.pinnedToday);
  const plannedTasks = tasks.filter(t => t.status === "planned" && t.plannedForDate === today && !t.pinnedToday).sort((a, b) => a.sortOrder - b.sortOrder);
  const blockedWaitingTasks = tasks.filter(t => (t.status === "blocked" || t.status === "waiting") && !t.pinnedToday);
  const inboxTasks = tasks.filter(t => t.status === "inbox");
  const doneTasks = tasks.filter(t => t.status === "done");

  const activePriorities = priorities.filter(p => p.status !== "closed");

  if (tasksLoading) {
    return (
      <MyToolLayout onQuickAdd={handleQuickAdd}>
        <div className="space-y-4 max-w-3xl" data-testid="mytool-today-skeleton">
          <div className="flex gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-5 w-20" />)}
          </div>
          <Skeleton className="h-10 w-full" />
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      </MyToolLayout>
    );
  }

  return (
    <MyToolLayout onQuickAdd={handleQuickAdd}>
      <div className="max-w-3xl space-y-6" data-testid="mytool-today-page">
        {/* Stats strip */}
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="stats-strip">
          {[
            { label: "Pinned", count: pinnedTasks.length, color: "bg-violet-500" },
            { label: "In Progress", count: inProgressTasks.length, color: "bg-amber-500" },
            { label: "Planned", count: plannedTasks.length, color: "bg-blue-500" },
            { label: "Blocked", count: blockedWaitingTasks.length, color: "bg-red-500" },
            { label: "Done", count: doneTasks.length, color: "bg-emerald-500" },
          ].map((s, i) => (
            <div key={s.label} className="flex items-center gap-1.5">
              {i > 0 && <span className="w-px h-3.5 bg-border" />}
              <span className={`w-1.5 h-1.5 rounded-full ${s.color}`} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-semibold text-foreground">{s.count}</span>
            </div>
          ))}
        </div>

        {/* Quick Add (mobile) */}
        <div className="sm:hidden">
          <div className="flex gap-2" data-testid="quick-add-mobile">
            <Input
              placeholder="Quick add task... (Enter)"
              value={quickAddText}
              onChange={(e) => setQuickAddText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
              className="h-9 text-sm"
              data-testid="input-quick-add"
            />
            <Button onClick={() => handleQuickAdd()} disabled={!quickAddText.trim()} className="h-9 px-3" data-testid="button-quick-add">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* LEFT: Main task flow */}
          <div className="lg:col-span-3 space-y-5">
            {/* Pinned Today (Top 3) */}
            {pinnedTasks.length > 0 && (
              <section data-testid="section-pinned">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-violet-600" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today's Top</h3>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{pinnedTasks.length}</Badge>
                  {pinnedTasks.length > 3 && <span className="text-[10px] text-amber-500">Consider limiting to 3</span>}
                </div>
                <div className="space-y-1.5">
                  {pinnedTasks.map(task => (
                    <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} onOpenDrawer={(t) => { setDrawerTask(t); setDrawerOpen(true); }} onQuickDone={handleQuickDone} showNextStep data-testid={`pinned-task-${task.id}`} />
                  ))}
                </div>
              </section>
            )}

            {/* In Progress */}
            {inProgressTasks.length > 0 && (
              <section data-testid="section-in-progress">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">In Progress</h3>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{inProgressTasks.length}</Badge>
                </div>
                <div className="space-y-1.5">
                  {inProgressTasks.map(task => (
                    <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} onOpenDrawer={(t) => { setDrawerTask(t); setDrawerOpen(true); }} onQuickDone={handleQuickDone} showNextStep />
                  ))}
                </div>
              </section>
            )}

            {/* Blocked */}
            {blockedWaitingTasks.length > 0 && (
              <section data-testid="section-blocked">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Blocked / Waiting</h3>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{blockedWaitingTasks.length}</Badge>
                </div>
                <div className="space-y-1.5">
                  {blockedWaitingTasks.map(task => (
                    <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} onOpenDrawer={(t) => { setDrawerTask(t); setDrawerOpen(true); }} onQuickDone={handleQuickDone} />
                  ))}
                </div>
              </section>
            )}

            {/* Today's Plan */}
            <section
              data-testid="section-planned"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setPlanDropOver(true); }}
              onDragLeave={() => setPlanDropOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setPlanDropOver(false);
                try {
                  const emailData = JSON.parse(e.dataTransfer.getData("application/json"));
                  if (emailData?.id && emailData?.subject !== undefined) handleDropEmail(emailData);
                } catch {}
              }}
              className={planDropOver ? "ring-2 ring-primary/40 bg-primary/5 rounded-lg p-2 -m-2 transition-all" : "transition-all"}
            >
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today's Plan</h3>
                <Badge variant="secondary" className="text-[10px] h-4 px-1">{plannedTasks.length}</Badge>
                {planDropOver && <span className="text-[10px] text-primary ml-auto">Drop email to create task</span>}
              </div>
              {plannedTasks.length === 0 ? (
                <div className="border border-dashed border-border rounded-lg py-8 text-center" data-testid="empty-planned">
                  <Target className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No tasks planned for today.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Use Quick Add (⌘K) or drag emails here.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {plannedTasks.map(task => (
                    <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} onOpenDrawer={(t) => { setDrawerTask(t); setDrawerOpen(true); }} onQuickDone={handleQuickDone} />
                  ))}
                </div>
              )}
            </section>

            {/* Inbox */}
            {inboxTasks.length > 0 && (
              <section data-testid="section-inbox">
                <div className="flex items-center gap-2 mb-2">
                  <Inbox className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inbox</h3>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{inboxTasks.length}</Badge>
                </div>
                <div className="space-y-1.5">
                  {inboxTasks.map(task => (
                    <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} onOpenDrawer={(t) => { setDrawerTask(t); setDrawerOpen(true); }} onQuickDone={handleQuickDone} />
                  ))}
                </div>
              </section>
            )}

            {/* Done */}
            {doneTasks.length > 0 && (
              <section data-testid="section-done">
                <button className="flex items-center gap-2 mb-2" onClick={() => setDoneCollapsed(!doneCollapsed)} data-testid="toggle-done-lane">
                  {doneCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Done</h3>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{doneTasks.length}</Badge>
                </button>
                {!doneCollapsed && (
                  <div className="space-y-1.5">
                    {doneTasks.map(task => (
                      <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} onOpenDrawer={(t) => { setDrawerTask(t); setDrawerOpen(true); }} onQuickDone={handleQuickDone} />
                    ))}
                  </div>
                )}
              </section>
            )}

          </div>

          {/* RIGHT: Context column */}
          <div className="lg:col-span-2 space-y-5">
            {/* Time Blocks */}
            <section
              className={`border border-border/50 rounded-lg transition-all ${blockDropOver ? "ring-2 ring-primary/40 bg-primary/5" : ""}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setBlockDropOver(true); }}
              onDragLeave={() => setBlockDropOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setBlockDropOver(false);
                try {
                  const emailData = JSON.parse(e.dataTransfer.getData("application/json"));
                  if (emailData?.id && emailData?.subject !== undefined) handleDropEmailToBlock(emailData);
                } catch {}
              }}
              data-testid="card-time-blocks"
            >
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-violet-600" />
                  <span className="text-sm font-medium">Time Blocks</span>
                  {blockDropOver && <span className="text-[10px] text-primary">Drop to create</span>}
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setAddBlockOpen(!addBlockOpen)} data-testid="button-add-block">
                  {addBlockOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="px-4 pb-4 space-y-1.5">
                {addBlockOpen && (
                  <div className="space-y-2 p-3 bg-muted/30 rounded-lg border border-border/50 mb-2" data-testid="form-add-block">
                    <div className="flex gap-2">
                      <Input type="time" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} className="text-xs h-8" data-testid="input-block-start" />
                      <Input type="time" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} className="text-xs h-8" data-testid="input-block-end" />
                    </div>
                    <Input value={blockLabel} onChange={(e) => setBlockLabel(e.target.value)} className="text-xs h-8" placeholder="What are you working on?" onKeyDown={(e) => e.key === "Enter" && blockStart && blockEnd && blockLabel.trim() && createBlockMutation.mutate({ date: today, startTime: blockStart, endTime: blockEnd, label: blockLabel.trim() })} data-testid="input-block-label" />
                    <Button size="sm" className="w-full h-7 text-xs" onClick={() => createBlockMutation.mutate({ date: today, startTime: blockStart, endTime: blockEnd, label: blockLabel.trim() })} disabled={!blockStart || !blockEnd || !blockLabel.trim()} data-testid="button-save-block">
                      Add Block
                    </Button>
                  </div>
                )}
                {timeblocks.length === 0 && !addBlockOpen ? (
                  <div className="text-center py-4" data-testid="empty-timeblocks">
                    <Clock className="h-6 w-6 text-muted-foreground/20 mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">No time blocks yet.</p>
                    <button onClick={() => setAddBlockOpen(true)} className="text-xs text-primary hover:underline mt-1" data-testid="link-add-first-block">Add your first block</button>
                  </div>
                ) : (
                  timeblocks.sort((a, b) => a.startTime.localeCompare(b.startTime)).map(block => (
                    <div key={block.id} className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-violet-50/30 dark:bg-violet-950/10 border border-violet-100/50 dark:border-violet-900/30 group" data-testid={`timeblock-${block.id}`}>
                      <span className="text-[11px] font-mono text-violet-600 dark:text-violet-400 shrink-0">{block.startTime}–{block.endTime}</span>
                      <span className="flex-1 text-xs text-foreground truncate">{block.label}</span>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={() => deleteBlockMutation.mutate(block.id)} data-testid={`button-delete-block-${block.id}`}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Email Inbox */}
            <section className="border border-border/50 rounded-lg" data-testid="card-email-inbox">
              <button className="flex items-center gap-2 px-4 py-3 w-full text-left" onClick={() => setEmailInboxOpen(!emailInboxOpen)} data-testid="toggle-email-inbox">
                {emailInboxOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                <Mail className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">Email Inbox</span>
              </button>
              {emailInboxOpen && (
                <div className="px-4 pb-4 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search emails..." value={emailInboxSearch} onChange={(e) => setEmailInboxSearch(e.target.value)} className="pl-8 text-xs h-8" data-testid="input-inbox-search" />
                  </div>
                  {inboxEmailsLoading ? (
                    <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                  ) : inboxEmails.length === 0 ? (
                    <div className="text-center py-4" data-testid="inbox-empty">
                      <Mail className="h-6 w-6 text-muted-foreground/20 mx-auto mb-1" />
                      <p className="text-xs text-muted-foreground">{emailInboxSearch ? "No emails found" : "No emails available."}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Connect Outlook in <Link href="/my-tool/settings" className="text-primary hover:underline">Settings</Link></p>
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-[350px] overflow-y-auto" data-testid="inbox-email-list">
                      {inboxEmails.map(email => (
                        <div
                          key={email.id}
                          draggable
                          onDragStart={(e) => { e.dataTransfer.setData("application/json", JSON.stringify(email)); e.dataTransfer.effectAllowed = "copy"; }}
                          className="px-2.5 py-2 rounded-md border border-border/50 hover:bg-muted/30 cursor-grab active:cursor-grabbing transition-colors group/email"
                          data-testid={`inbox-email-${email.id}`}
                        >
                          <div className="flex items-start gap-2">
                            <Mail className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">{email.subject || "(No subject)"}</p>
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <span className="truncate">{email.sender || email.senderEmail || "Unknown"}</span>
                                <span>·</span>
                                <span className="shrink-0">{email.receivedAt ? format(new Date(email.receivedAt), "d MMM") : ""}</span>
                              </div>
                            </div>
                            {email.webLink && (
                              <a href={email.webLink} target="_blank" rel="noopener noreferrer" className="text-primary opacity-0 group-hover/email:opacity-100 shrink-0" data-testid={`link-inbox-email-${email.id}`}>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <p className="text-[9px] text-primary/60 mt-0.5 select-none">↕ Drag to plan</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Company Priorities */}
            <section className="border border-border/50 rounded-lg" data-testid="card-company-priorities">
              <div className="flex items-center justify-between px-4 py-3">
                <button className="flex items-center gap-2" onClick={() => setPrioritiesOpen(!prioritiesOpen)} data-testid="toggle-company-priorities">
                  {prioritiesOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <Flag className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">Priorities</span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{activePriorities.length + escalatedItems.length}</Badge>
                </button>
                <div className="flex items-center gap-1">
                  <select value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)} className="text-[11px] border border-border rounded px-1.5 py-0.5 bg-background" data-testid="select-horizon">
                    <option value="today">Today</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                    <option value="quarter">Quarter</option>
                  </select>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setAddPriorityOpen(!addPriorityOpen)} data-testid="button-add-priority">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {prioritiesOpen && (
                <div className="px-4 pb-4 space-y-1.5">
                  {addPriorityOpen && (
                    <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2 mb-2" data-testid="add-priority-form">
                      <Input placeholder="Priority title..." value={newPriority.title} onChange={(e) => setNewPriority(p => ({ ...p, title: e.target.value }))} className="h-8 text-xs" data-testid="input-priority-title" onKeyDown={(e) => { if (e.key === "Enter" && newPriority.title.trim()) createPriorityMutation.mutate({ title: newPriority.title.trim(), department: newPriority.department || null, severity: newPriority.severity, horizon, linkedProjectName: newPriority.linkedProjectName || null, status: "active" }); }} />
                      <div className="flex gap-2">
                        <select value={newPriority.severity} onChange={(e) => setNewPriority(p => ({ ...p, severity: e.target.value }))} className="h-7 text-[11px] border border-border rounded px-1.5 bg-background flex-1" data-testid="select-priority-severity">
                          <option value="normal">Normal</option>
                          <option value="important">Important</option>
                          <option value="critical">Critical</option>
                        </select>
                        <select value={newPriority.department} onChange={(e) => setNewPriority(p => ({ ...p, department: e.target.value }))} className="h-7 text-[11px] border border-border rounded px-1.5 bg-background flex-1" data-testid="select-priority-department">
                          <option value="">Dept...</option>
                          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setAddPriorityOpen(false); setNewPriority({ title: "", department: "", severity: "normal", linkedProjectName: "" }); }}>Cancel</Button>
                        <Button size="sm" className="h-7 text-xs" onClick={() => createPriorityMutation.mutate({ title: newPriority.title.trim(), department: newPriority.department || null, severity: newPriority.severity, horizon, linkedProjectName: newPriority.linkedProjectName || null, status: "active" })} disabled={!newPriority.title.trim()} data-testid="button-save-priority">Add</Button>
                      </div>
                    </div>
                  )}

                  {escalatedItems.map(item => (
                    <div key={item.id} className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-destructive/5 border border-destructive/20" data-testid={`escalated-item-${item.id}`}>
                      <Flag className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{item.title}</p>
                        <span className="text-[10px] text-red-600 uppercase">{item.type}</span>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => setLocation(`/project/${encodeURIComponent(item.projectName)}`)}>
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}

                  {activePriorities.map(p => (
                    <div key={p.id} className="flex items-start gap-2 px-2.5 py-2 rounded-md border border-border/50 hover:bg-muted/30 transition-colors group" data-testid={`priority-item-${p.id}`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${p.severity === "critical" ? "bg-red-500" : p.severity === "important" ? "bg-amber-500" : "bg-blue-500"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{p.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <select value={p.status} onChange={(e) => updatePriorityMutation.mutate({ id: p.id, status: e.target.value })} className="text-[10px] uppercase tracking-wider px-1 py-0 rounded bg-transparent border-0 cursor-pointer text-muted-foreground" data-testid={`select-priority-status-${p.id}`}>
                            <option value="active">Active</option>
                            <option value="monitoring">Monitoring</option>
                            <option value="closed">Closed</option>
                          </select>
                          {p.department && <span className="text-[10px] text-indigo-600">{p.department}</span>}
                        </div>
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-primary" onClick={() => createTaskMutation.mutate({ title: p.title, status: "planned", plannedForDate: today, priority: p.severity === "critical" ? "critical" : p.severity === "important" ? "high" : "normal", projectName: p.linkedProjectName })} title="Create task" data-testid={`button-convert-task-${p.id}`}>
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => deletePriorityMutation.mutate(p.id)} data-testid={`button-delete-priority-${p.id}`}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {activePriorities.length === 0 && escalatedItems.length === 0 && !addPriorityOpen && (
                    <p className="text-xs text-muted-foreground text-center py-3" data-testid="empty-priorities">No priorities set.</p>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* DoD Prompt Modal */}
      {dodPromptTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="dod-prompt-overlay">
          <div className="bg-background rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 space-y-4" data-testid="dod-prompt-modal">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Can't close yet</h3>
              <p className="text-xs text-muted-foreground">Add a Definition of Done to close "{dodPromptTask.title}" 100%.</p>
            </div>
            <Textarea
              value={dodPromptText}
              onChange={(e) => setDodPromptText(e.target.value)}
              placeholder="What does 'done done' look like?"
              className="text-sm min-h-[60px]"
              autoFocus
              data-testid="textarea-dod-prompt"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setDodPromptTask(null); setDodPromptText(""); }}>Cancel</Button>
              <Button size="sm" onClick={handleDodPromptSave} disabled={!dodPromptText.trim() || updateTaskMutation.isPending} data-testid="button-dod-prompt-save">
                {updateTaskMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Mark Done
              </Button>
            </div>
          </div>
        </div>
      )}

      <TaskDetailDrawer
        task={drawerTask}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onInvalidate={invalidateAll}
      />
    </MyToolLayout>
  );
}

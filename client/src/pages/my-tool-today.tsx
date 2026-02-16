import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import MyToolNav from "@/components/my-tool-nav";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Play,
  CheckCircle2,
  Ban,
  GripVertical,
  Clock,
  Target,
  Inbox,
  Loader2,
  ArrowRight,
  ExternalLink,
  Unlock,
  Save,
  AlertCircle,
  Filter,
  X,
  Flag,
  Mail,
  Trash2,
  Paperclip,
  Zap,
  Moon,
  Repeat,
  Search,
} from "lucide-react";

type Priority = "critical" | "important" | "normal" | "low";
type TaskStatus = "inbox" | "planned" | "in_progress" | "blocked" | "waiting" | "done" | "cancelled";
type Horizon = "today" | "week" | "month" | "quarter";

interface MyToolTask {
  id: number;
  title: string;
  status: TaskStatus;
  priority: Priority;
  plannedForDate: string | null;
  sortOrder: number;
  projectName: string | null;
  tag: string | null;
  blockedReason: string | null;
  companyPriorityId: number | null;
  dueAt: string | null;
  isRecurring?: boolean;
  recurrenceFrequency?: string | null;
  notes?: string | null;
}

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

interface EmailLink {
  id: number;
  outlookMessageId: string;
  subject: string;
  sender: string;
  receivedAt: string;
  snippet: string;
  webLink: string;
}

interface TimeBlock {
  id: number;
  startTime: string;
  endTime: string;
  label: string;
  taskId: number | null;
}

type PriorityStatus = "active" | "monitoring" | "closed";

interface CompanyPriority {
  id: number;
  title: string;
  severity: "critical" | "important" | "normal";
  horizon: Horizon;
  department: string | null;
  linkedProjectName: string | null;
  status: PriorityStatus;
}

const DEPARTMENTS = [
  "Engineering",
  "Finance",
  "Operations",
  "Sales",
  "Procurement",
  "Legal",
  "HR",
  "Executive",
  "Project Delivery",
  "O&M",
] as const;

interface DailyReview {
  id: number;
  date: string;
  wentWell: string;
  movedForward: string;
  blocked: string;
  notes: string;
}

const today = format(new Date(), "yyyy-MM-dd");

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  important: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  normal: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  low: { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
};

const statusConfig: Record<string, { color: string; icon: typeof Play }> = {
  inbox: { color: "bg-gray-100 text-gray-700", icon: Inbox },
  planned: { color: "bg-blue-100 text-blue-700", icon: Target },
  in_progress: { color: "bg-amber-100 text-amber-700", icon: Play },
  blocked: { color: "bg-red-100 text-red-700", icon: Ban },
  waiting: { color: "bg-orange-100 text-orange-700", icon: Clock },
  done: { color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  cancelled: { color: "bg-gray-200 text-gray-500", icon: X },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = severityColors[severity] || severityColors.normal;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border} border`}
      data-testid={`badge-severity-${severity}`}
    >
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || statusConfig.inbox;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${cfg.color}`}
      data-testid={`badge-status-${status}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function PriorityDot({ priority }: { priority: Priority }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500",
    important: "bg-amber-500",
    normal: "bg-blue-500",
    low: "bg-gray-400",
  };
  return <div className={`w-2 h-2 rounded-full ${colors[priority] || colors.normal} shrink-0`} />;
}

export default function MyToolTodayPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [prioritiesOpen, setPrioritiesOpen] = useState(true);
  const [horizon, setHorizon] = useState<Horizon>("week");
  const [quickAddText, setQuickAddText] = useState("");
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockLabel, setBlockLabel] = useState("");
  const [doneCollapsed, setDoneCollapsed] = useState(true);
  const [wrapOpen, setWrapOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [emailPickerTaskId, setEmailPickerTaskId] = useState<number | null>(null);
  const [emailPickerTaskTitle, setEmailPickerTaskTitle] = useState("");
  const [emailInboxOpen, setEmailInboxOpen] = useState(true);
  const [emailInboxSearch, setEmailInboxSearch] = useState("");
  const [debouncedInboxSearch, setDebouncedInboxSearch] = useState("");
  const [planDropOver, setPlanDropOver] = useState(false);
  const [blockDropOver, setBlockDropOver] = useState(false);
  const [addPriorityOpen, setAddPriorityOpen] = useState(false);
  const [newPriority, setNewPriority] = useState({
    title: "",
    department: "",
    severity: "normal" as "critical" | "important" | "normal",
    linkedProjectName: "",
  });
  const [reviewForm, setReviewForm] = useState({
    wentWell: "",
    movedForward: "",
    blocked: "",
    notes: "",
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<MyToolTask[]>({
    queryKey: [`/api/mytool/tasks?date=${today}`],
  });

  const { data: timeblocks = [], isLoading: blocksLoading } = useQuery<TimeBlock[]>({
    queryKey: [`/api/mytool/timeblocks?date=${today}`],
  });

  const { data: priorities = [], isLoading: prioritiesLoading } = useQuery<CompanyPriority[]>({
    queryKey: [`/api/mytool/company-priorities?horizon=${horizon}`],
  });

  const { data: escalatedItems = [] } = useQuery<Array<{
    id: string;
    type: 'project' | 'task';
    title: string;
    projectName: string;
    escalationLevel: string;
    status: string | null;
    priority: string | null;
    dueDate: string | null;
    assignees: string[] | null;
  }>>({
    queryKey: ["/api/mytool/escalated-priorities"],
  });

  const { data: dailyReview } = useQuery<DailyReview | null>({
    queryKey: [`/api/mytool/daily-review?date=${today}`],
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
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/daily-review?date=${today}`] });
  }, [horizon]);

  const mutationErrorHandler = {
    onError: (error: Error) => {
      toast({
        title: "Couldn't save",
        description: "Please try again. If the problem persists, report it from the Help page.",
        variant: "destructive",
      });
    },
  };

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/tasks", body);
    },
    onSuccess: () => invalidateAll(),
    ...mutationErrorHandler,
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/tasks/${id}`, body);
    },
    onSuccess: () => invalidateAll(),
    ...mutationErrorHandler,
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/tasks/${id}`);
    },
    onSuccess: () => invalidateAll(),
    ...mutationErrorHandler,
  });

  const createBlockMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/timeblocks", body);
    },
    onSuccess: () => {
      invalidateAll();
      setAddBlockOpen(false);
      setBlockStart("");
      setBlockEnd("");
      setBlockLabel("");
    },
    ...mutationErrorHandler,
  });

  const createPriorityMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/company-priorities", body);
    },
    onSuccess: () => {
      invalidateAll();
      setAddPriorityOpen(false);
      setNewPriority({ title: "", department: "", severity: "normal", linkedProjectName: "" });
    },
    ...mutationErrorHandler,
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & Record<string, unknown>) => {
      await apiRequest("PATCH", `/api/mytool/company-priorities/${id}`, body);
    },
    onSuccess: () => invalidateAll(),
    ...mutationErrorHandler,
  });

  const deletePriorityMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/company-priorities/${id}`);
    },
    onSuccess: () => invalidateAll(),
    ...mutationErrorHandler,
  });

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({ project_name: p.project_name })),
  });

  const saveReviewMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/daily-review", body);
    },
    onSuccess: () => invalidateAll(),
    ...mutationErrorHandler,
  });

  const handleQuickAdd = () => {
    const title = quickAddText.trim();
    if (!title) return;
    createTaskMutation.mutate({
      title,
      status: "planned",
      plannedForDate: today,
      priority: "normal",
    });
    setQuickAddText("");
  };

  const handleStatusChange = (taskId: number, newStatus: TaskStatus) => {
    updateTaskMutation.mutate({ id: taskId, status: newStatus });
  };

  const handleUnblock = (taskId: number) => {
    updateTaskMutation.mutate({ id: taskId, status: "in_progress", blockedReason: null });
  };

  const handleInlineEdit = (taskId: number) => {
    if (editingTitle.trim()) {
      updateTaskMutation.mutate({ id: taskId, title: editingTitle.trim() });
    }
    setEditingTaskId(null);
  };

  const handleAddPriority = () => {
    const title = newPriority.title.trim();
    if (!title) return;
    createPriorityMutation.mutate({
      title,
      department: newPriority.department || null,
      severity: newPriority.severity,
      horizon,
      linkedProjectName: newPriority.linkedProjectName || null,
      status: "active",
    });
  };

  const handleConvertToTask = (priority: CompanyPriority) => {
    createTaskMutation.mutate({
      title: priority.title,
      status: "planned",
      plannedForDate: today,
      priority: priority.severity === "critical" ? "critical" : priority.severity === "important" ? "important" : "normal",
      projectName: priority.linkedProjectName,
      companyPriorityId: priority.id,
    });
  };

  const handleAddBlock = () => {
    if (!blockStart || !blockEnd || !blockLabel.trim()) return;
    createBlockMutation.mutate({
      date: today,
      startTime: blockStart,
      endTime: blockEnd,
      label: blockLabel.trim(),
    });
  };

  const handleSaveReview = () => {
    saveReviewMutation.mutate({
      date: today,
      ...reviewForm,
    });
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

  const plannedTasks = tasks
    .filter((t) => t.status === "planned" && t.plannedForDate === today)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const inboxTasks = tasks.filter((t) => t.status === "inbox");
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const blockedWaitingTasks = tasks.filter((t) => t.status === "blocked" || t.status === "waiting");
  const doneTasks = tasks.filter((t) => t.status === "done");
  const cancelledTasks = tasks.filter((t) => t.status === "cancelled");

  const activePriorities = priorities.filter((p) => p.status !== "closed");
  const closedPriorities = priorities.filter((p) => p.status === "closed");
  const totalPriorityCount = activePriorities.length + escalatedItems.length;

  const isLoading = tasksLoading || blocksLoading || prioritiesLoading;

  if (isLoading) {
    return (
      <div className="max-w-[1400px] mx-auto space-y-5" data-testid="mytool-today-skeleton">
        <MyToolNav />
        <div className="flex flex-wrap items-center gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded h-5 w-24" />
          ))}
        </div>
        <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded h-10 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded h-12 w-full" />
            ))}
          </div>
          <div className="space-y-4">
            <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded h-32 w-full" />
            <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-5" data-testid="mytool-today-page">
      <MyToolNav />

      {/* Quick stats strip */}
      <div className="flex flex-wrap items-center gap-3" data-testid="stats-strip">
        <div className="flex items-center gap-1.5 text-sm">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-gray-600 dark:text-gray-400">Planned</span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">{plannedTasks.length}</span>
        </div>
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
        <div className="flex items-center gap-1.5 text-sm">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-gray-600 dark:text-gray-400">In Progress</span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">{inProgressTasks.length}</span>
        </div>
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
        <div className="flex items-center gap-1.5 text-sm">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-gray-600 dark:text-gray-400">Blocked</span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">{blockedWaitingTasks.length}</span>
        </div>
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
        <div className="flex items-center gap-1.5 text-sm">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-gray-600 dark:text-gray-400">Done</span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">{doneTasks.length}</span>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* LEFT COLUMN - Main workflow (2/3 width) */}
        <div className="lg:col-span-2 space-y-5">
          {/* Quick Add */}
          <div className="flex gap-2" data-testid="quick-add-section">
            <Input
              placeholder="Quick add a task for today... (press Enter)"
              value={quickAddText}
              onChange={(e) => setQuickAddText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !createTaskMutation.isPending && handleQuickAdd()}
              className="text-sm h-10"
              data-testid="input-quick-add"
            />
            <Button
              onClick={handleQuickAdd}
              disabled={!quickAddText.trim() || createTaskMutation.isPending}
              className="h-10 px-4"
              data-testid="button-quick-add"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>

          {/* In Progress - most important, top of flow */}
          {inProgressTasks.length > 0 && (
            <section data-testid="section-in-progress">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">In Progress</h3>
                <Badge variant="secondary" className="text-xs">{inProgressTasks.length}</Badge>
              </div>
              <div className="space-y-1.5">
                {inProgressTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onStatusChange={handleStatusChange}
                    onUnblock={handleUnblock}
                    onEdit={(t) => { setEditingTaskId(t.id); setEditingTitle(t.title); }}
                    editingTaskId={editingTaskId}
                    editingTitle={editingTitle}
                    setEditingTitle={setEditingTitle}
                    onInlineEdit={handleInlineEdit}
                    setEditingTaskId={setEditingTaskId}
                    highlight="amber"
                    onOpenEmailPicker={(id, title) => { setEmailPickerTaskId(id); setEmailPickerTaskTitle(title); }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Blocked / Waiting */}
          {blockedWaitingTasks.length > 0 && (
            <section data-testid="section-blocked">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Blocked / Waiting</h3>
                <Badge variant="secondary" className="text-xs">{blockedWaitingTasks.length}</Badge>
              </div>
              <div className="space-y-1.5">
                {blockedWaitingTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onStatusChange={handleStatusChange}
                    onUnblock={handleUnblock}
                    onEdit={(t) => { setEditingTaskId(t.id); setEditingTitle(t.title); }}
                    editingTaskId={editingTaskId}
                    editingTitle={editingTitle}
                    setEditingTitle={setEditingTitle}
                    onInlineEdit={handleInlineEdit}
                    setEditingTaskId={setEditingTaskId}
                    highlight="red"
                    onOpenEmailPicker={(id, title) => { setEmailPickerTaskId(id); setEmailPickerTaskTitle(title); }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Today's Plan */}
          <section
            data-testid="card-todays-plan"
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
            className={planDropOver ? "ring-2 ring-blue-400 bg-blue-50/50 rounded-lg p-2 transition-all" : "transition-all"}
          >
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Today's Plan</h3>
              <Badge variant="secondary" className="text-xs" data-testid="badge-planned-count">
                {plannedTasks.length}
              </Badge>
              {planDropOver && <span className="text-[10px] text-blue-500 ml-auto">Drop email to create task</span>}
            </div>

            {plannedTasks.length === 0 ? (
              <Card className="border-dashed" data-testid="empty-planned">
                <CardContent className="py-8 text-center">
                  <Target className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No tasks planned for today.</p>
                  <p className="text-xs text-gray-400 mt-1">Type in the box above to add your first task.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-1.5">
                {plannedTasks.map((task, i) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    index={i + 1}
                    onStatusChange={handleStatusChange}
                    onUnblock={handleUnblock}
                    onEdit={(t) => { setEditingTaskId(t.id); setEditingTitle(t.title); }}
                    editingTaskId={editingTaskId}
                    editingTitle={editingTitle}
                    setEditingTitle={setEditingTitle}
                    onInlineEdit={handleInlineEdit}
                    setEditingTaskId={setEditingTaskId}
                    onOpenEmailPicker={(id, title) => { setEmailPickerTaskId(id); setEmailPickerTaskTitle(title); }}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Inbox */}
          {inboxTasks.length > 0 && (
            <section data-testid="section-inbox">
              <div className="flex items-center gap-2 mb-2">
                <Inbox className="h-4 w-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Inbox</h3>
                <Badge variant="secondary" className="text-xs">{inboxTasks.length}</Badge>
              </div>
              <div className="space-y-1.5">
                {inboxTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onStatusChange={handleStatusChange}
                    onUnblock={handleUnblock}
                    onEdit={(t) => { setEditingTaskId(t.id); setEditingTitle(t.title); }}
                    editingTaskId={editingTaskId}
                    editingTitle={editingTitle}
                    setEditingTitle={setEditingTitle}
                    onInlineEdit={handleInlineEdit}
                    setEditingTaskId={setEditingTaskId}
                    onOpenEmailPicker={(id, title) => { setEmailPickerTaskId(id); setEmailPickerTaskTitle(title); }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Done (collapsed) */}
          {doneTasks.length > 0 && (
            <section data-testid="section-done">
              <button
                className="flex items-center gap-2 mb-2"
                onClick={() => setDoneCollapsed(!doneCollapsed)}
                data-testid="toggle-done-lane"
              >
                {doneCollapsed ? <ChevronRight className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Done</h3>
                <Badge variant="secondary" className="text-xs" data-testid="badge-done-count">{doneTasks.length}</Badge>
              </button>
              {!doneCollapsed && (
                <div className="space-y-1.5">
                  {doneTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onStatusChange={handleStatusChange}
                      onEdit={(t) => { setEditingTaskId(t.id); setEditingTitle(t.title); }}
                      editingTaskId={editingTaskId}
                      editingTitle={editingTitle}
                      setEditingTitle={setEditingTitle}
                      onInlineEdit={handleInlineEdit}
                      setEditingTaskId={setEditingTaskId}
                      onOpenEmailPicker={(id, title) => { setEmailPickerTaskId(id); setEmailPickerTaskTitle(title); }}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* End-of-Day Wrap */}
          <Card data-testid="card-daily-wrap">
            <CardHeader className="pb-2">
              <button
                className="flex items-center gap-2 text-left w-full"
                onClick={() => {
                  setWrapOpen(!wrapOpen);
                  if (!wrapOpen && dailyReview) {
                    setReviewForm({
                      wentWell: dailyReview.wentWell || "",
                      movedForward: dailyReview.movedForward || "",
                      blocked: dailyReview.blocked || "",
                      notes: dailyReview.notes || "",
                    });
                  }
                }}
                data-testid="toggle-daily-wrap"
              >
                {wrapOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                <Moon className="h-4 w-4 text-indigo-500" />
                <CardTitle className="text-sm font-semibold">End-of-Day Wrap</CardTitle>
                {dailyReview && (
                  <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 ml-2">
                    Saved
                  </Badge>
                )}
              </button>
            </CardHeader>
            {wrapOpen && (
              <CardContent className="space-y-3 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">What went well?</label>
                    <Textarea
                      value={reviewForm.wentWell}
                      onChange={(e) => setReviewForm((p) => ({ ...p, wentWell: e.target.value }))}
                      placeholder="Wins, progress..."
                      className="text-sm min-h-[60px]"
                      data-testid="textarea-went-well"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">What moved forward?</label>
                    <Textarea
                      value={reviewForm.movedForward}
                      onChange={(e) => setReviewForm((p) => ({ ...p, movedForward: e.target.value }))}
                      placeholder="Projects advanced..."
                      className="text-sm min-h-[60px]"
                      data-testid="textarea-moved-forward"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">What's blocked?</label>
                    <Textarea
                      value={reviewForm.blocked}
                      onChange={(e) => setReviewForm((p) => ({ ...p, blocked: e.target.value }))}
                      placeholder="Blockers, waiting on..."
                      className="text-sm min-h-[60px]"
                      data-testid="textarea-blocked"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
                    <Textarea
                      value={reviewForm.notes}
                      onChange={(e) => setReviewForm((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Anything else..."
                      className="text-sm min-h-[60px]"
                      data-testid="textarea-notes"
                    />
                  </div>
                </div>
                <Button
                  onClick={handleSaveReview}
                  disabled={saveReviewMutation.isPending}
                  size="sm"
                  data-testid="button-save-review"
                >
                  {saveReviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Save Review
                </Button>
              </CardContent>
            )}
          </Card>
        </div>

        {/* RIGHT COLUMN - Context sidebar (1/3 width) */}
        <div className="space-y-5">
          {/* Time Blocks */}
          <Card
            data-testid="card-time-blocks"
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
            className={blockDropOver ? "ring-2 ring-blue-400 bg-blue-50/50 transition-all" : "transition-all"}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-violet-600" />
                  Time Blocks
                  {blockDropOver && <span className="text-[10px] text-blue-500 font-normal">Drop to create task + block</span>}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setAddBlockOpen(!addBlockOpen)}
                  data-testid="button-add-block"
                >
                  {addBlockOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {addBlockOpen && (
                <div className="space-y-2 p-2.5 bg-violet-50/50 dark:bg-violet-950/20 rounded-lg border border-violet-100 dark:border-violet-900" data-testid="form-add-block">
                  <div className="flex gap-2">
                    <Input
                      type="time"
                      value={blockStart}
                      onChange={(e) => setBlockStart(e.target.value)}
                      className="text-xs h-8"
                      data-testid="input-block-start"
                    />
                    <Input
                      type="time"
                      value={blockEnd}
                      onChange={(e) => setBlockEnd(e.target.value)}
                      className="text-xs h-8"
                      data-testid="input-block-end"
                    />
                  </div>
                  <Input
                    value={blockLabel}
                    onChange={(e) => setBlockLabel(e.target.value)}
                    className="text-xs h-8"
                    placeholder="What are you working on?"
                    onKeyDown={(e) => e.key === "Enter" && handleAddBlock()}
                    data-testid="input-block-label"
                  />
                  <Button
                    size="sm"
                    className="w-full h-7 text-xs"
                    onClick={handleAddBlock}
                    disabled={!blockStart || !blockEnd || !blockLabel.trim() || createBlockMutation.isPending}
                    data-testid="button-save-block"
                  >
                    Add Block
                  </Button>
                </div>
              )}

              {timeblocks.length === 0 && !addBlockOpen ? (
                <div className="text-center py-4" data-testid="empty-timeblocks">
                  <Clock className="h-6 w-6 text-gray-300 mx-auto mb-1.5" />
                  <p className="text-xs text-gray-400">No time blocks yet.</p>
                  <button
                    onClick={() => setAddBlockOpen(true)}
                    className="text-xs text-blue-600 hover:underline mt-1"
                    data-testid="link-add-first-block"
                  >
                    Add your first block
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  {timeblocks
                    .sort((a, b) => a.startTime.localeCompare(b.startTime))
                    .map((block) => (
                      <div
                        key={block.id}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-violet-50/50 dark:bg-violet-950/20 border border-violet-100/50 dark:border-violet-900/50"
                        data-testid={`timeblock-${block.id}`}
                      >
                        <span className="text-[11px] font-mono text-violet-600 dark:text-violet-400 shrink-0">
                          {block.startTime}–{block.endTime}
                        </span>
                        <span className="flex-1 text-xs text-gray-700 dark:text-gray-300 truncate">{block.label}</span>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Email Inbox */}
          <Card data-testid="card-email-inbox">
            <CardHeader className="pb-2">
              <button
                className="flex items-center gap-2 text-left w-full"
                onClick={() => setEmailInboxOpen(!emailInboxOpen)}
                data-testid="toggle-email-inbox"
              >
                {emailInboxOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                <Mail className="h-4 w-4 text-blue-600" />
                <CardTitle className="text-sm font-semibold">Email Inbox</CardTitle>
              </button>
            </CardHeader>
            {emailInboxOpen && (
              <CardContent className="pt-0 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    placeholder="Search emails..."
                    value={emailInboxSearch}
                    onChange={(e) => setEmailInboxSearch(e.target.value)}
                    className="pl-8 text-xs h-8"
                    data-testid="input-inbox-search"
                  />
                </div>

                {inboxEmailsLoading ? (
                  <div className="flex items-center justify-center py-6" data-testid="inbox-loading">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  </div>
                ) : inboxEmails.length === 0 ? (
                  <div className="text-center py-4" data-testid="inbox-empty">
                    <Mail className="h-6 w-6 text-gray-300 mx-auto mb-1.5" />
                    <p className="text-xs text-gray-400">
                      {emailInboxSearch ? "No emails found" : "No emails available."}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      Connect Outlook in <Link href="/my-tool/settings" className="text-blue-600 hover:underline" data-testid="link-connect-outlook">Settings</Link>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto" data-testid="inbox-email-list">
                    {inboxEmails.map((email) => (
                      <div
                        key={email.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/json", JSON.stringify(email));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        className="px-2.5 py-2 rounded-md border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-grab active:cursor-grabbing transition-colors group/email"
                        data-testid={`inbox-email-${email.id}`}
                      >
                        <div className="flex items-start gap-2">
                          <Mail className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{email.subject || "(No subject)"}</p>
                            <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                              <span className="truncate">{email.sender || email.senderEmail || "Unknown"}</span>
                              <span>·</span>
                              <span className="shrink-0">{email.receivedAt ? format(new Date(email.receivedAt), "d MMM") : ""}</span>
                            </div>
                            {email.snippet && (
                              <p className="text-[10px] text-gray-400 truncate mt-0.5">{email.snippet.slice(0, 80)}</p>
                            )}
                          </div>
                          {email.webLink && (
                            <a href={email.webLink} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 shrink-0 opacity-0 group-hover/email:opacity-100 transition-opacity" data-testid={`link-inbox-email-${email.id}`}>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-[9px] text-blue-500 mt-1 select-none">↕ Drag to plan</p>
                      </div>
                    ))}
                    {inboxEmails.length >= 15 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full h-7 text-xs text-gray-500"
                        onClick={() => setEmailInboxSearch(emailInboxSearch || " ")}
                        data-testid="button-load-more-emails"
                      >
                        Load More
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Company Priorities */}
          <Card data-testid="card-company-priorities">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <button
                  className="flex items-center gap-2 text-left"
                  onClick={() => setPrioritiesOpen(!prioritiesOpen)}
                  data-testid="toggle-company-priorities"
                >
                  {prioritiesOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                  <CardTitle className="text-sm font-semibold">Priorities</CardTitle>
                  <Badge variant="secondary" className="text-xs" data-testid="badge-priorities-count">
                    {totalPriorityCount}
                  </Badge>
                </button>
                <div className="flex items-center gap-1.5">
                  <select
                    value={horizon}
                    onChange={(e) => setHorizon(e.target.value as Horizon)}
                    className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white dark:bg-gray-900 dark:border-gray-700"
                    data-testid="select-horizon"
                  >
                    <option value="today">Today</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                    <option value="quarter">Quarter</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setAddPriorityOpen(!addPriorityOpen)}
                    data-testid="button-add-priority"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            {prioritiesOpen && (
              <CardContent className="pt-0 space-y-2">
                {addPriorityOpen && (
                  <div className="p-2.5 rounded-lg border border-blue-200 bg-blue-50/30 dark:border-blue-900 dark:bg-blue-950/20 space-y-2" data-testid="add-priority-form">
                    <Input
                      placeholder="Priority title..."
                      value={newPriority.title}
                      onChange={(e) => setNewPriority(p => ({ ...p, title: e.target.value }))}
                      className="h-8 text-xs"
                      data-testid="input-priority-title"
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddPriority(); }}
                    />
                    <div className="flex gap-2">
                      <select
                        value={newPriority.severity}
                        onChange={(e) => setNewPriority(p => ({ ...p, severity: e.target.value as any }))}
                        className="h-7 text-[11px] border border-gray-200 rounded px-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 flex-1"
                        data-testid="select-priority-severity"
                      >
                        <option value="normal">Normal</option>
                        <option value="important">Important</option>
                        <option value="critical">Critical</option>
                      </select>
                      <select
                        value={newPriority.department}
                        onChange={(e) => setNewPriority(p => ({ ...p, department: e.target.value }))}
                        className="h-7 text-[11px] border border-gray-200 rounded px-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 flex-1"
                        data-testid="select-priority-department"
                      >
                        <option value="">Dept...</option>
                        {DEPARTMENTS.map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <select
                      value={newPriority.linkedProjectName}
                      onChange={(e) => setNewPriority(p => ({ ...p, linkedProjectName: e.target.value }))}
                      className="h-7 text-[11px] border border-gray-200 rounded px-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 w-full"
                      data-testid="select-priority-project"
                    >
                      <option value="">Link to project (optional)</option>
                      {allProjects.map(p => (
                        <option key={p.project_name} value={p.project_name}>
                          {p.project_name.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => { setAddPriorityOpen(false); setNewPriority({ title: "", department: "", severity: "normal", linkedProjectName: "" }); }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleAddPriority}
                        disabled={!newPriority.title.trim() || createPriorityMutation.isPending}
                        data-testid="button-save-priority"
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                )}

                {totalPriorityCount === 0 && !addPriorityOpen ? (
                  <p className="text-xs text-gray-400 py-3 text-center" data-testid="empty-priorities">
                    No priorities set.
                  </p>
                ) : (
                  <>
                    {escalatedItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2 p-2 rounded-md border border-red-100 bg-red-50/30 dark:border-red-900 dark:bg-red-950/20"
                        data-testid={`escalated-item-${item.id}`}
                      >
                        <Flag className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{item.title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-red-600 font-medium uppercase">{item.type}</span>
                            {item.status && <span className="text-[10px] text-gray-500">{item.status}</span>}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-1.5 shrink-0"
                          onClick={() => setLocation(`/project/${encodeURIComponent(item.projectName)}`)}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    {activePriorities.map((p) => (
                      <PriorityCard
                        key={p.id}
                        priority={p}
                        onStatusChange={(status) => updatePriorityMutation.mutate({ id: p.id, status })}
                        onConvertToTask={() => handleConvertToTask(p)}
                        onDelete={() => deletePriorityMutation.mutate(p.id)}
                        isUpdating={updatePriorityMutation.isPending}
                        isCreatingTask={createTaskMutation.isPending}
                        isDeleting={deletePriorityMutation.isPending}
                      />
                    ))}
                  </>
                )}

                {closedPriorities.length > 0 && (
                  <div className="pt-1 mt-1 border-t border-gray-100 dark:border-gray-800">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-1.5">
                      Closed ({closedPriorities.length})
                    </p>
                    {closedPriorities.map((p) => (
                      <PriorityCard
                        key={p.id}
                        priority={p}
                        onStatusChange={(status) => updatePriorityMutation.mutate({ id: p.id, status })}
                        onConvertToTask={() => handleConvertToTask(p)}
                        onDelete={() => deletePriorityMutation.mutate(p.id)}
                        isUpdating={updatePriorityMutation.isPending}
                        isCreatingTask={createTaskMutation.isPending}
                        isDeleting={deletePriorityMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </div>
      </div>

      {emailPickerTaskId !== null && (
        <TodayEmailPickerDialog
          open={true}
          onOpenChange={(open) => { if (!open) { setEmailPickerTaskId(null); setEmailPickerTaskTitle(""); } }}
          taskId={emailPickerTaskId}
          taskTitle={emailPickerTaskTitle}
        />
      )}
    </div>
  );
}

function TodayEmailPickerDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
  taskTitle: string;
}) {
  const { toast } = useToast();
  const [emailSearch, setEmailSearch] = useState("");
  const [debouncedEmailSearch, setDebouncedEmailSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedEmailSearch(emailSearch), 400);
    return () => clearTimeout(timer);
  }, [emailSearch]);

  const { data: emails = [], isLoading: emailsLoading } = useQuery<OutlookEmail[]>({
    queryKey: ["/api/outlook/messages", debouncedEmailSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ top: "20" });
      if (debouncedEmailSearch.trim()) params.set("search", debouncedEmailSearch.trim());
      const res = await fetch(`/api/outlook/messages?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return data.value || data || [];
    },
    enabled: open,
  });

  const { data: linkedEmails = [], isLoading: linkedLoading } = useQuery<EmailLink[]>({
    queryKey: ["/api/mytool/email-links", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/mytool/email-links?taskId=${taskId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });

  const linkEmailMutation = useMutation({
    mutationFn: async (email: OutlookEmail) => {
      await apiRequest("POST", "/api/outlook/email-to-task", {
        outlookMessageId: email.id,
        subject: email.subject,
        sender: email.sender || email.senderEmail || "",
        receivedAt: email.receivedAt,
        snippet: email.snippet?.slice(0, 200) || "",
        webLink: email.webLink || "",
        targetType: "mytool",
        targetId: taskId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/email-links", taskId] });
      toast({ title: "Email linked to task" });
    },
    onError: () => {
      toast({ title: "Failed to link email", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" data-testid="dialog-email-picker">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Link Email to: {taskTitle}</DialogTitle>
          <DialogDescription className="text-xs text-gray-500">Search and link Outlook emails to this task</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search emails..."
              value={emailSearch}
              onChange={(e) => setEmailSearch(e.target.value)}
              className="pl-9 text-sm"
              data-testid="input-email-search"
            />
          </div>

          {linkedEmails.length > 0 && (
            <div className="space-y-1" data-testid="linked-emails-section">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Linked Emails</p>
              <div className="space-y-1 max-h-[120px] overflow-y-auto">
                {linkedEmails.map((le) => (
                  <div key={le.id} className="flex items-center gap-2 text-xs bg-blue-50 dark:bg-blue-900/20 rounded px-2 py-1.5" data-testid={`linked-email-${le.id}`}>
                    <Mail className="h-3 w-3 text-blue-600 shrink-0" />
                    <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{le.subject}</span>
                    <span className="text-gray-400 shrink-0">{le.sender}</span>
                    {le.webLink && (
                      <a href={le.webLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 shrink-0" data-testid={`link-open-email-${le.id}`}>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-1" data-testid="email-results-section">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              {emailsLoading ? "Loading..." : `Search Results (${emails.length})`}
            </p>
            {!emailsLoading && emails.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4" data-testid="text-no-emails">
                {emailSearch ? "No emails found" : "No emails available. Outlook may not be connected."}
              </p>
            )}
            {emails.map((email) => (
              <div key={email.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-1" data-testid={`email-result-${email.id}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{email.subject || "(No subject)"}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{email.sender || email.senderEmail || "Unknown"}</span>
                      <span>·</span>
                      <span>{email.receivedAt ? format(new Date(email.receivedAt), "d MMM yyyy") : ""}</span>
                    </div>
                    {email.snippet && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{email.snippet.slice(0, 120)}</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    onClick={() => linkEmailMutation.mutate(email)}
                    disabled={linkEmailMutation.isPending}
                    data-testid={`button-link-email-${email.id}`}
                  >
                    Link
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaskRow({
  task,
  index,
  onStatusChange,
  onUnblock,
  onEdit,
  editingTaskId,
  editingTitle,
  setEditingTitle,
  onInlineEdit,
  setEditingTaskId,
  highlight,
  onOpenEmailPicker,
}: {
  task: MyToolTask;
  index?: number;
  onStatusChange: (id: number, status: TaskStatus) => void;
  onUnblock?: (id: number) => void;
  onEdit: (task: MyToolTask) => void;
  editingTaskId: number | null;
  editingTitle: string;
  setEditingTitle: (s: string) => void;
  onInlineEdit: (id: number) => void;
  setEditingTaskId: (id: number | null) => void;
  highlight?: "amber" | "red";
  onOpenEmailPicker?: (taskId: number, taskTitle: string) => void;
}) {
  const borderClass = highlight === "amber"
    ? "border-l-amber-400 border-l-[3px]"
    : highlight === "red"
    ? "border-l-red-400 border-l-[3px]"
    : "";

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 group transition-colors ${borderClass}`}
      data-testid={`task-row-${task.id}`}
    >
      {index !== undefined && (
        <span className="text-[11px] text-gray-400 font-mono w-4 shrink-0 text-right">{index}</span>
      )}
      <PriorityDot priority={task.priority} />
      {editingTaskId === task.id ? (
        <Input
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onBlur={() => onInlineEdit(task.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onInlineEdit(task.id);
            if (e.key === "Escape") setEditingTaskId(null);
          }}
          className="h-7 text-sm flex-1"
          autoFocus
          data-testid={`input-edit-task-${task.id}`}
        />
      ) : (
        <span
          className={`flex-1 text-sm cursor-pointer truncate ${task.status === "done" ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`}
          onClick={() => onEdit(task)}
          data-testid={`text-task-title-${task.id}`}
        >
          {task.title}
        </span>
      )}
      {task.isRecurring && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 border border-purple-200 shrink-0" data-testid={`badge-recurring-${task.id}`}>
          <Repeat className="h-2.5 w-2.5" />
        </span>
      )}
      {onOpenEmailPicker && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-gray-400 hover:text-blue-600 shrink-0"
          onClick={(e) => { e.stopPropagation(); onOpenEmailPicker(task.id, task.title); }}
          title="Link emails"
          data-testid={`button-email-picker-${task.id}`}
        >
          <Mail className="h-3 w-3" />
        </Button>
      )}
      {task.projectName && (
        <Link
          href={`/project/${encodeURIComponent(task.projectName)}`}
          className="text-[10px] text-blue-600 hover:underline shrink-0 max-w-[80px] truncate hidden sm:inline"
          onClick={(e) => e.stopPropagation()}
          data-testid={`link-task-project-${task.id}`}
        >
          {task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
        </Link>
      )}
      {(task.status === "blocked" || task.status === "waiting") && task.blockedReason && (
        <span className="text-[10px] text-red-500 truncate max-w-[100px] hidden sm:inline" title={task.blockedReason}>
          {task.blockedReason}
        </span>
      )}
      <StatusBadge status={task.status} />
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {task.status !== "in_progress" && task.status !== "done" && task.status !== "cancelled" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
            onClick={() => onStatusChange(task.id, "in_progress")}
            title="Start"
            data-testid={`button-start-${task.id}`}
          >
            <Play className="h-3 w-3" />
          </Button>
        )}
        {task.status !== "done" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
            onClick={() => onStatusChange(task.id, "done")}
            title="Done"
            data-testid={`button-done-${task.id}`}
          >
            <CheckCircle2 className="h-3 w-3" />
          </Button>
        )}
        {(task.status === "blocked" || task.status === "waiting") && onUnblock && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
            onClick={() => onUnblock(task.id)}
            title="Unblock"
            data-testid={`button-unblock-${task.id}`}
          >
            <Unlock className="h-3 w-3" />
          </Button>
        )}
        {task.status === "done" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-gray-500"
            onClick={() => onStatusChange(task.id, "inbox")}
            title="Reopen"
            data-testid={`button-reopen-${task.id}`}
          >
            <ArrowRight className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

const priorityStatusConfig: Record<PriorityStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active: { label: "Active", color: "bg-blue-100 text-blue-700", icon: Play },
  monitoring: { label: "Monitoring", color: "bg-amber-100 text-amber-700", icon: Clock },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-500", icon: CheckCircle2 },
};

function PriorityCard({
  priority: p,
  onStatusChange,
  onConvertToTask,
  onDelete,
  isUpdating,
  isCreatingTask,
  isDeleting,
}: {
  priority: CompanyPriority;
  onStatusChange: (status: PriorityStatus) => void;
  onConvertToTask: () => void;
  onDelete: () => void;
  isUpdating: boolean;
  isCreatingTask: boolean;
  isDeleting: boolean;
}) {
  const isClosed = p.status === "closed";
  const stCfg = priorityStatusConfig[p.status] || priorityStatusConfig.active;

  return (
    <div
      className={`p-2 rounded-md border transition-colors ${
        isClosed
          ? "border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 opacity-70"
          : "border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      }`}
      data-testid={`priority-item-${p.id}`}
    >
      <div className="flex items-start gap-2">
        <SeverityBadge severity={p.severity} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium truncate ${isClosed ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`}>
            {p.title}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <select
              value={p.status}
              onChange={(e) => onStatusChange(e.target.value as PriorityStatus)}
              disabled={isUpdating}
              className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border-0 cursor-pointer ${stCfg.color}`}
              data-testid={`select-priority-status-${p.id}`}
            >
              <option value="active">Active</option>
              <option value="monitoring">Monitoring</option>
              <option value="closed">Closed</option>
            </select>
            {p.department && (
              <span className="text-[10px] text-indigo-600">{p.department}</span>
            )}
            {p.linkedProjectName && (
              <Link
                href={`/project/${encodeURIComponent(p.linkedProjectName)}`}
                className="text-[10px] text-blue-600 hover:underline truncate"
                data-testid={`link-priority-project-${p.id}`}
              >
                {p.linkedProjectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
              </Link>
            )}
          </div>
          {!isClosed && <EmailLinksWidget priorityId={p.id} />}
        </div>
        <div className="flex gap-0.5 shrink-0">
          {!isClosed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-blue-600"
              onClick={onConvertToTask}
              disabled={isCreatingTask}
              title="Create task from priority"
              data-testid={`button-convert-task-${p.id}`}
            >
              <Plus className="h-3 w-3" />
            </Button>
          )}
          {isClosed ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-blue-500 hover:text-blue-600"
              onClick={() => onStatusChange("active")}
              disabled={isUpdating}
              title="Reopen"
              data-testid={`button-reopen-priority-${p.id}`}
            >
              <ArrowRight className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-emerald-500 hover:text-emerald-600"
              onClick={() => onStatusChange("closed")}
              disabled={isUpdating}
              title="Close priority"
              data-testid={`button-close-priority-${p.id}`}
            >
              <CheckCircle2 className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
            onClick={onDelete}
            disabled={isDeleting}
            data-testid={`button-delete-priority-${p.id}`}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmailLinksWidget({ taskId, priorityId }: { taskId?: number; priorityId?: number }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ subject: "", sender: "", emailDate: "", snippet: "" });

  const qKey = taskId
    ? ["/api/mytool/email-links", { taskId }]
    : ["/api/mytool/email-links", { priorityId }];

  const param = taskId ? `taskId=${taskId}` : `priorityId=${priorityId}`;

  const { data: links = [] } = useQuery<any[]>({
    queryKey: qKey,
    queryFn: () => fetch(`/api/mytool/email-links?${param}`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/mytool/email-links", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      setForm({ subject: "", sender: "", emailDate: "", snippet: "" });
      setAdding(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/mytool/email-links/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  const handleSave = () => {
    if (!form.subject.trim()) return;
    createMut.mutate({
      subject: form.subject.trim(),
      sender: form.sender.trim() || null,
      emailDate: form.emailDate.trim() || null,
      snippet: form.snippet.trim() || null,
      linkedTaskId: taskId || null,
      linkedPriorityId: priorityId || null,
    });
  };

  return (
    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
      <button
        className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-blue-600 transition-colors"
        onClick={() => setOpen(!open)}
        data-testid={`toggle-emails-${taskId || priorityId}`}
      >
        <Paperclip className="h-2.5 w-2.5" />
        <span>Emails</span>
        {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {links.map((link: any) => (
            <div
              key={link.id}
              className="flex items-start gap-1.5 p-1.5 rounded bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/50 text-[11px]"
              data-testid={`email-link-${link.id}`}
            >
              <Mail className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 dark:text-gray-200 truncate">{link.subject}</p>
                {link.sender && <p className="text-gray-500 truncate">From: {link.sender}</p>}
              </div>
              <button
                className="text-gray-300 hover:text-red-500 shrink-0"
                onClick={() => deleteMut.mutate(link.id)}
                data-testid={`delete-email-${link.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          {!adding ? (
            <button
              className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700"
              onClick={() => setAdding(true)}
              data-testid={`add-email-${taskId || priorityId}`}
            >
              <Plus className="h-3 w-3" />
              Attach email
            </button>
          ) : (
            <div className="p-2 rounded border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20 space-y-1.5">
              <Input
                placeholder="Email subject *"
                value={form.subject}
                onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))}
                className="h-7 text-xs"
                data-testid={`input-email-subject-${taskId || priorityId}`}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
              <Input
                placeholder="Sender (optional)"
                value={form.sender}
                onChange={(e) => setForm(f => ({ ...f, sender: e.target.value }))}
                className="h-7 text-xs"
                data-testid={`input-email-sender-${taskId || priorityId}`}
              />
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => { setAdding(false); setForm({ subject: "", sender: "", emailDate: "", snippet: "" }); }}>
                  Cancel
                </Button>
                <Button size="sm" className="h-6 text-[10px]" onClick={handleSave} disabled={!form.subject.trim() || createMut.isPending}>
                  Attach
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

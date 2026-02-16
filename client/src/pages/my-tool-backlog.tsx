import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import MyToolNav from "@/components/my-tool-nav";
import {
  Plus,
  Loader2,
  CalendarDays,
  Settings,
  ListTodo,
  Target,
  Search,
  Trash2,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  X,
  CheckCircle2,
  ExternalLink,
  Calendar,
  Inbox,
  Flag,
  Repeat,
  Mail,
} from "lucide-react";

type Priority = "critical" | "important" | "normal" | "low";
type TaskStatus = "inbox" | "planned" | "in_progress" | "blocked" | "waiting" | "done" | "cancelled";
type SortField = "createdAt" | "dueDate" | "priority" | "status";
type SortDirection = "asc" | "desc";
type PriorityStatus = "active" | "monitoring" | "closed";

interface MyToolTask {
  id: number;
  title: string;
  status: TaskStatus;
  priority: Priority;
  plannedForDate: string | null;
  dueAt: string | null;
  sortOrder: number;
  projectName: string | null;
  tag: string | null;
  blockedReason: string | null;
  companyPriorityId: number | null;
  createdAt: string | null;
  notes: string | null;
  isRecurring?: boolean;
  recurrenceFrequency?: string | null;
  recurrenceInterval?: number | null;
  recurrenceDaysOfWeek?: string | null;
  recurrenceEndDate?: string | null;
  recurrenceParentId?: number | null;
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

interface CompanyPriority {
  id: number;
  title: string;
  severity: "critical" | "important" | "normal";
  horizon: string;
  department: string | null;
  linkedProjectName: string | null;
  status: PriorityStatus;
}

const priorityOrder: Record<string, number> = { critical: 0, important: 1, normal: 2, low: 3 };
const statusOrder: Record<string, number> = { in_progress: 0, planned: 1, inbox: 2, blocked: 3, waiting: 4, done: 5, cancelled: 6 };
const allStatuses: TaskStatus[] = ["inbox", "planned", "in_progress", "blocked", "waiting", "done", "cancelled"];
const allPriorities: Priority[] = ["critical", "important", "normal", "low"];

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  important: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  normal: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  low: { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
};

const statusColors: Record<string, string> = {
  inbox: "bg-gray-100 text-gray-700",
  planned: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  blocked: "bg-red-100 text-red-700",
  waiting: "bg-orange-100 text-orange-700",
  done: "bg-emerald-100 text-emerald-700",
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
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${statusColors[status] || statusColors.inbox}`}
      data-testid={`badge-status-${status}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}


function EmailPickerDialog({
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

  const createTaskFromEmailMutation = useMutation({
    mutationFn: async (email: OutlookEmail) => {
      await apiRequest("POST", "/api/outlook/email-to-task", {
        outlookMessageId: email.id,
        subject: email.subject,
        sender: email.sender || email.senderEmail || "",
        receivedAt: email.receivedAt,
        snippet: email.snippet?.slice(0, 200) || "",
        webLink: email.webLink || "",
        targetType: "new",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
      toast({ title: "New task created from email" });
    },
    onError: () => {
      toast({ title: "Failed to create task from email", variant: "destructive" });
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
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => linkEmailMutation.mutate(email)}
                      disabled={linkEmailMutation.isPending}
                      data-testid={`button-link-email-${email.id}`}
                    >
                      Link
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => createTaskFromEmailMutation.mutate(email)}
                      disabled={createTaskFromEmailMutation.isPending}
                      data-testid={`button-create-task-email-${email.id}`}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      New Task
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MyToolBacklogPage() {
  const { user } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();

  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<Priority[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("normal");
  const [newStatus, setNewStatus] = useState<TaskStatus>("inbox");
  const [showStatusFilter, setShowStatusFilter] = useState(false);
  const [showPriorityFilter, setShowPriorityFilter] = useState(false);

  const [newIsRecurring, setNewIsRecurring] = useState(false);
  const [newRecurrenceFrequency, setNewRecurrenceFrequency] = useState("daily");
  const [newRecurrenceInterval, setNewRecurrenceInterval] = useState(1);
  const [newRecurrenceDaysOfWeek, setNewRecurrenceDaysOfWeek] = useState<number[]>([]);
  const [newRecurrenceEndDate, setNewRecurrenceEndDate] = useState("");

  const [emailPickerTaskId, setEmailPickerTaskId] = useState<number | null>(null);
  const [emailPickerTaskTitle, setEmailPickerTaskTitle] = useState("");

  const [editingField, setEditingField] = useState<{ taskId: number; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [prioritiesOpen, setPrioritiesOpen] = useState(true);
  const [closedPrioritiesOpen, setClosedPrioritiesOpen] = useState(false);
  const [addPriorityOpen, setAddPriorityOpen] = useState(false);
  const [newPriorityForm, setNewPriorityForm] = useState({
    title: "",
    severity: "normal" as "critical" | "important" | "normal",
    department: "",
    linkedProjectName: "",
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { data: tasks = [], isLoading } = useQuery<MyToolTask[]>({
    queryKey: ["/api/mytool/tasks"],
  });

  const { data: priorities = [] } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({ project_name: p.project_name })),
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
  }, []);

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/tasks", body);
    },
    onSuccess: () => {
      invalidateAll();
      setShowCreateForm(false);
      setNewTitle("");
      setNewPriority("normal");
      setNewStatus("inbox");
      setNewIsRecurring(false);
      setNewRecurrenceFrequency("daily");
      setNewRecurrenceInterval(1);
      setNewRecurrenceDaysOfWeek([]);
      setNewRecurrenceEndDate("");
    },
    onError: () => {
      toast({ title: "Failed to create task", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/tasks/${id}`, body);
    },
    onSuccess: () => invalidateAll(),
    onError: () => {
      toast({ title: "Failed to update task", variant: "destructive" });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/tasks/${id}`);
    },
    onSuccess: () => invalidateAll(),
    onError: () => {
      toast({ title: "Failed to delete task", variant: "destructive" });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (updates: { ids: number[]; changes: Record<string, unknown> }) => {
      await Promise.all(
        updates.ids.map((id) => apiRequest("PATCH", `/api/mytool/tasks/${id}`, updates.changes))
      );
    },
    onSuccess: () => {
      invalidateAll();
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Failed to update tasks", variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/mytool/tasks/${id}`)));
    },
    onSuccess: () => {
      invalidateAll();
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Failed to delete tasks", variant: "destructive" });
    },
  });

  const createPriorityMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/company-priorities", body);
    },
    onSuccess: () => {
      invalidateAll();
      setAddPriorityOpen(false);
      setNewPriorityForm({ title: "", severity: "normal", department: "", linkedProjectName: "" });
    },
    onError: () => {
      toast({ title: "Failed to create priority", variant: "destructive" });
    },
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & Record<string, unknown>) => {
      await apiRequest("PATCH", `/api/mytool/company-priorities/${id}`, body);
    },
    onSuccess: () => invalidateAll(),
    onError: () => {
      toast({ title: "Failed to update priority", variant: "destructive" });
    },
  });

  const deletePriorityMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/company-priorities/${id}`);
    },
    onSuccess: () => invalidateAll(),
    onError: () => {
      toast({ title: "Failed to delete priority", variant: "destructive" });
    },
  });

  const handleCreateTask = () => {
    if (createTaskMutation.isPending) return;
    const title = newTitle.trim();
    if (!title) return;
    const payload: Record<string, unknown> = { title, status: newStatus, priority: newPriority };
    if (newIsRecurring) {
      payload.isRecurring = true;
      payload.recurrenceFrequency = newRecurrenceFrequency;
      payload.recurrenceInterval = newRecurrenceInterval;
      if (newRecurrenceFrequency === "weekly" && newRecurrenceDaysOfWeek.length > 0) {
        payload.recurrenceDaysOfWeek = newRecurrenceDaysOfWeek.join(",");
      }
      if (newRecurrenceEndDate) {
        payload.recurrenceEndDate = newRecurrenceEndDate;
      }
    }
    createTaskMutation.mutate(payload);
  };


  const toggleStatus = (s: TaskStatus) => {
    setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const togglePriority = (p: Priority) => {
    setPriorityFilter((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTasks.map((t) => t.id)));
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const startEditing = (taskId: number, field: string, currentValue: string) => {
    setEditingField({ taskId, field });
    setEditingValue(currentValue);
  };

  const saveEditing = () => {
    if (!editingField) return;
    const { taskId, field } = editingField;
    const value = editingValue.trim();
    if (field === "title" && !value) {
      setEditingField(null);
      return;
    }
    const update: Record<string, unknown> = { id: taskId };
    if (field === "title") update.title = value;
    else if (field === "tag") update.tag = value || null;
    else if (field === "notes") update.notes = value || null;
    else if (field === "dueDate") update.dueAt = value ? new Date(value + "T00:00:00").toISOString() : null;
    else if (field === "plannedForDate") update.plannedForDate = value || null;
    else if (field === "projectName") update.projectName = value || null;
    updateTaskMutation.mutate(update as any);
    setEditingField(null);
  };

  const cancelEditing = () => {
    setEditingField(null);
    setEditingValue("");
  };

  const handleAddPriority = () => {
    const title = newPriorityForm.title.trim();
    if (!title) return;
    createPriorityMutation.mutate({
      title,
      severity: newPriorityForm.severity,
      department: newPriorityForm.department || null,
      linkedProjectName: newPriorityForm.linkedProjectName || null,
      horizon: "week",
      status: "active",
    });
  };

  const projects = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => { if (t.projectName) set.add(t.projectName); });
    return Array.from(set).sort();
  }, [tasks]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => { if (t.tag) set.add(t.tag); });
    return Array.from(set).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    if (debouncedSearch.trim()) {
      const lower = debouncedSearch.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(lower));
    }
    if (statusFilter.length > 0) {
      result = result.filter((t) => statusFilter.includes(t.status));
    }
    if (priorityFilter.length > 0) {
      result = result.filter((t) => priorityFilter.includes(t.priority));
    }
    if (projectFilter) {
      result = result.filter((t) => t.projectName === projectFilter);
    }
    if (tagFilter) {
      result = result.filter((t) => t.tag === tagFilter);
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "priority":
          cmp = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
          break;
        case "status":
          cmp = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
          break;
        case "dueDate":
          cmp = (a.dueAt || "9999").localeCompare(b.dueAt || "9999");
          break;
        case "createdAt":
          cmp = (a.createdAt || "").localeCompare(b.createdAt || "");
          break;
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });

    return result;
  }, [tasks, debouncedSearch, statusFilter, priorityFilter, projectFilter, tagFilter, sortField, sortDirection]);

  const selectedArray = Array.from(selectedIds);

  const activePriorities = priorities.filter((p) => p.status !== "closed");
  const closedPriorities = priorities.filter((p) => p.status === "closed");

  if (isLoading) {
    return (
      <div className="max-w-[1400px] mx-auto space-y-5" data-testid="loading-skeleton">
        <MyToolNav subtitle="All Tasks" />
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-6 rounded-full" />
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-4 w-14 rounded" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="flex gap-3">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <th key={i} className="px-3 py-2"><Skeleton className="h-3 w-full" /></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map((row) => (
                    <tr key={row} className="border-b border-gray-100 dark:border-gray-800">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <td key={i} className="px-3 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-5" data-testid="mytool-backlog-page">
      <MyToolNav subtitle="All Tasks" />

      {/* Company Priorities Section */}
      <Card data-testid="card-company-priorities">
        <CardHeader className="pb-2">
          <button
            className="flex items-center gap-2 text-left w-full"
            onClick={() => setPrioritiesOpen(!prioritiesOpen)}
            data-testid="toggle-priorities"
          >
            {prioritiesOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            <Flag className="h-4 w-4 text-blue-600" />
            <CardTitle className="text-sm font-semibold">Company Priorities</CardTitle>
            <Badge variant="secondary" className="text-xs ml-1" data-testid="badge-priorities-count">
              {activePriorities.length}
            </Badge>
          </button>
        </CardHeader>
        {prioritiesOpen && (
          <CardContent className="pt-0 space-y-3">
            {activePriorities.length === 0 && !addPriorityOpen && (
              <p className="text-xs text-gray-400 text-center py-2" data-testid="text-no-priorities">No active priorities</p>
            )}
            {activePriorities.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-sm border-b border-gray-100 dark:border-gray-800 pb-2" data-testid={`priority-row-${p.id}`}>
                <select
                  value={p.status}
                  onChange={(e) => updatePriorityMutation.mutate({ id: p.id, status: e.target.value })}
                  className="text-[10px] border rounded px-1 py-0.5 bg-white dark:bg-gray-900"
                  data-testid={`select-priority-status-${p.id}`}
                >
                  <option value="active">active</option>
                  <option value="monitoring">monitoring</option>
                  <option value="closed">closed</option>
                </select>
                <SeverityBadge severity={p.severity} />
                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate" data-testid={`text-priority-title-${p.id}`}>
                  {p.title}
                </span>
                {p.department && (
                  <span className="text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded" data-testid={`text-priority-dept-${p.id}`}>
                    {p.department}
                  </span>
                )}
                {p.linkedProjectName && (
                  <Link
                    href={`/project/${encodeURIComponent(p.linkedProjectName)}`}
                    className="text-[10px] text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
                    data-testid={`link-priority-project-${p.id}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {p.linkedProjectName.replace(/_/g, " ")}
                  </Link>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700"
                  onClick={() => updatePriorityMutation.mutate({ id: p.id, status: "closed" })}
                  title="Close"
                  data-testid={`button-close-priority-${p.id}`}
                >
                  <CheckCircle2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                  onClick={() => deletePriorityMutation.mutate(p.id)}
                  title="Delete"
                  data-testid={`button-delete-priority-${p.id}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}

            {closedPriorities.length > 0 && (
              <div>
                <button
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                  onClick={() => setClosedPrioritiesOpen(!closedPrioritiesOpen)}
                  data-testid="toggle-closed-priorities"
                >
                  {closedPrioritiesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Closed ({closedPriorities.length})
                </button>
                {closedPrioritiesOpen && (
                  <div className="mt-2 space-y-2">
                    {closedPriorities.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 text-sm opacity-60" data-testid={`priority-closed-row-${p.id}`}>
                        <select
                          value={p.status}
                          onChange={(e) => updatePriorityMutation.mutate({ id: p.id, status: e.target.value })}
                          className="text-[10px] border rounded px-1 py-0.5 bg-white dark:bg-gray-900"
                          data-testid={`select-priority-status-closed-${p.id}`}
                        >
                          <option value="active">active</option>
                          <option value="monitoring">monitoring</option>
                          <option value="closed">closed</option>
                        </select>
                        <SeverityBadge severity={p.severity} />
                        <span className="flex-1 text-sm text-gray-400 line-through truncate">{p.title}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                          onClick={() => deletePriorityMutation.mutate(p.id)}
                          title="Delete"
                          data-testid={`button-delete-closed-priority-${p.id}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {addPriorityOpen ? (
              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-100 dark:border-gray-800" data-testid="form-add-priority">
                <Input
                  placeholder="Priority title..."
                  value={newPriorityForm.title}
                  onChange={(e) => setNewPriorityForm({ ...newPriorityForm, title: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleAddPriority()}
                  className="flex-1 text-sm h-8"
                  autoFocus
                  data-testid="input-new-priority-title"
                />
                <select
                  value={newPriorityForm.severity}
                  onChange={(e) => setNewPriorityForm({ ...newPriorityForm, severity: e.target.value as any })}
                  className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900 h-8"
                  data-testid="select-new-priority-severity"
                >
                  <option value="critical">critical</option>
                  <option value="important">important</option>
                  <option value="normal">normal</option>
                </select>
                <Input
                  placeholder="Department"
                  value={newPriorityForm.department}
                  onChange={(e) => setNewPriorityForm({ ...newPriorityForm, department: e.target.value })}
                  className="text-sm h-8 w-32"
                  data-testid="input-new-priority-department"
                />
                <select
                  value={newPriorityForm.linkedProjectName}
                  onChange={(e) => setNewPriorityForm({ ...newPriorityForm, linkedProjectName: e.target.value })}
                  className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900 h-8"
                  data-testid="select-new-priority-project"
                >
                  <option value="">No Project</option>
                  {allProjects.map((p) => (
                    <option key={p.project_name} value={p.project_name}>{p.project_name.replace(/_/g, " ")}</option>
                  ))}
                </select>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={handleAddPriority}
                    disabled={!newPriorityForm.title.trim() || createPriorityMutation.isPending}
                    data-testid="button-submit-new-priority"
                  >
                    Add
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setAddPriorityOpen(false)}
                    data-testid="button-cancel-new-priority"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-gray-500"
                onClick={() => setAddPriorityOpen(true)}
                data-testid="button-add-priority"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Priority
              </Button>
            )}
          </CardContent>
        )}
      </Card>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search tasks..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9 text-sm"
            data-testid="input-search"
          />
          {searchText && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
              onClick={() => setSearchText("")}
              data-testid="button-clear-search"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowStatusFilter(!showStatusFilter); setShowPriorityFilter(false); }}
              className="text-xs"
              data-testid="button-filter-status"
            >
              Status
              {statusFilter.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">{statusFilter.length}</Badge>
              )}
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
            {showStatusFilter && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 p-2 min-w-[160px]" data-testid="dropdown-status-filter">
                {allStatuses.map((s) => (
                  <label key={s} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={statusFilter.includes(s)}
                      onChange={() => toggleStatus(s)}
                      className="rounded"
                      data-testid={`checkbox-status-${s}`}
                    />
                    <StatusBadge status={s} />
                  </label>
                ))}
                <div className="border-t mt-1 pt-1">
                  <Button variant="ghost" size="sm" className="w-full h-6 text-[10px]" onClick={() => setStatusFilter([])} data-testid="button-clear-status-filter">
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowPriorityFilter(!showPriorityFilter); setShowStatusFilter(false); }}
              className="text-xs"
              data-testid="button-filter-priority"
            >
              Priority
              {priorityFilter.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">{priorityFilter.length}</Badge>
              )}
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
            {showPriorityFilter && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 p-2 min-w-[160px]" data-testid="dropdown-priority-filter">
                {allPriorities.map((p) => (
                  <label key={p} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={priorityFilter.includes(p)}
                      onChange={() => togglePriority(p)}
                      className="rounded"
                      data-testid={`checkbox-priority-${p}`}
                    />
                    <SeverityBadge severity={p} />
                  </label>
                ))}
                <div className="border-t mt-1 pt-1">
                  <Button variant="ghost" size="sm" className="w-full h-6 text-[10px]" onClick={() => setPriorityFilter([])} data-testid="button-clear-priority-filter">
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </div>

          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
              data-testid="select-project-filter"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
              ))}
            </select>
          )}

          {tags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
              data-testid="select-tag-filter"
            >
              <option value="">All Tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}

          <Button
            variant="default"
            size="sm"
            className="text-xs"
            onClick={() => setShowCreateForm(!showCreateForm)}
            data-testid="button-create-task"
          >
            <Plus className="h-3 w-3 mr-1" />
            Create Task
          </Button>
        </div>
      </div>

      {showCreateForm && (
        <Card data-testid="card-create-task">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="Task title..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateTask()}
                className="flex-1 text-sm"
                autoFocus
                data-testid="input-new-task-title"
              />
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as Priority)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
                data-testid="select-new-task-priority"
              >
                {allPriorities.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as TaskStatus)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
                data-testid="select-new-task-status"
              >
                {allStatuses.map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleCreateTask}
                  disabled={!newTitle.trim() || createTaskMutation.isPending}
                  data-testid="button-submit-new-task"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateForm(false)}
                  data-testid="button-cancel-new-task"
                >
                  Cancel
                </Button>
              </div>
            </div>
            <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="toggle-recurring">
                <input
                  type="checkbox"
                  checked={newIsRecurring}
                  onChange={(e) => setNewIsRecurring(e.target.checked)}
                  className="rounded"
                  data-testid="checkbox-recurring"
                />
                <Repeat className="h-3.5 w-3.5 text-gray-500" />
                <span className="text-gray-600 dark:text-gray-400">Make recurring</span>
              </label>
              {newIsRecurring && (
                <div className="mt-2 flex flex-col sm:flex-row flex-wrap gap-3 pl-6" data-testid="recurring-fields">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">Every</label>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={newRecurrenceInterval}
                      onChange={(e) => setNewRecurrenceInterval(Math.max(1, parseInt(e.target.value) || 1))}
                      className="h-8 w-16 text-sm"
                      data-testid="input-recurrence-interval"
                    />
                    <select
                      value={newRecurrenceFrequency}
                      onChange={(e) => setNewRecurrenceFrequency(e.target.value)}
                      className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900 h-8"
                      data-testid="select-recurrence-frequency"
                    >
                      <option value="daily">day(s)</option>
                      <option value="weekly">week(s)</option>
                      <option value="monthly">month(s)</option>
                    </select>
                  </div>
                  {newRecurrenceFrequency === "weekly" && (
                    <div className="flex items-center gap-1" data-testid="recurrence-days-of-week">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, idx) => (
                        <label key={day} className="flex flex-col items-center gap-0.5 cursor-pointer">
                          <span className="text-[10px] text-gray-500">{day}</span>
                          <input
                            type="checkbox"
                            checked={newRecurrenceDaysOfWeek.includes(idx)}
                            onChange={() => {
                              setNewRecurrenceDaysOfWeek((prev) =>
                                prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx]
                              );
                            }}
                            className="rounded"
                            data-testid={`checkbox-day-${idx}`}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">End date</label>
                    <Input
                      type="date"
                      value={newRecurrenceEndDate}
                      onChange={(e) => setNewRecurrenceEndDate(e.target.value)}
                      className="h-8 text-sm w-36"
                      data-testid="input-recurrence-end-date"
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedIds.size > 0 && (
        <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800" data-testid="card-bulk-actions">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300" data-testid="text-selected-count">
                {selectedIds.size} selected
              </span>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    bulkUpdateMutation.mutate({ ids: selectedArray, changes: { status: e.target.value } });
                    e.target.value = "";
                  }
                }}
                className="text-xs border rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
                defaultValue=""
                data-testid="select-bulk-status"
              >
                <option value="" disabled>Change Status</option>
                {allStatuses.map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    bulkUpdateMutation.mutate({ ids: selectedArray, changes: { priority: e.target.value } });
                    e.target.value = "";
                  }
                }}
                className="text-xs border rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
                defaultValue=""
                data-testid="select-bulk-priority"
              >
                <option value="" disabled>Change Priority</option>
                {allPriorities.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <Button
                variant="destructive"
                size="sm"
                className="text-xs"
                onClick={() => bulkDeleteMutation.mutate(selectedArray)}
                disabled={bulkDeleteMutation.isPending}
                data-testid="button-bulk-delete"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setSelectedIds(new Set())}
                data-testid="button-clear-selection"
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {filteredTasks.length === 0 ? (
        <Card data-testid="card-empty-state">
          <CardContent className="p-12 text-center">
            <Inbox className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-2" data-testid="text-empty-title">
              {tasks.length === 0 ? "No tasks yet" : "No matching tasks"}
            </h3>
            <p className="text-sm text-gray-400 mb-4" data-testid="text-empty-description">
              {tasks.length === 0
                ? "Start by adding tasks from your Today page."
                : "Try adjusting your filters or search term."}
            </p>
            {tasks.length === 0 && (
              <Link href="/my-tool">
                <Button variant="outline" size="sm" data-testid="button-go-to-today">
                  <Target className="h-4 w-4 mr-2" />
                  Go to Today
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="hidden md:block">
            <Card data-testid="card-backlog-table">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-backlog">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-3 py-2 text-left w-8">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === filteredTasks.length && filteredTasks.length > 0}
                            onChange={toggleSelectAll}
                            className="rounded"
                            data-testid="checkbox-select-all"
                          />
                        </th>
                        <th className="px-3 py-2 text-left">
                          <button onClick={() => handleSort("priority")} className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase" data-testid="sort-priority">
                            Priority <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Title</th>
                        <th className="px-3 py-2 text-left">
                          <button onClick={() => handleSort("status")} className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase" data-testid="sort-status">
                            Status <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Project</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Tag</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Planned</th>
                        <th className="px-3 py-2 text-left">
                          <button onClick={() => handleSort("dueDate")} className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase" data-testid="sort-due-date">
                            Due <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Notes</th>
                        <th className="px-3 py-2 text-left">
                          <button onClick={() => handleSort("createdAt")} className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase" data-testid="sort-created">
                            Created <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((task) => (
                        <tr
                          key={task.id}
                          className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${selectedIds.has(task.id) ? "bg-blue-50 dark:bg-blue-900/10" : ""}`}
                          data-testid={`backlog-row-${task.id}`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(task.id)}
                              onChange={() => toggleSelect(task.id)}
                              className="rounded"
                              data-testid={`checkbox-task-${task.id}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={task.priority}
                              onChange={(e) => updateTaskMutation.mutate({ id: task.id, priority: e.target.value })}
                              className="text-[10px] border-0 bg-transparent cursor-pointer p-0"
                              data-testid={`select-priority-${task.id}`}
                            >
                              {allPriorities.map((p) => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                            <SeverityBadge severity={task.priority} />
                          </td>
                          {/* Title - inline editable */}
                          <td className="px-3 py-2">
                            {editingField?.taskId === task.id && editingField.field === "title" ? (
                              <Input
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onBlur={saveEditing}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEditing();
                                  if (e.key === "Escape") cancelEditing();
                                }}
                                className="h-7 text-sm"
                                autoFocus
                                data-testid={`input-edit-title-${task.id}`}
                              />
                            ) : (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => startEditing(task.id, "title", task.title)}
                                  className={`text-sm text-left flex-1 hover:bg-gray-100 dark:hover:bg-gray-800 px-1 py-0.5 rounded ${task.status === "done" ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`}
                                  data-testid={`text-task-title-${task.id}`}
                                >
                                  {task.title}
                                </button>
                                {task.isRecurring && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 border border-purple-200 shrink-0" data-testid={`badge-recurring-${task.id}`}>
                                    <Repeat className="h-2.5 w-2.5" />
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={task.status}
                              onChange={(e) => updateTaskMutation.mutate({ id: task.id, status: e.target.value })}
                              className="text-[10px] border-0 bg-transparent cursor-pointer p-0"
                              data-testid={`select-status-${task.id}`}
                            >
                              {allStatuses.map((s) => (
                                <option key={s} value={s}>{s.replace("_", " ")}</option>
                              ))}
                            </select>
                          </td>
                          {/* Project - inline editable */}
                          <td className="px-3 py-2">
                            {editingField?.taskId === task.id && editingField.field === "projectName" ? (
                              <select
                                value={editingValue}
                                onChange={(e) => {
                                  setEditingValue(e.target.value);
                                  updateTaskMutation.mutate({ id: task.id, projectName: e.target.value || null });
                                  setEditingField(null);
                                }}
                                onBlur={() => setEditingField(null)}
                                className="text-xs border rounded px-1 py-0.5 bg-white dark:bg-gray-900 w-full"
                                autoFocus
                                data-testid={`select-edit-project-${task.id}`}
                              >
                                <option value="">None</option>
                                {allProjects.map((p) => (
                                  <option key={p.project_name} value={p.project_name}>{p.project_name.replace(/_/g, " ")}</option>
                                ))}
                              </select>
                            ) : (
                              <button
                                onClick={() => startEditing(task.id, "projectName", task.projectName || "")}
                                className="text-xs text-left w-full hover:bg-gray-100 dark:hover:bg-gray-800 px-1 py-0.5 rounded"
                                data-testid={`button-edit-project-${task.id}`}
                              >
                                {task.projectName ? (
                                  <span className="text-blue-600 flex items-center gap-1">
                                    <ExternalLink className="h-3 w-3" />
                                    {task.projectName.replace(/_/g, " ")}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </button>
                            )}
                          </td>
                          {/* Tag - inline editable */}
                          <td className="px-3 py-2">
                            {editingField?.taskId === task.id && editingField.field === "tag" ? (
                              <Input
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onBlur={saveEditing}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEditing();
                                  if (e.key === "Escape") cancelEditing();
                                }}
                                className="h-6 text-xs w-24"
                                autoFocus
                                data-testid={`input-edit-tag-${task.id}`}
                              />
                            ) : (
                              <button
                                onClick={() => startEditing(task.id, "tag", task.tag || "")}
                                className="text-left w-full hover:bg-gray-100 dark:hover:bg-gray-800 px-1 py-0.5 rounded"
                                data-testid={`button-edit-tag-${task.id}`}
                              >
                                {task.tag ? (
                                  <Badge variant="outline" className="text-[10px]" data-testid={`badge-tag-${task.id}`}>{task.tag}</Badge>
                                ) : (
                                  <span className="text-xs text-gray-400">—</span>
                                )}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {editingField?.taskId === task.id && editingField.field === "plannedForDate" ? (
                              <Input
                                type="date"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                className="h-6 text-xs w-32"
                                autoFocus
                                onBlur={saveEditing}
                                onKeyDown={(e) => { if (e.key === "Enter") saveEditing(); if (e.key === "Escape") cancelEditing(); }}
                                data-testid={`input-planned-date-${task.id}`}
                              />
                            ) : (
                              <button
                                onClick={() => startEditing(task.id, "plannedForDate", task.plannedForDate || "")}
                                className="text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 flex items-center gap-1"
                                data-testid={`button-set-planned-${task.id}`}
                              >
                                <Calendar className="h-3 w-3" />
                                {task.plannedForDate ? format(new Date(task.plannedForDate + "T00:00:00"), "d MMM") : "Set date"}
                              </button>
                            )}
                          </td>
                          {/* Due Date - inline editable */}
                          <td className="px-3 py-2">
                            {editingField?.taskId === task.id && editingField.field === "dueDate" ? (
                              <Input
                                type="date"
                                value={editingValue}
                                onChange={(e) => {
                                  setEditingValue(e.target.value);
                                }}
                                onBlur={saveEditing}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEditing();
                                  if (e.key === "Escape") cancelEditing();
                                }}
                                className="h-6 text-xs w-32"
                                autoFocus
                                data-testid={`input-edit-duedate-${task.id}`}
                              />
                            ) : (
                              <button
                                onClick={() => startEditing(task.id, "dueDate", task.dueAt ? format(new Date(task.dueAt), "yyyy-MM-dd") : "")}
                                className="text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 px-1 py-0.5 rounded"
                                data-testid={`button-edit-duedate-${task.id}`}
                              >
                                {task.dueAt ? format(new Date(task.dueAt), "d MMM") : "—"}
                              </button>
                            )}
                          </td>
                          {/* Notes - inline editable */}
                          <td className="px-3 py-2">
                            {editingField?.taskId === task.id && editingField.field === "notes" ? (
                              <Textarea
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onBlur={saveEditing}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") cancelEditing();
                                }}
                                className="text-xs min-h-[60px] w-40"
                                autoFocus
                                data-testid={`textarea-edit-notes-${task.id}`}
                              />
                            ) : (
                              <button
                                onClick={() => startEditing(task.id, "notes", task.notes || "")}
                                className="text-xs text-left w-full max-w-[120px] hover:bg-gray-100 dark:hover:bg-gray-800 px-1 py-0.5 rounded truncate block"
                                title={task.notes || "Add notes"}
                                data-testid={`button-edit-notes-${task.id}`}
                              >
                                {task.notes ? (
                                  <span className="text-gray-600 dark:text-gray-400">{task.notes}</span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {task.createdAt ? format(new Date(task.createdAt), "d MMM") : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-blue-500 hover:text-blue-700"
                                onClick={() => { setEmailPickerTaskId(task.id); setEmailPickerTaskTitle(task.title); }}
                                title="Link email"
                                data-testid={`button-email-${task.id}`}
                              >
                                <Mail className="h-3 w-3" />
                              </Button>
                              {task.status !== "done" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700"
                                  onClick={() => updateTaskMutation.mutate({ id: task.id, status: "done" })}
                                  title="Mark done"
                                  data-testid={`button-done-${task.id}`}
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                                onClick={() => deleteTaskMutation.mutate(task.id)}
                                disabled={deleteTaskMutation.isPending}
                                title="Delete"
                                data-testid={`button-delete-${task.id}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="md:hidden space-y-2" data-testid="backlog-card-list">
            {filteredTasks.map((task) => (
              <Card
                key={task.id}
                className={selectedIds.has(task.id) ? "ring-2 ring-blue-500" : ""}
                data-testid={`backlog-card-${task.id}`}
              >
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(task.id)}
                      onChange={() => toggleSelect(task.id)}
                      className="rounded mt-1"
                      data-testid={`checkbox-task-mobile-${task.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <SeverityBadge severity={task.priority} />
                        <StatusBadge status={task.status} />
                      </div>
                      {editingField?.taskId === task.id && editingField.field === "title" ? (
                        <Input
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEditing}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditing();
                            if (e.key === "Escape") cancelEditing();
                          }}
                          className="h-7 text-sm"
                          autoFocus
                          data-testid={`input-edit-title-mobile-${task.id}`}
                        />
                      ) : (
                        <div className="flex items-center gap-1 w-full">
                          <button
                            onClick={() => startEditing(task.id, "title", task.title)}
                            className={`text-sm font-medium text-left flex-1 ${task.status === "done" ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`}
                            data-testid={`text-task-title-mobile-${task.id}`}
                          >
                            {task.title}
                          </button>
                          {task.isRecurring && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 border border-purple-200 shrink-0" data-testid={`badge-recurring-mobile-${task.id}`}>
                              <Repeat className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-gray-500">
                        {task.projectName && (
                          <Link
                            href={`/project/${encodeURIComponent(task.projectName)}`}
                            className="text-blue-600 flex items-center gap-1"
                            data-testid={`link-project-mobile-${task.id}`}
                          >
                            <ExternalLink className="h-3 w-3" />
                            {task.projectName.replace(/_/g, " ")}
                          </Link>
                        )}
                        {task.tag && <Badge variant="outline" className="text-[10px]">{task.tag}</Badge>}
                        {task.plannedForDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(task.plannedForDate + "T00:00:00"), "d MMM")}
                          </span>
                        )}
                        {task.dueAt && (
                          <span className="flex items-center gap-1 text-orange-600">
                            Due: {format(new Date(task.dueAt), "d MMM")}
                          </span>
                        )}
                      </div>
                      {task.notes && (
                        <p className="text-xs text-gray-400 mt-1 truncate" data-testid={`text-notes-mobile-${task.id}`}>{task.notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 justify-end border-t pt-2">
                    <select
                      value={task.status}
                      onChange={(e) => updateTaskMutation.mutate({ id: task.id, status: e.target.value })}
                      className="text-xs border rounded px-1.5 py-1 bg-white dark:bg-gray-900"
                      data-testid={`select-status-mobile-${task.id}`}
                    >
                      {allStatuses.map((s) => (
                        <option key={s} value={s}>{s.replace("_", " ")}</option>
                      ))}
                    </select>
                    <select
                      value={task.priority}
                      onChange={(e) => updateTaskMutation.mutate({ id: task.id, priority: e.target.value })}
                      className="text-xs border rounded px-1.5 py-1 bg-white dark:bg-gray-900"
                      data-testid={`select-priority-mobile-${task.id}`}
                    >
                      {allPriorities.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-blue-500"
                      onClick={() => { setEmailPickerTaskId(task.id); setEmailPickerTaskTitle(task.title); }}
                      data-testid={`button-email-mobile-${task.id}`}
                    >
                      <Mail className="h-3.5 w-3.5" />
                    </Button>
                    {task.status !== "done" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-emerald-600"
                        onClick={() => updateTaskMutation.mutate({ id: task.id, status: "done" })}
                        data-testid={`button-done-mobile-${task.id}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-500"
                      onClick={() => deleteTaskMutation.mutate(task.id)}
                      data-testid={`button-delete-mobile-${task.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center justify-between text-xs text-gray-400 pb-4">
        <span data-testid="text-task-count">
          {filteredTasks.length} of {tasks.length} tasks
        </span>
        <div className="flex gap-2">
          <button onClick={() => handleSort("priority")} className={`hover:text-gray-600 ${sortField === "priority" ? "text-blue-600 font-medium" : ""}`} data-testid="sort-footer-priority">
            Priority {sortField === "priority" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
          <button onClick={() => handleSort("status")} className={`hover:text-gray-600 ${sortField === "status" ? "text-blue-600 font-medium" : ""}`} data-testid="sort-footer-status">
            Status {sortField === "status" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
          <button onClick={() => handleSort("dueDate")} className={`hover:text-gray-600 ${sortField === "dueDate" ? "text-blue-600 font-medium" : ""}`} data-testid="sort-footer-due">
            Due {sortField === "dueDate" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
          <button onClick={() => handleSort("createdAt")} className={`hover:text-gray-600 ${sortField === "createdAt" ? "text-blue-600 font-medium" : ""}`} data-testid="sort-footer-created">
            Created {sortField === "createdAt" && (sortDirection === "asc" ? "↑" : "↓")}
          </button>
        </div>
      </div>

      {emailPickerTaskId !== null && (
        <EmailPickerDialog
          open={true}
          onOpenChange={(open) => { if (!open) { setEmailPickerTaskId(null); setEmailPickerTaskTitle(""); } }}
          taskId={emailPickerTaskId}
          taskTitle={emailPickerTaskTitle}
        />
      )}
    </div>
  );
}

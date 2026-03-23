import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { PageShell, SectionHeader, FilterBar } from "@/components/layout/page-shell";
import {
  LayoutGrid, List, Calendar as CalendarIcon, BarChart3, Plus, Search,
  CheckCircle2, AlertTriangle, Loader2, Timer, ChevronLeft, ChevronRight,
  Bug, Lightbulb, Sparkles, Circle,
} from "lucide-react";

// ── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

interface TaskItem {
  id: number;
  projectId: number;
  workstream: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  startDate: string | null;
  endDate: string | null;
  percentComplete: number | null;
  ownerUserId: number | null;
  ownerName: string | null;
  estimateMinutes: number | null;
  taskCategory: string | null;
  isMilestone: boolean;
  phase: string | null;
  scheduledDate: string | null;
  createdAt: string;
  updatedAt: string;
  tags: { id: number; name: string; color: string; category: string }[];
}

interface TasksResponse {
  items: TaskItem[];
  total: number;
  limit: number;
  offset: number;
}

interface BoardData {
  [status: string]: TaskItem[];
}

interface MetricsData {
  statusBreakdown: { status: string; count: number }[];
  priorityBreakdown: { priority: string; count: number }[];
  categoryBreakdown: { category: string; count: number }[];
  workstreamBreakdown: { workstream: string; count: number }[];
  completionVelocity: number;
  totalTimeLoggedMinutes: number;
  lookbackDays: number;
}

// ── Color maps aligned with engineering-dashboard ────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-slate-100 text-slate-700",
  "In Progress": "bg-blue-100 text-blue-700",
  "Complete": "bg-emerald-100 text-emerald-700",
  "Delayed": "bg-red-100 text-red-700",
};

const PRIORITY_COLORS: Record<string, string> = {
  "Critical": "text-red-600",
  "Urgent": "text-red-600",
  "High": "text-orange-600",
  "Medium": "text-amber-600",
  "Low": "text-muted-foreground",
};

const PRIORITY_BORDER: Record<string, string> = {
  "Critical": "border-l-red-600",
  "Urgent": "border-l-red-500",
  "High": "border-l-orange-500",
  "Medium": "border-l-amber-400",
  "Low": "border-l-gray-300",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "BUG": <Bug className="h-3.5 w-3.5" />,
  "IMPROVEMENT": <Lightbulb className="h-3.5 w-3.5" />,
  "FEATURE": <Sparkles className="h-3.5 w-3.5" />,
};

// ── Task Card Component ──────────────────────────────────────────────────────

function TaskCard({ task, onStatusChange }: { task: TaskItem; onStatusChange: (id: number, status: string) => void }) {
  const borderClass = PRIORITY_BORDER[task.priority || ""] || "border-l-gray-200";

  return (
    <Card className={`hover:bg-muted/40 transition-all cursor-pointer border-l-3 ${borderClass}`}>
      <CardContent className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight line-clamp-2">{task.title}</p>
          {task.taskCategory && (
            <span className="shrink-0 text-muted-foreground">
              {CATEGORY_ICONS[task.taskCategory] || null}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {task.priority && (
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLORS[task.priority] || ""}`}>
              {task.priority}
            </Badge>
          )}
          {task.tags.map((tag) => (
            <Badge key={tag.id} variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </Badge>
          ))}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate max-w-[120px]">{task.ownerName || "Unassigned"}</span>
          <div className="flex items-center gap-2">
            {task.estimateMinutes != null && task.estimateMinutes > 0 && (
              <span className="flex items-center gap-0.5">
                <Timer className="h-3 w-3" />
                {Math.round(task.estimateMinutes / 60)}h
              </span>
            )}
            {task.endDate && (
              <span className="flex items-center gap-0.5">
                <CalendarIcon className="h-3 w-3" />
                {task.endDate.slice(5)}
              </span>
            )}
          </div>
        </div>

        {task.percentComplete != null && task.percentComplete > 0 && (
          <div className="w-full bg-muted rounded-full h-1">
            <div
              className="bg-primary h-1 rounded-full transition-all"
              style={{ width: `${Math.min(100, task.percentComplete)}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Kanban Board View ────────────────────────────────────────────────────────

function BoardView({ filters }: { filters: Record<string, string> }) {
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.set(k, v);
  }

  const { data: boardData, isLoading, isError, error, refetch } = useQuery<BoardData>({
    queryKey: ["tasks-board", filters],
    queryFn: () => apiFetch(`/api/tasks/board?${params}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-board"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Failed to load board data"}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const columns = ["Not Started", "In Progress", "Complete", "Delayed"];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {columns.map((status) => {
        const items = boardData?.[status] || [];
        return (
          <div key={status} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`${STATUS_COLORS[status]} text-[10px] font-semibold`}>
                  {status}
                </Badge>
                <span className="text-[10px] font-bold text-muted-foreground px-1.5 py-0.5 rounded-full bg-muted">{items.length}</span>
              </div>
            </div>
            <div className="bg-muted/30 rounded-lg p-2 min-h-[200px] space-y-2">
              {items.map((task: TaskItem) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onStatusChange={(id, newStatus) => updateMutation.mutate({ id, status: newStatus })}
                />
              ))}
              {items.length === 0 && (
                <div className="ee-empty-state min-h-[160px]">
                  <p className="text-sm text-muted-foreground">No tasks in this column</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── List View ────────────────────────────────────────────────────────────────

function ListView({ filters }: { filters: Record<string, string> }) {
  const [sortBy, setSortBy] = useState("updatedAt");
  const [sortDir, setSortDir] = useState("desc");

  const params = new URLSearchParams({ ...filters, sortBy, sortDir, limit: "100" });

  const { data, isLoading, isError, error, refetch } = useQuery<TasksResponse>({
    queryKey: ["tasks", filters, sortBy, sortDir],
    queryFn: () => apiFetch(`/api/tasks?${params}`),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Failed to load tasks"}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const items = data?.items || [];

  return (
    <Card className="overflow-hidden">
      <div className="bg-muted px-4 py-2 grid grid-cols-[1fr_100px_100px_120px_100px_80px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Title</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Assignee</span>
        <span>Due Date</span>
        <span>Category</span>
      </div>
      <ScrollArea className="max-h-[600px]">
        {items.map((task) => {
          const borderClass = PRIORITY_BORDER[task.priority || ""] || "border-l-gray-200";
          return (
            <div key={task.id} className={`px-4 py-2.5 grid grid-cols-[1fr_100px_100px_120px_100px_80px] gap-2 items-center border-b last:border-b-0 hover:bg-muted/40 transition-all border-l-3 ${borderClass}`}>
              <div className="flex items-center gap-2 min-w-0">
                <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm truncate">{task.title}</span>
                {task.tags.length > 0 && (
                  <div className="flex gap-0.5">
                    {task.tags.slice(0, 2).map((tag) => (
                      <span key={tag.id} className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} title={tag.name} />
                    ))}
                  </div>
                )}
              </div>
              <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[task.status] || ""} w-fit`}>
                {task.status}
              </Badge>
              <span className={`text-xs ${PRIORITY_COLORS[task.priority || ""] || ""}`}>{task.priority || "—"}</span>
              <span className="text-xs truncate">{task.ownerName || "—"}</span>
              <span className="text-xs text-muted-foreground">{task.endDate?.slice(0, 10) || "—"}</span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                {task.taskCategory ? CATEGORY_ICONS[task.taskCategory] : "—"}
              </span>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="ee-empty-state">
            <p className="text-sm font-medium">No tasks match your filters</p>
            <p className="text-xs text-muted-foreground mt-1">Try adjusting the status, priority, or category filters</p>
          </div>
        )}
      </ScrollArea>
      <div className="bg-muted/50 px-4 py-2 text-[11px] text-muted-foreground border-t">
        Showing {items.length} of {data?.total || 0} tasks
      </div>
    </Card>
  );
}

// ── Calendar View ────────────────────────────────────────────────────────────

function CalendarView({ filters }: { filters: Record<string, string> }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const [year, monthNum] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const lastDay = new Date(year, monthNum, 0).getDate();
  const endDate = `${month}-${lastDay}`;

  const params = new URLSearchParams({ ...filters, startDate, endDate });

  const { data: calendarData, isLoading, isError, error, refetch } = useQuery<Record<string, TaskItem[]>>({
    queryKey: ["tasks-calendar", month, filters],
    queryFn: () => apiFetch(`/api/tasks/calendar?${params}`),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Failed to load calendar data"}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const firstDayOfWeek = new Date(year, monthNum - 1, 1).getDay();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
  for (let d = 1; d <= lastDay; d++) days.push(d);

  const prevMonth = () => {
    const d = new Date(year, monthNum - 2, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nextMonth = () => {
    const d = new Date(year, monthNum, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={prevMonth} className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <h3 className="text-sm font-semibold tracking-tight">{new Date(year, monthNum - 1).toLocaleString("default", { month: "long", year: "numeric" })}</h3>
        <Button variant="outline" size="sm" onClick={nextMonth} className="gap-1">
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 gap-px bg-border">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="bg-muted px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-center text-muted-foreground">
              {day}
            </div>
          ))}
          {days.map((day, i) => {
            const dateStr = day ? `${month}-${String(day).padStart(2, "0")}` : "";
            const dayTasks = dateStr && calendarData ? calendarData[dateStr] || [] : [];
            const isToday = dateStr === new Date().toISOString().split("T")[0];

            return (
              <div key={i} className={`bg-background min-h-[80px] p-1.5 ${!day ? "bg-muted/30" : ""}`}>
                {day && (
                  <>
                    <span className={`text-[11px] font-semibold ${isToday ? "bg-primary text-primary-foreground rounded-full px-1.5 py-0.5" : "text-muted-foreground"}`}>
                      {day}
                    </span>
                    <div className="mt-1 space-y-0.5">
                      {dayTasks.slice(0, 3).map((task) => (
                        <div key={task.id} className="text-[10px] truncate px-1 py-0.5 rounded bg-primary/10 text-primary font-medium" title={task.title}>
                          {task.title}
                        </div>
                      ))}
                      {dayTasks.length > 3 && (
                        <span className="text-[10px] text-muted-foreground font-medium px-1">+{dayTasks.length - 3} more</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── Metrics View ─────────────────────────────────────────────────────────────

function MetricsView({ filters }: { filters: Record<string, string> }) {
  const params = new URLSearchParams(filters);

  const { data: metrics, isLoading, isError, error, refetch } = useQuery<MetricsData>({
    queryKey: ["tasks-metrics", filters],
    queryFn: () => apiFetch(`/api/tasks/metrics?${params}`),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Failed to load metrics"}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!metrics) return null;

  const totalTasks = metrics.statusBreakdown.reduce((sum, s) => sum + s.count, 0);
  const completedTasks = metrics.statusBreakdown.find((s) => s.status === "Complete")?.count || 0;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Tasks</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{totalTasks}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Completion Rate</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{completionRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Completed ({metrics.lookbackDays}d)</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{metrics.completionVelocity}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Time Logged ({metrics.lookbackDays}d)</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{Math.round(metrics.totalTimeLoggedMinutes / 60)}h</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="px-4 py-3 pb-2"><CardTitle className="ee-section-title">By Status</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {metrics.statusBreakdown.map((s) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <Badge variant="outline" className={`${STATUS_COLORS[s.status] || ""} text-[10px] font-semibold`}>
                  {s.status}
                </Badge>
                <span className="font-semibold tabular-nums">{s.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 py-3 pb-2"><CardTitle className="ee-section-title">By Priority</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {metrics.priorityBreakdown.map((p) => (
              <div key={p.priority || "none"} className="flex items-center justify-between text-sm">
                <span className={PRIORITY_COLORS[p.priority || ""] || "text-muted-foreground"}>{p.priority || "Unset"}</span>
                <span className="font-semibold tabular-nums">{p.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 py-3 pb-2"><CardTitle className="ee-section-title">By Category</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {metrics.categoryBreakdown.map((c) => (
              <div key={c.category || "none"} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  {CATEGORY_ICONS[c.category] || null}
                  {c.category || "Unset"}
                </span>
                <span className="font-semibold tabular-nums">{c.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 py-3 pb-2"><CardTitle className="ee-section-title">By Workstream</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {metrics.workstreamBreakdown.map((w) => (
              <div key={w.workstream} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{w.workstream}</span>
                <span className="font-semibold tabular-nums">{w.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Create Task Dialog ───────────────────────────────────────────────────────

function CreateTaskDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [taskCategory, setTaskCategory] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const { toast } = useToast();

  const { data: allProjects = [] } = useQuery<Array<{ id: number; projectName: string; isActive?: boolean }>>({
    queryKey: ["/api/project-info"],
    select: (data: any[]) =>
      data
        .filter((p: any) => p.isActive !== false)
        .map((p: any) => ({ id: p.id, projectName: p.projectName || p.project_name }))
        .filter((p) => p.id && p.projectName)
        .sort((a, b) => a.projectName.localeCompare(b.projectName)),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiFetch("/api/tasks", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Task created" });
      setOpen(false);
      setTitle("");
      setDescription("");
      setSelectedProjectId("");
      onCreated();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleCreate = () => {
    if (!title.trim() || !selectedProjectId) return;
    createMutation.mutate({
      projectId: Number(selectedProjectId),
      title: title.trim(),
      description: description.trim() || null,
      priority,
      taskCategory: taskCategory || null,
      status: "Not Started",
      workstream: "ENG",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Project</Label>
            <SearchableSelect
              value={selectedProjectId}
              onValueChange={setSelectedProjectId}
              placeholder="Select a project"
              options={allProjects.map((p) => ({ value: String(p.id), label: p.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ") }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the task" rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Critical">Critical</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={taskCategory} onValueChange={setTaskCategory}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUG">Bug</SelectItem>
                  <SelectItem value="IMPROVEMENT">Improvement</SelectItem>
                  <SelectItem value="FEATURE">Feature</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleCreate} disabled={!title.trim() || !selectedProjectId || createMutation.isPending} className="w-full">
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TaskManagementPage() {
  const [view, setView] = useState<"board" | "list" | "calendar" | "metrics">("board");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const queryClient = useQueryClient();

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (search) f.search = search;
    if (statusFilter && statusFilter !== "all") f.status = statusFilter;
    if (priorityFilter && priorityFilter !== "all") f.priority = priorityFilter;
    if (categoryFilter && categoryFilter !== "all") f.taskCategory = categoryFilter;
    return f;
  }, [search, statusFilter, priorityFilter, categoryFilter]);

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["tasks-board"] });
    queryClient.invalidateQueries({ queryKey: ["tasks-metrics"] });
  };

  const seedMutation = useMutation({
    mutationFn: () => apiFetch("/api/tasks/seed-identified-items", { method: "POST" }),
    onSuccess: () => { handleCreated(); },
  });

  return (
    <PageShell>
      <SectionHeader
        icon={<LayoutGrid className="h-5 w-5" />}
        title="Task Management"
        description="Unified task hub across all departments. Track work items with board, list, calendar, and metrics views."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} className="gap-1.5">
              {seedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bug className="h-4 w-4" />}
              Seed Code Analysis Items
            </Button>
            <CreateTaskDialog onCreated={handleCreated} />
          </div>
        }
      />

      <FilterBar>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Not Started">Not Started</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Complete">Complete</SelectItem>
              <SelectItem value="Delayed">Delayed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[120px]"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              <SelectItem value="Critical">Critical</SelectItem>
              <SelectItem value="High">High</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="BUG">Bug</SelectItem>
              <SelectItem value="IMPROVEMENT">Improvement</SelectItem>
              <SelectItem value="FEATURE">Feature</SelectItem>
            </SelectContent>
          </Select>
          {(statusFilter || priorityFilter || categoryFilter || search) && (
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(""); setPriorityFilter(""); setCategoryFilter(""); setSearch(""); }}>
              Clear filters
            </Button>
          )}
        </div>
      </FilterBar>

      <Tabs value={view} onValueChange={(v) => setView(v as any)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="board" className="gap-1.5">
            <LayoutGrid className="h-4 w-4" />
            Board
          </TabsTrigger>
          <TabsTrigger value="list" className="gap-1.5">
            <List className="h-4 w-4" />
            List
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5">
            <CalendarIcon className="h-4 w-4" />
            Calendar
          </TabsTrigger>
          <TabsTrigger value="metrics" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Metrics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board"><BoardView filters={filters} /></TabsContent>
        <TabsContent value="list"><ListView filters={filters} /></TabsContent>
        <TabsContent value="calendar"><CalendarView filters={filters} /></TabsContent>
        <TabsContent value="metrics"><MetricsView filters={filters} /></TabsContent>
      </Tabs>
    </PageShell>
  );
}

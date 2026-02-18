import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ListTodo,
  Plus,
  Filter,
  Loader2,
  Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

const TASK_STATUSES = [
  "TO DO", "IN PROGRESS", "HOLD", "NEEDS APPROVAL", "QC APPROVED",
  "PROVIDE FEEDBACK", "OPERATIONAL APPROVAL", "PROJECTS ASSISTANCE", "COMPLETE"
];

const PRIORITIES = ["Critical", "Urgent", "High", "Medium", "Low"];

const statusColors: Record<string, string> = {
  "TO DO": "bg-gray-100 text-gray-700",
  "IN PROGRESS": "bg-blue-100 text-blue-700",
  "HOLD": "bg-red-100 text-red-700",
  "NEEDS APPROVAL": "bg-amber-100 text-amber-700",
  "QC APPROVED": "bg-emerald-100 text-emerald-700",
  "PROVIDE FEEDBACK": "bg-purple-100 text-purple-700",
  "OPERATIONAL APPROVAL": "bg-indigo-100 text-indigo-700",
  "PROJECTS ASSISTANCE": "bg-cyan-100 text-cyan-700",
  "COMPLETE": "bg-green-100 text-green-700",
};

const priorityColors: Record<string, string> = {
  Critical: "bg-red-600 text-white",
  Urgent: "bg-orange-100 text-orange-700",
  High: "bg-amber-100 text-amber-700",
  Medium: "bg-blue-100 text-blue-700",
  Low: "bg-gray-100 text-gray-600",
};

interface Task {
  id: number;
  projectName: string;
  title: string;
  status: string;
  priority: string;
  phase: string | null;
  primaryWorkstream: string | null;
  dueDate: string | null;
  percentComplete: number;
  holdReason: string | null;
  createdAt: string;
}

export default function EngineeringTasksPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    projectName: "",
    title: "",
    description: "",
    status: "TO DO",
    priority: "Medium",
    phase: "",
    primaryWorkstream: "",
    dueDate: "",
  });

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["eng-tasks", statusFilter, priorityFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      return engFetch(`/api/eng/tasks?${params}`);
    },
    refetchOnMount: "always",
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: (task: typeof newTask) => engFetch("/api/eng/tasks", {
      method: "POST",
      body: JSON.stringify(task),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks"] });
      setCreateOpen(false);
      setNewTask({ projectName: "", title: "", description: "", status: "TO DO", priority: "Medium", phase: "", primaryWorkstream: "", dueDate: "" });
      toast({ title: "Task created" });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const filtered = tasks.filter(t => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return t.title.toLowerCase().includes(term) || t.projectName.toLowerCase().includes(term);
    }
    return true;
  });

  return (
    <div data-testid="eng-tasks-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <ListTodo className="h-8 w-8 text-blue-500" />
          <div>
            <h2 className="text-2xl sm:text-3xl font-heading font-bold" data-testid="text-tasks-title">Task Board</h2>
            <p className="text-sm text-muted-foreground">Manage engineering tasks across all projects</p>
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-orange-600 hover:bg-orange-700" data-testid="button-create-task">
              <Plus className="h-4 w-4 mr-2" />
              New Task
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create Task</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Project Name</Label>
                <Input
                  data-testid="input-task-project"
                  value={newTask.projectName}
                  onChange={e => setNewTask(p => ({ ...p, projectName: e.target.value }))}
                  placeholder="e.g. Riverside Mall"
                />
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  data-testid="input-task-title"
                  value={newTask.title}
                  onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
                  placeholder="Task title"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  data-testid="input-task-description"
                  value={newTask.description}
                  onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={newTask.priority} onValueChange={v => setNewTask(p => ({ ...p, priority: v }))}>
                    <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input
                    data-testid="input-task-due"
                    type="date"
                    value={newTask.dueDate}
                    onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))}
                  />
                </div>
              </div>
              <Button
                className="w-full bg-orange-600 hover:bg-orange-700"
                data-testid="button-submit-task"
                disabled={!newTask.projectName || !newTask.title || createMutation.isPending}
                onClick={() => createMutation.mutate(newTask)}
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Task
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                data-testid="input-task-search"
                placeholder="Search tasks..."
                className="pl-9"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]" data-testid="filter-task-status">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {TASK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-[140px]" data-testid="filter-task-priority">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-tasks-empty">
              <ListTodo className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No tasks found</p>
              <p className="text-sm mt-1">Create a new task or adjust your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="text-center">Progress</TableHead>
                    <TableHead>Due Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(task => (
                    <TableRow key={task.id} data-testid={`row-task-${task.id}`}>
                      <TableCell className="font-medium max-w-[250px] truncate" data-testid={`text-task-title-${task.id}`}>
                        {task.title}
                        {task.holdReason && (
                          <p className="text-xs text-red-500 truncate mt-0.5">{task.holdReason}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-task-project-${task.id}`}>
                        {task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${statusColors[task.status] || "bg-gray-100 text-gray-700"}`} data-testid={`badge-task-status-${task.id}`}>
                          {task.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${priorityColors[task.priority] || "bg-gray-100 text-gray-600"}`} data-testid={`badge-task-priority-${task.id}`}>
                          {task.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-sm" data-testid={`text-task-progress-${task.id}`}>
                        {task.percentComplete}%
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-task-due-${task.id}`}>
                        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

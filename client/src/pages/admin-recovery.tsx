import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, Loader2, ListTodo, FileUp, FolderCog, Trash2,
  RotateCcw, Edit, CheckCircle, AlertTriangle, Shield,
} from "lucide-react";

function authFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body && typeof options.body === "string") headers["Content-Type"] = "application/json";
  return fetch(url, { ...options, headers, credentials: "include" });
}

function TaskRecoveryTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [taskType, setTaskType] = useState("all");
  const [editingTask, setEditingTask] = useState<any>(null);
  const [editFields, setEditFields] = useState<Record<string, any>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["recovery-tasks", search, taskType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (taskType !== "all") params.set("taskType", taskType);
      params.set("limit", "100");
      const res = await authFetch(`/api/admin/recovery/tasks?${params}`);
      if (!res.ok) throw new Error("Failed to load tasks");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ taskId, taskSource, updates }: { taskId: number; taskSource: string; updates: Record<string, any> }) => {
      const res = await authFetch(`/api/admin/recovery/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ taskSource, ...updates }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task Updated", description: "Task has been updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["recovery-tasks"] });
      setEditingTask(null);
      setEditFields({});
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const tasks = data?.tasks || [];
  const allUsers = data?.users || [];
  const allProjects = data?.projects || [];

  const openEdit = (task: any) => {
    setEditingTask(task);
    setEditFields({
      status: task.status || "",
      title: task.title || "",
      projectName: task.projectName || "",
      ownerUserId: task.ownerUserId || task.assigneeUserId || "",
      dueDate: task.dueDate || "",
      priority: task.priority || "",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks by title..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-recovery-task-search"
          />
        </div>
        <Select value={taskType} onValueChange={setTaskType}>
          <SelectTrigger className="w-[180px]" data-testid="select-recovery-task-type">
            <SelectValue placeholder="Task Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="operational">Operational</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
            <SelectItem value="engineering">Engineering</SelectItem>
            <SelectItem value="work_item">Work Items</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12" data-testid="recovery-tasks-loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No tasks found matching your search.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]" data-testid="recovery-tasks-table">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">ID</th>
                <th className="text-left p-3 font-medium">Title</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Project</th>
                <th className="text-left p-3 font-medium">Owner</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task: any) => {
                const ownerUser = allUsers.find((u: any) => u.id === (task.ownerUserId || task.assigneeUserId));
                return (
                  <tr key={`${task.taskType}-${task.id}`} className="border-t hover:bg-muted/30" data-testid={`recovery-task-row-${task.taskType}-${task.id}`}>
                    <td className="p-3 font-mono text-xs">{task.id}</td>
                    <td className="p-3 truncate max-w-[250px]">{task.title}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">{task.taskType}</Badge>
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary" className="text-xs">{task.status}</Badge>
                    </td>
                    <td className="p-3 text-xs truncate max-w-[150px]">{task.projectName || "—"}</td>
                    <td className="p-3 text-xs">{ownerUser?.name || "—"}</td>
                    <td className="p-3">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => openEdit(task)}
                        data-testid={`button-edit-task-${task.taskType}-${task.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editingTask} onOpenChange={() => { setEditingTask(null); setEditFields({}); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5" />
              Edit Task — {editingTask?.taskType} #{editingTask?.id}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input
                value={editFields.title || ""}
                onChange={(e) => setEditFields(f => ({ ...f, title: e.target.value }))}
                data-testid="input-edit-task-title"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Input
                value={editFields.status || ""}
                onChange={(e) => setEditFields(f => ({ ...f, status: e.target.value }))}
                data-testid="input-edit-task-status"
              />
            </div>
            <div>
              <Label>Project</Label>
              <Select
                value={editFields.projectName || "__none__"}
                onValueChange={(v) => setEditFields(f => ({ ...f, projectName: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-edit-task-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {allProjects.map((p: any) => (
                    <SelectItem key={p.id} value={p.projectName}>{p.projectName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Owner / Assignee</Label>
              <Select
                value={String(editFields.ownerUserId || "__none__")}
                onValueChange={(v) => setEditFields(f => ({ ...f, ownerUserId: v === "__none__" ? null : parseInt(v) }))}
              >
                <SelectTrigger data-testid="select-edit-task-owner">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {allUsers.map((u: any) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Due Date</Label>
              <Input
                type="date"
                value={editFields.dueDate || ""}
                onChange={(e) => setEditFields(f => ({ ...f, dueDate: e.target.value }))}
                data-testid="input-edit-task-due-date"
              />
            </div>
            <div>
              <Label>Priority</Label>
              <Input
                value={editFields.priority || ""}
                onChange={(e) => setEditFields(f => ({ ...f, priority: e.target.value }))}
                data-testid="input-edit-task-priority"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingTask(null); setEditFields({}); }}>Cancel</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={updateMutation.isPending} data-testid="button-save-task-edit">
                  {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Changes
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Recovery Edit</AlertDialogTitle>
                  <AlertDialogDescription>
                    You are about to modify {editingTask?.taskType} task #{editingTask?.id} "{editFields.title}". This action will be audit-logged. Are you sure you want to proceed?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (!editingTask) return;
                      const source = editingTask.taskSource || editingTask.taskType;
                      updateMutation.mutate({
                        taskId: editingTask.id,
                        taskSource: source === "engineering" ? "engineering_task" : source === "work_item" ? "plan" : source,
                        updates: editFields,
                      });
                    }}
                    data-testid="button-confirm-task-edit"
                  >
                    Confirm Edit
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImportRecoveryTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["recovery-imports"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/recovery/imports?limit=50");
      if (!res.ok) throw new Error("Failed to load imports");
      return res.json();
    },
  });

  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const runs = data?.runs || [];

  const statusColor = (status: string) => {
    switch (status) {
      case "COMMITTED": return "bg-green-100 text-green-700";
      case "FAILED": return "bg-red-100 text-red-700";
      case "PREVIEW": return "bg-blue-100 text-blue-700";
      case "ROLLED_BACK": return "bg-orange-100 text-orange-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex items-center justify-center py-12" data-testid="recovery-imports-loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No import runs found.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]" data-testid="recovery-imports-table">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">Run ID</th>
                <th className="text-left p-3 font-medium">File</th>
                <th className="text-left p-3 font-medium">Project</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Uploaded</th>
                <th className="text-left p-3 font-medium">Issues</th>
                <th className="text-left p-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run: any) => (
                <>
                  <tr key={run.id} className="border-t hover:bg-muted/30" data-testid={`recovery-import-row-${run.id}`}>
                    <td className="p-3 font-mono text-xs">{run.id}</td>
                    <td className="p-3 text-xs truncate max-w-[200px]">{run.sourceFileName}</td>
                    <td className="p-3 text-xs truncate max-w-[150px]">{run.projectName}</td>
                    <td className="p-3">
                      <Badge variant="outline" className={`text-xs ${statusColor(run.status)}`}>{run.status}</Badge>
                    </td>
                    <td className="p-3 text-xs whitespace-nowrap">
                      {run.uploadedAt ? new Date(run.uploadedAt).toLocaleString() : "—"}
                    </td>
                    <td className="p-3">
                      {run.issueCount > 0 ? (
                        <Badge variant="destructive" className="text-xs">{run.issueCount}</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">0</Badge>
                      )}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                        data-testid={`button-expand-import-${run.id}`}
                      >
                        {expandedRun === run.id ? "Hide" : "View"}
                      </Button>
                    </td>
                  </tr>
                  {expandedRun === run.id && run.issues.length > 0 && (
                    <tr key={`issues-${run.id}`} className="bg-muted/20">
                      <td colSpan={7} className="p-3">
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {run.issues.map((issue: any) => (
                            <div key={issue.id} className="flex items-start gap-2 text-xs border rounded p-2 bg-background">
                              <Badge variant={issue.severity === "BLOCKER" ? "destructive" : issue.severity === "WARNING" ? "outline" : "secondary"} className="text-xs shrink-0">
                                {issue.severity}
                              </Badge>
                              <div>
                                <span className="font-medium">[{issue.section}]</span> {issue.message}
                                {issue.suggestedAction && (
                                  <p className="text-muted-foreground mt-1">Suggestion: {issue.suggestedAction}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProjectRecoveryTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingProject, setEditingProject] = useState<any>(null);
  const [editFields, setEditFields] = useState<Record<string, any>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["recovery-projects", search],
    queryFn: async () => {
      const res = await authFetch("/api/admin/recovery/tasks?taskType=__projects_only__&limit=0");
      if (!res.ok) throw new Error("Failed to load");
      const d = await res.json();
      return d.projects || [];
    },
  });

  const { data: projectsDetail, isLoading: projectsLoading } = useQuery({
    queryKey: ["recovery-projects-detail"],
    queryFn: async () => {
      const res = await authFetch("/api/project-info");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ projectId, updates }: { projectId: number; updates: Record<string, any> }) => {
      const res = await authFetch(`/api/admin/recovery/project/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Project Updated", description: "Project has been updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["recovery-projects"] });
      queryClient.invalidateQueries({ queryKey: ["recovery-projects-detail"] });
      setEditingProject(null);
      setEditFields({});
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const projects = (projectsDetail || []).filter((p: any) =>
    !search || p.projectName?.toLowerCase().includes(search.toLowerCase())
  );

  const openEdit = (project: any) => {
    setEditingProject(project);
    setEditFields({
      projectName: project.projectName || "",
      pm: project.pm || "",
      pd: project.pd || "",
      phase: project.phase || "",
      executionPhase: project.executionPhase || "",
      ragStatus: project.ragStatus || "",
      ragComment: project.ragComment || "",
      isActive: project.isActive,
      sizeKwp: project.sizeKwp ?? "",
      contractValue: project.contractValue ?? "",
      clientId: project.clientId ?? "",
    });
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-recovery-project-search"
        />
      </div>

      {projectsLoading ? (
        <div className="flex items-center justify-center py-12" data-testid="recovery-projects-loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No projects found.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]" data-testid="recovery-projects-table">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">ID</th>
                <th className="text-left p-3 font-medium">Project Name</th>
                <th className="text-left p-3 font-medium">Phase</th>
                <th className="text-left p-3 font-medium">PM</th>
                <th className="text-left p-3 font-medium">PD</th>
                <th className="text-left p-3 font-medium">RAG</th>
                <th className="text-left p-3 font-medium">Active</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project: any) => (
                <tr key={project.id} className="border-t hover:bg-muted/30" data-testid={`recovery-project-row-${project.id}`}>
                  <td className="p-3 font-mono text-xs">{project.id}</td>
                  <td className="p-3 text-xs truncate max-w-[200px]">{project.projectName}</td>
                  <td className="p-3 text-xs">{project.executionPhase || project.phase || "—"}</td>
                  <td className="p-3 text-xs">{project.pm || "—"}</td>
                  <td className="p-3 text-xs">{project.pd || "—"}</td>
                  <td className="p-3">
                    <Badge variant={project.ragStatus === "Green" ? "secondary" : project.ragStatus === "Red" ? "destructive" : "outline"} className="text-xs">
                      {project.ragStatus || "—"}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {project.isActive ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                    )}
                  </td>
                  <td className="p-3">
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => openEdit(project)}
                      data-testid={`button-edit-project-${project.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editingProject} onOpenChange={() => { setEditingProject(null); setEditFields({}); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderCog className="h-5 w-5" />
              Edit Project #{editingProject?.id}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Project Name</Label>
              <Input
                value={editFields.projectName || ""}
                onChange={(e) => setEditFields(f => ({ ...f, projectName: e.target.value }))}
                data-testid="input-edit-project-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>PM</Label>
                <Input
                  value={editFields.pm || ""}
                  onChange={(e) => setEditFields(f => ({ ...f, pm: e.target.value }))}
                  data-testid="input-edit-project-pm"
                />
              </div>
              <div>
                <Label>PD</Label>
                <Input
                  value={editFields.pd || ""}
                  onChange={(e) => setEditFields(f => ({ ...f, pd: e.target.value }))}
                  data-testid="input-edit-project-pd"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phase</Label>
                <Input
                  value={editFields.phase || ""}
                  onChange={(e) => setEditFields(f => ({ ...f, phase: e.target.value }))}
                  data-testid="input-edit-project-phase"
                />
              </div>
              <div>
                <Label>Execution Phase</Label>
                <Input
                  value={editFields.executionPhase || ""}
                  onChange={(e) => setEditFields(f => ({ ...f, executionPhase: e.target.value }))}
                  data-testid="input-edit-project-exec-phase"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>RAG Status</Label>
                <Select
                  value={editFields.ragStatus || "__none__"}
                  onValueChange={(v) => setEditFields(f => ({ ...f, ragStatus: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger data-testid="select-edit-project-rag">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    <SelectItem value="Green">Green</SelectItem>
                    <SelectItem value="Amber">Amber</SelectItem>
                    <SelectItem value="Red">Red</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={editFields.isActive ?? true}
                    onCheckedChange={(v) => setEditFields(f => ({ ...f, isActive: !!v }))}
                    data-testid="checkbox-edit-project-active"
                  />
                  <Label>Active</Label>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Size (kWp)</Label>
                <Input
                  type="number"
                  value={editFields.sizeKwp ?? ""}
                  onChange={(e) => setEditFields(f => ({ ...f, sizeKwp: e.target.value ? parseFloat(e.target.value) : null }))}
                  data-testid="input-edit-project-size-kwp"
                />
              </div>
              <div>
                <Label>Contract Value</Label>
                <Input
                  type="number"
                  value={editFields.contractValue ?? ""}
                  onChange={(e) => setEditFields(f => ({ ...f, contractValue: e.target.value ? parseFloat(e.target.value) : null }))}
                  data-testid="input-edit-project-contract-value"
                />
              </div>
            </div>
            <div>
              <Label>Client ID</Label>
              <Input
                type="number"
                value={editFields.clientId ?? ""}
                onChange={(e) => setEditFields(f => ({ ...f, clientId: e.target.value ? parseInt(e.target.value) : null }))}
                data-testid="input-edit-project-client-id"
              />
            </div>
            <div>
              <Label>RAG Comment</Label>
              <Input
                value={editFields.ragComment || ""}
                onChange={(e) => setEditFields(f => ({ ...f, ragComment: e.target.value }))}
                data-testid="input-edit-project-rag-comment"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingProject(null); setEditFields({}); }}>Cancel</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={updateMutation.isPending}
                  data-testid="button-save-project-edit"
                >
                  {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Changes
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Project Edit</AlertDialogTitle>
                  <AlertDialogDescription>
                    You are about to modify project #{editingProject?.id} ({editFields.projectName}). This action will be audit logged. Are you sure?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (!editingProject) return;
                      updateMutation.mutate({ projectId: editingProject.id, updates: editFields });
                    }}
                    data-testid="button-confirm-project-edit"
                  >
                    Confirm Save
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DELETED_TYPE_LABELS: Record<string, string> = {
  work_item: "Work Item",
  engineering_task: "Engineering Task",
  operational_task: "Operational Task",
  mytool_task: "My Tool Task",
};

function DeletedItemsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["recovery-deleted"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/recovery/deleted");
      if (!res.ok) throw new Error("Failed to load deleted items");
      return res.json();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (items: Array<{ id: number; type: string }>) => {
      const res = await authFetch("/api/admin/recovery/restore", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Restore failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Items Restored", description: `${data.restored} item(s) restored successfully` });
      queryClient.invalidateQueries({ queryKey: ["recovery-deleted"] });
      setSelectedItems(new Set());
    },
    onError: (err: any) => {
      toast({ title: "Restore Failed", description: err.message, variant: "destructive" });
    },
  });

  const allItems = data?.items || [];
  const items = allItems.filter((item: any) => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (search && !item.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const typeCounts = allItems.reduce((acc: Record<string, number>, item: any) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const toggleItem = (key: string) => {
    const next = new Set(selectedItems);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedItems(next);
  };

  const handleRestore = () => {
    const toRestore = Array.from(selectedItems).map(key => {
      const [type, id] = key.split(":");
      return { id: parseInt(id), type };
    });
    restoreMutation.mutate(toRestore);
  };

  const getDaysSinceDeleted = (deletedDate: string | null) => {
    if (!deletedDate) return null;
    const diff = Date.now() - new Date(deletedDate).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search deleted items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-deleted-search"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant={typeFilter === "" ? "default" : "outline"}
            size="sm"
            onClick={() => setTypeFilter("")}
            data-testid="button-filter-all-types"
          >
            All ({allItems.length})
          </Button>
          {Object.entries(typeCounts).map(([type, count]) => (
            <Button
              key={type}
              variant={typeFilter === type ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter(type)}
              data-testid={`button-filter-${type}`}
            >
              {DELETED_TYPE_LABELS[type] || type} ({count})
            </Button>
          ))}
        </div>
      </div>

      {selectedItems.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium">{selectedItems.size} item(s) selected</span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                disabled={restoreMutation.isPending}
                data-testid="button-restore-selected"
              >
                {restoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                Restore Selected
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Restore</AlertDialogTitle>
                <AlertDialogDescription>
                  You are about to restore {selectedItems.size} deleted item(s). This action will be audit-logged.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRestore} data-testid="button-confirm-restore">
                  Restore Items
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12" data-testid="recovery-deleted-loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Trash2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            No deleted items found.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]" data-testid="recovery-deleted-table">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 w-10"></th>
                <th className="text-left p-3 font-medium">ID</th>
                <th className="text-left p-3 font-medium">Title</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Deleted</th>
                <th className="text-left p-3 font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => {
                const key = `${item.type}:${item.id}`;
                return (
                  <tr key={key} className="border-t hover:bg-muted/30" data-testid={`recovery-deleted-row-${key}`}>
                    <td className="p-3">
                      <Checkbox
                        checked={selectedItems.has(key)}
                        onCheckedChange={() => toggleItem(key)}
                        data-testid={`checkbox-restore-${key}`}
                      />
                    </td>
                    <td className="p-3 font-mono text-xs">{item.id}</td>
                    <td className="p-3 truncate max-w-[250px]">{item.title}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">{DELETED_TYPE_LABELS[item.type] || item.type}</Badge>
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary" className="text-xs">{item.status}</Badge>
                    </td>
                    <td className="p-3 text-xs whitespace-nowrap text-muted-foreground">
                      {item.deletedDate ? new Date(item.deletedDate).toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-xs whitespace-nowrap">
                      {(() => {
                        const days = getDaysSinceDeleted(item.deletedDate);
                        if (days === null) return "—";
                        return <span className={days > 60 ? "text-red-500 font-medium" : days > 30 ? "text-amber-500" : "text-muted-foreground"}>{days}d ago</span>;
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminRecoveryPage() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <Shield className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-recovery-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">Admin access is required to use the Recovery Center.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-recovery-title">Admin Recovery Center</h1>
          <p className="text-sm text-muted-foreground">Correct task assignments, fix project data, review imports, and restore deleted items</p>
        </div>
      </div>

      <Tabs defaultValue="tasks" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-auto">
          <TabsTrigger value="tasks" data-testid="tab-recovery-tasks">
            <ListTodo className="h-4 w-4 mr-2" />
            Task Recovery
          </TabsTrigger>
          <TabsTrigger value="imports" data-testid="tab-recovery-imports">
            <FileUp className="h-4 w-4 mr-2" />
            Import Recovery
          </TabsTrigger>
          <TabsTrigger value="projects" data-testid="tab-recovery-projects">
            <FolderCog className="h-4 w-4 mr-2" />
            Project Recovery
          </TabsTrigger>
          <TabsTrigger value="deleted" data-testid="tab-recovery-deleted">
            <Trash2 className="h-4 w-4 mr-2" />
            Deleted Items
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Task Recovery</CardTitle>
              <CardDescription>Search and edit tasks across all types — change project, assignee, status, priority, dates, and more</CardDescription>
            </CardHeader>
            <CardContent>
              <TaskRecoveryTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="imports" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Import Recovery</CardTitle>
              <CardDescription>Review recent import runs, view errors, and identify failed imports</CardDescription>
            </CardHeader>
            <CardContent>
              <ImportRecoveryTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Project Recovery</CardTitle>
              <CardDescription>Edit project fields — fix wrong PM, PD, phase, RAG status, and other project info</CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectRecoveryTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deleted" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Deleted Items</CardTitle>
              <CardDescription>View and restore soft-deleted work items and engineering tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <DeletedItemsTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

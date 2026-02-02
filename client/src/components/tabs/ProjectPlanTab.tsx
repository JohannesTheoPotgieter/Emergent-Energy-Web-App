import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertTriangle, RotateCcw, Save, Plus, Trash2, Link, ChevronLeft, ChevronRight, Calendar, GitBranch } from "lucide-react";
import { format, addDays, differenceInDays, startOfWeek, endOfWeek, eachDayOfInterval, parseISO, isValid } from "date-fns";

interface ProjectPlanTabProps {
  projectName: string;
}

interface CPMTask {
  id: number;
  taskNo: string;
  name: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  slack: number;
  isCritical: boolean;
  predecessorIds: number[];
  successorIds: number[];
  isMilestone: boolean;
  type: string;
}

interface CPMDependency {
  id: number;
  predecessorTaskId: number;
  successorTaskId: number;
  dependencyType: string;
  lagDays: number;
}

interface WorkingPlanResponse {
  scenario: { id: number; projectName: string; name: string };
  tasks: CPMTask[];
  dependencies: CPMDependency[];
  criticalPath: number[];
  projectFinish: number;
  hasCircularDependency: boolean;
  warnings: string[];
  keyDates: {
    pdHandoverDate: string | null;
    constructionStartDate: string | null;
    commissioningDate: string | null;
    omHandoverDate: string | null;
    clientHandoverDate: string | null;
  };
  overrideCounts: {
    taskOverrides: number;
    dependencyOverrides: number;
  };
}

interface ScheduleChangeNotice {
  id: number;
  summary: string;
  oldFinishDate: string | null;
  newFinishDate: string | null;
  changedTasks: string | null;
  userNote: string | null;
  clientNotified: number;
  documentationUpdated: number;
  createdAt: string;
}

export function ProjectPlanTab({ projectName }: ProjectPlanTabProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("grid");
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{ startDate?: string; endDate?: string; name?: string }>({});
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [pendingChange, setPendingChange] = useState<{ taskId: number; changes: any } | null>(null);
  const [warningNote, setWarningNote] = useState("");
  const [ganttViewStart, setGanttViewStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [showAddDependency, setShowAddDependency] = useState(false);
  const [newDep, setNewDep] = useState({ predecessorId: "", successorId: "", type: "FS", lag: 0 });

  const { data: workingPlan, isLoading, error, refetch } = useQuery<WorkingPlanResponse>({
    queryKey: ["working-plan", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/working-plan`);
      if (!res.ok) throw new Error("Failed to fetch working plan");
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: changeNotices = [] } = useQuery<ScheduleChangeNotice[]>({
    queryKey: ["change-notices", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/change-notices`);
      if (!res.ok) throw new Error("Failed to fetch change notices");
      return res.json();
    },
    enabled: !!projectName,
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, changes }: { taskId: number; changes: any }) => {
      const res = await fetch(`/api/working-plan/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, ...changes }),
      });
      if (!res.ok) throw new Error("Failed to update task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
      setEditingTaskId(null);
      setEditValues({});
    },
  });

  const resetPlanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/working-plan/reset`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to reset plan");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
    },
  });

  const createDependencyMutation = useMutation({
    mutationFn: async (dep: { predecessorTaskId: number; successorTaskId: number; dependencyType: string; lagDays: number }) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dep),
      });
      if (!res.ok) throw new Error("Failed to create dependency");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
      setShowAddDependency(false);
      setNewDep({ predecessorId: "", successorId: "", type: "FS", lag: 0 });
    },
  });

  const deleteDependencyMutation = useMutation({
    mutationFn: async (depId: number) => {
      const res = await fetch(`/api/dependencies/${depId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete dependency");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-plan", projectName] });
    },
  });

  const createChangeNoticeMutation = useMutation({
    mutationFn: async (notice: { summary: string; oldFinishDate?: string; newFinishDate?: string; changedTasks?: string; userNote?: string }) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/change-notices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notice),
      });
      if (!res.ok) throw new Error("Failed to create change notice");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["change-notices", projectName] });
    },
  });

  const checkScheduleImpact = useCallback((taskId: number, changes: any) => {
    if (!workingPlan) return false;
    
    const task = workingPlan.tasks.find(t => t.id === taskId);
    if (!task || !task.isCritical) return false;
    
    const commissioningDate = workingPlan.keyDates.commissioningDate;
    const clientHandoverDate = workingPlan.keyDates.clientHandoverDate;
    
    if (!commissioningDate && !clientHandoverDate) return false;
    
    const newEndDate = changes.endDate || task.endDate;
    const oldEndDate = task.endDate;
    
    if (newEndDate > oldEndDate) {
      return true;
    }
    
    return false;
  }, [workingPlan]);

  const handleSaveEdit = useCallback((taskId: number) => {
    if (!editValues.startDate && !editValues.endDate && !editValues.name) {
      setEditingTaskId(null);
      return;
    }
    
    if (checkScheduleImpact(taskId, editValues)) {
      setPendingChange({ taskId, changes: editValues });
      setShowWarningModal(true);
    } else {
      updateTaskMutation.mutate({ taskId, changes: editValues });
    }
  }, [editValues, checkScheduleImpact, updateTaskMutation]);

  const confirmWarningChange = useCallback(() => {
    if (!pendingChange || !workingPlan) return;
    
    const task = workingPlan.tasks.find(t => t.id === pendingChange.taskId);
    
    createChangeNoticeMutation.mutate({
      summary: `Schedule change: ${task?.name || "Task"} end date modified`,
      oldFinishDate: task?.endDate,
      newFinishDate: pendingChange.changes.endDate,
      changedTasks: task?.name,
      userNote: warningNote,
    });
    
    updateTaskMutation.mutate(pendingChange);
    setShowWarningModal(false);
    setPendingChange(null);
    setWarningNote("");
  }, [pendingChange, workingPlan, warningNote, createChangeNoticeMutation, updateTaskMutation]);

  const tasks = workingPlan?.tasks || [];
  const dependencies = workingPlan?.dependencies || [];
  const criticalPath = workingPlan?.criticalPath || [];
  const hasOverrides = (workingPlan?.overrideCounts.taskOverrides || 0) > 0;

  const ganttDays = useMemo(() => {
    const viewEnd = addDays(ganttViewStart, 27);
    return eachDayOfInterval({ start: ganttViewStart, end: viewEnd });
  }, [ganttViewStart]);

  const getTaskBarStyle = useCallback((task: CPMTask) => {
    if (!task.startDate || !task.endDate) return { display: "none" };
    
    const start = parseISO(task.startDate);
    const end = parseISO(task.endDate);
    
    if (!isValid(start) || !isValid(end)) return { display: "none" };
    
    const viewEnd = addDays(ganttViewStart, 27);
    
    if (end < ganttViewStart || start > viewEnd) return { display: "none" };
    
    const dayWidth = 100 / 28;
    const startOffset = Math.max(0, differenceInDays(start, ganttViewStart));
    const endOffset = Math.min(27, differenceInDays(end, ganttViewStart));
    const width = endOffset - startOffset + 1;
    
    return {
      left: `${startOffset * dayWidth}%`,
      width: `${width * dayWidth}%`,
    };
  }, [ganttViewStart]);

  if (isLoading) {
    return (
      <Card data-testid="card-loading">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="spinner-loading" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="card-error">
        <CardContent className="py-12">
          <p className="text-center text-destructive" data-testid="text-error">Failed to load project plan data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2" data-testid="title-project-plan">
                Project Plan
                {hasOverrides && (
                  <Badge variant="secondary" className="ml-2" data-testid="badge-modified">Modified</Badge>
                )}
              </CardTitle>
              <CardDescription>
                <span data-testid="text-task-count">{tasks.length} tasks</span> • <span data-testid="text-critical-count">{criticalPath.length} on critical path</span>
                {workingPlan?.hasCircularDependency && (
                  <span className="text-destructive ml-2" data-testid="text-circular-warning">⚠ Circular dependency detected</span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddDependency(true)}
                data-testid="button-add-dependency"
              >
                <Link className="h-4 w-4 mr-1" />
                Add Link
              </Button>
              {hasOverrides && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resetPlanMutation.mutate()}
                  disabled={resetPlanMutation.isPending}
                  data-testid="button-reset-plan"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="grid" data-testid="tab-task-grid">
                <Calendar className="h-4 w-4 mr-1" />
                Task Grid
              </TabsTrigger>
              <TabsTrigger value="gantt" data-testid="tab-gantt">
                <GitBranch className="h-4 w-4 mr-1" />
                Gantt Chart
              </TabsTrigger>
              <TabsTrigger value="deps" data-testid="tab-dependencies">
                <Link className="h-4 w-4 mr-1" />
                Dependencies ({dependencies.length})
              </TabsTrigger>
              <TabsTrigger value="changes" data-testid="tab-changes">
                <AlertTriangle className="h-4 w-4 mr-1" />
                Changes ({changeNotices.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="grid" className="mt-4">
              {tasks.length === 0 ? (
                <p className="text-center text-muted-foreground py-8" data-testid="text-no-tasks">
                  No project plan data available
                </p>
              ) : (
                <div className="rounded-md border overflow-auto max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">No.</TableHead>
                        <TableHead>Task Name</TableHead>
                        <TableHead className="w-28">Start</TableHead>
                        <TableHead className="w-28">End</TableHead>
                        <TableHead className="w-20">Duration</TableHead>
                        <TableHead className="w-20">Slack</TableHead>
                        <TableHead className="w-20">Status</TableHead>
                        <TableHead className="w-24">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tasks.map((task) => {
                        const isEditing = editingTaskId === task.id;
                        const isCritical = task.isCritical;
                        
                        return (
                          <TableRow 
                            key={task.id} 
                            className={isCritical ? "bg-red-50 dark:bg-red-950/20" : ""}
                            data-testid={`row-task-${task.id}`}
                          >
                            <TableCell className="font-mono text-sm" data-testid={`text-taskno-${task.id}`}>
                              {task.taskNo || "-"}
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  value={editValues.name ?? task.name}
                                  onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                                  className="h-8"
                                  data-testid={`input-name-${task.id}`}
                                />
                              ) : (
                                <span className={isCritical ? "font-medium" : ""} data-testid={`text-name-${task.id}`}>
                                  {task.name || "-"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  type="date"
                                  value={editValues.startDate ?? task.startDate}
                                  onChange={(e) => setEditValues({ ...editValues, startDate: e.target.value })}
                                  className="h-8"
                                  data-testid={`input-start-${task.id}`}
                                />
                              ) : (
                                <span data-testid={`text-start-${task.id}`}>
                                  {task.startDate ? format(parseISO(task.startDate), "dd MMM yy") : "-"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  type="date"
                                  value={editValues.endDate ?? task.endDate}
                                  onChange={(e) => setEditValues({ ...editValues, endDate: e.target.value })}
                                  className="h-8"
                                  data-testid={`input-end-${task.id}`}
                                />
                              ) : (
                                <span data-testid={`text-end-${task.id}`}>
                                  {task.endDate ? format(parseISO(task.endDate), "dd MMM yy") : "-"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell data-testid={`text-duration-${task.id}`}>
                              {task.durationDays}d
                            </TableCell>
                            <TableCell>
                              <span className={task.slack === 0 ? "text-destructive font-medium" : "text-muted-foreground"} data-testid={`text-slack-${task.id}`}>
                                {task.slack}d
                              </span>
                            </TableCell>
                            <TableCell>
                              {isCritical ? (
                                <Badge variant="destructive" className="text-xs" data-testid={`badge-critical-${task.id}`}>Critical</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs" data-testid={`badge-normal-${task.id}`}>Normal</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleSaveEdit(task.id)}
                                    disabled={updateTaskMutation.isPending}
                                    data-testid={`button-save-${task.id}`}
                                  >
                                    <Save className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => { setEditingTaskId(null); setEditValues({}); }}
                                    data-testid={`button-cancel-${task.id}`}
                                  >
                                    ✕
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingTaskId(task.id);
                                    setEditValues({
                                      name: task.name,
                                      startDate: task.startDate,
                                      endDate: task.endDate,
                                    });
                                  }}
                                  data-testid={`button-edit-${task.id}`}
                                >
                                  Edit
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="gantt" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGanttViewStart(addDays(ganttViewStart, -14))}
                      data-testid="button-gantt-prev"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium" data-testid="text-gantt-range">
                      {format(ganttViewStart, "dd MMM yyyy")} - {format(addDays(ganttViewStart, 27), "dd MMM yyyy")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGanttViewStart(addDays(ganttViewStart, 14))}
                      data-testid="button-gantt-next"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-4 text-sm" data-testid="gantt-legend">
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-3 bg-destructive rounded" />
                      <span data-testid="text-legend-critical">Critical</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-3 bg-primary rounded" />
                      <span data-testid="text-legend-normal">Normal</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border overflow-hidden">
                  <div className="flex border-b bg-muted/50">
                    <div className="w-48 flex-shrink-0 p-2 border-r font-medium text-sm">Task</div>
                    <div className="flex-1 flex">
                      {ganttDays.map((day, i) => {
                        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                        return (
                          <div
                            key={i}
                            className={`flex-1 text-center text-xs py-1 border-r ${isWeekend ? "bg-muted" : ""}`}
                            style={{ minWidth: "24px" }}
                            data-testid={`text-gantt-day-${i}`}
                          >
                            {format(day, "d")}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="max-h-[500px] overflow-y-auto" data-testid="gantt-task-list">
                    {tasks.map((task) => (
                      <div key={task.id} className="flex border-b hover:bg-muted/30" data-testid={`gantt-row-${task.id}`}>
                        <div className="w-48 flex-shrink-0 p-2 border-r text-sm truncate" data-testid={`gantt-label-${task.id}`}>
                          {task.name || task.taskNo || "-"}
                        </div>
                        <div className="flex-1 relative h-8">
                          {ganttDays.map((day, i) => {
                            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                            return (
                              <div
                                key={i}
                                className={`absolute top-0 bottom-0 border-r ${isWeekend ? "bg-muted/30" : ""}`}
                                style={{ left: `${(i / 28) * 100}%`, width: `${100 / 28}%` }}
                              />
                            );
                          })}
                          <div
                            className={`absolute top-1 bottom-1 rounded ${task.isCritical ? "bg-destructive" : "bg-primary"} opacity-80`}
                            style={getTaskBarStyle(task)}
                            title={`${task.name}: ${task.startDate} - ${task.endDate}`}
                            data-testid={`gantt-bar-${task.id}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="deps" className="mt-4">
              {dependencies.length === 0 ? (
                <p className="text-center text-muted-foreground py-8" data-testid="text-no-dependencies">
                  No dependencies defined. Use "Add Link" to create task relationships.
                </p>
              ) : (
                <div className="rounded-md border overflow-auto max-h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Predecessor</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Successor</TableHead>
                        <TableHead className="w-20">Lag</TableHead>
                        <TableHead className="w-16">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dependencies.map((dep) => {
                        const predTask = tasks.find(t => t.id === dep.predecessorTaskId);
                        const succTask = tasks.find(t => t.id === dep.successorTaskId);
                        const typeLabels: Record<string, string> = {
                          FS: "Finish→Start",
                          SS: "Start→Start",
                          FF: "Finish→Finish",
                          SF: "Start→Finish",
                        };
                        
                        return (
                          <TableRow key={dep.id} data-testid={`row-dependency-${dep.id}`}>
                            <TableCell data-testid={`text-predecessor-${dep.id}`}>
                              {predTask?.taskNo} - {predTask?.name || "Unknown"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" data-testid={`badge-dep-type-${dep.id}`}>{typeLabels[dep.dependencyType] || dep.dependencyType}</Badge>
                            </TableCell>
                            <TableCell data-testid={`text-successor-${dep.id}`}>
                              {succTask?.taskNo} - {succTask?.name || "Unknown"}
                            </TableCell>
                            <TableCell data-testid={`text-lag-${dep.id}`}>{dep.lagDays}d</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteDependencyMutation.mutate(dep.id)}
                                disabled={deleteDependencyMutation.isPending}
                                data-testid={`button-delete-dependency-${dep.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="changes" className="mt-4">
              {changeNotices.length === 0 ? (
                <p className="text-center text-muted-foreground py-8" data-testid="text-no-changes">
                  No schedule changes recorded
                </p>
              ) : (
                <div className="space-y-3">
                  {changeNotices.map((notice) => (
                    <Card key={notice.id} data-testid={`card-change-notice-${notice.id}`}>
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium" data-testid={`text-notice-summary-${notice.id}`}>{notice.summary}</p>
                            {notice.oldFinishDate && notice.newFinishDate && (
                              <p className="text-sm text-muted-foreground" data-testid={`text-date-change-${notice.id}`}>
                                Date change: {notice.oldFinishDate} → {notice.newFinishDate}
                              </p>
                            )}
                            {notice.userNote && (
                              <p className="text-sm mt-1" data-testid={`text-user-note-${notice.id}`}>{notice.userNote}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Badge variant={notice.clientNotified ? "default" : "outline"} data-testid={`badge-notification-${notice.id}`}>
                              {notice.clientNotified ? "Client Notified" : "Pending Notification"}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2" data-testid={`text-notice-date-${notice.id}`}>
                          {format(parseISO(notice.createdAt), "dd MMM yyyy HH:mm")}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {workingPlan?.warnings && workingPlan.warnings.length > 0 && (
        <Card className="border-yellow-500">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Warnings
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="text-sm space-y-1" data-testid="list-warnings">
              {workingPlan.warnings.map((w, i) => (
                <li key={i} className="text-muted-foreground" data-testid={`text-warning-${i}`}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={showWarningModal} onOpenChange={setShowWarningModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Schedule Change Warning
            </DialogTitle>
            <DialogDescription>
              This change affects a task on the critical path and may impact project delivery dates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm">
              Changing this task may affect:
            </p>
            <ul className="text-sm list-disc pl-5 space-y-1" data-testid="list-affected-dates">
              {workingPlan?.keyDates.commissioningDate && (
                <li data-testid="text-commissioning-date">Commissioning Date: {workingPlan.keyDates.commissioningDate}</li>
              )}
              {workingPlan?.keyDates.clientHandoverDate && (
                <li data-testid="text-client-handover-date">Client Handover Date: {workingPlan.keyDates.clientHandoverDate}</li>
              )}
            </ul>
            <div>
              <label className="text-sm font-medium">Add a note (optional):</label>
              <Textarea
                value={warningNote}
                onChange={(e) => setWarningNote(e.target.value)}
                placeholder="Reason for change, mitigation actions, etc."
                className="mt-2"
                data-testid="input-warning-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWarningModal(false)} data-testid="button-warning-cancel">
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmWarningChange} data-testid="button-warning-confirm">
              Confirm Change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddDependency} onOpenChange={setShowAddDependency}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Task Dependency</DialogTitle>
            <DialogDescription>
              Create a link between two tasks
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Predecessor Task</label>
              <select
                className="w-full mt-1 p-2 border rounded"
                value={newDep.predecessorId}
                onChange={(e) => setNewDep({ ...newDep, predecessorId: e.target.value })}
                data-testid="select-predecessor"
              >
                <option value="">Select task...</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.taskNo} - {t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Successor Task</label>
              <select
                className="w-full mt-1 p-2 border rounded"
                value={newDep.successorId}
                onChange={(e) => setNewDep({ ...newDep, successorId: e.target.value })}
                data-testid="select-successor"
              >
                <option value="">Select task...</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.taskNo} - {t.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Type</label>
                <select
                  className="w-full mt-1 p-2 border rounded"
                  value={newDep.type}
                  onChange={(e) => setNewDep({ ...newDep, type: e.target.value })}
                  data-testid="select-dep-type"
                >
                  <option value="FS">Finish-to-Start</option>
                  <option value="SS">Start-to-Start</option>
                  <option value="FF">Finish-to-Finish</option>
                  <option value="SF">Start-to-Finish</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Lag (days)</label>
                <Input
                  type="number"
                  value={newDep.lag}
                  onChange={(e) => setNewDep({ ...newDep, lag: parseInt(e.target.value) || 0 })}
                  className="mt-1"
                  data-testid="input-dep-lag"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDependency(false)} data-testid="button-dep-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (newDep.predecessorId && newDep.successorId) {
                  createDependencyMutation.mutate({
                    predecessorTaskId: parseInt(newDep.predecessorId),
                    successorTaskId: parseInt(newDep.successorId),
                    dependencyType: newDep.type,
                    lagDays: newDep.lag,
                  });
                }
              }}
              disabled={!newDep.predecessorId || !newDep.successorId || createDependencyMutation.isPending}
              data-testid="button-dep-create"
            >
              Create Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

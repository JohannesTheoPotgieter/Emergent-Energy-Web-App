import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useRoute } from "wouter";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, ArrowLeft, Building2, FolderKanban, FileEdit, ExternalLink,
  CheckCircle2, Clock, AlertTriangle, Activity, ListTodo, Pencil, Save, X,
  CircleDot, Circle, PauseCircle, ArrowUpRight,
} from "lucide-react";

function pdFetch(url: string, opts?: RequestInit) {
  return fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  }).then(async r => {
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || "Request failed");
    }
    return r.json();
  });
}

const STATUSES = ["Draft", "In Progress", "On Hold", "Completed", "Cancelled"];
const PRIORITIES = ["Critical", "High", "Medium", "Low"];

export default function PdTicketDetailPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/pd/tickets/:id");
  const ticketId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/pd/tickets", ticketId],
    queryFn: () => pdFetch(`/api/pd/tickets/${ticketId}`),
    enabled: !!ticketId,
  });

  const { data: projectsList = [] } = useQuery<any[]>({
    queryKey: ["projects-list-for-link"],
    queryFn: async () => {
      const res = await fetch("/api/projects", { credentials: "include", headers: { ...(localStorage.getItem("auth_token") ? { Authorization: `Bearer ${localStorage.getItem("auth_token")}` } : {}) } });
      if (!res.ok) return [];
      const rows = await res.json();
      return rows.map((p: any) => ({ id: p.id, name: (p.projectName || p.project_name || "").replace(/_Tracker.*$/i, "").replace(/_/g, " ") }))
        .filter((p: any) => p.name)
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
    },
    enabled: editing,
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => pdFetch(`/api/pd/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pd/tickets", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/pd/tickets"] });
      toast({ title: "Ticket updated" });
      setEditing(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const spawnMutation = useMutation({
    mutationFn: () => pdFetch(`/api/pd/tickets/${ticketId}/spawn-tasks`, { method: "POST" }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pd/tickets", ticketId] });
      toast({ title: "Tasks spawned", description: `${result.spawned} tasks created` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>Ticket not found</p>
        <Button variant="link" onClick={() => navigate("/pd/tickets")}>Back to tickets</Button>
      </div>
    );
  }

  const t = data.ticket;
  const tasks = data.tasks || [];
  const activity = data.recentActivity || [];
  const today = new Date();
  const created = new Date(t.createdAt);
  const daysInProgress = Math.max(0, Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)));
  const daysGiven = t.dueDate ? Math.max(0, Math.floor((new Date(t.dueDate).getTime() - created.getTime()) / (1000 * 60 * 60 * 24))) : null;
  const overdue = t.dueDate && t.dueDate < today.toISOString().split("T")[0] && t.status !== "Completed" && t.status !== "Cancelled";

  const startEdit = () => {
    setEditForm({
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate || "",
      comments: t.comments || "",
      numberOfReworks: t.numberOfReworks || 0,
      projectId: t.projectId || "",
    });
    setEditing(true);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pd/tickets")} data-testid="btn-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-4">
            <div className="flex-1">
              <h1 className="text-xl font-bold flex items-center gap-2" data-testid="pd-detail-title">
                <FileEdit className="h-5 w-5 text-violet-600" />
                {t.projectSiteName}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[10px]">{t.requestType}</Badge>
                <Badge className={`text-[10px] ${statusColor(t.status)}`}>{t.status}</Badge>
                <Badge className={`text-[10px] ${priorityColor(t.priority)}`}>{t.priority}</Badge>
                {overdue && <Badge className="text-[10px] bg-red-100 text-red-700">Overdue</Badge>}
                <span className="text-[11px] text-muted-foreground">Ticket #{t.id}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {!editing ? (
                <Button variant="outline" size="sm" onClick={startEdit} data-testid="btn-edit-ticket">
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(false)} data-testid="btn-cancel-edit">
                    <X className="h-3.5 w-3.5 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" onClick={() => updateMutation.mutate(editForm)} disabled={updateMutation.isPending} data-testid="btn-save-edit">
                    {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />} Save
                  </Button>
                </>
              )}
            </div>
          </div>

          {editing ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={editForm.status} onValueChange={v => setEditForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="edit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Select value={editForm.priority} onValueChange={v => setEditForm(p => ({ ...p, priority: v }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="edit-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Due Date</Label>
                <Input type="date" className="h-8 text-xs" value={editForm.dueDate} onChange={e => setEditForm(p => ({ ...p, dueDate: e.target.value }))} data-testid="edit-due-date" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reworks</Label>
                <Input type="number" className="h-8 text-xs" value={editForm.numberOfReworks} onChange={e => setEditForm(p => ({ ...p, numberOfReworks: parseInt(e.target.value) || 0 }))} data-testid="edit-reworks" />
              </div>
              <div className="col-span-2 md:col-span-4 space-y-1">
                <Label className="text-xs">Linked Project</Label>
                <Select value={editForm.projectId ? String(editForm.projectId) : "__none__"} onValueChange={v => setEditForm(p => ({ ...p, projectId: v === "__none__" ? null : parseInt(v) }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="edit-project"><SelectValue placeholder="Select a project..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not linked</SelectItem>
                    {projectsList.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 md:col-span-4 space-y-1">
                <Label className="text-xs">Comments</Label>
                <Textarea className="text-xs min-h-[60px]" value={editForm.comments} onChange={e => setEditForm(p => ({ ...p, comments: e.target.value }))} data-testid="edit-comments" />
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <InfoItem label="Client" value={data.clientName} sub={data.clientClientId ? `ID: ${data.clientClientId}` : undefined} icon={<Building2 className="h-3.5 w-3.5" />} />
            <InfoItem label="Project" value={data.projectName || "Not linked"} icon={<FolderKanban className="h-3.5 w-3.5" />}
              action={data.projectName ? <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(`/project/${encodeURIComponent(data.projectName)}`)} data-testid="link-to-project"><ExternalLink className="h-3 w-3" /></Button> : undefined}
            />
            <InfoItem label="Days in Progress" value={`${daysInProgress}d`} icon={<Clock className="h-3.5 w-3.5" />} />
            <InfoItem label="Days Given" value={daysGiven !== null ? `${daysGiven}d` : "—"} icon={<Clock className="h-3.5 w-3.5" />} />
            <InfoItem label="Developer" value={data.developerName || "—"} />
            <InfoItem label="Designer" value={data.designerName || "—"} />
            <InfoItem label="Funding Type" value={t.fundingType || "—"} />
            <InfoItem label="Size" value={t.sizeKwp ? `${t.sizeKwp} kWp` : "—"} />
            <InfoItem label="Province" value={t.province || "—"} />
            <InfoItem label="GPS" value={t.gpsCoordinates || "—"} />
            <InfoItem label="Reworks" value={String(t.numberOfReworks || 0)} />
            <InfoItem label="Created" value={new Date(t.createdAt).toLocaleDateString()} />
          </div>

          {(t.billsOrTariffData || t.meteringDataAvailable || t.siteInspectionForm || t.batteriesNeeded || t.dieselGenIntegration || t.roofReplacementNeeded || t.hseDiscussed) && (
            <>
              <Separator className="my-3" />
              <div className="flex flex-wrap gap-2">
                {t.billsOrTariffData && <Badge variant="outline" className="text-[10px]">Bills/Tariff ✓</Badge>}
                {t.meteringDataAvailable && <Badge variant="outline" className="text-[10px]">Metering ✓</Badge>}
                {t.siteInspectionForm && <Badge variant="outline" className="text-[10px]">Site Inspection ✓</Badge>}
                {t.batteriesNeeded && <Badge variant="outline" className="text-[10px]">Batteries ({t.batterySize || "?"}kWh)</Badge>}
                {t.dieselGenIntegration && <Badge variant="outline" className="text-[10px]">Diesel Gen ✓</Badge>}
                {t.roofReplacementNeeded && <Badge variant="outline" className="text-[10px]">Roof Replacement ✓</Badge>}
                {t.hseDiscussed && <Badge variant="outline" className="text-[10px]">HSE Discussed ✓</Badge>}
              </div>
            </>
          )}

          {t.comments && (
            <>
              <Separator className="my-3" />
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Comments</p>
                <p className="text-sm whitespace-pre-wrap">{t.comments}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <SpawnedTasksCard
        tasks={tasks}
        ticket={t}
        spawnMutation={spawnMutation}
        navigate={navigate}
      />

      {activity.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Deliverables & Activity
              <Badge variant="secondary" className="text-[10px]">{activity.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {activity.map((a: any, i: number) => (
                <div key={a.id || i} className="flex items-start gap-2 text-xs border-b pb-2 last:border-b-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground">
                      <span className="font-medium">{a.action}</span>
                      {a.field && <span className="text-muted-foreground"> ({a.field})</span>}
                    </p>
                    {a.details && <p className="text-muted-foreground truncate">{a.details}</p>}
                    {a.oldValue && a.newValue && (
                      <p className="text-muted-foreground"><span className="line-through">{a.oldValue}</span> → {a.newValue}</p>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0">{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SpawnedTasksCard({ tasks, ticket, spawnMutation, navigate }: {
  tasks: any[];
  ticket: any;
  spawnMutation: any;
  navigate: (path: string) => void;
}) {
  const completed = tasks.filter((t: any) => t.status === "COMPLETE").length;
  const inProgress = tasks.filter((t: any) => t.status === "IN PROGRESS").length;
  const hold = tasks.filter((t: any) => t.status === "HOLD").length;
  const todo = tasks.filter((t: any) => t.status === "TO DO").length;
  const other = tasks.length - completed - inProgress - hold - todo;
  const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

  const todayStr = new Date().toISOString().split("T")[0];
  const overdueTasks = tasks.filter((t: any) => t.dueDate && t.dueDate < todayStr && t.status !== "COMPLETE");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ListTodo className="h-4 w-4" />
            Engineering Tasks
            <Badge variant="secondary" className="text-[10px]">{tasks.length}</Badge>
          </span>
          {tasks.length === 0 && !ticket.tasksSpawnedAt && (
            <Button size="sm" variant="outline" onClick={() => spawnMutation.mutate()} disabled={spawnMutation.isPending} data-testid="btn-spawn-tasks">
              {spawnMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Spawn Tasks
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {ticket.tasksSpawnedAt ? "No tasks found (they may have been deleted)" : "Tasks not yet spawned — click Spawn Tasks to create them"}
          </p>
        ) : (
          <>
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Overall Progress</span>
                <span className="text-sm font-bold" data-testid="task-progress-pct">{pct}%</span>
              </div>
              <Progress value={pct} className="h-2.5" />
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                  <strong>{completed}</strong> Complete
                </span>
                <span className="flex items-center gap-1">
                  <CircleDot className="h-3 w-3 text-blue-500" />
                  <strong>{inProgress}</strong> In Progress
                </span>
                <span className="flex items-center gap-1">
                  <PauseCircle className="h-3 w-3 text-orange-500" />
                  <strong>{hold}</strong> On Hold
                </span>
                <span className="flex items-center gap-1">
                  <Circle className="h-3 w-3 text-gray-400" />
                  <strong>{todo}</strong> To Do
                </span>
                {other > 0 && (
                  <span className="flex items-center gap-1">
                    <Circle className="h-3 w-3 text-purple-400" />
                    <strong>{other}</strong> Other
                  </span>
                )}
                {overdueTasks.length > 0 && (
                  <span className="flex items-center gap-1 text-red-600 font-semibold">
                    <AlertTriangle className="h-3 w-3" />
                    {overdueTasks.length} Overdue
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="text-[10px] text-muted-foreground border-b bg-muted/30">
                    <th className="text-left p-2 pl-3">Task</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Priority</th>
                    <th className="text-left p-2">Assignees</th>
                    <th className="text-left p-2">Due Date</th>
                    <th className="text-left p-2">% Done</th>
                    <th className="text-left p-2">Updated</th>
                    <th className="text-left p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task: any) => {
                    const taskOverdue = task.dueDate && task.dueDate < todayStr && task.status !== "COMPLETE";
                    return (
                      <tr
                        key={task.id}
                        className={`border-b hover:bg-muted/20 cursor-pointer transition-colors ${taskOverdue ? "bg-red-50/40 dark:bg-red-950/10" : ""}`}
                        onClick={() => navigate(`/engineering/tasks?taskId=${task.id}`)}
                        data-testid={`spawned-task-${task.id}`}
                      >
                        <td className="p-2 pl-3">
                          <div className="flex items-center gap-1.5">
                            {task.status === "COMPLETE" ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                            ) : task.status === "IN PROGRESS" ? (
                              <CircleDot className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                            ) : task.status === "HOLD" ? (
                              <PauseCircle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            )}
                            <span className={`font-medium text-sm ${task.status === "COMPLETE" ? "line-through text-muted-foreground" : ""}`}>
                              {task.title.replace(/^\[PD\]\s*/, "")}
                            </span>
                          </div>
                          {task.holdReason && (
                            <p className="text-[10px] text-orange-600 mt-0.5 ml-5 truncate max-w-[300px]">
                              {task.blockedType && <span className={`px-1 py-0 rounded font-semibold mr-0.5 ${task.blockedType === "External" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>{task.blockedType}</span>}
                              {task.holdReason}
                            </p>
                          )}
                        </td>
                        <td className="p-2"><Badge className={`text-[10px] ${taskStatusColor(task.status)}`}>{task.status}</Badge></td>
                        <td className="p-2"><Badge variant="outline" className="text-[10px]">{task.priority}</Badge></td>
                        <td className="p-2 text-xs text-muted-foreground">{(task.assignees || []).join(", ") || "—"}</td>
                        <td className={`p-2 text-xs ${taskOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                          {task.dueDate || "—"}
                          {taskOverdue && <AlertTriangle className="h-3 w-3 inline ml-1 text-red-500" />}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${(task.percentComplete || 0) >= 100 ? "bg-green-500" : (task.percentComplete || 0) > 0 ? "bg-blue-500" : "bg-gray-300"}`}
                                style={{ width: `${Math.min(task.percentComplete || 0, 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground w-7 text-right">{task.percentComplete || 0}%</span>
                          </div>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">{new Date(task.updatedAt).toLocaleDateString()}</td>
                        <td className="p-2">
                          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {ticket.tasksSpawnedAt && (
              <p className="text-[10px] text-muted-foreground text-right">
                Tasks spawned on {new Date(ticket.tasksSpawnedAt).toLocaleDateString()}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function InfoItem({ label, value, sub, icon, action }: { label: string; value: string; sub?: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground flex items-center gap-1">{icon}{label}</p>
      <div className="flex items-center gap-1">
        <p className="font-medium text-sm truncate">{value}</p>
        {action}
      </div>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function statusColor(s: string) {
  if (s === "Completed") return "bg-green-100 text-green-700";
  if (s === "In Progress") return "bg-blue-100 text-blue-700";
  if (s === "On Hold") return "bg-orange-100 text-orange-700";
  if (s === "Cancelled") return "bg-gray-100 text-gray-500";
  return "bg-gray-100 text-gray-700";
}

function priorityColor(p: string) {
  if (p === "Critical") return "bg-red-100 text-red-700";
  if (p === "High") return "bg-orange-100 text-orange-700";
  if (p === "Low") return "bg-green-100 text-green-700";
  return "bg-blue-100 text-blue-700";
}

function taskStatusColor(s: string) {
  if (s === "COMPLETE") return "bg-green-100 text-green-700";
  if (s === "IN PROGRESS") return "bg-blue-100 text-blue-700";
  if (s === "HOLD") return "bg-orange-100 text-orange-700";
  if (s === "TO DO") return "bg-gray-100 text-gray-700";
  return "bg-gray-100 text-gray-700";
}

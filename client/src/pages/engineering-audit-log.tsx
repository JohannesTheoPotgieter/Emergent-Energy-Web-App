import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import {
  History,
  Shield,
  User,
  ArrowRight,
  Filter,
  Clock,
  Activity,
  FileEdit,
  PlusCircle,
  Link2,
  Layers,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
  BarChart3,
  CalendarDays,
  TrendingUp,
} from "lucide-react";

async function engFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface AuditEntry {
  id: number;
  taskId: number;
  actionType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  taskTitle: string | null;
  projectName: string | null;
}

interface AuditStats {
  total: number;
  today: number;
  thisWeek: number;
  byAction: { actionType: string; count: number }[];
  topActors: { actorId: number; actorName: string; count: number }[];
}

interface PhaseHistoryEntry {
  id: number;
  projectId: number;
  fromPhase: string | null;
  toPhase: string;
  reason: string;
  changedAt: string;
  changedByName: string | null;
  projectName: string | null;
}

const ACTION_LABELS: Record<string, { label: string; icon: typeof Activity; color: string }> = {
  created: { label: "Created", icon: PlusCircle, color: "text-emerald-600 bg-emerald-50" },
  field_changed: { label: "Field Changed", icon: FileEdit, color: "text-blue-600 bg-blue-50" },
  bulk_updated: { label: "Bulk Updated", icon: Layers, color: "text-violet-600 bg-violet-50" },
  linked: { label: "Linked", icon: Link2, color: "text-indigo-600 bg-indigo-50" },
  subtask_created: { label: "Subtask Created", icon: PlusCircle, color: "text-teal-600 bg-teal-50" },
  comment_added: { label: "Comment Added", icon: Activity, color: "text-amber-600 bg-amber-50" },
  status_changed: { label: "Status Changed", icon: ArrowRight, color: "text-orange-600 bg-orange-50" },
};

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  priority: "Priority",
  dueDate: "Due Date",
  title: "Title",
  description: "Description",
  assignees: "Assignees",
  phase: "Phase",
  ownerUserId: "Owner",
  projectName: "Project",
  workstream: "Workstream",
  trackingRag: "RAG Status",
  holdReason: "Hold Reason",
  approverUserId: "Approver",
  requesterUserId: "Requester",
  completedAt: "Completed At",
  sortOrder: "Sort Order",
  taskTypeTag: "Task Type",
};

function ActionBadge({ actionType }: { actionType: string }) {
  const config = ACTION_LABELS[actionType] || { label: actionType, icon: Activity, color: "text-gray-600 bg-gray-50" };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${config.color}`} data-testid={`badge-action-${actionType}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function ChangeDetail({ entry }: { entry: AuditEntry }) {
  if (entry.actionType === "created") {
    return <span className="text-xs text-muted-foreground">Created task: <span className="font-medium text-foreground">{entry.newValue}</span></span>;
  }
  if (entry.actionType === "field_changed" && entry.fieldName) {
    const fieldLabel = FIELD_LABELS[entry.fieldName] || entry.fieldName;
    return (
      <div className="text-xs space-y-0.5">
        <span className="text-muted-foreground font-medium">{fieldLabel}:</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {entry.oldValue && (
            <span className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded text-[10px] line-through max-w-[200px] truncate">
              {entry.oldValue}
            </span>
          )}
          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] max-w-[200px] truncate">
            {entry.newValue || "—"}
          </span>
        </div>
      </div>
    );
  }
  if (entry.actionType === "bulk_updated") {
    return <span className="text-xs text-muted-foreground">Bulk update: <span className="font-mono text-[10px]">{entry.newValue}</span></span>;
  }
  if (entry.actionType === "linked") {
    return <span className="text-xs text-muted-foreground">Linked to: <span className="font-mono text-[10px]">{entry.newValue}</span></span>;
  }
  if (entry.actionType === "subtask_created") {
    return <span className="text-xs text-muted-foreground">Added subtask: <span className="font-medium text-foreground">{entry.newValue}</span></span>;
  }
  return <span className="text-xs text-muted-foreground">{entry.newValue || "—"}</span>;
}

function formatDateTime(d: string) {
  try {
    return new Date(d).toLocaleString("en-ZA", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return d; }
}

function formatRelative(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateTime(d);
}

export default function EngineeringAuditLog() {
  const { user } = useAuth();
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [activeTab, setActiveTab] = useState<"tasks" | "phases">("tasks");
  const pageSize = 50;

  if (user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground" data-testid="audit-log-forbidden">
        <Shield className="h-16 w-16 mb-4 opacity-30" />
        <h2 className="text-xl font-semibold">Admin Access Required</h2>
        <p className="text-sm mt-2">Only administrators can view the audit log.</p>
      </div>
    );
  }

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("offset", String(currentPage * pageSize));
    if (projectFilter !== "all") params.set("projectName", projectFilter);
    if (actorFilter !== "all") params.set("actorId", actorFilter);
    if (actionFilter !== "all") params.set("actionType", actionFilter);
    return params.toString();
  }, [projectFilter, actorFilter, actionFilter, currentPage]);

  const { data: logData, isLoading: logLoading } = useQuery<{
    entries: AuditEntry[];
    total: number;
    filters: {
      actionTypes: string[];
      projectNames: string[];
      actors: { id: number; name: string }[];
    };
  }>({
    queryKey: ["eng-audit-log", queryParams],
    queryFn: () => engFetch(`/api/eng/audit-log?${queryParams}`),
    staleTime: 30000,
  });

  const { data: stats } = useQuery<AuditStats>({
    queryKey: ["eng-audit-stats"],
    queryFn: () => engFetch("/api/eng/audit-log/stats"),
    staleTime: 60000,
  });

  const { data: phaseHistory } = useQuery<PhaseHistoryEntry[]>({
    queryKey: ["eng-audit-phase-history"],
    queryFn: () => engFetch("/api/eng/audit-log/phase-history"),
    staleTime: 60000,
    enabled: activeTab === "phases",
  });

  const entries = logData?.entries || [];
  const total = logData?.total || 0;
  const totalPages = Math.ceil(total / pageSize);
  const filters = logData?.filters;

  const filteredEntries = useMemo(() => {
    if (!searchTerm) return entries;
    const term = searchTerm.toLowerCase();
    return entries.filter(e =>
      e.taskTitle?.toLowerCase().includes(term) ||
      e.projectName?.toLowerCase().includes(term) ||
      e.actorName?.toLowerCase().includes(term) ||
      e.fieldName?.toLowerCase().includes(term) ||
      e.newValue?.toLowerCase().includes(term)
    );
  }, [entries, searchTerm]);

  return (
    <div className="space-y-6" data-testid="audit-log-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shadow-sm">
            <History className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold" data-testid="text-audit-title">
              Audit Log
            </h2>
            <p className="text-xs text-muted-foreground">
              Full history of all engineering changes &middot; Admin only
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <button
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === "tasks" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("tasks")}
            data-testid="tab-task-changes"
          >
            Task Changes
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === "phases" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("phases")}
            data-testid="tab-phase-changes"
          >
            Phase Changes
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Total Changes</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <p className="text-2xl font-bold" data-testid="stat-total-changes">{stats?.total || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Today</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <CalendarDays className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-emerald-600" data-testid="stat-today-changes">{stats?.today || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">This Week</span>
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-violet-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-violet-600" data-testid="stat-week-changes">{stats?.thisWeek || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Active Users</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <User className="w-4 h-4 text-amber-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-amber-600" data-testid="stat-active-users">{stats?.topActors?.length || 0}</p>
          </CardContent>
        </Card>
      </div>

      {activeTab === "tasks" && (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <div className="relative flex-1 min-w-[160px] max-w-xs">
                  <Input
                    placeholder="Search changes..."
                    className="h-8 text-xs"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    data-testid="input-audit-search"
                  />
                </div>
                <Select value={projectFilter} onValueChange={v => { setProjectFilter(v); setCurrentPage(0); }}>
                  <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="filter-project">
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {filters?.projectNames.sort().map(p => (
                      <SelectItem key={p} value={p!}>{(p || "").replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setCurrentPage(0); }}>
                  <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="filter-action">
                    <SelectValue placeholder="All Actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    {filters?.actionTypes.map(a => (
                      <SelectItem key={a} value={a}>{ACTION_LABELS[a]?.label || a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={actorFilter} onValueChange={v => { setActorFilter(v); setCurrentPage(0); }}>
                  <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="filter-actor">
                    <SelectValue placeholder="All Users" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {filters?.actors.map(a => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {logLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No audit entries found</p>
              <p className="text-sm mt-1">
                {total === 0
                  ? "Changes will appear here as users modify tasks."
                  : "Try adjusting your filters."}
              </p>
            </div>
          ) : (
            <>
              <Card>
                <div className="divide-y">
                  {filteredEntries.map(entry => (
                    <div key={entry.id} className="flex items-start gap-3 p-4 hover:bg-muted/20 transition-colors" data-testid={`audit-entry-${entry.id}`}>
                      <div className="mt-1 shrink-0">
                        <ActionBadge actionType={entry.actionType} />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold truncate max-w-[300px]">{entry.taskTitle || `Task #${entry.taskId}`}</span>
                          {entry.projectName && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">
                              {entry.projectName.replace(/_/g, " ")}
                            </Badge>
                          )}
                        </div>
                        <ChangeDetail entry={entry} />
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span>{entry.actorName || "System"}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground" title={formatDateTime(entry.createdAt)}>
                          <Clock className="h-3 w-3" />
                          <span>{formatRelative(entry.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-2">
                  <span className="text-xs text-muted-foreground">
                    Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, total)} of {total}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      className="p-1.5 rounded-md border bg-background hover:bg-muted disabled:opacity-30"
                      disabled={currentPage === 0}
                      onClick={() => setCurrentPage(p => p - 1)}
                      data-testid="btn-prev-page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs px-2">Page {currentPage + 1} of {totalPages}</span>
                    <button
                      className="p-1.5 rounded-md border bg-background hover:bg-muted disabled:opacity-30"
                      disabled={currentPage >= totalPages - 1}
                      onClick={() => setCurrentPage(p => p + 1)}
                      data-testid="btn-next-page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {activeTab === "phases" && (
        <Card>
          <CardContent className="p-0">
            {!phaseHistory || phaseHistory.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ArrowRight className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-lg font-medium">No phase changes recorded yet</p>
                <p className="text-sm mt-1">Phase transitions will appear here when admins change project phases.</p>
              </div>
            ) : (
              <div className="divide-y">
                {phaseHistory.map(entry => {
                  const fromLabel = entry.fromPhase ? (PROJECT_PHASE_LABELS[entry.fromPhase as ProjectPhase] || entry.fromPhase) : "None";
                  const toLabel = PROJECT_PHASE_LABELS[entry.toPhase as ProjectPhase] || entry.toPhase;
                  return (
                    <div key={entry.id} className="flex items-start gap-3 p-4 hover:bg-muted/20 transition-colors" data-testid={`phase-entry-${entry.id}`}>
                      <div className="mt-0.5 h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                        <ArrowRight className="h-4 w-4 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <span className="text-xs font-semibold">
                          {entry.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ") || `Project #${entry.projectId}`}
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap text-xs">
                          <span className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{fromLabel}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded font-medium">{toLabel}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{entry.reason}</p>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span>{entry.changedByName || "System"}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground" title={formatDateTime(entry.changedAt)}>
                          <Clock className="h-3 w-3" />
                          <span>{formatRelative(entry.changedAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

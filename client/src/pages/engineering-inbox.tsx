import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Inbox,
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
  Minus,
  AlertTriangle,
  Clock,
  FileText,
  ListTodo,
  RefreshCw,
  Save,
  Zap,
  Filter,
  X,
} from "lucide-react";
import { ActionBar } from "@/components/guidance/ActionBar";
import { MicroWalkthrough, ReplayWalkthrough } from "@/components/guidance/MicroWalkthrough";
import type { NextAction, BlockerInfo } from "@/hooks/use-guidance";

async function spFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

interface IntakeRequest {
  id: number;
  spItemId?: string;
  clientName: string;
  requestType?: string;
  priority?: string;
  status?: string;
  dueDate?: string | null;
  designer?: string | null;
  projectDeveloper?: string | null;
  province?: string | null;
  sizeKwp?: number | null;
  cpSigned?: boolean;
  cpSignedDate?: string | null;
  cpSignedBy?: string | null;
  daysInProgress?: number | null;
  appNotes?: string | null;
  appInternalBlockers?: string | null;
  comments?: string | null;
  syncConflict?: boolean;
  conflictFieldsJson?: Record<string, any> | null;
  projectId?: number | null;
  clientKey?: string | null;
  lastSpEditAt?: string | null;
  lastAppEditAt?: string | null;
  spFieldHash?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

interface IntakeTask {
  id: number;
  title: string;
  status: string;
  dueDate?: string | null;
  assignee?: string | null;
}

const priorityColors: Record<string, string> = {
  Critical: "bg-red-600 text-white",
  Urgent: "bg-orange-100 text-orange-700",
  High: "bg-amber-100 text-amber-700",
  Medium: "bg-blue-100 text-blue-700",
  Low: "bg-muted text-muted-foreground",
};

const statusColors: Record<string, string> = {
  New: "bg-muted text-foreground",
  "In Progress": "bg-blue-100 text-blue-700",
  "Awaiting CP": "bg-amber-100 text-amber-700",
  "CP Signed": "bg-emerald-100 text-emerald-700",
  "Design Complete": "bg-green-100 text-green-700",
  "On Hold": "bg-red-100 text-red-700",
  Cancelled: "bg-muted text-muted-foreground",
  Complete: "bg-green-100 text-green-700",
};

const STATUS_ORDER = ["New", "In Progress", "Awaiting CP", "CP Signed", "Design Complete", "On Hold", "Cancelled", "Complete"];

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return d; }
}

function formatTimestamp(d: string | null | undefined) {
  if (!d) return "Never";
  try {
    return new Date(d).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return d; }
}

function uniqueValues(requests: IntakeRequest[], key: string): string[] {
  const vals = new Set<string>();
  for (const r of requests) {
    const v = r[key];
    if (v && typeof v === "string") vals.add(v);
  }
  return Array.from(vals).sort();
}

function StatusGroup({
  status,
  requests,
  onRowClick,
}: {
  status: string;
  requests: IntakeRequest[];
  onRowClick: (r: IntakeRequest) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border rounded-lg overflow-hidden" data-testid={`status-group-${status.toLowerCase().replace(/\s+/g, "-")}`}>
      <button
        className="w-full flex items-center gap-2 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`toggle-group-${status.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Badge className={`text-xs ${statusColors[status] || "bg-muted text-foreground"}`}>{status}</Badge>
        <span className="text-sm text-muted-foreground font-medium">({requests.length})</span>
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid={`table-${status.toLowerCase().replace(/\s+/g, "-")}`}>
            <thead>
              <tr className="border-t bg-muted/10 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Priority</th>
                <th className="text-left px-3 py-2 font-medium">Due Date</th>
                <th className="text-left px-3 py-2 font-medium">Designer</th>
                <th className="text-left px-3 py-2 font-medium">Project Dev</th>
                <th className="text-right px-3 py-2 font-medium">kWp</th>
                <th className="text-center px-3 py-2 font-medium">CP</th>
                <th className="text-right px-3 py-2 font-medium">Days</th>
                <th className="text-center px-3 py-2 font-medium">Sync</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr
                  key={r.id}
                  className="border-t hover:bg-muted/20 cursor-pointer transition-colors"
                  onClick={() => onRowClick(r)}
                  data-testid={`row-request-${r.id}`}
                >
                  <td className="px-4 py-2.5">
                    {r.projectId ? (
                      <a
                        href={`/projects/${r.projectId}`}
                        className="text-blue-600 hover:underline font-medium"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`link-client-${r.id}`}
                      >
                        {r.clientName}
                      </a>
                    ) : (
                      <span className="font-medium" data-testid={`text-client-${r.id}`}>{r.clientName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.requestType && (
                      <Badge variant="outline" className="text-[10px]" data-testid={`badge-type-${r.id}`}>
                        {r.requestType}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.priority && (
                      <Badge className={`text-[10px] ${priorityColors[r.priority] || "bg-muted"}`} data-testid={`badge-priority-${r.id}`}>
                        {r.priority}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatDate(r.dueDate)}</td>
                  <td className="px-3 py-2.5 text-xs truncate max-w-[120px]">{r.designer || "—"}</td>
                  <td className="px-3 py-2.5 text-xs truncate max-w-[120px]">{r.projectDeveloper || "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-right font-mono">{r.sizeKwp != null ? r.sizeKwp : "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    {r.cpSigned ? (
                      <Check className="h-4 w-4 text-green-600 mx-auto" data-testid={`icon-cp-signed-${r.id}`} />
                    ) : (
                      <Minus className="h-4 w-4 text-gray-300 mx-auto" data-testid={`icon-cp-unsigned-${r.id}`} />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-right font-mono">{r.daysInProgress ?? "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    {r.syncConflict ? (
                      <Badge variant="destructive" className="text-[9px]" data-testid={`badge-conflict-${r.id}`}>
                        Conflict
                      </Badge>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DetailDrawer({
  request,
  onClose,
}: {
  request: IntakeRequest;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [appNotes, setAppNotes] = useState(request.appNotes || "");
  const [dirty, setDirty] = useState(false);

  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const isCoo = companyRole === "COO_ADMIN";

  const { data: tasksData } = useQuery<{ tasks: IntakeTask[] }>({
    queryKey: ["intake-tasks", request.id],
    queryFn: () => spFetch(`/api/sp-sync/intake-tasks/${request.id}`),
  });
  const tasks = tasksData?.tasks || [];

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, any>) =>
      spFetch(`/api/sp-sync/intake-requests/${request.id}`, { method: "PATCH", body: JSON.stringify(updates) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["intake-requests"] });
      setDirty(false);
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cpSignedMutation = useMutation({
    mutationFn: () =>
      spFetch(`/api/sp-sync/cp-signed/${request.id}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["intake-requests"] });
      toast({ title: "CP marked as signed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const generateTasksMutation = useMutation({
    mutationFn: () =>
      spFetch(`/api/sp-sync/generate-tasks/${request.id}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["intake-tasks", request.id] });
      toast({ title: "Tasks generated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="detail-drawer">
        <SheetHeader>
          <SheetTitle className="text-lg" data-testid="text-drawer-client">{request.clientName}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</Label>
              <p className="mt-0.5" data-testid="text-drawer-status">{request.status || "—"}</p>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Priority</Label>
              <div className="mt-0.5">
                {request.priority ? (
                  <Badge className={`text-xs ${priorityColors[request.priority] || "bg-muted"}`}>{request.priority}</Badge>
                ) : "—"}
              </div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Request Type</Label>
              <p className="mt-0.5" data-testid="text-drawer-type">{request.requestType || "—"}</p>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Province</Label>
              <p className="mt-0.5">{request.province || "—"}</p>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Designer</Label>
              <p className="mt-0.5">{request.designer || "—"}</p>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Project Developer</Label>
              <p className="mt-0.5">{request.projectDeveloper || "—"}</p>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Due Date</Label>
              <p className="mt-0.5">{formatDate(request.dueDate)}</p>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Size (kWp)</Label>
              <p className="mt-0.5 font-mono">{request.sizeKwp != null ? request.sizeKwp : "—"}</p>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Days in Progress</Label>
              <p className="mt-0.5 font-mono">{request.daysInProgress ?? "—"}</p>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">CP Signed</Label>
              <div className="mt-0.5 flex items-center gap-1">
                {request.cpSigned ? (
                  <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                    <Check className="h-4 w-4" /> Yes
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-gray-400 text-xs">
                    <Minus className="h-4 w-4" /> No
                  </span>
                )}
              </div>
            </div>
          </div>

          {request.syncConflict && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Sync Conflict
              </p>
              {request.conflictFieldsJson && (
                <p className="text-sm mt-1">
                  Conflicting fields: {Object.keys(request.conflictFieldsJson).join(", ")}
                </p>
              )}
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">App Notes</Label>
            <Textarea
              value={appNotes}
              onChange={(e) => { setAppNotes(e.target.value); setDirty(true); }}
              placeholder="Add notes..."
              className="min-h-[80px] text-sm"
              data-testid="textarea-app-notes"
            />
            {dirty && (
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => updateMutation.mutate({ appNotes })}
                disabled={updateMutation.isPending}
                data-testid="btn-save-notes"
              >
                <Save className="h-3 w-3 mr-1" />
                Save Notes
              </Button>
            )}
          </div>

          {isCoo && !request.cpSigned && (
            <Button
              onClick={() => cpSignedMutation.mutate()}
              disabled={cpSignedMutation.isPending}
              className="w-full"
              data-testid="btn-cp-signed"
            >
              <Check className="h-4 w-4 mr-2" />
              Mark CP Signed
            </Button>
          )}

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <ListTodo className="h-3.5 w-3.5" /> Tasks
              </Label>
              {isCoo && tasks.length === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => generateTasksMutation.mutate()}
                  disabled={generateTasksMutation.isPending}
                  data-testid="btn-generate-tasks"
                >
                  <Zap className="h-3 w-3 mr-1" />
                  Generate Tasks
                </Button>
              )}
            </div>

            {tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No tasks generated yet</p>
            ) : (
              <div className="space-y-1">
                {tasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 p-2 bg-muted/20 rounded text-xs"
                    data-testid={`task-row-${t.id}`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === "Complete" ? "bg-green-500" : t.status === "In Progress" ? "bg-blue-500" : "bg-gray-400"}`} />
                    <span className="flex-1 truncate">{t.title}</span>
                    <Badge variant="outline" className="text-[9px]">{t.status}</Badge>
                    {t.dueDate && <span className="text-muted-foreground">{formatDate(t.dueDate)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function EngineeringInbox() {
  const [selectedRequest, setSelectedRequest] = useState<IntakeRequest | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const { data: requestsData, isLoading } = useQuery<{ requests: IntakeRequest[] }>({
    queryKey: ["intake-requests"],
    queryFn: () => spFetch("/api/sp-sync/intake-requests"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: syncStatus } = useQuery<{ lastPulledAt?: string }>({
    queryKey: ["sp-sync-status"],
    queryFn: () => spFetch("/api/sp-sync/status"),
  });

  const requests = requestsData?.requests || [];

  const filterOptions = useMemo(() => ({
    statuses: uniqueValues(requests, "status"),
    priorities: uniqueValues(requests, "priority"),
    requestTypes: uniqueValues(requests, "requestType"),
    designers: uniqueValues(requests, "designer"),
    projectDevelopers: uniqueValues(requests, "projectDeveloper"),
    provinces: uniqueValues(requests, "province"),
  }), [requests]);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.priority && r.priority !== filters.priority) return false;
      if (filters.requestType && r.requestType !== filters.requestType) return false;
      if (filters.designer && r.designer !== filters.designer) return false;
      if (filters.projectDeveloper && r.projectDeveloper !== filters.projectDeveloper) return false;
      if (filters.province && r.province !== filters.province) return false;
      return true;
    });
  }, [requests, filters]);

  const grouped = useMemo(() => {
    const groups = new Map<string, IntakeRequest[]>();
    for (const r of filtered) {
      const status = r.status || "Unknown";
      if (!groups.has(status)) groups.set(status, []);
      groups.get(status)!.push(r);
    }
    const sorted: [string, IntakeRequest[]][] = [];
    for (const s of STATUS_ORDER) {
      if (groups.has(s)) { sorted.push([s, groups.get(s)!]); groups.delete(s); }
    }
    groups.forEach((items, s) => sorted.push([s, items]));
    return sorted;
  }, [filtered]);

  const totalRequests = requests.length;
  const inProgress = requests.filter((r) => r.status === "In Progress").length;
  const awaitingCp = requests.filter((r) => r.status === "Awaiting CP").length;
  const conflicts = requests.filter((r) => r.syncConflict).length;

  const hasFilters = Object.values(filters).some(Boolean);

  const newRequests = requests.filter(r => r.status === "New");
  const inboxNextAction = useMemo((): NextAction | null => {
    if (conflicts > 0) return { label: `${conflicts} sync conflict${conflicts !== 1 ? "s" : ""} need resolution`, severity: "urgent" };
    if (newRequests.length > 0) return { label: `${newRequests.length} new request${newRequests.length !== 1 ? "s" : ""} to triage`, severity: "warning" };
    if (awaitingCp > 0) return { label: `${awaitingCp} request${awaitingCp !== 1 ? "s" : ""} awaiting Cost Proposal sign-off`, severity: "info" };
    return { label: "Pipeline clear — all requests in progress", severity: "info" };
  }, [conflicts, newRequests, awaitingCp]);

  const inboxBlockers = useMemo((): BlockerInfo[] => {
    const b: BlockerInfo[] = [];
    if (conflicts > 0) b.push({ label: "Sync conflicts", count: conflicts, severity: "urgent" });
    if (newRequests.length > 0) b.push({ label: "Untriaged requests", count: newRequests.length, severity: "warning" });
    return b;
  }, [conflicts, newRequests]);

  const inboxWalkthroughSteps = useMemo(() => [
    { title: "Request pipeline", description: "All engineering requests come in here from SharePoint. They're grouped by status." },
    { title: "Click to review", description: "Click any row to open a detail drawer. You can add notes, generate task packs, or mark CP signed." },
    { title: "Filters", description: "Use the filter row to narrow by status, priority, type, or designer." },
  ], []);

  if (isLoading) {
    return (
      <div data-testid="engineering-inbox" className="space-y-5">
        <div className="flex items-center gap-3">
          <Inbox className="h-7 w-7 text-blue-500" />
          <div>
            <h2 className="text-lg sm:text-xl md:text-2xl font-heading font-bold">Engineering Pipeline</h2>
            <p className="text-xs text-muted-foreground">Loading...</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="engineering-inbox" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
            <Inbox className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl md:text-2xl font-heading font-bold" data-testid="text-pipeline-title">
              Engineering Pipeline
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-last-sync">
              <RefreshCw className="h-3 w-3" />
              Last sync: {formatTimestamp(syncStatus?.lastPulledAt)}
            </p>
          </div>
          <ReplayWalkthrough screenId="eng-inbox" />
        </div>
      </div>

      <MicroWalkthrough screenId="eng-inbox" steps={inboxWalkthroughSteps} />
      <ActionBar nextAction={inboxNextAction} blockers={inboxBlockers} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Total Requests</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <FileText className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <p className="text-2xl font-bold" data-testid="stat-total-requests">{totalRequests}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">In Progress</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Clock className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-blue-600" data-testid="stat-in-progress">{inProgress}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-amber-600 uppercase tracking-wide">Awaiting CP</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <FileText className="w-4 h-4 text-amber-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-amber-600" data-testid="stat-awaiting-cp">{awaitingCp}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[10px] font-medium uppercase tracking-wide ${conflicts > 0 ? "text-red-600" : "text-muted-foreground"}`}>Conflicts</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${conflicts > 0 ? "bg-red-50" : "bg-muted"}`}>
                <AlertTriangle className={`w-4 h-4 ${conflicts > 0 ? "text-red-600" : "text-muted-foreground"}`} />
              </div>
            </div>
            <p className={`text-2xl font-bold ${conflicts > 0 ? "text-red-600" : ""}`} data-testid="stat-conflicts">{conflicts}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filters</span>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] ml-auto"
                onClick={() => setFilters({})}
                data-testid="btn-clear-filters"
              >
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <SearchableSelect
              value={filters.status || ""}
              onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "all" ? "" : v }))}
              placeholder="Status"
              triggerClassName="h-8 text-xs"
              data-testid="filter-status"
              options={[
                { value: "all", label: "All Statuses" },
                ...filterOptions.statuses.map((s) => ({ value: s, label: s })),
              ]}
            />

            <SearchableSelect
              value={filters.priority || ""}
              onValueChange={(v) => setFilters((f) => ({ ...f, priority: v === "all" ? "" : v }))}
              placeholder="Priority"
              triggerClassName="h-8 text-xs"
              data-testid="filter-priority"
              options={[
                { value: "all", label: "All Priorities" },
                ...filterOptions.priorities.map((p) => ({ value: p, label: p })),
              ]}
            />

            <SearchableSelect
              value={filters.requestType || ""}
              onValueChange={(v) => setFilters((f) => ({ ...f, requestType: v === "all" ? "" : v }))}
              placeholder="Request Type"
              triggerClassName="h-8 text-xs"
              data-testid="filter-request-type"
              options={[
                { value: "all", label: "All Types" },
                ...filterOptions.requestTypes.map((t) => ({ value: t, label: t })),
              ]}
            />

            <SearchableSelect
              value={filters.designer || ""}
              onValueChange={(v) => setFilters((f) => ({ ...f, designer: v === "all" ? "" : v }))}
              placeholder="Designer"
              triggerClassName="h-8 text-xs"
              data-testid="filter-designer"
              options={[
                { value: "all", label: "All Designers" },
                ...filterOptions.designers.map((d) => ({ value: d, label: d })),
              ]}
            />

            <SearchableSelect
              value={filters.projectDeveloper || ""}
              onValueChange={(v) => setFilters((f) => ({ ...f, projectDeveloper: v === "all" ? "" : v }))}
              placeholder="Project Dev"
              triggerClassName="h-8 text-xs"
              data-testid="filter-project-developer"
              options={[
                { value: "all", label: "All Project Devs" },
                ...filterOptions.projectDevelopers.map((d) => ({ value: d, label: d })),
              ]}
            />

            <SearchableSelect
              value={filters.province || ""}
              onValueChange={(v) => setFilters((f) => ({ ...f, province: v === "all" ? "" : v }))}
              placeholder="Province"
              triggerClassName="h-8 text-xs"
              data-testid="filter-province"
              options={[
                { value: "all", label: "All Provinces" },
                ...filterOptions.provinces.map((p) => ({ value: p, label: p })),
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Inbox className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No requests found</p>
          <p className="text-sm mt-1">Adjust your filters or wait for the next sync</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="request-groups">
          {grouped.map(([status, items]) => (
            <StatusGroup
              key={status}
              status={status}
              requests={items}
              onRowClick={setSelectedRequest}
            />
          ))}
        </div>
      )}

      {selectedRequest && (
        <DetailDrawer
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
        />
      )}
    </div>
  );
}

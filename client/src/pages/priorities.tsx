import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Flag, Plus, AlertTriangle, AlertCircle, Clock, RefreshCw, ArrowUp, CheckCircle2, Users, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { isPriorityAdminRole, isDepartmentHeadRole, SCOPE_LABELS } from "@/config/priorities";
import { ROLE_DEPARTMENT_MAP } from "@shared/schema/users";

// ── Types ──────────────────────────────────────────────────────

interface Priority {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  severity: string;
  status: string;
  dueDate: string | null;
  assignedTo: string | null;
  sortOrder: number;
  manualHealth: string | null;
  manualProgress: number | null;
  targetStartDate: string | null;
  targetOutcome: string | null;
  owner: { id: number; name: string } | null;
  accountableExec: { id: number; name: string } | null;
  assignedUser: { id: number; name: string } | null;
  effectiveHealth: string;
  effectiveProgress: number;
  healthReasons?: string[];
  projectCount: number;
  atRiskProjectCount: number;
  totalRevenue: number;
  totalCos: number;
  totalGp: number;
  blockerCount: number;
  openTaskCount: number;
  hasProjects: boolean;
  scope: string;
  parentId: number | null;
  departmentKey: string | null;
  assignedUserId: number | null;
  escalated: boolean;
  escalatedAt: string | null;
  escalationReason: string | null;
  childCount: number;
  parentTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Constants ──────────────────────────────────────────────────

const HEALTH_COLORS: Record<string, string> = {
  critical: "border-l-red-500",
  at_risk: "border-l-amber-500",
  healthy: "border-l-emerald-500",
};

const HEALTH_DOT_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  at_risk: "bg-amber-500",
  healthy: "bg-emerald-500",
};

const SEVERITY_BADGE: Record<string, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-red-100 text-red-700 hover:bg-red-100" },
  important: { label: "High", className: "bg-amber-100 text-amber-700 hover:bg-amber-100" },
  normal: { label: "Normal", className: "bg-gray-100 text-gray-600 hover:bg-gray-100" },
};

const DEPARTMENT_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "LEADERSHIP", label: "Leadership" },
  { value: "ENGINEERING", label: "Engineering" },
  { value: "PROJECT_DEVELOPMENT", label: "Project Development" },
  { value: "PROJECT_MANAGEMENT", label: "Project Management" },
  { value: "FINANCE", label: "Finance" },
];

function daysRemaining(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const now = new Date();
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Fetch helper ───────────────────────────────────────────────

async function fetchPriorities(params: string): Promise<Priority[]> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api/priorities?${params}`, { credentials: "include", headers });
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Server returned ${res.status} with non-JSON response.`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Failed to load priorities (${res.status})`);
  }
  return res.json();
}

// ── Priority Card ──────────────────────────────────────────────

export function PriorityCard({ priority, showEscalate, onEscalate, showMarkComplete, onMarkComplete, showDeptActions, onAssign, showReopen, onReopen }: {
  priority: Priority;
  showEscalate?: boolean;
  onEscalate?: () => void;
  showMarkComplete?: boolean;
  onMarkComplete?: () => void;
  showDeptActions?: boolean;
  onAssign?: () => void;
  showReopen?: boolean;
  onReopen?: () => void;
}) {
  const days = daysRemaining(priority.dueDate);
  const healthColor = HEALTH_COLORS[priority.effectiveHealth] || HEALTH_COLORS.healthy;
  const dotColor = HEALTH_DOT_COLORS[priority.effectiveHealth] || HEALTH_DOT_COLORS.healthy;
  const sev = SEVERITY_BADGE[priority.severity] || SEVERITY_BADGE.normal;

  return (
    <Card className={`border-l-4 ${healthColor} hover:shadow-md transition-shadow`}>
      <CardContent className="p-4">
        {/* Escalation badge */}
        {priority.escalated && (
          <div className="flex items-center gap-1 mb-2">
            <Badge variant="destructive" className="text-[10px]">
              <AlertTriangle className="w-3 h-3 mr-0.5" />
              Escalated{priority.escalationReason ? ` — ${priority.escalationReason}` : ""}
            </Badge>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${dotColor} shrink-0`}
            title={priority.healthReasons && priority.healthReasons.length > 0
              ? `Health: ${priority.effectiveHealth} — ${priority.healthReasons.join("; ")}`
              : `Health: ${priority.effectiveHealth}`}
          />
          <Link href={`/priorities/${priority.id}`}>
            <span className="text-sm font-semibold text-foreground hover:text-primary hover:underline cursor-pointer truncate">
              {priority.title}
            </span>
          </Link>
          <Badge variant="secondary" className={`text-[10px] ml-auto shrink-0 ${sev.className}`}>
            {sev.label}
          </Badge>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2 flex-wrap">
          {priority.assignedUser && <span><User className="w-3 h-3 inline mr-0.5" />{priority.assignedUser.name}</span>}
          {!priority.assignedUser && priority.owner && <span>{priority.owner.name}</span>}
          {!priority.assignedUser && !priority.owner && priority.assignedTo && <span>{priority.assignedTo}</span>}
          {priority.dueDate && (
            <span className={days != null && days <= 7 ? "text-red-600 font-medium" : days != null && days <= 14 ? "text-amber-600 font-medium" : ""}>
              <Clock className="w-3 h-3 inline mr-0.5" />
              {days != null && days < 0 ? `${Math.abs(days)}d overdue` : days != null ? `${days}d` : priority.dueDate}
            </span>
          )}
          {priority.blockerCount > 0 && (
            <span className="text-red-600 font-medium">
              <AlertTriangle className="w-3 h-3 inline mr-0.5" />
              {priority.blockerCount} blocker{priority.blockerCount > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">
              {priority.effectiveProgress}%{!priority.hasProjects && " (manual)"}
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                priority.effectiveHealth === "critical" ? "bg-red-500" :
                priority.effectiveHealth === "at_risk" ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(priority.effectiveProgress, 100)}%` }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            {priority.parentTitle && (
              <Link href={`/priorities/${priority.parentId}`}>
                <span className="text-primary hover:underline cursor-pointer">Part of: {priority.parentTitle}</span>
              </Link>
            )}
            {!priority.parentTitle && priority.departmentKey && (
              <span>{DEPARTMENT_OPTIONS.find(d => d.value === priority.departmentKey)?.label || priority.departmentKey}</span>
            )}
            {!priority.parentTitle && !priority.departmentKey && priority.department && (
              <span>{priority.department}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {priority.childCount > 0 && (
              <span>{priority.childCount} sub-priorit{priority.childCount === 1 ? "y" : "ies"}</span>
            )}
            {priority.hasProjects && (
              <span>
                {priority.projectCount} project{priority.projectCount !== 1 ? "s" : ""}
                {priority.atRiskProjectCount > 0 && (
                  <span className="text-red-600 ml-1">· {priority.atRiskProjectCount} at risk</span>
                )}
              </span>
            )}
            {!priority.hasProjects && priority.childCount === 0 && (
              <span className="italic">Standalone</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {(showMarkComplete || (showEscalate && priority.scope !== "company") || showDeptActions || showReopen) && (
          <div className="mt-2 pt-2 border-t flex items-center gap-2 flex-wrap">
            {showMarkComplete && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={onMarkComplete}
                disabled={priority.status === "complete" || priority.status === "closed"}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {priority.status === "complete" || priority.status === "closed" ? "Completed" : "Mark Complete"}
              </Button>
            )}
            {showDeptActions && (
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={onAssign}>
                <Users className="w-3 h-3 mr-1" />
                {priority.assignedUser ? "Reassign" : "Assign Priority"}
              </Button>
            )}
            {showReopen && (priority.status === "closed" || priority.status === "complete") && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                onClick={onReopen}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Reopen
              </Button>
            )}
            {showEscalate && priority.scope !== "company" && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 text-orange-700 border-orange-200 hover:bg-orange-50"
                onClick={onEscalate}
                disabled={priority.status === "complete" || priority.status === "closed"}
              >
                <ArrowUp className="w-3 h-3 mr-1" />
                {showDeptActions ? "Escalate to Company" : "Escalate"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Create Priority Dialog ─────────────────────────────────────

const emptyForm = {
  title: "",
  description: "",
  department: "",
  severity: "normal",
  horizon: "quarter",
  due_date: "",
  target_outcome: "",
  next_action: "",
  definition_of_done: "",
  manual_health: "",
  manual_progress: "",
  scope: "company" as string,
  department_key: "",
  owner_user_id: "" as string,
  accountable_exec_id: "" as string,
  assigned_user_id: "" as string,
  parent_id: "" as string,
  project_ids: [] as number[],
};

function useUserOptions(enabled: boolean): SearchableSelectOption[] {
  const { data: users = [] } = useQuery<{ id: number; name: string; role: string }[]>({
    queryKey: ["/api/users-list-for-priority"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/users", { credentials: "include", headers });
      if (!res.ok) return [];
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data.users || data.data || [];
      return rows.map((u: any) => ({ id: u.id, name: u.name, role: u.role }));
    },
    enabled,
  });
  return useMemo(
    () => users.map((u) => ({ value: String(u.id), label: u.name })),
    [users],
  );
}

function useProjectOptions(enabled: boolean): { value: number; label: string }[] {
  const { data: projects = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/priorities-project-picker"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      try {
        const res = await fetch("/api/projects-summary", { credentials: "include", headers });
        if (res.ok) {
          const data = await res.json();
          const rows = Array.isArray(data) ? data : data.projects || data.data?.rows || [];
          if (rows.length > 0) {
            return rows.map((p: any) => ({
              id: p.id || p.project_info_id,
              name: p.projectName || p.project_name || p.name || `Project ${p.id || p.project_info_id}`,
            }));
          }
        }
      } catch {
        // fall through
      }
      const res = await fetch("/api/v2/projects?pageSize=500", { credentials: "include", headers });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data?.rows || []).map((p: any) => ({
        id: p.id,
        name: p.projectName || p.project_name || p.name || `Project ${p.id}`,
      }));
    },
    enabled,
  });
  return useMemo(() => projects.map((p) => ({ value: p.id, label: p.name })), [projects]);
}

function CreatePriorityDialog({ open, onOpenChange, defaultScope, defaultDepartment }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultScope?: string;
  defaultDepartment?: string;
}) {
  const [form, setForm] = useState({ ...emptyForm, scope: defaultScope || "company", department_key: defaultDepartment || "" });
  const [projectSearch, setProjectSearch] = useState("");
  const queryClient = useQueryClient();

  const userOptions = useUserOptions(open);
  const projectOptions = useProjectOptions(open);

  const filteredProjects = useMemo(() => {
    const needle = projectSearch.trim().toLowerCase();
    if (!needle) return projectOptions;
    return projectOptions.filter((p) => p.label.toLowerCase().includes(needle));
  }, [projectOptions, projectSearch]);

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/priorities", {
        title: form.title,
        description: form.description || null,
        department: form.department || null,
        severity: form.severity,
        horizon: form.horizon,
        due_date: form.due_date || null,
        target_outcome: form.target_outcome || null,
        next_action: form.next_action || null,
        definition_of_done: form.definition_of_done || null,
        manual_health: form.manual_health || null,
        manual_progress: form.manual_progress ? parseInt(form.manual_progress, 10) : null,
        scope: form.scope,
        department_key: form.department_key || null,
        owner_user_id: form.owner_user_id ? parseInt(form.owner_user_id, 10) : null,
        accountable_exec_id: form.accountable_exec_id ? parseInt(form.accountable_exec_id, 10) : null,
        assigned_user_id: form.assigned_user_id ? parseInt(form.assigned_user_id, 10) : null,
        parent_id: form.parent_id ? parseInt(form.parent_id, 10) : null,
        project_ids: form.project_ids.length > 0 ? form.project_ids : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      setForm({ ...emptyForm, scope: defaultScope || "company", department_key: defaultDepartment || "" });
      setProjectSearch("");
      onOpenChange(false);
    },
  });

  const toggleProjectId = (id: number) => {
    setForm((prev) => ({
      ...prev,
      project_ids: prev.project_ids.includes(id)
        ? prev.project_ids.filter((x) => x !== id)
        : [...prev.project_ids, id],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Priority</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="title" className="text-xs">Title *</Label>
            <Input id="title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Priority title" />
          </div>
          <div>
            <Label htmlFor="description" className="text-xs">Description</Label>
            <Textarea id="description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description" rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Scope</Label>
              <Select value={form.scope} onValueChange={v => setForm({ ...form, scope: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Company</SelectItem>
                  <SelectItem value="department">Department</SelectItem>
                  <SelectItem value="role">Role / Individual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="severity" className="text-xs">Severity</Label>
              <Select value={form.severity} onValueChange={v => setForm({ ...form, severity: v })}>
                <SelectTrigger id="severity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="important">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="horizon" className="text-xs">Horizon</Label>
              <Select value={form.horizon} onValueChange={v => setForm({ ...form, horizon: v })}>
                <SelectTrigger id="horizon"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This week</SelectItem>
                  <SelectItem value="month">This month</SelectItem>
                  <SelectItem value="quarter">This quarter</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {(form.scope === "department" || form.scope === "role") && (
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={form.department_key} onValueChange={v => setForm({ ...form, department_key: v })}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENT_OPTIONS.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Owner</Label>
              <SearchableSelect
                options={userOptions}
                value={form.owner_user_id}
                onValueChange={(v) => setForm({ ...form, owner_user_id: v })}
                placeholder="Who drives this?"
                searchPlaceholder="Search people..."
              />
            </div>
            <div>
              <Label className="text-xs">Accountable exec</Label>
              <SearchableSelect
                options={userOptions}
                value={form.accountable_exec_id}
                onValueChange={(v) => setForm({ ...form, accountable_exec_id: v })}
                placeholder="Executive sponsor"
                searchPlaceholder="Search people..."
              />
            </div>
          </div>
          {form.scope === "role" && (
            <div>
              <Label className="text-xs">Assign to</Label>
              <SearchableSelect
                options={userOptions}
                value={form.assigned_user_id}
                onValueChange={(v) => setForm({ ...form, assigned_user_id: v })}
                placeholder="Select person"
                searchPlaceholder="Search people..."
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="due_date" className="text-xs">Due Date</Label>
              <Input id="due_date" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="manual_health" className="text-xs">Health</Label>
              <Select value={form.manual_health || "none"} onValueChange={v => setForm({ ...form, manual_health: v === "none" ? "" : v })}>
                <SelectTrigger id="manual_health"><SelectValue placeholder="Auto" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Auto</SelectItem>
                  <SelectItem value="healthy">Healthy</SelectItem>
                  <SelectItem value="at_risk">At Risk</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="target_outcome" className="text-xs">Target Outcome</Label>
            <Textarea id="target_outcome" value={form.target_outcome} onChange={e => setForm({ ...form, target_outcome: e.target.value })} placeholder="What does success look like?" rows={2} />
          </div>
          <div>
            <Label htmlFor="next_action" className="text-xs">Next action</Label>
            <Input id="next_action" value={form.next_action} onChange={e => setForm({ ...form, next_action: e.target.value })} placeholder="Concrete next step" />
          </div>
          <div>
            <Label htmlFor="definition_of_done" className="text-xs">Definition of done</Label>
            <Textarea id="definition_of_done" value={form.definition_of_done} onChange={e => setForm({ ...form, definition_of_done: e.target.value })} placeholder="Checklist / acceptance criteria" rows={2} />
          </div>

          {/* Inline project linker — optional. Users can create + link in one step now. */}
          <div>
            <Label className="text-xs">Link projects (optional)</Label>
            <Input
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Search projects..."
              className="mb-1"
            />
            <div className="max-h-40 overflow-y-auto rounded border p-1 space-y-0.5">
              {filteredProjects.length === 0 && (
                <p className="text-xs text-muted-foreground py-1 text-center">No matching projects</p>
              )}
              {filteredProjects.slice(0, 50).map((p) => (
                <label key={p.value} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={form.project_ids.includes(p.value)}
                    onChange={() => toggleProjectId(p.value)}
                    className="rounded"
                  />
                  <span>{p.label}</span>
                </label>
              ))}
              {filteredProjects.length > 50 && (
                <p className="text-[10px] text-muted-foreground py-1 text-center">Showing first 50 — refine search</p>
              )}
            </div>
            {form.project_ids.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">{form.project_ids.length} project{form.project_ids.length === 1 ? "" : "s"} selected</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create Priority"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Assign Priority Dialog ─────────────────────────────────────

function AssignPriorityDialog({ open, onOpenChange, priorityId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  priorityId: number | null;
}) {
  const [userId, setUserId] = useState("");
  const queryClient = useQueryClient();
  const userOptions = useUserOptions(open);

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!priorityId) return;
      return apiRequest("PUT", `/api/priorities/${priorityId}`, {
        assigned_user_id: userId ? parseInt(userId, 10) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      setUserId("");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Priority</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Assign this priority to a team member. They'll see it in their "My Priorities" tab.
          </p>
          <div>
            <Label className="text-xs">Assign to</Label>
            <SearchableSelect
              options={userOptions}
              value={userId}
              onValueChange={setUserId}
              placeholder="Select person"
              searchPlaceholder="Search people..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => assignMutation.mutate()} disabled={!userId || assignMutation.isPending}>
            {assignMutation.isPending ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Priority List Section ──────────────────────────────────────

function PriorityListSection({ priorities, isLoading, isError, error, refetch, showEscalate, onEscalate, showMarkComplete, onMarkComplete, showDeptActions, onAssign, showReopen, onReopen, emptyMessage, emptyAction }: {
  priorities: Priority[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  showEscalate?: boolean;
  onEscalate?: (id: number) => void;
  showMarkComplete?: boolean;
  onMarkComplete?: (id: number) => void;
  showDeptActions?: boolean;
  onAssign?: (id: number) => void;
  showReopen?: boolean;
  onReopen?: (id: number) => void;
  emptyMessage: string;
  emptyAction?: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-500" />
        <p className="text-sm font-medium text-red-600 mb-1">Failed to load priorities</p>
        <p className="text-xs text-muted-foreground mb-3">{error?.message || "Unknown error"}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="w-3 h-3 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  // Split: escalated items first
  const escalated = priorities.filter(p => p.escalated);
  const normal = priorities.filter(p => !p.escalated);

  return (
    <div>
      {escalated.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-red-600 uppercase flex items-center gap-1 mb-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Escalations ({escalated.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {escalated.map(p => (
              <PriorityCard
                key={p.id}
                priority={p}
                showEscalate={showEscalate}
                onEscalate={() => onEscalate?.(p.id)}
                showMarkComplete={showMarkComplete}
                onMarkComplete={() => onMarkComplete?.(p.id)}
                showDeptActions={showDeptActions}
              />
            ))}
          </div>
        </div>
      )}

      {normal.length === 0 && escalated.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Flag className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground mb-1">{emptyMessage}</p>
          {emptyAction}
        </div>
      ) : normal.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {normal.map(p => (
            <PriorityCard
              key={p.id}
              priority={p}
              showEscalate={showEscalate}
              onEscalate={() => onEscalate?.(p.id)}
              showMarkComplete={showMarkComplete}
              onMarkComplete={() => onMarkComplete?.(p.id)}
              showDeptActions={showDeptActions}
              onAssign={() => onAssign?.(p.id)}
              showReopen={showReopen}
              onReopen={() => onReopen?.(p.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────

export default function PrioritiesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);

  const isAdmin = isPriorityAdminRole(user?.role);
  const isDeptHead = isDepartmentHeadRole(user?.role);
  const userDepartment = user?.role ? ROLE_DEPARTMENT_MAP[user.role] : undefined;

  // Determine default tab based on role
  const tabParam = params.get("tab");
  const defaultTab = tabParam || (isAdmin ? "company" : "mine");
  const [activeTab, setActiveTab] = useState(defaultTab);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [assignDialogPriorityId, setAssignDialogPriorityId] = useState<number | null>(null);
  const [levelFilter, setLevelFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [showClosed, setShowClosed] = useState(false);

  const listQueryParams = (base: string) =>
    showClosed ? `${base}&include_cancelled=true` : base;

  // ── My Priorities ──
  const myQuery = useQuery<Priority[]>({
    queryKey: ["/api/priorities", "mine", showClosed],
    queryFn: () => fetchPriorities(listQueryParams("scope=role&assigned_user_id=me")),
    enabled: activeTab === "mine",
  });

  // ── Department Priorities ──
  // include_team_roles=true broadens the response to also surface role-level
  // priorities owned or assigned to team members in the same department, so
  // a dept head sees everything on their team rather than only the rows
  // explicitly scoped to their department.
  const deptQuery = useQuery<Priority[]>({
    queryKey: ["/api/priorities", "department", userDepartment, showClosed],
    queryFn: () => fetchPriorities(
      listQueryParams(
        `scope=department${userDepartment ? `&department=${userDepartment}` : ""}&include_team_roles=true`,
      ),
    ),
    enabled: activeTab === "department" && isDeptHead,
  });

  // ── Company Priorities ──
  const companyQuery = useQuery<Priority[]>({
    queryKey: ["/api/priorities", "company", showClosed],
    queryFn: () => fetchPriorities(listQueryParams("scope=company")),
    enabled: activeTab === "company",
  });

  // ── Escalate mutation ──
  const escalateMutation = useMutation({
    mutationFn: async (priorityId: number) => {
      return apiRequest("POST", `/api/priorities/${priorityId}/escalate`, { reason: "manual" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
    },
  });

  // ── Mark complete mutation ──
  const markCompleteMutation = useMutation({
    mutationFn: async (priorityId: number) => {
      return apiRequest("PUT", `/api/priorities/${priorityId}`, { status: "complete" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
    },
  });

  // ── Reopen mutation (archive → active) ──
  const reopenMutation = useMutation({
    mutationFn: async (priorityId: number) => {
      return apiRequest("PUT", `/api/priorities/${priorityId}`, { status: "active" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
    },
  });

  // Apply filters to active data
  const applyFilters = (data: Priority[]) => {
    return data.filter(p => {
      if (levelFilter !== "all" && p.severity !== levelFilter) return false;
      if (healthFilter !== "all" && p.effectiveHealth !== healthFilter) return false;
      return true;
    });
  };

  const filteredMine = useMemo(() => applyFilters(myQuery.data || []), [myQuery.data, levelFilter, healthFilter]);
  const filteredDept = useMemo(() => applyFilters(deptQuery.data || []), [deptQuery.data, levelFilter, healthFilter]);
  const filteredCompany = useMemo(() => applyFilters(companyQuery.data || []), [companyQuery.data, levelFilter, healthFilter]);

  const activeData = activeTab === "mine" ? filteredMine : activeTab === "department" ? filteredDept : filteredCompany;
  const activeCount = activeData.filter(p => p.status !== "closed" && p.status !== "complete").length;
  const closedData = activeData.filter(p => p.status === "closed" || p.status === "complete");

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Flag className="w-5 h-5" />
            Priorities
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeCount} active priorit{activeCount === 1 ? "y" : "ies"}
            {showClosed && closedData.length > 0 && ` · ${closedData.length} closed`}
          </p>
        </div>
        {(isAdmin || isDeptHead) && (
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Add Priority
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="mine" className="text-xs">
              <User className="w-3.5 h-3.5 mr-1" />
              {SCOPE_LABELS.role}
            </TabsTrigger>
            {isDeptHead && (
              <TabsTrigger value="department" className="text-xs">
                <Users className="w-3.5 h-3.5 mr-1" />
                {SCOPE_LABELS.department}
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="company" className="text-xs">
                <Flag className="w-3.5 h-3.5 mr-1" />
                {SCOPE_LABELS.company}
              </TabsTrigger>
            )}
          </TabsList>

          {/* Filters */}
          <div className="flex items-center gap-2">
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="important">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
              </SelectContent>
            </Select>
            <Select value={healthFilter} onValueChange={setHealthFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue placeholder="Health" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All health</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="at_risk">At risk</SelectItem>
                <SelectItem value="healthy">Healthy</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
                className="rounded"
              />
              Show closed
            </label>
            {(levelFilter !== "all" || healthFilter !== "all") && (
              <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => { setLevelFilter("all"); setHealthFilter("all"); }}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* My Priorities Tab */}
        <TabsContent value="mine">
          <PriorityListSection
            priorities={filteredMine}
            isLoading={myQuery.isLoading}
            isError={myQuery.isError}
            error={myQuery.error as Error}
            refetch={myQuery.refetch}
            showEscalate
            onEscalate={(id) => escalateMutation.mutate(id)}
            showMarkComplete
            onMarkComplete={(id) => markCompleteMutation.mutate(id)}
            showReopen={showClosed}
            onReopen={(id) => reopenMutation.mutate(id)}
            emptyMessage="No priorities assigned to you"
            emptyAction={
              <p className="text-xs text-muted-foreground mt-1">
                Priorities will appear here when assigned by your department head or when you create them.
              </p>
            }
          />
        </TabsContent>

        {/* Department Tab */}
        {isDeptHead && (
          <TabsContent value="department">
            <PriorityListSection
              priorities={filteredDept}
              isLoading={deptQuery.isLoading}
              isError={deptQuery.isError}
              error={deptQuery.error as Error}
              refetch={deptQuery.refetch}
              showEscalate
              onEscalate={(id) => escalateMutation.mutate(id)}
              showDeptActions
              onAssign={(id) => setAssignDialogPriorityId(id)}
              showReopen={showClosed}
              onReopen={(id) => reopenMutation.mutate(id)}
              emptyMessage={`No priorities for ${DEPARTMENT_OPTIONS.find(d => d.value === userDepartment)?.label || "your department"}`}
              emptyAction={
                <Button size="sm" className="mt-3" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Create Department Priority
                </Button>
              }
            />
          </TabsContent>
        )}

        {/* Company Tab */}
        {isAdmin && (
          <TabsContent value="company">
            <PriorityListSection
              priorities={filteredCompany}
              isLoading={companyQuery.isLoading}
              isError={companyQuery.isError}
              error={companyQuery.error as Error}
              refetch={companyQuery.refetch}
              showReopen={showClosed}
              onReopen={(id) => reopenMutation.mutate(id)}
              emptyMessage="No company priorities yet"
              emptyAction={
                <Button size="sm" className="mt-3" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Create Priority
                </Button>
              }
            />
          </TabsContent>
        )}
      </Tabs>

      <CreatePriorityDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        defaultScope={activeTab === "mine" ? "role" : activeTab === "department" ? "department" : "company"}
        defaultDepartment={userDepartment}
      />

      <AssignPriorityDialog
        open={assignDialogPriorityId !== null}
        onOpenChange={(open) => { if (!open) setAssignDialogPriorityId(null); }}
        priorityId={assignDialogPriorityId}
      />
    </PageShell>
  );
}

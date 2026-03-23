import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Flag, Plus, AlertTriangle, AlertCircle, Clock, Settings, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

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
  effectiveHealth: string;
  effectiveProgress: number;
  projectCount: number;
  atRiskProjectCount: number;
  totalRevenue: number;
  totalCos: number;
  totalGp: number;
  blockerCount: number;
  openTaskCount: number;
  hasProjects: boolean;
  createdAt: string;
  updatedAt: string;
}

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

function daysRemaining(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const now = new Date();
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function PriorityCard({ priority }: { priority: Priority }) {
  const days = daysRemaining(priority.dueDate);
  const healthColor = HEALTH_COLORS[priority.effectiveHealth] || HEALTH_COLORS.healthy;
  const dotColor = HEALTH_DOT_COLORS[priority.effectiveHealth] || HEALTH_DOT_COLORS.healthy;
  const sev = SEVERITY_BADGE[priority.severity] || SEVERITY_BADGE.normal;

  return (
    <Card className={`border-l-4 ${healthColor} hover:shadow-md transition-shadow`}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-2.5 h-2.5 rounded-full ${dotColor} shrink-0`} />
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
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
          {priority.owner && <span>{priority.owner.name}</span>}
          {!priority.owner && priority.assignedTo && <span>{priority.assignedTo}</span>}
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
        <div className="text-xs text-muted-foreground">
          {priority.department && (
            <span className="mr-2">{priority.department}</span>
          )}
          {priority.hasProjects ? (
            <span>
              {priority.projectCount} project{priority.projectCount !== 1 ? "s" : ""}
              {priority.atRiskProjectCount > 0 ? (
                <span className="text-red-600 ml-1">· {priority.atRiskProjectCount} at risk</span>
              ) : (
                <span className="text-emerald-600 ml-1">· All healthy</span>
              )}
            </span>
          ) : (
            <span className="italic">Standalone priority</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const emptyForm = {
  title: "",
  description: "",
  department: "",
  severity: "normal",
  due_date: "",
  target_outcome: "",
  manual_health: "",
  manual_progress: "",
};

function CreatePriorityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/priorities", {
        title: form.title,
        description: form.description || null,
        department: form.department || null,
        severity: form.severity,
        due_date: form.due_date || null,
        target_outcome: form.target_outcome || null,
        manual_health: form.manual_health || null,
        manual_progress: form.manual_progress ? parseInt(form.manual_progress) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      setForm(emptyForm);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="department" className="text-xs">Department</Label>
              <Input id="department" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="e.g. Engineering" />
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
          </div>
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

export default function PrioritiesPage() {
  const { user } = useAuth();
  const [levelFilter, setLevelFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: priorities = [], isLoading, isError, error, refetch } = useQuery<Priority[]>({
    queryKey: ["/api/priorities"],
  });

  const categories = useMemo(() => {
    const cats = new Set(priorities.map(p => p.department).filter(Boolean));
    return Array.from(cats) as string[];
  }, [priorities]);

  const filtered = useMemo(() => {
    return priorities.filter(p => {
      if (levelFilter !== "all" && p.severity !== levelFilter) return false;
      if (healthFilter !== "all" && p.effectiveHealth !== healthFilter) return false;
      if (categoryFilter !== "all" && p.department !== categoryFilter) return false;
      return true;
    });
  }, [priorities, levelFilter, healthFilter, categoryFilter]);

  const isAdmin = user?.role && ["admin", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"].includes(user.role);

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Flag className="w-5 h-5" />
            Company Priorities
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Strategic focus areas — {filtered.length} active priorit{filtered.length === 1 ? "y" : "ies"}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Link href="/company-priorities">
              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4 mr-1" />
                Manage
              </Button>
            </Link>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Add Priority
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Priority level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="important">High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
          </SelectContent>
        </Select>

        <Select value={healthFilter} onValueChange={setHealthFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Health" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All health</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="at_risk">At risk</SelectItem>
            <SelectItem value="healthy">Healthy</SelectItem>
          </SelectContent>
        </Select>

        {categories.length > 0 && (
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(levelFilter !== "all" || healthFilter !== "all" || categoryFilter !== "all") && (
          <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => { setLevelFilter("all"); setHealthFilter("all"); setCategoryFilter("all"); }}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Priority cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <div className="text-center py-12">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-500" />
          <p className="text-sm font-medium text-red-600 mb-1">Failed to load priorities</p>
          <p className="text-xs text-muted-foreground mb-3">{error?.message || "Unknown error"}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3 mr-1" /> Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Flag className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No priorities match your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(p => (
            <PriorityCard key={p.id} priority={p} />
          ))}
        </div>
      )}

      {isAdmin && <CreatePriorityDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />}
    </PageShell>
  );
}

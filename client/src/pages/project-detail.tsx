import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, DollarSign, CreditCard, TrendingUp, BarChart3, Activity,
  ArrowLeft, User, CheckCircle, AlertCircle, Columns, CalendarDays,
  ListTodo, ShieldCheck, Clock, History, ArrowRight, Loader2,
  Wrench, PlusCircle, Circle, Calendar, PauseCircle, AlertTriangle,
  ChevronDown, ChevronUp, Eye, Play, Zap, Target, Users,
} from "lucide-react";
import { ProjectPlanTab } from "@/components/tabs/ProjectPlanTab";
import { RevenueTrackingTab } from "@/components/tabs/RevenueTrackingTab";
import { ExpenditureEditableTab } from "@/components/tabs/ExpenditureEditableTab";
import { MonthlyRealisationTab } from "@/components/tabs/MonthlyRealisationTab";
import { CashflowTab } from "@/components/tabs/CashflowTab";
import { ProjectSubcontractorsTab } from "@/components/tabs/ProjectSubcontractorsTab";
import TaskDetailDrawer from "@/components/TaskDetailDrawer";
import BoardView from "@/components/BoardView";
import CalendarView from "@/components/CalendarView";
import TaskGridView from "@/components/TaskGridView";
import KeyDatesPanel from "@/components/KeyDatesPanel";
import { QualityTab } from "@/components/tabs/QualityTab";
import { ProjectHistoryTab } from "@/components/tabs/ProjectHistoryTab";
import { WeeklyReviewWizard } from "@/components/WeeklyReviewWizard";
import { GuidancePrompt, getPhaseGuidance } from "@/components/MicroGuidance";
import { useProgramData } from "@/hooks/use-program-data";
import { useAuth } from "@/hooks/use-auth";
import { PROJECT_PHASES, PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  P0_FIRST_ASSESSMENT: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300" },
  P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-100", text: "text-violet-700", border: "border-violet-300" },
  P2_PD_PM_HANDOVER: { bg: "bg-indigo-100", text: "text-indigo-700", border: "border-indigo-300" },
  P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-300" },
  P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-300" },
  P5_COMMISSIONING_TESTING: { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-300" },
  P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-100", text: "text-teal-700", border: "border-teal-300" },
  P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
};

function getPhaseLabel(phase: string | null): string {
  if (!phase) return "Unknown";
  return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
}


function PhaseBadge({ phase }: { phase: string | null }) {
  const colors = phase ? PHASE_COLORS[phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT : PHASE_COLORS.P0_FIRST_ASSESSMENT;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${colors.bg} ${colors.text} ${colors.border}`}
      data-testid="badge-project-phase"
      title={getPhaseLabel(phase)}
    >
      {getPhaseLabel(phase)}
    </span>
  );
}

function engFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers, credentials: "include" });
}

function PhaseChangeModal({ projectId, currentPhase, open, onClose }: {
  projectId: number; currentPhase: string | null; open: boolean; onClose: () => void;
}) {
  const [toPhase, setToPhase] = useState<string>("");
  const [reason, setReason] = useState("");
  const [overrideSequence, setOverrideSequence] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/projects/${projectId}/phase`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({ toPhase, reason, overrideSequence }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "Failed to update phase");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Phase updated successfully" });
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      qc.invalidateQueries({ queryKey: ["phase-history", projectId] });
      setToPhase("");
      setReason("");
      setOverrideSequence(false);
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const currentIdx = PROJECT_PHASES.indexOf(currentPhase as any);
  const toIdx = PROJECT_PHASES.indexOf(toPhase as any);
  const needsOverride = currentIdx >= 0 && toIdx >= 0 && Math.abs(toIdx - currentIdx) > 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-phase-change">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Change Project Phase
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Current Phase</Label>
            <p className="text-sm font-medium mt-1">{getPhaseLabel(currentPhase)}</p>
          </div>
          <div>
            <Label htmlFor="toPhase">New Phase</Label>
            <Select value={toPhase} onValueChange={setToPhase}>
              <SelectTrigger data-testid="select-to-phase">
                <SelectValue placeholder="Select phase..." />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_PHASES.map(p => (
                  <SelectItem key={p} value={p} disabled={p === currentPhase}>
                    {PROJECT_PHASE_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="reason">Reason (required)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain why this phase change is happening..."
              className="mt-1"
              data-testid="input-phase-reason"
            />
          </div>
          {needsOverride && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <Switch
                checked={overrideSequence}
                onCheckedChange={setOverrideSequence}
                data-testid="switch-override-sequence"
              />
              <div className="text-sm">
                <p className="font-medium text-amber-800">Override sequential order</p>
                <p className="text-xs text-amber-600 mt-0.5">Phases normally move one step at a time. Enable this to skip phases.</p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-phase">Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!toPhase || !reason.trim() || (needsOverride && !overrideSequence) || mutation.isPending}
            data-testid="button-save-phase"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Update Phase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PhaseHistoryTimeline({ projectId }: { projectId: number }) {
  const { data } = useQuery({
    queryKey: ["phase-history", projectId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectId}/phase-history`);
      if (!res.ok) return { history: [] };
      return res.json();
    },
    enabled: !!projectId,
  });

  const history = data?.history || [];
  if (history.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="phase-history-timeline">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <History className="h-3.5 w-3.5" />
        Phase History
      </h4>
      <div className="space-y-1">
        {history.slice(0, 10).map((entry: any) => (
          <div key={entry.id} className="flex items-start gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/30">
            <div className="mt-0.5 h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">{getPhaseLabel(entry.fromPhase)}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{getPhaseLabel(entry.toPhase)}</span>
              </div>
              <p className="text-muted-foreground mt-0.5">{entry.reason}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {entry.changedByName} &middot; {new Date(entry.changedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  "TO DO": "text-gray-400", "IN PROGRESS": "text-blue-500", "HOLD": "text-red-500",
  "NEEDS APPROVAL": "text-amber-500", "COMPLETE": "text-green-500",
  "QC APPROVED": "text-emerald-500", "PROVIDE FEEDBACK": "text-purple-500",
  "OPERATIONAL APPROVAL": "text-indigo-500", "PROJECTS ASSISTANCE": "text-cyan-500",
};
const STATUS_BADGE: Record<string, string> = {
  "TO DO": "bg-gray-100 text-gray-700", "IN PROGRESS": "bg-blue-100 text-blue-700",
  "HOLD": "bg-red-100 text-red-700", "NEEDS APPROVAL": "bg-amber-100 text-amber-700",
  "COMPLETE": "bg-green-100 text-green-700", "QC APPROVED": "bg-emerald-100 text-emerald-700",
  "PROVIDE FEEDBACK": "bg-purple-100 text-purple-700",
};

function EngTasksTab({ projectInfoId, isAdmin }: { projectInfoId: number | null; isAdmin: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: engData, isLoading } = useQuery<{ projectName: string; phase: string; tasks: any[] }>({
    queryKey: ["project-eng-tasks", projectInfoId],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectInfoId}/eng-tasks`);
      if (!res.ok) return { projectName: "", phase: "", tasks: [] };
      return res.json();
    },
    enabled: !!projectInfoId,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/projects/${projectInfoId}/generate-eng-tasks`, {
        method: "POST",
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to generate tasks");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `${data.tasksCreated} engineering tasks created` });
      qc.invalidateQueries({ queryKey: ["project-eng-tasks", projectInfoId] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!projectInfoId) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Project info not available</div>;
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const tasks = engData?.tasks || [];
  const openTasks = tasks.filter((t: any) => t.status !== "COMPLETE");
  const completedTasks = tasks.filter((t: any) => t.status === "COMPLETE");
  const overdue = tasks.filter((t: any) => t.dueDate && t.dueDate < new Date().toISOString().split("T")[0] && t.status !== "COMPLETE");

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 space-y-4">
        <Wrench className="h-12 w-12 mx-auto text-muted-foreground/30" />
        <div>
          <p className="text-lg font-medium text-muted-foreground">No engineering tasks yet</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Engineering tasks are auto-created when a project moves past Phase 1 (Cost Proposal).
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="gap-2"
            data-testid="button-generate-eng-tasks"
          >
            {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            Generate Engineering Tasks
          </Button>
        )}
      </div>
    );
  }

  const phaseGroups = new Map<string, any[]>();
  for (const t of tasks) {
    const ph = t.phase || "Unassigned";
    if (!phaseGroups.has(ph)) phaseGroups.set(ph, []);
    phaseGroups.get(ph)!.push(t);
  }

  return (
    <div className="space-y-4" data-testid="eng-tasks-tab">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
          <p className="text-xl font-bold mt-1">{tasks.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Open</p>
          <p className="text-xl font-bold mt-1 text-blue-600">{openTasks.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Completed</p>
          <p className="text-xl font-bold mt-1 text-emerald-600">{completedTasks.length}</p>
        </Card>
        <Card className={`p-3 ${overdue.length > 0 ? "border-red-200" : ""}`}>
          <p className={`text-[10px] uppercase tracking-wider ${overdue.length > 0 ? "text-red-600" : "text-muted-foreground"}`}>Overdue</p>
          <p className={`text-xl font-bold mt-1 ${overdue.length > 0 ? "text-red-600" : ""}`}>{overdue.length}</p>
        </Card>
      </div>

      {tasks.length > 0 && (
        <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0}%` }}
          />
        </div>
      )}

      {Array.from(phaseGroups.entries()).map(([phase, phaseTasks]) => (
        <div key={phase} className="space-y-1">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 py-2">
            <span className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase]?.bg.replace("bg-", "bg-") || "bg-slate-200"}`} />
            {getPhaseLabel(phase)}
            <span className="font-normal">({phaseTasks.length})</span>
          </h4>
          <Card>
            <div className="divide-y">
              {phaseTasks.map((task: any) => {
                const isTaskOverdue = task.dueDate && task.dueDate < new Date().toISOString().split("T")[0] && task.status !== "COMPLETE";
                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted/20 transition-colors text-sm cursor-pointer ${isTaskOverdue ? "bg-red-50/30" : ""}`}
                    onClick={() => setLocation(`/engineering?task=${task.id}`)}
                    data-testid={`eng-task-row-${task.id}`}
                  >
                    <Circle className={`h-2.5 w-2.5 fill-current shrink-0 ${STATUS_DOT[task.status] || "text-gray-400"}`} />
                    <span className="flex-1 min-w-0 truncate">{task.title}</span>
                    {task.primaryWorkstream && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">{task.primaryWorkstream}</Badge>
                    )}
                    <Badge className={`text-[9px] px-1.5 py-0 shrink-0 ${STATUS_BADGE[task.status] || "bg-gray-100"}`}>
                      {task.status}
                    </Badge>
                    {task.dueDate && (
                      <span className={`text-[10px] flex items-center gap-0.5 shrink-0 ${isTaskOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                        <Calendar className="h-3 w-3" />
                        {new Date(task.dueDate).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                      </span>
                    )}
                    {task.assignees && task.assignees[0] && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0 max-w-[80px] truncate">
                        <User className="h-3 w-3" />
                        {task.assignees[0]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

const OLD_TAB_TO_SUPER: Record<string, { superTab: string; subTab: string }> = {
  "task-grid": { superTab: "overview", subTab: "task-grid" },
  "board": { superTab: "overview", subTab: "board" },
  "calendar": { superTab: "overview", subTab: "calendar" },
  "eng-tasks": { superTab: "engineering", subTab: "eng-tasks" },
  "project-plan": { superTab: "plan", subTab: "gantt" },
  "revenue-tracking": { superTab: "money", subTab: "revenue-tracking" },
  "expenditure": { superTab: "money", subTab: "expenditure" },
  "monthly-realisation": { superTab: "money", subTab: "monthly-realisation" },
  "cashflow": { superTab: "money", subTab: "cashflow" },
  "subcontractors": { superTab: "money", subTab: "subcontractors" },
  "quality": { superTab: "quality", subTab: "quality" },
  "history": { superTab: "history", subTab: "history" },
};

const SUPER_TAB_DEFAULTS: Record<string, string> = {
  overview: "task-grid",
  plan: "gantt",
  engineering: "eng-tasks",
  money: "revenue-tracking",
  quality: "quality",
  history: "history",
};

function RagDot({ color }: { color: "green" | "amber" | "red" }) {
  const cls = color === "green" ? "bg-emerald-500" : color === "amber" ? "bg-amber-500" : "bg-red-500";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />;
}

export default function ProjectDetailPage() {
  const [, params] = useRoute("/project/:projectName");
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const projectName = params?.projectName ? decodeURIComponent(params.projectName) : "";
  const { projectsSummary } = useProgramData();
  const { user } = useAuth();
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const alertsRef = useRef<HTMLDivElement>(null);

  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const urlTab = searchParams.get("tab");
  const highlightId = searchParams.get("highlightId") ? Number(searchParams.get("highlightId")) : null;
  const highlightType = searchParams.get("highlightType");

  const resolvedFromUrl = useMemo(() => {
    if (!urlTab) return null;
    const mapped = OLD_TAB_TO_SUPER[urlTab];
    if (mapped) return mapped;
    if (["overview", "plan", "engineering", "money", "quality", "history"].includes(urlTab)) {
      return { superTab: urlTab, subTab: SUPER_TAB_DEFAULTS[urlTab] };
    }
    return null;
  }, [urlTab]);

  const [activeSuperTab, setActiveSuperTab] = useState(resolvedFromUrl?.superTab || "overview");
  const [subTabs, setSubTabs] = useState<Record<string, string>>({
    overview: resolvedFromUrl?.superTab === "overview" ? resolvedFromUrl.subTab : "task-grid",
    plan: resolvedFromUrl?.superTab === "plan" ? resolvedFromUrl.subTab : "gantt",
    engineering: "eng-tasks",
    money: resolvedFromUrl?.superTab === "money" ? resolvedFromUrl.subTab : "revenue-tracking",
    quality: "quality",
    history: "history",
  });

  useEffect(() => {
    if (urlTab) {
      const mapped = OLD_TAB_TO_SUPER[urlTab];
      if (mapped) {
        setActiveSuperTab(mapped.superTab);
        setSubTabs(prev => ({ ...prev, [mapped.superTab]: mapped.subTab }));
      } else if (["overview", "plan", "engineering", "money", "quality", "history"].includes(urlTab)) {
        setActiveSuperTab(urlTab);
      }
    }
  }, [urlTab]);

  const projectInfo = projectsSummary?.find((p: any) => p.project_name === projectName);

  const handleTaskClick = (taskId: number) => {
    setSelectedTaskId(taskId);
    setDrawerOpen(true);
  };

  const { data: projectPlanData = [] } = useQuery({
    queryKey: ["project-plan", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/project-plan/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: revenueData = [] } = useQuery({
    queryKey: ["program-inflows", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/program-inflows?projectName=${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: expenseData = [] } = useQuery({
    queryKey: ["program-expenses", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/program-expenses/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: cashflowData = [] } = useQuery({
    queryKey: ["cashflow", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/cashflow?project=${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: engDataForAlerts } = useQuery<{ tasks: any[] }>({
    queryKey: ["project-eng-tasks", projectInfo?.project_info_id],
    queryFn: async () => {
      const res = await engFetch(`/api/projects/${projectInfo?.project_info_id}/eng-tasks`);
      if (!res.ok) return { tasks: [] };
      return res.json();
    },
    enabled: !!projectInfo?.project_info_id,
  });

  const { data: qualityData } = useQuery({
    queryKey: ["quality-checklist", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/quality-checklist/${encodeURIComponent(projectName)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectName,
  });

  if (!projectName) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground">Project Not Found</h2>
        <p className="text-muted-foreground">No project specified.</p>
      </div>
    );
  }

  const displayName = projectName.replace("_Tracker", "");
  const phase = projectInfo?.phase || null;
  const executionPhase = projectInfo?.execution_phase || null;
  const pd = projectInfo?.pd || "—";
  const pm = projectInfo?.pm || "—";
  const sizeKwp = projectInfo?.size_kwp ? `${projectInfo.size_kwp.toFixed(0)} kWp` : "—";
  const completion = projectInfo?.project_pct_complete != null
    ? `${(projectInfo.project_pct_complete * 100).toFixed(0)}%`
    : "—";
  const isAdmin = ['admin', 'COO_ADMIN', 'CEO_ADMIN'].includes(user?.role || '');
  const projectInfoId = projectInfo?.project_info_id;
  const contractValue = projectInfo?.contract_value || 0;
  const budgetTotal = projectInfo?.budget_total || 0;

  const dataHealth = [
    { name: "Project Plan", rows: (projectPlanData as any[]).length, present: (projectPlanData as any[]).length > 0 },
    { name: "Revenue Tracking", rows: (revenueData as any[]).length, present: (revenueData as any[]).length > 0 },
    { name: "Expenditure Breakdown", rows: (expenseData as any[]).length, present: (expenseData as any[]).length > 0 },
    { name: "Finance Summary", rows: 0, present: false },
    { name: "Cashflow", rows: (cashflowData as any[]).length, present: (cashflowData as any[]).length > 0 },
  ];

  const sheetsPresent = dataHealth.filter(s => s.present).length;
  const totalRows = dataHealth.reduce((sum, s) => sum + s.rows, 0);

  const planTasks = projectPlanData as any[];
  const today = new Date().toISOString().split("T")[0];
  const overduePlanTasks = planTasks.filter((t: any) => t.endDate && t.endDate < today && t.status !== "Complete" && t.status !== "Done");
  const scheduleRag: "green" | "amber" | "red" = overduePlanTasks.length === 0 ? "green" : overduePlanTasks.length <= 3 ? "amber" : "red";

  const totalExpenses = (expenseData as any[]).reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
  const costRatio = budgetTotal > 0 ? totalExpenses / budgetTotal : 0;
  const costRag: "green" | "amber" | "red" = costRatio < 0.9 ? "green" : costRatio <= 1 ? "amber" : "red";

  const qualityChecklist = qualityData as any;
  const qualityRag: "green" | "amber" | "red" = qualityChecklist && qualityChecklist.gates
    ? (qualityChecklist.gates.every?.((g: any) => g.passed) ? "green" : qualityChecklist.gates.some?.((g: any) => g.failed) ? "red" : "amber")
    : qualityChecklist && (Array.isArray(qualityChecklist) ? qualityChecklist.length > 0 : true) ? "amber" : "red";

  const nextMilestone = useMemo(() => {
    const now = new Date();
    const future = planTasks
      .filter((t: any) => t.endDate && new Date(t.endDate) >= now)
      .sort((a: any, b: any) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
    return future[0] || null;
  }, [planTasks]);

  const totalPaidInflows = (revenueData as any[]).reduce((s: number, r: any) => {
    if (r.paymentReceivedDate) return s + (Number(r.milestoneAmount) || 0);
    return s;
  }, 0);
  const revenueRealisedPct = contractValue > 0 ? (totalPaidInflows / contractValue) * 100 : 0;
  const cosRealisedPct = budgetTotal > 0 ? (totalExpenses / budgetTotal) * 100 : 0;
  const marginDelta = revenueRealisedPct - cosRealisedPct;

  const hasRedRag = scheduleRag === "red" || costRag === "red" || qualityRag === "red";

  const alerts = useMemo(() => {
    const result: { severity: "warning" | "info"; message: string; key: string }[] = [];
    const now = new Date();
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    (revenueData as any[]).forEach((r: any) => {
      const planned = r.plannedPaymentDate ? new Date(r.plannedPaymentDate) : null;
      if (planned && planned >= now && planned <= in14Days && !r.invoiceRaisedDate) {
        result.push({ severity: "warning", message: `Revenue milestone "${r.milestoneName || "Unnamed"}" due within 14 days — no invoice raised`, key: `rev-${r.id || r.milestoneName}` });
      }
    });
    const totalRev = (revenueData as any[]).reduce((s: number, r: any) => s + (Number(r.milestoneAmount) || 0), 0);
    if (totalExpenses > totalRev && totalRev > 0) {
      result.push({ severity: "warning", message: `COS (R${totalExpenses.toLocaleString()}) exceeds linked revenue (R${totalRev.toLocaleString()})`, key: "cos-exceeds-rev" });
    }
    const engTasks = engDataForAlerts?.tasks || [];
    const overdueEng = engTasks.filter((t: any) => t.dueDate && t.dueDate < today && t.status !== "COMPLETE");
    if (overdueEng.length > 0) {
      result.push({ severity: "warning", message: `${overdueEng.length} overdue engineering task${overdueEng.length > 1 ? "s" : ""}`, key: "eng-overdue" });
    }
    if (planTasks.length === 0) {
      result.push({ severity: "info", message: "No project plan data uploaded yet", key: "no-plan" });
    }
    return result;
  }, [revenueData, expenseData, engDataForAlerts, planTasks, totalExpenses, today]);

  const primaryCta = useMemo(() => {
    if (phase?.includes("FIRST_ASSESSMENT") || phase?.includes("COST_PROPOSAL")) {
      return { label: "Advance Gate", icon: <Zap className="h-4 w-4" />, action: () => setPhaseModalOpen(true) };
    }
    if (executionPhase && phase?.includes("CONSTRUCTION")) {
      return { label: "Start Weekly Review", icon: <Play className="h-4 w-4" />, action: () => { setActiveSuperTab("overview"); setSubTabs(prev => ({ ...prev, overview: "task-grid" })); } };
    }
    if (hasRedRag) {
      return { label: "Resolve Issue", icon: <AlertTriangle className="h-4 w-4" />, action: () => { setAlertsExpanded(true); alertsRef.current?.scrollIntoView({ behavior: "smooth" }); } };
    }
    return { label: "View Tasks", icon: <Eye className="h-4 w-4" />, action: () => { setActiveSuperTab("overview"); setSubTabs(prev => ({ ...prev, overview: "task-grid" })); } };
  }, [phase, executionPhase, hasRedRag]);

  const setSubTab = (superTab: string, subTab: string) => {
    setSubTabs(prev => ({ ...prev, [superTab]: subTab }));
  };

  const currentSubTab = subTabs[activeSuperTab] || SUPER_TAB_DEFAULTS[activeSuperTab];

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => setLocation("/projects")} className="gap-2" data-testid="button-back">
        <ArrowLeft className="h-4 w-4" />
        Back to Projects
      </Button>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <h2 className="text-xl sm:text-3xl font-heading font-bold text-foreground" data-testid="text-project-name">{displayName}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> PD: {pd}</span>
            <span className="flex items-center gap-1"><User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> PM: {pm}</span>
            <span className="flex items-center gap-1"><Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {sizeKwp}</span>
            <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {completion} complete</span>
          </div>
          {projectInfoId && <PhaseHistoryTimeline projectId={projectInfoId} />}
        </div>

        <Card className="lg:w-auto">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{sheetsPresent}/6</p>
                <p className="text-xs text-muted-foreground">Sheets</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="text-center">
                <p className="text-2xl font-bold">{totalRows}</p>
                <p className="text-xs text-muted-foreground">Rows</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex flex-wrap gap-1">
                {dataHealth.map(sheet => (
                  <Badge
                    key={sheet.name}
                    variant={sheet.present ? "default" : "outline"}
                    className={`text-xs ${!sheet.present && "opacity-50"}`}
                  >
                    {sheet.present ? <CheckCircle className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
                    {sheet.name.split(" ")[0]}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="sticky top-0 z-10 shadow-sm" data-testid="awareness-bar">
        <CardContent className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 items-center">
            <div className="flex flex-col gap-1" data-testid="awareness-phase">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Phase</span>
              <PhaseBadge phase={phase} />
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-execution-phase">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Execution</span>
              <span className="text-xs font-medium truncate">{executionPhase || "—"}</span>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-rag">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">RAG</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1" title={`Schedule: ${scheduleRag}`}>
                  <RagDot color={scheduleRag} />
                  <span className="text-[10px]">S</span>
                </div>
                <div className="flex items-center gap-1" title={`Cost: ${costRag}`}>
                  <RagDot color={costRag} />
                  <span className="text-[10px]">C</span>
                </div>
                <div className="flex items-center gap-1" title={`Quality: ${qualityRag}`}>
                  <RagDot color={qualityRag} />
                  <span className="text-[10px]">Q</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-milestone">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Next Milestone</span>
              <span className="text-xs font-medium truncate">
                {nextMilestone ? `${nextMilestone.taskName || nextMilestone.task_name || "Task"} (${new Date(nextMilestone.endDate || nextMilestone.end_date).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })})` : "—"}
              </span>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-revenue">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Rev Realised</span>
              <span className="text-sm font-bold">{revenueRealisedPct.toFixed(1)}%</span>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-cos">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">COS Realised</span>
              <span className="text-sm font-bold">{cosRealisedPct.toFixed(1)}%</span>
            </div>

            <div className="flex flex-col gap-1" data-testid="awareness-margin">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Margin Δ</span>
              <span className={`text-sm font-bold ${marginDelta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {marginDelta >= 0 ? "+" : ""}{marginDelta.toFixed(1)}%
              </span>
            </div>

            <div className="flex items-end justify-end">
              <Button size="sm" onClick={primaryCta.action} className="gap-1.5" data-testid="button-primary-cta">
                {primaryCta.icon}
                {primaryCta.label}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {(() => {
        const phaseGuide = getPhaseGuidance(phase);
        return phaseGuide ? (
          <GuidancePrompt
            type={phaseGuide.type}
            title={phaseGuide.title}
            message={phaseGuide.message}
            learnMoreText={phaseGuide.learnMoreText}
          />
        ) : null;
      })()}

      {alerts.length > 0 && (
        <div ref={alertsRef} data-testid="alert-panel">
          <button
            onClick={() => setAlertsExpanded(!alertsExpanded)}
            className="flex items-center gap-2 w-full text-left mb-2"
            data-testid="button-toggle-alerts"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-semibold">Business Alerts</span>
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0" data-testid="badge-alert-count">
              {alerts.length}
            </Badge>
            {alertsExpanded ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
          </button>
          {alertsExpanded && (
            <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar" data-testid="alert-cards">
              {alerts.map(alert => (
                <Card key={alert.key} className="flex-shrink-0 w-72 border-l-4 border-l-amber-400" data-testid={`alert-card-${alert.key}`}>
                  <CardContent className="p-3 flex items-start gap-2">
                    {alert.severity === "warning" ? (
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    )}
                    <span className="text-xs leading-tight">{alert.message}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <Tabs value={activeSuperTab} onValueChange={setActiveSuperTab} className="w-full">
        <TabsList className="flex gap-1 h-auto p-1 w-full" data-testid="super-tabs">
          <TabsTrigger value="overview" className="flex items-center gap-1.5 text-xs" data-testid="tab-overview">
            <ListTodo className="h-3.5 w-3.5" />
            <span>Overview</span>
          </TabsTrigger>
          <TabsTrigger value="plan" className="flex items-center gap-1.5 text-xs" data-testid="tab-plan">
            <FileText className="h-3.5 w-3.5" />
            <span>Plan</span>
          </TabsTrigger>
          <TabsTrigger value="engineering" className="flex items-center gap-1.5 text-xs" data-testid="tab-engineering">
            <Wrench className="h-3.5 w-3.5" />
            <span>Engineering</span>
          </TabsTrigger>
          <TabsTrigger value="money" className="flex items-center gap-1.5 text-xs" data-testid="tab-money">
            <DollarSign className="h-3.5 w-3.5" />
            <span>Project Finance</span>
          </TabsTrigger>
          <TabsTrigger value="quality" className="flex items-center gap-1.5 text-xs" data-testid="tab-quality">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Quality</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5 text-xs" data-testid="tab-history">
            <History className="h-3.5 w-3.5" />
            <span>History</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="flex gap-1 flex-wrap" data-testid="sub-tabs-overview">
            <Button size="sm" variant={currentSubTab === "task-grid" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("overview", "task-grid")} data-testid="subtab-task-grid">
              <ListTodo className="h-3 w-3 mr-1" /> Tasks
            </Button>
            <Button size="sm" variant={currentSubTab === "board" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("overview", "board")} data-testid="subtab-board">
              <Columns className="h-3 w-3 mr-1" /> Board
            </Button>
            <Button size="sm" variant={currentSubTab === "calendar" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("overview", "calendar")} data-testid="subtab-calendar">
              <CalendarDays className="h-3 w-3 mr-1" /> Calendar
            </Button>
          </div>
          {currentSubTab === "task-grid" && <TaskGridView projectName={projectName} onTaskClick={handleTaskClick} />}
          {currentSubTab === "board" && <BoardView projectName={projectName} onTaskClick={handleTaskClick} />}
          {currentSubTab === "calendar" && <CalendarView projectName={projectName} onTaskClick={handleTaskClick} />}
        </TabsContent>

        <TabsContent value="engineering" className="space-y-4">
          <EngTasksTab projectInfoId={projectInfoId ?? null} isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="plan" className="space-y-4">
          <div className="flex gap-1 flex-wrap" data-testid="sub-tabs-plan">
            <Button size="sm" variant={currentSubTab === "gantt" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("plan", "gantt")} data-testid="subtab-gantt">
              <FileText className="h-3 w-3 mr-1" /> Gantt
            </Button>
            <Button size="sm" variant={currentSubTab === "key-dates" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("plan", "key-dates")} data-testid="subtab-key-dates">
              <Calendar className="h-3 w-3 mr-1" /> Key Dates
            </Button>
          </div>
          {currentSubTab === "gantt" && <ProjectPlanTab projectName={projectName} />}
          {currentSubTab === "key-dates" && <KeyDatesPanel projectName={projectName} />}
        </TabsContent>

        <TabsContent value="money" className="space-y-4">
          <div className="flex gap-1 flex-wrap" data-testid="sub-tabs-money">
            <Button size="sm" variant={currentSubTab === "revenue-tracking" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("money", "revenue-tracking")} data-testid="subtab-revenue">
              <DollarSign className="h-3 w-3 mr-1" /> Revenue
            </Button>
            <Button size="sm" variant={currentSubTab === "expenditure" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("money", "expenditure")} data-testid="subtab-expenditure">
              <CreditCard className="h-3 w-3 mr-1" /> Expenditure
            </Button>
            <Button size="sm" variant={currentSubTab === "monthly-realisation" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("money", "monthly-realisation")} data-testid="subtab-monthly-realisation">
              <TrendingUp className="h-3 w-3 mr-1" /> COS Tracker
            </Button>
            <Button size="sm" variant={currentSubTab === "cashflow" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("money", "cashflow")} data-testid="subtab-cashflow">
              <Activity className="h-3 w-3 mr-1" /> Cashflow
            </Button>
            <Button size="sm" variant={currentSubTab === "subcontractors" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setSubTab("money", "subcontractors")} data-testid="subtab-subcontractors">
              <Users className="h-3 w-3 mr-1" /> Subcontractors
            </Button>
          </div>
          {currentSubTab === "revenue-tracking" && <RevenueTrackingTab projectName={projectName} highlightId={highlightType === 'revenue' ? highlightId : null} />}
          {currentSubTab === "expenditure" && <ExpenditureEditableTab projectName={projectName} highlightId={highlightType === 'expense' ? highlightId : null} />}
          {currentSubTab === "monthly-realisation" && <MonthlyRealisationTab projectName={projectName} />}
          {currentSubTab === "cashflow" && <CashflowTab projectName={projectName} />}
          {currentSubTab === "subcontractors" && <ProjectSubcontractorsTab projectName={projectName} />}
        </TabsContent>

        <TabsContent value="quality" className="space-y-4">
          <QualityTab projectName={projectName} />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <WeeklyReviewWizard
            projectName={projectName}
            snapshotMetrics={{
              phase: phase || undefined,
              completion: projectInfo?.project_pct_complete ?? undefined,
              totalRevenue: totalPaidInflows,
              totalExpenses,
              margin: totalPaidInflows > 0 ? (totalPaidInflows - totalExpenses) / totalPaidInflows : 0,
              overdueCount: (engDataForAlerts as any[])?.filter?.((t: any) => t.dueDate && t.dueDate < new Date().toISOString().split("T")[0] && t.status !== "COMPLETE")?.length || 0,
            }}
          />
          <ProjectHistoryTab projectName={projectName} />
        </TabsContent>
      </Tabs>

      <TaskDetailDrawer
        taskId={selectedTaskId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTaskId(null); }}
        projectName={projectName}
      />

      {projectInfoId && (
        <PhaseChangeModal
          projectId={projectInfoId}
          currentPhase={phase}
          open={phaseModalOpen}
          onClose={() => setPhaseModalOpen(false)}
        />
      )}
    </div>
  );
}

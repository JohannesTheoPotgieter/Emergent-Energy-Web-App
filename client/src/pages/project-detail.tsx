import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import { ProjectPlanTab } from "@/components/tabs/ProjectPlanTab";
import { RevenueTrackingTab } from "@/components/tabs/RevenueTrackingTab";
import { ExpenditureEditableTab } from "@/components/tabs/ExpenditureEditableTab";
import { FinanceRevenueTab } from "@/components/tabs/FinanceRevenueTab";
import { FinanceCosTab } from "@/components/tabs/FinanceCosTab";
import { CashflowTab } from "@/components/tabs/CashflowTab";
import TaskDetailDrawer from "@/components/TaskDetailDrawer";
import BoardView from "@/components/BoardView";
import CalendarView from "@/components/CalendarView";
import TaskGridView from "@/components/TaskGridView";
import KeyDatesPanel from "@/components/KeyDatesPanel";
import { QualityTab } from "@/components/tabs/QualityTab";
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

function getPhaseShortLabel(phase: string | null): string {
  if (!phase) return "—";
  const label = PROJECT_PHASE_LABELS[phase as ProjectPhase];
  if (!label) return phase;
  const match = label.match(/^Phase \d/);
  return match ? match[0] : label;
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
                <span className="text-muted-foreground">{getPhaseShortLabel(entry.fromPhase)}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{getPhaseShortLabel(entry.toPhase)}</span>
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

  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const urlTab = searchParams.get("tab");
  const highlightId = searchParams.get("highlightId") ? Number(searchParams.get("highlightId")) : null;
  const highlightType = searchParams.get("highlightType");

  const [activeTab, setActiveTab] = useState(urlTab || "task-grid");

  useEffect(() => {
    if (urlTab) setActiveTab(urlTab);
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

  const { data: financeRevData = [] } = useQuery({
    queryKey: ["finance-revenue", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/finance/revenue?projectName=${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: financeCosData = [] } = useQuery({
    queryKey: ["finance-cos", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/finance/cos?projectName=${encodeURIComponent(projectName)}`);
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
  const pd = projectInfo?.pd || "—";
  const pm = projectInfo?.pm || "—";
  const sizeKwp = projectInfo?.size_kwp ? `${projectInfo.size_kwp.toFixed(0)} kWp` : "—";
  const completion = projectInfo?.project_pct_complete !== null
    ? `${(projectInfo!.project_pct_complete * 100).toFixed(0)}%`
    : "—";
  const isAdmin = user?.role === "admin";
  const projectInfoId = projectInfo?.project_info_id;

  const dataHealth = [
    { name: "Project Plan", rows: (projectPlanData as any[]).length, present: (projectPlanData as any[]).length > 0 },
    { name: "Revenue Tracking", rows: (revenueData as any[]).length, present: (revenueData as any[]).length > 0 },
    { name: "Expenditure Breakdown", rows: (expenseData as any[]).length, present: (expenseData as any[]).length > 0 },
    { name: "Finance - Revenue", rows: (financeRevData as any[]).length, present: (financeRevData as any[]).length > 0 },
    { name: "Finance - COS", rows: (financeCosData as any[]).length, present: (financeCosData as any[]).length > 0 },
    { name: "Cashflow", rows: (cashflowData as any[]).length, present: (cashflowData as any[]).length > 0 },
  ];

  const sheetsPresent = dataHealth.filter(s => s.present).length;
  const totalRows = dataHealth.reduce((sum, s) => sum + s.rows, 0);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => setLocation("/projects")} className="gap-2" data-testid="button-back">
        <ArrowLeft className="h-4 w-4" />
        Back to Projects
      </Button>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <h2 className="text-xl sm:text-3xl font-heading font-bold text-foreground" data-testid="text-project-name">{displayName}</h2>
            <PhaseBadge phase={phase} />
            {isAdmin && projectInfoId && (
              <Button variant="outline" size="sm" onClick={() => setPhaseModalOpen(true)} className="h-7 text-xs gap-1" data-testid="button-change-phase">
                <History className="h-3.5 w-3.5" />
                Change Phase
              </Button>
            )}
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex overflow-x-auto gap-1 h-auto p-1 w-full no-scrollbar">
          <TabsTrigger value="task-grid" className="flex items-center gap-1.5 text-xs" data-testid="tab-task-grid">
            <ListTodo className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Tasks</span>
          </TabsTrigger>
          <TabsTrigger value="board" className="flex items-center gap-1.5 text-xs" data-testid="tab-board">
            <Columns className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Board</span>
          </TabsTrigger>
          <TabsTrigger value="calendar" className="flex items-center gap-1.5 text-xs" data-testid="tab-calendar">
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Calendar</span>
          </TabsTrigger>
          <TabsTrigger value="project-plan" className="flex items-center gap-1.5 text-xs" data-testid="tab-project-plan">
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Gantt</span>
          </TabsTrigger>
          <TabsTrigger value="revenue-tracking" className="flex items-center gap-1.5 text-xs" data-testid="tab-revenue">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Revenue</span>
          </TabsTrigger>
          <TabsTrigger value="expenditure" className="flex items-center gap-1.5 text-xs" data-testid="tab-expenditure">
            <CreditCard className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Expenditure</span>
          </TabsTrigger>
          <TabsTrigger value="finance-revenue" className="flex items-center gap-1.5 text-xs" data-testid="tab-finance-rev">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Fin-Rev</span>
          </TabsTrigger>
          <TabsTrigger value="finance-cos" className="flex items-center gap-1.5 text-xs" data-testid="tab-finance-cos">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Fin-COS</span>
          </TabsTrigger>
          <TabsTrigger value="cashflow" className="flex items-center gap-1.5 text-xs" data-testid="tab-cashflow">
            <Activity className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Cashflow</span>
          </TabsTrigger>
          <TabsTrigger value="quality" className="flex items-center gap-1.5 text-xs" data-testid="tab-quality">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Quality</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="task-grid" className="space-y-4">
          <TaskGridView projectName={projectName} onTaskClick={handleTaskClick} />
          <KeyDatesPanel projectName={projectName} />
        </TabsContent>

        <TabsContent value="board" className="space-y-4">
          <BoardView projectName={projectName} onTaskClick={handleTaskClick} />
          <KeyDatesPanel projectName={projectName} />
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          <CalendarView projectName={projectName} onTaskClick={handleTaskClick} />
          <KeyDatesPanel projectName={projectName} />
        </TabsContent>

        <TabsContent value="project-plan" className="space-y-4">
          <ProjectPlanTab projectName={projectName} />
          <KeyDatesPanel projectName={projectName} />
        </TabsContent>

        <TabsContent value="revenue-tracking" className="space-y-4">
          <RevenueTrackingTab projectName={projectName} highlightId={highlightType === 'revenue' ? highlightId : null} />
        </TabsContent>

        <TabsContent value="expenditure" className="space-y-4">
          <ExpenditureEditableTab projectName={projectName} highlightId={highlightType === 'expense' ? highlightId : null} />
        </TabsContent>

        <TabsContent value="finance-revenue" className="space-y-4">
          <FinanceRevenueTab projectName={projectName} />
        </TabsContent>

        <TabsContent value="finance-cos" className="space-y-4">
          <FinanceCosTab projectName={projectName} />
        </TabsContent>

        <TabsContent value="cashflow" className="space-y-4">
          <CashflowTab projectName={projectName} />
        </TabsContent>

        <TabsContent value="quality" className="space-y-4">
          <QualityTab projectName={projectName} />
        </TabsContent>
      </Tabs>

      <TaskDetailDrawer
        taskId={selectedTaskId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTaskId(null); }}
        projectName={projectName}
      />

      {isAdmin && projectInfoId && (
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

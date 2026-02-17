import { useState, useEffect, useMemo } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, DollarSign, CreditCard, TrendingUp, BarChart3, Activity, ArrowLeft, User, Calendar, CheckCircle, AlertCircle, Columns, CalendarDays, ListTodo } from "lucide-react";
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
import { useProgramData } from "@/hooks/use-program-data";

export default function ProjectDetailPage() {
  const [, params] = useRoute("/project/:projectName");
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const projectName = params?.projectName ? decodeURIComponent(params.projectName) : "";
  const { projectsSummary } = useProgramData();
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const urlTab = searchParams.get("tab");
  const highlightId = searchParams.get("highlightId") ? Number(searchParams.get("highlightId")) : null;
  const highlightType = searchParams.get("highlightType");

  const [activeTab, setActiveTab] = useState(urlTab || "task-grid");

  useEffect(() => {
    if (urlTab) setActiveTab(urlTab);
  }, [urlTab]);

  const projectInfo = projectsSummary?.find(p => p.project_name === projectName);

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
  const phase = projectInfo?.phase || "Unknown";
  const pd = projectInfo?.pd || "—";
  const pm = projectInfo?.pm || "—";
  const sizeKwp = projectInfo?.size_kwp ? `${projectInfo.size_kwp.toFixed(0)} kWp` : "—";
  const completion = projectInfo?.project_pct_complete !== null 
    ? `${(projectInfo!.project_pct_complete * 100).toFixed(0)}%` 
    : "—";

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
            <Badge variant={phase === "Construction" ? "default" : phase === "Handover" ? "secondary" : "outline"}>
              {phase}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> PD: {pd}</span>
            <span className="flex items-center gap-1"><User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> PM: {pm}</span>
            <span className="flex items-center gap-1"><Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {sizeKwp}</span>
            <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {completion} complete</span>
          </div>
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
      </Tabs>

      <TaskDetailDrawer
        taskId={selectedTaskId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTaskId(null); }}
        projectName={projectName}
      />
    </div>
  );
}

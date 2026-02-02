import { useState, useMemo } from "react";
import { useProgramData } from "@/hooks/use-program-data";
import { useQuery } from "@tanstack/react-query";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Activity, AlertCircle, Banknote, TrendingUp, TrendingDown, Calendar, AlertTriangle, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, addDays, isWithinInterval, parseISO, startOfYear, isBefore, isAfter } from "date-fns";
import { useLocation } from "wouter";

function getFYRange(date: Date = new Date()) {
  const year = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return {
    start: new Date(year, 8, 1),
    end: new Date(year + 1, 7, 31),
    label: `FY${(year + 1).toString().slice(-2)}`,
  };
}

function getDateRangeForFilter(filterValue: string): { start: Date; end: Date } {
  const today = new Date();
  const fyRange = getFYRange(today);
  
  switch (filterValue) {
    case "ytd":
      return { start: fyRange.start, end: today };
    case "q1":
      return { start: fyRange.start, end: new Date(fyRange.start.getFullYear(), 10, 30) };
    case "q2":
      return { start: new Date(fyRange.start.getFullYear(), 11, 1), end: new Date(fyRange.start.getFullYear() + 1, 1, 28) };
    case "q3":
      return { start: new Date(fyRange.start.getFullYear() + 1, 2, 1), end: new Date(fyRange.start.getFullYear() + 1, 4, 31) };
    case "q4":
      return { start: new Date(fyRange.start.getFullYear() + 1, 5, 1), end: fyRange.end };
    case "fy":
    default:
      return { start: fyRange.start, end: fyRange.end };
  }
}

export default function Dashboard() {
  const { overview, projectsSummary, isLoading } = useProgramData();
  const [, setLocation] = useLocation();
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("fy");

  const fyRange = getFYRange();

  const projectQueryParam = selectedProject !== "all" ? selectedProject : undefined;

  const { data: cashflowData = [] } = useQuery({
    queryKey: ["/api/cashflow", projectQueryParam],
    queryFn: async () => {
      const url = projectQueryParam 
        ? `/api/cashflow?project=${encodeURIComponent(projectQueryParam)}`
        : "/api/cashflow";
      const res = await fetch(url);
      return res.json();
    },
  });

  const { data: revenueData = [] } = useQuery({
    queryKey: ["/api/program-inflows", projectQueryParam],
    queryFn: async () => {
      const url = projectQueryParam
        ? `/api/program-inflows/${encodeURIComponent(projectQueryParam)}`
        : "/api/program-inflows";
      const res = await fetch(url);
      return res.json();
    },
  });

  const { data: expenseData = [] } = useQuery({
    queryKey: ["/api/program-expenses", projectQueryParam],
    queryFn: async () => {
      const url = projectQueryParam
        ? `/api/program-expenses/${encodeURIComponent(projectQueryParam)}`
        : "/api/program-expenses";
      const res = await fetch(url);
      return res.json();
    },
  });

  const projects = projectsSummary || [];
  const activeDateRange = getDateRangeForFilter(dateRange);

  const filteredProjects = useMemo(() => {
    if (selectedProject === "all") return projects;
    return projects.filter(p => p.project_name === selectedProject);
  }, [projects, selectedProject]);

  const kpiData = useMemo(() => {
    const totalBudget = overview?.total_program_budget || 0;
    const actualSpend = overview?.actual_spend_paid || 0;
    const revenueRealised = overview?.revenue_realised || 0;
    const activeProjects = selectedProject === "all" 
      ? (overview?.active_projects || 0) 
      : 1;

    const netCashflow = revenueRealised - actualSpend;

    const projectsAtRisk = filteredProjects.filter(p => {
      const behindSchedule = p.delta_vs_expected !== null && p.delta_vs_expected < -0.1;
      const overBudget = p.actual_expenses > (p.actual_revenue * 1.2);
      const negativeCashflow = (p.actual_revenue - p.actual_expenses) < 0;
      return behindSchedule || overBudget || negativeCashflow;
    }).length;

    return {
      totalBudget,
      actualSpend,
      revenueRealised,
      activeProjects,
      netCashflow,
      projectsAtRisk,
    };
  }, [overview, filteredProjects, selectedProject]);

  const topRisks = useMemo(() => {
    const risks: Array<{ project: string; risk: string; severity: "high" | "medium" | "low" }> = [];

    filteredProjects.forEach(p => {
      if (p.delta_vs_expected !== null && p.delta_vs_expected < -0.1) {
        risks.push({
          project: p.project_name,
          risk: `Behind schedule by ${Math.abs(p.delta_vs_expected * 100).toFixed(0)}%`,
          severity: p.delta_vs_expected < -0.2 ? "high" : "medium",
        });
      }
      if (p.actual_expenses > p.actual_revenue * 1.2 && p.actual_revenue > 0) {
        risks.push({
          project: p.project_name,
          risk: "Expenditure exceeds revenue by >20%",
          severity: "high",
        });
      }
      if ((p.actual_revenue - p.actual_expenses) < 0 && p.actual_expenses > 100000) {
        risks.push({
          project: p.project_name,
          risk: "Negative cashflow position",
          severity: "medium",
        });
      }
    });

    return risks.slice(0, 5);
  }, [filteredProjects]);

  const next30DaysFlows = useMemo(() => {
    const today = new Date();
    const thirtyDaysOut = addDays(today, 30);

    let plannedInflows = 0;
    let plannedOutflows = 0;

    (revenueData as any[]).forEach((rev: any) => {
      if (rev.date) {
        try {
          const revDate = new Date(rev.date);
          if (isWithinInterval(revDate, { start: today, end: thirtyDaysOut })) {
            plannedInflows += Number(rev.amount) || 0;
          }
        } catch {}
      }
    });

    (expenseData as any[]).forEach((exp: any) => {
      if (exp.date) {
        try {
          const expDate = new Date(exp.date);
          if (isWithinInterval(expDate, { start: today, end: thirtyDaysOut })) {
            plannedOutflows += Number(exp.amount) || 0;
          }
        } catch {}
      }
    });

    return { plannedInflows, plannedOutflows };
  }, [revenueData, expenseData]);

  if (isLoading && !overview) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground">Program Dashboard</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 bg-muted/20 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const dataAsOf = overview?.data_as_of ? new Date(overview.data_as_of) : new Date();

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-heading font-bold text-foreground">Program Dashboard</h2>
          <p className="text-muted-foreground">
            Portfolio-level KPIs and risk overview • {fyRange.label}
            <span className="ml-2 text-xs">
              • Data as of {format(dataAsOf, "dd MMM yyyy, HH:mm")}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[140px]">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fy">This FY</SelectItem>
              <SelectItem value="ytd">Year to Date</SelectItem>
              <SelectItem value="q1">Q1</SelectItem>
              <SelectItem value="q2">Q2</SelectItem>
              <SelectItem value="q3">Q3</SelectItem>
              <SelectItem value="q4">Q4</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map(p => (
                <SelectItem key={p.project_name} value={p.project_name}>
                  {p.project_name.replace("_Tracker", "")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard 
          title="Total Portfolio Budget" 
          value={`R${(kpiData.totalBudget / 1000000).toFixed(1)}M`} 
          subValue="Program allocation"
          icon={DollarSign}
          data-testid="card-total-budget"
        />
        <SummaryCard 
          title="Actual Spend (Paid)" 
          value={`R${(kpiData.actualSpend / 1000000).toFixed(1)}M`} 
          subValue={kpiData.totalBudget > 0 ? `${((kpiData.actualSpend / kpiData.totalBudget) * 100).toFixed(0)}% of budget` : "No budget set"}
          icon={Activity}
          data-testid="card-actual-spend"
        />
        <SummaryCard 
          title="Revenue Realised" 
          value={`R${(kpiData.revenueRealised / 1000000).toFixed(1)}M`} 
          subValue="Cash received"
          trend={kpiData.revenueRealised > 0 ? "up" : undefined}
          icon={Banknote}
          data-testid="card-revenue-realised"
        />
        <SummaryCard 
          title="Net Cashflow (FY)" 
          value={`R${(kpiData.netCashflow / 1000000).toFixed(1)}M`} 
          subValue={kpiData.netCashflow >= 0 ? "Positive position" : "Negative position"}
          trend={kpiData.netCashflow >= 0 ? "up" : "down"}
          icon={kpiData.netCashflow >= 0 ? TrendingUp : TrendingDown}
          className={kpiData.netCashflow >= 0 ? "border-l-emerald-500" : "border-l-red-500"}
          data-testid="card-net-cashflow"
        />
        <SummaryCard 
          title="Active Projects" 
          value={kpiData.activeProjects} 
          subValue="In portfolio"
          icon={Activity}
          data-testid="card-active-projects"
        />
        <SummaryCard 
          title="Projects at Risk" 
          value={kpiData.projectsAtRisk} 
          subValue={kpiData.projectsAtRisk > 0 ? "Need attention" : "All on track"}
          icon={AlertTriangle}
          className={kpiData.projectsAtRisk > 0 ? "border-l-amber-500" : "border-l-emerald-500"}
          data-testid="card-projects-at-risk"
        />
      </div>

      {/* Two Column Layout: Risks + Cashflow Summary */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Risks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Top Risks
            </CardTitle>
            <CardDescription>Projects requiring attention based on schedule, budget, or cashflow</CardDescription>
          </CardHeader>
          <CardContent>
            {topRisks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No risks identified - all projects on track</p>
              </div>
            ) : (
              <div className="space-y-3">
                {topRisks.map((risk, i) => (
                  <div 
                    key={i} 
                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setLocation(`/project/${encodeURIComponent(risk.project)}`)}
                  >
                    <Badge 
                      variant={risk.severity === "high" ? "destructive" : "secondary"}
                      className="mt-0.5"
                    >
                      {risk.severity}
                    </Badge>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{risk.project.replace("_Tracker", "")}</p>
                      <p className="text-xs text-muted-foreground">{risk.risk}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Next 30 Days Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Next 30 Days
            </CardTitle>
            <CardDescription>Planned inflows and outflows for the upcoming month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <div className="text-center p-6 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                <ArrowUpRight className="w-8 h-8 mx-auto mb-2 text-emerald-600" />
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  R{(next30DaysFlows.plannedInflows / 1000000).toFixed(2)}M
                </p>
                <p className="text-sm text-emerald-600 dark:text-emerald-500">Expected Inflows</p>
              </div>
              <div className="text-center p-6 rounded-lg bg-red-50 dark:bg-red-900/20">
                <ArrowDownRight className="w-8 h-8 mx-auto mb-2 text-red-600" />
                <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                  R{(next30DaysFlows.plannedOutflows / 1000000).toFixed(2)}M
                </p>
                <p className="text-sm text-red-600 dark:text-red-500">Expected Outflows</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t text-center">
              <p className="text-sm text-muted-foreground">
                Net: R{((next30DaysFlows.plannedInflows - next30DaysFlows.plannedOutflows) / 1000000).toFixed(2)}M
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Projects Quick View */}
      {filteredProjects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Portfolio Projects</CardTitle>
            <CardDescription>Click any project to view details</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filteredProjects.map((project) => {
                const gpPercent = project.gp_percent !== null 
                  ? `${(project.gp_percent * 100).toFixed(1)}% GP` 
                  : "—";
                const completion = project.project_pct_complete !== null
                  ? `${(project.project_pct_complete * 100).toFixed(0)}%`
                  : "—";
                const isAtRisk = project.delta_vs_expected !== null && project.delta_vs_expected < -0.1;
                
                return (
                  <div 
                    key={project.project_name} 
                    className="flex items-center p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setLocation(`/project/${encodeURIComponent(project.project_name)}`)}
                  >
                    <div className={`w-2 h-2 rounded-full mr-3 ${isAtRisk ? "bg-amber-500" : "bg-emerald-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{project.project_name.replace("_Tracker", "")}</p>
                      <p className="text-xs text-muted-foreground">
                        {project.phase || "Unknown"} • {completion} complete • {gpPercent}
                      </p>
                    </div>
                    <div className="text-right ml-4">
                      <p className="font-mono font-medium">R{(project.actual_revenue / 1000000).toFixed(1)}M</p>
                      <p className="text-xs text-muted-foreground">Revenue</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {projects.length === 0 && (
        <Card className="border-2 border-dashed border-muted">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Project Data Available</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Upload your Excel tracker files to populate the dashboard with project data, 
              financial metrics, and risk tracking.
            </p>
            <Button onClick={() => setLocation("/upload")}>
              Go to Upload
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

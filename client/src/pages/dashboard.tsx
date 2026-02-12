import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Construction, Zap, Wrench, UserCheck, DollarSign, AlertCircle, 
  TrendingDown, TrendingUp, ArrowRight, AlertTriangle, Clock,
  ChevronDown, ChevronRight, X,
} from "lucide-react";
import { useLocation, Link } from "wouter";
import { format } from "date-fns";

function formatRand(val: number): string {
  if (val >= 1_000_000) return `R ${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `R ${(val / 1_000).toFixed(1)}K`;
  return `R ${Math.round(val)}`;
}

function formatPct(val: number | null): string {
  if (val === null || val === undefined) return "--";
  return `${(val * 100).toFixed(1)}%`;
}

interface HighPriority {
  overdueExpenses: Array<{
    projectName: string;
    lineItem: string | null;
    invoiceNumber: string | null;
    poNumber: string | null;
    amount: number;
    paymentDate: string;
    severity: string;
  }>;
  revenueOutstanding: Array<{
    projectName: string;
    milestoneName: string | null;
    invoiceNumber: string | null;
    amount: number;
    dueDate: string | null;
    severity: string;
  }>;
  projectsBehindPlan: Array<{
    projectName: string;
    phase: string | null;
    pm: string | null;
    delta: number;
    avgActual: number;
    avgExpected: number;
    severity: string;
  }>;
  upcomingMilestones: Array<{
    projectName: string;
    milestoneType: string;
    date: string;
    pm: string | null;
  }>;
}

const severityColors: Record<string, string> = {
  Critical: "bg-red-100 text-red-800 border-red-200",
  High: "bg-amber-100 text-amber-800 border-amber-200",
  Medium: "bg-blue-100 text-blue-800 border-blue-200",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge className={`${severityColors[severity] || severityColors.Medium} text-[10px] font-semibold`} variant="outline">
      {severity}
    </Badge>
  );
}

function PrioritySection({ 
  title, 
  icon: Icon, 
  iconColor,
  items,
  viewAllPath,
  renderItem,
  expanded,
  onToggle,
}: { 
  title: string;
  icon: any;
  iconColor: string;
  items: any[];
  viewAllPath: string;
  renderItem: (item: any, i: number) => React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const displayItems = expanded ? items : items.slice(0, 5);

  return (
    <div className="space-y-2">
      <button
        className="flex items-center gap-2 w-full text-left group"
        onClick={onToggle}
        data-testid={`toggle-${title.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <span className="font-semibold text-sm flex-1">{title}</span>
        <Badge variant="secondary" className="text-xs">{items.length}</Badge>
        {items.length > 5 && (
          expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground pl-6">No items</p>
      ) : (
        <div className="space-y-1">
          {displayItems.map((item, i) => renderItem(item, i))}
          {items.length > 5 && !expanded && (
            <div className="pl-6">
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onToggle}>
                +{items.length - 5} more
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="pl-6">
        <Link href={viewAllPath}>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" data-testid={`link-viewall-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            View all <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function KpiDrilldown({ 
  items, 
  type, 
  onClose,
  onNavigate 
}: { 
  items: any[]; 
  type: string;
  onClose: () => void;
  onNavigate: (projectName: string) => void;
}) {
  if (!items || items.length === 0) {
    return (
      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border rounded-lg shadow-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground">No projects</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
        </div>
      </div>
    );
  }

  const isFinancial = type === 'revenue' || type === 'expense' || type === 'inflows' || type === 'outflows';

  return (
    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border rounded-lg shadow-lg p-3 max-h-64 overflow-y-auto min-w-[280px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground">{items.length} project{items.length !== 1 ? 's' : ''}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
      </div>
      <div className="space-y-1">
        {items.map((item: any, i: number) => (
          <button
            key={i}
            className="w-full text-left flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-muted/50 text-sm transition-colors"
            onClick={() => onNavigate(item.projectName)}
            data-testid={`drilldown-item-${i}`}
          >
            <span className="truncate font-medium text-primary">{(item.projectName || '').replace('_Tracker', '')}</span>
            {isFinancial ? (
              <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{formatRand(item.amount)}</span>
            ) : (
              <span className="text-xs text-muted-foreground whitespace-nowrap">{item.date}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeDrilldown, setActiveDrilldown] = useState<string | null>(null);

  const { data: dashboardData, isLoading: dashLoading } = useQuery<{
    kpis: {
      siteEstablishmentNext10: number;
      commissioningNext10: number;
      omHandoverNext10: number;
      clientHandoverNext10: number;
      revenueOutstanding: number;
      expenseOverdue: number;
      inflowsThisWeek: number;
      outflowsThisWeek: number;
    };
    kpiDetails: {
      siteEstablishmentProjects: Array<{ projectName: string; date: string; pm: string | null }>;
      commissioningProjects: Array<{ projectName: string; date: string; pm: string | null }>;
      omHandoverProjects: Array<{ projectName: string; date: string; pm: string | null }>;
      clientHandoverProjects: Array<{ projectName: string; date: string; pm: string | null }>;
      revenueOutstandingProjects: Array<{ projectName: string; amount: number }>;
      expenseOverdueProjects: Array<{ projectName: string; amount: number }>;
      inflowProjects: Array<{ projectName: string; amount: number }>;
      outflowProjects: Array<{ projectName: string; amount: number }>;
    };
    pmTable: Array<{ pm: string; activeProjects: number; commissioningThisMonth: number; clientHandoverThisMonth: number }>;
  }>({
    queryKey: ["/api/program-dashboard"],
  });

  const { data: highPriority, isLoading: hpLoading } = useQuery<HighPriority>({
    queryKey: ["/api/dashboard/high-priority"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: projectsSummary = [] } = useQuery<any[]>({
    queryKey: ["/api/projects-summary"],
  });

  const kpis = dashboardData?.kpis;
  const kpiDetails = dashboardData?.kpiDetails;
  const pmTable = dashboardData?.pmTable || [];

  const top10Projects = useMemo(() => {
    if (!projectsSummary.length) return [];
    return [...projectsSummary]
      .sort((a, b) => (a.delta_vs_expected ?? 0) - (b.delta_vs_expected ?? 0))
      .slice(0, 10);
  }, [projectsSummary]);

  const pmTotals = useMemo(() => {
    return pmTable.reduce(
      (acc, row) => ({
        activeProjects: acc.activeProjects + row.activeProjects,
        commissioningThisMonth: acc.commissioningThisMonth + row.commissioningThisMonth,
        clientHandoverThisMonth: acc.clientHandoverThisMonth + row.clientHandoverThisMonth,
      }),
      { activeProjects: 0, commissioningThisMonth: 0, clientHandoverThisMonth: 0 }
    );
  }, [pmTable]);

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const toggleDrilldown = (key: string) => {
    setActiveDrilldown(prev => prev === key ? null : key);
  };

  const navigateToProject = (projectName: string) => {
    setActiveDrilldown(null);
    setLocation(`/project/${encodeURIComponent(projectName)}`);
  };

  if (dashLoading && !dashboardData) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">Program Dashboard</h2>
        <p className="text-sm text-muted-foreground">FY26: 1 Sep 2025 - 31 Aug 2026</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-32 bg-muted/20 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">Program Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">FY26: 1 Sep 2025 - 31 Aug 2026</p>
        </div>
      </div>

      <Card className="border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10" data-testid="card-high-priority">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            High Priority Actions
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Rules: overdue expenses (unpaid past date), revenue outstanding (no payment received), projects behind plan (delta &lt; -5%), milestones in next 7 days
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {hpLoading ? (
            <div className="text-sm text-muted-foreground">Loading priority items...</div>
          ) : highPriority ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <PrioritySection
                title="Overdue Expenses"
                icon={AlertCircle}
                iconColor="text-red-600"
                items={highPriority.overdueExpenses}
                viewAllPath="/projects"
                expanded={!!expanded.overdue}
                onToggle={() => toggle("overdue")}
                renderItem={(item, i) => (
                  <Link key={i} href={`/project/${encodeURIComponent(item.projectName)}`}>
                    <div className="flex items-center gap-2 pl-6 py-1.5 rounded hover:bg-white/50 cursor-pointer group" data-testid={`item-overdue-${i}`}>
                      <SeverityBadge severity={item.severity} />
                      <span className="text-sm truncate flex-1 group-hover:text-blue-600">{item.projectName.replace('_Tracker', '')}</span>
                      <span className="text-sm font-mono font-medium text-red-700">{formatRand(item.amount)}</span>
                      <span className="text-xs text-muted-foreground">{item.paymentDate}</span>
                    </div>
                  </Link>
                )}
              />

              <PrioritySection
                title="Revenue Outstanding"
                icon={DollarSign}
                iconColor="text-amber-600"
                items={highPriority.revenueOutstanding}
                viewAllPath="/projects"
                expanded={!!expanded.revenue}
                onToggle={() => toggle("revenue")}
                renderItem={(item, i) => (
                  <Link key={i} href={`/project/${encodeURIComponent(item.projectName)}`}>
                    <div className="flex items-center gap-2 pl-6 py-1.5 rounded hover:bg-white/50 cursor-pointer group" data-testid={`item-revenue-${i}`}>
                      <SeverityBadge severity={item.severity} />
                      <span className="text-sm truncate flex-1 group-hover:text-blue-600">{item.projectName.replace('_Tracker', '')}</span>
                      <span className="text-sm font-mono font-medium text-amber-700">{formatRand(item.amount)}</span>
                      {item.milestoneName && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{item.milestoneName}</span>}
                    </div>
                  </Link>
                )}
              />

              <PrioritySection
                title="Projects Behind Plan"
                icon={TrendingDown}
                iconColor="text-orange-600"
                items={highPriority.projectsBehindPlan}
                viewAllPath="/projects"
                expanded={!!expanded.behind}
                onToggle={() => toggle("behind")}
                renderItem={(item, i) => (
                  <Link key={i} href={`/project/${encodeURIComponent(item.projectName)}`}>
                    <div className="flex items-center gap-2 pl-6 py-1.5 rounded hover:bg-white/50 cursor-pointer group" data-testid={`item-behind-${i}`}>
                      <SeverityBadge severity={item.severity} />
                      <span className="text-sm truncate flex-1 group-hover:text-blue-600">{item.projectName.replace('_Tracker', '')}</span>
                      <Badge variant="destructive" className="text-xs">{formatPct(item.delta)}</Badge>
                      {item.pm && <span className="text-xs text-muted-foreground">{item.pm}</span>}
                    </div>
                  </Link>
                )}
              />

              <PrioritySection
                title="Upcoming Milestones (10 days)"
                icon={Clock}
                iconColor="text-blue-600"
                items={highPriority.upcomingMilestones}
                viewAllPath="/projects"
                expanded={!!expanded.milestones}
                onToggle={() => toggle("milestones")}
                renderItem={(item, i) => (
                  <Link key={i} href={`/project/${encodeURIComponent(item.projectName)}`}>
                    <div className="flex items-center gap-2 pl-6 py-1.5 rounded hover:bg-white/50 cursor-pointer group" data-testid={`item-milestone-${i}`}>
                      <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]" variant="outline">{item.milestoneType}</Badge>
                      <span className="text-sm truncate flex-1 group-hover:text-blue-600">{item.projectName.replace('_Tracker', '')}</span>
                      <span className="text-xs text-muted-foreground font-mono">{item.date}</span>
                      {item.pm && <span className="text-xs text-muted-foreground">{item.pm}</span>}
                    </div>
                  </Link>
                )}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Card 
            className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 cursor-pointer hover:shadow-md transition-shadow" 
            data-testid="card-site-establishment"
            onClick={() => toggleDrilldown('site')}
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-amber-100 dark:bg-amber-900/40">
                  <Construction className="w-6 h-6 text-amber-700 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-amber-800 dark:text-amber-300" data-testid="value-site-establishment">
                    {kpis?.siteEstablishmentNext10 ?? 0}
                  </p>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Site Establishment</p>
                  <p className="text-xs text-amber-600 dark:text-amber-500">Next 7 Days</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {activeDrilldown === 'site' && kpiDetails && (
            <KpiDrilldown
              items={kpiDetails.siteEstablishmentProjects}
              type="milestone"
              onClose={() => setActiveDrilldown(null)}
              onNavigate={navigateToProject}
            />
          )}
        </div>

        <div className="relative">
          <Card 
            className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 cursor-pointer hover:shadow-md transition-shadow" 
            data-testid="card-commissioning"
            onClick={() => toggleDrilldown('commissioning')}
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/40">
                  <Zap className="w-6 h-6 text-blue-700 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-blue-800 dark:text-blue-300" data-testid="value-commissioning">
                    {kpis?.commissioningNext10 ?? 0}
                  </p>
                  <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Commissioning</p>
                  <p className="text-xs text-blue-600 dark:text-blue-500">Next 7 Days</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {activeDrilldown === 'commissioning' && kpiDetails && (
            <KpiDrilldown
              items={kpiDetails.commissioningProjects}
              type="milestone"
              onClose={() => setActiveDrilldown(null)}
              onNavigate={navigateToProject}
            />
          )}
        </div>

        <div className="relative">
          <Card 
            className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 cursor-pointer hover:shadow-md transition-shadow" 
            data-testid="card-om-handover"
            onClick={() => toggleDrilldown('om')}
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900/40">
                  <Wrench className="w-6 h-6 text-green-700 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-800 dark:text-green-300" data-testid="value-om-handover">
                    {kpis?.omHandoverNext10 ?? 0}
                  </p>
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">O&M Handover</p>
                  <p className="text-xs text-green-600 dark:text-green-500">Next 7 Days</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {activeDrilldown === 'om' && kpiDetails && (
            <KpiDrilldown
              items={kpiDetails.omHandoverProjects}
              type="milestone"
              onClose={() => setActiveDrilldown(null)}
              onNavigate={navigateToProject}
            />
          )}
        </div>

        <div className="relative">
          <Card 
            className="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 cursor-pointer hover:shadow-md transition-shadow" 
            data-testid="card-client-handover"
            onClick={() => toggleDrilldown('client')}
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-purple-100 dark:bg-purple-900/40">
                  <UserCheck className="w-6 h-6 text-purple-700 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-purple-800 dark:text-purple-300" data-testid="value-client-handover">
                    {kpis?.clientHandoverNext10 ?? 0}
                  </p>
                  <p className="text-sm font-medium text-purple-700 dark:text-purple-400">Client Handover</p>
                  <p className="text-xs text-purple-600 dark:text-purple-500">Next 7 Days</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {activeDrilldown === 'client' && kpiDetails && (
            <KpiDrilldown
              items={kpiDetails.clientHandoverProjects}
              type="milestone"
              onClose={() => setActiveDrilldown(null)}
              onNavigate={navigateToProject}
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Card 
            className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 cursor-pointer hover:shadow-md transition-shadow" 
            data-testid="card-revenue-outstanding"
            onClick={() => toggleDrilldown('revOutstanding')}
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-amber-100 dark:bg-amber-900/40">
                  <DollarSign className="w-6 h-6 text-amber-700 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-800 dark:text-amber-300" data-testid="value-revenue-outstanding">
                    {formatRand(kpis?.revenueOutstanding ?? 0)}
                  </p>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Revenue Outstanding</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {activeDrilldown === 'revOutstanding' && kpiDetails && (
            <KpiDrilldown
              items={kpiDetails.revenueOutstandingProjects}
              type="revenue"
              onClose={() => setActiveDrilldown(null)}
              onNavigate={navigateToProject}
            />
          )}
        </div>

        <div className="relative">
          <Card 
            className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 cursor-pointer hover:shadow-md transition-shadow" 
            data-testid="card-expenses-overdue"
            onClick={() => toggleDrilldown('expOverdue')}
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/40">
                  <AlertCircle className="w-6 h-6 text-red-700 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-800 dark:text-red-300" data-testid="value-expenses-overdue">
                    {formatRand(kpis?.expenseOverdue ?? 0)}
                  </p>
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">Expenses Overdue</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {activeDrilldown === 'expOverdue' && kpiDetails && (
            <KpiDrilldown
              items={kpiDetails.expenseOverdueProjects}
              type="expense"
              onClose={() => setActiveDrilldown(null)}
              onNavigate={navigateToProject}
            />
          )}
        </div>

        <div className="relative">
          <Card 
            className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 cursor-pointer hover:shadow-md transition-shadow" 
            data-testid="card-inflows-this-week"
            onClick={() => toggleDrilldown('inflows')}
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900/40">
                  <TrendingUp className="w-6 h-6 text-green-700 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-800 dark:text-green-300" data-testid="value-inflows-this-week">
                    {formatRand(kpis?.inflowsThisWeek ?? 0)}
                  </p>
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">Inflows This Week</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {activeDrilldown === 'inflows' && kpiDetails && (
            <KpiDrilldown
              items={kpiDetails.inflowProjects}
              type="inflows"
              onClose={() => setActiveDrilldown(null)}
              onNavigate={navigateToProject}
            />
          )}
        </div>

        <div className="relative">
          <Card 
            className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 cursor-pointer hover:shadow-md transition-shadow" 
            data-testid="card-outflows-this-week"
            onClick={() => toggleDrilldown('outflows')}
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/40">
                  <TrendingDown className="w-6 h-6 text-red-700 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-800 dark:text-red-300" data-testid="value-outflows-this-week">
                    {formatRand(kpis?.outflowsThisWeek ?? 0)}
                  </p>
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">Outflows This Week</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {activeDrilldown === 'outflows' && kpiDetails && (
            <KpiDrilldown
              items={kpiDetails.outflowProjects}
              type="outflows"
              onClose={() => setActiveDrilldown(null)}
              onNavigate={navigateToProject}
            />
          )}
        </div>
      </div>

      <Card data-testid="card-pm-summary">
        <CardHeader>
          <CardTitle>Project Manager Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">PM Name</th>
                  <th className="text-right py-2 px-3 font-medium">Active Projects</th>
                  <th className="text-right py-2 px-3 font-medium">Commissioning (This Month)</th>
                  <th className="text-right py-2 px-3 font-medium">Client Handover (This Month)</th>
                </tr>
              </thead>
              <tbody>
                {pmTable.map((row, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-pm-${i}`}>
                    <td className="py-2 px-3">{row.pm}</td>
                    <td className="py-2 px-3 text-right font-mono">{row.activeProjects}</td>
                    <td className="py-2 px-3 text-right font-mono">{row.commissioningThisMonth}</td>
                    <td className="py-2 px-3 text-right font-mono">{row.clientHandoverThisMonth}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="py-2 px-3">Total</td>
                  <td className="py-2 px-3 text-right font-mono">{pmTotals.activeProjects}</td>
                  <td className="py-2 px-3 text-right font-mono">{pmTotals.commissioningThisMonth}</td>
                  <td className="py-2 px-3 text-right font-mono">{pmTotals.clientHandoverThisMonth}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-projects-overview">
        <CardHeader>
          <CardTitle>Active Projects Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Project</th>
                  <th className="text-left py-2 px-3 font-medium">Phase</th>
                  <th className="text-right py-2 px-3 font-medium">% Complete</th>
                  <th className="text-right py-2 px-3 font-medium">Delta</th>
                  <th className="text-right py-2 px-3 font-medium">Revenue</th>
                  <th className="text-right py-2 px-3 font-medium">Expenses</th>
                </tr>
              </thead>
              <tbody>
                {top10Projects.map((p: any, i: number) => (
                  <tr
                    key={p.project_name || i}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setLocation(`/project/${encodeURIComponent(p.project_name)}`)}
                    data-testid={`row-project-${i}`}
                  >
                    <td className="py-2 px-3 font-medium">{(p.project_name || "").replace("_Tracker", "")}</td>
                    <td className="py-2 px-3">{p.phase || "--"}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatPct(p.project_pct_complete)}</td>
                    <td className={`py-2 px-3 text-right font-mono ${(p.delta_vs_expected ?? 0) < 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatPct(p.delta_vs_expected)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{formatRand(p.actual_revenue ?? 0)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatRand(p.actual_expenses ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-center">
            <Button variant="link" onClick={() => setLocation("/projects")} data-testid="link-view-all-projects">
              View All <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

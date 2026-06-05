import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useLocation } from "wouter";
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  addMonths,
  subMonths,
  isSameDay,
  isToday,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  parseISO,
  differenceInDays,
} from "date-fns";
import {
  Briefcase,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ArrowRight,
  HardHat,
  Zap,
  PauseCircle,
  TrendingUp,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Flag,
  Shield,
  ExternalLink,
  AlertCircle,
  FileWarning,
  Gauge,
  Percent,
  MoreHorizontal,
} from "lucide-react";
import { EnergyLoader } from "@/components/ui/energy-loader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import DataSourceDebug from "@/components/DataSourceDebug";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrencyCompact, formatCurrencyFull } from "@/lib/execution-dashboard";
import { formatForDisplayZA, parseIsoDateStrict } from "@shared/utils/dates";

async function pmFetch<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json();
}

interface ProjectDates {
  pdHandover: string | null;
  pdHandoverActual: string | null;
  constructionStart: string | null;
  constructionStartActual: string | null;
  commissioning: string | null;
  commissioningActual: string | null;
  clientHandover: string | null;
  clientHandoverActual: string | null;
  omHandover: string | null;
}

interface ProjectFinancials {
  totalBudget: number;
  totalActual: number;
  spendPercent: number;
  cosRealised: number;
  cosCommitted: number;
  cosPlanned: number;
}

interface ProjectTasks {
  total: number;
  inProgress: number;
  completed: number;
  onHold: number;
  needsApproval: number;
  overdue: number;
  active: number;
}

interface PMProject {
  id: number;
  projectName: string;
  phase: string | null;
  ragStatus: string | null;
  contractValue: number;
  sizeKwp: number;
  escalationLevel: string | null;
  isActive: boolean;
  dates: ProjectDates;
  financials: ProjectFinancials;
  tasks: ProjectTasks;
}

interface NegativeCosCommittedProject {
  id: number;
  projectName: string;
  cosCommitted: number;
}

interface PMDashboardData {
  projects: PMProject[];
  summary: {
    totalProjects: number;
    totalContractValue: number;
    totalBudget: number;
    totalActualSpend: number;
    activeTasks: number;
    overdueTasks: number;
    completedTasks: number;
    grossProfit: number;
    avgSpendPercent: number;
    cosRealisedTotal: number;
    cosCommittedTotal: number;
  };
  dataQualityWarnings?: {
    negativeCosCommittedProjects: NegativeCosCommittedProject[];
  };
}

interface PriorityItem {
  type: string;
  severity: string;
  projectName: string;
  title: string;
  detail: string;
  taskId?: number;
  expenseId?: number;
  dueDate?: string;
  priority?: string;
  phase?: string;
  link: string;
}

interface CalendarEvent {
  type: string;
  projectName: string;
  title: string;
  date: string;
  isCompleted?: boolean;
  taskId?: number;
  status?: string;
  priority?: string;
  isOverdue?: boolean;
  link: string;
}

const ragColors: Record<string, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  grey: "bg-gray-400",
};

// Prompt 0.10: removed local formatCurrency in favour of the shared
// helpers from @/lib/execution-dashboard. The local version lacked
// Math.abs handling which caused negative COS values to render
// incorrectly and it never applied commas or locale grouping.
// formatCurrencyCompact — compact "R25.9M" for summary KPI tiles.
// formatCurrencyFull    — detailed "R1,543,651" for project-card badges.

function formatDate(d: string | null): string {
  if (!d) return "\u2014";
  const parsed = parseIsoDateStrict(d);
  if (!parsed) return d;
  return formatForDisplayZA(parsed.toDate());
}

function DateRow({ label, planned, actual }: { label: string; planned: string | null; actual: string | null }) {
  if (!planned && !actual) return null;
  return (
    <div className="flex justify-between text-xs" data-testid={`date-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={actual ? "text-green-600 font-medium" : ""}>{formatDate(actual || planned)}</span>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const typeIcons: Record<string, any> = {
  overdue_task: AlertTriangle,
  hold_task: PauseCircle,
  approval_needed: Shield,
  cos_flagged: FileWarning,
  budget_overrun: TrendingUp,
};

const typeLabels: Record<string, string> = {
  overdue_task: "Overdue Task",
  hold_task: "On Hold",
  approval_needed: "Needs Approval",
  cos_flagged: "COS Flagged",
  budget_overrun: "Cost Overrun",
};

const severityColors: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
};

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Icon className={`h-3.5 w-3.5 ${color || ""}`} /> {label}
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function OverviewTab({ data, navigate }: { data: PMDashboardData; navigate: (path: string) => void }) {
  const { projects, summary } = data;
  const negativeCosProjects = data.dataQualityWarnings?.negativeCosCommittedProjects ?? [];

  return (
    <div className="space-y-6">
      {negativeCosProjects.length > 0 && (
        <Card className="border-amber-300 bg-amber-50" data-testid="pm-data-quality-warning">
          <CardContent className="p-3 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-900">
                Credit-note review needed — negative committed cost on {negativeCosProjects.length}{" "}
                project{negativeCosProjects.length === 1 ? "" : "s"}
              </div>
              <div className="text-amber-800 mt-0.5">
                {negativeCosProjects
                  .map((p) => `${p.projectName} (${formatCurrencyFull(p.cosCommitted)})`)
                  .join(", ")}
                . These are credit notes / reversals on normalized cost lines with{" "}
                <code>paid_date IS NULL</code> exceeding positive commitments. Ask finance to review and apply.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3" data-testid="pm-kpi-strip">
        <KpiCard icon={Briefcase} label="Projects" value={summary.totalProjects} />
        <KpiCard icon={DollarSign} label="Contract Value" value={formatCurrencyCompact(summary.totalContractValue)} />
        <KpiCard icon={Gauge} label="Avg Spend" value={`${summary.avgSpendPercent}%`} sub="costed utilisation" />
        <KpiCard icon={Percent} label="Gross Profit" value={`${summary.grossProfit}%`} sub="across portfolio" color={summary.grossProfit < 15 ? "text-red-500" : "text-green-500"} />
        <KpiCard icon={Zap} label="Active Tasks" value={summary.activeTasks} />
        <KpiCard icon={AlertTriangle} label="Overdue" value={summary.overdueTasks} color={summary.overdueTasks > 0 ? "text-red-500" : ""} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="pm-cos-kpis">
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-green-700 font-medium uppercase">COS Realised</div>
            {/* Prompt 0.10: apply formatCurrencyCompact to match the header tiles. */}
            <p className="text-xl font-bold text-green-800">{formatCurrencyCompact(summary.cosRealisedTotal || 0)}</p>
          </CardContent>
        </Card>
        <Card className={`${summary.cosCommittedTotal < 0 ? "border-red-300 bg-red-50/60" : "border-amber-200 bg-amber-50/50"}`}>
          <CardContent className="p-3">
            <div className={`text-[10px] font-medium uppercase ${summary.cosCommittedTotal < 0 ? "text-red-700" : "text-amber-700"}`}>
              COS Committed
            </div>
            {/* Prompt 0.11: render the honest (possibly negative) aggregate.
                A negative value means credit notes / reversals on
                normalized_cost_lines with paid_date IS NULL exceed the
                unpaid positive commitments — the surrounding banner and
                the negativeCosCommittedProjects list tell finance which
                projects to investigate. formatCurrencyCompact handles the
                sign prefix. */}
            <p className={`text-xl font-bold ${summary.cosCommittedTotal < 0 ? "text-red-700" : "text-amber-800"}`}
               title={summary.cosCommittedTotal < 0 ? "Credit notes / reversals exceed positive commitments — see banner above" : undefined}>
              {formatCurrencyCompact(summary.cosCommittedTotal || 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-blue-700 font-medium uppercase">Tasks Completed</div>
            <p className="text-xl font-bold text-blue-800">{summary.completedTasks}</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-purple-700 font-medium uppercase">Total Costed</div>
            <p className="text-xl font-bold text-purple-800">{formatCurrencyCompact(summary.totalBudget)}</p>
          </CardContent>
        </Card>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center" data-testid="pm-empty">
            <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="font-medium text-lg mb-1">No projects assigned yet</h3>
            <p className="text-sm text-muted-foreground">Projects will appear here once they are linked to your account.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="pm-projects-grid">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/project/${encodeURIComponent(project.projectName)}`)}
              data-testid={`pm-project-${project.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold truncate flex-1 mr-2">{project.projectName}</CardTitle>
                  <div className="flex items-center gap-2 shrink-0">
                    {project.ragStatus && (
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${ragColors[project.ragStatus] || "bg-gray-300"}`}
                        title={`RAG: ${project.ragStatus}`}
                        data-testid={`rag-${project.id}`}
                      />
                    )}
                    {project.phase && (
                      <Badge variant="outline" className="text-[9px] h-5">{project.phase}</Badge>
                    )}
                  </div>
                </div>
                {project.sizeKwp > 0 && (
                  <p className="text-xs text-muted-foreground">{project.sizeKwp} kWp</p>
                )}
              </CardHeader>

              <CardContent className="space-y-3 pt-0">
                <div className="space-y-1">
                  <DateRow label="Construction" planned={project.dates.constructionStart} actual={project.dates.constructionStartActual} />
                  <DateRow label="Commissioning" planned={project.dates.commissioning} actual={project.dates.commissioningActual} />
                  <DateRow label="Client Handover" planned={project.dates.clientHandover} actual={project.dates.clientHandoverActual} />
                </div>

                <Separator />

                <div data-testid={`financials-${project.id}`}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <BarChart3 className="h-3 w-3" /> Costed vs Actual
                    </span>
                    <span className="font-medium">{project.financials.spendPercent}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        project.financials.spendPercent > 100 ? "bg-red-500" :
                        project.financials.spendPercent > 80 ? "bg-amber-500" : "bg-primary"
                      }`}
                      style={{ width: `${Math.min(project.financials.spendPercent, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>{formatCurrencyCompact(project.financials.totalActual)} spent</span>
                    <span>{formatCurrencyCompact(project.financials.totalBudget)} costed</span>
                  </div>
                </div>

                {/* Prompt 0.10: project-card COS badges previously rendered
                    raw floats with "R:" / "C:" / "P:" prefixes that
                    collided visually with the Rand currency symbol. Now
                    use formatCurrencyFull for the value (detailed R-prefixed
                    ZAR with comma grouping) and move the semantic label
                    ("Real", "Com", "Plan") in front so the R in "R1,543,651"
                    is unambiguously the currency symbol. */}
                <div className="flex gap-1.5 flex-wrap" data-testid={`cos-${project.id}`}>
                  {project.financials.cosRealised !== 0 && (
                    <Badge
                      className={`text-[9px] ${project.financials.cosRealised < 0 ? "bg-red-100 text-red-800 hover:bg-red-100" : "bg-green-100 text-green-800 hover:bg-green-100"}`}
                      title="Cost of Sales — Realised"
                    >
                      Real {formatCurrencyFull(project.financials.cosRealised)}
                    </Badge>
                  )}
                  {(project.financials.cosCommitted || 0) !== 0 && (
                    <Badge
                      className={`text-[9px] ${project.financials.cosCommitted < 0 ? "bg-red-100 text-red-800 hover:bg-red-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100"}`}
                      title={project.financials.cosCommitted < 0 ? "Cost of Sales — Committed (credit notes exceed positive commitments)" : "Cost of Sales — Committed"}
                    >
                      Com {formatCurrencyFull(project.financials.cosCommitted || 0)}
                    </Badge>
                  )}
                  {project.financials.cosPlanned > 0 && (
                    <Badge className="text-[9px] bg-muted text-muted-foreground hover:bg-muted" title="Cost of Sales — Planned">Plan {formatCurrencyFull(project.financials.cosPlanned)}</Badge>
                  )}
                </div>

                <Separator />

                <div data-testid={`tasks-${project.id}`}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <HardHat className="h-3 w-3" /> Engineering Tasks
                    </span>
                    <span className="font-medium">{project.tasks.completed}/{project.tasks.total}</span>
                  </div>
                  {project.tasks.total > 0 && (
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-1.5">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${project.tasks.total > 0 ? (project.tasks.completed / project.tasks.total) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {project.tasks.inProgress > 0 && (
                      <span className="text-[10px] flex items-center gap-0.5 text-blue-600">
                        <Clock className="h-2.5 w-2.5" /> {project.tasks.inProgress} active
                      </span>
                    )}
                    {project.tasks.onHold > 0 && (
                      <span className="text-[10px] flex items-center gap-0.5 text-amber-600">
                        <PauseCircle className="h-2.5 w-2.5" /> {project.tasks.onHold} hold
                      </span>
                    )}
                    {project.tasks.overdue > 0 && (
                      <span className="text-[10px] flex items-center gap-0.5 text-red-600">
                        <AlertTriangle className="h-2.5 w-2.5" /> {project.tasks.overdue} overdue
                      </span>
                    )}
                    {project.tasks.completed > 0 && (
                      <span className="text-[10px] flex items-center gap-0.5 text-green-600">
                        <CheckCircle2 className="h-2.5 w-2.5" /> {project.tasks.completed} done
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end text-xs text-primary">
                  <span className="flex items-center gap-1">View details <ArrowRight className="h-3 w-3" /></span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PriorityTab({ navigate, pmUserId }: { navigate: (path: string) => void; pmUserId?: string }) {
  const [filterType, setFilterType] = useState<string>("all");

  const { data, isLoading } = useQuery<{ items: PriorityItem[] }>({
    queryKey: ["pm-priority", pmUserId],
    queryFn: () => pmFetch(`/api/pm/priority-items${pmUserId ? `?pmUserId=${pmUserId}` : ""}`),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const items = data?.items || [];
  const types = [...new Set(items.map(i => i.type))];
  const filtered = filterType === "all" ? items : items.filter(i => i.type === filterType);

  const highCount = items.filter(i => i.severity === "high").length;
  const mediumCount = items.filter(i => i.severity === "medium").length;

  return (
    <div className="space-y-4" data-testid="pm-priority-tab">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">{highCount} High</Badge>
          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{mediumCount} Medium</Badge>
          <span className="text-xs text-muted-foreground">{items.length} total items</span>
        </div>
        <div className="flex gap-1 ml-auto flex-wrap">
          <Button
            size="sm"
            variant={filterType === "all" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setFilterType("all")}
            data-testid="filter-all"
          >
            All
          </Button>
          {types.map(t => (
            <Button
              key={t}
              size="sm"
              variant={filterType === t ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setFilterType(t)}
              data-testid={`filter-${t}`}
            >
              {typeLabels[t] || t} ({items.filter(i => i.type === t).length})
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-500" />
            <h3 className="font-medium">No priority items</h3>
            <p className="text-sm text-muted-foreground mt-1">All clear across your projects.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((item, idx) => {
            const TypeIcon = typeIcons[item.type] || AlertCircle;
            return (
              <Card
                key={`${item.type}-${idx}`}
                className={`cursor-pointer hover:shadow-md transition-shadow border ${severityColors[item.severity] || ""}`}
                onClick={() => navigate(item.link)}
                data-testid={`priority-item-${idx}`}
              >
                <CardContent className="p-3 flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    <TypeIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                        {typeLabels[item.type] || item.type}
                      </span>
                      <Badge variant="outline" className="text-[9px] h-4">{item.projectName}</Badge>
                      {item.priority && (
                        <Badge variant="outline" className="text-[9px] h-4">{item.priority}</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
                    {item.dueDate && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Due: {formatDate(item.dueDate)}
                        {item.dueDate < new Date().toISOString().split("T")[0] && (
                          <span className="text-red-600 font-medium ml-1">
                            ({differenceInDays(new Date(), parseISO(item.dueDate))}d overdue)
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 mt-1 opacity-40" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CalendarTab({ navigate, pmUserId }: { navigate: (path: string) => void; pmUserId?: string }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const { data, isLoading } = useQuery<{ events: CalendarEvent[] }>({
    queryKey: ["pm-calendar", pmUserId],
    queryFn: () => pmFetch(`/api/pm/calendar-events${pmUserId ? `?pmUserId=${pmUserId}` : ""}`),
  });

  const events = data?.events || [];

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      if (!ev.date) continue;
      try {
        const d = ev.date.split("T")[0];
        if (!map[d]) map[d] = [];
        map[d].push(ev);
      } catch {}
    }
    return map;
  }, [events]);

  const thisMonthEvents = useMemo(() => {
    return events.filter(ev => {
      if (!ev.date) return false;
      try {
        const d = parseISO(ev.date);
        return isSameMonth(d, currentMonth);
      } catch {
        return false;
      }
    });
  }, [events, currentMonth]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pm-calendar-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(m => subMonths(m, 1))} data-testid="cal-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-semibold w-40 text-center">{format(currentMonth, "MMMM yyyy")}</h3>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(m => addMonths(m, 1))} data-testid="cal-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCurrentMonth(new Date())} data-testid="cal-today">
          Today
        </Button>
      </div>

      <div className="flex items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" /> Milestone</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Task Due</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Completed</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Overdue</span>
      </div>

      <Card>
        <CardContent className="p-2">
          <div className="grid grid-cols-7 gap-0">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-[10px] font-semibold text-center text-muted-foreground py-1 uppercase">
                {d}
              </div>
            ))}
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayEvents = eventsByDate[key] || [];
              const inMonth = isSameMonth(day, currentMonth);
              const today = isToday(day);

              return (
                <div
                  key={key}
                  className={`min-h-[72px] md:min-h-[80px] border border-border/30 p-1 transition-colors ${
                    !inMonth ? "bg-muted/30 opacity-50" : ""
                  } ${today ? "bg-primary/5 ring-1 ring-primary/20" : ""}`}
                  data-testid={`cal-day-${key}`}
                >
                  <div className={`text-[11px] font-medium mb-0.5 ${today ? "text-primary font-bold" : "text-muted-foreground"}`}>
                    {format(day, "d")}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev, i) => {
                      const dotColor = ev.isCompleted
                        ? "bg-green-500"
                        : ev.isOverdue
                        ? "bg-red-500"
                        : ev.type === "milestone"
                        ? "bg-purple-500"
                        : "bg-blue-500";

                      return (
                        <Popover key={i}>
                          <PopoverTrigger asChild>
                            <button
                              className="w-full text-left flex items-center gap-1 hover:bg-accent/50 rounded px-0.5 py-px"
                              data-testid={`cal-event-${key}-${i}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                              <span className="text-[9px] truncate leading-tight">{ev.title}</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-3" side="top">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  {ev.type === "milestone" ? "Milestone" : "Task"}
                                </span>
                              </div>
                              <p className="text-sm font-medium">{ev.title}</p>
                              <Badge variant="outline" className="text-[9px]">{ev.projectName}</Badge>
                              {ev.status && <p className="text-xs text-muted-foreground">Status: {ev.status}</p>}
                              {ev.priority && <p className="text-xs text-muted-foreground">Priority: {ev.priority}</p>}
                              <p className="text-xs text-muted-foreground">{formatDate(ev.date)}</p>
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full h-7 text-xs"
                                onClick={() => navigate(ev.link)}
                                data-testid={`cal-go-${key}-${i}`}
                              >
                                Go to project <ExternalLink className="h-3 w-3 ml-1" />
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="text-[9px] text-primary font-medium px-0.5" data-testid={`cal-more-${key}`}>
                            +{dayEvents.length - 3} more
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-3 max-h-60 overflow-y-auto" side="top">
                          <p className="text-xs font-semibold mb-2">{format(day, "dd MMM yyyy")} - All Events</p>
                          <div className="space-y-2">
                            {dayEvents.map((ev, i) => {
                              const dotColor = ev.isCompleted ? "bg-green-500" : ev.isOverdue ? "bg-red-500" : ev.type === "milestone" ? "bg-purple-500" : "bg-blue-500";
                              return (
                                <div
                                  key={i}
                                  className="flex items-start gap-2 cursor-pointer hover:bg-accent/50 rounded p-1"
                                  onClick={() => navigate(ev.link)}
                                >
                                  <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${dotColor}`} />
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium truncate">{ev.title}</p>
                                    <p className="text-[10px] text-muted-foreground">{ev.projectName}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Events This Month ({thisMonthEvents.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {thisMonthEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No events this month</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {thisMonthEvents.map((ev, i) => {
                const dotColor = ev.isCompleted ? "bg-green-500" : ev.isOverdue ? "bg-red-500" : ev.type === "milestone" ? "bg-purple-500" : "bg-blue-500";
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 rounded hover:bg-accent/50 cursor-pointer text-xs"
                    onClick={() => navigate(ev.link)}
                    data-testid={`month-event-${i}`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                    <span className="font-medium w-16 shrink-0">{formatDate(ev.date)}</span>
                    <span className="truncate flex-1">{ev.title}</span>
                    <Badge variant="outline" className="text-[9px] shrink-0">{ev.projectName}</Badge>
                    {ev.isOverdue && <Badge className="text-[8px] bg-red-100 text-red-800 hover:bg-red-100 shrink-0">Overdue</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface PMUser {
  id: number;
  username: string;
  name: string;
  project_count: string;
}

const COO_VIEW_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin"];

function HandoverCompleteSection() {
  const [, navigate] = useLocation();
  const { data } = useQuery<{ items: any[] }>({
    queryKey: ["/api/engineering-pm-handover/completed"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/engineering-pm-handover/completed");
      return res.json();
    },
  });

  const items = data?.items || [];
  if (items.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Handover Complete ({items.length})
      </h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((row: any) => {
          const daysSince = row.pm_sign_off_at ? Math.max(0, Math.floor((Date.now() - new Date(row.pm_sign_off_at).getTime()) / 86400000)) : 0;
          const kickoffDate = row.kickoff_date ? new Date(row.kickoff_date) : null;
          const kickoffSoon = kickoffDate ? (kickoffDate.getTime() - Date.now()) / 86400000 <= 5 && kickoffDate.getTime() >= Date.now() : false;
          return (
            <Card key={row.project_id} className="border-emerald-100 cursor-pointer hover:shadow-sm transition-shadow" onClick={() => navigate(`/pd/handover/${row.project_id}`)}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{row.project_name}</p>
                  <Badge variant="outline" className="text-emerald-700 border-emerald-200 text-xs">Complete</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{row.client_name} &middot; {row.size_kwp || "—"} kWp</p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {kickoffDate && (
                    <span className={kickoffSoon ? "text-amber-700 font-medium" : ""}>
                      Kickoff: {kickoffDate.toLocaleDateString()}{kickoffSoon ? " (soon)" : ""}
                    </span>
                  )}
                  <span>{daysSince}d since sign-off</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function PMDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedPmId, setSelectedPmId] = useState<string>("");

  const isCooView = user?.role ? COO_VIEW_ROLES.includes(user.role) : false;

  const { data: pmUsersData } = useQuery<{ users: PMUser[] }>({
    queryKey: ["pm-users"],
    queryFn: () => pmFetch("/api/pm/users"),
    enabled: isCooView,
  });

  const pmUsers = pmUsersData?.users || [];
  const pmIdParam = isCooView && selectedPmId ? selectedPmId : undefined;

  const { data, isLoading, error } = useQuery<PMDashboardData>({
    queryKey: ["pm-dashboard", pmIdParam],
    queryFn: () => pmFetch(`/api/pm/dashboard${pmIdParam ? `?pmUserId=${pmIdParam}` : ""}`),
    enabled: isCooView ? !!selectedPmId : true,
  });

  const selectedPmName = pmUsers.find(u => String(u.id) === selectedPmId)?.name;

  if (isCooView && !selectedPmId) {
    if (pmUsers.length === 0) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]" data-testid="pm-loading">
          <EnergyLoader size="md" label="Loading project managers..." />
        </div>
      );
    }
    return (
      <PageShell className="p-4 md:p-6" data-testid="pm-dashboard">
        <SectionHeader
          icon={<Briefcase className="h-5 w-5" />}
          title="Project Manager Dashboard"
          description="Select a project manager to review the post-handover execution workspace."
        />
        <div className="max-w-xs">
          <SearchableSelect
            value={selectedPmId}
            onValueChange={setSelectedPmId}
            placeholder="Choose a PM..."
            data-testid="pm-selector-trigger"
            options={pmUsers.map(u => ({
              value: String(u.id),
              label: `${u.name || u.username} (${u.project_count} projects)`,
            }))}
          />
        </div>
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="pm-loading">
        <EnergyLoader size="lg" label="Loading execution overview..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-destructive" data-testid="pm-error">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Could not load the execution overview. Likely reason: server or PM access mismatch. Refresh and retry. If it persists, contact your admin.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="pm-loading">
        <EnergyLoader size="md" label="Connecting to project data..." />
      </div>
    );
  }

  const { summary } = data;

  return (
    <PageShell className="p-4 md:p-6" data-testid="pm-dashboard">
      <SectionHeader
        icon={<Briefcase className="h-5 w-5" />}
        title="Project Manager Dashboard"
        description={`${isCooView && selectedPmName ? `${selectedPmName} - ` : user?.name ? `${user.name} - ` : ""}${summary.totalProjects} project${summary.totalProjects !== 1 ? "s" : ""} in the execution workspace after PD handover`}
        actions={<div className="flex items-center gap-2">
          {isCooView ? (
            <div className="w-56">
              <SearchableSelect
                value={selectedPmId}
                onValueChange={setSelectedPmId}
                placeholder="Select PM"
                triggerClassName="h-9"
                data-testid="pm-selector-trigger"
                options={pmUsers.map(u => ({
                  value: String(u.id),
                  label: `${u.name || u.username} (${u.project_count})`,
                }))}
              />
            </div>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => navigate("/handover-control")}>Site / Execution Controls</Button>
        </div>}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="pm-tabs">
        <div className="flex items-center gap-2 flex-wrap">
          <TabsList className="grid grid-cols-2 w-full max-w-[280px]">
          <TabsTrigger value="overview" className="text-xs" data-testid="tab-overview">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Delivery
          </TabsTrigger>
          <TabsTrigger value="priority" className="text-xs" data-testid="tab-priority">
            <Flag className="h-3.5 w-3.5 mr-1.5" /> Action Queue
            {summary.overdueTasks > 0 && (
              <Badge className="ml-1.5 h-4 text-[9px] bg-red-500">{summary.overdueTasks}</Badge>
            )}
          </TabsTrigger>
          </TabsList>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5" data-testid="tab-more-options">
                <MoreHorizontal className="h-3.5 w-3.5" /> More
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-1.5">
              <Button
                variant={activeTab === "calendar" ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start text-xs"
                onClick={() => setActiveTab("calendar")}
                data-testid="tab-calendar"
              >
                <CalendarDays className="h-3.5 w-3.5 mr-1.5" /> Calendar
              </Button>
            </PopoverContent>
          </Popover>
        </div>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab data={data} navigate={navigate} />
        </TabsContent>

        <TabsContent value="priority" className="mt-4">
          <PriorityTab navigate={navigate} pmUserId={pmIdParam} />
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <CalendarTab navigate={navigate} pmUserId={pmIdParam} />
        </TabsContent>
      </Tabs>

      {/* Managed-document approvals waiting on this PM */}
      <ManagedDocumentApprovalQueue title="Approvals waiting on you" />

      {/* Handover-complete projects section */}
      <HandoverCompleteSection />

      <DataSourceDebug
        pageName="Project Manager Dashboard"
        dataSources={[
          { endpoint: "/api/pm/dashboard", tables: ["project_info", "normalized_cost_lines", "normalized_plan_tasks", "work_items"], description: "PM projects, financials, task counts" },
          { endpoint: "/api/pm/priority-items", tables: ["work_items", "normalized_cost_lines", "project_info"], description: "Priority items: overdue, holds, approvals" },
          { endpoint: "/api/pm/calendar-events", tables: ["project_info", "work_items", "normalized_plan_tasks"], description: "Milestone and task calendar events" },
        ]}
      />
    </PageShell>
  );
}

import { useQuery } from "@tanstack/react-query";
import {
  Home,
  Building2,
  ListTodo,
  CalendarClock,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { PageShell, SectionHeader, KPIStrip, WorkspaceNotice } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getUniversalStatusLabel, getUniversalStatusBadgeClass } from "@shared/task-status";
import { cn } from "@/lib/utils";

/**
 * Engineering Home (delivery-scope rebuild, Phase 1).
 *
 * Spine-based landing for the Engineering function — reads
 * GET /api/engineering/home (work_items workstream=ENG + read-only phase).
 * Replaces the legacy engineering-dashboard.tsx (standup/registers dropped).
 */

type DueBucket = "overdue" | "today" | "this_week" | "later" | "none";

interface HomeMetrics {
  activeProjects: number;
  openTasks: number;
  dueThisWeek: number;
  overdue: number;
}

interface PortfolioRow {
  projectId: number;
  projectName: string;
  phaseCode: string | null;
  phaseLabel: string;
  open: number;
  overdue: number;
  progress: number;
}

interface MyWorkRow {
  id: number;
  title: string;
  projectId: number | null;
  projectName: string | null;
  status: string;
  endDate: string | null;
  due: DueBucket;
}

interface EngineeringHomeSummary {
  metrics: HomeMetrics;
  portfolio: PortfolioRow[];
  myWork: MyWorkRow[];
}

const DUE_META: Record<DueBucket, { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "bg-red-100 text-red-700" },
  today: { label: "Today", cls: "bg-amber-100 text-amber-700" },
  this_week: { label: "This week", cls: "bg-blue-100 text-blue-700" },
  later: { label: "Later", cls: "bg-muted text-foreground" },
  none: { label: "No date", cls: "bg-muted text-muted-foreground" },
};

function MetricCard({
  label,
  value,
  icon,
  danger,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            danger && value > 0 ? "bg-red-100 text-red-600" : "bg-primary/8 text-primary",
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-4" data-testid="engineering-home-loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export default function EngineeringHomePage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<EngineeringHomeSummary>({
    queryKey: ["/api/engineering/home"],
  });

  return (
    <PageShell>
      <SectionHeader
        icon={<Home className="h-5 w-5" />}
        eyebrow="Engineering"
        title="Home"
        description="Delivery work across the engineering discipline, from financial close to handover."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="engineering-home-refresh"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <HomeSkeleton />
      ) : isError ? (
        <WorkspaceNotice
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Couldn't load the engineering home"
          description={error instanceof Error ? error.message : "Please try again."}
          actions={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          }
        />
      ) : data ? (
        <div className="space-y-5" data-testid="engineering-home-content">
          <KPIStrip className="grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Active projects" value={data.metrics.activeProjects} icon={<Building2 className="h-4 w-4" />} />
            <MetricCard label="Open tasks" value={data.metrics.openTasks} icon={<ListTodo className="h-4 w-4" />} />
            <MetricCard label="Due this week" value={data.metrics.dueThisWeek} icon={<CalendarClock className="h-4 w-4" />} />
            <MetricCard label="Overdue" value={data.metrics.overdue} icon={<AlertTriangle className="h-4 w-4" />} danger />
          </KPIStrip>

          {/* Portfolio — where are we */}
          <Card className="border-border bg-card">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Where are we</h2>
                <span className="text-xs text-muted-foreground">{data.portfolio.length} projects</span>
              </div>
              {data.portfolio.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">No engineering work on any project yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Project</th>
                        <th className="px-4 py-2 font-medium">Phase</th>
                        <th className="px-4 py-2 text-right font-medium">Open</th>
                        <th className="px-4 py-2 text-right font-medium">Overdue</th>
                        <th className="px-4 py-2 text-right font-medium">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.portfolio.map((row) => (
                        <tr key={row.projectId} className="border-b border-border/40 last:border-0" data-testid={`portfolio-row-${row.projectId}`}>
                          <td className="px-4 py-2.5 font-medium text-foreground">{row.projectName}</td>
                          <td className="px-4 py-2.5">
                            {/* Phase is read-only in Engineering (single source: lifecycle). */}
                            <Badge variant="outline" className="font-normal">{row.phaseLabel}</Badge>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{row.open}</td>
                          <td className={cn("px-4 py-2.5 text-right tabular-nums", row.overdue > 0 && "font-semibold text-red-600")}>{row.overdue}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${row.progress}%` }} />
                              </div>
                              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{row.progress}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* My work today */}
          <Card className="border-border bg-card">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight">My work</h2>
                <span className="text-xs text-muted-foreground">{data.myWork.length} open</span>
              </div>
              {data.myWork.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <p className="text-sm text-muted-foreground">Nothing open assigned to you. Nice.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {data.myWork.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-2.5" data-testid={`my-work-${task.id}`}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{task.projectName ?? "No project"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="secondary" className={cn("font-normal", getUniversalStatusBadgeClass(task.status))}>
                          {getUniversalStatusLabel(task.status)}
                        </Badge>
                        <Badge variant="secondary" className={cn("font-normal", DUE_META[task.due].cls)}>
                          {DUE_META[task.due].label}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PageShell>
  );
}

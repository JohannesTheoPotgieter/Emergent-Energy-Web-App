import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { formatZarCompact } from "@/lib/currency";
import { useGatesPipeline, useGatesHandovers } from "@/hooks/use-gates";
import { PortfolioReadinessTile } from "@/components/documents/PortfolioReadinessTile";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import { PageHeader } from "@/components/ui/page-header";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, ArrowRight, Clock, DollarSign, Flag,
  ShieldAlert, ShieldCheck, TrendingUp, Wrench, Zap, AlertCircle,
} from "lucide-react";

/**
 * COO morning check — operational command.
 *
 * Ordered around how the COO's eyes actually move:
 *   1) Waiting on me (approvals the COO owns)
 *   2) Company priorities snapshot — COO owns the priorities function
 *   3) Project progress — Red / Behind-plan projects
 *   4) Engineering (COO's baby) — blockers + stage-gate readiness
 *   5) Quality + HSE + SSEG
 *   6) Upcoming handovers this week
 *   Right column always-visible: CoS realisation + Revenue + Cashflow
 *
 * Actionable rule: every tile and row deep-links to the specific thing,
 * not to a filtered dashboard.
 */

interface PriorityRow {
  id: string | number;
  title: string;
  status?: string | null;
  severity?: string | null;
  /**
   * Owner shape from /api/priorities is an object ({ id, name } | null),
   * not a plain string. We accept both for tolerance.
   */
  owner?: { id: number; name: string } | string | null;
  ownerName?: string | null;
  assignedUser?: { id: number; name: string } | null;
  nextCheckpoint?: string | null;
}

function ownerLabel(p: PriorityRow): string {
  if (!p) return "Unassigned";
  if (typeof p.owner === "string") return p.owner || "Unassigned";
  if (p.owner && typeof p.owner === "object" && "name" in p.owner) {
    return p.owner.name || "Unassigned";
  }
  if (p.ownerName) return p.ownerName;
  if (p.assignedUser?.name) return p.assignedUser.name;
  return "Unassigned";
}

interface ExecDashboardPayload {
  kpis?: {
    plannedRevenueFy?: number;
    receivedInflowFy?: number;
    openInflowFy?: number;
    openExpenditureFy?: number;
    grossProfitFy?: number;
    grossMarginPctFy?: number | null;
    plannedExpenditureFy?: number;
    projectsRed?: number;
    projectsAmber?: number;
    projectsGreen?: number;
    activeDashboardProjects?: number;
    pendingApprovals?: number;
    projectsBehindPlan?: number;
  };
  financialYear?: { start?: string; end?: string };
}

export default function CooHome() {
  const { data: gatesData, isLoading, error } = useGatesPipeline();
  const { data: handoversData } = useGatesHandovers();
  const prioritiesQuery = useQuery<{ priorities: PriorityRow[] } | PriorityRow[]>({
    queryKey: ["/api/priorities"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60_000,
  });
  const execQuery = useQuery<ExecDashboardPayload>({
    queryKey: ["/api/lifecycle-board/execution-dashboard"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60_000,
  });

  const projects = gatesData?.projects ?? [];
  const redProjects = useMemo(() => projects.filter((p) => (p.ragStatus || "").toLowerCase() === "red").slice(0, 6), [projects]);
  const amberProjects = useMemo(() => projects.filter((p) => (p.ragStatus || "").toLowerCase() === "amber").slice(0, 6), [projects]);
  const blockedProjects = useMemo(() => projects.filter((p) => (p.gateStatus || "").toUpperCase() === "BLOCKED").slice(0, 6), [projects]);
  const upcomingHandovers = useMemo(() => (handoversData?.projects ?? []).slice(0, 5), [handoversData]);

  const priorities: PriorityRow[] = useMemo(() => {
    const raw = prioritiesQuery.data;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.slice(0, 5);
    if (Array.isArray((raw as { priorities?: PriorityRow[] }).priorities)) {
      return (raw as { priorities: PriorityRow[] }).priorities.slice(0, 5);
    }
    return [];
  }, [prioritiesQuery.data]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load COO home" />;

  return (
    <PageLayout
      data-testid="coo-home-page"
      header={
        <PageHeader
          title="COO Dashboard"
          subtitle="What's waiting, what's red, what's blocked, and what's coming up."
        />
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Left + middle: operational stack */}
        <div className="xl:col-span-3 space-y-4">
          {/* Top row: approvals + priorities */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ManagedDocumentApprovalQueue title="Document approvals waiting on you" />
            <PrioritiesCard rows={priorities} loading={prioritiesQuery.isLoading} />
          </div>

          {/* Documents readiness across the portfolio (D6) */}
          <PortfolioReadinessTile />

          {/* Finance KPI strip — revenue, CoS, outstanding, margin */}
          <FinanceKpiStrip kpis={execQuery.data?.kpis} loading={execQuery.isLoading} />

          {/* Red + blocked + amber rows */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ProjectList
              title="Red projects"
              icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
              badgeClass="bg-red-100 text-red-700"
              projects={redProjects}
              emptyLabel="No red projects"
            />
            <ProjectList
              title="Blocked gates"
              icon={<ShieldAlert className="h-4 w-4 text-orange-600" />}
              badgeClass="bg-orange-100 text-orange-700"
              projects={blockedProjects}
              emptyLabel="No blocked gates"
            />
            <ProjectList
              title="Amber projects"
              icon={<Clock className="h-4 w-4 text-amber-600" />}
              badgeClass="bg-amber-100 text-amber-700"
              projects={amberProjects}
              emptyLabel="No amber projects"
            />
          </div>

          {/* Cross-lens drill-downs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <DrillTile to="/engineering" label="Engineering" icon={<Wrench className="h-4 w-4" />} />
            <DrillTile to="/quality" label="Quality" icon={<ShieldCheck className="h-4 w-4" />} />
            <DrillTile to="/hse" label="HSE" icon={<ShieldAlert className="h-4 w-4" />} />
            <DrillTile to="/cashflow" label="Cashflow" icon={<DollarSign className="h-4 w-4" />} />
            <DrillTile to="/revenue-tracker" label="Revenue" icon={<TrendingUp className="h-4 w-4" />} />
            <DrillTile to="/cos" label="CoS" icon={<Zap className="h-4 w-4" />} />
          </div>

          {/* Upcoming handovers */}
          <UpcomingHandoversCard rows={upcomingHandovers} />
        </div>

        {/* Right: financial pulse column */}
        <div className="xl:col-span-1">
          <FinancialPulseColumn />
        </div>
      </div>
    </PageLayout>
  );
}

const formatZAR = (n: number | null | undefined): string => formatZarCompact(n);

function FinanceKpiStrip({ kpis, loading }: { kpis: ExecDashboardPayload["kpis"] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <Card data-testid="finance-kpi-strip">
        <CardContent className="p-3 text-xs text-muted-foreground">Loading finance KPIs…</CardContent>
      </Card>
    );
  }
  if (!kpis) {
    return null;
  }
  const revenuePct = kpis.plannedRevenueFy && kpis.plannedRevenueFy > 0
    ? Math.round(((kpis.receivedInflowFy ?? 0) / kpis.plannedRevenueFy) * 100)
    : null;
  return (
    <Card data-testid="finance-kpi-strip">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          Finance pulse (FY)
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiTile
            label="Revenue realised"
            primary={formatZAR(kpis.receivedInflowFy)}
            sub={`of ${formatZAR(kpis.plannedRevenueFy)} planned${revenuePct != null ? ` · ${revenuePct}%` : ""}`}
            to="/revenue-tracker"
          />
          <KpiTile
            label="Revenue outstanding"
            primary={formatZAR(kpis.openInflowFy)}
            tone="amber"
            to="/revenue-tracker"
          />
          <KpiTile
            label="Expense outstanding"
            primary={formatZAR(kpis.openExpenditureFy)}
            tone="amber"
            to="/cos"
          />
          <KpiTile
            label="Gross profit (planned)"
            primary={formatZAR(kpis.grossProfitFy)}
            sub={kpis.grossMarginPctFy != null ? `Margin ${kpis.grossMarginPctFy}%` : undefined}
            to="/finance/gp/company"
          />
          <KpiTile
            label="Cashflow 30-day"
            primary="View"
            sub="Projected position"
            to="/cashflow"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function KpiTile({ label, primary, sub, tone, to }: {
  label: string;
  primary: string;
  sub?: string;
  tone?: "amber" | "red";
  to: string;
}) {
  const toneClass = tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "";
  return (
    <Link
      href={to}
      className="block rounded-md border bg-card p-2.5 hover:bg-[hsl(var(--surface-tint))] hover:border-primary/30 transition-colors"
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold tabular-nums mt-0.5 ${toneClass}`}>{primary}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </Link>
  );
}

function PrioritiesCard({ rows, loading }: { rows: PriorityRow[]; loading: boolean }) {
  return (
    <Card data-testid="priorities-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flag className="h-4 w-4 text-primary" />
          Company priorities
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <p className="text-xs text-muted-foreground py-4">Loading priorities…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No active priorities.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((p) => (
              <li key={p.id} className="py-2">
                <Link
                  href={`/priority/${p.id}`}
                  className="flex items-start justify-between gap-2 hover:bg-[hsl(var(--surface-tint))] -mx-2 px-2 py-1 rounded transition-colors"
                  data-testid={`priority-row-${p.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {ownerLabel(p)}
                      {p.nextCheckpoint ? ` · next: ${p.nextCheckpoint}` : ""}
                    </p>
                  </div>
                  {p.severity && (
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {p.severity}
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface ProjectRowShape {
  projectId: number;
  projectName: string;
  clientName: string | null;
  pm: string | null;
  daysInStage: number;
  nextRequiredAction?: string | null;
  waitingOnDepartment?: string | null;
  gateReadinessPct?: number | null;
}

function ProjectList({
  title, icon, badgeClass, projects, emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  badgeClass: string;
  projects: ProjectRowShape[];
  emptyLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
          <Badge className={`text-[10px] ${badgeClass}`}>{projects.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">{emptyLabel}</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {projects.map((p) => (
              <li key={p.projectId} className="py-2" data-testid={`project-row-${p.projectId}`}>
                <Link
                  href={`/project/${encodeURIComponent(p.projectName)}`}
                  className="block hover:bg-[hsl(var(--surface-tint))] -mx-2 px-2 py-1 rounded transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.projectName}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {p.clientName || "—"} {p.pm ? `· ${p.pm}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {p.gateReadinessPct != null && (
                        <Badge variant="outline" className="text-[10px] tabular-nums">
                          {p.gateReadinessPct}%
                        </Badge>
                      )}
                      {p.daysInStage != null && (
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {p.daysInStage}d
                        </span>
                      )}
                    </div>
                  </div>
                  {(p.nextRequiredAction || p.waitingOnDepartment) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {p.nextRequiredAction && <>Next: <span className="text-foreground">{p.nextRequiredAction}</span></>}
                      {p.nextRequiredAction && p.waitingOnDepartment && " · "}
                      {p.waitingOnDepartment && <>Waiting on <span className="text-foreground">{p.waitingOnDepartment}</span></>}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DrillTile({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={to}
      className="flex items-center justify-between p-3 rounded-md border bg-card hover:bg-[hsl(var(--surface-tint))] hover:border-primary/30 transition-colors"
      data-testid={`drill-tile-${label.toLowerCase()}`}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </span>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

function UpcomingHandoversCard({ rows }: { rows: any[] }) {
  return (
    <Card data-testid="coo-upcoming-handovers">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Upcoming handovers this week
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No handovers scheduled.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((r, i) => (
              <li key={r.projectId ?? i} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/project/${encodeURIComponent(r.projectName)}`}
                    className="flex-1 min-w-0 hover:bg-[hsl(var(--surface-tint))] -mx-2 px-2 py-1 rounded transition-colors"
                  >
                    <p className="text-sm font-medium truncate">{r.projectName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {r.clientName || ""} {r.pm ? `· PM: ${r.pm}` : ""}
                    </p>
                  </Link>
                  {r.gateReadinessPct != null && (
                    <Badge variant="outline" className="text-[10px] tabular-nums shrink-0">
                      {r.gateReadinessPct}% ready
                    </Badge>
                  )}
                  {r.projectId && (
                    <Link
                      href={`/handover/${r.projectId}/live`}
                      className="text-[11px] text-primary underline hover:no-underline shrink-0"
                      data-testid={`coo-live-room-${r.projectId}`}
                    >
                      Live room →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FinancialPulseColumn() {
  return (
    <Card data-testid="financial-pulse-column" className="sticky top-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Financial pulse
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <PulseLink to="/cos" label="CoS realisation" icon={<Zap className="h-3.5 w-3.5" />} sub="Planned vs actual" />
        <PulseLink to="/revenue-tracker" label="Revenue" icon={<TrendingUp className="h-3.5 w-3.5" />} sub="Forecast vs received" />
        <PulseLink to="/cashflow" label="Cashflow 30-day" icon={<DollarSign className="h-3.5 w-3.5" />} sub="Projected position" />
        <PulseLink to="/finance/gp/company" label="Margin pulse" icon={<AlertCircle className="h-3.5 w-3.5" />} sub="Top deteriorating" />
      </CardContent>
    </Card>
  );
}

function PulseLink({ to, label, icon, sub }: { to: string; label: string; icon: React.ReactNode; sub: string }) {
  return (
    <Link
      href={to}
      className="block rounded-md border bg-card p-2.5 hover:bg-[hsl(var(--surface-tint))] hover:border-primary/30 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
    </Link>
  );
}

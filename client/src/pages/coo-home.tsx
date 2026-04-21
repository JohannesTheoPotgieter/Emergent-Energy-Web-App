import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useGatesPipeline, useGatesHandovers } from "@/hooks/use-gates";
import { ApprovalQueueCard } from "@/components/controlled-documents";
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
  owner?: string | null;
  nextCheckpoint?: string | null;
}

export default function CooHome() {
  const { data: gatesData, isLoading, error } = useGatesPipeline();
  const { data: handoversData } = useGatesHandovers();
  const prioritiesQuery = useQuery<{ priorities: PriorityRow[] } | PriorityRow[]>({
    queryKey: ["/api/priorities"],
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
            <ApprovalQueueCard />
            <PrioritiesCard rows={priorities} loading={prioritiesQuery.isLoading} />
          </div>

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
                      {p.owner ? `${p.owner}` : "Unassigned"}
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

function ProjectList({
  title, icon, badgeClass, projects, emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  badgeClass: string;
  projects: { projectId: number; projectName: string; clientName: string | null; pm: string | null; daysInStage: number }[];
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
              <li key={p.projectId} className="py-2">
                <Link
                  href={`/project/${encodeURIComponent(p.projectName)}`}
                  className="flex items-center justify-between gap-2 hover:bg-[hsl(var(--surface-tint))] -mx-2 px-2 py-1 rounded transition-colors"
                  data-testid={`project-row-${p.projectId}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.projectName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {p.clientName || "—"} {p.pm ? `· ${p.pm}` : ""}
                    </p>
                  </div>
                  {p.daysInStage != null && (
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {p.daysInStage}d
                    </span>
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
                <Link
                  href={`/project/${encodeURIComponent(r.projectName)}`}
                  className="flex items-center justify-between gap-2 hover:bg-[hsl(var(--surface-tint))] -mx-2 px-2 py-1 rounded transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.projectName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {r.clientName || ""} {r.pm ? `· PM: ${r.pm}` : ""}
                    </p>
                  </div>
                  {r.gateReadinessPct != null && (
                    <Badge variant="outline" className="text-[10px] tabular-nums shrink-0">
                      {r.gateReadinessPct}% ready
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
        <PulseLink to="/execution-board/finance" label="Margin pulse" icon={<AlertCircle className="h-3.5 w-3.5" />} sub="Top deteriorating" />
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

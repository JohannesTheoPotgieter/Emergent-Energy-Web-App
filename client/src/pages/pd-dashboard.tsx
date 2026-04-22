import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Activity,
  DollarSign,
  Target,
  Trophy,
  Users as UsersIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";

type PdDashboard = {
  generatedAt: string;
  summary: {
    activeCount: number;
    wonCount: number;
    lostCount: number;
    pipelineValue: number;
    weightedValue: number;
    wonValue: number;
    pipelineKwp: number;
    avgProbability: number | null;
    winRate: number | null;
  };
  byStage: Array<{ stage: string; count: number; value: number; weighted: number }>;
  byPhase: Array<{ phase: string; count: number; value: number; weighted: number; stages: string[] }>;
  atRisk: { staleActivity: number; veryStale: number; highValueNoRecent: number; overdueFollowups: number };
  recentWins: Array<{ id: number; dealName: string | null; value: number | null; owner: string | null; signedDate: string | null }>;
  recentLost: Array<{ id: number; dealName: string | null; value: number | null; owner: string | null; reason: string | null; lostTime: string | null }>;
  upcomingActivity: Array<{ id: number; dealName: string | null; owner: string | null; date: string | null; subject: string | null; value: number | null }>;
  conversion: { prospect: number; qualification: number; proposal: number; negotiation: number; won: number; lost: number };
};

const STAGE_LABELS: Record<string, string> = {
  prospect: "Prospect",
  qualification: "Qualification",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  unknown: "Unstaged",
};

function formatZAR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R ${(n / 1_000).toFixed(0)}k`;
  return `R ${n.toFixed(0)}`;
}

function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return "—";
  }
}

function relativeDays(dateStr: string | null | undefined): { label: string; tone: "ok" | "warn" | "bad" } {
  if (!dateStr) return { label: "—", tone: "ok" };
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.round((d.getTime() - now.setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, tone: "bad" };
  if (diff === 0) return { label: "Today", tone: "warn" };
  if (diff <= 3) return { label: `In ${diff}d`, tone: "warn" };
  return { label: `In ${diff}d`, tone: "ok" };
}

function KpiCard({
  label,
  value,
  subValue,
  icon: Icon,
  tone = "default",
  testId,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "emerald" | "amber" | "rose";
  testId: string;
}) {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    rose: "text-rose-700",
  }[tone];
  const iconBg = {
    default: "bg-muted",
    emerald: "bg-emerald-50",
    amber: "bg-amber-50",
    rose: "bg-rose-50",
  }[tone];
  return (
    <Card data-testid={testId} className="border-border/60">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
            {subValue && <p className="mt-0.5 text-xs text-muted-foreground">{subValue}</p>}
          </div>
          <div className={`shrink-0 rounded-lg p-2 ${iconBg}`}>
            <Icon className={`h-5 w-5 ${toneClass}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StageBar({ stage, count, value, weighted, maxValue }: { stage: string; count: number; value: number; weighted: number; maxValue: number }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="space-y-1.5" data-testid={`stage-row-${stage}`}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{STAGE_LABELS[stage] ?? stage}</span>
          <Badge variant="outline" className="text-[10px]">{count} deals</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Wtd {formatZAR(weighted)}</span>
          <span className="font-medium text-foreground">{formatZAR(value)}</span>
        </div>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

function PhaseBar({ phase, count, value, weighted, stages, maxValue }: { phase: string; count: number; value: number; weighted: number; stages: string[]; maxValue: number }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="space-y-1.5" data-testid={`phase-row-${phase}`}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-emerald-800">{phase}</span>
          <Badge variant="outline" className="text-[10px]">{count} deals</Badge>
          {stages.length > 0 && (
            <span className="text-[10px] lowercase text-slate-500" title="Pipedrive stages rolled up into this phase">
              {stages.map((s) => s.toLowerCase()).join(" · ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Wtd {formatZAR(weighted)}</span>
          <span className="font-medium text-foreground">{formatZAR(value)}</span>
        </div>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

export default function PdDashboardPage() {
  const { data, isLoading, error } = useQuery<PdDashboard>({
    queryKey: ["/api/pd/dashboard"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6" data-testid="pd-dashboard-loading">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6" data-testid="pd-dashboard-error">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-rose-700">Failed to load Project Development dashboard.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { summary, byStage, byPhase, atRisk, recentWins, recentLost, upcomingActivity, conversion } = data;
  const maxStageValue = Math.max(...byStage.map((s) => s.value), 1);
  const phaseBuckets = byPhase ?? [];
  const maxPhaseValue = Math.max(...phaseBuckets.map((p) => p.value), 1);
  const totalActive = summary.activeCount;
  const stagePercents = {
    prospect: totalActive > 0 ? (conversion.prospect / totalActive) * 100 : 0,
    qualification: totalActive > 0 ? (conversion.qualification / totalActive) * 100 : 0,
    proposal: totalActive > 0 ? (conversion.proposal / totalActive) * 100 : 0,
    negotiation: totalActive > 0 ? (conversion.negotiation / totalActive) * 100 : 0,
  };

  return (
    <PageLayout
      data-testid="pd-dashboard"
      header={
        <PageHeader
          title="Project Development"
          subtitle="Pipeline health, deal activity, and conversion across all opportunities"
          actions={
            <Link href="/opportunities">
              <Button variant="outline" size="sm" className="gap-2" data-testid="link-working-list">
                Open working list
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
          }
        />
      }
    >
      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Active Pipeline"
          value={formatZAR(summary.pipelineValue)}
          subValue={`${summary.activeCount} active deals · ${summary.pipelineKwp.toFixed(0)} kWp`}
          icon={DollarSign}
          tone="emerald"
          testId="kpi-pipeline-value"
        />
        <KpiCard
          label="Weighted Pipeline"
          value={formatZAR(summary.weightedValue)}
          subValue={summary.avgProbability != null ? `Avg ${(summary.avgProbability).toFixed(0)}% probability` : "Probability not set"}
          icon={Target}
          testId="kpi-weighted-value"
        />
        <KpiCard
          label="Win Rate"
          value={formatPct(summary.winRate)}
          subValue={`${summary.wonCount} won · ${summary.lostCount} lost`}
          icon={Trophy}
          tone="emerald"
          testId="kpi-win-rate"
        />
        <KpiCard
          label="At-Risk Deals"
          value={String(atRisk.staleActivity + atRisk.overdueFollowups)}
          subValue={`${atRisk.overdueFollowups} overdue follow-ups · ${atRisk.veryStale} >60d stale`}
          icon={AlertTriangle}
          tone={atRisk.staleActivity + atRisk.overdueFollowups > 0 ? "amber" : "default"}
          testId="kpi-at-risk"
        />
      </div>

      {/* Pipeline by stage + Conversion funnel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="card-pipeline-by-phase">
          <CardHeader>
            <CardTitle className="text-base">Pipeline by Lifecycle Phase</CardTitle>
            <p className="text-xs text-muted-foreground">Active opportunities grouped by the company's 10-stage lifecycle. Pipedrive stages roll up under each phase.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {phaseBuckets.length === 0 ? (
              byStage.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active opportunities.</p>
              ) : (
                byStage.map((s) => (
                  <StageBar key={s.stage} stage={s.stage} count={s.count} value={s.value} weighted={s.weighted} maxValue={maxStageValue} />
                ))
              )
            ) : (
              phaseBuckets.map((p) => (
                <PhaseBar key={p.phase} phase={p.phase} count={p.count} value={p.value} weighted={p.weighted} stages={p.stages} maxValue={maxPhaseValue} />
              ))
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-conversion">
          <CardHeader>
            <CardTitle className="text-base">Active Funnel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { key: "prospect", label: "Prospect", count: conversion.prospect, pct: stagePercents.prospect },
              { key: "qualification", label: "Qualification", count: conversion.qualification, pct: stagePercents.qualification },
              { key: "proposal", label: "Proposal", count: conversion.proposal, pct: stagePercents.proposal },
              { key: "negotiation", label: "Negotiation", count: conversion.negotiation, pct: stagePercents.negotiation },
            ].map((row) => (
              <div key={row.key} data-testid={`funnel-row-${row.key}`}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">{row.label}</span>
                  <span className="text-muted-foreground">{row.count}</span>
                </div>
                <Progress value={row.pct} className="h-1.5" />
              </div>
            ))}
            <div className="mt-4 grid grid-cols-2 gap-2 border-t pt-3">
              <div className="rounded-md bg-emerald-50 p-2">
                <p className="text-[10px] uppercase tracking-wide text-emerald-700">Won</p>
                <p className="text-lg font-semibold text-emerald-700">{conversion.won}</p>
              </div>
              <div className="rounded-md bg-rose-50 p-2">
                <p className="text-[10px] uppercase tracking-wide text-rose-700">Lost</p>
                <p className="text-lg font-semibold text-rose-700">{conversion.lost}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity + Recent wins/lost */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1" data-testid="card-upcoming-activity">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              Upcoming Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scheduled activity in the next 14 days.</p>
            ) : (
              <ul className="space-y-3">
                {upcomingActivity.map((a) => {
                  const rel = relativeDays(a.date);
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-2 text-sm" data-testid={`activity-${a.id}`}>
                      <div className="min-w-0 flex-1">
                        <Link href={`/opportunities?open=${a.id}`}>
                          <span className="cursor-pointer font-medium text-foreground hover:text-emerald-700">
                            {a.dealName || `Deal #${a.id}`}
                          </span>
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">{a.subject || "—"}</p>
                        {a.owner && <p className="text-[10px] text-muted-foreground">{a.owner}</p>}
                      </div>
                      <Badge
                        variant={rel.tone === "bad" ? "destructive" : "outline"}
                        className={`shrink-0 text-[10px] ${rel.tone === "warn" ? "border-amber-300 text-amber-800" : ""}`}
                      >
                        {rel.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-recent-wins">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              Recent Wins
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentWins.length === 0 ? (
              <p className="text-sm text-muted-foreground">No wins recorded.</p>
            ) : (
              <ul className="space-y-3">
                {recentWins.map((w) => (
                  <li key={w.id} className="flex items-start justify-between gap-2 text-sm" data-testid={`win-${w.id}`}>
                    <div className="min-w-0 flex-1">
                      <Link href={`/opportunities?open=${w.id}`}>
                        <span className="cursor-pointer font-medium text-foreground hover:text-emerald-700">
                          {w.dealName || `Deal #${w.id}`}
                        </span>
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {w.owner ? `${w.owner} · ` : ""}{formatDate(w.signedDate)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-emerald-700">{formatZAR(w.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-recent-lost">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <XCircle className="h-4 w-4 text-rose-700" />
              Recent Losses
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentLost.length === 0 ? (
              <p className="text-sm text-muted-foreground">No losses recorded.</p>
            ) : (
              <ul className="space-y-3">
                {recentLost.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-2 text-sm" data-testid={`loss-${l.id}`}>
                    <div className="min-w-0 flex-1">
                      <Link href={`/opportunities?open=${l.id}`}>
                        <span className="cursor-pointer font-medium text-foreground hover:text-emerald-700">
                          {l.dealName || `Deal #${l.id}`}
                        </span>
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{l.reason || "Reason not recorded"}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDate(l.lostTime)}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-muted-foreground">{formatZAR(l.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Risk row */}
      <Card data-testid="card-at-risk-detail">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Risk Signals
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Link
              href="/opportunities?filter=stale-30"
              className="rounded-md -m-2 p-2 transition-colors hover:bg-[hsl(var(--surface-tint))]"
              data-testid="risk-stale"
            >
              <p className="text-xs text-muted-foreground">Stale &gt; 30d</p>
              <p className="mt-1 text-xl font-semibold text-amber-700">{atRisk.staleActivity}</p>
              <p className="text-[10px] text-primary mt-0.5">View deals →</p>
            </Link>
            <Link
              href="/opportunities?filter=stale-60"
              className="rounded-md -m-2 p-2 transition-colors hover:bg-[hsl(var(--surface-tint))]"
              data-testid="risk-very-stale"
            >
              <p className="text-xs text-muted-foreground">Stale &gt; 60d</p>
              <p className="mt-1 text-xl font-semibold text-rose-700">{atRisk.veryStale}</p>
              <p className="text-[10px] text-primary mt-0.5">View deals →</p>
            </Link>
            <Link
              href="/opportunities?filter=high-value-quiet"
              className="rounded-md -m-2 p-2 transition-colors hover:bg-[hsl(var(--surface-tint))]"
              data-testid="risk-high-value"
            >
              <p className="text-xs text-muted-foreground">High-value &gt; 14d quiet</p>
              <p className="mt-1 text-xl font-semibold text-amber-700">{atRisk.highValueNoRecent}</p>
              <p className="text-[10px] text-primary mt-0.5">View deals →</p>
            </Link>
            <Link
              href="/opportunities?filter=overdue-followups"
              className="rounded-md -m-2 p-2 transition-colors hover:bg-[hsl(var(--surface-tint))]"
              data-testid="risk-overdue"
            >
              <p className="text-xs text-muted-foreground">Overdue follow-ups</p>
              <p className="mt-1 text-xl font-semibold text-rose-700">{atRisk.overdueFollowups}</p>
              <p className="text-[10px] text-primary mt-0.5">View deals →</p>
            </Link>
          </div>
        </CardContent>
      </Card>

      <MeetingViewSection />

      <p className="text-[10px] text-muted-foreground" data-testid="generated-at">
        Snapshot generated {new Date(data.generatedAt).toLocaleString()}
      </p>
    </PageLayout>
  );
}

type WorkspaceRollupResponse = {
  generatedAt: string;
  asOf?: string;
  totals: {
    opportunities?: number;
    linkedProjects?: number;
    linkedWorkItems?: number;
    projects: number;
    spineGap: number;
    cascadeAnomalies: number;
    openPdTickets: number;
    overduePdTickets: number;
    openWorkItems: number;
    blockedWorkItems: number;
    overdueWorkItems: number;
    openRaid: number;
    ticketsDueThisWeek?: number;
    tasksDueThisWeek?: number;
    projectsWithoutTickets?: number;
    ticketsWithoutValidLinkage?: number;
    workItemsWithInvalidLinkage?: number;
  };
  lists?: {
    projectsWithoutTickets: Array<{ id: number; projectName: string }>;
    ticketsWithoutValidLinkage: Array<{ id: number; projectSiteName: string; projectId: number | null; opportunityId: number | null }>;
    workItemsWithInvalidLinkage: Array<{ id: number; title: string; projectId: number | null }>;
    ticketsDueThisWeek: Array<{ id: number; projectSiteName: string; dueDate: string | null; projectId: number | null }>;
    tasksDueThisWeek: Array<{ id: number; title: string; endDate: string | null; projectId: number | null }>;
  };
  rows: Array<{
    projectId: number;
    projectName: string;
    phase: string | null;
    opportunityStage: string | null;
    pdTickets: { total: number; open: number; completed: number; overdue: number; oldestOpenAt: string | null };
    workItems: { total: number; open: number; completed: number; blocked: number; overdue: number };
    raid: { open: number };
    ragStatus: string | null;
    spineGap: boolean;
    lastActivityAt: string | null;
  }>;
};

function MeetingViewSection() {
  const { data, isLoading, error } = useQuery<WorkspaceRollupResponse>({
    queryKey: ["/api/project-development/workspace/rollup"],
  });

  if (isLoading) {
    return (
      <Card data-testid="meeting-view-loading">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><UsersIcon className="h-4 w-4" /> Meeting view</CardTitle>
          <p className="text-xs text-muted-foreground">Org-wide PD workspace rollup across all active projects.</p>
        </CardHeader>
        <CardContent><Skeleton className="h-48" /></CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card data-testid="meeting-view-error">
        <CardContent className="p-6">
          <p className="text-sm text-rose-700">Failed to load Meeting view rollup.</p>
        </CardContent>
      </Card>
    );
  }

  const sortedRows = [...data.rows].sort((a, b) => {
    const aSpan = a.workItems.overdue + a.pdTickets.overdue + (a.spineGap ? 100 : 0);
    const bSpan = b.workItems.overdue + b.pdTickets.overdue + (b.spineGap ? 100 : 0);
    return bSpan - aSpan;
  });

  return (
    <Card data-testid="meeting-view">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><UsersIcon className="h-4 w-4" /> Meeting view</CardTitle>
        <p className="text-xs text-muted-foreground">
          Org-wide PD workspace rollup across {data.totals.projects} active projects.
          Generated {new Date(data.generatedAt).toLocaleString()}.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
          <div data-testid="rollup-total-open-pd-tickets" className="rounded-md bg-muted/40 p-2">
            <p className="text-muted-foreground">Open PD tickets</p>
            <p className="text-lg font-semibold">{data.totals.openPdTickets}</p>
            <p className="text-[10px] text-amber-700">{data.totals.overduePdTickets} overdue</p>
          </div>
          <div data-testid="rollup-total-work-items" className="rounded-md bg-muted/40 p-2">
            <p className="text-muted-foreground">Open work items</p>
            <p className="text-lg font-semibold">{data.totals.openWorkItems}</p>
            <p className="text-[10px] text-amber-700">{data.totals.overdueWorkItems} overdue · {data.totals.blockedWorkItems} blocked</p>
          </div>
          <div data-testid="rollup-total-raid" className="rounded-md bg-muted/40 p-2">
            <p className="text-muted-foreground">Open RAID</p>
            <p className="text-lg font-semibold">{data.totals.openRaid}</p>
          </div>
          <div data-testid="rollup-spine-gap" className={`rounded-md p-2 ${data.totals.spineGap > 0 ? "bg-rose-50" : "bg-muted/40"}`}>
            <p className="text-muted-foreground">Spine gaps</p>
            <p className={`text-lg font-semibold ${data.totals.spineGap > 0 ? "text-rose-700" : ""}`}>{data.totals.spineGap}</p>
            <p className="text-[10px] text-muted-foreground">work_items but no PD ticket</p>
            <Link
              href="/admin/work-item-linkage"
              className="text-[10px] text-emerald-700 underline hover:no-underline"
              data-testid="link-spine-gap-repair"
            >
              Open linkage repair →
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="meeting-view-table">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Project</th>
                <th className="py-2 pr-3">Phase</th>
                <th className="py-2 pr-3 text-right">PD tickets</th>
                <th className="py-2 pr-3 text-right">Work items</th>
                <th className="py-2 pr-3 text-right">RAID</th>
                <th className="py-2 pr-3">Flags</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.projectId} className="border-b hover:bg-muted/30" data-testid={`row-project-${r.projectId}`}>
                  <td className="py-2 pr-3 font-medium">{r.projectName || `#${r.projectId}`}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.phase || "—"}</td>
                  <td className="py-2 pr-3 text-right">
                    <span data-testid={`text-pd-open-${r.projectId}`}>{r.pdTickets.open}</span>
                    {r.pdTickets.overdue > 0 && (
                      <span className="ml-1 text-amber-700" data-testid={`text-pd-overdue-${r.projectId}`}>({r.pdTickets.overdue} od)</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <span data-testid={`text-wi-open-${r.projectId}`}>{r.workItems.open}</span>
                    {r.workItems.overdue > 0 && (
                      <span className="ml-1 text-amber-700">({r.workItems.overdue} od)</span>
                    )}
                    {r.workItems.blocked > 0 && (
                      <span className="ml-1 text-rose-700">({r.workItems.blocked} blk)</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{r.raid.open}</td>
                  <td className="py-2 pr-3">
                    {r.spineGap && (
                      <Badge variant="destructive" className="text-[10px]" data-testid={`badge-spine-gap-${r.projectId}`}>spine gap</Badge>
                    )}
                    {r.ragStatus && (
                      <Badge variant="outline" className="text-[10px] ml-1">{r.ragStatus}</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {sortedRows.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No active projects.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data.lists && (
          <div className="mt-6 space-y-3">
            <RiskList
              testId="risk-projects-without-tickets"
              title="Projects without PD tickets"
              count={data.lists.projectsWithoutTickets.length}
              items={data.lists.projectsWithoutTickets.map((p) => ({ id: p.id, label: p.projectName || `#${p.id}` }))}
            />
            <RiskList
              testId="risk-tickets-invalid-linkage"
              title="PD tickets with invalid linkage"
              count={data.lists.ticketsWithoutValidLinkage.length}
              items={data.lists.ticketsWithoutValidLinkage.map((t) => ({
                id: t.id,
                label: `${t.projectSiteName || `Ticket #${t.id}`} — project=${t.projectId ?? "—"}, opp=${t.opportunityId ?? "—"}`,
              }))}
            />
            <RiskList
              testId="risk-work-items-invalid-linkage"
              title="Work items with invalid linkage"
              count={data.lists.workItemsWithInvalidLinkage.length}
              items={data.lists.workItemsWithInvalidLinkage.map((w) => ({ id: w.id, label: w.title || `Work item #${w.id}` }))}
            />
            <RiskList
              testId="risk-tickets-due-this-week"
              title="PD tickets due this week"
              count={data.lists.ticketsDueThisWeek.length}
              items={data.lists.ticketsDueThisWeek.map((t) => ({
                id: t.id,
                label: `${t.projectSiteName || `Ticket #${t.id}`}${t.dueDate ? ` (due ${t.dueDate})` : ""}`,
              }))}
            />
            <RiskList
              testId="risk-tasks-due-this-week"
              title="Work items due this week"
              count={data.lists.tasksDueThisWeek.length}
              items={data.lists.tasksDueThisWeek.map((w) => ({
                id: w.id,
                label: `${w.title || `Work item #${w.id}`}${w.endDate ? ` (due ${w.endDate})` : ""}`,
              }))}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RiskList({ testId, title, count, items }: { testId: string; title: string; count: number; items: Array<{ id: number; label: string }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-md" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/40"
        data-testid={`${testId}-toggle`}
      >
        <span>{title}</span>
        <span className={`px-2 py-0.5 rounded ${count > 0 ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`} data-testid={`${testId}-count`}>
          {count}
        </span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 text-xs" data-testid={`${testId}-body`}>
          {items.length === 0 ? (
            <p className="text-muted-foreground" data-testid={`${testId}-empty`}>None.</p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {items.map((it) => (
                <li key={it.id} data-testid={`${testId}-item-${it.id}`} className="text-muted-foreground">{it.label}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

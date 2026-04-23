import { useState, useMemo } from "react";
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
  Handshake,
  Link2Off,
  ListChecks,
  Users as UsersIcon,
  Briefcase,
  Hourglass,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";

type ActionReason = "overdue_followup" | "very_stale" | "high_value_quiet" | "stale_30d" | "";

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
  // Operational additions
  eligibleActiveCount: number;
  blockedDependencyCount: number;
  byOwner: Array<{ owner: string; active: number; overdue: number; stale30: number; dueThisWeek: number; pipelineValue: number; handoverReady: number }>;
  handoverReady: { total: number; items: Array<{ id: number; dealName: string | null; owner: string | null; value: number | null; signedDate: string | null; handoverReadiness: string | null }> };
  linkageGaps: { total: number; items: Array<{ id: number; dealName: string | null; owner: string | null; value: number | null; signedDate: string | null }> };
  actionQueue: Array<{ id: number; dealName: string | null; owner: string | null; value: number | null; nextActivityDate: string | null; lastActivityDate: string | null; reason: ActionReason }>;
};

const REASON_LABEL: Record<ActionReason, { label: string; tone: "rose" | "amber" | "slate" }> = {
  overdue_followup: { label: "Overdue follow-up", tone: "rose" },
  very_stale: { label: "Very stale (>60d)", tone: "rose" },
  high_value_quiet: { label: "High-value quiet", tone: "amber" },
  stale_30d: { label: "Stale >30d", tone: "amber" },
  "": { label: "—", tone: "slate" },
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

function ageInDays(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 86_400_000);
}

function ExceptionTile({
  label,
  count,
  sub,
  href,
  icon: Icon,
  tone = "default",
  testId,
}: {
  label: string;
  count: number;
  sub: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "emerald" | "amber" | "rose" | "slate";
  testId: string;
}) {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    rose: "text-rose-700",
    slate: "text-slate-700",
  }[tone];
  const iconBg = {
    default: "bg-muted",
    emerald: "bg-emerald-50",
    amber: "bg-amber-50",
    rose: "bg-rose-50",
    slate: "bg-slate-50",
  }[tone];

  const inner = (
    <Card data-testid={testId} className={`border-border/60 ${href ? "transition-colors hover:border-emerald-300 hover:bg-[hsl(var(--surface-tint))] cursor-pointer" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{count}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{sub}</p>
          </div>
          <div className={`shrink-0 rounded-lg p-2 ${iconBg}`}>
            <Icon className={`h-4 w-4 ${toneClass}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (!href) return inner;
  // In-page anchors (#cross-company) cannot be routed by wouter's Link — use a
  // plain <a> so the browser scrolls to the section.
  if (href.startsWith("#")) return <a href={href}>{inner}</a>;
  return <Link href={href}>{inner}</Link>;
}

function ReasonChip({ reason }: { reason: ActionReason }) {
  const { label, tone } = REASON_LABEL[reason] ?? REASON_LABEL[""];
  const toneClass = tone === "rose"
    ? "border-rose-300 bg-rose-50 text-rose-700"
    : tone === "amber"
    ? "border-amber-300 bg-amber-50 text-amber-800"
    : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${toneClass}`} data-testid={`reason-${reason}`}>
      {label}
    </span>
  );
}

function PhaseBar({ phase, count, value, weighted, stages, maxValue }: { phase: string; count: number; value: number; weighted: number; stages: string[]; maxValue: number }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="space-y-1.5" data-testid={`phase-row-${phase}`}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-emerald-800 truncate">{phase}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">{count} deals</Badge>
          {stages.length > 0 && (
            <span className="text-[10px] lowercase text-slate-500 truncate" title="Pipedrive stages rolled up into this phase">
              {stages.map((s) => s.toLowerCase()).join(" · ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0">
          <span className="text-muted-foreground">Wtd {formatZAR(weighted)}</span>
          <span className="font-medium text-foreground">{formatZAR(value)}</span>
        </div>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

function DisclosurePanel({
  testId,
  title,
  count,
  tone = "default",
  emptyText = "Nothing here right now.",
  children,
}: {
  testId: string;
  title: string;
  count: number;
  tone?: "default" | "emerald" | "amber" | "rose";
  emptyText?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toneClass = {
    default: "bg-muted text-muted-foreground",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-800",
  }[tone];
  return (
    <div className="rounded-md border border-border/60" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/40"
        data-testid={`${testId}-toggle`}
      >
        <span className="flex items-center gap-2 font-medium">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {title}
        </span>
        <span className={`rounded px-2 py-0.5 text-xs ${toneClass}`} data-testid={`${testId}-count`}>{count}</span>
      </button>
      {open && (
        <div className="border-t border-border/60 p-3 text-sm" data-testid={`${testId}-body`}>
          {count === 0 ? <p className="text-xs text-muted-foreground">{emptyText}</p> : children}
        </div>
      )}
    </div>
  );
}

// Collapsible section wrapper. Each PD-dashboard section can be opened or
// closed by the user as they work through the page; the open/closed state
// for each section is persisted in localStorage so it survives reloads.
type CollapsibleCardProps = {
  id: string;
  testId?: string;
  defaultOpen?: boolean;
  header: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyId?: string;
};

function CollapsibleCard({
  id,
  testId,
  defaultOpen = true,
  header,
  children,
  className,
  bodyId,
}: CollapsibleCardProps) {
  const storageKey = `pd-dashboard:section:${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultOpen;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return defaultOpen;
      return stored === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore quota / privacy mode errors */
      }
      return next;
    });
  };
  const contentId = bodyId ?? `${id}-body`;
  const toggleTestId = testId ? `${testId}-toggle` : `${id}-toggle`;
  return (
    <Card data-testid={testId} className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full text-left rounded-t-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        data-testid={toggleTestId}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">{header}</div>
            <span className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          </div>
        </CardHeader>
      </button>
      {open && <div id={contentId}>{children}</div>}
    </Card>
  );
}

export default function PdDashboardPage() {
  const { data, isLoading, error } = useQuery<PdDashboard>({
    queryKey: ["/api/pd/dashboard"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6" data-testid="pd-dashboard-loading">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
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

  const { summary, byPhase, atRisk, recentWins, recentLost, upcomingActivity, conversion, eligibleActiveCount, blockedDependencyCount, byOwner, handoverReady, linkageGaps, actionQueue } = data;
  const phaseBuckets = byPhase ?? [];
  const maxPhaseValue = Math.max(...phaseBuckets.map((p) => p.value), 1);
  const incompleteEligible = Math.max(summary.activeCount - eligibleActiveCount, 0);

  return (
    <PageLayout
      data-testid="pd-dashboard"
      header={
        <PageHeader
          title="Project Development"
          subtitle="Operational control tower — what PD tickets need action today, and where handover and cross-team flow is breaking down."
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
      {/* 1. TOP STRIP — exception-first, drilldown-only */}
      <section data-testid="section-top-strip" aria-labelledby="top-strip-heading">
        <h2 id="top-strip-heading" className="sr-only">Exceptions and immediate actions</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <ExceptionTile
            label="Active eligible"
            count={eligibleActiveCount}
            sub={incompleteEligible > 0 ? `${incompleteEligible} excluded (terminal/linked)` : "Matches working list"}
            href="/opportunities"
            icon={Briefcase}
            tone="emerald"
            testId="kpi-eligible-active"
          />
          <ExceptionTile
            label="Overdue follow-ups"
            count={atRisk.overdueFollowups}
            sub="Next-activity date in the past"
            href="/opportunities?filter=overdue-followups"
            icon={AlertTriangle}
            tone={atRisk.overdueFollowups > 0 ? "rose" : "default"}
            testId="kpi-overdue-followups"
          />
          <ExceptionTile
            label="Stale > 30d"
            count={atRisk.staleActivity}
            sub={`${atRisk.veryStale} are >60d`}
            href="/opportunities?filter=stale-30"
            icon={Hourglass}
            tone={atRisk.staleActivity > 0 ? "amber" : "default"}
            testId="kpi-stale-30"
          />
          <ExceptionTile
            label="Blocked by dependency"
            count={blockedDependencyCount}
            sub={blockedDependencyCount > 0 ? `${atRisk.highValueNoRecent} high-value also quiet` : "No internal blockers"}
            href={blockedDependencyCount > 0 ? "#cross-company" : undefined}
            icon={ShieldAlert}
            tone={blockedDependencyCount > 0 ? "rose" : "default"}
            testId="kpi-blocked-dependency"
          />
          <ExceptionTile
            label="Handover-ready"
            count={handoverReady.total}
            sub={handoverReady.total > 0 ? "Won + signed + ready packet" : "No deals at handover stage"}
            href={handoverReady.total > 0 ? "/handover-control" : undefined}
            icon={Handshake}
            tone={handoverReady.total > 0 ? "emerald" : "default"}
            testId="kpi-handover-ready"
          />
          <ExceptionTile
            label="Linkage / data gaps"
            count={linkageGaps.total}
            sub={linkageGaps.total > 0 ? "Won deals with no project link" : "Spine clean"}
            href={linkageGaps.total > 0 ? "/admin/work-item-linkage" : undefined}
            icon={Link2Off}
            tone={linkageGaps.total > 0 ? "rose" : "default"}
            testId="kpi-linkage-gaps"
          />
        </div>
      </section>

      {/* 2. ACTION QUEUE — what to do right now */}
      <CollapsibleCard
        id="action-queue"
        testId="card-action-queue"
        header={
          <>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-emerald-700" />
              Action queue
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Top {actionQueue.length} active opportunities ranked by overdue → very stale → high-value quiet → stale 30d, then by deal value.
            </p>
          </>
        }
      >
        <CardContent>
          {actionQueue.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="action-queue-empty">No items need PD action right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="action-queue-table">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Reason</th>
                    <th className="py-2 pr-3 font-medium">Deal</th>
                    <th className="py-2 pr-3 font-medium">Owner</th>
                    <th className="py-2 pr-3 font-medium text-right">Value</th>
                    <th className="py-2 pr-3 font-medium">Last activity</th>
                    <th className="py-2 pr-3 font-medium">Next activity</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {actionQueue.map((item) => {
                    const lastAge = ageInDays(item.lastActivityDate);
                    const nextAge = ageInDays(item.nextActivityDate);
                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`action-row-${item.id}`}>
                        <td className="py-2 pr-3"><ReasonChip reason={item.reason} /></td>
                        <td className="py-2 pr-3 font-medium text-foreground">
                          <Link href={`/opportunities?open=${item.id}`} className="hover:text-emerald-700" data-testid={`action-deal-${item.id}`}>
                            {item.dealName || `Deal #${item.id}`}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{item.owner || "Unassigned"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatZAR(item.value)}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {lastAge == null ? "Never" : `${lastAge}d ago`}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {item.nextActivityDate == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : nextAge != null && nextAge > 0 ? (
                            <span className="text-rose-700">{nextAge}d overdue</span>
                          ) : (
                            <span className="text-muted-foreground">{formatDate(item.nextActivityDate)}</span>
                          )}
                        </td>
                        <td className="py-2">
                          <Link href={`/opportunities?open=${item.id}`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid={`action-open-${item.id}`}>
                              Open
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </CollapsibleCard>

      {/* 3. PD OPERATING BOARD — pipeline by lifecycle phase (operational, not vanity) */}
      <CollapsibleCard
        id="pipeline-by-phase"
        testId="card-pipeline-by-phase"
        header={
          <>
            <CardTitle className="text-base">PD operating board · by lifecycle phase</CardTitle>
            <p className="text-xs text-muted-foreground">
              Active opportunities grouped by the company's 10-stage lifecycle. Pipedrive stages roll up under each phase.
            </p>
          </>
        }
      >
        <CardContent className="space-y-4">
          {phaseBuckets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active opportunities.</p>
          ) : (
            phaseBuckets.map((p) => (
              <PhaseBar key={p.phase} phase={p.phase} count={p.count} value={p.value} weighted={p.weighted} stages={p.stages} maxValue={maxPhaseValue} />
            ))
          )}
        </CardContent>
      </CollapsibleCard>

      {/* 4. CROSS-COMPANY INTERACTION — workspace rollup (engineering, finance, blockers, broken handovers) */}
      <MeetingViewSection />

      {/* 5. OWNERSHIP VIEW — by PD owner */}
      <CollapsibleCard
        id="by-owner"
        testId="card-by-owner"
        header={
          <>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="h-4 w-4 text-muted-foreground" />
              Ownership · per PD owner
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Source: <code className="rounded bg-muted px-1">opportunities.deal_owner_name</code> snapshot from Pipedrive sync. Counts only active opportunities.
            </p>
          </>
        }
      >
        <CardContent>
          {byOwner.length === 0 ? (
            <p className="text-sm text-muted-foreground">No owners to display — no active opportunities yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="by-owner-table">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Owner</th>
                    <th className="py-2 pr-3 font-medium text-right">Active</th>
                    <th className="py-2 pr-3 font-medium text-right">Overdue</th>
                    <th className="py-2 pr-3 font-medium text-right">Stale 30d</th>
                    <th className="py-2 pr-3 font-medium text-right">Due this week</th>
                    <th className="py-2 pr-3 font-medium text-right">Handover-ready</th>
                    <th className="py-2 pr-3 font-medium text-right">Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  {byOwner.map((row) => (
                    <tr key={row.owner} className="border-b last:border-0 hover:bg-muted/30" data-testid={`owner-row-${row.owner}`}>
                      <td className="py-2 pr-3 font-medium">{row.owner}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.active}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${row.overdue > 0 ? "text-rose-700 font-medium" : "text-muted-foreground"}`}>{row.overdue}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${row.stale30 > 0 ? "text-amber-700" : "text-muted-foreground"}`}>{row.stale30}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.dueThisWeek}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${row.handoverReady > 0 ? "text-emerald-700 font-medium" : "text-muted-foreground"}`} data-testid={`owner-handover-${row.owner}`}>{row.handoverReady}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatZAR(row.pipelineValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </CollapsibleCard>

      {/* Handover-ready / linkage-gap inline lists (progressive disclosure) */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DisclosurePanel
          testId="disclosure-handover-ready"
          title="Handover-ready deals"
          count={handoverReady.total}
          tone="emerald"
          emptyText="No deals currently match the handover-ready signal (won + signed + handover_readiness in {ready, in_preparation, awaiting_approval, submitted})."
        >
          <ul className="space-y-2">
            {handoverReady.items.map((it) => (
              <li key={it.id} className="flex items-start justify-between gap-3 text-sm" data-testid={`handover-item-${it.id}`}>
                <div className="min-w-0 flex-1">
                  <Link href={`/handover-control`} className="font-medium hover:text-emerald-700">
                    {it.dealName || `Deal #${it.id}`}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {it.owner ? `${it.owner} · ` : ""}
                    {it.handoverReadiness ?? "—"}
                    {it.signedDate ? ` · signed ${formatDate(it.signedDate)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-emerald-700">{formatZAR(it.value)}</span>
              </li>
            ))}
          </ul>
        </DisclosurePanel>

        <DisclosurePanel
          testId="disclosure-linkage-gaps"
          title="Won deals with no linked project"
          count={linkageGaps.total}
          tone="rose"
          emptyText="Spine is clean — every won deal has a project_info row."
        >
          <ul className="space-y-2">
            {linkageGaps.items.map((it) => (
              <li key={it.id} className="flex items-start justify-between gap-3 text-sm" data-testid={`linkage-item-${it.id}`}>
                <div className="min-w-0 flex-1">
                  <Link href={`/opportunities?open=${it.id}`} className="font-medium hover:text-emerald-700">
                    {it.dealName || `Deal #${it.id}`}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {it.owner ? `${it.owner} · ` : ""}
                    {it.signedDate ? `signed ${formatDate(it.signedDate)}` : "no signed date"}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium text-muted-foreground">{formatZAR(it.value)}</span>
              </li>
            ))}
          </ul>
          {linkageGaps.total > 8 && (
            <p className="mt-2 text-[11px] text-muted-foreground">Showing top 8 of {linkageGaps.total}.</p>
          )}
        </DisclosurePanel>
      </div>

      {/* 6. COMMERCIAL CONTEXT — moved lower, intentionally summarized */}
      <CollapsibleCard
        id="commercial-context"
        testId="card-commercial-context"
        defaultOpen={false}
        header={
          <>
            <CardTitle className="text-base">Commercial context</CardTitle>
            <p className="text-xs text-muted-foreground">Pipeline value, weighted exposure, win rate, and recent deal motion. Reference only — do not use for forecasting without verification.</p>
          </>
        }
      >
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-md border border-border/60 p-3" data-testid="commercial-pipeline">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pipeline value</p>
              <p className="mt-1 text-lg font-semibold">{formatZAR(summary.pipelineValue)}</p>
              <p className="text-[11px] text-muted-foreground">{summary.activeCount} active · {summary.pipelineKwp.toFixed(0)} kWp</p>
            </div>
            <div className="rounded-md border border-border/60 p-3" data-testid="commercial-weighted">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Weighted</p>
              <p className="mt-1 text-lg font-semibold">{formatZAR(summary.weightedValue)}</p>
              <p className="text-[11px] text-muted-foreground">{summary.avgProbability != null ? `Avg ${summary.avgProbability.toFixed(0)}% probability` : "Probability not set"}</p>
            </div>
            <div className="rounded-md border border-border/60 p-3" data-testid="commercial-win-rate">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Win rate</p>
              <p className="mt-1 text-lg font-semibold">{formatPct(summary.winRate)}</p>
              <p className="text-[11px] text-muted-foreground">{summary.wonCount} won · {summary.lostCount} lost</p>
            </div>
            <div className="rounded-md border border-border/60 p-3" data-testid="commercial-funnel">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Funnel</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                P {conversion.prospect} · Q {conversion.qualification} · Pr {conversion.proposal} · Neg {conversion.negotiation}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div data-testid="commercial-upcoming">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                Upcoming activity (14d)
              </h3>
              {upcomingActivity.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="space-y-2">
                  {upcomingActivity.slice(0, 5).map((a) => (
                    <li key={a.id} className="text-xs" data-testid={`activity-${a.id}`}>
                      <Link href={`/opportunities?open=${a.id}`} className="font-medium hover:text-emerald-700">{a.dealName || `Deal #${a.id}`}</Link>
                      <p className="text-muted-foreground">{a.subject || "—"}{a.date ? ` · ${formatDate(a.date)}` : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div data-testid="commercial-wins">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                Recent wins
              </h3>
              {recentWins.length === 0 ? (
                <p className="text-xs text-muted-foreground">No wins recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {recentWins.slice(0, 5).map((w) => (
                    <li key={w.id} className="flex items-center justify-between text-xs" data-testid={`win-${w.id}`}>
                      <Link href={`/opportunities?open=${w.id}`} className="truncate font-medium hover:text-emerald-700">
                        {w.dealName || `Deal #${w.id}`}
                      </Link>
                      <span className="ml-2 shrink-0 text-emerald-700 font-semibold">{formatZAR(w.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div data-testid="commercial-losses">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <XCircle className="h-3.5 w-3.5 text-rose-700" />
                Recent losses
              </h3>
              {recentLost.length === 0 ? (
                <p className="text-xs text-muted-foreground">No losses recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {recentLost.slice(0, 5).map((l) => (
                    <li key={l.id} className="text-xs" data-testid={`loss-${l.id}`}>
                      <Link href={`/opportunities?open=${l.id}`} className="font-medium hover:text-emerald-700">
                        {l.dealName || `Deal #${l.id}`}
                      </Link>
                      <p className="truncate text-muted-foreground">{l.reason || "Reason not recorded"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </CollapsibleCard>

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
    /** @deprecated use `openEngineeringTickets` (task #61) */
    openPdTickets?: number;
    /** @deprecated use `overdueEngineeringTickets` (task #61) */
    overduePdTickets?: number;
    openEngineeringTickets: number;
    overdueEngineeringTickets: number;
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
    /** @deprecated use `engineeringTickets` (task #61) */
    pdTickets?: { total: number; open: number; completed: number; overdue: number; oldestOpenAt: string | null };
    engineeringTickets: { total: number; open: number; completed: number; overdue: number; oldestOpenAt: string | null };
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

  const sortedRows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      const aSpan = a.workItems.overdue + a.engineeringTickets.overdue + a.workItems.blocked + (a.spineGap ? 100 : 0);
      const bSpan = b.workItems.overdue + b.engineeringTickets.overdue + b.workItems.blocked + (b.spineGap ? 100 : 0);
      return bSpan - aSpan;
    });
  }, [data]);

  if (isLoading) {
    return (
      <Card data-testid="meeting-view-loading">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Cross-company interaction</CardTitle>
          <p className="text-xs text-muted-foreground">PD tickets, work-item blockers, and workspace-rollup gaps across all active projects.</p>
        </CardHeader>
        <CardContent><Skeleton className="h-48" /></CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card data-testid="meeting-view-error">
        <CardContent className="p-6">
          <p className="text-sm text-rose-700">Failed to load cross-company rollup.</p>
        </CardContent>
      </Card>
    );
  }

  const topRows = sortedRows.slice(0, 8);
  const hiddenRows = Math.max(sortedRows.length - topRows.length, 0);

  return (
    <CollapsibleCard
      id="cross-company"
      testId="meeting-view"
      className="scroll-mt-20"
      header={
        <>
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Cross-company interaction</CardTitle>
          <p className="text-xs text-muted-foreground">
            Source: <code className="rounded bg-muted px-1">/api/project-development/workspace/rollup</code> across {data.totals.projects} active projects.
            Generated {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </>
      }
    >
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
          <div data-testid="rollup-total-open-pd-tickets" className="rounded-md bg-muted/40 p-2">
            <p className="text-muted-foreground">Open PD tickets</p>
            <p className="text-lg font-semibold">{data.totals.openEngineeringTickets}</p>
            <p className="text-[10px] text-amber-700">{data.totals.overdueEngineeringTickets} overdue</p>
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
              {topRows.map((r) => (
                <tr key={r.projectId} className="border-b hover:bg-muted/30" data-testid={`row-project-${r.projectId}`}>
                  <td className="py-2 pr-3 font-medium">
                    <Link href={`/project/${encodeURIComponent(r.projectName || String(r.projectId))}`} className="hover:text-emerald-700">
                      {r.projectName || `#${r.projectId}`}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.phase || "—"}</td>
                  <td className="py-2 pr-3 text-right">
                    <span data-testid={`text-pd-open-${r.projectId}`}>{r.engineeringTickets.open}</span>
                    {r.engineeringTickets.overdue > 0 && (
                      <span className="ml-1 text-amber-700" data-testid={`text-pd-overdue-${r.projectId}`}>({r.engineeringTickets.overdue} od)</span>
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
              {topRows.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No active projects.</td></tr>
              )}
            </tbody>
          </table>
          {hiddenRows > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">Showing top {topRows.length} most-stressed of {sortedRows.length} active projects.</p>
          )}
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
    </CollapsibleCard>
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

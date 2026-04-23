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

type ActionReason = "blocked" | "overdue" | "stale_30d" | "high_priority_quiet" | "";

type PdDashboard = {
  generatedAt: string;
  summary: {
    activeTickets: number;
    overdueTickets: number;
    stale30Tickets: number;
    blockedTickets: number;
    completedTickets: number;
    activeKwp: number;
    openWorkItems: number;
    overdueWorkItems: number;
    dueThisWeekWorkItems: number;
    completed14dWorkItems: number;
  };
  byPhase: Array<{ code: string; label: string; ticketCount: number; openWorkItems: number; overdueWorkItems: number }>;
  byOwner: Array<{ ownerUserId: number | null; owner: string; active: number; overdue: number; stale30: number; dueThisWeek: number; activeKwp: number }>;
  handoverReady: { total: number; items: Array<{ id: number; projectName: string | null; phase: string | null; phaseLabel: string | null; ragStatus: string | null }> };
  actionQueue: Array<{
    workItemId: number;
    title: string | null;
    ticketId: number | null;
    ticketName: string | null;
    phase: string | null;
    phaseLabel: string | null;
    priority: string | null;
    endDate: string | null;
    owner: string | null;
    reason: ActionReason;
  }>;
  recentlyCompleted: Array<{ workItemId: number; title: string | null; ticketId: number | null; ticketName: string | null; completedAt: string | null; owner: string | null }>;
  upcomingThisWeek: Array<{ workItemId: number; title: string | null; ticketId: number | null; ticketName: string | null; endDate: string | null; priority: string | null; owner: string | null }>;
  atRiskTickets: Array<{ ticketId: number; ticketName: string | null; owner: string | null; redWorkItemCount: number; openCriticalRaidCount: number }>;
  linkageGaps: { total: number; items: Array<{ kind: string; id: number; label: string | null }> };
};

const REASON_LABEL: Record<ActionReason, { label: string; tone: "rose" | "amber" | "slate" }> = {
  blocked: { label: "Blocked", tone: "rose" },
  overdue: { label: "Overdue", tone: "rose" },
  stale_30d: { label: "Stale >30d", tone: "amber" },
  high_priority_quiet: { label: "High-priority quiet", tone: "amber" },
  "": { label: "—", tone: "slate" },
};

const LINKAGE_LABEL: Record<string, string> = {
  unlinked_ticket: "Ticket with no project or opportunity",
  completed_no_project: "Completed ticket — no project linked",
  project_no_tickets: "Active project — no engineering tickets",
};

function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-ZA");
}

function formatKwp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)} MWp`;
  return `${n.toFixed(0)} kWp`;
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

function PhaseRow({ row, maxOpen }: { row: { code: string; label: string; ticketCount: number; openWorkItems: number; overdueWorkItems: number }; maxOpen: number }) {
  const pct = maxOpen > 0 ? (row.openWorkItems / maxOpen) * 100 : 0;
  return (
    <div className="space-y-1.5" data-testid={`phase-row-${row.code}`}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-emerald-800 truncate">{row.label}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">{row.ticketCount} tickets</Badge>
          {row.overdueWorkItems > 0 && (
            <Badge variant="outline" className="text-[10px] shrink-0 border-rose-300 text-rose-700">
              {row.overdueWorkItems} overdue
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0">
          <span className="text-muted-foreground">{row.openWorkItems} open work items</span>
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

// Drilldown helper: link to the engineering ticket if known, else fall back
// to /engineering/tasks. We never link back to /opportunities here — the PD
// dashboard is now a view onto app-internal engineering & project work.
function ticketHref(ticketId: number | null | undefined, ticketName: string | null | undefined): string {
  if (ticketName) return `/engineering/tickets?open=${encodeURIComponent(ticketName)}`;
  if (ticketId != null) return `/engineering/tickets?id=${ticketId}`;
  return `/engineering/tickets`;
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

  const { summary, byPhase, byOwner, handoverReady, linkageGaps, actionQueue, recentlyCompleted, upcomingThisWeek, atRiskTickets } = data;
  const phaseRows = (byPhase ?? []).filter((p) => p.ticketCount > 0 || p.openWorkItems > 0);
  const maxPhaseOpen = Math.max(...phaseRows.map((p) => p.openWorkItems), 1);

  return (
    <PageLayout
      data-testid="pd-dashboard"
      header={
        <PageHeader
          title="Project Development"
          subtitle="Operational control tower — engineering tickets and work items needing PD action right now, sourced from app-internal data."
          actions={
            <Link href="/engineering/tickets">
              <Button variant="outline" size="sm" className="gap-2" data-testid="link-engineering-tickets">
                Open engineering tickets
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
          }
        />
      }
    >
      {/* 1. TOP STRIP — exception-first, drilldown-only. All counts come from
            engineering_tickets and work_items — no Pipedrive metrics. */}
      <section data-testid="section-top-strip" aria-labelledby="top-strip-heading">
        <h2 id="top-strip-heading" className="sr-only">Exceptions and immediate actions</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <ExceptionTile
            label="Active tickets"
            count={summary.activeTickets}
            sub={`${formatKwp(summary.activeKwp)} of design work`}
            href="/engineering/tickets"
            icon={Briefcase}
            tone="emerald"
            testId="kpi-active-tickets"
          />
          <ExceptionTile
            label="Overdue tickets"
            count={summary.overdueTickets}
            sub="Past due_date, still open"
            href="/engineering/tickets?filter=overdue"
            icon={AlertTriangle}
            tone={summary.overdueTickets > 0 ? "rose" : "default"}
            testId="kpi-overdue-tickets"
          />
          <ExceptionTile
            label="Stale > 30d"
            count={summary.stale30Tickets}
            sub="No update in 30+ days"
            href="/engineering/tickets?filter=stale-30"
            icon={Hourglass}
            tone={summary.stale30Tickets > 0 ? "amber" : "default"}
            testId="kpi-stale-tickets"
          />
          <ExceptionTile
            label="Blocked tickets"
            count={summary.blockedTickets}
            sub={summary.blockedTickets > 0 ? "Have a work item on hold" : "No internal blockers"}
            href={summary.blockedTickets > 0 ? "#cross-company" : undefined}
            icon={ShieldAlert}
            tone={summary.blockedTickets > 0 ? "rose" : "default"}
            testId="kpi-blocked-tickets"
          />
          <ExceptionTile
            label="Handover-ready"
            count={handoverReady.total}
            sub={handoverReady.total > 0 ? "Projects in S08–S10 band" : "No projects at handover stage"}
            href={handoverReady.total > 0 ? "/handover-control" : undefined}
            icon={Handshake}
            tone={handoverReady.total > 0 ? "emerald" : "default"}
            testId="kpi-handover-ready"
          />
          <ExceptionTile
            label="Linkage / data gaps"
            count={linkageGaps.total}
            sub={linkageGaps.total > 0 ? "Spine breaks across tickets/projects" : "Spine clean"}
            href={linkageGaps.total > 0 ? "/admin/work-item-linkage" : undefined}
            icon={Link2Off}
            tone={linkageGaps.total > 0 ? "rose" : "default"}
            testId="kpi-linkage-gaps"
          />
        </div>
      </section>

      {/* 2. ACTION QUEUE — what to do right now. Source: open work_items
            joined to engineering_tickets, ranked by reason. */}
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
              Top {actionQueue.length} open work items ranked by blocked → overdue → stale &gt;30d → high-priority quiet.
            </p>
          </>
        }
      >
        <CardContent>
          {actionQueue.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="action-queue-empty">No work items need PD action right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="action-queue-table">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Reason</th>
                    <th className="py-2 pr-3 font-medium">Work item</th>
                    <th className="py-2 pr-3 font-medium">Ticket</th>
                    <th className="py-2 pr-3 font-medium">Phase</th>
                    <th className="py-2 pr-3 font-medium">Owner</th>
                    <th className="py-2 pr-3 font-medium">Due</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {actionQueue.map((item) => {
                    const dueAge = ageInDays(item.endDate);
                    return (
                      <tr key={item.workItemId} className="border-b last:border-0 hover:bg-muted/30" data-testid={`action-row-${item.workItemId}`}>
                        <td className="py-2 pr-3"><ReasonChip reason={item.reason} /></td>
                        <td className="py-2 pr-3 font-medium text-foreground">
                          <Link href={`/engineering/tasks?open=${item.workItemId}`} className="hover:text-emerald-700" data-testid={`action-wi-${item.workItemId}`}>
                            {item.title || `Work item #${item.workItemId}`}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {item.ticketName ? (
                            <Link href={ticketHref(item.ticketId, item.ticketName)} className="hover:text-emerald-700">
                              {item.ticketName}
                            </Link>
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{item.phaseLabel || "—"}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{item.owner || "Unassigned"}</td>
                        <td className="py-2 pr-3 text-xs">
                          {item.endDate == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : dueAge != null && dueAge > 0 ? (
                            <span className="text-rose-700">{dueAge}d overdue</span>
                          ) : (
                            <span className="text-muted-foreground">{formatDate(item.endDate)}</span>
                          )}
                        </td>
                        <td className="py-2">
                          <Link href={`/engineering/tasks?open=${item.workItemId}`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid={`action-open-${item.workItemId}`}>
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

      {/* 3. PD OPERATING BOARD — engineering activity by canonical lifecycle phase */}
      <CollapsibleCard
        id="pipeline-by-phase"
        testId="card-pipeline-by-phase"
        header={
          <>
            <CardTitle className="text-base">PD operating board · by lifecycle phase</CardTitle>
            <p className="text-xs text-muted-foreground">
              Engineering tickets and work items grouped by the company's 10-stage canonical phase cycle (shared/phases.ts). Bar width = open work items.
            </p>
          </>
        }
      >
        <CardContent className="space-y-4">
          {phaseRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No engineering activity yet.</p>
          ) : (
            phaseRows.map((p) => (
              <PhaseRow key={p.code} row={p} maxOpen={maxPhaseOpen} />
            ))
          )}
        </CardContent>
      </CollapsibleCard>

      {/* 4. CROSS-COMPANY INTERACTION — workspace rollup */}
      <MeetingViewSection />

      {/* 5. OWNERSHIP VIEW — by PD developer */}
      <CollapsibleCard
        id="by-owner"
        testId="card-by-owner"
        header={
          <>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="h-4 w-4 text-muted-foreground" />
              Ownership · per PD developer
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Source: <code className="rounded bg-muted px-1">engineering_tickets.project_developer_user_id</code> joined to <code className="rounded bg-muted px-1">users</code>. Counts only active tickets.
            </p>
          </>
        }
      >
        <CardContent>
          {byOwner.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active engineering tickets.</p>
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
                    <th className="py-2 pr-3 font-medium text-right">Active capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {byOwner.map((row) => (
                    <tr key={`${row.ownerUserId ?? 'na'}-${row.owner}`} className="border-b last:border-0 hover:bg-muted/30" data-testid={`owner-row-${row.owner}`}>
                      <td className="py-2 pr-3 font-medium">{row.owner}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.active}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${row.overdue > 0 ? "text-rose-700 font-medium" : "text-muted-foreground"}`}>{row.overdue}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${row.stale30 > 0 ? "text-amber-700" : "text-muted-foreground"}`}>{row.stale30}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.dueThisWeek}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatKwp(row.activeKwp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </CollapsibleCard>

      {/* Handover-ready / linkage-gap inline lists */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DisclosurePanel
          testId="disclosure-handover-ready"
          title="Handover-ready projects"
          count={handoverReady.total}
          tone="emerald"
          emptyText="No projects currently sit in the post-construction handover band (canonical phases S08, S09, S9B, S10)."
        >
          <ul className="space-y-2">
            {handoverReady.items.map((it) => (
              <li key={it.id} className="flex items-start justify-between gap-3 text-sm" data-testid={`handover-item-${it.id}`}>
                <div className="min-w-0 flex-1">
                  <Link href={`/project/${encodeURIComponent(it.projectName ?? String(it.id))}`} className="font-medium hover:text-emerald-700">
                    {it.projectName || `Project #${it.id}`}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {it.phaseLabel ?? "—"}
                    {it.ragStatus ? ` · RAG ${it.ragStatus}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </DisclosurePanel>

        <DisclosurePanel
          testId="disclosure-linkage-gaps"
          title="Linkage / data gaps"
          count={linkageGaps.total}
          tone="rose"
          emptyText="Spine is clean — every active project has tickets and every ticket has a project or opportunity link."
        >
          <ul className="space-y-2">
            {linkageGaps.items.map((it, idx) => (
              <li key={`${it.kind}-${it.id}-${idx}`} className="flex items-start justify-between gap-3 text-sm" data-testid={`linkage-item-${it.kind}-${it.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{it.label || `#${it.id}`}</p>
                  <p className="text-xs text-muted-foreground">{LINKAGE_LABEL[it.kind] ?? it.kind}</p>
                </div>
              </li>
            ))}
          </ul>
          {linkageGaps.total > linkageGaps.items.length && (
            <p className="mt-2 text-[11px] text-muted-foreground">Showing top {linkageGaps.items.length} of {linkageGaps.total}.</p>
          )}
        </DisclosurePanel>
      </div>

      {/* 6. ACTIVITY PULSE — recently completed and what's due this week */}
      <CollapsibleCard
        id="activity-pulse"
        testId="card-activity-pulse"
        defaultOpen={false}
        header={
          <>
            <CardTitle className="text-base">Activity pulse</CardTitle>
            <p className="text-xs text-muted-foreground">
              {summary.completed14dWorkItems} work items completed in the last 14 days · {summary.dueThisWeekWorkItems} due in the next 7.
            </p>
          </>
        }
      >
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div data-testid="recently-completed">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                Recently completed (14d)
              </h3>
              {recentlyCompleted.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing completed in the last 14 days.</p>
              ) : (
                <ul className="space-y-2">
                  {recentlyCompleted.map((w) => (
                    <li key={w.workItemId} className="text-xs" data-testid={`completed-${w.workItemId}`}>
                      <Link href={`/engineering/tasks?open=${w.workItemId}`} className="font-medium hover:text-emerald-700">
                        {w.title || `Work item #${w.workItemId}`}
                      </Link>
                      <p className="text-muted-foreground">
                        {w.owner ? `${w.owner} · ` : ""}
                        {w.ticketName ?? "—"}
                        {w.completedAt ? ` · ${formatDate(w.completedAt)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div data-testid="upcoming-this-week">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5 text-emerald-700" />
                Due in the next 7 days
              </h3>
              {upcomingThisWeek.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing due this week.</p>
              ) : (
                <ul className="space-y-2">
                  {upcomingThisWeek.map((w) => (
                    <li key={w.workItemId} className="text-xs" data-testid={`upcoming-${w.workItemId}`}>
                      <Link href={`/engineering/tasks?open=${w.workItemId}`} className="font-medium hover:text-emerald-700">
                        {w.title || `Work item #${w.workItemId}`}
                      </Link>
                      <p className="text-muted-foreground">
                        {w.owner ? `${w.owner} · ` : ""}
                        {w.ticketName ?? "—"}
                        {w.endDate ? ` · due ${formatDate(w.endDate)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {atRiskTickets.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-4" data-testid="at-risk-tickets">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <XCircle className="h-3.5 w-3.5 text-rose-700" />
                At-risk tickets
              </h3>
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {atRiskTickets.map((t) => (
                  <li key={t.ticketId} className="text-xs" data-testid={`at-risk-${t.ticketId}`}>
                    <Link href={ticketHref(t.ticketId, t.ticketName)} className="font-medium hover:text-rose-700">
                      {t.ticketName || `Ticket #${t.ticketId}`}
                    </Link>
                    <p className="text-muted-foreground">
                      {t.owner ? `${t.owner} · ` : ""}
                      {t.redWorkItemCount > 0 ? `${t.redWorkItemCount} red work items` : ""}
                      {t.redWorkItemCount > 0 && t.openCriticalRaidCount > 0 ? " · " : ""}
                      {t.openCriticalRaidCount > 0 ? `${t.openCriticalRaidCount} critical RAID` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </CollapsibleCard>

      <p className="text-[10px] text-muted-foreground" data-testid="generated-at">
        Snapshot generated {new Date(data.generatedAt).toLocaleString()} · {formatNumber(summary.activeTickets)} active tickets · {formatNumber(summary.openWorkItems)} open work items
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

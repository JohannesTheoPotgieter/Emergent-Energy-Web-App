// ============================================================
// /now — "What needs attention right now?"
//
// PR-B of the truth/clear/simple redesign.
//
// Replaces the 5-tab Execution Dashboard with a single screen that
// answers the COO's daily question: anything on fire, how is money
// moving this week, what needs me. The 5 dashboard tabs remain
// accessible at /execution-board for one transition cycle so any
// bookmarks survive — but /now is the canonical landing.
//
// Truth — every number reflects the real state. No tiles. No drilldown
// drawers. Loading shows a skeleton, error says "load failed".
// Clear — three sections, one per question. One H1, one primary CTA
// per section. Colours only via design-tokens.ts.
// Simple — total page footprint < 800 LOC including imports. No nested
// tabs, no filter dropdowns, no toolbars.
// ============================================================

import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/hooks/use-permissions';
import {
  ExecutionDashboardContext,
  useExecutionDataProvider,
} from './execution-dashboard/use-execution-data';
import type { ExecutionDashboardProject } from '@/lib/execution-dashboard';
import { useAuth } from '@/hooks/use-auth';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { formatZarCompact } from '@/lib/currency';
import {
  statusBadgeClasses,
  statusClasses,
  ragLevel,
  TYPOGRAPHY,
} from '@/lib/design-tokens';
import {
  Flame,
  ArrowRight,
  AlertOctagon,
  TrendingUp,
  TrendingDown,
  Activity,
  Inbox,
} from 'lucide-react';

// "On fire" derivation lives in a separate module so it's testable
// without React.
import { computeFireList } from './now-fire-list';

// ===================== Page =====================

function NowPageInner() {
  const { user } = useAuth();
  // The provider returns `loading` / `error` (string) / `loadData` rather
  // than the React-Query shape; normalise to local names so the JSX
  // below reads consistently.
  const provider = useExecutionDataProvider(useLocation()[1]);
  const { kpis, filteredProjects, dashboard, openProject } = provider;
  const isLoading = provider.loading;
  const isError = !!provider.error;
  const refetch = provider.loadData;

  // Top 3 fires.
  const fires = useMemo(() => computeFireList(filteredProjects).slice(0, 3), [filteredProjects]);

  // PR-C wired in /api/my-queue — single fetch covers POs +
  // payment requests + change requests + stage exceptions.
  const { data: myQueue } = useQuery<{
    pos: { count: number };
    paymentRequests: { count: number };
    changeRequests: { count: number };
    stageExceptions: { count: number };
  }>({
    queryKey: ['/api/my-queue'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/my-queue');
      if (!res.ok) throw new Error('my-queue failed');
      return res.json();
    },
    staleTime: 30_000,
  });

  const myPoCount = myQueue?.pos.count ?? 0;
  const myPaymentCount = myQueue?.paymentRequests.count ?? 0;
  const myCrCount = myQueue?.changeRequests.count ?? 0;
  const myStageCount = myQueue?.stageExceptions.count ?? 0;
  const myQueueTotal = myPoCount + myPaymentCount + myCrCount + myStageCount;

  // Money this week — direct from `kpis`, no aggregation.
  const inflowThisWeek = dashboard?.kpis.projectInflowsThisWeek ?? 0;
  const outflowThisWeek = dashboard?.kpis.projectOutflowsThisWeek ?? 0;
  const overdueAR = kpis?.overdueInflowFy ?? 0;
  const overdueAP = kpis?.overdueOutflowFy ?? 0;

  const onSchedule = filteredProjects.filter(
    (p) => p.expectedProgressPct != null && !p.behindPlan,
  ).length;
  const behindPlan = filteredProjects.filter((p) => p.behindPlan).length;
  const measured = filteredProjects.filter((p) => p.expectedProgressPct != null).length;
  const ahead = filteredProjects.filter(
    (p) =>
      p.expectedProgressPct != null &&
      p.actualProgressPct != null &&
      p.actualProgressPct > p.expectedProgressPct + 5,
  ).length;

  if (isLoading) return <NowSkeleton />;
  if (isError) return <NowError onRetry={refetch} />;

  const fireCount = fires.length;
  const actionWaiting = myQueueTotal;

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-6 px-4">
      {/* H1 — one per page, per the design system. */}
      <header className="space-y-1">
        <h1 className={TYPOGRAPHY.PAGE_TITLE}>Now</h1>
        <p className="text-sm text-muted-foreground">
          {greeting(user?.name)} ·{' '}
          {fireCount === 0
            ? 'Nothing on fire'
            : `${fireCount} ${fireCount === 1 ? 'project' : 'projects'} on fire`}
          {actionWaiting > 0 && ` · ${actionWaiting} action${actionWaiting === 1 ? '' : 's'} waiting`}
        </p>
      </header>

      {/* SECTION 1 — Projects on fire. Big card, single primary action. */}
      <section>
        <h2 className={`${TYPOGRAPHY.SECTION} mb-2 flex items-center gap-2`}>
          <Flame className={`h-4 w-4 ${statusClasses('critical', 'text')}`} />
          On fire
        </h2>
        {fires.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No projects are currently flagged. Schedule, RAG, finance and engineering are all
              within tolerance.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y">
              {fires.map((f) => {
                const headline = f.reasons[0];
                const more = f.reasons.length - 1;
                return (
                  <li
                    key={f.project.projectId}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer"
                    onClick={() => openProject(f.project)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') openProject(f.project);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">
                        {cleanName(f.project.projectName)}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span className={`inline-flex w-2 h-2 rounded-full ${ragDotClass(f.project.rag)}`} />
                        <span>{f.project.executionPhase || 'No phase'}</span>
                        <span aria-hidden>·</span>
                        <Badge variant="outline" className={`${statusClasses(headline.level, 'outline')} text-[10px]`}>
                          {headline.label}
                        </Badge>
                        {more > 0 && (
                          <span className="text-[10px] text-muted-foreground" title={f.reasons.slice(1).map((r) => r.label).join(' · ')}>
                            +{more} more
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      {/* SECTION 2 — Money + Schedule, side-by-side text blocks (not tiles). */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4">
            <h3 className={`${TYPOGRAPHY.SECTION} mb-2 flex items-center gap-2`}>
              <Activity className={`h-4 w-4 ${statusClasses('neutral', 'text')}`} />
              Money this week
            </h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground inline-flex items-center gap-1.5">
                  <TrendingUp className={`h-3.5 w-3.5 ${statusClasses('healthy', 'text')}`} />
                  In this week
                </dt>
                <dd className="font-medium tabular-nums">{formatZarCompact(inflowThisWeek)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground inline-flex items-center gap-1.5">
                  <TrendingDown className={`h-3.5 w-3.5 ${statusClasses('neutral', 'text')}`} />
                  Out this week
                </dt>
                <dd className="font-medium tabular-nums">{formatZarCompact(outflowThisWeek)}</dd>
              </div>
              {overdueAR > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground inline-flex items-center gap-1.5">
                    <AlertOctagon className={`h-3.5 w-3.5 ${statusClasses('critical', 'text')}`} />
                    Overdue receivables
                  </dt>
                  <dd className={`font-medium tabular-nums ${statusClasses('critical', 'text')}`}>
                    {formatZarCompact(overdueAR)}
                  </dd>
                </div>
              )}
              {overdueAP > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground inline-flex items-center gap-1.5">
                    <AlertOctagon className={`h-3.5 w-3.5 ${statusClasses('critical', 'text')}`} />
                    Overdue payables
                  </dt>
                  <dd className={`font-medium tabular-nums ${statusClasses('critical', 'text')}`}>
                    {formatZarCompact(overdueAP)}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <h3 className={`${TYPOGRAPHY.SECTION} mb-2 flex items-center gap-2`}>
              <Activity className={`h-4 w-4 ${statusClasses('neutral', 'text')}`} />
              Schedule this week
            </h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">On schedule</dt>
                <dd className="font-medium tabular-nums">{onSchedule}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Behind plan</dt>
                <dd className={`font-medium tabular-nums ${behindPlan > 0 ? statusClasses('warning', 'text') : ''}`}>
                  {behindPlan}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Ahead</dt>
                <dd className="font-medium tabular-nums">{ahead}</dd>
              </div>
              {measured < filteredProjects.length && (
                <div className="text-[11px] text-muted-foreground pt-1">
                  {filteredProjects.length - measured} project
                  {filteredProjects.length - measured === 1 ? '' : 's'} missing schedule data
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      </section>

      {/* SECTION 3 — What needs me. PR-C wired /api/my-queue so this
          mirrors the dedicated /my-queue page. The whole section is a
          link to /my-queue; the inner rows are scannable shortcuts. */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className={`${TYPOGRAPHY.SECTION} flex items-center gap-2`}>
            <Inbox className={`h-4 w-4 ${statusClasses(myQueueTotal > 0 ? 'warning' : 'neutral', 'text')}`} />
            What needs me
          </h2>
          {myQueueTotal > 0 && (
            <Button variant="ghost" size="sm" asChild className="text-xs">
              <a href="/my-queue" className="inline-flex items-center gap-1">
                Open my queue <ArrowRight className="h-3 w-3" />
              </a>
            </Button>
          )}
        </div>
        <Card>
          <ul className="divide-y">
            <NeedsMeRow count={myPoCount} label="purchase orders awaiting your approval" href="/my-queue#pos" />
            <NeedsMeRow count={myPaymentCount} label="payment requests in review" href="/my-queue#payments" />
            <NeedsMeRow count={myCrCount} label="change requests awaiting decision" href="/my-queue#crs" />
            <NeedsMeRow count={myStageCount} label="stage-gate exceptions assigned to you" href="/my-queue#stage" />
          </ul>
        </Card>
      </section>

      {/* Footer — link to the legacy 5-tab dashboard so existing bookmarks still work. */}
      <div className="text-center pt-4">
        <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground">
          <a href="/execution-board">Open full execution dashboard →</a>
        </Button>
      </div>
    </div>
  );
}

// ===================== Sub-components =====================

function NeedsMeRow({
  count,
  label,
  href,
}: {
  count: number;
  label: string;
  href: string;
}) {
  if (count === 0) {
    return (
      <li className="px-4 py-3 text-sm text-muted-foreground flex items-center justify-between">
        <span>Nothing waiting on you for {labelCategory(label)}.</span>
      </li>
    );
  }
  return (
    <li className="px-4 py-3 flex items-center justify-between hover:bg-muted/30">
      <div className="text-sm">
        <span className={`${statusClasses('warning', 'text')} font-semibold`}>{count}</span>{' '}
        {label}
      </div>
      <Button asChild size="sm" variant="outline">
        <a href={href} className="inline-flex items-center gap-1">
          Open <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </Button>
    </li>
  );
}

function labelCategory(label: string): string {
  if (label.includes('purchase order')) return 'POs';
  if (label.includes('change request')) return 'CRs';
  return 'this';
}

function NowSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto py-6 px-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Card>
        <CardContent className="py-6 space-y-3">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

function NowError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 text-center">
      <h1 className={`${TYPOGRAPHY.PAGE_TITLE} mb-2`}>Now</h1>
      <p className={`text-sm ${statusClasses('critical', 'text')} mb-4`}>
        Couldn't load your dashboard. That doesn't mean nothing is on fire — please retry.
      </p>
      <Button onClick={onRetry} variant="outline" size="sm">
        Retry
      </Button>
    </div>
  );
}

function ragDotClass(rag?: string | null): string {
  const level = ragLevel(rag);
  if (level === 'healthy') return 'bg-emerald-500';
  if (level === 'warning') return 'bg-amber-500';
  if (level === 'critical') return 'bg-red-500';
  return 'bg-slate-400';
}

function cleanName(raw: string): string {
  return raw.replace(/_Tracker.*$/i, '').replace(/_/g, ' ');
}

function greeting(name?: string | null): string {
  const first = (name || '').split(' ')[0];
  const hour = new Date().getHours();
  const tod = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  return first ? `${tod}, ${first}` : tod;
}

// ===================== Permission wrapper =====================

export default function NowPage() {
  // usePermission returns { allowed, loading } — treat "still loading
  // the role grant" as not-ready so we don't briefly render the
  // "no permission" state on first paint.
  const { allowed: canView, loading: permLoading } = usePermission('execution_board', 'view');
  const [, setLocation] = useLocation();
  const ctx = useExecutionDataProvider(setLocation);

  if (permLoading) return <NowSkeleton />;
  if (!canView) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 text-center">
        <h1 className={`${TYPOGRAPHY.PAGE_TITLE} mb-2`}>Now</h1>
        <p className={`text-sm ${statusClasses('neutral', 'text')}`}>
          You don't have permission to view the execution dashboard.
        </p>
      </div>
    );
  }
  return (
    <ExecutionDashboardContext.Provider value={ctx}>
      <NowPageInner />
    </ExecutionDashboardContext.Provider>
  );
}

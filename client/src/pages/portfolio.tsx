// ============================================================
// /portfolio — 6-column project list with lens-aware health column.
//
// PR-D of the truth/clear/simple redesign.
//
// Replaces (alongside, doesn't delete) the 50+ column `/projects` page
// and the two milestone trackers. The right-most column changes
// meaning when the user switches "lens":
//
//   • Delivery  — schedule delta + blockers (default).
//   • Revenue   — actual / planned + outstanding.
//   • Cost      — actual / planned expenses + GP %.
//   • Quality   — open NCRs + handover readiness.
//
// Truth — every cell is a real number. Missing data renders "—",
// never zeroed. Empty state says "No projects match" rather than
// blank-table.
// Clear — six columns by default. One H1, one primary filter dropdown,
// one search. Lens label is the most-prominent control because it's
// what changes the meaning of the rightmost column.
// Simple — single fetch. No bulk actions. No 6-quick-filter rail.
// ============================================================

import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  Card, CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useProjectsSummary } from '@/hooks/use-projects-summary';
import { useAuth } from '@/hooks/use-auth';
import { usePermission } from '@/hooks/use-permissions';
import { TYPOGRAPHY, statusClasses, ragLevel } from '@/lib/design-tokens';
import { Search } from 'lucide-react';
import type { ProjectSummary } from '@/lib/api';
import {
  computePortfolioRow,
  type PortfolioLens,
  type PortfolioStateFilter,
  PORTFOLIO_LENSES,
  PORTFOLIO_STATE_FILTERS,
  LENS_LABELS,
  STATE_LABELS,
} from './portfolio-lens';

// ===================== Page =====================

export default function PortfolioPage() {
  const { allowed: canView, loading: permLoading } = usePermission('execution_board', 'view');
  const { user } = useAuth();
  const { projectsSummary, isLoading } = useProjectsSummary();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [lens, setLens] = useState<PortfolioLens>('delivery');
  const [state, setState] = useState<PortfolioStateFilter>('active');

  // Apply state + search filters. Lens does NOT change the row set —
  // only the rightmost column meaning — so users can switch lenses
  // without losing their place.
  const rows = useMemo(() => {
    const list = projectsSummary ?? [];
    const me = (user?.name || '').toLowerCase();
    const term = search.trim().toLowerCase();
    return list.filter((p) => {
      // State filter.
      if (state === 'active' && (p as ProjectSummary & { archived_status?: string }).archived_status === 'ARCHIVED') return false;
      if (state === 'archived' && (p as ProjectSummary & { archived_status?: string }).archived_status !== 'ARCHIVED') return false;
      if (state === 'mine' && me) {
        const isMine = (p.pm || '').toLowerCase().includes(me) || (p.pd || '').toLowerCase().includes(me);
        if (!isMine) return false;
      }
      if (state === 'behind' && !(p.delta_vs_expected != null && p.delta_vs_expected < -0.05)) return false;
      if (state === 'missing_fc') {
        // Heuristic: no financial-close achieved yet. Project may carry
        // various flags; fall back to phase containing "first" or "cost"
        // when explicit field absent.
        const phase = (p.phase || '').toLowerCase();
        const earlyPhase = phase.includes('first') || phase.includes('cost') || phase.includes('proposal');
        if (!earlyPhase) return false;
      }
      // Search.
      if (term) {
        const hay = [
          p.project_name, p.phase, p.pm, p.pd,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    }).map((p) => computePortfolioRow(p, lens));
  }, [projectsSummary, state, search, lens, user?.name]);

  // KPI strip — three numbers only. Sum / avg / count.
  const kpi = useMemo(() => {
    const all = projectsSummary ?? [];
    const active = all.filter((p) => (p as ProjectSummary & { archived_status?: string }).archived_status !== 'ARCHIVED');
    const totalKwp = active.reduce((s, p) => s + (Number(p.size_kwp) || 0), 0);
    const measured = active.filter((p) => p.project_pct_complete != null);
    const avgCompletion = measured.length === 0
      ? null
      : (measured.reduce((s, p) => s + (Number(p.project_pct_complete) || 0), 0) / measured.length) * 100;
    const behind = active.filter((p) => p.delta_vs_expected != null && p.delta_vs_expected < -0.05).length;
    return { active: active.length, totalKwp, avgCompletion, behind };
  }, [projectsSummary]);

  if (permLoading) return <PortfolioSkeleton />;
  if (!canView) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-4 text-center">
        <h1 className={`${TYPOGRAPHY.PAGE_TITLE} mb-2`}>Portfolio</h1>
        <p className={`text-sm ${statusClasses('neutral', 'text')}`}>
          You don't have permission to view the portfolio.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-6xl mx-auto py-6 px-4">
      <header className="space-y-1">
        <h1 className={TYPOGRAPHY.PAGE_TITLE}>Portfolio</h1>
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? 'Loading projects…'
            : `${kpi.active} active · ${kpi.behind} behind plan · ${formatNumber(kpi.totalKwp, 0)} kWp${
                kpi.avgCompletion != null ? ` · avg ${kpi.avgCompletion.toFixed(0)}% complete` : ''
              }`}
        </p>
      </header>

      {/* Toolbar — lens / state / search. No icons, no inline KPI strip;
          the page subtitle already carries the headline numbers. */}
      <section className="flex items-center gap-3 flex-wrap">
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Lens
          <Select value={lens} onValueChange={(v) => setLens(v as PortfolioLens)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PORTFOLIO_LENSES.map((l) => (
                <SelectItem key={l} value={l} className="text-xs">
                  {LENS_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          State
          <Select value={state} onValueChange={(v) => setState(v as PortfolioStateFilter)}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PORTFOLIO_STATE_FILTERS.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {STATE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search project / PM…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-7 text-xs w-56"
          />
        </div>
      </section>

      {/* Table — 6 columns. No bulk select, no per-row action menu. */}
      <Card>
        {isLoading ? (
          <CardContent className="space-y-2 py-4">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </CardContent>
        ) : rows.length === 0 ? (
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No projects match this filter.
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="w-44">Phase</TableHead>
                <TableHead className="w-32">PM</TableHead>
                <TableHead className="w-16 text-center">RAG</TableHead>
                <TableHead className="w-24 text-right">% complete</TableHead>
                <TableHead>{LENS_LABELS[lens]} summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const ragClass = ragDotClass(row.rag);
                return (
                  <TableRow
                    key={row.projectId ?? row.projectName}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => row.projectId && setLocation(`/project/id/${row.projectId}`)}
                  >
                    <TableCell className="font-medium">{row.projectName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.phase || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.pm || '—'}</TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${ragClass}`} aria-label={`RAG ${row.rag || 'unknown'}`} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {row.pctComplete == null ? '—' : `${row.pctComplete.toFixed(0)}%`}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        {row.lensSummary.badges.map((b, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className={`${statusClasses(b.level, 'outline')} text-[10px]`}
                          >
                            {b.label}
                          </Badge>
                        ))}
                        {row.lensSummary.text && (
                          <span className="text-muted-foreground truncate">{row.lensSummary.text}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-[11px] text-muted-foreground text-center">
        The legacy 50-column view stays at <a href="/projects" className="underline">/projects</a>.
      </p>
    </div>
  );
}

// ===================== Sub-components =====================

function PortfolioSkeleton() {
  return (
    <div className="space-y-5 max-w-6xl mx-auto py-6 px-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-64" />
    </div>
  );
}

function ragDotClass(rag: string | null | undefined): string {
  const level = ragLevel(rag);
  if (level === 'healthy') return 'bg-emerald-500';
  if (level === 'warning') return 'bg-amber-500';
  if (level === 'critical') return 'bg-red-500';
  return 'bg-slate-400';
}

function formatNumber(n: number, frac = 0): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-ZA', { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

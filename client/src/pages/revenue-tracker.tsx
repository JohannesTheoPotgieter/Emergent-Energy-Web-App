/**
 * Revenue — compact finance template (header → KPI row → drill table → states).
 *
 * Answer-first: "What revenue have we recognised this FY vs plan?" The headline
 * reads the CANONICAL FYTD recognition (company-overview executiveSummary —
 * getCanonicalProjectTotals § 3.3, the same figure Finance Home and the golden
 * oracle use). The drill table below breaks the tracker's monthly recognition
 * down FY → month → project → line → invoice. Presentation only — every figure
 * comes from the canonical endpoints; no formula or number is computed here.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FinanceShell } from '@/components/layout/FinanceShell';
import { FinancialYearScopeControl } from '@/components/finance/FinancialYearScopeControl';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  FinancePageHeader,
  KpiRow,
  KpiTile,
  MoneyValue,
  DrillTable,
  FinanceLoading,
  FinanceEmpty,
  FinanceError,
  type DrillColumn,
} from '@/components/finance/template';
import {
  RevenueMonthDetailDrawer,
  type RevenueDetailFilter,
} from '@/components/finance/revenue-line-drawer';
import { fetchQueryFn, apiRequest, invalidateDashboardQueries } from '@/lib/queryClient';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { usePermission } from '@/hooks/use-permissions';
import { formatZarCompact } from '@/lib/currency';
import { useFinancialYearScope } from '@/hooks/use-financial-year-scope';

interface ProjectBreakdown {
  projectName: string;
  value: number;
}

interface MonthData {
  monthKey: string;
  monthLabel: string;
  totalRevenue: number;
  realisedRevenue: number;
  unrealisedRevenue: number;
  qbRevenueActual: number;
  budget: number;
  revProjects: ProjectBreakdown[];
  realisedProjects: ProjectBreakdown[];
  unrealisedProjects: ProjectBreakdown[];
  qbRevenueProjects: ProjectBreakdown[];
}

/**
 * Editable monthly budget cell — the one manual input on the page, gated by the
 * revenue_tracker:edit permission (not an admin-role shortcut). Writes the
 * manual budget via the existing /api/tracker-monthly endpoint; no finance
 * formula is touched.
 */
function BudgetCell({
  monthKey,
  value,
  canEdit,
  onSave,
}: {
  monthKey: string;
  value: number;
  canEdit: boolean;
  onSave: (budget: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? 0));
  if (!canEdit) return <MoneyValue value={value} muteNegative={false} />;
  if (editing) {
    return (
      <Input
        type="number"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (Number.isFinite(Number(draft)) && draft !== String(value ?? 0)) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="h-7 w-24 text-right font-mono text-xs ml-auto"
        data-testid={`input-budget-${monthKey}`}
      />
    );
  }
  return (
    <button
      type="button"
      className="tabular-nums hover:underline"
      onClick={() => {
        setDraft(String(value ?? 0));
        setEditing(true);
      }}
      data-testid={`cell-budget-${monthKey}`}
    >
      <MoneyValue value={value} muteNegative={false} />
    </button>
  );
}

interface RevenueTrackerResponse {
  months: MonthData[];
  totalMilestoneRevenue: number;
  totalCOS: number;
}

interface CompanyOverviewResponse {
  executiveSummary?: {
    revenueVsTarget?: { actual: number; target: number; pct: number };
  };
}

type DrawerState = {
  monthKey: string;
  monthLabel: string;
  defaultFilter: RevenueDetailFilter;
  defaultProject?: string;
};

/** Per-project breakdown for one month, unioned across the four pipeline arrays. */
function projectRows(m: MonthData) {
  const byName = new Map<
    string,
    { projectName: string; planned: number; committed: number; realised: number; qb: number }
  >();
  const add = (arr: ProjectBreakdown[] | undefined, key: 'planned' | 'committed' | 'realised' | 'qb') => {
    for (const p of arr ?? []) {
      const row =
        byName.get(p.projectName) ??
        { projectName: p.projectName, planned: 0, committed: 0, realised: 0, qb: 0 };
      row[key] += p.value ?? 0;
      byName.set(p.projectName, row);
    }
  };
  add(m.revProjects, 'planned');
  add(m.unrealisedProjects, 'committed');
  add(m.realisedProjects, 'realised');
  add(m.qbRevenueProjects, 'qb');
  return Array.from(byName.values()).sort((a, b) =>
    a.projectName.localeCompare(b.projectName),
  );
}

export default function RevenueTrackerPage() {
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;
  const qc = useQueryClient();
  const { allowed: canEditRevenueTracker } = usePermission('revenue_tracker', 'edit');
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<RevenueTrackerResponse>({
    queryKey: ['/api/revenue-tracker', qs],
    queryFn: fetchQueryFn(`/api/revenue-tracker?${qs}`),
    staleTime: 30_000,
  });

  const budgetMutation = useApiMutation<unknown, unknown, { monthKey: string; budget: string }>({
    mutationFn: (body) =>
      apiRequest('POST', '/api/tracker-monthly', { trackerType: 'REV', monthKey: body.monthKey, budget: body.budget }),
    successToast: 'Budget updated',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/revenue-tracker'] });
      invalidateDashboardQueries(qc);
    },
  });

  // Canonical FYTD recognised revenue — the SAME figure as Finance Home and the
  // golden oracle (executiveSummary.revenueVsTarget = getCanonicalProjectTotals
  // § 3.3, FY-windowed incl. the open month).
  const overviewQuery = useQuery<CompanyOverviewResponse>({
    queryKey: ['/api/company-overview'],
    queryFn: fetchQueryFn('/api/company-overview'),
    staleTime: 60_000,
  });

  const months = useMemo(() => data?.months ?? [], [data]);

  const fy = useMemo(
    () => ({
      planned: months.reduce((s, m) => s + (m.totalRevenue ?? 0), 0),
      committed: months.reduce((s, m) => s + (m.unrealisedRevenue ?? 0), 0),
      quickbooks: months.reduce((s, m) => s + (m.qbRevenueActual ?? 0), 0),
    }),
    [months],
  );

  const recognised = overviewQuery.data?.executiveSummary?.revenueVsTarget ?? null;

  const openDrawer = (m: MonthData, filter: RevenueDetailFilter, project?: string) =>
    setDrawer({ monthKey: m.monthKey, monthLabel: m.monthLabel, defaultFilter: filter, defaultProject: project });

  const moneyCell = (m: MonthData, value: number, filter: RevenueDetailFilter) => (
    <button
      type="button"
      onClick={() => openDrawer(m, filter)}
      className="w-full text-right tabular-nums hover:underline decoration-emerald-300 underline-offset-2"
      data-testid={`cell-${filter}-${m.monthKey}`}
    >
      <MoneyValue value={value} muteNegative={false} />
    </button>
  );

  const columns: DrillColumn<MonthData>[] = [
    { key: 'month', header: 'Month', cell: (m) => <span className="font-medium text-foreground">{m.monthLabel}</span> },
    { key: 'planned', header: 'Planned', numeric: true, cell: (m) => moneyCell(m, m.totalRevenue, 'all') },
    {
      key: 'budget',
      header: 'Budget',
      numeric: true,
      cell: (m) => (
        <BudgetCell
          monthKey={m.monthKey}
          value={m.budget}
          canEdit={canEditRevenueTracker}
          onSave={(budget) => budgetMutation.mutate({ monthKey: m.monthKey, budget })}
        />
      ),
    },
    { key: 'committed', header: 'Committed', numeric: true, cell: (m) => moneyCell(m, m.unrealisedRevenue, 'unrealised') },
    { key: 'realised', header: 'Realised', numeric: true, cell: (m) => moneyCell(m, m.realisedRevenue, 'realised') },
    { key: 'qb', header: 'QuickBooks', numeric: true, cell: (m) => moneyCell(m, m.qbRevenueActual, 'qb_actual') },
  ];

  const renderProjects = (m: MonthData) => {
    const rows = projectRows(m);
    if (rows.length === 0) return <p className="text-xs text-muted-foreground px-2 py-1">No project breakdown for this month.</p>;
    return (
      <table className="w-full text-xs" data-testid={`project-breakdown-${m.monthKey}`}>
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-medium px-2 py-1">Project</th>
            <th className="text-right font-medium px-2 py-1">Planned</th>
            <th className="text-right font-medium px-2 py-1">Committed</th>
            <th className="text-right font-medium px-2 py-1">Realised</th>
            <th className="text-right font-medium px-2 py-1">QuickBooks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.projectName} className="border-t border-slate-100">
              <td className="px-2 py-1">
                <button
                  type="button"
                  className="text-emerald-700 hover:underline text-left"
                  onClick={() => openDrawer(m, 'realised', p.projectName)}
                >
                  {p.projectName}
                </button>
              </td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.planned} muteNegative={false} /></td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.committed} muteNegative={false} /></td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.realised} muteNegative={false} /></td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.qb} muteNegative={false} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  if (isLoading) return <FinanceShell><FinanceLoading label="Loading Revenue…" /></FinanceShell>;
  if (isError) {
    return (
      <FinanceShell>
        <FinanceError
          title="Unable to load Revenue"
          hint={error instanceof Error ? error.message : 'Failed to fetch data'}
          onRetry={() => refetch()}
        />
      </FinanceShell>
    );
  }

  return (
    <FinanceShell>
      <FinancePageHeader
        data-testid="revenue-header"
        title={`Revenue ${fyScope.label}`}
        question="What have we recognised this FY vs plan?"
        source={fyScope.allData ? 'Canonical tracker · ex-VAT' : `${fyScope.startDate} to ${fyScope.endDate} · ex-VAT`}
        period={<FinancialYearScopeControl scope={fyScope} />}
      />

      <KpiRow>
        <KpiTile
          data-testid="kpi-recognised"
          label="Revenue recognised"
          description="FYTD · canonical § 3.3"
          value={recognised ? <MoneyValue value={recognised.actual} align="left" /> : overviewQuery.isLoading ? '…' : '—'}
          tone="positive"
          progress={recognised ? { pct: recognised.pct, tone: 'positive' } : undefined}
          supporting={
            recognised ? (
              <span className="inline-flex items-center gap-1.5">
                <span>vs FY plan {formatZarCompact(recognised.target)} · {recognised.pct}%</span>
                <Badge variant="outline" className="text-[9px] border-status-drift/40 text-status-drift" title="Plan is the planned-revenue proxy, pending a board FY target (P4.4).">
                  Provisional
                </Badge>
              </span>
            ) : overviewQuery.isLoading ? 'Loading…' : 'No data'
          }
        />
        <KpiTile data-testid="kpi-planned" label="Planned" description="FY" value={<MoneyValue value={fy.planned} align="left" />} />
        <KpiTile data-testid="kpi-committed" label="Committed" description="FY" value={<MoneyValue value={fy.committed} align="left" />} tone="warning" />
        <KpiTile data-testid="kpi-quickbooks" label="QuickBooks" description="FY" value={<MoneyValue value={fy.quickbooks} align="left" />} />
      </KpiRow>

      <p className="mt-2 mb-3 text-[11px] text-muted-foreground">
        Headline is FYTD recognition (canonical § 3.3, incl. the open month) — the same figure as
        Finance Home and the golden oracle. The monthly <span className="font-medium">Realised</span> column
        below is the tracker&apos;s per-month recognition in closed months, so its sum is lower than the headline.
      </p>

      <section aria-label="Revenue by month" data-testid="revenue-grid">
        {months.length === 0 ? (
          <FinanceEmpty title="No revenue in this window." hint="Pick a wider financial-year scope, or import a tracker." />
        ) : (
          <DrillTable
            data-testid="revenue-drill-table"
            columns={columns}
            rows={months}
            rowKey={(m) => m.monthKey}
            renderDetail={renderProjects}
            maxBodyHeightClass="max-h-[62vh]"
            caption="Revenue by month across the recognition pipeline; expand a row for the per-project breakdown."
          />
        )}
      </section>

      {drawer && (
        <RevenueMonthDetailDrawer
          key={`${drawer.monthKey}-${drawer.defaultFilter}-${drawer.defaultProject ?? 'all'}`}
          monthKey={drawer.monthKey}
          monthLabel={drawer.monthLabel}
          defaultFilter={drawer.defaultFilter}
          defaultProject={drawer.defaultProject}
          onClose={() => setDrawer(null)}
        />
      )}
    </FinanceShell>
  );
}

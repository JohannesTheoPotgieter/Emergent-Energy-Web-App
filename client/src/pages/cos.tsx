/**
 * Cost of Sales — compact finance template (header → KPI row → drill table →
 * line review). Mirrors the Revenue skeleton: the FY KPI strip + the
 * FY → month → project drill table read the canonical /api/cos-tracker grid
 * (numbers identical to before), and the per-line review actions are kept via
 * the canonical <CosLineReviewPanel>. Presentation only — no figure is computed
 * here.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { FinanceShell } from '@/components/layout/FinanceShell';
import { FinancialYearScopeControl } from '@/components/finance/FinancialYearScopeControl';
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
import { CosLineReviewPanel } from '@/components/cos/cos-line-review-panel';
import { fetchQueryFn } from '@/lib/queryClient';
import { FINANCE_QUERY_VOLATILE } from '@/lib/finance-stale-policy';
import { useFinancialYearScope } from '@/hooks/use-financial-year-scope';
import type { ReconPortfolioResponse } from '@/lib/finance/home-data';
import { ListChecks } from 'lucide-react';

interface ProjectBreakdown {
  projectName: string;
  value: number;
}

interface CosMonthData {
  monthKey: string;
  monthLabel: string;
  cosPlanned: number;
  realisedCOS: number;
  committedCOS: number;
  qbOnlyActual: number;
  cosPlannedProjects: ProjectBreakdown[];
  committedProjects: ProjectBreakdown[];
  realisedProjects: ProjectBreakdown[];
  qbOnlyProjects: ProjectBreakdown[];
}

/** Per-project breakdown for one month, unioned across the pipeline arrays. */
function projectRows(m: CosMonthData) {
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
  add(m.cosPlannedProjects, 'planned');
  add(m.committedProjects, 'committed');
  add(m.realisedProjects, 'realised');
  add(m.qbOnlyProjects, 'qb');
  return Array.from(byName.values()).sort((a, b) =>
    a.projectName.localeCompare(b.projectName),
  );
}

export default function CosTrackerPage() {
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;
  const cosTrackerQueryKey = useMemo(() => ['/api/cos-tracker', qs] as const, [qs]);

  const { data, isLoading, isError, error, refetch } = useQuery<CosMonthData[]>({
    queryKey: cosTrackerQueryKey,
    queryFn: fetchQueryFn(`/api/cos-tracker?${qs}`),
    ...FINANCE_QUERY_VOLATILE,
  });

  const months = useMemo(() => data ?? [], [data]);

  // Resolve project name → id so each row can deep-link to the finance-scoped
  // project page (/projects/:id/finance). The legacy /project/:name route lives
  // in the PROJECT_MANAGEMENT nav-group, which is disabled in finance-only mode
  // and therefore redirects to the finance landing — see shared/config/
  // enabled-modules.ts. The reconciliation portfolio is the same name↔id source
  // Finance Home uses.
  const reconQuery = useQuery<ReconPortfolioResponse>({
    queryKey: ['/api/finance/reconciliation'],
    queryFn: fetchQueryFn('/api/finance/reconciliation'),
    staleTime: 60_000,
  });
  const projectIdByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of reconQuery.data?.projects ?? []) map.set(p.projectName, p.projectId);
    return map;
  }, [reconQuery.data]);

  const fy = useMemo(
    () => ({
      planned: months.reduce((s, m) => s + (m.cosPlanned ?? 0), 0),
      committed: months.reduce((s, m) => s + (m.committedCOS ?? 0), 0),
      realised: months.reduce((s, m) => s + (m.realisedCOS ?? 0), 0),
      quickbooks: months.reduce((s, m) => s + (m.qbOnlyActual ?? 0), 0),
    }),
    [months],
  );

  const columns: DrillColumn<CosMonthData>[] = [
    { key: 'month', header: 'Month', cell: (m) => <span className="font-medium text-foreground">{m.monthLabel}</span> },
    { key: 'planned', header: 'Planned', numeric: true, cell: (m) => <MoneyValue value={m.cosPlanned} muteNegative={false} /> },
    { key: 'committed', header: 'Committed', numeric: true, cell: (m) => <MoneyValue value={m.committedCOS} muteNegative={false} /> },
    { key: 'realised', header: 'Realised', numeric: true, cell: (m) => <MoneyValue value={m.realisedCOS} muteNegative={false} /> },
    { key: 'qb', header: 'QuickBooks', numeric: true, cell: (m) => <MoneyValue value={m.qbOnlyActual} muteNegative={false} /> },
  ];

  const renderProjects = (m: CosMonthData) => {
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
          {rows.map((p) => {
            const projectId = projectIdByName.get(p.projectName);
            return (
            <tr key={p.projectName} className="border-t border-slate-100">
              <td className="px-2 py-1">
                {projectId ? (
                  <Link
                    href={`/projects/${projectId}/finance`}
                    className="text-emerald-700 hover:underline"
                  >
                    {p.projectName}
                  </Link>
                ) : (
                  <span className="text-foreground">{p.projectName}</span>
                )}
              </td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.planned} muteNegative={false} /></td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.committed} muteNegative={false} /></td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.realised} muteNegative={false} /></td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.qb} muteNegative={false} /></td>
            </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  if (isLoading) return <FinanceShell><FinanceLoading label="Loading Cost of Sales…" /></FinanceShell>;
  if (isError) {
    return (
      <FinanceShell>
        <FinanceError
          title="Unable to load Cost of Sales"
          hint={error instanceof Error ? error.message : 'Failed to fetch data'}
          onRetry={() => refetch()}
        />
      </FinanceShell>
    );
  }

  return (
    <FinanceShell>
      <FinancePageHeader
        data-testid="cos-header"
        title={`Cost of Sales ${fyScope.label}`}
        question="What cost of sales have we recognised this FY?"
        source={fyScope.allData ? 'Canonical tracker · ex-VAT' : `${fyScope.startDate} to ${fyScope.endDate} · ex-VAT`}
        period={<FinancialYearScopeControl scope={fyScope} />}
      />

      <KpiRow>
        <KpiTile data-testid="kpi-planned" label="COS Planned" description="FY · P + C + R" value={<MoneyValue value={fy.planned} align="left" />} />
        <KpiTile data-testid="kpi-committed" label="COS Committed" description="FY" value={<MoneyValue value={fy.committed} align="left" />} tone="warning" />
        <KpiTile data-testid="kpi-realised" label="COS Realised" description="FY" value={<MoneyValue value={fy.realised} align="left" />} tone="critical" />
        <KpiTile data-testid="kpi-quickbooks" label="QuickBooks COS" description="FY" value={<MoneyValue value={fy.quickbooks} align="left" />} />
      </KpiRow>

      <section aria-label="Cost of sales by month" data-testid="cos-grid" className="mt-3">
        {months.length === 0 ? (
          <FinanceEmpty title="No cost of sales in this window." hint="Pick a wider financial-year scope, or import a tracker." />
        ) : (
          <DrillTable
            data-testid="cos-drill-table"
            columns={columns}
            rows={months}
            rowKey={(m) => m.monthKey}
            renderDetail={renderProjects}
            maxBodyHeightClass="max-h-[55vh]"
            caption="Cost of sales by month across the recognition pipeline; expand a row for the per-project breakdown."
          />
        )}
      </section>

      <section aria-label="Line review" data-testid="cos-line-review" className="mt-4">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground mb-2">
          <ListChecks className="h-4 w-4 text-brand-green" />
          Line review
        </h2>
        <CosLineReviewPanel cosTrackerQueryKey={cosTrackerQueryKey} />
      </section>
    </FinanceShell>
  );
}

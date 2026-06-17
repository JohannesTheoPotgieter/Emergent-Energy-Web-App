/**
 * Cost of Sales — compact finance template (header → KPI row → drill table →
 * line review). Mirrors the Revenue skeleton: the FY KPI strip + the
 * FY → month → project drill table read the canonical /api/cos-tracker grid
 * (numbers identical to before), and the per-line review actions are kept via
 * the canonical <CosLineReviewPanel>. Presentation only — no figure is computed
 * here.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { BudgetProgressCard } from '@/components/finance/BudgetProgressCard';
import { Input } from '@/components/ui/input';
import { fetchQueryFn, apiRequest, invalidateDashboardQueries } from '@/lib/queryClient';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { usePermission } from '@/hooks/use-permissions';
import { FINANCE_QUERY_VOLATILE } from '@/lib/finance-stale-policy';
import { useFinancialYearScope } from '@/hooks/use-financial-year-scope';
import { budgetDelta, budgetPctLabel } from '@/lib/finance/budget-variance';
import { FinanceLineDetailDrawer, type FinanceDetailStateFilter } from '@/components/finance/finance-line-detail-drawer';
import { ListChecks } from 'lucide-react';

interface ProjectBreakdown {
  projectName: string;
  value: number;
}

interface CosMonthData {
  monthKey: string;
  monthLabel: string;
  cosPlanned: number;
  cosUnrealised: number;
  realisedCOS: number;
  committedCOS: number;
  budget: number;
  qbOnlyActual: number;
  cosPlannedProjects: ProjectBreakdown[];
  committedProjects: ProjectBreakdown[];
  cosUnrealisedProjects: ProjectBreakdown[];
  realisedProjects: ProjectBreakdown[];
  qbOnlyProjects: ProjectBreakdown[];
}

/** Per-project breakdown for one month, unioned across the pipeline arrays. */
function projectRows(m: CosMonthData) {
  const byName = new Map<
    string,
    { projectName: string; planned: number; committed: number; unrealised: number; realised: number; qb: number }
  >();
  const add = (arr: ProjectBreakdown[] | undefined, key: 'planned' | 'committed' | 'unrealised' | 'realised' | 'qb') => {
    for (const p of arr ?? []) {
      const row =
        byName.get(p.projectName) ??
        { projectName: p.projectName, planned: 0, committed: 0, unrealised: 0, realised: 0, qb: 0 };
      row[key] += p.value ?? 0;
      byName.set(p.projectName, row);
    }
  };
  add(m.cosPlannedProjects, 'planned');
  add(m.committedProjects, 'committed');
  add(m.cosUnrealisedProjects, 'unrealised');
  add(m.realisedProjects, 'realised');
  add(m.qbOnlyProjects, 'qb');
  return Array.from(byName.values()).sort((a, b) =>
    a.projectName.localeCompare(b.projectName),
  );
}

/**
 * Editable monthly COS budget cell — the manually-captured annual budget
 * (revised at half-year). Gated by cos:edit (COO / CFO / PFM / Accountant /
 * Construction Manager per the permission registry). Writes the manual budget
 * via /api/tracker-monthly (trackerType COS); no finance formula is touched.
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
        className="h-7 w-28 text-right font-mono text-xs ml-auto"
        data-testid={`input-cos-budget-${monthKey}`}
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
      data-testid={`cell-cos-budget-${monthKey}`}
    >
      <MoneyValue value={value} muteNegative={false} />
    </button>
  );
}

export default function CosTrackerPage() {
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;
  const qc = useQueryClient();
  const { allowed: canEditCos } = usePermission('cos', 'edit');
  const cosTrackerQueryKey = useMemo(() => ['/api/cos-tracker', qs] as const, [qs]);

  const budgetMutation = useApiMutation<unknown, unknown, { monthKey: string; budget: string }>({
    mutationFn: (body) =>
      apiRequest('POST', '/api/tracker-monthly', { trackerType: 'COS', monthKey: body.monthKey, budget: body.budget }),
    successToast: 'COS budget updated',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/cos-tracker'] });
      invalidateDashboardQueries(qc);
    },
  });

  const { data, isLoading, isError, error, refetch } = useQuery<CosMonthData[]>({
    queryKey: cosTrackerQueryKey,
    queryFn: fetchQueryFn(`/api/cos-tracker?${qs}`),
    ...FINANCE_QUERY_VOLATILE,
  });

  const months = useMemo(() => data ?? [], [data]);

  const [drawer, setDrawer] = useState<{
    monthKey: string;
    monthLabel: string;
    defaultFilter: FinanceDetailStateFilter;
    defaultProject?: string;
  } | null>(null);

  const openDrawer = (m: CosMonthData, filter: FinanceDetailStateFilter, project?: string) =>
    setDrawer({ monthKey: m.monthKey, monthLabel: m.monthLabel, defaultFilter: filter, defaultProject: project });

  const moneyCell = (m: CosMonthData, value: number, filter: FinanceDetailStateFilter) => (
    <button
      type="button"
      onClick={() => openDrawer(m, filter)}
      className="w-full text-right tabular-nums hover:underline decoration-emerald-300 underline-offset-2"
      data-testid={`cell-${filter}-${m.monthKey}`}
    >
      <MoneyValue value={value} muteNegative={false} />
    </button>
  );

  const fy = useMemo(
    () => ({
      budget: months.reduce((s, m) => s + (m.budget ?? 0), 0),
      planned: months.reduce((s, m) => s + (m.cosPlanned ?? 0), 0),
      committed: months.reduce((s, m) => s + (m.committedCOS ?? 0), 0),
      realised: months.reduce((s, m) => s + (m.realisedCOS ?? 0), 0),
      quickbooks: months.reduce((s, m) => s + (m.qbOnlyActual ?? 0), 0),
    }),
    [months],
  );

  const columns: DrillColumn<CosMonthData>[] = [
    { key: 'month', header: 'Month', cell: (m) => <span className="font-medium text-foreground">{m.monthLabel}</span>, sortValue: (m) => m.monthKey, exportValue: (m) => m.monthLabel },
    {
      key: 'budget',
      header: 'Budget',
      numeric: true,
      cell: (m) => (
        <BudgetCell
          monthKey={m.monthKey}
          value={m.budget}
          canEdit={canEditCos}
          onSave={(budget) => budgetMutation.mutate({ monthKey: m.monthKey, budget })}
        />
      ),
      sortValue: (m) => m.budget,
    },
    { key: 'planned', header: 'Planned', numeric: true, cell: (m) => <MoneyValue value={m.cosPlanned} muteNegative={false} />, sortValue: (m) => m.cosPlanned },
    { key: 'committed', header: 'Committed', numeric: true, cell: (m) => <MoneyValue value={m.committedCOS} muteNegative={false} />, sortValue: (m) => m.committedCOS },
    { key: 'unrealised', header: 'Unrealised', numeric: true, cell: (m) => moneyCell(m, m.cosUnrealised, 'unrealised'), sortValue: (m) => m.cosUnrealised },
    { key: 'realised', header: 'Realised', numeric: true, cell: (m) => moneyCell(m, m.realisedCOS, 'realised'), sortValue: (m) => m.realisedCOS },
    { key: 'qb', header: 'QuickBooks', numeric: true, hideBelowMd: true, cell: (m) => moneyCell(m, m.qbOnlyActual, 'qb_actual'), sortValue: (m) => m.qbOnlyActual },
    {
      key: 'varRealised',
      header: 'Realised vs Budget',
      numeric: true,
      cell: (m) => (
        <span className="tabular-nums">
          <MoneyValue value={budgetDelta(m.realisedCOS, m.budget)} muteNegative={false} />{' '}
          <span className="text-muted-foreground">({budgetPctLabel(m.realisedCOS, m.budget)})</span>
        </span>
      ),
      sortValue: (m) => budgetDelta(m.realisedCOS, m.budget),
    },
    {
      key: 'varPlanned',
      header: 'Planned vs Budget',
      numeric: true,
      hideBelowMd: true,
      cell: (m) => (
        <span className="tabular-nums">
          <MoneyValue value={budgetDelta(m.cosPlanned, m.budget)} muteNegative={false} />{' '}
          <span className="text-muted-foreground">({budgetPctLabel(m.cosPlanned, m.budget)})</span>
        </span>
      ),
      sortValue: (m) => budgetDelta(m.cosPlanned, m.budget),
    },
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
            <th className="text-right font-medium px-2 py-1">Unrealised</th>
            <th className="text-right font-medium px-2 py-1">Realised</th>
            <th className="text-right font-medium px-2 py-1">QuickBooks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            return (
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
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.unrealised} muteNegative={false} /></td>
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

      <div className="mt-3">
        <BudgetProgressCard
          data-testid="cos-budget-progress"
          budget={fy.budget}
          rows={[
            { label: 'Planned', value: fy.planned },
            { label: 'Realised', value: fy.realised },
          ]}
        />
      </div>

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
            sortable
            exportFilename={`cost-of-sales-by-month-${fyScope.label.replace(/\s+/g, '-')}`}
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

      {drawer && (
        <FinanceLineDetailDrawer
          key={`${drawer.monthKey}-${drawer.defaultFilter}-${drawer.defaultProject ?? 'all'}`}
          variant="cos"
          title={drawer.monthLabel}
          monthKey={drawer.monthKey}
          defaultFilter={drawer.defaultFilter}
          defaultProject={drawer.defaultProject}
          onClose={() => setDrawer(null)}
        />
      )}
    </FinanceShell>
  );
}

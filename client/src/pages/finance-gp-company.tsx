/**
 * Gross Profit — company-wide, compact finance template
 * (header → KPI row → per-project drill table). GP is derived client-side as
 * Revenue − COS from the SAME canonical trackers the Revenue and COS pages read
 * (/api/revenue-tracker + /api/cos-tracker), month by month; per-project GP is
 * the union of the two per-project breakdowns. Presentation only — every figure
 * is unchanged from before.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
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
import { fetchQueryFn } from '@/lib/queryClient';
import { useFinancialYearScope } from '@/hooks/use-financial-year-scope';

interface ProjBreak {
  projectName: string;
  value: number;
}

interface CosMonthData {
  monthKey: string;
  monthLabel: string;
  cosPlanned: number;
  realisedCOS: number;
  budget: number;
  qbOnlyActual: number;
  cosPlannedProjects: ProjBreak[];
  realisedProjects: ProjBreak[];
}

interface RevMonthData {
  monthKey: string;
  monthLabel: string;
  totalRevenue: number;
  realisedRevenue: number;
  budget: number;
  qbRevenueActual: number;
  revProjects: ProjBreak[];
  realisedProjects: ProjBreak[];
}

interface RevTrackerResponse {
  months: RevMonthData[];
}

interface GpMonth {
  monthKey: string;
  monthLabel: string;
  budgetGP: number;
  plannedRevenue: number;
  plannedGP: number;
  realisedGP: number;
  qbGP: number;
  plannedMarginPct: number;
  gpPlannedProjects: ProjBreak[];
  gpRealisedProjects: ProjBreak[];
}

const marginPct = (gp: number, rev: number) => (rev !== 0 ? (gp / rev) * 100 : 0);

/** Per-project GP = revenue − cos across the union of project names. */
function mergeProjectGP(rev: ProjBreak[], cos: ProjBreak[]): ProjBreak[] {
  const revMap = new Map(rev.map((p) => [p.projectName, p.value]));
  const cosMap = new Map(cos.map((p) => [p.projectName, p.value]));
  const names = new Set([...revMap.keys(), ...cosMap.keys()]);
  return Array.from(names)
    .map((projectName) => ({ projectName, value: (revMap.get(projectName) ?? 0) - (cosMap.get(projectName) ?? 0) }))
    .sort((a, b) => b.value - a.value);
}

export default function FinanceGpCompanyPage() {
  const [, navigate] = useLocation();
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;

  const cosQuery = useQuery<CosMonthData[]>({
    queryKey: ['/api/cos-tracker', qs],
    queryFn: fetchQueryFn(`/api/cos-tracker?${qs}`),
    staleTime: 30_000,
  });
  const revQuery = useQuery<RevTrackerResponse>({
    queryKey: ['/api/revenue-tracker', qs],
    queryFn: fetchQueryFn(`/api/revenue-tracker?${qs}`),
    staleTime: 30_000,
  });

  const months = useMemo<GpMonth[]>(() => {
    const cosMonths = cosQuery.data ?? [];
    const revByKey = new Map((revQuery.data?.months ?? []).map((m) => [m.monthKey, m]));
    return cosMonths.map((cos) => {
      const rev = revByKey.get(cos.monthKey);
      const plannedRevenue = rev?.totalRevenue ?? 0;
      const plannedCOS = cos.cosPlanned ?? 0;
      const plannedGP = plannedRevenue - plannedCOS;
      const realisedGP = (rev?.realisedRevenue ?? 0) - (cos.realisedCOS ?? 0);
      const budgetGP = (rev?.budget ?? 0) - (cos.budget ?? 0);
      const qbGP = (rev?.qbRevenueActual ?? 0) - (cos.qbOnlyActual ?? 0);
      return {
        monthKey: cos.monthKey,
        monthLabel: cos.monthLabel,
        budgetGP,
        plannedRevenue,
        plannedGP,
        realisedGP,
        qbGP,
        plannedMarginPct: marginPct(plannedGP, plannedRevenue),
        gpPlannedProjects: mergeProjectGP(rev?.revProjects ?? [], cos.cosPlannedProjects ?? []),
        gpRealisedProjects: mergeProjectGP(rev?.realisedProjects ?? [], cos.realisedProjects ?? []),
      };
    });
  }, [cosQuery.data, revQuery.data]);

  const fy = useMemo(() => {
    const budgetGP = months.reduce((s, m) => s + m.budgetGP, 0);
    const plannedRevenue = months.reduce((s, m) => s + m.plannedRevenue, 0);
    const plannedGP = months.reduce((s, m) => s + m.plannedGP, 0);
    const realisedGP = months.reduce((s, m) => s + m.realisedGP, 0);
    return { budgetGP, plannedGP, realisedGP, plannedMarginPct: marginPct(plannedGP, plannedRevenue) };
  }, [months]);

  const columns: DrillColumn<GpMonth>[] = [
    { key: 'month', header: 'Month', cell: (m) => <span className="font-medium text-foreground">{m.monthLabel}</span> },
    { key: 'budgetGP', header: 'Budget GP', numeric: true, cell: (m) => <MoneyValue value={m.budgetGP} muteNegative={false} /> },
    { key: 'plannedGP', header: 'Planned GP', numeric: true, cell: (m) => <MoneyValue value={m.plannedGP} muteNegative={false} /> },
    { key: 'realisedGP', header: 'Realised GP', numeric: true, cell: (m) => <MoneyValue value={m.realisedGP} muteNegative={false} /> },
    { key: 'qbGP', header: 'QB GP', numeric: true, cell: (m) => <MoneyValue value={m.qbGP} muteNegative={false} /> },
    { key: 'margin', header: 'Planned Margin', numeric: true, cell: (m) => <span className="tabular-nums">{m.plannedMarginPct.toFixed(1)}%</span> },
  ];

  const renderProjects = (m: GpMonth) => {
    const byName = new Map<string, { projectName: string; plannedGP: number; realisedGP: number }>();
    for (const p of m.gpPlannedProjects) byName.set(p.projectName, { projectName: p.projectName, plannedGP: p.value, realisedGP: 0 });
    for (const p of m.gpRealisedProjects) {
      const row = byName.get(p.projectName) ?? { projectName: p.projectName, plannedGP: 0, realisedGP: 0 };
      row.realisedGP = p.value;
      byName.set(p.projectName, row);
    }
    const rows = Array.from(byName.values()).sort((a, b) => b.realisedGP - a.realisedGP);
    if (rows.length === 0) return <p className="text-xs text-muted-foreground px-2 py-1">No project breakdown for this month.</p>;
    return (
      <table className="w-full text-xs" data-testid={`gp-breakdown-${m.monthKey}`}>
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-medium px-2 py-1">Project</th>
            <th className="text-right font-medium px-2 py-1">Planned GP</th>
            <th className="text-right font-medium px-2 py-1">Realised GP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.projectName} className="border-t border-slate-100">
              <td className="px-2 py-1">
                <button
                  type="button"
                  className="text-emerald-700 hover:underline text-left"
                  onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}?tab=revenue-tracking`)}
                >
                  {p.projectName}
                </button>
              </td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.plannedGP} muteNegative={false} /></td>
              <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={p.realisedGP} muteNegative={false} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const isLoading = cosQuery.isLoading || revQuery.isLoading;
  const isError = cosQuery.isError || revQuery.isError;

  if (isLoading) return <FinanceShell><FinanceLoading label="Loading Gross Profit…" /></FinanceShell>;
  if (isError) {
    return (
      <FinanceShell>
        <FinanceError title="Unable to load Gross Profit" onRetry={() => { cosQuery.refetch(); revQuery.refetch(); }} />
      </FinanceShell>
    );
  }

  return (
    <FinanceShell>
      <FinancePageHeader
        data-testid="gp-company-header"
        title={`Gross Profit ${fyScope.label}`}
        question="What gross profit have we earned this FY, by month and project?"
        source={fyScope.allData ? 'Revenue − COS · canonical trackers · ex-VAT' : `${fyScope.startDate} to ${fyScope.endDate} · ex-VAT`}
        period={<FinancialYearScopeControl scope={fyScope} />}
      />

      <KpiRow>
        <KpiTile data-testid="kpi-budget-gp" label="Budget GP" description="FY" value={<MoneyValue value={fy.budgetGP} align="left" />} />
        <KpiTile data-testid="kpi-planned-gp" label="Planned GP" description="FY · all states" value={<MoneyValue value={fy.plannedGP} align="left" />} />
        <KpiTile data-testid="kpi-realised-gp" label="Realised GP" description="FY" value={<MoneyValue value={fy.realisedGP} align="left" />} tone="positive" />
        <KpiTile data-testid="kpi-planned-margin" label="Planned Margin" description="Planned GP / Revenue" value={<span className="tabular-nums">{fy.plannedMarginPct.toFixed(1)}%</span>} />
      </KpiRow>

      <section aria-label="Gross profit by month" data-testid="gp-grid" className="mt-3">
        {months.length === 0 ? (
          <FinanceEmpty title="No gross profit in this window." hint="Pick a wider financial-year scope, or import a tracker." />
        ) : (
          <DrillTable
            data-testid="gp-drill-table"
            columns={columns}
            rows={months}
            rowKey={(m) => m.monthKey}
            renderDetail={renderProjects}
            maxBodyHeightClass="max-h-[60vh]"
            caption="Gross profit by month (Revenue − COS); expand a row for the per-project breakdown."
          />
        )}
      </section>
    </FinanceShell>
  );
}

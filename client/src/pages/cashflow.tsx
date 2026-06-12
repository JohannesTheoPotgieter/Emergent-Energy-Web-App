/**
 * Cashflow — compact finance template (header → KPI row → week drill table →
 * AR/AP/missing-invoice worklists). Reads the canonical /api/weekly-cashflow
 * series; the two operationally-critical overrides (opening balance + available
 * payment) are kept via the existing <EditCellPopover>/<OverrideChipMenu>.
 * Presentation only — no figure or formula is computed here.
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FinanceShell } from '@/components/layout/FinanceShell';
import { FinancialYearScopeControl } from '@/components/finance/FinancialYearScopeControl';
import { Badge } from '@/components/ui/badge';
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
import { EditCellPopover } from '@/components/cashflow/EditCellPopover';
import { CashflowWorklists } from '@/components/cashflow/cashflow-worklists';
import { fetchQueryFn, apiRequest, invalidateDashboardQueries } from '@/lib/queryClient';
import { useFinancialYearScope } from '@/hooks/use-financial-year-scope';
import { usePermission } from '@/hooks/use-permissions';

const CASHFLOW_API_BASE = '/api/weekly-cashflow';

interface CashflowWeek {
  weekStart: string;
  weekEnd: string;
  openingBalance: number;
  computedOpening: number;
  hasManualOverride: boolean;
  balanceDelta: number;
  projectInflows: number;
  opexOutflows: number;
  projectOutflows: number;
  closingBalance: number;
  availablePayment: number;
  computedAvailablePayment: number;
  hasAvailPayOverride: boolean;
  availPayReason: string | null;
}

const todayIso = new Date().toISOString().slice(0, 10);

function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

export default function CashflowPage() {
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;
  const qc = useQueryClient();
  const { allowed: canEditCashflow } = usePermission('cashflow', 'edit');

  const cashflowQueryKey = useMemo(() => [CASHFLOW_API_BASE, qs] as const, [qs]);

  const { data, isLoading, isError, error, refetch } = useQuery<{ weeks: CashflowWeek[] }>({
    queryKey: cashflowQueryKey,
    queryFn: fetchQueryFn(`${CASHFLOW_API_BASE}?${qs}`),
    staleTime: 30_000,
  });

  const weeks = useMemo(() => data?.weeks ?? [], [data]);

  const kpis = useMemo(() => {
    const totalInflows = weeks.reduce((s, w) => s + w.projectInflows, 0);
    const totalOutflows = weeks.reduce((s, w) => s + (w.opexOutflows + w.projectOutflows), 0);
    const currentWeek =
      weeks.find((w) => w.weekStart <= todayIso && todayIso < w.weekEnd) ?? weeks[0] ?? null;
    const currentOpening = currentWeek?.openingBalance ?? 0;
    const forecast = weeks.length ? weeks[weeks.length - 1].closingBalance : 0;
    return { totalInflows, totalOutflows, currentOpening, forecast, currentWeekStart: currentWeek?.weekStart ?? null };
  }, [weeks]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
    invalidateDashboardQueries(qc);
  };

  const saveOpening = useMutation({
    mutationFn: (a: { weekStartDate: string; openingBalance: number; computedValue: number }) =>
      apiRequest('POST', `${CASHFLOW_API_BASE}/opening-balance`, { ...a, clearForward: true }),
    onSuccess: invalidate,
  });
  const resetOpening = useMutation({
    mutationFn: (weekStartDate: string) => apiRequest('DELETE', `${CASHFLOW_API_BASE}/opening-balance`, { weekStartDate }),
    onSuccess: invalidate,
  });
  const saveAvail = useMutation({
    mutationFn: (a: { weekStartDate: string; overrideValue: number; reason: string; computedValue: number }) =>
      apiRequest('POST', `${CASHFLOW_API_BASE}/available-payment`, a),
    onSuccess: invalidate,
  });
  const resetAvail = useMutation({
    mutationFn: (weekStartDate: string) => apiRequest('DELETE', `${CASHFLOW_API_BASE}/available-payment`, { weekStartDate }),
    onSuccess: invalidate,
  });

  const isCurrent = (w: CashflowWeek) => w.weekStart === kpis.currentWeekStart;

  const openingCell = (w: CashflowWeek) => {
    const display = <MoneyValue value={w.openingBalance} />;
    if (!canEditCashflow) {
      return w.hasManualOverride ? (
        <span className="inline-flex items-center gap-1 justify-end">
          {display}
          <Badge variant="outline" className="text-[9px] border-amber-200 text-amber-700">override</Badge>
        </span>
      ) : (
        display
      );
    }
    return (
      <EditCellPopover
        trigger={
          <button type="button" className="tabular-nums hover:underline inline-flex items-center gap-1">
            {display}
            {w.hasManualOverride && (
              <Badge variant="outline" className="text-[9px] border-amber-200 text-amber-700">override</Badge>
            )}
          </button>
        }
        weekLabel={weekLabel(w.weekStart)}
        fieldLabel="Opening Balance"
        currentValue={w.openingBalance}
        computedValue={w.computedOpening}
        hasOverride={w.hasManualOverride}
        requireReason={false}
        onSave={({ value }) => saveOpening.mutate({ weekStartDate: w.weekStart, openingBalance: value, computedValue: w.computedOpening })}
        onResetToComputed={() => resetOpening.mutate(w.weekStart)}
        isSaving={saveOpening.isPending}
        isResetting={resetOpening.isPending}
        testIdPrefix={`opening-${w.weekStart}`}
      />
    );
  };

  const availCell = (w: CashflowWeek) => {
    const display = <MoneyValue value={w.availablePayment} muteNegative={false} />;
    if (!canEditCashflow) return display;
    return (
      <EditCellPopover
        trigger={<button type="button" id={isCurrent(w) ? 'kb-edit-current-availpay' : undefined} className="tabular-nums hover:underline">{display}</button>}
        weekLabel={weekLabel(w.weekStart)}
        fieldLabel="Available Payment"
        currentValue={w.availablePayment}
        computedValue={w.computedAvailablePayment}
        hasOverride={w.hasAvailPayOverride}
        requireReason
        defaultReason={w.availPayReason}
        onSave={({ value, reason }) => saveAvail.mutate({ weekStartDate: w.weekStart, overrideValue: value, reason, computedValue: w.computedAvailablePayment })}
        onResetToComputed={() => resetAvail.mutate(w.weekStart)}
        isSaving={saveAvail.isPending}
        isResetting={resetAvail.isPending}
        testIdPrefix={`availpay-${w.weekStart}`}
        helperText="Computed = Opening + Inflows − All Outflows. A reason is required."
      />
    );
  };

  const columns: DrillColumn<CashflowWeek>[] = [
    {
      key: 'week',
      header: 'Week',
      cell: (w) => (
        <span className="inline-flex items-center gap-2 font-medium text-foreground">
          {weekLabel(w.weekStart)}
          {isCurrent(w) && <Badge variant="outline" className="text-[9px] border-emerald-300 text-emerald-700">NOW</Badge>}
        </span>
      ),
    },
    { key: 'opening', header: 'Opening', numeric: true, cell: openingCell },
    { key: 'inflows', header: 'Inflows', numeric: true, cell: (w) => <MoneyValue value={w.projectInflows} muteNegative={false} /> },
    { key: 'outflows', header: 'Outflows', numeric: true, cell: (w) => <MoneyValue value={w.opexOutflows + w.projectOutflows} muteNegative={false} /> },
    { key: 'closing', header: 'Closing', numeric: true, cell: (w) => <MoneyValue value={w.closingBalance} muteNegative={false} /> },
    { key: 'available', header: 'Available', numeric: true, cell: availCell },
  ];

  if (isLoading) return <FinanceShell><FinanceLoading label="Loading Cashflow…" /></FinanceShell>;
  if (isError) {
    return (
      <FinanceShell>
        <FinanceError
          title="Unable to load Cashflow"
          hint={error instanceof Error ? error.message : 'Failed to fetch data'}
          onRetry={() => refetch()}
        />
      </FinanceShell>
    );
  }

  return (
    <FinanceShell>
      <FinancePageHeader
        data-testid="cashflow-header"
        title={`Cashflow ${fyScope.label}`}
        question="What cash is coming in, going out, and available to pay each week?"
        source={fyScope.allData ? 'Canonical weekly cashflow · paid / received dates' : `${fyScope.startDate} to ${fyScope.endDate}`}
        period={<FinancialYearScopeControl scope={fyScope} />}
        actions={!canEditCashflow ? <Badge variant="outline" className="text-[10px]">Read-only</Badge> : undefined}
      />

      <KpiRow>
        <KpiTile
          data-testid="kpi-forecast"
          label="Forecast end-of-FY"
          description="Bank position"
          value={<MoneyValue value={kpis.forecast} align="left" muteNegative={false} />}
          tone={kpis.forecast >= 0 ? 'positive' : 'critical'}
        />
        <KpiTile data-testid="kpi-inflows" label="Inflows YTD" value={<MoneyValue value={kpis.totalInflows} align="left" />} tone="positive" />
        <KpiTile data-testid="kpi-outflows" label="Outflows YTD" value={<MoneyValue value={kpis.totalOutflows} align="left" />} tone="critical" />
        <KpiTile
          data-testid="kpi-current-opening"
          label="Current week opening"
          value={<MoneyValue value={kpis.currentOpening} align="left" muteNegative={false} />}
          tone={kpis.currentOpening >= 0 ? 'positive' : 'critical'}
        />
      </KpiRow>

      <section aria-label="Weekly cashflow" data-testid="cashflow-week-grid" className="mt-3">
        {weeks.length === 0 ? (
          <FinanceEmpty title="No weeks in this window." hint="Pick a wider financial-year scope." />
        ) : (
          <DrillTable
            data-testid="cashflow-drill-table"
            columns={columns}
            rows={weeks}
            rowKey={(w) => w.weekStart}
            maxBodyHeightClass="max-h-[55vh]"
            caption="Weekly cashflow — opening, inflows, outflows, closing and available payment."
          />
        )}
      </section>

      <section aria-label="Worklists" data-testid="cashflow-worklists-section" className="mt-4">
        <CashflowWorklists projectParam={undefined} />
      </section>
    </FinanceShell>
  );
}

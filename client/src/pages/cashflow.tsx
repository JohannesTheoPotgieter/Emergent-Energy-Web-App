/**
 * Cashflow — compact finance template (header → KPI row → week drill table →
 * AR/AP/missing-invoice worklists). Reads the canonical /api/weekly-cashflow
 * series; the two operationally-critical overrides (opening balance + available
 * payment) are kept via the existing <EditCellPopover>, and the per-week drill
 * keeps the QuickBooks match-and-link workflow. Presentation only — no figure or
 * formula is computed here.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FinanceShell } from '@/components/layout/FinanceShell';
import { FinancialYearScopeControl } from '@/components/finance/FinancialYearScopeControl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
import { FindQbMatchesPanel } from '@/components/quickbooks/FindQbMatchesPanel';
import { fetchQueryFn, apiRequest, invalidateDashboardQueries } from '@/lib/queryClient';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { FINANCE_QUERY_STABLE } from '@/lib/finance-stale-policy';
import { useFinancialYearScope } from '@/hooks/use-financial-year-scope';
import { usePermission } from '@/hooks/use-permissions';
import { Link2, ChevronDown } from 'lucide-react';

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

interface DetailInflow {
  inflowId: number;
  projectName: string;
  milestoneName: string;
  milestoneInvoiceNumber: string;
  milestoneAmount: number;
  qbStatus?: 'confirmed' | 'unlinked';
  qbDocNumber?: string | null;
}
interface DetailOutflow {
  expenseId: number;
  projectName: string;
  expenseLineItem: string;
  expenseInvoiceNumber: string;
  expenseActualTotal: number;
  qbStatus?: 'confirmed' | 'unlinked';
  qbDocNumber?: string | null;
}
interface WeekDetail {
  inflows: DetailInflow[];
  outflows: DetailOutflow[];
}

type QbMatchScope = 'cost' | 'revenue';
type QbLinkContext = {
  scope: QbMatchScope;
  initialSearch: string;
  label: string;
};

const todayIso = new Date().toISOString().slice(0, 10);

function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

/**
 * Per-week line drill (FY → week → line) with the QuickBooks match-and-link
 * affordance preserved. Reads the canonical /api/weekly-cashflow/detail.
 */
function WeekQbDetail({
  week,
  fyParam,
  onOpenQbLink,
}: {
  week: CashflowWeek;
  fyParam: string;
  onOpenQbLink: (ctx: QbLinkContext) => void;
}) {
  const { data, isLoading } = useQuery<WeekDetail>({
    queryKey: [`${CASHFLOW_API_BASE}/detail`, week.weekStart, fyParam],
    queryFn: fetchQueryFn(`${CASHFLOW_API_BASE}/detail?week=${week.weekStart}&fy=${fyParam}`),
    staleTime: 30_000,
  });
  if (isLoading) return <p className="px-2 py-2 text-xs text-muted-foreground">Loading week detail…</p>;
  const inflows = data?.inflows ?? [];
  const outflows = data?.outflows ?? [];
  if (inflows.length === 0 && outflows.length === 0)
    return <p className="px-2 py-2 text-xs text-muted-foreground">No line detail for this week.</p>;
  return (
    <div className="grid gap-4 text-xs md:grid-cols-2">
      <div>
        <p className="mb-1 font-semibold text-emerald-700">Inflows</p>
        {inflows.length === 0 ? (
          <p className="text-muted-foreground">None</p>
        ) : (
          inflows.map((inf, i) => (
            <div key={inf.inflowId} className="flex items-center justify-between gap-2 border-t border-slate-100 py-1">
              <span className="truncate" title={`${inf.projectName} · ${inf.milestoneName}`}>
                {inf.projectName} · {inf.milestoneName}
              </span>
              <span className="inline-flex shrink-0 items-center gap-2">
                <MoneyValue value={inf.milestoneAmount} />
                {inf.qbStatus !== 'confirmed' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="touch-compact h-4 px-1 text-[9px] text-amber-800 hover:text-amber-900"
                    aria-label="Open QuickBooks match"
                    title="Open QuickBooks match"
                    data-testid={`button-qb-link-inflow-${week.weekStart}-${i}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenQbLink({
                        scope: 'revenue',
                        initialSearch: inf.milestoneInvoiceNumber?.trim() || inf.qbDocNumber?.trim() || inf.projectName,
                        label: inf.milestoneInvoiceNumber || inf.projectName,
                      });
                    }}
                  >
                    <Link2 className="h-3 w-3" />
                    Link
                  </Button>
                )}
              </span>
            </div>
          ))
        )}
      </div>
      <div>
        <p className="mb-1 font-semibold text-rose-700">Outflows</p>
        {outflows.length === 0 ? (
          <p className="text-muted-foreground">None</p>
        ) : (
          outflows.map((out, i) => (
            <div key={out.expenseId} className="flex items-center justify-between gap-2 border-t border-slate-100 py-1">
              <span className="truncate" title={`${out.projectName} · ${out.expenseLineItem}`}>
                {out.projectName} · {out.expenseLineItem}
              </span>
              <span className="inline-flex shrink-0 items-center gap-2">
                <MoneyValue value={out.expenseActualTotal} />
                {out.qbStatus !== 'confirmed' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="touch-compact h-4 px-1 text-[9px] text-amber-800 hover:text-amber-900"
                    aria-label="Open QuickBooks match"
                    title="Open QuickBooks match"
                    data-testid={`button-qb-link-outflow-${week.weekStart}-${i}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenQbLink({
                        scope: 'cost',
                        initialSearch: out.expenseInvoiceNumber?.trim() || out.qbDocNumber?.trim() || out.projectName,
                        label: out.expenseInvoiceNumber || out.projectName,
                      });
                    }}
                  >
                    <Link2 className="h-3 w-3" />
                    Link
                  </Button>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function CashflowPage() {
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;
  const qc = useQueryClient();
  const { allowed: canEditCashflow } = usePermission('cashflow', 'edit');
  const [qbLinkContext, setQbLinkContext] = useState<QbLinkContext | null>(null);

  const cashflowQueryKey = useMemo(() => [CASHFLOW_API_BASE, qs] as const, [qs]);

  const { data, isLoading, isError, error, refetch } = useQuery<{ weeks: CashflowWeek[] }>({
    queryKey: cashflowQueryKey,
    queryFn: fetchQueryFn(`${CASHFLOW_API_BASE}?${qs}`),
    ...FINANCE_QUERY_STABLE,
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

  const saveOpening = useApiMutation<unknown, unknown, { weekStartDate: string; openingBalance: number; computedValue: number }>({
    mutationFn: (a) => apiRequest('POST', `${CASHFLOW_API_BASE}/opening-balance`, { ...a, clearForward: true }),
    successToast: 'Opening balance updated',
    onSuccess: invalidate,
  });
  const resetOpening = useApiMutation<unknown, unknown, string>({
    mutationFn: (weekStartDate) => apiRequest('DELETE', `${CASHFLOW_API_BASE}/opening-balance`, { weekStartDate }),
    successToast: 'Override cleared',
    onSuccess: invalidate,
  });
  const saveAvail = useApiMutation<unknown, unknown, { weekStartDate: string; overrideValue: number; reason: string; computedValue: number }>({
    mutationFn: (a) => apiRequest('POST', `${CASHFLOW_API_BASE}/available-payment`, a),
    successToast: 'Available payment updated',
    onSuccess: invalidate,
  });
  const resetAvail = useApiMutation<unknown, unknown, string>({
    mutationFn: (weekStartDate) => apiRequest('DELETE', `${CASHFLOW_API_BASE}/available-payment`, { weekStartDate }),
    successToast: 'Override cleared',
    onSuccess: invalidate,
  });

  const isCurrent = (w: CashflowWeek) => w.weekStart === kpis.currentWeekStart;

  const openingCell = (w: CashflowWeek) => {
    const display = <MoneyValue value={w.openingBalance} />;
    if (!canEditCashflow) {
      return w.hasManualOverride ? (
        <span className="inline-flex items-center justify-end gap-1">
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
          <button type="button" className="inline-flex items-center gap-1 tabular-nums hover:underline">
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

      {/* Cashflow data-trust boundary (kept verbatim — guards the planning-only
          caveat the weekly meeting relies on). */}
      <details
        className="mt-2 rounded-md border border-slate-200 bg-slate-50/70 text-[11px] text-slate-700 group"
        data-testid="cashflow-trust-note"
      >
        <summary className="cursor-pointer select-none px-2.5 py-1 list-none flex items-center gap-1.5 hover:bg-slate-100/70 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
          <span aria-hidden="true" className="text-slate-500">ⓘ</span>
          <span>Cashflow actuals use payment received / paid dates. Forecast dates may use planned-payment fallback where no canonical payment date exists.</span>
          <ChevronDown aria-hidden="true" className="ml-auto h-3 w-3 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <p className="px-2.5 pb-2 pt-0.5 text-slate-600 leading-snug">
          Forecast dates may use planned-payment fallback where no canonical payment date exists. Use forecast values as planning data until reconciled.
        </p>
      </details>

      <section aria-label="Weekly cashflow" data-testid="cashflow-week-grid" className="mt-3">
        {weeks.length === 0 ? (
          <FinanceEmpty title="No weeks in this window." hint="Pick a wider financial-year scope." />
        ) : (
          <DrillTable
            data-testid="cashflow-drill-table"
            columns={columns}
            rows={weeks}
            rowKey={(w) => w.weekStart}
            renderDetail={(w) => <WeekQbDetail week={w} fyParam={fyScope.allData ? 'all' : 'fy'} onOpenQbLink={setQbLinkContext} />}
            maxBodyHeightClass="max-h-[55vh]"
            caption="Weekly cashflow — opening, inflows, outflows, closing and available payment; expand a week for its lines."
          />
        )}
      </section>

      <section aria-label="Worklists" data-testid="cashflow-worklists-section" className="mt-4">
        <CashflowWorklists projectParam={undefined} />
      </section>

      <Dialog open={!!qbLinkContext} onOpenChange={(open) => !open && setQbLinkContext(null)}>
        <DialogContent
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            right: 'auto',
            bottom: 'auto',
            transform: 'translate(-50%, -50%)',
            width: 'min(calc(100vw - 1rem), 1280px)',
            maxWidth: 'min(calc(100vw - 1rem), 1280px)',
            height: 'min(92dvh, 920px)',
            maxHeight: 'min(92dvh, 920px)',
            zIndex: 60,
          }}
          className="z-[60] h-[min(92dvh,920px)] w-[min(1280px,calc(100vw-1rem))] max-w-none max-h-[min(92dvh,920px)] overflow-hidden p-0 sm:p-0"
          data-wide-dialog=""
          data-testid="dialog-cashflow-qb-match"
        >
          <div className="flex h-full max-h-[min(92dvh,920px)] min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b border-border bg-background px-4 py-3 pr-12 sm:px-5 sm:py-4">
              <DialogTitle className="text-base font-semibold">Open QuickBooks match</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Search QuickBooks, link the app line, and review the live payment status without leaving cashflow.
                {qbLinkContext?.label ? ` Seeded from ${qbLinkContext.label}.` : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-3 py-3 sm:px-5 sm:py-4">
              {qbLinkContext && (
                <FindQbMatchesPanel
                  key={`${qbLinkContext.scope}-${qbLinkContext.initialSearch}`}
                  defaultScope={qbLinkContext.scope}
                  initialSearch={qbLinkContext.initialSearch}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </FinanceShell>
  );
}

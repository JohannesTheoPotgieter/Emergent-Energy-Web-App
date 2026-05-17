import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ragBadgeClasses } from '@/lib/status-colors';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  formatCurrencyCompact,
  formatDate,
  type ExecutionDashboardProject,
} from '@/lib/execution-dashboard';
import {
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart3,
  AlertTriangle,
  ExternalLink,
  Info,
  Clock,
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { useExecutionData } from './use-execution-data';
import { apiRequest } from '@/lib/queryClient';
import { KpiCard } from '@/components/ui/kpi-card';
import { formatZar } from '@/lib/currency';
import { DataTrustBadge } from '@/components/ui/data-trust-badge';
import { FinancialYearScopeControl } from '@/components/finance/FinancialYearScopeControl';
import { getMarginColour } from '@/lib/margin-colour';

type SortKey =
  | 'projectName'
  | 'pm'
  | 'plannedRevenue'
  | 'receivedInflow'
  | 'revenueVariance'
  | 'plannedExpenditure'
  | 'paidExpenditure'
  | 'expenditureVariance'
  | 'grossProfit'
  | 'grossMargin'
  | 'openInflow'
  | 'openExpenditure';
type SortDir = 'asc' | 'desc';

function sortProjects(
  projects: ExecutionDashboardProject[],
  key: SortKey,
  dir: SortDir,
): ExecutionDashboardProject[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...projects].sort((a, b) => {
    switch (key) {
      case 'projectName':
        return m * (a.projectName || '').localeCompare(b.projectName || '');
      case 'pm':
        return m * (a.pm || '').localeCompare(b.pm || '');
      case 'plannedRevenue':
        return m * (a.plannedRevenueFy - b.plannedRevenueFy);
      case 'receivedInflow':
        return m * (a.receivedInflowFy - b.receivedInflowFy);
      case 'revenueVariance':
        return (
          m * (a.receivedInflowFy - a.plannedRevenueFy - (b.receivedInflowFy - b.plannedRevenueFy))
        );
      case 'plannedExpenditure':
        return m * (a.plannedExpenditureFy - b.plannedExpenditureFy);
      case 'paidExpenditure':
        return m * (a.paidExpenditureFy - b.paidExpenditureFy);
      case 'expenditureVariance':
        return (
          m *
          (a.paidExpenditureFy -
            a.plannedExpenditureFy -
            (b.paidExpenditureFy - b.plannedExpenditureFy))
        );
      case 'grossProfit':
        return m * (a.grossProfitFy - b.grossProfitFy);
      case 'grossMargin':
        return m * ((a.grossMarginPctFy || 0) - (b.grossMarginPctFy || 0));
      case 'openInflow':
        return m * (a.openInflowFy - b.openInflowFy);
      case 'openExpenditure':
        return m * (a.openExpenditureFy - b.openExpenditureFy);
      default:
        return 0;
    }
  });
}

interface OverdueItem {
  id: number;
  projectId: number;
  projectName: string;
  description: string;
  amount: number;
  invoiceNumber: string | null;
  poNumber?: string | null;
  counterparty?: string | null;
  dueDate: string;
  daysOverdue: number;
  status: string;
  type: 'inflow' | 'outflow';
}

interface OverdueData {
  inflow: { items: OverdueItem[]; totalAmount: number; count: number };
  outflow: { items: OverdueItem[]; totalAmount: number; count: number };
}

export default function FinancePage() {
  const { kpis, filteredProjects, actionRows, openProject, fyLabel, fyScope, trust } =
    useExecutionData();
  const [sortKey, setSortKey] = useState<SortKey>('grossMargin');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Overdue payments drill-down state
  const [overdueDrawerOpen, setOverdueDrawerOpen] = useState(false);
  const [overdueFilter, setOverdueFilter] = useState<'all' | 'inflow' | 'outflow'>('all');
  const [overdueData, setOverdueData] = useState<OverdueData | null>(null);
  const [overdueLoading, setOverdueLoading] = useState(false);
  const [overdueError, setOverdueError] = useState(false);
  const [overdueProjectFilter, setOverdueProjectFilter] = useState<number | null>(null);
  const [overdueExpandedId, setOverdueExpandedId] = useState<number | null>(null);

  const loadOverdueData = useCallback(
    async (direction: string = 'all', projectId?: number) => {
      try {
        setOverdueLoading(true);
        setOverdueError(false);
        const params = new URLSearchParams();
        params.set('fy', fyScope.allData ? 'all' : String(fyScope.fy));
        if (direction !== 'all') params.set('direction', direction);
        if (projectId) params.set('projectId', String(projectId));
        const res = await apiRequest(
          'GET',
          `/api/lifecycle-board/overdue-payments?${params.toString()}`,
        );
        const data: OverdueData = await res.json();
        setOverdueData(data);
      } catch (err) {
        // A failed load must NOT read as "nothing overdue" (UI/UX audit 4a).
        // eslint-disable-next-line no-console
        if (typeof console !== 'undefined') console.error('Overdue payments load failed:', err);
        setOverdueData(null);
        setOverdueError(true);
      } finally {
        setOverdueLoading(false);
      }
    },
    [fyScope.allData, fyScope.fy, fyScope.apiQueryString],
  );

  const openOverdueDrawer = useCallback(
    (filter: 'all' | 'inflow' | 'outflow' = 'all', projectId?: number) => {
      setOverdueFilter(filter);
      setOverdueProjectFilter(projectId || null);
      setOverdueExpandedId(null);
      setOverdueDrawerOpen(true);
      loadOverdueData(filter, projectId);
    },
    [loadOverdueData],
  );

  const overdueItems = useMemo(() => {
    if (!overdueData) return [];
    const items: OverdueItem[] = [];
    if (overdueFilter === 'all' || overdueFilter === 'inflow')
      items.push(...overdueData.inflow.items);
    if (overdueFilter === 'all' || overdueFilter === 'outflow')
      items.push(...overdueData.outflow.items);
    return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [overdueData, overdueFilter]);

  const sorted = useMemo(
    () => sortProjects(filteredProjects, sortKey, sortDir),
    [filteredProjects, sortKey, sortDir],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortHeader = ({
    k,
    children,
    className,
  }: {
    k: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th
      className={`py-2.5 px-2 font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap ${className || ''}`}
      onClick={() => toggleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortKey === k &&
          (sortDir === 'asc' ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          ))}
        {sortKey !== k && <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );

  // Margin erosion watchlist: projects with negative or low margin
  const marginWatchlist = useMemo(() => {
    return [...filteredProjects]
      .filter((p) => p.grossMarginPctFy !== null && p.grossMarginPctFy < 15)
      .sort((a, b) => (a.grossMarginPctFy || 0) - (b.grossMarginPctFy || 0))
      .slice(0, 10);
  }, [filteredProjects]);

  // Finance risk rows from action center
  const financeRiskRows = useMemo(() => {
    return actionRows
      .filter((r) => {
        const q = r.queue?.toLowerCase() || '';
        return q.includes('inflow') || q.includes('expenditure') || q.includes('cos');
      })
      .slice(0, 15);
  }, [actionRows]);

  return (
    <div className="space-y-5">
      {/* Trust badge */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <FinancialYearScopeControl scope={fyScope} />
        <DataTrustBadge trust={trust} />
      </div>

      {/* KPI STRIP - Revenue */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label={`Budget Revenue (${fyLabel})`}
          value={formatCurrencyCompact(kpis.plannedRevenueFy)}
          title={formatZar(kpis.plannedRevenueFy)}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <KpiCard
          label={`Actual Revenue (${fyLabel})`}
          value={formatCurrencyCompact(kpis.receivedInflowFy)}
          title={formatZar(kpis.receivedInflowFy)}
          icon={<TrendingUp className="w-4 h-4" />}
          sub={`${kpis.plannedRevenueFy > 0 ? Math.round((kpis.receivedInflowFy / kpis.plannedRevenueFy) * 100) : 0}% collected`}
        />
        <KpiCard
          label="Revenue Outstanding"
          value={formatCurrencyCompact(kpis.openInflowFy)}
          title={formatZar(kpis.openInflowFy)}
          icon={<DollarSign className="w-4 h-4" />}
          tone="warning"
        />
        <KpiCard
          label={`Budget Expenditure (${fyLabel})`}
          value={formatCurrencyCompact(kpis.plannedExpenditureFy)}
          title={formatZar(kpis.plannedExpenditureFy)}
          icon={<TrendingDown className="w-4 h-4" />}
        />
        <KpiCard
          label={`Actual Expenditure (${fyLabel})`}
          value={formatCurrencyCompact(kpis.paidExpenditureFy)}
          title={formatZar(kpis.paidExpenditureFy)}
          icon={<TrendingDown className="w-4 h-4" />}
          sub={`${kpis.plannedExpenditureFy > 0 ? Math.round((kpis.paidExpenditureFy / kpis.plannedExpenditureFy) * 100) : 0}% spent`}
        />
        <KpiCard
          label="Expense Outstanding"
          value={formatCurrencyCompact(kpis.openExpenditureFy)}
          title={formatZar(kpis.openExpenditureFy)}
          icon={<DollarSign className="w-4 h-4" />}
          tone="warning"
        />
      </div>

      {/* KPI STRIP - Margin */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Gross Profit (Planned)"
          value={formatCurrencyCompact(kpis.grossProfitFy)}
          title={formatZar(kpis.grossProfitFy)}
          icon={<BarChart3 className="w-4 h-4" />}
          sub="Planned revenue minus planned expenditure"
        />
        <KpiCard
          label="Planned Margin"
          value={`${kpis.grossMarginPctFy ?? '—'}%`}
          icon={<BarChart3 className="w-4 h-4" />}
          sub="Planned GP as % of planned revenue"
        />
        <KpiCard
          label="Actual Margin"
          value={`${kpis.actualMarginPctFy ?? '—'}%`}
          icon={<BarChart3 className="w-4 h-4" />}
          sub="Actual received minus actual paid"
        />
        <KpiCard
          label="Margin Variance"
          value={
            kpis.marginVariancePct !== null
              ? `${kpis.marginVariancePct > 0 ? '+' : ''}${kpis.marginVariancePct}%`
              : '—'
          }
          icon={<BarChart3 className="w-4 h-4" />}
          tone={(kpis.marginVariancePct ?? 0) < 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Inflow Risk Projects"
          value={kpis.inflowRiskProjects}
          icon={<AlertTriangle className="w-4 h-4" />}
          tone="danger"
          sub={`${kpis.outflowRiskProjects} outflow risk`}
        />
      </div>

      {/* OVERDUE PAYMENTS KPI */}
      <Card className="border-red-200 bg-red-50/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-red-500" />
            <h2 className="text-base font-semibold">Overdue Payments Outstanding</h2>
            <Badge variant="outline" className="text-xs text-red-600 border-red-300">
              Past due date
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard
              label="Total Overdue"
              value={formatCurrencyCompact(kpis.overdueInflowFy + kpis.overdueOutflowFy)}
              title={formatZar(kpis.overdueInflowFy + kpis.overdueOutflowFy)}
              icon={<Clock className="w-4 h-4" />}
              tone="danger"
              sub="Click to drill down to item level"
              onClick={() => openOverdueDrawer('all')}
              data-testid="kpi-total-overdue"
            />
            <KpiCard
              label="Overdue Inflow (AR)"
              value={formatCurrencyCompact(kpis.overdueInflowFy)}
              title={formatZar(kpis.overdueInflowFy)}
              icon={<ArrowDownRight className="w-4 h-4" />}
              tone="warning"
              sub="Revenue past expected payment date"
              onClick={() => openOverdueDrawer('inflow')}
              data-testid="kpi-overdue-inflow"
            />
            <KpiCard
              label="Overdue Outflow (AP)"
              value={formatCurrencyCompact(kpis.overdueOutflowFy)}
              title={formatZar(kpis.overdueOutflowFy)}
              icon={<ArrowUpRight className="w-4 h-4" />}
              tone="warning"
              sub="Expenditure past approved/invoice date"
              onClick={() => openOverdueDrawer('outflow')}
              data-testid="kpi-overdue-outflow"
            />
          </div>

          {/* Per-project overdue breakdown (top 5) */}
          {filteredProjects.some(
            (p) => (p.overdueInflowFy || 0) + (p.overdueOutflowFy || 0) > 0,
          ) && (
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-2">
                Top Overdue by Project
              </p>
              <div className="rounded-lg border border-border/60 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="text-left py-2 px-3 font-medium">Project</th>
                      <th className="text-right py-2 px-3 font-medium">Overdue Inflow</th>
                      <th className="text-right py-2 px-3 font-medium">Overdue Outflow</th>
                      <th className="text-right py-2 px-3 font-medium">Total Overdue</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...filteredProjects]
                      .filter((p) => (p.overdueInflowFy || 0) + (p.overdueOutflowFy || 0) > 0)
                      .sort(
                        (a, b) =>
                          (b.overdueInflowFy || 0) +
                          (b.overdueOutflowFy || 0) -
                          ((a.overdueInflowFy || 0) + (a.overdueOutflowFy || 0)),
                      )
                      .slice(0, 8)
                      .map((p) => (
                        <tr
                          key={p.projectId}
                          className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                          onClick={() => openOverdueDrawer('all', p.projectId)}
                        >
                          <td className="py-2 px-3 font-medium truncate max-w-[200px]">
                            {p.projectName}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-amber-600">
                            {formatCurrencyCompact(p.overdueInflowFy || 0)}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-orange-600">
                            {formatCurrencyCompact(p.overdueOutflowFy || 0)}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-medium text-red-600">
                            {formatCurrencyCompact(
                              (p.overdueInflowFy || 0) + (p.overdueOutflowFy || 0),
                            )}
                          </td>
                          <td className="py-2 px-1">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                              <Eye className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AR/AP Ageing Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="border-blue-200 bg-blue-50/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span className="text-[10px] text-blue-700 font-medium uppercase">
                Accounts Receivable (Overdue Inflows)
              </span>
            </div>
            <p className="text-xl font-bold text-blue-800">
              {formatCurrencyCompact(kpis.overdueInflowFy)}
            </p>
            <p className="text-[10px] text-blue-600">
              {sorted.filter((p) => p.overdueInflowFy > 0).length} projects with overdue inflows
            </p>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="w-4 h-4 text-orange-600" />
              <span className="text-[10px] text-orange-700 font-medium uppercase">
                Accounts Payable (Overdue Outflows)
              </span>
            </div>
            <p className="text-xl font-bold text-orange-800">
              {formatCurrencyCompact(kpis.overdueOutflowFy)}
            </p>
            <p className="text-[10px] text-orange-600">
              {sorted.filter((p) => p.overdueOutflowFy > 0).length} projects with overdue outflows
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gross Profit & Collection Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-emerald-700 font-medium uppercase">
              Gross Profit ({fyLabel})
            </div>
            <p className="text-xl font-bold text-emerald-800">
              {formatCurrencyCompact(kpis.grossProfitFy)}
            </p>
            <p className="text-[10px] text-emerald-600">
              Planned Margin: {kpis.grossMarginPctFy ?? '—'}% | Actual:{' '}
              {kpis.actualMarginPctFy ?? '—'}%
            </p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-blue-700 font-medium uppercase">
              Inflow Collection Rate
            </div>
            <p className="text-xl font-bold text-blue-800">
              {kpis.plannedRevenueFy > 0
                ? `${Math.round((kpis.receivedInflowFy / kpis.plannedRevenueFy) * 100)}%`
                : '—'}
            </p>
            <p className="text-[10px] text-blue-600">
              {formatCurrencyCompact(kpis.receivedInflowFy)} of{' '}
              {formatCurrencyCompact(kpis.plannedRevenueFy)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-orange-700 font-medium uppercase">
              Expenditure Paid Rate
            </div>
            <p className="text-xl font-bold text-orange-800">
              {kpis.plannedExpenditureFy > 0
                ? `${Math.round((kpis.paidExpenditureFy / kpis.plannedExpenditureFy) * 100)}%`
                : '—'}
            </p>
            <p className="text-[10px] text-orange-600">
              {formatCurrencyCompact(kpis.paidExpenditureFy)} of{' '}
              {formatCurrencyCompact(kpis.plannedExpenditureFy)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* PROJECT FINANCE CONTROL TABLE */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold">Project Finance Control</h2>
            <Badge variant="outline" className="text-xs ml-1">
              {sorted.length} projects
            </Badge>
          </div>
          <div className="rounded-lg border border-border/60 overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <SortHeader k="projectName" className="text-left px-3">
                    Project
                  </SortHeader>
                  <SortHeader k="pm" className="text-left">
                    PM
                  </SortHeader>
                  <SortHeader k="plannedRevenue" className="text-right">
                    Budget Rev.
                  </SortHeader>
                  <SortHeader k="receivedInflow" className="text-right">
                    Actual Rev.
                  </SortHeader>
                  <SortHeader k="openInflow" className="text-right">
                    Rev. Open
                  </SortHeader>
                  <SortHeader k="plannedExpenditure" className="text-right">
                    Budget Exp.
                  </SortHeader>
                  <SortHeader k="paidExpenditure" className="text-right">
                    Actual Exp.
                  </SortHeader>
                  <SortHeader k="openExpenditure" className="text-right">
                    Exp. Open
                  </SortHeader>
                  <SortHeader k="grossProfit" className="text-right">
                    GP
                  </SortHeader>
                  <SortHeader k="grossMargin" className="text-right">
                    Margin
                  </SortHeader>
                  <th className="w-8 py-2.5 px-1"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const expanded = expandedId === p.projectId;
                  const revenueVar = p.receivedInflowFy - p.plannedRevenueFy;
                  const expenditureVar = p.paidExpenditureFy - p.plannedExpenditureFy;
                  return (
                    <React.Fragment key={p.projectId}>
                      <tr
                        className={`border-t border-border/40 cursor-pointer transition-colors ${expanded ? 'bg-emerald-50/40' : 'hover:bg-muted/30'} ${p.grossMarginPctFy !== null ? getMarginColour(p.grossMarginPctFy) : ''}`}
                        onClick={() => setExpandedId(expanded ? null : p.projectId)}
                      >
                        <td className="py-2 px-3 font-medium truncate max-w-[180px]">
                          {p.projectName}
                        </td>
                        <td className="py-2 px-2 text-muted-foreground text-xs">{p.pm || '—'}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs">
                          {formatCurrencyCompact(p.plannedRevenueFy)}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-emerald-600">
                          {formatCurrencyCompact(p.receivedInflowFy)}
                        </td>
                        <td
                          className={`py-2 px-2 text-right tabular-nums text-xs ${p.openInflowFy > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}
                        >
                          {formatCurrencyCompact(p.openInflowFy)}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs">
                          {formatCurrencyCompact(p.plannedExpenditureFy)}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-emerald-600">
                          {formatCurrencyCompact(p.paidExpenditureFy)}
                        </td>
                        <td
                          className={`py-2 px-2 text-right tabular-nums text-xs ${p.openExpenditureFy > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}
                        >
                          {formatCurrencyCompact(p.openExpenditureFy)}
                        </td>
                        <td
                          className={`py-2 px-2 text-right tabular-nums text-xs font-medium ${p.grossProfitFy < 0 ? 'text-red-600' : 'text-emerald-600'}`}
                        >
                          {formatCurrencyCompact(p.grossProfitFy)}
                        </td>
                        <td
                          className={`py-2 px-2 text-right tabular-nums text-xs font-medium ${(p.grossMarginPctFy ?? 0) < 10 ? 'text-red-600' : (p.grossMarginPctFy ?? 0) < 20 ? 'text-amber-600' : ''}`}
                        >
                          {p.grossMarginPctFy === null ? '—' : `${p.grossMarginPctFy}%`}
                        </td>
                        <td className="py-2 px-1 text-center">
                          {expanded ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20 border-t border-border/40">
                          <td colSpan={11} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                  Revenue ({fyLabel})
                                </p>
                                <div className="space-y-1.5 text-sm">
                                  <p>
                                    <span className="text-muted-foreground">Budget:</span>{' '}
                                    {formatZar(p.plannedRevenueFy)}
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Received:</span>{' '}
                                    <span className="text-emerald-600">
                                      {formatZar(p.receivedInflowFy)}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Outstanding:</span>{' '}
                                    <span className="text-amber-600">
                                      {formatZar(p.openInflowFy)}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Variance:</span>{' '}
                                    <span
                                      className={
                                        revenueVar < 0 ? 'text-red-600' : 'text-emerald-600'
                                      }
                                    >
                                      {formatZar(revenueVar)}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Inflow Risk:</span>{' '}
                                    <span
                                      className={
                                        p.inflowRisk
                                          ? 'text-red-600 font-medium'
                                          : 'text-emerald-600'
                                      }
                                    >
                                      {p.inflowRisk ? 'Yes' : 'No'}
                                    </span>
                                  </p>
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                  Expenditure ({fyLabel})
                                </p>
                                <div className="space-y-1.5 text-sm">
                                  <p>
                                    <span className="text-muted-foreground">Budget:</span>{' '}
                                    {formatZar(p.plannedExpenditureFy)}
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Paid:</span>{' '}
                                    <span className="text-emerald-600">
                                      {formatZar(p.paidExpenditureFy)}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Outstanding:</span>{' '}
                                    <span className="text-amber-600">
                                      {formatZar(p.openExpenditureFy)}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Variance:</span>{' '}
                                    <span
                                      className={
                                        expenditureVar > 0 ? 'text-red-600' : 'text-emerald-600'
                                      }
                                    >
                                      {formatZar(expenditureVar)}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Outflow Risk:</span>{' '}
                                    <span
                                      className={
                                        p.outflowRisk
                                          ? 'text-red-600 font-medium'
                                          : 'text-emerald-600'
                                      }
                                    >
                                      {p.outflowRisk ? 'Yes' : 'No'}
                                    </span>
                                  </p>
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                  Profitability
                                </p>
                                <div className="space-y-1.5 text-sm">
                                  <p>
                                    <span className="text-muted-foreground">Gross Profit:</span>{' '}
                                    <span
                                      className={
                                        p.grossProfitFy < 0
                                          ? 'text-red-600 font-medium'
                                          : 'text-emerald-600 font-medium'
                                      }
                                    >
                                      {formatZar(p.grossProfitFy)}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">GP Margin:</span>{' '}
                                    <span className="font-medium">
                                      {p.grossMarginPctFy === null ? '—' : `${p.grossMarginPctFy}%`}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Portfolio:</span>{' '}
                                    {p.portfolio || '—'}
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Phase:</span>{' '}
                                    {p.executionPhase || '—'}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <Button
                                size="sm"
                                onClick={() => openProject(p)}
                                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Open Project
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openProject(p, 'revenue')}
                              >
                                Revenue
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openProject(p, 'expenditure')}
                              >
                                Expenditure
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openProject(p, 'cashflow')}
                              >
                                Cashflow
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {sorted.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground">No projects match current filters</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* MARGIN EROSION WATCHLIST */}
      {marginWatchlist.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-semibold">Margin Erosion Watchlist</h3>
              <Badge variant="outline" className="text-xs">
                {marginWatchlist.length} projects under 15% margin
              </Badge>
            </div>
            <div className="rounded-lg border border-border/60 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Project</th>
                    <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">PM</th>
                    <th className="text-right py-2 px-3 font-medium">GP Margin</th>
                    <th className="text-right py-2 px-3 font-medium">Gross Profit</th>
                    <th className="text-right py-2 px-3 font-medium hidden md:table-cell">
                      Revenue
                    </th>
                    <th className="text-right py-2 px-3 font-medium hidden md:table-cell">
                      Expenditure
                    </th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {marginWatchlist.map((p) => (
                    <tr
                      key={p.projectId}
                      className={`border-t border-border/40 hover:bg-muted/30 cursor-pointer ${p.grossMarginPctFy !== null ? getMarginColour(p.grossMarginPctFy) : ''}`}
                      onClick={() => openProject(p, 'revenue')}
                    >
                      <td className="py-2 px-3 font-medium truncate max-w-[200px]">
                        {p.projectName}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground text-xs hidden sm:table-cell">
                        {p.pm || '—'}
                      </td>
                      <td
                        className={`py-2 px-3 text-right tabular-nums font-medium ${(p.grossMarginPctFy ?? 0) < 0 ? 'text-red-600' : (p.grossMarginPctFy ?? 0) < 10 ? 'text-red-600' : 'text-amber-600'}`}
                      >
                        {p.grossMarginPctFy === null ? '—' : `${p.grossMarginPctFy}%`}
                      </td>
                      <td
                        className={`py-2 px-3 text-right tabular-nums ${p.grossProfitFy < 0 ? 'text-red-600' : ''}`}
                      >
                        {formatCurrencyCompact(p.grossProfitFy)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs hidden md:table-cell">
                        {formatCurrencyCompact(p.plannedRevenueFy)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs hidden md:table-cell">
                        {formatCurrencyCompact(p.plannedExpenditureFy)}
                      </td>
                      <td className="py-2 px-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            openProject(p, 'revenue');
                          }}
                        >
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* FINANCE RISK ITEMS */}
      {financeRiskRows.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-semibold">Cash / Exposure Risks</h3>
              <Badge variant="outline" className="text-xs">
                {financeRiskRows.length}
              </Badge>
            </div>
            <div className="rounded-lg border border-border/60 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Project</th>
                    <th className="text-left py-2 px-3 font-medium">Risk</th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">
                      Category
                    </th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Owner</th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">
                      Severity
                    </th>
                    <th className="text-left py-2 px-3 font-medium hidden lg:table-cell">Due</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {financeRiskRows.map((r, i) => (
                    <tr key={i} className="border-t border-border/40 hover:bg-muted/30">
                      <td className="py-2 px-3 font-medium">{r.projectName}</td>
                      <td className="py-2 px-3 text-muted-foreground truncate max-w-[250px]">
                        {r.issueTitle}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground text-xs hidden md:table-cell">
                        {r.queue}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground text-xs hidden md:table-cell">
                        {r.owner}
                      </td>
                      <td className="py-2 px-3 hidden md:table-cell">
                        <Badge
                          className={`text-[10px] ${r.severity === 'critical' ? 'bg-red-100 text-red-700' : r.severity === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}
                        >
                          {r.severity}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground text-xs tabular-nums hidden lg:table-cell">
                        {formatDate(r.dueDate)}
                      </td>
                      <td className="py-2 px-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => (window.location.href = r.link)}
                        >
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Realisation KPIs now live on their own discoverable tab
          (/execution-board/realisation) — see route-tabs.ts. */}
      <Card className="border-border/60">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Realisation KPIs</h3>
              <p className="text-xs text-muted-foreground">
                COS &amp; cashflow realisation trends — weekly, monthly and YTD.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="sm:ml-auto gap-1.5 shrink-0"
            onClick={() => (window.location.href = '/execution-board/realisation')}
          >
            View Realisation KPIs
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </CardContent>
      </Card>

      {/* OVERDUE PAYMENTS DRILL-DOWN DRAWER */}
      <Sheet open={overdueDrawerOpen} onOpenChange={setOverdueDrawerOpen}>
        <SheetContent className="sm:max-w-[1000px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-red-500" />
              Overdue Payments
              {overdueProjectFilter && overdueData && (
                <Badge variant="outline" className="text-xs">
                  {overdueItems[0]?.projectName || 'Project'}
                </Badge>
              )}
            </SheetTitle>
          </SheetHeader>

          {/* Filter tabs */}
          <div className="mt-3 flex items-center gap-2">
            {(['all', 'inflow', 'outflow'] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={overdueFilter === f ? 'default' : 'outline'}
                className={`text-xs ${overdueFilter === f ? '' : ''}`}
                onClick={() => {
                  setOverdueFilter(f);
                  setOverdueExpandedId(null);
                  loadOverdueData(f, overdueProjectFilter || undefined);
                }}
              >
                {f === 'all' ? 'All' : f === 'inflow' ? 'Inflow (AR)' : 'Outflow (AP)'}
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1"
                onClick={() => loadOverdueData(overdueFilter, overdueProjectFilter || undefined)}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          </div>

          {/* Summary strip */}
          {overdueData && !overdueLoading && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="bg-red-50 rounded-lg border border-red-200 p-2 text-center">
                <p className="text-[10px] text-red-700 font-medium">TOTAL OVERDUE</p>
                <p className="text-lg font-bold text-red-600 tabular-nums">
                  {formatCurrencyCompact(
                    overdueData.inflow.totalAmount + overdueData.outflow.totalAmount,
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {overdueData.inflow.count + overdueData.outflow.count} items
                </p>
              </div>
              <div className="bg-amber-50 rounded-lg border border-amber-200 p-2 text-center">
                <p className="text-[10px] text-amber-700 font-medium">INFLOW (AR)</p>
                <p className="text-lg font-bold text-amber-600 tabular-nums">
                  {formatCurrencyCompact(overdueData.inflow.totalAmount)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {overdueData.inflow.count} items
                </p>
              </div>
              <div className="bg-orange-50 rounded-lg border border-orange-200 p-2 text-center">
                <p className="text-[10px] text-orange-700 font-medium">OUTFLOW (AP)</p>
                <p className="text-lg font-bold text-orange-600 tabular-nums">
                  {formatCurrencyCompact(overdueData.outflow.totalAmount)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {overdueData.outflow.count} items
                </p>
              </div>
            </div>
          )}

          {/* Item-level table */}
          {overdueLoading ? (
            <div className="text-sm text-muted-foreground mt-6 text-center py-8">
              Loading overdue items...
            </div>
          ) : overdueError ? (
            <div className="mt-6 flex flex-col items-center justify-center gap-3 py-10 text-center">
              <AlertTriangle className="w-7 h-7 text-red-500" />
              <p className="text-sm font-medium">Couldn’t load overdue payments</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                This list failed to load — it does <strong>not</strong> mean there are no overdue
                payments. Please retry.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => loadOverdueData(overdueFilter, overdueProjectFilter || undefined)}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </Button>
            </div>
          ) : (
            <div className="mt-3 border rounded-lg overflow-auto max-h-[65vh]">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Type</th>
                    <th className="text-left py-2 px-3 font-medium">Project</th>
                    <th className="text-left py-2 px-3 font-medium">Description</th>
                    <th className="text-right py-2 px-3 font-medium">Amount</th>
                    <th className="text-left py-2 px-3 font-medium">Invoice</th>
                    <th className="text-left py-2 px-3 font-medium">Due Date</th>
                    <th className="text-right py-2 px-3 font-medium">Days Overdue</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {overdueItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-muted-foreground">
                        No overdue payments found
                      </td>
                    </tr>
                  ) : (
                    overdueItems.map((item) => {
                      const isExpanded = overdueExpandedId === item.id;
                      return (
                        <React.Fragment key={`${item.type}-${item.id}`}>
                          <tr
                            className={`border-t border-border/40 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/40' : 'hover:bg-muted/30'}`}
                            onClick={() => setOverdueExpandedId(isExpanded ? null : item.id)}
                          >
                            <td className="py-2 px-3">
                              <Badge
                                className={`text-[10px] ${item.type === 'inflow' ? 'bg-amber-100 text-amber-700' : 'bg-orange-100 text-orange-700'}`}
                              >
                                {item.type === 'inflow' ? 'AR' : 'AP'}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 font-medium truncate max-w-[150px]">
                              {item.projectName}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground truncate max-w-[200px]">
                              {item.description}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums font-medium">
                              {formatZar(item.amount)}
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {item.invoiceNumber || '—'}
                            </td>
                            <td className="py-2 px-3 text-xs tabular-nums">
                              {formatDate(item.dueDate)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <Badge
                                className={`text-[10px] ${item.daysOverdue > 60 ? 'bg-red-100 text-red-700' : item.daysOverdue > 30 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}
                              >
                                {item.daysOverdue}d
                              </Badge>
                            </td>
                            <td className="py-2 px-1 text-center">
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-muted/20 border-t border-border/40">
                              <td colSpan={8} className="p-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                  <div className="bg-white rounded-lg border p-3">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                      Payment Details
                                    </p>
                                    <div className="space-y-1.5 text-sm">
                                      <p>
                                        <span className="text-muted-foreground">Type:</span>{' '}
                                        {item.type === 'inflow'
                                          ? 'Revenue (Inflow)'
                                          : 'Expenditure (Outflow)'}
                                      </p>
                                      <p>
                                        <span className="text-muted-foreground">Amount:</span>{' '}
                                        <span className="font-medium">
                                          {formatZar(item.amount)}
                                        </span>
                                      </p>
                                      <p>
                                        <span className="text-muted-foreground">Invoice #:</span>{' '}
                                        {item.invoiceNumber || 'Not invoiced'}
                                      </p>
                                      {item.poNumber && (
                                        <p>
                                          <span className="text-muted-foreground">PO #:</span>{' '}
                                          {item.poNumber}
                                        </p>
                                      )}
                                      {item.counterparty && (
                                        <p>
                                          <span className="text-muted-foreground">
                                            Counterparty:
                                          </span>{' '}
                                          {item.counterparty}
                                        </p>
                                      )}
                                      <p>
                                        <span className="text-muted-foreground">Status:</span>{' '}
                                        <Badge variant="outline" className="text-[10px]">
                                          {item.status}
                                        </Badge>
                                      </p>
                                    </div>
                                  </div>
                                  <div className="bg-white rounded-lg border p-3">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                      Overdue Info
                                    </p>
                                    <div className="space-y-1.5 text-sm">
                                      <p>
                                        <span className="text-muted-foreground">Due Date:</span>{' '}
                                        {formatDate(item.dueDate)}
                                      </p>
                                      <p>
                                        <span className="text-muted-foreground">Days Overdue:</span>{' '}
                                        <span
                                          className={`font-medium ${item.daysOverdue > 60 ? 'text-red-600' : item.daysOverdue > 30 ? 'text-amber-600' : ''}`}
                                        >
                                          {item.daysOverdue} days
                                        </span>
                                      </p>
                                      <p>
                                        <span className="text-muted-foreground">Project:</span>{' '}
                                        {item.projectName}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                  <Button
                                    size="sm"
                                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const proj = filteredProjects.find(
                                        (fp) => fp.projectId === item.projectId,
                                      );
                                      if (proj)
                                        openProject(
                                          proj,
                                          item.type === 'inflow' ? 'revenue' : 'expenditure',
                                        );
                                    }}
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Open in {item.type === 'inflow' ? 'Revenue' : 'Expenditure'} Tab
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const proj = filteredProjects.find(
                                        (fp) => fp.projectId === item.projectId,
                                      );
                                      if (proj) openProject(proj, 'cashflow');
                                    }}
                                  >
                                    Cashflow
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}


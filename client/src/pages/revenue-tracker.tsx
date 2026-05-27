import React, { useState, useMemo, useCallback } from 'react';
import { FinanceShell } from '@/components/layout/FinanceShell';
import { FinancialYearScopeControl } from '@/components/finance/FinancialYearScopeControl';
import { RevenueGapTab } from '@/components/revenue/RevenueGapTab';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SectionHeader } from '@/components/layout/page-shell';
import { PageError, PageSkeleton } from '@/components/ui/page-states';
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { fetchQueryFn, apiRequest, invalidateDashboardQueries } from '@/lib/queryClient';
import { formatZar, formatZarCompact } from '@/lib/currency';
import { PageHero } from '@/components/finance/PageHero';
import { KpiTile } from '@/components/finance/KpiTile';
import { Money } from '@/components/ui/money';
import { DirectionDelta } from '@/components/finance/DirectionDelta';
import { DrillReconciliationFooter } from '@/components/finance/DrillReconciliationFooter';
import { DataSourceBadge } from '@/components/finance/DataSourceBadge';
import { usePermission } from '@/hooks/use-permissions';
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  LineChart,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  X,
  Search,
  Loader2,
  AlertCircle,
  HelpCircle,
  Filter,
  Wallet,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ListChecks,
  LineChart as LineChartIcon,
} from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { EmptyState } from '@/components/ui/empty-state';
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
  qbVsAppVariance?: number;
  qbVsAppVariancePct?: number;
  budget: number;
  variance: number;
  variancePct: number;
  ytdRevenue: number;
  ytdRealised: number;
  ytdUnrealised: number;
  ytdQbRevenueActual: number;
  ytdBudget: number;
  ytdVariance: number;
  ytdVariancePct: number;
  revProjects: ProjectBreakdown[];
  realisedProjects: ProjectBreakdown[];
  unrealisedProjects: ProjectBreakdown[];
  qbRevenueProjects: ProjectBreakdown[];
  budgetProjects: ProjectBreakdown[];
}

interface RevenueTrackerResponse {
  months: MonthData[];
  totalMilestoneRevenue: number;
  totalCOS: number;
}

interface MonthDetailItem {
  id: number;
  projectName: string;
  category: string | null;
  lineItem: string | null;
  costAmount: number;
  revenueAmount: number;
  invoiceNumber: string | null;
  poNumber: string | null;
  invoiceDate: string | null;
  supplier: string | null;
  isRealised: boolean;
  noRevenueLinked: boolean;
  revState: string;
  dataSource?: string;
  dateSource?: string | null;
  dateSourceLabel?: string | null;
  qbTransactionType?: string | null;
  qbDocNumber?: string | null;
  paymentReference?: string | null;
  transactionDate?: string | null;
  recognitionDate?: string | null;
  sourceTraceId?: string | null;
  matchStatus?: string;
}

// Canonical precise ZAR for all cells, panels and tooltips. Absent /
// non-numeric → "—" (never "R 0"). Chart axes use formatZarCompact directly.
function formatRand(val: number | null | undefined): string {
  return formatZar(val);
}

/**
 * Small inline help affordance. Used to explain rows whose values are
 * intentionally equal (e.g. Revenue Committed vs Revenue Unrealised) so the
 * coincidence is not misread as a data bug.
 */
function RowHelp({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground/70 hover:text-muted-foreground"
            aria-label="Why these values match"
            onClick={(e) => e.stopPropagation()}
          >
            <HelpCircle className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {text}
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

type RevTab = 'planned' | 'committed' | 'realised';

interface RowDef {
  key: string;
  label: string;
  dataKey: keyof MonthData;
  colorClass: string;
  group: 'monthly' | 'ytd';
  expandable?: boolean;
  editable?: boolean;
  projectsKey?: 'revProjects' | 'realisedProjects' | 'unrealisedProjects' | 'qbRevenueProjects';
  colorCoded?: boolean;
  /** Optional inline clarification shown via a help icon next to the label. */
  help?: string;
}

const ROW_DEFS: RowDef[] = [
  // Pipeline order: Planned → Committed → Realised → QB
  {
    key: 'totalRevenue',
    label: 'Revenue Planned',
    dataKey: 'totalRevenue',
    colorClass: 'text-emerald-700 font-semibold',
    group: 'monthly',
    expandable: true,
    projectsKey: 'revProjects',
  },
  {
    key: 'budget',
    label: 'Budget (Manual)',
    dataKey: 'budget',
    editable: true,
    colorClass: 'text-emerald-700/60',
    group: 'monthly',
  },
  {
    key: 'unrealisedRevenue',
    label: 'Revenue Committed',
    dataKey: 'unrealisedRevenue',
    colorClass: 'text-amber-700 font-semibold',
    group: 'monthly',
    expandable: true,
    projectsKey: 'unrealisedProjects',
    help: 'Revenue has no separate planned-vs-committed breakdown yet, so "Revenue Committed" and "Revenue Unrealised" intentionally show the same figure (everything not yet realised). This is expected, not a bug.',
  },
  // "Revenue Unrealised" row mirrors the COS grid layout (Planned → Committed →
  // Unrealised → Realised). Revenue currently has no separate planned-vs-
  // committed breakdown, so its Unrealised value equals the Committed total
  // above (everything not yet realised). The row exists for look-and-feel
  // parity with the COS grid; the value will diverge once revenue gains a
  // finer-grained classification.
  {
    key: 'unrealisedRevenueRow',
    label: 'Revenue Unrealised',
    dataKey: 'unrealisedRevenue',
    colorClass: 'text-amber-800 font-semibold',
    group: 'monthly',
    expandable: true,
    projectsKey: 'unrealisedProjects',
    help: 'Equals "Revenue Committed" above by design — revenue is not yet split into planned vs committed, so both rows report all not-yet-realised revenue. The values will diverge once finer revenue classification exists.',
  },
  {
    key: 'realisedRevenue',
    label: 'Revenue Realised',
    dataKey: 'realisedRevenue',
    colorClass: 'text-foreground font-bold',
    group: 'monthly',
    expandable: true,
    projectsKey: 'realisedProjects',
  },
  {
    key: 'qbRevenueActual',
    label: 'Quickbooks Revenue',
    dataKey: 'qbRevenueActual',
    colorClass: 'text-emerald-600 font-semibold',
    group: 'monthly',
    expandable: true,
    projectsKey: 'qbRevenueProjects',
  },
  {
    key: 'variance',
    label: 'Budget Variance',
    dataKey: 'variance',
    colorClass: '',
    group: 'monthly',
    colorCoded: true,
  },
  {
    key: 'variancePct',
    label: 'Budget Variance %',
    dataKey: 'variancePct',
    colorClass: '',
    group: 'monthly',
    colorCoded: true,
  },
  {
    key: 'ytdBudget',
    label: 'YTD Planned (Budget)',
    dataKey: 'ytdBudget',
    colorClass: 'text-emerald-700',
    group: 'ytd',
  },
  {
    key: 'ytdUnrealised',
    label: 'YTD Committed',
    dataKey: 'ytdUnrealised',
    colorClass: 'text-amber-700',
    group: 'ytd',
    help: 'Same value as "YTD Unrealised" by design — revenue has no planned-vs-committed split yet, so both show all not-yet-realised YTD revenue.',
  },
  {
    key: 'ytdUnrealisedRow',
    label: 'YTD Unrealised',
    dataKey: 'ytdUnrealised',
    colorClass: 'text-amber-800',
    group: 'ytd',
    help: 'Same value as "YTD Committed" by design — revenue has no planned-vs-committed split yet, so both show all not-yet-realised YTD revenue.',
  },
  {
    key: 'ytdRealised',
    label: 'YTD Realised',
    dataKey: 'ytdRealised',
    colorClass: 'text-foreground font-bold',
    group: 'ytd',
  },
  {
    key: 'ytdQbRevenueActual',
    label: 'YTD QB Revenue',
    dataKey: 'ytdQbRevenueActual',
    colorClass: 'text-emerald-600',
    group: 'ytd',
  },
  {
    key: 'ytdVariance',
    label: 'YTD Variance',
    dataKey: 'ytdVariance',
    colorClass: '',
    group: 'ytd',
    colorCoded: true,
  },
  {
    key: 'ytdVariancePct',
    label: 'YTD Variance %',
    dataKey: 'ytdVariancePct',
    colorClass: '',
    group: 'ytd',
    colorCoded: true,
  },
];

const TAB_META: Record<
  RevTab,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    ytdKey: keyof MonthData;
    monthKey: keyof MonthData;
    accent: string;
    sparkColor: string;
  }
> = {
  realised: {
    label: 'Realised',
    icon: CheckCircle2,
    ytdKey: 'ytdRealised',
    monthKey: 'realisedRevenue',
    accent: 'text-foreground',
    sparkColor: '#0f172a',
  },
  committed: {
    label: 'Committed',
    icon: Clock,
    ytdKey: 'ytdUnrealised',
    monthKey: 'unrealisedRevenue',
    accent: 'text-amber-700',
    sparkColor: '#b45309',
  },
  planned: {
    label: 'Planned',
    icon: ListChecks,
    ytdKey: 'ytdBudget',
    monthKey: 'totalRevenue',
    accent: 'text-emerald-700',
    sparkColor: '#16a34a',
  },
};

function MonthDetailDrawer({
  monthKey,
  monthLabel,
  onClose,
  defaultFilter = 'all',
  defaultProject = 'all',
}: {
  monthKey: string;
  monthLabel: string;
  onClose: () => void;
  defaultFilter?: 'all' | 'realised' | 'unrealised' | 'qb_actual';
  defaultProject?: string;
}) {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'realised' | 'unrealised' | 'qb_actual'>(
    defaultFilter,
  );
  const [projectFilter, setProjectFilter] = useState<string>(defaultProject);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const stateParam =
    stateFilter !== 'all'
      ? `&state=${stateFilter === 'realised' ? 'Realised' : stateFilter === 'unrealised' ? 'Unrealised' : 'qb_actual'}`
      : '';
  const projectParam =
    projectFilter !== 'all' ? `&project=${encodeURIComponent(projectFilter)}` : '';

  const {
    data: rawItems,
    isLoading,
    isError,
    error: detailError,
    refetch: refetchDetail,
  } = useQuery<MonthDetailItem[]>({
    queryKey: ['/api/revenue-tracker/month-detail', monthKey, stateFilter, projectFilter],
    queryFn: fetchQueryFn(
      `/api/revenue-tracker/month-detail?monthKey=${monthKey}${stateParam}${projectParam}`,
    ),
    retry: 1,
  });

  const items = rawItems ?? [];

  const summaries = useMemo(() => {
    const realisedItems = items.filter((i) => i.isRealised);
    const unrealisedItems = items.filter((i) => !i.isRealised);
    return {
      lineCount: items.length,
      totalAmount: items.reduce((s, i) => s + i.revenueAmount, 0),
      realisedTotal: realisedItems.reduce((s, i) => s + i.revenueAmount, 0),
      unrealisedTotal: unrealisedItems.reduce((s, i) => s + i.revenueAmount, 0),
      realisedCount: realisedItems.length,
      unrealisedCount: unrealisedItems.length,
    };
  }, [items]);

  const allProjects = useMemo(() => {
    const names = new Set(items.map((i) => i.projectName));
    return Array.from(names).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.projectName.toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q) ||
        (i.lineItem || '').toLowerCase().includes(q) ||
        (i.invoiceNumber || '').toLowerCase().includes(q) ||
        (i.supplier || '').toLowerCase().includes(q),
    );
  }, [items, search]);

  const filteredTotal = useMemo(
    () => filtered.reduce((s, i) => s + i.revenueAmount, 0),
    [filtered],
  );
  const filteredRealised = useMemo(
    () => filtered.filter((i) => i.isRealised).reduce((s, i) => s + i.revenueAmount, 0),
    [filtered],
  );
  const filteredUnrealised = useMemo(
    () => filtered.filter((i) => !i.isRealised).reduce((s, i) => s + i.revenueAmount, 0),
    [filtered],
  );

  const stateBadgeColor = (state: string) => {
    switch (state) {
      case 'Received':
      case 'Realised':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold';
      case 'Invoiced':
        return 'bg-card text-foreground border border-border';
      case 'Committed':
        return 'bg-amber-50 text-amber-700 border border-amber-200';
      default:
        return 'bg-amber-50 text-amber-700 border border-amber-200';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex"
      data-testid="drawer-revenue-detail"
      role="dialog"
      aria-modal="true"
      aria-label={`Revenue detail for ${monthLabel}`}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="ml-auto relative w-full max-w-5xl bg-card shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        <div className="px-3 sm:px-6 py-4 sm:py-5 border-b border-border bg-gradient-to-r from-emerald-50 to-card flex items-center justify-between">
          <div>
            <h3
              className="font-bold text-xl tracking-tight text-foreground"
              data-testid="text-drawer-title"
            >
              {monthLabel}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Revenue Line Item Detail · {summaries.lineCount} items ·{' '}
              {formatRand(summaries.totalAmount)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
            data-testid="button-close-drawer"
            aria-label="Close detail drawer"
          >
            <X className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>

        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-border bg-gradient-to-b from-emerald-50/30 to-transparent">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <div className="relative overflow-hidden rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-emerald-700 uppercase tracking-wider">
                    Realised
                  </p>
                  <p
                    className="font-mono font-black text-foreground text-lg mt-0.5"
                    data-testid="text-realised-total"
                  >
                    {formatRand(summaries.realisedTotal)}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-emerald-100 text-emerald-700 text-xs font-semibold"
                >
                  {summaries.realisedCount}
                </Badge>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                    Unrealised
                  </p>
                  <p
                    className="font-mono font-bold text-amber-700 text-lg mt-0.5"
                    data-testid="text-unrealised-total"
                  >
                    {formatRand(summaries.unrealisedTotal)}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-amber-100 text-amber-700 text-xs font-semibold"
                >
                  {summaries.unrealisedCount}
                </Badge>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-xl bg-muted/50 border border-border px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Total
                  </p>
                  <p className="font-mono font-bold text-foreground text-lg mt-0.5">
                    {formatRand(summaries.totalAmount)}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-muted text-muted-foreground text-xs font-semibold"
                >
                  {summaries.lineCount}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search project, category, supplier, invoice…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-muted/50 border-border focus:bg-card transition-colors"
              data-testid="input-search-detail"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as any)}
            className="h-9 px-3 text-sm border border-border rounded-lg bg-muted/50 hover:bg-card transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-300"
            data-testid="select-state-filter"
          >
            <option value="all">All States</option>
            <option value="realised">Realised Only</option>
            <option value="unrealised">Unrealised Only</option>
            <option value="qb_actual">QB Actual Only</option>
          </select>
          <SearchableSelect
            value={projectFilter}
            onValueChange={(v) => setProjectFilter(v || 'all')}
            options={[
              { value: 'all', label: 'All Projects' },
              ...allProjects.map((p) => ({ value: p, label: p })),
            ]}
            placeholder="All Projects"
            searchPlaceholder="Search projects..."
            triggerClassName="h-9 max-w-[220px]"
            data-testid="select-project-filter"
          />
        </div>

        <div className="px-6 py-2.5 border-b border-border bg-muted/60 flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">
            <span className="text-foreground font-semibold">{filtered.length}</span> items
          </span>
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-700 font-mono text-xs font-bold">
                {formatRand(filteredRealised)}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-amber-700 font-mono text-xs font-medium">
                {formatRand(filteredUnrealised)}
              </span>
            </span>
            <span className="font-mono font-bold text-foreground">{formatRand(filteredTotal)}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
              <span className="text-sm">Loading line items…</span>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3 px-6">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="font-medium text-sm">Unable to load detail</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  {detailError instanceof Error
                    ? detailError.message
                    : 'An unexpected error occurred fetching the drill-down.'}
                </p>
              </div>
              <button
                onClick={() => refetchDetail()}
                className="text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted transition-colors"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No line items found"
              description={`No revenue lines match the current filters for ${monthLabel}. Clear the search or pick a different month / status.`}
              className="m-6"
            />
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur-md z-10 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px] w-8"></th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                    Project
                  </th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                    Category
                  </th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                    Line Item
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                    Status
                  </th>
                  <th
                    className="text-center px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]"
                    title="Where this row came from: imported from Smart Import v2, edited after import, manually entered, or covered by an admin override."
                  >
                    Source
                  </th>
                  <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                    COS
                  </th>
                  <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.slice(0, 500).map((item, i) => (
                  <React.Fragment key={item.id}>
                    <tr
                      className={`group cursor-pointer transition-colors ${expandedId === item.id ? 'bg-emerald-50/60' : 'hover:bg-muted/60'}`}
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      data-testid={`row-detail-${i}`}
                    >
                      <td className="px-3 py-2.5 text-muted-foreground transition-colors">
                        {expandedId === item.id ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </td>
                      <td
                        className="px-3 py-2.5 max-w-[150px] truncate font-medium"
                        title={item.projectName}
                      >
                        <button
                          type="button"
                          className="text-emerald-700 hover:text-emerald-900 hover:underline transition-colors text-left truncate max-w-full"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(
                              `/project/${encodeURIComponent(item.projectName)}?tab=revenue-tracking`,
                            );
                          }}
                        >
                          {item.projectName}
                        </button>
                      </td>
                      <td
                        className="px-3 py-2.5 text-muted-foreground max-w-[150px] truncate"
                        title={item.category || ''}
                      >
                        {item.category || '—'}
                      </td>
                      <td
                        className="px-3 py-2.5 max-w-[200px] truncate text-foreground"
                        title={item.lineItem || ''}
                      >
                        {item.lineItem || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${stateBadgeColor(item.revState)}`}
                        >
                          {item.revState}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <DataSourceBadge
                          source={item.dataSource}
                          testId={`data-source-rev-${item.id}`}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                        {formatRand(item.costAmount)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-semibold ${item.isRealised ? 'text-foreground' : 'text-amber-700'}`}
                      >
                        {item.noRevenueLinked ? (
                          <span className="text-muted-foreground italic text-[10px]">No Rev</span>
                        ) : (
                          formatRand(item.revenueAmount)
                        )}
                      </td>
                    </tr>
                    {expandedId === item.id && (
                      <tr className="bg-emerald-50/40">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-6 gap-x-6 gap-y-3 text-xs">
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                                Invoice #
                              </p>
                              <p className="font-medium text-foreground">
                                {item.invoiceNumber || '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                                Invoice Date
                              </p>
                              <p className="font-medium text-foreground">
                                {item.invoiceDate || '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                                Supplier
                              </p>
                              <p className="font-medium text-foreground">{item.supplier || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                                Revenue Status
                              </p>
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${stateBadgeColor(item.revState)}`}
                              >
                                {item.revState}
                              </span>
                              {item.noRevenueLinked && (
                                <Badge
                                  variant="outline"
                                  className="ml-1 text-[9px] border-amber-300 text-amber-700"
                                >
                                  No Rev Linked
                                </Badge>
                              )}
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                                QB Doc / Trace
                              </p>
                              <p className="font-medium text-foreground">
                                {item.qbDocNumber || item.sourceTraceId || '—'}
                              </p>
                              {item.dateSource && (
                                <Badge
                                  variant="outline"
                                  className={`mt-1 text-[9px] ${item.dateSource === 'qb_txn_date_paid' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}
                                  title={item.dateSourceLabel ?? undefined}
                                  data-testid={`badge-date-source-${item.id}`}
                                >
                                  {item.dateSource === 'qb_txn_date_paid'
                                    ? 'Issue date · paid'
                                    : 'Issue date · proxy'}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

type EditingCell = { field: string; monthKey: string; value: string };

export default function RevenueTrackerPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { allowed: canEditRevenueTracker } = usePermission('revenue_tracker', 'edit');
  const fyScope = useFinancialYearScope();
  const revenueTrackerQueryKey = useMemo(
    () => ['/api/revenue-tracker', fyScope.apiQueryString] as const,
    [fyScope.apiQueryString],
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [drawerMonth, setDrawerMonth] = useState<{
    monthKey: string;
    monthLabel: string;
    defaultFilter?: 'all' | 'realised' | 'unrealised' | 'qb_actual';
    defaultProject?: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'recon' | 'trend' | 'gap'>('recon');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const { data, isLoading, isError, error, refetch, dataUpdatedAt, isFetching } =
    useQuery<RevenueTrackerResponse>({
      queryKey: revenueTrackerQueryKey,
      queryFn: fetchQueryFn(`/api/revenue-tracker?${fyScope.apiQueryString}`),
      staleTime: 30_000,
    });

  const { data: projectsSummary = [] } = useQuery<
    Array<{ project_name: string; has_tracker_import?: boolean }>
  >({
    queryKey: ['/api/projects-summary'],
  });

  const trackerProjectNames = useMemo(() => {
    const set = new Set<string>();
    projectsSummary.forEach((p) => {
      if (p.project_name && p.has_tracker_import) set.add(p.project_name);
    });
    return Array.from(set).sort();
  }, [projectsSummary]);

  const filteredRailNames = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return trackerProjectNames;
    return trackerProjectNames.filter((n) => n.toLowerCase().includes(q));
  }, [trackerProjectNames, projectSearch]);

  const isProjectFiltered = selectedProjects.length > 0;

  const mutation = useMutation({
    mutationFn: async (body: { trackerType: string; monthKey: string; budget?: string }) => {
      await apiRequest('POST', '/api/tracker-monthly', body);
    },
    onMutate: async (body: { trackerType: string; monthKey: string; budget?: string }) => {
      if (body.budget == null) return;
      const newBudget = Number(body.budget);
      if (!Number.isFinite(newBudget)) return;
      await qc.cancelQueries({ queryKey: revenueTrackerQueryKey });
      const previous = qc.getQueryData<RevenueTrackerResponse>(revenueTrackerQueryKey);
      if (!previous) return { previous };
      const targetIdx = previous.months.findIndex((m) => m.monthKey === body.monthKey);
      if (targetIdx < 0) return { previous };
      const nextMonths = previous.months.map((m) => ({ ...m }));
      nextMonths[targetIdx].budget = newBudget;
      // Mirror server formula in finance-routes.ts: variance = totalRevenue - budget;
      // ytdBudget cumulative; ytdVariance = ytdRevenue - ytdBudget.
      let ytdBudget = 0;
      let ytdRevenue = 0;
      for (let i = 0; i < nextMonths.length; i++) {
        const m = nextMonths[i];
        ytdBudget += m.budget ?? 0;
        ytdRevenue += m.totalRevenue ?? 0;
        if (i >= targetIdx) {
          m.variance = (m.totalRevenue ?? 0) - (m.budget ?? 0);
          m.variancePct = (m.budget ?? 0) !== 0 ? (m.variance / (m.budget ?? 0)) * 100 : 0;
          m.ytdBudget = ytdBudget;
          m.ytdVariance = ytdRevenue - ytdBudget;
          m.ytdVariancePct = ytdBudget !== 0 ? (m.ytdVariance / ytdBudget) * 100 : 0;
        }
      }
      qc.setQueryData<RevenueTrackerResponse>(revenueTrackerQueryKey, {
        ...previous,
        months: nextMonths,
      });
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(revenueTrackerQueryKey, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: revenueTrackerQueryKey });
      invalidateDashboardQueries(qc);
    },
  });

  const startEdit = useCallback((field: string, monthKey: string, currentValue: number) => {
    setEditing({ field, monthKey, value: String(currentValue) });
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const payload: Record<string, string> = {
      trackerType: 'REV',
      monthKey: editing.monthKey,
    };
    payload[editing.field] = editing.value;
    mutation.mutate(payload as any);
    setEditing(null);
  }, [editing, mutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') setEditing(null);
    },
    [commitEdit],
  );

  const rawMonths = data?.months ?? [];
  // When a project filter is active, derive each month's totals from its per-project
  // breakdown arrays (filtered to selected projects) and rebuild YTD chains. Budget is
  // tracked at the company level only, so it falls to 0 in the filtered view.
  const months = useMemo<MonthData[]>(() => {
    if (!isProjectFiltered) return rawMonths;
    const sel = new Set(selectedProjects);
    const sumProjects = (arr: ProjectBreakdown[] | undefined) =>
      (arr ?? []).filter((p) => sel.has(p.projectName)).reduce((s, p) => s + (p.value ?? 0), 0);
    const filterProjects = (arr: ProjectBreakdown[] | undefined) =>
      (arr ?? []).filter((p) => sel.has(p.projectName));
    let ytdRevenue = 0,
      ytdRealised = 0,
      ytdUnrealised = 0,
      ytdQbRevenueActual = 0;
    const ytdBudget = 0;
    return rawMonths.map((m) => {
      const totalRevenue = sumProjects(m.revProjects);
      const realisedRevenue = sumProjects(m.realisedProjects);
      const unrealisedRevenue = sumProjects(m.unrealisedProjects);
      const qbRevenueActual = sumProjects(m.qbRevenueProjects);
      const budget = 0;
      const variance = totalRevenue - budget;
      const variancePct = 0;
      ytdRevenue += totalRevenue;
      ytdRealised += realisedRevenue;
      ytdUnrealised += unrealisedRevenue;
      ytdQbRevenueActual += qbRevenueActual;
      const ytdVariance = ytdRevenue - ytdBudget;
      const ytdVariancePct = 0;
      return {
        ...m,
        totalRevenue,
        realisedRevenue,
        unrealisedRevenue,
        qbRevenueActual,
        qbVsAppVariance: qbRevenueActual - totalRevenue,
        qbVsAppVariancePct:
          qbRevenueActual !== 0 ? ((qbRevenueActual - totalRevenue) / qbRevenueActual) * 100 : 0,
        budget,
        variance,
        variancePct,
        ytdRevenue,
        ytdRealised,
        ytdUnrealised,
        ytdQbRevenueActual,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
        revProjects: filterProjects(m.revProjects),
        realisedProjects: filterProjects(m.realisedProjects),
        unrealisedProjects: filterProjects(m.unrealisedProjects),
        qbRevenueProjects: filterProjects(m.qbRevenueProjects),
        budgetProjects: filterProjects(m.budgetProjects),
      };
    });
  }, [rawMonths, isProjectFiltered, selectedProjects]);
  const lastMonth = useMemo(() => (months.length ? months[months.length - 1] : null), [months]);
  const prevMonth = useMemo(() => (months.length > 1 ? months[months.length - 2] : null), [months]);

  const fyTotals = useMemo(
    () => ({
      budget: months.reduce((s, m) => s + (m.budget ?? 0), 0),
      planned: months.reduce((s, m) => s + (m.totalRevenue ?? 0), 0),
      realised: months.reduce((s, m) => s + (m.realisedRevenue ?? 0), 0),
      quickbooks: months.reduce((s, m) => s + (m.qbRevenueActual ?? 0), 0),
    }),
    [months],
  );

  const projectNamesByRow = useMemo(() => {
    const result: Record<string, string[]> = {};
    const trackerSet = new Set(trackerProjectNames);
    const selectedSet = new Set(selectedProjects);
    for (const key of [
      'revProjects',
      'realisedProjects',
      'unrealisedProjects',
      'qbRevenueProjects',
    ] as const) {
      const names = new Set<string>();
      for (const m of months) {
        for (const p of (m as any)[key] || []) {
          if (!trackerSet.has(p.projectName)) continue;
          if (selectedSet.size > 0 && !selectedSet.has(p.projectName)) continue;
          names.add(p.projectName);
        }
      }
      result[key] = Array.from(names).sort();
    }
    return result;
  }, [months, trackerProjectNames, selectedProjects]);

  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        month: m.monthLabel,
        'Revenue Planned (Budget)': m.budget,
        'Revenue Committed': m.unrealisedRevenue,
        'Revenue Realised': m.realisedRevenue,
        'Quickbooks Revenue': m.qbRevenueActual,
      })),
    [months],
  );

  const sparkData = useMemo(() => {
    return {
      realised: months.map((m) => ({ x: m.monthKey, y: m.realisedRevenue })),
      committed: months.map((m) => ({ x: m.monthKey, y: m.unrealisedRevenue })),
      planned: months.map((m) => ({ x: m.monthKey, y: m.totalRevenue })),
    } as Record<RevTab, { x: string; y: number }[]>;
  }, [months]);

  const getCellColor = (val: number, variancePct?: number) => {
    const pct = variancePct != null ? Math.abs(variancePct) : null;
    const isPositive = val > 0;
    if (pct !== null) {
      if (pct >= 0.25)
        return isPositive
          ? 'text-emerald-700 font-bold bg-emerald-50'
          : 'text-destructive font-bold bg-destructive/10';
      if (pct >= 0.15)
        return isPositive
          ? 'text-emerald-600 font-semibold bg-emerald-50'
          : 'text-amber-700 font-semibold bg-amber-50';
    }
    return isPositive ? 'text-emerald-700' : 'text-destructive';
  };

  const formatCell = (row: RowDef, val: number) => {
    if (row.key === 'variancePct' || row.key === 'ytdVariancePct') return `${val.toFixed(1)}%`;
    return formatRand(val);
  };

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) {
    return (
      <div className="p-3 md:p-4">
        <PageError
          title="Unable to load Revenue Tracker"
          message={error instanceof Error ? error.message : 'Failed to fetch data'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const ytdPlanned = lastMonth?.ytdBudget ?? 0;
  const ytdCommitted = lastMonth?.ytdUnrealised ?? 0;
  const ytdRealised = lastMonth?.ytdRealised ?? 0;
  const ytdQbRev = lastMonth?.ytdQbRevenueActual ?? 0;
  const realisationRate = ytdPlanned > 0 ? Math.round((ytdRealised / ytdPlanned) * 100) : 0;

  const kpiByTab: Record<RevTab, { ytdValue: number; lastValue: number; prevValue: number }> = {
    realised: {
      ytdValue: ytdRealised,
      lastValue: lastMonth?.realisedRevenue ?? 0,
      prevValue: prevMonth?.realisedRevenue ?? 0,
    },
    committed: {
      ytdValue: ytdCommitted,
      lastValue: lastMonth?.unrealisedRevenue ?? 0,
      prevValue: prevMonth?.unrealisedRevenue ?? 0,
    },
    planned: {
      ytdValue: ytdPlanned,
      lastValue: lastMonth?.totalRevenue ?? 0,
      prevValue: prevMonth?.totalRevenue ?? 0,
    },
  };

  const renderSparkline = (tab: RevTab) => (
    <div className="h-10 w-28 sm:w-36">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sparkData[tab]} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="y"
            stroke={TAB_META[tab].sparkColor}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  type FyCardKey = 'budget' | 'planned' | 'realised' | 'quickbooks';
  const FY_CARD_META: Record<
    FyCardKey,
    {
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      iconBg: string;
      accent: string;
      sparkColor: string;
      monthField: keyof MonthData;
    }
  > = {
    budget: {
      label: 'FY Budget',
      icon: Wallet,
      iconBg: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      accent: 'text-emerald-700',
      sparkColor: '#16a34a',
      monthField: 'budget',
    },
    planned: {
      label: 'FY Planned',
      icon: ListChecks,
      iconBg: 'bg-emerald-100 text-emerald-700',
      accent: 'text-emerald-700',
      sparkColor: '#16a34a',
      monthField: 'totalRevenue',
    },
    realised: {
      label: 'FY Realised',
      icon: CheckCircle2,
      iconBg: 'bg-foreground/8 text-foreground',
      accent: 'text-foreground',
      sparkColor: '#0f172a',
      monthField: 'realisedRevenue',
    },
    quickbooks: {
      label: 'FY Quickbooks',
      icon: DollarSign,
      iconBg: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      accent: 'text-emerald-700',
      sparkColor: '#16a34a',
      monthField: 'qbRevenueActual',
    },
  };

  // Visual redesign — migrated to <KpiTile> with the new sparkline slot
  // so the per-tile trend chart survives the rebuild. Same icon + label +
  // MoM delta semantics; rendered through the canonical component.
  const renderFyKpiCard = (key: FyCardKey) => {
    const meta = FY_CARD_META[key];
    const Icon = meta.icon;
    const fyValue = fyTotals[key];
    const lastValue = (lastMonth?.[meta.monthField] as number | undefined) ?? 0;
    const prevValue = (prevMonth?.[meta.monthField] as number | undefined) ?? 0;
    const deltaAbs = lastValue - prevValue;
    const deltaPct = prevValue !== 0 ? (deltaAbs / Math.abs(prevValue)) * 100 : 0;
    const cardSpark = months.map((m) => ({
      x: m.monthKey,
      y: (m[meta.monthField] as number | undefined) ?? 0,
    }));
    return (
      <KpiTile
        key={key}
        data-testid={`text-fy-${key}-value`}
        label={meta.label}
        icon={<Icon className="h-4 w-4" />}
        value={formatRand(fyValue)}
        delta={
          prevMonth
            ? {
                label: "Last mo.",
                priorValue: formatRand(lastValue),
                pct: deltaPct,
                positiveIs: "good",
              }
            : undefined
        }
        sparkline={{
          content: (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cardSpark} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke={meta.sparkColor}
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ),
          widthClass: "w-28 sm:w-36",
        }}
      />
    );
  };

  const renderTrend = () => (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="bg-muted/30 border-b border-border px-3 sm:px-5 py-2.5 sm:py-3">
        <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
          <LineChartIcon className="h-4 w-4 text-muted-foreground" />
          Revenue trend — Planned vs Committed vs Realised vs QB
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-6">
        <div className="h-[320px] sm:h-[440px]" data-testid="chart-revenue">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => formatZarCompact(v)}
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: number) => formatRand(value)}
                contentStyle={{
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  fontSize: '12px',
                }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
              <Bar dataKey="Revenue Planned (Budget)" fill="#a7f3d0" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Revenue Committed" stackId="rev" fill="#f59e0b" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Revenue Realised" stackId="rev" fill="#0f172a" radius={[4, 4, 0, 0]} />
              <Line
                type="monotone"
                dataKey="Quickbooks Revenue"
                stroke="#16a34a"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );

  const renderGrid = () => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs sm:text-sm" data-testid="table-revenue-grid">
        <thead>
          <tr className="border-b border-border bg-muted/80">
            <th className="sticky left-0 z-10 bg-muted/95 backdrop-blur-sm px-3 sm:px-5 py-2 sm:py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] min-w-[140px] sm:min-w-[200px] border-r border-border">
              Metric
            </th>
            {months.map((m) => (
              <th
                key={m.monthKey}
                className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-muted-foreground uppercase tracking-wider text-[10px] sm:text-[11px] whitespace-nowrap min-w-[85px] sm:min-w-[110px]"
              >
                {m.monthLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROW_DEFS.map((row, rowIdx) => {
            const isYtd = row.group === 'ytd';
            const isExpanded = expandedRows.has(row.key);
            const isClickable = [
              'totalRevenue',
              'realisedRevenue',
              'unrealisedRevenue',
              'qbRevenueActual',
            ].includes(row.key);
            const isFirstYtd = isYtd && rowIdx > 0 && ROW_DEFS[rowIdx - 1].group !== 'ytd';
            return (
              <React.Fragment key={row.key}>
                {isFirstYtd && (
                  <tr>
                    <td colSpan={months.length + 1} className="bg-muted/60 h-px" />
                  </tr>
                )}
                <tr
                  className={`border-b border-border transition-colors ${isYtd ? 'bg-muted/40' : 'bg-card'} hover:bg-muted/40`}
                  data-testid={`row-${row.key}`}
                >
                  <td
                    className={`sticky left-0 z-10 px-3 sm:px-5 py-2 sm:py-2.5 font-medium text-xs sm:text-sm border-r border-border ${isYtd ? 'bg-muted/95' : 'bg-card/95'} backdrop-blur-sm`}
                  >
                    {row.expandable ? (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 hover:text-emerald-700 transition-colors group"
                        onClick={() => toggleRow(row.key)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.label} by project`}
                        data-testid={`toggle-${row.key}`}
                      >
                        <span className="text-muted-foreground group-hover:text-emerald-600 transition-colors">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </span>
                        <span>{row.label}</span>
                        {row.help && <RowHelp text={row.help} />}
                      </button>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 ${isYtd ? 'pl-5.5 text-muted-foreground' : ''}`}
                      >
                        {row.label}
                        {row.help && <RowHelp text={row.help} />}
                      </span>
                    )}
                  </td>
                  {months.map((m) => {
                    const val = m[row.dataKey] as number;
                    const isEditingCell =
                      editing?.field === row.key && editing?.monthKey === m.monthKey;
                    if (row.editable && canEditRevenueTracker && !isProjectFiltered) {
                      return (
                        <td key={m.monthKey} className="px-1 sm:px-2 py-1 sm:py-1.5 text-right">
                          {isEditingCell ? (
                            <Input
                              type="number"
                              className="h-7 sm:h-8 w-full text-right font-mono text-xs sm:text-sm border-emerald-300 focus:ring-emerald-400"
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onBlur={commitEdit}
                              onKeyDown={handleKeyDown}
                              autoFocus
                              data-testid={`input-${row.key}-${m.monthKey}`}
                            />
                          ) : (
                            <button
                              type="button"
                              className={`w-full text-right font-mono cursor-pointer hover:bg-emerald-50 rounded-lg px-1.5 sm:px-3 py-1 sm:py-1.5 transition-colors ${row.colorClass}`}
                              onClick={() => startEdit(row.key, m.monthKey, val)}
                              data-testid={`cell-${row.key}-${m.monthKey}`}
                            >
                              {formatRand(val)}
                            </button>
                          )}
                        </td>
                      );
                    }
                    const pctRef =
                      row.key === 'variance'
                        ? m.variancePct
                        : row.key === 'ytdVariance'
                          ? m.ytdVariancePct
                          : row.key === 'variancePct' || row.key === 'ytdVariancePct'
                            ? val
                            : undefined;
                    const colorClass = row.colorCoded ? getCellColor(val, pctRef) : row.colorClass;
                    return (
                      <td
                        key={m.monthKey}
                        className={`px-2 sm:px-4 py-1.5 sm:py-2.5 text-right font-mono text-xs sm:text-sm ${colorClass} ${isClickable ? 'cursor-pointer hover:bg-emerald-50/70 hover:underline decoration-emerald-300 underline-offset-2 transition-colors rounded' : ''}`}
                        onClick={
                          isClickable
                            ? () =>
                                setDrawerMonth({
                                  monthKey: m.monthKey,
                                  monthLabel: m.monthLabel,
                                  defaultFilter:
                                    row.key === 'realisedRevenue'
                                      ? 'realised'
                                      : row.key === 'unrealisedRevenue'
                                        ? 'unrealised'
                                        : row.key === 'qbRevenueActual'
                                          ? 'qb_actual'
                                          : 'all',
                                })
                            : undefined
                        }
                        data-testid={`cell-${row.key}-${m.monthKey}`}
                      >
                        {formatCell(row, val)}
                      </td>
                    );
                  })}
                </tr>
                {row.expandable &&
                  isExpanded &&
                  row.projectsKey &&
                  (projectNamesByRow[row.projectsKey] || []).map((pName) => (
                    <tr
                      key={`${row.key}-${pName}`}
                      className="border-b border-border/40 bg-emerald-50/20 hover:bg-emerald-50/40 transition-colors"
                      data-testid={`row-detail-${row.key}-${pName}`}
                    >
                      <td
                        className="sticky left-0 z-10 bg-emerald-50/30 backdrop-blur-sm pl-7 sm:pl-11 pr-2 sm:pr-4 py-1 sm:py-1.5 text-[10px] sm:text-xs text-muted-foreground truncate max-w-[140px] sm:max-w-[200px] border-r border-border"
                        title={pName}
                      >
                        <button
                          type="button"
                          className="cursor-pointer text-emerald-700 hover:text-emerald-900 hover:underline decoration-dashed underline-offset-2 transition-colors text-left"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/project/${encodeURIComponent(pName)}?tab=revenue-tracking`);
                          }}
                          aria-label={`View ${pName} revenue details`}
                        >
                          {pName}
                        </button>
                      </td>
                      {months.map((m) => {
                        const projArr = row.projectsKey
                          ? ((m as any)[row.projectsKey] as ProjectBreakdown[])
                          : [];
                        const proj = projArr?.find(
                          (p: ProjectBreakdown) => p.projectName === pName,
                        );
                        const val = proj?.value ?? 0;
                        const drillFilter =
                          row.key === 'realisedRevenue'
                            ? ('realised' as const)
                            : row.key === 'unrealisedRevenue'
                              ? ('unrealised' as const)
                              : row.key === 'qbRevenueActual'
                                ? ('qb_actual' as const)
                                : ('all' as const);
                        return (
                          <td
                            key={m.monthKey}
                            className={`px-2 sm:px-4 py-1 sm:py-1.5 text-right font-mono text-[10px] sm:text-xs text-emerald-700/70 ${val !== 0 ? 'cursor-pointer hover:bg-emerald-50/70 hover:underline decoration-emerald-300 underline-offset-2 transition-colors rounded' : ''}`}
                            onClick={
                              val !== 0
                                ? () =>
                                    setDrawerMonth({
                                      monthKey: m.monthKey,
                                      monthLabel: m.monthLabel,
                                      defaultFilter: drillFilter,
                                      defaultProject: pName,
                                    })
                                : undefined
                            }
                            data-testid={`cell-detail-${row.key}-${pName}-${m.monthKey}`}
                          >
                            {val !== 0 ? formatRand(val) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {/* Visual redesign — reconciliation footer ties the per-month sum back
          to the hero YTD realised revenue (TF-19). */}
      <DrillReconciliationFooter
        sourceLabel="Hero · YTD revenue realised"
        sourceValue={ytdRealised}
        drilldownLabel={`Sum across ${months.length} months · realised`}
        drilldownValue={months.reduce((s, m) => s + (m.realisedRevenue ?? 0), 0)}
      />
    </div>
  );

  return (
    <FinanceShell>
      <div className="space-y-3">
        <SectionHeader
          icon={<Wallet className="h-5 w-5" />}
          title={`Revenue Tracker ${fyScope.label}`}
          eyebrow={
            fyScope.allData
              ? 'All finance data in the system'
              : `${fyScope.startDate} to ${fyScope.endDate}`
          }
          actions={
            <>
              <FinancialYearScopeControl scope={fyScope} />
              <TooltipProvider delayDuration={200}>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-lg border-border"
                      data-testid="button-revenue-help"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                      How it works
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[320px] text-xs leading-relaxed">
                    <p className="font-semibold mb-1">Revenue realisation pipeline</p>
                    <p>
                      <strong>Planned</strong> = revenue line on a planned date (no invoice yet).
                    </p>
                    <p>
                      <strong>Committed</strong> = revenue line linked to an invoice but invoice
                      date unconfirmed.
                    </p>
                    <p>
                      <strong>Realised</strong> = invoice captured AND invoice date confirmed.
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Allocated via the COS-ratio method. This is recognition, not cash received.
                    </p>
                  </TooltipContent>
                </UiTooltip>
              </TooltipProvider>
            </>
          }
        />
        {/* Visual redesign — PageHero. The headline answer: how much revenue have
            we realised YTD vs. plan, and how far ahead / behind are we. The badge
            strip below becomes supporting context. */}
        <PageHero
          eyebrow="Finance · Revenue"
          label={`YTD revenue realised${fyScope.label ? ` · ${fyScope.label}` : ''}`}
          value={<Money value={ytdRealised} />}
          tone={ytdPlanned > 0 && ytdRealised >= ytdPlanned ? 'positive' : 'default'}
          supporting={
            ytdPlanned > 0 ? (
              <>
                vs. plan <Money value={ytdPlanned} /> ·{' '}
                <DirectionDelta value={ytdRealised - ytdPlanned} positiveIs="good" asMoney /> ·{' '}
                {realisationRate}% realisation
              </>
            ) : (
              <>No plan baseline yet.</>
            )
          }
          trust={[
            { label: 'QB revenue YTD', value: <Money value={ytdQbRev} /> },
            { label: 'In pipeline', value: <Money value={ytdCommitted} /> },
          ]}
          data-testid="revenue-page-hero"
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground -mt-1">
          <Badge
            variant="outline"
            className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card"
          >
            <CheckCircle2 className="h-3 w-3 text-foreground" />
            YTD Realised {formatRand(ytdRealised)}
          </Badge>
          <Badge
            variant="outline"
            className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card"
          >
            <ListChecks className="h-3 w-3 text-emerald-700" />
            YTD Planned {formatRand(ytdPlanned)}
          </Badge>
          <Badge
            variant="outline"
            className="gap-1 px-2 py-0.5 text-[11px] font-medium border-emerald-200 bg-emerald-50 text-emerald-800"
          >
            <TrendingUp className="h-3 w-3" />
            {realisationRate}% realised
          </Badge>
          <Badge
            variant="outline"
            className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card"
          >
            <DollarSign className="h-3 w-3" />
            QB Actual {formatRand(ytdQbRev)}
          </Badge>
          <Badge
            variant="outline"
            className="gap-1 px-2 py-0.5 text-[11px] font-medium border-border bg-card"
          >
            <Loader2 className={`h-3 w-3 ${isFetching ? 'animate-spin text-emerald-600' : ''}`} />
            {dataUpdatedAt
              ? `Refreshed ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Live'}
          </Badge>
        </div>

        <div className="lg:flex lg:gap-5 lg:items-start -mt-1">
          <aside
            className="hidden lg:flex lg:flex-col lg:w-56 lg:shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] rounded-xl border border-border bg-card shadow-sm p-3"
            data-testid="rail-filter-revenue"
            aria-label="Filter projects"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Projects
              </h3>
              {selectedProjects.length > 0 && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedProjects([])}
                  data-testid="rail-clear-all-revenue"
                >
                  Clear ({selectedProjects.length})
                </button>
              )}
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search projects…"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
                data-testid="rail-search-revenue"
              />
            </div>
            <div className="overflow-y-auto -mx-1 px-1">
              <label className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                <input
                  type="checkbox"
                  className="accent-emerald-600 h-3.5 w-3.5"
                  checked={selectedProjects.length === 0}
                  onChange={() => setSelectedProjects([])}
                  data-testid="rail-all-projects-revenue"
                />
                <span
                  className={`truncate ${selectedProjects.length === 0 ? 'font-medium' : 'text-muted-foreground'}`}
                >
                  All projects
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {trackerProjectNames.length}
                </span>
              </label>
              {filteredRailNames.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-2 py-3">
                  No tracker-loaded projects match.
                </p>
              ) : (
                filteredRailNames.map((name) => {
                  const checked = selectedProjects.includes(name);
                  return (
                    <label
                      key={name}
                      className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs"
                    >
                      <input
                        type="checkbox"
                        className="accent-emerald-600 h-3.5 w-3.5"
                        checked={checked}
                        onChange={() =>
                          setSelectedProjects((prev) =>
                            prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
                          )
                        }
                        data-testid={`rail-project-revenue-${name}`}
                      />
                      <span
                        className={`truncate ${checked ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                        title={name}
                      >
                        {name}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </aside>

          <div className="flex-1 min-w-0 space-y-3">
            <div
              className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3"
              data-testid="kpi-strip-revenue"
            >
              {renderFyKpiCard('budget')}
              {renderFyKpiCard('planned')}
              {renderFyKpiCard('realised')}
              {renderFyKpiCard('quickbooks')}
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as 'recon' | 'trend' | 'gap')}
            >
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <TabsList className="bg-muted/60">
                  <TabsTrigger
                    value="recon"
                    className="data-[state=active]:bg-card gap-1.5"
                    data-testid="tab-recon"
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    Recon Grid
                  </TabsTrigger>
                  <TabsTrigger
                    value="trend"
                    className="data-[state=active]:bg-card gap-1.5"
                    data-testid="tab-trend"
                  >
                    <LineChartIcon className="h-3.5 w-3.5" />
                    Trend
                  </TabsTrigger>
                  <TabsTrigger
                    value="gap"
                    className="data-[state=active]:bg-card gap-1.5"
                    data-testid="tab-revenue-gap"
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    Tracker Gap
                  </TabsTrigger>
                </TabsList>

                <div className="lg:hidden">
                  <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 rounded-lg border-border"
                        data-testid="button-project-picker-revenue"
                      >
                        <Filter className="h-3.5 w-3.5" />
                        Projects
                        {selectedProjects.length > 0 && (
                          <Badge
                            variant="outline"
                            className="ml-1 px-1.5 py-0 text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            {selectedProjects.length}
                          </Badge>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-2" align="end">
                      <div className="relative mb-2">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="Search projects…"
                          value={projectSearch}
                          onChange={(e) => setProjectSearch(e.target.value)}
                          className="h-8 pl-7 text-xs"
                        />
                      </div>
                      <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                        <label className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs">
                          <input
                            type="checkbox"
                            className="accent-emerald-600 h-3.5 w-3.5"
                            checked={selectedProjects.length === 0}
                            onChange={() => setSelectedProjects([])}
                          />
                          <span
                            className={`truncate ${selectedProjects.length === 0 ? 'font-medium' : 'text-muted-foreground'}`}
                          >
                            All projects
                          </span>
                        </label>
                        {filteredRailNames.map((name) => {
                          const checked = selectedProjects.includes(name);
                          return (
                            <label
                              key={name}
                              className="flex items-center gap-2 px-1 py-1 cursor-pointer rounded hover:bg-muted/40 text-xs"
                            >
                              <input
                                type="checkbox"
                                className="accent-emerald-600 h-3.5 w-3.5"
                                checked={checked}
                                onChange={() =>
                                  setSelectedProjects((prev) =>
                                    prev.includes(name)
                                      ? prev.filter((x) => x !== name)
                                      : [...prev, name],
                                  )
                                }
                              />
                              <span
                                className={`truncate ${checked ? 'font-medium' : 'text-muted-foreground'}`}
                              >
                                {name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {selectedProjects.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3 lg:hidden">
                  {selectedProjects.map((p) => (
                    <Badge
                      key={p}
                      variant="secondary"
                      className="text-xs gap-1 cursor-pointer hover:bg-destructive/10"
                      onClick={() => setSelectedProjects((prev) => prev.filter((x) => x !== p))}
                    >
                      {p}
                      <X className="h-3 w-3" />
                    </Badge>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground px-2"
                    onClick={() => setSelectedProjects([])}
                  >
                    Clear all
                  </Button>
                </div>
              )}

              <TabsContent value="recon" className="mt-0">
                <Card className="shadow-sm overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b border-border px-3 sm:px-5 py-2.5 sm:py-3">
                    <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-muted-foreground" />
                      Planned → Committed → Realised → QuickBooks reconciliation
                      {isProjectFiltered && (
                        <Badge
                          variant="outline"
                          className="ml-2 text-[10px] font-medium border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          Filtered: {selectedProjects.length} project
                          {selectedProjects.length === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">{renderGrid()}</CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="trend" className="mt-0">
                {renderTrend()}
              </TabsContent>
              <TabsContent value="gap" className="mt-0">
                <RevenueGapTab />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {drawerMonth && (
        <MonthDetailDrawer
          key={`${drawerMonth.monthKey}-${drawerMonth.defaultFilter}-${drawerMonth.defaultProject || 'all'}`}
          monthKey={drawerMonth.monthKey}
          monthLabel={drawerMonth.monthLabel}
          defaultFilter={drawerMonth.defaultFilter}
          defaultProject={drawerMonth.defaultProject}
          onClose={() => setDrawerMonth(null)}
        />
      )}
    </FinanceShell>
  );
}

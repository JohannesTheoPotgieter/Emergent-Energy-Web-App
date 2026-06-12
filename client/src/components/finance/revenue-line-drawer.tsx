/**
 * RevenueMonthDetailDrawer — the line/invoice level of the Revenue drill
 * (FY → month → project → line → invoice).
 *
 * Extracted verbatim from the legacy revenue-tracker page body so the
 * compact-template page stays lean. Presentation only — it reads the SAME
 * canonical `/api/revenue-tracker/month-detail` endpoint and changes no
 * figure (every amount renders through the shared <MoneyValue>).
 */
import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MoneyValue } from '@/components/finance/template';
import { fetchQueryFn } from '@/lib/queryClient';
import { DataSourceBadge } from '@/components/finance/DataSourceBadge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { EmptyState } from '@/components/ui/empty-state';
import {
  X,
  Search,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

export interface RevenueMonthDetailItem {
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

export type RevenueDetailFilter = 'all' | 'realised' | 'unrealised' | 'qb_actual';

function money(val: number | null | undefined) {
  return <MoneyValue value={val} align="left" muteNegative={false} />;
}

export function RevenueMonthDetailDrawer({
  monthKey,
  monthLabel,
  onClose,
  defaultFilter = 'all',
  defaultProject = 'all',
}: {
  monthKey: string;
  monthLabel: string;
  onClose: () => void;
  defaultFilter?: RevenueDetailFilter;
  defaultProject?: string;
}) {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<RevenueDetailFilter>(defaultFilter);
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
  } = useQuery<RevenueMonthDetailItem[]>({
    queryKey: ['/api/revenue-tracker/month-detail', monthKey, stateFilter, projectFilter],
    queryFn: fetchQueryFn(
      `/api/revenue-tracker/month-detail?monthKey=${monthKey}${stateParam}${projectParam}`,
    ),
    retry: 1,
  });

  const items = useMemo(() => rawItems ?? [], [rawItems]);

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

  const filteredTotal = useMemo(() => filtered.reduce((s, i) => s + i.revenueAmount, 0), [filtered]);
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
        <div className="px-3 sm:px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-bold text-xl tracking-tight text-foreground" data-testid="text-drawer-title">
              {monthLabel}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Revenue line-item detail · {summaries.lineCount} items · {money(summaries.totalAmount)}
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

        <div className="px-3 sm:px-6 py-3 border-b border-border grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-emerald-700 uppercase tracking-wider">Realised</p>
              <p className="font-mono font-black text-foreground text-lg" data-testid="text-realised-total">
                {money(summaries.realisedTotal)}
              </p>
            </div>
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
              {summaries.realisedCount}
            </Badge>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wider">Unrealised</p>
              <p className="font-mono font-bold text-amber-700 text-lg" data-testid="text-unrealised-total">
                {money(summaries.unrealisedTotal)}
              </p>
            </div>
            <Badge variant="secondary" className="bg-amber-100 text-amber-700">
              {summaries.unrealisedCount}
            </Badge>
          </div>
          <div className="rounded-lg bg-muted/50 border border-border px-4 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</p>
              <p className="font-mono font-bold text-foreground text-lg">{money(summaries.totalAmount)}</p>
            </div>
            <Badge variant="secondary" className="bg-muted text-muted-foreground">
              {summaries.lineCount}
            </Badge>
          </div>
        </div>

        <div className="px-3 sm:px-6 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search project, category, supplier, invoice…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
              data-testid="input-search-detail"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as RevenueDetailFilter)}
            className="h-9 px-3 text-sm border border-border rounded-lg bg-muted/50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-300"
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

        <div className="px-3 sm:px-6 py-2 border-b border-border bg-muted/60 flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">
            <span className="text-foreground font-semibold">{filtered.length}</span> items
          </span>
          <div className="flex items-center gap-5">
            <span className="text-emerald-700 font-mono text-xs font-bold">{money(filteredRealised)}</span>
            <span className="text-amber-700 font-mono text-xs">{money(filteredUnrealised)}</span>
            <span className="font-mono font-bold text-foreground">{money(filteredTotal)}</span>
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
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-xs text-muted-foreground max-w-md">
                {detailError instanceof Error ? detailError.message : 'Unable to load the drill-down.'}
              </p>
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
              description={`No revenue lines match the current filters for ${monthLabel}.`}
              className="m-6"
            />
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur-md z-10 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2.5 w-8" />
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Project</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Category</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Line Item</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Status</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Source</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">COS</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Revenue</th>
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
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {expandedId === item.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </td>
                      <td className="px-3 py-2.5 max-w-[150px] truncate font-medium" title={item.projectName}>
                        <button
                          type="button"
                          className="text-emerald-700 hover:text-emerald-900 hover:underline text-left truncate max-w-full"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/project/${encodeURIComponent(item.projectName)}?tab=revenue-tracking`);
                          }}
                        >
                          {item.projectName}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground max-w-[150px] truncate" title={item.category || ''}>
                        {item.category || '—'}
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate text-foreground" title={item.lineItem || ''}>
                        {item.lineItem || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${stateBadgeColor(item.revState)}`}>
                          {item.revState}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <DataSourceBadge source={item.dataSource} testId={`data-source-rev-${item.id}`} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{money(item.costAmount)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${item.isRealised ? 'text-foreground' : 'text-amber-700'}`}>
                        {item.noRevenueLinked ? (
                          <span className="text-muted-foreground italic text-[10px]">No Rev</span>
                        ) : (
                          money(item.revenueAmount)
                        )}
                      </td>
                    </tr>
                    {expandedId === item.id && (
                      <tr className="bg-emerald-50/40">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-3 text-xs">
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Invoice #</p>
                              <p className="font-medium text-foreground">{item.invoiceNumber || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Invoice Date</p>
                              <p className="font-medium text-foreground">{item.invoiceDate || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Supplier</p>
                              <p className="font-medium text-foreground">{item.supplier || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Revenue Status</p>
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${stateBadgeColor(item.revState)}`}>
                                {item.revState}
                              </span>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">QB Doc / Trace</p>
                              <p className="font-medium text-foreground">{item.qbDocNumber || item.sourceTraceId || '—'}</p>
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

/**
 * FinanceLineDetailDrawer — the shared line-item slide-over used by the
 * Revenue, COS and GP finance surfaces so all three drill into the same
 * look-and-feel (KPI strip → search/filter bar → line table → expandable row).
 *
 * Presentation only. It reads the SAME canonical endpoints each tab already
 * uses and changes no figure (every amount renders through <MoneyValue>):
 *
 *   variant="revenue"  GET /api/revenue-tracker/month-detail  (array)
 *   variant="cos"      GET /api/cos-tracker/month-detail       ({ items })
 *   variant="gp"       GET /api/finance/lines/:projectId        ({ lines })
 *
 * The month variants (revenue / cos) filter by state + project SERVER-side
 * (refetch on change); the gp variant fetches a project's canonical lines once
 * and filters by state + category CLIENT-side. Columns are uniform across all
 * three: Project (month variants) ▸ Category ▸ Line Item ▸ Invoice # ▸ Status
 * ▸ the variant's amount column(s).
 *
 * NOTE: the `month-detail` URL strings intentionally live in THIS component
 * (not in any finance *page*), per the compact-template conformance guard
 * (qa/tests/unit/finance-template-conformance.test.ts).
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MoneyValue } from '@/components/finance/template';
import { fetchQueryFn } from '@/lib/queryClient';
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

export type FinanceDetailVariant = 'revenue' | 'cos' | 'gp';
export type FinanceDetailStateFilter = 'all' | 'realised' | 'committed' | 'unrealised' | 'qb_actual';

/** Normalised line shape the drawer renders, regardless of source endpoint. */
interface DrawerLine {
  id: string | number;
  projectName: string | null;
  category: string | null;
  categoryKey: string | null;
  lineItem: string | null;
  cos: number;
  revenue: number | null;
  gp: number | null;
  qb: number | null;
  status: string;
  isRealised: boolean;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  poNumber: string | null;
  supplier: string | null;
  rowSource: string | null;
  overridden: boolean;
  traceId: string | null;
  noRevenueLinked: boolean;
}

// ── Raw wire shapes (per endpoint) ──────────────────────────────────────────
interface RevenueRaw {
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
  rowSource?: string | null;
  overridden?: boolean;
  qbDocNumber?: string | null;
  sourceTraceId?: string | null;
}
interface CosRaw {
  id: string;
  projectName: string | null;
  category: string | null;
  lineItem: string | null;
  appAmount: number | null;
  qbAmount: number | null;
  contributionAmount: number;
  invoiceNumber: string | null;
  qbBillNumber: string | null;
  invoiceDate: string | null;
  supplier: string | null;
  poNumber: string | null;
  cosState: 'realised' | 'committed' | 'planned' | 'qb_actual';
  rowSource?: string | null;
  overridden?: boolean;
  sourceTraceId?: string | null;
}
interface CosResponse {
  items: CosRaw[];
}
interface GpRaw {
  lineId: number;
  parentLineId: number;
  categoryAllocationId: number | null;
  categoryKey: string | null;
  categoryName: string | null;
  categoryNumber: string | null;
  descriptionOfWork: string | null;
  actualTotal: number;
  perLineRevenue: number;
  perLineGp: number;
  invoiceNumber: string | null;
  poNumber: string | null;
  invoiceRaisedDate: string | null;
  bucket: 'planned' | 'committed' | 'unrealised' | 'realised';
  recognitionMonth: string | null;
}
interface GpResponse {
  lines: GpRaw[];
}

const COS_STATE_LABEL: Record<CosRaw['cosState'], string> = {
  realised: 'Realised',
  committed: 'Committed',
  planned: 'Planned',
  qb_actual: 'QB Actual',
};
const GP_BUCKET_LABEL: Record<GpRaw['bucket'], string> = {
  realised: 'Realised',
  committed: 'Committed',
  planned: 'Planned',
  unrealised: 'Invoiced',
};

function money(val: number | null | undefined) {
  return <MoneyValue value={val} align="left" muteNegative={false} />;
}

interface NumericCol {
  key: 'cos' | 'revenue' | 'gp' | 'qb';
  header: string;
  get: (l: DrawerLine) => number | null;
  highlight?: boolean;
}

const NUMERIC_COLS: Record<FinanceDetailVariant, NumericCol[]> = {
  revenue: [
    { key: 'cos', header: 'COS', get: (l) => l.cos },
    { key: 'revenue', header: 'Revenue', get: (l) => l.revenue, highlight: true },
  ],
  cos: [
    { key: 'cos', header: 'COS', get: (l) => l.cos, highlight: true },
  ],
  gp: [
    { key: 'cos', header: 'COS', get: (l) => l.cos },
    { key: 'revenue', header: 'Revenue', get: (l) => l.revenue },
    { key: 'gp', header: 'GP', get: (l) => l.gp, highlight: true },
  ],
};

/** Primary amount each variant sums for its KPI strip. */
function primaryOf(variant: FinanceDetailVariant, l: DrawerLine): number {
  if (variant === 'revenue') return l.revenue ?? 0;
  if (variant === 'gp') return l.gp ?? 0;
  return l.cos;
}

function normaliseRevenue(rows: RevenueRaw[]): DrawerLine[] {
  return rows.map((r) => ({
    id: r.id,
    projectName: r.projectName,
    category: r.category,
    categoryKey: r.category,
    lineItem: r.lineItem,
    cos: r.costAmount,
    revenue: r.revenueAmount,
    gp: null,
    qb: null,
    status: r.revState,
    isRealised: r.isRealised,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate,
    poNumber: r.poNumber,
    supplier: r.supplier,
    rowSource: r.rowSource ?? null,
    overridden: !!r.overridden,
    traceId: r.qbDocNumber || r.sourceTraceId || null,
    noRevenueLinked: r.noRevenueLinked,
  }));
}

function normaliseCos(rows: CosRaw[]): DrawerLine[] {
  return rows.map((r) => ({
    id: r.id,
    projectName: r.projectName,
    category: r.category,
    categoryKey: r.category,
    lineItem: r.lineItem,
    cos: r.contributionAmount,
    revenue: null,
    gp: null,
    qb: r.qbAmount,
    status: COS_STATE_LABEL[r.cosState] ?? r.cosState,
    isRealised: r.cosState === 'realised',
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate,
    poNumber: r.poNumber,
    supplier: r.supplier,
    rowSource: r.rowSource ?? null,
    overridden: !!r.overridden,
    traceId: r.qbBillNumber || r.sourceTraceId || null,
    noRevenueLinked: false,
  }));
}

function normaliseGp(rows: GpRaw[]): DrawerLine[] {
  return rows.map((r) => ({
    id: r.lineId,
    projectName: null,
    category: r.categoryNumber ? `${r.categoryNumber}. ${r.categoryName ?? ''}`.trim() : r.categoryName,
    categoryKey: r.categoryAllocationId != null ? `alloc:${r.categoryAllocationId}` : `missing:${r.categoryKey ?? 'uncategorised'}`,
    lineItem: r.descriptionOfWork,
    cos: r.actualTotal,
    revenue: r.perLineRevenue,
    gp: r.perLineGp,
    qb: null,
    status: GP_BUCKET_LABEL[r.bucket] ?? r.bucket,
    isRealised: r.bucket === 'realised',
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceRaisedDate,
    poNumber: r.poNumber,
    supplier: null,
    rowSource: null,
    overridden: false,
    traceId: null,
    noRevenueLinked: false,
  }));
}

export interface FinanceLineDetailDrawerProps {
  variant: FinanceDetailVariant;
  /** Header title — month label (revenue/cos) or project name (gp). */
  title: string;
  onClose: () => void;
  /** Month variants. */
  monthKey?: string;
  defaultProject?: string;
  /** GP variant. */
  projectId?: number;
  defaultCategoryKey?: string;
  defaultFilter?: FinanceDetailStateFilter;
}

export function FinanceLineDetailDrawer({
  variant,
  title,
  onClose,
  monthKey,
  defaultProject = 'all',
  projectId,
  defaultCategoryKey = 'all',
  defaultFilter = 'all',
}: FinanceLineDetailDrawerProps) {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<FinanceDetailStateFilter>(defaultFilter);
  // Scope filter = project (month variants) or category (gp).
  const [scopeFilter, setScopeFilter] = useState<string>(
    variant === 'gp' ? defaultCategoryKey : defaultProject,
  );
  const [expandedId, setExpandedId] = useState<string | number | null>(null);

  const isMonthVariant = variant === 'revenue' || variant === 'cos';

  // Server-side state param (month variants only).
  const stateParam = (() => {
    if (!isMonthVariant || stateFilter === 'all') return '';
    if (variant === 'revenue') {
      const v =
        stateFilter === 'realised'
          ? 'Realised'
          : stateFilter === 'committed'
            ? 'Committed'
            : stateFilter === 'unrealised'
              ? 'Unrealised'
              : 'qb_actual';
      return `&state=${v}`;
    }
    return `&state=${stateFilter}`; // cos endpoint takes lowercase (realised/committed/unrealised/qb_actual)
  })();
  // Server-side project scope (month variants only).
  const projectParam =
    isMonthVariant && scopeFilter !== 'all' ? `&project=${encodeURIComponent(scopeFilter)}` : '';

  const url =
    variant === 'revenue'
      ? `/api/revenue-tracker/month-detail?monthKey=${monthKey}${stateParam}${projectParam}`
      : variant === 'cos'
        ? `/api/cos-tracker/month-detail?monthKey=${monthKey}${stateParam}${projectParam}`
        : `/api/finance/lines/${projectId}`;

  const queryKey = isMonthVariant
    ? [`/api/${variant}-detail`, monthKey, stateFilter, scopeFilter]
    : ['/api/finance/lines', projectId];

  const {
    data: rawData,
    isLoading,
    isError,
    error: detailError,
    refetch: refetchDetail,
  } = useQuery<unknown>({
    queryKey,
    queryFn: fetchQueryFn(url),
    retry: 1,
  });

  // Normalise the raw wire shape into DrawerLine[].
  const allLines = useMemo<DrawerLine[]>(() => {
    if (rawData == null) return [];
    if (variant === 'revenue') return normaliseRevenue(rawData as RevenueRaw[]);
    if (variant === 'cos') return normaliseCos((rawData as CosResponse).items ?? []);
    return normaliseGp((rawData as GpResponse).lines ?? []);
  }, [rawData, variant]);

  // GP filters client-side (state + category); month variants are already
  // server-filtered, so this is a no-op for them.
  const lines = useMemo<DrawerLine[]>(() => {
    if (variant !== 'gp') return allLines;
    return allLines.filter((l) => {
      if (stateFilter === 'realised' && !l.isRealised) return false;
      if (stateFilter === 'committed' && l.status !== 'Committed') return false;
      if (stateFilter === 'unrealised' && l.isRealised) return false;
      if (scopeFilter !== 'all' && l.categoryKey !== scopeFilter) return false;
      return true;
    });
  }, [allLines, variant, stateFilter, scopeFilter]);

  const summaries = useMemo(() => {
    const realisedItems = lines.filter((i) => i.isRealised);
    const unrealisedItems = lines.filter((i) => !i.isRealised);
    const sum = (arr: DrawerLine[]) => arr.reduce((s, i) => s + primaryOf(variant, i), 0);
    return {
      lineCount: lines.length,
      totalAmount: sum(lines),
      realisedTotal: sum(realisedItems),
      unrealisedTotal: sum(unrealisedItems),
      realisedCount: realisedItems.length,
      unrealisedCount: unrealisedItems.length,
    };
  }, [lines, variant]);

  // Scope-select options: projects (month variants) or categories (gp).
  const scopeOptions = useMemo(() => {
    const source = variant === 'gp'
      ? allLines.map((i) => ({ key: i.categoryKey ?? '', label: i.category ?? '—' }))
      : allLines.map((i) => ({ key: i.projectName ?? '', label: i.projectName ?? '—' }));
    const byKey = new Map<string, string>();
    for (const o of source) if (o.key) byKey.set(o.key, o.label);
    const opts = Array.from(byKey.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
    return [{ value: 'all', label: variant === 'gp' ? 'All Categories' : 'All Projects' }, ...opts];
  }, [allLines, variant]);

  const filtered = useMemo(() => {
    if (!search.trim()) return lines;
    const q = search.toLowerCase();
    return lines.filter(
      (i) =>
        (i.projectName || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q) ||
        (i.lineItem || '').toLowerCase().includes(q) ||
        (i.invoiceNumber || '').toLowerCase().includes(q) ||
        (i.supplier || '').toLowerCase().includes(q),
    );
  }, [lines, search]);

  const filteredTotal = useMemo(() => filtered.reduce((s, i) => s + primaryOf(variant, i), 0), [filtered, variant]);
  const filteredRealised = useMemo(
    () => filtered.filter((i) => i.isRealised).reduce((s, i) => s + primaryOf(variant, i), 0),
    [filtered, variant],
  );
  const filteredUnrealised = useMemo(
    () => filtered.filter((i) => !i.isRealised).reduce((s, i) => s + primaryOf(variant, i), 0),
    [filtered, variant],
  );

  const numericCols = NUMERIC_COLS[variant];
  const showProjectCol = variant !== 'gp';
  // Uniform across Revenue / COS / GP: no Source, no QB; an Invoice # column.
  // colCount = chevron + project? + (category + line item + invoice + status) + numeric.
  const colCount = 1 + (showProjectCol ? 1 : 0) + 4 + numericCols.length;

  const subtitleNoun = variant === 'cos' ? 'Cost line detail' : variant === 'gp' ? 'Line detail' : 'Revenue line-item detail';

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
      data-testid={`drawer-${variant}-detail`}
      role="dialog"
      aria-modal="true"
      aria-label={`${subtitleNoun} for ${title}`}
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
              {title}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {subtitleNoun} · {summaries.lineCount} items · {money(summaries.totalAmount)}
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
            onChange={(e) => setStateFilter(e.target.value as FinanceDetailStateFilter)}
            className="h-9 px-3 text-sm border border-border rounded-lg bg-muted/50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-300"
            data-testid="select-state-filter"
          >
            <option value="all">All States</option>
            <option value="realised">Realised Only</option>
            <option value="committed">Committed Only</option>
            <option value="unrealised">Unrealised Only</option>
            {/* QB Actual is no longer a standard option; only surfaced when the
                drawer was opened from a QuickBooks grid cell. */}
            {stateFilter === 'qb_actual' && <option value="qb_actual">QB Actual Only</option>}
          </select>
          <SearchableSelect
            value={scopeFilter}
            onValueChange={(v) => setScopeFilter(v || 'all')}
            options={scopeOptions}
            placeholder={variant === 'gp' ? 'All Categories' : 'All Projects'}
            searchPlaceholder={variant === 'gp' ? 'Search categories...' : 'Search projects...'}
            triggerClassName="h-9 max-w-[220px]"
            data-testid={variant === 'gp' ? 'select-category-filter' : 'select-project-filter'}
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
              description={`No lines match the current filters for ${title}.`}
              className="m-6"
            />
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur-md z-10 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2.5 w-8" />
                  {showProjectCol && (
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Project</th>
                  )}
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Category</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Line Item</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Invoice #</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Status</th>
                  {numericCols.map((c) => (
                    <th key={c.key} className="text-right px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">{c.header}</th>
                  ))}
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
                      {showProjectCol && (
                        <td className="px-3 py-2.5 max-w-[150px] truncate font-medium" title={item.projectName || ''}>
                          {item.projectName ? (
                            <button
                              type="button"
                              className="text-emerald-700 hover:text-emerald-900 hover:underline text-left truncate max-w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/project/${encodeURIComponent(item.projectName as string)}?tab=${variant === 'cos' ? 'cos-tracker' : 'revenue-tracking'}`);
                              }}
                            >
                              {item.projectName}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-muted-foreground max-w-[150px] truncate" title={item.category || ''}>
                        {item.category || '—'}
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate text-foreground" title={item.lineItem || ''}>
                        {item.lineItem || '—'}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-foreground max-w-[140px] truncate" title={item.invoiceNumber || ''}>
                        {item.invoiceNumber || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${stateBadgeColor(item.status)}`}>
                          {item.status}
                        </span>
                      </td>
                      {numericCols.map((c) => {
                        const v = c.get(item);
                        const isNoRev = c.key === 'revenue' && item.noRevenueLinked;
                        return (
                          <td
                            key={c.key}
                            className={`px-3 py-2.5 text-right font-mono ${c.highlight ? `font-semibold ${item.isRealised ? 'text-foreground' : 'text-amber-700'}` : 'text-muted-foreground'}`}
                          >
                            {isNoRev ? (
                              <span className="text-muted-foreground italic text-[10px]">No Rev</span>
                            ) : (
                              money(v)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {expandedId === item.id && (
                      <tr className="bg-emerald-50/40">
                        <td colSpan={colCount} className="px-6 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-xs">
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Invoice Date</p>
                              <p className="font-medium text-foreground">{item.invoiceDate || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">PO #</p>
                              <p className="font-medium text-foreground">{item.poNumber || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Supplier</p>
                              <p className="font-medium text-foreground">{item.supplier || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Trace</p>
                              <p className="font-medium text-foreground">{item.traceId || '—'}</p>
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

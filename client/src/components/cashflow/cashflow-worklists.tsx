/**
 * Cashflow worklists — Accounts Receivable, Accounts Payable, and the
 * past-dated missing-invoice list (GP4). Reporting / visibility only: these
 * surface what is invoiced-and-unpaid, paid-and-outstanding, and overdue to be
 * invoiced. They do NOT action payments (that workflow is parked).
 *
 * All three read the canonical cashflow line endpoints and age on the
 * invoice-raised date (col T). Amounts are ex-VAT. Each list drills to its
 * workbook source cell and exports to CSV/Excel with source-cell columns.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { ExportDropdown } from '@/components/ui/export-dropdown';
import type { ExportColumn } from '@/lib/export-table';
import { formatZar } from '@/lib/currency';
import { Loader2, ArrowDownLeft, ArrowUpRight, FileWarning, type LucideIcon } from 'lucide-react';

const API_BASE = '/api/weekly-cashflow';

type AgeBucket = '0-30' | '31-60' | '61-90' | '90+';
const BUCKETS: AgeBucket[] = ['0-30', '31-60', '61-90', '90+'];

interface SourceRef {
  sourceSheet: string | null;
  sourceRow: number | null;
  sourceCell: string | null;
}
interface AgedRow {
  lineId: number;
  projectName: string | null;
  counterpartyName: string | null;
  label: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number;
  ageDays: number;
  ageBucket: AgeBucket;
  source: SourceRef;
}
interface BucketTotal {
  count: number;
  amount: number;
}
type BucketTotals = Record<AgeBucket, BucketTotal> & { total: BucketTotal };
interface AgedWorklist {
  asOf: string;
  rows: AgedRow[];
  buckets: BucketTotals;
}
interface MissingRow {
  side: 'revenue' | 'cost';
  lineId: number;
  projectName: string | null;
  counterpartyName: string | null;
  label: string | null;
  expectedInvoiceDate: string | null;
  daysOverdue: number;
  amountExVat: number;
  source: SourceRef;
}
interface MissingWorklist {
  asOf: string;
  rows: MissingRow[];
  summary: { revenue: BucketTotal; cost: BucketTotal; total: BucketTotal };
}

async function fetchJson<T>(url: string): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { credentials: 'include', headers });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

function sourceLabel(s: SourceRef): string {
  const sheet = s.sourceSheet ?? '—';
  if (s.sourceCell) return `${sheet}!${s.sourceCell}`;
  if (s.sourceRow != null) return `${sheet} · row ${s.sourceRow}`;
  return sheet;
}

/** Source cell with a tooltip carrying the full provenance + line id so a row
 * drills back to the exact workbook line and cell. */
function SourceCell({ row }: { row: { lineId: number; source: SourceRef } }) {
  return (
    <TooltipProvider>
      <UiTooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-xs text-muted-foreground underline decoration-dotted">
            {sourceLabel(row.source)}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div>Sheet: {row.source.sourceSheet ?? '—'}</div>
            <div>Row: {row.source.sourceRow ?? '—'}</div>
            <div>Cell: {row.source.sourceCell ?? '—'}</div>
            <div>Line ID: {row.lineId}</div>
          </div>
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

function bucketTone(b: AgeBucket): string {
  switch (b) {
    case '0-30':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case '31-60':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case '61-90':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    case '90+':
      return 'bg-red-50 text-red-700 border-red-200';
  }
}

function BucketChips({ buckets }: { buckets: BucketTotals }) {
  return (
    <div className="flex flex-wrap gap-2">
      {BUCKETS.map((b) => (
        <div key={b} className={`rounded-md border px-3 py-2 text-sm ${bucketTone(b)}`}>
          <div className="font-medium">{b} days</div>
          <div className="font-mono tabular-nums">{formatZar(buckets[b].amount)}</div>
          <div className="text-xs opacity-80">{buckets[b].count} line(s)</div>
        </div>
      ))}
      <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800">
        <div className="font-semibold">Total</div>
        <div className="font-mono tabular-nums font-semibold">{formatZar(buckets.total.amount)}</div>
        <div className="text-xs opacity-80">{buckets.total.count} line(s)</div>
      </div>
    </div>
  );
}

const SOURCE_COLUMNS: ExportColumn[] = [
  { key: 'source.sourceSheet', header: 'Source sheet' },
  { key: 'source.sourceRow', header: 'Source row' },
  { key: 'source.sourceCell', header: 'Source cell' },
  { key: 'lineId', header: 'Line ID' },
];

function StateWrap({
  isLoading,
  isError,
  isEmpty,
  emptyTitle,
  emptyIcon,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  emptyTitle: string;
  emptyIcon: LucideIcon;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="py-10 text-sm text-red-600">Could not load this worklist. Please retry.</div>
    );
  }
  if (isEmpty) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description="Nothing to show right now." />;
  }
  return <>{children}</>;
}

export function CashflowWorklists({ projectParam }: { projectParam?: string }) {
  const qs = projectParam ? `?project=${encodeURIComponent(projectParam)}` : '';

  const ar = useQuery<AgedWorklist>({
    queryKey: [`${API_BASE}/receivables`, projectParam ?? null],
    queryFn: () => fetchJson<AgedWorklist>(`${API_BASE}/receivables${qs}`),
  });
  const ap = useQuery<AgedWorklist>({
    queryKey: [`${API_BASE}/payables`, projectParam ?? null],
    queryFn: () => fetchJson<AgedWorklist>(`${API_BASE}/payables${qs}`),
  });
  const missing = useQuery<MissingWorklist>({
    queryKey: [`${API_BASE}/missing-invoices`, projectParam ?? null],
    queryFn: () => fetchJson<MissingWorklist>(`${API_BASE}/missing-invoices${qs}`),
  });

  const arColumns: ExportColumn[] = useMemo(
    () => [
      { key: 'projectName', header: 'Project' },
      { key: 'label', header: 'Milestone' },
      { key: 'invoiceNumber', header: 'Invoice no' },
      { key: 'invoiceDate', header: 'Invoice date' },
      { key: 'amountExVat', header: 'Amount (ex-VAT)' },
      { key: 'ageDays', header: 'Age (days)' },
      { key: 'ageBucket', header: 'Age bucket' },
      ...SOURCE_COLUMNS,
    ],
    [],
  );
  const apColumns: ExportColumn[] = useMemo(
    () => [
      { key: 'projectName', header: 'Project' },
      { key: 'counterpartyName', header: 'Supplier' },
      { key: 'label', header: 'Line item' },
      { key: 'invoiceNumber', header: 'Invoice no' },
      { key: 'invoiceDate', header: 'Invoice date' },
      { key: 'amountExVat', header: 'Amount (ex-VAT)' },
      { key: 'ageDays', header: 'Age (days)' },
      { key: 'ageBucket', header: 'Age bucket' },
      ...SOURCE_COLUMNS,
    ],
    [],
  );
  const missingColumns: ExportColumn[] = useMemo(
    () => [
      { key: 'side', header: 'Side' },
      { key: 'projectName', header: 'Project' },
      { key: 'counterpartyName', header: 'Counterparty' },
      { key: 'label', header: 'Line' },
      { key: 'expectedInvoiceDate', header: 'Expected invoice date' },
      { key: 'daysOverdue', header: 'Days overdue' },
      { key: 'amountExVat', header: 'Amount (ex-VAT)' },
      ...SOURCE_COLUMNS,
    ],
    [],
  );

  return (
    <Card data-testid="cashflow-worklists">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Receivables, Payables &amp; Missing Invoices
          <Badge variant="outline" className="font-normal">
            reporting only
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Visibility, not actioning. Ex-VAT, aged from the invoice-raised date (col T). Receipt /
          payment uses the col-W paid signal.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="ar">
          <TabsList>
            <TabsTrigger value="ar" data-testid="tab-receivables">
              <ArrowDownLeft className="mr-1 h-4 w-4" /> Receivables (AR)
              {ar.data ? <span className="ml-2 text-xs opacity-70">{ar.data.buckets.total.count}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="ap" data-testid="tab-payables">
              <ArrowUpRight className="mr-1 h-4 w-4" /> Payables (AP)
              {ap.data ? <span className="ml-2 text-xs opacity-70">{ap.data.buckets.total.count}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="missing" data-testid="tab-missing">
              <FileWarning className="mr-1 h-4 w-4" /> Missing invoices
              {missing.data ? <span className="ml-2 text-xs opacity-70">{missing.data.summary.total.count}</span> : null}
            </TabsTrigger>
          </TabsList>

          {/* ── Accounts Receivable ── */}
          <TabsContent value="ar" className="space-y-4">
            <StateWrap
              isLoading={ar.isLoading}
              isError={ar.isError}
              isEmpty={!!ar.data && ar.data.rows.length === 0}
              emptyTitle="No outstanding receivables"
              emptyIcon={ArrowDownLeft}
            >
              {ar.data ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <BucketChips buckets={ar.data.buckets} />
                    <ExportDropdown data={ar.data.rows} columns={arColumns} filename="receivables-ar" />
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project</TableHead>
                          <TableHead>Milestone</TableHead>
                          <TableHead>Invoice no</TableHead>
                          <TableHead>Invoice date</TableHead>
                          <TableHead className="text-right">Amount (ex-VAT)</TableHead>
                          <TableHead>Age</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ar.data.rows.map((row) => (
                          <TableRow key={row.lineId} data-testid="ar-row">
                            <TableCell>{row.projectName ?? '—'}</TableCell>
                            <TableCell className="max-w-[16rem] truncate">{row.label ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{row.invoiceNumber ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{row.invoiceDate ?? '—'}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatZar(row.amountExVat)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={bucketTone(row.ageBucket)}>
                                {row.ageBucket} · {row.ageDays}d
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <SourceCell row={row} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : null}
            </StateWrap>
          </TabsContent>

          {/* ── Accounts Payable ── */}
          <TabsContent value="ap" className="space-y-4">
            <StateWrap
              isLoading={ap.isLoading}
              isError={ap.isError}
              isEmpty={!!ap.data && ap.data.rows.length === 0}
              emptyTitle="No outstanding payables"
              emptyIcon={ArrowUpRight}
            >
              {ap.data ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <BucketChips buckets={ap.data.buckets} />
                    <ExportDropdown data={ap.data.rows} columns={apColumns} filename="payables-ap" />
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Line item</TableHead>
                          <TableHead>Invoice no</TableHead>
                          <TableHead>Invoice date</TableHead>
                          <TableHead className="text-right">Amount (ex-VAT)</TableHead>
                          <TableHead>Age</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ap.data.rows.map((row) => (
                          <TableRow key={row.lineId} data-testid="ap-row">
                            <TableCell>{row.projectName ?? '—'}</TableCell>
                            <TableCell className="max-w-[12rem] truncate">{row.counterpartyName ?? '—'}</TableCell>
                            <TableCell className="max-w-[14rem] truncate">{row.label ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{row.invoiceNumber ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{row.invoiceDate ?? '—'}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatZar(row.amountExVat)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={bucketTone(row.ageBucket)}>
                                {row.ageBucket} · {row.ageDays}d
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <SourceCell row={row} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : null}
            </StateWrap>
          </TabsContent>

          {/* ── Missing invoices ── */}
          <TabsContent value="missing" className="space-y-4">
            <StateWrap
              isLoading={missing.isLoading}
              isError={missing.isError}
              isEmpty={!!missing.data && missing.data.rows.length === 0}
              emptyTitle="No overdue missing invoices"
              emptyIcon={FileWarning}
            >
              {missing.data ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2 text-sm">
                      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-700">
                        <div className="font-medium">Revenue (to invoice client)</div>
                        <div className="font-mono tabular-nums">{formatZar(missing.data.summary.revenue.amount)}</div>
                        <div className="text-xs opacity-80">{missing.data.summary.revenue.count} line(s)</div>
                      </div>
                      <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-violet-700">
                        <div className="font-medium">Cost (supplier invoice missing)</div>
                        <div className="font-mono tabular-nums">{formatZar(missing.data.summary.cost.amount)}</div>
                        <div className="text-xs opacity-80">{missing.data.summary.cost.count} line(s)</div>
                      </div>
                      <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-slate-800">
                        <div className="font-semibold">Total</div>
                        <div className="font-mono tabular-nums font-semibold">{formatZar(missing.data.summary.total.amount)}</div>
                        <div className="text-xs opacity-80">{missing.data.summary.total.count} line(s)</div>
                      </div>
                    </div>
                    <ExportDropdown data={missing.data.rows} columns={missingColumns} filename="missing-invoices" />
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Side</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Line</TableHead>
                          <TableHead>Expected invoice date</TableHead>
                          <TableHead className="text-right">Days overdue</TableHead>
                          <TableHead className="text-right">Amount (ex-VAT)</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {missing.data.rows.map((row) => (
                          <TableRow key={`${row.side}-${row.lineId}`} data-testid="missing-row">
                            <TableCell>
                              <Badge variant={row.side === 'revenue' ? 'default' : 'secondary'}>
                                {row.side === 'revenue' ? 'Revenue' : 'Cost'}
                              </Badge>
                            </TableCell>
                            <TableCell>{row.projectName ?? '—'}</TableCell>
                            <TableCell className="max-w-[18rem] truncate">
                              {row.label ?? '—'}
                              {row.counterpartyName && row.side === 'cost' ? (
                                <span className="text-muted-foreground"> · {row.counterpartyName}</span>
                              ) : null}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{row.expectedInvoiceDate ?? '—'}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              <span className={row.daysOverdue > 60 ? 'text-red-600 font-semibold' : ''}>
                                {row.daysOverdue}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatZar(row.amountExVat)}
                            </TableCell>
                            <TableCell>
                              <SourceCell row={row} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : null}
            </StateWrap>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

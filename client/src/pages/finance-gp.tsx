/**
 * Gross Profit — per-project, compact finance template
 * (header → KPI row → category ▸ line drill table). Reads the CANONICAL
 * line-level API (/api/finance/lines/:projectId, AGENT_GUARDRAILS § 3.3); GP /
 * margin are taken straight from the per-line canonical fields. Presentation
 * only — no figure is computed or changed here.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { FinanceShell } from '@/components/layout/FinanceShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FinancePageHeader,
  KpiRow,
  KpiTile,
  MoneyValue,
  StatusBadge,
  DrillTable,
  FinanceLoading,
  FinanceEmpty,
  FinanceError,
  type StatusTone,
  type DrillColumn,
} from '@/components/finance/template';
import { fetchQueryFn } from '@/lib/queryClient';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

type Bucket = 'planned' | 'committed' | 'unrealised' | 'realised';

interface FinanceLine {
  lineId: number;
  parentLineId: number;
  categoryAllocationId: number | null;
  categoryKey: string | null;
  categoryName: string | null;
  categoryNumber: string | null;
  descriptionOfWork: string | null;
  qty: string | null;
  actualTotal: number;
  poNumber: string | null;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  categoryRevenueAllocation: number | null;
  perLineRevenue: number;
  perLineGp: number;
  perLineGpPct: number | null;
  bucket: Bucket;
  recognitionMonth: string | null;
  derivationWarning: string | null;
}

interface MonthlyRow {
  revenue: number;
  cos: number;
  gp: number;
  gpPct: number | null;
  count: number;
}

interface FinanceLinesResponse {
  projectId: number;
  lines: FinanceLine[];
  total: MonthlyRow;
}

interface CategoryHealthEntry {
  projectId: number;
  projectName: string;
  status: 'healthy' | 'partial' | 'missing' | 'no_lines';
}
interface CategoryHealthResponse {
  projects: CategoryHealthEntry[];
}

interface CategoryGroup {
  key: string;
  name: string;
  number: string | null;
  lines: FinanceLine[];
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  hasMissingAllocation: boolean;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

const BUCKET_BADGE: Record<Bucket, { label: string; tone: StatusTone }> = {
  realised: { label: 'Realised', tone: 'positive' },
  unrealised: { label: 'Invoiced', tone: 'info' },
  committed: { label: 'Committed', tone: 'neutral' },
  planned: { label: 'Planned', tone: 'pending' },
};

function groupByCategory(lines: FinanceLine[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  for (const l of lines) {
    const key = l.categoryAllocationId != null ? `alloc:${l.categoryAllocationId}` : `missing:${l.categoryKey ?? 'uncategorised'}`;
    const g =
      map.get(key) ??
      {
        key,
        name: l.categoryName ?? 'Uncategorised',
        number: l.categoryNumber,
        lines: [],
        cos: 0,
        revenue: 0,
        gp: 0,
        gpPct: null,
        hasMissingAllocation: false,
      };
    g.lines.push(l);
    g.cos += l.actualTotal;
    g.revenue += l.perLineRevenue;
    g.gp += l.perLineGp;
    if (l.categoryAllocationId == null || l.categoryRevenueAllocation == null || l.categoryRevenueAllocation === 0) {
      g.hasMissingAllocation = true;
    }
    map.set(key, g);
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.gpPct = g.revenue !== 0 ? g.gp / g.revenue : null;
    g.lines.sort((a, b) => (a.invoiceRaisedDate ?? '').localeCompare(b.invoiceRaisedDate ?? '') || a.parentLineId - b.parentLineId);
  }
  return groups.sort((a, b) => Number(a.number ?? 0) - Number(b.number ?? 0) || a.name.localeCompare(b.name));
}

function ProjectGpView({ projectId, projectName }: { projectId: number; projectName: string }) {
  const { data, isLoading, isError, refetch } = useQuery<FinanceLinesResponse>({
    queryKey: [`/api/finance/lines/${projectId}`],
    queryFn: fetchQueryFn(`/api/finance/lines/${projectId}`),
    staleTime: 60_000,
  });

  const groups = useMemo(() => groupByCategory(data?.lines ?? []), [data]);

  const totals = useMemo(() => {
    const lines = data?.lines ?? [];
    const reduce = (pred: (l: FinanceLine) => boolean) =>
      lines.filter(pred).reduce(
        (acc, l) => ({ revenue: acc.revenue + l.perLineRevenue, cos: acc.cos + l.actualTotal, gp: acc.gp + l.perLineGp }),
        { revenue: 0, cos: 0, gp: 0 },
      );
    const realised = reduce((l) => l.bucket === 'realised');
    const planned = reduce((l) => l.bucket !== 'realised');
    return {
      total: data?.total ?? { revenue: 0, cos: 0, gp: 0, gpPct: null, count: 0 },
      realised: { ...realised, gpPct: realised.revenue !== 0 ? realised.gp / realised.revenue : null },
      planned: { ...planned, gpPct: planned.revenue !== 0 ? planned.gp / planned.revenue : null },
    };
  }, [data]);

  const columns: DrillColumn<CategoryGroup>[] = [
    {
      key: 'category',
      header: 'Category',
      cell: (g) => (
        <span className="inline-flex items-center gap-2 font-medium text-foreground">
          {g.number ? `${g.number}. ` : ''}
          {g.name}
          {g.hasMissingAllocation && <StatusBadge tone="critical" icon={AlertTriangle} label="Allocation missing" />}
        </span>
      ),
    },
    { key: 'revenue', header: 'Revenue', numeric: true, cell: (g) => <MoneyValue value={g.revenue} muteNegative={false} /> },
    { key: 'cos', header: 'COS', numeric: true, cell: (g) => <MoneyValue value={g.cos} muteNegative={false} /> },
    { key: 'gp', header: 'GP', numeric: true, cell: (g) => <MoneyValue value={g.gp} muteNegative={false} /> },
    { key: 'margin', header: 'Margin', numeric: true, cell: (g) => <span className="tabular-nums">{pct(g.gpPct)}</span> },
    { key: 'lines', header: 'Lines', numeric: true, widthClass: 'w-16', cell: (g) => g.lines.length },
  ];

  const renderLines = (g: CategoryGroup) => (
    <table className="w-full text-xs" data-testid={`gp-lines-${g.key}`}>
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <th className="text-left font-medium px-2 py-1">Line</th>
          <th className="text-right font-medium px-2 py-1">Revenue</th>
          <th className="text-right font-medium px-2 py-1">COS</th>
          <th className="text-right font-medium px-2 py-1">GP</th>
          <th className="text-right font-medium px-2 py-1">Margin</th>
        </tr>
      </thead>
      <tbody>
        {g.lines.map((l) => (
          <tr key={l.lineId} className="border-t border-slate-100">
            <td className="px-2 py-1">
              <span className="text-foreground">{l.descriptionOfWork ?? `Line #${l.parentLineId}`}</span>
              <span className="ml-2 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <StatusBadge tone={BUCKET_BADGE[l.bucket].tone} label={BUCKET_BADGE[l.bucket].label} />
                {l.recognitionMonth && <span>T:{l.recognitionMonth}</span>}
                {l.invoiceNumber && <span>INV:{l.invoiceNumber}</span>}
                {l.derivationWarning && <StatusBadge tone="critical" icon={AlertTriangle} label="Check" title={l.derivationWarning} />}
              </span>
            </td>
            <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={l.perLineRevenue} muteNegative={false} /></td>
            <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={l.actualTotal} muteNegative={false} /></td>
            <td className="px-2 py-1 text-right tabular-nums"><MoneyValue value={l.perLineGp} muteNegative={false} /></td>
            <td className="px-2 py-1 text-right tabular-nums">{pct(l.perLineGpPct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (isLoading) return <FinanceLoading label={`Loading ${projectName}…`} />;
  if (isError) return <FinanceError title={`Could not load ${projectName}.`} onRetry={() => refetch()} />;

  return (
    <div className="space-y-3">
      <KpiRow>
        <KpiTile
          data-testid="kpi-total-gp"
          label="Total GP (FY)"
          value={<MoneyValue value={totals.total.gp} align="left" muteNegative={false} />}
          supporting={
            <span className="inline-flex items-center gap-1">
              Rev <MoneyValue value={totals.total.revenue} align="left" /> − COS{' '}
              <MoneyValue value={totals.total.cos} align="left" /> · Margin {pct(totals.total.gpPct)}
            </span>
          }
        />
        <KpiTile
          data-testid="kpi-realised-gp"
          label="Realised GP"
          value={<MoneyValue value={totals.realised.gp} align="left" muteNegative={false} />}
          tone="positive"
          supporting={`Margin ${pct(totals.realised.gpPct)}`}
        />
        <KpiTile
          data-testid="kpi-planned-gp"
          label="Planned / Committed GP"
          value={<MoneyValue value={totals.planned.gp} align="left" muteNegative={false} />}
          supporting={`Margin ${pct(totals.planned.gpPct)}`}
        />
      </KpiRow>

      {groups.length === 0 ? (
        <FinanceEmpty title="No lines for this project." />
      ) : (
        <DrillTable
          data-testid="gp-project-drill-table"
          columns={columns}
          rows={groups}
          rowKey={(g) => g.key}
          renderDetail={renderLines}
          maxBodyHeightClass="max-h-[58vh]"
          caption="Per-project gross profit by category; expand a category for its line items."
        />
      )}
    </div>
  );
}

export default function FinanceGpPage() {
  const healthQuery = useQuery<CategoryHealthResponse>({
    queryKey: ['/api/finance/category-allocation-health'],
    queryFn: fetchQueryFn('/api/finance/category-allocation-health'),
    staleTime: 5 * 60_000,
  });

  const projects = useMemo(
    () => (healthQuery.data?.projects ?? []).filter((p) => p.status !== 'no_lines'),
    [healthQuery.data],
  );

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const selected = projects.find((p) => p.projectId === (selectedProjectId ?? projects[0]?.projectId)) ?? projects[0] ?? null;

  return (
    <FinanceShell>
      <FinancePageHeader
        data-testid="gp-project-header"
        title="Gross Profit — by project"
        question="What is each project's revenue, COS, GP and margin?"
        source="Canonical line-level § 3.3 · ex-VAT"
        actions={
          <Link href="/finance/gp/company" className="text-xs font-medium text-brand-green hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Company view
          </Link>
        }
      />

      {healthQuery.isLoading ? (
        <FinanceLoading label="Loading projects…" />
      ) : projects.length === 0 ? (
        <FinanceEmpty title="No projects with finance lines yet." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" data-testid="gp-project-picker">
            {projects.map((p) => {
              const active = selected?.projectId === p.projectId;
              return (
                <Button
                  key={p.projectId}
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => setSelectedProjectId(p.projectId)}
                  data-testid={`gp-project-${p.projectId}`}
                >
                  {p.projectName}
                  {p.status !== 'healthy' && (
                    <Badge variant="outline" className="ml-1.5 text-[9px] border-amber-200 text-amber-700">
                      {p.status}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>

          {selected && <ProjectGpView projectId={selected.projectId} projectName={selected.projectName} />}
        </div>
      )}
    </FinanceShell>
  );
}

/**
 * Finance — GP Tracking
 *
 * Surfaces per-project Revenue / COS / GP / Margin % using the canonical
 * line-level API (AGENT_GUARDRAILS § 3.3). Drill-down: project → month →
 * category → line. The math comes exclusively from
 * `/api/finance/lines/:projectId`; numbers must equal the sum of per-line
 * values at every tier (§ 3.3.1).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronRight, ChevronDown, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFinanceQuery } from "@/lib/finance-trust";
import { DataTrustBadge } from "@/components/ui/data-trust-badge";
import { useQuery } from "@tanstack/react-query";
import { fetchQueryFn } from "@/lib/queryClient";
import {
  FinancePageHeader,
  MoneyValue,
  StatusBadge,
  FinanceLoading,
  FinanceError,
  type StatusTone,
} from "@/components/finance/template";
import { RevCosGpDrillView } from "@/components/finance/rev-cos-gp-drill-view";

type Bucket = "planned" | "committed" | "unrealised" | "realised";

interface FinanceLine {
  lineId: number;
  parentLineId: number;
  projectId: number;
  categoryAllocationId: number | null;
  categoryKey: string | null;
  categoryName: string | null;
  categoryNumber: string | null;
  productService: string | null;
  descriptionOfWork: string | null;
  qty: string | null;
  rateUnit: string | null;
  budgetTotal: string | null;
  forecastPaymentDate: string | null;
  actualTotal: number;
  poNumber: string | null;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  paidDate: string | null;
  paidDateConfirmed: boolean | null;
  categoryTotalActualTotal: number;
  categoryRevenueAllocation: number | null;
  perLineRevenue: number;
  perLineGp: number;
  perLineGpPct: number | null;
  bucket: Bucket;
  recognitionMonth: string | null;
  derivationWarning: string | null;
}

interface MonthlyRow {
  monthKey: string;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
}

interface FinanceLinesResponse {
  projectId: number;
  fyStart: string | null;
  fyEnd: string | null;
  lines: FinanceLine[];
  monthly: MonthlyRow[];
  unrecognised: MonthlyRow;
  total: MonthlyRow;
}

interface ReconCheckResponse {
  projectId: number;
  fyStart: string | null;
  fyEnd: string | null;
  lineCount: number;
  linelevel: { revenue: number; cos: number; gp: number };
  persisted: { revenue: number; cos: number; rowCount: number; nonNullRevenueRowCount: number };
  drift: { revenue: number; cos: number; revenuePerLine: number; detected: boolean };
}

interface PortfolioProjectTotals {
  projectId: number;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
}

interface PortfolioResponse {
  projectIds: number[];
  byProject: PortfolioProjectTotals[];
  monthly: MonthlyRow[];
  unrecognised: MonthlyRow;
  total: MonthlyRow;
}

interface ProjectSummaryRow {
  project_name: string;
  has_tracker_import?: boolean;
  id?: number;
}

interface CategoryHealthEntry {
  projectId: number;
  projectName: string;
  status: "healthy" | "partial" | "missing" | "no_lines";
  allocations: number;
  allocationsWithRevenue: number;
  parentLines: number;
  linesWithoutAllocation: number;
  actualsRows: number;
}

interface CategoryHealthResponse {
  summary: { total: number; healthy: number; partial: number; missing: number; noLines: number };
  projects: CategoryHealthEntry[];
}

// Canonical precise ZAR for all cells, panels and tooltips, rendered through the
// shared <MoneyValue> (same digits as formatZar; absent / non-numeric → "—",
// never "R 0"; muted-red negatives). Routing every money cell through this one
// helper adopts the template renderer without changing any displayed figure.
const money = (n: number | null | undefined) => <MoneyValue value={n} align="left" />;

const pct = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
};

const fmtMonth = (key: string): string => {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return key;
  const [y, m] = key.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1]} ${y}`;
};

const bucketBadge = (b: Bucket): { label: string; tone: StatusTone } => {
  switch (b) {
    case "realised":
      return { label: "Realised", tone: "positive" };
    case "unrealised":
      return { label: "Invoiced", tone: "info" };
    case "committed":
      return { label: "Committed", tone: "neutral" };
    case "planned":
      return { label: "Planned", tone: "pending" };
  }
};

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

function groupByCategory(lines: FinanceLine[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  for (const l of lines) {
    const key = l.categoryAllocationId != null
      ? `alloc:${l.categoryAllocationId}`
      : `missing:${l.categoryKey ?? "uncategorised"}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        name: l.categoryName ?? l.categoryKey ?? "Uncategorised",
        number: l.categoryNumber,
        lines: [],
        cos: 0,
        revenue: 0,
        gp: 0,
        gpPct: null,
        hasMissingAllocation:
          l.categoryAllocationId == null ||
          l.categoryRevenueAllocation == null ||
          l.categoryRevenueAllocation === 0,
      };
      map.set(key, g);
    }
    g.lines.push(l);
    g.cos += l.actualTotal;
    g.revenue += l.perLineRevenue;
    g.gp += l.perLineGp;
  }
  for (const g of map.values()) {
    g.gpPct = g.revenue !== 0 ? g.gp / g.revenue : null;
    // Sort lines by recognition date then by parent line for stable display.
    g.lines.sort((a, b) => {
      const da = a.invoiceRaisedDate ?? "";
      const db = b.invoiceRaisedDate ?? "";
      if (da !== db) return da.localeCompare(db);
      return a.parentLineId - b.parentLineId;
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    const an = Number(a.number);
    const bn = Number(b.number);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.name.localeCompare(b.name);
  });
}

function GpKpiCard({
  title,
  revenue,
  cos,
  gp,
  gpPct,
  tone,
}: {
  title: string;
  revenue: number;
  cos: number;
  gp: number;
  gpPct: number | null;
  tone: "neutral" | "primary";
}) {
  const accent = tone === "primary" ? "border-emerald-500/60 bg-emerald-50/40" : "";
  return (
    <Card className={accent}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tabular-nums">{money(gp)}</div>
        <div className="text-xs text-muted-foreground">
          Revenue {money(revenue)} − COS {money(cos)}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Badge variant="outline" className="font-mono">
            Margin {pct(gpPct)}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryRow({
  group,
  expanded,
  onToggle,
}: {
  group: CategoryGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
        <TableCell className="w-8">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-medium">
          {group.number ? `${group.number}. ` : ""}
          {group.name}
          {group.hasMissingAllocation && (
            <StatusBadge tone="critical" icon={AlertTriangle} label="Allocation missing" className="ml-2" />
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">{money(group.revenue)}</TableCell>
        <TableCell className="text-right tabular-nums">{money(group.cos)}</TableCell>
        <TableCell className="text-right tabular-nums">{money(group.gp)}</TableCell>
        <TableCell className="text-right tabular-nums">{pct(group.gpPct)}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{group.lines.length}</TableCell>
      </TableRow>
      {expanded && group.lines.map((l) => {
        const badge = bucketBadge(l.bucket);
        return (
          <TableRow key={`line-${l.lineId}`} className="bg-muted/20 text-sm">
            <TableCell />
            <TableCell className="pl-8">
              <div className="font-medium">{l.descriptionOfWork ?? `Line #${l.parentLineId}`}</div>
              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                <StatusBadge tone={badge.tone} label={badge.label} />
                {l.recognitionMonth && <span>T: {l.recognitionMonth}</span>}
                {l.poNumber && <span>PO: {l.poNumber}</span>}
                {l.invoiceNumber && <span>INV: {l.invoiceNumber}</span>}
                {l.derivationWarning && (
                  <StatusBadge tone="critical" label={l.derivationWarning.replace(/_/g, " ")} />
                )}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{money(l.perLineRevenue)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(l.actualTotal)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(l.perLineGp)}</TableCell>
            <TableCell className="text-right tabular-nums">{pct(l.perLineGpPct)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {l.qty ?? ""}
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}

function DriftCard({ projectId }: { projectId: number }) {
  const { data } = useQuery<ReconCheckResponse>({
    queryKey: [`/api/finance/recon-check/${projectId}`],
    queryFn: fetchQueryFn(`/api/finance/recon-check/${projectId}`),
    enabled: Number.isFinite(projectId),
    staleTime: 60_000,
  });

  if (!data) return null;
  const tone = data.drift.detected ? "border-amber-300 bg-amber-50/40" : "border-emerald-300 bg-emerald-50/40";
  const driftAbs = Math.abs(data.drift.revenue);
  return (
    <Card className={tone}>
      <CardContent className="p-4 flex items-start gap-3">
        <AlertTriangle className={data.drift.detected ? "h-5 w-5 text-amber-600 mt-0.5" : "h-5 w-5 text-emerald-600 mt-0.5"} />
        <div className="text-sm space-y-1">
          <div className="font-medium">
            Dual-write parity {data.drift.detected ? "— drift detected" : "— in sync"}
          </div>
          <div className="text-muted-foreground">
            Line-level (§ 3.3) Revenue {money(data.linelevel.revenue)} · persisted Revenue {money(data.persisted.revenue)} ·
            {" "}drift {money(driftAbs)} ({money(data.drift.revenuePerLine)}/line across {data.lineCount} lines).
            {data.drift.detected && " Some drift is expected — legacy persisted column uses a project-scoped formula vs § 3.3 category-scoped. Investigate if absolute drift is large."}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PortfolioSummaryCard({ projectIds }: { projectIds: number[] }) {
  const queryString = projectIds.length > 0 ? `?projectIds=${projectIds.join(",")}` : "";
  const { data, isLoading } = useQuery<PortfolioResponse>({
    queryKey: [`/api/finance/lines${queryString}`],
    queryFn: fetchQueryFn(`/api/finance/lines${queryString}`),
    enabled: projectIds.length > 0,
    staleTime: 60_000,
  });

  if (projectIds.length === 0) return null;
  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company-wide GP</CardTitle>
        </CardHeader>
        <CardContent>
          <FinanceLoading label={`Aggregating ${projectIds.length} project(s)…`} />
        </CardContent>
      </Card>
    );
  }

  const total = data.total;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Company-wide GP — {data.byProject.length} project(s)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div>
            <div className="text-xs text-muted-foreground">Revenue</div>
            <div className="text-xl font-semibold tabular-nums">{money(total.revenue)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">COS</div>
            <div className="text-xl font-semibold tabular-nums">{money(total.cos)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">GP</div>
            <div className="text-xl font-semibold tabular-nums">{money(total.gp)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Margin %</div>
            <div className="text-xl font-semibold tabular-nums">{pct(total.gpPct)}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Σ projects (Σ lines perLineRevenue) — § 3.3.1, no cross-project pooling. Includes only
          projects whose category J has been populated; missing-J projects contribute zero rather
          than a wrong number.
        </p>
      </CardContent>
    </Card>
  );
}

function ProjectGpView({ projectId, projectName }: { projectId: number; projectName: string }) {
  const { data, trust, isLoading, isError, refetch } = useFinanceQuery<FinanceLinesResponse>({
    queryKey: [`/api/finance/lines/${projectId}`],
    url: `/api/finance/lines/${projectId}`,
    enabled: Number.isFinite(projectId),
  });
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => (data ? groupByCategory(data.lines) : []), [data]);

  if (isLoading) {
    return <FinanceLoading label={`Loading ${projectName}…`} />;
  }
  if (isError || !data) {
    return (
      <FinanceError
        title={`Could not load GP for ${projectName}.`}
        onRetry={() => void refetch()}
      />
    );
  }

  const total = data.total;
  const realisedTotal = data.lines
    .filter((l) => l.bucket === "realised")
    .reduce(
      (acc, l) => ({
        revenue: acc.revenue + l.perLineRevenue,
        cos: acc.cos + l.actualTotal,
        gp: acc.gp + l.perLineGp,
      }),
      { revenue: 0, cos: 0, gp: 0 },
    );
  const realisedGpPct = realisedTotal.revenue !== 0 ? realisedTotal.gp / realisedTotal.revenue : null;
  const plannedTotal = data.lines
    .filter((l) => l.bucket !== "realised")
    .reduce(
      (acc, l) => ({
        revenue: acc.revenue + l.perLineRevenue,
        cos: acc.cos + l.actualTotal,
        gp: acc.gp + l.perLineGp,
      }),
      { revenue: 0, cos: 0, gp: 0 },
    );
  const plannedGpPct = plannedTotal.revenue !== 0 ? plannedTotal.gp / plannedTotal.revenue : null;

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title={`GP — ${projectName}`}
        question="Per-line POC (§ 3.3): Revenue = (Q / X) × J · grain = actuals child rows · recognition month from invoice raised date (col T)."
        actions={<DataTrustBadge trust={trust} />}
      />

      <DriftCard projectId={projectId} />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GpKpiCard
          title="Total GP (FY)"
          revenue={total.revenue}
          cos={total.cos}
          gp={total.gp}
          gpPct={total.gpPct}
          tone="primary"
        />
        <GpKpiCard
          title="Realised GP"
          revenue={realisedTotal.revenue}
          cos={realisedTotal.cos}
          gp={realisedTotal.gp}
          gpPct={realisedGpPct}
          tone="neutral"
        />
        <GpKpiCard
          title="Planned / Committed GP"
          revenue={plannedTotal.revenue}
          cos={plannedTotal.cos}
          gp={plannedTotal.gp}
          gpPct={plannedGpPct}
          tone="neutral"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly recon</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">COS</TableHead>
                <TableHead className="text-right">GP</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
                <TableHead className="text-right">Lines</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.monthly.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No recognised lines in window.
                  </TableCell>
                </TableRow>
              )}
              {data.monthly.map((m) => (
                <TableRow key={m.monthKey}>
                  <TableCell>{fmtMonth(m.monthKey)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(m.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(m.cos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(m.gp)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(m.gpPct)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.count}</TableCell>
                </TableRow>
              ))}
              {data.unrecognised.count > 0 && (
                <TableRow className="text-muted-foreground">
                  <TableCell>Unrecognised (no T date)</TableCell>
                  <TableCell className="text-right tabular-nums">{money(data.unrecognised.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(data.unrecognised.cos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(data.unrecognised.gp)}</TableCell>
                  <TableCell className="text-right">—</TableCell>
                  <TableCell className="text-right tabular-nums">{data.unrecognised.count}</TableCell>
                </TableRow>
              )}
              <TableRow className="font-medium border-t-2">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{money(total.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(total.cos)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(total.gp)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(total.gpPct)}</TableCell>
                <TableCell className="text-right tabular-nums">{total.count}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Categories — drill into lines</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Category / Line</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">COS</TableHead>
                <TableHead className="text-right">GP</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
                <TableHead className="text-right">Qty / #</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No lines for this project.
                  </TableCell>
                </TableRow>
              )}
              {grouped.map((g) => (
                <CategoryRow
                  key={g.key}
                  group={g}
                  expanded={expandedCats.has(g.key)}
                  onToggle={() => setExpandedCats((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.key)) next.delete(g.key); else next.add(g.key);
                    return next;
                  })}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FinanceGpPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const { data: projects = [] } = useQuery<ProjectSummaryRow[]>({
    queryKey: ["/api/projects-summary"],
    queryFn: fetchQueryFn("/api/projects-summary"),
    staleTime: 60_000,
  });

  const { data: health } = useQuery<CategoryHealthResponse>({
    queryKey: ["/api/finance/category-allocation-health"],
    queryFn: fetchQueryFn("/api/finance/category-allocation-health"),
    staleTime: 5 * 60_000,
  });

  const healthIndex = useMemo(() => {
    const map = new Map<number, CategoryHealthEntry>();
    if (health) for (const p of health.projects) map.set(p.projectId, p);
    return map;
  }, [health]);

  const projectsWithLines = useMemo(() => {
    if (!health) return [] as CategoryHealthEntry[];
    return health.projects
      .filter((p) => p.actualsRows > 0 || p.parentLines > 0)
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
  }, [health]);

  // Default to first healthy project if available.
  const defaultId = useMemo(() => {
    if (selectedProjectId != null) return selectedProjectId;
    if (projectsWithLines.length === 0) return null;
    const healthy = projectsWithLines.find((p) => p.status === "healthy");
    return (healthy ?? projectsWithLines[0]).projectId;
  }, [selectedProjectId, projectsWithLines]);

  const selected = defaultId != null ? healthIndex.get(defaultId) ?? null : null;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="finance-gp-page">
      {/* Invoice-level drill: FY ▸ month ▸ project ▸ line ▸ invoice, reading
          the canonical drill endpoints (no recomputation). */}
      <RevCosGpDrillView />

      {health && health.summary.missing + health.summary.partial > 0 && (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium">Allocation health</div>
              <div className="text-muted-foreground">
                {health.summary.missing} project(s) missing column J · {health.summary.partial} partial ·
                {" "}{health.summary.healthy} healthy. Projects with missing J render
                {" "}<code>perLineRevenue = 0</code> rather than a wrong number, per § 3.3.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <PortfolioSummaryCard projectIds={projectsWithLines.map((p) => p.projectId)} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pick a project</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="flex flex-wrap gap-2">
            {projects.length === 0 && (
              <span className="text-sm text-muted-foreground">No projects available.</span>
            )}
            {projects.map((p) => {
              const id = p.id;
              if (typeof id !== "number") return null;
              const h = healthIndex.get(id);
              const isSelected = id === defaultId;
              const variant = h?.status === "missing" || h?.status === "partial" ? "destructive" : "outline";
              return (
                <Button
                  key={id}
                  size="sm"
                  variant={isSelected ? "default" : variant}
                  onClick={() => setSelectedProjectId(id)}
                  data-testid={`gp-project-${id}`}
                >
                  {p.project_name}
                  {h?.status === "missing" && (
                    <StatusBadge tone="critical" label="missing J" className="ml-2" />
                  )}
                  {h?.status === "partial" && (
                    <StatusBadge tone="warning" label="partial" className="ml-2" />
                  )}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selected ? (
        <ProjectGpView projectId={selected.projectId} projectName={selected.projectName} />
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Pick a project above to see GP detail. <Link href="/" className="underline">Back to home</Link>.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

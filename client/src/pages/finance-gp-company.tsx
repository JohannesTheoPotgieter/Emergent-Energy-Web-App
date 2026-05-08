/**
 * Finance — Company-wide GP Tracking
 *
 * Portfolio view that consumes the canonical line-level API
 * (AGENT_GUARDRAILS § 3.3). Shows Revenue / COS / GP / Margin across
 * every project that has cost lines, plus a monthly recon grid and a
 * per-project ranking table.
 *
 * The numbers here are strictly Σ projects (Σ lines perLineRevenue) —
 * § 3.3.1 forbids cross-project pooling. Projects whose category J is
 * missing contribute zero rather than wrong numbers; they surface in
 * the allocation-health banner so the COO can triage workbook fixes.
 *
 * Sister page at /finance/gp shows per-project drill-down.
 */
import { useMemo } from "react";
import { Link } from "wouter";
import { Loader2, AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { fetchQueryFn } from "@/lib/queryClient";

interface MonthlyRow {
  monthKey: string;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
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

const ZAR = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const money = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return ZAR.format(n);
};

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

function CompanyKpiCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function FinanceGpCompanyPage() {
  const { data: health } = useQuery<CategoryHealthResponse>({
    queryKey: ["/api/finance/category-allocation-health"],
    queryFn: fetchQueryFn("/api/finance/category-allocation-health"),
    staleTime: 5 * 60_000,
  });

  const projectsWithLines = useMemo(() => {
    if (!health) return [] as CategoryHealthEntry[];
    return health.projects.filter((p) => p.actualsRows > 0 || p.parentLines > 0);
  }, [health]);

  const projectIds = useMemo(
    () => projectsWithLines.map((p) => p.projectId),
    [projectsWithLines],
  );

  const queryString = projectIds.length > 0 ? `?projectIds=${projectIds.join(",")}` : "";
  const { data, isLoading } = useQuery<PortfolioResponse>({
    queryKey: [`/api/finance/lines${queryString}`],
    queryFn: fetchQueryFn(`/api/finance/lines${queryString}`),
    enabled: projectIds.length > 0,
    staleTime: 60_000,
  });

  const projectNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of projectsWithLines) map.set(p.projectId, p.projectName);
    return map;
  }, [projectsWithLines]);

  const healthById = useMemo(() => {
    const map = new Map<number, CategoryHealthEntry>();
    for (const p of projectsWithLines) map.set(p.projectId, p);
    return map;
  }, [projectsWithLines]);

  const rankedProjects = useMemo(() => {
    if (!data) return [] as Array<PortfolioProjectTotals & { projectName: string; status: CategoryHealthEntry["status"] | "unknown" }>;
    return data.byProject
      .map((p) => ({
        ...p,
        projectName: projectNameById.get(p.projectId) ?? `Project #${p.projectId}`,
        status: (healthById.get(p.projectId)?.status ?? "unknown") as
          | CategoryHealthEntry["status"]
          | "unknown",
      }))
      .sort((a, b) => b.gp - a.gp);
  }, [data, projectNameById, healthById]);

  if (projectIds.length === 0 && !health) {
    return (
      <div className="p-8 flex items-center text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading project list…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="finance-gp-company-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Company-wide GP</h1>
          <p className="text-sm text-muted-foreground">
            Σ projects (Σ lines perLineRevenue) — § 3.3.1, no cross-project pooling. Per-project
            drill-down lives on{" "}
            <Link href="/finance/gp" className="underline">
              /finance/gp
            </Link>
            .
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          {projectIds.length} project(s)
        </Badge>
      </header>

      {health && health.summary.missing + health.summary.partial > 0 && (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium">Allocation health</div>
              <div className="text-muted-foreground">
                {health.summary.missing} project(s) missing column J ·{" "}
                {health.summary.partial} partial · {health.summary.healthy} healthy. Projects with
                missing J contribute <code>perLineRevenue = 0</code> rather than wrong numbers,
                per § 3.3 — the company total below is conservative until those workbooks ship.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading || !data ? (
        <div className="p-8 flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aggregating {projectIds.length} project(s)…
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <CompanyKpiCard title="Revenue" value={money(data.total.revenue)} />
            <CompanyKpiCard title="COS" value={money(data.total.cos)} />
            <CompanyKpiCard
              title="GP"
              value={money(data.total.gp)}
              hint={`Margin ${pct(data.total.gpPct)}`}
            />
            <CompanyKpiCard
              title="Lines counted"
              value={data.total.count.toLocaleString("en-ZA")}
              hint="actuals rows across all projects"
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly recon — company total</CardTitle>
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
                        No recognised lines.
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
                      <TableCell className="text-right tabular-nums">
                        {money(data.unrecognised.revenue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(data.unrecognised.cos)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(data.unrecognised.gp)}
                      </TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {data.unrecognised.count}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow className="font-medium border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{money(data.total.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(data.total.cos)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(data.total.gp)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(data.total.gpPct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{data.total.count}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Projects ranked by GP</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">COS</TableHead>
                    <TableHead className="text-right">GP</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rankedProjects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No project data.
                      </TableCell>
                    </TableRow>
                  )}
                  {rankedProjects.map((p) => (
                    <TableRow key={p.projectId} data-testid={`gp-row-${p.projectId}`}>
                      <TableCell className="font-medium">
                        {p.projectName}
                        {p.status === "missing" && (
                          <Badge variant="destructive" className="ml-2 text-[10px]">
                            missing J
                          </Badge>
                        )}
                        {p.status === "partial" && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            partial
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.cos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.gp)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(p.gpPct)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {p.count}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href="/finance/gp"
                          className="inline-flex items-center text-emerald-600 hover:text-emerald-700 text-xs"
                        >
                          Drill <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

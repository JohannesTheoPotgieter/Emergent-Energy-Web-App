/**
 * ProjectRevenueTrackerView — a project-scoped slice of the company Revenue
 * tracker, modelled tab-for-tab on ProjectCosTrackerView.
 *
 * Reads the SAME canonical endpoint as the Revenue page (`/api/revenue-tracker`,
 * FY-scoped) and filters each month's per-project breakdowns to one project,
 * exactly the way the COS view slices a project. It introduces NO new
 * calculation — every figure is a sum of the per-project values the endpoint
 * already returns (Realised / Committed / Planned), rendered through the shared
 * <MoneyValue>. Used as the "Revenue" tab on the project finance detail page.
 *
 * Column parity with Cost of Sales: Realised / Committed / Planned / Total,
 * where Planned = the endpoint's plannedProjects (FYE planned + unrealised,
 * identical to the COS tab's "Planned" definition) and the three states sum to
 * Total recognised revenue.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchQueryFn } from "@/lib/queryClient";
import { useFinancialYearScope } from "@/hooks/use-financial-year-scope";
import { FinancialYearScopeControl } from "@/components/finance/FinancialYearScopeControl";
import { MoneyValue, FinanceLoading, FinanceError, FinanceEmpty } from "@/components/finance/template";

interface ProjBreak {
  projectName: string;
  value: number;
}

interface RevenueMonth {
  monthKey: string;
  monthLabel: string;
  realisedProjects: ProjBreak[];
  committedProjects: ProjBreak[];
  plannedProjects: ProjBreak[];
}

interface RevenueTrackerResponse {
  months: RevenueMonth[];
}

interface ProjectRevenueRow {
  monthKey: string;
  monthLabel: string;
  realised: number;
  committed: number;
  planned: number;
  total: number;
}

/** Σ of one breakdown array restricted to a single project. */
function sumForProject(rows: ProjBreak[] | undefined, projectName: string): number {
  if (!rows) return 0;
  let s = 0;
  for (const r of rows) if (r.projectName === projectName) s += r.value;
  return s;
}

export function ProjectRevenueTrackerView({
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;

  const { data, isLoading, isError, error, refetch } = useQuery<RevenueTrackerResponse>({
    queryKey: ["/api/revenue-tracker", qs],
    queryFn: fetchQueryFn(`/api/revenue-tracker?${qs}`),
    staleTime: 30_000,
  });

  const rows = useMemo<ProjectRevenueRow[]>(() => {
    return (data?.months ?? []).map((m) => {
      const realised = sumForProject(m.realisedProjects, projectName);
      const committed = sumForProject(m.committedProjects, projectName);
      const planned = sumForProject(m.plannedProjects, projectName);
      return {
        monthKey: m.monthKey,
        monthLabel: m.monthLabel,
        realised,
        committed,
        planned,
        total: realised + committed + planned,
      };
    });
  }, [data, projectName]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          realised: acc.realised + r.realised,
          committed: acc.committed + r.committed,
          planned: acc.planned + r.planned,
          total: acc.total + r.total,
        }),
        { realised: 0, committed: 0, planned: 0, total: 0 },
      ),
    [rows],
  );

  // A project with no revenue in any state across the window has nothing to show.
  const hasAny = rows.some((r) => r.realised !== 0 || r.committed !== 0 || r.planned !== 0);

  return (
    <div className="space-y-3" data-testid="project-revenue-tracker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Revenue — {projectName}</h3>
          <p className="text-xs text-muted-foreground">
            Monthly recognised revenue by state ({fyScope.label}). Same canonical{" "}
            <span className="font-mono">/api/revenue-tracker</span> figures as the Revenue page, sliced to this project.
          </p>
        </div>
        <FinancialYearScopeControl scope={fyScope} />
      </div>

      {isLoading ? (
        <FinanceLoading label="Loading project revenue…" />
      ) : isError ? (
        <FinanceError hint={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : !hasAny ? (
        <FinanceEmpty
          title="No revenue in this window"
          hint="This project has no realised, committed, or planned revenue for the selected period."
        />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-left font-semibold">Month</th>
                <th className="px-3 py-2 text-right font-semibold">Realised</th>
                <th className="px-3 py-2 text-right font-semibold">Committed</th>
                <th className="px-3 py-2 text-right font-semibold">Planned</th>
                <th className="px-3 py-2 text-right font-semibold">Total Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.monthKey} className="border-b border-slate-100 last:border-0" data-testid={`project-revenue-row-${r.monthKey}`}>
                  <td className="px-3 py-1.5 text-slate-700">{r.monthLabel}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums"><MoneyValue value={r.realised} muteNegative={false} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums"><MoneyValue value={r.committed} muteNegative={false} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums"><MoneyValue value={r.planned} muteNegative={false} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold"><MoneyValue value={r.total} muteNegative={false} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold bg-slate-50/60">
                <td className="px-3 py-2 text-slate-700">Total</td>
                <td className="px-3 py-2 text-right tabular-nums"><MoneyValue value={totals.realised} muteNegative={false} /></td>
                <td className="px-3 py-2 text-right tabular-nums"><MoneyValue value={totals.committed} muteNegative={false} /></td>
                <td className="px-3 py-2 text-right tabular-nums"><MoneyValue value={totals.planned} muteNegative={false} /></td>
                <td className="px-3 py-2 text-right tabular-nums"><MoneyValue value={totals.total} muteNegative={false} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Excel-vs-App program-level diff page.
 *
 * One row per project. Drift counters (verified vs unverified). Sort
 * defaults to most-unverified-drift first. Click "Open diff" to drill
 * into the per-project diff page.
 *
 * RBAC: gated by `excel_vs_app:view`. Resolution affordances live on
 * the per-project page; this view is read-only summary.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, AlertTriangle, CheckCircle2, FileText, RefreshCw } from "lucide-react";

interface SectionSummary {
  verified: number;
  unverified: number;
}

interface ProgramRow {
  projectId: number;
  projectName: string;
  verified: number;
  unverified: number;
  section: {
    EXPENDITURE: SectionSummary;
    REVENUE: SectionSummary;
    PLAN: SectionSummary;
  };
}

interface ProgramResponse {
  projects: ProgramRow[];
}

type FilterMode = "all" | "unverified" | "verified" | "none";

export default function ExcelVsAppProgramPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error, dataUpdatedAt, isFetching } = useQuery<ProgramResponse>({
    queryKey: ["excel-vs-app-program"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/excel-vs-app/program");
      if (!res.ok) throw new Error(await res.text() || "Failed to load drift summary");
      return res.json();
    },
  });

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["excel-vs-app-program"] });
  }

  const filtered = useMemo(() => {
    const rows = data?.projects ?? [];
    return rows.filter(r => {
      if (search.trim() && !r.projectName.toLowerCase().includes(search.trim().toLowerCase())) return false;
      switch (filter) {
        case "unverified":
          return r.unverified > 0;
        case "verified":
          return r.verified > 0;
        case "none":
          return r.unverified === 0 && r.verified === 0;
        default:
          return true;
      }
    });
  }, [data, filter, search]);

  const totals = useMemo(() => {
    const rows = data?.projects ?? [];
    return {
      projects: rows.length,
      withUnverified: rows.filter(r => r.unverified > 0).length,
      totalUnverified: rows.reduce((s, r) => s + r.unverified, 0),
      totalVerified: rows.reduce((s, r) => s + r.verified, 0),
    };
  }, [data]);

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Excel vs App</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-project comparison of the live app state against the most recent Tracker workbook import.
            Unverified drift means the live value disagrees with Excel and no operator override explains the change — those need an explicit decision.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={"h-3.5 w-3.5 mr-1 " + (isFetching ? "animate-spin" : "")} /> Refresh
          </Button>
          {dataUpdatedAt > 0 && (
            <span className="text-[11px] text-muted-foreground">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard label="Projects" value={totals.projects} icon={<FileText className="h-4 w-4" />} />
        <SummaryCard label="Projects with unverified drift" value={totals.withUnverified} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} />
        <SummaryCard label="Unverified drift fields" value={totals.totalUnverified} tone="warn" />
        <SummaryCard label="Verified drift fields" value={totals.totalVerified} tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Project drift</CardTitle>
          <div className="flex items-center gap-2">
            <Input placeholder="Search project…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 h-8" />
            <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>All</FilterTab>
            <FilterTab active={filter === "unverified"} onClick={() => setFilter("unverified")}>Unverified</FilterTab>
            <FilterTab active={filter === "verified"} onClick={() => setFilter("verified")}>Verified</FilterTab>
            <FilterTab active={filter === "none"} onClick={() => setFilter("none")}>No drift</FilterTab>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <SkeletonRows />}
          {isError && (
            <div className="text-sm text-red-600">Failed to load drift summary: {error instanceof Error ? error.message : String(error)}</div>
          )}
          {!isLoading && !isError && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 font-medium">Project</th>
                    <th className="py-2 font-medium text-right">Plan</th>
                    <th className="py-2 font-medium text-right">Revenue</th>
                    <th className="py-2 font-medium text-right">Expenditure</th>
                    <th className="py-2 font-medium text-right">Verified</th>
                    <th className="py-2 font-medium text-right">Unverified</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.projectId} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 font-medium">{row.projectName}</td>
                      <td className="py-2 text-right">
                        <SectionCell summary={row.section.PLAN} />
                      </td>
                      <td className="py-2 text-right">
                        <SectionCell summary={row.section.REVENUE} />
                      </td>
                      <td className="py-2 text-right">
                        <SectionCell summary={row.section.EXPENDITURE} />
                      </td>
                      <td className="py-2 text-right">
                        {row.verified > 0 ? <Badge variant="secondary">{row.verified}</Badge> : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="py-2 text-right">
                        {row.unverified > 0 ? <Badge variant="destructive">{row.unverified}</Badge> : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="py-2 text-right">
                        <Link
                          href={`/projects/${row.projectId}/excel-vs-app`}
                          className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 text-sm font-medium"
                        >
                          Open diff <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                        No projects match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
  icon?: React.ReactNode;
}) {
  const valueClass =
    tone === "warn" && value > 0
      ? "text-red-600"
      : tone === "ok" && value > 0
        ? "text-emerald-600"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
          <span>{label}</span>
          {icon}
        </div>
        <div className={`text-2xl font-semibold mt-1 ${valueClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-3 py-1 rounded-md text-xs font-medium transition-colors border " +
        (active
          ? "bg-emerald-50 border-emerald-300 text-emerald-700"
          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
      }
    >
      {children}
    </button>
  );
}

function SectionCell({ summary }: { summary: SectionSummary }) {
  if (summary.verified === 0 && summary.unverified === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="inline-flex items-center gap-1.5 text-xs">
      {summary.unverified > 0 && (
        <span className="bg-red-50 text-red-700 border border-red-200 rounded px-1.5 py-0.5">
          {summary.unverified} unverified
        </span>
      )}
      {summary.verified > 0 && (
        <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
          {summary.verified} verified
        </span>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

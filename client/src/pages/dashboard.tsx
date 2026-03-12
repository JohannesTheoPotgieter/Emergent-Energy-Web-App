import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

type DashboardResponse = {
  meta: { fyStart: string; fyEnd: string };
  kpis: Record<string, number | null>;
  options: { portfolios: string[]; pms: string[]; pds: string[]; executionPhases: string[]; rags: string[] };
  projects: any[];
  actionCenter: Record<string, any[]>;
};

const tabs = ["COO", "Program", "Finance", "Construction"] as const;

const money = (n: number | null | undefined) => `R ${(Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("COO");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filters, setFilters] = useState({
    search: "", portfolio: "all", pm: "all", pd: "all", executionPhase: "all", rag: "all",
    exceptionOnly: false, behindPlanOnly: false, inflowRiskOnly: false, outflowRiskOnly: false,
    engineeringBlockersOnly: false, qualityIssuesOnly: false, pendingApprovalsOnly: false, staleImportsOnly: false,
  });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (typeof v === "boolean") {
        if (v) params.set(k, "true");
      } else if (v && v !== "all") params.set(k, v);
    });
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: ["/api/program-dashboard", query],
    queryFn: async () => {
      const res = await fetch(`/api/program-dashboard${query ? `?${query}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const opts = data?.options || { portfolios: [], pms: [], pds: [], executionPhases: [], rags: [] };

  const filterSelect = (name: keyof typeof filters, values: string[]) => (
    <Select value={String(filters[name])} onValueChange={(v) => setFilters((f) => ({ ...f, [name]: v }))}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        {values.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const queueKeys: Array<[string, string]> = [
    ["projectsBehindPlan", "Projects Behind Plan"],
    ["inflowAtRisk", "Inflow at Risk"],
    ["expenditureAtRisk", "Expenditure / COS at Risk"],
    ["engineeringBottlenecks", "Engineering Bottlenecks"],
    ["qualityIssues", "Quality Issues"],
    ["pendingApprovalsDecisions", "Pending Approvals / Decisions"],
  ];

  return (
    <div className="space-y-4 p-4" data-testid="execution-dashboard-page">
      <h1 className="text-2xl font-bold">Execution Dashboard</h1>

      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <Button key={t} variant={activeTab === t ? "default" : "outline"} onClick={() => setActiveTab(t)}>{t}</Button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input placeholder="Search" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
          {filterSelect("portfolio", opts.portfolios)}
          {filterSelect("pm", opts.pms)}
          {filterSelect("pd", opts.pds)}
          {filterSelect("executionPhase", opts.executionPhases)}
          {filterSelect("rag", opts.rags)}
          {[
            ["exceptionOnly", "Exception only"], ["behindPlanOnly", "Behind plan only"], ["inflowRiskOnly", "Inflow risk only"],
            ["outflowRiskOnly", "Outflow risk only"], ["engineeringBlockersOnly", "Engineering blockers only"], ["qualityIssuesOnly", "Quality issues only"],
            ["pendingApprovalsOnly", "Pending approvals only"], ["staleImportsOnly", "Stale imports only"],
          ].map(([k, label]) => (
            <label className="flex items-center gap-2 text-sm" key={k}><Checkbox checked={(filters as any)[k]} onCheckedChange={(v) => setFilters((f) => ({ ...f, [k]: !!v }))} />{label}</label>
          ))}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-4 gap-3">
        {[
          ["activeDashboardProjects", "Active Dashboard Projects"], ["averageActualProgressPct", "Average Actual Progress %"], ["averageExpectedProgressPct", "Average Expected Progress %"], ["projectsBehindPlan", "Projects Behind Plan"],
          ["plannedRevenueFy", "Planned Revenue (Current FY)"], ["receivedInflowFy", "Received Inflow (Current FY)"], ["openInflowFy", "Open Inflow (Current FY)"],
          ["plannedExpenditureFy", "Planned Expenditure (Current FY)"], ["paidExpenditureFy", "Paid Expenditure (Current FY)"], ["openExpenditureFy", "Open Expenditure (Current FY)"],
          ["grossProfitFy", "Gross Profit (Current FY)"], ["grossMarginPctFy", "Gross Margin % (Current FY)"], ["openEngineeringBlockers", "Open Engineering Blockers"],
          ["openQualityWarnings", "Open Quality Warnings"], ["pendingApprovals", "Pending Approvals"], ["staleImports", "Stale Imports"],
        ].map(([key, label]) => (
          <Card key={key}><CardContent className="pt-5"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-semibold">{
            String(key).includes("Pct") || key === "grossMarginPctFy" ? pct(data?.kpis?.[key] as number | null) :
            String(key).includes("Revenue") || String(key).includes("Inflow") || String(key).includes("Expenditure") || key === "grossProfitFy" ? money(data?.kpis?.[key] as number) :
            Number(data?.kpis?.[key] || 0)
          }</div></CardContent></Card>
        ))}
      </div>

      {activeTab === "COO" && (
        <Card>
          <CardHeader><CardTitle>Action Center</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {queueKeys.map(([k, title]) => (
              <div key={k}>
                <div className="font-medium mb-2">{title}</div>
                <table className="w-full text-sm border">
                  <thead><tr className="bg-muted"><th>Project</th><th>Issue title</th><th>Severity</th><th>Owner</th><th>Due date</th><th>Link</th></tr></thead>
                  <tbody>
                    {(data?.actionCenter?.[k] || []).map((r: any, i: number) => (
                      <tr key={i} className="border-t"><td>{r.project}</td><td>{r.issueTitle}</td><td>{r.severity}</td><td>{r.owner || "—"}</td><td>{r.dueDate || "—"}</td><td><Link href={r.links.project}>Open</Link></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === "Program" && <Card><CardHeader><CardTitle>Program View</CardTitle></CardHeader><CardContent>Phase flow, PM load, delivery exceptions, and schedule behavior all use the same canonical progress source for the visible project set.</CardContent></Card>}
      {activeTab === "Finance" && <Card><CardHeader><CardTitle>Finance (Current FY {data?.meta.fyStart} to {data?.meta.fyEnd})</CardTitle></CardHeader><CardContent>Planned/received/open inflow and planned/paid/open expenditure are FY-only and reconcile with the main table and KPI strip.</CardContent></Card>}
      {activeTab === "Construction" && <Card><CardHeader><CardTitle>Construction View</CardTitle></CardHeader><CardContent>Phase, dates, site readiness and execution timing for the same visible project population.</CardContent></Card>}

      <Card>
        <CardHeader><CardTitle>Main Project Table</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? "Loading..." : (
            <table className="w-full text-xs border" data-testid="execution-dashboard-table">
              <thead className="bg-muted"><tr>
                <th>Project Name</th><th>Portfolio</th><th>PM</th><th>PD</th><th>Execution Phase</th><th>RAG</th><th>Actual Progress %</th><th>Expected Progress %</th><th>Schedule Variance %</th>
                <th>Planned Revenue (FY)</th><th>Received Inflow (FY)</th><th>Open Inflow (FY)</th><th>Planned Expenditure (FY)</th><th>Paid Expenditure (FY)</th><th>Open Expenditure (FY)</th><th>Gross Margin % (FY)</th>
                <th>Engineering Status</th><th>Quality Status</th><th>Import Freshness</th><th>Critical Action Count</th>
              </tr></thead>
              <tbody>
                {(data?.projects || []).map((p: any) => (
                  <Fragment key={p.projectId}>
                    <tr key={p.projectId} className="border-t cursor-pointer" onClick={() => setExpanded(expanded === p.projectId ? null : p.projectId)}>
                      <td>{p.projectName}</td><td>{p.portfolio || "—"}</td><td>{p.pm || "—"}</td><td>{p.pd || "—"}</td><td>{p.executionPhase || "—"}</td><td>{p.rag || "—"}</td>
                      <td>{pct(p.actualProgressPct)}</td><td>{pct(p.expectedProgressPct)}</td><td>{pct(p.scheduleVariancePct)}</td>
                      <td>{money(p.plannedRevenueFy)}</td><td>{money(p.receivedInflowFy)}</td><td>{money(p.openInflowFy)}</td>
                      <td>{money(p.plannedExpenditureFy)}</td><td>{money(p.paidExpenditureFy)}</td><td>{money(p.openExpenditureFy)}</td><td>{pct((p.grossMarginPctFy || 0) * 100)}</td>
                      <td>{p.engineeringStatus}</td><td>{p.qualityStatus}</td><td>{p.importFreshness}</td><td>{p.criticalActionCount}</td>
                    </tr>
                    {expanded === p.projectId && (
                      <tr className="border-t bg-muted/30"><td colSpan={20} className="p-3">
                        <div className="grid md:grid-cols-4 gap-4">
                          <div><div className="font-semibold">Project Summary</div><div>{p.projectName}</div></div>
                          <div><div className="font-semibold">Progress Summary</div><div>Actual {pct(p.actualProgressPct)} · Expected {pct(p.expectedProgressPct)} · Variance {pct(p.scheduleVariancePct)}</div></div>
                          <div><div className="font-semibold">Financial Summary (Current FY)</div><div>{money(p.plannedRevenueFy)} / {money(p.plannedExpenditureFy)} · Margin {pct((p.grossMarginPctFy || 0) * 100)}</div></div>
                          <div><div className="font-semibold">Active Issues / Exceptions</div><div>Critical actions: {p.criticalActionCount}</div></div>
                        </div>
                        <div className="flex gap-3 mt-2">
                          <Link href={`/project/${encodeURIComponent(p.projectName)}`}>Project</Link>
                          <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=plan`}>Plan</Link>
                          <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=revenue-tracking`}>Revenue</Link>
                          <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=expenditure`}>Expenditure</Link>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

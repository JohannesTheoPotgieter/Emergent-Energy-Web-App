import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Search,
  ArrowUpDown,
  Users,
  Calendar,
  Zap,
} from "lucide-react";

function formatRand(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

interface ProjectRow {
  projectName: string;
  pm: string | null;
  phase: string | null;
  sizeKwp: string | null;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  totalBudget: number;
  totalActual: number;
  totalRevenue: number;
  totalReceived: number;
  budgetVariance: number;
  revenueRealized: number;
  expenseLineCount: number;
  inflowLineCount: number;
  riskFlags: string[];
}

const riskFlagColors: Record<string, string> = {
  "Over budget": "bg-red-100 text-red-700",
  "No start date": "bg-amber-100 text-amber-700",
  "No commissioning date": "bg-amber-100 text-amber-700",
  "No PM assigned": "bg-purple-100 text-purple-700",
  "No revenue received": "bg-orange-100 text-orange-700",
};

export default function PlanningBoardPage() {
  const [search, setSearch] = useState("");
  const [pmFilter, setPmFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [sortField, setSortField] = useState<string>("riskFlags");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useQuery<{ projects: ProjectRow[]; total: number }>({
    queryKey: ["/api/planning-board/projects"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const projects = data?.projects ?? [];

  const pms = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => { if (p.pm) set.add(p.pm); });
    return Array.from(set).sort();
  }, [projects]);

  const phases = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => { if (p.phase) set.add(p.phase); });
    return Array.from(set).sort();
  }, [projects]);

  const allRiskTypes = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => p.riskFlags.forEach(f => set.add(f)));
    return Array.from(set).sort();
  }, [projects]);

  const filtered = useMemo(() => {
    let result = projects;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p => p.projectName.toLowerCase().includes(q) || (p.pm && p.pm.toLowerCase().includes(q)));
    }
    if (pmFilter !== "all") result = result.filter(p => p.pm === pmFilter);
    if (phaseFilter !== "all") result = result.filter(p => p.phase === phaseFilter);
    if (riskFilter !== "all") result = result.filter(p => p.riskFlags.includes(riskFilter));

    return result.sort((a: any, b: any) => {
      let av: any, bv: any;
      if (sortField === "riskFlags") { av = a.riskFlags.length; bv = b.riskFlags.length; }
      else { av = a[sortField] ?? ''; bv = b[sortField] ?? ''; }
      if (typeof av === 'string') return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [projects, search, pmFilter, phaseFilter, riskFilter, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const summaryStats = useMemo(() => {
    const totalCapacity = projects.reduce((s, p) => s + parseFloat(p.sizeKwp || '0'), 0);
    const totalBudget = projects.reduce((s, p) => s + p.totalBudget, 0);
    const totalActual = projects.reduce((s, p) => s + p.totalActual, 0);
    const totalRevenue = projects.reduce((s, p) => s + p.totalRevenue, 0);
    const totalReceived = projects.reduce((s, p) => s + p.totalReceived, 0);
    const withRisks = projects.filter(p => p.riskFlags.length > 0).length;
    return { totalCapacity, totalBudget, totalActual, totalRevenue, totalReceived, withRisks };
  }, [projects]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold">Planning Board</h2>
        <div className="p-12 text-center text-muted-foreground">Loading project data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="planning-board-page">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Planning Board</h2>
        <p className="text-muted-foreground">Project overview with risk flags and financial summary</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Projects</p>
            <p className="text-xl font-bold">{projects.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Capacity</p>
            <p className="text-xl font-bold">{(summaryStats.totalCapacity / 1000).toFixed(1)} MWp</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Budget</p>
            <p className="text-xl font-bold">{formatRand(summaryStats.totalBudget)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Actual</p>
            <p className="text-xl font-bold">{formatRand(summaryStats.totalActual)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Revenue Received</p>
            <p className="text-xl font-bold text-green-600">{formatRand(summaryStats.totalReceived)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">At Risk</p>
            <p className="text-xl font-bold text-red-600">{summaryStats.withRisks}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
            <CardTitle className="text-lg">Projects ({filtered.length})</CardTitle>
            <div className="flex gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="input-search-projects"
                  placeholder="Search projects..."
                  className="pl-8 h-8 w-48"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <select
                data-testid="select-pm-filter"
                className="h-8 rounded-md border px-2 text-sm bg-background"
                value={pmFilter}
                onChange={e => setPmFilter(e.target.value)}
              >
                <option value="all">All PMs</option>
                {pms.map(pm => <option key={pm} value={pm}>{pm}</option>)}
              </select>
              <select
                data-testid="select-phase-filter"
                className="h-8 rounded-md border px-2 text-sm bg-background"
                value={phaseFilter}
                onChange={e => setPhaseFilter(e.target.value)}
              >
                <option value="all">All Phases</option>
                {phases.map(ph => <option key={ph} value={ph}>{ph}</option>)}
              </select>
              <select
                data-testid="select-risk-filter"
                className="h-8 rounded-md border px-2 text-sm bg-background"
                value={riskFilter}
                onChange={e => setRiskFilter(e.target.value)}
              >
                <option value="all">All Risk Levels</option>
                {allRiskTypes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background z-10 border-b">
                <tr>
                  <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort("projectName")}>
                    <div className="flex items-center gap-1">Project <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort("pm")}>
                    <div className="flex items-center gap-1">PM <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-2 text-left">Phase</th>
                  <th className="p-2 text-right cursor-pointer" onClick={() => toggleSort("sizeKwp")}>
                    <div className="flex items-center justify-end gap-1">Size <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-2 text-left">Dates</th>
                  <th className="p-2 text-right cursor-pointer" onClick={() => toggleSort("totalBudget")}>
                    <div className="flex items-center justify-end gap-1">Budget <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-2 text-right cursor-pointer" onClick={() => toggleSort("totalActual")}>
                    <div className="flex items-center justify-end gap-1">Actual <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-2 text-right">Variance</th>
                  <th className="p-2 text-right cursor-pointer" onClick={() => toggleSort("revenueRealized")}>
                    <div className="flex items-center justify-end gap-1">Rev % <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort("riskFlags")}>
                    <div className="flex items-center gap-1">Risks <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.projectName} className="border-b hover:bg-muted/50" data-testid={`planning-project-${p.projectName}`}>
                    <td className="p-2 font-medium truncate max-w-[200px]">{p.projectName}</td>
                    <td className="p-2 text-xs">{p.pm || '-'}</td>
                    <td className="p-2 text-xs">{p.phase || '-'}</td>
                    <td className="p-2 text-right text-xs font-mono">{p.sizeKwp ? `${parseFloat(p.sizeKwp).toFixed(0)} kWp` : '-'}</td>
                    <td className="p-2 text-xs whitespace-nowrap">
                      {p.constructionStartDate ? p.constructionStartDate.substring(0, 10) : '?'} →{' '}
                      {p.commissioningDate ? p.commissioningDate.substring(0, 10) : '?'}
                    </td>
                    <td className="p-2 text-right font-mono text-xs">{formatRand(p.totalBudget)}</td>
                    <td className="p-2 text-right font-mono text-xs">{formatRand(p.totalActual)}</td>
                    <td className={`p-2 text-right font-mono text-xs font-medium ${p.budgetVariance > 5 ? 'text-red-600' : p.budgetVariance < -5 ? 'text-green-600' : ''}`}>
                      {p.totalBudget > 0 ? `${p.budgetVariance > 0 ? '+' : ''}${p.budgetVariance.toFixed(1)}%` : '-'}
                    </td>
                    <td className="p-2 text-right text-xs">
                      {p.totalRevenue > 0 ? (
                        <span className={p.revenueRealized > 50 ? 'text-green-600' : 'text-amber-600'}>
                          {p.revenueRealized.toFixed(0)}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {p.riskFlags.map(flag => (
                          <span key={flag} className={`px-1.5 py-0.5 rounded text-[10px] ${riskFlagColors[flag] || 'bg-gray-100 text-gray-700'}`}>
                            {flag}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

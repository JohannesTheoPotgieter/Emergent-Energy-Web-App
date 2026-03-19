import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ragBadgeClasses } from "@/lib/status-colors";
import {
  formatCurrencyCompact,
  formatDate,
  type ExecutionDashboardProject,
} from "@/lib/execution-dashboard";
import {
  ArrowRight, ArrowUpDown, ChevronDown, ChevronUp,
  Layers, Clock, AlertTriangle, Activity, Shield, Users,
  ExternalLink,
} from "lucide-react";
import { useExecutionData } from "./use-execution-data";

type SortKey = "projectName" | "pm" | "phase" | "rag" | "progress" | "variance" | "behindPlan" | "criticalActions" | "importAge";
type SortDir = "asc" | "desc";

const RAG_ORDER: Record<string, number> = { Red: 0, Amber: 1, Green: 2, Unknown: 3 };

function sortProjects(projects: ExecutionDashboardProject[], key: SortKey, dir: SortDir): ExecutionDashboardProject[] {
  const m = dir === "asc" ? 1 : -1;
  return [...projects].sort((a, b) => {
    switch (key) {
      case "projectName": return m * (a.projectName || "").localeCompare(b.projectName || "");
      case "pm": return m * (a.pm || "").localeCompare(b.pm || "");
      case "phase": return m * (a.executionPhase || "").localeCompare(b.executionPhase || "");
      case "rag": return m * ((RAG_ORDER[a.rag] ?? 3) - (RAG_ORDER[b.rag] ?? 3));
      case "progress": return m * ((a.actualProgressPct || 0) - (b.actualProgressPct || 0));
      case "variance": return m * ((a.scheduleVariancePct || 0) - (b.scheduleVariancePct || 0));
      case "behindPlan": return m * ((a.behindPlan ? 0 : 1) - (b.behindPlan ? 0 : 1));
      case "criticalActions": return m * (a.criticalActionCount - b.criticalActionCount);
      case "importAge": return m * ((a.importAgeDays || 0) - (b.importAgeDays || 0));
      default: return 0;
    }
  });
}

export default function ProgramPage() {
  const { kpis, filteredProjects, actionRows, openProject, fyLabel } = useExecutionData();
  const [sortKey, setSortKey] = useState<SortKey>("behindPlan");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const sorted = useMemo(() => sortProjects(filteredProjects, sortKey, sortDir), [filteredProjects, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortHeader = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      className={`py-2.5 px-2 font-medium cursor-pointer hover:text-foreground select-none ${className || ""}`}
      onClick={() => toggleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortKey === k && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        {sortKey !== k && <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );

  // Phase counts
  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filteredProjects) {
      const phase = p.executionPhase || "Unassigned";
      counts[phase] = (counts[phase] || 0) + 1;
    }
    return counts;
  }, [filteredProjects]);

  // Blocker / dependency watchlist
  const blockerRows = useMemo(() => {
    return actionRows
      .filter((r) => r.queue?.toLowerCase().includes("engineering") || r.queue?.toLowerCase().includes("behind") || r.queue?.toLowerCase().includes("quality"))
      .slice(0, 15);
  }, [actionRows]);

  return (
    <div className="space-y-5">
      {/* KPI STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Object.entries(phaseCounts).slice(0, 4).map(([phase, count]) => (
          <KpiCard key={phase} label={`In ${phase}`} value={count} icon={<Layers className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-100" />
        ))}
        <KpiCard label="Behind Plan" value={kpis.projectsBehindPlan} icon={<Clock className="w-4 h-4 text-red-600" />} iconBg="bg-red-100" valueClass="text-red-600" />
        <KpiCard label="Avg. Progress" value={`${kpis.averageActualProgressPct ?? "—"}%`} icon={<Activity className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-100" sub={`Expected: ${kpis.averageExpectedProgressPct ?? "—"}%`} />
      </div>

      {/* MAIN EXECUTION GRID */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold">Program Execution Grid</h2>
            <Badge variant="outline" className="text-xs ml-1">{sorted.length} projects</Badge>
          </div>
          <div className="rounded-lg border border-border/60 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <SortHeader k="projectName" className="text-left px-3">Project</SortHeader>
                  <SortHeader k="pm" className="text-left hidden lg:table-cell">PM</SortHeader>
                  <SortHeader k="phase" className="text-left">Phase</SortHeader>
                  <SortHeader k="rag" className="text-center">RAG</SortHeader>
                  <SortHeader k="progress" className="text-right">Progress</SortHeader>
                  <SortHeader k="variance" className="text-right">Variance</SortHeader>
                  <SortHeader k="behindPlan" className="text-center">Delayed</SortHeader>
                  <SortHeader k="criticalActions" className="text-center">Issues</SortHeader>
                  <SortHeader k="importAge" className="text-right hidden lg:table-cell">Last Update</SortHeader>
                  <th className="w-8 py-2.5 px-1"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const expanded = expandedId === p.projectId;
                  const variance = p.scheduleVariancePct || 0;
                  return (
                    <React.Fragment key={p.projectId}>
                      <tr
                        className={`border-t border-border/40 cursor-pointer transition-colors ${expanded ? "bg-emerald-50/40" : "hover:bg-muted/30"}`}
                        onClick={() => setExpandedId(expanded ? null : p.projectId)}
                      >
                        <td className="py-2 px-3 font-medium truncate max-w-[200px]">{p.projectName}</td>
                        <td className="py-2 px-2 text-muted-foreground text-xs hidden lg:table-cell">{p.pm || "—"}</td>
                        <td className="py-2 px-2 text-xs">{p.executionPhase || "—"}</td>
                        <td className="py-2 px-2 text-center"><Badge className={`text-[10px] ${ragBadgeClasses(p.rag)}`}>{p.rag}</Badge></td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          <span className="font-medium">{p.actualProgressPct ?? "—"}%</span>
                          <div className="text-[10px] text-muted-foreground">of {p.expectedProgressPct ?? "—"}%</div>
                        </td>
                        <td className={`py-2 px-2 text-right tabular-nums font-medium ${variance < 0 ? "text-red-600" : variance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                          {p.scheduleVariancePct != null ? `${variance > 0 ? "+" : ""}${variance}%` : "—"}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {p.behindPlan ? (
                            <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Yes</Badge>
                          ) : (
                            <span className="text-xs text-emerald-600">No</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {p.criticalActionCount > 0 ? (
                            <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{p.criticalActionCount}</Badge>
                          ) : <span className="text-xs text-muted-foreground">0</span>}
                        </td>
                        <td className="py-2 px-2 text-right text-xs text-muted-foreground hidden lg:table-cell tabular-nums">
                          {p.importAgeDays != null ? `${p.importAgeDays}d ago` : "—"}
                        </td>
                        <td className="py-2 px-1 text-center">
                          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20 border-t border-border/40">
                          <td colSpan={10} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Project Details</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Portfolio:</span> <span className="font-medium">{p.portfolio || "—"}</span></p>
                                  <p><span className="text-muted-foreground">PM:</span> {p.pm || "Unassigned"}</p>
                                  <p><span className="text-muted-foreground">PD:</span> {p.pd || "Unassigned"}</p>
                                  <p><span className="text-muted-foreground">Phase:</span> {p.executionPhase || "—"}</p>
                                  <p><span className="text-muted-foreground">Import Status:</span> {p.importFreshness}</p>
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Schedule</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Actual Progress:</span> <span className="font-medium">{p.actualProgressPct ?? "—"}%</span></p>
                                  <p><span className="text-muted-foreground">Expected Progress:</span> {p.expectedProgressPct ?? "—"}%</p>
                                  <p><span className="text-muted-foreground">Variance:</span> <span className={variance < 0 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>{p.scheduleVariancePct ?? "—"}%</span></p>
                                  <p><span className="text-muted-foreground">Behind Plan:</span> <span className={p.behindPlan ? "text-red-600 font-medium" : "text-emerald-600"}>{p.behindPlan ? "Yes" : "No"}</span></p>
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Status</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Engineering:</span> {p.engineeringStatus}</p>
                                  <p><span className="text-muted-foreground">Quality:</span> {p.qualityStatus}</p>
                                  <p><span className="text-muted-foreground">Critical Actions:</span> {p.criticalActionCount}</p>
                                  <p><span className="text-muted-foreground">Pending Approvals:</span> {p.pendingApprovalCount}</p>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <Button size="sm" onClick={() => openProject(p)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                <ExternalLink className="w-3.5 h-3.5" />Open Project
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openProject(p, "plan")}>Plan</Button>
                              <Button size="sm" variant="outline" onClick={() => openProject(p, "revenue")}>Revenue</Button>
                              <Button size="sm" variant="outline" onClick={() => openProject(p, "expenditure")}>Expenditure</Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {sorted.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground">No projects match current filters</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* BLOCKER / DEPENDENCY WATCHLIST */}
      {blockerRows.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-violet-500" />
              <h3 className="text-sm font-semibold">Blocker / Dependency Watchlist</h3>
              <Badge variant="outline" className="text-xs">{blockerRows.length}</Badge>
            </div>
            <div className="rounded-lg border border-border/60 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Project</th>
                    <th className="text-left py-2 px-3 font-medium">Blocker / Issue</th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Owner</th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Severity</th>
                    <th className="text-left py-2 px-3 font-medium hidden lg:table-cell">Due</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {blockerRows.map((r, i) => (
                    <tr key={i} className="border-t border-border/40 hover:bg-muted/30">
                      <td className="py-2 px-3 font-medium">{r.projectName}</td>
                      <td className="py-2 px-3 text-muted-foreground truncate max-w-[250px]">{r.issueTitle}</td>
                      <td className="py-2 px-3 text-muted-foreground text-xs hidden md:table-cell">{r.owner}</td>
                      <td className="py-2 px-3 hidden md:table-cell">
                        <Badge className={`text-[10px] ${r.severity === "critical" ? "bg-red-100 text-red-700" : r.severity === "high" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{r.severity}</Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground text-xs tabular-nums hidden lg:table-cell">{formatDate(r.dueDate)}</td>
                      <td className="py-2 px-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => window.location.href = r.link}>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ icon, iconBg, label, value, sub, valueClass }: {
  icon: React.ReactNode; iconBg: string; label: string; value: React.ReactNode; sub?: string; valueClass?: string;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>{icon}</div>
          <span className="text-[10px] text-muted-foreground font-medium leading-tight">{label}</span>
        </div>
        <p className={`text-lg font-bold tabular-nums ${valueClass || ""}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

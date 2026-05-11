import React, { useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCurrencyCompact } from "@/lib/execution-dashboard";
import {
  Activity, TrendingDown, DollarSign,
  ArrowRight, CheckCircle2, XCircle, Banknote,
} from "lucide-react";
import { useExecutionData } from "./use-execution-data";

export default function OverviewPage() {
  const { kpis, filteredProjects, openProject, dashboard } = useExecutionData();
  const [, setLocation] = useLocation();
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);
  const [contractSheetOpen, setContractSheetOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* 6 Program Metrics KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* 1 — On Schedule Rate */}
        <KpiTile
          label="On Schedule Rate"
          value={`${kpis.onScheduleRate}%`}
          valueClass={kpis.onScheduleRate >= 70 ? "text-emerald-600" : kpis.onScheduleRate >= 50 ? "text-amber-600" : "text-red-600"}
          sub={`${filteredProjects.filter((p) => (p.actualProgressPct ?? 0) >= (p.expectedProgressPct ?? 0) - 5).length} of ${filteredProjects.length} projects on schedule`}
          icon={<Activity className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-100"
          cta="View schedule breakdown"
          onClick={() => setScheduleSheetOpen(true)}
        />

        {/* 2 — Contract Completeness */}
        <KpiTile
          label="Contract Completeness"
          value={`${kpis.contractCompleteness}%`}
          valueClass={kpis.contractCompleteness >= 80 ? "text-emerald-600" : kpis.contractCompleteness >= 50 ? "text-amber-600" : "text-red-600"}
          sub={`${filteredProjects.filter((p) => p.cpSigned && p.signedStatus === "SIGNED").length} of ${filteredProjects.length} projects fully signed`}
          icon={<CheckCircle2 className="w-5 h-5 text-blue-600" />}
          iconBg="bg-blue-100"
          cta="View contract status"
          onClick={() => setContractSheetOpen(true)}
        />

        {/* 3 — Revenue Outstanding This Month */}
        <KpiTile
          label="Rev Outstanding This Month"
          value={formatCurrencyCompact(dashboard?.kpis.revenueOutstandingThisMonth ?? 0)}
          valueClass="text-amber-600"
          sub="Revenue planned but not yet received in current month"
          icon={<DollarSign className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-100"
          cta="View Finance"
          onClick={() => setLocation("/execution-board/finance")}
        />

        {/* 4 — COS Outstanding This Month */}
        <KpiTile
          label="COS Outstanding This Month"
          value={formatCurrencyCompact(dashboard?.kpis.cosOutstandingThisMonth ?? 0)}
          valueClass="text-orange-600"
          sub="Cost of sales planned but not yet paid in current month"
          icon={<TrendingDown className="w-5 h-5 text-orange-600" />}
          iconBg="bg-orange-100"
          cta="View Finance"
          onClick={() => setLocation("/execution-board/finance")}
        />

        {/* 5 — Inflows This Week */}
        <KpiTile
          label="Inflows This Week"
          value={formatCurrencyCompact(dashboard?.kpis.projectInflowsThisWeek ?? 0)}
          valueClass="text-blue-600"
          sub="Expected project cashflow inflows for Mon–Sun this week"
          icon={<Banknote className="w-5 h-5 text-blue-600" />}
          iconBg="bg-blue-100"
          cta="View Finance"
          onClick={() => setLocation("/execution-board/finance")}
        />

        {/* 6 — Outflows This Week */}
        <KpiTile
          label="Outflows This Week"
          value={formatCurrencyCompact(dashboard?.kpis.projectOutflowsThisWeek ?? 0)}
          valueClass="text-red-600"
          sub="Expected project cashflow outflows for Mon–Sun this week"
          icon={<TrendingDown className="w-5 h-5 text-red-600" />}
          iconBg="bg-red-100"
          cta="View Finance"
          onClick={() => setLocation("/execution-board/finance")}
        />
      </div>

      {/* On Schedule drill-down Sheet */}
      <Sheet open={scheduleSheetOpen} onOpenChange={setScheduleSheetOpen}>
        <SheetContent className="sm:max-w-[800px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-500" />
              Schedule Status — {kpis.onScheduleRate}% On Schedule
            </SheetTitle>
          </SheetHeader>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-2 text-center">
              <p className="text-[10px] text-emerald-700 font-medium">ON SCHEDULE</p>
              <p className="text-xl font-bold text-emerald-600">
                {filteredProjects.filter((p) => (p.actualProgressPct ?? 0) >= (p.expectedProgressPct ?? 0) - 5).length}
              </p>
            </div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-2 text-center">
              <p className="text-[10px] text-red-700 font-medium">BEHIND PLAN</p>
              <p className="text-xl font-bold text-red-600">{kpis.projectsBehindPlan}</p>
            </div>
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-2 text-center">
              <p className="text-[10px] text-slate-700 font-medium">TOTAL PROJECTS</p>
              <p className="text-xl font-bold text-slate-600">{filteredProjects.length}</p>
            </div>
          </div>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[65vh]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left py-2 px-3 font-medium">Project</th>
                  <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-right py-2 px-3 font-medium">Actual %</th>
                  <th className="text-right py-2 px-3 font-medium">Expected %</th>
                  <th className="text-right py-2 px-3 font-medium">Variance</th>
                  <th className="text-center py-2 px-3 font-medium">Status</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...filteredProjects]
                  .sort((a, b) => ((a.scheduleVariancePct ?? 0) - (b.scheduleVariancePct ?? 0)))
                  .map((p) => {
                    const onSchedule = (p.actualProgressPct ?? 0) >= (p.expectedProgressPct ?? 0) - 5;
                    const variance = p.scheduleVariancePct ?? 0;
                    return (
                      <tr
                        key={p.projectId}
                        className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                        onClick={() => { openProject(p, "plan"); setScheduleSheetOpen(false); }}
                      >
                        <td className="py-2 px-3 font-medium truncate max-w-[200px]">{p.projectName}</td>
                        <td className="py-2 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-medium">{p.actualProgressPct ?? "—"}%</td>
                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{p.expectedProgressPct ?? "—"}%</td>
                        <td className={`py-2 px-3 text-right tabular-nums font-medium ${variance < 0 ? "text-red-600" : variance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                          {p.scheduleVariancePct != null ? `${variance > 0 ? "+" : ""}${variance}%` : "—"}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {onSchedule
                            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">On Schedule</Badge>
                            : <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Behind Plan</Badge>}
                        </td>
                        <td className="py-2 px-1 text-center">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                            <ArrowRight className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </SheetContent>
      </Sheet>

      {/* Contract Completeness drill-down Sheet */}
      <Sheet open={contractSheetOpen} onOpenChange={setContractSheetOpen}>
        <SheetContent className="sm:max-w-[800px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-blue-500" />
              Contract Completeness — {kpis.contractCompleteness}% Complete
            </SheetTitle>
          </SheetHeader>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-2 text-center">
              <p className="text-[10px] text-emerald-700 font-medium">FULLY SIGNED</p>
              <p className="text-xl font-bold text-emerald-600">
                {filteredProjects.filter((p) => p.cpSigned && p.signedStatus === "SIGNED").length}
              </p>
            </div>
            <div className="bg-amber-50 rounded-lg border border-amber-200 p-2 text-center">
              <p className="text-[10px] text-amber-700 font-medium">PARTIAL</p>
              <p className="text-xl font-bold text-amber-600">
                {filteredProjects.filter((p) => (p.cpSigned || p.signedStatus !== "NONE") && !(p.cpSigned && p.signedStatus === "SIGNED")).length}
              </p>
            </div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-2 text-center">
              <p className="text-[10px] text-red-700 font-medium">UNSIGNED</p>
              <p className="text-xl font-bold text-red-600">
                {filteredProjects.filter((p) => !p.cpSigned && p.signedStatus === "NONE").length}
              </p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 px-1">CP = Cost Proposal signed · EPC = Contract status SIGNED</p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[65vh]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left py-2 px-3 font-medium">Project</th>
                  <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-center py-2 px-3 font-medium">CP Signed</th>
                  <th className="text-center py-2 px-3 font-medium">EPC Contract</th>
                  <th className="text-center py-2 px-3 font-medium">Status</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...filteredProjects]
                  .sort((a, b) => {
                    const aComplete = a.cpSigned && a.signedStatus === "SIGNED";
                    const bComplete = b.cpSigned && b.signedStatus === "SIGNED";
                    if (aComplete !== bComplete) return aComplete ? 1 : -1;
                    return (a.projectName || "").localeCompare(b.projectName || "");
                  })
                  .map((p) => {
                    const complete = p.cpSigned && p.signedStatus === "SIGNED";
                    const partial = (p.cpSigned || p.signedStatus !== "NONE") && !complete;
                    return (
                      <tr
                        key={p.projectId}
                        className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                        onClick={() => { openProject(p); setContractSheetOpen(false); }}
                      >
                        <td className="py-2 px-3 font-medium truncate max-w-[200px]">{p.projectName}</td>
                        <td className="py-2 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                        <td className="py-2 px-3 text-center">
                          {p.cpSigned
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                            : <XCircle className="w-4 h-4 text-red-400 mx-auto" />}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <Badge className={`text-[10px] ${p.signedStatus === "SIGNED" ? "bg-emerald-100 text-emerald-700" : p.signedStatus === "PENDING" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                            {p.signedStatus}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-center">
                          {complete
                            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Complete</Badge>
                            : partial
                              ? <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Partial</Badge>
                              : <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Unsigned</Badge>}
                        </td>
                        <td className="py-2 px-1 text-center">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                            <ArrowRight className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function KpiTile({
  label, value, valueClass, sub, icon, iconBg, cta, onClick,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub: string;
  icon: React.ReactNode;
  iconBg: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-border/60 p-5 hover:shadow-md hover:border-emerald-300 transition-all group"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide leading-tight">{label}</span>
      </div>
      <p className={`text-3xl font-bold tabular-nums ${valueClass || ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{sub}</p>
      <p className="text-[11px] font-medium text-emerald-600 mt-3 group-hover:underline">{cta} →</p>
    </button>
  );
}

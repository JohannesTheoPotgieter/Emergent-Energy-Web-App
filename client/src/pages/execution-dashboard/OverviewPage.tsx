import React, { useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCurrencyCompact, formatCurrencyFull } from "@/lib/execution-dashboard";
import {
  Activity, TrendingDown, DollarSign,
  ArrowRight, CheckCircle2, XCircle, Banknote, Clock,
  TrendingUp, AlertOctagon,
} from "lucide-react";
import { useExecutionData } from "./use-execution-data";

export default function OverviewPage() {
  const { kpis, filteredProjects, allProjects, openProject, dashboard } = useExecutionData();
  const [, setLocation] = useLocation();
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);
  const [contractSheetOpen, setContractSheetOpen] = useState(false);
  const [revenueSheetOpen, setRevenueSheetOpen] = useState(false);
  const [cosSheetOpen, setCosSheetOpen] = useState(false);

  const behindCount = kpis.projectsBehindPlan;               // server boolean — canonical
  const onScheduleCount = filteredProjects.length - behindCount; // always sums to total
  const fullySignedCount = filteredProjects.filter(
    (p) => p.cpSigned && p.signedStatus === "SIGNED",
  ).length;

  return (
    <div className="space-y-6">
      {/* 7 KPI tiles — 2 cols sm, 4 cols lg */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* 1 — Behind Schedule count */}
        <KpiTile
          label="Projects Behind Schedule"
          value={String(behindCount)}
          valueClass={behindCount === 0 ? "text-emerald-600" : behindCount <= 2 ? "text-amber-600" : "text-red-600"}
          sub={`${onScheduleCount} of ${filteredProjects.length} projects on track`}
          icon={<Clock className="w-5 h-5 text-red-600" />}
          iconBg="bg-red-100"
          cta="View all projects"
          onClick={() => setScheduleSheetOpen(true)}
        />

        {/* 2 — On Schedule Rate */}
        <KpiTile
          label="On Schedule Rate"
          value={`${kpis.onScheduleRate}%`}
          valueClass={kpis.onScheduleRate >= 70 ? "text-emerald-600" : kpis.onScheduleRate >= 50 ? "text-amber-600" : "text-red-600"}
          sub={`${onScheduleCount} of ${filteredProjects.length} projects not more than 5% behind expected`}
          icon={<Activity className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-100"
          cta="View schedule breakdown"
          onClick={() => setScheduleSheetOpen(true)}
        />

        {/* 3 — Contract Completeness */}
        <KpiTile
          label="Contract Completeness"
          value={`${kpis.contractCompleteness}%`}
          valueClass={kpis.contractCompleteness >= 80 ? "text-emerald-600" : kpis.contractCompleteness >= 50 ? "text-amber-600" : "text-red-600"}
          sub={`${fullySignedCount} of ${filteredProjects.length} projects CP + EPC signed`}
          icon={<CheckCircle2 className="w-5 h-5 text-blue-600" />}
          iconBg="bg-blue-100"
          cta="View contract status"
          onClick={() => setContractSheetOpen(true)}
        />

        {/* 4 — Revenue Outstanding This Month */}
        <KpiTile
          label="Rev Outstanding This Month"
          value={formatCurrencyCompact(dashboard?.kpis.revenueOutstandingThisMonth ?? 0)}
          valueClass="text-amber-600"
          sub="Revenue planned but not yet received this month · all active projects"
          icon={<DollarSign className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-100"
          cta="View by project"
          onClick={() => setRevenueSheetOpen(true)}
        />

        {/* 5 — COS Outstanding This Month */}
        <KpiTile
          label="COS Outstanding This Month"
          value={formatCurrencyCompact(dashboard?.kpis.cosOutstandingThisMonth ?? 0)}
          valueClass="text-orange-600"
          sub="Cost of sales planned but not yet paid this month · all active projects"
          icon={<TrendingDown className="w-5 h-5 text-orange-600" />}
          iconBg="bg-orange-100"
          cta="View by project"
          onClick={() => setCosSheetOpen(true)}
        />

        {/* 6 — Inflows This Week */}
        <KpiTile
          label="Revenue Inflows This Week"
          value={formatCurrencyCompact(dashboard?.kpis.projectInflowsThisWeek ?? 0)}
          valueClass="text-blue-600"
          sub="Cashflow revenue series expected Mon–Sun this week · all active projects"
          icon={<Banknote className="w-5 h-5 text-blue-600" />}
          iconBg="bg-blue-100"
          cta="Open cashflow register"
          onClick={() => setLocation("/cashflow")}
        />

        {/* 7 — Outflows This Week */}
        <KpiTile
          label="Expenditure Outflows This Week"
          value={formatCurrencyCompact(dashboard?.kpis.projectOutflowsThisWeek ?? 0)}
          valueClass="text-red-600"
          sub="Cashflow expenditure series expected Mon–Sun this week · all active projects"
          icon={<TrendingDown className="w-5 h-5 text-red-600" />}
          iconBg="bg-red-100"
          cta="Open cashflow register"
          onClick={() => setLocation("/cashflow")}
        />

        {/* 8 — Portfolio GP% */}
        <KpiTile
          label="Portfolio Gross Margin"
          value={kpis.grossMarginPctFy != null ? `${kpis.grossMarginPctFy}%` : "—"}
          valueClass={kpis.grossMarginPctFy == null ? "text-muted-foreground" : kpis.grossMarginPctFy >= 20 ? "text-emerald-600" : kpis.grossMarginPctFy >= 10 ? "text-amber-600" : "text-red-600"}
          sub={`GP ${formatCurrencyCompact(kpis.grossProfitFy)} on ${formatCurrencyCompact(kpis.plannedRevenueFy)} planned revenue · FY`}
          icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-100"
          cta="View finance breakdown"
          onClick={() => setRevenueSheetOpen(true)}
        />

        {/* 9 — Overdue Receivables */}
        <KpiTile
          label="Overdue Receivables"
          value={formatCurrencyCompact(kpis.overdueInflowFy ?? 0)}
          valueClass={(kpis.overdueInflowFy ?? 0) === 0 ? "text-emerald-600" : "text-red-600"}
          sub="Revenue milestones past planned date without confirmed payment · FY"
          icon={<AlertOctagon className="w-5 h-5 text-red-600" />}
          iconBg="bg-red-100"
          cta="View outstanding revenue"
          onClick={() => setRevenueSheetOpen(true)}
        />
      </div>

      {/* Revenue outstanding drill-down Sheet */}
      <Sheet open={revenueSheetOpen} onOpenChange={setRevenueSheetOpen}>
        <SheetContent className="sm:max-w-[860px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-amber-500" />
              Revenue &amp; Cashflow — By Project
            </SheetTitle>
          </SheetHeader>
          <p className="text-[11px] text-muted-foreground mt-2">
            Sorted by open revenue (largest first). Figures are for the current financial year across all active projects.
          </p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[72vh]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-right py-2.5 px-3 font-medium">Planned Rev</th>
                  <th className="text-right py-2.5 px-3 font-medium">Received</th>
                  <th className="text-right py-2.5 px-3 font-medium">Open</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...allProjects]
                  .sort((a, b) => (b.openInflowFy ?? 0) - (a.openInflowFy ?? 0))
                  .map((p) => (
                    <tr
                      key={p.projectId}
                      className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => { openProject(p, "revenue"); setRevenueSheetOpen(false); }}
                    >
                      <td className="py-2.5 px-3 font-medium truncate max-w-[180px]">{p.projectName}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{formatCurrencyCompact(p.plannedRevenueFy)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-emerald-600 font-semibold">{formatCurrencyCompact(p.receivedInflowFy)}</td>
                      <td className={`py-2.5 px-3 text-right tabular-nums font-bold ${p.openInflowFy > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {formatCurrencyCompact(p.openInflowFy)}
                      </td>
                      <td className="py-2.5 px-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                <tr className="text-[11px] font-semibold">
                  <td className="py-2 px-3" colSpan={2}>Total ({allProjects.length} projects)</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatCurrencyFull(allProjects.reduce((s, p) => s + p.plannedRevenueFy, 0))}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{formatCurrencyFull(allProjects.reduce((s, p) => s + p.receivedInflowFy, 0))}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-amber-600">{formatCurrencyFull(allProjects.reduce((s, p) => s + p.openInflowFy, 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SheetContent>
      </Sheet>

      {/* COS outstanding drill-down Sheet */}
      <Sheet open={cosSheetOpen} onOpenChange={setCosSheetOpen}>
        <SheetContent className="sm:max-w-[860px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-orange-500" />
              Cost of Sales &amp; Expenditure — By Project
            </SheetTitle>
          </SheetHeader>
          <p className="text-[11px] text-muted-foreground mt-2">
            Sorted by open expenditure (largest first). Figures are for the current financial year across all active projects.
          </p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[72vh]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-right py-2.5 px-3 font-medium">Planned COS</th>
                  <th className="text-right py-2.5 px-3 font-medium">Paid</th>
                  <th className="text-right py-2.5 px-3 font-medium">Open</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...allProjects]
                  .sort((a, b) => (b.openExpenditureFy ?? 0) - (a.openExpenditureFy ?? 0))
                  .map((p) => (
                    <tr
                      key={p.projectId}
                      className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => { openProject(p, "expenditure"); setCosSheetOpen(false); }}
                    >
                      <td className="py-2.5 px-3 font-medium truncate max-w-[180px]">{p.projectName}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{formatCurrencyCompact(p.plannedExpenditureFy)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-emerald-600 font-semibold">{formatCurrencyCompact(p.paidExpenditureFy)}</td>
                      <td className={`py-2.5 px-3 text-right tabular-nums font-bold ${p.openExpenditureFy > 0 ? "text-orange-600" : "text-emerald-600"}`}>
                        {formatCurrencyCompact(p.openExpenditureFy)}
                      </td>
                      <td className="py-2.5 px-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                <tr className="text-[11px] font-semibold">
                  <td className="py-2 px-3" colSpan={2}>Total ({allProjects.length} projects)</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatCurrencyFull(allProjects.reduce((s, p) => s + p.plannedExpenditureFy, 0))}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{formatCurrencyFull(allProjects.reduce((s, p) => s + p.paidExpenditureFy, 0))}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-orange-600">{formatCurrencyFull(allProjects.reduce((s, p) => s + p.openExpenditureFy, 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SheetContent>
      </Sheet>

      {/* All Projects / Schedule drill-down Sheet */}
      <Sheet open={scheduleSheetOpen} onOpenChange={setScheduleSheetOpen}>
        <SheetContent className="sm:max-w-[900px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-red-500" />
              All Projects — Schedule Status
            </SheetTitle>
          </SheetHeader>

          {/* Summary strip */}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-slate-50 rounded-lg border p-2 text-center">
              <p className="text-[10px] text-muted-foreground font-medium">TOTAL</p>
              <p className="text-xl font-bold">{filteredProjects.length}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-2 text-center">
              <p className="text-[10px] text-emerald-700 font-medium">ON SCHEDULE</p>
              <p className="text-xl font-bold text-emerald-600">{onScheduleCount}</p>
            </div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-2 text-center">
              <p className="text-[10px] text-red-700 font-medium">BEHIND</p>
              <p className="text-xl font-bold text-red-600">{behindCount}</p>
            </div>
            <div className="bg-blue-50 rounded-lg border border-blue-200 p-2 text-center">
              <p className="text-[10px] text-blue-700 font-medium">ON SCHEDULE RATE</p>
              <p className="text-xl font-bold text-blue-600">{kpis.onScheduleRate}%</p>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground mt-2 px-0.5">
            "Behind" = actual progress more than 5 pp below expected. Sorted worst variance first.
          </p>

          <div className="mt-3 border rounded-lg overflow-auto max-h-[65vh]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden md:table-cell">PM</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden lg:table-cell">Phase</th>
                  <th className="text-center py-2.5 px-3 font-medium hidden sm:table-cell">RAG</th>
                  <th className="text-right py-2.5 px-3 font-medium">Actual %</th>
                  <th className="text-right py-2.5 px-3 font-medium">Expected %</th>
                  <th className="text-right py-2.5 px-3 font-medium">Variance</th>
                  <th className="text-center py-2.5 px-3 font-medium">Status</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...filteredProjects]
                  .sort((a, b) => ((a.scheduleVariancePct ?? 0) - (b.scheduleVariancePct ?? 0)))
                  .map((p) => {
                    const onSchedule = !p.behindPlan; // same source as tile values
                    const variance = p.scheduleVariancePct ?? 0;
                    return (
                      <tr
                        key={p.projectId}
                        className={`border-t border-border/40 hover:bg-muted/30 cursor-pointer ${!onSchedule ? "bg-red-50/30" : ""}`}
                        onClick={() => { openProject(p, "plan"); setScheduleSheetOpen(false); }}
                      >
                        <td className="py-2.5 px-3 font-medium truncate max-w-[180px]">{p.projectName}</td>
                        <td className="py-2.5 px-3 text-xs text-muted-foreground hidden md:table-cell">{p.pm || "—"}</td>
                        <td className="py-2.5 px-3 text-xs text-muted-foreground hidden lg:table-cell">{p.executionPhase || "—"}</td>
                        <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${p.rag === "Green" ? "bg-emerald-500" : p.rag === "Amber" ? "bg-amber-500" : p.rag === "Red" ? "bg-red-500" : "bg-gray-300"}`} title={p.rag || "Not set"} />
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                          {p.actualProgressPct != null ? `${p.actualProgressPct}%` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                          {p.expectedProgressPct != null ? `${p.expectedProgressPct}%` : "—"}
                        </td>
                        <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${variance < -5 ? "text-red-600" : variance < 0 ? "text-amber-600" : variance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                          {p.scheduleVariancePct != null ? `${variance > 0 ? "+" : ""}${variance}%` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {onSchedule
                            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">On Schedule</Badge>
                            : <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Behind Plan</Badge>}
                        </td>
                        <td className="py-2.5 px-1 text-center">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
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
              Contract Completeness — {kpis.contractCompleteness}%
            </SheetTitle>
          </SheetHeader>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-2 text-center">
              <p className="text-[10px] text-emerald-700 font-medium">FULLY SIGNED</p>
              <p className="text-xl font-bold text-emerald-600">{fullySignedCount}</p>
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
          <p className="text-[10px] text-muted-foreground mt-2 px-0.5">CP = Cost Proposal signed · EPC = Contract status SIGNED</p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[65vh]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-center py-2.5 px-3 font-medium">CP Signed</th>
                  <th className="text-center py-2.5 px-3 font-medium">EPC Contract</th>
                  <th className="text-center py-2.5 px-3 font-medium">Status</th>
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
                        <td className="py-2.5 px-3 font-medium truncate max-w-[200px]">{p.projectName}</td>
                        <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                        <td className="py-2.5 px-3 text-center">
                          {p.cpSigned
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                            : <XCircle className="w-4 h-4 text-red-400 mx-auto" />}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <Badge className={`text-[10px] ${p.signedStatus === "SIGNED" ? "bg-emerald-100 text-emerald-700" : p.signedStatus === "PENDING" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                            {p.signedStatus}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {complete
                            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Complete</Badge>
                            : partial
                              ? <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Partial</Badge>
                              : <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Unsigned</Badge>}
                        </td>
                        <td className="py-2.5 px-1 text-center">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
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

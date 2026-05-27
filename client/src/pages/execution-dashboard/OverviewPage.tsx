import React, { useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatZar, formatZarCompact } from "@/lib/currency";
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
  const [inflowSheetOpen, setInflowSheetOpen] = useState(false);
  const [outflowSheetOpen, setOutflowSheetOpen] = useState(false);
  const [overdueArSheetOpen, setOverdueArSheetOpen] = useState(false);
  const [overdueApSheetOpen, setOverdueApSheetOpen] = useState(false);

  const scheduleMeasuredProjects = filteredProjects.filter(
    (p) => p.actualProgressPct != null && p.expectedProgressPct != null,
  );
  const scheduleDataMissingCount = filteredProjects.length - scheduleMeasuredProjects.length;
  const scheduleDataSuffix =
    scheduleDataMissingCount > 0 ? `; ${scheduleDataMissingCount} missing schedule data` : "";
  const behindCount = scheduleMeasuredProjects.filter((p) => p.behindPlan).length;
  const onScheduleCount = scheduleMeasuredProjects.length - behindCount;
  const fullySignedCount = filteredProjects.filter(
    (p) => p.cpSigned && p.signedStatus === "SIGNED",
  ).length;

  // Wave-7 UX audit (2026-05-26): the dashboard had 10 KPI tiles
  // above the fold — exceeded the ≤6 target by ~2x. Split into:
  //   • Operational health (5) — always visible, the "is delivery on
  //     track right now?" answer.
  //   • Cash & receivables (5) — collapsed by default, expand for FY
  //     finance detail. Surfaces the total overdue in the header so
  //     even when collapsed the user sees if there's anything red.
  // Persist the open state in localStorage so the COO's preference
  // sticks across reloads.
  const [cashOpen, setCashOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("exec-dash-cash-open") === "1"; } catch { return false; }
  });
  const setCashOpenPersist = (next: boolean) => {
    setCashOpen(next);
    try { localStorage.setItem("exec-dash-cash-open", next ? "1" : "0"); } catch { /* ignore */ }
  };
  const totalOverdue = (kpis.overdueInflowFy ?? 0) + (kpis.overdueOutflowFy ?? 0);

  return (
    <div className="space-y-6">
      {/* Operational health — 5 KPI tiles always visible */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

        {/* 1 — Behind Schedule count */}
        <KpiTile
          label="Projects Behind Schedule"
          value={String(behindCount)}
          valueClass={behindCount === 0 ? "text-emerald-600" : behindCount <= 2 ? "text-amber-600" : "text-red-600"}
          sub={`${onScheduleCount} of ${scheduleMeasuredProjects.length} measured projects on track${scheduleDataSuffix}`}
          icon={<Clock className="w-5 h-5" />}
          cta="View all projects"
          onClick={() => setScheduleSheetOpen(true)}
        />

        {/* 2 — On Schedule Rate */}
        <KpiTile
          label="On Schedule Rate"
          value={`${kpis.onScheduleRate}%`}
          valueClass={kpis.onScheduleRate >= 70 ? "text-emerald-600" : kpis.onScheduleRate >= 50 ? "text-amber-600" : "text-red-600"}
          sub={`${onScheduleCount} of ${scheduleMeasuredProjects.length} measured projects not more than 5% behind expected${scheduleDataSuffix}`}
          icon={<Activity className="w-5 h-5" />}
          cta="View schedule breakdown"
          onClick={() => setScheduleSheetOpen(true)}
        />

        {/* 3 — Contract Completeness */}
        <KpiTile
          label="Contract Completeness"
          value={`${kpis.contractCompleteness}%`}
          valueClass={kpis.contractCompleteness >= 80 ? "text-emerald-600" : kpis.contractCompleteness >= 50 ? "text-amber-600" : "text-red-600"}
          sub={`${fullySignedCount} of ${filteredProjects.length} projects CP + EPC signed`}
          icon={<CheckCircle2 className="w-5 h-5" />}
          cta="View contract status"
          onClick={() => setContractSheetOpen(true)}
        />

        {/* 4 — Revenue Outstanding This Month */}
        <KpiTile
          label="Rev Outstanding This Month"
          value={formatZarCompact(dashboard?.kpis.revenueOutstandingThisMonth ?? 0)}
          title={formatZar(dashboard?.kpis.revenueOutstandingThisMonth ?? 0)}
          valueClass="text-amber-600"
          sub="Revenue due to be realised this month, still outstanding · all active projects"
          icon={<DollarSign className="w-5 h-5" />}
          cta="View by project"
          onClick={() => setRevenueSheetOpen(true)}
        />

        {/* 5 — COS Outstanding This Month */}
        <KpiTile
          label="COS Outstanding This Month"
          value={formatZarCompact(dashboard?.kpis.cosOutstandingThisMonth ?? 0)}
          title={formatZar(dashboard?.kpis.cosOutstandingThisMonth ?? 0)}
          valueClass="text-amber-600"
          sub="COS due to be realised this month, still outstanding · all active projects"
          icon={<TrendingDown className="w-5 h-5" />}
          cta="View by project"
          onClick={() => setCosSheetOpen(true)}
        />

      </div>

      {/* Cash & receivables — collapsed by default. Header shows
          totalOverdue so the COO sees if anything is red without
          expanding. */}
      <div className="border border-border rounded-md">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/50"
          onClick={() => setCashOpenPersist(!cashOpen)}
          aria-expanded={cashOpen}
        >
          <span className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-muted-foreground" />
            Cash &amp; Receivables (FY)
            {totalOverdue > 0 && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px] ml-2">
                {formatZarCompact(totalOverdue)} overdue
              </Badge>
            )}
          </span>
          <span className="text-xs text-muted-foreground">{cashOpen ? "Hide" : "Show"}</span>
        </button>
        {cashOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 p-4 border-t">

            {/* 6 — Inflows This Week */}
            <KpiTile
              label="Revenue Inflows This Week"
              value={formatZarCompact(dashboard?.kpis.projectInflowsThisWeek ?? 0)}
              title={formatZar(dashboard?.kpis.projectInflowsThisWeek ?? 0)}
              sub="Revenue payments received Mon–Sun this week · all active projects"
              icon={<Banknote className="w-5 h-5" />}
              cta="View by project"
              onClick={() => setInflowSheetOpen(true)}
            />

            {/* 7 — Outflows This Week */}
            <KpiTile
              label="Expenditure Outflows This Week"
              value={formatZarCompact(dashboard?.kpis.projectOutflowsThisWeek ?? 0)}
              title={formatZar(dashboard?.kpis.projectOutflowsThisWeek ?? 0)}
              sub="Expenditure payments made Mon–Sun this week · all active projects"
              icon={<TrendingDown className="w-5 h-5" />}
              cta="View by project"
              onClick={() => setOutflowSheetOpen(true)}
            />

            {/* 8 — Portfolio GP% */}
            <KpiTile
              label="Portfolio Gross Margin"
              value={kpis.grossMarginPctFy != null ? `${kpis.grossMarginPctFy}%` : "—"}
              valueClass={kpis.grossMarginPctFy == null ? "text-muted-foreground" : kpis.grossMarginPctFy >= 20 ? "text-emerald-600" : kpis.grossMarginPctFy >= 10 ? "text-amber-600" : "text-red-600"}
              sub={`GP ${formatZarCompact(kpis.grossProfitFy)} on ${formatZarCompact(kpis.plannedRevenueFy)} planned revenue · FY`}
              icon={<TrendingUp className="w-5 h-5" />}
              cta="View finance breakdown"
              onClick={() => setLocation("/execution-dashboard/finance")}
            />

            {/* 9 — Overdue Receivables */}
            <KpiTile
              label="Overdue Receivables"
              value={formatZarCompact(kpis.overdueInflowFy ?? 0)}
              title={formatZar(kpis.overdueInflowFy ?? 0)}
              valueClass={(kpis.overdueInflowFy ?? 0) === 0 ? "text-emerald-600" : "text-red-600"}
              sub="Revenue milestones past planned date without confirmed payment · FY"
              icon={<AlertOctagon className="w-5 h-5" />}
              cta="View by project"
              onClick={() => setOverdueArSheetOpen(true)}
            />

            {/* 10 — Overdue Payables */}
            <KpiTile
              label="Overdue Payables"
              value={formatZarCompact(kpis.overdueOutflowFy ?? 0)}
              title={formatZar(kpis.overdueOutflowFy ?? 0)}
              valueClass={(kpis.overdueOutflowFy ?? 0) === 0 ? "text-emerald-600" : "text-red-600"}
              sub="Supplier invoices past planned payment date without confirmed payment · FY"
              icon={<AlertOctagon className="w-5 h-5" />}
              cta="View by project"
              onClick={() => setOverdueApSheetOpen(true)}
            />
          </div>
        )}
      </div>

      {/* Rev Outstanding This Month drill-down */}
      <Sheet open={revenueSheetOpen} onOpenChange={setRevenueSheetOpen}>
        <SheetContent className="sm:max-w-[860px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-amber-500" />
              Rev Outstanding This Month — By Project
            </SheetTitle>
          </SheetHeader>
          <p className="text-[11px] text-muted-foreground mt-2">
            Revenue lines with an invoice date in the current month. Realised = invoice number raised
            with a confirmed (black) invoice date. Sorted by open (largest first).
          </p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[72vh]" data-testid="sheet-rev-outstanding-month">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-right py-2.5 px-3 font-medium">Planned Rev (Month)</th>
                  <th className="text-right py-2.5 px-3 font-medium">Realised (Month)</th>
                  <th className="text-right py-2.5 px-3 font-medium">Open (Month)</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...allProjects]
                  .filter((p) => (p.plannedRevenueMonth ?? 0) > 0 || (p.openRevenueMonth ?? 0) !== 0)
                  .sort((a, b) => (b.openRevenueMonth ?? 0) - (a.openRevenueMonth ?? 0))
                  .map((p) => (
                    <tr
                      key={p.projectId}
                      data-testid={`row-rev-month-${p.projectId}`}
                      className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => { openProject(p, "revenue"); setRevenueSheetOpen(false); }}
                    >
                      <td className="py-2.5 px-3 font-medium truncate max-w-[180px]">{p.projectName}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{formatZarCompact(p.plannedRevenueMonth ?? 0)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-emerald-600 font-semibold">{formatZarCompact(p.realisedRevenueMonth ?? 0)}</td>
                      <td className={`py-2.5 px-3 text-right tabular-nums font-bold ${(p.openRevenueMonth ?? 0) > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {formatZarCompact(p.openRevenueMonth ?? 0)}
                      </td>
                      <td className="py-2.5 px-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                {allProjects.every((p) => (p.plannedRevenueMonth ?? 0) === 0 && (p.openRevenueMonth ?? 0) === 0) && (
                  <tr><td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">No revenue invoice-dated this month.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                <tr className="text-[11px] font-semibold">
                  <td className="py-2 px-3" colSpan={2}>Total · all active projects</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatZar(allProjects.reduce((s, p) => s + (p.plannedRevenueMonth ?? 0), 0))}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{formatZar(allProjects.reduce((s, p) => s + (p.realisedRevenueMonth ?? 0), 0))}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-amber-600" data-testid="text-rev-outstanding-month-total">{formatZar(allProjects.reduce((s, p) => s + (p.openRevenueMonth ?? 0), 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SheetContent>
      </Sheet>

      {/* COS Outstanding This Month drill-down */}
      <Sheet open={cosSheetOpen} onOpenChange={setCosSheetOpen}>
        <SheetContent className="sm:max-w-[860px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-orange-500" />
              COS Outstanding This Month — By Project
            </SheetTitle>
          </SheetHeader>
          <p className="text-[11px] text-muted-foreground mt-2">
            Cost lines with an invoice date in the current month. Realised = invoice number raised
            with a confirmed (black) invoice date. Sorted by open (largest first).
          </p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[72vh]" data-testid="sheet-cos-outstanding-month">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-right py-2.5 px-3 font-medium">Planned COS (Month)</th>
                  <th className="text-right py-2.5 px-3 font-medium">Realised (Month)</th>
                  <th className="text-right py-2.5 px-3 font-medium">Open (Month)</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...allProjects]
                  .filter((p) => (p.plannedCosMonth ?? 0) > 0 || (p.openCosMonth ?? 0) !== 0)
                  .sort((a, b) => (b.openCosMonth ?? 0) - (a.openCosMonth ?? 0))
                  .map((p) => (
                    <tr
                      key={p.projectId}
                      data-testid={`row-cos-month-${p.projectId}`}
                      className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => { openProject(p, "expenditure"); setCosSheetOpen(false); }}
                    >
                      <td className="py-2.5 px-3 font-medium truncate max-w-[180px]">{p.projectName}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{formatZarCompact(p.plannedCosMonth ?? 0)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-emerald-600 font-semibold">{formatZarCompact(p.realisedCosMonth ?? 0)}</td>
                      <td className={`py-2.5 px-3 text-right tabular-nums font-bold ${(p.openCosMonth ?? 0) > 0 ? "text-orange-600" : "text-emerald-600"}`}>
                        {formatZarCompact(p.openCosMonth ?? 0)}
                      </td>
                      <td className="py-2.5 px-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                {allProjects.every((p) => (p.plannedCosMonth ?? 0) === 0 && (p.openCosMonth ?? 0) === 0) && (
                  <tr><td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">No cost invoice-dated this month.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                <tr className="text-[11px] font-semibold">
                  <td className="py-2 px-3" colSpan={2}>Total · all active projects</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatZar(allProjects.reduce((s, p) => s + (p.plannedCosMonth ?? 0), 0))}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{formatZar(allProjects.reduce((s, p) => s + (p.realisedCosMonth ?? 0), 0))}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-orange-600" data-testid="text-cos-outstanding-month-total">{formatZar(allProjects.reduce((s, p) => s + (p.openCosMonth ?? 0), 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SheetContent>
      </Sheet>

      {/* Revenue Inflows This Week drill-down */}
      <Sheet open={inflowSheetOpen} onOpenChange={setInflowSheetOpen}>
        <SheetContent className="sm:max-w-[760px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-emerald-500" />
              Revenue Inflows This Week — By Project
            </SheetTitle>
          </SheetHeader>
          <p className="text-[11px] text-muted-foreground mt-2">
            Revenue lines with a payment date Mon–Sun this week, regardless of confirmation. Sorted largest first.
          </p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[72vh]" data-testid="sheet-inflows-week">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-right py-2.5 px-3 font-medium">Received This Week</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...allProjects]
                  .filter((p) => (p.inflowsWeek ?? 0) > 0)
                  .sort((a, b) => (b.inflowsWeek ?? 0) - (a.inflowsWeek ?? 0))
                  .map((p) => (
                    <tr
                      key={p.projectId}
                      data-testid={`row-inflow-week-${p.projectId}`}
                      className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => { openProject(p, "revenue"); setInflowSheetOpen(false); }}
                    >
                      <td className="py-2.5 px-3 font-medium truncate max-w-[220px]">{p.projectName}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-600">
                        {formatZarCompact(p.inflowsWeek ?? 0)}
                      </td>
                      <td className="py-2.5 px-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                {allProjects.every((p) => (p.inflowsWeek ?? 0) === 0) && (
                  <tr><td colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No revenue payments dated this week.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                <tr className="text-[11px] font-semibold">
                  <td className="py-2 px-3" colSpan={2}>Total · all active projects</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-600" data-testid="text-inflows-week-total">
                    {formatZar(allProjects.reduce((s, p) => s + (p.inflowsWeek ?? 0), 0))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => { setInflowSheetOpen(false); setLocation("/cashflow"); }}>
              Open full cashflow register →
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Expenditure Outflows This Week drill-down */}
      <Sheet open={outflowSheetOpen} onOpenChange={setOutflowSheetOpen}>
        <SheetContent className="sm:max-w-[760px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-orange-500" />
              Expenditure Outflows This Week — By Project
            </SheetTitle>
          </SheetHeader>
          <p className="text-[11px] text-muted-foreground mt-2">
            Cost lines with a payment date Mon–Sun this week, regardless of confirmation. Sorted largest first.
          </p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[72vh]" data-testid="sheet-outflows-week">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-right py-2.5 px-3 font-medium">Paid This Week</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...allProjects]
                  .filter((p) => (p.outflowsWeek ?? 0) > 0)
                  .sort((a, b) => (b.outflowsWeek ?? 0) - (a.outflowsWeek ?? 0))
                  .map((p) => (
                    <tr
                      key={p.projectId}
                      data-testid={`row-outflow-week-${p.projectId}`}
                      className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => { openProject(p, "expenditure"); setOutflowSheetOpen(false); }}
                    >
                      <td className="py-2.5 px-3 font-medium truncate max-w-[220px]">{p.projectName}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-bold text-orange-600">
                        {formatZarCompact(p.outflowsWeek ?? 0)}
                      </td>
                      <td className="py-2.5 px-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                {allProjects.every((p) => (p.outflowsWeek ?? 0) === 0) && (
                  <tr><td colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No cost payments dated this week.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                <tr className="text-[11px] font-semibold">
                  <td className="py-2 px-3" colSpan={2}>Total · all active projects</td>
                  <td className="py-2 px-3 text-right tabular-nums text-orange-600" data-testid="text-outflows-week-total">
                    {formatZar(allProjects.reduce((s, p) => s + (p.outflowsWeek ?? 0), 0))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => { setOutflowSheetOpen(false); setLocation("/cashflow"); }}>
              Open full cashflow register →
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Overdue Receivables drill-down */}
      <Sheet open={overdueArSheetOpen} onOpenChange={setOverdueArSheetOpen}>
        <SheetContent className="sm:max-w-[760px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <AlertOctagon className="w-5 h-5 text-red-500" />
              Overdue Receivables — By Project
            </SheetTitle>
          </SheetHeader>
          <p className="text-[11px] text-muted-foreground mt-2">
            Revenue milestones whose planned payment date has passed without a confirmed receipt.
            Same logic as the Revenue tab on the project detail page. Sorted largest first.
          </p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[72vh]" data-testid="sheet-overdue-ar">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-right py-2.5 px-3 font-medium">Overdue</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...allProjects]
                  .filter((p) => (p.overdueInflowFy ?? 0) > 0)
                  .sort((a, b) => (b.overdueInflowFy ?? 0) - (a.overdueInflowFy ?? 0))
                  .map((p) => (
                    <tr
                      key={p.projectId}
                      data-testid={`row-overdue-ar-${p.projectId}`}
                      className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => { openProject(p, "revenue"); setOverdueArSheetOpen(false); }}
                    >
                      <td className="py-2.5 px-3 font-medium truncate max-w-[220px]">{p.projectName}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-bold text-red-600">
                        {formatZarCompact(p.overdueInflowFy ?? 0)}
                      </td>
                      <td className="py-2.5 px-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                {allProjects.every((p) => (p.overdueInflowFy ?? 0) === 0) && (
                  <tr><td colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No overdue receivables.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                <tr className="text-[11px] font-semibold">
                  <td className="py-2 px-3" colSpan={2}>Total · all active projects</td>
                  <td className="py-2 px-3 text-right tabular-nums text-red-600" data-testid="text-overdue-ar-total">
                    {formatZar(allProjects.reduce((s, p) => s + (p.overdueInflowFy ?? 0), 0))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SheetContent>
      </Sheet>

      {/* Overdue Payables drill-down */}
      <Sheet open={overdueApSheetOpen} onOpenChange={setOverdueApSheetOpen}>
        <SheetContent className="sm:max-w-[760px] w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <AlertOctagon className="w-5 h-5 text-red-500" />
              Overdue Payables — By Project
            </SheetTitle>
          </SheetHeader>
          <p className="text-[11px] text-muted-foreground mt-2">
            Supplier invoices whose planned payment date has passed without a confirmed payment.
            Same logic as "Show overdue supplier" on the project detail Expenditure tab. Sorted largest first.
          </p>
          <div className="mt-3 border rounded-lg overflow-auto max-h-[72vh]" data-testid="sheet-overdue-ap">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">PM</th>
                  <th className="text-right py-2.5 px-3 font-medium">Overdue</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {[...allProjects]
                  .filter((p) => (p.overdueOutflowFy ?? 0) > 0)
                  .sort((a, b) => (b.overdueOutflowFy ?? 0) - (a.overdueOutflowFy ?? 0))
                  .map((p) => (
                    <tr
                      key={p.projectId}
                      data-testid={`row-overdue-ap-${p.projectId}`}
                      className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => { openProject(p, "expenditure"); setOverdueApSheetOpen(false); }}
                    >
                      <td className="py-2.5 px-3 font-medium truncate max-w-[220px]">{p.projectName}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-bold text-red-600">
                        {formatZarCompact(p.overdueOutflowFy ?? 0)}
                      </td>
                      <td className="py-2.5 px-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                {allProjects.every((p) => (p.overdueOutflowFy ?? 0) === 0) && (
                  <tr><td colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No overdue payables.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                <tr className="text-[11px] font-semibold">
                  <td className="py-2 px-3" colSpan={2}>Total · all active projects</td>
                  <td className="py-2 px-3 text-right tabular-nums text-red-600" data-testid="text-overdue-ap-total">
                    {formatZar(allProjects.reduce((s, p) => s + (p.overdueOutflowFy ?? 0), 0))}
                  </td>
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
            <div className="bg-primary/5 rounded-lg border border-primary/20 p-2 text-center">
              <p className="text-[10px] text-primary font-medium">ON SCHEDULE RATE</p>
              <p className="text-xl font-bold text-primary">{kpis.onScheduleRate}%</p>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground mt-2 px-0.5">
            "Behind" = actual progress more than 5 pp below expected. Missing schedule data is excluded from the on-schedule rate. Sorted worst variance first.
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
                  .sort((a, b) => {
                    const aHasScheduleData = a.actualProgressPct != null && a.expectedProgressPct != null;
                    const bHasScheduleData = b.actualProgressPct != null && b.expectedProgressPct != null;
                    if (aHasScheduleData !== bHasScheduleData) return aHasScheduleData ? -1 : 1;
                    return (a.scheduleVariancePct ?? 0) - (b.scheduleVariancePct ?? 0);
                  })
                  .map((p) => {
                    const hasScheduleData = p.actualProgressPct != null && p.expectedProgressPct != null;
                    const onSchedule = hasScheduleData && !p.behindPlan; // same source as tile values
                    const variance = p.scheduleVariancePct ?? 0;
                    return (
                      <tr
                        key={p.projectId}
                        className={`border-t border-border/40 hover:bg-muted/30 cursor-pointer ${hasScheduleData && !onSchedule ? "bg-red-50/30" : !hasScheduleData ? "bg-slate-50/40" : ""}`}
                        onClick={() => { openProject(p, "plan"); setScheduleSheetOpen(false); }}
                      >
                        <td className="py-2.5 px-3 font-medium truncate max-w-[180px]">{p.projectName}</td>
                        <td className="py-2.5 px-3 text-xs text-muted-foreground hidden md:table-cell">{p.pm || "—"}</td>
                        <td className="py-2.5 px-3 text-xs text-muted-foreground hidden lg:table-cell">{p.executionPhase || "—"}</td>
                        <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                          <span
                            role="img"
                            aria-label={`RAG: ${p.rag || "Not set"}`}
                            title={p.rag || "Not set"}
                            className={`inline-block w-2.5 h-2.5 rounded-full ${p.rag === "Green" ? "bg-emerald-500" : p.rag === "Amber" ? "bg-amber-500" : p.rag === "Red" ? "bg-red-500" : "bg-gray-300"}`}
                          />
                          <span className="sr-only">{p.rag || "Not set"}</span>
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
                          {!hasScheduleData
                            ? <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-[10px] whitespace-nowrap">No Schedule Data</Badge>
                            : onSchedule
                              ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] whitespace-nowrap">On Schedule</Badge>
                              : <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px] whitespace-nowrap">Behind Plan</Badge>}
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
  label, value, valueClass, sub, icon, cta, onClick, title,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub: string;
  icon: React.ReactNode;
  cta: string;
  onClick: () => void;
  /** X2 — exact figure tooltip for compact currency values. */
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-card rounded-lg border border-border p-5 shadow-sm hover:shadow-md hover:border-primary/40 transition-all group"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-primary/8 text-primary flex items-center justify-center shrink-0">
          {icon}
        </div>
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide leading-tight">{label}</span>
      </div>
      <p className={`text-3xl font-bold tabular-nums ${valueClass || "text-foreground"}`} title={title}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{sub}</p>
      <p className="text-[11px] font-medium text-primary mt-3 group-hover:underline">{cta} →</p>
    </button>
  );
}

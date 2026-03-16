import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase, Plus, FolderOpen, TrendingUp, TrendingDown, AlertTriangle,
  Users, Zap, DollarSign, ShieldCheck, Search, ChevronRight, ChevronDown, Wrench,
  CheckCircle2, Clock, XCircle, BarChart3, Activity, Receipt, Percent,
  ArrowUpRight, ArrowDownRight, Layers, Target,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  RadialBarChart, RadialBar,
} from "recharts";

type ViewMode = "management" | "finance" | "quality" | "engineering";

const PHASE_COLORS: Record<string, string> = {
  Construction: "#4472C4",
  QA: "#ED7D31",
  "Quality Assurance": "#ED7D31",
  Commissioning: "#FFC000",
  Handover: "#70AD47",
  "Compliance Handover": "#5B9BD5",
  "Commercial Close Out": "#A5A5A5",
  DLP: "#9B59B6",
  "Financial Close": "#2ECC71",
  Planning: "#1ABC9C",
  TBC: "#BDC3C7",
  Hold: "#E74C3C",
};
const PIE_COLORS = ["#4472C4", "#ED7D31", "#FFC000", "#70AD47", "#5B9BD5", "#9B59B6", "#2ECC71", "#E74C3C", "#1ABC9C", "#A5A5A5"];

function formatCurrency(v: number) {
  if (Math.abs(v) >= 1e6) return `R ${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `R ${(v / 1e3).toFixed(0)}K`;
  return `R ${v.toFixed(0)}`;
}

function healthColor(h: string) {
  if (h === "At Risk") return "bg-red-100 text-red-700 border-red-200";
  if (h === "Behind") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-emerald-100 text-emerald-700 border-emerald-200";
}

function shortName(name: string) {
  return (name || "").replace(/_Tracker$/i, "").replace(/_/g, " ").slice(0, 18);
}

function KpiCard({ icon: Icon, label, value, color, bgClass, testId }: { icon: any; label: string; value: string; color: string; bgClass: string; testId: string }) {
  return (
    <Card className={`border-0 shadow-sm ${bgClass}`}>
      <CardContent className="p-3.5">
        <div className="flex items-center gap-2.5">
          <div className={`rounded-lg p-1.5 ${color === 'text-emerald-700' ? 'bg-emerald-200/60' : color === 'text-blue-700' ? 'bg-blue-200/60' : color === 'text-orange-700' ? 'bg-orange-200/60' : color === 'text-red-700' ? 'bg-red-200/60' : color === 'text-violet-700' ? 'bg-violet-200/60' : 'bg-gray-200/60'}`}>
            <Icon className={`h-4 w-4 ${color}`} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</div>
            <div className={`text-lg font-bold mt-0.5 leading-tight ${color}`} data-testid={testId}>{value}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FinanceCharts({ portfolio }: { portfolio: any }) {
  const breakdown = portfolio.projectFinanceBreakdown || [];
  if (breakdown.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        No financial data available for this portfolio's projects.
      </div>
    );
  }

  const revenueData = breakdown.filter((p: any) => p.costedRevenue > 0 || p.actualRevenue > 0).map((p: any) => ({
    name: shortName(p.projectName),
    Costed: Math.round(p.costedRevenue / 1000),
    Actual: Math.round(p.actualRevenue / 1000),
  }));

  const expenseData = breakdown.filter((p: any) => p.costedExpenses > 0 || p.actualExpenses > 0).map((p: any) => ({
    name: shortName(p.projectName),
    Costed: Math.round(p.costedExpenses / 1000),
    Actual: Math.round(p.actualExpenses / 1000),
  }));

  const gpData = breakdown.filter((p: any) => p.grossProfit !== 0 || p.costedRevenue > 0).map((p: any) => ({
    name: shortName(p.projectName),
    GP: Math.round(p.grossProfit / 1000),
  }));

  const fin = portfolio.finance || {};
  const gp = (fin.actualRevenue || 0) - (fin.actualExpenses || 0);
  const gpMargin = (fin.actualRevenue || 0) > 0 ? (gp / (fin.actualRevenue || 1)) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={DollarSign} label="Costed Revenue" value={formatCurrency(fin.costedRevenue || 0)} color="text-emerald-700" bgClass="bg-emerald-50/80" testId="text-fin-costed-revenue" />
        <KpiCard icon={ArrowUpRight} label="Actual Revenue" value={formatCurrency(fin.actualRevenue || 0)} color="text-blue-700" bgClass="bg-blue-50/80" testId="text-fin-actual-revenue" />
        <KpiCard icon={Receipt} label="Costed Expenses" value={formatCurrency(fin.costedExpenses || 0)} color="text-orange-700" bgClass="bg-orange-50/80" testId="text-fin-costed-expenses" />
        <KpiCard icon={ArrowDownRight} label="Actual Expenses" value={formatCurrency(fin.actualExpenses || 0)} color="text-red-700" bgClass="bg-red-50/80" testId="text-fin-actual-expenses" />
        <KpiCard icon={TrendingUp} label="Gross Profit" value={formatCurrency(gp)} color={gp >= 0 ? "text-emerald-700" : "text-red-700"} bgClass={gp >= 0 ? "bg-emerald-50/80" : "bg-red-50/80"} testId="text-fin-gross-profit" />
        <KpiCard icon={Percent} label="GP Margin" value={`${gpMargin.toFixed(1)}%`} color={gpMargin >= 0 ? "text-violet-700" : "text-red-700"} bgClass={gpMargin >= 0 ? "bg-violet-50/80" : "bg-red-50/80"} testId="text-fin-gp-margin" />
      </div>

      {revenueData.length > 0 && (
        <Card className="shadow-sm" data-testid="chart-revenue-costed-vs-actual">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-muted-foreground">Revenue: Costed vs Actual (R'000)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={Math.max(160, revenueData.length * 32)}>
              <BarChart data={revenueData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `R ${v}K`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={100} />
                <Tooltip formatter={(v: number) => [`R ${v.toLocaleString()}K`, ""]} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="Costed" fill="#93c5fd" radius={[0, 4, 4, 0]} barSize={12} name="Costed Revenue" />
                <Bar dataKey="Actual" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={12} name="Actual Revenue" />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {expenseData.length > 0 && (
        <Card className="shadow-sm" data-testid="chart-expenses-costed-vs-actual">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-muted-foreground">Expenses: Costed vs Actual (R'000)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={Math.max(160, expenseData.length * 32)}>
              <BarChart data={expenseData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `R ${v}K`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={100} />
                <Tooltip formatter={(v: number) => [`R ${v.toLocaleString()}K`, ""]} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="Costed" fill="#fdba74" radius={[0, 4, 4, 0]} barSize={12} name="Costed Expenses" />
                <Bar dataKey="Actual" fill="#ea580c" radius={[0, 4, 4, 0]} barSize={12} name="Actual Expenses" />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {gpData.length > 0 && (
        <Card className="shadow-sm" data-testid="chart-gross-profit">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-muted-foreground">Gross Profit by Project (R'000)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={Math.max(160, gpData.length * 32)}>
              <BarChart data={gpData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `R ${v}K`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={100} />
                <Tooltip formatter={(v: number) => [`R ${v.toLocaleString()}K`, "GP"]} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="GP" radius={[0, 4, 4, 0]} barSize={14}>
                  {gpData.map((entry: any, idx: number) => (
                    <Cell key={idx} fill={entry.GP >= 0 ? "#16a34a" : "#dc2626"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScheduleCharts({ portfolio }: { portfolio: any }) {
  const schedule = portfolio.projectSchedule || [];
  const phaseCounts = portfolio.phaseCounts || {};

  if (schedule.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        No schedule data available for this portfolio's projects.
      </div>
    );
  }

  const completionData = schedule.map((s: any) => ({
    name: shortName(s.projectName),
    "Act%": Math.round(s.actualPct * 10) / 10,
    "Exp%": Math.round(s.expectedPct * 10) / 10,
  }));

  const phaseData = Object.entries(phaseCounts).map(([phase, count]) => ({
    name: phase,
    value: count as number,
  }));

  const onTrack = schedule.filter((s: any) => s.delta >= -5).length;
  const behind = schedule.filter((s: any) => s.delta < -5 && s.delta >= -10).length;
  const atRisk = schedule.filter((s: any) => s.delta < -10).length;
  const healthData = [
    { name: "On Track", value: onTrack, fill: "#16a34a" },
    { name: "Behind", value: behind, fill: "#f59e0b" },
    { name: "At Risk", value: atRisk, fill: "#dc2626" },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard icon={Layers} label="Projects" value={`${schedule.length}`} color="text-blue-700" bgClass="bg-blue-50/80" testId="text-schedule-projects" />
        <KpiCard icon={Target} label="Avg Actual %" value={`${portfolio.avgActualPct}%`} color="text-emerald-700" bgClass="bg-emerald-50/80" testId="text-schedule-avg-act" />
        <KpiCard icon={BarChart3} label="Avg Expected %" value={`${portfolio.avgExpectedPct}%`} color="text-blue-700" bgClass="bg-blue-50/80" testId="text-schedule-avg-exp" />
        <KpiCard icon={AlertTriangle} label="Behind Schedule" value={`${portfolio.behindCount}`} color={portfolio.behindCount > 0 ? "text-red-700" : "text-emerald-700"} bgClass={portfolio.behindCount > 0 ? "bg-red-50/80" : "bg-emerald-50/80"} testId="text-schedule-behind" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {phaseData.length > 0 && (
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Projects by Phase</CardTitle>
            </CardHeader>
            <CardContent className="p-2 flex justify-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={phaseData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={2} label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                    {phaseData.map((entry, idx) => (
                      <Cell key={idx} fill={PHASE_COLORS[entry.name] || PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {healthData.length > 0 && (
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Schedule Health</CardTitle>
            </CardHeader>
            <CardContent className="p-2 flex justify-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={healthData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3} label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                    {healthData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {completionData.length > 0 && (
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actual vs Expected Completion (%)</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={Math.max(180, completionData.length * 28)}>
              <BarChart data={completionData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="Exp%" fill="#93c5fd" radius={[0, 2, 2, 0]} barSize={10} />
                <Bar dataKey="Act%" fill="#2563eb" radius={[0, 2, 2, 0]} barSize={10} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QualityCharts({ portfolio }: { portfolio: any }) {
  const qs = portfolio.qualitySummary || { total: 0, approved: 0, pending: 0, failed: 0 };

  if (qs.total === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-40" />
        No quality inspection data available for this portfolio's projects.
      </div>
    );
  }

  const pieData = [
    { name: "Approved", value: qs.approved, fill: "#16a34a" },
    { name: "Pending", value: qs.pending, fill: "#f59e0b" },
    { name: "Failed", value: qs.failed, fill: "#dc2626" },
  ].filter(d => d.value > 0);

  const passRate = qs.total > 0 ? Math.round((qs.approved / qs.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard icon={Layers} label="Total Items" value={`${qs.total}`} color="text-blue-700" bgClass="bg-blue-50/80" testId="text-quality-total" />
        <KpiCard icon={CheckCircle2} label="Approved" value={`${qs.approved}`} color="text-emerald-700" bgClass="bg-emerald-50/80" testId="text-quality-approved" />
        <KpiCard icon={Clock} label="Pending" value={`${qs.pending}`} color="text-orange-700" bgClass="bg-orange-50/80" testId="text-quality-pending" />
        <KpiCard icon={Percent} label="Pass Rate" value={`${passRate}%`} color={passRate >= 80 ? "text-emerald-700" : passRate >= 50 ? "text-orange-700" : "text-red-700"} bgClass={passRate >= 80 ? "bg-emerald-50/80" : passRate >= 50 ? "bg-orange-50/80" : "bg-red-50/80"} testId="text-quality-pass-rate" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Inspection Status</CardTitle>
          </CardHeader>
          <CardContent className="p-2 flex justify-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3} label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {pieData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quality Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Approved</span>
                  <span className="font-medium text-emerald-600">{qs.approved} / {qs.total}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${qs.total > 0 ? (qs.approved / qs.total) * 100 : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Pending</span>
                  <span className="font-medium text-amber-600">{qs.pending} / {qs.total}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${qs.total > 0 ? (qs.pending / qs.total) * 100 : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Failed / Rejected</span>
                  <span className="font-medium text-red-600">{qs.failed} / {qs.total}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-red-500 h-2 rounded-full transition-all" style={{ width: `${qs.total > 0 ? (qs.failed / qs.total) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EngineeringCharts({ portfolio }: { portfolio: any }) {
  const eng = portfolio.engSummary || { total: 0, complete: 0, inProgress: 0, notStarted: 0 };

  if (eng.total === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        <Wrench className="h-8 w-8 mx-auto mb-2 opacity-40" />
        No engineering stage data available for this portfolio's projects.
      </div>
    );
  }

  const pieData = [
    { name: "Complete", value: eng.complete, fill: "#16a34a" },
    { name: "In Progress", value: eng.inProgress, fill: "#2563eb" },
    { name: "Not Started", value: eng.notStarted, fill: "#d1d5db" },
  ].filter(d => d.value > 0);

  const completionRate = eng.total > 0 ? Math.round((eng.complete / eng.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard icon={Layers} label="Total Stages" value={`${eng.total}`} color="text-blue-700" bgClass="bg-blue-50/80" testId="text-eng-total" />
        <KpiCard icon={CheckCircle2} label="Complete" value={`${eng.complete}`} color="text-emerald-700" bgClass="bg-emerald-50/80" testId="text-eng-complete" />
        <KpiCard icon={Activity} label="In Progress" value={`${eng.inProgress}`} color="text-blue-700" bgClass="bg-blue-50/80" testId="text-eng-in-progress" />
        <KpiCard icon={Percent} label="Completion Rate" value={`${completionRate}%`} color={completionRate >= 80 ? "text-emerald-700" : completionRate >= 50 ? "text-orange-700" : "text-red-700"} bgClass={completionRate >= 80 ? "bg-emerald-50/80" : completionRate >= 50 ? "bg-orange-50/80" : "bg-red-50/80"} testId="text-eng-completion-rate" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="p-2 flex justify-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3} label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {pieData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Engineering Progress</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="flex items-center gap-1 text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Complete</span>
                  <span className="font-medium text-emerald-600">{eng.complete} / {eng.total}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div className="bg-emerald-500 h-2.5 rounded-full transition-all" style={{ width: `${eng.total > 0 ? (eng.complete / eng.total) * 100 : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="flex items-center gap-1 text-muted-foreground"><Activity className="h-3 w-3 text-blue-500" /> In Progress</span>
                  <span className="font-medium text-blue-600">{eng.inProgress} / {eng.total}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div className="bg-blue-500 h-2.5 rounded-full transition-all" style={{ width: `${eng.total > 0 ? (eng.inProgress / eng.total) * 100 : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3 text-gray-400" /> Not Started</span>
                  <span className="font-medium">{eng.notStarted} / {eng.total}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div className="bg-gray-300 h-2.5 rounded-full transition-all" style={{ width: `${eng.total > 0 ? (eng.notStarted / eng.total) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function PortfoliosPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [viewMode, setViewMode] = useState<ViewMode>("management");
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [formData, setFormData] = useState({ name: "", clientName: "", description: "", status: "Active", ownerUserId: "" });
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: dashboard, isLoading } = useQuery<any>({
    queryKey: ["/api/portfolio-dashboard", viewMode],
    queryFn: () => fetch(`/api/portfolio-dashboard?view=${viewMode}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: allUsers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["eng-team-members"],
    queryFn: async () => {
      const res = await fetch("/api/eng/team-members", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload: any = { ...data };
      payload.ownerUserId = data.ownerUserId && data.ownerUserId !== "none" ? parseInt(data.ownerUserId) : null;
      const res = await fetch("/api/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["/api/portfolio-dashboard"] });
      setCreateOpen(false);
      setFormData({ name: "", clientName: "", description: "", status: "Active", ownerUserId: "" });
      toast({ title: "Portfolio created", description: `"${created.name}" has been created` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const portfoliosList = (dashboard?.portfolios || []).filter((p: any) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.clientName || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="page-portfolios">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Portfolio Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {dashboard?.totalPortfolios || 0} portfolios · {dashboard?.unassignedProjectCount || 0} unassigned projects
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5" data-testid="button-create-portfolio">
          <Plus className="h-4 w-4" /> New Portfolio
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
          {([
            { key: "management" as const, label: "Project Management", icon: Briefcase },
            { key: "finance" as const, label: "Finance", icon: DollarSign },
            { key: "quality" as const, label: "Quality", icon: ShieldCheck },
            { key: "engineering" as const, label: "Engineering", icon: Wrench },
          ]).map(tab => (
            <button key={tab.key}
              onClick={() => setViewMode(tab.key)}
              data-testid={`tab-${tab.key}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === tab.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search portfolios..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9"
            data-testid="input-search-portfolios"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground">Loading portfolios...</div>
      ) : portfoliosList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <h3 className="font-semibold text-lg">No portfolios yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Create your first portfolio to group and manage related projects together.</p>
            <Button className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)} data-testid="button-create-portfolio-empty">
              <Plus className="h-4 w-4" /> Create Portfolio
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {portfoliosList.map((p: any) => {
            const isExpanded = expandedId === p.id;
            return (
              <Card key={p.id} className="overflow-hidden" data-testid={`card-portfolio-${p.id}`}>
                <div className="flex items-center">
                  <button
                    className="flex-1 p-4 text-left hover:bg-muted/30 transition-colors group"
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                    data-testid={`toggle-portfolio-${p.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`transition-transform ${isExpanded ? "rotate-0" : "-rotate-90"}`}>
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm truncate" data-testid={`text-portfolio-name-${p.id}`}>
                            {p.name}
                          </h3>
                          <Badge variant="outline" className={`text-[10px] shrink-0 ${healthColor(p.overallHealth)}`} data-testid={`badge-health-${p.id}`}>
                            {p.overallHealth}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {p.status}
                          </Badge>
                          {p.clientName && (
                            <span className="text-xs text-muted-foreground">Client: {p.clientName}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {p.projectCount} projects
                          </span>
                          {p.ownerName && <span>Owner: {p.ownerName}</span>}
                          <span className="flex items-center gap-1">
                            <Zap className="h-3 w-3" />
                            {p.totalKwp?.toFixed(0) || 0} kWp
                          </span>
                          <span>
                            Act: <span className={p.avgActualPct < p.avgExpectedPct - 5 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>
                              {p.avgActualPct}%
                            </span>
                            <span className="text-muted-foreground"> / Exp: {p.avgExpectedPct}%</span>
                          </span>
                          {p.behindCount > 0 && (
                            <span className="flex items-center gap-1 text-red-600 font-medium">
                              <AlertTriangle className="h-3 w-3" />
                              {p.behindCount} behind
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                  <button
                    className="px-3 py-4 border-l hover:bg-muted/30 transition-colors self-stretch flex items-center"
                    onClick={() => navigate(`/portfolios/${p.id}`)}
                    title="View portfolio detail"
                    data-testid={`link-portfolio-${p.id}`}
                  >
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>

                {isExpanded && p.projectCount > 0 && (
                  <div className="border-t px-5 py-4">
                    {viewMode === "management" && <ScheduleCharts portfolio={p} />}
                    {viewMode === "finance" && <FinanceCharts portfolio={p} />}
                    {viewMode === "quality" && <QualityCharts portfolio={p} />}
                    {viewMode === "engineering" && <EngineeringCharts portfolio={p} />}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="dialog-create-portfolio">
          <DialogHeader>
            <DialogTitle>Create New Portfolio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Portfolio Name *</label>
              <Input
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g., Mondi Rollout"
                data-testid="input-portfolio-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Client Name</label>
              <Input
                value={formData.clientName}
                onChange={e => setFormData(f => ({ ...f, clientName: e.target.value }))}
                placeholder="e.g., Mondi Group"
                data-testid="input-portfolio-client"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Owner</label>
              <SearchableSelect
                value={formData.ownerUserId}
                onValueChange={v => setFormData(f => ({ ...f, ownerUserId: v }))}
                placeholder="Select owner..."
                data-testid="select-portfolio-owner"
                options={[
                  { value: "none", label: "No owner" },
                  ...allUsers.map(u => ({ value: String(u.id), label: u.name })),
                ]}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <SearchableSelect
                value={formData.status}
                onValueChange={v => setFormData(f => ({ ...f, status: v }))}
                data-testid="select-portfolio-status"
                options={[
                  { value: "Active", label: "Active" },
                  { value: "On Hold", label: "On Hold" },
                  { value: "Completed", label: "Completed" },
                  { value: "Archived", label: "Archived" },
                ]}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={formData.description}
                onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description of this portfolio..."
                rows={3}
                data-testid="input-portfolio-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(formData)}
              disabled={!formData.name.trim() || createMutation.isPending}
              data-testid="button-confirm-create"
            >
              {createMutation.isPending ? "Creating..." : "Create Portfolio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

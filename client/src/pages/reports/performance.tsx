import { usePerformanceV1 } from "@/hooks/use-performance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageSkeleton, PageError } from "@/components/ui/page-states";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const STAGE_LABELS: Record<string, string> = {
  S01_FIRST_ASSESSMENT: "S01",
  S02_DESIGN_COST_PROPOSAL: "S02",
  S03_SIGNATURE_FINANCIAL_CLOSE: "S03",
  S04_PD_PM_HANDOVER: "S04",
  S05_FINANCIAL_REVIEW: "S05",
  S06_CONSTRUCTION: "S06",
  S07_COMMISSIONING: "S07",
  S08_OM_HANDOVER: "S08",
  S09_CLIENT_HANDOVER: "S09",
  S10_POST_HANDOVER_REVIEW: "S10",
};

const COLORS = ["hsl(142, 64%, 36%)", "hsl(0, 72%, 51%)", "hsl(35, 92%, 45%)", "hsl(214, 78%, 48%)"];

export default function PerformancePage() {
  const { data, isLoading, error } = usePerformanceV1();

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load performance data" />;

  const stageDurationData = (data?.stageDuration ?? []).map((s) => ({
    name: STAGE_LABELS[s.stage_code] || s.stage_code,
    avg: Number(s.avg_days || 0),
    min: Number(s.min_days || 0),
    max: Number(s.max_days || 0),
    count: Number(s.project_count || 0),
  }));

  const commDone = Number(data?.commissioning?.done || 0);
  const commPlanned = Number(data?.commissioning?.planned_by_now || 0);
  const commTotal = Number(data?.commissioning?.total || 0);

  const revCompleted = Number(data?.reviews?.completed || 0);
  const revDue = Number(data?.reviews?.due || 0);

  const onTime = Number(data?.projectCompletion?.on_time || 0);
  const late = Number(data?.projectCompletion?.late || 0);
  const completionData = [
    { name: "On Time", value: onTime },
    { name: "Late", value: late },
  ].filter((d) => d.value > 0);

  const issues = data?.repeatIssues ?? {};

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Performance Dashboard</h1>
          <p className="text-sm text-muted-foreground">V1 — Operational outcomes tracking</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Commissioning Done</p>
              <p className="text-xl font-semibold font-mono">{commDone}/{commTotal}</p>
              <p className="text-xs text-muted-foreground">{commPlanned} planned by now</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">3-Month Reviews</p>
              <p className="text-xl font-semibold font-mono">{revCompleted}/{revDue}</p>
              <p className="text-xs text-muted-foreground">completed vs due</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">On Time</p>
              <p className="text-xl font-semibold font-mono text-green-600">{onTime}</p>
              <p className="text-xs text-muted-foreground">{late} late</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Stages Active</p>
              <p className="text-xl font-semibold font-mono">{data?.stageDistribution?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">with projects</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Average Stage Duration */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Average Stage Duration (Days)</CardTitle>
            </CardHeader>
            <CardContent>
              {stageDurationData.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No stage duration data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={stageDurationData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" width={40} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(val: number) => `${val} days`} />
                    <Bar dataKey="avg" fill="hsl(145, 72%, 32%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Projects On Time vs Late */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Projects: On Time vs Late</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center">
              {completionData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8">No completion data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={completionData}
                      cx="50%" cy="50%" outerRadius={80}
                      dataKey="value" nameKey="name"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {completionData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Repeat Issues */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Repeat Issues Across Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Metering Problems", value: Number(issues.metering_problems || 0), color: "text-red-600" },
                { label: "SSEG Delays", value: Number(issues.sseg_delays || 0), color: "text-orange-600" },
                { label: "Scope Drift", value: Number(issues.scope_drift || 0), color: "text-amber-600" },
                { label: "Quality Defects", value: Number(issues.quality_defects || 0), color: "text-violet-600" },
                { label: "Installer Issues", value: Number(issues.installer_issues || 0), color: "text-blue-600" },
              ].map((item) => (
                <div key={item.label} className="text-center p-3 border rounded-lg">
                  <p className={`text-2xl font-semibold font-mono ${item.value > 0 ? item.color : "text-muted-foreground"}`}>
                    {item.value}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Pipeline Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Projects by Current Stage</CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.stageDistribution?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No stage distribution data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={(data?.stageDistribution ?? []).map((s) => ({
                  name: STAGE_LABELS[s.stage_code] || s.stage_code,
                  count: Number(s.count),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(214, 78%, 48%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

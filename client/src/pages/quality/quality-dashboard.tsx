import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, LineChart, Line, Tooltip } from "recharts";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

async function api(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch data (${res.status})`);
  return res.json();
}

export default function QualityDashboardPage() {
  const [projectId, setProjectId] = useState("1");
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["quality-dash-v2", projectId], queryFn: () => api(`/api/quality/dashboard?project_id=${projectId}`) });
  const severity = data?.openNcrsBySeverity || [];

  if (isLoading) return <PageSkeleton lines={3} />;
  if (isError) return <div className="p-4 md:p-6 space-y-4"><h1 className="text-2xl font-semibold">Quality Dashboard</h1><PageError title="Unable to load quality dashboard" message={error instanceof Error ? error.message : "Failed to fetch quality data"} onRetry={() => refetch()} /></div>;

  return <div className="p-4 md:p-6 space-y-4"><h1 className="text-2xl font-semibold">Quality Dashboard</h1><Input value={projectId} onChange={(e) => setProjectId(e.target.value)} />
    <div className="grid lg:grid-cols-3 grid-cols-1 gap-4">
      <Card><CardHeader><CardTitle>NCR by Severity</CardTitle></CardHeader><CardContent className="h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={severity} dataKey="count" nameKey="severity" outerRadius={80}>{severity.map((_: any, i: number) => <Cell key={i} fill={["#ef4444", "#f59e0b", "#10b981"][i % 3]} />)}</Pie></PieChart></ResponsiveContainer></CardContent></Card>
      <Card><CardHeader><CardTitle>NCR Aging (proxy)</CardTitle></CardHeader><CardContent className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={severity}><XAxis dataKey="severity" /><YAxis /><Bar dataKey="count" fill="#2563eb" /></BarChart></ResponsiveContainer></CardContent></Card>
      <Card><CardHeader><CardTitle>Opened vs Closed Trend</CardTitle></CardHeader><CardContent className="h-56"><ResponsiveContainer width="100%" height="100%"><LineChart data={data?.ncrTrend || []}><XAxis dataKey="month" /><YAxis /><Tooltip /><Line dataKey="opened" stroke="#f59e0b" /><Line dataKey="closed" stroke="#10b981" /></LineChart></ResponsiveContainer></CardContent></Card>
    </div>
    <Card><CardContent className="pt-4 text-sm">Inspection Pass Rate: {data?.inspectionPassRate ?? 0}% • SLA Compliance: {data?.slaCompliancePercentage ?? 0}% • Avg Close Time: {Math.round(data?.averageTimeToCloseDays || 0)} days</CardContent></Card>
  </div>;
}

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface ResourceItem {
  resource: string;
  assignedTasks: number;
  completedThisMonth: number;
  overdue: number;
  projectCount: number;
}

interface ResourceWorkloadChartProps {
  data: ResourceItem[];
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

export default function ResourceWorkloadChart({ data }: ResourceWorkloadChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((r) => ({
      name: truncate(r.resource, 20),
      assignedTasks: r.assignedTasks,
      completedThisMonth: r.completedThisMonth,
      overdue: r.overdue,
    }));
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          No data available for this period
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Resource Workload</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="assignedTasks" fill="#5B9BD5" name="Assigned" radius={[4, 4, 0, 0]} barSize={14} />
            <Bar dataKey="completedThisMonth" fill="#10B981" name="Done This Month" radius={[4, 4, 0, 0]} barSize={14} />
            <Bar dataKey="overdue" fill="#DC2626" name="Overdue" radius={[4, 4, 0, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

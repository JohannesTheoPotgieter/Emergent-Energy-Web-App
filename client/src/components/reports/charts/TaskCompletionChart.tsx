import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const TASK_COLORS = {
  completed: "#10B981",
  inProgress: "#2563EB",
  notStarted: "#6B7280",
  overdue: "#DC2626",
};

interface PerProjectTask {
  projectId: number;
  projectName: string;
  totalTasks: number;
  completed: number;
  inProgress: number;
  notStarted?: number;
  overdue: number;
  completionPct: number;
  completedThisMonth?: number;
}

interface TaskCompletionChartProps {
  data: PerProjectTask[];
  showNotStarted?: boolean;
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

export default function TaskCompletionChart({ data, showNotStarted = false }: TaskCompletionChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((r) => ({
      name: truncate(r.projectName, 20),
      completed: r.completed,
      inProgress: r.inProgress,
      notStarted: r.notStarted ?? 0,
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
        <CardTitle className="text-sm">Task Completion by Project</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 28)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="completed" stackId="tasks" fill={TASK_COLORS.completed} name="Completed" barSize={14} radius={[0, 0, 0, 0]} />
            <Bar dataKey="inProgress" stackId="tasks" fill={TASK_COLORS.inProgress} name="In Progress" />
            {showNotStarted && (
              <Bar dataKey="notStarted" stackId="tasks" fill={TASK_COLORS.notStarted} name="Not Started" />
            )}
            <Bar dataKey="overdue" stackId="tasks" fill={TASK_COLORS.overdue} name="Overdue" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const DELIVERABLE_COLORS: Record<string, string> = {
  "TO DO": "#6B7280",
  "IN PROGRESS": "#2563EB",
  "NEEDS APPROVAL": "#F59E0B",
  "QC APPROVED": "#10B981",
  "COMPLETE": "#059669",
  "PROVIDE FEEDBACK": "#DC2626",
};

const FALLBACK_COLORS = ["#4472C4", "#ED7D31", "#FFC000", "#70AD47", "#5B9BD5", "#9B59B6"];

interface DeliverableItem {
  status: string;
  [key: string]: unknown;
}

interface DeliverableStatusChartProps {
  data: DeliverableItem[];
}

export default function DeliverableStatusChart({ data }: DeliverableStatusChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const statusCounts: Record<string, number> = {};
    for (const d of data) {
      statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
    }
    return Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
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
        <CardTitle className="text-sm">Deliverable Status Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              label={({ value }) => value}
            >
              {chartData.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={DELIVERABLE_COLORS[entry.name.toUpperCase()] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length]}
                />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const RAG_COLORS: Record<string, string> = {
  RED: "#DC2626",
  AMBER: "#F59E0B",
  GREEN: "#10B981",
  Unknown: "#6B7280",
};

interface ProjectStatusItem {
  projectId: number;
  projectName: string;
  ragStatus: string | null;
}

interface RAGDistributionChartProps {
  data: ProjectStatusItem[];
}

export default function RAGDistributionChart({ data }: RAGDistributionChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const ragCounts: Record<string, number> = { RED: 0, AMBER: 0, GREEN: 0, Unknown: 0 };
    for (const p of data) {
      const rag = (p.ragStatus || "").toUpperCase();
      if (rag === "RED") ragCounts.RED++;
      else if (rag === "AMBER") ragCounts.AMBER++;
      else if (rag === "GREEN") ragCounts.GREEN++;
      else ragCounts.Unknown++;
    }
    return Object.entries(ragCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
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
        <CardTitle className="text-sm">RAG Status Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={70}
              label={({ value }) => value}
            >
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={RAG_COLORS[entry.name] || "#6B7280"} />
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

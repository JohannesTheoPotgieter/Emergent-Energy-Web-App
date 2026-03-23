import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const SERIES_COLORS = ["#4472C4", "#ED7D31", "#FFC000", "#70AD47", "#5B9BD5", "#9B59B6"];

interface RevenueTrendItem {
  projectName: string;
  projectId: number;
  category: string;
  monthEndDate: string;
  value: number;
}

interface RevenueTrendChartProps {
  data: RevenueTrendItem[];
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-ZA", { month: "short" })}`;
}

export default function RevenueTrendChart({ data }: RevenueTrendChartProps) {
  const { chartData, categories } = useMemo(() => {
    if (!data || data.length === 0) return { chartData: [], categories: [] };

    const months = [...new Set(data.map((r) => r.monthEndDate))].sort();
    const cats = [...new Set(data.map((r) => r.category))];
    const rows = months.map((m) => {
      const row: Record<string, unknown> = { month: formatDateLabel(m) };
      for (const cat of cats) {
        row[cat] = data
          .filter((r) => r.monthEndDate === m && r.category === cat)
          .reduce((sum, r) => sum + r.value, 0);
      }
      return row;
    });
    return { chartData: rows, categories: cats };
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
        <CardTitle className="text-sm">Revenue Trend (12 Months)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `R ${(v / 1000).toFixed(0)}K`} />
            <Tooltip formatter={(v: number) => `R ${v.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {categories.map((cat, idx) => (
              <Bar
                key={cat}
                dataKey={cat}
                stackId="revenue"
                fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                radius={idx === categories.length - 1 ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

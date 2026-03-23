import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const SERIES_COLORS = ["#4472C4", "#ED7D31", "#FFC000", "#70AD47", "#5B9BD5", "#9B59B6"];

interface CashflowTrendItem {
  projectName: string;
  projectId: number;
  seriesName: string;
  pointDate: string;
  value: number;
}

interface CashflowTrendChartProps {
  data: CashflowTrendItem[];
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-ZA", { month: "short" })}`;
}

export default function CashflowTrendChart({ data }: CashflowTrendChartProps) {
  const { chartData, seriesNames } = useMemo(() => {
    if (!data || data.length === 0) return { chartData: [], seriesNames: [] };

    const dates = [...new Set(data.map((c) => c.pointDate))].sort();
    const names = [...new Set(data.map((c) => c.seriesName))];
    const rows = dates.map((d) => {
      const row: Record<string, unknown> = { date: formatDateLabel(d) };
      for (const s of names) {
        row[s] = data
          .filter((c) => c.pointDate === d && c.seriesName === s)
          .reduce((sum, c) => sum + c.value, 0);
      }
      return row;
    });
    return { chartData: rows, seriesNames: names };
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
        <CardTitle className="text-sm">Cashflow Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `R ${(v / 1000).toFixed(0)}K`} />
            <Tooltip formatter={(v: number) => `R ${v.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {seriesNames.map((name, idx) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

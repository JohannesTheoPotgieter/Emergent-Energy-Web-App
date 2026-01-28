import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeBar } from "@/components/DateRangeBar";
import { cashflowApi } from "@/lib/api";
import { format, parseISO } from "date-fns";

export default function CashflowPage() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  const { data: cashflowPoints = [], isLoading } = useQuery({
    queryKey: ["cashflow", selectedProject, startDate, endDate],
    queryFn: () => cashflowApi.getAll(selectedProject || undefined, startDate || undefined, endDate || undefined),
    staleTime: 30000,
  });

  const filteredAndGroupedData = useMemo(() => {
    let filtered = cashflowPoints;

    if (startDate) {
      filtered = filtered.filter(point => point.pointDate >= startDate);
    }
    if (endDate) {
      filtered = filtered.filter(point => point.pointDate <= endDate);
    }

    const dateMap = new Map<string, Record<string, number>>();
    
    filtered.forEach(point => {
      if (!dateMap.has(point.pointDate)) {
        dateMap.set(point.pointDate, {});
      }
      const dateData = dateMap.get(point.pointDate)!;
      dateData[point.seriesName] = point.value;
    });

    const chartData = Array.from(dateMap.entries())
      .map(([date, values]) => ({
        date,
        dateLabel: format(parseISO(date), "dd MMM yy"),
        ...values,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return chartData;
  }, [cashflowPoints, startDate, endDate]);

  const seriesNames = useMemo(() => {
    const names = new Set<string>();
    cashflowPoints.forEach(point => names.add(point.seriesName));
    return Array.from(names).sort();
  }, [cashflowPoints]);

  const getSeriesColor = (name: string) => {
    const colorMap: Record<string, string> = {
      "Planned Revenue": "#3b82f6",
      "Planned Expenditure": "#f59e0b",
      "PLANNED CashFlow": "#10b981",
      "Actual + Planned Revenue": "#06b6d4",
      "Actual + Planned Expenditure": "#ef4444",
      "ACTUAL CashFlow": "#059669",
    };
    return colorMap[name] || "#6b7280";
  };

  return (
    <div className="space-y-0">
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-heading font-bold text-foreground">Cashflow Analysis</h2>
          <p className="text-muted-foreground">
            Historical cashflow tracking with planned vs actual comparisons
          </p>
        </div>
      </div>

      <DateRangeBar 
        onDateChange={(start, end) => {
          setStartDate(start);
          setEndDate(end);
        }}
        onProjectChange={setSelectedProject}
      />

      <div className="p-6 space-y-6">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading cashflow data...</div>
        ) : cashflowPoints.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <p className="text-lg font-medium">No cashflow data available</p>
                <p className="text-sm mt-2">Upload tracker files with Cashflow sheets to see data here</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle>Cashflow Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[500px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={filteredAndGroupedData} margin={{ top: 20, right: 30, left: 60, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis 
                        dataKey="dateLabel" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={false}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false} 
                        tickFormatter={(val) => `R${(val/1000000).toFixed(1)}M`}
                      />
                      <Tooltip 
                        formatter={(value: number) => [`R${value.toLocaleString()}`, ""]}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      />
                      <Legend 
                        wrapperStyle={{ paddingTop: '20px' }}
                        iconType="line"
                      />
                      {seriesNames.map(name => (
                        <Line
                          key={name}
                          type="monotone"
                          dataKey={name}
                          name={name}
                          stroke={getSeriesColor(name)}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Data Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <div className="text-sm text-blue-700 font-medium">Total Data Points</div>
                    <div className="text-2xl font-bold text-blue-900 mt-1">
                      {filteredAndGroupedData.length}
                    </div>
                  </div>
                  <div className="text-center p-4 bg-emerald-50 rounded-lg">
                    <div className="text-sm text-emerald-700 font-medium">Series Tracked</div>
                    <div className="text-2xl font-bold text-emerald-900 mt-1">
                      {seriesNames.length}
                    </div>
                  </div>
                  <div className="text-center p-4 bg-amber-50 rounded-lg">
                    <div className="text-sm text-amber-700 font-medium">Projects</div>
                    <div className="text-2xl font-bold text-amber-900 mt-1">
                      {selectedProject ? 1 : new Set(cashflowPoints.map(p => p.projectName)).size}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

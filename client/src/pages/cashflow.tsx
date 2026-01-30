import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { DateRangeBar } from "@/components/DateRangeBar";
import { cashflowApi, type CashflowPoint, type InsertCashflowPlanningOverride } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { format, parseISO } from "date-fns";

export default function CashflowPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [edits, setEdits] = useState<Map<string, number>>(new Map());

  const { data: cashflowPoints = [], isLoading } = useQuery({
    queryKey: ["cashflow", selectedProject, startDate, endDate],
    queryFn: () => cashflowApi.getAll(selectedProject || undefined, startDate || undefined, endDate || undefined),
    staleTime: 30000,
  });

  const saveMutation = useMutation({
    mutationFn: cashflowApi.savePlanningOverrides,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      setEdits(new Map());
      toast({
        title: "Plan Saved",
        description: "Planning changes have been saved successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: getErrorMessage(error, "Failed to save planning changes"),
        variant: "destructive",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: (projectName: string) => cashflowApi.resetPlanningOverrides(projectName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      setEdits(new Map());
      toast({
        title: "Plan Reset",
        description: "Planning overrides have been cleared.",
      });
    },
    onError: (error) => {
      toast({
        title: "Reset Failed",
        description: getErrorMessage(error, "Failed to reset plan"),
        variant: "destructive",
      });
    },
  });

  // Get unique weekly dates and project names
  const { weeklyDates, projects } = useMemo(() => {
    const dates = new Set<string>();
    const projs = new Set<string>();
    cashflowPoints.forEach(point => {
      dates.add(point.pointDate);
      projs.add(point.projectName);
    });
    return {
      weeklyDates: Array.from(dates).sort(),
      projects: Array.from(projs).sort(),
    };
  }, [cashflowPoints]);

  // Organize data for chart and grid
  const chartData = useMemo(() => {
    const dateMap = new Map<string, Record<string, number>>();

    // Apply edits to cashflow points
    const pointsWithEdits = cashflowPoints.map(point => {
      const editKey = `${point.projectName}|${point.pointDate}|${point.seriesName}`;
      if (edits.has(editKey)) {
        return { ...point, value: edits.get(editKey)! };
      }
      return point;
    });

    pointsWithEdits.forEach(point => {
      if (!dateMap.has(point.pointDate)) {
        dateMap.set(point.pointDate, {});
      }
      const dateData = dateMap.get(point.pointDate)!;
      dateData[point.seriesName] = point.value;
    });

    return Array.from(dateMap.entries())
      .map(([date, values]) => ({
        date,
        dateLabel: format(parseISO(date), "dd MMM yy"),
        ...values,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [cashflowPoints, edits]);

  // Extract planning grid data (Planned Revenue and Planned Expenditure only)
  const planningGridData = useMemo(() => {
    const plannedRevenueRow: Record<string, number> = {};
    const plannedExpenditureRow: Record<string, number> = {};

    cashflowPoints.forEach(point => {
      if (point.seriesName === "Planned Revenue") {
        const editKey = `${point.projectName}|${point.pointDate}|${point.seriesName}`;
        plannedRevenueRow[point.pointDate] = edits.has(editKey) ? edits.get(editKey)! : point.value;
      } else if (point.seriesName === "Planned Expenditure") {
        const editKey = `${point.projectName}|${point.pointDate}|${point.seriesName}`;
        plannedExpenditureRow[point.pointDate] = edits.has(editKey) ? edits.get(editKey)! : point.value;
      }
    });

    return {
      revenue: plannedRevenueRow,
      expenditure: plannedExpenditureRow,
    };
  }, [cashflowPoints, edits]);

  const seriesConfig = [
    { name: "Planned Revenue", color: "#3b82f6", strokeWidth: 2 },
    { name: "Planned Expenditure", color: "#f59e0b", strokeWidth: 2 },
    { name: "PLANNED CashFlow", color: "#10b981", strokeWidth: 2 },
    { name: "Actual + Planned Revenue", color: "#06b6d4", strokeWidth: 2, dash: "5 5" },
    { name: "Actual + Planned Expenditure", color: "#ef4444", strokeWidth: 2, dash: "5 5" },
    { name: "ACTUAL CashFlow", color: "#059669", strokeWidth: 3 },
    { name: "Revenue Recognition", color: "#8b5cf6", strokeWidth: 2 },
    { name: "Revenue Recognition Cumulative", color: "#ec4899", strokeWidth: 2 },
  ];

  const handleCellEdit = (date: string, seriesName: string, value: number) => {
    const project = selectedProject || projects[0] || "";
    const editKey = `${project}|${date}|${seriesName}`;
    const newEdits = new Map(edits);
    newEdits.set(editKey, value);
    setEdits(newEdits);
  };

  const handleSavePlan = async () => {
    if (edits.size === 0) {
      toast({
        title: "No Changes",
        description: "No planning changes to save.",
      });
      return;
    }

    const overrides: InsertCashflowPlanningOverride[] = [];
    edits.forEach((value, key) => {
      const [projectName, weekStartDate, seriesName] = key.split('|');
      overrides.push({
        projectName,
        weekStartDate,
        seriesName,
        overrideValue: value.toString(),
      });
    });

    await saveMutation.mutateAsync(overrides);
  };

  const handleResetPlan = async () => {
    const project = selectedProject || projects[0];
    if (!project) {
      toast({
        title: "No Project Selected",
        description: "Please select a project to reset.",
        variant: "destructive",
      });
      return;
    }

    await resetMutation.mutateAsync(project);
  };

  const hasEdits = edits.size > 0;

  return (
    <div className="space-y-0">
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-heading font-bold text-foreground">Cashflow Planning</h2>
          <p className="text-muted-foreground">
            View and edit planned cashflow data - changes affect the chart immediately
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
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Cashflow Chart</CardTitle>
                <div className="flex gap-2">
                  {hasEdits && (
                    <Button
                      onClick={handleSavePlan}
                      disabled={saveMutation.isPending}
                      size="sm"
                      data-testid="button-save-plan"
                    >
                      {saveMutation.isPending ? "Saving..." : "Save Plan"}
                    </Button>
                  )}
                  <Button
                    onClick={handleResetPlan}
                    disabled={resetMutation.isPending}
                    variant="outline"
                    size="sm"
                    data-testid="button-reset-plan"
                  >
                    {resetMutation.isPending ? "Resetting..." : "Reset Plan"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[500px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 20, right: 30, left: 60, bottom: 80 }}>
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
                        tickFormatter={(val) => `R${(val / 1000000).toFixed(1)}M`}
                      />
                      <Tooltip
                        formatter={(value: number) => [`R${value.toLocaleString()}`, ""]}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: '20px' }}
                        iconType="line"
                      />
                      {seriesConfig.map(series => (
                        <Line
                          key={series.name}
                          type="monotone"
                          dataKey={series.name}
                          name={series.name}
                          stroke={series.color}
                          strokeWidth={series.strokeWidth}
                          strokeDasharray={series.dash || undefined}
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
                <CardTitle>Editable Planning Grid</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Edit Planned Revenue and Planned Expenditure values - changes update the chart immediately
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium sticky left-0 bg-white z-10">Series</th>
                        {weeklyDates.map(date => (
                          <th key={date} className="text-right p-2 font-medium min-w-[120px]">
                            {format(parseISO(date), "dd MMM yy")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b hover:bg-blue-50">
                        <td className="p-2 font-medium sticky left-0 bg-white">Planned Revenue</td>
                        {weeklyDates.map(date => (
                          <td key={date} className="p-1">
                            <input
                              type="number"
                              className="w-full text-right p-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={planningGridData.revenue[date] || 0}
                              onChange={(e) => handleCellEdit(date, "Planned Revenue", parseFloat(e.target.value) || 0)}
                              data-testid={`input-planned-revenue-${date}`}
                            />
                          </td>
                        ))}
                      </tr>
                      <tr className="border-b hover:bg-amber-50">
                        <td className="p-2 font-medium sticky left-0 bg-white">Planned Expenditure</td>
                        {weeklyDates.map(date => (
                          <td key={date} className="p-1">
                            <input
                              type="number"
                              className="w-full text-right p-1 border rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                              value={planningGridData.expenditure[date] || 0}
                              onChange={(e) => handleCellEdit(date, "Planned Expenditure", parseFloat(e.target.value) || 0)}
                              data-testid={`input-planned-expenditure-${date}`}
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                {hasEdits && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm text-blue-900">
                      You have {edits.size} unsaved change{edits.size > 1 ? 's' : ''}. Click "Save Plan" to persist your changes.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

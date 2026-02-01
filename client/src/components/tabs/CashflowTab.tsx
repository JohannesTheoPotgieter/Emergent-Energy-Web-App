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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cashflowApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { Save, RotateCcw, Loader2 } from "lucide-react";

interface CashflowTabProps {
  projectName: string;
}

export function CashflowTab({ projectName }: CashflowTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Map<string, number>>(new Map());

  const { data: cashflowPoints = [], isLoading } = useQuery({
    queryKey: ["cashflow", projectName],
    queryFn: () => cashflowApi.getAll(projectName),
    staleTime: 30000,
  });

  const saveMutation = useMutation({
    mutationFn: cashflowApi.savePlanningOverrides,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cashflow", projectName] });
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
    mutationFn: () => cashflowApi.resetPlanningOverrides(projectName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cashflow", projectName] });
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

  // Clear edits when project changes
  useEffect(() => {
    setEdits(new Map());
  }, [projectName]);

  // Get unique weekly dates
  const weeklyDates = useMemo(() => {
    const dates = new Set<string>();
    cashflowPoints.forEach(point => dates.add(point.pointDate));
    return Array.from(dates).sort();
  }, [cashflowPoints]);

  // Organize data by series and date
  const seriesData = useMemo(() => {
    const data: Record<string, Record<string, number | null>> = {};
    cashflowPoints.forEach(point => {
      if (!data[point.seriesName]) {
        data[point.seriesName] = {};
      }
      data[point.seriesName][point.pointDate] = point.value;
    });
    return data;
  }, [cashflowPoints]);

  // Apply edits to display data
  const displayData = useMemo(() => {
    const result = JSON.parse(JSON.stringify(seriesData));
    edits.forEach((value, key) => {
      const [series, date] = key.split("|");
      if (result[series] && result[series][date] !== undefined) {
        result[series][date] = value;
      }
    });
    return result;
  }, [seriesData, edits]);

  // Prepare chart data
  const chartData = useMemo(() => {
    return weeklyDates.map(date => {
      const point: any = { date: new Date(date).toLocaleDateString() };
      Object.keys(displayData).forEach(series => {
        point[series] = displayData[series][date] || 0;
      });
      return point;
    });
  }, [weeklyDates, displayData]);

  const handleSavePlan = async () => {
    const overrides = Array.from(edits.entries()).map(([key, value]) => {
      const [seriesName, weekStartDate] = key.split("|");
      return {
        projectName,
        weekStartDate,
        seriesName,
        overrideValue: value,
      };
    });
    await saveMutation.mutateAsync(overrides);
  };

  const handleResetPlan = async () => {
    await resetMutation.mutateAsync();
  };

  const handleCellEdit = (series: string, date: string, value: string) => {
    const key = `${series}|${date}`;
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      const newEdits = new Map(edits);
      newEdits.set(key, numValue);
      setEdits(newEdits);
    }
  };

  const editableSeries = ["Planned Revenue", "Planned Expenditure"];
  const hasEdits = edits.size > 0;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (cashflowPoints.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cashflow</CardTitle>
          <CardDescription>Weekly cashflow planning and actuals</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">
            No cashflow data available for this project
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Cashflow Chart</CardTitle>
          <CardDescription>Weekly cashflow visualization with live planning updates</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="Planned Revenue" stroke="#10b981" strokeWidth={2} />
              <Line type="monotone" dataKey="Planned Expenditure" stroke="#f59e0b" strokeWidth={2} />
              <Line type="monotone" dataKey="Actual Revenue" stroke="#22c55e" strokeDasharray="5 5" />
              <Line type="monotone" dataKey="Actual Expenditure" stroke="#fb923c" strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Planning Grid */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Planning Grid</CardTitle>
              <CardDescription>
                Edit planned values • Click cells to modify • Changes reflect immediately in chart
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleSavePlan}
                disabled={!hasEdits || saveMutation.isPending}
                variant="default"
                size="sm"
              >
                <Save className="h-4 w-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save Plan"}
              </Button>
              <Button
                onClick={handleResetPlan}
                disabled={resetMutation.isPending}
                variant="outline"
                size="sm"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset Plan
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-auto max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Series</TableHead>
                  {weeklyDates.slice(0, 10).map(date => (
                    <TableHead key={date} className="text-right min-w-[100px]">
                      {new Date(date).toLocaleDateString()}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.keys(displayData).map(series => (
                  <TableRow key={series}>
                    <TableCell className="font-medium">{series}</TableCell>
                    {weeklyDates.slice(0, 10).map(date => {
                      const value = displayData[series][date];
                      const isEditable = editableSeries.includes(series);
                      const key = `${series}|${date}`;

                      return (
                        <TableCell key={date} className="text-right">
                          {isEditable ? (
                            <Input
                              type="number"
                              value={value || 0}
                              onChange={(e) => handleCellEdit(series, date, e.target.value)}
                              className="h-8 text-right"
                            />
                          ) : (
                            <span className="font-mono text-muted-foreground">
                              {value?.toLocaleString() || "-"}
                            </span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {hasEdits && (
            <div className="mt-4 text-sm text-muted-foreground">
              {edits.size} {edits.size === 1 ? "cell" : "cells"} modified. Click "Save Plan" to persist changes.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

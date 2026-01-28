import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateRangeBar } from "@/components/DateRangeBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { financeApi } from "@/lib/api";
import { format, parseISO } from "date-fns";

export default function CosTracker() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  const { data: financeCos = [], isLoading } = useQuery({
    queryKey: ["finance-cos", selectedProject],
    queryFn: () => financeApi.getCos(selectedProject || undefined),
    staleTime: 30000,
  });

  const filteredData = useMemo(() => {
    let filtered = financeCos;

    if (startDate) {
      filtered = filtered.filter(item => item.monthEndDate >= startDate);
    }
    if (endDate) {
      filtered = filtered.filter(item => item.monthEndDate <= endDate);
    }

    return filtered;
  }, [financeCos, startDate, endDate]);

  const pivotData = useMemo(() => {
    const categoryMap = new Map<string, Map<string, number>>();
    const monthSet = new Set<string>();

    filteredData.forEach(item => {
      monthSet.add(item.monthEndDate);
      
      if (!categoryMap.has(item.category)) {
        categoryMap.set(item.category, new Map());
      }
      categoryMap.get(item.category)!.set(item.monthEndDate, item.value);
    });

    const months = Array.from(monthSet).sort();
    
    const rows = Array.from(categoryMap.entries()).map(([category, monthValues]) => {
      const row: Record<string, string | number> = { category };
      let total = 0;
      
      months.forEach(month => {
        const value = monthValues.get(month) || 0;
        row[month] = value;
        total += value;
      });
      
      row.total = total;
      return row;
    });

    return { rows, months };
  }, [filteredData]);

  const totalCos = useMemo(() => {
    return filteredData.reduce((sum, item) => sum + item.value, 0);
  }, [filteredData]);

  return (
    <div className="space-y-0">
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-heading font-bold text-foreground">Cost of Sales Tracker (COS)</h2>
          <p className="text-muted-foreground">
            Monthly cost breakdown by category from Finance - COS sheets
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
          <div className="text-center py-12 text-muted-foreground">Loading COS data...</div>
        ) : financeCos.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <p className="text-lg font-medium">No COS data available</p>
                <p className="text-sm mt-2">Upload tracker files with Finance - COS sheets to see data here</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid md:grid-cols-3 gap-4">
              <Card className="bg-rose-50 border-rose-200">
                <CardContent className="pt-6">
                  <div className="text-sm text-rose-700 font-medium">Total COS</div>
                  <div className="text-3xl font-bold text-rose-900 mt-2">
                    R{(totalCos / 1000000).toFixed(2)}M
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="pt-6">
                  <div className="text-sm text-blue-700 font-medium">Categories</div>
                  <div className="text-3xl font-bold text-blue-900 mt-2">
                    {pivotData.rows.length}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-amber-50 border-amber-200">
                <CardContent className="pt-6">
                  <div className="text-sm text-amber-700 font-medium">Months Tracked</div>
                  <div className="text-3xl font-bold text-amber-900 mt-2">
                    {pivotData.months.length}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Monthly COS by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-bold">Category</TableHead>
                        {pivotData.months.map(month => (
                          <TableHead key={month} className="text-right font-bold">
                            {format(parseISO(month), "MMM yy")}
                          </TableHead>
                        ))}
                        <TableHead className="text-right font-bold bg-rose-50">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pivotData.rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={pivotData.months.length + 2} className="text-center py-8 text-muted-foreground">
                            No data available for the selected filters
                          </TableCell>
                        </TableRow>
                      ) : (
                        pivotData.rows.map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{row.category}</TableCell>
                            {pivotData.months.map(month => (
                              <TableCell key={month} className="text-right font-mono">
                                {row[month] ? `R${(row[month] as number).toLocaleString()}` : '-'}
                              </TableCell>
                            ))}
                            <TableCell className="text-right font-mono font-bold bg-rose-50 text-rose-900">
                              R{(row.total as number).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Line-Level COS Data</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Month End</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredData.slice(0, 100).map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{item.projectName}</TableCell>
                          <TableCell>{item.category}</TableCell>
                          <TableCell>{format(parseISO(item.monthEndDate), "dd MMM yyyy")}</TableCell>
                          <TableCell className="text-right font-mono text-rose-700">
                            R{item.value.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredData.length > 100 && (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      Showing first 100 of {filteredData.length} records
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

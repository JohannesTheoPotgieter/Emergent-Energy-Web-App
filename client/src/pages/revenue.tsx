import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { DateRangeBar } from "@/components/DateRangeBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { financeApi, overviewApi } from "@/lib/api";
import { format, parseISO, addDays, isWithinInterval, isBefore } from "date-fns";
import { DollarSign, TrendingUp, AlertTriangle, Calendar, ArrowRight } from "lucide-react";

export default function RevenueTracker() {
  const [, setLocation] = useLocation();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  const { data: financeRevenue = [], isLoading: isLoadingFinance } = useQuery({
    queryKey: ["finance-revenue", selectedProject, startDate, endDate],
    queryFn: () => financeApi.getRevenue(selectedProject || undefined, startDate || undefined, endDate || undefined),
    staleTime: 30000,
  });

  const { data: programInflows = [], isLoading: isLoadingInflows } = useQuery({
    queryKey: ["program-inflows", selectedProject, startDate, endDate],
    queryFn: () => overviewApi.getProgramInflows(selectedProject || undefined, startDate || undefined, endDate || undefined),
    staleTime: 30000,
  });

  const isLoading = isLoadingFinance || isLoadingInflows;

  const filteredData = useMemo(() => {
    let filtered = financeRevenue;

    if (startDate) {
      filtered = filtered.filter(item => item.monthEndDate >= startDate);
    }
    if (endDate) {
      filtered = filtered.filter(item => item.monthEndDate <= endDate);
    }

    return filtered;
  }, [financeRevenue, startDate, endDate]);

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

  const totalRevenue = useMemo(() => {
    return filteredData.reduce((sum, item) => sum + item.value, 0);
  }, [filteredData]);

  const inflowMetrics = useMemo(() => {
    const today = new Date();
    const next30 = addDays(today, 30);
    const next60 = addDays(today, 60);
    const next90 = addDays(today, 90);

    let totalPlanned = 0;
    let totalReceived = 0;
    let overdue = 0;
    let upcoming30 = 0;
    let upcoming60 = 0;
    let upcoming90 = 0;

    (programInflows as any[]).forEach((inflow: any) => {
      const amount = Number(inflow.amount) || 0;
      totalPlanned += amount;

      if (inflow.is_received) {
        totalReceived += amount;
      } else if (inflow.date) {
        try {
          const date = new Date(inflow.date);
          if (isBefore(date, today)) {
            overdue += amount;
          } else if (isWithinInterval(date, { start: today, end: next30 })) {
            upcoming30 += amount;
          } else if (isWithinInterval(date, { start: today, end: next60 })) {
            upcoming60 += amount;
          } else if (isWithinInterval(date, { start: today, end: next90 })) {
            upcoming90 += amount;
          }
        } catch {}
      }
    });

    return {
      totalPlanned,
      totalReceived,
      overdue,
      overdueCount: (programInflows as any[]).filter((i: any) => !i.is_received && i.date && isBefore(new Date(i.date), today)).length,
      upcoming30,
      upcoming60,
      upcoming90,
    };
  }, [programInflows]);

  const projectBreakdown = useMemo(() => {
    const projectMap = new Map<string, number>();
    filteredData.forEach(item => {
      const current = projectMap.get(item.projectName) || 0;
      projectMap.set(item.projectName, current + item.value);
    });
    return Array.from(projectMap.entries())
      .map(([project, total]) => ({ project, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [filteredData]);

  return (
    <div className="space-y-0">
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-heading font-bold text-foreground">Revenue Tracker (REV)</h2>
          <p className="text-muted-foreground">
            Monthly revenue breakdown by category from Finance - Revenue sheets
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
          <div className="text-center py-12 text-muted-foreground">Loading revenue data...</div>
        ) : financeRevenue.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <p className="text-lg font-medium">No revenue data available</p>
                <p className="text-sm mt-2">Upload tracker files with Finance - Revenue sheets to see data here</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                title="Total Revenue (Finance)"
                value={`R${(totalRevenue / 1000000).toFixed(2)}M`}
                subValue={`${pivotData.rows.length} categories, ${pivotData.months.length} months`}
                icon={DollarSign}
                data-testid="card-total-revenue"
              />
              <SummaryCard
                title="Received vs Planned"
                value={`R${(inflowMetrics.totalReceived / 1000000).toFixed(2)}M`}
                subValue={`of R${(inflowMetrics.totalPlanned / 1000000).toFixed(2)}M planned`}
                trend={inflowMetrics.totalPlanned > 0 && inflowMetrics.totalReceived / inflowMetrics.totalPlanned >= 0.8 ? "up" : undefined}
                icon={TrendingUp}
                data-testid="card-received-planned"
              />
              <SummaryCard
                title="Overdue Milestones"
                value={inflowMetrics.overdueCount}
                subValue={inflowMetrics.overdue > 0 ? `R${(inflowMetrics.overdue / 1000000).toFixed(2)}M outstanding` : "All on track"}
                icon={AlertTriangle}
                className={inflowMetrics.overdueCount > 0 ? "border-l-amber-500" : "border-l-emerald-500"}
                data-testid="card-overdue-milestones"
              />
              <SummaryCard
                title="Next 30 Days"
                value={`R${(inflowMetrics.upcoming30 / 1000000).toFixed(2)}M`}
                subValue={`60d: R${(inflowMetrics.upcoming60 / 1000000).toFixed(1)}M • 90d: R${(inflowMetrics.upcoming90 / 1000000).toFixed(1)}M`}
                icon={Calendar}
                data-testid="card-upcoming-inflows"
              />
            </div>

            {projectBreakdown.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Top Projects by Revenue</CardTitle>
                  <CardDescription>Click to drill down into project details</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {projectBreakdown.map(({ project, total }) => (
                      <div
                        key={project}
                        className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => setLocation(`/project/${encodeURIComponent(project)}`)}
                      >
                        <span className="font-medium">{project.replace("_Tracker", "")}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">R{(total / 1000000).toFixed(2)}M</span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Monthly Revenue by Category</CardTitle>
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
                        <TableHead className="text-right font-bold bg-emerald-50">Total</TableHead>
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
                            <TableCell className="text-right font-mono font-bold bg-emerald-50 text-emerald-900">
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
                <CardTitle>Line-Level Revenue Data (Inflows)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Milestone</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Planned Payment</TableHead>
                        <TableHead>Payment Received</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {programInflows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No inflow data available
                          </TableCell>
                        </TableRow>
                      ) : (
                        programInflows.slice(0, 100).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{item.projectName}</TableCell>
                            <TableCell>{item.milestoneName || `#${item.milestoneNo}`}</TableCell>
                            <TableCell className="font-mono text-emerald-700">
                              R{item.milestoneAmount?.toLocaleString() || '-'}
                            </TableCell>
                            <TableCell>
                              {item.plannedPaymentDate ? format(parseISO(item.plannedPaymentDate), "dd MMM yyyy") : '-'}
                            </TableCell>
                            <TableCell>
                              {item.paymentReceivedDate ? format(parseISO(item.paymentReceivedDate), "dd MMM yyyy") : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={item.paymentReceivedDate ? "default" : "outline"} className={item.paymentReceivedDate ? "bg-emerald-600" : ""}>
                                {item.paymentReceivedDate ? "Received" : "Pending"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {programInflows.length > 100 && (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      Showing first 100 of {programInflows.length} records
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

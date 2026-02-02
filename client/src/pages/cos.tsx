import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { DateRangeBar } from "@/components/DateRangeBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { financeApi, overviewApi } from "@/lib/api";
import { format, parseISO, addDays, isWithinInterval, isBefore } from "date-fns";
import { CreditCard, TrendingDown, AlertTriangle, Users, ArrowRight } from "lucide-react";

export default function CosTracker() {
  const [, setLocation] = useLocation();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  const { data: financeCos = [], isLoading: isLoadingFinance } = useQuery({
    queryKey: ["finance-cos", selectedProject, startDate, endDate],
    queryFn: () => financeApi.getCos(selectedProject || undefined, startDate || undefined, endDate || undefined),
    staleTime: 30000,
  });

  const { data: programExpenses = [], isLoading: isLoadingExpenses } = useQuery({
    queryKey: ["program-expenses", selectedProject, startDate, endDate],
    queryFn: () => overviewApi.getProgramExpenses(selectedProject || undefined, startDate || undefined, endDate || undefined),
    staleTime: 30000,
  });

  const isLoading = isLoadingFinance || isLoadingExpenses;

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

  const expenseMetrics = useMemo(() => {
    const today = new Date();
    let totalBudget = 0;
    let totalPaid = 0;
    let overdue = 0;
    let atRiskCount = 0;

    (programExpenses as any[]).forEach((exp: any) => {
      const amount = Number(exp.amount) || 0;
      totalBudget += amount;

      if (exp.is_paid) {
        totalPaid += amount;
      } else if (exp.date) {
        try {
          const date = new Date(exp.date);
          if (isBefore(date, today)) {
            overdue += amount;
            atRiskCount++;
          }
        } catch {}
      }
    });

    return {
      totalBudget,
      totalPaid,
      overdue,
      atRiskCount,
      variance: totalBudget > 0 ? ((totalPaid / totalBudget) * 100) : 0,
    };
  }, [programExpenses]);

  const supplierBreakdown = useMemo(() => {
    const supplierMap = new Map<string, number>();
    filteredData.forEach(item => {
      const current = supplierMap.get(item.category) || 0;
      supplierMap.set(item.category, current + item.value);
    });
    return Array.from(supplierMap.entries())
      .map(([supplier, total]) => ({ supplier, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [filteredData]);

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
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                title="Total COS (Finance)"
                value={`R${(totalCos / 1000000).toFixed(2)}M`}
                subValue={`${pivotData.rows.length} categories, ${pivotData.months.length} months`}
                icon={CreditCard}
                data-testid="card-total-cos"
              />
              <SummaryCard
                title="Paid vs Budget"
                value={`R${(expenseMetrics.totalPaid / 1000000).toFixed(2)}M`}
                subValue={`of R${(expenseMetrics.totalBudget / 1000000).toFixed(2)}M budgeted (${expenseMetrics.variance.toFixed(0)}%)`}
                icon={TrendingDown}
                data-testid="card-paid-budget"
              />
              <SummaryCard
                title="At Risk Lines"
                value={expenseMetrics.atRiskCount}
                subValue={expenseMetrics.overdue > 0 ? `R${(expenseMetrics.overdue / 1000000).toFixed(2)}M overdue` : "All on track"}
                icon={AlertTriangle}
                className={expenseMetrics.atRiskCount > 0 ? "border-l-red-500" : "border-l-emerald-500"}
                data-testid="card-at-risk"
              />
              <SummaryCard
                title="Top Suppliers"
                value={supplierBreakdown.length}
                subValue={supplierBreakdown.length > 0 ? `Top: ${supplierBreakdown[0]?.supplier}` : "No data"}
                icon={Users}
                data-testid="card-top-suppliers"
              />
            </div>

            {projectBreakdown.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Top Projects by COS</CardTitle>
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
                <CardTitle>Line-Level COS Data (Expenditures)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Line Item</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Payment Date</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {programExpenses.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                            No expense data available
                          </TableCell>
                        </TableRow>
                      ) : (
                        programExpenses.slice(0, 100).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{item.projectName}</TableCell>
                            <TableCell>{item.expenseCategory || '-'}</TableCell>
                            <TableCell className="max-w-[200px] truncate">{item.expenseLineItem || '-'}</TableCell>
                            <TableCell className="font-mono text-rose-700">
                              R{item.expenseActualTotal?.toLocaleString() || '-'}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{item.expensePoNumber || '-'}</TableCell>
                            <TableCell>
                              {item.expensePaymentDate ? format(parseISO(item.expensePaymentDate), "dd MMM yyyy") : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={item.expensePaymentDate ? "default" : "outline"} className={item.expensePaymentDate ? "bg-rose-600" : ""}>
                                {item.expensePaymentDate ? "Paid" : "Pending"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {programExpenses.length > 100 && (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      Showing first 100 of {programExpenses.length} records
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

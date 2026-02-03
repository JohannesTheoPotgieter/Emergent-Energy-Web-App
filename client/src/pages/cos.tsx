import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { DateRangeBar } from "@/components/DateRangeBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { format, parseISO } from "date-fns";
import { CreditCard, TrendingDown, AlertTriangle, Users, ArrowRight, RefreshCw } from "lucide-react";
import { formatRand, formatPercent, safeNumber } from "@/lib/safeMoney";

interface CosApiResponse {
  lastRefresh: string | null;
  fyRange: { start: string; end: string; label: string };
  filterRange: { start: string; end: string };
  kpis: {
    totalCosRealised: number;
    cashPaid: number;
    outstandingCos: number;
    paidVsBudget: number;
    totalBudget: number;
    atRiskCount: number;
    supplierCount: number;
  };
  topProjects: Array<{ project: string; total: number }>;
  topSuppliers: Array<{ supplier: string; total: number }>;
  monthlyCosMatrix: {
    months: string[];
    rows: Array<Record<string, string | number>>;
  };
}

export default function CosTracker() {
  const [, setLocation] = useLocation();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  const { data, isLoading } = useQuery<CosApiResponse>({
    queryKey: ["/api/program/cos", selectedProject, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProject) params.set("project", selectedProject);
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate);
      const url = `/api/program/cos${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch COS data");
      return res.json();
    },
    staleTime: 30000,
  });

  const kpis = data?.kpis;
  const topProjects = data?.topProjects || [];
  const topSuppliers = data?.topSuppliers || [];
  const monthlyCosMatrix = data?.monthlyCosMatrix || { months: [], rows: [] };

  return (
    <div className="space-y-0">
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-heading font-bold text-foreground">Cost of Sales Tracker (COS)</h2>
          <p className="text-muted-foreground">
            COS recognition based on Invoice Number + Invoice Raised Date • {data?.fyRange?.label || 'FY26'}
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
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            Loading COS data...
          </div>
        ) : !data ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <p className="text-lg font-medium">No COS data available</p>
                <p className="text-sm mt-2">Upload tracker files with Expenditure Breakdown sheets to see data here</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                title="COS Realised (FY)"
                value={formatRand(kpis?.totalCosRealised, { compact: true })}
                subValue={`${monthlyCosMatrix.rows.length} categories`}
                icon={CreditCard}
                data-testid="card-total-cos"
              />
              <SummaryCard
                title="Cash Paid"
                value={formatRand(kpis?.cashPaid, { compact: true })}
                subValue={`${formatPercent(kpis?.paidVsBudget || 0)} of R${formatRand(kpis?.totalBudget, { compact: true }).replace('R', '')} budget`}
                icon={TrendingDown}
                data-testid="card-paid-budget"
              />
              <SummaryCard
                title="Outstanding COS"
                value={formatRand(kpis?.outstandingCos, { compact: true })}
                subValue={safeNumber(kpis?.atRiskCount) > 0 ? `${kpis?.atRiskCount} at-risk lines` : "All on track"}
                icon={AlertTriangle}
                className={safeNumber(kpis?.atRiskCount) > 0 ? "border-l-red-500" : "border-l-emerald-500"}
                data-testid="card-outstanding-cos"
              />
              <SummaryCard
                title="Suppliers"
                value={kpis?.supplierCount || 0}
                subValue={topSuppliers.length > 0 ? `Top: ${topSuppliers[0]?.supplier}` : "No data"}
                icon={Users}
                data-testid="card-top-suppliers"
              />
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {topProjects.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Top 10 Projects by COS</CardTitle>
                    <CardDescription>Click to drill down into project details</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {topProjects.map(({ project, total }, idx) => (
                        <div
                          key={project}
                          className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => setLocation(`/project/${encodeURIComponent(project + "_Tracker")}`)}
                          data-testid={`project-row-${idx}`}
                        >
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0 text-xs">
                              {idx + 1}
                            </Badge>
                            <span className="font-medium">{project}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{formatRand(total, { compact: true })}</span>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {topSuppliers.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Top 10 Suppliers by COS</CardTitle>
                    <CardDescription>Supplier extracted from Invoice/PO numbers</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {topSuppliers.map(({ supplier, total }, idx) => (
                        <div
                          key={supplier}
                          className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                          data-testid={`supplier-row-${idx}`}
                        >
                          <div className="flex items-center gap-3">
                            <Badge variant="secondary" className="w-6 h-6 flex items-center justify-center p-0 text-xs">
                              {idx + 1}
                            </Badge>
                            <span className="font-medium truncate max-w-[200px]">{supplier}</span>
                          </div>
                          <span className="font-mono">{formatRand(total, { compact: true })}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Monthly COS by Category</CardTitle>
                <CardDescription>
                  Data range: {data?.filterRange?.start && format(parseISO(data.filterRange.start), "MMM yyyy")} - {data?.filterRange?.end && format(parseISO(data.filterRange.end), "MMM yyyy")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-bold sticky left-0 bg-background z-10">Category</TableHead>
                        {monthlyCosMatrix.months.map(month => (
                          <TableHead key={month} className="text-right font-bold whitespace-nowrap">
                            {format(parseISO(month + "-01"), "MMM yy")}
                          </TableHead>
                        ))}
                        <TableHead className="text-right font-bold bg-rose-50">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthlyCosMatrix.rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={monthlyCosMatrix.months.length + 2} className="text-center text-muted-foreground py-8">
                            No monthly COS data available for the selected period
                          </TableCell>
                        </TableRow>
                      ) : (
                        monthlyCosMatrix.rows.map((row, idx) => (
                          <TableRow key={String(row.category)} className={idx % 2 === 0 ? "" : "bg-muted/30"}>
                            <TableCell className="font-medium sticky left-0 bg-background z-10">
                              {String(row.category)}
                            </TableCell>
                            {monthlyCosMatrix.months.map(month => (
                              <TableCell key={month} className="text-right font-mono text-sm">
                                {safeNumber(row[month]) > 0 
                                  ? formatRand(row[month], { compact: true, decimals: 0 })
                                  : <span className="text-muted-foreground">—</span>
                                }
                              </TableCell>
                            ))}
                            <TableCell className="text-right font-mono font-bold bg-rose-50">
                              {formatRand(row.total, { compact: true })}
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
                <CardTitle>COS Recognition Rules</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-lg border bg-blue-50/50 dark:bg-blue-950/20">
                    <Badge variant="outline" className="mb-2">Planned</Badge>
                    <p className="text-sm text-muted-foreground">Line exists with budget values, no PO issued yet</p>
                  </div>
                  <div className="p-4 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20">
                    <Badge variant="secondary" className="mb-2">Committed</Badge>
                    <p className="text-sm text-muted-foreground">PO number exists, goods/services ordered</p>
                  </div>
                  <div className="p-4 rounded-lg border bg-purple-50/50 dark:bg-purple-950/20">
                    <Badge className="mb-2 bg-purple-600">Invoiced (COS)</Badge>
                    <p className="text-sm text-muted-foreground">Invoice Number AND Invoice Raised Date both present</p>
                  </div>
                  <div className="p-4 rounded-lg border bg-green-50/50 dark:bg-green-950/20">
                    <Badge className="mb-2 bg-green-600">Paid</Badge>
                    <p className="text-sm text-muted-foreground">Payment Date exists - cash has left the bank</p>
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

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, Clock, AlertCircle } from "lucide-react";

interface RevenueTrackingTabProps {
  projectName: string;
}

export function RevenueTrackingTab({ projectName }: RevenueTrackingTabProps) {
  const { data: revenues = [], isLoading, error } = useQuery({
    queryKey: ["program-inflows", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/program-inflows?projectName=${encodeURIComponent(projectName)}`);
      if (!res.ok) throw new Error("Failed to fetch revenue data");
      return res.json();
    },
    enabled: !!projectName,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <p className="text-center text-destructive">Failed to load revenue tracking data</p>
        </CardContent>
      </Card>
    );
  }

  const revenueList = Array.isArray(revenues) ? revenues.filter((r: any) => 
    r.milestoneNo && !r.milestoneName?.includes("[") && r.milestoneName !== "KEY: "
  ) : [];

  const formatCurrency = (amount: any) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return "-";
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
  };

  const formatDate = (dateStr: any) => {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return "-";
    }
  };

  const getPaymentStatus = (rec: any) => {
    if (rec.paymentReceivedDate) return "received";
    if (rec.invoiceRaisedDate) return "invoiced";
    if (rec.plannedPaymentDate) return "planned";
    return "pending";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue Tracking</CardTitle>
        <CardDescription>
          Milestone-based revenue from Revenue Tracking sheet • {revenueList.length} milestones • Read-only view
        </CardDescription>
      </CardHeader>
      <CardContent>
        {revenueList.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No revenue tracking data available for this project
          </p>
        ) : (
          <div className="rounded-md border overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Planned Date</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Invoiced</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenueList.map((rev: any, idx: number) => {
                  const status = getPaymentStatus(rev);
                  return (
                    <TableRow key={rev.id || idx}>
                      <TableCell className="font-mono text-sm">{rev.milestoneNo || "-"}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate" title={rev.milestoneName}>
                        {rev.milestoneName || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {rev.milestonePercent ? `${(parseFloat(rev.milestonePercent) * 100).toFixed(0)}%` : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(rev.milestoneAmount)}
                      </TableCell>
                      <TableCell>{formatDate(rev.plannedPaymentDate)}</TableCell>
                      <TableCell className="font-mono text-sm">{rev.milestoneInvoiceNumber || "-"}</TableCell>
                      <TableCell>{formatDate(rev.invoiceRaisedDate)}</TableCell>
                      <TableCell>{formatDate(rev.paymentReceivedDate)}</TableCell>
                      <TableCell>
                        {status === "received" ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                            <CheckCircle className="h-3 w-3 mr-1" /> Received
                          </Badge>
                        ) : status === "invoiced" ? (
                          <Badge variant="outline" className="text-blue-600 border-blue-300">
                            <Clock className="h-3 w-3 mr-1" /> Invoiced
                          </Badge>
                        ) : status === "planned" ? (
                          <Badge variant="outline">
                            <Clock className="h-3 w-3 mr-1" /> Planned
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <AlertCircle className="h-3 w-3 mr-1" /> Pending
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

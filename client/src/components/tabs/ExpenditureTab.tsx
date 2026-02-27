import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, Clock } from "lucide-react";

interface ExpenditureTabProps {
  projectName: string;
}

export function ExpenditureTab({ projectName }: ExpenditureTabProps) {
  const { data: expenses = [], isLoading, error } = useQuery({
    queryKey: ["program-expenses", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/program-expenses?projectName=${encodeURIComponent(projectName)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch expenditure data");
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
          <p className="text-center text-destructive">Failed to load expenditure data</p>
        </CardContent>
      </Card>
    );
  }

  const expenseList = Array.isArray(expenses) ? expenses.filter((e: any) => 
    e.expenseCategory && e.expenseLineItem && !e.expenseLineItem.includes("[")
  ) : [];

  const formatCurrency = (amount: any) => {
    const num = parseFloat(amount);
    if (isNaN(num) || num === 0) return "-";
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expenditure Breakdown</CardTitle>
        <CardDescription>
          Cost items from Expenditure Breakdown sheet • {expenseList.length} line items • Read-only view
        </CardDescription>
      </CardHeader>
      <CardContent>
        {expenseList.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No expenditure data available for this project
          </p>
        ) : (
          <div className="rounded-md border overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Line Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate/Unit</TableHead>
                  <TableHead className="text-right">Actual Total</TableHead>
                  <TableHead>PO #</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Invoiced Date</TableHead>
                  <TableHead>Payment Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenseList.map((exp: any, idx: number) => {
                  const isPaid = !!exp.expensePaymentDate;
                  const isInvoiced = !!exp.expenseInvoicedDate;
                  const isCategoryHeader = !exp.expenseLineItem || exp.expenseLineItem === exp.expenseCategory;
                  
                  return (
                    <TableRow key={exp.id || idx} className={isCategoryHeader ? "bg-muted/50" : ""}>
                      <TableCell className="font-medium text-sm max-w-[180px] truncate" title={exp.expenseCategory}>
                        {exp.expenseCategory || "-"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" title={exp.expenseLineItem}>
                        {exp.expenseLineItem || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {exp.expenseQty || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(exp.expenseRateUnit)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(exp.expenseActualTotal)}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{exp.expensePoNumber || "-"}</TableCell>
                      <TableCell className="font-mono text-sm">{exp.expenseInvoiceNumber || "-"}</TableCell>
                      <TableCell className="text-sm">{formatDate(exp.expenseInvoicedDate)}</TableCell>
                      <TableCell className="text-sm">{formatDate(exp.expensePaymentDate)}</TableCell>
                      <TableCell>
                        {isPaid ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                            <CheckCircle className="h-3 w-3 mr-1" /> Paid
                          </Badge>
                        ) : isInvoiced ? (
                          <Badge variant="outline" className="text-blue-600 border-blue-300">
                            <Clock className="h-3 w-3 mr-1" /> Invoiced
                          </Badge>
                        ) : exp.expenseActualTotal ? (
                          <Badge variant="outline">Pending</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
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

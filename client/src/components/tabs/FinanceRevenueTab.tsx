import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface FinanceRevenueTabProps {
  projectName: string;
}

export function FinanceRevenueTab({ projectName }: FinanceRevenueTabProps) {
  const { data: monthlyRevenue, isLoading, error } = useQuery({
    queryKey: [`/api/finance-revenue/${projectName}`],
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
          <p className="text-center text-destructive">Failed to load Finance-Revenue data</p>
        </CardContent>
      </Card>
    );
  }

  const revenueData = monthlyRevenue || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finance - Revenue</CardTitle>
        <CardDescription>
          Monthly revenue breakdown from Finance-Revenue sheet • Read-only view
        </CardDescription>
      </CardHeader>
      <CardContent>
        {revenueData.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No Finance-Revenue data available for this project
          </p>
        ) : (
          <div className="rounded-md border overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenueData.map((item: any, idx: number) => (
                  <TableRow key={item.id || idx}>
                    <TableCell className="font-medium">{item.category || "-"}</TableCell>
                    <TableCell>{item.month ? new Date(item.month).toLocaleDateString() : "-"}</TableCell>
                    <TableCell className="text-right font-mono">
                      ${Number(item.amount || 0).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

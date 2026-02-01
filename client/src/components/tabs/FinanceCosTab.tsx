import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface FinanceCosTabProps {
  projectName: string;
}

export function FinanceCosTab({ projectName }: FinanceCosTabProps) {
  const { data: monthlyCos, isLoading, error } = useQuery({
    queryKey: [`/api/finance-cos/${projectName}`],
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
          <p className="text-center text-destructive">Failed to load Finance-COS data</p>
        </CardContent>
      </Card>
    );
  }

  const cosData = monthlyCos || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finance - COS</CardTitle>
        <CardDescription>
          Monthly cost of sales from Finance-COS sheet • Read-only view
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cosData.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No Finance-COS data available for this project
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
                {cosData.map((item: any, idx: number) => (
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

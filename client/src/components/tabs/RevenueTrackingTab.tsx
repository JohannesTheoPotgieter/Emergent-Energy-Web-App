import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface RevenueTrackingTabProps {
  projectName: string;
}

export function RevenueTrackingTab({ projectName }: RevenueTrackingTabProps) {
  const { data: revenues, isLoading, error } = useQuery({
    queryKey: [`/api/program-inflows/${projectName}`],
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

  const revenueList = revenues || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue Tracking</CardTitle>
        <CardDescription>
          Revenue entries from Revenue Tracking sheet • Read-only view
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
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenueList.map((rev: any, idx: number) => (
                  <TableRow key={rev.id || idx}>
                    <TableCell>{rev.date ? new Date(rev.date).toLocaleDateString() : "-"}</TableCell>
                    <TableCell className="font-medium">{rev.category || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{rev.description || "-"}</TableCell>
                    <TableCell className="text-right font-mono">
                      ${Number(rev.amount || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{rev.source || "-"}</TableCell>
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

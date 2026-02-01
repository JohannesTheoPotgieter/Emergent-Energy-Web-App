import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface ExpenditureTabProps {
  projectName: string;
}

export function ExpenditureTab({ projectName }: ExpenditureTabProps) {
  const { data: expenses, isLoading, error } = useQuery({
    queryKey: [`/api/program-expenses/${projectName}`],
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

  const expenseList = expenses || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expenditure Breakdown</CardTitle>
        <CardDescription>
          Expenditure entries from Expenditure Breakdown sheet • Read-only view
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
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Vendor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenseList.map((exp: any, idx: number) => (
                  <TableRow key={exp.id || idx}>
                    <TableCell>{exp.date ? new Date(exp.date).toLocaleDateString() : "-"}</TableCell>
                    <TableCell className="font-medium">{exp.category || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{exp.description || "-"}</TableCell>
                    <TableCell className="text-right font-mono">
                      ${Number(exp.amount || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{exp.vendor || "-"}</TableCell>
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

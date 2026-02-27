import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface FinanceCosTabProps {
  projectName: string;
}

export function FinanceCosTab({ projectName }: FinanceCosTabProps) {
  const { data: monthlyCos = [], isLoading, error } = useQuery({
    queryKey: ["finance-cos", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/finance/cos?projectName=${encodeURIComponent(projectName)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch finance COS data");
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
          <p className="text-center text-destructive">Failed to load Finance-COS data</p>
        </CardContent>
      </Card>
    );
  }

  const cosData = Array.isArray(monthlyCos) ? monthlyCos : [];

  const formatCurrency = (amount: any) => {
    const num = parseFloat(amount);
    if (isNaN(num) || num === 0) return "-";
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
  };

  const formatMonth = (dateStr: any) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
    } catch {
      return "-";
    }
  };

  const categories = Array.from(new Set(cosData.map((r: any) => r.category)));
  const months = Array.from(new Set(cosData.map((r: any) => r.monthEndDate))).sort();

  const pivotedData = categories.map(category => {
    const row: any = { category };
    months.forEach(month => {
      const item = cosData.find((r: any) => r.category === category && r.monthEndDate === month);
      row[month as string] = item?.value;
    });
    return row;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finance - Cost of Sales</CardTitle>
        <CardDescription>
          Monthly COS breakdown by category • {cosData.length} entries • Read-only view
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
                  <TableHead className="sticky left-0 bg-background">Category</TableHead>
                  {months.map((month: any) => (
                    <TableHead key={month} className="text-right whitespace-nowrap">
                      {formatMonth(month)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pivotedData.map((row: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium sticky left-0 bg-background">{row.category}</TableCell>
                    {months.map((month: any) => (
                      <TableCell key={month} className="text-right font-mono text-sm">
                        {formatCurrency(row[month])}
                      </TableCell>
                    ))}
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

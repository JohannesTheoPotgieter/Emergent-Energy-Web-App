import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout, TableLayout } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

export default function EngineeringMonthlyReportHistory() {
  const [, navigate] = useLocation();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/reports/engineering/monthly/history"],
    queryFn: async () => {
      const res = await fetch("/api/reports/engineering/monthly/history", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load report history");
      return res.json();
    },
  });

  const statusColors: Record<string, string> = {
    draft: "bg-amber-100 text-amber-800",
    reviewed: "bg-blue-100 text-blue-800",
    published: "bg-emerald-100 text-emerald-800",
  };

  const history = data?.data || [];

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <div className="p-4 md:p-6"><PageError title="Unable to load engineering report history" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></div>;

  const subtitle = history.length === 0
    ? "No reports generated yet"
    : `${history.length} report${history.length !== 1 ? "s" : ""} in history`;

  const emptyRow = (
    <TableRow>
      <TableCell colSpan={6} className="py-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">No reports generated yet</p>
      </TableCell>
    </TableRow>
  );

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Generated</TableHead>
          <TableHead>Reviewed By</TableHead>
          <TableHead>Published By</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.length === 0 ? emptyRow : history.map((h: any) => (
          <TableRow key={h.id} data-testid={`row-eng-report-${h.id}`}>
            <TableCell className="font-medium">{h.reportMonth}</TableCell>
            <TableCell>
              <Badge variant="outline" className={`text-xs ${statusColors[h.status] || ""}`}>{h.status}</Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(h.generatedAt).toLocaleString("en-ZA")}
            </TableCell>
            <TableCell className="text-xs">
              {h.reviewedByName || "—"}
              {h.reviewedAt && <span className="text-muted-foreground ml-1">({new Date(h.reviewedAt).toLocaleDateString("en-ZA")})</span>}
            </TableCell>
            <TableCell className="text-xs">
              {h.publishedByName || "—"}
              {h.publishedAt && <span className="text-muted-foreground ml-1">({new Date(h.publishedAt).toLocaleDateString("en-ZA")})</span>}
            </TableCell>
            <TableCell>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate(`/reports/engineering/monthly?month=${h.reportMonth}`)} data-testid={`btn-view-eng-${h.id}`}>
                View
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <PageLayout
      data-testid="engineering-monthly-report-history-page"
      header={
        <PageHeader
          title="Engineering Report History"
          subtitle={subtitle}
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/reports/engineering/monthly")}
              data-testid="btn-back-eng-monthly"
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Eng Monthly Report
            </Button>
          }
        />
      }
    >
      <TableLayout table={table} />
    </PageLayout>
  );
}

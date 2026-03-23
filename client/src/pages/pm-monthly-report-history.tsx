import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function PmMonthlyReportHistory() {
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/pm/monthly/history"],
    queryFn: async () => {
      const res = await fetch("/api/reports/pm/monthly/history", { headers: getAuthHeaders() });
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

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/reports/pm/monthly")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-2xl font-bold">PM Report History</h1>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[30vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Month</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium">Generated</th>
                <th className="text-left px-4 py-2.5 font-medium">Reviewed By</th>
                <th className="text-left px-4 py-2.5 font-medium">Published By</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No reports generated yet</td></tr>
              ) : history.map((h: any) => (
                <tr key={h.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{h.reportMonth}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className={`text-xs ${statusColors[h.status] || ""}`}>{h.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {new Date(h.generatedAt).toLocaleString("en-ZA")}
                    {h.regeneratedAt && <span className="ml-2">(regen: {new Date(h.regeneratedAt).toLocaleString("en-ZA")})</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {h.reviewedByName || "—"}
                    {h.reviewedAt && <span className="text-muted-foreground ml-1">({new Date(h.reviewedAt).toLocaleDateString("en-ZA")})</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {h.publishedByName || "—"}
                    {h.publishedAt && <span className="text-muted-foreground ml-1">({new Date(h.publishedAt).toLocaleDateString("en-ZA")})</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate(`/reports/pm/monthly?month=${h.reportMonth}`)}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

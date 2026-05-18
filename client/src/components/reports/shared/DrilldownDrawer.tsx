import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

type DrillContext = {
  tab?: string;
  metric?: string;
  projectId?: number;
  status?: string;
  owner?: string;
  category?: string;
  riskPriority?: string;
  supplier?: string;
  approvalState?: string;
  dateFrom?: string;
  dateTo?: string;
};

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

export default function DrilldownDrawer({
  open,
  onOpenChange,
  title,
  endpoint,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  endpoint: string;
  context: DrillContext;
}) {
  const [sortKey, setSortKey] = useState<string>("");

  const queryParams = useMemo(() => {
    const q = new URLSearchParams();
    Object.entries(context).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).length > 0) q.set(k, String(v));
    });
    return q.toString();
  }, [context]);

  const { data, isLoading, error } = useQuery<{
    rows?: Array<Record<string, unknown>>;
    aggregates?: { rowCount?: number };
    appliedFilters?: Record<string, unknown>;
  }>({
    queryKey: ["report-drilldown", endpoint, queryParams],
    enabled: open,
    queryFn: async () => {
      const res = await fetch(`${endpoint}?${queryParams}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load drilldown");
      return res.json();
    },
  });

  const rows = useMemo(() => {
    const list = [...(data?.rows || [])];
    if (!sortKey) return list;
    return list.sort((a, b) => String(a?.[sortKey] ?? "").localeCompare(String(b?.[sortKey] ?? "")));
  }, [data?.rows, sortKey]);

  const exportExcel = async () => {
    const res = await fetch(`${endpoint}?${queryParams}&format=xlsx`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `${title.replace(/\s+/g, "_")}_drilldown.xlsx`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const columns = Object.keys(rows[0] || {});

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[960px] w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Rows: {data?.aggregates?.rowCount ?? 0}</span>
          <Button size="sm" variant="outline" onClick={exportExcel}>Export drill result (Excel)</Button>
        </div>

        {!!data?.appliedFilters && (
          <div className="mt-2 text-xs text-muted-foreground">Filters: {JSON.stringify(data.appliedFilters)}</div>
        )}

        {error && <div className="text-xs text-red-600 mt-3">{(error as Error).message}</div>}
        {isLoading ? <div className="text-xs text-muted-foreground mt-3">Loading drill-through...</div> : (
          <div className="mt-3 border rounded-lg overflow-auto max-h-[70vh]">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {columns.map(c => <th key={c} className="text-left px-2 py-2 cursor-pointer" onClick={() => setSortKey(c)}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? <tr><td className="p-4" colSpan={columns.length || 1}>No rows found.</td></tr> : rows.map((r, i) => (
                  <tr key={i} className="border-b">
                    {columns.map(c => <td key={c} className="px-2 py-1.5">{String(r[c] ?? "—")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

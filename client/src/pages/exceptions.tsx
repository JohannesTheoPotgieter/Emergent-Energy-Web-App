import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ExceptionItem = {
  id: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  owner: string;
  dueDate: string | null;
  project: string;
  sourceLink: string;
  reason: string;
};

type ExceptionResponse = {
  roleCluster: string;
  items: ExceptionItem[];
  taxonomy: string[];
  summary: {
    total: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
  };
};

const severityTone: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

function fetchExceptions(): Promise<ExceptionResponse> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch("/api/exceptions", { credentials: "include", headers }).then(async (res) => {
    if (!res.ok) throw new Error("Failed to load exceptions");
    return res.json();
  });
}

export default function ExceptionsPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["exceptions-page"], queryFn: fetchExceptions });

  const groupedBySeverity = useMemo(() => {
    const order = ["critical", "high", "medium", "low"];
    const groups = new Map<string, ExceptionItem[]>();
    for (const severity of order) groups.set(severity, []);
    for (const item of data?.items || []) groups.get(item.severity)?.push(item);
    return order.map((severity) => ({ severity, items: groups.get(severity) || [] }));
  }, [data?.items]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<string, ExceptionItem[]>();
    for (const item of data?.items || []) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [data?.items]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card className="border-red-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl"><ShieldAlert className="h-5 w-5 text-red-600" />Exception Command Center</CardTitle>
          <p className="text-sm text-muted-foreground">Only what needs intervention now. Role-scoped, severity-ranked, deeply actionable.</p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-4">
          {["critical", "high", "medium", "low"].map((severity) => (
            <div key={severity} className="rounded-md border p-2">
              <p className="text-xs uppercase text-muted-foreground">{severity}</p>
              <p className="text-lg font-semibold">{data?.summary?.bySeverity?.[severity] || 0}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading exceptions…</p> : null}
      {isError ? <p className="text-sm text-red-600">Could not load exceptions.</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">By severity</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {groupedBySeverity.map((group) => (
              <div key={group.severity} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Badge className={severityTone[group.severity]}>{group.severity.toUpperCase()}</Badge>
                  <span className="text-xs text-muted-foreground">{group.items.length} item(s)</span>
                </div>
                {group.items.slice(0, 6).map((item) => (
                  <Link key={item.id} href={item.sourceLink} className="flex items-start justify-between rounded-md border p-2 hover:bg-muted/40">
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.project} · Owner: {item.owner} · {item.reason}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By category</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {groupedByCategory.map(([category, items]) => (
              <div key={category} className="rounded-md border p-2">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-sm font-medium">{category.replace(/_/g, " ")}</p>
                  <Badge variant="outline">{items.length}</Badge>
                </div>
                {items.slice(0, 3).map((item) => (
                  <Link key={item.id} href={item.sourceLink} className="mt-1 flex items-center justify-between rounded border border-transparent px-2 py-1 hover:border-slate-200 hover:bg-slate-50">
                    <span className="text-xs">{item.title}</span>
                    {item.severity === "critical" ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> : null}
                  </Link>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

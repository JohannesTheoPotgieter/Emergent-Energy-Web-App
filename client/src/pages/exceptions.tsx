import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, ShieldAlert, Search, Filter, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";

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
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Derive filter options from data
  const filterOptions = useMemo(() => {
    const items = data?.items || [];
    const owners = Array.from(new Set(items.map((i) => i.owner).filter(Boolean))).sort();
    const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort();
    return { owners, categories };
  }, [data?.items]);

  // Apply filters
  const filteredItems = useMemo(() => {
    let items = data?.items || [];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((i) =>
        i.title.toLowerCase().includes(q) ||
        i.project.toLowerCase().includes(q) ||
        i.owner.toLowerCase().includes(q) ||
        i.reason.toLowerCase().includes(q)
      );
    }
    if (severityFilter !== "all") items = items.filter((i) => i.severity === severityFilter);
    if (ownerFilter !== "all") items = items.filter((i) => i.owner === ownerFilter);
    if (categoryFilter !== "all") items = items.filter((i) => i.category === categoryFilter);
    return items;
  }, [data?.items, search, severityFilter, ownerFilter, categoryFilter]);

  const hasActiveFilters = search || severityFilter !== "all" || ownerFilter !== "all" || categoryFilter !== "all";

  // Recompute summary from filtered items
  const filteredSummary = useMemo(() => {
    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const item of filteredItems) {
      bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
      byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    }
    return { total: filteredItems.length, bySeverity, byCategory };
  }, [filteredItems]);

  const groupedBySeverity = useMemo(() => {
    const order = ["critical", "high", "medium", "low"];
    const groups = new Map<string, ExceptionItem[]>();
    for (const severity of order) groups.set(severity, []);
    for (const item of filteredItems) groups.get(item.severity)?.push(item);
    return order.map((severity) => ({ severity, items: groups.get(severity) || [] }));
  }, [filteredItems]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<string, ExceptionItem[]>();
    for (const item of filteredItems) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filteredItems]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card className="border-red-100">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl"><ShieldAlert className="h-5 w-5 text-red-600" />Exception Command Center</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {hasActiveFilters
                  ? `${filteredSummary.total} of ${data?.summary?.total || 0} exceptions matching filters`
                  : "Only what needs intervention now. Role-scoped, severity-ranked, deeply actionable."}
              </p>
            </div>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSearch(""); setSeverityFilter("all"); setOwnerFilter("all"); setCategoryFilter("all"); }}
                className="gap-1.5 text-muted-foreground"
              >
                <RotateCcw className="w-3.5 h-3.5" />Clear filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            {["critical", "high", "medium", "low"].map((severity) => (
              <button
                key={severity}
                onClick={() => setSeverityFilter(severityFilter === severity ? "all" : severity)}
                className={`rounded-md border p-2 text-left transition-colors cursor-pointer ${severityFilter === severity ? severityTone[severity] : "hover:bg-muted/30"}`}
              >
                <p className="text-xs uppercase text-muted-foreground">{severity}</p>
                <p className="text-lg font-semibold">{filteredSummary.bySeverity[severity] || 0}</p>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search exceptions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <SearchableSelect
              value={ownerFilter}
              onValueChange={setOwnerFilter}
              placeholder="Owner"
              options={[{ value: "all", label: "All Owners" }, ...filterOptions.owners.map((v) => ({ value: v, label: v }))]}
            />
            <SearchableSelect
              value={categoryFilter}
              onValueChange={setCategoryFilter}
              placeholder="Category"
              options={[{ value: "all", label: "All Categories" }, ...filterOptions.categories.map((v) => ({ value: v, label: v.replace(/_/g, " ") }))]}
            />
          </div>
        </CardContent>
      </Card>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading exceptions...</p> : null}
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

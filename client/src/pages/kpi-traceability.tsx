import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Database, Code, Monitor, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface KpiItem {
  sourceLayer: string;
  businessRule: string;
  aggregationPath: string;
  id: string;
  name: string;
  currentValue: number;
  sourceTable: string;
  sourceFields: string;
  formula: string;
  apiEndpoint: string;
  consumingComponent: string;
  lastComputed: string;
}

interface KpiResponse {
  kpis: KpiItem[];
  generatedAt: string;
  totalKpis: number;
}

function formatValue(id: string, value: number): string {
  if (id.includes("margin") || id.includes("pct") || id.includes("progress") || id.includes("pass_rate")) {
    return `${value}%`;
  }
  if (id.includes("revenue") || id.includes("cos") || id.includes("gp_") || id.includes("cashflow") || id.includes("expenditure") || id.includes("inflow_total")) {
    return `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return value.toLocaleString();
}

function getCategory(id: string): string {
  if (id.startsWith("revenue") || id.startsWith("inflow")) return "Revenue";
  if (id.startsWith("cos")) return "COS";
  if (id.startsWith("gp")) return "GP";
  if (id.startsWith("cashflow")) return "Cashflow";
  if (id.startsWith("project")) return "Projects";
  if (id.startsWith("eng")) return "Engineering";
  if (id.startsWith("quality")) return "Quality";
  if (id.startsWith("mywork")) return "My Work";
  if (id.startsWith("portfolio")) return "Portfolios";
  return "Other";
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    Revenue: "bg-emerald-100 text-emerald-800",
    COS: "bg-orange-100 text-orange-800",
    GP: "bg-blue-100 text-blue-800",
    Cashflow: "bg-purple-100 text-purple-800",
    Projects: "bg-slate-100 text-slate-800",
    Engineering: "bg-cyan-100 text-cyan-800",
    Quality: "bg-rose-100 text-rose-800",
    "My Work": "bg-amber-100 text-amber-800",
    Portfolios: "bg-indigo-100 text-indigo-800",
  };
  return colors[category] || "bg-gray-100 text-gray-800";
}

export default function KpiTraceabilityPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery<KpiResponse>({
    queryKey: ["kpi-traceability"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/admin/kpi-traceability", { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch KPI traceability data");
      return res.json();
    },
  });

  const filteredKpis = data?.kpis?.filter((kpi) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      kpi.name.toLowerCase().includes(q) ||
      kpi.sourceTable.toLowerCase().includes(q) ||
      kpi.apiEndpoint.toLowerCase().includes(q) ||
      kpi.consumingComponent.toLowerCase().includes(q) ||
      getCategory(kpi.id).toLowerCase().includes(q)
    );
  }) ?? [];

  const categories = Array.from(new Set(filteredKpis.map((k) => getCategory(k.id))));

  return (
    <div className="space-y-6 p-6" data-testid="page-kpi-traceability">
      <PageHeader
        title="KPI Traceability"
        subtitle="Full traceability of every headline number — including source layer, business rule, aggregation path, API endpoint, and consuming UI component."
      />

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-kpi-search"
            placeholder="Search KPIs by name, table, endpoint, or component..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          data-testid="button-refresh-kpi"
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        {data && (
          <span className="text-xs text-muted-foreground" data-testid="text-kpi-count">
            {filteredKpis.length} of {data.totalKpis} KPIs
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : (
        categories.map((category) => {
          const categoryKpis = filteredKpis.filter((k) => getCategory(k.id) === category);
          return (
            <Card key={category} data-testid={`card-kpi-category-${category.toLowerCase()}`}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Badge className={getCategoryColor(category)}>{category}</Badge>
                  <span className="text-muted-foreground text-sm">({categoryKpis.length} KPIs)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[200px]">KPI Name</TableHead>
                        <TableHead className="w-[140px] text-right">Current Value</TableHead>
                        <TableHead className="w-[120px]">Source Layer</TableHead>
                        <TableHead className="w-[160px]">
                          <div className="flex items-center gap-1">
                            <Database className="h-3 w-3" />
                            Source Table
                          </div>
                        </TableHead>
                        <TableHead className="w-[140px]">Source Fields</TableHead>
                        <TableHead className="w-[220px]">Business Rule</TableHead>
                        <TableHead className="w-[240px]">
                          <div className="flex items-center gap-1">
                            <Code className="h-3 w-3" />
                            Formula
                          </div>
                        </TableHead>
                        <TableHead className="w-[220px]">Aggregation Path</TableHead>
                        <TableHead className="w-[180px]">API Endpoint</TableHead>
                        <TableHead className="w-[220px]">
                          <div className="flex items-center gap-1">
                            <Monitor className="h-3 w-3" />
                            Consuming Component
                          </div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categoryKpis.map((kpi) => (
                        <TableRow key={kpi.id} data-testid={`row-kpi-${kpi.id}`}>
                          <TableCell className="font-medium text-sm" data-testid={`text-kpi-name-${kpi.id}`}>
                            {kpi.name}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold" data-testid={`text-kpi-value-${kpi.id}`}>
                            {formatValue(kpi.id, kpi.currentValue)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="uppercase text-[10px]">{kpi.sourceLayer}</Badge>
                          </TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                              {kpi.sourceTable}
                            </code>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{kpi.sourceFields}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{kpi.businessRule}</TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                              {kpi.formula}
                            </code>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{kpi.aggregationPath}</TableCell>
                          <TableCell>
                            <code className="text-xs text-blue-600 font-mono">{kpi.apiEndpoint}</code>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{kpi.consumingComponent}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {data && (
        <p className="text-xs text-muted-foreground text-center" data-testid="text-kpi-generated-at">
          Last generated: {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

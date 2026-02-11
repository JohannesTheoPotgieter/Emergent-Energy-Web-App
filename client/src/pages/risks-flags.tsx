import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Search,
  ExternalLink,
  Filter,
} from "lucide-react";
import { Link } from "wouter";

interface DataQualityIssue {
  ruleId: string;
  severity: string;
  description: string;
  count: number;
  items: Array<{
    id: number;
    projectName: string;
    detail: string;
  }>;
}

const severityConfig: Record<string, { icon: any; color: string; badge: string }> = {
  Error: { icon: AlertCircle, color: "text-red-600", badge: "bg-red-100 text-red-700 border-red-200" },
  Warning: { icon: AlertTriangle, color: "text-amber-600", badge: "bg-amber-100 text-amber-700 border-amber-200" },
  Info: { icon: Info, color: "text-blue-600", badge: "bg-blue-100 text-blue-700 border-blue-200" },
};

export default function RisksFlagsPage() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{ issues: DataQualityIssue[] }>({
    queryKey: ["/api/data-quality/scan"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const issues = data?.issues ?? [];

  const flatItems = useMemo(() => {
    const items: Array<{
      ruleId: string;
      severity: string;
      description: string;
      itemId: number;
      projectName: string;
      detail: string;
    }> = [];
    for (const issue of issues) {
      for (const item of issue.items) {
        items.push({
          ruleId: issue.ruleId,
          severity: issue.severity,
          description: issue.description,
          itemId: item.id,
          projectName: item.projectName,
          detail: item.detail,
        });
      }
    }
    return items;
  }, [issues]);

  const filtered = useMemo(() => {
    let result = flatItems;
    if (severityFilter !== "all") {
      result = result.filter(i => i.severity === severityFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.projectName.toLowerCase().includes(q) ||
        i.detail.toLowerCase().includes(q) ||
        i.ruleId.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [flatItems, severityFilter, search]);

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { Error: 0, Warning: 0, Info: 0 };
    for (const item of flatItems) {
      counts[item.severity] = (counts[item.severity] || 0) + 1;
    }
    return counts;
  }, [flatItems]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground" data-testid="loading-indicator">
        Loading risk data...
      </div>
    );
  }

  return (
    <div className="space-y-0" data-testid="risks-flags-page">
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">
          Risks & Flags
        </h2>
        <p className="text-muted-foreground mt-1">
          Data quality issues and actionable risk flags across all projects
        </p>
      </div>

      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-red-50 dark:bg-red-950/30 border-red-200" data-testid="card-error-count">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="h-8 w-8 text-red-600" />
              <div>
                <p className="text-2xl font-bold text-red-700">{severityCounts.Error || 0}</p>
                <p className="text-sm text-red-600 font-medium">Critical / Error</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200" data-testid="card-warning-count">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
              <div>
                <p className="text-2xl font-bold text-amber-700">{severityCounts.Warning || 0}</p>
                <p className="text-sm text-amber-600 font-medium">Warnings</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200" data-testid="card-info-count">
            <CardContent className="p-4 flex items-center gap-3">
              <Info className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-2xl font-bold text-blue-700">{severityCounts.Info || 0}</p>
                <p className="text-sm text-blue-600 font-medium">Info</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by project, invoice #, PO #, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-flags"
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {["all", "Error", "Warning", "Info"].map((sev) => (
              <Button
                key={sev}
                variant={severityFilter === sev ? "default" : "outline"}
                size="sm"
                onClick={() => setSeverityFilter(sev)}
                data-testid={`filter-${sev.toLowerCase()}`}
              >
                {sev === "all" ? "All" : sev}
              </Button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-flags">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-semibold w-24">Severity</th>
                    <th className="px-4 py-3 text-left font-semibold w-20">Rule</th>
                    <th className="px-4 py-3 text-left font-semibold">Flag Type</th>
                    <th className="px-4 py-3 text-left font-semibold">Project</th>
                    <th className="px-4 py-3 text-left font-semibold">Detail</th>
                    <th className="px-4 py-3 text-center font-semibold w-20">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        No flags found matching your criteria
                      </td>
                    </tr>
                  ) : (
                    filtered.slice(0, 200).map((item, i) => {
                      const config = severityConfig[item.severity] || severityConfig.Info;
                      const Icon = config.icon;
                      return (
                        <tr key={`${item.ruleId}-${item.itemId}-${i}`} className="border-b hover:bg-muted/30" data-testid={`row-flag-${i}`}>
                          <td className="px-4 py-2">
                            <Badge className={`${config.badge} text-xs`} variant="outline">
                              <Icon className="h-3 w-3 mr-1" />
                              {item.severity}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{item.ruleId}</td>
                          <td className="px-4 py-2 text-sm">{item.description}</td>
                          <td className="px-4 py-2">
                            <Link
                              href={`/project/${encodeURIComponent(item.projectName)}`}
                              className="text-blue-600 hover:underline text-sm"
                              data-testid={`link-project-${i}`}
                            >
                              {item.projectName.replace('_Tracker', '')}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-sm text-muted-foreground max-w-[300px] truncate" title={item.detail}>
                            {item.detail}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <Link href={`/project/${encodeURIComponent(item.projectName)}`}>
                              <Button variant="ghost" size="sm" data-testid={`button-open-detail-${i}`}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 200 && (
              <div className="p-3 border-t text-center text-sm text-muted-foreground">
                Showing first 200 of {filtered.length} flags. Use search to narrow results.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { useAdminFetch } from "@/hooks/use-admin-fetch";
import { AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { getQueryError } from "./cc-utils";
import type { OpsExceptionsData } from "./cc-types";

const DEFAULT: OpsExceptionsData = {
  unassignedTasks: 0,
  unassignedProjects: 0,
  blockedItems: 0,
  overdueByOwner: [],
};

export function CcOperationalExceptions() {
  const query = useAdminFetch<OpsExceptionsData>(
    "/api/admin/control-center/operational-exceptions",
    ["admin-control-ops-exceptions"],
  );
  const data = query.data ?? DEFAULT;

  return (
    <Card data-testid="card-operational-exceptions">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Operational Exceptions
        </CardTitle>
        <CardDescription>Live management exceptions requiring attention</CardDescription>
      </CardHeader>
      <CardContent>
        <AdminQueryState
          isLoading={query.isLoading}
          error={query.error ? getQueryError(query.error, "Operational exceptions could not be loaded.") : null}
          onRetry={() => { void query.refetch(); }}
          loadingLabel="Loading operational exceptions..."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className={`rounded-lg border p-3 text-center ${data.unassignedTasks > 0 ? "border-red-200 bg-red-50" : "border-border"}`}>
                <p className={`text-2xl font-bold ${data.unassignedTasks > 0 ? "text-red-600" : "text-foreground"}`}>{data.unassignedTasks}</p>
                <p className="text-xs text-muted-foreground">Unassigned Tasks</p>
              </div>
              <div className={`rounded-lg border p-3 text-center ${data.unassignedProjects > 0 ? "border-amber-200 bg-amber-50" : "border-border"}`}>
                <p className={`text-2xl font-bold ${data.unassignedProjects > 0 ? "text-amber-600" : "text-foreground"}`}>{data.unassignedProjects}</p>
                <p className="text-xs text-muted-foreground">Projects Without PM</p>
              </div>
              <div className={`rounded-lg border p-3 text-center ${data.blockedItems > 0 ? "border-orange-200 bg-orange-50" : "border-border"}`}>
                <p className={`text-2xl font-bold ${data.blockedItems > 0 ? "text-orange-600" : "text-foreground"}`}>{data.blockedItems}</p>
                <p className="text-xs text-muted-foreground">Blocked Items</p>
              </div>
              <div className="rounded-lg border p-3 text-center border-border">
                <p className="text-2xl font-bold text-foreground">{data.overdueByOwner.reduce((s, o) => s + o.count, 0)}</p>
                <p className="text-xs text-muted-foreground">Total Overdue</p>
              </div>
            </div>
            {data.overdueByOwner.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Overdue by Owner</p>
                <div className="space-y-1.5">
                  {data.overdueByOwner.map((o, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground truncate">{o.owner || "Unassigned"}</span>
                      <Badge variant="outline" className={o.count > 3 ? "bg-red-50 text-red-700 border-red-200" : ""}>{o.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}

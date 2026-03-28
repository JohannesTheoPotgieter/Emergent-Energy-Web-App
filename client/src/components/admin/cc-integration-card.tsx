import { useAdminFetch } from "@/hooks/use-admin-fetch";
import { AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link2, Wifi, WifiOff, Clock } from "lucide-react";
import { getQueryError } from "./cc-utils";
import type { IntegrationHealthItem } from "./cc-types";

export function CcIntegrationCard() {
  const healthQuery = useAdminFetch<IntegrationHealthItem[]>(
    "/api/admin/control-center/integration-health",
    ["admin-control-integration-health"],
  );
  const items = healthQuery.data ?? [];

  return (
    <Card data-testid="card-integrations">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4 text-violet-600" />
          Microsoft Integration
        </CardTitle>
        <CardDescription>MS365 connectivity and sync status</CardDescription>
      </CardHeader>
      <CardContent>
        <AdminQueryState
          isLoading={healthQuery.isLoading}
          error={healthQuery.error ? getQueryError(healthQuery.error, "Integration health could not be loaded.") : null}
          onRetry={() => { void healthQuery.refetch(); }}
          empty={items.length === 0}
          emptyTitle="No integration data available"
          emptyDescription="Connected Microsoft surfaces will expose sync state here."
          loadingLabel="Loading integration health..."
        >
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.type} className="flex items-center justify-between p-3 rounded-lg border border-border" data-testid={`row-integration-${item.type}`}>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    {item.status === "connected" ? (
                      <Wifi className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <WifiOff className="h-3.5 w-3.5 text-slate-400" />
                    )}
                    <p className="text-sm font-medium">{item.name}</p>
                  </div>
                  {item.lastSyncTime && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 ml-5">
                      <Clock className="h-3 w-3" />
                      Last sync: {new Date(item.lastSyncTime).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{item.objectCount} objects</span>
                  <Badge
                    variant="outline"
                    className={item.status === "connected" ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}
                    data-testid={`status-integration-${item.type}`}
                  >
                    {item.status === "connected" ? "Connected" : "Not Connected"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}

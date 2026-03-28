import { useAdminFetch } from "@/hooks/use-admin-fetch";
import { AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Database, CheckCircle, XCircle } from "lucide-react";
import { getQueryError } from "./cc-utils";
import type { HealthData } from "./cc-types";

const HEALTH_DEFAULT: HealthData = {
  db: { connected: false, host: null, error: null },
  users: 0,
  projects: { total: 0, active: 0 },
  imports: { total: 0, committed: 0, failed: 0, lastRun: null },
  auditEvents: 0,
};

export function CcSystemHealthCard() {
  const healthQuery = useAdminFetch<HealthData>(
    "/api/admin/control-center/health",
    ["admin-control-health"],
  );
  const health = healthQuery.data ?? HEALTH_DEFAULT;

  return (
    <Card data-testid="card-system-health">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4 text-emerald-600" />
          System Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AdminQueryState
          isLoading={healthQuery.isLoading}
          error={healthQuery.error ? getQueryError(healthQuery.error, "System health could not be loaded.") : null}
          onRetry={() => { void healthQuery.refetch(); }}
          loadingLabel="Loading system health..."
        >
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Database</span>
              {health.db.connected ? (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200" data-testid="status-db">
                  <CheckCircle className="h-3 w-3 mr-1" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200" data-testid="status-db">
                  <XCircle className="h-3 w-3 mr-1" /> Disconnected
                </Badge>
              )}
            </div>
            {health.db.host && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Host</span>
                <span className="text-xs font-mono text-muted-foreground">{health.db.host}</span>
              </div>
            )}
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Users</span>
              <span className="text-sm font-medium" data-testid="text-user-count">{health.users}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Projects (active/total)</span>
              <span className="text-sm font-medium" data-testid="text-project-count">
                {health.projects.active} / {health.projects.total}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Audit Events</span>
              <span className="text-sm font-medium" data-testid="text-audit-count">{health.auditEvents}</span>
            </div>
          </>
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}

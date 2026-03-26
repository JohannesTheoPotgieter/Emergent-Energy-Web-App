import { useAdminFetch } from "@/hooks/use-admin-fetch";
import { AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileUp } from "lucide-react";
import { getQueryError } from "./cc-utils";
import type { HealthData, ImportGovernanceData } from "./cc-types";

const GOVERNANCE_DEFAULT: ImportGovernanceData = {
  summary: {
    previewRuns: 0,
    awaitingReviewRuns: 0,
    committedRuns: 0,
    failedRuns: 0,
    rolledBackRuns: 0,
    supersededRuns: 0,
    reviewBacklog: 0,
    pendingExcelConfirmations: 0,
    unresolvedPlanEdits: 0,
    lastRunAt: null,
  },
  recentRuns: [],
  recentAttentionRuns: [],
};

export function CcImportGovernanceCard() {
  const healthQuery = useAdminFetch<HealthData>(
    "/api/admin/control-center/health",
    ["admin-control-health"],
  );
  const governanceQuery = useAdminFetch<ImportGovernanceData>(
    "/api/admin/control-center/import-governance",
    ["admin-control-import-governance"],
  );

  const health = healthQuery.data;
  const governance = governanceQuery.data ?? GOVERNANCE_DEFAULT;

  return (
    <Card data-testid="card-import-stats">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileUp className="h-4 w-4 text-blue-600" />
          Import Governance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AdminQueryState
          isLoading={healthQuery.isLoading || governanceQuery.isLoading}
          error={(healthQuery.error || governanceQuery.error) ? getQueryError(healthQuery.error || governanceQuery.error, "Import governance could not be loaded.") : null}
          onRetry={() => { void healthQuery.refetch(); void governanceQuery.refetch(); }}
          loadingLabel="Loading import governance..."
        >
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Runs</span>
              <span className="text-sm font-medium">{health?.imports.total ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Awaiting Review</span>
              <Badge variant="outline" className={(governance.summary.reviewBacklog || 0) > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}>
                {governance.summary.reviewBacklog ?? 0}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Pending Excel Confirmations</span>
              <Badge variant="outline" className={(governance.summary.pendingExcelConfirmations || 0) > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : ""}>
                {governance.summary.pendingExcelConfirmations ?? 0}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Failed Runs</span>
              <Badge variant="outline" className={(health?.imports.failed ?? 0) > 0 ? "bg-red-50 text-red-700 border-red-200" : ""}>
                {health?.imports.failed ?? 0}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Unresolved Plan Edits</span>
              <span className="text-sm font-medium">{governance.summary.unresolvedPlanEdits ?? 0}</span>
            </div>
            {(governance.summary.lastRunAt || health?.imports.lastRun) && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last Run</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(governance.summary.lastRunAt || health?.imports.lastRun || "").toLocaleString()}
                </span>
              </div>
            )}
          </>
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}

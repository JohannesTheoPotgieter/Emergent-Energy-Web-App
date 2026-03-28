import { useAdminFetch } from "@/hooks/use-admin-fetch";
import { AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileUp, AlertTriangle } from "lucide-react";
import { getQueryError } from "./cc-utils";
import type { ImportFailure, SystemIssue } from "./cc-types";

export function CcRecentEvents() {
  const failuresQuery = useAdminFetch<ImportFailure[]>(
    "/api/admin/control-center/recent-import-failures",
    ["admin-control-import-failures"],
  );
  const issuesQuery = useAdminFetch<SystemIssue[]>(
    "/api/admin/control-center/recent-issues",
    ["admin-control-system-issues"],
  );

  const failures = failuresQuery.data ?? [];
  const issues = issuesQuery.data ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card data-testid="card-import-failures">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileUp className="h-4 w-4 text-red-600" />
            Recent Import Failures
          </CardTitle>
          <CardDescription>Last 10 failed import runs</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminQueryState
            isLoading={failuresQuery.isLoading}
            error={failuresQuery.error ? getQueryError(failuresQuery.error, "Recent import failures could not be loaded.") : null}
            onRetry={() => { void failuresQuery.refetch(); }}
            empty={failures.length === 0}
            emptyTitle="No recent import failures"
            emptyDescription="Failed runs and blocker-heavy imports will appear here for review."
            loadingLabel="Loading recent import failures..."
          >
            <div className="space-y-3">
              {failures.map((failure) => (
                <div key={failure.id} className="p-3 rounded-lg border border-red-100 bg-red-50/30 space-y-1" data-testid={`row-import-failure-${failure.id}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate max-w-[200px]">{failure.projectName}</p>
                    <span className="text-xs text-muted-foreground">
                      {new Date(failure.uploadedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{failure.fileName}</p>
                  {failure.uploadedBy && (
                    <p className="text-xs text-muted-foreground">By: {failure.uploadedBy}</p>
                  )}
                  <div className="flex items-center gap-2">
                    {failure.blockerCount > 0 && (
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                        {failure.blockerCount} blockers
                      </Badge>
                    )}
                    {failure.recordsFailed != null && failure.recordsFailed > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {failure.recordsFailed} records failed
                      </Badge>
                    )}
                  </div>
                  {failure.topError && (
                    <p className="text-xs text-red-600 truncate" data-testid={`text-error-${failure.id}`}>
                      {failure.topError}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </AdminQueryState>
        </CardContent>
      </Card>

      <Card data-testid="card-system-issues">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Recent System Events
          </CardTitle>
          <CardDescription>Administrative and error events</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminQueryState
            isLoading={issuesQuery.isLoading}
            error={issuesQuery.error ? getQueryError(issuesQuery.error, "Recent system events could not be loaded.") : null}
            onRetry={() => { void issuesQuery.refetch(); }}
            empty={issues.length === 0}
            emptyTitle="No recent system events"
            emptyDescription="Administrative errors, recovery actions, and system events will appear here."
            loadingLabel="Loading recent system events..."
          >
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {issues.map((issue) => (
                <div key={issue.id} className="p-2.5 rounded-lg border border-border space-y-0.5" data-testid={`row-system-issue-${issue.id}`}>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">{issue.action}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(issue.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {issue.entityType}{issue.entityId ? ` #${issue.entityId}` : ""}
                    {issue.userName && ` · ${issue.userName}`}
                    {issue.projectName && ` · ${issue.projectName}`}
                  </p>
                  {issue.requestPath && (
                    <p className="text-xs text-muted-foreground font-mono truncate">{issue.requestPath}</p>
                  )}
                </div>
              ))}
            </div>
          </AdminQueryState>
        </CardContent>
      </Card>
    </div>
  );
}

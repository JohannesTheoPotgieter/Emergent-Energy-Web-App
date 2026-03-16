import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminPageShell, AdminQueryState } from "@/components/admin/admin-shell";
import { usePermission } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Activity, FileUp, Edit, Shield, GitMerge, Cpu, Users, Settings, LogIn, Trash2, PenLine,
  ChevronLeft, ChevronRight, Loader2, Search, ArrowRight, Filter, AlertTriangle,
  Download, Calendar, X, User,
} from "lucide-react";

const SOURCE_ICONS: Record<string, any> = {
  IMPORT: FileUp, MANUAL_EDIT: Edit, OVERRIDE: Shield,
  CONFLICT_RESOLUTION: GitMerge, PATTERN_LEARNING: Cpu,
  COUNTERPARTY_UPDATE: Users, SYSTEM: Settings, UI: PenLine,
  SETTINGS: Settings, DOCS: FileUp,
};

const SOURCE_COLORS: Record<string, string> = {
  IMPORT: "bg-blue-100 text-blue-700", MANUAL_EDIT: "bg-green-100 text-green-700",
  OVERRIDE: "bg-amber-100 text-amber-700", CONFLICT_RESOLUTION: "bg-purple-100 text-purple-700",
  PATTERN_LEARNING: "bg-cyan-100 text-cyan-700", COUNTERPARTY_UPDATE: "bg-pink-100 text-pink-700",
  SYSTEM: "bg-muted text-foreground", UI: "bg-emerald-100 text-emerald-700",
  SETTINGS: "bg-orange-100 text-orange-700", DOCS: "bg-indigo-100 text-indigo-700",
};

const ACTION_ICONS: Record<string, any> = {
  login_success: LogIn, login_failed: LogIn, password_changed: Shield,
  DELETE: Trash2, delete: Trash2,
};

function authFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers, credentials: "include" });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("en-ZA", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function buildQueryParams(filters: {
  sourceFilter: string;
  entityTypeFilter: string;
  projectNameFilter: string;
  actionFilter: string;
  userNameFilter: string;
  searchQuery: string;
  fromDate: string;
  toDate: string;
}) {
  const params = new URLSearchParams();
  if (filters.sourceFilter !== "all") params.set("source", filters.sourceFilter);
  if (filters.entityTypeFilter !== "all") params.set("entityType", filters.entityTypeFilter);
  if (filters.projectNameFilter !== "all") params.set("projectName", filters.projectNameFilter);
  if (filters.actionFilter !== "all") params.set("action", filters.actionFilter);
  if (filters.userNameFilter !== "all") params.set("userName", filters.userNameFilter);
  if (filters.searchQuery) params.set("q", filters.searchQuery);
  if (filters.fromDate) params.set("from", filters.fromDate);
  if (filters.toDate) params.set("to", filters.toDate);
  return params;
}

export default function SystemActivityLogPage() {
  const { allowed: canView } = usePermission('activity_log', 'view');
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");
  const [projectNameFilter, setProjectNameFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [userNameFilter, setUserNameFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedChangeSetId, setSelectedChangeSetId] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const activityQuery = useQuery<any, Error>({
    queryKey: ["activity-log", page, sourceFilter, entityTypeFilter, projectNameFilter, actionFilter, userNameFilter, searchQuery, fromDate, toDate],
    queryFn: async () => {
      const params = buildQueryParams({ sourceFilter, entityTypeFilter, projectNameFilter, actionFilter, userNameFilter, searchQuery, fromDate, toDate });
      params.set("page", String(page));
      params.set("limit", "50");
      const res = await authFetch(`/api/audit/activity-log?${params}`);
      if (!res.ok) throw new Error("The audit log could not be loaded.");
      return res.json();
    },
  });

  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  const detailQuery = useQuery<any, Error>({
    queryKey: ["changeset-detail", selectedChangeSetId],
    queryFn: async () => {
      if (!selectedChangeSetId) return null;
      const res = await authFetch(`/api/audit/changeset/${selectedChangeSetId}`);
      if (!res.ok) throw new Error("The selected audit event detail could not be loaded.");
      return res.json();
    },
    enabled: !!selectedChangeSetId,
  });

  const data = activityQuery.data;
  const detail = detailQuery.data;
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };
  const filters = data?.filters || { sources: [], entityTypes: [], actions: [], projectNames: [], userNames: [] };

  const activeFilterCount = [sourceFilter, entityTypeFilter, projectNameFilter, actionFilter, userNameFilter].filter(v => v !== "all").length
    + (fromDate ? 1 : 0) + (toDate ? 1 : 0) + (searchQuery ? 1 : 0);
  const auditStatuses = [
    { label: "Audit trail active", tone: "success" as const },
    activeFilterCount > 0
      ? { label: `${activeFilterCount} filters applied`, tone: "info" as const }
      : { label: "Showing full audit stream", tone: "neutral" as const },
  ];

  const handleClearFilters = useCallback(() => {
    setSourceFilter("all");
    setEntityTypeFilter("all");
    setProjectNameFilter("all");
    setActionFilter("all");
    setUserNameFilter("all");
    setSearchQuery("");
    setFromDate("");
    setToDate("");
    setPage(1);
  }, []);

  const handleExportCsv = useCallback(async () => {
    setIsExporting(true);
    try {
      const params = buildQueryParams({ sourceFilter, entityTypeFilter, projectNameFilter, actionFilter, userNameFilter, searchQuery, fromDate, toDate });
      const res = await authFetch(`/api/audit/activity-log/export?${params}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV export failed:", err);
    } finally {
      setIsExporting(false);
    }
  }, [sourceFilter, entityTypeFilter, projectNameFilter, actionFilter, userNameFilter, searchQuery, fromDate, toDate]);

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <AdminPageShell
      surfaceId="audit-log"
      title="Audit Log"
      description="Trace governed system activity, filter operational history, and drill into changes without leaving the admin control centre."
      statuses={auditStatuses}
      metrics={[
        { label: "Events", value: pagination.total, helper: "Matching current audit filters" },
        { label: "Filters", value: activeFilterCount, helper: "Search and governance filters applied" },
        { label: "Page", value: `${pagination.page}/${pagination.totalPages}`, helper: "Current audit page" },
      ]}
    >
    <div className="space-y-4" data-testid="activity-log-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-activity-log-title">System Activity Log</h1>
            <p className="text-sm text-muted-foreground">All logins, edits, imports, overrides, deletes, and system events</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm" data-testid="text-activity-total">
            {pagination.total} events
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={isExporting}
            data-testid="button-export-csv"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search all fields..."
                className="pl-8 w-full sm:w-[220px]"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                data-testid="input-activity-search"
              />
            </div>
            <SearchableSelect
              value={sourceFilter}
              onValueChange={(v) => { setSourceFilter(v); setPage(1); }}
              placeholder="Source"
              triggerClassName="w-[calc(50%-0.5rem)] sm:w-[150px]"
              data-testid="select-activity-source"
              options={[
                { value: "all", label: "All Sources" },
                ...filters.sources.map((s: string) => ({ value: s, label: s })),
              ]}
            />
            <SearchableSelect
              value={entityTypeFilter}
              onValueChange={(v) => { setEntityTypeFilter(v); setPage(1); }}
              placeholder="Entity Type"
              triggerClassName="w-[calc(50%-0.5rem)] sm:w-[160px]"
              data-testid="select-activity-entity"
              options={[
                { value: "all", label: "All Entities" },
                ...filters.entityTypes.map((e: string) => ({ value: e, label: e })),
              ]}
            />
            <SearchableSelect
              value={actionFilter}
              onValueChange={(v) => { setActionFilter(v); setPage(1); }}
              placeholder="Action"
              triggerClassName="w-[calc(50%-0.5rem)] sm:w-[160px]"
              data-testid="select-activity-action"
              options={[
                { value: "all", label: "All Actions" },
                ...filters.actions.map((a: string) => ({ value: a, label: a })),
              ]}
            />
            <SearchableSelect
              value={userNameFilter}
              onValueChange={(v) => { setUserNameFilter(v); setPage(1); }}
              placeholder="User"
              triggerClassName="w-[calc(50%-0.5rem)] sm:w-[160px]"
              data-testid="select-activity-user"
              options={[
                { value: "all", label: "All Users" },
                ...filters.userNames.map((u: string) => ({ value: u, label: u })),
              ]}
            />
            <SearchableSelect
              value={projectNameFilter}
              onValueChange={(v) => { setProjectNameFilter(v); setPage(1); }}
              placeholder="Project"
              triggerClassName="w-full sm:w-[180px]"
              data-testid="select-activity-project"
              options={[
                { value: "all", label: "All Projects" },
                ...filters.projectNames.map((p: string) => ({ value: p, label: p })),
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">From:</label>
              <Input
                type="date"
                className="w-[160px] h-9 text-sm"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                data-testid="input-activity-from-date"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">To:</label>
              <Input
                type="date"
                className="w-[160px] h-9 text-sm"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                data-testid="input-activity-to-date"
              />
            </div>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-clear-filters"
              >
                <X className="h-3 w-3 mr-1" />
                Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AdminQueryState
        isLoading={activityQuery.isLoading}
        error={activityQuery.error?.message || null}
        onRetry={() => void activityQuery.refetch()}
        loadingLabel="Loading audit activity..."
      >
        {items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No activity events found matching your filters.
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]" data-testid="activity-log-table">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 font-medium">Time</th>
                  <th className="text-left p-3 font-medium">User</th>
                  <th className="text-left p-3 font-medium">Source</th>
                  <th className="text-left p-3 font-medium">Action</th>
                  <th className="text-left p-3 font-medium">Entity</th>
                  <th className="text-left p-3 font-medium">Project</th>
                  <th className="text-left p-3 font-medium">Summary</th>
                  <th className="text-left p-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {items.map((cs: any, idx: number) => {
                  const source = cs.source || cs.Source || '';
                  const action = cs.action || '';
                  const entityType = cs.entity_type || cs.entityType || '';
                  const projectName = cs.project_name || cs.projectName || '';
                  const summary = cs.summary || '';
                  const createdAt = cs.created_at || cs.createdAt || '';
                  const recordType = cs.record_type || 'changeset';
                  const userName = cs.user_name || cs.userName || '';
                  const colorClass = SOURCE_COLORS[source] || SOURCE_COLORS.SYSTEM;
                  const uniqueKey = `${recordType}-${cs.id}-${idx}`;
                  return (
                    <tr key={uniqueKey} className="border-t hover:bg-muted/30" data-testid={`activity-row-${uniqueKey}`}>
                      <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                        {createdAt ? formatDate(createdAt) : "\u2014"}
                      </td>
                      <td className="p-3 text-xs font-medium whitespace-nowrap">
                        {userName || "\u2014"}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-xs ${colorClass}`}>{source}</Badge>
                      </td>
                      <td className="p-3 font-mono text-xs">{action}</td>
                      <td className="p-3 text-xs">{entityType}</td>
                      <td className="p-3 text-xs truncate max-w-[150px]">{projectName || "\u2014"}</td>
                      <td className="p-3 text-xs truncate max-w-[250px]">
                        {summary || "\u2014"}
                      </td>
                      <td className="p-3">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => {
                            if (recordType === 'changeset') {
                              setSelectedChangeSetId(cs.id);
                              setSelectedRecord(null);
                            } else {
                              setSelectedChangeSetId(null);
                              setSelectedRecord(cs);
                            }
                          }}
                          data-testid={`button-detail-${uniqueKey}`}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminQueryState>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            data-testid="button-activity-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pagination.totalPages}
          </span>
          <Button
            variant="outline" size="sm"
            onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
            disabled={page >= pagination.totalPages}
            data-testid="button-activity-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Dialog open={!!selectedChangeSetId || !!selectedRecord} onOpenChange={() => { setSelectedChangeSetId(null); setSelectedRecord(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Event Detail
            </DialogTitle>
          </DialogHeader>
          {selectedChangeSetId && detailQuery.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : selectedChangeSetId && detail ? (
            <div className="space-y-4" data-testid="activity-detail">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Source:</span> <Badge variant="outline">{detail.source}</Badge></div>
                <div><span className="text-muted-foreground">Action:</span> {detail.action}</div>
                <div><span className="text-muted-foreground">Entity:</span> {detail.entityType}</div>
                <div><span className="text-muted-foreground">Time:</span> {formatDate(detail.createdAt)}</div>
                {detail.actorRole && (
                  <div><span className="text-muted-foreground">Role:</span> {detail.actorRole}</div>
                )}
                {detail.projectName && (
                  <div><span className="text-muted-foreground">Project:</span> {detail.projectName}</div>
                )}
              </div>
              {detail.summary && (
                <p className="text-sm bg-muted p-2 rounded">{detail.summary}</p>
              )}
              {detail.overrideCategory && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Category:</span>{" "}
                  <Badge variant="secondary">{detail.overrideCategory}</Badge>
                  {detail.overrideComment && (
                    <p className="mt-1 italic text-muted-foreground">"{detail.overrideComment}"</p>
                  )}
                </div>
              )}
              {detail.fieldChanges && detail.fieldChanges.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Field Changes</h4>
                  <div className="border rounded overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left p-2 font-medium">Field</th>
                          <th className="text-left p-2 font-medium">Old</th>
                          <th className="text-left p-2 font-medium">New</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.fieldChanges.map((fc: any) => (
                          <tr key={fc.id} className="border-t">
                            <td className="p-2 font-mono text-xs">{fc.fieldName}</td>
                            <td className="p-2 text-red-600">{fc.oldValue ?? "\u2014"}</td>
                            <td className="p-2 text-green-600 flex items-center gap-1">
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              {fc.newValue ?? "\u2014"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : selectedChangeSetId && detailQuery.error ? (
            <AdminQueryState
              isLoading={false}
              error={detailQuery.error.message}
              onRetry={() => void detailQuery.refetch()}
            >
              <div />
            </AdminQueryState>
          ) : selectedRecord ? (
            <div className="space-y-4" data-testid="activity-detail-audit">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Source:</span> <Badge variant="outline" className={SOURCE_COLORS[selectedRecord.source] || ''}>{selectedRecord.source}</Badge></div>
                <div><span className="text-muted-foreground">Action:</span> {selectedRecord.action}</div>
                <div><span className="text-muted-foreground">Entity:</span> {selectedRecord.entity_type || selectedRecord.entityType}</div>
                <div><span className="text-muted-foreground">Time:</span> {formatDate(selectedRecord.created_at || selectedRecord.createdAt)}</div>
                {(selectedRecord.actor_role || selectedRecord.actorRole) && (
                  <div><span className="text-muted-foreground">Role:</span> {selectedRecord.actor_role || selectedRecord.actorRole}</div>
                )}
                {(selectedRecord.user_name || selectedRecord.userName) && (
                  <div><span className="text-muted-foreground">User:</span> {selectedRecord.user_name || selectedRecord.userName}</div>
                )}
                {(selectedRecord.project_name || selectedRecord.projectName) && (
                  <div><span className="text-muted-foreground">Project:</span> {selectedRecord.project_name || selectedRecord.projectName}</div>
                )}
                {(selectedRecord.ip_address || selectedRecord.ipAddress) && (
                  <div><span className="text-muted-foreground">IP:</span> {selectedRecord.ip_address || selectedRecord.ipAddress}</div>
                )}
                {(selectedRecord.request_method && selectedRecord.request_path) && (
                  <div className="col-span-2"><span className="text-muted-foreground">Request:</span> <code className="text-xs">{selectedRecord.request_method} {selectedRecord.request_path}</code></div>
                )}
              </div>
              {selectedRecord.summary && (
                <p className="text-sm bg-muted p-2 rounded">{selectedRecord.summary}</p>
              )}
              {selectedRecord.changes_json && typeof selectedRecord.changes_json === 'object' && Object.keys(selectedRecord.changes_json).length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Change Details</h4>
                  <div className="border rounded p-3 bg-muted/50 text-xs font-mono max-h-[300px] overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(selectedRecord.changes_json, null, 2)}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
    </AdminPageShell>
  );
}

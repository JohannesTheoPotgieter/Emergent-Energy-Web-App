import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

export default function SystemActivityLogPage() {
  const { allowed: canView } = usePermission('activity_log', 'view');
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");
  const [projectNameFilter, setProjectNameFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChangeSetId, setSelectedChangeSetId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["activity-log", page, sourceFilter, entityTypeFilter, projectNameFilter, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (entityTypeFilter !== "all") params.set("entityType", entityTypeFilter);
      if (projectNameFilter !== "all") params.set("projectName", projectNameFilter);
      if (searchQuery) params.set("q", searchQuery);
      const res = await authFetch(`/api/audit/activity-log?${params}`);
      if (!res.ok) throw new Error("Failed to load activity log");
      return res.json();
    },
  });

  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["changeset-detail", selectedChangeSetId],
    queryFn: async () => {
      if (!selectedChangeSetId) return null;
      const res = await authFetch(`/api/audit/changeset/${selectedChangeSetId}`);
      if (!res.ok) throw new Error("Failed to load detail");
      return res.json();
    },
    enabled: !!selectedChangeSetId,
  });

  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };
  const filters = data?.filters || { sources: [], entityTypes: [], actions: [], projectNames: [] };

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
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-activity-log-title">System Activity Log</h1>
            <p className="text-sm text-muted-foreground">All logins, edits, imports, overrides, deletes, and system events</p>
          </div>
        </div>
        <Badge variant="secondary" className="text-sm" data-testid="text-activity-total">
          {pagination.total} events
        </Badge>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events..."
                className="pl-8 w-full sm:w-[200px]"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                data-testid="input-activity-search"
              />
            </div>
            <SearchableSelect
              value={sourceFilter}
              onValueChange={(v) => { setSourceFilter(v); setPage(1); }}
              placeholder="Source"
              triggerClassName="w-[calc(50%-0.5rem)] sm:w-[160px]"
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
              triggerClassName="w-[calc(50%-0.5rem)] sm:w-[180px]"
              data-testid="select-activity-entity"
              options={[
                { value: "all", label: "All Entities" },
                ...filters.entityTypes.map((e: string) => ({ value: e, label: e })),
              ]}
            />
            <SearchableSelect
              value={projectNameFilter}
              onValueChange={(v) => { setProjectNameFilter(v); setPage(1); }}
              placeholder="Project"
              triggerClassName="w-full sm:w-[200px]"
              data-testid="select-activity-project"
              options={[
                { value: "all", label: "All Projects" },
                ...filters.projectNames.map((p: string) => ({ value: p, label: p })),
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12" data-testid="activity-loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading activity log...</span>
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No activity events found matching your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]" data-testid="activity-log-table">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">Time</th>
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
                      {createdAt ? formatDate(createdAt) : "—"}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className={`text-xs ${colorClass}`}>{source}</Badge>
                    </td>
                    <td className="p-3 font-mono text-xs">{action}</td>
                    <td className="p-3 text-xs">{entityType}</td>
                    <td className="p-3 text-xs truncate max-w-[150px]">{projectName || "—"}</td>
                    <td className="p-3 text-xs truncate max-w-[250px]">
                      {userName && !summary.includes(userName) ? <span className="font-medium">{userName}: </span> : null}
                      {summary || "—"}
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
          {selectedChangeSetId && detailLoading ? (
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
                            <td className="p-2 text-red-600">{fc.oldValue ?? "—"}</td>
                            <td className="p-2 text-green-600 flex items-center gap-1">
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              {fc.newValue ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
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
  );
}

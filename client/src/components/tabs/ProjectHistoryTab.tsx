import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  History, FileUp, Edit, Shield, GitMerge, Cpu, Users, Settings,
  ChevronLeft, ChevronRight, Loader2, ArrowRight,
} from "lucide-react";

const SOURCE_ICONS: Record<string, any> = {
  IMPORT: FileUp,
  MANUAL_EDIT: Edit,
  OVERRIDE: Shield,
  CONFLICT_RESOLUTION: GitMerge,
  PATTERN_LEARNING: Cpu,
  COUNTERPARTY_UPDATE: Users,
  SYSTEM: Settings,
};

const SOURCE_COLORS: Record<string, string> = {
  IMPORT: "bg-blue-100 text-blue-700",
  MANUAL_EDIT: "bg-green-100 text-green-700",
  OVERRIDE: "bg-amber-100 text-amber-700",
  CONFLICT_RESOLUTION: "bg-purple-100 text-purple-700",
  PATTERN_LEARNING: "bg-cyan-100 text-cyan-700",
  COUNTERPARTY_UPDATE: "bg-pink-100 text-pink-700",
  SYSTEM: "bg-gray-100 text-gray-700",
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

export function ProjectHistoryTab({ projectName }: { projectName: string }) {
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedChangeSetId, setSelectedChangeSetId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["project-history", projectName, page, sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "30" });
      if (sourceFilter && sourceFilter !== "all") params.set("source", sourceFilter);
      const res = await authFetch(`/api/audit/project-history-by-name/${encodeURIComponent(projectName)}?${params}`);
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["changeset-detail", selectedChangeSetId],
    queryFn: async () => {
      if (!selectedChangeSetId) return null;
      const res = await authFetch(`/api/audit/changeset/${selectedChangeSetId}`);
      if (!res.ok) throw new Error("Failed to load changeset detail");
      return res.json();
    },
    enabled: !!selectedChangeSetId,
  });

  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="history-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading history...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-lg">Project History</h3>
          <Badge variant="secondary" data-testid="text-history-count">{pagination.total} events</Badge>
        </div>
        <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]" data-testid="select-history-source-filter">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="IMPORT">Imports</SelectItem>
            <SelectItem value="MANUAL_EDIT">Manual Edits</SelectItem>
            <SelectItem value="OVERRIDE">Overrides</SelectItem>
            <SelectItem value="CONFLICT_RESOLUTION">Conflict Resolution</SelectItem>
            <SelectItem value="SYSTEM">System</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No history events found for this project.
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />
          <div className="space-y-3">
            {items.map((cs: any) => {
              const Icon = SOURCE_ICONS[cs.source] || Settings;
              const colorClass = SOURCE_COLORS[cs.source] || SOURCE_COLORS.SYSTEM;
              return (
                <div key={cs.id} className="relative pl-14" data-testid={`history-event-${cs.id}`}>
                  <div className={`absolute left-4 top-3 w-5 h-5 rounded-full flex items-center justify-center ${colorClass}`}>
                    <Icon className="h-3 w-3" />
                  </div>
                  <Card
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedChangeSetId(cs.id)}
                  >
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className={`text-xs ${colorClass}`}>
                              {cs.source}
                            </Badge>
                            <span className="text-xs font-medium text-foreground">{cs.action}</span>
                          </div>
                          {cs.summary && (
                            <p className="text-sm text-muted-foreground truncate">{cs.summary}</p>
                          )}
                          {cs.overrideCategory && (
                            <div className="flex items-center gap-1 mt-1">
                              <Badge variant="secondary" className="text-xs">{cs.overrideCategory}</Badge>
                              {cs.overrideComment && (
                                <span className="text-xs text-muted-foreground italic truncate max-w-[200px]">
                                  "{cs.overrideComment}"
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(cs.createdAt)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            data-testid="button-history-prev"
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
            data-testid="button-history-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Dialog open={!!selectedChangeSetId} onOpenChange={() => setSelectedChangeSetId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Change Detail
            </DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : detail ? (
            <div className="space-y-4" data-testid="changeset-detail">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Source:</span> <Badge variant="outline">{detail.source}</Badge></div>
                <div><span className="text-muted-foreground">Action:</span> {detail.action}</div>
                <div><span className="text-muted-foreground">Entity:</span> {detail.entityType}</div>
                <div><span className="text-muted-foreground">Time:</span> {formatDate(detail.createdAt)}</div>
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
                          <tr key={fc.id} className="border-t" data-testid={`field-change-${fc.fieldName}`}>
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
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
